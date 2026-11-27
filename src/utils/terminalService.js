import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

export const TERMINAL_STATUSES = {
  ACTIVE: "active",
  INACTIVE: "inactive",
};

export const SESSION_STATUSES = {
  OPEN: "open",
  CLOSED: "closed",
};

export const INVENTORY_MODES = {
  SHARED: "shared",
  FLOOR_WISE: "floor_wise",
  TERMINAL_WISE: "terminal_wise",
};

export function toMillis(val) {
  if (!val) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val?.toDate === "function") return val.toDate().getTime();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  const parsed = new Date(val).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatDateTime(val) {
  const ms = toMillis(val);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(amount) {
  const num = Number(amount || 0);
  return `₹${num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function normalizeTerminalCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

export function generateUniqueTerminalCode(existingTerminals = [], floorName = "") {
  const used = new Set(
    existingTerminals.map((t) => normalizeTerminalCode(t.code)).filter(Boolean)
  );
  const floorPrefixRaw = String(floorName || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const prefix = floorPrefixRaw.length >= 2 ? `T-${floorPrefixRaw.slice(0, 2)}` : "TRM";

  let counter = existingTerminals.length + 1;
  while (counter < 9999) {
    const candidate = `${prefix}-${String(counter).padStart(2, "0")}`;
    if (!used.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
  return `TRM-${Date.now().toString().slice(-5)}`;
}

export function isDuplicateTerminalCode(terminals = [], code, excludeTerminalId = null) {
  const normalized = normalizeTerminalCode(code);
  if (!normalized) return false;
  return terminals.some(
    (t) =>
      t.id !== excludeTerminalId &&
      normalizeTerminalCode(t.code) === normalized
  );
}

export function captureDeviceInfo() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      userAgent: "Server/Test",
      platform: "Unknown",
      screen: "Unknown",
      deviceLabel: "POS Terminal",
      capturedAtIso: new Date().toISOString(),
    };
  }
  const ua = navigator.userAgent || "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "Web";
  const screenStr = window.screen ? `${window.screen.width}x${window.screen.height}` : "Unknown";
  let browser = "Browser";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";
  else if (ua.includes("Firefox/")) browser = "Firefox";

  return {
    userAgent: ua.slice(0, 220),
    platform,
    screen: screenStr,
    deviceLabel: `${browser} on ${platform} (${screenStr})`,
    capturedAtIso: new Date().toISOString(),
  };
}

export function normalizePaymentBucket(paymentMethod) {
  const raw = String(paymentMethod || "").trim().toLowerCase();
  if (raw.includes("upi") || raw.includes("qr")) return "upi";
  if (raw.includes("card") || raw.includes("debit") || raw.includes("credit card")) return "card";
  if (raw === "credit" || raw.includes("khata") || raw.includes("due")) return "credit";
  return "cash";
}

export function getShopInventoryMode(userData) {
  if (userData?.inventoryMode === INVENTORY_MODES.TERMINAL_WISE) {
    return INVENTORY_MODES.TERMINAL_WISE;
  }
  if (userData?.inventoryMode === INVENTORY_MODES.FLOOR_WISE) {
    return INVENTORY_MODES.FLOOR_WISE;
  }
  return INVENTORY_MODES.SHARED;
}

export function filterProductsForCatalog(
  products = [],
  {
    inventoryMode = INVENTORY_MODES.SHARED,
    terminalId = null,
    floorId = null,
    primaryTerminalId = null,
  } = {}
) {
  const hasTerminalTarget = Boolean(terminalId && terminalId !== "all");
  const hasFloorTarget = Boolean(floorId && floorId !== "all");

  if (inventoryMode === INVENTORY_MODES.TERMINAL_WISE && hasTerminalTarget) {
    return products.filter((p) => {
      if (p.terminalId === "all") return true;
      if (p.terminalId) return p.terminalId === terminalId;
      if (p.floorId && p.floorId !== "all") {
        return hasFloorTarget ? p.floorId === floorId : false;
      }
      // Legacy unassigned items stay on the primary (first) terminal so new terminals start clean
      if (primaryTerminalId) {
        return terminalId === primaryTerminalId;
      }
      return true;
    });
  }

  if (inventoryMode === INVENTORY_MODES.FLOOR_WISE && hasFloorTarget) {
    return products.filter((p) => {
      if (p.terminalId && p.terminalId !== "all") {
        return hasTerminalTarget ? p.terminalId === terminalId : false;
      }
      if (!p.floorId || p.floorId === "all") {
        if (Array.isArray(p.assignedFloorIds) && p.assignedFloorIds.length > 0) {
          return p.assignedFloorIds.includes(floorId);
        }
        return true;
      }
      return p.floorId === floorId;
    });
  }

  // Even in Shared mode, respect explicit terminal-specific items
  if (hasTerminalTarget) {
    return products.filter((p) => !p.terminalId || p.terminalId === "all" || p.terminalId === terminalId);
  }

  return products;
}

export function filterProductsForFloor(
  products = [],
  { inventoryMode = INVENTORY_MODES.SHARED, floorId = null, terminalId = null, primaryTerminalId = null } = {}
) {
  return filterProductsForCatalog(products, {
    inventoryMode,
    floorId,
    terminalId,
    primaryTerminalId,
  });
}

export function getAuthorizedTerminalsForStaff({
  terminals = [],
  floors = [],
  shopId,
  staffId,
  isOwner = false,
}) {
  if (!shopId) return [];
  const floorMap = new Map(floors.map((f) => [f.id, f]));

  return terminals
    .filter((t) => {
      if (t.shopId && t.shopId !== shopId) return false;
      if (t.status === TERMINAL_STATUSES.INACTIVE || t.isActive === false) return false;

      const parentFloor = floorMap.get(t.floorId);
      if (parentFloor && (parentFloor.status === "inactive" || parentFloor.isActive === false)) {
        return false;
      }

      if (isOwner) return true;
      if (!staffId) return false;
      const assigned = Array.isArray(t.assignedStaffIds) ? t.assignedStaffIds : [];
      return assigned.includes(staffId);
    })
    .sort((a, b) => {
      const fA = floorMap.get(a.floorId)?.order ?? 999;
      const fB = floorMap.get(b.floorId)?.order ?? 999;
      if (fA !== fB) return fA - fB;
      return String(a.code || a.name || "").localeCompare(String(b.code || b.name || ""));
    });
}

export function calculateSessionSummaryFromTransactions(
  transactions = [],
  openingCash = 0,
  actualClosingCash = null
) {
  let totalSales = 0;
  let totalCashSales = 0;
  let totalUpiSales = 0;
  let totalCardSales = 0;
  let totalCreditSales = 0;
  let totalRefunds = 0;
  let totalCashRefunds = 0;
  let totalCancellations = 0;
  let saleCount = 0;

  for (const txn of transactions) {
    const amount = Number(txn.amount || 0);
    const bucket = txn.paymentBucket || normalizePaymentBucket(txn.paymentMethod);

    if (txn.type === "refund") {
      totalRefunds += amount;
      if (bucket === "cash") {
        totalCashRefunds += amount;
      }
    } else if (txn.type === "cancellation") {
      totalCancellations += amount;
    } else {
      // Cancelled sales are excluded from collected sales; totalCancellations is summed from the cancellation record
      if (txn.status === "cancelled") {
        continue;
      }
      saleCount += 1;
      totalSales += amount;
      if (bucket === "cash") totalCashSales += amount;
      else if (bucket === "upi") totalUpiSales += amount;
      else if (bucket === "card") totalCardSales += amount;
      else if (bucket === "credit") totalCreditSales += amount;
    }
  }

  const openAmt = Number(openingCash || 0);
  const expectedClosingCash = Number(
    (openAmt + totalCashSales - totalCashRefunds).toFixed(2)
  );
  const hasActual = actualClosingCash !== null && actualClosingCash !== undefined && actualClosingCash !== "";
  const actualNum = hasActual ? Number(actualClosingCash) : null;
  const cashDifference =
    hasActual && Number.isFinite(actualNum)
      ? Number((actualNum - expectedClosingCash).toFixed(2))
      : null;

  return {
    openingCash: Number(openAmt.toFixed(2)),
    totalSales: Number(totalSales.toFixed(2)),
    totalCashSales: Number(totalCashSales.toFixed(2)),
    totalUpiSales: Number(totalUpiSales.toFixed(2)),
    totalCardSales: Number(totalCardSales.toFixed(2)),
    totalCreditSales: Number(totalCreditSales.toFixed(2)),
    totalRefunds: Number(totalRefunds.toFixed(2)),
    totalCashRefunds: Number(totalCashRefunds.toFixed(2)),
    totalCancellations: Number(totalCancellations.toFixed(2)),
    transactionCount: saleCount,
    expectedClosingCash,
    actualClosingCash: actualNum,
    cashDifference,
  };
}

export function filterRecordsByTimeframe(
  records = [],
  { timeframe = "all", startDate = "", endDate = "", now = new Date() } = {}
) {
  if (timeframe === "all") return records;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86400000 - 1;

  return records.filter((rec) => {
    const ms = toMillis(rec.createdAt || rec.openedAt || rec.createdAtMs || rec.openedAtMs);
    if (!ms) return false;

    if (timeframe === "daily" || timeframe === "today") {
      return ms >= todayStart && ms <= todayEnd;
    }
    if (timeframe === "weekly") {
      const weekAgo = todayStart - 6 * 86400000;
      return ms >= weekAgo && ms <= todayEnd;
    }
    if (timeframe === "monthly") {
      const d = new Date(ms);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    if (timeframe === "custom") {
      const sMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
      const eMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Infinity;
      return ms >= sMs && ms <= eMs;
    }
    return true;
  });
}

export function buildTerminalSalesReport({
  sales = [],
  transactions = [],
  floors = [],
  terminals = [],
  sessions = [],
  timeframe = "all",
  startDate = "",
  endDate = "",
  filterFloorId = "all",
  filterTerminalId = "all",
  now = new Date(),
}) {
  const floorMap = new Map(floors.map((f) => [f.id, f]));
  const terminalMap = new Map(terminals.map((t) => [t.id, t]));

  // Combine terminal transactions and sales without double-counting
  const seenSaleIds = new Set();
  const normalizedEntries = [];

  for (const txn of transactions) {
    if (txn.saleDocId) seenSaleIds.add(txn.saleDocId);
    if (txn.billNo) seenSaleIds.add(`bill:${txn.billNo}`);
    normalizedEntries.push({
      id: txn.id,
      type: txn.type || "sale",
      status: txn.status || "completed",
      amount: Number(txn.amount || 0),
      paymentBucket: txn.paymentBucket || normalizePaymentBucket(txn.paymentMethod),
      floorId: txn.floorId || "unassigned",
      floorName: txn.floorName || floorMap.get(txn.floorId)?.name || "Unassigned Floor",
      terminalId: txn.terminalId || "unassigned",
      terminalName: txn.terminalName || terminalMap.get(txn.terminalId)?.name || "Unassigned Terminal",
      terminalCode: txn.terminalCode || terminalMap.get(txn.terminalId)?.code || "—",
      staffId: txn.staffId || "OWNER",
      staffName: txn.staffName || "Store Owner",
      createdAt: txn.createdAt || txn.createdAtMs,
    });
  }

  for (const s of sales) {
    if (seenSaleIds.has(s.id) || (s.billNo && seenSaleIds.has(`bill:${s.billNo}`))) {
      continue;
    }
    normalizedEntries.push({
      id: s.id,
      type: s.transactionType || "sale",
      status: s.transactionStatus || "completed",
      amount: Number(s.totalAmount || s.total || 0),
      paymentBucket: normalizePaymentBucket(s.paymentMethod || s.paymentMode),
      floorId: s.floorId || "legacy_counter",
      floorName: s.floorName || (s.terminalId ? floorMap.get(s.floorId)?.name || "Floor" : "Direct Counter (Legacy)"),
      terminalId: s.terminalId || "legacy_counter",
      terminalName: s.terminalName || (s.terminalId ? terminalMap.get(s.terminalId)?.name || "Terminal" : "Direct Counter (No Terminal)"),
      terminalCode: s.terminalCode || "—",
      staffId: s.staffId || "OWNER",
      staffName: s.staffName || s.billedBy || "Store Owner",
      createdAt: s.createdAt || s.createdAtMs,
    });
  }

  const timeFiltered = filterRecordsByTimeframe(normalizedEntries, {
    timeframe,
    startDate,
    endDate,
    now,
  });

  const filtered = timeFiltered.filter((e) => {
    if (filterFloorId !== "all" && e.floorId !== filterFloorId) return false;
    if (filterTerminalId !== "all" && e.terminalId !== filterTerminalId) return false;
    return true;
  });

  const floorAgg = new Map();
  const terminalAgg = new Map();
  const staffAgg = new Map();

  // Seed active floors & terminals so zero-sale ones still appear cleanly in reports
  if (filterTerminalId === "all") {
    for (const f of floors) {
      if (filterFloorId !== "all" && f.id !== filterFloorId) continue;
      floorAgg.set(f.id, {
        floorId: f.id,
        floorName: f.name,
        totalSales: 0,
        ordersCount: 0,
        cash: 0,
        upi: 0,
        card: 0,
        credit: 0,
        refunds: 0,
      });
    }
  }
  for (const t of terminals) {
    if (filterFloorId !== "all" && t.floorId !== filterFloorId) continue;
    if (filterTerminalId !== "all" && t.id !== filterTerminalId) continue;
    terminalAgg.set(t.id, {
      terminalId: t.id,
      terminalName: t.name,
      terminalCode: t.code,
      floorId: t.floorId,
      floorName: t.floorName || floorMap.get(t.floorId)?.name || "Floor",
      totalSales: 0,
      ordersCount: 0,
      cash: 0,
      upi: 0,
      card: 0,
      credit: 0,
      refunds: 0,
    });
  }

  const summary = {
    totalGrossSales: 0,
    totalNetSales: 0,
    totalOrders: 0,
    totalRefunds: 0,
    totalCancellations: 0,
    cashTotal: 0,
    upiTotal: 0,
    cardTotal: 0,
    creditTotal: 0,
  };

  for (const item of filtered) {
    const amt = Number(item.amount || 0);
    const bucket = item.paymentBucket;

    if (!floorAgg.has(item.floorId)) {
      floorAgg.set(item.floorId, {
        floorId: item.floorId,
        floorName: item.floorName,
        totalSales: 0,
        ordersCount: 0,
        cash: 0,
        upi: 0,
        card: 0,
        credit: 0,
        refunds: 0,
      });
    }
    if (!terminalAgg.has(item.terminalId)) {
      terminalAgg.set(item.terminalId, {
        terminalId: item.terminalId,
        terminalName: item.terminalName,
        terminalCode: item.terminalCode,
        floorId: item.floorId,
        floorName: item.floorName,
        totalSales: 0,
        ordersCount: 0,
        cash: 0,
        upi: 0,
        card: 0,
        credit: 0,
        refunds: 0,
      });
    }
    if (!staffAgg.has(item.staffId)) {
      staffAgg.set(item.staffId, {
        staffId: item.staffId,
        staffName: item.staffName,
        totalSales: 0,
        ordersCount: 0,
        cash: 0,
        upi: 0,
        card: 0,
        credit: 0,
        refunds: 0,
      });
    }

    const fRec = floorAgg.get(item.floorId);
    const tRec = terminalAgg.get(item.terminalId);
    const sRec = staffAgg.get(item.staffId);

    if (item.type === "refund") {
      summary.totalRefunds += amt;
      fRec.refunds += amt;
      tRec.refunds += amt;
      sRec.refunds += amt;
      continue;
    }

    if (item.type === "cancellation") {
      summary.totalCancellations += amt;
      continue;
    }

    if (item.status === "cancelled") {
      continue;
    }

    // Completed (or partially refunded via separate refund txn) sale
    summary.totalGrossSales += amt;
    summary.totalOrders += 1;
    if (bucket === "cash") summary.cashTotal += amt;
    else if (bucket === "upi") summary.upiTotal += amt;
    else if (bucket === "card") summary.cardTotal += amt;
    else if (bucket === "credit") summary.creditTotal += amt;

    fRec.totalSales += amt;
    fRec.ordersCount += 1;
    fRec[bucket] += amt;

    tRec.totalSales += amt;
    tRec.ordersCount += 1;
    tRec[bucket] += amt;

    sRec.totalSales += amt;
    sRec.ordersCount += 1;
    sRec[bucket] += amt;
  }

  summary.totalNetSales = Number(Math.max(0, summary.totalGrossSales - summary.totalRefunds).toFixed(2));

  const sessionsHistory = filterRecordsByTimeframe(sessions, {
    timeframe,
    startDate,
    endDate,
    now,
  })
    .filter((sess) => {
      if (filterFloorId !== "all" && sess.floorId !== filterFloorId) return false;
      if (filterTerminalId !== "all" && sess.terminalId !== filterTerminalId) return false;
      return true;
    })
    .sort((a, b) => toMillis(b.openedAt || b.createdAt) - toMillis(a.openedAt || a.createdAt));

  return {
    summary,
    byFloor: Array.from(floorAgg.values()).sort((a, b) => b.totalSales - a.totalSales),
    byTerminal: Array.from(terminalAgg.values()).sort((a, b) => b.totalSales - a.totalSales),
    byStaff: Array.from(staffAgg.values())
      .map((s) => ({
        ...s,
        avgOrderValue: s.ordersCount > 0 ? s.totalSales / s.ordersCount : 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales),
    paymentBreakdown: {
      cash: summary.cashTotal,
      upi: summary.upiTotal,
      card: summary.cardTotal,
      credit: summary.creditTotal,
      total: summary.totalGrossSales,
    },
    sessionsHistory,
  };
}

// ============================================================================
// FIRESTORE REAL-TIME SUBSCRIPTIONS & TRANSACTIONS
// ============================================================================

export function subscribeFloors(db, shopId, onData, onError) {
  if (!shopId) return () => {};
  const floorsRef = collection(db, "users", shopId, "floors");
  return onSnapshot(
    floorsRef,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const orderDiff = Number(a.order ?? 999) - Number(b.order ?? 999);
        if (orderDiff !== 0) return orderDiff;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      onData(list);
    },
    (err) => {
      console.error("subscribeFloors error:", err);
      if (onError) onError(err);
    }
  );
}

export function subscribeTerminals(db, shopId, onData, onError) {
  if (!shopId) return () => {};
  const terminalsRef = collection(db, "users", shopId, "terminals");
  return onSnapshot(
    terminalsRef,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => String(a.code || a.name || "").localeCompare(String(b.code || b.name || "")));
      onData(list);
    },
    (err) => {
      console.error("subscribeTerminals error:", err);
      if (onError) onError(err);
    }
  );
}

export function subscribeTerminalSessions(db, shopId, terminalId, onData, onError) {
  if (!shopId || !terminalId) return () => {};
  const ref = collection(db, "users", shopId, "terminals", terminalId, "sessions");
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => toMillis(b.openedAt || b.createdAt) - toMillis(a.openedAt || a.createdAt));
      onData(list);
    },
    (err) => {
      console.error("subscribeTerminalSessions error:", err);
      if (onError) onError(err);
    }
  );
}

export function subscribeTerminalTransactions(db, shopId, terminalId, onData, onError) {
  if (!shopId || !terminalId) return () => {};
  const ref = collection(db, "users", shopId, "terminals", terminalId, "transactions");
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onData(list);
    },
    (err) => {
      console.error("subscribeTerminalTransactions error:", err);
      if (onError) onError(err);
    }
  );
}

export async function fetchAllShopSessions(db, shopId, terminals = []) {
  if (!shopId || terminals.length === 0) return [];
  const results = await Promise.all(
    terminals.map(async (t) => {
      try {
        const snap = await getDocs(collection(db, "users", shopId, "terminals", t.id, "sessions"));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn(`Could not fetch sessions for terminal ${t.id}:`, err);
        return [];
      }
    })
  );
  return results
    .flat()
    .sort((a, b) => toMillis(b.openedAt || b.createdAt) - toMillis(a.openedAt || a.createdAt));
}

export async function fetchAllShopTransactions(db, shopId, terminals = []) {
  if (!shopId || terminals.length === 0) return [];
  const results = await Promise.all(
    terminals.map(async (t) => {
      try {
        const snap = await getDocs(collection(db, "users", shopId, "terminals", t.id, "transactions"));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (err) {
        console.warn(`Could not fetch transactions for terminal ${t.id}:`, err);
        return [];
      }
    })
  );
  return results
    .flat()
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function ensurePrimaryTerminalSeeded(
  db,
  shopId,
  { floors = [], terminals = [], rawUserData = null, storeName = "Main Counter" } = {}
) {
  if (!shopId) return null;
  if (rawUserData?.primaryTerminalSeeded === true) return null;
  const hasPrimary = terminals.some((t) => t.isPrimary === true || t.id === "terminal_1");
  if (hasPrimary) {
    try {
      await setDoc(
        doc(db, "users", shopId),
        { primaryTerminalSeeded: true },
        { merge: true }
      );
    } catch {
      // Ignore if offline or non-owner
    }
    return null;
  }

  // Pick an existing ground/first floor or create floor_1
  let targetFloor = floors.find(
    (f) =>
      f.id === "floor_1" ||
      String(f.name || "").toLowerCase().includes("ground") ||
      String(f.name || "").toLowerCase().includes("1st") ||
      Number(f.order) === 0
  );

  const batch = writeBatch(db);
  if (!targetFloor) {
    const floorRef = doc(db, "users", shopId, "floors", "floor_1");
    targetFloor = {
      id: "floor_1",
      shopId,
      name: "Ground Floor (Main)",
      description: `Primary billing floor for ${storeName}`,
      order: 1,
      status: "active",
      isActive: true,
      isPrimary: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(floorRef, targetFloor, { merge: true });
  }

  const termCode = isDuplicateTerminalCode(terminals, "TRM-01")
    ? generateUniqueTerminalCode(terminals, targetFloor.name)
    : "TRM-01";
  const termRef = doc(db, "users", shopId, "terminals", "terminal_1");
  const primaryTerminal = {
    id: "terminal_1",
    shopId,
    floorId: targetFloor.id,
    floorName: targetFloor.name,
    name: "Terminal 1 (Main Counter)",
    code: termCode,
    isPrimary: true,
    assignedStaffIds: [],
    assignedStaff: [],
    status: TERMINAL_STATUSES.ACTIVE,
    isActive: true,
    sessionStatus: SESSION_STATUSES.CLOSED,
    currentSessionId: null,
    activeStaffId: null,
    activeStaffName: null,
    deviceInfo: captureDeviceInfo(),
    lastActiveAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(termRef, primaryTerminal, { merge: true });

  const userUpdates = { primaryTerminalSeeded: true };
  if (!rawUserData?.inventoryMode && terminals.length >= 1) {
    userUpdates.inventoryMode = INVENTORY_MODES.TERMINAL_WISE;
  }
  batch.set(doc(db, "users", shopId), userUpdates, { merge: true });

  await batch.commit();
  return primaryTerminal;
}

export async function setShopInventoryMode(db, shopId, mode) {
  if (!shopId) throw new Error("Missing shopId");
  const normalized =
    mode === INVENTORY_MODES.TERMINAL_WISE
      ? INVENTORY_MODES.TERMINAL_WISE
      : mode === INVENTORY_MODES.FLOOR_WISE
      ? INVENTORY_MODES.FLOOR_WISE
      : INVENTORY_MODES.SHARED;
  await setDoc(
    doc(db, "users", shopId),
    { inventoryMode: normalized, updatedAt: serverTimestamp() },
    { merge: true }
  );
  return normalized;
}

export async function assignUnassignedProductsToTerminal(
  db,
  shopId,
  collectionName,
  products = [],
  terminal
) {
  if (!shopId || !collectionName || !terminal?.id) {
    throw new Error("Missing shop, collection, or target terminal.");
  }
  const unassigned = products.filter(
    (p) => !p.terminalId && (!p.floorId || p.floorId === "all")
  );
  if (unassigned.length === 0) return 0;

  const chunkSize = 400;
  let updatedCount = 0;
  for (let i = 0; i < unassigned.length; i += chunkSize) {
    const batch = writeBatch(db);
    const slice = unassigned.slice(i, i + chunkSize);
    for (const item of slice) {
      batch.update(doc(db, "users", shopId, collectionName, item.id), {
        terminalId: terminal.id,
        terminalName: terminal.name || "Terminal",
        terminalCode: terminal.code || "",
        floorId: terminal.floorId || "all",
        floorName: terminal.floorName || "Floor",
        updatedAt: serverTimestamp(),
      });
      updatedCount += 1;
    }
    await batch.commit();
  }
  return updatedCount;
}

export async function saveFloor(db, shopId, floorData, editingFloorId = null, existingTerminals = []) {
  if (!shopId) throw new Error("Shop authentication missing.");
  const cleanName = String(floorData.name || "").trim();
  if (!cleanName) throw new Error("Floor name is required.");

  const orderVal = Number.isFinite(Number(floorData.order)) ? Number(floorData.order) : 0;
  const statusVal = floorData.status === "inactive" ? "inactive" : "active";

  if (editingFloorId && statusVal === "inactive") {
    const hasOpenSessionOnFloor = existingTerminals.some(
      (t) => t.floorId === editingFloorId && (t.sessionStatus === "open" || Boolean(t.currentSessionId))
    );
    if (hasOpenSessionOnFloor) {
      throw new Error("Cannot deactivate this floor while one of its terminals has an open billing session.");
    }
  }

  const payload = {
    shopId,
    name: cleanName,
    description: String(floorData.description || "").trim(),
    order: orderVal,
    status: statusVal,
    isActive: statusVal === "active",
    updatedAt: serverTimestamp(),
  };

  if (editingFloorId) {
    const batch = writeBatch(db);
    const floorRef = doc(db, "users", shopId, "floors", editingFloorId);
    batch.set(floorRef, payload, { merge: true });

    // Keep floorName synced on assigned terminals
    const relatedTerminals = existingTerminals.filter((t) => t.floorId === editingFloorId);
    for (const term of relatedTerminals) {
      batch.update(doc(db, "users", shopId, "terminals", term.id), {
        floorName: cleanName,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return { id: editingFloorId, ...payload };
  }

  const newFloorRef = doc(collection(db, "users", shopId, "floors"));
  const createPayload = {
    ...payload,
    id: newFloorRef.id,
    createdAt: serverTimestamp(),
  };
  await setDoc(newFloorRef, createPayload);
  return createPayload;
}

export async function toggleFloorStatus(db, shopId, floor, existingTerminals = []) {
  if (!shopId || !floor?.id) throw new Error("Invalid floor.");
  const nextStatus = floor.status === "inactive" || floor.isActive === false ? "active" : "inactive";

  if (nextStatus === "inactive") {
    const hasOpenSession = existingTerminals.some(
      (t) => t.floorId === floor.id && (t.sessionStatus === "open" || Boolean(t.currentSessionId))
    );
    if (hasOpenSession) {
      throw new Error("Cannot deactivate floor while a terminal on it has an open billing session.");
    }
  }

  await updateDoc(doc(db, "users", shopId, "floors", floor.id), {
    status: nextStatus,
    isActive: nextStatus === "active",
    updatedAt: serverTimestamp(),
  });
  return nextStatus;
}

export async function deleteFloor(db, shopId, floorId, terminals = []) {
  if (!shopId || !floorId) throw new Error("Invalid floor selection.");

  const floorTerminals = terminals.filter((t) => t.floorId === floorId);
  const hasOpenSession = floorTerminals.some(
    (t) => t.sessionStatus === "open" || Boolean(t.currentSessionId)
  );
  if (hasOpenSession) {
    throw new Error("Cannot delete this floor because a terminal on it has an open billing session.");
  }

  const hasActiveTerminals = floorTerminals.some(
    (t) => t.status === "active" || t.isActive !== false
  );
  if (hasActiveTerminals) {
    throw new Error("Cannot delete a floor containing active terminals. Deactivate or move terminals first.");
  }

  if (floorTerminals.length > 0) {
    throw new Error(
      `Cannot delete this floor because ${floorTerminals.length} terminal(s) are still assigned to it. Reassign or delete those terminals first.`
    );
  }

  await deleteDocGuardFloor(db, shopId, floorId);
}

async function deleteDocGuardFloor(db, shopId, floorId) {
  // Server-side double check for any terminals pointing to this floor
  const qSnap = await getDocs(
    query(collection(db, "users", shopId, "terminals"), where("floorId", "==", floorId))
  );
  if (!qSnap.empty) {
    throw new Error("Floor still has terminals in Firestore. Remove or reassign them first.");
  }
  await deleteDoc(doc(db, "users", shopId, "floors", floorId));
}

export async function saveTerminal(
  db,
  shopId,
  terminalData,
  existingTerminals = [],
  floors = [],
  editingTerminalId = null
) {
  if (!shopId) throw new Error("Shop authentication missing.");
  const cleanName = String(terminalData.name || "").trim();
  if (!cleanName) throw new Error("Terminal name is required.");

  const floorObj = floors.find((f) => f.id === terminalData.floorId);
  if (!floorObj) {
    throw new Error("Please select a valid floor for this terminal.");
  }

  const rawCode = terminalData.code
    ? normalizeTerminalCode(terminalData.code)
    : generateUniqueTerminalCode(existingTerminals, floorObj.name);

  if (!rawCode) {
    throw new Error("Terminal code is required.");
  }

  if (isDuplicateTerminalCode(existingTerminals, rawCode, editingTerminalId)) {
    throw new Error(`Terminal code "${rawCode}" already exists in this shop. Codes must be unique.`);
  }

  // Authoritative Firestore duplicate code check
  const dupSnap = await getDocs(
    query(collection(db, "users", shopId, "terminals"), where("code", "==", rawCode))
  );
  const conflictDoc = dupSnap.docs.find((d) => d.id !== editingTerminalId);
  if (conflictDoc) {
    throw new Error(`Terminal code "${rawCode}" is already assigned to another terminal.`);
  }

  const statusVal = terminalData.status === "inactive" ? "inactive" : "active";
  if (editingTerminalId && statusVal === "inactive") {
    const existingTerm = existingTerminals.find((t) => t.id === editingTerminalId);
    if (existingTerm?.sessionStatus === "open" || existingTerm?.currentSessionId) {
      throw new Error("Cannot deactivate terminal while a billing session is open. Close the session first.");
    }
  }

  const assignedStaffList = Array.isArray(terminalData.assignedStaff)
    ? terminalData.assignedStaff.map((s) => ({
        staffId: String(s.staffId || s.id),
        name: String(s.name || "Staff"),
        role: String(s.role || "employee"),
      }))
    : [];
  const assignedStaffIds = Array.from(new Set(assignedStaffList.map((s) => s.staffId)));

  const basePayload = {
    shopId,
    floorId: floorObj.id,
    floorName: floorObj.name,
    name: cleanName,
    code: rawCode,
    assignedStaffIds,
    assignedStaff: assignedStaffList,
    status: statusVal,
    isActive: statusVal === "active",
    deviceInfo: terminalData.deviceInfo || captureDeviceInfo(),
    updatedAt: serverTimestamp(),
  };

  if (editingTerminalId) {
    await setDoc(doc(db, "users", shopId, "terminals", editingTerminalId), basePayload, {
      merge: true,
    });
    return { id: editingTerminalId, ...basePayload };
  }

  const termRef = doc(collection(db, "users", shopId, "terminals"));
  const createPayload = {
    ...basePayload,
    id: termRef.id,
    sessionStatus: SESSION_STATUSES.CLOSED,
    currentSessionId: null,
    activeStaffId: null,
    activeStaffName: null,
    lastActiveAt: null,
    createdAt: serverTimestamp(),
  };
  await setDoc(termRef, createPayload);
  return createPayload;
}

export async function toggleTerminalStatus(db, shopId, terminal) {
  if (!shopId || !terminal?.id) throw new Error("Invalid terminal.");
  const nextStatus = terminal.status === "active" ? "inactive" : "active";
  if (nextStatus === "inactive" && (terminal.sessionStatus === "open" || terminal.currentSessionId)) {
    throw new Error("Cannot deactivate a terminal with an open billing session. Close the session first.");
  }

  await updateDoc(doc(db, "users", shopId, "terminals", terminal.id), {
    status: nextStatus,
    isActive: nextStatus === "active",
    updatedAt: serverTimestamp(),
  });
  return nextStatus;
}

export async function assignTerminalStaff(db, shopId, terminalId, selectedStaffObjects = []) {
  if (!shopId || !terminalId) throw new Error("Missing shop or terminal ID.");
  const assignedStaff = selectedStaffObjects.map((s) => ({
    staffId: String(s.staffId || s.id),
    name: String(s.name || "Staff"),
    role: String(s.role || "employee"),
  }));
  const assignedStaffIds = Array.from(new Set(assignedStaff.map((s) => s.staffId)));

  await updateDoc(doc(db, "users", shopId, "terminals", terminalId), {
    assignedStaff,
    assignedStaffIds,
    updatedAt: serverTimestamp(),
  });
  return { assignedStaff, assignedStaffIds };
}

export async function deleteTerminal(db, shopId, terminal) {
  if (!shopId || !terminal?.id) throw new Error("Invalid terminal.");
  if (terminal.sessionStatus === "open" || terminal.currentSessionId) {
    throw new Error("Cannot delete a terminal with an open billing session. Close the session first.");
  }

  const termRef = doc(db, "users", shopId, "terminals", terminal.id);
  const snap = await getDoc(termRef);
  if (snap.exists()) {
    const data = snap.data();
    if (data.sessionStatus === "open" || data.currentSessionId) {
      throw new Error("Cannot delete terminal: an active billing session is currently open.");
    }
  }
  await deleteDoc(termRef);
}

export async function openTerminalSession(
  db,
  { shopId, terminalId, staffId, staffName, openingCash = 0, isOwner = false }
) {
  if (!shopId || !terminalId) throw new Error("Missing shop or terminal information.");
  const openAmt = Number(openingCash);
  if (!Number.isFinite(openAmt) || openAmt < 0) {
    throw new Error("Opening cash amount must be a valid non-negative number.");
  }

  const actorStaffId = String(staffId || (isOwner ? "OWNER" : "")).trim();
  const actorStaffName = String(staffName || (isOwner ? "Store Owner" : "Staff")).trim();
  if (!actorStaffId) {
    throw new Error("Staff identification is required to open a terminal session.");
  }

  const terminalRef = doc(db, "users", shopId, "terminals", terminalId);
  const sessionRef = doc(collection(db, "users", shopId, "terminals", terminalId, "sessions"));
  const deviceInfo = captureDeviceInfo();

  return runTransaction(db, async (tx) => {
    const termSnap = await tx.get(terminalRef);
    if (!termSnap.exists()) {
      throw new Error("Selected terminal no longer exists.");
    }
    const termData = termSnap.data();

    if (termData.shopId && termData.shopId !== shopId) {
      throw new Error("Unauthorized: Terminal does not belong to your shop.");
    }
    if (termData.status !== "active" || termData.isActive === false) {
      throw new Error("This terminal is currently inactive and cannot open a billing session.");
    }
    if (termData.sessionStatus === "open" || termData.currentSessionId) {
      throw new Error(
        `Terminal "${termData.name}" already has an open session by ${termData.activeStaffName || "another user"}.`
      );
    }

    // Verify floor is active
    if (termData.floorId) {
      const floorSnap = await tx.get(doc(db, "users", shopId, "floors", termData.floorId));
      if (floorSnap.exists()) {
        const floorData = floorSnap.data();
        if (floorData.status === "inactive" || floorData.isActive === false) {
          throw new Error(`Floor "${floorData.name}" is inactive. Activate the floor before opening a session.`);
        }
      }
    }

    // Verify staff authorization on server state
    if (!isOwner) {
      const assigned = Array.isArray(termData.assignedStaffIds) ? termData.assignedStaffIds : [];
      if (!assigned.includes(actorStaffId)) {
        throw new Error("Unauthorized: You are not assigned to this terminal.");
      }
      const staffSnap = await tx.get(doc(db, "users", shopId, "staffs", actorStaffId));
      if (!staffSnap.exists()) {
        throw new Error("Unauthorized: Staff account not found in this shop.");
      }
      const staffData = staffSnap.data();
      if (staffData.status === "inactive" || staffData.isActive === false) {
        throw new Error("Unauthorized: Your staff account is inactive.");
      }
    }

    const nowMs = Date.now();
    const sessionDoc = {
      id: sessionRef.id,
      shopId,
      floorId: termData.floorId,
      floorName: termData.floorName || "Floor",
      terminalId,
      terminalName: termData.name,
      terminalCode: termData.code,
      staffId: actorStaffId,
      staffName: actorStaffName,
      status: SESSION_STATUSES.OPEN,
      openingCash: Number(openAmt.toFixed(2)),
      openedAt: serverTimestamp(),
      openedAtMs: nowMs,
      closedAt: null,
      closedAtMs: null,
      closingStaffId: null,
      closingStaffName: null,
      totalSales: 0,
      totalCashSales: 0,
      totalUpiSales: 0,
      totalCardSales: 0,
      totalCreditSales: 0,
      totalRefunds: 0,
      totalCashRefunds: 0,
      totalCancellations: 0,
      transactionCount: 0,
      expectedClosingCash: Number(openAmt.toFixed(2)),
      actualClosingCash: null,
      cashDifference: null,
      closingNotes: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    tx.set(sessionRef, sessionDoc);
    tx.update(terminalRef, {
      sessionStatus: SESSION_STATUSES.OPEN,
      currentSessionId: sessionRef.id,
      activeStaffId: actorStaffId,
      activeStaffName: actorStaffName,
      lastActiveAt: serverTimestamp(),
      deviceInfo,
      updatedAt: serverTimestamp(),
    });

    return {
      ...sessionDoc,
      openedAt: new Date(nowMs),
    };
  });
}

export async function closeTerminalSession(
  db,
  {
    shopId,
    terminalId,
    sessionId,
    actualClosingCash,
    closingStaffId,
    closingStaffName,
    closingNotes = "",
  }
) {
  if (!shopId || !terminalId || !sessionId) {
    throw new Error("Missing session details to close.");
  }
  const actualAmt = Number(actualClosingCash);
  if (!Number.isFinite(actualAmt) || actualAmt < 0) {
    throw new Error("Please enter a valid non-negative Actual Closing Cash amount.");
  }

  // Query transactions belonging to this session for exact cash reconciliation
  const txnsSnap = await getDocs(
    query(
      collection(db, "users", shopId, "terminals", terminalId, "transactions"),
      where("sessionId", "==", sessionId)
    )
  );
  const sessionTxns = txnsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const terminalRef = doc(db, "users", shopId, "terminals", terminalId);
  const sessionRef = doc(db, "users", shopId, "terminals", terminalId, "sessions", sessionId);

  return runTransaction(db, async (tx) => {
    // Firestore requires ALL reads (tx.get) before ANY writes (tx.set / tx.update)
    const sessionSnap = await tx.get(sessionRef);
    const termSnap = await tx.get(terminalRef);

    if (!sessionSnap.exists()) {
      throw new Error("Billing session record not found.");
    }
    const sessionData = sessionSnap.data();
    if (sessionData.status === SESSION_STATUSES.CLOSED) {
      throw new Error("This billing session has already been closed.");
    }

    const summary = calculateSessionSummaryFromTransactions(
      sessionTxns,
      sessionData.openingCash || 0,
      actualAmt
    );

    const closedAtMs = Date.now();
    const closeUpdates = {
      status: SESSION_STATUSES.CLOSED,
      closedAt: serverTimestamp(),
      closedAtMs,
      closingStaffId: String(closingStaffId || sessionData.staffId || "OWNER"),
      closingStaffName: String(closingStaffName || sessionData.staffName || "Staff"),
      closingNotes: String(closingNotes || "").trim(),
      ...summary,
      updatedAt: serverTimestamp(),
    };

    tx.update(sessionRef, closeUpdates);

    if (termSnap.exists()) {
      const termData = termSnap.data();
      if (!termData.currentSessionId || termData.currentSessionId === sessionId) {
        tx.update(terminalRef, {
          sessionStatus: SESSION_STATUSES.CLOSED,
          currentSessionId: null,
          activeStaffId: null,
          activeStaffName: null,
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    return {
      ...sessionData,
      ...closeUpdates,
      closedAt: new Date(closedAtMs),
    };
  });
}

export async function recordTerminalSaleTransaction(
  db,
  {
    shopId,
    terminal,
    session,
    staffId,
    staffName,
    saleDocId,
    saleRecord,
    idempotencyKey,
    defaultProductCollection = "inventory",
    allowNegativeStock = false,
  }
) {
  if (!shopId || !terminal?.id || !session?.id) {
    throw new Error("Active terminal and session are required to record a terminal sale.");
  }

  const finalSaleId = String(saleDocId || idempotencyKey || `SALE-${Date.now()}`);
  const finalTxnId = String(idempotencyKey || finalSaleId);
  const amount = Number(saleRecord.totalAmount ?? saleRecord.total ?? 0);
  const paymentMethod = saleRecord.paymentMethod || saleRecord.paymentMode || "Cash";
  const paymentBucket = normalizePaymentBucket(paymentMethod);

  const saleRef = doc(db, "users", shopId, "sales", finalSaleId);
  const terminalRef = doc(db, "users", shopId, "terminals", terminal.id);
  const sessionRef = doc(db, "users", shopId, "terminals", terminal.id, "sessions", session.id);
  const txnRef = doc(db, "users", shopId, "terminals", terminal.id, "transactions", finalTxnId);

  const billItems = Array.isArray(saleRecord.items) ? saleRecord.items : [];

  return runTransaction(db, async (tx) => {
    // 1. ALL FIRESTORE READS MUST EXECUTE BEFORE ANY WRITES
    const existingTxn = await tx.get(txnRef);
    if (existingTxn.exists()) {
      return { duplicate: true, saleDocId: finalSaleId, txnId: finalTxnId };
    }

    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) {
      throw new Error("Active billing session no longer exists. Please reopen a session.");
    }
    const sessData = sessionSnap.data();
    if (sessData.status !== SESSION_STATUSES.OPEN) {
      throw new Error("Billing session is closed. Please open a new session before billing.");
    }

    // Aggregate quantities per productId in case duplicate lines exist, and read stock docs
    const aggregatedItemsMap = new Map();
    billItems.forEach((rawItem) => {
      const pId = String(rawItem.productId || rawItem.id || "").trim();
      if (!pId) return;
      const qty = Math.max(1, Number(rawItem.qty ?? rawItem.quantity ?? 1) || 1);
      const col = rawItem.productCollection || defaultProductCollection;
      const source =
        rawItem.productSource === "independent" || rawItem.productSource === "shared"
          ? rawItem.productSource
          : "shared";
      const sMode =
        rawItem.stockMode === "independent" || rawItem.stockMode === "shared"
          ? rawItem.stockMode
          : source === "independent"
          ? "independent"
          : "shared";

      const prev = aggregatedItemsMap.get(pId);
      if (prev) {
        prev.qty += qty;
      } else {
        aggregatedItemsMap.set(pId, {
          productId: pId,
          productName: rawItem.productNameSnapshot || rawItem.name || rawItem.itemName || "Item",
          productCollection: col,
          productSource: source,
          stockMode: sMode,
          qty,
        });
      }
    });

    const stockReadPlans = [];
    for (const entry of aggregatedItemsMap.values()) {
      const termInvRef = doc(
        db,
        "users",
        shopId,
        "terminals",
        terminal.id,
        "inventory",
        entry.productId
      );
      const masterRef = doc(db, "users", shopId, entry.productCollection, entry.productId);
      const termInvSnap =
        entry.stockMode === "independent" ? await tx.get(termInvRef) : null;
      const masterSnap = await tx.get(masterRef);

      stockReadPlans.push({
        ...entry,
        termInvRef,
        masterRef,
        termInvSnap,
        masterSnap,
      });
    }

    // Validate stock & prepare stock writes before mutating anything
    const stockUpdates = [];
    const nowMs = Date.now();
    for (const plan of stockReadPlans) {
      // Prepared restaurant menu items are cooked on demand and always available;
      // their raw material stock is tracked separately by recipeStockService.
      if (plan.productCollection === "restaurant_menu") continue;

      const masterExists = plan.masterSnap?.exists();
      const termInvExists = plan.termInvSnap?.exists();

      let currentStock = null;
      if (plan.stockMode === "independent") {
        if (termInvExists && typeof plan.termInvSnap.data().stockQuantity === "number") {
          currentStock = Number(plan.termInvSnap.data().stockQuantity);
        } else if (masterExists && typeof plan.masterSnap.data().quantity === "number") {
          currentStock = Number(plan.masterSnap.data().quantity);
        }
      } else if (masterExists && typeof plan.masterSnap.data().quantity === "number") {
        currentStock = Number(plan.masterSnap.data().quantity);
      }

      if (currentStock !== null) {
        const nextStock = Number((currentStock - plan.qty).toFixed(4));
        if (!allowNegativeStock && nextStock < 0) {
          throw new Error(
            `Insufficient stock for "${plan.productName}" (Available: ${currentStock}, Requested: ${plan.qty}).`
          );
        }
        stockUpdates.push({
          ...plan,
          prevQty: currentStock,
          nextQty: nextStock,
          masterExists,
          termInvExists,
        });
      }
    }

    // 2. ALL FIRESTORE WRITES AFTER READS
    const enrichedSale = {
      ...saleRecord,
      id: finalSaleId,
      shopId,
      floorId: terminal.floorId,
      floorName: terminal.floorName || session.floorName || "Floor",
      terminalId: terminal.id,
      terminalName: terminal.name,
      terminalCode: terminal.code,
      sessionId: session.id,
      staffId: String(staffId || session.staffId || "OWNER"),
      staffName: String(staffName || session.staffName || "Owner"),
      transactionId: finalTxnId,
      transactionType: "sale",
      transactionStatus: "completed",
      paymentBucket,
      createdAtMs: nowMs,
      updatedAt: serverTimestamp(),
    };

    const txnDoc = {
      id: finalTxnId,
      idempotencyKey: finalTxnId,
      shopId,
      floorId: terminal.floorId,
      floorName: terminal.floorName || session.floorName || "Floor",
      terminalId: terminal.id,
      terminalName: terminal.name,
      terminalCode: terminal.code,
      sessionId: session.id,
      staffId: String(staffId || session.staffId || "OWNER"),
      staffName: String(staffName || session.staffName || "Owner"),
      type: "sale",
      status: "completed",
      billNo: saleRecord.billNo || finalSaleId,
      saleDocId: finalSaleId,
      paymentMethod,
      paymentBucket,
      amount: Number(amount.toFixed(2)),
      items: saleRecord.items || [],
      customerName: saleRecord.customerName || "Walk-in Customer",
      customerPhone: saleRecord.customerPhone || "N/A",
      notes: "",
      parentTransactionId: null,
      createdAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: serverTimestamp(),
    };

    const sessionIncrements = {
      totalSales: increment(amount),
      transactionCount: increment(1),
      updatedAt: serverTimestamp(),
    };
    if (paymentBucket === "cash") sessionIncrements.totalCashSales = increment(amount);
    else if (paymentBucket === "upi") sessionIncrements.totalUpiSales = increment(amount);
    else if (paymentBucket === "card") sessionIncrements.totalCardSales = increment(amount);
    else if (paymentBucket === "credit") sessionIncrements.totalCreditSales = increment(amount);

    tx.set(saleRef, enrichedSale);
    tx.set(txnRef, txnDoc);
    tx.update(sessionRef, sessionIncrements);
    tx.update(terminalRef, {
      lastActiveAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    stockUpdates.forEach((su) => {
      if (su.stockMode === "independent") {
        tx.set(
          su.termInvRef,
          {
            id: su.productId,
            productId: su.productId,
            shopId,
            terminalId: terminal.id,
            stockMode: "independent",
            stockQuantity: su.nextQty,
            updatedByStaffId: String(staffId || session.staffId || "OWNER"),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        if (su.productSource === "independent" && su.masterExists) {
          tx.update(su.masterRef, {
            quantity: su.nextQty,
            stockQuantity: su.nextQty,
            updatedAt: serverTimestamp(),
          });
        }
      } else if (su.masterExists) {
        tx.update(su.masterRef, {
          quantity: su.nextQty,
          stockQuantity: su.nextQty,
          updatedAt: serverTimestamp(),
        });
      }

      const moveRef = doc(
        db,
        "users",
        shopId,
        "stock_movements",
        `sale_${finalTxnId}_${su.productId}`
      );
      tx.set(moveRef, {
        id: `sale_${finalTxnId}_${su.productId}`,
        shopId,
        terminalId: terminal.id,
        productId: su.productId,
        productName: su.productName,
        productSource: su.productSource,
        stockMode: su.stockMode,
        previousQty: su.prevQty,
        changeQty: -su.qty,
        newQty: su.nextQty,
        reason: `POS Sale (${saleRecord.billNo || finalSaleId})`,
        referenceId: finalSaleId,
        staffId: String(staffId || session.staffId || "OWNER"),
        staffName: String(staffName || session.staffName || "Owner"),
        createdAt: serverTimestamp(),
        createdAtMs: nowMs,
      });
    });

    return {
      duplicate: false,
      saleDocId: finalSaleId,
      txnId: finalTxnId,
      saleRecord: enrichedSale,
      transaction: txnDoc,
    };
  });
}

export async function recordStandardSaleWithStock(
  db,
  {
    shopId,
    saleDocId,
    saleRecord,
    defaultProductCollection = "inventory",
    allowNegativeStock = false,
  }
) {
  if (!shopId || !saleDocId) {
    throw new Error("Missing shopId or saleDocId.");
  }

  const saleRef = doc(db, "users", shopId, "sales", String(saleDocId));
  const billItems = Array.isArray(saleRecord.items) ? saleRecord.items : [];

  return runTransaction(db, async (tx) => {
    const existingSale = await tx.get(saleRef);
    if (existingSale.exists()) {
      return { duplicate: true, saleDocId: String(saleDocId) };
    }

    const aggregated = new Map();
    billItems.forEach((rawItem) => {
      const pId = String(rawItem.productId || rawItem.id || "").trim();
      if (!pId) return;
      const qty = Math.max(1, Number(rawItem.qty ?? rawItem.quantity ?? 1) || 1);
      const col = rawItem.productCollection || defaultProductCollection;
      const prev = aggregated.get(pId);
      if (prev) prev.qty += qty;
      else {
        aggregated.set(pId, {
          productId: pId,
          productName: rawItem.productNameSnapshot || rawItem.name || rawItem.itemName || "Item",
          productCollection: col,
          productSource: rawItem.productSource || "shared",
          qty,
        });
      }
    });

    const reads = [];
    for (const entry of aggregated.values()) {
      const masterRef = doc(db, "users", shopId, entry.productCollection, entry.productId);
      const masterSnap = await tx.get(masterRef);
      reads.push({ ...entry, masterRef, masterSnap });
    }

    const stockUpdates = [];
    for (const plan of reads) {
      // Prepared restaurant menu items are cooked on demand and always available;
      // their raw material stock is tracked separately by recipeStockService.
      if (plan.productCollection === "restaurant_menu") continue;

      if (plan.masterSnap.exists() && typeof plan.masterSnap.data().quantity === "number") {
        const prevQty = Number(plan.masterSnap.data().quantity);
        const nextQty = Number((prevQty - plan.qty).toFixed(4));
        if (!allowNegativeStock && nextQty < 0) {
          throw new Error(
            `Insufficient stock for "${plan.productName}" (Available: ${prevQty}, Requested: ${plan.qty}).`
          );
        }
        stockUpdates.push({ ...plan, prevQty, nextQty });
      }
    }

    const nowMs = Date.now();
    tx.set(saleRef, { ...saleRecord, id: String(saleDocId), createdAtMs: nowMs });

    stockUpdates.forEach((su) => {
      tx.update(su.masterRef, {
        quantity: su.nextQty,
        stockQuantity: su.nextQty,
        updatedAt: serverTimestamp(),
      });
      const moveRef = doc(
        db,
        "users",
        shopId,
        "stock_movements",
        `sale_${saleDocId}_${su.productId}`
      );
      tx.set(moveRef, {
        id: `sale_${saleDocId}_${su.productId}`,
        shopId,
        terminalId: saleRecord.terminalId || "counter",
        productId: su.productId,
        productName: su.productName,
        productSource: su.productSource,
        stockMode: "shared",
        previousQty: su.prevQty,
        changeQty: -su.qty,
        newQty: su.nextQty,
        reason: `Counter Sale (${saleRecord.billNo || saleDocId})`,
        referenceId: String(saleDocId),
        staffId: saleRecord.staffId || "OWNER",
        staffName: saleRecord.staffName || "Owner",
        createdAt: serverTimestamp(),
        createdAtMs: nowMs,
      });
    });

    return { duplicate: false, saleDocId: String(saleDocId) };
  });
}

export async function recordRefundOrCancellation(
  db,
  {
    shopId,
    terminalId,
    originalTransaction,
    actionType = "refund", // "refund" | "cancellation"
    reason = "",
    staffId,
    staffName,
  }
) {
  if (!shopId || !terminalId || !originalTransaction?.id) {
    throw new Error("Missing original transaction details.");
  }
  if (originalTransaction.type !== "sale") {
    throw new Error("Only sale transactions can be refunded or cancelled.");
  }
  if (originalTransaction.status === "refunded" || originalTransaction.status === "cancelled") {
    throw new Error(`This transaction is already marked as ${originalTransaction.status}.`);
  }

  const normalizedType = actionType === "cancellation" ? "cancellation" : "refund";
  const nextStatus = normalizedType === "cancellation" ? "cancelled" : "refunded";
  const refundTxnId = `${normalizedType}_${originalTransaction.id}`;

  const origRef = doc(db, "users", shopId, "terminals", terminalId, "transactions", originalTransaction.id);
  const refundRef = doc(db, "users", shopId, "terminals", terminalId, "transactions", refundTxnId);
  const sessionRef = doc(
    db,
    "users",
    shopId,
    "terminals",
    terminalId,
    "sessions",
    originalTransaction.sessionId
  );

  return runTransaction(db, async (tx) => {
    // Firestore requires ALL reads (tx.get) before ANY writes (tx.set / tx.update)
    const origSnap = await tx.get(origRef);
    const existingAction = await tx.get(refundRef);

    if (!origSnap.exists()) {
      throw new Error("Original transaction not found.");
    }
    const orig = origSnap.data();
    if (orig.status === "refunded" || orig.status === "cancelled") {
      throw new Error(`Transaction already ${orig.status}.`);
    }

    if (existingAction.exists()) {
      throw new Error("A refund/cancellation record already exists for this transaction.");
    }

    const saleRef = orig.saleDocId ? doc(db, "users", shopId, "sales", orig.saleDocId) : null;
    const saleSnap = saleRef ? await tx.get(saleRef) : null;
    const sessSnap = orig.sessionId ? await tx.get(sessionRef) : null;

    const amt = Number(orig.amount || 0);
    const bucket = orig.paymentBucket || normalizePaymentBucket(orig.paymentMethod);
    const nowMs = Date.now();

    const actionDoc = {
      id: refundTxnId,
      idempotencyKey: refundTxnId,
      shopId,
      floorId: orig.floorId,
      floorName: orig.floorName || "Floor",
      terminalId,
      terminalName: orig.terminalName || "Terminal",
      terminalCode: orig.terminalCode || "—",
      sessionId: orig.sessionId,
      staffId: String(staffId || "OWNER"),
      staffName: String(staffName || "Owner"),
      type: normalizedType,
      status: nextStatus,
      billNo: orig.billNo || orig.id,
      saleDocId: orig.saleDocId || null,
      paymentMethod: orig.paymentMethod || "Cash",
      paymentBucket: bucket,
      amount: Number(amt.toFixed(2)),
      items: orig.items || [],
      customerName: orig.customerName || "Walk-in Customer",
      customerPhone: orig.customerPhone || "N/A",
      notes: String(reason || "").trim() || (normalizedType === "refund" ? "Customer Refund" : "Bill Cancelled"),
      parentTransactionId: orig.id,
      createdAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: serverTimestamp(),
    };

    tx.set(refundRef, actionDoc);
    tx.update(origRef, {
      status: nextStatus,
      refundReason: actionDoc.notes,
      refundedBy: String(staffName || "Owner"),
      refundedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    if (saleRef && saleSnap?.exists()) {
      tx.update(saleRef, {
        transactionStatus: nextStatus,
        refundReason: actionDoc.notes,
        refundedBy: String(staffName || "Owner"),
        updatedAt: serverTimestamp(),
      });
    }

    if (orig.sessionId && sessSnap?.exists()) {
      const sessUpdates = { updatedAt: serverTimestamp() };
      if (normalizedType === "refund") {
        sessUpdates.totalRefunds = increment(amt);
        if (bucket === "cash") {
          sessUpdates.totalCashRefunds = increment(amt);
        }
      } else {
        sessUpdates.totalCancellations = increment(amt);
        sessUpdates.totalSales = increment(-amt);
        sessUpdates.transactionCount = increment(-1);
        if (bucket === "cash") sessUpdates.totalCashSales = increment(-amt);
        else if (bucket === "upi") sessUpdates.totalUpiSales = increment(-amt);
        else if (bucket === "card") sessUpdates.totalCardSales = increment(-amt);
        else if (bucket === "credit") sessUpdates.totalCreditSales = increment(-amt);
      }
      tx.update(sessionRef, sessUpdates);
    }

    return actionDoc;
  });
}
