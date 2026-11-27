import { useEffect, useMemo, useState } from "react";
import { db } from "../utils/firebase";
import {
  calculateSessionSummaryFromTransactions,
  closeTerminalSession,
  formatCurrency,
  formatDateTime,
  getAuthorizedTerminalsForStaff,
  openTerminalSession,
  subscribeTerminalTransactions,
} from "../utils/terminalService";
import SessionClosingReportModal from "./SessionClosingReportModal";

export default function PosTerminalBar({
  shopId,
  storeName,
  isStaff,
  staffId,
  staffName,
  floors = [],
  terminals = [],
  terminalsLoaded = false,
  activeTerminal,
  activeSession,
  onSelectTerminal,
  onSessionOpened,
  onSessionClosed,
  onOpenTerminalManagement,
}) {
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [pendingTerminal, setPendingTerminal] = useState(null);

  const [openingCash, setOpeningCash] = useState("0");
  const [actualClosingCash, setActualClosingCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [sessionTxns, setSessionTxns] = useState([]);
  const [closedReportSession, setClosedReportSession] = useState(null);

  const authorizedTerminals = useMemo(
    () =>
      getAuthorizedTerminalsForStaff({
        terminals,
        floors,
        shopId,
        staffId,
        isOwner: !isStaff,
      }),
    [terminals, floors, shopId, staffId, isStaff]
  );

  // Live subscribe to transactions of active terminal for accurate close preview
  useEffect(() => {
    if (!shopId || !activeTerminal?.id || !activeSession?.id) {
      return undefined;
    }
    const unsub = subscribeTerminalTransactions(
      db,
      shopId,
      activeTerminal.id,
      (list) => {
        setSessionTxns(list.filter((t) => t.sessionId === activeSession.id));
      },
      () => {}
    );
    return () => unsub();
  }, [shopId, activeTerminal?.id, activeSession?.id]);

  // Streamlined staff terminal selection: if staff has exactly 1 terminal and none selected yet, pre-focus it
  const singleStaffTerminal =
    isStaff && authorizedTerminals.length === 1 ? authorizedTerminals[0] : null;

  const liveSummary = useMemo(() => {
    if (!activeSession) return null;
    const filteredTxns = sessionTxns.filter((t) => t.sessionId === activeSession.id);
    if (filteredTxns.length > 0) {
      return calculateSessionSummaryFromTransactions(
        filteredTxns,
        activeSession.openingCash || 0,
        actualClosingCash
      );
    }
    // Fallback to session counters if transactions haven't loaded yet
    const openCash = Number(activeSession.openingCash || 0);
    const cashSales = Number(activeSession.totalCashSales || 0);
    const cashRefunds = Number(activeSession.totalCashRefunds || 0);
    const expected = Number((openCash + cashSales - cashRefunds).toFixed(2));
    const hasActual = actualClosingCash !== "" && Number.isFinite(Number(actualClosingCash));
    const actualNum = hasActual ? Number(actualClosingCash) : null;
    return {
      openingCash: openCash,
      totalSales: Number(activeSession.totalSales || 0),
      totalCashSales: cashSales,
      totalUpiSales: Number(activeSession.totalUpiSales || 0),
      totalCardSales: Number(activeSession.totalCardSales || 0),
      totalCreditSales: Number(activeSession.totalCreditSales || 0),
      totalRefunds: Number(activeSession.totalRefunds || 0),
      totalCashRefunds: cashRefunds,
      totalCancellations: Number(activeSession.totalCancellations || 0),
      transactionCount: Number(activeSession.transactionCount || 0),
      expectedClosingCash: expected,
      actualClosingCash: actualNum,
      cashDifference: hasActual ? Number((actualNum - expected).toFixed(2)) : null,
    };
  }, [activeSession, sessionTxns, actualClosingCash]);

  const handleChooseTerminal = (term) => {
    setErrorMsg("");
    onSelectTerminal(term);
    setShowSelectModal(false);
    // If closed, immediately prompt to open a billing session
    if (term.sessionStatus !== "open" || !term.currentSessionId) {
      setPendingTerminal(term);
      setOpeningCash("0");
      setShowOpenModal(true);
    }
  };

  const handleOpenSessionSubmit = async (e) => {
    e.preventDefault();
    const target = pendingTerminal || activeTerminal || singleStaffTerminal;
    if (!target) return;

    setErrorMsg("");
    setSubmitting(true);
    try {
      const createdSession = await openTerminalSession(db, {
        shopId,
        terminalId: target.id,
        staffId: isStaff ? staffId : "OWNER",
        staffName: isStaff ? staffName : "Store Owner",
        openingCash: Number(openingCash || 0),
        isOwner: !isStaff,
      });
      onSelectTerminal(target);
      if (onSessionOpened) onSessionOpened(target, createdSession);
      setShowOpenModal(false);
      setPendingTerminal(null);
      setOpeningCash("0");
    } catch (err) {
      setErrorMsg(err.message || "Failed to open billing session.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseSessionSubmit = async (e) => {
    e.preventDefault();
    if (!activeTerminal?.id || !activeSession?.id) return;
    if (actualClosingCash === "" || Number(actualClosingCash) < 0) {
      setErrorMsg("Please enter a valid Actual Closing Cash amount.");
      return;
    }

    setErrorMsg("");
    setSubmitting(true);
    try {
      const report = await closeTerminalSession(db, {
        shopId,
        terminalId: activeTerminal.id,
        sessionId: activeSession.id,
        actualClosingCash: Number(actualClosingCash),
        closingStaffId: isStaff ? staffId : "OWNER",
        closingStaffName: isStaff ? staffName : "Store Owner",
        closingNotes,
      });
      setShowCloseModal(false);
      setActualClosingCash("");
      setClosingNotes("");
      setClosedReportSession(report);
      if (onSessionClosed) onSessionClosed(activeTerminal, report);
    } catch (err) {
      setErrorMsg(err.message || "Failed to close billing session.");
    } finally {
      setSubmitting(false);
    }
  };

  // Staff with terminals configured in shop, but none assigned to this staff
  const staffHasNoAuthorizedTerminals =
    terminalsLoaded && isStaff && terminals.length > 0 && authorizedTerminals.length === 0;

  // Staff needs to select / open a terminal session before billing
  const staffNeedsTerminalAction =
    terminalsLoaded && isStaff && authorizedTerminals.length > 0 && !activeSession;

  return (
    <>
      {/* TOP BAR IN POS VIEW */}
      <div style={styles.barWrapper}>
        {activeTerminal && activeSession ? (
          <div style={styles.activeBar}>
            <div style={styles.barLeft}>
              <div style={styles.liveDot} />
              <div style={{ minWidth: 0 }}>
                <div style={styles.termTitleRow}>
                  <span style={styles.termTitle}>
                    🖥️ {activeTerminal.name}
                  </span>
                  <span style={styles.codePill}>{activeTerminal.code}</span>
                  <span style={styles.floorPill}>🏢 {activeTerminal.floorName}</span>
                  <span style={styles.openPill}>SESSION OPEN</span>
                </div>
                <div style={styles.termMeta}>
                  Cashier: <strong>{activeSession.staffName}</strong> • Opened:{" "}
                  {formatDateTime(activeSession.openedAt || activeSession.openedAtMs)} • Opening Cash:{" "}
                  <strong>{formatCurrency(activeSession.openingCash || 0)}</strong> • Session Sales:{" "}
                  <strong style={{ color: "#15803d" }}>
                    {formatCurrency(liveSummary?.totalSales ?? activeSession.totalSales ?? 0)}
                  </strong>{" "}
                  ({liveSummary?.transactionCount ?? activeSession.transactionCount ?? 0} bills)
                </div>
              </div>
            </div>

            <div style={styles.barActions}>
              {(authorizedTerminals.length > 1 || !isStaff) && (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg("");
                    setShowSelectModal(true);
                  }}
                  style={styles.switchBtn}
                >
                  🔄 Switch Terminal
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setErrorMsg("");
                  setActualClosingCash(
                    String(liveSummary?.expectedClosingCash ?? activeSession.openingCash ?? 0)
                  );
                  setClosingNotes("");
                  setShowCloseModal(true);
                }}
                style={styles.closeSessionBtn}
              >
                🔒 Close Session
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.idleBar}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "16px" }}>🖥️</span>
              {terminals.length === 0 ? (
                <span style={{ fontSize: "12.5px", color: "#475569", fontWeight: "600" }}>
                  No POS terminals configured yet — running in standard store counter mode.
                </span>
              ) : staffHasNoAuthorizedTerminals ? (
                <span style={{ fontSize: "12.5px", color: "#b91c1c", fontWeight: "700" }}>
                  ⛔ No active POS terminal is assigned to Staff ID <strong>{staffId}</strong>. Contact your shop owner.
                </span>
              ) : (
                <span style={{ fontSize: "12.5px", color: "#92400e", fontWeight: "700" }}>
                  {activeTerminal
                    ? `Terminal "${activeTerminal.name}" (${activeTerminal.floorName}) has no open session.`
                    : "Select a POS terminal & open a billing session to track terminal sales."}
                </span>
              )}
            </div>

            <div style={styles.barActions}>
              {terminals.length === 0 && !isStaff && onOpenTerminalManagement && (
                <button
                  type="button"
                  onClick={onOpenTerminalManagement}
                  style={styles.manageBtn}
                >
                  + Setup Floors &amp; Terminals
                </button>
              )}
              {authorizedTerminals.length > 0 && (
                <>
                  {(singleStaffTerminal || activeTerminal) && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg("");
                        setPendingTerminal(singleStaffTerminal || activeTerminal);
                        setOpeningCash("0");
                        setShowOpenModal(true);
                      }}
                      style={styles.openSessionBtn}
                    >
                      ▶ Open Session ({(singleStaffTerminal || activeTerminal).name})
                    </button>
                  )}
                  {!singleStaffTerminal && (authorizedTerminals.length > 1 || !activeTerminal) && (
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg("");
                        setShowSelectModal(true);
                      }}
                      style={activeTerminal ? styles.switchBtn : styles.openSessionBtn}
                    >
                      {activeTerminal ? "🔄 Switch Terminal" : "🖥️ Select Terminal & Open Session"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* STAFF BLOCKING OVERLAY WHEN TERMINAL SESSION IS REQUIRED */}
      {(staffHasNoAuthorizedTerminals || staffNeedsTerminalAction) &&
        !showOpenModal &&
        !showSelectModal && (
          <div style={styles.gateBanner}>
            {staffHasNoAuthorizedTerminals ? (
              <div style={styles.gateCard}>
                <div style={{ fontSize: "34px", marginBottom: "8px" }}>🔐</div>
                <h3 style={{ margin: "0 0 6px 0", color: "#0f172a", fontSize: "18px", fontWeight: "800" }}>
                  Terminal Assignment Required
                </h3>
                <p style={{ margin: 0, color: "#64748b", fontSize: "13.5px", lineHeight: "1.5" }}>
                  Staff account <strong>{staffName} ({staffId})</strong> is not currently assigned to any active POS terminal in this shop. Please ask the shop owner to assign your account to a terminal under <strong>Terminal Management</strong>.
                </p>
              </div>
            ) : singleStaffTerminal ? (
              <div style={styles.gateCard}>
                <div style={{ fontSize: "34px", marginBottom: "8px" }}>🖥️</div>
                <h3 style={{ margin: "0 0 6px 0", color: "#0f172a", fontSize: "18px", fontWeight: "800" }}>
                  Ready to Start Shift: {singleStaffTerminal.name}
                </h3>
                <p style={{ margin: "0 0 14px 0", color: "#64748b", fontSize: "13px" }}>
                  Floor: <strong>{singleStaffTerminal.floorName}</strong> • Code:{" "}
                  <strong>{singleStaffTerminal.code}</strong> • Staff: <strong>{staffName}</strong>
                </p>
                {singleStaffTerminal.sessionStatus === "open" &&
                singleStaffTerminal.activeStaffId &&
                singleStaffTerminal.activeStaffId !== staffId ? (
                  <div style={styles.warnBox}>
                    ⚠️ This terminal currently has an open billing session by{" "}
                    <strong>{singleStaffTerminal.activeStaffName || singleStaffTerminal.activeStaffId}</strong>. Wait for them to close the session or ask the owner to close it.
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg("");
                      setPendingTerminal(singleStaffTerminal);
                      setOpeningCash("0");
                      setShowOpenModal(true);
                    }}
                    style={{ ...styles.openSessionBtn, padding: "12px 22px", fontSize: "14px" }}
                  >
                    ▶ Open Billing Session
                  </button>
                )}
              </div>
            ) : (
              <div style={styles.gateCard}>
                <div style={{ fontSize: "34px", marginBottom: "8px" }}>🏢</div>
                <h3 style={{ margin: "0 0 6px 0", color: "#0f172a", fontSize: "18px", fontWeight: "800" }}>
                  Select Your Assigned POS Terminal
                </h3>
                <p style={{ margin: "0 0 14px 0", color: "#64748b", fontSize: "13px" }}>
                  You have {authorizedTerminals.length} authorized terminals. Select one to begin your billing session.
                </p>
                <div style={styles.gateTermList}>
                  {authorizedTerminals.map((t) => {
                    const isOccupiedByOther =
                      t.sessionStatus === "open" && t.activeStaffId && t.activeStaffId !== staffId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={isOccupiedByOther}
                        onClick={() => handleChooseTerminal(t)}
                        style={{
                          ...styles.gateTermBtn,
                          opacity: isOccupiedByOther ? 0.6 : 1,
                          cursor: isOccupiedByOther ? "not-allowed" : "pointer",
                        }}
                      >
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "14px" }}>
                            {t.name} <span style={styles.codePill}>{t.code}</span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                            🏢 {t.floorName}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "800",
                            padding: "4px 10px",
                            borderRadius: "8px",
                            backgroundColor:
                              t.sessionStatus === "open"
                                ? isOccupiedByOther
                                  ? "#fee2e2"
                                  : "#dcfce7"
                                : "#eef2ff",
                            color:
                              t.sessionStatus === "open"
                                ? isOccupiedByOther
                                  ? "#dc2626"
                                  : "#15803d"
                                : "#4338ca",
                          }}
                        >
                          {t.sessionStatus === "open"
                            ? isOccupiedByOther
                              ? `Busy (${t.activeStaffName || "Other"})`
                              : "Resume Session"
                            : "Open Session →"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

      {/* SELECT TERMINAL MODAL */}
      {showSelectModal && (
        <div style={styles.modalOverlay} onClick={() => setShowSelectModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Select POS Terminal</h3>
                <p style={styles.modalSub}>
                  {isStaff
                    ? `Showing terminals assigned to ${staffName} (${staffId})`
                    : "Choose an active terminal across your shop floors"}
                </p>
              </div>
              <button type="button" onClick={() => setShowSelectModal(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              {authorizedTerminals.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>
                  No active terminals available.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {authorizedTerminals.map((t) => {
                    const isOpen = t.sessionStatus === "open";
                    const occupiedByOther =
                      isStaff && isOpen && t.activeStaffId && t.activeStaffId !== staffId;
                    const isCurrent = activeTerminal?.id === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={occupiedByOther}
                        onClick={() => handleChooseTerminal(t)}
                        style={{
                          ...styles.gateTermBtn,
                          borderColor: isCurrent ? "#2563eb" : "#e2e8f0",
                          backgroundColor: isCurrent ? "#eff6ff" : "#ffffff",
                          opacity: occupiedByOther ? 0.6 : 1,
                          cursor: occupiedByOther ? "not-allowed" : "pointer",
                        }}
                      >
                        <div style={{ textAlign: "left" }}>
                          <div style={{ fontWeight: "800", color: "#0f172a", fontSize: "14px" }}>
                            🖥️ {t.name}{" "}
                            <span style={styles.codePill}>{t.code}</span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                            🏢 {t.floorName} •{" "}
                            {isOpen
                              ? `Active Cashier: ${t.activeStaffName || "Staff"}`
                              : "Ready to open"}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: "800",
                            padding: "4px 10px",
                            borderRadius: "8px",
                            backgroundColor: isOpen
                              ? occupiedByOther
                                ? "#fee2e2"
                                : "#dcfce7"
                              : "#f1f5f9",
                            color: isOpen
                              ? occupiedByOther
                                ? "#dc2626"
                                : "#15803d"
                              : "#334155",
                          }}
                        >
                          {isOpen
                            ? occupiedByOther
                              ? "Session Open (Busy)"
                              : "Active • Select"
                            : "Closed • Open"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OPEN SESSION MODAL */}
      {showOpenModal && (pendingTerminal || activeTerminal || singleStaffTerminal) && (
        <div style={styles.modalOverlay} onClick={() => setShowOpenModal(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>▶ Open Billing Session</h3>
                <p style={styles.modalSub}>Initialize cash drawer before recording POS sales</p>
              </div>
              <button type="button" onClick={() => setShowOpenModal(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <form onSubmit={handleOpenSessionSubmit} style={styles.modalBody}>
              {(() => {
                const target = pendingTerminal || activeTerminal || singleStaffTerminal;
                return (
                  <div style={styles.infoBox}>
                    <div style={styles.infoRow}>
                      <span>Terminal</span>
                      <strong>
                        {target.name} ({target.code})
                      </strong>
                    </div>
                    <div style={styles.infoRow}>
                      <span>Floor</span>
                      <strong>{target.floorName}</strong>
                    </div>
                    <div style={styles.infoRow}>
                      <span>Staff</span>
                      <strong>{isStaff ? `${staffName} (${staffId})` : "Store Owner"}</strong>
                    </div>
                    <div style={styles.infoRow}>
                      <span>Opening Time</span>
                      <strong>{new Date().toLocaleString("en-IN")}</strong>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                <label style={styles.label}>Opening Cash Amount (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  style={styles.input}
                  placeholder="0.00"
                  autoFocus
                />
              </div>

              {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setShowOpenModal(false)}
                  style={styles.cancelBtn}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.submitBtn} disabled={submitting}>
                  {submitting ? "Opening Session..." : "Confirm & Open Session"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLOSE SESSION & RECONCILIATION MODAL */}
      {showCloseModal && activeTerminal && activeSession && liveSummary && (
        <div style={styles.modalOverlay} onClick={() => setShowCloseModal(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "520px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>🔒 Close Billing Session</h3>
                <p style={styles.modalSub}>
                  {activeTerminal.name} ({activeTerminal.code}) • {activeTerminal.floorName}
                </p>
              </div>
              <button type="button" onClick={() => setShowCloseModal(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCloseSessionSubmit} style={styles.modalBody}>
              <div style={styles.infoBox}>
                <div style={styles.infoRow}>
                  <span>Opening Cash</span>
                  <strong>{formatCurrency(liveSummary.openingCash)}</strong>
                </div>
                <div style={styles.infoRow}>
                  <span>💵 Cash Sales</span>
                  <strong style={{ color: "#15803d" }}>+{formatCurrency(liveSummary.totalCashSales)}</strong>
                </div>
                <div style={styles.infoRow}>
                  <span>📱 UPI Sales</span>
                  <strong>{formatCurrency(liveSummary.totalUpiSales)}</strong>
                </div>
                <div style={styles.infoRow}>
                  <span>💳 Card Sales</span>
                  <strong>{formatCurrency(liveSummary.totalCardSales)}</strong>
                </div>
                {liveSummary.totalCreditSales > 0 && (
                  <div style={styles.infoRow}>
                    <span>📒 Credit / Khata Sales</span>
                    <strong>{formatCurrency(liveSummary.totalCreditSales)}</strong>
                  </div>
                )}
                <div style={styles.infoRow}>
                  <span>↩️ Total Refunds (Cash: {formatCurrency(liveSummary.totalCashRefunds)})</span>
                  <strong style={{ color: "#dc2626" }}>-{formatCurrency(liveSummary.totalRefunds)}</strong>
                </div>
                <div
                  style={{
                    ...styles.infoRow,
                    borderTop: "1.5px solid #cbd5e1",
                    paddingTop: "8px",
                    marginTop: "4px",
                  }}
                >
                  <span style={{ fontWeight: "800", color: "#0f172a" }}>Expected Closing Cash</span>
                  <strong style={{ fontSize: "15px", color: "#0f172a" }}>
                    {formatCurrency(liveSummary.expectedClosingCash)}
                  </strong>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                <label style={styles.label}>Actual Closing Cash in Drawer (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={actualClosingCash}
                  onChange={(e) => setActualClosingCash(e.target.value)}
                  style={styles.input}
                  autoFocus
                />
              </div>

              {liveSummary.cashDifference !== null && (
                <div
                  style={{
                    marginTop: "10px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    fontSize: "13px",
                    fontWeight: "800",
                    display: "flex",
                    justifyContent: "space-between",
                    backgroundColor:
                      Math.abs(liveSummary.cashDifference) < 0.01
                        ? "#dcfce7"
                        : liveSummary.cashDifference > 0
                        ? "#e0f2fe"
                        : "#fee2e2",
                    color:
                      Math.abs(liveSummary.cashDifference) < 0.01
                        ? "#15803d"
                        : liveSummary.cashDifference > 0
                        ? "#0369a1"
                        : "#dc2626",
                  }}
                >
                  <span>Cash Difference</span>
                  <span>
                    {liveSummary.cashDifference >= 0 ? "+" : ""}
                    {formatCurrency(liveSummary.cashDifference)} (
                    {Math.abs(liveSummary.cashDifference) < 0.01
                      ? "Balanced"
                      : liveSummary.cashDifference > 0
                      ? "Excess"
                      : "Shortage"}
                    )
                  </span>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "12px" }}>
                <label style={styles.label}>Closing Notes (Optional)</label>
                <textarea
                  rows={2}
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  placeholder="Shift handover remarks, variance explanation..."
                  style={{ ...styles.input, resize: "vertical" }}
                />
              </div>

              {errorMsg && <div style={styles.errorBox}>{errorMsg}</div>}

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  style={styles.cancelBtn}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...styles.submitBtn, backgroundColor: "#dc2626" }}
                  disabled={submitting}
                >
                  {submitting ? "Closing..." : "Close Session & Generate Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SESSION CLOSING REPORT MODAL */}
      {closedReportSession && (
        <SessionClosingReportModal
          session={closedReportSession}
          storeName={storeName}
          onClose={() => setClosedReportSession(null)}
        />
      )}
    </>
  );
}

const styles = {
  barWrapper: {
    width: "100%",
    padding: "8px 16px 0 16px",
    boxSizing: "border-box",
    flexShrink: 0,
  },
  activeBar: {
    backgroundColor: "#f0fdf4",
    border: "1.5px solid #86efac",
    borderRadius: "12px",
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  idleBar: {
    backgroundColor: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: "12px",
    padding: "8px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  barLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
    flex: 1,
  },
  liveDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: "#16a34a",
    boxShadow: "0 0 0 4px rgba(22, 163, 74, 0.2)",
    flexShrink: 0,
  },
  termTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  termTitle: {
    fontSize: "13.5px",
    fontWeight: "800",
    color: "#0f172a",
  },
  codePill: {
    backgroundColor: "#e0e7ff",
    color: "#3730a3",
    fontSize: "10.5px",
    fontWeight: "800",
    padding: "1px 7px",
    borderRadius: "6px",
  },
  floorPill: {
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#334155",
    fontSize: "11px",
    fontWeight: "700",
    padding: "1px 8px",
    borderRadius: "6px",
  },
  openPill: {
    backgroundColor: "#16a34a",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: "800",
    padding: "2px 7px",
    borderRadius: "8px",
  },
  termMeta: {
    fontSize: "11.5px",
    color: "#334155",
    marginTop: "2px",
  },
  barActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  switchBtn: {
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    color: "#0f172a",
    borderRadius: "8px",
    padding: "6px 11px",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
  },
  closeSessionBtn: {
    backgroundColor: "#dc2626",
    border: "none",
    color: "#ffffff",
    borderRadius: "8px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: "800",
    cursor: "pointer",
  },
  openSessionBtn: {
    backgroundColor: "#2563eb",
    border: "none",
    color: "#ffffff",
    borderRadius: "8px",
    padding: "7px 14px",
    fontSize: "12px",
    fontWeight: "800",
    cursor: "pointer",
  },
  manageBtn: {
    backgroundColor: "#eef2ff",
    border: "1px solid #c7d2fe",
    color: "#4338ca",
    borderRadius: "8px",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: "800",
    cursor: "pointer",
  },
  gateBanner: {
    position: "fixed",
    inset: 0,
    top: "64px",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    backdropFilter: "blur(4px)",
    zIndex: 90,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  },
  gateCard: {
    backgroundColor: "#ffffff",
    borderRadius: "20px",
    padding: "28px",
    maxWidth: "520px",
    width: "100%",
    textAlign: "center",
    boxShadow: "0 20px 45px rgba(0,0,0,0.28)",
  },
  gateTermList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    maxHeight: "300px",
    overflowY: "auto",
  },
  gateTermBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1.5px solid #e2e8f0",
    backgroundColor: "#ffffff",
    width: "100%",
    boxSizing: "border-box",
  },
  warnBox: {
    backgroundColor: "#fef3c7",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: "10px",
    padding: "12px",
    fontSize: "13px",
    lineHeight: "1.4",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10040,
    padding: "16px",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "18px",
    width: "100%",
    maxWidth: "520px",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 24px 48px rgba(0,0,0,0.22)",
  },
  modalHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  modalTitle: { margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" },
  modalSub: { margin: "3px 0 0 0", fontSize: "12.5px", color: "#64748b" },
  closeBtn: {
    background: "transparent",
    border: "none",
    fontSize: "18px",
    color: "#64748b",
    cursor: "pointer",
    fontWeight: "800",
  },
  modalBody: {
    padding: "18px 20px",
    overflowY: "auto",
  },
  infoBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "13px",
    color: "#334155",
  },
  label: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
  },
  input: {
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    fontSize: "14px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  errorBox: {
    marginTop: "10px",
    backgroundColor: "#fee2e2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    padding: "10px 12px",
    borderRadius: "10px",
    fontSize: "12.5px",
    fontWeight: "600",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "18px",
  },
  cancelBtn: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#475569",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
  submitBtn: {
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "13px",
    cursor: "pointer",
  },
};
