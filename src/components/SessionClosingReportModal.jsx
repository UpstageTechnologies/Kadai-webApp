import { formatCurrency, formatDateTime } from "../utils/terminalService";

export default function SessionClosingReportModal({
  session,
  storeName = "Kadai Pro Store",
  onClose,
}) {
  if (!session) return null;

  const openingCash = Number(session.openingCash || 0);
  const cashSales = Number(session.totalCashSales || 0);
  const upiSales = Number(session.totalUpiSales || 0);
  const cardSales = Number(session.totalCardSales || 0);
  const creditSales = Number(session.totalCreditSales || 0);
  const totalRefunds = Number(session.totalRefunds || 0);
  const cashRefunds = Number(session.totalCashRefunds || 0);
  const totalCancellations = Number(session.totalCancellations || 0);
  const totalSales = Number(
    session.totalSales ?? cashSales + upiSales + cardSales + creditSales
  );
  const expectedCash = Number(
    session.expectedClosingCash ?? openingCash + cashSales - cashRefunds
  );
  const hasActual =
    session.actualClosingCash !== null && session.actualClosingCash !== undefined;
  const actualCash = hasActual ? Number(session.actualClosingCash) : null;
  const diff =
    hasActual && session.cashDifference !== null && session.cashDifference !== undefined
      ? Number(session.cashDifference)
      : hasActual
      ? Number((actualCash - expectedCash).toFixed(2))
      : null;

  const diffStatus =
    diff === null
      ? { label: "Pending Close", color: "#64748b", bg: "#f1f5f9" }
      : Math.abs(diff) < 0.01
      ? { label: "Exact Match ✓", color: "#15803d", bg: "#dcfce7" }
      : diff > 0
      ? { label: `Excess (+${formatCurrency(diff)})`, color: "#0369a1", bg: "#e0f2fe" }
      : { label: `Shortage (${formatCurrency(diff)})`, color: "#dc2626", bg: "#fee2e2" };

  const handlePrintReport = () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Session Closing Report - ${session.terminalCode || session.terminalName}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; padding: 24px; max-width: 480px; margin: 0 auto; }
            h2 { margin: 0 0 4px 0; font-size: 18px; text-align: center; }
            .sub { text-align: center; font-size: 12px; color: #64748b; margin-bottom: 16px; }
            .box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
            .row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
            .row:last-child { border-bottom: none; }
            .bold { font-weight: 800; }
            .title { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 6px; letter-spacing: 0.5px; }
          </style>
        </head>
        <body>
          <h2>${storeName}</h2>
          <div class="sub">POS TERMINAL SESSION CLOSING REPORT (Z-REPORT)</div>
          <div class="box">
            <div class="title">Terminal &amp; Staff Details</div>
            <div class="row"><span>Floor</span><span class="bold">${session.floorName || "—"}</span></div>
            <div class="row"><span>Terminal</span><span class="bold">${session.terminalName || "—"} (${session.terminalCode || "—"})</span></div>
            <div class="row"><span>Opened By</span><span>${session.staffName || "—"}</span></div>
            <div class="row"><span>Opened At</span><span>${formatDateTime(session.openedAt || session.openedAtMs)}</span></div>
            <div class="row"><span>Closed By</span><span>${session.closingStaffName || "—"}</span></div>
            <div class="row"><span>Closed At</span><span>${formatDateTime(session.closedAt || session.closedAtMs)}</span></div>
            <div class="row"><span>Transactions</span><span class="bold">${session.transactionCount || 0}</span></div>
          </div>
          <div class="box">
            <div class="title">Sales &amp; Payment Breakdown</div>
            <div class="row"><span>Cash Sales</span><span>${formatCurrency(cashSales)}</span></div>
            <div class="row"><span>UPI Sales</span><span>${formatCurrency(upiSales)}</span></div>
            <div class="row"><span>Card Sales</span><span>${formatCurrency(cardSales)}</span></div>
            <div class="row"><span>Credit / Khata Sales</span><span>${formatCurrency(creditSales)}</span></div>
            <div class="row bold"><span>Total Gross Sales</span><span>${formatCurrency(totalSales)}</span></div>
            <div class="row"><span>Total Refunds</span><span>-${formatCurrency(totalRefunds)}</span></div>
            <div class="row"><span>Cancellations (Excluded)</span><span>${formatCurrency(totalCancellations)}</span></div>
          </div>
          <div class="box">
            <div class="title">Cash Drawer Reconciliation</div>
            <div class="row"><span>Opening Cash</span><span>${formatCurrency(openingCash)}</span></div>
            <div class="row"><span>+ Cash Sales</span><span>${formatCurrency(cashSales)}</span></div>
            <div class="row"><span>- Cash Refunds</span><span>${formatCurrency(cashRefunds)}</span></div>
            <div class="row bold"><span>Expected Closing Cash</span><span>${formatCurrency(expectedCash)}</span></div>
            <div class="row bold"><span>Actual Closing Cash</span><span>${hasActual ? formatCurrency(actualCash) : "—"}</span></div>
            <div class="row bold"><span>Cash Difference</span><span>${diff !== null ? formatCurrency(diff) : "—"} (${diffStatus.label})</span></div>
          </div>
          ${session.closingNotes ? `<div class="box"><div class="title">Closing Notes</div><div style="font-size:12px;">${session.closingNotes}</div></div>` : ""}
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `;
    const win = window.open("", "_blank", "width=560,height=740");
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "20px" }}>🧾</span>
              <h3 style={styles.title}>Session Closing Report</h3>
              <span
                style={{
                  ...styles.statusBadge,
                  backgroundColor: session.status === "open" ? "#dcfce7" : "#e2e8f0",
                  color: session.status === "open" ? "#15803d" : "#334155",
                }}
              >
                {session.status === "open" ? "ACTIVE SESSION" : "CLOSED"}
              </span>
            </div>
            <p style={styles.subtitle}>
              {session.terminalName} ({session.terminalCode}) • {session.floorName}
            </p>
          </div>
          <button type="button" onClick={onClose} style={styles.closeIcon}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          {/* Shift Metadata Grid */}
          <div style={styles.metaGrid}>
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Opening Staff</span>
              <span style={styles.metaVal}>{session.staffName || "—"}</span>
              <span style={styles.metaSub}>{formatDateTime(session.openedAt || session.openedAtMs)}</span>
            </div>
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Closing Staff</span>
              <span style={styles.metaVal}>{session.closingStaffName || "—"}</span>
              <span style={styles.metaSub}>
                {session.closedAt || session.closedAtMs
                  ? formatDateTime(session.closedAt || session.closedAtMs)
                  : "Session still open"}
              </span>
            </div>
          </div>

          {/* Payment Summary */}
          <div style={styles.sectionBox}>
            <div style={styles.sectionHeading}>Payment Method &amp; Sales Breakdown</div>
            <div style={styles.row}>
              <span>💵 Total Cash Sales</span>
              <strong>{formatCurrency(cashSales)}</strong>
            </div>
            <div style={styles.row}>
              <span>📱 Total UPI Sales</span>
              <strong>{formatCurrency(upiSales)}</strong>
            </div>
            <div style={styles.row}>
              <span>💳 Total Card Sales</span>
              <strong>{formatCurrency(cardSales)}</strong>
            </div>
            {creditSales > 0 && (
              <div style={styles.row}>
                <span>📒 Total Credit / Khata Sales</span>
                <strong>{formatCurrency(creditSales)}</strong>
              </div>
            )}
            <div style={{ ...styles.row, borderTop: "1.5px solid #e2e8f0", paddingTop: "8px", marginTop: "4px" }}>
              <span style={{ fontWeight: "800", color: "#0f172a" }}>
                Total Gross Sales ({session.transactionCount || 0} Bills)
              </span>
              <strong style={{ color: "#2563eb", fontSize: "15px" }}>{formatCurrency(totalSales)}</strong>
            </div>
            <div style={styles.row}>
              <span style={{ color: "#dc2626" }}>↩️ Total Refunds</span>
              <strong style={{ color: "#dc2626" }}>-{formatCurrency(totalRefunds)}</strong>
            </div>
            <div style={styles.row}>
              <span style={{ color: "#64748b" }}>🚫 Cancellations (Voided)</span>
              <span style={{ color: "#64748b", fontWeight: "700" }}>{formatCurrency(totalCancellations)}</span>
            </div>
          </div>

          {/* Cash Reconciliation Box */}
          <div style={{ ...styles.sectionBox, backgroundColor: "#f8fafc", borderColor: "#cbd5e1" }}>
            <div style={styles.sectionHeading}>Cash Drawer Reconciliation</div>
            <div style={styles.row}>
              <span>Opening Cash Amount</span>
              <strong>{formatCurrency(openingCash)}</strong>
            </div>
            <div style={styles.row}>
              <span>+ Cash Sales Collected</span>
              <strong style={{ color: "#15803d" }}>+{formatCurrency(cashSales)}</strong>
            </div>
            <div style={styles.row}>
              <span>- Cash Refunds Issued</span>
              <strong style={{ color: "#dc2626" }}>-{formatCurrency(cashRefunds)}</strong>
            </div>
            <div style={{ ...styles.row, borderTop: "1.5px solid #cbd5e1", paddingTop: "8px", marginTop: "4px" }}>
              <span style={{ fontWeight: "800", color: "#0f172a" }}>Expected Closing Cash</span>
              <strong style={{ fontSize: "15px", color: "#0f172a" }}>{formatCurrency(expectedCash)}</strong>
            </div>
            <div style={styles.row}>
              <span style={{ fontWeight: "800", color: "#0f172a" }}>Actual Closing Cash</span>
              <strong style={{ fontSize: "15px", color: "#0f172a" }}>
                {hasActual ? formatCurrency(actualCash) : "—"}
              </strong>
            </div>
            <div style={{ ...styles.row, paddingTop: "6px" }}>
              <span style={{ fontWeight: "800" }}>Cash Difference</span>
              <span
                style={{
                  backgroundColor: diffStatus.bg,
                  color: diffStatus.color,
                  padding: "3px 10px",
                  borderRadius: "8px",
                  fontWeight: "800",
                  fontSize: "12.5px",
                }}
              >
                {diff !== null ? `${diff >= 0 ? "+" : ""}${formatCurrency(diff)} • ` : ""}
                {diffStatus.label}
              </span>
            </div>
          </div>

          {session.closingNotes && (
            <div style={styles.notesBox}>
              <strong>Closing Notes:</strong> {session.closingNotes}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={handlePrintReport} style={styles.printBtn}>
            🖨️ Print Closing Report
          </button>
          <button type="button" onClick={onClose} style={styles.doneBtn}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10050,
    padding: "16px",
  },
  modal: {
    backgroundColor: "#ffffff",
    borderRadius: "18px",
    width: "100%",
    maxWidth: "560px",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 24px 48px rgba(0,0,0,0.22)",
  },
  header: {
    padding: "18px 22px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    backgroundColor: "#0f172a",
    color: "#ffffff",
  },
  title: { margin: 0, fontSize: "18px", fontWeight: "800" },
  subtitle: { margin: "4px 0 0 0", fontSize: "12.5px", color: "#94a3b8" },
  statusBadge: {
    fontSize: "10.5px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "10px",
  },
  closeIcon: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "18px",
    cursor: "pointer",
    fontWeight: "800",
  },
  body: {
    padding: "18px 22px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "10px",
  },
  metaItem: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  metaLabel: { fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  metaVal: { fontSize: "14px", fontWeight: "800", color: "#0f172a" },
  metaSub: { fontSize: "11.5px", color: "#64748b" },
  sectionBox: {
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  sectionHeading: {
    fontSize: "11.5px",
    fontWeight: "800",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
    marginBottom: "4px",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "13px",
    color: "#334155",
  },
  notesBox: {
    backgroundColor: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "10px",
    padding: "10px 12px",
    fontSize: "12.5px",
    color: "#92400e",
  },
  footer: {
    padding: "14px 22px",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end",
    backgroundColor: "#f8fafc",
  },
  printBtn: {
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "13px",
    cursor: "pointer",
  },
  doneBtn: {
    padding: "10px 18px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
};
