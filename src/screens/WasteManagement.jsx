import { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, doc, getDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import {
  WASTE_REASONS,
  calculateWasteStats,
  logWasteRecord,
  subscribeWasteRecords,
} from "../utils/wasteService";

export default function WasteManagement({ onBack, userProfile = {} }) {
  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

  // Shop & Business Mode
  const [shopType, setShopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant = (shopType || "").trim().toLowerCase() === "restaurant";
  const [appMode] = useState(() => localStorage.getItem("app_mode") || "local");
  const isGlobalMode = appMode === "global";

  // Data States
  const [wasteRecords, setWasteRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);

  // Filter States
  const [timeFilter, setTimeFilter] = useState("all"); // "today" | "yesterday" | "week" | "month" | "all"
  const [reasonFilter, setReasonFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modal States
  const [showLogModal, setShowLogModal] = useState(false);
  const [savingWaste, setSavingWaste] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successToast, setSuccessToast] = useState("");

  // Log Form States
  const [selectedItemSource, setSelectedItemSource] = useState(isRestaurant ? "raw_materials" : "products");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [wastedQty, setWastedQty] = useState("");
  const [selectedReason, setSelectedReason] = useState(WASTE_REASONS[0].label);
  const [wasteNotes, setWasteNotes] = useState("");
  const [reportedByName, setReportedByName] = useState(() => localStorage.getItem("staff_name") || userProfile.name || "Owner");

  // Print / Export Slip State
  const [showPrintSlip, setShowPrintSlip] = useState(false);
  const printRef = useRef(null);

  // 1. Subscribe to Waste Records
  useEffect(() => {
    if (!currentUid) return;

    setLoading(true);
    const unsubscribe = subscribeWasteRecords(
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

    return () => unsubscribe();
  }, [currentUid]);

  // 2. Fetch inventory products for selection
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
        return {
          id: d.id,
          name: data.itemName || data.name || "Unnamed Item",
          category: data.category || (isRestaurant ? "Main Course" : "General"),
          quantity: Number(data.quantity || 0),
          purchasePrice: Number(data.purchasePrice ?? data.costPrice ?? data.price ?? 0),
          unitType: data.unitType || data.unit || "Qty",
          image: data.image || data.imageUrl || "",
          type: "product",
        };
      });
      setProducts(items);
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
      unsubRaw();
    };
  }, [currentUid, isRestaurant, isGlobalMode]);

  // Selected item object for live form preview
  const currentSelectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    const pool = selectedItemSource === "raw_materials" ? rawMaterials : products;
    return pool.find((i) => i.id === selectedItemId) || null;
  }, [selectedItemId, selectedItemSource, products, rawMaterials]);

  // Live calculated loss in modal
  const modalCalculatedLoss = useMemo(() => {
    if (!currentSelectedItem || !wastedQty) return 0;
    const qty = Number(wastedQty);
    if (isNaN(qty) || qty <= 0) return 0;
    const cost = Number(currentSelectedItem.purchasePrice) || 0;
    return Math.round(cost * qty * 100) / 100;
  }, [currentSelectedItem, wastedQty]);

  // Overall statistics
  const stats = useMemo(() => {
    return calculateWasteStats(wasteRecords);
  }, [wasteRecords]);

  // Filtered waste records
  const filteredRecords = useMemo(() => {
    const now = new Date();
    const todayStr = now.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(now.getDate() - 7);

    return wasteRecords.filter((rec) => {
      const d = rec.parsedDate || new Date();

      // Time filter
      if (timeFilter === "today" && d.toDateString() !== todayStr) return false;
      if (timeFilter === "yesterday" && d.toDateString() !== yesterdayStr) return false;
      if (timeFilter === "week" && d < oneWeekAgo) return false;
      if (
        timeFilter === "month" &&
        (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear())
      ) {
        return false;
      }

      // Reason filter
      if (reasonFilter !== "all" && rec.reason !== reasonFilter) return false;

      // Type filter
      if (typeFilter !== "all" && rec.itemType !== typeFilter) return false;

      // Search query
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

  // Print Loss Report
  const handlePrint = () => {
    window.print();
  };

  // Export CSV
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) {
      alert("No waste records to export.");
      return;
    }

    const headers = [
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

    const rows = filteredRecords.map((r) => [
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

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Waste_Report_${new Date().toISOString().slice(0, 10)}.csv`);
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
            <span style={{ fontSize: "24px" }}>📉</span>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={styles.title}>
                {isRestaurant ? "Food Waste & Kitchen Spoilage" : "Waste & Spoilage Management"}
              </h1>
              <span style={isRestaurant ? styles.restaurantBadge : styles.shopBadge}>
                {isRestaurant ? "🍳 Restaurant / Kitchen" : "🏪 Retail Shop"}
              </span>
            </div>
            <p style={styles.subtitle}>
              Track product spoilage, expired stock, kitchen errors, and calculate the true cost of inventory loss.
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={handleExportCsv}
            style={styles.secondaryBtn}
            title="Download CSV for accounting & tax write-off"
          >
            <span>📥 Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            style={styles.secondaryBtn}
            title="Print Waste Loss Audit Slip"
          >
            <span>🖨️ Print Report</span>
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

      {/* 4 KPI SUMMARY CARDS */}
      <div style={styles.kpiGrid}>
        {/* KPI 1: Total Loss */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #ef4444" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Total Financial Loss</span>
            <span style={styles.kpiIcon}>💸</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#ef4444" }}>
            ₹{stats.totalLoss.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={styles.kpiSub}>Lifetime operational shrinkage expense</div>
        </div>

        {/* KPI 2: Today's Loss */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #f97316" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Today's Waste Loss</span>
            <span style={styles.kpiIcon}>📅</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#ea580c" }}>
            ₹{stats.todayLoss.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={styles.kpiSub}>{stats.todayQuantity} units recorded today</div>
        </div>

        {/* KPI 3: Month's Loss */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #8b5cf6" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>This Month's Loss</span>
            <span style={styles.kpiIcon}>📆</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#7c3aed" }}>
            ₹{stats.monthLoss.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={styles.kpiSub}>{stats.monthQuantity} units lost this month</div>
        </div>

        {/* KPI 4: Total Wasted Items */}
        <div style={{ ...styles.kpiCard, borderLeft: "4px solid #06b6d4" }}>
          <div style={styles.kpiTop}>
            <span style={styles.kpiLabel}>Total Units Wasted</span>
            <span style={styles.kpiIcon}>📦</span>
          </div>
          <div style={{ ...styles.kpiValue, color: "#0891b2" }}>
            {stats.totalQuantity.toLocaleString("en-IN")}
          </div>
          <div style={styles.kpiSub}>Across {wasteRecords.length} recorded incidents</div>
        </div>
      </div>

      {/* 2 VISUAL INSIGHTS CARDS */}
      <div style={styles.analyticsGrid}>
        {/* Analytics 1: Reason Breakdown */}
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

        {/* Analytics 2: Top Financial Loss Products (Pareto 80/20) */}
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
            placeholder="Search by product, ingredient, or reason..."
            style={styles.searchInput}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} style={styles.clearSearchBtn}>
              ✕
            </button>
          )}
        </div>

        {/* Reason Dropdown Filter */}
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

        {/* Item Type Dropdown Filter (for Restaurant) */}
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
      </div>

      {/* FILTER ACTIVE SUMMARY */}
      <div style={styles.filterSummary}>
        <span>
          Showing <strong>{filteredRecords.length}</strong> incidents (Filtered Total Loss:{" "}
          <strong style={{ color: "#ef4444" }}>₹{currentViewLoss.toFixed(2)}</strong>)
        </span>
      </div>

      {/* WASTE AUDIT LOG TABLE */}
      <div style={styles.tableCard}>
        {loading ? (
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
    backgroundColor: "#fee2e2",
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
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
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
};
