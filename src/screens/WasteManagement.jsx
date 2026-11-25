import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import {
  WASTE_REASONS,
  calculateWasteStats,
  calculateProfitAndLossStats,
  logWasteRecord,
  logManualProfitSale,
  matchesTimeframe,
  subscribeWasteRecords,
  subscribeSalesRecords,
} from "../utils/wasteService";

const formatINR = (value) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function WasteManagement({
  userProfile = {},
  isRestaurant: propIsRestaurant,
  isGlobalMode: propIsGlobalMode,
  activeBranchId,
  activeBranchName,
}) {
  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

  // Shop & Business Mode
  const [shopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant =
    propIsRestaurant !== undefined
      ? propIsRestaurant
      : (shopType || "").trim().toLowerCase() === "restaurant";
  const [appMode] = useState(() => localStorage.getItem("app_mode") || "local");
  const isGlobalMode = propIsGlobalMode !== undefined ? propIsGlobalMode : appMode === "global";

  // Data States
  const [wasteRecords, setWasteRecords] = useState([]);
  const [salesRecords, setSalesRecords] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(currentUid));
  const [salesLoading, setSalesLoading] = useState(() => Boolean(currentUid));
  const [products, setProducts] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [recipes, setRecipes] = useState([]);

  // Filter & View States
  const [timeFilter, setTimeFilter] = useState("all"); // "today" | "yesterday" | "week" | "month" | "all"
  const [reasonFilter, setReasonFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeLedgerTab, setActiveLedgerTab] = useState("daily"); // "daily" | "sales" | "waste"

  // Waste Modal States
  const [showLogModal, setShowLogModal] = useState(false);
  const [savingWaste, setSavingWaste] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Profit Modal States
  const [showProfitModal, setShowProfitModal] = useState(false);
  const [savingProfit, setSavingProfit] = useState(false);
  const [profitError, setProfitError] = useState("");
  const [profitSelectedProductId, setProfitSelectedProductId] = useState("custom");
  const [profitItemName, setProfitItemName] = useState("");
  const [profitQty, setProfitQty] = useState("1");
  const [profitSellPrice, setProfitSellPrice] = useState("");
  const [profitCostPrice, setProfitCostPrice] = useState("");
  const [profitCustomer, setProfitCustomer] = useState("");
  const [profitPaymentMode, setProfitPaymentMode] = useState("CASH");
  const [profitNotes, setProfitNotes] = useState("");

  // Log Waste Form States
  const [selectedItemSource, setSelectedItemSource] = useState(isRestaurant ? "raw_materials" : "products");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [wastedQty, setWastedQty] = useState("");
  const [selectedReason, setSelectedReason] = useState(WASTE_REASONS[0].label);
  const [wasteNotes, setWasteNotes] = useState("");
  const [reportedByName, setReportedByName] = useState(() => localStorage.getItem("staff_name") || userProfile.name || "Owner");

  // 1. Subscribe to Waste & Sales Records
  useEffect(() => {
    if (!currentUid) return;

    const unsubscribeWaste = subscribeWasteRecords(
      db,
      currentUid,
      (records) => {
        setWasteRecords(records);
        setLoading(false);
      },
      (err) => {
        console.error("Waste sync error:", err);
        setLoading(false);
      }
    );

    const unsubscribeSales = subscribeSalesRecords(
      db,
      currentUid,
      (sales) => {
        setSalesRecords(sales);
        setSalesLoading(false);
      },
      (err) => {
        console.error("Sales sync error:", err);
        setSalesLoading(false);
      }
    );

    return () => {
      unsubscribeWaste();
      unsubscribeSales();
    };
  }, [currentUid]);

  // 2. Fetch inventory products, recipes & raw materials for cost/profit & waste selection
  useEffect(() => {
    if (!currentUid) return;

    const inventoryCol = isRestaurant
      ? "restaurant_menu"
      : isGlobalMode
      ? "global_inventory"
      : "inventory";

    const unsubProducts = onSnapshot(collection(db, "users", currentUid, inventoryCol), (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data();
        const sellingPrice = Number(data.price ?? data.salesPrice ?? 0);
        const trueCost = Number(data.makingCost ?? data.purchasePrice ?? data.costPrice ?? 0);
        const wasteCost = trueCost > 0 ? trueCost : sellingPrice;
        return {
          id: d.id,
          name: data.itemName || data.name || "Unnamed Item",
          category: data.category || (isRestaurant ? "Main Course" : "General"),
          quantity: Number(data.quantity || 0),
          sellingPrice,
          costPrice: trueCost,
          purchasePrice: wasteCost,
          unitType: data.unitType || data.unit || "Qty",
          image: data.image || data.imageUrl || "",
          type: "product",
        };
      });
      setProducts(items);
    });

    const unsubRecipes = onSnapshot(collection(db, "users", currentUid, "recipes"), (snap) => {
      const recipeList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRecipes(recipeList);
    });

    // If restaurant, also fetch raw materials
    let unsubRaw = () => {};
    if (isRestaurant) {
      unsubRaw = onSnapshot(collection(db, "users", currentUid, "raw_materials"), (snap) => {
        const rawItems = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || "Unnamed Material",
            category: data.category || "Kitchen Ingredient",
            quantity: Number(data.stockQuantity || 0),
            purchasePrice: Number(data.costPerUnit || 0),
            unitType: data.unit || "kg",
            image: "",
            type: "raw_material",
          };
        });
        setRawMaterials(rawItems);
      });
    }

    return () => {
      unsubProducts();
      unsubRecipes();
      unsubRaw();
    };
  }, [currentUid, isRestaurant, isGlobalMode]);

  // Lookup maps for accurate COGS / Profit resolution
  const productCostMap = useMemo(() => {
    const map = {};
    for (const p of products) {
      if (p.costPrice > 0) {
        map[p.id] = p.costPrice;
        map[p.name.toLowerCase()] = p.costPrice;
      }
    }
    return map;
  }, [products]);

  const recipeCostMap = useMemo(() => {
    const map = {};
    for (const r of recipes) {
      const cost = Number(r.totalMakingCost || 0);
      if (cost > 0) {
        if (r.productId) map[String(r.productId)] = cost;
        if (r.id) map[String(r.id)] = cost;
        if (r.productName) map[String(r.productName).toLowerCase()] = cost;
      }
    }
    return map;
  }, [recipes]);

  // Filter sales to current business mode (matching Dashboard logic)
  const modeFilteredSales = useMemo(() => {
    return salesRecords.filter((o) => {
      if (isRestaurant) return true;
      const isOrdGlobal = o.isGlobalMode === true || o.appMode === "global";
      return isGlobalMode ? isOrdGlobal : !isOrdGlobal;
    });
  }, [salesRecords, isRestaurant, isGlobalMode]);

  // Selected item object for live waste form preview
  const currentSelectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    const pool = selectedItemSource === "raw_materials" ? rawMaterials : products;
    return pool.find((i) => i.id === selectedItemId) || null;
  }, [selectedItemId, selectedItemSource, products, rawMaterials]);

  // Live calculated loss in waste modal
  const modalCalculatedLoss = useMemo(() => {
    if (!currentSelectedItem || !wastedQty) return 0;
    const qty = Number(wastedQty);
    if (isNaN(qty) || qty <= 0) return 0;
    const cost = Number(currentSelectedItem.purchasePrice) || 0;
    return Math.round(cost * qty * 100) / 100;
  }, [currentSelectedItem, wastedQty]);

  // Live calculated profit in profit modal
  const modalProfitPreview = useMemo(() => {
    const qty = Number(profitQty) || 0;
    const sell = Number(profitSellPrice) || 0;
    const cost = Number(profitCostPrice) || 0;
    if (qty <= 0 || sell <= 0) {
      return { revenue: 0, cost: 0, profit: 0, marginPct: 0 };
    }
    const revenue = Math.round(sell * qty * 100) / 100;
    const totalCost = Math.round(cost * qty * 100) / 100;
    const profit = Math.round((revenue - totalCost) * 100) / 100;
    const marginPct = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
    return { revenue, cost: totalCost, profit, marginPct };
  }, [profitQty, profitSellPrice, profitCostPrice]);

  // Overall Waste statistics
  const stats = useMemo(() => {
    return calculateWasteStats(wasteRecords);
  }, [wasteRecords]);

  // Combined Profit, Revenue, COGS & Waste Loss statistics
  const pnlStats = useMemo(() => {
    return calculateProfitAndLossStats({
      sales: modeFilteredSales,
      wasteRecords,
      productCostMap,
      recipeCostMap,
      timeFilter,
      searchQuery,
    });
  }, [modeFilteredSales, wasteRecords, productCostMap, recipeCostMap, timeFilter, searchQuery]);

  // Filtered waste records
  const filteredRecords = useMemo(() => {
    const now = new Date();
    return wasteRecords.filter((rec) => {
      const d = rec.parsedDate || new Date();
      if (!matchesTimeframe(d, timeFilter, now)) return false;
      if (reasonFilter !== "all" && rec.reason !== reasonFilter) return false;
      if (typeFilter !== "all" && rec.itemType !== typeFilter) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const name = (rec.productName || rec.itemName || "").toLowerCase();
        const cat = (rec.category || "").toLowerCase();
        const reason = (rec.reason || "").toLowerCase();
        const notes = (rec.notes || "").toLowerCase();
        if (
          !name.includes(query) &&
          !cat.includes(query) &&
          !reason.includes(query) &&
          !notes.includes(query)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [wasteRecords, timeFilter, reasonFilter, typeFilter, searchQuery]);

  // Filtered summary for current view
  const currentViewLoss = useMemo(() => {
    return filteredRecords.reduce((sum, r) => sum + (Number(r.totalLoss) || 0), 0);
  }, [filteredRecords]);

  // Handle selecting a product inside the Log Profit modal
  const handleSelectProfitProduct = (prodId) => {
    setProfitSelectedProductId(prodId);
    if (prodId === "custom") {
      setProfitItemName("");
      setProfitSellPrice("");
      setProfitCostPrice("");
      return;
    }
    const found = products.find((p) => p.id === prodId);
    if (found) {
      const recipeCost = recipeCostMap[found.id] || recipeCostMap[found.name.toLowerCase()] || 0;
      const resolvedCost = found.costPrice > 0 ? found.costPrice : recipeCost;
      setProfitItemName(found.name);
      setProfitSellPrice(found.sellingPrice > 0 ? String(found.sellingPrice) : "");
      setProfitCostPrice(resolvedCost > 0 ? String(resolvedCost) : "0");
    }
  };

  // Handle Manual Profit / Sale Submission
  const handleLogProfitSubmit = async (e) => {
    e.preventDefault();
    setProfitError("");

    const qty = Number(profitQty);
    const sell = Number(profitSellPrice);
    const cost = profitCostPrice === "" ? 0 : Number(profitCostPrice);

    if (!profitItemName.trim()) {
      setProfitError("Please enter an item or sale description.");
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      setProfitError("Please enter a valid quantity greater than zero.");
      return;
    }
    if (isNaN(sell) || sell <= 0) {
      setProfitError("Please enter a valid selling price greater than zero.");
      return;
    }
    if (isNaN(cost) || cost < 0) {
      setProfitError("Cost price cannot be negative.");
      return;
    }

    setSavingProfit(true);
    try {
      const res = await logManualProfitSale({
        db,
        uid: currentUid,
        itemId: profitSelectedProductId !== "custom" ? profitSelectedProductId : "",
        itemName: profitItemName,
        quantity: qty,
        sellingPrice: sell,
        costPrice: cost,
        customerName: profitCustomer,
        paymentMode: profitPaymentMode,
        notes: profitNotes,
        isRestaurant,
        appMode,
        branchId: activeBranchId || "main_branch",
        branchName: activeBranchName || "Main Branch",
      });

      setSavingProfit(false);
      setShowProfitModal(false);
      setProfitSelectedProductId("custom");
      setProfitItemName("");
      setProfitQty("1");
      setProfitSellPrice("");
      setProfitCostPrice("");
      setProfitCustomer("");
      setProfitNotes("");
      setSuccessToast(
        `Recorded sale ₹${formatINR(res.totalRevenue)} (Profit: +₹${formatINR(res.totalProfit)})!`
      );
      setTimeout(() => setSuccessToast(""), 4000);
    } catch (err) {
      console.error("Error logging profit sale:", err);
      setProfitError(err.message || "Failed to log profit entry.");
      setSavingProfit(false);
    }
  };

  // Handle Log Waste Submission
  const handleLogWasteSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!selectedItemId) {
      setErrorMessage("Please select a product or raw material.");
      return;
    }

    const qty = Number(wastedQty);
    if (isNaN(qty) || qty <= 0) {
      setErrorMessage("Please enter a valid wasted quantity greater than zero.");
      return;
    }

    if (currentSelectedItem && qty > (currentSelectedItem.quantity || 0)) {
      setErrorMessage(
        `Wasted quantity (${qty}) exceeds available stock (${currentSelectedItem.quantity} ${currentSelectedItem.unitType}).`
      );
      return;
    }

    setSavingWaste(true);
    try {
      const itemType =
        selectedItemSource === "raw_materials"
          ? "restaurant_raw_material"
          : isRestaurant
          ? "restaurant_food_item"
          : "shop_product";

      await logWasteRecord({
        db,
        uid: currentUid,
        itemId: selectedItemId,
        itemType,
        wastedQty: qty,
        reason: selectedReason,
        notes: wasteNotes,
        reportedBy: reportedByName,
        shopMode: appMode,
        unitCost: currentSelectedItem?.purchasePrice || 0,
        unitType: currentSelectedItem?.unitType || "Qty",
        productName: currentSelectedItem?.name || "Unnamed Item",
        category: currentSelectedItem?.category || "General",
        image: currentSelectedItem?.image || "",
      });

      setSavingWaste(false);
      setShowLogModal(false);
      setSelectedItemId("");
      setWastedQty("");
      setWasteNotes("");
      setSuccessToast(`Logged ₹${modalCalculatedLoss.toFixed(2)} wastage successfully!`);
      setTimeout(() => setSuccessToast(""), 4000);
    } catch (err) {
      console.error("Error logging waste:", err);
      setErrorMessage(err.message || "Failed to log waste record.");
      setSavingWaste(false);
    }
  };

  // Print Profit & Loss / Waste Report
  const handlePrint = () => {
    window.print();
  };

  // Export CSV (exports active ledger view: Daily P&L, Sales & Profit, or Waste Records)
  const handleExportCsv = () => {
    let headers;
    let rows;
    let filePrefix;

    if (activeLedgerTab === "daily") {
      if (pnlStats.dailyTrend.length === 0) {
        alert("No daily profit or waste records to export.");
        return;
      }
      filePrefix = "Daily_Profit_Loss_Report";
      headers = [
        "Date",
        "Orders",
        "Revenue (INR)",
        "COGS (INR)",
        "Gross Profit (INR)",
        "Waste Incidents",
        "Waste Loss (INR)",
        "Net Profit (INR)",
      ];
      rows = pnlStats.dailyTrend.map((d) => [
        `"${d.dateLabel}"`,
        d.ordersCount,
        d.revenue.toFixed(2),
        d.cogs.toFixed(2),
        d.grossProfit.toFixed(2),
        d.wasteCount,
        d.wasteLoss.toFixed(2),
        d.netProfit.toFixed(2),
      ]);
    } else if (activeLedgerTab === "sales") {
      if (pnlStats.filteredSales.length === 0) {
        alert("No sales/profit records to export.");
        return;
      }
      filePrefix = "Sales_Profit_Report";
      headers = [
        "Bill No",
        "Date",
        "Customer",
        "Order Type",
        "Payment Mode",
        "Items Count",
        "Revenue (INR)",
        "Cost / COGS (INR)",
        "Gross Profit (INR)",
        "Margin %",
      ];
      rows = pnlStats.filteredSales.map((s) => [
        `"${s.billNo}"`,
        s.parsedDate ? s.parsedDate.toISOString().replace("T", " ").substring(0, 19) : "",
        `"${(s.customerName || "").replace(/"/g, '""')}"`,
        `"${s.orderType}"`,
        `"${s.paymentMode}"`,
        s.itemCount,
        s.revenue.toFixed(2),
        s.cost.toFixed(2),
        s.grossProfit.toFixed(2),
        s.marginPct.toFixed(1),
      ]);
    } else {
      if (filteredRecords.length === 0) {
        alert("No waste records to export.");
        return;
      }
      filePrefix = "Waste_Loss_Report";
      headers = [
        "Record ID",
        "Date",
        "Item Name",
        "Category",
        "Type",
        "Quantity Wasted",
        "Unit",
        "Unit Cost (INR)",
        "Total Loss (INR)",
        "Reason",
        "Notes",
        "Reported By",
      ];
      rows = filteredRecords.map((r) => [
        r.id,
        r.parsedDate ? r.parsedDate.toISOString().replace("T", " ").substring(0, 19) : "",
        `"${(r.productName || r.itemName || "").replace(/"/g, '""')}"`,
        `"${(r.category || "").replace(/"/g, '""')}"`,
        r.itemType || "shop_product",
        r.wastedQuantity || r.expiredQuantity || 0,
        r.unitType || "Qty",
        Number(r.unitCost || r.purchasePrice || 0).toFixed(2),
        Number(r.totalLoss || 0).toFixed(2),
        `"${(r.reason || "").replace(/"/g, '""')}"`,
        `"${(r.notes || "").replace(/"/g, '""')}"`,
        `"${(r.reportedBy || "").replace(/"/g, '""')}"`,
      ]);
    }

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${filePrefix}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Color helper for reasons
  const getReasonBadgeColor = (reason = "") => {
    const r = reason.toLowerCase();
    if (r.includes("expired")) return { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" };
    if (r.includes("spoilage") || r.includes("rotten")) return { bg: "#fef3c7", text: "#b45309", border: "#fcd34d" };
    if (r.includes("burnt") || r.includes("cooking")) return { bg: "#ffedd5", text: "#c2410c", border: "#fdba74" };
    if (r.includes("damaged")) return { bg: "#e0e7ff", text: "#4338ca", border: "#a5b4fc" };
    if (r.includes("plate") || r.includes("return")) return { bg: "#f3e8ff", text: "#7e22ce", border: "#d8b4fe" };
    return { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" };
  };

  return (
    <div style={styles.container}>
      {/* SUCCESS TOAST */}
      {successToast && <div style={styles.toast}>{successToast}</div>}

      {/* HEADER BAR */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.headerIconBox}>
            <span style={{ fontSize: "24px" }}>📊</span>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <h1 style={styles.title}>
                {isRestaurant ? "Profit, Loss & Kitchen Waste" : "Profit, Loss & Waste Tracking"}
              </h1>
              <span style={isRestaurant ? styles.restaurantBadge : styles.shopBadge}>
                {isRestaurant ? "🍳 Restaurant / Kitchen" : "🏪 Retail Shop"}
              </span>
              <span style={styles.profitPillBadge}>📈 Live P&amp;L Sync</span>
            </div>
            <p style={styles.subtitle}>
              Track sales revenue, gross &amp; net profit alongside product spoilage, kitchen errors, and inventory loss.
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={handleExportCsv}
            style={styles.secondaryBtn}
            title="Download CSV for the active report tab"
          >
            <span>📥 Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            style={styles.secondaryBtn}
            title="Print Profit, Loss & Waste Report"
          >
            <span>🖨️ Print Report</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setProfitError("");
              setShowProfitModal(true);
            }}
            style={styles.profitPrimaryBtn}
          >
            <span>+ Log Sale / Profit</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setErrorMessage("");
              setShowLogModal(true);
            }}
            style={styles.primaryBtn}
          >
            <span>+ Log Wastage / Spoilage</span>
          </button>
        </div>
      </div>

      {/* 4 P&L + WASTE KPI SUMMARY CARDS (Respects active time filter) */}
      <div style={styles.kpiGrid}>
        {/* KPI 1: Net Profit (After Waste) */}
        <div
          style={{
            ...styles.kpiCard,
            borderLeft: `4px solid ${pnlStats.netProfit >= 0 ? "#10b981" : "#ef4444"}`,
          }}
        >
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Net Profit (After Waste)</span>
            <span style={styles.kpiIcon}>{pnlStats.netProfit >= 0 ? "📈" : "📉"}</span>
          </div>
          <div
            style={{
              ...styles.kpiValue,
              color: pnlStats.netProfit >= 0 ? "#059669" : "#ef4444",
            }}
          >
            {pnlStats.netProfit < 0 ? "-" : ""}₹{formatINR(Math.abs(pnlStats.netProfit))}
          </div>
          <div style={styles.kpiSub}>
            Margin: <strong>{pnlStats.profitMarginPct}%</strong> • Today: ₹{formatINR(pnlStats.todayNetProfit)}
          </div>
        </div>

        {/* KPI 2: Total Revenue (Sales) */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #3b82f6" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Sales Revenue</span>
            <span style={styles.kpiIcon}>💰</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#2563eb" }}>
            ₹{formatINR(pnlStats.revenue)}
          </div>
          <div style={styles.kpiSub}>
            {pnlStats.ordersCount} bills • Today: ₹{formatINR(pnlStats.todayRevenue)}
          </div>
        </div>

        {/* KPI 3: Gross Profit (Before Waste) */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #0d9488" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Gross Profit (Before Waste)</span>
            <span style={styles.kpiIcon}>💹</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#0f766e" }}>
            ₹{formatINR(pnlStats.grossProfit)}
          </div>
          <div style={styles.kpiSub}>
            Item Cost (COGS): ₹{formatINR(pnlStats.cogs)} • Month: ₹{formatINR(pnlStats.monthGrossProfit)}
          </div>
        </div>

        {/* KPI 4: Waste & Spoilage Loss */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #ef4444" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Waste &amp; Spoilage Loss</span>
            <span style={styles.kpiIcon}>💸</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#ef4444" }}>
            ₹{formatINR(pnlStats.wasteLoss)}
          </div>
          <div style={styles.kpiSub}>
            Today: ₹{formatINR(stats.todayLoss)} • Lifetime: ₹{formatINR(stats.totalLoss)} ({stats.totalQuantity} units)
          </div>
        </div>
      </div>

      {/* PROFIT vs WASTE BREAKDOWN BAR */}
      <div style={styles.pnlBannerCard}>
        <div style={styles.pnlBannerTop}>
          <div>
            <span style={styles.pnlBannerTitle}>Revenue Allocation &amp; Profit Health</span>
            <span style={styles.pnlBannerSub}>
              {" "}
              (COGS + Waste Loss vs Net Profit)
            </span>
          </div>
          <div style={styles.pnlQuickPills}>
            <span style={styles.pnlQuickPillGreen}>
              Today Net: {pnlStats.todayNetProfit < 0 ? "-" : "+"}₹{formatINR(Math.abs(pnlStats.todayNetProfit))}
            </span>
            <span style={styles.pnlQuickPillBlue}>
              This Month Net: {pnlStats.monthNetProfit < 0 ? "-" : "+"}₹{formatINR(Math.abs(pnlStats.monthNetProfit))}
            </span>
            <span style={styles.pnlQuickPillRed}>
              Waste Impact: {pnlStats.wasteImpactPct}% of sales
            </span>
          </div>
        </div>

        {pnlStats.revenue > 0 ? (
          <>
            <div style={styles.stackedBarBg}>
              <div
                style={{
                  ...styles.stackedBarSegment,
                  width: `${Math.min(100, Math.max(0, (pnlStats.cogs / pnlStats.revenue) * 100))}%`,
                  backgroundColor: "#f59e0b",
                }}
                title={`Item Cost (COGS): ₹${formatINR(pnlStats.cogs)}`}
              />
              <div
                style={{
                  ...styles.stackedBarSegment,
                  width: `${Math.min(100, Math.max(0, (pnlStats.wasteLoss / pnlStats.revenue) * 100))}%`,
                  backgroundColor: "#ef4444",
                }}
                title={`Waste & Spoilage Loss: ₹${formatINR(pnlStats.wasteLoss)}`}
              />
              <div
                style={{
                  ...styles.stackedBarSegment,
                  width: `${Math.min(100, Math.max(0, (Math.max(0, pnlStats.netProfit) / pnlStats.revenue) * 100))}%`,
                  backgroundColor: "#10b981",
                }}
                title={`Net Profit: ₹${formatINR(pnlStats.netProfit)}`}
              />
            </div>
            <div style={styles.stackedLegend}>
              <span style={styles.legendItem}>
                <span style={{ ...styles.legendDot, backgroundColor: "#f59e0b" }} />
                Item Cost (COGS): ₹{formatINR(pnlStats.cogs)}
              </span>
              <span style={styles.legendItem}>
                <span style={{ ...styles.legendDot, backgroundColor: "#ef4444" }} />
                Waste Loss: ₹{formatINR(pnlStats.wasteLoss)}
              </span>
              <span style={styles.legendItem}>
                <span style={{ ...styles.legendDot, backgroundColor: "#10b981" }} />
                Net Profit: ₹{formatINR(pnlStats.netProfit)} ({pnlStats.profitMarginPct}%)
              </span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
            Record a POS bill or tap <strong>+ Log Sale / Profit</strong> to visualize your Revenue vs. Cost vs. Waste breakdown.
          </div>
        )}
      </div>

      {/* 4 VISUAL INSIGHTS CARDS (PROFIT + WASTE) */}
      <div style={styles.analyticsGrid}>
        {/* Analytics 1: Top 5 Profitable Items */}
        <div style={styles.analyticsCard}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>🏆 Top 5 Most Profitable Items</h3>
            <span style={styles.cardHint}>Highest gross profit generators</span>
          </div>
          <div style={styles.topItemsList}>
            {pnlStats.topProfitItems.length === 0 ? (
              <div style={styles.emptyNotice}>No sales profit data for this period yet.</div>
            ) : (
              pnlStats.topProfitItems.map((item, idx) => (
                <div key={idx} style={styles.topItemRow}>
                  <div style={{ ...styles.rankBadge, backgroundColor: "#10b981" }}>#{idx + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.topItemName}>{item.name}</div>
                    <div style={styles.topItemSub}>
                      Sold: {item.qtySold} • Revenue: ₹{formatINR(item.revenue)} • Margin: {item.marginPct}%
                    </div>
                  </div>
                  <div style={styles.topItemProfit}>+₹{formatINR(item.grossProfit)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Analytics 2: Recent Daily Profit vs Waste */}
        <div style={styles.analyticsCard}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>⚖️ Daily Net Profit vs. Waste</h3>
            <span style={styles.cardHint}>Latest active days at a glance</span>
          </div>
          <div style={styles.topItemsList}>
            {pnlStats.dailyTrend.length === 0 ? (
              <div style={styles.emptyNotice}>No daily profit or waste activity yet.</div>
            ) : (
              pnlStats.dailyTrend.slice(0, 5).map((day) => (
                <div key={day.dateKey} style={styles.topItemRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.topItemName}>{day.dateLabel}</div>
                    <div style={styles.topItemSub}>
                      Sales: ₹{formatINR(day.revenue)} • Gross: ₹{formatINR(day.grossProfit)} • Waste:{" "}
                      <span style={{ color: "#ef4444", fontWeight: "600" }}>
                        -₹{formatINR(day.wasteLoss)}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      ...styles.topItemProfit,
                      color: day.netProfit >= 0 ? "#059669" : "#ef4444",
                    }}
                  >
                    {day.netProfit >= 0 ? "+" : "-"}₹{formatINR(Math.abs(day.netProfit))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Analytics 3: Reason Breakdown */}
        <div style={styles.analyticsCard}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>📊 Waste Loss by Reason Breakdown</h3>
            <span style={styles.cardHint}>Where is money being lost?</span>
          </div>
          <div style={styles.reasonList}>
            {Object.keys(stats.byReason).length === 0 ? (
              <div style={styles.emptyNotice}>No loss breakdown recorded yet.</div>
            ) : (
              Object.entries(stats.byReason)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, amount]) => {
                  const pct = stats.totalLoss > 0 ? (amount / stats.totalLoss) * 100 : 0;
                  const reasonObj = WASTE_REASONS.find((r) => r.label === reason);
                  return (
                    <div key={reason} style={styles.reasonRow}>
                      <div style={styles.reasonMeta}>
                        <span style={{ fontSize: "16px" }}>{reasonObj?.icon || "⚠️"}</span>
                        <span style={styles.reasonName}>{reason}</span>
                        <span style={styles.reasonAmount}>
                          ₹{amount.toFixed(2)} ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div style={styles.progressBarBg}>
                        <div
                          style={{
                            ...styles.progressBarFill,
                            width: `${Math.min(100, Math.max(4, pct))}%`,
                            backgroundColor: pct > 40 ? "#ef4444" : pct > 20 ? "#f97316" : "#3b82f6",
                          }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </div>

        {/* Analytics 4: Top Financial Loss Products (Pareto 80/20) */}
        <div style={styles.analyticsCard}>
          <div style={styles.cardHeader}>
            <h3 style={styles.cardTitle}>🔥 Top 5 High-Loss Items (Pareto Impact)</h3>
            <span style={styles.cardHint}>Items causing the biggest expense</span>
          </div>
          <div style={styles.topItemsList}>
            {stats.topLossItems.length === 0 ? (
              <div style={styles.emptyNotice}>No item loss records yet.</div>
            ) : (
              stats.topLossItems.map((item, idx) => (
                <div key={idx} style={styles.topItemRow}>
                  <div style={styles.rankBadge}>#{idx + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.topItemName}>{item.name}</div>
                    <div style={styles.topItemSub}>
                      Category: {item.category} • Wasted: {item.totalQuantity} {item.unitType}
                    </div>
                  </div>
                  <div style={styles.topItemLoss}>- ₹{item.totalLoss.toFixed(2)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH CONTROLS */}
      <div style={styles.filterBar}>
        {/* Time Filter Chips */}
        <div style={styles.timeFilterGroup}>
          {[
            { id: "all", label: "All Time" },
            { id: "today", label: "Today" },
            { id: "yesterday", label: "Yesterday" },
            { id: "week", label: "This Week" },
            { id: "month", label: "This Month" },
          ].map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeFilter(tf.id)}
              style={{
                ...styles.timeChip,
                backgroundColor: timeFilter === tf.id ? "#0d9488" : "#ffffff",
                color: timeFilter === tf.id ? "#ffffff" : "#475569",
                borderColor: timeFilter === tf.id ? "#0d9488" : "#cbd5e1",
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div style={styles.searchBox}>
          <span style={{ fontSize: "14px", color: "#94a3b8" }}>🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by product, bill no, customer, or reason..."
            style={styles.searchInput}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} style={styles.clearSearchBtn}>
              ✕
            </button>
          )}
        </div>

        {/* Waste-specific dropdowns shown when viewing Waste Log */}
        {activeLedgerTab === "waste" && (
          <>
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              style={styles.selectFilter}
            >
              <option value="all">All Reasons</option>
              {WASTE_REASONS.map((r) => (
                <option key={r.id} value={r.label}>
                  {r.icon} {r.label}
                </option>
              ))}
            </select>

            {isRestaurant && (
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={styles.selectFilter}
              >
                <option value="all">All Item Types</option>
                <option value="restaurant_raw_material">Kitchen Ingredients</option>
                <option value="restaurant_food_item">Prepared Dishes</option>
                <option value="shop_product">Retail Products</option>
              </select>
            )}
          </>
        )}
      </div>

      {/* LEDGER VIEW TABS + SUMMARY */}
      <div style={styles.ledgerTabBar}>
        <div style={styles.ledgerTabs}>
          <button
            type="button"
            onClick={() => setActiveLedgerTab("daily")}
            style={{
              ...styles.ledgerTabBtn,
              ...(activeLedgerTab === "daily" ? styles.ledgerTabBtnActive : {}),
            }}
          >
            ⚖️ Daily P&amp;L Summary ({pnlStats.dailyTrend.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveLedgerTab("sales")}
            style={{
              ...styles.ledgerTabBtn,
              ...(activeLedgerTab === "sales" ? styles.ledgerTabBtnActive : {}),
            }}
          >
            💰 Profit &amp; Sales Log ({pnlStats.filteredSales.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveLedgerTab("waste")}
            style={{
              ...styles.ledgerTabBtn,
              ...(activeLedgerTab === "waste" ? styles.ledgerTabBtnActive : {}),
            }}
          >
            🗑️ Waste &amp; Loss Log ({filteredRecords.length})
          </button>
        </div>

        <div style={styles.filterSummary}>
          <span>
            Net Profit:{" "}
            <strong style={{ color: pnlStats.netProfit >= 0 ? "#059669" : "#ef4444" }}>
              {pnlStats.netProfit < 0 ? "-" : "+"}₹{formatINR(Math.abs(pnlStats.netProfit))}
            </strong>{" "}
            • Sales: <strong style={{ color: "#2563eb" }}>₹{formatINR(pnlStats.revenue)}</strong> • Waste:{" "}
            <strong style={{ color: "#ef4444" }}>₹{formatINR(currentViewLoss)}</strong>
          </span>
        </div>
      </div>

      {/* LEDGER TABLE CARD */}
      <div style={styles.tableCard}>
        {activeLedgerTab === "daily" ? (
          loading && salesLoading ? (
            <div style={styles.tableLoader}>⏳ Loading profit &amp; waste summary...</div>
          ) : pnlStats.dailyTrend.length === 0 ? (
            <div style={styles.emptyTable}>
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>📊</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155" }}>
                No profit or waste records found for this period
              </div>
              <p style={{ fontSize: "13px", color: "#64748b", margin: "6px 0 16px" }}>
                Sales billed in POS appear here automatically, or record a sale/waste entry directly.
              </p>
              <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    setProfitError("");
                    setShowProfitModal(true);
                  }}
                  style={styles.profitPrimaryBtn}
                >
                  + Log Sale / Profit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage("");
                    setShowLogModal(true);
                  }}
                  style={styles.primaryBtn}
                >
                  + Log Wastage Now
                </button>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.thRow}>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Orders</th>
                    <th style={styles.th}>Sales Revenue</th>
                    <th style={styles.th}>Item Cost (COGS)</th>
                    <th style={styles.th}>Gross Profit</th>
                    <th style={styles.th}>Waste Loss</th>
                    <th style={styles.th}>Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {pnlStats.dailyTrend.map((day) => (
                    <tr key={day.dateKey} style={styles.tr}>
                      <td style={{ ...styles.tdDate, fontWeight: "700", color: "#0f172a" }}>
                        {day.dateLabel}
                      </td>
                      <td style={styles.td}>{day.ordersCount} bills</td>
                      <td style={{ ...styles.td, fontWeight: "700", color: "#2563eb" }}>
                        ₹{formatINR(day.revenue)}
                      </td>
                      <td style={styles.tdCost}>₹{formatINR(day.cogs)}</td>
                      <td style={{ ...styles.td, fontWeight: "700", color: "#0f766e" }}>
                        +₹{formatINR(day.grossProfit)}
                      </td>
                      <td style={styles.tdLoss}>
                        {day.wasteLoss > 0 ? `- ₹${formatINR(day.wasteLoss)}` : "₹0.00"}
                        {day.wasteCount > 0 ? (
                          <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "500" }}>
                            {" "}
                            ({day.wasteCount})
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          ...styles.td,
                          fontWeight: "800",
                          color: day.netProfit >= 0 ? "#059669" : "#ef4444",
                        }}
                      >
                        {day.netProfit >= 0 ? "+" : "-"}₹{formatINR(Math.abs(day.netProfit))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : activeLedgerTab === "sales" ? (
          salesLoading ? (
            <div style={styles.tableLoader}>⏳ Loading sales &amp; profit records...</div>
          ) : pnlStats.filteredSales.length === 0 ? (
            <div style={styles.emptyTable}>
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>💰</div>
              <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155" }}>
                No sales / profit records found
              </div>
              <p style={{ fontSize: "13px", color: "#64748b", margin: "6px 0 16px" }}>
                POS checkout bills sync here automatically. You can also tap &quot;+ Log Sale / Profit&quot; to record an entry.
              </p>
              <button
                type="button"
                onClick={() => {
                  setProfitError("");
                  setShowProfitModal(true);
                }}
                style={styles.profitPrimaryBtn}
              >
                + Log Sale / Profit
              </button>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.thRow}>
                    <th style={styles.th}>Date &amp; Time</th>
                    <th style={styles.th}>Bill No / Items</th>
                    <th style={styles.th}>Customer / Type</th>
                    <th style={styles.th}>Payment</th>
                    <th style={styles.th}>Revenue</th>
                    <th style={styles.th}>Cost (COGS)</th>
                    <th style={styles.th}>Gross Profit</th>
                    <th style={styles.th}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {pnlStats.filteredSales.map((sale) => {
                    const dateStr = sale.parsedDate
                      ? sale.parsedDate.toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Recent";
                    const itemsText =
                      sale.itemsSummary.length > 0
                        ? sale.itemsSummary
                            .slice(0, 2)
                            .map((i) => `${i.name} ×${i.qty}`)
                            .join(", ") +
                          (sale.itemsSummary.length > 2
                            ? ` +${sale.itemsSummary.length - 2} more`
                            : "")
                        : `${sale.itemCount} item(s)`;

                    return (
                      <tr key={sale.id} style={styles.tr}>
                        <td style={styles.tdDate}>{dateStr}</td>
                        <td style={styles.tdItem}>
                          <div style={styles.itemTitle}>#{sale.billNo}</div>
                          <div style={styles.itemCategory}>{itemsText}</div>
                        </td>
                        <td style={styles.td}>
                          <div style={{ fontWeight: "600", color: "#334155" }}>
                            {sale.customerName}
                          </div>
                          <span style={styles.typeBadge}>
                            {sale.isManual ? "Manual Profit Log" : sale.orderType}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.typeBadge}>{sale.paymentMode}</span>
                        </td>
                        <td style={{ ...styles.td, fontWeight: "700", color: "#2563eb" }}>
                          ₹{formatINR(sale.revenue)}
                        </td>
                        <td style={styles.tdCost}>₹{formatINR(sale.cost)}</td>
                        <td
                          style={{
                            ...styles.td,
                            fontWeight: "800",
                            color: sale.grossProfit >= 0 ? "#059669" : "#ef4444",
                          }}
                        >
                          {sale.grossProfit >= 0 ? "+" : "-"}₹{formatINR(Math.abs(sale.grossProfit))}
                        </td>
                        <td style={styles.td}>
                          <span
                            style={{
                              ...styles.reasonBadge,
                              backgroundColor: sale.grossProfit >= 0 ? "#dcfce7" : "#fee2e2",
                              color: sale.grossProfit >= 0 ? "#15803d" : "#b91c1c",
                              borderColor: sale.grossProfit >= 0 ? "#86efac" : "#fca5a5",
                            }}
                          >
                            {sale.marginPct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : loading ? (
          <div style={styles.tableLoader}>⏳ Loading waste records...</div>
        ) : filteredRecords.length === 0 ? (
          <div style={styles.emptyTable}>
            <div style={{ fontSize: "40px", marginBottom: "8px" }}>🌱</div>
            <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155" }}>
              No waste records found
            </div>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "6px 0 16px" }}>
              {searchQuery || reasonFilter !== "all" || timeFilter !== "all"
                ? "Try adjusting your filters or search terms."
                : "No product or kitchen waste recorded yet. Tap '+ Log Wastage / Spoilage' to record an incident."}
            </p>
            <button
              type="button"
              onClick={() => setShowLogModal(true)}
              style={styles.primaryBtn}
            >
              + Log Wastage Now
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thRow}>
                  <th style={styles.th}>Date & Time</th>
                  <th style={styles.th}>Item / Ingredient</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Qty Wasted</th>
                  <th style={styles.th}>Unit Cost</th>
                  <th style={styles.th}>Financial Loss</th>
                  <th style={styles.th}>Reason</th>
                  <th style={styles.th}>Reported By / Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((rec) => {
                  const bColor = getReasonBadgeColor(rec.reason);
                  const dateStr = rec.parsedDate
                    ? rec.parsedDate.toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Recent";

                  return (
                    <tr key={rec.id} style={styles.tr}>
                      <td style={styles.tdDate}>{dateStr}</td>
                      <td style={styles.tdItem}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          {rec.productImage ? (
                            <img
                              src={rec.productImage}
                              alt={rec.productName}
                              style={styles.tableThumb}
                              onError={(e) => {
                                e.target.style.display = "none";
                              }}
                            />
                          ) : (
                            <div style={styles.tableThumbPlaceholder}>
                              {rec.itemType === "restaurant_raw_material" ? "🥬" : "📦"}
                            </div>
                          )}
                          <div>
                            <div style={styles.itemTitle}>{rec.productName || rec.itemName}</div>
                            <div style={styles.itemCategory}>{rec.category || "General"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.typeBadge}>
                          {rec.itemType === "restaurant_raw_material"
                            ? "Raw Material"
                            : rec.itemType === "restaurant_food_item"
                            ? "Food Menu"
                            : "Product"}
                        </span>
                      </td>
                      <td style={styles.tdQty}>
                        <strong>
                          {rec.wastedQuantity || rec.expiredQuantity} {rec.unitType || "Qty"}
                        </strong>
                      </td>
                      <td style={styles.tdCost}>
                        ₹{Number(rec.unitCost || rec.purchasePrice || 0).toFixed(2)}
                      </td>
                      <td style={styles.tdLoss}>
                        - ₹{Number(rec.totalLoss || 0).toFixed(2)}
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.reasonBadge,
                            backgroundColor: bColor.bg,
                            color: bColor.text,
                            borderColor: bColor.border,
                          }}
                        >
                          {rec.reason || "Expired"}
                        </span>
                      </td>
                      <td style={styles.tdNotes}>
                        <div style={{ fontWeight: "600", color: "#334155" }}>
                          {rec.reportedBy || "Owner"}
                        </div>
                        {rec.notes ? (
                          <div style={{ fontSize: "11px", color: "#64748b", fontStyle: "italic" }}>
                            "{rec.notes}"
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: LOG NEW WASTAGE */}
      {showLogModal && (
        <div style={styles.modalOverlay} onClick={() => setShowLogModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "22px" }}>🗑️</span>
                <h3 style={styles.modalTitle}>
                  {isRestaurant ? "Log Kitchen & Food Waste" : "Log Product Spoilage / Wastage"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleLogWasteSubmit} style={styles.modalForm}>
              {errorMessage && <div style={styles.modalError}>{errorMessage}</div>}

              {/* Source Toggle for Restaurant */}
              {isRestaurant && (
                <div style={styles.sourceToggleRow}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemSource("raw_materials");
                      setSelectedItemId("");
                    }}
                    style={{
                      ...styles.sourceToggleBtn,
                      backgroundColor:
                        selectedItemSource === "raw_materials" ? "#0d9488" : "#f1f5f9",
                      color: selectedItemSource === "raw_materials" ? "#ffffff" : "#475569",
                      fontWeight: selectedItemSource === "raw_materials" ? "700" : "500",
                    }}
                  >
                    🥬 Kitchen Raw Materials ({rawMaterials.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemSource("products");
                      setSelectedItemId("");
                    }}
                    style={{
                      ...styles.sourceToggleBtn,
                      backgroundColor: selectedItemSource === "products" ? "#0d9488" : "#f1f5f9",
                      color: selectedItemSource === "products" ? "#ffffff" : "#475569",
                      fontWeight: selectedItemSource === "products" ? "700" : "500",
                    }}
                  >
                    🍽️ Prepared Foods / Dishes ({products.length})
                  </button>
                </div>
              )}

              {/* Item Selector */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  Select {selectedItemSource === "raw_materials" ? "Ingredient" : "Product"} *
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  style={styles.formInput}
                  required
                >
                  <option value="">-- Choose item from stock --</option>
                  {(selectedItemSource === "raw_materials" ? rawMaterials : products).map(
                    (item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} (Stock: {item.quantity} {item.unitType} | Cost: ₹
                        {item.purchasePrice}/{item.unitType})
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* Item Details Preview if selected */}
              {currentSelectedItem && (
                <div style={styles.itemPreviewCard}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={styles.previewName}>{currentSelectedItem.name}</div>
                      <div style={styles.previewSub}>
                        Category: {currentSelectedItem.category}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={styles.previewStock}>
                        Current Stock:{" "}
                        <strong style={{ color: "#0d9488" }}>
                          {currentSelectedItem.quantity} {currentSelectedItem.unitType}
                        </strong>
                      </div>
                      <div style={styles.previewCost}>
                        Unit Cost Price: ₹{currentSelectedItem.purchasePrice} /{" "}
                        {currentSelectedItem.unitType}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Wasted Quantity Input */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  Quantity Wasted ({currentSelectedItem?.unitType || "Units"}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={wastedQty}
                  onChange={(e) => setWastedQty(e.target.value)}
                  placeholder={`e.g. 2.5 ${currentSelectedItem?.unitType || "units"}`}
                  style={styles.formInput}
                  required
                />
              </div>

              {/* Reason Selector */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Reason for Waste / Spoilage *</label>
                <select
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  style={styles.formInput}
                  required
                >
                  {WASTE_REASONS.map((r) => (
                    <option key={r.id} value={r.label}>
                      {r.icon} {r.label} ({r.category})
                    </option>
                  ))}
                </select>
              </div>

              {/* Financial Loss Calculation Box */}
              {modalCalculatedLoss > 0 && (
                <div style={styles.lossCalcBox}>
                  <div style={styles.lossCalcRow}>
                    <span>Wasted Quantity:</span>
                    <strong>
                      {wastedQty} {currentSelectedItem?.unitType}
                    </strong>
                  </div>
                  <div style={styles.lossCalcRow}>
                    <span>Cost per Unit:</span>
                    <strong>₹{currentSelectedItem?.purchasePrice}</strong>
                  </div>
                  <div style={styles.lossDivider} />
                  <div style={{ ...styles.lossCalcRow, fontSize: "16px", color: "#b91c1c" }}>
                    <span>Calculated Financial Loss:</span>
                    <strong>₹{modalCalculatedLoss.toFixed(2)}</strong>
                  </div>
                  <div style={styles.lossNote}>
                    💡 Inventory stock will be atomically reduced by {wastedQty}{" "}
                    {currentSelectedItem?.unitType}.
                  </div>
                </div>
              )}

              {/* Notes */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Incident Notes / Root Cause (Optional)</label>
                <textarea
                  value={wasteNotes}
                  onChange={(e) => setWasteNotes(e.target.value)}
                  placeholder="e.g. Cold storage condenser shut off overnight, cooking burnt on batch #2"
                  rows={2}
                  style={styles.formTextarea}
                />
              </div>

              {/* Reported By */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Reported By</label>
                <input
                  type="text"
                  value={reportedByName}
                  onChange={(e) => setReportedByName(e.target.value)}
                  style={styles.formInput}
                />
              </div>

              {/* Modal Buttons */}
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  style={styles.modalCancelBtn}
                  disabled={savingWaste}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={styles.modalSubmitBtn}
                  disabled={savingWaste || !currentSelectedItem || !wastedQty}
                >
                  {savingWaste ? "Saving & Deducting Stock..." : "Confirm & Record Loss"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LOG SALE / PROFIT ENTRY */}
      {showProfitModal && (
        <div style={styles.modalOverlay} onClick={() => setShowProfitModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "22px" }}>💰</span>
                <h3 style={styles.modalTitle}>Log Sale &amp; Profit Entry</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowProfitModal(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleLogProfitSubmit} style={styles.modalForm}>
              {profitError && <div style={styles.modalError}>{profitError}</div>}

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Select Product / Dish (Optional Quick Fill)</label>
                <select
                  value={profitSelectedProductId}
                  onChange={(e) => handleSelectProfitProduct(e.target.value)}
                  style={styles.formInput}
                >
                  <option value="custom">-- Custom Item / Daily Summary --</option>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (Sell: ₹{item.sellingPrice} | Cost: ₹
                      {item.costPrice > 0
                        ? item.costPrice
                        : recipeCostMap[item.id] || recipeCostMap[item.name.toLowerCase()] || 0}
                      )
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Item / Sale Description *</label>
                <input
                  type="text"
                  value={profitItemName}
                  onChange={(e) => setProfitItemName(e.target.value)}
                  placeholder="e.g. Chicken Biryani, Catering Order, or Offline Sale"
                  style={styles.formInput}
                  required
                />
              </div>

              <div style={styles.formRow2}>
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>Quantity *</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={profitQty}
                    onChange={(e) => setProfitQty(e.target.value)}
                    style={styles.formInput}
                    required
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>Payment Mode</label>
                  <select
                    value={profitPaymentMode}
                    onChange={(e) => setProfitPaymentMode(e.target.value)}
                    style={styles.formInput}
                  >
                    <option value="CASH">Cash</option>
                    <option value="UPI">UPI / QR</option>
                    <option value="CARD">Card</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div style={styles.formRow2}>
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>Selling Price / Unit (₹) *</label>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={profitSellPrice}
                    onChange={(e) => setProfitSellPrice(e.target.value)}
                    placeholder="e.g. 180"
                    style={styles.formInput}
                    required
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.formLabel}>Cost Price / Unit (₹)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={profitCostPrice}
                    onChange={(e) => setProfitCostPrice(e.target.value)}
                    placeholder="e.g. 95"
                    style={styles.formInput}
                  />
                </div>
              </div>

              {modalProfitPreview.revenue > 0 && (
                <div style={styles.profitCalcBox}>
                  <div style={styles.lossCalcRow}>
                    <span>Total Revenue:</span>
                    <strong>₹{formatINR(modalProfitPreview.revenue)}</strong>
                  </div>
                  <div style={styles.lossCalcRow}>
                    <span>Total Cost (COGS):</span>
                    <strong>₹{formatINR(modalProfitPreview.cost)}</strong>
                  </div>
                  <div style={{ ...styles.lossDivider, backgroundColor: "#86efac" }} />
                  <div
                    style={{
                      ...styles.lossCalcRow,
                      fontSize: "16px",
                      color: modalProfitPreview.profit >= 0 ? "#15803d" : "#b91c1c",
                    }}
                  >
                    <span>Gross Profit ({modalProfitPreview.marginPct}%):</span>
                    <strong>
                      {modalProfitPreview.profit >= 0 ? "+" : "-"}₹
                      {formatINR(Math.abs(modalProfitPreview.profit))}
                    </strong>
                  </div>
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Customer / Source (Optional)</label>
                <input
                  type="text"
                  value={profitCustomer}
                  onChange={(e) => setProfitCustomer(e.target.value)}
                  placeholder="Walk-in Customer / Swiggy / Bulk Order"
                  style={styles.formInput}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>Notes (Optional)</label>
                <textarea
                  value={profitNotes}
                  onChange={(e) => setProfitNotes(e.target.value)}
                  placeholder="Optional note about this sale or profit entry"
                  rows={2}
                  style={styles.formTextarea}
                />
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setShowProfitModal(false)}
                  style={styles.modalCancelBtn}
                  disabled={savingProfit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={styles.profitSubmitBtn}
                  disabled={savingProfit || !profitItemName.trim() || !profitSellPrice}
                >
                  {savingProfit ? "Saving Entry..." : "Confirm & Record Profit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "24px",
    paddingBottom: "80px",
    maxWidth: "1400px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  toast: {
    position: "fixed",
    top: "20px",
    right: "20px",
    backgroundColor: "#065f46",
    color: "#ffffff",
    padding: "12px 20px",
    borderRadius: "10px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
    fontWeight: "700",
    zIndex: 9999,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "16px",
    marginBottom: "24px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  headerIconBox: {
    width: "52px",
    height: "52px",
    borderRadius: "14px",
    backgroundColor: "#ecfdf5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: "24px",
    fontWeight: "800",
    color: "#0f172a",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: "13px",
    color: "#64748b",
  },
  shopBadge: {
    backgroundColor: "#eff6ff",
    color: "#2563eb",
    fontSize: "11px",
    fontWeight: "700",
    padding: "3px 8px",
    borderRadius: "6px",
    border: "1px solid #bfdbfe",
  },
  restaurantBadge: {
    backgroundColor: "#fef3c7",
    color: "#b45309",
    fontSize: "11px",
    fontWeight: "700",
    padding: "3px 8px",
    borderRadius: "6px",
    border: "1px solid #fde68a",
  },
  profitPillBadge: {
    backgroundColor: "#ecfdf5",
    color: "#059669",
    fontSize: "11px",
    fontWeight: "700",
    padding: "3px 8px",
    borderRadius: "6px",
    border: "1px solid #a7f3d0",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  profitPrimaryBtn: {
    backgroundColor: "#10b981",
    color: "#ffffff",
    border: "none",
    padding: "10px 18px",
    borderRadius: "10px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
  },
  primaryBtn: {
    backgroundColor: "#ef4444",
    color: "#ffffff",
    border: "none",
    padding: "10px 18px",
    borderRadius: "10px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: "0 2px 8px rgba(239, 68, 68, 0.3)",
  },
  secondaryBtn: {
    backgroundColor: "#ffffff",
    color: "#334155",
    border: "1px solid #cbd5e1",
    padding: "10px 16px",
    borderRadius: "10px",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "16px",
    marginBottom: "24px",
  },
  kpiCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "18px 20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
  },
  kpiTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  },
  kpiLabel: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#64748b",
  },
  kpiIcon: {
    fontSize: "18px",
  },
  kpiValue: {
    fontSize: "26px",
    fontWeight: "800",
    margin: "4px 0",
  },
  kpiSub: {
    fontSize: "12px",
    color: "#94a3b8",
  },
  analyticsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: "20px",
    marginBottom: "24px",
  },
  analyticsCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
  },
  cardHeader: {
    marginBottom: "16px",
  },
  cardTitle: {
    margin: 0,
    fontSize: "15px",
    fontWeight: "700",
    color: "#1e293b",
  },
  cardHint: {
    fontSize: "12px",
    color: "#94a3b8",
  },
  reasonList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  reasonRow: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  reasonMeta: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
  },
  reasonName: {
    flex: 1,
    fontWeight: "600",
    color: "#334155",
  },
  reasonAmount: {
    fontWeight: "700",
    color: "#b91c1c",
  },
  progressBarBg: {
    height: "6px",
    borderRadius: "4px",
    backgroundColor: "#f1f5f9",
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: "4px",
    transition: "width 0.4s ease",
  },
  topItemsList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  topItemRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: "10px",
    backgroundColor: "#f8fafc",
    border: "1px solid #f1f5f9",
  },
  rankBadge: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    backgroundColor: "#ef4444",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "11px",
    fontWeight: "800",
    flexShrink: 0,
  },
  topItemName: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#1e293b",
  },
  topItemSub: {
    fontSize: "11px",
    color: "#64748b",
  },
  topItemLoss: {
    fontSize: "14px",
    fontWeight: "800",
    color: "#ef4444",
  },
  emptyNotice: {
    fontSize: "13px",
    color: "#94a3b8",
    textAlign: "center",
    padding: "24px 0",
  },
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    marginBottom: "12px",
  },
  timeFilterGroup: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#f1f5f9",
    padding: "4px",
    borderRadius: "10px",
  },
  timeChip: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid transparent",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    padding: "6px 12px",
    flex: "1 1 200px",
  },
  searchInput: {
    border: "none",
    outline: "none",
    width: "100%",
    fontSize: "13px",
    color: "#1e293b",
  },
  clearSearchBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#94a3b8",
    fontSize: "12px",
  },
  selectFilter: {
    padding: "8px 12px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    fontSize: "13px",
    color: "#334155",
    outline: "none",
  },
  filterSummary: {
    fontSize: "13px",
    color: "#64748b",
    marginBottom: "16px",
  },
  tableCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    overflow: "hidden",
  },
  tableLoader: {
    padding: "40px",
    textAlign: "center",
    color: "#64748b",
    fontSize: "14px",
  },
  emptyTable: {
    padding: "48px 24px",
    textAlign: "center",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: "13px",
  },
  thRow: {
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  th: {
    padding: "12px 16px",
    fontSize: "11px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "#64748b",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
  },
  td: {
    padding: "14px 16px",
    verticalAlign: "middle",
  },
  tdDate: {
    padding: "14px 16px",
    fontSize: "12px",
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  tdItem: {
    padding: "14px 16px",
    minWidth: "200px",
  },
  tdQty: {
    padding: "14px 16px",
    color: "#1e293b",
    whiteSpace: "nowrap",
  },
  tdCost: {
    padding: "14px 16px",
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  tdLoss: {
    padding: "14px 16px",
    fontWeight: "800",
    color: "#ef4444",
    whiteSpace: "nowrap",
  },
  tdNotes: {
    padding: "14px 16px",
    maxWidth: "200px",
  },
  tableThumb: {
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    objectFit: "cover",
    backgroundColor: "#f1f5f9",
  },
  tableThumbPlaceholder: {
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    backgroundColor: "#f1f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
  },
  itemTitle: {
    fontWeight: "700",
    color: "#0f172a",
  },
  itemCategory: {
    fontSize: "11px",
    color: "#64748b",
  },
  typeBadge: {
    fontSize: "11px",
    fontWeight: "600",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    padding: "3px 8px",
    borderRadius: "6px",
    whiteSpace: "nowrap",
  },
  reasonBadge: {
    fontSize: "11px",
    fontWeight: "700",
    padding: "4px 10px",
    borderRadius: "12px",
    borderWidth: "1px",
    borderStyle: "solid",
    whiteSpace: "nowrap",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "16px",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    maxWidth: "540px",
    width: "100%",
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
  },
  modalHeader: {
    padding: "18px 24px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    margin: 0,
    fontSize: "16px",
    fontWeight: "800",
    color: "#0f172a",
  },
  modalCloseBtn: {
    background: "none",
    border: "none",
    fontSize: "18px",
    cursor: "pointer",
    color: "#94a3b8",
  },
  modalForm: {
    padding: "24px",
  },
  modalError: {
    backgroundColor: "#fee2e2",
    color: "#b91c1c",
    padding: "10px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600",
    marginBottom: "16px",
  },
  sourceToggleRow: {
    display: "flex",
    gap: "8px",
    marginBottom: "16px",
  },
  sourceToggleBtn: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: "8px",
    border: "none",
    fontSize: "12px",
    cursor: "pointer",
  },
  formGroup: {
    marginBottom: "16px",
  },
  formLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
    marginBottom: "6px",
  },
  formInput: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    boxSizing: "border-box",
    outline: "none",
    backgroundColor: "#ffffff",
  },
  formTextarea: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    boxSizing: "border-box",
    outline: "none",
    resize: "vertical",
  },
  itemPreviewCard: {
    padding: "12px 14px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    marginBottom: "16px",
  },
  previewName: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#0f172a",
  },
  previewSub: {
    fontSize: "11px",
    color: "#64748b",
  },
  previewStock: {
    fontSize: "12px",
  },
  previewCost: {
    fontSize: "11px",
    color: "#64748b",
  },
  lossCalcBox: {
    padding: "14px 16px",
    backgroundColor: "#fef2f2",
    borderRadius: "10px",
    border: "1px solid #fecaca",
    marginBottom: "16px",
  },
  lossCalcRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    marginBottom: "4px",
    color: "#374151",
  },
  lossDivider: {
    height: "1px",
    backgroundColor: "#fca5a5",
    margin: "8px 0",
  },
  lossNote: {
    fontSize: "11px",
    color: "#6b7280",
    marginTop: "6px",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "20px",
  },
  modalCancelBtn: {
    padding: "10px 18px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#475569",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
  },
  modalSubmitBtn: {
    padding: "10px 20px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#ef4444",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(239, 68, 68, 0.3)",
  },
  profitSubmitBtn: {
    padding: "10px 20px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#10b981",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(16, 185, 129, 0.3)",
  },
  profitCalcBox: {
    padding: "14px 16px",
    backgroundColor: "#ecfdf5",
    borderRadius: "10px",
    border: "1px solid #a7f3d0",
    marginBottom: "16px",
  },
  formRow2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  pnlBannerCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "16px 20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
    border: "1px solid #e2e8f0",
    marginBottom: "24px",
  },
  pnlBannerTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "10px",
    marginBottom: "12px",
  },
  pnlBannerTitle: {
    fontSize: "14px",
    fontWeight: "700",
    color: "#0f172a",
  },
  pnlBannerSub: {
    fontSize: "12px",
    color: "#64748b",
  },
  pnlQuickPills: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  pnlQuickPillGreen: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#047857",
    backgroundColor: "#ecfdf5",
    border: "1px solid #a7f3d0",
    padding: "4px 10px",
    borderRadius: "999px",
  },
  pnlQuickPillBlue: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#1d4ed8",
    backgroundColor: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: "4px 10px",
    borderRadius: "999px",
  },
  pnlQuickPillRed: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#b91c1c",
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "4px 10px",
    borderRadius: "999px",
  },
  stackedBarBg: {
    display: "flex",
    width: "100%",
    height: "10px",
    borderRadius: "999px",
    overflow: "hidden",
    backgroundColor: "#f1f5f9",
    marginBottom: "10px",
  },
  stackedBarSegment: {
    height: "100%",
    transition: "width 0.4s ease",
  },
  stackedLegend: {
    display: "flex",
    alignItems: "center",
    gap: "18px",
    flexWrap: "wrap",
    fontSize: "12px",
    color: "#475569",
    fontWeight: "600",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  legendDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    display: "inline-block",
  },
  topItemProfit: {
    fontSize: "14px",
    fontWeight: "800",
    color: "#059669",
    whiteSpace: "nowrap",
  },
  ledgerTabBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "14px",
  },
  ledgerTabs: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  ledgerTabBtn: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#475569",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
  },
  ledgerTabBtnActive: {
    backgroundColor: "#0f172a",
    color: "#ffffff",
    borderColor: "#0f172a",
  },
};
