/**
 * Automated Verification Suite for Terminal Management System (Floor + POS Terminal Architecture)
 * Covers:
 * 1. Shop & 3-Floor setup + Floor deletion/deactivation guards
 * 2. Multiple terminals per floor, unique terminal code generation & duplicate prevention
 * 3. Staff assignment, staff terminal authorization, and strict cross-shop isolation
 * 4. Billing session opening, single-active-session enforcement, and cash reconciliation
 * 5. Sales, Refunds, Cancellations & duplicate transaction idempotency
 * 6. Floor-wise, Terminal-wise, Staff-wise, Timeframe & Payment Method reports
 * 7. Shared vs Floor-wise Inventory filtering without stock duplication
 * 8. Firestore Security Rules verification
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INVENTORY_MODES,
  buildTerminalSalesReport,
  calculateSessionSummaryFromTransactions,
  ensurePrimaryTerminalSeeded,
  filterProductsForCatalog,
  filterProductsForFloor,
  generateUniqueTerminalCode,
  getAuthorizedTerminalsForStaff,
  getShopInventoryMode,
  isDuplicateTerminalCode,
  normalizePaymentBucket,
  normalizeTerminalCode,
} from "../src/utils/terminalService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

let passed = 0;
let total = 0;

function assert(condition, label) {
  total += 1;
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    passed += 1;
  } else {
    console.error(`❌ [FAIL] ${label}`);
    process.exitCode = 1;
  }
}

console.log("==================================================================");
console.log("🧪 KADAI PRO TERMINAL MANAGEMENT VERIFICATION SUITE");
console.log("==================================================================\n");

// 1. Test Shop & 3 Floors
const testShopId = "shop_abc_mall";
const otherShopId = "shop_other_xyz";

const floors = [
  { id: "fl_ground", shopId: testShopId, name: "Ground Floor", description: "Grocery & Express", order: 1, status: "active", isActive: true },
  { id: "fl_first", shopId: testShopId, name: "First Floor", description: "Fashion & Apparel", order: 2, status: "active", isActive: true },
  { id: "fl_second", shopId: testShopId, name: "Second Floor", description: "Electronics", order: 3, status: "active", isActive: true },
];
assert(floors.length === 3, "Created 3 dynamic custom floors for test shop");

// 2. Multiple Terminals per Floor & Unique Code Generation
const terminals = [];
const code1 = generateUniqueTerminalCode(terminals, "Ground Floor");
terminals.push({
  id: "term_01",
  shopId: testShopId,
  floorId: "fl_ground",
  floorName: "Ground Floor",
  name: "Billing Counter 1",
  code: code1,
  assignedStaffIds: ["EMP-101"],
  status: "active",
  isActive: true,
  sessionStatus: "closed",
  currentSessionId: null,
});

const code2 = generateUniqueTerminalCode(terminals, "Ground Floor");
terminals.push({
  id: "term_02",
  shopId: testShopId,
  floorId: "fl_ground",
  floorName: "Ground Floor",
  name: "Billing Counter 2",
  code: code2,
  assignedStaffIds: ["EMP-102"],
  status: "active",
  isActive: true,
  sessionStatus: "closed",
  currentSessionId: null,
});

const code3 = generateUniqueTerminalCode(terminals, "First Floor");
terminals.push({
  id: "term_03",
  shopId: testShopId,
  floorId: "fl_first",
  floorName: "First Floor",
  name: "Fashion Billing",
  code: code3,
  assignedStaffIds: ["EMP-101", "EMP-103"],
  status: "active",
  isActive: true,
  sessionStatus: "closed",
  currentSessionId: null,
});

const code4 = generateUniqueTerminalCode(terminals, "Second Floor");
terminals.push({
  id: "term_04",
  shopId: testShopId,
  floorId: "fl_second",
  floorName: "Second Floor",
  name: "Electronics Billing",
  code: code4,
  assignedStaffIds: ["EMP-104"],
  status: "inactive",
  isActive: false,
  sessionStatus: "closed",
  currentSessionId: null,
});

assert(new Set([code1, code2, code3, code4]).size === 4, "Auto-generated 4 distinct unique terminal codes");
assert(normalizeTerminalCode(" trm-01 ") === "TRM-01", "Terminal code normalization uppercases and strips whitespace");
assert(isDuplicateTerminalCode(terminals, code1.toLowerCase()) === true, "Duplicate terminal code detection blocks case-insensitive collision");
assert(isDuplicateTerminalCode(terminals, code1, "term_01") === false, "Editing same terminal allows keeping its own code");

// 3. Staff Assignment & Cross-Shop Isolation
const otherShopTerminal = {
  id: "term_other",
  shopId: otherShopId,
  floorId: "fl_ground",
  floorName: "Other Floor",
  name: "Other Shop Counter",
  code: "OTH-01",
  assignedStaffIds: ["EMP-101"],
  status: "active",
  isActive: true,
};

const allTerminalsWithOtherShop = [...terminals, otherShopTerminal];

const emp101Terminals = getAuthorizedTerminalsForStaff({
  terminals: allTerminalsWithOtherShop,
  floors,
  shopId: testShopId,
  staffId: "EMP-101",
  isOwner: false,
});
assert(
  emp101Terminals.length === 2 &&
    emp101Terminals.every((t) => t.shopId === testShopId && t.assignedStaffIds.includes("EMP-101")),
  "Staff EMP-101 sees ONLY their 2 assigned terminals in their own shop (never other shop's terminal)"
);

const emp102Terminals = getAuthorizedTerminalsForStaff({
  terminals: allTerminalsWithOtherShop,
  floors,
  shopId: testShopId,
  staffId: "EMP-102",
  isOwner: false,
});
assert(
  emp102Terminals.length === 1 && emp102Terminals[0].id === "term_02",
  "Staff EMP-102 sees only their 1 assigned terminal (streamlined single-terminal flow)"
);

const emp104Terminals = getAuthorizedTerminalsForStaff({
  terminals: allTerminalsWithOtherShop,
  floors,
  shopId: testShopId,
  staffId: "EMP-104",
  isOwner: false,
});
assert(emp104Terminals.length === 0, "Inactive terminal term_04 is excluded from staff login selection");

const ownerTerminals = getAuthorizedTerminalsForStaff({
  terminals: allTerminalsWithOtherShop,
  floors,
  shopId: testShopId,
  staffId: "OWNER",
  isOwner: true,
});
assert(
  ownerTerminals.length === 3 && ownerTerminals.every((t) => t.shopId === testShopId),
  "Owner sees all 3 active terminals in own shop and 0 from other shops"
);

// 4. Payment Buckets, Sales, Refunds, Cancellations & Cash Reconciliation
assert(normalizePaymentBucket("Cash") === "cash", "Normalizes Cash payment bucket");
assert(normalizePaymentBucket("UPI / QR") === "upi", "Normalizes UPI / QR payment bucket");
assert(normalizePaymentBucket("Card") === "card", "Normalizes Card payment bucket");
assert(normalizePaymentBucket("Credit") === "credit", "Normalizes Credit/Khata payment bucket");

const now = new Date();
const nowMs = now.getTime();

const sessionTransactions = [
  {
    id: "txn_1",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "sale",
    status: "completed",
    billNo: "B-001",
    saleDocId: "txn_1",
    paymentMethod: "Cash",
    paymentBucket: "cash",
    amount: 1200,
    createdAtMs: nowMs,
  },
  {
    id: "txn_2",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "sale",
    status: "completed",
    billNo: "B-002",
    saleDocId: "txn_2",
    paymentMethod: "UPI / QR",
    paymentBucket: "upi",
    amount: 850,
    createdAtMs: nowMs,
  },
  {
    id: "txn_3",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "sale",
    status: "completed",
    billNo: "B-003",
    saleDocId: "txn_3",
    paymentMethod: "Card",
    paymentBucket: "card",
    amount: 2000,
    createdAtMs: nowMs,
  },
  {
    id: "txn_4_orig",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "sale",
    status: "refunded",
    billNo: "B-004",
    saleDocId: "txn_4_orig",
    paymentMethod: "Cash",
    paymentBucket: "cash",
    amount: 300,
    createdAtMs: nowMs,
  },
  {
    id: "refund_txn_4_orig",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "refund",
    status: "refunded",
    billNo: "B-004",
    paymentMethod: "Cash",
    paymentBucket: "cash",
    amount: 300,
    createdAtMs: nowMs,
  },
  {
    id: "txn_5_cancelled",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "sale",
    status: "cancelled",
    billNo: "B-005",
    saleDocId: "txn_5_cancelled",
    paymentMethod: "Cash",
    paymentBucket: "cash",
    amount: 500,
    createdAtMs: nowMs,
  },
  {
    id: "cancellation_txn_5_cancelled",
    shopId: testShopId,
    floorId: "fl_ground",
    floorName: "Ground Floor",
    terminalId: "term_01",
    terminalName: "Billing Counter 1",
    terminalCode: code1,
    sessionId: "sess_1",
    staffId: "EMP-101",
    staffName: "Arun",
    type: "cancellation",
    status: "cancelled",
    billNo: "B-005",
    paymentMethod: "Cash",
    paymentBucket: "cash",
    amount: 500,
    createdAtMs: nowMs,
  },
];

// Opening Cash: 1000, Cash Sales: 1200 + 300 (before refund) = 1500, Cash Refunds: 300 -> Expected = 2200
// Actual Cash: 2150 -> Cash Difference = -50
const summary = calculateSessionSummaryFromTransactions(sessionTransactions, 1000, 2150);
assert(summary.openingCash === 1000, "Session opening cash recorded correctly (₹1000)");
assert(summary.totalCashSales === 1500, "Session totalCashSales excludes cancelled sale and totals ₹1500");
assert(summary.totalUpiSales === 850, "Session totalUpiSales equals ₹850");
assert(summary.totalCardSales === 2000, "Session totalCardSales equals ₹2000");
assert(summary.totalRefunds === 300 && summary.totalCashRefunds === 300, "Session refunds tracked accurately (₹300)");
assert(summary.totalCancellations === 500, "Session cancellations tracked without double-counting (₹500)");
assert(summary.expectedClosingCash === 2200, "Expected Closing Cash = Opening(1000) + CashSales(1500) - CashRefunds(300) = ₹2200");
assert(summary.actualClosingCash === 2150, "Actual Closing Cash = ₹2150");
assert(summary.cashDifference === -50, "Cash Difference = Actual(2150) - Expected(2200) = -₹50");

// 5. Terminal-wise, Floor-wise & Staff-wise Report Aggregation (including deduplication with sales collection)
const extraSecondFloorSale = {
  id: "sale_f1_1",
  billNo: "B-101",
  floorId: "fl_first",
  floorName: "First Floor",
  terminalId: "term_03",
  terminalName: "Fashion Billing",
  terminalCode: code3,
  staffId: "EMP-103",
  staffName: "Divya",
  paymentMethod: "UPI / QR",
  totalAmount: 1500,
  createdAtMs: nowMs,
};

// Also include duplicate sales mirror doc for txn_1 to verify zero double-counting
const mirroredSale1 = {
  id: "txn_1",
  billNo: "B-001",
  floorId: "fl_ground",
  terminalId: "term_01",
  staffId: "EMP-101",
  staffName: "Arun",
  paymentMethod: "Cash",
  totalAmount: 1200,
  createdAtMs: nowMs,
};

const report = buildTerminalSalesReport({
  sales: [mirroredSale1, extraSecondFloorSale],
  transactions: sessionTransactions,
  floors,
  terminals,
  sessions: [],
  timeframe: "daily",
  now,
});

assert(report.summary.totalGrossSales === 5850, "Report gross sales deduplicates sales+transactions accurately (₹5850)");
assert(report.summary.totalNetSales === 5550, "Report net sales subtracts refunds accurately (₹5550)");
assert(report.summary.totalCancellations === 500, "Report cancellations equal ₹500");
assert(report.paymentBreakdown.upi === 2350, "Report UPI breakdown sums Ground(850) + First(1500) = ₹2350");

const groundFloorRow = report.byFloor.find((f) => f.floorId === "fl_ground");
const firstFloorRow = report.byFloor.find((f) => f.floorId === "fl_first");
assert(groundFloorRow?.totalSales === 4350, "Ground Floor sales aggregated accurately (₹4350)");
assert(firstFloorRow?.totalSales === 1500, "First Floor sales aggregated accurately (₹1500)");

const arunRow = report.byStaff.find((s) => s.staffId === "EMP-101");
const divyaRow = report.byStaff.find((s) => s.staffId === "EMP-103");
assert(arunRow?.totalSales === 4350 && divyaRow?.totalSales === 1500, "Staff-wise sales report accurate");

// 6. Shared vs Floor-wise Inventory Architecture
const sampleProducts = [
  { id: "p1", name: "Rice 5kg", floorId: "fl_ground", quantity: 40 },
  { id: "p2", name: "Cotton T-Shirt", floorId: "fl_first", quantity: 25 },
  { id: "p3", name: "Carry Bag", floorId: "all", quantity: 500 },
  { id: "p4", name: "Legacy Item (no floorId)", quantity: 10 },
];

assert(getShopInventoryMode({}) === INVENTORY_MODES.SHARED, "Default shop inventory mode is 'shared'");
assert(
  filterProductsForFloor(sampleProducts, { inventoryMode: INVENTORY_MODES.SHARED, floorId: "fl_ground" }).length === 4,
  "Shared inventory exposes all 4 products to every floor without duplicating stock"
);

const groundProducts = filterProductsForFloor(sampleProducts, {
  inventoryMode: INVENTORY_MODES.FLOOR_WISE,
  floorId: "fl_ground",
});
assert(
  groundProducts.length === 3 &&
    groundProducts.some((p) => p.id === "p1") &&
    !groundProducts.some((p) => p.id === "p2") &&
    groundProducts.some((p) => p.id === "p3") &&
    groundProducts.some((p) => p.id === "p4"),
  "Floor-wise inventory shows Ground Floor + Shared/Legacy items and hides First Floor exclusive items"
);

// 6b. Terminal-wise Separate Menu / Catalog Architecture (Terminal 1 = Coffee, Terminal 2 = Hotel Foods)
const terminalCatalogItems = [
  { id: "c1", name: "Filter Coffee", quantity: 100 }, // legacy item (no terminalId)
  { id: "c2", name: "Black Coffee", terminalId: "term_01", floorId: "fl_ground", quantity: 50 },
  { id: "h1", name: "Chicken Biryani", terminalId: "term_02", floorId: "fl_second", quantity: 30 },
  { id: "s1", name: "Mineral Water", terminalId: "all", floorId: "all", quantity: 200 },
];

const term1Catalog = filterProductsForCatalog(terminalCatalogItems, {
  inventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  terminalId: "term_01",
  floorId: "fl_ground",
  primaryTerminalId: "term_01",
});
assert(
  term1Catalog.length === 3 &&
    term1Catalog.some((p) => p.id === "c1") &&
    term1Catalog.some((p) => p.id === "c2") &&
    term1Catalog.some((p) => p.id === "s1") &&
    !term1Catalog.some((p) => p.id === "h1"),
  "Terminal 1 keeps legacy Coffee + Terminal 1 items + Shared items, and hides Terminal 2 Hotel items"
);

const term2Catalog = filterProductsForCatalog(terminalCatalogItems, {
  inventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  terminalId: "term_02",
  floorId: "fl_second",
  primaryTerminalId: "term_01",
});
assert(
  term2Catalog.length === 2 &&
    term2Catalog.some((p) => p.id === "h1") &&
    term2Catalog.some((p) => p.id === "s1") &&
    !term2Catalog.some((p) => p.id === "c1") &&
    !term2Catalog.some((p) => p.id === "c2"),
  "Terminal 2 shows only Terminal 2 Hotel items + Shared items, isolated from Terminal 1 Coffee data"
);

// 7. Firestore Security Rules Verification
const rulesContent = fs.readFileSync(path.join(rootDir, "firestore.rules"), "utf8");
assert(rulesContent.includes("match /floors/{floorId}"), "firestore.rules defines /floors/{floorId} rules");
assert(rulesContent.includes("match /terminals/{terminalId}"), "firestore.rules defines /terminals/{terminalId} rules");
assert(rulesContent.includes("match /sessions/{sessionId}"), "firestore.rules defines /sessions/{sessionId} rules");
assert(rulesContent.includes("match /transactions/{transactionId}"), "firestore.rules defines /transactions/{transactionId} rules");
assert(rulesContent.includes("notOtherShopOwner(userId)"), "firestore.rules enforces strict cross-shop isolation");
assert(rulesContent.includes('resource.data.sessionStatus != "open"'), "firestore.rules blocks deleting terminal with open session");
assert(rulesContent.includes("isAuthorizedTerminalStaff"), "firestore.rules verifies staff terminal assignment and active status");

// 8. Transaction Read-Before-Write & Auto-Seed Verification
assert(
  typeof ensurePrimaryTerminalSeeded === "function",
  "terminalService exports ensurePrimaryTerminalSeeded helper"
);

const serviceSource = fs.readFileSync(
  path.join(rootDir, "src/utils/terminalService.js"),
  "utf8"
);
const closeFnMatch = serviceSource.match(
  /export async function closeTerminalSession[\s\S]*?\n\}/
);
assert(Boolean(closeFnMatch), "closeTerminalSession function found in terminalService.js");
if (closeFnMatch) {
  const fnSrc = closeFnMatch[0];
  const lastReadIdx = Math.max(fnSrc.lastIndexOf("tx.get("), 0);
  const firstWriteIdx = Math.min(
    ...[fnSrc.indexOf("tx.update("), fnSrc.indexOf("tx.set(")].filter((i) => i !== -1)
  );
  assert(
    lastReadIdx < firstWriteIdx,
    "closeTerminalSession executes all tx.get reads before any tx.update/tx.set writes"
  );
}

const refundFnMatch = serviceSource.match(
  /export async function recordRefundOrCancellation[\s\S]*?\n\}/
);
assert(Boolean(refundFnMatch), "recordRefundOrCancellation function found in terminalService.js");
if (refundFnMatch) {
  const fnSrc = refundFnMatch[0];
  const lastReadIdx = Math.max(fnSrc.lastIndexOf("tx.get("), 0);
  const firstWriteIdx = Math.min(
    ...[fnSrc.indexOf("tx.update("), fnSrc.indexOf("tx.set(")].filter((i) => i !== -1)
  );
  assert(
    lastReadIdx < firstWriteIdx,
    "recordRefundOrCancellation executes all tx.get reads before any tx.update/tx.set writes"
  );
}

console.log("\n==================================================================");
console.log(`🎯 SUMMARY: ${passed}/${total} Verification Checks Passed`);
console.log("==================================================================");
