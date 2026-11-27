import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "../utils/firebase";
import {
  adjustCustomerLoyaltyPoints,
  buildMergedCustomerDirectory,
  buildWhatsAppReminderMessage,
  fetchCustomerLedger,
  getOrderCustomerIdentity,
  isValidPhone10,
  normalizePhone10,
  openWhatsAppChat,
  recordCreditPayment,
  updateShopCustomerMeta,
  upsertShopCustomer,
} from "../utils/customerCrmService";

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "due", label: "Credit Due" },
  { id: "vip", label: "VIP" },
  { id: "website", label: "Online" },
  { id: "inactive", label: "Inactive" },
];

const AVAILABLE_TAGS = ["VIP", "Regular", "Wholesale", "Credit"];

const AVATAR_THEMES = [
  { bg: "#e0e7ff", text: "#1e40af" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#e0f2fe", text: "#0369a1" },
];

const toMillis = (val) => {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (typeof val?.toDate === "function") return val.toDate().getTime();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  const parsed = new Date(val).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatDateShort = (val) => {
  const ms = toMillis(val);
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatPhoneDisplay = (raw) => {
  const digits = normalizePhone10(raw);
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return raw || "—";
};

const formatIndianCompact = (num) => {
  const n = Number(num || 0);
  if (n >= 10000000) {
    return `₹${Number((n / 10000000).toFixed(2))}Cr`;
  }
  if (n >= 100000) {
    return `₹${Number((n / 100000).toFixed(2))}L`;
  }
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const getAvatarTheme = (name = "") => {
  const code = (name.trim().charCodeAt(0) || 65) % AVATAR_THEMES.length;
  return AVATAR_THEMES[code];
};

const getPrimaryBadge = (c) => {
  const due = Number(c.creditBalance || 0);
  const tags = Array.isArray(c.tags) ? c.tags : [];
  if (tags.includes("VIP")) {
    return { label: "VIP", bg: "#dcfce7", color: "#15803d" };
  }
  if (due > 0) {
    return { label: "Credit Due", bg: "#ffedd5", color: "#c2410c" };
  }
  if (c.source === "website" || c.source === "both") {
    return { label: "Online", bg: "#dbeafe", color: "#1d4ed8" };
  }
  if (tags.includes("Wholesale")) {
    return { label: "Wholesale", bg: "#ede9fe", color: "#6d28d9" };
  }
  return { label: "Regular", bg: "#f1f5f9", color: "#475569" };
};

export default function CustomerManagement({
  userProfile = {},
  storeSettings = {},
  ordersList = [],
  onlineOrdersList = [],
  onBack,
}) {
  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
  const shopName = userProfile?.storeName || userProfile?.shopName || "My Store";
  const staffName = localStorage.getItem("staff_name") || userProfile?.name || "Owner";

  const [customers, setCustomers] = useState([]);
  const [mountNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detailTab, setDetailTab] = useState("pos"); // "pos" | "online" | "ledger"
  const [ledgerItems, setLedgerItems] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Add Customer Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [addName, setAddName] = useState("");
  const [addGstin, setAddGstin] = useState("");
  const [addCreditLimit, setAddCreditLimit] = useState("5000");
  const [addNotes, setAddNotes] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);

  // Record Khata Payment Modal
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState("CASH");
  const [payNote, setPayNote] = useState("");
  const [savingPay, setSavingPay] = useState(false);

  // Adjust Points Modal
  const [showPtsModal, setShowPtsModal] = useState(false);
  const [ptsDelta, setPtsDelta] = useState("");
  const [ptsReason, setPtsReason] = useState("");
  const [savingPts, setSavingPts] = useState(false);

  // Edit Customer Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editGstin, setEditGstin] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState([]);

  useEffect(() => {
    if (!currentUid) return undefined;
    const unsub = onSnapshot(
      collection(db, "users", currentUid, "customers"),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort(
          (a, b) => toMillis(b.lastOrderAt || b.updatedAt) - toMillis(a.lastOrderAt || a.updatedAt)
        );
        setCustomers(list);
        setLoading(false);
      },
      (err) => {
        console.warn("CustomerManagement listener error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUid]);

  const mergedCustomers = useMemo(
    () =>
      buildMergedCustomerDirectory({
        persistedCustomers: customers,
        ordersList,
        onlineOrdersList,
      }),
    [customers, ordersList, onlineOrdersList]
  );

  const selectedCustomer = useMemo(
    () => mergedCustomers.find((c) => c.id === selectedId) || null,
    [mergedCustomers, selectedId]
  );

  useEffect(() => {
    if (!currentUid || !isValidPhone10(selectedCustomer?.phone)) {
      return undefined;
    }
    let active = true;
    fetchCustomerLedger(currentUid, selectedCustomer.phone, 50)
      .then((items) => {
        if (active) setLedgerItems(items);
      })
      .catch((err) => console.warn("Ledger load error:", err))
      .finally(() => {
        if (active) setLedgerLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    currentUid,
    selectedCustomer?.phone,
    selectedCustomer?.creditBalance,
    selectedCustomer?.loyaltyPoints,
  ]);

  const kpis = useMemo(() => {
    const totalCount = mergedCustomers.length;
    const nowDate = new Date(mountNow);
    const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
    const addedThisMonth = mergedCustomers.filter((c) => {
      const createdMs = toMillis(c.createdAt);
      return createdMs >= monthStart;
    }).length;
    const totalRevenue = mergedCustomers.reduce((s, c) => s + Number(c.totalSpent || 0), 0);
    const totalDue = mergedCustomers.reduce((s, c) => s + Number(c.creditBalance || 0), 0);
    const totalPoints = mergedCustomers.reduce((s, c) => s + Number(c.loyaltyPoints || 0), 0);
    return { totalCount, addedThisMonth, totalRevenue, totalDue, totalPoints };
  }, [mergedCustomers, mountNow]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const thirtyDaysAgo = mountNow - 30 * 24 * 60 * 60 * 1000;
    return mergedCustomers.filter((c) => {
      if (activeFilter === "due" && Number(c.creditBalance || 0) <= 0) return false;
      if (activeFilter === "vip" && !(Array.isArray(c.tags) && c.tags.includes("VIP"))) return false;
      if (activeFilter === "website" && c.source !== "website" && c.source !== "both") return false;
      if (activeFilter === "inactive") {
        const lastMs = toMillis(c.lastOrderAt || c.createdAt);
        if (!lastMs || lastMs >= thirtyDaysAgo) return false;
      }
      if (!q) return true;
      return (
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.phone || c.id || "").toLowerCase().includes(q) ||
        String(c.gstin || "").toLowerCase().includes(q)
      );
    });
  }, [mergedCustomers, search, activeFilter, mountNow]);

  const customerPosBills = useMemo(() => {
    if (!selectedCustomer) return [];
    const targetPhone = normalizePhone10(selectedCustomer.phone || selectedCustomer.id);
    const hasPhone = isValidPhone10(targetPhone);
    return (ordersList || [])
      .filter((s) => {
        if (hasPhone) {
          return normalizePhone10(s.customerPhone || s.customerId) === targetPhone;
        }
        return getOrderCustomerIdentity(s).key === selectedCustomer.id;
      })
      .sort((a, b) => toMillis(b.createdAtMs || b.createdAt) - toMillis(a.createdAtMs || a.createdAt));
  }, [ordersList, selectedCustomer]);

  const customerOnlineOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    const targetPhone = normalizePhone10(selectedCustomer.phone || selectedCustomer.id);
    const hasPhone = isValidPhone10(targetPhone);
    const targetUid = String(selectedCustomer.customerUid || "");
    return (onlineOrdersList || [])
      .filter((o) => {
        const oPhone = normalizePhone10(o.customerPhone || o.address?.phoneNumber);
        const oUid = String(o.customerUid || o.customerId || "");
        if (hasPhone && oPhone === targetPhone) return true;
        if (targetUid && oUid === targetUid) return true;
        if (!hasPhone && getOrderCustomerIdentity(o).key === selectedCustomer.id) return true;
        return false;
      })
      .sort((a, b) => toMillis(b.createdAtMs || b.createdAt) - toMillis(a.createdAtMs || a.createdAt));
  }, [onlineOrdersList, selectedCustomer]);

  const handleAddCustomer = async (e) => {
    e.preventDefault();
    if (!isValidPhone10(addPhone)) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }
    try {
      setSavingAdd(true);
      const saved = await upsertShopCustomer(currentUid, {
        phone: addPhone,
        name: addName.trim() || "Customer",
        gstin: addGstin.trim(),
        creditLimit: Number(addCreditLimit || 5000),
        notes: addNotes.trim(),
        source: "pos",
      });
      setShowAddModal(false);
      setAddPhone("");
      setAddName("");
      setAddGstin("");
      setAddCreditLimit("5000");
      setAddNotes("");
      setLedgerLoading(true);
      setSelectedId(saved.id);
    } catch (err) {
      alert(err?.message || "Failed to add customer.");
    } finally {
      setSavingAdd(false);
    }
  };

  const handleSettlePayment = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      setSavingPay(true);
      await recordCreditPayment({
        shopId: currentUid,
        phone: selectedCustomer.phone,
        amount: Number(payAmount),
        paymentMode: payMode,
        note: payNote,
        staffName,
      });
      setShowPayModal(false);
      setPayAmount("");
      setPayNote("");
    } catch (err) {
      alert(err?.message || "Failed to record payment.");
    } finally {
      setSavingPay(false);
    }
  };

  const handleAdjustPoints = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      setSavingPts(true);
      await adjustCustomerLoyaltyPoints({
        shopId: currentUid,
        phone: selectedCustomer.phone,
        deltaPoints: Number(ptsDelta),
        reason: ptsReason,
        staffName,
      });
      setShowPtsModal(false);
      setPtsDelta("");
      setPtsReason("");
    } catch (err) {
      alert(err?.message || "Failed to update points.");
    } finally {
      setSavingPts(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      await updateShopCustomerMeta(currentUid, selectedCustomer.phone, {
        name: editName,
        creditLimit: Number(editLimit || 0),
        gstin: editGstin,
        notes: editNotes,
        tags: editTags,
      });
      setShowEditModal(false);
    } catch (err) {
      alert(err?.message || "Failed to update profile.");
    }
  };

  return (
    <div style={styles.outerWrap}>
      <div style={styles.container}>
        {/* Top Bar */}
        <div style={styles.topRow}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {onBack && (
              <button type="button" onClick={onBack} style={styles.backBtn}>
                ← Back
              </button>
            )}
            <span style={styles.topSectionTitle}>Customer Management</span>
          </div>
          <span style={styles.liveChip}>● Live CRM</span>
        </div>

        {/* Hero Header */}
        <div style={styles.heroHeader}>
          <div>
            <h1 style={styles.heroTitle}>Customers</h1>
            <p style={styles.heroSubtitle}>Manage your customers, payments and rewards</p>
          </div>
          <button type="button" onClick={() => setShowAddModal(true)} style={styles.addBtn}>
            + Add Customer
          </button>
        </div>

        {/* 2x2 KPI Cards Grid */}
        <div style={styles.kpiGrid}>
          <div style={styles.kpiCard}>
            <div style={styles.kpiHeaderRow}>
              <span style={{ ...styles.kpiIcon, color: "#4f46e5" }}>👥</span>
              <span style={styles.kpiLabel}>Total Customers</span>
            </div>
            <div style={{ ...styles.kpiNumber, color: "#0f172a" }}>
              {kpis.totalCount.toLocaleString("en-IN")}
            </div>
            <div style={{ ...styles.kpiCaption, color: "#15803d" }}>
              ↑ {kpis.addedThisMonth} this month
            </div>
          </div>

          <div style={styles.kpiCard}>
            <div style={styles.kpiHeaderRow}>
              <span style={{ ...styles.kpiIcon, color: "#15803d" }}>💳</span>
              <span style={styles.kpiLabel}>Total Sales</span>
            </div>
            <div style={{ ...styles.kpiNumber, color: "#15803d" }}>
              {formatIndianCompact(kpis.totalRevenue)}
            </div>
            <div style={styles.kpiCaption}>Customer purchases</div>
          </div>

          <div style={styles.kpiCard}>
            <div style={styles.kpiHeaderRow}>
              <span style={{ ...styles.kpiIcon, color: "#b91c1c" }}>ⓘ</span>
              <span style={styles.kpiLabel}>Pending Dues</span>
            </div>
            <div style={{ ...styles.kpiNumber, color: "#991b1b" }}>
              ₹{kpis.totalDue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            <div style={styles.kpiCaption}>Customer credit</div>
          </div>

          <div style={styles.kpiCard}>
            <div style={styles.kpiHeaderRow}>
              <span style={{ ...styles.kpiIcon, color: "#7c3aed" }}>🎁</span>
              <span style={styles.kpiLabel}>Reward Points</span>
            </div>
            <div style={{ ...styles.kpiNumber, color: "#7c3aed" }}>
              {kpis.totalPoints.toLocaleString("en-IN")}
            </div>
            <div style={styles.kpiCaption}>Points earned</div>
          </div>
        </div>

        <div style={styles.sectionDivider} />

        {/* Customer Directory */}
        <div style={styles.directoryHeader}>
          <h2 style={styles.directoryTitle}>Customer Directory</h2>
        </div>

        <div style={styles.searchWrap}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or mobile number..."
            style={styles.searchInput}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              style={styles.searchClearBtn}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div style={styles.filterRow}>
          {FILTER_TABS.map((tab) => {
            const active = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id)}
                style={{
                  ...styles.filterChip,
                  backgroundColor: active ? "#111827" : "#f1f5f9",
                  color: active ? "#ffffff" : "#374151",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Directory Cards List */}
        {loading ? (
          <div style={styles.emptyCard}>Loading customers...</div>
        ) : filteredCustomers.length === 0 ? (
          <div style={styles.emptyCard}>
            <div style={{ fontSize: "34px", marginBottom: "8px" }}>👥</div>
            <div style={{ fontWeight: "700", fontSize: "15px", color: "#0f172a" }}>
              No customers found
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#64748b" }}>
              Attach a mobile number during checkout or click <b>+ Add Customer</b> to create one.
            </p>
          </div>
        ) : (
          <div style={styles.cardsStack}>
            {filteredCustomers.map((c) => {
              const av = getAvatarTheme(c.name || "C");
              const badge = getPrimaryBadge(c);
              const openProfile = () => {
                setLedgerLoading(isValidPhone10(c.phone));
                setSelectedId(c.id);
                setDetailTab("pos");
              };

              return (
                <div
                  key={c.id}
                  onClick={openProfile}
                  style={styles.customerCard}
                >
                  {/* Top Row: Avatar + Name/Phone + Tag Pill */}
                  <div style={styles.cardTopRow}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                      <div style={{ ...styles.avatarCircle, backgroundColor: av.bg, color: av.text }}>
                        {(c.name || "C").charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={styles.custName}>{c.name || "Customer"}</div>
                        <div style={styles.custPhone}>
                          {isValidPhone10(c.phone)
                            ? formatPhoneDisplay(c.phone)
                            : `${Number(c.totalOrders || 0)} order${Number(c.totalOrders || 0) === 1 ? "" : "s"} • No mobile`}
                        </div>
                      </div>
                    </div>

                    <span
                      style={{
                        ...styles.statusBadge,
                        backgroundColor: badge.bg,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Middle Row: 3 Columns (Purchased / Due Amount / Points) */}
                  <div style={styles.metricsRow}>
                    <div>
                      <div style={styles.metricLabel}>Purchased</div>
                      <div style={styles.metricValue}>
                        ₹{Number(c.totalSpent || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div>
                      <div style={styles.metricLabel}>Due Amount</div>
                      <div
                        style={{
                          ...styles.metricValue,
                          color: Number(c.creditBalance || 0) > 0 ? "#0f172a" : "#0f172a",
                        }}
                      >
                        ₹{Number(c.creditBalance || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div>
                      <div style={styles.metricLabel}>Points</div>
                      <div style={styles.metricValue}>
                        {Number(c.loyaltyPoints || 0).toLocaleString("en-IN")}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Right Link */}
                  <div style={styles.cardFooterRow}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openProfile();
                      }}
                      style={styles.viewProfileLink}
                    >
                      View Profile →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Customer 360° Slide-Over Profile Drawer */}
      {selectedCustomer && (
        <div style={styles.drawerOverlay} onClick={() => setSelectedId(null)}>
          <div style={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                <div
                  style={{
                    ...styles.avatarCircle,
                    backgroundColor: getAvatarTheme(selectedCustomer.name).bg,
                    color: getAvatarTheme(selectedCustomer.name).text,
                  }}
                >
                  {(selectedCustomer.name || "C").charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                    {selectedCustomer.name}
                  </h2>
                  <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>
                    {isValidPhone10(selectedCustomer.phone)
                      ? `+91 ${formatPhoneDisplay(selectedCustomer.phone)}`
                      : "Walk-in / Counter Customer (No mobile attached)"}
                    {selectedCustomer.gstin ? ` • GSTIN: ${selectedCustomer.gstin}` : ""}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} style={styles.closeIconBtn}>
                ✕
              </button>
            </div>

            <div style={styles.drawerBody}>
              {/* Action Buttons */}
              {isValidPhone10(selectedCustomer.phone) ? (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
                  <button
                    type="button"
                    style={styles.waBtn}
                    onClick={() => {
                      const msg =
                        Number(selectedCustomer.creditBalance || 0) > 0
                          ? buildWhatsAppReminderMessage({
                              shopName,
                              customerName: selectedCustomer.name,
                              creditBalance: selectedCustomer.creditBalance,
                              upiId: storeSettings?.upiId || "",
                            })
                          : `Hello ${selectedCustomer.name || "Customer"}! Thank you for shopping at *${shopName}*. You have *${Number(selectedCustomer.loyaltyPoints || 0)} Reward Points* ready to redeem! 🎁`;
                      openWhatsAppChat(selectedCustomer.phone, msg);
                    }}
                  >
                    📲 {Number(selectedCustomer.creditBalance || 0) > 0 ? "WhatsApp Due Reminder" : "WhatsApp"}
                  </button>
                  <button
                    type="button"
                    style={styles.outlineBtn}
                    onClick={() => {
                      setEditName(selectedCustomer.name || "");
                      setEditLimit(String(selectedCustomer.creditLimit ?? 5000));
                      setEditGstin(selectedCustomer.gstin || "");
                      setEditNotes(selectedCustomer.notes || "");
                      setEditTags(Array.isArray(selectedCustomer.tags) ? selectedCustomer.tags : []);
                      setShowEditModal(true);
                    }}
                  >
                    ✏️ Edit Profile
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    fontSize: "12px",
                    color: "#475569",
                    marginBottom: "14px",
                  }}
                >
                  Attach a 10-digit mobile number at checkout or via <b>+ Add Customer</b> to enable WhatsApp, Khata credit &amp; loyalty points.
                </div>
              )}

              {/* Khata & Loyalty Cards */}
              <div style={styles.balanceSplit}>
                <div style={styles.balanceCard}>
                  <span style={styles.balanceLabel}>PENDING DUES (KHATA)</span>
                  <div style={{ fontSize: "22px", fontWeight: "800", color: "#991b1b", margin: "4px 0" }}>
                    ₹{Number(selectedCustomer.creditBalance || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                    Credit Limit: ₹{Number(selectedCustomer.creditLimit ?? 5000).toLocaleString("en-IN")}
                  </div>
                  {isValidPhone10(selectedCustomer.phone) && (
                    <button
                      type="button"
                      style={{ ...styles.smallActionBtn, backgroundColor: "#b91c1c" }}
                      onClick={() => {
                        setPayAmount(
                          Number(selectedCustomer.creditBalance || 0) > 0
                            ? String(selectedCustomer.creditBalance)
                            : ""
                        );
                        setShowPayModal(true);
                      }}
                    >
                      + Record Payment
                    </button>
                  )}
                </div>

                <div style={styles.balanceCard}>
                  <span style={styles.balanceLabel}>REWARD POINTS</span>
                  <div style={{ fontSize: "22px", fontWeight: "800", color: "#7c3aed", margin: "4px 0" }}>
                    {Number(selectedCustomer.loyaltyPoints || 0).toLocaleString("en-IN")} pts
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                    {Number(selectedCustomer.totalOrders || 0)} orders • Last seen {formatDateShort(selectedCustomer.lastOrderAt || selectedCustomer.updatedAt)}
                  </div>
                  {isValidPhone10(selectedCustomer.phone) && (
                    <button
                      type="button"
                      style={{ ...styles.smallActionBtn, backgroundColor: "#4f46e5" }}
                      onClick={() => setShowPtsModal(true)}
                    >
                      Adjust Points
                    </button>
                  )}
                </div>
              </div>

              {/* Tags & Notes */}
              {(selectedCustomer.tags?.length > 0 || selectedCustomer.notes) && (
                <div style={styles.metaBox}>
                  {selectedCustomer.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: selectedCustomer.notes ? "6px" : 0 }}>
                      {selectedCustomer.tags.map((t) => (
                        <span key={t} style={styles.tagPill}>{t}</span>
                      ))}
                    </div>
                  )}
                  {selectedCustomer.notes && (
                    <div style={{ fontSize: "12.5px", color: "#475569" }}>📝 {selectedCustomer.notes}</div>
                  )}
                </div>
              )}

              {/* History Tabs */}
              <div style={styles.tabBar}>
                {[
                  { id: "pos", label: `POS Bills (${customerPosBills.length})` },
                  { id: "online", label: `Online (${customerOnlineOrders.length})` },
                  { id: "ledger", label: `Ledger (${isValidPhone10(selectedCustomer.phone) ? ledgerItems.length : 0})` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDetailTab(tab.id)}
                    style={{
                      ...styles.tabBtn,
                      backgroundColor: detailTab === tab.id ? "#111827" : "transparent",
                      color: detailTab === tab.id ? "#ffffff" : "#475569",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {detailTab === "pos" &&
                  (customerPosBills.length === 0 ? (
                    <div style={styles.emptySmall}>No in-store POS bills linked yet.</div>
                  ) : (
                    customerPosBills.map((b) => (
                      <div key={b.id} style={styles.historyRow}>
                        <div>
                          <strong style={{ fontSize: "13.5px", color: "#0f172a" }}>
                            {b.billNo || b.invoiceId || b.id}
                          </strong>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {b.billDate || formatDateShort(b.createdAt)} • {b.paymentMode || "CASH"}
                            {b.loyaltyEarnedPoints ? ` • +${b.loyaltyEarnedPoints} pts` : ""}
                          </div>
                        </div>
                        <strong style={{ fontSize: "14px", color: "#0f172a" }}>
                          ₹{Number(b.total || 0).toFixed(2)}
                        </strong>
                      </div>
                    ))
                  ))}

                {detailTab === "online" &&
                  (customerOnlineOrders.length === 0 ? (
                    <div style={styles.emptySmall}>No website orders from this customer yet.</div>
                  ) : (
                    customerOnlineOrders.map((o) => (
                      <div key={o.id} style={styles.historyRow}>
                        <div>
                          <strong style={{ fontSize: "13.5px", color: "#0f172a" }}>
                            {o.orderId || o.id}
                          </strong>
                          <div style={{ fontSize: "12px", color: "#64748b" }}>
                            {formatDateShort(o.createdAt)} • {o.status || "Order Placed"}
                          </div>
                        </div>
                        <strong style={{ fontSize: "14px", color: "#15803d" }}>
                          ₹{Number(o.totalAmount || o.total || 0).toFixed(2)}
                        </strong>
                      </div>
                    ))
                  ))}

                {detailTab === "ledger" &&
                  (!isValidPhone10(selectedCustomer.phone) ? (
                    <div style={styles.emptySmall}>No Khata or Reward entries yet.</div>
                  ) : ledgerLoading ? (
                    <div style={styles.emptySmall}>Loading ledger...</div>
                  ) : ledgerItems.length === 0 ? (
                    <div style={styles.emptySmall}>No Khata or Reward entries yet.</div>
                  ) : (
                    ledgerItems.map((entry) => {
                      const isCredit = entry.type === "credit_sale";
                      const isPay = entry.type === "payment_received";
                      return (
                        <div key={entry.id} style={styles.historyRow}>
                          <div>
                            <strong style={{ fontSize: "13px", color: "#0f172a" }}>
                              {entry.note || entry.type}
                            </strong>
                            <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                              {formatDateShort(entry.createdAt)} • By {entry.staffName || "Owner"}
                            </div>
                          </div>
                          {isCredit ? (
                            <strong style={{ color: "#b91c1c" }}>+₹{Number(entry.amount || 0).toFixed(2)} Due</strong>
                          ) : isPay ? (
                            <strong style={{ color: "#15803d" }}>-₹{Number(entry.amount || 0).toFixed(2)} Paid</strong>
                          ) : (
                            <strong style={{ color: Number(entry.points) >= 0 ? "#7c3aed" : "#d97706" }}>
                              {Number(entry.points) >= 0 ? `+${entry.points}` : entry.points} pts
                            </strong>
                          )}
                        </div>
                      );
                    })
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddModal && (
        <div style={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Add New Customer</h3>
            <form onSubmit={handleAddCustomer} style={styles.formStack}>
              <label style={styles.fieldLabel}>10-Digit Mobile Number *</label>
              <input
                type="tel"
                maxLength={10}
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
                placeholder="9876543210"
                style={styles.input}
                required
              />
              <label style={styles.fieldLabel}>Customer Name *</label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="e.g. Ravi Kumar"
                style={styles.input}
                required
              />
              <label style={styles.fieldLabel}>Khata Credit Limit (₹)</label>
              <input
                type="number"
                value={addCreditLimit}
                onChange={(e) => setAddCreditLimit(e.target.value)}
                style={styles.input}
              />
              <label style={styles.fieldLabel}>GSTIN (Optional)</label>
              <input
                type="text"
                value={addGstin}
                onChange={(e) => setAddGstin(e.target.value)}
                placeholder="33AAAAA0000A1Z5"
                style={styles.input}
              />
              <label style={styles.fieldLabel}>Notes</label>
              <input
                type="text"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="Customer preference or address note"
                style={styles.input}
              />
              <div style={styles.modalBtns}>
                <button type="button" onClick={() => setShowAddModal(false)} style={styles.outlineBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={savingAdd} style={styles.addBtn}>
                  {savingAdd ? "Saving..." : "Save Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Khata Payment Modal */}
      {showPayModal && selectedCustomer && (
        <div style={styles.modalOverlay} onClick={() => setShowPayModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Record Khata Payment</h3>
            <form onSubmit={handleSettlePayment} style={styles.formStack}>
              <label style={styles.fieldLabel}>Amount Received (₹)</label>
              <input
                type="number"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                style={styles.input}
                required
              />
              <label style={styles.fieldLabel}>Payment Mode</label>
              <div style={{ display: "flex", gap: "8px" }}>
                {["CASH", "UPI"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayMode(m)}
                    style={{
                      ...styles.filterChip,
                      flex: 1,
                      backgroundColor: payMode === m ? "#15803d" : "#f1f5f9",
                      color: payMode === m ? "#ffffff" : "#334155",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <label style={styles.fieldLabel}>Note (Optional)</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="e.g. GPay settlement"
                style={styles.input}
              />
              <div style={styles.modalBtns}>
                <button type="button" onClick={() => setShowPayModal(false)} style={styles.outlineBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={savingPay} style={{ ...styles.addBtn, backgroundColor: "#15803d" }}>
                  {savingPay ? "Saving..." : "Confirm Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Points Modal */}
      {showPtsModal && selectedCustomer && (
        <div style={styles.modalOverlay} onClick={() => setShowPtsModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Adjust Reward Points</h3>
            <form onSubmit={handleAdjustPoints} style={styles.formStack}>
              <label style={styles.fieldLabel}>Points (+ to add, - to deduct)</label>
              <input
                type="number"
                value={ptsDelta}
                onChange={(e) => setPtsDelta(e.target.value)}
                placeholder="e.g. 50 or -20"
                style={styles.input}
                required
              />
              <label style={styles.fieldLabel}>Reason</label>
              <input
                type="text"
                value={ptsReason}
                onChange={(e) => setPtsReason(e.target.value)}
                placeholder="e.g. Goodwill bonus"
                style={styles.input}
              />
              <div style={styles.modalBtns}>
                <button type="button" onClick={() => setShowPtsModal(false)} style={styles.outlineBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={savingPts} style={styles.addBtn}>
                  {savingPts ? "Saving..." : "Update Points"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditModal && selectedCustomer && (
        <div style={styles.modalOverlay} onClick={() => setShowEditModal(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Edit Customer Profile</h3>
            <form onSubmit={handleSaveEdit} style={styles.formStack}>
              <label style={styles.fieldLabel}>Name</label>
              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} style={styles.input} required />
              <label style={styles.fieldLabel}>Tags</label>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {AVAILABLE_TAGS.map((tag) => {
                  const active = editTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() =>
                        setEditTags((prev) =>
                          prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
                        )
                      }
                      style={{
                        ...styles.filterChip,
                        backgroundColor: active ? "#111827" : "#f1f5f9",
                        color: active ? "#ffffff" : "#334155",
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <label style={styles.fieldLabel}>Credit Limit (₹)</label>
              <input type="number" value={editLimit} onChange={(e) => setEditLimit(e.target.value)} style={styles.input} />
              <label style={styles.fieldLabel}>GSTIN</label>
              <input type="text" value={editGstin} onChange={(e) => setEditGstin(e.target.value)} style={styles.input} />
              <label style={styles.fieldLabel}>Notes</label>
              <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} style={styles.input} />
              <div style={styles.modalBtns}>
                <button type="button" onClick={() => setShowEditModal(false)} style={styles.outlineBtn}>
                  Cancel
                </button>
                <button type="submit" style={styles.addBtn}>
                  Save Changes
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
  outerWrap: {
    backgroundColor: "#ffffff",
    minHeight: "calc(100vh - 64px)",
    padding: "20px 24px 48px",
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  container: {
    maxWidth: "1060px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "18px",
  },
  backBtn: {
    padding: "5px 12px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#f8fafc",
    color: "#334155",
    fontWeight: "600",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  topSectionTitle: {
    fontSize: "17px",
    fontWeight: "700",
    color: "#111827",
  },
  liveChip: {
    backgroundColor: "#dcfce7",
    color: "#15803d",
    fontSize: "12px",
    fontWeight: "700",
    padding: "4px 12px",
    borderRadius: "999px",
  },
  heroHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "18px",
  },
  heroTitle: {
    margin: 0,
    fontSize: "26px",
    fontWeight: "800",
    color: "#111827",
    letterSpacing: "-0.3px",
  },
  heroSubtitle: {
    margin: "4px 0 0",
    fontSize: "13.5px",
    color: "#6b7280",
  },
  addBtn: {
    padding: "10px 20px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#4f46e5",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(79, 70, 229, 0.25)",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "14px",
  },
  kpiCard: {
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: "14px",
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  kpiHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  kpiIcon: {
    fontSize: "16px",
    lineHeight: 1,
  },
  kpiLabel: {
    fontSize: "13.5px",
    fontWeight: "500",
    color: "#4b5563",
  },
  kpiNumber: {
    fontSize: "30px",
    fontWeight: "800",
    lineHeight: 1.15,
    marginTop: "4px",
  },
  kpiCaption: {
    fontSize: "12.5px",
    color: "#6b7280",
    fontWeight: "500",
  },
  sectionDivider: {
    height: "1px",
    backgroundColor: "#e5e7eb",
    margin: "24px 0 18px",
  },
  directoryHeader: {
    marginBottom: "12px",
  },
  directoryTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: "700",
    color: "#111827",
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    border: "1px solid #d1d5db",
    borderRadius: "12px",
    padding: "0 14px",
    height: "46px",
    backgroundColor: "#ffffff",
    marginBottom: "14px",
  },
  searchIcon: {
    fontSize: "15px",
    color: "#9ca3af",
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    fontSize: "14px",
    color: "#111827",
    backgroundColor: "transparent",
  },
  searchClearBtn: {
    border: "none",
    background: "transparent",
    color: "#9ca3af",
    cursor: "pointer",
    fontSize: "14px",
  },
  filterRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "18px",
  },
  filterChip: {
    padding: "8px 16px",
    borderRadius: "999px",
    border: "none",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  cardsStack: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  customerCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "14px",
    padding: "18px 20px",
    cursor: "pointer",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "16px",
  },
  avatarCircle: {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    fontWeight: "700",
    fontSize: "17px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  custName: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#111827",
  },
  custPhone: {
    fontSize: "13px",
    color: "#6b7280",
    marginTop: "2px",
  },
  statusBadge: {
    fontSize: "12px",
    fontWeight: "700",
    padding: "5px 12px",
    borderRadius: "999px",
    flexShrink: 0,
  },
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "10px",
  },
  metricLabel: {
    fontSize: "12.5px",
    color: "#6b7280",
    marginBottom: "4px",
  },
  metricValue: {
    fontSize: "16px",
    fontWeight: "700",
    color: "#111827",
  },
  cardFooterRow: {
    display: "flex",
    justifyContent: "flex-end",
  },
  viewProfileLink: {
    border: "none",
    background: "transparent",
    color: "#4b5563",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    padding: "2px 0",
  },
  emptyCard: {
    border: "1px dashed #d1d5db",
    borderRadius: "14px",
    padding: "48px 20px",
    textAlign: "center",
    color: "#6b7280",
  },
  drawerOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    justifyContent: "flex-end",
    zIndex: 9998,
  },
  drawerPanel: {
    width: "100%",
    maxWidth: "520px",
    height: "100%",
    backgroundColor: "#ffffff",
    display: "flex",
    flexDirection: "column",
    boxShadow: "-8px 0 30px rgba(0, 0, 0, 0.14)",
  },
  drawerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 22px",
    borderBottom: "1px solid #e5e7eb",
  },
  drawerBody: {
    flex: 1,
    overflowY: "auto",
    padding: "18px 22px 32px",
  },
  closeIconBtn: {
    width: "34px",
    height: "34px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    backgroundColor: "#f8fafc",
    color: "#475569",
    fontSize: "15px",
    cursor: "pointer",
  },
  waBtn: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#15803d",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
  outlineBtn: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: "1px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#374151",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
  },
  balanceSplit: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "14px",
  },
  balanceCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "14px",
    backgroundColor: "#f8fafc",
  },
  balanceLabel: {
    fontSize: "10.5px",
    fontWeight: "700",
    color: "#6b7280",
    letterSpacing: "0.5px",
  },
  smallActionBtn: {
    width: "100%",
    padding: "8px",
    borderRadius: "8px",
    border: "none",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  metaBox: {
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "10px 12px",
    marginBottom: "14px",
    backgroundColor: "#ffffff",
  },
  tagPill: {
    fontSize: "11px",
    fontWeight: "700",
    padding: "2px 9px",
    borderRadius: "999px",
    backgroundColor: "#e0e7ff",
    color: "#3730a3",
  },
  tabBar: {
    display: "flex",
    gap: "6px",
    padding: "4px",
    borderRadius: "10px",
    backgroundColor: "#f1f5f9",
    marginBottom: "12px",
  },
  tabBtn: {
    flex: 1,
    padding: "8px",
    borderRadius: "8px",
    border: "none",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  historyRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid #e5e7eb",
  },
  emptySmall: {
    textAlign: "center",
    padding: "24px 12px",
    color: "#9ca3af",
    fontSize: "13px",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "16px",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    padding: "22px",
    width: "100%",
    maxWidth: "440px",
    boxSizing: "border-box",
  },
  modalTitle: {
    margin: "0 0 14px",
    fontSize: "18px",
    fontWeight: "800",
    color: "#111827",
  },
  formStack: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  fieldLabel: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#374151",
    marginTop: "4px",
  },
  input: {
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    fontSize: "13.5px",
    outline: "none",
  },
  modalBtns: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    marginTop: "14px",
  },
};
