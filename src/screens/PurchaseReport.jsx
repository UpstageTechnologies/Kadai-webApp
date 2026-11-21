import { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp
} from "firebase/firestore";
import { db, auth } from "../utils/firebase";

export default function PurchaseReport({ userProfile = {}, isRestaurant = false, isGlobalMode = false, onBack }) {
  // Mode: "restaurant" (Groceries & Ingredients) vs "shop" (Stock & Products)
  const [reportMode, setReportMode] = useState(() => (isRestaurant ? "restaurant" : "shop"));
  
  // Data states
  const [purchasesList, setPurchasesList] = useState([]);
  const [rawMaterialsList, setRawMaterialsList] = useState([]);
  const [shopProductsList, setShopProductsList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all"); // "all" | "today" | "week" | "month" | "custom"
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");

  // Add Purchase Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState("");
  const [formItemName, setFormItemName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUnit, setFormUnit] = useState("kg");
  const [formRate, setFormRate] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formBillNo, setFormBillNo] = useState("");
  const [formPaymentMode, setFormPaymentMode] = useState("Cash");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formNotes, setFormNotes] = useState("");

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
  const storeName = userProfile.storeName || "Upstage Kadai";

  // Auto-generate invoice number when modal opens
  const openNewPurchaseModal = () => {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    setFormBillNo(`PUR-${randomSuffix}`);
    setFormItemName("");
    setSelectedExistingId("");
    setFormCategory(reportMode === "restaurant" ? "Groceries" : "Stock");
    setFormQty("");
    setFormUnit(reportMode === "restaurant" ? "kg" : "pcs");
    setFormRate("");
    setFormSupplier("");
    setFormPaymentMode("Cash");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes("");
    setShowAddModal(true);
  };

  // 1. Listen to purchases collection
  useEffect(() => {
    if (!currentUid) return;

    // Listen to main purchases collection
    const purchasesRef = collection(db, "users", currentUid, "purchases");
    const unsubPurchases = onSnapshot(
      purchasesRef,
      (snapshot) => {
        const records = snapshot.docs.map((d) => {
          const data = d.data();
          const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : (data.date ? new Date(data.date) : (data.createdAt ? new Date(data.createdAt) : new Date()));
          return {
            id: d.id,
            ...data,
            parsedDate: createdAt,
            totalAmount: Number(data.totalAmount || data.total || 0),
            qty: Number(data.qty || data.quantity || 1),
            rate: Number(data.rate || data.purchasePrice || data.costPerUnit || 0)
          };
        });
        setPurchasesList(records);
        setLoading(false);
      },
      (err) => {
        console.warn("Purchases listener error:", err);
        setLoading(false);
      }
    );

    // 2. Listen to raw materials (restaurant groceries)
    const rawRef = collection(db, "users", currentUid, "raw_materials");
    const unsubRaw = onSnapshot(rawRef, (snapshot) => {
      const rows = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        costPerUnit: Number(d.data().costPerUnit || 0),
        stockQuantity: Number(d.data().stockQuantity || 0)
      }));
      setRawMaterialsList(rows);
    });

    // 3. Listen to shop inventory
    const inventoryCol = isGlobalMode ? "global_inventory" : "inventory";
    const invRef = collection(db, "users", currentUid, inventoryCol);
    const unsubInv = onSnapshot(invRef, (snapshot) => {
      const rows = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          itemName: data.name || data.itemName || "Unnamed Item",
          purchasePrice: Number(data.purchasePrice || data.costPrice || 0),
          quantity: Number(data.quantity || 0)
        };
      });
      setShopProductsList(rows);
    });

    return () => {
      unsubPurchases();
      unsubRaw();
      unsubInv();
    };
  }, [currentUid, isGlobalMode]);

  // Handle selecting an existing item from dropdown in Add Purchase modal
  const handleSelectExistingItem = (itemId) => {
    setSelectedExistingId(itemId);
    if (!itemId) {
      setFormItemName("");
      setFormRate("");
      return;
    }

    if (reportMode === "restaurant") {
      const found = rawMaterialsList.find((r) => r.id === itemId);
      if (found) {
        setFormItemName(found.name || "");
        setFormCategory(found.category || "Groceries");
        setFormUnit(found.unit || "kg");
        setFormRate(found.costPerUnit ? String(found.costPerUnit) : "");
        if (found.supplierName) setFormSupplier(found.supplierName);
      }
    } else {
      const found = shopProductsList.find((p) => p.id === itemId);
      if (found) {
        setFormItemName(found.itemName || found.name || "");
        setFormCategory(found.category || "Stock");
        setFormUnit(found.unitType || "pcs");
        setFormRate(found.purchasePrice ? String(found.purchasePrice) : "");
        if (found.supplierName) setFormSupplier(found.supplierName);
      }
    }
  };

  // Save new purchase record & update stock
  const handleSavePurchase = async (e) => {
    e.preventDefault();
    if (!currentUid) {
      alert("User not authenticated.");
      return;
    }

    const name = formItemName.trim();
    if (!name) {
      alert("Please enter item/grocery name.");
      return;
    }

    const qtyNum = parseFloat(formQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      alert("Please enter a valid quantity greater than 0.");
      return;
    }

    const rateNum = parseFloat(formRate);
    if (isNaN(rateNum) || rateNum < 0) {
      alert("Please enter a valid rate/cost per unit.");
      return;
    }

    const totalAmt = Number((qtyNum * rateNum).toFixed(2));
    setSavingPurchase(true);

    try {
      // 1. Create Purchase record in Firestore
      const purchaseData = {
        billNo: formBillNo.trim() || `PUR-${Date.now().toString().slice(-6)}`,
        invoiceId: formBillNo.trim() || `PUR-${Date.now().toString().slice(-6)}`,
        itemName: name,
        category: formCategory.trim() || (reportMode === "restaurant" ? "Groceries" : "Stock"),
        type: reportMode, // "restaurant" | "shop"
        qty: qtyNum,
        unit: formUnit.trim() || "unit",
        rate: rateNum,
        purchasePrice: rateNum,
        totalAmount: totalAmt,
        supplierName: formSupplier.trim() || "Market / Vendor",
        paymentMode: formPaymentMode,
        purchaseDate: formDate,
        date: formDate,
        notes: formNotes.trim(),
        createdAt: serverTimestamp(),
        recordedBy: userProfile.name || "Owner"
      };

      await addDoc(collection(db, "users", currentUid, "purchases"), purchaseData);

      // Also record in mobile-compatible invoices collection for shops
      if (reportMode === "shop") {
        const invoicesCol = isGlobalMode ? "global_invoices" : "invoices";
        await addDoc(collection(db, "users", currentUid, invoicesCol), {
          billNo: purchaseData.billNo,
          invoiceId: purchaseData.billNo,
          supplierName: purchaseData.supplierName,
          paymentMode: formPaymentMode,
          items: [
            {
              itemName: name,
              purchasePrice: rateNum,
              qty: qtyNum,
              unitType: formUnit.trim() || "pcs"
            }
          ],
          total: totalAmt,
          createdAt: serverTimestamp()
        });
      }

      // 2. Automatically update or create stock in inventory / raw materials
      if (reportMode === "restaurant") {
        // Find if raw material already exists
        let existingRaw = selectedExistingId ? rawMaterialsList.find((r) => r.id === selectedExistingId) : null;
        if (!existingRaw) {
          existingRaw = rawMaterialsList.find((r) => r.name?.toLowerCase().trim() === name.toLowerCase());
        }

        if (existingRaw) {
          const newStock = Number(((Number(existingRaw.stockQuantity) || 0) + qtyNum).toFixed(2));
          await updateDoc(doc(db, "users", currentUid, "raw_materials", existingRaw.id), {
            stockQuantity: newStock,
            costPerUnit: rateNum,
            supplierName: formSupplier.trim() || existingRaw.supplierName || "",
            updatedAtMs: Date.now()
          });
        } else {
          // Add new raw material entry
          await addDoc(collection(db, "users", currentUid, "raw_materials"), {
            name: name,
            category: formCategory.trim() || "Groceries",
            unit: formUnit.trim() || "kg",
            costPerUnit: rateNum,
            stockQuantity: qtyNum,
            minStockAlert: 5,
            supplierName: formSupplier.trim() || "Market / Vendor",
            createdAtMs: Date.now(),
            updatedAtMs: Date.now()
          });
        }
      } else {
        // Shop inventory mode
        const invCol = isGlobalMode ? "global_inventory" : "inventory";
        let existingProd = selectedExistingId ? shopProductsList.find((p) => p.id === selectedExistingId) : null;
        if (!existingProd) {
          existingProd = shopProductsList.find((p) => (p.itemName || p.name)?.toLowerCase().trim() === name.toLowerCase());
        }

        if (existingProd) {
          const newStock = Number(((Number(existingProd.quantity) || 0) + qtyNum).toFixed(2));
          await updateDoc(doc(db, "users", currentUid, invCol, existingProd.id), {
            quantity: newStock,
            purchasePrice: rateNum,
            supplierName: formSupplier.trim() || existingProd.supplierName || "",
            updatedAt: serverTimestamp()
          });
        } else {
          await addDoc(collection(db, "users", currentUid, invCol), {
            name: name,
            itemName: name,
            category: formCategory.trim() || "General",
            unitType: formUnit.trim() || "pcs",
            purchasePrice: rateNum,
            salesPrice: Number((rateNum * 1.25).toFixed(2)),
            price: Number((rateNum * 1.25).toFixed(2)),
            quantity: qtyNum,
            supplierName: formSupplier.trim() || "Vendor",
            createdAt: serverTimestamp()
          });
        }
      }

      setSavingPurchase(false);
      setShowAddModal(false);
      alert(`✅ Purchase of ₹${totalAmt.toLocaleString("en-IN")} recorded successfully!\nStock for "${name}" increased by +${qtyNum} ${formUnit}.`);
    } catch (err) {
      console.error("Save purchase error:", err);
      setSavingPurchase(false);
      alert("Error saving purchase: " + err.message);
    }
  };

  // Combine actual purchase records + stock valuation items
  const combinedRecords = useMemo(() => {
    // 1. Records from purchases collection matching active mode
    const modePurchases = purchasesList.filter((p) => {
      if (!p.type) return true; // generic purchase applies to both
      return p.type === reportMode;
    });

    // If no purchase records yet, generate initial stock view entries so user has full visibility of current inventory purchase value
    if (modePurchases.length === 0) {
      if (reportMode === "restaurant") {
        return rawMaterialsList.map((r) => ({
          id: `stock-${r.id}`,
          billNo: "INITIAL-STOCK",
          itemName: r.name || "Raw Material",
          category: r.category || "Groceries",
          type: "restaurant",
          qty: Number(r.stockQuantity || 0),
          unit: r.unit || "kg",
          rate: Number(r.costPerUnit || 0),
          totalAmount: Number(((Number(r.stockQuantity) || 0) * (Number(r.costPerUnit) || 0)).toFixed(2)),
          supplierName: r.supplierName || "Local Market",
          paymentMode: "Stock On Hand",
          purchaseDate: r.updatedAtMs ? new Date(r.updatedAtMs).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          parsedDate: r.updatedAtMs ? new Date(r.updatedAtMs) : new Date(),
          isStockOnHand: true
        }));
      } else {
        return shopProductsList.map((p) => ({
          id: `stock-${p.id}`,
          billNo: "INITIAL-STOCK",
          itemName: p.itemName || p.name || "Stock Item",
          category: p.category || "Stock",
          type: "shop",
          qty: Number(p.quantity || 0),
          unit: p.unitType || "pcs",
          rate: Number(p.purchasePrice || 0),
          totalAmount: Number(((Number(p.quantity) || 0) * (Number(p.purchasePrice) || 0)).toFixed(2)),
          supplierName: p.supplierName || "Direct Purchase",
          paymentMode: "Stock On Hand",
          purchaseDate: new Date().toISOString().slice(0, 10),
          parsedDate: new Date(),
          isStockOnHand: true
        }));
      }
    }

    return modePurchases;
  }, [purchasesList, rawMaterialsList, shopProductsList, reportMode]);

  // Filtered Records based on search, date range, and payment mode
  const filteredRecords = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    return combinedRecords.filter((rec) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (rec.itemName || "").toLowerCase().includes(q);
        const matchSupplier = (rec.supplierName || "").toLowerCase().includes(q);
        const matchBill = (rec.billNo || "").toLowerCase().includes(q);
        const matchCat = (rec.category || "").toLowerCase().includes(q);
        if (!matchName && !matchSupplier && !matchBill && !matchCat) return false;
      }

      // 2. Payment Mode Filter
      if (paymentFilter !== "all" && rec.paymentMode !== paymentFilter) {
        return false;
      }

      // 3. Date Filter
      const recDate = rec.parsedDate instanceof Date && !isNaN(rec.parsedDate) ? rec.parsedDate : new Date(rec.purchaseDate || Date.now());
      const recDateStr = recDate.toISOString().slice(0, 10);

      if (dateFilter === "today") {
        return recDateStr === todayStr;
      } else if (dateFilter === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return recDate >= weekAgo;
      } else if (dateFilter === "month") {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return recDate >= monthAgo;
      } else if (dateFilter === "custom") {
        if (customStartDate && recDateStr < customStartDate) return false;
        if (customEndDate && recDateStr > customEndDate) return false;
      }

      return true;
    }).sort((a, b) => (b.parsedDate || 0) - (a.parsedDate || 0));
  }, [combinedRecords, searchQuery, dateFilter, customStartDate, customEndDate, paymentFilter]);

  // Summary Metrics
  const summary = useMemo(() => {
    let totalSpend = 0;
    let totalQty = 0;
    const suppliersSet = new Set();
    const itemsSet = new Set();

    filteredRecords.forEach((r) => {
      totalSpend += Number(r.totalAmount || 0);
      totalQty += Number(r.qty || 0);
      if (r.supplierName) suppliersSet.add(r.supplierName.trim().toLowerCase());
      if (r.itemName) itemsSet.add(r.itemName.trim().toLowerCase());
    });

    return {
      totalSpend: Math.round(totalSpend),
      totalQty: Number(totalQty.toFixed(1)),
      itemCount: itemsSet.size,
      supplierCount: suppliersSet.size
    };
  }, [filteredRecords]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) {
      alert("No purchase records to export.");
      return;
    }

    const headers = [
      "Invoice/Bill No",
      "Date",
      "Item / Grocery Name",
      "Type",
      "Category",
      "Quantity",
      "Unit",
      "Rate (INR)",
      "Total Amount (INR)",
      "Supplier",
      "Payment Mode",
      "Notes"
    ];

    const rows = filteredRecords.map((r) => [
      `"${(r.billNo || "").replace(/"/g, '""')}"`,
      r.purchaseDate || (r.parsedDate ? r.parsedDate.toISOString().slice(0, 10) : ""),
      `"${(r.itemName || "").replace(/"/g, '""')}"`,
      r.type === "restaurant" ? "Restaurant Grocery" : "Shop Stock",
      `"${(r.category || "").replace(/"/g, '""')}"`,
      r.qty || 0,
      r.unit || "unit",
      Number(r.rate || 0).toFixed(2),
      Number(r.totalAmount || 0).toFixed(2),
      `"${(r.supplierName || "").replace(/"/g, '""')}"`,
      `"${(r.paymentMode || "").replace(/"/g, '""')}"`,
      `"${(r.notes || "").replace(/"/g, '""')}"`
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const fileName = `Purchase_Report_${reportMode}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print Report
  const handlePrint = () => {
    window.print();
  };

  return (
    <div style={styles.container}>
      {/* Printable Report Header (visible only when printing) */}
      <div className="print-only" style={{ display: "none" }}>
        <div style={{ textAlign: "center", marginBottom: "20px" }}>
          <h1 style={{ fontSize: "22px", margin: "0 0 4px" }}>{storeName}</h1>
          <h2 style={{ fontSize: "16px", color: "#475569", margin: "0 0 6px" }}>
            {reportMode === "restaurant" ? "RESTAURANT GROCERIES & FOOD INGREDIENTS PURCHASE REPORT" : "SHOP STOCK & PRODUCTS PURCHASE REPORT"}
          </h2>
          <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
            Generated on: {new Date().toLocaleString("en-IN")} | Total Spend: ₹{summary.totalSpend.toLocaleString("en-IN")}
          </p>
        </div>
      </div>

      {/* Screen Top Bar */}
      <div className="no-print" style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn} title="Return to POS Billing">
              ← Back
            </button>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>📊</span>
              <h1 style={styles.title}>
                {reportMode === "restaurant" ? "Restaurant Grocery Purchase Report" : "Shop Stock Purchase Report"}
              </h1>
              <span style={{
                ...styles.modeBadge,
                backgroundColor: reportMode === "restaurant" ? "#fef3c7" : "#e0e7ff",
                color: reportMode === "restaurant" ? "#b45309" : "#4338ca",
                border: `1px solid ${reportMode === "restaurant" ? "#fde68a" : "#c7d2fe"}`
              }}>
                {reportMode === "restaurant" ? "🥘 Groceries & Kitchen Supplies" : "🏪 Shop Stock & Retail"}
              </span>
            </div>
            <p style={styles.subtitle}>
              {reportMode === "restaurant"
                ? "Track food ingredients, groceries, spices & raw materials purchased to prepare dishes"
                : "Track retail goods, inventory stocks & supplier purchases with date-wise reports"}
            </p>
          </div>
        </div>

        {/* Action Buttons: Add Purchase, Print & Export */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={openNewPurchaseModal} style={styles.recordBtn}>
            <span style={{ fontSize: "15px" }}>➕</span>
            <span>Record Purchase</span>
          </button>
          <button type="button" onClick={handlePrint} style={styles.printBtn}>
            <span style={{ fontSize: "15px" }}>🖨️</span>
            <span>Print Report</span>
          </button>
          <button type="button" onClick={handleExportCsv} style={styles.exportBtn}>
            <span style={{ fontSize: "15px" }}>📥</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs: Restaurant Groceries vs Shop Stock */}
      <div className="no-print" style={styles.modeTabsWrapper}>
        <button
          type="button"
          onClick={() => setReportMode("restaurant")}
          style={{
            ...styles.modeTab,
            backgroundColor: reportMode === "restaurant" ? "#16a34a" : "#ffffff",
            color: reportMode === "restaurant" ? "#ffffff" : "#475569",
            borderColor: reportMode === "restaurant" ? "#16a34a" : "#e2e8f0"
          }}
        >
          <span style={{ fontSize: "16px" }}>🥘</span>
          <span style={{ fontWeight: "700" }}>Restaurant Groceries & Food Ingredients</span>
          <span style={{
            fontSize: "11px",
            padding: "2px 8px",
            borderRadius: "12px",
            backgroundColor: reportMode === "restaurant" ? "rgba(255,255,255,0.25)" : "#f1f5f9",
            color: reportMode === "restaurant" ? "#ffffff" : "#64748b"
          }}>
            {rawMaterialsList.length} Items
          </span>
        </button>

        <button
          type="button"
          onClick={() => setReportMode("shop")}
          style={{
            ...styles.modeTab,
            backgroundColor: reportMode === "shop" ? "#4f46e5" : "#ffffff",
            color: reportMode === "shop" ? "#ffffff" : "#475569",
            borderColor: reportMode === "shop" ? "#4f46e5" : "#e2e8f0"
          }}
        >
          <span style={{ fontSize: "16px" }}>🏪</span>
          <span style={{ fontWeight: "700" }}>Shop Inventory & Product Stocks</span>
          <span style={{
            fontSize: "11px",
            padding: "2px 8px",
            borderRadius: "12px",
            backgroundColor: reportMode === "shop" ? "rgba(255,255,255,0.25)" : "#f1f5f9",
            color: reportMode === "shop" ? "#ffffff" : "#64748b"
          }}>
            {shopProductsList.length} Items
          </span>
        </button>
      </div>

      {/* Summary Stat Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Total Purchase Expenditure</span>
            <span style={{ fontSize: "20px" }}>💰</span>
          </div>
          <div style={styles.statValue}>₹{summary.totalSpend.toLocaleString("en-IN")}</div>
          <div style={styles.statSub}>For selected period & filters</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>{reportMode === "restaurant" ? "Groceries / Ingredients" : "Stock Items"}</span>
            <span style={{ fontSize: "20px" }}>📦</span>
          </div>
          <div style={styles.statValue}>{summary.itemCount}</div>
          <div style={styles.statSub}>Unique items purchased</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Total Quantity Purchased</span>
            <span style={{ fontSize: "20px" }}>⚖️</span>
          </div>
          <div style={styles.statValue}>{summary.totalQty}</div>
          <div style={styles.statSub}>{reportMode === "restaurant" ? "Kilograms / Litres / Units" : "Total Product Units"}</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Active Suppliers / Vendors</span>
            <span style={{ fontSize: "20px" }}>🚚</span>
          </div>
          <div style={styles.statValue}>{summary.supplierCount}</div>
          <div style={styles.statSub}>Suppliers in selected records</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="no-print" style={styles.filterCard}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: "220px" }}>
          <label style={styles.filterLabel}>Search Records</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={reportMode === "restaurant" ? "Search grocery, milk, chicken, supplier, bill..." : "Search product, stock, supplier, invoice..."}
            style={styles.searchInput}
          />
        </div>

        {/* Date Filter Pills */}
        <div>
          <label style={styles.filterLabel}>Date Range</label>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All Time" },
              { id: "today", label: "Today" },
              { id: "week", label: "Past 7 Days" },
              { id: "month", label: "This Month" },
              { id: "custom", label: "Custom Date" }
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDateFilter(d.id)}
                style={{
                  ...styles.datePill,
                  backgroundColor: dateFilter === d.id ? "#0f172a" : "#f8fafc",
                  color: dateFilter === d.id ? "#ffffff" : "#475569",
                  borderColor: dateFilter === d.id ? "#0f172a" : "#cbd5e1"
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Inputs if custom is selected */}
        {dateFilter === "custom" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div>
              <label style={styles.filterLabel}>From Date</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={styles.dateInput}
              />
            </div>
            <div>
              <label style={styles.filterLabel}>To Date</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={styles.dateInput}
              />
            </div>
          </div>
        )}

        {/* Payment Filter */}
        <div>
          <label style={styles.filterLabel}>Payment Mode</label>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            style={styles.selectInput}
          >
            <option value="all">All Payment Modes</option>
            <option value="Cash">Cash</option>
            <option value="UPI">UPI / Online</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Credit">Credit / Unpaid</option>
            <option value="Stock On Hand">Stock On Hand</option>
          </select>
        </div>
      </div>

      {/* Purchase Records Table */}
      <div style={styles.tableCard}>
        <div style={styles.tableHeaderBar}>
          <div style={{ fontWeight: "800", fontSize: "14px", color: "#1e293b" }}>
            {reportMode === "restaurant" ? "Grocery Purchase Invoices & Stock Log" : "Stock Purchase Invoices & Product Log"}
            <span style={{ marginLeft: "8px", color: "#64748b", fontWeight: "600", fontSize: "12px" }}>
              ({filteredRecords.length} records found)
            </span>
          </div>
          {filteredRecords.length > 0 && (
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
              Total: <span style={{ color: "#16a34a" }}>₹{summary.totalSpend.toLocaleString("en-IN")}</span>
            </div>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.thRow}>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Bill / Invoice</th>
                <th style={styles.th}>{reportMode === "restaurant" ? "Grocery / Ingredient" : "Product / Stock"}</th>
                <th style={styles.th}>Category</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Quantity</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Rate (₹)</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Total (₹)</th>
                <th style={styles.th}>Supplier</th>
                <th style={styles.th}>Payment</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    Loading purchase records...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>
                    <div style={{ fontSize: "36px", marginBottom: "10px" }}>🛒</div>
                    <div style={{ fontWeight: "700", fontSize: "15px", color: "#334155" }}>
                      No purchase records found
                    </div>
                    <div style={{ fontSize: "12.5px", marginTop: "4px" }}>
                      Click <strong>"+ Record Purchase"</strong> above to log your groceries or stock purchases!
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r, idx) => (
                  <tr key={r.id || idx} style={idx % 2 === 0 ? styles.trEven : styles.trOdd}>
                    <td style={styles.td}>
                      {r.purchaseDate || (r.parsedDate ? r.parsedDate.toLocaleDateString("en-IN") : "-")}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.billBadge}>{r.billNo || "PUR-BILL"}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: "700", color: "#0f172a" }}>{r.itemName}</div>
                      {r.notes && <div style={{ fontSize: "10.5px", color: "#64748b" }}>{r.notes}</div>}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.catBadge}>{r.category || (reportMode === "restaurant" ? "Grocery" : "Stock")}</span>
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: "700" }}>
                      {r.qty} {r.unit || "unit"}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", color: "#475569" }}>
                      ₹{Number(r.rate || 0).toFixed(2)}
                    </td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: "800", color: "#16a34a" }}>
                      ₹{Number(r.totalAmount || 0).toLocaleString("en-IN")}
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: "600", color: "#334155" }}>{r.supplierName || "Direct Vendor"}</div>
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.payBadge,
                        backgroundColor: r.paymentMode === "Cash" ? "#f0fdf4" : r.paymentMode === "UPI" ? "#eff6ff" : r.paymentMode === "Credit" ? "#fef2f2" : "#f8fafc",
                        color: r.paymentMode === "Cash" ? "#166534" : r.paymentMode === "UPI" ? "#1e40af" : r.paymentMode === "Credit" ? "#991b1b" : "#475569",
                        borderColor: r.paymentMode === "Cash" ? "#bbf7d0" : r.paymentMode === "UPI" ? "#bfdbfe" : r.paymentMode === "Credit" ? "#fecaca" : "#e2e8f0"
                      }}>
                        {r.paymentMode || "Cash"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredRecords.length > 0 && (
              <tfoot>
                <tr style={{ backgroundColor: "#f8fafc", borderTop: "2px solid #cbd5e1", fontWeight: "800" }}>
                  <td colSpan="4" style={{ padding: "12px 16px", color: "#1e293b", textAlign: "right" }}>
                    Grand Total ({filteredRecords.length} entries):
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", color: "#0f172a" }}>
                    {summary.totalQty} Units
                  </td>
                  <td style={{ padding: "12px 16px" }}></td>
                  <td style={{ padding: "12px 16px", textAlign: "right", color: "#16a34a", fontSize: "15px" }}>
                    ₹{summary.totalSpend.toLocaleString("en-IN")}
                  </td>
                  <td colSpan="2" style={{ padding: "12px 16px" }}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* RECORD PURCHASE MODAL */}
      {showAddModal && (
        <div style={styles.modalOverlay} onClick={() => !savingPurchase && setShowAddModal(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: "800", color: "#0f172a" }}>
                  {reportMode === "restaurant" ? "Record Restaurant Grocery Purchase" : "Record Shop Stock Purchase"}
                </h3>
                <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                  {reportMode === "restaurant"
                    ? "Add food groceries, milk, vegetables, chicken, spices. Automatically increases kitchen raw material stock!"
                    : "Add retail inventory purchase invoice. Automatically increases shop product stock!"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={styles.closeBtn}
                disabled={savingPurchase}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePurchase} style={{ padding: "20px" }}>
              {/* Existing item picker */}
              <div style={{ marginBottom: "14px" }}>
                <label style={styles.modalLabel}>
                  {reportMode === "restaurant" ? "Select Existing Grocery (or enter new below)" : "Select Existing Product (or enter new below)"}
                </label>
                <select
                  value={selectedExistingId}
                  onChange={(e) => handleSelectExistingItem(e.target.value)}
                  style={styles.modalInput}
                >
                  <option value="">-- Choose Existing Item to Restock / Repurchase --</option>
                  {reportMode === "restaurant"
                    ? rawMaterialsList.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} (Current Stock: {r.stockQuantity} {r.unit} | Cost: ₹{r.costPerUnit})
                        </option>
                      ))
                    : shopProductsList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.itemName || p.name} (Stock: {p.quantity} {p.unitType || "pcs"} | Cost: ₹{p.purchasePrice})
                        </option>
                      ))}
                </select>
              </div>

              {/* Item Name & Category */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>
                    {reportMode === "restaurant" ? "Grocery / Ingredient Name *" : "Item / Product Name *"}
                  </label>
                  <input
                    type="text"
                    required
                    value={formItemName}
                    onChange={(e) => setFormItemName(e.target.value)}
                    placeholder={reportMode === "restaurant" ? "e.g. Buffalo Milk, Tomatoes, Chicken" : "e.g. Biscuits 500g, Shampoo, Soft Drink"}
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Category</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    placeholder={reportMode === "restaurant" ? "Dairy, Veg, Meat, Grains..." : "Snacks, Drinks, General..."}
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Quantity, Unit & Rate */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Quantity Purchased *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={formQty}
                    onChange={(e) => setFormQty(e.target.value)}
                    placeholder="e.g. 10"
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Unit Type</label>
                  <select
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    style={styles.modalInput}
                  >
                    <option value="kg">kg (Kilogram)</option>
                    <option value="litre">litre (L)</option>
                    <option value="gm">gm (Grams)</option>
                    <option value="pcs">pcs (Pieces)</option>
                    <option value="packet">packet</option>
                    <option value="box">box</option>
                    <option value="bottle">bottle</option>
                  </select>
                </div>
                <div>
                  <label style={styles.modalLabel}>Rate / Unit Cost (₹) *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={formRate}
                    onChange={(e) => setFormRate(e.target.value)}
                    placeholder="e.g. 60"
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Estimated Total Calculation */}
              {formQty && formRate && !isNaN(parseFloat(formQty)) && !isNaN(parseFloat(formRate)) && (
                <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12.5px", color: "#166534", fontWeight: "700" }}>Total Purchase Amount:</span>
                  <span style={{ fontSize: "16px", color: "#16a34a", fontWeight: "900" }}>
                    ₹{(parseFloat(formQty) * parseFloat(formRate)).toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              {/* Supplier & Bill No */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Supplier / Vendor Name</label>
                  <input
                    type="text"
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    placeholder="e.g. Metro Cash & Carry, Sakthi Traders"
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Invoice / Bill Number</label>
                  <input
                    type="text"
                    value={formBillNo}
                    onChange={(e) => setFormBillNo(e.target.value)}
                    placeholder="PUR-123456"
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Payment Mode & Date */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Payment Mode</label>
                  <select
                    value={formPaymentMode}
                    onChange={(e) => setFormPaymentMode(e.target.value)}
                    style={styles.modalInput}
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI / GPay / PhonePe</option>
                    <option value="Bank Transfer">Bank Transfer / NEFT</option>
                    <option value="Credit">Credit (Pay Later)</option>
                  </select>
                </div>
                <div>
                  <label style={styles.modalLabel}>Purchase Date</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Optional Notes */}
              <div style={{ marginBottom: "20px" }}>
                <label style={styles.modalLabel}>Notes / Remarks (Optional)</label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="e.g. Fresh stock for weekend festival"
                  style={styles.modalInput}
                />
              </div>

              {/* Modal Action Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={savingPurchase}
                  style={styles.modalCancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPurchase}
                  style={styles.modalSubmitBtn}
                >
                  {savingPurchase ? "Saving..." : "Save Purchase & Update Stock"}
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
    maxWidth: "1400px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "system-ui, -apple-system, sans-serif"
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    flexWrap: "wrap",
    gap: "14px"
  },
  backBtn: {
    padding: "7px 12px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "4px"
  },
  title: {
    fontSize: "20px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0
  },
  subtitle: {
    fontSize: "12.5px",
    color: "#64748b",
    margin: "4px 0 0"
  },
  modeBadge: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "8px"
  },
  recordBtn: {
    padding: "8px 16px",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)"
  },
  printBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#334155",
    border: "1.5px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  exportBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#4f46e5",
    border: "1.5px solid #c7d2fe",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  modeTabsWrapper: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
    flexWrap: "wrap"
  },
  modeTab: {
    padding: "10px 18px",
    border: "1.5px solid",
    borderRadius: "10px",
    fontSize: "13.5px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    transition: "all 0.15s ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
    marginBottom: "20px"
  },
  statCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "16px 18px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
  },
  statHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px"
  },
  statLabel: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.4px"
  },
  statValue: {
    fontSize: "22px",
    fontWeight: "900",
    color: "#0f172a",
    marginBottom: "2px"
  },
  statSub: {
    fontSize: "11px",
    color: "#94a3b8"
  },
  filterCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "16px 18px",
    border: "1px solid #e2e8f0",
    marginBottom: "20px",
    display: "flex",
    alignItems: "flex-end",
    gap: "16px",
    flexWrap: "wrap",
    boxShadow: "0 1px 3px rgba(0,0,0,0.02)"
  },
  filterLabel: {
    display: "block",
    fontSize: "11.5px",
    fontWeight: "700",
    color: "#475569",
    marginBottom: "6px"
  },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    color: "#1e293b",
    outline: "none"
  },
  datePill: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.15s ease"
  },
  dateInput: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12px",
    color: "#1e293b",
    outline: "none"
  },
  selectInput: {
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12.5px",
    color: "#1e293b",
    backgroundColor: "#ffffff",
    outline: "none",
    minWidth: "150px"
  },
  tableCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
  },
  tableHeaderBar: {
    padding: "14px 18px",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    textAlign: "left"
  },
  thRow: {
    backgroundColor: "#f1f5f9",
    borderBottom: "1px solid #cbd5e1"
  },
  th: {
    padding: "10px 14px",
    fontWeight: "700",
    color: "#475569",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.3px"
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155"
  },
  trOdd: {
    backgroundColor: "#ffffff"
  },
  trEven: {
    backgroundColor: "#f8fafc"
  },
  billBadge: {
    padding: "2px 7px",
    borderRadius: "6px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    fontSize: "11px",
    fontWeight: "700",
    border: "1px solid #e2e8f0"
  },
  catBadge: {
    padding: "2px 7px",
    borderRadius: "6px",
    backgroundColor: "#e0f2fe",
    color: "#0369a1",
    fontSize: "11px",
    fontWeight: "700"
  },
  payBadge: {
    padding: "2px 7px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: "700",
    border: "1px solid"
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "16px"
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    maxWidth: "580px",
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
    overflow: "hidden",
    maxHeight: "92vh",
    overflowY: "auto"
  },
  modalHeader: {
    padding: "16px 20px",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    fontSize: "18px",
    color: "#94a3b8",
    cursor: "pointer",
    padding: "2px 6px",
    fontWeight: "800"
  },
  modalLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
    marginBottom: "5px"
  },
  modalInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    color: "#1e293b",
    outline: "none"
  },
  modalCancelBtn: {
    padding: "8px 16px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    color: "#475569",
    cursor: "pointer"
  },
  modalSubmitBtn: {
    padding: "8px 20px",
    backgroundColor: "#16a34a",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "800",
    color: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.3)"
  }
};
