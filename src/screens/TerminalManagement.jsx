import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "../utils/firebase";
import {
  INVENTORY_MODES,
  assignTerminalStaff,
  buildTerminalSalesReport,
  calculateSessionSummaryFromTransactions,
  captureDeviceInfo,
  closeTerminalSession,
  deleteFloor,
  deleteTerminal,
  ensurePrimaryTerminalSeeded,
  fetchAllShopSessions,
  fetchAllShopTransactions,
  formatCurrency,
  formatDateTime,
  generateUniqueTerminalCode,
  getShopInventoryMode,
  openTerminalSession,
  recordRefundOrCancellation,
  saveFloor,
  saveTerminal,
  setShopInventoryMode,
  subscribeFloors,
  subscribeTerminalSessions,
  subscribeTerminalTransactions,
  subscribeTerminals,
  toggleFloorStatus,
  toggleTerminalStatus,
} from "../utils/terminalService";
import SessionClosingReportModal from "../components/SessionClosingReportModal";
import TerminalProductManagement from "../components/TerminalProductManagement";
import TerminalProductOverview from "../components/TerminalProductOverview";

export default function TerminalManagement({
  userProfile = {},
  rawUserData = null,
  ordersList = [],
  wasteRecords = [],
  shopProducts = [],
  productCollection = "inventory",
  primaryTerminalId = null,
  allowNegativeStock = false,
  initialSubTab = "overview",
  onSelectTerminalForPos,
  onBack,
}) {
  const shopId = auth.currentUser?.uid || localStorage.getItem("uid") || "";
  const storeName = userProfile?.storeName || userProfile?.shopName || "Kadai Pro Store";
  const isStaff = localStorage.getItem("is_staff") === "true";
  const currentStaffId = isStaff ? localStorage.getItem("staff_id") || "STAFF" : "OWNER";
  const currentStaffName = isStaff
    ? localStorage.getItem("staff_name") || "Staff"
    : userProfile?.name || "Store Owner";

  const [subTab, setSubTab] = useState(initialSubTab || "overview"); // "overview" | "products" | "product_overview" | "sessions" | "reports"
  const [selectedProdTerminalId, setSelectedProdTerminalId] = useState("");
  const [loading, setLoading] = useState(() => Boolean(shopId));
  const [floors, setFloors] = useState([]);
  const [terminals, setTerminals] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [inventoryModeOverride, setInventoryModeOverride] = useState(null);
  const inventoryMode =
    inventoryModeOverride ??
    (rawUserData?.inventoryMode
      ? getShopInventoryMode(rawUserData)
      : terminals.length > 1
      ? INVENTORY_MODES.TERMINAL_WISE
      : INVENTORY_MODES.SHARED);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFloorId, setFilterFloorId] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterSessionStatus, setFilterSessionStatus] = useState("all");
  const [collapsedFloors, setCollapsedFloors] = useState({});

  // Reports Filters
  const [reportTimeframe, setReportTimeframe] = useState("daily"); // "daily" | "weekly" | "monthly" | "all" | "custom"
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportFloorId, setReportFloorId] = useState("all");
  const [reportTerminalId, setReportTerminalId] = useState("all");

  // Toast
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4200);
  }, []);

  // Floor Modal
  const [floorModalOpen, setFloorModalOpen] = useState(false);
  const [editingFloor, setEditingFloor] = useState(null);
  const [floorName, setFloorName] = useState("");
  const [floorDesc, setFloorDesc] = useState("");
  const [floorOrder, setFloorOrder] = useState("1");
  const [floorStatus, setFloorStatus] = useState("active");
  const [savingFloor, setSavingFloor] = useState(false);

  // Terminal Modal
  const [termModalOpen, setTermModalOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState(null);
  const [termName, setTermName] = useState("");
  const [termCode, setTermCode] = useState("");
  const [termFloorId, setTermFloorId] = useState("");
  const [termStatus, setTermStatus] = useState("active");
  const [termStaffIds, setTermStaffIds] = useState([]);
  const [savingTerminal, setSavingTerminal] = useState(false);

  // Assign Staff Modal
  const [assignModalTerminal, setAssignModalTerminal] = useState(null);
  const [assignSelectedIds, setAssignSelectedIds] = useState([]);
  const [assignSearch, setAssignSearch] = useState("");
  const [savingAssign, setSavingAssign] = useState(false);

  // Terminal Details Modal
  const [detailsTerminal, setDetailsTerminal] = useState(null);
  const [detailsSessions, setDetailsSessions] = useState([]);
  const [detailsTxns, setDetailsTxns] = useState([]);

  // Open / Close Session Modals
  const [openSessionTerminal, setOpenSessionTerminal] = useState(null);
  const [openingCashInput, setOpeningCashInput] = useState("0");
  const [sessionSubmitting, setSessionSubmitting] = useState(false);

  const [closeSessionTarget, setCloseSessionTarget] = useState(null); // { terminal, session }
  const [closeSessionTxns, setCloseSessionTxns] = useState([]);
  const [actualCashInput, setActualCashInput] = useState("");
  const [closingNotesInput, setClosingNotesInput] = useState("");

  // Session Closing Report Modal
  const [reportModalSession, setReportModalSession] = useState(null);

  // Refund / Cancel Modal
  const [refundTargetTxn, setRefundTargetTxn] = useState(null);
  const [refundActionType, setRefundActionType] = useState("refund");
  const [refundReason, setRefundReason] = useState("");
  const [refundSubmitting, setRefundSubmitting] = useState(false);

  // Confirmation Dialog
  const [confirmDialog, setConfirmDialog] = useState({
    show: false,
    title: "",
    message: "",
    confirmLabel: "Confirm",
    danger: false,
    onConfirm: null,
  });

  // Subscribe to Floors, Terminals & Staff
  useEffect(() => {
    if (!shopId) {
      return undefined;
    }

    let gotFloors = false;
    let gotTerms = false;
    const checkDone = () => {
      if (gotFloors && gotTerms) setLoading(false);
    };

    const unsubFloors = subscribeFloors(
      db,
      shopId,
      (list) => {
        setFloors(list);
        gotFloors = true;
        checkDone();
      },
      (err) => {
        showToast("Failed to load floors: " + err.message, "error");
        gotFloors = true;
        checkDone();
      }
    );

    const unsubTerms = subscribeTerminals(
      db,
      shopId,
      (list) => {
        setTerminals(list);
        gotTerms = true;
        checkDone();
      },
      (err) => {
        showToast("Failed to load terminals: " + err.message, "error");
        gotTerms = true;
        checkDone();
      }
    );

    const unsubStaff = onSnapshot(
      collection(db, "users", shopId, "staffs"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setStaffList(list);
      },
      (err) => console.warn("Staff subscription warning:", err)
    );

    return () => {
      unsubFloors();
      unsubTerms();
      unsubStaff();
    };
  }, [shopId, showToast]);

  const primarySeedAttemptedRef = useRef(false);
  useEffect(() => {
    if (!shopId || isStaff || loading || !rawUserData) return;
    if (primarySeedAttemptedRef.current) return;
    if (rawUserData.primaryTerminalSeeded === true) return;
    if (terminals.some((t) => t.isPrimary === true || t.id === "terminal_1")) return;
    if (floors.length === 0 && terminals.length === 0) return;

    primarySeedAttemptedRef.current = true;
    ensurePrimaryTerminalSeeded(db, shopId, {
      floors,
      terminals,
      rawUserData,
      storeName,
    }).catch((err) => {
      console.warn("Primary terminal auto-seed skipped:", err);
      primarySeedAttemptedRef.current = false;
    });
  }, [shopId, isStaff, loading, rawUserData, terminals, floors, storeName]);

  const refreshSessionsAndTxns = useCallback(async () => {
    if (!shopId || terminals.length === 0) {
      setAllSessions([]);
      setAllTransactions([]);
      return;
    }
    try {
      const [sess, txns] = await Promise.all([
        fetchAllShopSessions(db, shopId, terminals),
        fetchAllShopTransactions(db, shopId, terminals),
      ]);
      setAllSessions(sess);
      setAllTransactions(txns);
    } catch (err) {
      console.warn("Error loading shop sessions/txns:", err);
    }
  }, [shopId, terminals]);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      if (!shopId || terminals.length === 0) {
        if (!cancelled) {
          setAllSessions([]);
          setAllTransactions([]);
        }
        return;
      }
      try {
        const [sess, txns] = await Promise.all([
          fetchAllShopSessions(db, shopId, terminals),
          fetchAllShopTransactions(db, shopId, terminals),
        ]);
        if (!cancelled) {
          setAllSessions(sess);
          setAllTransactions(txns);
        }
      } catch (err) {
        console.warn("Error loading shop sessions/txns:", err);
      }
    };
    loadData();
    return () => {
      cancelled = true;
    };
  }, [shopId, terminals, ordersList.length]);

  // Subscribe to selected Terminal Details
  useEffect(() => {
    if (!shopId || !detailsTerminal?.id) return undefined;
    const unsubSess = subscribeTerminalSessions(
      db,
      shopId,
      detailsTerminal.id,
      setDetailsSessions,
      () => {}
    );
    const unsubTxn = subscribeTerminalTransactions(
      db,
      shopId,
      detailsTerminal.id,
      setDetailsTxns,
      () => {}
    );
    return () => {
      unsubSess();
      unsubTxn();
    };
  }, [shopId, detailsTerminal?.id]);

  // Subscribe to Close Session transactions when close modal open
  useEffect(() => {
    if (!shopId || !closeSessionTarget?.terminal?.id || !closeSessionTarget?.session?.id) {
      return undefined;
    }
    const unsub = subscribeTerminalTransactions(
      db,
      shopId,
      closeSessionTarget.terminal.id,
      (list) => {
        setCloseSessionTxns(
          list.filter((t) => t.sessionId === closeSessionTarget.session.id)
        );
      },
      () => {}
    );
    return () => unsub();
  }, [shopId, closeSessionTarget?.terminal?.id, closeSessionTarget?.session?.id]);

  // Today's report for KPI cards
  const todayReport = useMemo(
    () =>
      buildTerminalSalesReport({
        sales: ordersList,
        transactions: allTransactions,
        floors,
        terminals,
        sessions: allSessions,
        timeframe: "daily",
      }),
    [ordersList, allTransactions, floors, terminals, allSessions]
  );

  // Full report for Reports tab
  const fullReport = useMemo(
    () =>
      buildTerminalSalesReport({
        sales: ordersList,
        transactions: allTransactions,
        floors,
        terminals,
        sessions: allSessions,
        timeframe: reportTimeframe,
        startDate: reportStartDate,
        endDate: reportEndDate,
        filterFloorId: reportFloorId,
        filterTerminalId: reportTerminalId,
      }),
    [
      ordersList,
      allTransactions,
      floors,
      terminals,
      allSessions,
      reportTimeframe,
      reportStartDate,
      reportEndDate,
      reportFloorId,
      reportTerminalId,
    ]
  );

  // KPI metrics
  const kpiStats = useMemo(() => {
    const totalFloors = floors.length;
    const activeFloors = floors.filter((f) => f.status !== "inactive" && f.isActive !== false).length;
    const totalTerminals = terminals.length;
    const activeTerminals = terminals.filter(
      (t) => t.status !== "inactive" && t.isActive !== false
    ).length;
    const inactiveTerminals = totalTerminals - activeTerminals;
    const openSessionsCount = terminals.filter(
      (t) => t.sessionStatus === "open" || Boolean(t.currentSessionId)
    ).length;

    const todayTerminalSales = todayReport.byTerminal
      .filter((t) => t.terminalId !== "legacy_counter")
      .reduce((sum, t) => sum + Number(t.totalSales || 0), 0);

    return {
      totalFloors,
      activeFloors,
      totalTerminals,
      activeTerminals,
      inactiveTerminals,
      openSessionsCount,
      todayTerminalSales,
    };
  }, [floors, terminals, todayReport]);

  const todaySalesByTerminalMap = useMemo(() => {
    const map = new Map();
    for (const row of todayReport.byTerminal) {
      map.set(row.terminalId, row);
    }
    return map;
  }, [todayReport]);

  const todaySalesByFloorMap = useMemo(() => {
    const map = new Map();
    for (const row of todayReport.byFloor) {
      map.set(row.floorId, row);
    }
    return map;
  }, [todayReport]);

  // Filtered terminals for display
  const filteredTerminals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return terminals.filter((t) => {
      if (filterFloorId !== "all" && t.floorId !== filterFloorId) return false;
      const isAct = t.status !== "inactive" && t.isActive !== false;
      if (filterStatus === "active" && !isAct) return false;
      if (filterStatus === "inactive" && isAct) return false;
      const isOpen = t.sessionStatus === "open" || Boolean(t.currentSessionId);
      if (filterSessionStatus === "open" && !isOpen) return false;
      if (filterSessionStatus === "closed" && isOpen) return false;

      if (!q) return true;
      const staffStr = (t.assignedStaff || [])
        .map((s) => `${s.name} ${s.staffId}`)
        .join(" ")
        .toLowerCase();
      return (
        String(t.name || "").toLowerCase().includes(q) ||
        String(t.code || "").toLowerCase().includes(q) ||
        String(t.floorName || "").toLowerCase().includes(q) ||
        staffStr.includes(q)
      );
    });
  }, [terminals, searchQuery, filterFloorId, filterStatus, filterSessionStatus]);

  const displayedFloors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return floors.filter((f) => {
      if (filterFloorId !== "all" && f.id !== filterFloorId) return false;
      if (!q) return true;
      const floorMatch =
        String(f.name || "").toLowerCase().includes(q) ||
        String(f.description || "").toLowerCase().includes(q);
      const hasMatchingTerminal = filteredTerminals.some((t) => t.floorId === f.id);
      return floorMatch || hasMatchingTerminal;
    });
  }, [floors, filterFloorId, searchQuery, filteredTerminals]);

  // Close session live summary
  const closeModalSummary = useMemo(() => {
    if (!closeSessionTarget?.session) return null;
    if (closeSessionTxns.length > 0) {
      return calculateSessionSummaryFromTransactions(
        closeSessionTxns,
        closeSessionTarget.session.openingCash || 0,
        actualCashInput
      );
    }
    const sess = closeSessionTarget.session;
    const openAmt = Number(sess.openingCash || 0);
    const cashSales = Number(sess.totalCashSales || 0);
    const cashRefunds = Number(sess.totalCashRefunds || 0);
    const expected = Number((openAmt + cashSales - cashRefunds).toFixed(2));
    const hasActual = actualCashInput !== "" && Number.isFinite(Number(actualCashInput));
    const actualNum = hasActual ? Number(actualCashInput) : null;
    return {
      openingCash: openAmt,
      totalSales: Number(sess.totalSales || 0),
      totalCashSales: cashSales,
      totalUpiSales: Number(sess.totalUpiSales || 0),
      totalCardSales: Number(sess.totalCardSales || 0),
      totalCreditSales: Number(sess.totalCreditSales || 0),
      totalRefunds: Number(sess.totalRefunds || 0),
      totalCashRefunds: cashRefunds,
      totalCancellations: Number(sess.totalCancellations || 0),
      transactionCount: Number(sess.transactionCount || 0),
      expectedClosingCash: expected,
      actualClosingCash: actualNum,
      cashDifference: hasActual ? Number((actualNum - expected).toFixed(2)) : null,
    };
  }, [closeSessionTarget, closeSessionTxns, actualCashInput]);

  // =========================================================================
  // HANDLERS
  // =========================================================================

  const handleToggleInventoryMode = async (mode) => {
    try {
      const next = await setShopInventoryMode(db, shopId, mode);
      setInventoryModeOverride(next);
      showToast(
        next === INVENTORY_MODES.TERMINAL_WISE
          ? "Terminal-wise Mode active! Each terminal now has its own separate menu & billing."
          : next === INVENTORY_MODES.FLOOR_WISE
          ? "Floor-wise Mode active! Products can now be assigned to specific floors."
          : "Shared Mode active across all floors and terminals."
      );
    } catch (err) {
      showToast("Failed to update inventory mode: " + err.message, "error");
    }
  };

  const openAddFloorModal = () => {
    setEditingFloor(null);
    setFloorName("");
    setFloorDesc("");
    setFloorOrder(String(floors.length + 1));
    setFloorStatus("active");
    setFloorModalOpen(true);
  };

  const openEditFloorModal = (f) => {
    setEditingFloor(f);
    setFloorName(f.name || "");
    setFloorDesc(f.description || "");
    setFloorOrder(String(f.order ?? 1));
    setFloorStatus(f.status === "inactive" ? "inactive" : "active");
    setFloorModalOpen(true);
  };

  const handleSaveFloorSubmit = async (e) => {
    e.preventDefault();
    setSavingFloor(true);
    try {
      await saveFloor(
        db,
        shopId,
        { name: floorName, description: floorDesc, order: Number(floorOrder || 0), status: floorStatus },
        editingFloor?.id || null,
        terminals
      );
      setFloorModalOpen(false);
      showToast(editingFloor ? `Floor "${floorName}" updated!` : `Floor "${floorName}" added!`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingFloor(false);
    }
  };

  const handleToggleFloorActive = async (floor) => {
    try {
      const next = await toggleFloorStatus(db, shopId, floor, terminals);
      showToast(`Floor "${floor.name}" is now ${next}.`);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const requestDeleteFloor = (floor) => {
    setConfirmDialog({
      show: true,
      title: `Delete Floor "${floor.name}"?`,
      message:
        "This floor will be permanently removed. Deletion is blocked if any active terminals or open billing sessions exist on this floor.",
      confirmLabel: "Delete Floor",
      danger: true,
      onConfirm: async () => {
        try {
          await deleteFloor(db, shopId, floor.id, terminals);
          showToast(`Floor "${floor.name}" deleted.`);
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          setConfirmDialog((p) => ({ ...p, show: false }));
        }
      },
    });
  };

  const openAddTerminalModal = (preselectedFloorId = "") => {
    const defaultFloor =
      floors.find((f) => f.id === preselectedFloorId) ||
      floors.find((f) => f.status !== "inactive") ||
      floors[0];
    if (!defaultFloor) {
      showToast("Please create a floor before adding a terminal.", "error");
      openAddFloorModal();
      return;
    }
    setEditingTerminal(null);
    setTermName("");
    setTermFloorId(defaultFloor.id);
    setTermCode(generateUniqueTerminalCode(terminals, defaultFloor.name));
    setTermStatus("active");
    setTermStaffIds([]);
    setTermModalOpen(true);
  };

  const openEditTerminalModal = (term) => {
    setEditingTerminal(term);
    setTermName(term.name || "");
    setTermCode(term.code || "");
    setTermFloorId(term.floorId || "");
    setTermStatus(term.status === "inactive" ? "inactive" : "active");
    setTermStaffIds(Array.isArray(term.assignedStaffIds) ? term.assignedStaffIds : []);
    setTermModalOpen(true);
  };

  const handleSaveTerminalSubmit = async (e) => {
    e.preventDefault();
    setSavingTerminal(true);
    try {
      const selectedStaffObjs = staffList.filter((s) =>
        termStaffIds.includes(s.staffId || s.id)
      );
      await saveTerminal(
        db,
        shopId,
        {
          name: termName,
          code: termCode,
          floorId: termFloorId,
          status: termStatus,
          assignedStaff: selectedStaffObjs,
          deviceInfo: editingTerminal?.deviceInfo || captureDeviceInfo(),
        },
        terminals,
        floors,
        editingTerminal?.id || null
      );
      setTermModalOpen(false);
      showToast(
        editingTerminal
          ? `Terminal "${termName}" updated!`
          : `Terminal "${termName}" created!`
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingTerminal(false);
    }
  };

  const handleToggleTerminalActive = async (term) => {
    try {
      const next = await toggleTerminalStatus(db, shopId, term);
      showToast(`Terminal "${term.name}" is now ${next}.`);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const requestDeleteTerminal = (term) => {
    setConfirmDialog({
      show: true,
      title: `Delete Terminal "${term.name}" (${term.code})?`,
      message:
        "Historical sales and closed session records will be preserved, while the terminal registration will be removed. Deletion is blocked if a billing session is currently open.",
      confirmLabel: "Delete Terminal",
      danger: true,
      onConfirm: async () => {
        try {
          await deleteTerminal(db, shopId, term);
          if (detailsTerminal?.id === term.id) setDetailsTerminal(null);
          showToast(`Terminal "${term.name}" deleted.`);
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          setConfirmDialog((p) => ({ ...p, show: false }));
        }
      },
    });
  };

  const openAssignStaffModal = (term) => {
    setAssignModalTerminal(term);
    setAssignSelectedIds(Array.isArray(term.assignedStaffIds) ? term.assignedStaffIds : []);
    setAssignSearch("");
  };

  const handleSaveAssignStaff = async () => {
    if (!assignModalTerminal) return;
    setSavingAssign(true);
    try {
      const selectedObjs = staffList.filter((s) =>
        assignSelectedIds.includes(s.staffId || s.id)
      );
      await assignTerminalStaff(db, shopId, assignModalTerminal.id, selectedObjs);
      setAssignModalTerminal(null);
      showToast(`Updated staff assignments for ${assignModalTerminal.name}.`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingAssign(false);
    }
  };

  const handleOpenSessionSubmit = async (e) => {
    e.preventDefault();
    if (!openSessionTerminal) return;
    setSessionSubmitting(true);
    try {
      await openTerminalSession(db, {
        shopId,
        terminalId: openSessionTerminal.id,
        staffId: currentStaffId,
        staffName: currentStaffName,
        openingCash: Number(openingCashInput || 0),
        isOwner: !isStaff,
      });
      setOpenSessionTerminal(null);
      setOpeningCashInput("0");
      await refreshSessionsAndTxns();
      showToast(`Billing session opened on ${openSessionTerminal.name}!`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSessionSubmitting(false);
    }
  };

  const initiateCloseSession = async (term) => {
    // Locate the open session from allSessions or fetch fresh
    let openSess = allSessions.find(
      (s) => s.id === term.currentSessionId || (s.terminalId === term.id && s.status === "open")
    );
    if (!openSess) {
      const fresh = await fetchAllShopSessions(db, shopId, [term]);
      openSess = fresh.find((s) => s.id === term.currentSessionId || s.status === "open");
    }
    if (!openSess) {
      showToast("No open session found for this terminal.", "error");
      return;
    }
    setCloseSessionTarget({ terminal: term, session: openSess });
    setActualCashInput(String(openSess.expectedClosingCash ?? openSess.openingCash ?? 0));
    setClosingNotesInput("");
  };

  const handleCloseSessionSubmit = async (e) => {
    e.preventDefault();
    if (!closeSessionTarget?.terminal || !closeSessionTarget?.session) return;
    setSessionSubmitting(true);
    try {
      const report = await closeTerminalSession(db, {
        shopId,
        terminalId: closeSessionTarget.terminal.id,
        sessionId: closeSessionTarget.session.id,
        actualClosingCash: Number(actualCashInput || 0),
        closingStaffId: currentStaffId,
        closingStaffName: currentStaffName,
        closingNotes: closingNotesInput,
      });
      setCloseSessionTarget(null);
      setReportModalSession(report);
      await refreshSessionsAndTxns();
      showToast(`Session closed on ${report.terminalName}.`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSessionSubmitting(false);
    }
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();
    if (!refundTargetTxn) return;
    setRefundSubmitting(true);
    try {
      await recordRefundOrCancellation(db, {
        shopId,
        terminalId: refundTargetTxn.terminalId,
        originalTransaction: refundTargetTxn,
        actionType: refundActionType,
        reason: refundReason,
        staffId: currentStaffId,
        staffName: currentStaffName,
      });
      setRefundTargetTxn(null);
      setRefundReason("");
      await refreshSessionsAndTxns();
      showToast(
        refundActionType === "cancellation"
          ? "Transaction cancelled and session totals adjusted."
          : "Refund recorded and cash drawer reconciliation updated."
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setRefundSubmitting(false);
    }
  };

  const handleExportReportCsv = () => {
    const headers = [
      "Terminal Code",
      "Terminal Name",
      "Floor",
      "Orders",
      "Cash Sales",
      "UPI Sales",
      "Card Sales",
      "Credit Sales",
      "Refunds",
      "Total Sales",
    ];
    const rows = fullReport.byTerminal.map((t) => [
      `"${t.terminalCode || ""}"`,
      `"${(t.terminalName || "").replace(/"/g, '""')}"`,
      `"${(t.floorName || "").replace(/"/g, '""')}"`,
      t.ordersCount,
      t.cash.toFixed(2),
      t.upi.toFixed(2),
      t.card.toFixed(2),
      t.credit.toFixed(2),
      t.refunds.toFixed(2),
      t.totalSales.toFixed(2),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Terminal_Sales_Report_${reportTimeframe}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div style={styles.container}>
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div
          style={{
            ...styles.toast,
            backgroundColor: toast.type === "error" ? "#dc2626" : "#0f172a",
            borderColor: toast.type === "error" ? "#f87171" : "#10b981",
          }}
        >
          <span>{toast.type === "error" ? "⚠️" : "✅"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* HEADER */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn}>
              ← Back to POS
            </button>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "24px" }}>🖥️</span>
              <h1 style={styles.title}>Terminal Management</h1>
              <span style={styles.shopBadge}>{storeName}</span>
            </div>
            <p style={styles.subtitle}>
              Multi-floor POS terminal architecture, cashier shift sessions, cash reconciliation &amp; terminal-wise analytics
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <button type="button" onClick={openAddFloorModal} style={styles.secondaryBtn}>
            + Add Floor
          </button>
          <button type="button" onClick={() => openAddTerminalModal("")} style={styles.primaryBtn}>
            + Add Terminal
          </button>
        </div>
      </div>

      {/* KPI SUMMARY CARDS */}
      <div style={styles.kpiGrid}>
        {loading ? (
          Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} style={styles.skeletonCard}>
              <div style={styles.skeletonLineShort} />
              <div style={styles.skeletonLineTall} />
              <div style={styles.skeletonLineMed} />
            </div>
          ))
        ) : (
          <>
            <div style={styles.kpiCard}>
              <div style={styles.kpiTop}>
                <span style={styles.kpiLabel}>Total Floors</span>
                <span style={{ ...styles.kpiIcon, backgroundColor: "#eef2ff", color: "#4f46e5" }}>🏢</span>
              </div>
              <div style={styles.kpiValue}>{kpiStats.totalFloors}</div>
              <div style={styles.kpiSub}>{kpiStats.activeFloors} Active Floors</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiTop}>
                <span style={styles.kpiLabel}>Total Terminals</span>
                <span style={{ ...styles.kpiIcon, backgroundColor: "#e0f2fe", color: "#0284c7" }}>🖥️</span>
              </div>
              <div style={styles.kpiValue}>{kpiStats.totalTerminals}</div>
              <div style={styles.kpiSub}>Configured POS Counters</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiTop}>
                <span style={styles.kpiLabel}>Active Terminals</span>
                <span style={{ ...styles.kpiIcon, backgroundColor: "#dcfce7", color: "#15803d" }}>🟢</span>
              </div>
              <div style={{ ...styles.kpiValue, color: "#15803d" }}>{kpiStats.activeTerminals}</div>
              <div style={styles.kpiSub}>Ready for billing</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiTop}>
                <span style={styles.kpiLabel}>Inactive Terminals</span>
                <span style={{ ...styles.kpiIcon, backgroundColor: "#f1f5f9", color: "#64748b" }}>⏸️</span>
              </div>
              <div style={{ ...styles.kpiValue, color: "#64748b" }}>{kpiStats.inactiveTerminals}</div>
              <div style={styles.kpiSub}>Disabled / Offline</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiTop}>
                <span style={styles.kpiLabel}>Open Billing Sessions</span>
                <span style={{ ...styles.kpiIcon, backgroundColor: "#fff7ed", color: "#ea580c" }}>🔓</span>
              </div>
              <div style={{ ...styles.kpiValue, color: "#ea580c" }}>{kpiStats.openSessionsCount}</div>
              <div style={styles.kpiSub}>Active cashier shifts</div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiTop}>
                <span style={styles.kpiLabel}>Today&apos;s Terminal Sales</span>
                <span style={{ ...styles.kpiIcon, backgroundColor: "#ecfdf5", color: "#059669" }}>💰</span>
              </div>
              <div style={{ ...styles.kpiValue, color: "#059669", fontSize: "21px" }}>
                {formatCurrency(kpiStats.todayTerminalSales)}
              </div>
              <div style={styles.kpiSub}>
                {todayReport.byTerminal.filter((t) => t.terminalId !== "legacy_counter" && t.ordersCount > 0).length}{" "}
                terminals billed today
              </div>
            </div>
          </>
        )}
      </div>

      {/* NAVIGATION SUB-TABS */}
      <div style={styles.subTabRow}>
        <button
          type="button"
          onClick={() => setSubTab("overview")}
          style={{
            ...styles.subTabBtn,
            ...(subTab === "overview" ? styles.subTabBtnActive : {}),
          }}
        >
          🏢 Floors &amp; Terminals ({terminals.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("products")}
          style={{
            ...styles.subTabBtn,
            ...(subTab === "products" ? styles.subTabBtnActive : {}),
          }}
        >
          🛍️ Terminal Products &amp; Stock
        </button>
        <button
          type="button"
          onClick={() => setSubTab("product_overview")}
          style={{
            ...styles.subTabBtn,
            ...(subTab === "product_overview" ? styles.subTabBtnActive : {}),
          }}
        >
          📈 Product &amp; Sales Overview
        </button>
        <button
          type="button"
          onClick={() => setSubTab("sessions")}
          style={{
            ...styles.subTabBtn,
            ...(subTab === "sessions" ? styles.subTabBtnActive : {}),
          }}
        >
          ⏱️ Billing Sessions ({kpiStats.openSessionsCount} Open)
        </button>
        <button
          type="button"
          onClick={() => setSubTab("reports")}
          style={{
            ...styles.subTabBtn,
            ...(subTab === "reports" ? styles.subTabBtnActive : {}),
          }}
        >
          📊 Terminal Sales Reports
        </button>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: FLOORS & TERMINALS OVERVIEW                                */}
      {/* ================================================================= */}
      {subTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Inventory Architecture Config Strip */}
          <div style={styles.invModeCard}>
            <div>
              <div style={{ fontWeight: "800", fontSize: "14px", color: "#0f172a" }}>
                📦 Catalog &amp; Inventory Architecture Mode
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                {inventoryMode === INVENTORY_MODES.TERMINAL_WISE
                  ? "Terminal-wise Separate Billing: Each terminal has its own menu/items (e.g., Terminal 1 = Coffee, Terminal 2 = Hotel Foods)."
                  : inventoryMode === INVENTORY_MODES.FLOOR_WISE
                  ? "Floor-wise Inventory: Products can be assigned to specific floors without duplicating stock."
                  : "Shared Inventory: All floors and POS terminals share the same shop product catalog and stock."}
              </div>
            </div>
            <div style={styles.invModeToggle}>
              <button
                type="button"
                onClick={() => handleToggleInventoryMode(INVENTORY_MODES.SHARED)}
                style={{
                  ...styles.invToggleBtn,
                  backgroundColor: inventoryMode === INVENTORY_MODES.SHARED ? "#0f172a" : "transparent",
                  color: inventoryMode === INVENTORY_MODES.SHARED ? "#ffffff" : "#475569",
                }}
              >
                Shared
              </button>
              <button
                type="button"
                onClick={() => handleToggleInventoryMode(INVENTORY_MODES.FLOOR_WISE)}
                style={{
                  ...styles.invToggleBtn,
                  backgroundColor:
                    inventoryMode === INVENTORY_MODES.FLOOR_WISE ? "#4f46e5" : "transparent",
                  color: inventoryMode === INVENTORY_MODES.FLOOR_WISE ? "#ffffff" : "#475569",
                }}
              >
                Floor-wise
              </button>
              <button
                type="button"
                onClick={() => handleToggleInventoryMode(INVENTORY_MODES.TERMINAL_WISE)}
                style={{
                  ...styles.invToggleBtn,
                  backgroundColor:
                    inventoryMode === INVENTORY_MODES.TERMINAL_WISE ? "#059669" : "transparent",
                  color: inventoryMode === INVENTORY_MODES.TERMINAL_WISE ? "#ffffff" : "#475569",
                }}
              >
                Terminal-wise
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div style={styles.filterBar}>
            <input
              type="text"
              placeholder="🔍 Search terminal name, code, floor, or assigned staff..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
            <select
              value={filterFloorId}
              onChange={(e) => setFilterFloorId(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Floors ({floors.length})</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
            <select
              value={filterSessionStatus}
              onChange={(e) => setFilterSessionStatus(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Sessions</option>
              <option value="open">Session Open</option>
              <option value="closed">Session Closed</option>
            </select>
          </div>

          {/* Today's Terminal-wise Quick Summary Strip */}
          {terminals.length > 0 && (
            <div style={styles.todayQuickStrip}>
              <div style={{ fontSize: "12px", fontWeight: "800", color: "#475569", textTransform: "uppercase" }}>
                Today&apos;s Terminal Sales:
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {terminals.map((t) => {
                  const row = todaySalesByTerminalMap.get(t.id);
                  return (
                    <div key={t.id} style={styles.todayChip}>
                      <span style={{ fontWeight: "800", color: "#0f172a" }}>{t.code}</span>
                      <span style={{ color: "#64748b" }}>{t.name}:</span>
                      <strong style={{ color: "#059669" }}>
                        {formatCurrency(row?.totalSales || 0)}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Floors & Terminals Hierarchy */}
          {loading ? (
            <div style={styles.emptyBox}>Loading floors and terminals...</div>
          ) : floors.length === 0 ? (
            <div style={styles.emptyBox}>
              <div style={{ fontSize: "42px", marginBottom: "10px" }}>🏢</div>
              <h3 style={{ margin: "0 0 6px 0", color: "#0f172a" }}>No Floors Created Yet</h3>
              <p style={{ margin: "0 0 16px 0", color: "#64748b", fontSize: "13.5px" }}>
                Organize your shop by floors (e.g., Ground Floor, First Floor, Second Floor) and add POS billing terminals under each floor.
              </p>
              <button type="button" onClick={openAddFloorModal} style={styles.primaryBtn}>
                + Create Your First Floor
              </button>
            </div>
          ) : displayedFloors.length === 0 ? (
            <div style={styles.emptyBox}>No floors or terminals match your current search/filter.</div>
          ) : (
            displayedFloors.map((floor) => {
              const floorTerms = filteredTerminals.filter((t) => t.floorId === floor.id);
              const allFloorTerms = terminals.filter((t) => t.floorId === floor.id);
              const isCollapsed = Boolean(collapsedFloors[floor.id]);
              const isFloorActive = floor.status !== "inactive" && floor.isActive !== false;
              const floorToday = todaySalesByFloorMap.get(floor.id);
              const openOnFloor = allFloorTerms.filter(
                (t) => t.sessionStatus === "open" || Boolean(t.currentSessionId)
              ).length;

              return (
                <div key={floor.id} style={styles.floorCard}>
                  <div style={styles.floorHeader}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, cursor: "pointer", minWidth: "240px" }}
                      onClick={() =>
                        setCollapsedFloors((p) => ({ ...p, [floor.id]: !p[floor.id] }))
                      }
                    >
                      <div style={styles.floorOrderBadge}>#{floor.order ?? 0}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <h3 style={styles.floorName}>{floor.name}</h3>
                          <span
                            style={{
                              ...styles.pill,
                              backgroundColor: isFloorActive ? "#dcfce7" : "#f1f5f9",
                              color: isFloorActive ? "#15803d" : "#64748b",
                            }}
                          >
                            {isFloorActive ? "Active" : "Inactive"}
                          </span>
                          <span style={{ ...styles.pill, backgroundColor: "#eef2ff", color: "#4338ca" }}>
                            {allFloorTerms.length} Terminal{allFloorTerms.length === 1 ? "" : "s"}
                          </span>
                          {openOnFloor > 0 && (
                            <span style={{ ...styles.pill, backgroundColor: "#fff7ed", color: "#c2410c" }}>
                              🔓 {openOnFloor} Open
                            </span>
                          )}
                          <span style={{ ...styles.pill, backgroundColor: "#ecfdf5", color: "#047857" }}>
                            Today: {formatCurrency(floorToday?.totalSales || 0)}
                          </span>
                        </div>
                        {floor.description && (
                          <div style={styles.floorDesc}>{floor.description}</div>
                        )}
                      </div>
                    </div>

                    <div style={styles.floorActions}>
                      <button
                        type="button"
                        onClick={() => openAddTerminalModal(floor.id)}
                        style={styles.smallPrimaryBtn}
                      >
                        + Add Terminal
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditFloorModal(floor)}
                        style={styles.smallGhostBtn}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFloorActive(floor)}
                        style={styles.smallGhostBtn}
                      >
                        {isFloorActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteFloor(floor)}
                        style={styles.smallDangerBtn}
                      >
                        🗑️ Delete
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedFloors((p) => ({ ...p, [floor.id]: !p[floor.id] }))
                        }
                        style={styles.smallGhostBtn}
                        title="Expand / Collapse"
                      >
                        {isCollapsed ? "▼" : "▲"}
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div style={styles.terminalListBody}>
                      {floorTerms.length === 0 ? (
                        <div style={styles.emptyFloorTerms}>
                          <span>No terminals {searchQuery || filterStatus !== "all" ? "matching filters " : ""}on this floor.</span>
                          <button
                            type="button"
                            onClick={() => openAddTerminalModal(floor.id)}
                            style={styles.linkBtn}
                          >
                            + Add Terminal to {floor.name}
                          </button>
                        </div>
                      ) : (
                        <div style={styles.terminalGrid}>
                          {floorTerms.map((term) => {
                            const isActive = term.status !== "inactive" && term.isActive !== false;
                            const isOpen =
                              term.sessionStatus === "open" || Boolean(term.currentSessionId);
                            const termToday = todaySalesByTerminalMap.get(term.id);
                            const assigned = Array.isArray(term.assignedStaff)
                              ? term.assignedStaff
                              : [];

                            return (
                              <div
                                key={term.id}
                                style={{
                                  ...styles.termCard,
                                  borderColor: isOpen ? "#86efac" : "#e2e8f0",
                                  opacity: isActive ? 1 : 0.78,
                                }}
                              >
                                <div style={styles.termCardTop}>
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                      <span style={styles.termCodeBadge}>{term.code}</span>
                                      <span
                                        style={{
                                          ...styles.pill,
                                          backgroundColor: isActive ? "#dcfce7" : "#f1f5f9",
                                          color: isActive ? "#15803d" : "#64748b",
                                        }}
                                      >
                                        {isActive ? "Active" : "Inactive"}
                                      </span>
                                      <span
                                        style={{
                                          ...styles.pill,
                                          backgroundColor: isOpen ? "#dbeafe" : "#f8fafc",
                                          color: isOpen ? "#1d4ed8" : "#64748b",
                                          border: isOpen ? "none" : "1px solid #e2e8f0",
                                        }}
                                      >
                                        {isOpen ? "🟢 Session Open" : "⚪ Session Closed"}
                                      </span>
                                    </div>
                                    <h4 style={styles.termName}>{term.name}</h4>
                                    <div style={styles.termIdText}>ID: {term.id}</div>
                                  </div>

                                  <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700" }}>
                                      Today&apos;s Sales
                                    </div>
                                    <div style={{ fontSize: "16px", fontWeight: "900", color: "#059669" }}>
                                      {formatCurrency(termToday?.totalSales || 0)}
                                    </div>
                                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                                      {termToday?.ordersCount || 0} bills
                                    </div>
                                  </div>
                                </div>

                                <div style={styles.termMetaBlock}>
                                  <div style={styles.termMetaRow}>
                                    <span>Assigned Staff:</span>
                                    <span style={{ fontWeight: "700", color: "#0f172a" }}>
                                      {assigned.length === 0
                                        ? "None assigned"
                                        : assigned.map((s) => s.name).join(", ")}
                                    </span>
                                  </div>
                                  {isOpen && (
                                    <div style={styles.termMetaRow}>
                                      <span>Active Cashier:</span>
                                      <span style={{ fontWeight: "800", color: "#1d4ed8" }}>
                                        {term.activeStaffName || term.activeStaffId || "Cashier"}
                                      </span>
                                    </div>
                                  )}
                                  <div style={styles.termMetaRow}>
                                    <span>Last Active:</span>
                                    <span>{formatDateTime(term.lastActiveAt || term.updatedAt)}</span>
                                  </div>
                                  <div style={styles.termMetaRow}>
                                    <span>Device:</span>
                                    <span style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {term.deviceInfo?.deviceLabel || "Web POS"}
                                    </span>
                                  </div>
                                </div>

                                <div style={styles.termCardActions}>
                                  <button
                                    type="button"
                                    onClick={() => setDetailsTerminal(term)}
                                    style={styles.actionBtn}
                                  >
                                    👁️ Details
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openAssignStaffModal(term)}
                                    style={styles.actionBtn}
                                  >
                                    👥 Staff ({assigned.length})
                                  </button>
                                  {isOpen ? (
                                    <button
                                      type="button"
                                      onClick={() => initiateCloseSession(term)}
                                      style={{ ...styles.actionBtn, backgroundColor: "#fee2e2", color: "#dc2626", borderColor: "#fecaca" }}
                                    >
                                      🔒 Close Session
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={!isActive || !isFloorActive}
                                      onClick={() => {
                                        setOpenSessionTerminal(term);
                                        setOpeningCashInput("0");
                                      }}
                                      style={{
                                        ...styles.actionBtn,
                                        backgroundColor: isActive && isFloorActive ? "#eff6ff" : "#f8fafc",
                                        color: isActive && isFloorActive ? "#2563eb" : "#94a3b8",
                                        borderColor: isActive && isFloorActive ? "#bfdbfe" : "#e2e8f0",
                                        cursor: isActive && isFloorActive ? "pointer" : "not-allowed",
                                      }}
                                    >
                                      ▶ Open Session
                                    </button>
                                  )}
                                  {onSelectTerminalForPos && isActive && isFloorActive && (
                                    <button
                                      type="button"
                                      onClick={() => onSelectTerminalForPos(term)}
                                      style={{ ...styles.actionBtn, backgroundColor: "#fff7ed", color: "#ea580c", borderColor: "#fed7aa" }}
                                    >
                                      🧾 POS ↗
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedProdTerminalId(term.id);
                                      setSubTab("products");
                                    }}
                                    style={{ ...styles.actionBtn, backgroundColor: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" }}
                                  >
                                    📦 Products
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditTerminalModal(term)}
                                    style={styles.actionBtn}
                                  >
                                    ✏️ Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTerminalActive(term)}
                                    style={styles.actionBtn}
                                  >
                                    {isActive ? "⏸️ Deactivate" : "▶️ Activate"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => requestDeleteTerminal(term)}
                                    style={{ ...styles.actionBtn, color: "#dc2626" }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1B: TERMINAL PRODUCT & CATEGORY MANAGEMENT (BOTH MODELS)       */}
      {/* ================================================================= */}
      {subTab === "products" && (
        <TerminalProductManagement
          shopId={shopId}
          rawUserData={rawUserData}
          terminals={terminals}
          shopProducts={shopProducts}
          productCollection={productCollection}
          shopInventoryMode={inventoryMode}
          primaryTerminalId={
            primaryTerminalId ||
            terminals.find((t) => t.isPrimary === true || t.id === "terminal_1")?.id ||
            terminals[0]?.id ||
            null
          }
          salesList={ordersList}
          allTransactions={allTransactions}
          selectedTerminalId={selectedProdTerminalId}
          onSelectTerminalId={setSelectedProdTerminalId}
          onShowToast={showToast}
          allowNegativeStock={allowNegativeStock}
        />
      )}

      {/* ================================================================= */}
      {/* TAB 1C: OWNER CONSOLIDATED PRODUCT & SALES OVERVIEW               */}
      {/* ================================================================= */}
      {subTab === "product_overview" && (
        <TerminalProductOverview
          shopId={shopId}
          terminals={terminals}
          shopProducts={shopProducts}
          salesList={ordersList}
          wasteRecords={wasteRecords}
          shopInventoryMode={inventoryMode}
          primaryTerminalId={
            primaryTerminalId ||
            terminals.find((t) => t.isPrimary === true || t.id === "terminal_1")?.id ||
            terminals[0]?.id ||
            null
          }
          onOpenTerminalProducts={(tId) => {
            setSelectedProdTerminalId(tId);
            setSubTab("products");
          }}
        />
      )}

      {/* ================================================================= */}
      {/* TAB 2: BILLING SESSIONS & RECONCILIATION                          */}
      {/* ================================================================= */}
      {subTab === "sessions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div>
                <h3 style={styles.sectionTitle}>🔓 Currently Open Billing Sessions</h3>
                <p style={styles.sectionSub}>Live active cashier shifts across all floors and terminals</p>
              </div>
              <button type="button" onClick={refreshSessionsAndTxns} style={styles.smallGhostBtn}>
                🔄 Refresh
              </button>
            </div>

            {allSessions.filter((s) => s.status === "open").length === 0 ? (
              <div style={styles.emptyInline}>No billing sessions are currently open.</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Terminal</th>
                      <th style={styles.th}>Floor</th>
                      <th style={styles.th}>Cashier</th>
                      <th style={styles.th}>Opened At</th>
                      <th style={styles.th}>Opening Cash</th>
                      <th style={styles.th}>Sales (Bills)</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allSessions
                      .filter((s) => s.status === "open")
                      .map((sess) => {
                        const term = terminals.find((t) => t.id === sess.terminalId);
                        return (
                          <tr key={sess.id}>
                            <td style={styles.td}>
                              <strong>{sess.terminalName}</strong>{" "}
                              <span style={styles.termCodeBadge}>{sess.terminalCode}</span>
                            </td>
                            <td style={styles.td}>{sess.floorName}</td>
                            <td style={styles.td}>{sess.staffName}</td>
                            <td style={styles.td}>{formatDateTime(sess.openedAt || sess.openedAtMs)}</td>
                            <td style={styles.td}>{formatCurrency(sess.openingCash)}</td>
                            <td style={styles.td}>
                              <strong style={{ color: "#059669" }}>{formatCurrency(sess.totalSales)}</strong> (
                              {sess.transactionCount || 0})
                            </td>
                            <td style={styles.td}>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  onClick={() => setReportModalSession(sess)}
                                  style={styles.smallGhostBtn}
                                >
                                  📄 Summary
                                </button>
                                {term && (
                                  <button
                                    type="button"
                                    onClick={() => initiateCloseSession(term)}
                                    style={styles.smallDangerBtn}
                                  >
                                    🔒 Close Session
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div>
                <h3 style={styles.sectionTitle}>📜 Terminal Session History &amp; Cash Reconciliation</h3>
                <p style={styles.sectionSub}>Complete shift audit trail with expected vs actual cash variance</p>
              </div>
            </div>

            {allSessions.length === 0 ? (
              <div style={styles.emptyInline}>No session history recorded yet.</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Terminal</th>
                      <th style={styles.th}>Floor</th>
                      <th style={styles.th}>Staff</th>
                      <th style={styles.th}>Opened / Closed</th>
                      <th style={styles.th}>Opening</th>
                      <th style={styles.th}>Gross Sales</th>
                      <th style={styles.th}>Expected Cash</th>
                      <th style={styles.th}>Actual Cash</th>
                      <th style={styles.th}>Difference</th>
                      <th style={styles.th}>Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allSessions.map((sess) => {
                      const isOpen = sess.status === "open";
                      const diff =
                        sess.cashDifference !== null && sess.cashDifference !== undefined
                          ? Number(sess.cashDifference)
                          : null;
                      return (
                        <tr key={sess.id}>
                          <td style={styles.td}>
                            <span
                              style={{
                                ...styles.pill,
                                backgroundColor: isOpen ? "#dcfce7" : "#f1f5f9",
                                color: isOpen ? "#15803d" : "#475569",
                              }}
                            >
                              {isOpen ? "OPEN" : "CLOSED"}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <strong>{sess.terminalName}</strong>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{sess.terminalCode}</div>
                          </td>
                          <td style={styles.td}>{sess.floorName}</td>
                          <td style={styles.td}>
                            <div>{sess.staffName}</div>
                            {sess.closingStaffName && (
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                Closed: {sess.closingStaffName}
                              </div>
                            )}
                          </td>
                          <td style={styles.td}>
                            <div style={{ fontSize: "12px" }}>{formatDateTime(sess.openedAt || sess.openedAtMs)}</div>
                            {sess.closedAt && (
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                → {formatDateTime(sess.closedAt || sess.closedAtMs)}
                              </div>
                            )}
                          </td>
                          <td style={styles.td}>{formatCurrency(sess.openingCash)}</td>
                          <td style={styles.td}>
                            <strong>{formatCurrency(sess.totalSales)}</strong>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              {sess.transactionCount || 0} bills
                            </div>
                          </td>
                          <td style={styles.td}>{formatCurrency(sess.expectedClosingCash)}</td>
                          <td style={styles.td}>
                            {sess.actualClosingCash !== null && sess.actualClosingCash !== undefined
                              ? formatCurrency(sess.actualClosingCash)
                              : "—"}
                          </td>
                          <td style={styles.td}>
                            {diff === null ? (
                              "—"
                            ) : (
                              <span
                                style={{
                                  fontWeight: "800",
                                  color:
                                    Math.abs(diff) < 0.01
                                      ? "#15803d"
                                      : diff > 0
                                      ? "#0369a1"
                                      : "#dc2626",
                                }}
                              >
                                {diff >= 0 ? "+" : ""}
                                {formatCurrency(diff)}
                              </span>
                            )}
                          </td>
                          <td style={styles.td}>
                            <button
                              type="button"
                              onClick={() => setReportModalSession(sess)}
                              style={styles.smallGhostBtn}
                            >
                              🧾 Z-Report
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: TERMINAL-WISE SALES REPORTS                                */}
      {/* ================================================================= */}
      {subTab === "reports" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Report Filter Bar */}
          <div style={styles.filterBar}>
            <div style={styles.timeframeGroup}>
              {[
                { id: "daily", label: "Daily (Today)" },
                { id: "weekly", label: "Weekly (7d)" },
                { id: "monthly", label: "Monthly" },
                { id: "all", label: "All Time" },
                { id: "custom", label: "Custom" },
              ].map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  onClick={() => setReportTimeframe(tf.id)}
                  style={{
                    ...styles.tfBtn,
                    backgroundColor: reportTimeframe === tf.id ? "#0f172a" : "#ffffff",
                    color: reportTimeframe === tf.id ? "#ffffff" : "#475569",
                  }}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {reportTimeframe === "custom" && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  style={styles.filterSelect}
                />
                <span style={{ color: "#64748b", fontSize: "12px" }}>to</span>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  style={styles.filterSelect}
                />
              </div>
            )}

            <select
              value={reportFloorId}
              onChange={(e) => {
                setReportFloorId(e.target.value);
                setReportTerminalId("all");
              }}
              style={styles.filterSelect}
            >
              <option value="all">All Floors</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            <select
              value={reportTerminalId}
              onChange={(e) => setReportTerminalId(e.target.value)}
              style={styles.filterSelect}
            >
              <option value="all">All Terminals</option>
              {terminals
                .filter((t) => reportFloorId === "all" || t.floorId === reportFloorId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </option>
                ))}
            </select>

            <button type="button" onClick={handleExportReportCsv} style={styles.secondaryBtn}>
              ⬇️ Export CSV
            </button>
          </div>

          {/* Payment Method Breakdown Summary */}
          <div style={styles.paymentBreakdownGrid}>
            <div style={styles.payCard}>
              <div style={styles.payLabel}>Net Revenue</div>
              <div style={{ ...styles.payVal, color: "#0f172a" }}>
                {formatCurrency(fullReport.summary.totalNetSales)}
              </div>
              <div style={styles.paySub}>{fullReport.summary.totalOrders} completed bills</div>
            </div>
            <div style={styles.payCard}>
              <div style={styles.payLabel}>💵 Cash</div>
              <div style={{ ...styles.payVal, color: "#15803d" }}>
                {formatCurrency(fullReport.paymentBreakdown.cash)}
              </div>
              <div style={styles.paySub}>Cash drawer collection</div>
            </div>
            <div style={styles.payCard}>
              <div style={styles.payLabel}>📱 UPI / QR</div>
              <div style={{ ...styles.payVal, color: "#2563eb" }}>
                {formatCurrency(fullReport.paymentBreakdown.upi)}
              </div>
              <div style={styles.paySub}>Digital QR payments</div>
            </div>
            <div style={styles.payCard}>
              <div style={styles.payLabel}>💳 Card</div>
              <div style={{ ...styles.payVal, color: "#7c3aed" }}>
                {formatCurrency(fullReport.paymentBreakdown.card)}
              </div>
              <div style={styles.paySub}>Credit / Debit cards</div>
            </div>
            <div style={styles.payCard}>
              <div style={styles.payLabel}>↩️ Refunds &amp; Cancels</div>
              <div style={{ ...styles.payVal, color: "#dc2626" }}>
                {formatCurrency(fullReport.summary.totalRefunds)}
              </div>
              <div style={styles.paySub}>
                Cancelled: {formatCurrency(fullReport.summary.totalCancellations)}
              </div>
            </div>
          </div>

          {/* Floor-wise & Terminal-wise Sales Tables */}
          <div style={styles.reportsTwoCol}>
            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>🏢 Floor-wise Sales</h3>
              </div>
              {fullReport.byFloor.length === 0 ? (
                <div style={styles.emptyInline}>No floor sales data in this period.</div>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Floor</th>
                        <th style={styles.th}>Bills</th>
                        <th style={styles.th}>Cash</th>
                        <th style={styles.th}>UPI</th>
                        <th style={styles.th}>Card</th>
                        <th style={styles.th}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fullReport.byFloor.map((row) => (
                        <tr key={row.floorId}>
                          <td style={styles.td}>
                            <strong>{row.floorName}</strong>
                          </td>
                          <td style={styles.td}>{row.ordersCount}</td>
                          <td style={styles.td}>{formatCurrency(row.cash)}</td>
                          <td style={styles.td}>{formatCurrency(row.upi)}</td>
                          <td style={styles.td}>{formatCurrency(row.card)}</td>
                          <td style={styles.td}>
                            <strong style={{ color: "#059669" }}>
                              {formatCurrency(row.totalSales)}
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={styles.sectionCard}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>👤 Staff-wise Sales</h3>
              </div>
              {fullReport.byStaff.length === 0 ? (
                <div style={styles.emptyInline}>No staff sales data in this period.</div>
              ) : (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Staff</th>
                        <th style={styles.th}>Bills</th>
                        <th style={styles.th}>Avg Bill</th>
                        <th style={styles.th}>Cash</th>
                        <th style={styles.th}>UPI + Card</th>
                        <th style={styles.th}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fullReport.byStaff.map((row) => (
                        <tr key={row.staffId}>
                          <td style={styles.td}>
                            <strong>{row.staffName}</strong>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{row.staffId}</div>
                          </td>
                          <td style={styles.td}>{row.ordersCount}</td>
                          <td style={styles.td}>{formatCurrency(row.avgOrderValue)}</td>
                          <td style={styles.td}>{formatCurrency(row.cash)}</td>
                          <td style={styles.td}>{formatCurrency(row.upi + row.card)}</td>
                          <td style={styles.td}>
                            <strong style={{ color: "#2563eb" }}>
                              {formatCurrency(row.totalSales)}
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Terminal-wise Sales Table */}
          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <h3 style={styles.sectionTitle}>🖥️ Terminal-wise Sales Breakdown</h3>
            </div>
            {fullReport.byTerminal.length === 0 ? (
              <div style={styles.emptyInline}>No terminal sales data in this period.</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Code</th>
                      <th style={styles.th}>Terminal</th>
                      <th style={styles.th}>Floor</th>
                      <th style={styles.th}>Bills</th>
                      <th style={styles.th}>Cash</th>
                      <th style={styles.th}>UPI</th>
                      <th style={styles.th}>Card</th>
                      <th style={styles.th}>Credit</th>
                      <th style={styles.th}>Refunds</th>
                      <th style={styles.th}>Total Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullReport.byTerminal.map((row) => (
                      <tr key={row.terminalId}>
                        <td style={styles.td}>
                          <span style={styles.termCodeBadge}>{row.terminalCode}</span>
                        </td>
                        <td style={styles.td}>
                          <strong>{row.terminalName}</strong>
                        </td>
                        <td style={styles.td}>{row.floorName}</td>
                        <td style={styles.td}>{row.ordersCount}</td>
                        <td style={styles.td}>{formatCurrency(row.cash)}</td>
                        <td style={styles.td}>{formatCurrency(row.upi)}</td>
                        <td style={styles.td}>{formatCurrency(row.card)}</td>
                        <td style={styles.td}>{formatCurrency(row.credit)}</td>
                        <td style={{ ...styles.td, color: "#dc2626" }}>
                          {row.refunds > 0 ? `-${formatCurrency(row.refunds)}` : "—"}
                        </td>
                        <td style={styles.td}>
                          <strong style={{ color: "#059669" }}>
                            {formatCurrency(row.totalSales)}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Terminal Transactions & Refunds/Cancellations Log */}
          <div style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <div>
                <h3 style={styles.sectionTitle}>🧾 Terminal Transaction History</h3>
                <p style={styles.sectionSub}>
                  All recorded sales, refunds, and cancellations across terminals
                </p>
              </div>
            </div>

            {allTransactions.length === 0 ? (
              <div style={styles.emptyInline}>No terminal transactions recorded yet.</div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Time</th>
                      <th style={styles.th}>Bill #</th>
                      <th style={styles.th}>Terminal</th>
                      <th style={styles.th}>Staff</th>
                      <th style={styles.th}>Type / Status</th>
                      <th style={styles.th}>Payment</th>
                      <th style={styles.th}>Amount</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTransactions
                      .filter(
                        (txn) =>
                          (reportFloorId === "all" || txn.floorId === reportFloorId) &&
                          (reportTerminalId === "all" || txn.terminalId === reportTerminalId)
                      )
                      .slice(0, 60)
                      .map((txn) => (
                        <tr key={`${txn.terminalId}_${txn.id}`}>
                          <td style={styles.td}>{formatDateTime(txn.createdAt || txn.createdAtMs)}</td>
                          <td style={styles.td}>
                            <strong>{txn.billNo || txn.id}</strong>
                          </td>
                          <td style={styles.td}>
                            {txn.terminalName} ({txn.terminalCode})
                          </td>
                          <td style={styles.td}>{txn.staffName}</td>
                          <td style={styles.td}>
                            <span
                              style={{
                                ...styles.pill,
                                backgroundColor:
                                  txn.status === "completed"
                                    ? "#dcfce7"
                                    : txn.status === "refunded"
                                    ? "#fef3c7"
                                    : "#fee2e2",
                                color:
                                  txn.status === "completed"
                                    ? "#15803d"
                                    : txn.status === "refunded"
                                    ? "#b45309"
                                    : "#dc2626",
                              }}
                            >
                              {String(txn.type || "sale").toUpperCase()} • {String(txn.status || "completed").toUpperCase()}
                            </span>
                          </td>
                          <td style={styles.td}>{txn.paymentMethod}</td>
                          <td style={styles.td}>
                            <strong
                              style={{
                                color: txn.type === "refund" || txn.status === "cancelled" ? "#dc2626" : "#0f172a",
                              }}
                            >
                              {txn.type === "refund" ? "-" : ""}
                              {formatCurrency(txn.amount)}
                            </strong>
                          </td>
                          <td style={styles.td}>
                            {txn.type === "sale" && txn.status === "completed" ? (
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRefundTargetTxn(txn);
                                    setRefundActionType("refund");
                                    setRefundReason("");
                                  }}
                                  style={styles.smallGhostBtn}
                                >
                                  ↩️ Refund
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRefundTargetTxn(txn);
                                    setRefundActionType("cancellation");
                                    setRefundReason("");
                                  }}
                                  style={styles.smallDangerBtn}
                                >
                                  🚫 Cancel
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: "11px", color: "#64748b" }}>
                                {txn.notes || txn.refundReason || "—"}
                              </span>
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
      )}

      {/* ================================================================= */}
      {/* MODALS                                                            */}
      {/* ================================================================= */}

      {/* 1. ADD / EDIT FLOOR MODAL */}
      {floorModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setFloorModalOpen(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{editingFloor ? "Edit Floor" : "Add New Floor"}</h3>
              <button type="button" onClick={() => setFloorModalOpen(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveFloorSubmit} style={styles.modalBody}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Floor Name *</label>
                <input
                  type="text"
                  required
                  value={floorName}
                  onChange={(e) => setFloorName(e.target.value)}
                  placeholder="e.g. Ground Floor, First Floor, Electronics Wing"
                  style={styles.input}
                  autoFocus
                />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Description</label>
                <textarea
                  rows={2}
                  value={floorDesc}
                  onChange={(e) => setFloorDesc(e.target.value)}
                  placeholder="e.g. Main supermarket & express billing counters"
                  style={{ ...styles.input, resize: "vertical" }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Floor Order</label>
                  <input
                    type="number"
                    value={floorOrder}
                    onChange={(e) => setFloorOrder(e.target.value)}
                    style={styles.input}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Status</label>
                  <select
                    value={floorStatus}
                    onChange={(e) => setFloorStatus(e.target.value)}
                    style={styles.input}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setFloorModalOpen(false)}
                  style={styles.cancelBtn}
                  disabled={savingFloor}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryBtn} disabled={savingFloor}>
                  {savingFloor ? "Saving..." : editingFloor ? "Update Floor" : "Create Floor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. ADD / EDIT TERMINAL MODAL */}
      {termModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setTermModalOpen(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "540px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                {editingTerminal ? "Edit POS Terminal" : "Add POS Terminal"}
              </h3>
              <button type="button" onClick={() => setTermModalOpen(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveTerminalSubmit} style={styles.modalBody}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Assigned Floor *</label>
                <select
                  required
                  value={termFloorId}
                  onChange={(e) => setTermFloorId(e.target.value)}
                  style={styles.input}
                >
                  <option value="" disabled>
                    -- Select Floor --
                  </option>
                  {floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} {f.status === "inactive" ? "(Inactive)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "12px" }}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Terminal Name *</label>
                  <input
                    type="text"
                    required
                    value={termName}
                    onChange={(e) => setTermName(e.target.value)}
                    placeholder="e.g. Terminal 01 - Billing Counter 1"
                    style={styles.input}
                    autoFocus
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Terminal Code *</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text"
                      required
                      value={termCode}
                      onChange={(e) => setTermCode(e.target.value.toUpperCase())}
                      placeholder="TRM-01"
                      style={{ ...styles.input, fontWeight: "800" }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const f = floors.find((fl) => fl.id === termFloorId);
                        setTermCode(generateUniqueTerminalCode(terminals, f?.name || ""));
                      }}
                      style={styles.smallGhostBtn}
                      title="Generate Unique Code"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Terminal Status</label>
                <select
                  value={termStatus}
                  onChange={(e) => setTermStatus(e.target.value)}
                  style={styles.input}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Assign Authorized Staff ({termStaffIds.length} selected)</label>
                {staffList.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "#64748b", padding: "8px", backgroundColor: "#f8fafc", borderRadius: "8px" }}>
                    No staff accounts found. Create staff in Staff Management first, or assign later.
                  </div>
                ) : (
                  <div style={styles.staffCheckGrid}>
                    {staffList.map((st) => {
                      const sId = st.staffId || st.id;
                      const checked = termStaffIds.includes(sId);
                      return (
                        <label key={sId} style={styles.staffCheckItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setTermStaffIds((prev) =>
                                prev.includes(sId)
                                  ? prev.filter((id) => id !== sId)
                                  : [...prev, sId]
                              )
                            }
                          />
                          <span>
                            <strong>{st.name}</strong> ({sId}) • {st.role || "staff"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setTermModalOpen(false)}
                  style={styles.cancelBtn}
                  disabled={savingTerminal}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryBtn} disabled={savingTerminal}>
                  {savingTerminal
                    ? "Saving..."
                    : editingTerminal
                    ? "Update Terminal"
                    : "Create Terminal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. ASSIGN STAFF MODAL */}
      {assignModalTerminal && (
        <div style={styles.modalOverlay} onClick={() => setAssignModalTerminal(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>Assign Staff to {assignModalTerminal.name}</h3>
                <p style={styles.modalSub}>
                  {assignModalTerminal.code} • {assignModalTerminal.floorName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalTerminal(null)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <input
                type="text"
                placeholder="🔍 Search staff by name, ID, or role..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                style={{ ...styles.input, marginBottom: "12px" }}
              />
              {staffList.length === 0 ? (
                <div style={styles.emptyInline}>No staff members created yet.</div>
              ) : (
                <div style={{ ...styles.staffCheckGrid, maxHeight: "280px" }}>
                  {staffList
                    .filter((s) => {
                      const q = assignSearch.toLowerCase();
                      return (
                        !q ||
                        String(s.name || "").toLowerCase().includes(q) ||
                        String(s.staffId || s.id || "").toLowerCase().includes(q) ||
                        String(s.role || "").toLowerCase().includes(q)
                      );
                    })
                    .map((st) => {
                      const sId = st.staffId || st.id;
                      const checked = assignSelectedIds.includes(sId);
                      const isInactiveStaff = st.status === "inactive" || st.isActive === false;
                      return (
                        <label key={sId} style={styles.staffCheckItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setAssignSelectedIds((prev) =>
                                prev.includes(sId)
                                  ? prev.filter((id) => id !== sId)
                                  : [...prev, sId]
                              )
                            }
                          />
                          <div style={{ flex: 1 }}>
                            <strong>{st.name}</strong>{" "}
                            <span style={{ color: "#64748b", fontSize: "12px" }}>({sId})</span>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>
                              Role: {st.role || "staff"} {isInactiveStaff ? "• INACTIVE" : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                </div>
              )}
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setAssignModalTerminal(null)}
                  style={styles.cancelBtn}
                  disabled={savingAssign}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAssignStaff}
                  style={styles.primaryBtn}
                  disabled={savingAssign}
                >
                  {savingAssign ? "Saving..." : `Save Assignments (${assignSelectedIds.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. TERMINAL DETAILS MODAL */}
      {detailsTerminal && (
        <div style={styles.modalOverlay} onClick={() => setDetailsTerminal(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "700px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h3 style={styles.modalTitle}>🖥️ {detailsTerminal.name}</h3>
                  <span style={styles.termCodeBadge}>{detailsTerminal.code}</span>
                </div>
                <p style={styles.modalSub}>
                  Floor: {detailsTerminal.floorName} • ID: {detailsTerminal.id}
                </p>
              </div>
              <button type="button" onClick={() => setDetailsTerminal(null)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.detailsInfoGrid}>
                <div style={styles.detailsBox}>
                  <span style={styles.detailsLabel}>Status</span>
                  <strong>
                    {detailsTerminal.status === "inactive" ? "Inactive" : "Active"} • Session{" "}
                    {detailsTerminal.sessionStatus === "open" ? "Open" : "Closed"}
                  </strong>
                </div>
                <div style={styles.detailsBox}>
                  <span style={styles.detailsLabel}>Created Date</span>
                  <strong>{formatDateTime(detailsTerminal.createdAt)}</strong>
                </div>
                <div style={styles.detailsBox}>
                  <span style={styles.detailsLabel}>Last Active</span>
                  <strong>{formatDateTime(detailsTerminal.lastActiveAt || detailsTerminal.updatedAt)}</strong>
                </div>
                <div style={styles.detailsBox}>
                  <span style={styles.detailsLabel}>Device Info</span>
                  <strong style={{ fontSize: "12px" }}>
                    {detailsTerminal.deviceInfo?.deviceLabel || "Web POS"}
                  </strong>
                </div>
              </div>

              <div style={{ marginTop: "14px" }}>
                <div style={styles.sectionHeading}>Recent Sessions ({detailsSessions.length})</div>
                {detailsSessions.length === 0 ? (
                  <div style={styles.emptyInline}>No sessions recorded on this terminal yet.</div>
                ) : (
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Staff</th>
                          <th style={styles.th}>Opened</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Sales</th>
                          <th style={styles.th}>Report</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailsSessions.slice(0, 8).map((s) => (
                          <tr key={s.id}>
                            <td style={styles.td}>{s.staffName}</td>
                            <td style={styles.td}>{formatDateTime(s.openedAt || s.openedAtMs)}</td>
                            <td style={styles.td}>{String(s.status || "").toUpperCase()}</td>
                            <td style={styles.td}>{formatCurrency(s.totalSales)}</td>
                            <td style={styles.td}>
                              <button
                                type="button"
                                onClick={() => setReportModalSession(s)}
                                style={styles.smallGhostBtn}
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ marginTop: "14px" }}>
                <div style={styles.sectionHeading}>Recent Transactions ({detailsTxns.length})</div>
                {detailsTxns.length === 0 ? (
                  <div style={styles.emptyInline}>No transactions recorded on this terminal yet.</div>
                ) : (
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Bill #</th>
                          <th style={styles.th}>Type</th>
                          <th style={styles.th}>Payment</th>
                          <th style={styles.th}>Amount</th>
                          <th style={styles.th}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailsTxns.slice(0, 10).map((t) => (
                          <tr key={t.id}>
                            <td style={styles.td}>{t.billNo || t.id}</td>
                            <td style={styles.td}>
                              {t.type} ({t.status})
                            </td>
                            <td style={styles.td}>{t.paymentMethod}</td>
                            <td style={styles.td}>{formatCurrency(t.amount)}</td>
                            <td style={styles.td}>{formatDateTime(t.createdAt || t.createdAtMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. OPEN SESSION MODAL */}
      {openSessionTerminal && (
        <div style={styles.modalOverlay} onClick={() => setOpenSessionTerminal(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "440px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>▶ Open Billing Session</h3>
                <p style={styles.modalSub}>
                  {openSessionTerminal.name} ({openSessionTerminal.code}) •{" "}
                  {openSessionTerminal.floorName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenSessionTerminal(null)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleOpenSessionSubmit} style={styles.modalBody}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Opening Cash Amount (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={openingCashInput}
                  onChange={(e) => setOpeningCashInput(e.target.value)}
                  style={styles.input}
                  autoFocus
                />
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
                Staff: <strong>{currentStaffName}</strong> ({currentStaffId}) •{" "}
                {new Date().toLocaleString("en-IN")}
              </div>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setOpenSessionTerminal(null)}
                  style={styles.cancelBtn}
                  disabled={sessionSubmitting}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryBtn} disabled={sessionSubmitting}>
                  {sessionSubmitting ? "Opening..." : "Open Session"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. CLOSE SESSION MODAL */}
      {closeSessionTarget && closeModalSummary && (
        <div style={styles.modalOverlay} onClick={() => setCloseSessionTarget(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "500px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>🔒 Close Billing Session</h3>
                <p style={styles.modalSub}>
                  {closeSessionTarget.terminal.name} ({closeSessionTarget.terminal.code})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCloseSessionTarget(null)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCloseSessionSubmit} style={styles.modalBody}>
              <div style={styles.summaryBox}>
                <div style={styles.sumRow}>
                  <span>Opening Cash</span>
                  <strong>{formatCurrency(closeModalSummary.openingCash)}</strong>
                </div>
                <div style={styles.sumRow}>
                  <span>+ Cash Sales</span>
                  <strong style={{ color: "#15803d" }}>
                    +{formatCurrency(closeModalSummary.totalCashSales)}
                  </strong>
                </div>
                <div style={styles.sumRow}>
                  <span>UPI Sales</span>
                  <strong>{formatCurrency(closeModalSummary.totalUpiSales)}</strong>
                </div>
                <div style={styles.sumRow}>
                  <span>Card Sales</span>
                  <strong>{formatCurrency(closeModalSummary.totalCardSales)}</strong>
                </div>
                <div style={styles.sumRow}>
                  <span>- Cash Refunds</span>
                  <strong style={{ color: "#dc2626" }}>
                    -{formatCurrency(closeModalSummary.totalCashRefunds)}
                  </strong>
                </div>
                <div style={{ ...styles.sumRow, borderTop: "1px solid #cbd5e1", paddingTop: "6px" }}>
                  <strong>Expected Closing Cash</strong>
                  <strong>{formatCurrency(closeModalSummary.expectedClosingCash)}</strong>
                </div>
              </div>

              <div style={{ ...styles.fieldGroup, marginTop: "12px" }}>
                <label style={styles.label}>Actual Closing Cash (₹) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={actualCashInput}
                  onChange={(e) => setActualCashInput(e.target.value)}
                  style={styles.input}
                  autoFocus
                />
              </div>

              {closeModalSummary.cashDifference !== null && (
                <div
                  style={{
                    marginTop: "8px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    fontSize: "12.5px",
                    fontWeight: "800",
                    backgroundColor:
                      Math.abs(closeModalSummary.cashDifference) < 0.01
                        ? "#dcfce7"
                        : closeModalSummary.cashDifference > 0
                        ? "#e0f2fe"
                        : "#fee2e2",
                    color:
                      Math.abs(closeModalSummary.cashDifference) < 0.01
                        ? "#15803d"
                        : closeModalSummary.cashDifference > 0
                        ? "#0369a1"
                        : "#dc2626",
                  }}
                >
                  Cash Difference: {closeModalSummary.cashDifference >= 0 ? "+" : ""}
                  {formatCurrency(closeModalSummary.cashDifference)}
                </div>
              )}

              <div style={{ ...styles.fieldGroup, marginTop: "12px" }}>
                <label style={styles.label}>Closing Notes</label>
                <textarea
                  rows={2}
                  value={closingNotesInput}
                  onChange={(e) => setClosingNotesInput(e.target.value)}
                  style={{ ...styles.input, resize: "vertical" }}
                  placeholder="Optional remarks..."
                />
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setCloseSessionTarget(null)}
                  style={styles.cancelBtn}
                  disabled={sessionSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...styles.primaryBtn, backgroundColor: "#dc2626" }}
                  disabled={sessionSubmitting}
                >
                  {sessionSubmitting ? "Closing..." : "Close Session & Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. REFUND / CANCELLATION MODAL */}
      {refundTargetTxn && (
        <div style={styles.modalOverlay} onClick={() => setRefundTargetTxn(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>
                {refundActionType === "cancellation" ? "🚫 Cancel Sale Bill" : "↩️ Record Refund"}
              </h3>
              <button type="button" onClick={() => setRefundTargetTxn(null)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <form onSubmit={handleRefundSubmit} style={styles.modalBody}>
              <div style={styles.summaryBox}>
                <div style={styles.sumRow}>
                  <span>Bill #</span>
                  <strong>{refundTargetTxn.billNo || refundTargetTxn.id}</strong>
                </div>
                <div style={styles.sumRow}>
                  <span>Terminal</span>
                  <strong>{refundTargetTxn.terminalName}</strong>
                </div>
                <div style={styles.sumRow}>
                  <span>Payment Method</span>
                  <strong>{refundTargetTxn.paymentMethod}</strong>
                </div>
                <div style={styles.sumRow}>
                  <span>Amount</span>
                  <strong style={{ color: "#dc2626" }}>{formatCurrency(refundTargetTxn.amount)}</strong>
                </div>
              </div>

              <div style={{ ...styles.fieldGroup, marginTop: "12px" }}>
                <label style={styles.label}>Reason / Notes *</label>
                <input
                  type="text"
                  required
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Customer returned item, billing mistake"
                  style={styles.input}
                  autoFocus
                />
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setRefundTargetTxn(null)}
                  style={styles.cancelBtn}
                  disabled={refundSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...styles.primaryBtn, backgroundColor: "#dc2626" }}
                  disabled={refundSubmitting}
                >
                  {refundSubmitting
                    ? "Processing..."
                    : refundActionType === "cancellation"
                    ? "Confirm Cancellation"
                    : "Confirm Refund"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 8. CONFIRMATION DIALOG */}
      {confirmDialog.show && (
        <div
          style={styles.modalOverlay}
          onClick={() => setConfirmDialog((p) => ({ ...p, show: false }))}
        >
          <div style={{ ...styles.modalBox, maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>{confirmDialog.title}</h3>
              <button
                type="button"
                onClick={() => setConfirmDialog((p) => ({ ...p, show: false }))}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ margin: 0, fontSize: "13.5px", color: "#475569", lineHeight: "1.5" }}>
                {confirmDialog.message}
              </p>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setConfirmDialog((p) => ({ ...p, show: false }))}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDialog.onConfirm}
                  style={{
                    ...styles.primaryBtn,
                    backgroundColor: confirmDialog.danger ? "#dc2626" : "#2563eb",
                  }}
                >
                  {confirmDialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. SESSION CLOSING REPORT MODAL */}
      {reportModalSession && (
        <SessionClosingReportModal
          session={reportModalSession}
          storeName={storeName}
          onClose={() => setReportModalSession(null)}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "24px",
    maxWidth: "1380px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },
  toast: {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: 10090,
    color: "#ffffff",
    padding: "12px 18px",
    borderRadius: "12px",
    borderLeft: "4px solid",
    boxShadow: "0 14px 32px rgba(0,0,0,0.22)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "13.5px",
    fontWeight: "700",
    maxWidth: "440px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
  },
  backBtn: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
  title: {
    margin: 0,
    fontSize: "24px",
    fontWeight: "800",
    color: "#0f172a",
  },
  shopBadge: {
    backgroundColor: "#fff7ed",
    color: "#c2410c",
    border: "1px solid #fed7aa",
    fontSize: "11.5px",
    fontWeight: "800",
    padding: "3px 10px",
    borderRadius: "10px",
  },
  subtitle: {
    margin: "4px 0 0 0",
    fontSize: "13px",
    color: "#64748b",
  },
  headerActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  primaryBtn: {
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "13px",
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))",
    gap: "12px",
  },
  kpiCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "14px 16px",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.03)",
  },
  kpiTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiLabel: { fontSize: "12px", fontWeight: "700", color: "#64748b" },
  kpiIcon: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
  },
  kpiValue: { fontSize: "24px", fontWeight: "900", color: "#0f172a", marginTop: "6px" },
  kpiSub: { fontSize: "11.5px", color: "#64748b", marginTop: "2px" },
  skeletonCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  skeletonLineShort: { height: "12px", width: "55%", backgroundColor: "#e2e8f0", borderRadius: "6px" },
  skeletonLineTall: { height: "26px", width: "40%", backgroundColor: "#e2e8f0", borderRadius: "6px" },
  skeletonLineMed: { height: "11px", width: "70%", backgroundColor: "#f1f5f9", borderRadius: "6px" },
  subTabRow: {
    display: "flex",
    gap: "8px",
    backgroundColor: "#e2e8f0",
    padding: "5px",
    borderRadius: "12px",
    width: "fit-content",
    flexWrap: "wrap",
  },
  subTabBtn: {
    padding: "9px 16px",
    borderRadius: "9px",
    border: "none",
    backgroundColor: "transparent",
    color: "#475569",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
  subTabBtnActive: {
    backgroundColor: "#ffffff",
    color: "#0f172a",
    boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
  },
  invModeCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "14px 18px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "14px",
    flexWrap: "wrap",
  },
  invModeToggle: {
    display: "flex",
    backgroundColor: "#f1f5f9",
    padding: "4px",
    borderRadius: "10px",
    gap: "4px",
  },
  invToggleBtn: {
    padding: "7px 14px",
    borderRadius: "8px",
    border: "none",
    fontWeight: "700",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  filterBar: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    minWidth: "220px",
    padding: "10px 14px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    backgroundColor: "#ffffff",
    fontSize: "13.5px",
    outline: "none",
  },
  filterSelect: {
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    backgroundColor: "#ffffff",
    fontSize: "13px",
    fontWeight: "600",
    color: "#334155",
  },
  todayQuickStrip: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "10px 14px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  todayChip: {
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "4px 10px",
    fontSize: "12px",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  floorCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(15, 23, 42, 0.04)",
  },
  floorHeader: {
    padding: "16px 20px",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  floorOrderBadge: {
    width: "34px",
    height: "34px",
    borderRadius: "10px",
    backgroundColor: "#0f172a",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "800",
    fontSize: "13px",
    flexShrink: 0,
  },
  floorName: { margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" },
  floorDesc: { fontSize: "12px", color: "#64748b", marginTop: "3px" },
  floorActions: { display: "flex", gap: "6px", flexWrap: "wrap" },
  pill: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "8px",
  },
  smallPrimaryBtn: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  smallGhostBtn: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  smallDangerBtn: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1px solid #fecaca",
    backgroundColor: "#fee2e2",
    color: "#dc2626",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  terminalListBody: { padding: "16px 20px" },
  emptyFloorTerms: {
    padding: "20px",
    border: "1.5px dashed #cbd5e1",
    borderRadius: "12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#64748b",
    fontSize: "13px",
    flexWrap: "wrap",
    gap: "10px",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#2563eb",
    fontWeight: "800",
    fontSize: "13px",
    cursor: "pointer",
  },
  terminalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
    gap: "14px",
  },
  termCard: {
    border: "1.5px solid #e2e8f0",
    borderRadius: "14px",
    padding: "14px",
    backgroundColor: "#ffffff",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  termCardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },
  termCodeBadge: {
    backgroundColor: "#e0e7ff",
    color: "#3730a3",
    fontWeight: "800",
    fontSize: "11px",
    padding: "2px 7px",
    borderRadius: "6px",
  },
  termName: { margin: "6px 0 2px 0", fontSize: "15px", fontWeight: "800", color: "#0f172a" },
  termIdText: { fontSize: "11px", color: "#94a3b8" },
  termMetaBlock: {
    backgroundColor: "#f8fafc",
    borderRadius: "10px",
    padding: "9px 11px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    fontSize: "12px",
    color: "#475569",
  },
  termMetaRow: { display: "flex", justifyContent: "space-between", gap: "8px" },
  termCardActions: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    marginTop: "2px",
  },
  actionBtn: {
    padding: "6px 9px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontSize: "11.5px",
    fontWeight: "700",
    cursor: "pointer",
  },
  emptyBox: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "48px 24px",
    textAlign: "center",
    color: "#64748b",
  },
  emptyInline: {
    padding: "24px",
    textAlign: "center",
    color: "#64748b",
    fontSize: "13px",
  },
  sectionCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "18px",
    boxShadow: "0 2px 6px rgba(15,23,42,0.03)",
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
    flexWrap: "wrap",
    gap: "10px",
  },
  sectionTitle: { margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" },
  sectionSub: { margin: "2px 0 0 0", fontSize: "12px", color: "#64748b" },
  sectionHeading: {
    fontSize: "12px",
    fontWeight: "800",
    color: "#475569",
    textTransform: "uppercase",
    marginBottom: "8px",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    backgroundColor: "#f8fafc",
    borderBottom: "1.5px solid #e2e8f0",
    color: "#475569",
    fontSize: "11.5px",
    fontWeight: "800",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
    color: "#1e293b",
    verticalAlign: "middle",
  },
  timeframeGroup: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  tfBtn: {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  paymentBreakdownGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "12px",
  },
  payCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "14px 16px",
  },
  payLabel: { fontSize: "12px", fontWeight: "700", color: "#64748b" },
  payVal: { fontSize: "20px", fontWeight: "900", marginTop: "4px" },
  paySub: { fontSize: "11.5px", color: "#64748b", marginTop: "2px" },
  reportsTwoCol: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: "16px",
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
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  fieldGroup: { display: "flex", flexDirection: "column", gap: "5px" },
  label: { fontSize: "12px", fontWeight: "700", color: "#334155" },
  input: {
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13.5px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  staffCheckGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    maxHeight: "180px",
    overflowY: "auto",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "8px",
    backgroundColor: "#f8fafc",
  },
  staffCheckItem: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    padding: "6px 8px",
    borderRadius: "8px",
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    cursor: "pointer",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "12px",
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
  detailsInfoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
  },
  detailsBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    fontSize: "13px",
  },
  detailsLabel: { fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" },
  summaryBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontSize: "13px",
  },
  sumRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
};
