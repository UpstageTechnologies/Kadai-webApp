import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy
} from "firebase/firestore";

/**
 * Standardized Waste & Spoilage Reason Categories
 * Covers both Retail Shop and Restaurant/Kitchen operations.
 */
export const WASTE_REASONS = [
  { id: "expired", label: "Expired / Past Shelf Life", category: "Retail & Kitchen", icon: "⏰" },
  { id: "spoilage", label: "Kitchen Spoilage / Rotten", category: "Produce & Kitchen", icon: "🥬" },
  { id: "cooking_error", label: "Burnt / Cooking Mistake", category: "Kitchen", icon: "🔥" },
  { id: "damaged", label: "Damaged Packaging / Broken", category: "Retail & Storage", icon: "📦" },
  { id: "overprep", label: "Over-Preparation / Leftover", category: "Kitchen & Buffet", icon: "🍲" },
  { id: "plate_waste", label: "Customer Return / Plate Waste", category: "Dine-In", icon: "🍽️" },
  { id: "spill", label: "Spill / Contamination", category: "General", icon: "💧" },
  { id: "temp_failure", label: "Freezer / Power Failure", category: "Storage", icon: "❄️" },
  { id: "quality", label: "Quality / Taste Defect", category: "Quality", icon: "⚠️" },
  { id: "other", label: "Other Operational Loss", category: "General", icon: "📝" },
];

/**
 * Validates waste logging inputs.
 */
export function validateWasteInput({ uid, itemId, wastedQty, availableStock }) {
  if (!uid || typeof uid !== "string" || !uid.trim()) {
    throw new Error("User must be authenticated to record waste.");
  }

  if (!itemId || typeof itemId !== "string" || !itemId.trim()) {
    throw new Error("Item selection is required.");
  }

  const qty = Number(wastedQty);
  if (!Number.isFinite(qty) || isNaN(qty)) {
    throw new Error("Wasted quantity must be a valid number.");
  }

  if (qty <= 0) {
    throw new Error("Wasted quantity must be greater than zero.");
  }

  if (availableStock !== undefined && availableStock !== null) {
    const stock = Number(availableStock) || 0;
    if (qty > stock) {
      throw new Error(`Wasted quantity (${qty}) cannot exceed available stock (${stock}).`);
    }
  }

  return qty;
}

/**
 * Calculates financial loss based strictly on purchase cost / unit expense.
 * Formula: Total Loss = Unit Cost * Wasted Quantity
 * Never based on selling price, to reflect true operational expense/shrinkage.
 */
export function calculateWasteLoss(unitCost, wastedQty) {
  const cost = Number(unitCost) >= 0 ? Number(unitCost) : 0;
  const qty = Number(wastedQty) > 0 ? Number(wastedQty) : 0;
  const loss = cost * qty;
  return Math.round(loss * 100) / 100;
}

/**
 * Aggregates statistics for waste records across timeframes and categories.
 */
export function calculateWasteStats(records = []) {
  if (!Array.isArray(records)) {
    return {
      totalLoss: 0,
      totalQuantity: 0,
      todayLoss: 0,
      todayQuantity: 0,
      monthLoss: 0,
      monthQuantity: 0,
      byReason: {},
      topLossItems: [],
    };
  }

  const now = new Date();
  const isToday = (d) =>
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const isCurrentMonth = (d) =>
    d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  let totalLoss = 0;
  let totalQuantity = 0;
  let todayLoss = 0;
  let todayQuantity = 0;
  let monthLoss = 0;
  let monthQuantity = 0;

  const reasonMap = {};
  const itemMap = {};

  for (const record of records) {
    if (!record) continue;
    const loss = Number(record.totalLoss) || 0;
    const qty = Number(record.wastedQuantity || record.expiredQuantity) || 0;
    const date = record.parsedDate || (record.createdAt ? new Date(record.createdAt.seconds ? record.createdAt.seconds * 1000 : record.createdAt) : new Date());

    totalLoss += loss;
    totalQuantity += qty;

    if (isToday(date)) {
      todayLoss += loss;
      todayQuantity += qty;
    }

    if (isCurrentMonth(date)) {
      monthLoss += loss;
      monthQuantity += qty;
    }

    // Reason aggregation
    const reasonKey = record.reason || "Unspecified";
    reasonMap[reasonKey] = (reasonMap[reasonKey] || 0) + loss;

    // Item aggregation (Pareto)
    const itemName = record.productName || record.itemName || "Unnamed";
    if (!itemMap[itemName]) {
      itemMap[itemName] = {
        name: itemName,
        totalLoss: 0,
        totalQuantity: 0,
        unitType: record.unitType || "Qty",
        category: record.category || "General",
      };
    }
    itemMap[itemName].totalLoss += loss;
    itemMap[itemName].totalQuantity += qty;
  }

  // Top items sorted by total financial loss descending
  const topLossItems = Object.values(itemMap)
    .sort((a, b) => b.totalLoss - a.totalLoss)
    .slice(0, 5)
    .map((item) => ({
      ...item,
      totalLoss: Math.round(item.totalLoss * 100) / 100,
      totalQuantity: Math.round(item.totalQuantity * 100) / 100,
    }));

  return {
    totalLoss: Math.round(totalLoss * 100) / 100,
    totalQuantity: Math.round(totalQuantity * 100) / 100,
    todayLoss: Math.round(todayLoss * 100) / 100,
    todayQuantity: Math.round(todayQuantity * 100) / 100,
    monthLoss: Math.round(monthLoss * 100) / 100,
    monthQuantity: Math.round(monthQuantity * 100) / 100,
    byReason: reasonMap,
    topLossItems,
  };
}

/**
 * Atomically records waste in Firestore and updates stock.
 * Supports:
 * 1. Retail Products (users/{uid}/inventory or global_inventory)
 * 2. Restaurant Raw Materials (users/{uid}/raw_materials)
 * 3. Restaurant Food Items (users/{uid}/restaurant_menu)
 *
 * Atomically deducts stock and writes to `users/{uid}/waste_records`.
 * Also dual-writes to `users/{uid}/expired_products` if marked expired for backward compatibility.
 */
export async function logWasteRecord({
  db,
  uid,
  itemId,
  itemType = "shop_product", // "shop_product" | "restaurant_raw_material" | "restaurant_food_item"
  wastedQty,
  reason = "Expired / Past Shelf Life",
  notes = "",
  reportedBy = "Store Owner",
  shopMode = "local",
  unitCost,
  unitType,
  productName,
  category,
  image,
}) {
  const qty = validateWasteInput({ uid, itemId, wastedQty });

  // Resolve target stock collection
  let targetCol = "inventory";
  if (itemType === "restaurant_raw_material") {
    targetCol = "raw_materials";
  } else if (itemType === "restaurant_food_item") {
    targetCol = "restaurant_menu";
  } else if (shopMode === "global") {
    targetCol = "global_inventory";
  }

  const itemRef = doc(db, "users", uid, targetCol, itemId);
  const wasteColRef = collection(db, "users", uid, "waste_records");
  const wasteDocRef = doc(wasteColRef);
  const expiredColRef = collection(db, "users", uid, "expired_products");
  const expiredDocRef = doc(expiredColRef);

  return await runTransaction(db, async (transaction) => {
    const itemSnap = await transaction.get(itemRef);
    let currentStock = 0;
    let cost = 0;
    let resolvedName = productName || "Unnamed Item";
    let resolvedUnit = unitType || "Qty";
    let resolvedCat = category || "General";
    let resolvedImg = image || "";

    if (itemSnap.exists()) {
      const itemData = itemSnap.data();
      currentStock = Number(itemData.quantity ?? itemData.stockQuantity ?? 0);
      cost = Number(itemData.purchasePrice ?? itemData.costPerUnit ?? unitCost ?? 0);
      resolvedName = itemData.itemName || itemData.name || resolvedName;
      resolvedUnit = itemData.unitType || itemData.unit || resolvedUnit;
      resolvedCat = itemData.category || resolvedCat;
      resolvedImg = itemData.image || itemData.imageUrl || resolvedImg;

      if (qty > currentStock) {
        throw new Error(
          `Wasted quantity (${qty}) exceeds available stock (${currentStock}) for "${resolvedName}".`
        );
      }

      const remainingStock = Math.max(0, currentStock - qty);

      // Atomically reduce stock
      if (itemType === "restaurant_raw_material") {
        transaction.update(itemRef, {
          stockQuantity: remainingStock,
          updatedAt: serverTimestamp(),
        });
      } else {
        transaction.update(itemRef, {
          quantity: remainingStock,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      // If doc not found (e.g. prepared dish tracked without separate doc), use passed cost
      cost = Number(unitCost) >= 0 ? Number(unitCost) : 0;
    }

    const totalLoss = calculateWasteLoss(cost, qty);
    const isExpired = reason.toLowerCase().includes("expired");

    const wasteRecord = {
      productId: itemId,
      itemId,
      productName: resolvedName,
      itemName: resolvedName,
      productImage: resolvedImg,
      itemType,
      category: resolvedCat,
      unitType: resolvedUnit,
      purchasePrice: cost,
      unitCost: cost,
      wastedQuantity: qty,
      expiredQuantity: qty,
      previousQuantity: currentStock,
      remainingQuantity: Math.max(0, currentStock - qty),
      totalLoss,
      reason: reason.trim(),
      notes: notes ? notes.trim() : "",
      reportedBy: reportedBy || "Store Owner",
      shopMode: shopMode === "global" ? "global" : "local",
      inventoryReduced: itemSnap.exists(),
      createdAt: serverTimestamp(),
    };

    // 1. Write to modern waste_records collection
    transaction.set(wasteDocRef, wasteRecord);

    // 2. Dual-write to legacy expired_products if expired, for backwards compatibility
    if (isExpired) {
      transaction.set(expiredDocRef, {
        ...wasteRecord,
        expirationDate: new Date().toISOString().split("T")[0],
      });
    }

    return {
      success: true,
      id: wasteDocRef.id,
      ...wasteRecord,
      createdAtDate: new Date(),
    };
  });
}

/**
 * Subscribes to real-time waste records for a user.
 * Merges waste_records and legacy expired_products seamlessly.
 */
export function subscribeWasteRecords(db, uid, onData, onError) {
  if (!db || !uid) return () => {};

  const wasteColRef = collection(db, "users", uid, "waste_records");
  const expiredColRef = collection(db, "users", uid, "expired_products");

  let wasteList = [];
  let expiredList = [];

  const mergeAndEmit = () => {
    const map = new Map();

    // Add waste records
    for (const w of wasteList) {
      map.set(w.id, w);
    }

    // Add legacy expired records if not already present
    for (const e of expiredList) {
      if (!map.has(e.id)) {
        map.set(e.id, {
          ...e,
          wastedQuantity: e.wastedQuantity || e.expiredQuantity || 0,
          unitCost: e.unitCost || e.purchasePrice || 0,
          reason: e.reason || "Expired / Past Shelf Life",
          itemType: e.itemType || "shop_product",
        });
      }
    }

    const merged = Array.from(map.values());
    merged.sort((a, b) => {
      const timeA = a.parsedDate?.getTime?.() || 0;
      const timeB = b.parsedDate?.getTime?.() || 0;
      return timeB - timeA;
    });

    onData(merged);
  };

  const parseItemDate = (data) => {
    if (data.createdAt?.seconds) return new Date(data.createdAt.seconds * 1000);
    if (data.createdAt?.toDate) return data.createdAt.toDate();
    if (data.createdAt) return new Date(data.createdAt);
    return new Date();
  };

  const unsubWaste = onSnapshot(
    wasteColRef,
    (snap) => {
      wasteList = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          parsedDate: parseItemDate(data),
        };
      });
      mergeAndEmit();
    },
    (err) => {
      console.warn("[WasteService] Waste listener notice:", err);
      if (onError) onError(err);
    }
  );

  const unsubExpired = onSnapshot(
    expiredColRef,
    (snap) => {
      expiredList = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          parsedDate: parseItemDate(data),
        };
      });
      mergeAndEmit();
    },
    (err) => {
      console.warn("[WasteService] Legacy expired listener notice:", err);
    }
  );

  return () => {
    unsubWaste();
    unsubExpired();
  };
}
