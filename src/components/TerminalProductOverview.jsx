import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../utils/firebase";
import { formatCurrency } from "../utils/terminalService";
import {
  buildOwnerProductOverview,
  calculateMultiTerminalProfitAndLoss,
  fetchAllTerminalsProductBundles,
} from "../utils/terminalProductService";

export default function TerminalProductOverview({
  shopId,
  terminals = [],
  shopProducts = [],
  salesList = [],
  wasteRecords = [],
  shopInventoryMode = "terminal_wise",
  primaryTerminalId = null,
  onOpenTerminalProducts,
}) {
  const [bundles, setBundles] = useState({
    assignmentsByTerminal: {},
    inventoryByTerminal: {},
    categoriesByTerminal: {},
  });
  const [loading, setLoading] = useState(false);

  // Filters
  const [pnlTimeframe, setPnlTimeframe] = useState("all"); // "today" | "week" | "month" | "all" | "custom"
  const [terminalFilter, setTerminalFilter] = useState("all");
  const [productQuery, setProductQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const loadBundles = useCallback(async () => {
    if (!shopId || terminals.length === 0) {
      setBundles({
        assignmentsByTerminal: {},
        inventoryByTerminal: {},
        categoriesByTerminal: {},
      });
      return;
    }
    setLoading(true);
    try {
      const data = await fetchAllTerminalsProductBundles(db, shopId, terminals);
      setBundles(data);
    } finally {
      setLoading(false);
    }
  }, [shopId, terminals]);

  useEffect(() => {
    if (!shopId || terminals.length === 0) return undefined;
    let cancelled = false;
    fetchAllTerminalsProductBundles(db, shopId, terminals).then((data) => {
      if (!cancelled) setBundles(data);
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, terminals]);

  const allCategoryNames = useMemo(() => {
    const set = new Set();
    shopProducts.forEach((p) => {
      if (p?.category) set.add(p.category);
    });
    Object.values(bundles.categoriesByTerminal).forEach((list) => {
      list.forEach((c) => {
        if (c?.name) set.add(c.name);
      });
    });
    Object.values(bundles.assignmentsByTerminal).forEach((list) => {
      list.forEach((a) => {
        if (a?.categoryName) set.add(a.categoryName);
      });
    });
    return Array.from(set).sort();
  }, [shopProducts, bundles]);

  const overview = useMemo(
    () =>
      buildOwnerProductOverview({
        terminals,
        shopProducts,
        assignmentsByTerminal: bundles.assignmentsByTerminal,
        inventoryByTerminal: bundles.inventoryByTerminal,
        categoriesByTerminal: bundles.categoriesByTerminal,
        salesList,
        filters: {
          terminalId: terminalFilter,
          productQuery,
          category: categoryFilter,
          startDate,
          endDate,
        },
        shopInventoryMode,
        primaryTerminalId,
      }),
    [
      terminals,
      shopProducts,
      bundles,
      salesList,
      terminalFilter,
      productQuery,
      categoryFilter,
      startDate,
      endDate,
      shopInventoryMode,
      primaryTerminalId,
    ]
  );

  const pnlReport = useMemo(
    () =>
      calculateMultiTerminalProfitAndLoss({
        terminals,
        salesList,
        wasteRecords,
        shopProducts,
        timeframe: startDate || endDate ? "custom" : pnlTimeframe,
        startDate,
        endDate,
      }),
    [terminals, salesList, wasteRecords, shopProducts, pnlTimeframe, startDate, endDate]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* ALL-TERMINALS CONSOLIDATED SALES & PROFIT / LOSS (P&L) STATEMENT */}
      <div style={styles.pnlCard}>
        <div style={styles.filterHeader}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16.5px", fontWeight: "900", color: "#0f172a" }}>
              💰 All Terminals Consolidated Sales &amp; Profit / Loss (P&amp;L)
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#475569" }}>
              Combined Sales, Item Cost (COGS), Waste/Damage Loss, and Net Profit/Loss across every terminal
            </p>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "today", label: "Today" },
              { id: "week", label: "7 Days" },
              { id: "month", label: "This Month" },
              { id: "all", label: "All Time" },
            ].map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                  setPnlTimeframe(tf.id);
                }}
                style={{
                  padding: "6px 11px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  backgroundColor:
                    !startDate && !endDate && pnlTimeframe === tf.id ? "#0f172a" : "#ffffff",
                  color:
                    !startDate && !endDate && pnlTimeframe === tf.id ? "#ffffff" : "#334155",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.kpiGrid}>
          <div style={{ ...styles.kpiCard, borderColor: "#bbf7d0", backgroundColor: "#f0fdf4" }}>
            <div style={styles.kpiLabel}>Combined Total Sales</div>
            <div style={{ ...styles.kpiValue, color: "#15803d" }}>
              {formatCurrency(pnlReport.totals.totalSales)}
            </div>
            <div style={styles.kpiSub}>
              {pnlReport.totals.totalOrders} bills • {pnlReport.totals.totalItemsSold} items sold
            </div>
          </div>

          <div style={styles.kpiCard}>
            <div style={styles.kpiLabel}>Cost of Goods / Making Cost</div>
            <div style={{ ...styles.kpiValue, color: "#334155" }}>
              {formatCurrency(pnlReport.totals.totalCogs)}
            </div>
            <div style={styles.kpiSub}>
              Tax: {formatCurrency(pnlReport.totals.totalTax)} • Disc:{" "}
              {formatCurrency(pnlReport.totals.totalDiscount)}
            </div>
          </div>

          <div style={styles.kpiCard}>
            <div style={styles.kpiLabel}>Waste / Spoilage Loss</div>
            <div style={{ ...styles.kpiValue, color: "#b91c1c" }}>
              {formatCurrency(pnlReport.totals.totalWasteLoss)}
            </div>
            <div style={styles.kpiSub}>
              Refunded/Cancelled:{" "}
              {formatCurrency(pnlReport.totals.refundedTotal + pnlReport.totals.cancelledTotal)}
            </div>
          </div>

          <div
            style={{
              ...styles.kpiCard,
              borderColor: pnlReport.totals.isNetProfit ? "#86efac" : "#fca5a5",
              backgroundColor: pnlReport.totals.isNetProfit ? "#ecfdf5" : "#fef2f2",
            }}
          >
            <div style={styles.kpiLabel}>
              Consolidated {pnlReport.totals.isNetProfit ? "Net Profit" : "Net Loss"}
            </div>
            <div
              style={{
                ...styles.kpiValue,
                color: pnlReport.totals.isNetProfit ? "#059669" : "#dc2626",
              }}
            >
              {pnlReport.totals.isNetProfit ? "+" : ""}
              {formatCurrency(pnlReport.totals.netProfitLoss)}
            </div>
            <div style={styles.kpiSub}>
              Margin: <strong>{pnlReport.totals.profitMarginPercent}%</strong>
            </div>
          </div>
        </div>

        {/* Per-Terminal Sales & Profit/Loss Table */}
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "12px" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Terminal</th>
                <th style={styles.th}>Bills</th>
                <th style={styles.th}>Sales</th>
                <th style={styles.th}>COGS / Cost</th>
                <th style={styles.th}>Waste Loss</th>
                <th style={styles.th}>Net Profit / Loss</th>
                <th style={styles.th}>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {pnlReport.byTerminal.map((row) => (
                <tr key={row.terminalId} style={styles.tr}>
                  <td style={styles.td}>
                    <strong>{row.terminalName}</strong>{" "}
                    <span style={styles.codePill}>{row.terminalCode}</span>
                  </td>
                  <td style={styles.td}>{row.ordersCount}</td>
                  <td style={{ ...styles.td, fontWeight: "800", color: "#0f172a" }}>
                    {formatCurrency(row.grossSales)}
                  </td>
                  <td style={styles.td}>{formatCurrency(row.cogs)}</td>
                  <td style={{ ...styles.td, color: row.wasteLoss > 0 ? "#dc2626" : "#64748b" }}>
                    {formatCurrency(row.wasteLoss)}
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      fontWeight: "900",
                      color: row.netProfitLoss >= 0 ? "#15803d" : "#dc2626",
                    }}
                  >
                    {row.netProfitLoss >= 0 ? "+" : ""}
                    {formatCurrency(row.netProfitLoss)}
                  </td>
                  <td style={styles.td}>{row.marginPercent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters Bar */}
      <div style={styles.filterCard}>
        <div style={styles.filterHeader}>
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
              📈 Consolidated Multi-Terminal Product &amp; Sales Overview
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
              Real-time overview across Independent (Model A) &amp; Shared (Model B) terminal catalogs
            </p>
          </div>
          <button type="button" onClick={loadBundles} disabled={loading} style={styles.refreshBtn}>
            {loading ? "Refreshing..." : "🔄 Refresh Overview"}
          </button>
        </div>

        <div style={styles.filterGrid}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Terminal</label>
            <select
              value={terminalFilter}
              onChange={(e) => setTerminalFilter(e.target.value)}
              style={styles.input}
            >
              <option value="all">All Terminals ({terminals.length})</option>
              {terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </select>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Product Search</label>
            <input
              type="text"
              placeholder="Filter by product name, SKU, barcode..."
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              style={styles.input}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={styles.input}
            >
              <option value="all">All Categories</option>
              {allCategoryNames.map((cname) => (
                <option key={cname} value={cname}>
                  {cname}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>From Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={styles.input}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>To Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={styles.input}
            />
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div style={styles.kpiGrid}>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Total Products Across Terminals</div>
          <div style={styles.kpiValue}>{overview.totalProductsAcrossTerminals}</div>
          <div style={styles.kpiSub}>Active + Assigned slots</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Independent Products (Model A)</div>
          <div style={{ ...styles.kpiValue, color: "#4338ca" }}>
            {overview.independentProductsCount}
          </div>
          <div style={styles.kpiSub}>Terminal-exclusive SKUs</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Shared Shop Products (Model B)</div>
          <div style={{ ...styles.kpiValue, color: "#0d9488" }}>
            {overview.sharedProductsCount}
          </div>
          <div style={styles.kpiSub}>Unique shop items shared</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Terminal Sales (Filtered)</div>
          <div style={{ ...styles.kpiValue, color: "#15803d" }}>
            {formatCurrency(overview.totalSales)}
          </div>
          <div style={styles.kpiSub}>{overview.totalOrders} bills</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Terminal Inventory Value</div>
          <div style={{ ...styles.kpiValue, color: "#0369a1" }}>
            {formatCurrency(overview.totalInventoryValue)}
          </div>
          <div style={styles.kpiSub}>Cost / Selling stock valuation</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Low Stock Alerts</div>
          <div
            style={{
              ...styles.kpiValue,
              color: overview.lowStockCount > 0 ? "#dc2626" : "#15803d",
            }}
          >
            {overview.lowStockCount}
          </div>
          <div style={styles.kpiSub}>Items at/below alert threshold</div>
        </div>
      </div>

      {/* Terminal-wise Breakdown Table */}
      <div style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <h4 style={{ margin: 0, fontSize: "14.5px", fontWeight: "800", color: "#0f172a" }}>
            🖥️ Terminal-wise Product Counts, Inventory Value &amp; Sales
          </h4>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Terminal</th>
                <th style={styles.th}>Floor</th>
                <th style={styles.th}>Products</th>
                <th style={styles.th}>Indep / Shared</th>
                <th style={styles.th}>Categories</th>
                <th style={styles.th}>Active / Inact</th>
                <th style={styles.th}>Inventory Value</th>
                <th style={styles.th}>Low Stock</th>
                <th style={styles.th}>Sales</th>
                <th style={styles.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {overview.terminalStats.map((row) => (
                <tr key={row.terminalId} style={styles.tr}>
                  <td style={styles.td}>
                    <strong>{row.terminalName}</strong>{" "}
                    <span style={styles.codePill}>{row.terminalCode}</span>
                  </td>
                  <td style={styles.td}>{row.floorName}</td>
                  <td style={styles.td}>
                    <strong>{row.productCount}</strong>
                  </td>
                  <td style={styles.td}>
                    <span style={{ color: "#4338ca", fontWeight: "700" }}>
                      {row.independentCount}
                    </span>{" "}
                    /{" "}
                    <span style={{ color: "#0d9488", fontWeight: "700" }}>{row.sharedCount}</span>
                  </td>
                  <td style={styles.td}>{row.categoryCount}</td>
                  <td style={styles.td}>
                    <span style={{ color: "#15803d", fontWeight: "700" }}>{row.activeCount}</span> /{" "}
                    <span style={{ color: "#64748b" }}>{row.inactiveCount}</span>
                  </td>
                  <td style={styles.td}>{formatCurrency(row.inventoryValue)}</td>
                  <td style={styles.td}>
                    <span
                      style={{
                        color: row.lowStockCount > 0 ? "#dc2626" : "#15803d",
                        fontWeight: "800",
                      }}
                    >
                      {row.lowStockCount}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <strong style={{ color: "#15803d" }}>{formatCurrency(row.salesTotal)}</strong>{" "}
                    <span style={{ fontSize: "11px", color: "#64748b" }}>
                      ({row.salesCount})
                    </span>
                  </td>
                  <td style={styles.td}>
                    {onOpenTerminalProducts && (
                      <button
                        type="button"
                        onClick={() => onOpenTerminalProducts(row.terminalId)}
                        style={styles.manageLinkBtn}
                      >
                        📦 Manage
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Low Stock Alerts List */}
      <div style={styles.tableCard}>
        <div style={styles.tableHeader}>
          <h4 style={{ margin: 0, fontSize: "14.5px", fontWeight: "800", color: "#991b1b" }}>
            ⚠️ Low Stock Alerts Across Terminals ({overview.lowStockAlerts.length})
          </h4>
        </div>
        {overview.lowStockAlerts.length === 0 ? (
          <div style={{ padding: "22px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
            All products across selected terminals are above their low-stock threshold.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Terminal</th>
                  <th style={styles.th}>Product</th>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Stock Type</th>
                  <th style={styles.th}>Remaining</th>
                  <th style={styles.th}>Alert Limit</th>
                  <th style={styles.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.lowStockAlerts.map((al, idx) => (
                  <tr key={`${al.terminalId}_${al.productId}_${idx}`} style={styles.tr}>
                    <td style={styles.td}>
                      <strong>{al.terminalName}</strong>
                    </td>
                    <td style={styles.td}>{al.productName}</td>
                    <td style={styles.td}>{al.category}</td>
                    <td style={styles.td}>
                      {al.stockMode === "shared" ? "🌐 Central Stock" : "🖥️ Terminal Stock"}
                    </td>
                    <td style={{ ...styles.td, color: "#dc2626", fontWeight: "800" }}>
                      {al.currentStock} {al.unit}
                    </td>
                    <td style={styles.td}>{al.lowStockAlert}</td>
                    <td style={styles.td}>
                      {onOpenTerminalProducts && (
                        <button
                          type="button"
                          onClick={() => onOpenTerminalProducts(al.terminalId)}
                          style={styles.manageLinkBtn}
                        >
                          ⚖️ Restock
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  pnlCard: {
    backgroundColor: "#ffffff",
    border: "1.5px solid #cbd5e1",
    borderRadius: "16px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  filterCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  filterHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  refreshBtn: {
    padding: "7px 12px",
    borderRadius: "9px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: "10px",
  },
  fieldGroup: { display: "flex", flexDirection: "column", gap: "4px" },
  label: { fontSize: "11px", fontWeight: "700", color: "#475569" },
  input: {
    padding: "8px 10px",
    borderRadius: "9px",
    border: "1px solid #cbd5e1",
    fontSize: "12.5px",
    outline: "none",
    backgroundColor: "#ffffff",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
    gap: "12px",
  },
  kpiCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "14px",
  },
  kpiLabel: { fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  kpiValue: { fontSize: "22px", fontWeight: "900", color: "#0f172a", marginTop: "4px" },
  kpiSub: { fontSize: "11px", color: "#64748b", marginTop: "2px" },
  tableCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    overflow: "hidden",
  },
  tableHeader: {
    padding: "14px 16px",
    borderBottom: "1px solid #e2e8f0",
    backgroundColor: "#f8fafc",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "12.5px" },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "1px solid #e2e8f0",
    color: "#475569",
    fontWeight: "800",
    backgroundColor: "#f8fafc",
  },
  tr: { borderBottom: "1px solid #f1f5f9" },
  td: { padding: "10px 12px", color: "#1e293b" },
  codePill: {
    fontSize: "10.5px",
    fontWeight: "800",
    backgroundColor: "#eef2ff",
    color: "#3730a3",
    padding: "2px 6px",
    borderRadius: "6px",
  },
  manageLinkBtn: {
    padding: "5px 10px",
    borderRadius: "8px",
    border: "1px solid #bfdbfe",
    backgroundColor: "#eff6ff",
    color: "#1d4ed8",
    fontSize: "11.5px",
    fontWeight: "700",
    cursor: "pointer",
  },
};
