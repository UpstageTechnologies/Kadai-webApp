import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

/**
 * Deducts raw material ingredients from Firestore when a food order is completed.
 * Matches ordered items against configured recipes in users/{uid}/recipes.
 * Converts units (kg <-> g, L <-> ml, pcs) accurately and updates users/{uid}/raw_materials in real-time.
 *
 * @param {string} uid - Store owner UID
 * @param {Array} orderedItems - Array of items in the completed bill/order
 */
export async function deductRecipeStock(uid, orderedItems) {
  if (!uid || !Array.isArray(orderedItems) || orderedItems.length === 0) {
    return { success: false, reason: "No items or user" };
  }

  try {
    // 1. Fetch user's recipes
    const recipesRef = collection(db, "users", uid, "recipes");
    const recipesSnap = await getDocs(recipesRef);

    // 2. Fetch user's raw materials (grocery stock)
    const rawRef = collection(db, "users", uid, "raw_materials");
    const rawSnap = await getDocs(rawRef);

    if (rawSnap.empty) {
      console.log("[recipeStockService] No raw materials found for UID:", uid);
      return { success: false, reason: "No raw materials inventory" };
    }

    const rawMap = {};
    rawSnap.forEach((d) => {
      rawMap[d.id] = { id: d.id, ...d.data() };
    });

    const recipeMap = {};
    if (!recipesSnap.empty) {
      recipesSnap.forEach((d) => {
        const data = d.data();
        const rId = String(d.id);
        recipeMap[rId] = data;
        if (data.productId) recipeMap[String(data.productId)] = data;
        if (data.productName) {
          recipeMap[data.productName.toLowerCase().trim()] = data;
        }
      });
    }

    // Map of raw material id -> total quantity to deduct (in base units of the raw material)
    const deductions = {};
    const deductedItemsLog = [];

    for (const item of orderedItems) {
      const pId = String(item.id || item.foodId || "");
      const pName = String(item.name || item.itemName || "").toLowerCase().trim();
      const orderQty = Math.max(1, Number(item.qty || item.quantity || 1));

      // Check if item has a recipe
      const recipe = recipeMap[pId] || recipeMap[pName];
      if (recipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
        for (const ing of recipe.ingredients) {
          let rawId = ing.rawMaterialId;
          let raw = rawMap[rawId];

          // If rawMaterialId not matched, fallback lookup by ingredient name
          if (!raw && ing.name) {
            const found = Object.values(rawMap).find(
              (r) => (r.name || "").toLowerCase().trim() === (ing.name || "").toLowerCase().trim()
            );
            if (found) {
              rawId = found.id;
              raw = found;
            }
          }

          if (!raw) continue;

          const ingQty = Number(ing.quantity || ing.qty || 0);
          if (ingQty <= 0) continue;

          const ingUnit = String(ing.unit || raw.unit || "").toLowerCase().trim();
          const rawUnit = String(raw.unit || "pcs").toLowerCase().trim();

          // Unit conversion to raw material base unit
          let convertedQty = ingQty;
          if (rawUnit === "kg" && ingUnit === "g") {
            convertedQty = ingQty / 1000;
          } else if (rawUnit === "g" && ingUnit === "kg") {
            convertedQty = ingQty * 1000;
          } else if (rawUnit === "l" && ingUnit === "ml") {
            convertedQty = ingQty / 1000;
          } else if (rawUnit === "ml" && ingUnit === "l") {
            convertedQty = ingQty * 1000;
          } else if (["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pcs"].includes(rawUnit)) {
            let packCapacity = Number(ing.packQuantity || raw.packQuantity || raw.packSizeVal || 0);
            let packCapacityUnit = String(ing.packUnit || raw.packUnit || raw.packSizeUnit || "").toLowerCase().trim();
            if (!packCapacity || packCapacity <= 0) {
              if (ingUnit === "ml" || ingUnit === "l") {
                packCapacity = 500;
                packCapacityUnit = "ml";
              } else if (ingUnit === "g" || ingUnit === "kg") {
                packCapacity = 100;
                packCapacityUnit = "g";
              }
            }
            if (packCapacity > 0) {
              const ingVal = (ingUnit === "kg" || ingUnit === "l") ? ingQty * 1000 : ingQty;
              const packVal = (packCapacityUnit === "kg" || packCapacityUnit === "l") ? packCapacity * 1000 : packCapacity;
              convertedQty = ingVal / packVal;
            }
          }

          const totalDeduct = Number((convertedQty * orderQty).toFixed(4));
          deductions[rawId] = (deductions[rawId] || 0) + totalDeduct;
          deductedItemsLog.push({
            dishName: item.name || item.itemName,
            ingredientName: raw.name,
            deducted: totalDeduct,
            unit: raw.unit || "unit",
          });
        }
      }
    }

    // Apply deductions to raw_materials in Firestore
    const updates = [];
    for (const [rawId, amount] of Object.entries(deductions)) {
      const raw = rawMap[rawId];
      if (!raw) continue;

      const currentStock = Number(raw.stockQuantity || 0);
      const newStock = Math.max(0, Number((currentStock - amount).toFixed(3)));

      const p = updateDoc(doc(db, "users", uid, "raw_materials", rawId), {
        stockQuantity: newStock,
        lastDeductedAmount: amount,
        lastDeductedAt: Date.now(),
        updatedAtMs: Date.now(),
      });
      updates.push(p);
      console.log(
        `[recipeStockService] Deducted ${amount} ${raw.unit} from "${raw.name}". Stock: ${currentStock} -> ${newStock}`
      );
    }

    // Also deduct matching items in inventory so POS app and Web app stay identical
    try {
      const invRef = collection(db, "users", uid, "inventory");
      const invSnap = await getDocs(invRef);
      if (!invSnap.empty) {
        invSnap.forEach((invDoc) => {
          const invData = invDoc.data();
          const invName = (invData.itemName || invData.name || "").toLowerCase().trim();
          for (const [rawId, amount] of Object.entries(deductions)) {
            const raw = rawMap[rawId];
            if (!raw) continue;
            const rName = (raw.name || "").toLowerCase().trim();
            if (invName === rName || invDoc.id === rawId) {
              const curQty = Number(invData.quantity || 0);
              const newQty = Math.max(0, Number((curQty - amount).toFixed(3)));
              updates.push(
                updateDoc(doc(db, "users", uid, "inventory", invDoc.id), {
                  quantity: newQty,
                  updatedAt: Date.now(),
                })
              );
              console.log(
                `[recipeStockService] Deducted ${amount} from inventory "${invName}". Quantity: ${curQty} -> ${newQty}`
              );
            }
          }
        });
      }
    } catch (invErr) {
      console.warn("[recipeStockService] inventory deduction notice:", invErr);
    }

    await Promise.all(updates);
    return {
      success: true,
      deductionsCount: Object.keys(deductions).length,
      details: deductedItemsLog,
    };
  } catch (err) {
    console.error("[recipeStockService] Failed to deduct recipe stock:", err);
    return { success: false, error: err.message };
  }
}
