import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { INVENTORY_MODES, toMillis } from "./terminalService";

export const PRODUCT_SOURCES = {
  INDEPENDENT: "independent",
  SHARED: "shared",
};

export const STOCK_MODES = {
  INDEPENDENT: "independent",
  SHARED: "shared",
};

export const DISCOUNT_TYPES = {
  PERCENT: "percent",
  FLAT: "flat",
};

export const DEFAULT_PRODUCT_IMAGE =
  "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function getTimeBoundsForFilter(startDate, endDate) {
  const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
  const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Number.MAX_SAFE_INTEGER;
  return { startMs, endMs };
}

/**
 * Resolves effective price, discount, and tax for a product under an optional terminal assignment override.
 * Never mutates the original shop product or assignment object.
 */
export function calculateProductEffectivePricing(baseProduct = {}, assignment = null) {
  const basePrice = Number(baseProduct.salesPrice ?? baseProduct.price ?? 0);
  const effectivePrice =
    assignment &&
    assignment.sellingPriceOverride !== null &&
    assignment.sellingPriceOverride !== undefined &&
    assignment.sellingPriceOverride !== ""
      ? Number(assignment.sellingPriceOverride)
      : basePrice;

  const baseDiscountType =
    baseProduct.discountType === DISCOUNT_TYPES.FLAT
      ? DISCOUNT_TYPES.FLAT
      : DISCOUNT_TYPES.PERCENT;
  const baseDiscountValue = Number(baseProduct.discountValue ?? baseProduct.discount ?? 0);

  let effectiveDiscountType = baseDiscountType;
  let effectiveDiscountValue = baseDiscountValue;

  if (assignment?.discountOverride !== null && assignment?.discountOverride !== undefined) {
    if (typeof assignment.discountOverride === "object") {
      effectiveDiscountType =
        assignment.discountOverride.type === DISCOUNT_TYPES.FLAT
          ? DISCOUNT_TYPES.FLAT
          : DISCOUNT_TYPES.PERCENT;
      effectiveDiscountValue = Number(assignment.discountOverride.value || 0);
    } else if (assignment.discountOverride !== "") {
      effectiveDiscountType =
        assignment.discountTypeOverride === DISCOUNT_TYPES.FLAT
          ? DISCOUNT_TYPES.FLAT
          : DISCOUNT_TYPES.PERCENT;
      effectiveDiscountValue = Number(assignment.discountOverride || 0);
    }
  }

  const baseTaxPercent = Number(baseProduct.taxPercent ?? baseProduct.gstPercent ?? 0);
  const effectiveTaxPercent =
    assignment &&
    assignment.taxOverride !== null &&
    assignment.taxOverride !== undefined &&
    assignment.taxOverride !== ""
      ? Number(assignment.taxOverride)
      : baseTaxPercent;

  const safePrice = Number.isFinite(effectivePrice) && effectivePrice >= 0 ? effectivePrice : 0;
  const safeDiscountVal =
    Number.isFinite(effectiveDiscountValue) && effectiveDiscountValue >= 0
      ? effectiveDiscountValue
      : 0;
  const safeTaxRate =
    Number.isFinite(effectiveTaxPercent) && effectiveTaxPercent >= 0 ? effectiveTaxPercent : 0;

  const unitDiscount =
    effectiveDiscountType === DISCOUNT_TYPES.FLAT
      ? Math.min(safePrice, safeDiscountVal)
      : Math.min(safePrice, safePrice * (safeDiscountVal / 100));

  const unitTaxable = Math.max(0, safePrice - unitDiscount);
  const unitTax = unitTaxable * (safeTaxRate / 100);
  const unitFinalPrice = unitTaxable + unitTax;

  return {
    basePrice: round2(basePrice),
    effectivePrice: round2(safePrice),
    effectiveDiscountType,
    effectiveDiscountValue: round2(safeDiscountVal),
    effectiveTaxPercent: round2(safeTaxRate),
    unitDiscount: round2(unitDiscount),
    unitTaxable: round2(unitTaxable),
    unitTax: round2(unitTax),
    unitFinalPrice: round2(unitFinalPrice),
    hasPriceOverride:
      assignment !== null &&
      assignment?.sellingPriceOverride !== null &&
      assignment?.sellingPriceOverride !== undefined &&
      assignment?.sellingPriceOverride !== "",
    hasDiscountOverride:
      assignment !== null &&
      assignment?.discountOverride !== null &&
      assignment?.discountOverride !== undefined &&
      assignment?.discountOverride !== "",
    hasTaxOverride:
      assignment !== null &&
      assignment?.taxOverride !== null &&
      assignment?.taxOverride !== undefined &&
      assignment?.taxOverride !== "",
  };
}

/**
 * Computes cart totals and immutable invoice line-item snapshots for POS checkout.
 * Guarantees historical bills preserve exact product name, price, discount, tax, and terminal metadata.
 */
export function calculateCartTotalsAndSnapshots(
  cartItems = [],
  { shopId = "", terminal = null, staffId = "OWNER" } = {}
) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let netTotal = 0;

  const itemSnapshots = cartItems.map((item) => {
    const qty = Math.max(1, Number(item.qty ?? item.quantity ?? 1) || 1);
    const unitPrice = Number(
      item.effectivePrice ?? item.sellingPriceSnapshot ?? item.salesPrice ?? item.price ?? 0
    );
    const dType =
      item.effectiveDiscountType || item.discountType || DISCOUNT_TYPES.PERCENT;
    const dVal = Number(
      item.effectiveDiscountValue ?? item.discountValue ?? item.discount ?? 0
    );
    const tRate = Number(
      item.effectiveTaxPercent ?? item.taxRateSnapshot ?? item.taxPercent ?? 0
    );

    const lineGross = unitPrice * qty;
    const lineDiscount =
      dType === DISCOUNT_TYPES.FLAT
        ? Math.min(lineGross, Math.max(0, dVal) * qty)
        : Math.min(lineGross, lineGross * (Math.max(0, dVal) / 100));
    const lineTaxable = Math.max(0, lineGross - lineDiscount);
    const lineTax = lineTaxable * (Math.max(0, tRate) / 100);
    const lineTotal = lineTaxable + lineTax;

    subtotal += lineGross;
    discountTotal += lineDiscount;
    taxTotal += lineTax;
    netTotal += lineTotal;

    const pId = String(item.productId || item.id || item.barcode || "");
    const pName = String(item.productNameSnapshot || item.name || item.itemName || "Item");
    const source =
      item.productSource === PRODUCT_SOURCES.INDEPENDENT
        ? PRODUCT_SOURCES.INDEPENDENT
        : item.productSource === PRODUCT_SOURCES.SHARED
        ? PRODUCT_SOURCES.SHARED
        : item.terminalId && item.terminalId !== "all"
        ? PRODUCT_SOURCES.INDEPENDENT
        : PRODUCT_SOURCES.SHARED;

    return {
      id: pId,
      productId: pId,
      productSource: source,
      stockMode:
        item.stockMode === STOCK_MODES.INDEPENDENT || item.stockMode === STOCK_MODES.SHARED
          ? item.stockMode
          : source === PRODUCT_SOURCES.INDEPENDENT
          ? STOCK_MODES.INDEPENDENT
          : STOCK_MODES.SHARED,
      productCollection: item.productCollection || null,
      assignmentId: item.assignmentId || null,
      barcode: String(item.barcode || pId),
      sku: String(item.sku || ""),
      name: pName,
      itemName: pName,
      productNameSnapshot: pName,
      price: round2(unitPrice),
      salesPrice: round2(unitPrice),
      sellingPriceSnapshot: round2(unitPrice),
      purchasePrice: round2(Number(item.purchasePrice || 0)),
      discountType: dType,
      discountValue: round2(dVal),
      discount: round2(lineDiscount),
      discountSnapshot: round2(lineDiscount),
      taxPercent: round2(tRate),
      taxRateSnapshot: round2(tRate),
      taxSnapshot: round2(lineTax),
      qty,
      quantity: qty,
      totalAmount: round2(lineTotal),
      portion: String(item.portion || "Standard"),
      notes: String(item.notes || ""),
      image: String(item.image || item.imageUrl || ""),
      imageUrl: String(item.image || item.imageUrl || ""),
      shopId: String(shopId || ""),
      terminalId: terminal?.id || item.terminalId || null,
      terminalName: terminal?.name || item.terminalName || null,
      floorId: terminal?.floorId || item.floorId || null,
      staffId: String(staffId || "OWNER"),
    };
  });

  return {
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    taxTotal: round2(taxTotal),
    netTotal: round2(netTotal),
    itemSnapshots,
  };
}

/**
 * Resolves the effective product catalog for a single POS terminal, combining:
 * 1) Model A (Independent terminal-exclusive products)
 * 2) Model B (Shared Shop Products explicitly assigned to this terminal with per-terminal overrides)
 * 3) Legacy unassigned items according to shopInventoryMode (for smooth backward compatibility)
 */
export function resolveTerminalCatalog({
  terminal = null,
  shopProducts = [],
  terminalAssignments = [],
  terminalCategories = [],
  terminalInventoryDocs = [],
  shopInventoryMode = INVENTORY_MODES.SHARED,
  primaryTerminalId = null,
  includeInactive = false,
} = {}) {
  const shopProductMap = new Map();
  shopProducts.forEach((p) => {
    if (p?.id) shopProductMap.set(String(p.id), p);
  });

  const categoryMap = new Map();
  terminalCategories.forEach((c) => {
    if (c?.id) categoryMap.set(String(c.id), c);
  });

  const termInvMap = new Map();
  terminalInventoryDocs.forEach((inv) => {
    const key = String(inv.productId || inv.id || "");
    if (key) termInvMap.set(key, inv);
  });

  const assignedProductIds = new Set();
  const resolved = [];

  // 1. Resolve explicit terminal product assignments (Model A & Model B)
  if (terminal?.id) {
    terminalAssignments.forEach((assign) => {
      if (!assign || (assign.terminalId && assign.terminalId !== terminal.id)) return;
      const pId = String(assign.productId || assign.id || "");
      const masterProduct = shopProductMap.get(pId) || assign.productSnapshot || null;
      if (!masterProduct) return;

      assignedProductIds.add(pId);

      const source =
        assign.productSource === PRODUCT_SOURCES.INDEPENDENT
          ? PRODUCT_SOURCES.INDEPENDENT
          : PRODUCT_SOURCES.SHARED;

      const stockMode =
        assign.stockMode === STOCK_MODES.INDEPENDENT || assign.stockMode === STOCK_MODES.SHARED
          ? assign.stockMode
          : source === PRODUCT_SOURCES.INDEPENDENT
          ? STOCK_MODES.INDEPENDENT
          : STOCK_MODES.SHARED;

      const invDoc = termInvMap.get(pId);
      const rawShopStock = Number(masterProduct.quantity ?? masterProduct.stockQuantity ?? 0);
      const effectiveStock =
        stockMode === STOCK_MODES.INDEPENDENT
          ? invDoc !== undefined
            ? Number(invDoc.stockQuantity ?? 0)
            : Number(assign.stockQuantity ?? masterProduct.quantity ?? 0)
          : Number.isFinite(rawShopStock)
          ? rawShopStock
          : 0;

      const lowStockAlert = Number(
        invDoc?.lowStockAlert ?? assign.lowStockAlert ?? masterProduct.lowStockAlert ?? 5
      );
      const isLowStock =
        Number.isFinite(effectiveStock) &&
        Number.isFinite(lowStockAlert) &&
        effectiveStock <= lowStockAlert;

      const isActive = assign.isActive !== false && masterProduct.isActive !== false;
      const isAvailable = assign.isAvailable !== false && masterProduct.isAvailable !== false;

      if (!includeInactive && (!isActive || !isAvailable)) {
        return;
      }

      const catObj = assign.categoryId ? categoryMap.get(String(assign.categoryId)) : null;
      const effectiveCategory =
        catObj?.name || assign.categoryName || masterProduct.category || "General";

      const pricing = calculateProductEffectivePricing(masterProduct, assign);
      const itemName = masterProduct.itemName || masterProduct.name || "Unnamed Item";
      const image = masterProduct.image || masterProduct.imageUrl || DEFAULT_PRODUCT_IMAGE;

      resolved.push({
        ...masterProduct,
        id: pId,
        productId: pId,
        assignmentId: assign.id,
        productSource: source,
        productCollection: assign.productCollection || masterProduct.productCollection || null,
        terminalId: terminal.id,
        terminalName: terminal.name || "",
        terminalCode: terminal.code || "",
        floorId: terminal.floorId || masterProduct.floorId || null,
        floorName: terminal.floorName || masterProduct.floorName || "",
        categoryId: assign.categoryId || null,
        category: effectiveCategory,
        effectiveCategory,
        name: itemName,
        itemName,
        image,
        imageUrl: image,
        sku: masterProduct.sku || "",
        barcode: masterProduct.barcode || "",
        description: masterProduct.description || "",
        unit: invDoc?.unit || assign.unit || masterProduct.unit || "pcs",
        purchasePrice: Number(masterProduct.purchasePrice || 0),
        salesPrice: pricing.effectivePrice,
        price: pricing.effectivePrice,
        basePrice: pricing.basePrice,
        effectivePrice: pricing.effectivePrice,
        effectiveDiscountType: pricing.effectiveDiscountType,
        effectiveDiscountValue: pricing.effectiveDiscountValue,
        effectiveTaxPercent: pricing.effectiveTaxPercent,
        taxPercent: pricing.effectiveTaxPercent,
        unitDiscount: pricing.unitDiscount,
        unitTax: pricing.unitTax,
        unitFinalPrice: pricing.unitFinalPrice,
        hasPriceOverride: pricing.hasPriceOverride,
        hasDiscountOverride: pricing.hasDiscountOverride,
        hasTaxOverride: pricing.hasTaxOverride,
        stockMode,
        quantity: effectiveStock,
        effectiveStock,
        sharedStockQuantity: Number.isFinite(rawShopStock) ? rawShopStock : 0,
        terminalStockQuantity:
          invDoc !== undefined ? Number(invDoc.stockQuantity ?? 0) : effectiveStock,
        lowStockAlert,
        isLowStock,
        isActive,
        isAvailable,
      });
    });
  }

  // 2. Include legacy items directly linked or legacy unassigned according to shopInventoryMode
  if (terminal?.id) {
    const isPrimary = Boolean(primaryTerminalId) && terminal.id === primaryTerminalId;

    shopProducts.forEach((p) => {
      const pId = String(p.id || "");
      if (!pId || assignedProductIds.has(pId)) return;

      // Products belonging exclusively to another terminal must NEVER leak here
      if (p.terminalId && p.terminalId !== "all" && p.terminalId !== terminal.id) {
        return;
      }
      if (p.productSource === PRODUCT_SOURCES.INDEPENDENT && p.terminalId !== terminal.id) {
        return;
      }

      const explicitForThisTerm = p.terminalId === terminal.id;
      if (!explicitForThisTerm) {
        // Legacy unassigned or shared shop product without assignment doc
        if (shopInventoryMode === INVENTORY_MODES.TERMINAL_WISE) {
          if (!isPrimary) return;
        } else if (shopInventoryMode === INVENTORY_MODES.FLOOR_WISE) {
          if (p.floorId && p.floorId !== "all" && p.floorId !== terminal.floorId) {
            return;
          }
        }
      }

      const isActive = p.isActive !== false;
      const isAvailable = p.isAvailable !== false;
      if (!includeInactive && (!isActive || !isAvailable)) return;

      const source =
        p.productSource === PRODUCT_SOURCES.INDEPENDENT || explicitForThisTerm
          ? PRODUCT_SOURCES.INDEPENDENT
          : PRODUCT_SOURCES.SHARED;
      const invDoc = termInvMap.get(pId);
      const stockMode =
        p.stockMode === STOCK_MODES.INDEPENDENT || invDoc
          ? STOCK_MODES.INDEPENDENT
          : source === PRODUCT_SOURCES.INDEPENDENT
          ? STOCK_MODES.INDEPENDENT
          : STOCK_MODES.SHARED;

      const numericQty = Number(p.quantity);
      const effectiveStock =
        stockMode === STOCK_MODES.INDEPENDENT && invDoc
          ? Number(invDoc.stockQuantity ?? 0)
          : Number.isFinite(numericQty)
          ? numericQty
          : 0;
      const lowStockAlert = Number(invDoc?.lowStockAlert ?? p.lowStockAlert ?? 5);
      const isLowStock =
        Number.isFinite(effectiveStock) &&
        Number.isFinite(lowStockAlert) &&
        effectiveStock <= lowStockAlert;

      const pricing = calculateProductEffectivePricing(p, null);
      const itemName = p.itemName || p.name || "Unnamed Item";
      const image = p.image || p.imageUrl || DEFAULT_PRODUCT_IMAGE;

      resolved.push({
        ...p,
        id: pId,
        productId: pId,
        assignmentId: null,
        productSource: source,
        terminalId: p.terminalId || terminal.id,
        floorId: p.floorId || terminal.floorId || null,
        categoryId: null,
        category: p.category || "General",
        effectiveCategory: p.category || "General",
        name: itemName,
        itemName,
        image,
        imageUrl: image,
        sku: p.sku || "",
        barcode: p.barcode || "",
        description: p.description || "",
        unit: invDoc?.unit || p.unit || "pcs",
        purchasePrice: Number(p.purchasePrice || 0),
        salesPrice: pricing.effectivePrice,
        price: pricing.effectivePrice,
        basePrice: pricing.basePrice,
        effectivePrice: pricing.effectivePrice,
        effectiveDiscountType: pricing.effectiveDiscountType,
        effectiveDiscountValue: pricing.effectiveDiscountValue,
        effectiveTaxPercent: pricing.effectiveTaxPercent,
        taxPercent: pricing.effectiveTaxPercent,
        unitDiscount: pricing.unitDiscount,
        unitTax: pricing.unitTax,
        unitFinalPrice: pricing.unitFinalPrice,
        hasPriceOverride: false,
        hasDiscountOverride: false,
        hasTaxOverride: false,
        stockMode,
        quantity: p.quantity !== undefined ? effectiveStock : 0,
        effectiveStock,
        sharedStockQuantity: Number.isFinite(numericQty) ? numericQty : 0,
        terminalStockQuantity:
          invDoc !== undefined ? Number(invDoc.stockQuantity ?? 0) : effectiveStock,
        lowStockAlert,
        isLowStock,
        isActive,
        isAvailable,
      });
    });
  }

  return resolved;
}

/**
 * Checks whether a product is referenced in historical bills or terminal transactions.
 */
export function checkProductReferencedInHistory(salesList = [], transactionsList = [], productId) {
  const targetId = String(productId || "");
  if (!targetId) return false;

  const checkItems = (items) =>
    Array.isArray(items) &&
    items.some(
      (i) => String(i.productId || i.id || "") === targetId || String(i.barcode || "") === targetId
    );

  return (
    salesList.some((s) => checkItems(s.items)) ||
    transactionsList.some((t) => checkItems(t.items))
  );
}

/**
 * Builds Consolidated Owner Product, Inventory Value, Low Stock, & Sales Overview across all terminals.
 */
export function buildOwnerProductOverview({
  terminals = [],
  shopProducts = [],
  assignmentsByTerminal = {},
  inventoryByTerminal = {},
  categoriesByTerminal = {},
  salesList = [],
  filters = {},
  shopInventoryMode = INVENTORY_MODES.SHARED,
  primaryTerminalId = null,
} = {}) {
  const {
    terminalId = "all",
    productQuery = "",
    category = "all",
    startDate = "",
    endDate = "",
  } = filters;

  const q = String(productQuery || "").trim().toLowerCase();
  const catFilter = String(category || "all").trim().toLowerCase();
  const { startMs, endMs } = getTimeBoundsForFilter(startDate, endDate);

  const selectedTerminals =
    terminalId && terminalId !== "all"
      ? terminals.filter((t) => t.id === terminalId)
      : terminals;

  const terminalStats = [];
  const lowStockAlerts = [];
  const independentProductIds = new Set();
  const sharedAssignedProductIds = new Set();
  let totalProductsAcrossTerminals = 0;
  let totalInventoryValue = 0;

  selectedTerminals.forEach((term) => {
    const assigns = assignmentsByTerminal[term.id] || [];
    const invDocs = inventoryByTerminal[term.id] || [];
    const cats = categoriesByTerminal[term.id] || [];

    const catalog = resolveTerminalCatalog({
      terminal: term,
      shopProducts,
      terminalAssignments: assigns,
      terminalCategories: cats,
      terminalInventoryDocs: invDocs,
      shopInventoryMode,
      primaryTerminalId,
      includeInactive: true,
    }).filter((item) => {
      if (q) {
        const hay = `${item.name} ${item.sku} ${item.barcode} ${item.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (catFilter !== "all") {
        if (String(item.category || "").toLowerCase() !== catFilter) return false;
      }
      return true;
    });

    let activeCount = 0;
    let inactiveCount = 0;
    let independentCount = 0;
    let sharedCount = 0;
    let termInvValue = 0;
    let termLowStockCount = 0;

    catalog.forEach((item) => {
      if (item.isActive && item.isAvailable) activeCount += 1;
      else inactiveCount += 1;

      if (item.productSource === PRODUCT_SOURCES.INDEPENDENT) {
        independentCount += 1;
        independentProductIds.add(item.productId);
      } else {
        sharedCount += 1;
        sharedAssignedProductIds.add(item.productId);
      }

      const stockVal = Math.max(0, Number(item.effectiveStock || 0));
      const unitCost =
        Number(item.purchasePrice) > 0 ? Number(item.purchasePrice) : Number(item.effectivePrice || 0);
      termInvValue += stockVal * unitCost;

      if (item.isLowStock) {
        termLowStockCount += 1;
        lowStockAlerts.push({
          terminalId: term.id,
          terminalName: term.name,
          terminalCode: term.code,
          productId: item.productId,
          productName: item.name,
          category: item.category,
          productSource: item.productSource,
          stockMode: item.stockMode,
          currentStock: item.effectiveStock,
          lowStockAlert: item.lowStockAlert,
          unit: item.unit,
        });
      }
    });

    // Terminal sales inside date/product/category filter
    const termSales = salesList.filter((sale) => {
      if (sale.terminalId !== term.id) return false;
      if (sale.transactionStatus === "cancelled" || sale.status === "cancelled") return false;
      const ms = toMillis(sale.createdAtMs || sale.createdAt);
      if (ms < startMs || ms > endMs) return false;
      if (q || catFilter !== "all") {
        const items = Array.isArray(sale.items) ? sale.items : [];
        return items.some((it) => {
          const nm = String(it.productNameSnapshot || it.name || it.itemName || "").toLowerCase();
          if (q && !nm.includes(q)) return false;
          if (catFilter !== "all") {
            const matchedProd = catalog.find((c) => c.productId === String(it.productId || it.id));
            if (!matchedProd) return false;
          }
          return true;
        });
      }
      return true;
    });

    const termSalesAmount = termSales.reduce(
      (sum, s) => sum + Number(s.totalAmount ?? s.total ?? 0),
      0
    );

    totalProductsAcrossTerminals += catalog.length;
    totalInventoryValue += termInvValue;

    terminalStats.push({
      terminalId: term.id,
      terminalName: term.name,
      terminalCode: term.code,
      floorName: term.floorName || "Floor",
      productCount: catalog.length,
      independentCount,
      sharedCount,
      categoryCount: new Set([
        ...cats.map((c) => c.name),
        ...catalog.map((i) => i.category).filter(Boolean),
      ]).size,
      activeCount,
      inactiveCount,
      inventoryValue: round2(termInvValue),
      lowStockCount: termLowStockCount,
      salesCount: termSales.length,
      salesTotal: round2(termSalesAmount),
    });
  });

  const totalSales = terminalStats.reduce((sum, t) => sum + t.salesTotal, 0);
  const totalOrders = terminalStats.reduce((sum, t) => sum + t.salesCount, 0);

  return {
    totalProductsAcrossTerminals,
    independentProductsCount: independentProductIds.size,
    sharedProductsCount: sharedAssignedProductIds.size,
    totalInventoryValue: round2(totalInventoryValue),
    totalSales: round2(totalSales),
    totalOrders,
    lowStockCount: lowStockAlerts.length,
    terminalStats,
    lowStockAlerts,
  };
}

// ============================================================================
// FIRESTORE REAL-TIME SUBSCRIPTIONS & CRUD FOR TERMINAL PRODUCT MANAGEMENT
// ============================================================================

export function subscribeTerminalCategories(db, shopId, terminalId, onData, onError) {
  if (!shopId || !terminalId) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, "users", shopId, "terminals", terminalId, "categories");
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const orderDiff = Number(a.sortOrder ?? 999) - Number(b.sortOrder ?? 999);
        if (orderDiff !== 0) return orderDiff;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      onData(list);
    },
    (err) => {
      console.error("subscribeTerminalCategories error:", err);
      if (onError) onError(err);
    }
  );
}

export function subscribeTerminalAssignments(db, shopId, terminalId, onData, onError) {
  if (!shopId || !terminalId) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, "users", shopId, "terminals", terminalId, "products");
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(list);
    },
    (err) => {
      console.error("subscribeTerminalAssignments error:", err);
      if (onError) onError(err);
    }
  );
}

export function subscribeTerminalInventory(db, shopId, terminalId, onData, onError) {
  if (!shopId || !terminalId) {
    onData([]);
    return () => {};
  }
  const ref = collection(db, "users", shopId, "terminals", terminalId, "inventory");
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(list);
    },
    (err) => {
      console.error("subscribeTerminalInventory error:", err);
      if (onError) onError(err);
    }
  );
}

export function subscribeTerminalStockMovements(db, shopId, terminalId, onData, onError) {
  if (!shopId) {
    onData([]);
    return () => {};
  }
  const qRef = terminalId
    ? query(
        collection(db, "users", shopId, "stock_movements"),
        where("terminalId", "==", terminalId)
      )
    : collection(db, "users", shopId, "stock_movements");

  return onSnapshot(
    qRef,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => toMillis(b.createdAtMs || b.createdAt) - toMillis(a.createdAtMs || a.createdAt));
      onData(list.slice(0, 100));
    },
    (err) => {
      console.error("subscribeTerminalStockMovements error:", err);
      if (onError) onError(err);
    }
  );
}

export async function fetchAllTerminalsProductBundles(db, shopId, terminals = []) {
  if (!shopId || terminals.length === 0) {
    return {
      assignmentsByTerminal: {},
      inventoryByTerminal: {},
      categoriesByTerminal: {},
    };
  }
  const assignmentsByTerminal = {};
  const inventoryByTerminal = {};
  const categoriesByTerminal = {};

  await Promise.all(
    terminals.map(async (t) => {
      try {
        const [aSnap, iSnap, cSnap] = await Promise.all([
          getDocs(collection(db, "users", shopId, "terminals", t.id, "products")),
          getDocs(collection(db, "users", shopId, "terminals", t.id, "inventory")),
          getDocs(collection(db, "users", shopId, "terminals", t.id, "categories")),
        ]);
        assignmentsByTerminal[t.id] = aSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        inventoryByTerminal[t.id] = iSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        categoriesByTerminal[t.id] = cSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn(`Could not fetch product bundle for terminal ${t.id}:`, err);
        assignmentsByTerminal[t.id] = [];
        inventoryByTerminal[t.id] = [];
        categoriesByTerminal[t.id] = [];
      }
    })
  );

  return { assignmentsByTerminal, inventoryByTerminal, categoriesByTerminal };
}

export async function saveTerminalCategory(
  db,
  shopId,
  terminalId,
  categoryData,
  existingCategories = [],
  editingCategoryId = null
) {
  if (!shopId || !terminalId) throw new Error("Shop or terminal missing.");
  const cleanName = String(categoryData.name || "").trim();
  if (!cleanName) throw new Error("Category name is required.");

  const dup = existingCategories.find(
    (c) =>
      c.id !== editingCategoryId &&
      String(c.name || "").trim().toLowerCase() === cleanName.toLowerCase()
  );
  if (dup) {
    throw new Error(`Category "${cleanName}" already exists in this terminal.`);
  }

  const catRef = editingCategoryId
    ? doc(db, "users", shopId, "terminals", terminalId, "categories", editingCategoryId)
    : doc(collection(db, "users", shopId, "terminals", terminalId, "categories"));

  const payload = {
    id: catRef.id,
    shopId,
    terminalId,
    name: cleanName,
    description: String(categoryData.description || "").trim(),
    color: String(categoryData.color || "#2563eb"),
    sortOrder: Number(categoryData.sortOrder || existingCategories.length + 1),
    isActive: categoryData.isActive !== false,
    updatedAt: serverTimestamp(),
  };

  if (!editingCategoryId) {
    payload.createdAt = serverTimestamp();
    await setDoc(catRef, payload);
  } else {
    await setDoc(catRef, payload, { merge: true });
  }

  return payload;
}

export async function deleteTerminalCategory(
  db,
  shopId,
  terminalId,
  categoryId,
  terminalAssignments = []
) {
  if (!shopId || !terminalId || !categoryId) throw new Error("Missing category info.");
  const inUse = terminalAssignments.some((a) => String(a.categoryId || "") === String(categoryId));
  if (inUse) {
    throw new Error(
      "Cannot delete this category while products are assigned to it. Reassign those products first."
    );
  }
  await deleteDoc(doc(db, "users", shopId, "terminals", terminalId, "categories", categoryId));
}

/**
 * MODEL A: Create an Independent Product belonging exclusively to a single terminal.
 */
export async function createIndependentTerminalProduct(
  db,
  {
    shopId,
    terminal,
    productCollection = "inventory",
    form,
    existingCategories = [],
  }
) {
  if (!shopId || !terminal?.id) throw new Error("Missing shop or terminal context.");
  if (terminal.shopId && terminal.shopId !== shopId) {
    throw new Error("Unauthorized: Terminal belongs to a different shop.");
  }

  const cleanName = String(form.name || "").trim();
  if (!cleanName) throw new Error("Product name is required.");

  const sellingPrice = Number(form.sellingPrice ?? form.price ?? 0);
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
    throw new Error("Please enter a valid Selling Price.");
  }

  const stockQty = Math.max(0, Number(form.stockQuantity ?? form.quantity ?? 0) || 0);
  const lowStockAlert = Math.max(0, Number(form.lowStockAlert ?? 5) || 0);
  const purchasePrice = Math.max(0, Number(form.purchasePrice || 0) || 0);
  const taxPercent = Math.max(0, Number(form.taxPercent || 0) || 0);
  const discountType =
    form.discountType === DISCOUNT_TYPES.FLAT ? DISCOUNT_TYPES.FLAT : DISCOUNT_TYPES.PERCENT;
  const discountValue = Math.max(0, Number(form.discountValue || 0) || 0);

  let categoryId = form.categoryId || null;
  let categoryName = String(form.categoryName || form.category || "General").trim() || "General";

  // Auto-create category inside terminal if typed/chosen and missing
  const matchedCat = existingCategories.find(
    (c) =>
      (categoryId && c.id === categoryId) ||
      String(c.name || "").trim().toLowerCase() === categoryName.toLowerCase()
  );

  const batch = writeBatch(db);
  if (matchedCat) {
    categoryId = matchedCat.id;
    categoryName = matchedCat.name;
  } else {
    const newCatRef = doc(collection(db, "users", shopId, "terminals", terminal.id, "categories"));
    categoryId = newCatRef.id;
    batch.set(newCatRef, {
      id: newCatRef.id,
      shopId,
      terminalId: terminal.id,
      name: categoryName,
      description: "",
      color: "#2563eb",
      sortOrder: existingCategories.length + 1,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const productRef = doc(collection(db, "users", shopId, productCollection));
  const productId = productRef.id;
  const imageVal = String(form.image || "").trim() || DEFAULT_PRODUCT_IMAGE;

  const productDoc = {
    id: productId,
    shopId,
    productSource: PRODUCT_SOURCES.INDEPENDENT,
    isTerminalExclusive: true,
    productCollection,
    terminalId: terminal.id,
    terminalName: terminal.name || "",
    terminalCode: terminal.code || "",
    floorId: terminal.floorId || "all",
    floorName: terminal.floorName || "Floor",
    name: cleanName,
    itemName: cleanName,
    sku: String(form.sku || "").trim(),
    barcode: String(form.barcode || "").trim(),
    description: String(form.description || "").trim(),
    category: categoryName,
    categoryId,
    image: imageVal,
    imageUrl: imageVal,
    purchasePrice: round2(purchasePrice),
    price: round2(sellingPrice),
    salesPrice: round2(sellingPrice),
    discountType,
    discountValue: round2(discountValue),
    taxPercent: round2(taxPercent),
    unit: String(form.unit || "pcs").trim() || "pcs",
    quantity: stockQty,
    stockQuantity: stockQty,
    lowStockAlert,
    stockMode: STOCK_MODES.INDEPENDENT,
    isAvailable: form.isAvailable !== false,
    isActive: form.isActive !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const assignmentId = `ind_${productId}`;
  const assignRef = doc(db, "users", shopId, "terminals", terminal.id, "products", assignmentId);
  const assignmentDoc = {
    id: assignmentId,
    shopId,
    terminalId: terminal.id,
    productId,
    productCollection,
    productSource: PRODUCT_SOURCES.INDEPENDENT,
    categoryId,
    categoryName,
    sellingPriceOverride: null,
    discountOverride: null,
    taxOverride: null,
    stockMode: STOCK_MODES.INDEPENDENT,
    unit: productDoc.unit,
    lowStockAlert,
    isAvailable: form.isAvailable !== false,
    isActive: form.isActive !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const invRef = doc(db, "users", shopId, "terminals", terminal.id, "inventory", productId);
  const invDoc = {
    id: productId,
    productId,
    shopId,
    terminalId: terminal.id,
    stockMode: STOCK_MODES.INDEPENDENT,
    stockQuantity: stockQty,
    lowStockAlert,
    unit: productDoc.unit,
    updatedByStaffId: "OWNER",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  batch.set(productRef, productDoc);
  batch.set(assignRef, assignmentDoc);
  batch.set(invRef, invDoc);
  await batch.commit();

  return { productId, assignmentId, productDoc, assignmentDoc, invDoc };
}

/**
 * MODEL A: Update an Independent Terminal Product without affecting any other terminal.
 */
export async function updateIndependentTerminalProduct(
  db,
  {
    shopId,
    terminal,
    productId,
    assignmentId = null,
    productCollection = "inventory",
    form,
    existingCategories = [],
  }
) {
  if (!shopId || !terminal?.id || !productId) throw new Error("Missing product details.");
  const cleanName = String(form.name || "").trim();
  if (!cleanName) throw new Error("Product name is required.");

  const sellingPrice = Number(form.sellingPrice ?? form.price ?? 0);
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0) {
    throw new Error("Please enter a valid Selling Price.");
  }

  const purchasePrice = Math.max(0, Number(form.purchasePrice || 0) || 0);
  const taxPercent = Math.max(0, Number(form.taxPercent || 0) || 0);
  const discountType =
    form.discountType === DISCOUNT_TYPES.FLAT ? DISCOUNT_TYPES.FLAT : DISCOUNT_TYPES.PERCENT;
  const discountValue = Math.max(0, Number(form.discountValue || 0) || 0);
  const stockQty = Math.max(0, Number(form.stockQuantity ?? form.quantity ?? 0) || 0);
  const lowStockAlert = Math.max(0, Number(form.lowStockAlert ?? 5) || 0);

  let categoryId = form.categoryId || null;
  let categoryName = String(form.categoryName || form.category || "General").trim() || "General";

  const matchedCat = existingCategories.find(
    (c) =>
      (categoryId && c.id === categoryId) ||
      String(c.name || "").trim().toLowerCase() === categoryName.toLowerCase()
  );

  const batch = writeBatch(db);
  if (matchedCat) {
    categoryId = matchedCat.id;
    categoryName = matchedCat.name;
  } else {
    const newCatRef = doc(collection(db, "users", shopId, "terminals", terminal.id, "categories"));
    categoryId = newCatRef.id;
    batch.set(newCatRef, {
      id: newCatRef.id,
      shopId,
      terminalId: terminal.id,
      name: categoryName,
      description: "",
      color: "#2563eb",
      sortOrder: existingCategories.length + 1,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const imageVal = String(form.image || "").trim() || DEFAULT_PRODUCT_IMAGE;
  const prodRef = doc(db, "users", shopId, productCollection, productId);
  batch.set(
    prodRef,
    {
      shopId,
      productSource: PRODUCT_SOURCES.INDEPENDENT,
      isTerminalExclusive: true,
      terminalId: terminal.id,
      terminalName: terminal.name || "",
      terminalCode: terminal.code || "",
      floorId: terminal.floorId || "all",
      floorName: terminal.floorName || "Floor",
      name: cleanName,
      itemName: cleanName,
      sku: String(form.sku || "").trim(),
      barcode: String(form.barcode || "").trim(),
      description: String(form.description || "").trim(),
      category: categoryName,
      categoryId,
      image: imageVal,
      imageUrl: imageVal,
      purchasePrice: round2(purchasePrice),
      price: round2(sellingPrice),
      salesPrice: round2(sellingPrice),
      discountType,
      discountValue: round2(discountValue),
      taxPercent: round2(taxPercent),
      unit: String(form.unit || "pcs").trim() || "pcs",
      quantity: stockQty,
      stockQuantity: stockQty,
      lowStockAlert,
      stockMode: STOCK_MODES.INDEPENDENT,
      isAvailable: form.isAvailable !== false,
      isActive: form.isActive !== false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const finalAssignId = assignmentId || `ind_${productId}`;
  const assignRef = doc(db, "users", shopId, "terminals", terminal.id, "products", finalAssignId);
  batch.set(
    assignRef,
    {
      id: finalAssignId,
      shopId,
      terminalId: terminal.id,
      productId,
      productCollection,
      productSource: PRODUCT_SOURCES.INDEPENDENT,
      categoryId,
      categoryName,
      sellingPriceOverride: null,
      discountOverride: null,
      taxOverride: null,
      stockMode: STOCK_MODES.INDEPENDENT,
      unit: String(form.unit || "pcs").trim() || "pcs",
      lowStockAlert,
      isAvailable: form.isAvailable !== false,
      isActive: form.isActive !== false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const invRef = doc(db, "users", shopId, "terminals", terminal.id, "inventory", productId);
  batch.set(
    invRef,
    {
      id: productId,
      productId,
      shopId,
      terminalId: terminal.id,
      stockMode: STOCK_MODES.INDEPENDENT,
      stockQuantity: stockQty,
      lowStockAlert,
      unit: String(form.unit || "pcs").trim() || "pcs",
      updatedByStaffId: "OWNER",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();
}

/**
 * MODEL B: Bulk Assign Existing Shop Products to 1 or multiple terminals with per-terminal overrides.
 * Uses deterministic assignment ID `shared_${productId}` to strictly prevent duplicates in a terminal.
 * Never mutates the original Shop Product document.
 */
export async function assignShopProductsToTerminals(
  db,
  {
    shopId,
    productCollection = "inventory",
    assignmentsPayload = [], // Array of { terminalId, product, sellingPriceOverride, discountTypeOverride, discountValueOverride, taxOverride, stockMode, initialStockQuantity, lowStockAlert, categoryId, categoryName }
  }
) {
  if (!shopId) throw new Error("Missing shopId.");
  if (!Array.isArray(assignmentsPayload) || assignmentsPayload.length === 0) {
    throw new Error("Please select at least one product and terminal to assign.");
  }

  const batch = writeBatch(db);
  let assignedCount = 0;

  assignmentsPayload.forEach((entry) => {
    const tId = entry.terminalId;
    const prod = entry.product;
    if (!tId || !prod?.id) return;
    if (prod.shopId && prod.shopId !== shopId) {
      throw new Error("Unauthorized: Cross-shop product assignment is blocked.");
    }

    const assignmentId = `shared_${prod.id}`;
    const assignRef = doc(db, "users", shopId, "terminals", tId, "products", assignmentId);

    const stockMode =
      entry.stockMode === STOCK_MODES.INDEPENDENT
        ? STOCK_MODES.INDEPENDENT
        : STOCK_MODES.SHARED;

    const hasPriceOverride =
      entry.sellingPriceOverride !== "" &&
      entry.sellingPriceOverride !== null &&
      entry.sellingPriceOverride !== undefined;
    const hasTaxOverride =
      entry.taxOverride !== "" &&
      entry.taxOverride !== null &&
      entry.taxOverride !== undefined;
    const hasDiscOverride =
      entry.discountValueOverride !== "" &&
      entry.discountValueOverride !== null &&
      entry.discountValueOverride !== undefined;

    const docData = {
      id: assignmentId,
      shopId,
      terminalId: tId,
      productId: prod.id,
      productCollection: prod.productCollection || productCollection,
      productSource: PRODUCT_SOURCES.SHARED,
      categoryId: entry.categoryId || null,
      categoryName: String(entry.categoryName || prod.category || "General").trim() || "General",
      sellingPriceOverride: hasPriceOverride ? round2(Number(entry.sellingPriceOverride)) : null,
      discountOverride: hasDiscOverride
        ? {
            type:
              entry.discountTypeOverride === DISCOUNT_TYPES.FLAT
                ? DISCOUNT_TYPES.FLAT
                : DISCOUNT_TYPES.PERCENT,
            value: round2(Number(entry.discountValueOverride)),
          }
        : null,
      taxOverride: hasTaxOverride ? round2(Number(entry.taxOverride)) : null,
      stockMode,
      unit: String(prod.unit || "pcs"),
      lowStockAlert: Math.max(0, Number(entry.lowStockAlert ?? prod.lowStockAlert ?? 5) || 0),
      isAvailable: entry.isAvailable !== false,
      isActive: entry.isActive !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    batch.set(assignRef, docData, { merge: true });

    if (stockMode === STOCK_MODES.INDEPENDENT) {
      const invRef = doc(db, "users", shopId, "terminals", tId, "inventory", prod.id);
      const qtyVal = Math.max(0, Number(entry.initialStockQuantity ?? 0) || 0);
      batch.set(
        invRef,
        {
          id: prod.id,
          productId: prod.id,
          shopId,
          terminalId: tId,
          stockMode: STOCK_MODES.INDEPENDENT,
          stockQuantity: qtyVal,
          lowStockAlert: docData.lowStockAlert,
          unit: docData.unit,
          updatedByStaffId: "OWNER",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    assignedCount += 1;
  });

  await batch.commit();
  return assignedCount;
}

/**
 * MODEL B: Update Terminal-Specific Overrides for a Shared Product without touching original Shop Product.
 */
export async function updateSharedProductAssignmentOverrides(
  db,
  {
    shopId,
    terminalId,
    assignmentId,
    productId,
    productCollection = "inventory",
    overrides,
    existingCategories = [],
  }
) {
  if (!shopId || !terminalId || !productId) {
    throw new Error("Missing shop, terminal, or product ID.");
  }

  let categoryId = overrides.categoryId || null;
  let categoryName = String(overrides.categoryName || "General").trim() || "General";

  const matchedCat = existingCategories.find(
    (c) =>
      (categoryId && c.id === categoryId) ||
      String(c.name || "").trim().toLowerCase() === categoryName.toLowerCase()
  );

  const batch = writeBatch(db);
  if (matchedCat) {
    categoryId = matchedCat.id;
    categoryName = matchedCat.name;
  } else {
    const newCatRef = doc(collection(db, "users", shopId, "terminals", terminalId, "categories"));
    categoryId = newCatRef.id;
    batch.set(newCatRef, {
      id: newCatRef.id,
      shopId,
      terminalId,
      name: categoryName,
      description: "",
      color: "#2563eb",
      sortOrder: existingCategories.length + 1,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const finalAssignId = assignmentId || `shared_${productId}`;
  const assignRef = doc(db, "users", shopId, "terminals", terminalId, "products", finalAssignId);

  const hasPriceOverride =
    overrides.sellingPriceOverride !== "" &&
    overrides.sellingPriceOverride !== null &&
    overrides.sellingPriceOverride !== undefined;
  const hasTaxOverride =
    overrides.taxOverride !== "" &&
    overrides.taxOverride !== null &&
    overrides.taxOverride !== undefined;
  const hasDiscOverride =
    overrides.discountValueOverride !== "" &&
    overrides.discountValueOverride !== null &&
    overrides.discountValueOverride !== undefined;

  const stockMode =
    overrides.stockMode === STOCK_MODES.INDEPENDENT
      ? STOCK_MODES.INDEPENDENT
      : STOCK_MODES.SHARED;

  batch.set(
    assignRef,
    {
      id: finalAssignId,
      shopId,
      terminalId,
      productId,
      productCollection,
      productSource: PRODUCT_SOURCES.SHARED,
      categoryId,
      categoryName,
      sellingPriceOverride: hasPriceOverride ? round2(Number(overrides.sellingPriceOverride)) : null,
      discountOverride: hasDiscOverride
        ? {
            type:
              overrides.discountTypeOverride === DISCOUNT_TYPES.FLAT
                ? DISCOUNT_TYPES.FLAT
                : DISCOUNT_TYPES.PERCENT,
            value: round2(Number(overrides.discountValueOverride)),
          }
        : null,
      taxOverride: hasTaxOverride ? round2(Number(overrides.taxOverride)) : null,
      stockMode,
      lowStockAlert: Math.max(0, Number(overrides.lowStockAlert ?? 5) || 0),
      isAvailable: overrides.isAvailable !== false,
      isActive: overrides.isActive !== false,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (stockMode === STOCK_MODES.INDEPENDENT && overrides.stockQuantity !== undefined) {
    const invRef = doc(db, "users", shopId, "terminals", terminalId, "inventory", productId);
    batch.set(
      invRef,
      {
        id: productId,
        productId,
        shopId,
        terminalId,
        stockMode: STOCK_MODES.INDEPENDENT,
        stockQuantity: Math.max(0, Number(overrides.stockQuantity || 0) || 0),
        lowStockAlert: Math.max(0, Number(overrides.lowStockAlert ?? 5) || 0),
        unit: String(overrides.unit || "pcs"),
        updatedByStaffId: "OWNER",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

export async function toggleTerminalProductAssignmentStatus(
  db,
  { shopId, terminalId, item, field = "isActive", nextValue }
) {
  if (!shopId || !terminalId || !item?.productId) return;
  const assignId =
    item.assignmentId ||
    (item.productSource === PRODUCT_SOURCES.INDEPENDENT
      ? `ind_${item.productId}`
      : `shared_${item.productId}`);

  const assignRef = doc(db, "users", shopId, "terminals", terminalId, "products", assignId);
  await setDoc(
    assignRef,
    {
      id: assignId,
      shopId,
      terminalId,
      productId: item.productId,
      productCollection: item.productCollection || "inventory",
      productSource: item.productSource || PRODUCT_SOURCES.SHARED,
      stockMode: item.stockMode || STOCK_MODES.SHARED,
      categoryName: item.category || "General",
      [field]: Boolean(nextValue),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // If independent, mirror on master doc too
  if (item.productSource === PRODUCT_SOURCES.INDEPENDENT && item.productCollection) {
    await setDoc(
      doc(db, "users", shopId, item.productCollection, item.productId),
      { [field]: Boolean(nextValue), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }
}

/**
 * Removes a shared product assignment from a terminal (leaving original shop product intact),
 * or deletes an independent product if NOT referenced in historical bills.
 */
export async function removeOrDeleteTerminalProduct(
  db,
  { shopId, terminalId, item, salesList = [], transactionsList = [], defaultCollection = "inventory" }
) {
  if (!shopId || !terminalId || !item?.productId) {
    throw new Error("Missing product details.");
  }

  const colName = item.productCollection || defaultCollection;

  // Shared product -> ONLY remove terminal assignment & terminal inventory doc; keep Shop Product!
  if (item.productSource === PRODUCT_SOURCES.SHARED) {
    const batch = writeBatch(db);
    const assignId = item.assignmentId || `shared_${item.productId}`;
    batch.delete(doc(db, "users", shopId, "terminals", terminalId, "products", assignId));
    batch.delete(doc(db, "users", shopId, "terminals", terminalId, "inventory", item.productId));
    await batch.commit();
    return { removedShared: true, deletedIndependent: false };
  }

  // Independent product -> Check historical invoice references first!
  const isReferenced = checkProductReferencedInHistory(salesList, transactionsList, item.productId);
  if (isReferenced) {
    throw new Error(
      `Cannot delete "${item.name}" because it is referenced in past invoices/bills. Deactivate it instead to preserve historical receipts.`
    );
  }

  const batch = writeBatch(db);
  if (item.assignmentId) {
    batch.delete(doc(db, "users", shopId, "terminals", terminalId, "products", item.assignmentId));
  }
  batch.delete(doc(db, "users", shopId, "terminals", terminalId, "products", `ind_${item.productId}`));
  batch.delete(doc(db, "users", shopId, "terminals", terminalId, "inventory", item.productId));
  batch.delete(doc(db, "users", shopId, colName, item.productId));
  await batch.commit();
  return { removedShared: false, deletedIndependent: true };
}

/**
 * Atomically adjusts stock for either Independent Terminal Stock or Shared Shop Stock
 * using a Firestore transaction and writes a traceable stock movement audit record.
 */
export async function adjustTerminalProductStock(
  db,
  {
    shopId,
    terminalId,
    productId,
    productName,
    productSource = PRODUCT_SOURCES.INDEPENDENT,
    stockMode = STOCK_MODES.INDEPENDENT,
    productCollection = "inventory",
    mode = "add", // "add" | "subtract" | "set"
    quantity = 0,
    lowStockAlert = null,
    reason = "Manual Stock Adjustment",
    staffId = "OWNER",
    staffName = "Store Owner",
    allowNegativeStock = false,
  }
) {
  if (!shopId || !terminalId || !productId) throw new Error("Missing stock adjustment details.");
  const qtyNum = Number(quantity);
  if (!Number.isFinite(qtyNum) || qtyNum < 0) {
    throw new Error("Please enter a valid non-negative stock quantity.");
  }

  const termInvRef = doc(db, "users", shopId, "terminals", terminalId, "inventory", productId);
  const masterRef = doc(db, "users", shopId, productCollection, productId);
  const moveRef = doc(collection(db, "users", shopId, "stock_movements"));

  return runTransaction(db, async (tx) => {
    // 1. ALL READS FIRST
    const termInvSnap = await tx.get(termInvRef);
    const masterSnap = await tx.get(masterRef);

    const prevQty =
      stockMode === STOCK_MODES.INDEPENDENT
        ? Number(
            termInvSnap.exists()
              ? termInvSnap.data().stockQuantity ?? 0
              : masterSnap.exists()
              ? masterSnap.data().quantity ?? 0
              : 0
          )
        : Number(masterSnap.exists() ? masterSnap.data().quantity ?? 0 : 0);

    let nextQty = prevQty;
    if (mode === "set") nextQty = qtyNum;
    else if (mode === "subtract") nextQty = prevQty - qtyNum;
    else nextQty = prevQty + qtyNum;

    if (!allowNegativeStock && nextQty < 0) {
      throw new Error(
        `Cannot reduce stock below 0 for "${productName || productId}". Current stock: ${prevQty}.`
      );
    }

    const changeQty = round2(nextQty - prevQty);
    const nowMs = Date.now();
    const resolvedAlert =
      lowStockAlert !== null && lowStockAlert !== undefined && lowStockAlert !== ""
        ? Number(lowStockAlert)
        : Number(termInvSnap.data()?.lowStockAlert ?? masterSnap.data()?.lowStockAlert ?? 5);

    // 2. ALL WRITES AFTER READS
    if (stockMode === STOCK_MODES.INDEPENDENT) {
      tx.set(
        termInvRef,
        {
          id: productId,
          productId,
          shopId,
          terminalId,
          stockMode: STOCK_MODES.INDEPENDENT,
          stockQuantity: round2(nextQty),
          lowStockAlert: resolvedAlert,
          updatedByStaffId: String(staffId || "OWNER"),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (productSource === PRODUCT_SOURCES.INDEPENDENT && masterSnap.exists()) {
        tx.update(masterRef, {
          quantity: round2(nextQty),
          stockQuantity: round2(nextQty),
          lowStockAlert: resolvedAlert,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      if (!masterSnap.exists()) {
        throw new Error("Central shop product no longer exists.");
      }
      tx.update(masterRef, {
        quantity: round2(nextQty),
        stockQuantity: round2(nextQty),
        lowStockAlert: resolvedAlert,
        updatedAt: serverTimestamp(),
      });
    }

    const movementDoc = {
      id: moveRef.id,
      shopId,
      terminalId,
      productId,
      productName: String(productName || masterSnap.data()?.name || "Product"),
      productSource,
      stockMode,
      previousQty: round2(prevQty),
      changeQty,
      newQty: round2(nextQty),
      reason: String(reason || "Manual Adjustment").trim(),
      referenceId: null,
      staffId: String(staffId || "OWNER"),
      staffName: String(staffName || "Owner"),
      createdAt: serverTimestamp(),
      createdAtMs: nowMs,
    };
    tx.set(moveRef, movementDoc);

    return movementDoc;
  });
}

/**
 * Helper to resolve and check Shop Product doc from collection name fallback.
 */
export async function fetchShopProductDoc(db, shopId, productId, candidateCollections = ["inventory", "restaurant_menu", "global_inventory"]) {
  for (const col of candidateCollections) {
    const snap = await getDoc(doc(db, "users", shopId, col, productId));
    if (snap.exists()) {
      return { collection: col, data: { id: snap.id, ...snap.data() } };
    }
  }
  return null;
}
