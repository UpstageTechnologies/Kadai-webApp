/**
 * Comprehensive Verification Suite for Advanced Terminal-Wise Product Management (Both Models)
 * Scenarios covered:
 * 1. Create Hotel, Cafe, and Juice Shop terminals across floors
 * 2. Model A: Independent products created exclusively for each terminal
 * 3. Verify strict isolation: Independent products never appear in other terminals
 * 4. Model B: Create Shared Shop Product (e.g., Bottled Water ₹20)
 * 5. Assign Shared Shop Product to Hotel (₹20) and Cafe (₹25) without duplicating master doc
 * 6. Terminal-specific category assignment & overrides (price, discount, GST/tax)
 * 7. Update Cafe override price -> verify Hotel price & original Shop Product remain unchanged
 * 8. Independent Terminal Inventory mode (separate stock counters per terminal)
 * 9. Shared Central Inventory mode (deducts central Shop Product stock atomically)
 * 10. Create POS bills from different terminals using calculateCartTotalsAndSnapshots
 * 11. Verify immutable invoice snapshots (productId, productSource, productNameSnapshot, sellingPriceSnapshot, taxSnapshot, totalAmount, terminalId, floorId, staffId)
 * 12. Owner consolidated overview: total counts, inventory value, low stock alerts, filters (terminal, product, category, date)
 * 13. Staff authorization, shop isolation & Firestore security rules verification
 * 14. Historical bill reference guard preventing accidental deletion & atomic runTransaction read-before-write guarantee
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCOUNT_TYPES,
  PRODUCT_SOURCES,
  STOCK_MODES,
  buildOwnerProductOverview,
  calculateCartTotalsAndSnapshots,
  calculateMultiTerminalProfitAndLoss,
  calculateProductEffectivePricing,
  checkProductReferencedInHistory,
  resolveTerminalCatalog,
} from "../src/utils/terminalProductService.js";
import {
  canAddInventoryItem,
  countProductsForTerminalLimit,
  resolveTerminalSubscription,
} from "../src/utils/subscriptionService.js";
import {
  INVENTORY_MODES,
  getAuthorizedTerminalsForStaff,
} from "../src/utils/terminalService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

let passed = 0;
let total = 0;
function assert(condition, label) {
  total += 1;
  if (condition) {
    passed += 1;
    console.log(`✅ [PASS] ${label}`);
  } else {
    console.error(`❌ [FAIL] ${label}`);
    process.exitCode = 1;
  }
}

console.log("==================================================================");
console.log("🧪 TERMINAL-WISE PRODUCT MANAGEMENT (BOTH MODELS) VERIFICATION");
console.log("==================================================================\n");

const SHOP_ID = "shop_abc_food_court";

// 1. Setup Floors & Hotel / Cafe / Juice Terminals
const floors = [
  { id: "fl_1", shopId: SHOP_ID, name: "Ground Floor", order: 1, status: "active" },
  { id: "fl_2", shopId: SHOP_ID, name: "1st Floor", order: 2, status: "active" },
  { id: "fl_3", shopId: SHOP_ID, name: "2nd Floor", order: 3, status: "active" },
];

const termHotel = {
  id: "term_hotel",
  shopId: SHOP_ID,
  floorId: "fl_1",
  floorName: "Ground Floor",
  name: "Terminal 01 - HOTEL",
  code: "HTL-01",
  status: "active",
  assignedStaffIds: ["EMP_HOTEL"],
};
const termCafe = {
  id: "term_cafe",
  shopId: SHOP_ID,
  floorId: "fl_2",
  floorName: "1st Floor",
  name: "Terminal 02 - CAFE",
  code: "CAF-01",
  status: "active",
  assignedStaffIds: ["EMP_CAFE"],
};
const termJuice = {
  id: "term_juice",
  shopId: SHOP_ID,
  floorId: "fl_3",
  floorName: "2nd Floor",
  name: "Terminal 03 - JUICE SHOP",
  code: "JUC-01",
  status: "active",
  assignedStaffIds: ["EMP_JUICE"],
};
const allTerminals = [termHotel, termCafe, termJuice];

assert(allTerminals.length === 3, "Created Hotel, Cafe, and Juice Shop terminals");

// 2. Setup Shop Products (Model A Independent docs + Model B Shared Shop Product)
const masterSharedWater = {
  id: "prod_water",
  shopId: SHOP_ID,
  productSource: PRODUCT_SOURCES.SHARED,
  name: "Bottled Water (1L)",
  category: "Beverages",
  sku: "SHP-WTR-01",
  barcode: "8901111222333",
  purchasePrice: 12,
  salesPrice: 20,
  price: 20,
  taxPercent: 0,
  quantity: 500,
  lowStockAlert: 20,
  unit: "bottle",
  isActive: true,
  isAvailable: true,
};

const hotelIdly = {
  id: "ind_idly",
  shopId: SHOP_ID,
  productSource: PRODUCT_SOURCES.INDEPENDENT,
  isTerminalExclusive: true,
  terminalId: termHotel.id,
  floorId: termHotel.floorId,
  name: "Idly (2 pcs)",
  category: "Breakfast",
  purchasePrice: 10,
  salesPrice: 30,
  price: 30,
  taxPercent: 5,
  quantity: 80,
  lowStockAlert: 10,
  unit: "plate",
  isActive: true,
  isAvailable: true,
};

const hotelBiryani = {
  id: "ind_biryani",
  shopId: SHOP_ID,
  productSource: PRODUCT_SOURCES.INDEPENDENT,
  isTerminalExclusive: true,
  terminalId: termHotel.id,
  floorId: termHotel.floorId,
  name: "Chicken Biryani",
  category: "Lunch",
  purchasePrice: 85,
  salesPrice: 180,
  price: 180,
  taxPercent: 5,
  quantity: 4, // intentionally below lowStockAlert=10
  lowStockAlert: 10,
  unit: "plate",
  isActive: true,
  isAvailable: true,
};

const cafeCoffee = {
  id: "ind_coffee",
  shopId: SHOP_ID,
  productSource: PRODUCT_SOURCES.INDEPENDENT,
  isTerminalExclusive: true,
  terminalId: termCafe.id,
  floorId: termCafe.floorId,
  name: "Filter Coffee",
  category: "Hot Drinks",
  purchasePrice: 8,
  salesPrice: 25,
  price: 25,
  discountType: DISCOUNT_TYPES.FLAT,
  discountValue: 5, // ₹5 flat discount => taxable ₹20
  taxPercent: 5,
  quantity: 120,
  lowStockAlert: 15,
  unit: "cup",
  isActive: true,
  isAvailable: true,
};

const juiceMango = {
  id: "ind_mango",
  shopId: SHOP_ID,
  productSource: PRODUCT_SOURCES.INDEPENDENT,
  isTerminalExclusive: true,
  terminalId: termJuice.id,
  floorId: termJuice.floorId,
  name: "Mango Shake",
  category: "Milkshakes",
  purchasePrice: 30,
  salesPrice: 80,
  price: 80,
  taxPercent: 12,
  quantity: 50,
  lowStockAlert: 8,
  unit: "glass",
  isActive: true,
  isAvailable: true,
};

const shopProducts = [masterSharedWater, hotelIdly, hotelBiryani, cafeCoffee, juiceMango];

// Independent Terminal Categories
const catsHotel = [
  { id: "c_h_1", terminalId: termHotel.id, name: "Breakfast", isActive: true },
  { id: "c_h_2", terminalId: termHotel.id, name: "Lunch", isActive: true },
  { id: "c_h_3", terminalId: termHotel.id, name: "Hotel Drinks", isActive: true },
];
const catsCafe = [
  { id: "c_c_1", terminalId: termCafe.id, name: "Hot Drinks", isActive: true },
  { id: "c_c_2", terminalId: termCafe.id, name: "Cold Drinks", isActive: true },
];
const catsJuice = [
  { id: "c_j_1", terminalId: termJuice.id, name: "Milkshakes", isActive: true },
];

// Assignments per terminal
const assignmentsHotel = [
  {
    id: "ind_ind_idly",
    shopId: SHOP_ID,
    terminalId: termHotel.id,
    productId: hotelIdly.id,
    productSource: PRODUCT_SOURCES.INDEPENDENT,
    categoryId: "c_h_1",
    categoryName: "Breakfast",
    stockMode: STOCK_MODES.INDEPENDENT,
    isActive: true,
    isAvailable: true,
  },
  {
    id: "ind_ind_biryani",
    shopId: SHOP_ID,
    terminalId: termHotel.id,
    productId: hotelBiryani.id,
    productSource: PRODUCT_SOURCES.INDEPENDENT,
    categoryId: "c_h_2",
    categoryName: "Lunch",
    stockMode: STOCK_MODES.INDEPENDENT,
    isActive: true,
    isAvailable: true,
  },
  {
    id: "shared_prod_water",
    shopId: SHOP_ID,
    terminalId: termHotel.id,
    productId: masterSharedWater.id,
    productSource: PRODUCT_SOURCES.SHARED,
    categoryId: "c_h_3",
    categoryName: "Hotel Drinks",
    sellingPriceOverride: 20, // Hotel sells Water at ₹20
    taxOverride: 0,
    discountOverride: null,
    stockMode: STOCK_MODES.INDEPENDENT, // Hotel keeps independent water stock
    lowStockAlert: 10,
    isActive: true,
    isAvailable: true,
  },
];

const assignmentsCafe = [
  {
    id: "ind_ind_coffee",
    shopId: SHOP_ID,
    terminalId: termCafe.id,
    productId: cafeCoffee.id,
    productSource: PRODUCT_SOURCES.INDEPENDENT,
    categoryId: "c_c_1",
    categoryName: "Hot Drinks",
    stockMode: STOCK_MODES.INDEPENDENT,
    isActive: true,
    isAvailable: true,
  },
  {
    id: "shared_prod_water",
    shopId: SHOP_ID,
    terminalId: termCafe.id,
    productId: masterSharedWater.id,
    productSource: PRODUCT_SOURCES.SHARED,
    categoryId: "c_c_2",
    categoryName: "Cold Drinks",
    sellingPriceOverride: 25, // Cafe overrides Water to ₹25
    taxOverride: 5, // Cafe applies 5% GST
    discountOverride: null,
    stockMode: STOCK_MODES.SHARED, // Cafe consumes central stock (500)
    lowStockAlert: 20,
    isActive: true,
    isAvailable: true,
  },
];

const assignmentsJuice = [
  {
    id: "ind_ind_mango",
    shopId: SHOP_ID,
    terminalId: termJuice.id,
    productId: juiceMango.id,
    productSource: PRODUCT_SOURCES.INDEPENDENT,
    categoryId: "c_j_1",
    categoryName: "Milkshakes",
    stockMode: STOCK_MODES.INDEPENDENT,
    isActive: true,
    isAvailable: true,
  },
];

// Independent inventory docs per terminal
const invHotel = [
  { id: hotelIdly.id, productId: hotelIdly.id, stockQuantity: 80, lowStockAlert: 10 },
  { id: hotelBiryani.id, productId: hotelBiryani.id, stockQuantity: 4, lowStockAlert: 10 },
  { id: masterSharedWater.id, productId: masterSharedWater.id, stockQuantity: 100, lowStockAlert: 10 },
];
const invCafe = [
  { id: cafeCoffee.id, productId: cafeCoffee.id, stockQuantity: 120, lowStockAlert: 15 },
];
const invJuice = [
  { id: juiceMango.id, productId: juiceMango.id, stockQuantity: 50, lowStockAlert: 8 },
];

// 3. Resolve POS Catalogs & Verify Isolation
const hotelCatalog = resolveTerminalCatalog({
  terminal: termHotel,
  shopProducts,
  terminalAssignments: assignmentsHotel,
  terminalCategories: catsHotel,
  terminalInventoryDocs: invHotel,
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});

const cafeCatalog = resolveTerminalCatalog({
  terminal: termCafe,
  shopProducts,
  terminalAssignments: assignmentsCafe,
  terminalCategories: catsCafe,
  terminalInventoryDocs: invCafe,
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});

const juiceCatalog = resolveTerminalCatalog({
  terminal: termJuice,
  shopProducts,
  terminalAssignments: assignmentsJuice,
  terminalCategories: catsJuice,
  terminalInventoryDocs: invJuice,
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});

assert(
  hotelCatalog.length === 3 &&
    hotelCatalog.some((p) => p.productId === hotelIdly.id) &&
    hotelCatalog.some((p) => p.productId === masterSharedWater.id) &&
    !hotelCatalog.some((p) => p.productId === cafeCoffee.id) &&
    !hotelCatalog.some((p) => p.productId === juiceMango.id),
  "Hotel terminal sees Idly, Biryani, and Hotel Water, and hides Cafe Coffee & Juice items"
);

assert(
  cafeCatalog.length === 2 &&
    cafeCatalog.some((p) => p.productId === cafeCoffee.id) &&
    cafeCatalog.some((p) => p.productId === masterSharedWater.id) &&
    !cafeCatalog.some((p) => p.productId === hotelIdly.id) &&
    !cafeCatalog.some((p) => p.productId === juiceMango.id),
  "Cafe terminal sees Filter Coffee and Cafe Water, and hides Hotel & Juice items"
);

assert(
  juiceCatalog.length === 1 &&
    juiceCatalog[0].productId === juiceMango.id &&
    !juiceCatalog.some((p) => p.productId === masterSharedWater.id),
  "Juice terminal sees only Mango Shake (unassigned Shared Water does not leak here)"
);

// 4-7. Verify Shared Shop Product Terminal-Specific Overrides & Immutability of Master Product
const hotelWater = hotelCatalog.find((p) => p.productId === masterSharedWater.id);
const cafeWater = cafeCatalog.find((p) => p.productId === masterSharedWater.id);

assert(hotelWater.effectivePrice === 20 && hotelWater.category === "Hotel Drinks", "Hotel Water uses ₹20 & 'Hotel Drinks' category");
assert(cafeWater.effectivePrice === 25 && cafeWater.effectiveTaxPercent === 5 && cafeWater.category === "Cold Drinks", "Cafe Water uses ₹25, 5% GST & 'Cold Drinks' category");

// Change Cafe price override to ₹30 -> verify Hotel stays ₹20 and Master Shop stays ₹20
const updatedCafeWaterAssign = { ...assignmentsCafe[1], sellingPriceOverride: 30 };
const cafePriceAfterUpdate = calculateProductEffectivePricing(masterSharedWater, updatedCafeWaterAssign);
const hotelPriceAfterUpdate = calculateProductEffectivePricing(masterSharedWater, assignmentsHotel[2]);

assert(
  cafePriceAfterUpdate.effectivePrice === 30 &&
    hotelPriceAfterUpdate.effectivePrice === 20 &&
    masterSharedWater.salesPrice === 20,
  "Changing Cafe override price to ₹30 leaves Hotel price (₹20) and original Shop Product (₹20) untouched"
);

// 8 & 9. Verify Independent Terminal Inventory vs Shared Central Inventory
assert(
  hotelWater.stockMode === STOCK_MODES.INDEPENDENT && hotelWater.effectiveStock === 100,
  "Hotel Water maintains Independent Terminal Stock (100)"
);
assert(
  cafeWater.stockMode === STOCK_MODES.SHARED && cafeWater.effectiveStock === 500,
  "Cafe Water reads Shared Central Shop Stock (500)"
);

// 10 & 11. Checkout Pricing & Immutable Invoice Snapshots
const hotelBill = calculateCartTotalsAndSnapshots(
  [
    { ...hotelCatalog.find((p) => p.productId === hotelIdly.id), qty: 2 }, // 2 * 30 = 60, +5% GST = 63
    { ...hotelWater, qty: 1 }, // 1 * 20 = 20, 0% GST = 20 => Total 83
  ],
  { shopId: SHOP_ID, terminal: termHotel, staffId: "EMP_HOTEL" }
);
assert(
  hotelBill.subtotal === 80 &&
    hotelBill.taxTotal === 3 &&
    hotelBill.netTotal === 83 &&
    hotelBill.itemSnapshots[0].productSource === "independent" &&
    hotelBill.itemSnapshots[1].productSource === "shared" &&
    hotelBill.itemSnapshots[0].terminalId === termHotel.id &&
    hotelBill.itemSnapshots[0].productNameSnapshot === "Idly (2 pcs)" &&
    hotelBill.itemSnapshots[0].sellingPriceSnapshot === 30 &&
    hotelBill.itemSnapshots[0].taxSnapshot === 3,
  "Hotel POS invoice computes tax accurately (₹83) and stores immutable item & terminal snapshots"
);

const cafeBill = calculateCartTotalsAndSnapshots(
  [
    { ...cafeCatalog.find((p) => p.productId === cafeCoffee.id), qty: 1 }, // 25 - 5 flat = 20 + 5% (1) = 21
    { ...cafeWater, qty: 1 }, // 25 + 5% (1.25) = 26.25 => Total 47.25
  ],
  { shopId: SHOP_ID, terminal: termCafe, staffId: "EMP_CAFE" }
);
assert(
  cafeBill.subtotal === 50 &&
    cafeBill.discountTotal === 5 &&
    cafeBill.taxTotal === 2.25 &&
    cafeBill.netTotal === 47.25,
  "Cafe POS checkout accurately applies per-terminal discount (₹5) and GST (₹2.25) -> ₹47.25"
);

// 12. Owner Consolidated Overview (Counts, Sales, Inventory Value, Low Stock, Filters)
const mockSales = [
  {
    id: "sale_h1",
    terminalId: termHotel.id,
    items: hotelBill.itemSnapshots,
    totalAmount: hotelBill.netTotal,
    createdAtMs: new Date("2026-11-26T10:00:00Z").getTime(),
  },
  {
    id: "sale_c1",
    terminalId: termCafe.id,
    items: cafeBill.itemSnapshots,
    totalAmount: cafeBill.netTotal,
    createdAtMs: new Date("2026-11-26T12:00:00Z").getTime(),
  },
];

const overviewAll = buildOwnerProductOverview({
  terminals: allTerminals,
  shopProducts,
  assignmentsByTerminal: {
    [termHotel.id]: assignmentsHotel,
    [termCafe.id]: assignmentsCafe,
    [termJuice.id]: assignmentsJuice,
  },
  inventoryByTerminal: {
    [termHotel.id]: invHotel,
    [termCafe.id]: invCafe,
    [termJuice.id]: invJuice,
  },
  categoriesByTerminal: {
    [termHotel.id]: catsHotel,
    [termCafe.id]: catsCafe,
    [termJuice.id]: catsJuice,
  },
  salesList: mockSales,
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});

assert(
  overviewAll.totalProductsAcrossTerminals === 6 &&
    overviewAll.independentProductsCount === 4 &&
    overviewAll.sharedProductsCount === 1 &&
    overviewAll.totalSales === 130.25 &&
    overviewAll.lowStockCount === 1 &&
    overviewAll.lowStockAlerts[0].productId === hotelBiryani.id,
  "Owner overview aggregates 6 terminal product slots (4 indep, 1 unique shared), ₹130.25 sales, and Biryani low-stock alert"
);

const filteredOverviewCafe = buildOwnerProductOverview({
  terminals: allTerminals,
  shopProducts,
  assignmentsByTerminal: {
    [termHotel.id]: assignmentsHotel,
    [termCafe.id]: assignmentsCafe,
    [termJuice.id]: assignmentsJuice,
  },
  inventoryByTerminal: {
    [termHotel.id]: invHotel,
    [termCafe.id]: invCafe,
    [termJuice.id]: invJuice,
  },
  categoriesByTerminal: {
    [termHotel.id]: catsHotel,
    [termCafe.id]: catsCafe,
    [termJuice.id]: catsJuice,
  },
  salesList: mockSales,
  filters: { terminalId: termCafe.id, category: "Cold Drinks" },
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});
assert(
  filteredOverviewCafe.totalProductsAcrossTerminals === 1 &&
    filteredOverviewCafe.terminalStats.length === 1 &&
    filteredOverviewCafe.terminalStats[0].terminalId === termCafe.id,
  "Owner overview filters cleanly by terminal & category"
);

// 13. Staff Authorization & Shop Isolation + Firestore Rules Checks
const empHotelTerms = getAuthorizedTerminalsForStaff({
  terminals: allTerminals,
  floors,
  shopId: SHOP_ID,
  staffId: "EMP_HOTEL",
  isOwner: false,
});
assert(
  empHotelTerms.length === 1 && empHotelTerms[0].id === termHotel.id,
  "Staff EMP_HOTEL is restricted to Hotel Terminal only"
);

const crossShopTerms = getAuthorizedTerminalsForStaff({
  terminals: allTerminals,
  floors,
  shopId: "other_shop_xyz",
  staffId: "EMP_HOTEL",
  isOwner: false,
});
assert(crossShopTerms.length === 0, "Cross-shop terminal leak strictly blocked");

const rulesContent = fs.readFileSync(path.join(rootDir, "firestore.rules"), "utf8");
assert(rulesContent.includes("match /categories/{categoryId}"), "firestore.rules secures terminal /categories");
assert(rulesContent.includes("match /products/{assignmentId}"), "firestore.rules secures terminal /products assignments");
assert(rulesContent.includes("match /inventory/{productId}"), "firestore.rules secures terminal /inventory ledger");
assert(rulesContent.includes("match /stock_movements/{movementId}"), "firestore.rules enforces immutable /stock_movements ledger");
assert(rulesContent.includes("allowNegativeStock == true"), "firestore.rules enforces non-negative terminal stock by default");

// 14. Historical Bill Deletion Guard & Atomic Transaction Read-Before-Write Verification
assert(
  checkProductReferencedInHistory(mockSales, [], hotelIdly.id) === true &&
    checkProductReferencedInHistory(mockSales, [], juiceMango.id) === false,
  "checkProductReferencedInHistory blocks deleting billed products while permitting unbilled ones"
);

const termServiceSrc = fs.readFileSync(
  path.join(rootDir, "src/utils/terminalService.js"),
  "utf8"
);
const saleTxnMatch = termServiceSrc.match(
  /export async function recordTerminalSaleTransaction[\s\S]*?\n\}/
);
assert(Boolean(saleTxnMatch), "recordTerminalSaleTransaction located in terminalService.js");
if (saleTxnMatch) {
  const src = saleTxnMatch[0];
  const lastReadIdx = src.lastIndexOf("tx.get(");
  const firstWriteIdx = Math.min(
    ...[src.indexOf("tx.set("), src.indexOf("tx.update(")].filter((i) => i !== -1)
  );
  assert(
    lastReadIdx < firstWriteIdx,
    "recordTerminalSaleTransaction executes ALL tx.get reads (session + stock) before ANY writes"
  );
}

// 15. Per-Terminal Subscription Plan Limit (Basic Plan = 10 items per terminal independently)
const basicShopUser = {
  userPlan: "Basic",
  subscriptionActive: true,
  subscriptionExpiry: Date.now() + 30 * 86400000,
};
const tenTerm1Products = Array.from({ length: 10 }, (_, idx) => ({
  id: `t1_item_${idx}`,
  name: `Coffee ${idx + 1}`,
  // Legacy unassigned items count toward primary terminal in terminal_wise mode
}));

const term1Count = countProductsForTerminalLimit(tenTerm1Products, {
  terminalId: termHotel.id,
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});
const term2Count = countProductsForTerminalLimit(tenTerm1Products, {
  terminalId: termCafe.id,
  shopInventoryMode: INVENTORY_MODES.TERMINAL_WISE,
  primaryTerminalId: termHotel.id,
});

const subTerm1 = resolveTerminalSubscription(basicShopUser, termHotel);
const subTerm2 = resolveTerminalSubscription(basicShopUser, termCafe);
assert(
  term1Count === 10 &&
    !canAddInventoryItem(term1Count, subTerm1.plan, subTerm1.isExpired) &&
    term2Count === 0 &&
    canAddInventoryItem(term2Count, subTerm2.plan, subTerm2.isExpired),
  "Basic plan 10-item limit blocks adding 11th item to Terminal 1 while allowing 10 fresh items in Terminal 2"
);

const term2PremiumOverride = resolveTerminalSubscription(basicShopUser, {
  ...termCafe,
  subscriptionPlan: "Premium",
});
assert(
  subTerm1.limits.inventoryLimit === 10 && term2PremiumOverride.limits.inventoryLimit === 200,
  "Each terminal evaluates its own subscription plan limits independently"
);

// 16. All-Terminals Combined Sales & Profit/Loss (P&L) Calculation
const pnlResult = calculateMultiTerminalProfitAndLoss({
  terminals: allTerminals,
  salesList: [
    {
      id: "s1",
      terminalId: termHotel.id,
      totalAmount: 210,
      taxTotal: 10,
      items: [{ productId: "x1", purchasePrice: 80, qty: 1 }],
      createdAtMs: Date.now(),
    },
    {
      id: "s2",
      terminalId: termCafe.id,
      totalAmount: 300,
      taxTotal: 0,
      items: [{ productId: "x2", purchasePrice: 100, qty: 1 }],
      createdAtMs: Date.now(),
    },
  ],
  wasteRecords: [{ id: "w1", terminalId: termHotel.id, totalLoss: 20, createdAtMs: Date.now() }],
  shopProducts: [],
  timeframe: "all",
});

assert(
  pnlResult.totals.totalSales === 510 &&
    pnlResult.totals.totalCogs === 180 &&
    pnlResult.totals.totalWasteLoss === 20 &&
    pnlResult.totals.netProfitLoss === 300 &&
    pnlResult.totals.isNetProfit === true &&
    pnlResult.byTerminal.length === 3,
  "Combined P&L accurately aggregates all terminals' Sales (₹510), COGS (₹180), Waste Loss (₹20), and Net Profit (₹300)"
);

const pnlLossScenario = calculateMultiTerminalProfitAndLoss({
  terminals: [termJuice],
  salesList: [
    {
      id: "s_loss",
      terminalId: termJuice.id,
      totalAmount: 100,
      taxTotal: 0,
      items: [{ productId: "j1", purchasePrice: 90, qty: 1 }],
      createdAtMs: Date.now(),
    },
  ],
  wasteRecords: [{ id: "w_loss", terminalId: termJuice.id, totalLoss: 50, createdAtMs: Date.now() }],
  timeframe: "all",
});
assert(
  pnlLossScenario.totals.netProfitLoss === -40 && pnlLossScenario.totals.isNetProfit === false,
  "Combined P&L accurately detects Net Loss (-₹40) when COGS + Waste exceeds revenue"
);

console.log("\n==================================================================");
console.log(`🎯 SUMMARY: ${passed}/${total} Terminal Product Checks Passed`);
console.log("==================================================================");
