import { collection, getDocs, doc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";

/**
 * Formats a raw material stock quantity with human-friendly packet + sub-unit breakdown.
 * Example: 9.8 packet with 500 ml pack -> "9 pkts + 400 ml" (total: 4,900 ml)
 * Example: 4.5 packet with 100 g pack -> "4 pkts + 50 g" (total: 450 g)
 */
export function formatRawStockDisplay(stockQty, unit, packQty, packUnit) {
  const qty = Number(stockQty) || 0;
  const u = String(unit || "pcs").toLowerCase().trim();
  const pQty = Number(packQty) || 0;
  const pUnit = String(packUnit || "").toLowerCase().trim();

  // If this item is sold in packets/boxes/cans and has a known sub-unit capacity (e.g. 500 ml, 100 g)
  if (["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pcs"].includes(u) && pQty > 0 && pUnit) {
    const fullPacks = Math.floor(qty);
    const fraction = Number((qty - fullPacks).toFixed(4));
    const fractionSubUnits = Math.round(fraction * pQty);
    const totalSubUnits = Math.round(qty * pQty);

    if (fullPacks === 0) {
      return {
        formatted: `${fractionSubUnits} ${pUnit}`,
        detail: `${fractionSubUnits} ${pUnit} remaining`,
        totalSubUnits: totalSubUnits,
        subUnit: pUnit,
        fullPacks: 0,
        fractionSubUnits
      };
    }

    if (fractionSubUnits === 0) {
      return {
        formatted: `${fullPacks} ${u} (${totalSubUnits.toLocaleString("en-IN")} ${pUnit})`,
        detail: `${totalSubUnits.toLocaleString("en-IN")} ${pUnit} total (${fullPacks} sealed ${u})`,
        totalSubUnits: totalSubUnits,
        subUnit: pUnit,
        fullPacks,
        fractionSubUnits: 0
      };
    }

    return {
      formatted: `${fullPacks} ${u} + ${fractionSubUnits} ${pUnit}`,
      detail: `${totalSubUnits.toLocaleString("en-IN")} ${pUnit} remaining (${fullPacks} sealed + ${fractionSubUnits} ${pUnit} open)`,
      totalSubUnits: totalSubUnits,
      subUnit: pUnit,
      fullPacks,
      fractionSubUnits
    };
  }

  // Weight in kg / g
  if (u === "kg") {
    const kilos = Math.floor(qty);
    const grams = Math.round((qty - kilos) * 1000);
    return {
      formatted: grams > 0 && kilos > 0 ? `${kilos} kg ${grams} g` : `${qty} kg`,
      detail: `${Math.round(qty * 1000).toLocaleString("en-IN")} g total`,
      totalSubUnits: Math.round(qty * 1000),
      subUnit: "g",
      fullPacks: kilos,
      fractionSubUnits: grams
    };
  }

  // Volume in L / ml
  if (u === "l") {
    const litres = Math.floor(qty);
    const mls = Math.round((qty - litres) * 1000);
    return {
      formatted: mls > 0 && litres > 0 ? `${litres} L ${mls} ml` : `${qty} L`,
      detail: `${Math.round(qty * 1000).toLocaleString("en-IN")} ml total`,
      totalSubUnits: Math.round(qty * 1000),
      subUnit: "ml",
      fullPacks: litres,
      fractionSubUnits: mls
    };
  }

  return {
    formatted: `${qty} ${u}`,
    detail: `${qty} ${u}`,
    totalSubUnits: qty,
    subUnit: u,
    fullPacks: qty,
    fractionSubUnits: 0
  };
}

/**
 * Calculates Recipe Portion Yield, Output & Shortage Variance.
 *
 * Example:
 * 1 packet of milk = 500 ml
 * 1 coffee portion = 10 ml
 * Expected Yield = 50 cups per packet
 * If 1 packet was consumed but only 48 cups were served:
 * Expected Output = 50 cups (500 ml)
 * Actual Output = 48 cups (480 ml)
 * Shortage = 2 cups (-20 ml)
 * Shortage % = 4.0% Loss
 */
export function calculatePortionYieldAndShortage({
  packCapacity = 500,
  portionQty = 10,
  packsUsed = 1,
  actualPortionsServed = 48,
  portionUnit = "ml",
  packCost = 50
}) {
  const cap = Number(packCapacity) || 500;
  const pQty = Number(portionQty) || 1;
  const pUsed = Math.max(1, Number(packsUsed) || 1);
  const actServed = Math.max(0, Number(actualPortionsServed) || 0);
  const cost = Number(packCost) || 0;

  // Expected yield per single pack
  const yieldPerPack = pQty > 0 ? Number((cap / pQty).toFixed(1)) : 0;
  
  // Total expected portions from the packs used
  const totalExpectedPortions = Math.round(yieldPerPack * pUsed);
  const totalVolumeOrWeight = cap * pUsed;

  // Actual consumption based on served portions
  const actualVolumeUsed = actServed * pQty;

  // Shortage (if fewer portions obtained than expected)
  const shortagePortions = Math.max(0, totalExpectedPortions - actServed);
  const shortageVolume = shortagePortions * pQty;
  const shortagePercent = totalExpectedPortions > 0 ? Number(((shortagePortions / totalExpectedPortions) * 100).toFixed(1)) : 0;
  
  // Cost of the lost/shortage amount
  const costPerPortion = totalExpectedPortions > 0 ? Number((cost / yieldPerPack).toFixed(2)) : 0;
  const shortageLossAmount = Number((shortagePortions * costPerPortion).toFixed(2));

  return {
    yieldPerPack,
    totalExpectedPortions,
    totalVolumeOrWeight,
    actualPortionsServed: actServed,
    actualVolumeUsed,
    shortagePortions,
    shortageVolume,
    shortagePercent,
    costPerPortion,
    shortageLossAmount,
    portionUnit,
    isShortage: shortagePortions > 0
  };
}

/**
 * Deducts raw material ingredients from Firestore when a food order is completed.
 * Matches ordered items against configured recipes in users/{uid}/recipes.
 * Converts units (kg <-> g, L <-> ml, packet <-> ml/g) accurately and updates users/{uid}/raw_materials in real-time.
 *
 * @param {string} uid - Store owner UID
 * @param {Array} orderedItems - Array of items in the completed bill/order
 */
export async function deductRecipeStock(uid, orderedItems, options = {}) {
  if (!uid || !Array.isArray(orderedItems) || orderedItems.length === 0) {
    return { success: false, reason: "No items or user" };
  }

  const targetBranchId = typeof options === "string" ? options : (options?.branchId || null);
  const isTargetPrimary = !targetBranchId || targetBranchId === "main_branch" || targetBranchId === "main_default" || targetBranchId === "BR-01";

  const itemMatchesBranch = (data) => {
    if (!targetBranchId) return true;
    if (!data.branchId && !data.branchName) return isTargetPrimary;
    return (
      data.branchId === targetBranchId ||
      (isTargetPrimary && (data.branchId === "main_branch" || data.branchId === "main_default" || data.branchId === "BR-01"))
    );
  };

  try {
    // 1. Fetch user's recipes
    const recipesRef = collection(db, "users", uid, "recipes");
    const recipesSnap = await getDocs(recipesRef);

    // 2. Fetch user's shop inventory & raw materials
    const invRef = collection(db, "users", uid, "inventory");
    const invSnap = await getDocs(invRef);

    const rawRef = collection(db, "users", uid, "raw_materials");
    const rawSnap = await getDocs(rawRef);

    if (invSnap.empty && rawSnap.empty) {
      console.log("[recipeStockService] No inventory or raw materials found for UID:", uid);
      return { success: false, reason: "No inventory stock items" };
    }

    const rawMap = {};
    if (!rawSnap.empty) {
      rawSnap.forEach((d) => {
        const data = d.data();
        if (itemMatchesBranch(data)) {
          rawMap[d.id] = { id: d.id, ...data };
        }
      });
    }
    if (!invSnap.empty) {
      invSnap.forEach((d) => {
        const data = d.data();
        if (itemMatchesBranch(data)) {
          const existing = rawMap[d.id];
          rawMap[d.id] = {
            id: d.id,
            name: data.itemName || data.name || (existing ? existing.name : ""),
            stockQuantity: data.quantity != null ? data.quantity : (existing ? existing.stockQuantity : 0),
            unit: data.unitType || data.unit || (existing ? existing.unit : "pcs"),
            costPerUnit: data.purchasePrice != null ? data.purchasePrice : (existing ? existing.costPerUnit : 0),
            packQuantity: data.packQuantity || (existing ? existing.packQuantity : null),
            packUnit: data.packUnit || (existing ? existing.packUnit : null),
            ...data,
            isInventory: true
          };
        }
      });
    }

    const recipeMap = {};
    if (!recipesSnap.empty) {
      recipesSnap.forEach((d) => {
        const data = d.data();
        const rId = String(d.id);
        recipeMap[rId] = data;
        if (data.productId) recipeMap[String(data.productId)] = data;
        if (data.productName) {
          const cleanP = data.productName.toLowerCase().trim();
          recipeMap[cleanP] = data;
          recipeMap[cleanP.replace(/[^\w\s]/g, "").trim()] = data;
        }
        if (data.name) {
          const cleanN = data.name.toLowerCase().trim();
          recipeMap[cleanN] = data;
          recipeMap[cleanN.replace(/[^\w\s]/g, "").trim()] = data;
        }
      });
    }

    // Map of raw material id -> { deductBaseUnits, deductSubUnits, subUnit, dishNames }
    const deductions = {};
    const deductedItemsLog = [];

    for (const item of orderedItems) {
      const pId = String(item.id || item.foodId || item.barcode || "");
      const pName = String(item.name || item.itemName || "").toLowerCase().trim();
      const pNameClean = pName.replace(/[^\w\s]/g, "").trim();
      const orderQty = Math.max(1, Number(item.qty || item.quantity || 1));

      // Bulletproof matching: direct id -> direct name -> cleaned name -> substring match
      let recipe = recipeMap[pId] || recipeMap[pName] || recipeMap[pNameClean];
      if (!recipe) {
        recipe = Object.values(recipeMap).find((r) => {
          const rName = (r.productName || r.name || "").toLowerCase().trim();
          return rName === pName || (pName && rName.includes(pName)) || (rName && pName.includes(rName));
        });
      }

      if (recipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
        for (const ing of recipe.ingredients) {
          let rawId = ing.rawMaterialId;
          let raw = rawMap[rawId];

          // Fallback lookup across raw materials by name
          if (!raw && ing.name) {
            const ingClean = (ing.name || "").toLowerCase().trim();
            const ingSimple = ingClean.replace(/[^\w\s]/g, "");
            raw = Object.values(rawMap).find((r) => {
              const rName = (r.name || "").toLowerCase().trim();
              const rClean = rName.replace(/[^\w\s]/g, "");
              return (
                rName === ingClean ||
                rClean === ingSimple ||
                (ingClean.length > 3 && (rName.includes(ingClean) || ingClean.includes(rName)))
              );
            });
            if (raw) rawId = raw.id;
          }

          if (!raw) continue;

          const ingQty = Number(ing.quantity || ing.qty || 0);
          if (ingQty <= 0) continue;

          const ingUnit = String(ing.unit || raw.unit || "").toLowerCase().trim();
          const rawUnit = String(raw.unit || "pcs").toLowerCase().trim();

          // Sub-unit amount used per single portion
          const singleSubUnitQty = ingQty;
          const totalSubUnitAmount = Number((singleSubUnitQty * orderQty).toFixed(2));

          // Unit conversion to raw material base unit
          let convertedQty = ingQty;
          let packCapacity = Number(ing.packQuantity || raw.packQuantity || raw.packSizeVal || 0);
          let packCapacityUnit = String(ing.packUnit || raw.packUnit || raw.packSizeUnit || "").toLowerCase().trim();

          if (rawUnit === "kg" && ingUnit === "g") {
            convertedQty = ingQty / 1000;
          } else if (rawUnit === "g" && ingUnit === "kg") {
            convertedQty = ingQty * 1000;
          } else if (rawUnit === "l" && ingUnit === "ml") {
            convertedQty = ingQty / 1000;
          } else if (rawUnit === "ml" && ingUnit === "l") {
            convertedQty = ingQty * 1000;
          } else if (["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pcs"].includes(rawUnit)) {
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

          const totalDeductBase = Number((convertedQty * orderQty).toFixed(4));

          if (!deductions[rawId]) {
            deductions[rawId] = {
              deductBaseUnits: 0,
              deductSubUnits: 0,
              subUnit: ingUnit,
              packCapacity: packCapacity || null,
              packUnit: packCapacityUnit || ingUnit,
              dishNames: []
            };
          }

          deductions[rawId].deductBaseUnits += totalDeductBase;
          deductions[rawId].deductSubUnits += totalSubUnitAmount;
          deductions[rawId].dishNames.push(`${item.name || item.itemName} (${orderQty})`);

          deductedItemsLog.push({
            dishName: item.name || item.itemName,
            ingredientName: raw.name,
            deductedBase: totalDeductBase,
            deductedSubUnit: `${totalSubUnitAmount} ${ingUnit}`,
            unit: raw.unit || "unit",
          });
        }
      }
    }

    // Apply deductions to raw_materials in Firestore
    const updates = [];
    const outOfStockIngredients = [];
    const lowStockIngredients = [];

    for (const [rawId, info] of Object.entries(deductions)) {
      const raw = rawMap[rawId];
      if (!raw) continue;

      const currentStock = Number(raw.stockQuantity || 0);
      const newStock = Math.max(0, Number((currentStock - info.deductBaseUnits).toFixed(4)));
      const minAlert = Number(raw.minAlertQuantity || 0);
      const unitLabel = raw.unit || "pcs";
      const uniqueDishes = [...new Set(info.dishNames.map((d) => String(d).replace(/\s*\(\d+\)$/, "").trim()).filter(Boolean))];

      const prevTotalUsedSub = Number(raw.totalUsedSubUnits || 0);
      const newTotalUsedSub = Number((prevTotalUsedSub + info.deductSubUnits).toFixed(2));

      if (!raw.isInventory) {
        const p = updateDoc(doc(db, "users", uid, "raw_materials", rawId), {
          stockQuantity: newStock,
          totalUsedSubUnits: newTotalUsedSub,
          lastDeductedAmount: info.deductBaseUnits,
          lastDeductedSubUnits: `${info.deductSubUnits} ${info.subUnit}`,
          lastDeductedDish: info.dishNames.join(", "),
          packQuantity: info.packCapacity || raw.packQuantity || null,
          packUnit: info.packUnit || raw.packUnit || null,
          lastDeductedAt: Date.now(),
          updatedAtMs: Date.now(),
        }).catch(() => {});
        updates.push(p);
      }

      if (newStock <= 0) {
        outOfStockIngredients.push({
          id: rawId,
          name: raw.name || "Ingredient",
          unit: unitLabel,
          previousStock: currentStock,
          newStock: 0,
          minAlertQuantity: minAlert,
          dishes: uniqueDishes,
        });
      } else if (minAlert > 0 && newStock <= minAlert) {
        lowStockIngredients.push({
          id: rawId,
          name: raw.name || "Ingredient",
          unit: unitLabel,
          previousStock: currentStock,
          newStock,
          minAlertQuantity: minAlert,
          dishes: uniqueDishes,
        });
      }

      console.log(
        `[recipeStockService] Deducted ${info.deductSubUnits} ${info.subUnit} (${info.deductBaseUnits} ${raw.unit}) from "${raw.name}". Stock: ${currentStock} -> ${newStock}`
      );
    }

    // Also deduct matching items in inventory so POS app and Web app stay identical
    try {
      const invRef = collection(db, "users", uid, "inventory");
      const invSnap = await getDocs(invRef);
      if (!invSnap.empty) {
        invSnap.forEach((invDoc) => {
          const invData = invDoc.data();
          if (!itemMatchesBranch(invData)) return; // Only deduct matching branch's inventory!
          const invName = (invData.itemName || invData.name || "").toLowerCase().trim();
          for (const [rawId, info] of Object.entries(deductions)) {
            const raw = rawMap[rawId];
            if (!raw) continue;
            const rName = (raw.name || "").toLowerCase().trim();
            if (invName === rName || invDoc.id === rawId) {
              const curQty = Number(invData.quantity || 0);
              const newQty = Math.max(0, Number((curQty - info.deductBaseUnits).toFixed(4)));
              updates.push(
                updateDoc(doc(db, "users", uid, "inventory", invDoc.id), {
                  quantity: newQty,
                  updatedAt: Date.now(),
                })
              );
              console.log(
                `[recipeStockService] Deducted ${info.deductBaseUnits} from inventory "${invName}". Quantity: ${curQty} -> ${newQty}`
              );
            }
          }
        });
      }
    } catch (invErr) {
      console.warn("[recipeStockService] inventory deduction notice:", invErr);
    }

    // Dispatch persistent & desktop alerts for empty or low-stock recipe ingredients
    const allAlertIngredients = [
      ...outOfStockIngredients.map((item) => ({ ...item, severity: "out_of_stock" })),
      ...lowStockIngredients.map((item) => ({ ...item, severity: "low_stock" })),
    ];

    for (const alertItem of allAlertIngredients) {
      const isEmpty = alertItem.severity === "out_of_stock";
      const dishSummary = alertItem.dishes.length > 0 ? alertItem.dishes.join(", ") : "Configured recipes";
      const title = isEmpty
        ? `🚨 Recipe Stock Empty: ${alertItem.name}`
        : `⚠️ Recipe Stock Low: ${alertItem.name}`;
      const body = isEmpty
        ? `0 ${alertItem.unit} remaining! Needed for: ${dishSummary}. Please restock.`
        : `${alertItem.newStock} ${alertItem.unit} left (Min: ${alertItem.minAlertQuantity}) • Used in: ${dishSummary}`;

      updates.push(
        setDoc(doc(db, "users", uid, "owner_notifications", `recipe_alert_${alertItem.id}`), {
          type: "recipe_stock_alert",
          severity: alertItem.severity,
          ingredientId: alertItem.id,
          ingredientName: alertItem.name,
          remainingStock: alertItem.newStock,
          unit: alertItem.unit,
          minAlertQuantity: alertItem.minAlertQuantity,
          dishes: alertItem.dishes,
          title,
          body,
          data: {
            ingredientId: alertItem.id,
            ingredientName: alertItem.name,
            remainingStock: alertItem.newStock,
            unit: alertItem.unit,
            dishes: alertItem.dishes,
          },
          read: false,
          resolved: false,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        }).catch((err) => {
          console.warn("[recipeStockService] alert write notice:", err);
        })
      );

      try {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification(title, {
            body,
            tag: `recipe_alert_${alertItem.id}`,
            renotify: true,
          });
        }
      } catch (notifErr) {
        console.warn("[recipeStockService] desktop notification notice:", notifErr);
      }
    }

    await Promise.all(updates);
    return {
      success: true,
      deductionsCount: Object.keys(deductions).length,
      details: deductedItemsLog,
      outOfStockIngredients,
      lowStockIngredients,
    };
  } catch (err) {
    console.error("[recipeStockService] Failed to deduct recipe stock:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Evaluates all configured recipes against current raw materials & inventory stock
 * to return ingredients that are empty (<= 0) or below minimum alert threshold.
 */
export function evaluateRecipeIngredientAlerts({
  recipes = [],
  rawMaterials = [],
  inventoryItems = [],
} = {}) {
  const byId = new Map();
  const byName = new Map();

  const registerItem = (item, fromInventory = false) => {
    if (!item) return;
    const id = String(item.id || "");
    const name = String(item.itemName || item.name || "").trim();
    const keyName = name.toLowerCase();
    const stockQuantity = Number(
      fromInventory
        ? (item.quantity ?? item.stockQuantity ?? 0)
        : (item.stockQuantity ?? item.quantity ?? 0)
    );
    const minAlertQuantity = Number(item.minAlertQuantity ?? 0);
    const unit = item.unit || item.unitType || "pcs";

    const normalized = {
      id,
      name: name || "Ingredient",
      stockQuantity: Number.isFinite(stockQuantity) ? stockQuantity : 0,
      minAlertQuantity: Number.isFinite(minAlertQuantity) ? minAlertQuantity : 0,
      unit,
      fromInventory,
    };

    if (id && (!fromInventory || !byId.has(id))) {
      byId.set(id, normalized);
    }
    if (keyName && (!fromInventory || !byName.has(keyName))) {
      byName.set(keyName, normalized);
    }
  };

  (rawMaterials || []).forEach((r) => registerItem(r, false));
  (inventoryItems || []).forEach((inv) => registerItem(inv, true));

  const alertMap = new Map();

  (recipes || []).forEach((recipe) => {
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    if (ingredients.length === 0) return;
    const dishName = String(recipe.productName || recipe.name || "Menu Item").trim();

    ingredients.forEach((ing) => {
      const ingId = String(ing.rawMaterialId || "");
      const ingNameClean = String(ing.name || "").toLowerCase().trim();
      const ingSimple = ingNameClean.replace(/[^\w\s]/g, "");

      let raw = (ingId && byId.get(ingId)) || (ingNameClean && byName.get(ingNameClean)) || null;
      if (!raw && ingNameClean) {
        for (const candidate of byId.values()) {
          const rName = candidate.name.toLowerCase().trim();
          const rClean = rName.replace(/[^\w\s]/g, "");
          if (
            rName === ingNameClean ||
            rClean === ingSimple ||
            (ingNameClean.length > 3 && (rName.includes(ingNameClean) || ingNameClean.includes(rName)))
          ) {
            raw = candidate;
            break;
          }
        }
      }

      if (!raw) return;

      const isOutOfStock = raw.stockQuantity <= 0;
      const isLowStock = !isOutOfStock && raw.minAlertQuantity > 0 && raw.stockQuantity <= raw.minAlertQuantity;
      if (!isOutOfStock && !isLowStock) return;

      const alertKey = raw.id || raw.name.toLowerCase();
      if (!alertMap.has(alertKey)) {
        alertMap.set(alertKey, {
          id: raw.id,
          name: raw.name,
          stockQuantity: raw.stockQuantity,
          minAlertQuantity: raw.minAlertQuantity,
          unit: raw.unit,
          isOutOfStock,
          isLowStock,
          dishes: [],
        });
      }
      const entry = alertMap.get(alertKey);
      if (dishName && !entry.dishes.includes(dishName)) {
        entry.dishes.push(dishName);
      }
    });
  });

  return Array.from(alertMap.values()).sort((a, b) => {
    if (a.isOutOfStock !== b.isOutOfStock) return a.isOutOfStock ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Marks a recipe stock alert notification as resolved/read after restocking.
 */
export async function markRecipeStockAlertResolved(uid, ingredientId) {
  if (!uid || !ingredientId) return;
  try {
    await updateDoc(doc(db, "users", uid, "owner_notifications", `recipe_alert_${ingredientId}`), {
      read: true,
      resolved: true,
      resolvedAtMs: Date.now(),
    });
  } catch (err) {
    console.warn("[recipeStockService] resolve alert notice:", err);
  }
}
