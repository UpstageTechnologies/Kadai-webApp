import {
  collection,
  doc,
  addDoc,
  runTransaction,
  serverTimestamp,
  onSnapshot,
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
    let cost;
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

/**
 * Safely parses a Firestore timestamp, Date, number, or date string into a Date object.
 */
export function parseRecordDate(record) {
  if (!record) return new Date();
  if (record.parsedDate instanceof Date && !isNaN(record.parsedDate.getTime())) {
    return record.parsedDate;
  }
  const ts = record.createdAt;
  if (ts?.toDate) return ts.toDate();
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  if (ts) {
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (record.createdAtMs) {
    const parsed = new Date(record.createdAtMs);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Checks whether a date matches a given timeframe filter ("all" | "today" | "yesterday" | "week" | "month").
 */
export function matchesTimeframe(date, timeFilter = "all", now = new Date()) {
  if (!timeFilter || timeFilter === "all") return true;
  if (!(date instanceof Date) || isNaN(date.getTime())) return false;

  if (timeFilter === "today") {
    return date.toDateString() === now.toDateString();
  }
  if (timeFilter === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return date.toDateString() === yesterday.toDateString();
  }
  if (timeFilter === "week") {
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(now.getDate() - 7);
    return date >= oneWeekAgo;
  }
  if (timeFilter === "month") {
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }
  return true;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Computes Revenue, Cost of Goods Sold (COGS), and Gross Profit for a single sale record.
 * Resolves item costs from the sale item itself, or falls back to recipeCostMap / productCostMap.
 */
export function computeSaleProfitBreakdown(sale, productCostMap = {}, recipeCostMap = {}) {
  if (!sale) {
    return { revenue: 0, cost: 0, grossProfit: 0, marginPct: 0, itemCount: 0, itemsSummary: [] };
  }

  const revenue = Number(sale.totalAmount ?? sale.total ?? 0) || 0;
  const items = Array.isArray(sale.items) ? sale.items : [];

  let itemsCost = 0;
  let itemsRevenue = 0;
  let totalQty = 0;
  let hasResolvedItemCost = false;
  const itemsSummary = [];

  for (const item of items) {
    if (!item) continue;
    const qty = Math.max(0, Number(item.qty ?? item.quantity ?? 1) || 1);
    const sellPrice = Number(item.salesPrice ?? item.price ?? 0) || 0;
    const itemId = String(item.id || item.productId || item.barcode || "").trim();
    const itemName = String(item.itemName || item.name || "Item").trim();
    const nameKey = itemName.toLowerCase();

    let unitCost = Number(item.makingCost ?? item.costPrice ?? item.purchasePrice ?? 0) || 0;
    if (unitCost <= 0 && itemId && recipeCostMap[itemId] > 0) {
      unitCost = Number(recipeCostMap[itemId]) || 0;
    }
    if (unitCost <= 0 && nameKey && recipeCostMap[nameKey] > 0) {
      unitCost = Number(recipeCostMap[nameKey]) || 0;
    }
    if (unitCost <= 0 && itemId && productCostMap[itemId] > 0) {
      unitCost = Number(productCostMap[itemId]) || 0;
    }
    if (unitCost <= 0 && nameKey && productCostMap[nameKey] > 0) {
      unitCost = Number(productCostMap[nameKey]) || 0;
    }

    if (unitCost > 0) hasResolvedItemCost = true;

    const lineRevenue = sellPrice * qty;
    const lineCost = unitCost * qty;
    itemsRevenue += lineRevenue;
    itemsCost += lineCost;
    totalQty += qty;

    itemsSummary.push({
      name: itemName,
      qty,
      revenue: round2(lineRevenue),
      cost: round2(lineCost),
      grossProfit: round2(lineRevenue - lineCost),
    });
  }

  const effectiveRevenue = revenue > 0 ? revenue : itemsRevenue;
  let cost;
  let grossProfit;

  if (hasResolvedItemCost) {
    cost = itemsCost;
    grossProfit = effectiveRevenue - cost;
  } else if (sale.profit !== undefined && sale.profit !== null && Number.isFinite(Number(sale.profit))) {
    grossProfit = Number(sale.profit);
    cost = Math.max(0, effectiveRevenue - grossProfit);
  } else {
    cost = 0;
    grossProfit = effectiveRevenue;
  }

  const marginPct = effectiveRevenue > 0 ? (grossProfit / effectiveRevenue) * 100 : 0;

  return {
    revenue: round2(effectiveRevenue),
    cost: round2(cost),
    grossProfit: round2(grossProfit),
    marginPct: Math.round(marginPct * 10) / 10,
    itemCount: totalQty || items.length || 1,
    itemsSummary,
  };
}

/**
 * Aggregates Profit & Loss statistics combining Sales Revenue, COGS, and Waste/Spoilage Loss.
 */
export function calculateProfitAndLossStats({
  sales = [],
  wasteRecords = [],
  productCostMap = {},
  recipeCostMap = {},
  timeFilter = "all",
  searchQuery = "",
}) {
  const now = new Date();
  const isToday = (d) =>
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  const isCurrentMonth = (d) =>
    d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  const normalizedQuery = searchQuery.trim().toLowerCase();

  let lifetimeRevenue = 0;
  let lifetimeCogs = 0;
  let lifetimeGrossProfit = 0;
  let todayRevenue = 0;
  let todayCogs = 0;
  let todayGrossProfit = 0;
  let todayOrdersCount = 0;
  let monthRevenue = 0;
  let monthCogs = 0;
  let monthGrossProfit = 0;
  let monthOrdersCount = 0;

  let filteredRevenue = 0;
  let filteredCogs = 0;
  let filteredGrossProfit = 0;

  const profitItemMap = {};
  const dailyMap = {};
  const normalizedSales = [];

  const getDayKey = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const ensureDayBucket = (d) => {
    const key = getDayKey(d);
    if (!dailyMap[key]) {
      dailyMap[key] = {
        dateKey: key,
        dateLabel: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        timestamp: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
        ordersCount: 0,
        wasteCount: 0,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        wasteLoss: 0,
        netProfit: 0,
      };
    }
    return dailyMap[key];
  };

  for (const sale of sales) {
    if (!sale) continue;
    const d = parseRecordDate(sale);
    const breakdown = computeSaleProfitBreakdown(sale, productCostMap, recipeCostMap);

    lifetimeRevenue += breakdown.revenue;
    lifetimeCogs += breakdown.cost;
    lifetimeGrossProfit += breakdown.grossProfit;

    if (isToday(d)) {
      todayRevenue += breakdown.revenue;
      todayCogs += breakdown.cost;
      todayGrossProfit += breakdown.grossProfit;
      todayOrdersCount += 1;
    }
    if (isCurrentMonth(d)) {
      monthRevenue += breakdown.revenue;
      monthCogs += breakdown.cost;
      monthGrossProfit += breakdown.grossProfit;
      monthOrdersCount += 1;
    }

    if (!matchesTimeframe(d, timeFilter, now)) continue;

    if (normalizedQuery) {
      const billNo = String(sale.billNo || sale.invoiceId || "").toLowerCase();
      const customer = String(sale.customerName || "").toLowerCase();
      const notes = String(sale.notes || "").toLowerCase();
      const itemNames = breakdown.itemsSummary.map((i) => i.name.toLowerCase()).join(" ");
      if (
        !billNo.includes(normalizedQuery) &&
        !customer.includes(normalizedQuery) &&
        !notes.includes(normalizedQuery) &&
        !itemNames.includes(normalizedQuery)
      ) {
        continue;
      }
    }

    filteredRevenue += breakdown.revenue;
    filteredCogs += breakdown.cost;
    filteredGrossProfit += breakdown.grossProfit;

    const dayBucket = ensureDayBucket(d);
    dayBucket.ordersCount += 1;
    dayBucket.revenue += breakdown.revenue;
    dayBucket.cogs += breakdown.cost;
    dayBucket.grossProfit += breakdown.grossProfit;

    for (const item of breakdown.itemsSummary) {
      const key = item.name;
      if (!profitItemMap[key]) {
        profitItemMap[key] = {
          name: item.name,
          qtySold: 0,
          revenue: 0,
          cost: 0,
          grossProfit: 0,
        };
      }
      profitItemMap[key].qtySold += item.qty;
      profitItemMap[key].revenue += item.revenue;
      profitItemMap[key].cost += item.cost;
      profitItemMap[key].grossProfit += item.grossProfit;
    }

    normalizedSales.push({
      id: sale.id,
      billNo: sale.billNo || sale.invoiceId || sale.id?.slice(0, 8) || "SALE",
      parsedDate: d,
      customerName: sale.customerName || "Walk-in Customer",
      paymentMode: sale.paymentMode || sale.paymentMethod || "CASH",
      orderType: sale.orderType || (sale.source === "profit_tracker" ? "Manual Entry" : "POS Sale"),
      notes: sale.notes || "",
      isManual: sale.source === "profit_tracker",
      ...breakdown,
    });
  }

  let todayWasteLoss = 0;
  let monthWasteLoss = 0;
  let filteredWasteLoss = 0;

  for (const w of wasteRecords) {
    if (!w) continue;
    const d = parseRecordDate(w);
    const loss = Number(w.totalLoss) || 0;

    if (isToday(d)) todayWasteLoss += loss;
    if (isCurrentMonth(d)) monthWasteLoss += loss;

    if (!matchesTimeframe(d, timeFilter, now)) continue;
    if (normalizedQuery) {
      const name = String(w.productName || w.itemName || "").toLowerCase();
      const cat = String(w.category || "").toLowerCase();
      const reason = String(w.reason || "").toLowerCase();
      const notes = String(w.notes || "").toLowerCase();
      if (
        !name.includes(normalizedQuery) &&
        !cat.includes(normalizedQuery) &&
        !reason.includes(normalizedQuery) &&
        !notes.includes(normalizedQuery)
      ) {
        continue;
      }
    }

    filteredWasteLoss += loss;
    const dayBucket = ensureDayBucket(d);
    dayBucket.wasteCount += 1;
    dayBucket.wasteLoss += loss;
  }

  const dailyTrend = Object.values(dailyMap)
    .map((day) => ({
      ...day,
      revenue: round2(day.revenue),
      cogs: round2(day.cogs),
      grossProfit: round2(day.grossProfit),
      wasteLoss: round2(day.wasteLoss),
      netProfit: round2(day.grossProfit - day.wasteLoss),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  const topProfitItems = Object.values(profitItemMap)
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, 5)
    .map((item) => ({
      ...item,
      qtySold: round2(item.qtySold),
      revenue: round2(item.revenue),
      cost: round2(item.cost),
      grossProfit: round2(item.grossProfit),
      marginPct: item.revenue > 0 ? Math.round((item.grossProfit / item.revenue) * 1000) / 10 : 0,
    }));

  normalizedSales.sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());

  const netProfit = round2(filteredGrossProfit - filteredWasteLoss);
  const todayNetProfit = round2(todayGrossProfit - todayWasteLoss);
  const monthNetProfit = round2(monthGrossProfit - monthWasteLoss);
  const profitMarginPct = filteredRevenue > 0 ? Math.round((netProfit / filteredRevenue) * 1000) / 10 : 0;
  const wasteImpactPct = filteredRevenue > 0 ? Math.round((filteredWasteLoss / filteredRevenue) * 1000) / 10 : 0;

  return {
    revenue: round2(filteredRevenue),
    cogs: round2(filteredCogs),
    grossProfit: round2(filteredGrossProfit),
    wasteLoss: round2(filteredWasteLoss),
    netProfit,
    profitMarginPct,
    wasteImpactPct,
    ordersCount: normalizedSales.length,
    todayRevenue: round2(todayRevenue),
    todayCogs: round2(todayCogs),
    todayGrossProfit: round2(todayGrossProfit),
    todayWasteLoss: round2(todayWasteLoss),
    todayNetProfit,
    todayOrdersCount,
    monthRevenue: round2(monthRevenue),
    monthCogs: round2(monthCogs),
    monthGrossProfit: round2(monthGrossProfit),
    monthWasteLoss: round2(monthWasteLoss),
    monthNetProfit,
    monthOrdersCount,
    lifetimeRevenue: round2(lifetimeRevenue),
    lifetimeCogs: round2(lifetimeCogs),
    lifetimeGrossProfit: round2(lifetimeGrossProfit),
    topProfitItems,
    dailyTrend,
    filteredSales: normalizedSales,
  };
}

/**
 * Subscribes to real-time sales records for profit & revenue tracking.
 */
export function subscribeSalesRecords(db, uid, onData, onError) {
  if (!db || !uid) return () => {};
  const salesColRef = collection(db, "users", uid, "sales");
  return onSnapshot(
    salesColRef,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          parsedDate: parseRecordDate(data),
        };
      });
      list.sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());
      onData(list);
    },
    (err) => {
      console.warn("[WasteService] Sales listener notice:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * Records a manual sale / profit entry into `users/{uid}/sales` so it stays unified with POS analytics.
 */
export async function logManualProfitSale({
  db,
  uid,
  itemId = "",
  itemName,
  quantity = 1,
  sellingPrice,
  costPrice = 0,
  customerName = "Walk-in Customer",
  paymentMode = "CASH",
  notes = "",
  isRestaurant = false,
  appMode = "local",
  branchId = "main_branch",
  branchName = "Main Branch",
}) {
  if (!uid || typeof uid !== "string" || !uid.trim()) {
    throw new Error("User must be authenticated to record profit.");
  }
  const cleanName = String(itemName || "").trim();
  if (!cleanName) {
    throw new Error("Item or income description is required.");
  }
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }
  const sell = Number(sellingPrice);
  if (!Number.isFinite(sell) || sell <= 0) {
    throw new Error("Selling price / revenue per unit must be greater than zero.");
  }
  const cost = Number(costPrice);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Cost price cannot be negative.");
  }

  const totalRevenue = round2(sell * qty);
  const totalCost = round2(cost * qty);
  const totalProfit = round2(totalRevenue - totalCost);

  const now = new Date();
  const billNo = `PROFIT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(Date.now()).slice(-4)}`;
  const billDate = now.toLocaleDateString("en-GB");

  const payload = {
    billNo,
    invoiceId: billNo,
    billDate,
    items: [
      {
        id: itemId || `manual_${Date.now()}`,
        name: cleanName,
        itemName: cleanName,
        price: sell,
        salesPrice: sell,
        purchasePrice: cost,
        makingCost: cost,
        qty,
        notes: notes.trim(),
      },
    ],
    total: totalRevenue,
    totalAmount: totalRevenue,
    profit: totalProfit,
    customerName: customerName.trim() || "Walk-in Customer",
    orderType: "manual_profit",
    paymentMode: String(paymentMode || "CASH").toUpperCase(),
    paymentMethod: String(paymentMode || "cash").toLowerCase(),
    notes: notes.trim(),
    source: "profit_tracker",
    isGlobalMode: appMode === "global",
    appMode,
    isRestaurant,
    shopType: isRestaurant ? "restaurant" : "retail",
    branchId: branchId || "main_branch",
    branchName: branchName || "Main Branch",
    createdAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, "users", uid, "sales"), payload);
  return {
    success: true,
    id: docRef.id,
    totalRevenue,
    totalCost,
    totalProfit,
    ...payload,
  };
}
