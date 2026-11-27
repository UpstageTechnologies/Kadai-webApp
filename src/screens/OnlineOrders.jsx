import { useState, useMemo } from "react";
import { auth } from "../utils/firebase";
import {
  ONLINE_ORDER_TABS,
  asArray,
  asText,
  getOnlineOrderProgress,
  getOnlineOrderStatusColors,
  getNextOnlineOrderStatus,
  computeOrderTotal,
  filterOnlineOrders,
  updateOnlineOrderStatus,
  assignDeliveryBoyToOnlineOrder,
  markOnlineOrderPackedAndNotify,
  holdOnlineOrder,
  resumeHeldOnlineOrder,
  rejectOnlineOrder,
  toggleShopDoorDelivery,
  getPickupWhatsAppUrl,
  getDeliveryBoyWhatsAppUrl,
  createSimulatedOnlineOrder,
} from "../utils/onlineOrderService";
import { playNotificationSound, getOrderClassification } from "../utils/restaurantOrderService";

export default function OnlineOrders({
  db,
  uid: propUid,
  onlineOrders = [],
  salesOrders = [],
  deliveryStaffList = [],
  doorDeliveryEnabled = true,
  setDoorDeliveryEnabled,
  shopProfile = {},
  isGlobalMode = false,
  isRestaurant = false,
  onViewBillDetails,
}) {
  const uid = String(
    propUid ||
    auth?.currentUser?.uid ||
    (typeof localStorage !== "undefined" ? localStorage.getItem("uid") : "") ||
    ""
  ).trim();
  // Main view switcher: "online" (Live Online Orders) vs "history" (Sales & Bill History)
  const [mainView, setMainView] = useState("online");

  // Tab filter: "All", "New", "Hold", "Completed", "Rejected"
  const [activeTab, setActiveTab] = useState("New");
  const [searchQuery, setSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState("current"); // "current" | "local" | "global" | "all"

  // Action Loading & Modal States
  const [actionLoading, setActionLoading] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [orderToAssign, setOrderToAssign] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [customBoyName, setCustomBoyName] = useState("");
  const [customBoyPhone, setCustomBoyPhone] = useState("");

  // Hold Modal States
  const [holdModalOpen, setHoldModalOpen] = useState(false);
  const [orderToHold, setOrderToHold] = useState(null);
  const [holdReason, setHoldReason] = useState("");
  const [holdDurationMinutes, setHoldDurationMinutes] = useState(60);

  // Success Feedback Toast
  const [feedbackToast, setFeedbackToast] = useState(null);

  const showToast = (msg, isSuccess = true) => {
    setFeedbackToast({ msg, isSuccess });
    setTimeout(() => setFeedbackToast(null), 4000);
  };

  // Door delivery toggle handler
  const handleToggleDelivery = async () => {
    try {
      setActionLoading(true);
      const nextVal = await toggleShopDoorDelivery({
        db,
        uid,
        currentSetting: doorDeliveryEnabled,
      });
      if (setDoorDeliveryEnabled) setDoorDeliveryEnabled(nextVal);
      showToast(nextVal ? "🛵 Door Delivery is now ON!" : "🏬 Store Pickup Only activated!");
    } catch (e) {
      showToast("Error updating delivery setting: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Status update handler (Accept, Pack, Out for delivery, Delivered/Finished)
  const handleStatusChange = async (order, targetStatus) => {
    try {
      setActionLoading(true);
      const mode = order.isGlobalMode || isGlobalMode ? "global" : "local";
      await updateOnlineOrderStatus({
        db,
        uid,
        order,
        newStatus: targetStatus,
        mode,
        shopProfile,
      });

      if (targetStatus === "Delivered") {
        playNotificationSound("orderDelivered");
        showToast(`🎉 Order #${order.orderId || order.id.slice(-6)} Finished & Delivered!`);
      } else {
        showToast(`Order status updated to "${targetStatus}"`);
      }
    } catch (e) {
      showToast("Failed to update status: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Assign delivery staff handler
  const handleAssignDelivery = async () => {
    if (!orderToAssign) return;
    try {
      setActionLoading(true);
      const mode = orderToAssign.isGlobalMode || isGlobalMode ? "global" : "local";
      const sellerUid =
        uid ||
        auth?.currentUser?.uid ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("uid") : "") ||
        orderToAssign?.shopId ||
        orderToAssign?.sellerUid ||
        orderToAssign?.masterUid ||
        "";

      const { finalStaffName, finalStaffPhone } = await assignDeliveryBoyToOnlineOrder({
        db,
        uid: sellerUid,
        order: orderToAssign,
        selectedStaff,
        customName: customBoyName,
        customPhone: customBoyPhone,
        deliveryStaffList,
        shopProfile,
        mode,
      });

      playNotificationSound("foodReady");
      showToast(`🛵 Order #${orderToAssign.orderId || orderToAssign.id.slice(-6)} assigned to ${finalStaffName}!`);
      setAssignModalOpen(false);
      setOrderToAssign(null);
      setCustomBoyName("");
      setCustomBoyPhone("");

      // Offer WhatsApp dispatch to delivery boy
      if (finalStaffPhone) {
        const waUrl = getDeliveryBoyWhatsAppUrl(orderToAssign, finalStaffPhone, shopProfile);
        if (waUrl && window.confirm(`Open WhatsApp to send delivery details to ${finalStaffName}?`)) {
          window.open(waUrl, "_blank");
        }
      }
    } catch (e) {
      showToast(e.message || "Failed to assign delivery boy", false);
    } finally {
      setActionLoading(false);
    }
  };

  // Mark packed and notify customer handler
  const handleMarkPacked = async (order) => {
    try {
      setActionLoading(true);
      const mode = order.isGlobalMode || isGlobalMode ? "global" : "local";
      await markOnlineOrderPackedAndNotify({
        db,
        uid,
        order,
        shopProfile,
        mode,
      });
      showToast(`📦 Order marked Packed & in-app pickup alert sent to customer!`);
    } catch (e) {
      showToast("Error packing order: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Hold order handler
  const handleConfirmHold = async () => {
    if (!orderToHold) return;
    try {
      setActionLoading(true);
      const mode = orderToHold.isGlobalMode || isGlobalMode ? "global" : "local";
      const pendingUntil = new Date(Date.now() + holdDurationMinutes * 60 * 1000).toISOString();
      await holdOnlineOrder({
        db,
        uid,
        order: orderToHold,
        reason: holdReason,
        pendingUntilIso: pendingUntil,
        mode,
      });
      showToast(`⏸ Order placed on hold.`);
      setHoldModalOpen(false);
      setOrderToHold(null);
      setHoldReason("");
    } catch (e) {
      showToast("Failed to hold order: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Resume held order handler
  const handleResumeOrder = async (order) => {
    try {
      setActionLoading(true);
      const mode = order.isGlobalMode || isGlobalMode ? "global" : "local";
      const { restoredStatus } = await resumeHeldOnlineOrder({
        db,
        uid,
        order,
        mode,
      });
      showToast(`▶ Order resumed to "${restoredStatus}"`);
    } catch (e) {
      showToast("Failed to resume order: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Reject order handler
  const handleRejectOrder = async (order) => {
    if (!window.confirm(`Are you sure you want to reject Order #${order.orderId || order.id.slice(-6)}?`)) return;
    try {
      setActionLoading(true);
      const mode = order.isGlobalMode || isGlobalMode ? "global" : "local";
      await rejectOnlineOrder({ db, uid, order, mode });
      showToast(`Order #${order.orderId || order.id.slice(-6)} was rejected.`);
    } catch (e) {
      showToast("Failed to reject order: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Simulate new incoming test order
  const handleCreateTestOrder = async () => {
    try {
      setActionLoading(true);
      const testOrd = await createSimulatedOnlineOrder({
        db,
        uid,
        isGlobalMode,
      });
      playNotificationSound("onlineOrder");
      showToast(`✨ Test Online Order #${testOrd.orderId} created successfully!`);
      setActiveTab("New");
    } catch (e) {
      showToast("Failed to create test order: " + e.message, false);
    } finally {
      setActionLoading(false);
    }
  };

  // Filtered Online Orders
  const filteredOrders = useMemo(() => {
    return filterOnlineOrders(onlineOrders, activeTab, searchQuery, modeFilter, isGlobalMode, uid);
  }, [onlineOrders, activeTab, searchQuery, modeFilter, isGlobalMode, uid]);

  // Tab Counts for badges
  const tabCounts = useMemo(() => {
    const counts = { All: 0, New: 0, Hold: 0, Completed: 0, Rejected: 0 };
    onlineOrders.forEach((o) => {
      const custName = asText(o.customerName).toLowerCase().trim();
      const orderType = asText(o.orderType || o.type).toLowerCase().trim();
      if (
        custName.includes("walk-in") ||
        custName === "walk in customer" ||
        orderType.includes("walk-in") ||
        o.isWalkIn === true
      ) {
        return;
      }
      counts.All++;
      const s = asText(o.status || "Pending Verification").toLowerCase();
      if (["pending verification", "accepted", "packed", "out for delivery"].includes(s)) counts.New++;
      else if (s === "pending") counts.Hold++;
      else if (s === "delivered") counts.Completed++;
      else if (s === "rejected") counts.Rejected++;
    });
    return counts;
  }, [onlineOrders]);

  // Sales History filter
  const displayedSalesOrders = useMemo(() => {
    return salesOrders.filter((o) => {
      if (modeFilter === "all") return true;
      const isOrdGlobal = Boolean(o.isGlobalMode || o.appMode === "global");
      if (modeFilter === "local") return !isOrdGlobal;
      if (modeFilter === "global") return isOrdGlobal;
      return isGlobalMode ? isOrdGlobal : !isOrdGlobal;
    });
  }, [salesOrders, modeFilter, isGlobalMode]);

  return (
    <div style={styles.container}>
      {/* Toast Feedback */}
      {feedbackToast && (
        <div style={{
          ...styles.feedbackToast,
          backgroundColor: feedbackToast.isSuccess ? "#059669" : "#dc2626"
        }}>
          <span>{feedbackToast.isSuccess ? "✓" : "⚠️"}</span>
          <span>{feedbackToast.msg}</span>
        </div>
      )}

      {/* Main Screen Header */}
      <div style={styles.header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <h1 style={styles.title}>🛵 Customer Online Orders & Delivery</h1>
            <span style={{
              ...styles.modeBadge,
              backgroundColor: isGlobalMode ? "#ecfdf5" : "#eef2ff",
              color: isGlobalMode ? "#059669" : "#4f46e5"
            }}>
              {isGlobalMode ? "🌐 Global Shop" : "🏪 Local Shop"}
            </span>
          </div>
          <p style={styles.subtitle}>
            Manage online orders, track delivery boys, pack store pickups, and synchronize status with mobile app in real-time.
          </p>
        </div>

        {/* Quick action buttons */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleCreateTestOrder}
            disabled={actionLoading}
            style={styles.testBtn}
            title="Create a test online order to simulate customer ordering"
          >
            <span>+ Simulate Test Order</span>
          </button>
        </div>
      </div>

      {/* Door Delivery Mode Toggle Banner */}
      <div style={{
        ...styles.deliveryBanner,
        backgroundColor: doorDeliveryEnabled ? "#ecfdf5" : "#fffbeb",
        borderColor: doorDeliveryEnabled ? "#a7f3d0" : "#fde68a"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: "260px" }}>
          <span style={{ fontSize: "28px" }}>{doorDeliveryEnabled ? "🛵" : "🏬"}</span>
          <div>
            <div style={{
              fontWeight: "800",
              fontSize: "14px",
              color: doorDeliveryEnabled ? "#15803d" : "#b45309"
            }}>
              {doorDeliveryEnabled ? "Door Delivery: Active (ON)" : "Store Pickup Only: Active (Door Delivery OFF)"}
            </div>
            <div style={{
              fontSize: "12px",
              color: doorDeliveryEnabled ? "#166534" : "#92400e",
              marginTop: "2px"
            }}>
              {doorDeliveryEnabled
                ? "Assign orders to delivery boys using the Delivery App. Customers receive tracking updates."
                : "Door delivery is paused. Customers pick up packed orders directly in your shop."}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleDelivery}
          disabled={actionLoading}
          style={{
            ...styles.deliveryToggleBtn,
            backgroundColor: doorDeliveryEnabled ? "#15803d" : "#d97706"
          }}
        >
          {doorDeliveryEnabled ? "Turn Delivery OFF" : "Turn Delivery ON"}
        </button>
      </div>

      {/* View Switcher: Live Online Orders vs Bill History */}
      <div style={styles.viewTabsRow}>
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            onClick={() => setMainView("online")}
            style={{
              ...styles.viewTabBtn,
              backgroundColor: mainView === "online" ? "#fc8019" : "#f1f5f9",
              color: mainView === "online" ? "#ffffff" : "#475569",
              boxShadow: mainView === "online" ? "0 4px 10px rgba(252,128,25,0.25)" : "none"
            }}
          >
            <span>🛵 Live Online Orders</span>
            {tabCounts.New > 0 && (
              <span style={styles.pulseBadge}>{tabCounts.New}</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setMainView("history")}
            style={{
              ...styles.viewTabBtn,
              backgroundColor: mainView === "history" ? "#fc8019" : "#f1f5f9",
              color: mainView === "history" ? "#ffffff" : "#475569",
              boxShadow: mainView === "history" ? "0 4px 10px rgba(252,128,25,0.25)" : "none"
            }}
          >
            <span>🧾 Sales & Bill History ({salesOrders.length})</span>
          </button>
        </div>

        {/* Mode filter pills */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setModeFilter("current")}
            style={{
              ...styles.filterPill,
              backgroundColor: modeFilter === "current" ? (isGlobalMode ? "#ecfdf5" : "#eef2ff") : "#ffffff",
              color: modeFilter === "current" ? (isGlobalMode ? "#059669" : "#4f46e5") : "#64748b",
              borderColor: modeFilter === "current" ? (isGlobalMode ? "#10b981" : "#6366f1") : "#e2e8f0"
            }}
          >
            Current Mode ({isGlobalMode ? "Global" : "Local"})
          </button>
          <button
            type="button"
            onClick={() => setModeFilter("local")}
            style={{
              ...styles.filterPill,
              backgroundColor: modeFilter === "local" ? "#eef2ff" : "#ffffff",
              color: modeFilter === "local" ? "#4f46e5" : "#64748b",
              borderColor: modeFilter === "local" ? "#6366f1" : "#e2e8f0"
            }}
          >
            🏪 Local
          </button>
          <button
            type="button"
            onClick={() => setModeFilter("global")}
            style={{
              ...styles.filterPill,
              backgroundColor: modeFilter === "global" ? "#ecfdf5" : "#ffffff",
              color: modeFilter === "global" ? "#059669" : "#64748b",
              borderColor: modeFilter === "global" ? "#10b981" : "#e2e8f0"
            }}
          >
            🌐 Global
          </button>
          <button
            type="button"
            onClick={() => setModeFilter("all")}
            style={{
              ...styles.filterPill,
              backgroundColor: modeFilter === "all" ? "#f1f5f9" : "#ffffff",
              color: modeFilter === "all" ? "#0f172a" : "#64748b",
              borderColor: modeFilter === "all" ? "#0f172a" : "#e2e8f0"
            }}
          >
            All
          </button>
        </div>
      </div>

      {/* ========================================================
          VIEW A: LIVE ONLINE ORDERS & DELIVERY MANAGEMENT
         ======================================================== */}
      {mainView === "online" && (
        <div>
          {/* Sub-tabs: All, New, Hold, Completed, Rejected */}
          <div style={styles.subTabsContainer}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {ONLINE_ORDER_TABS.map((tab) => {
                const count = tabCounts[tab] || 0;
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    style={{
                      ...styles.subTabBtn,
                      backgroundColor: isActive ? "#fc8019" : "#ffffff",
                      color: isActive ? "#ffffff" : "#475569",
                      borderColor: isActive ? "#fc8019" : "#e2e8f0"
                    }}
                  >
                    <span>{tab}</span>
                    <span style={{
                      ...styles.subTabCount,
                      backgroundColor: isActive ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                      color: isActive ? "#ffffff" : "#64748b"
                    }}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div style={styles.searchBox}>
              <span>🔍</span>
              <input
                type="text"
                placeholder="Search by Order ID, customer, phone, or items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={styles.clearSearchBtn}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Online Orders Cards List */}
          {filteredOrders.length === 0 ? (
            <div style={styles.emptyCard}>
              <div style={{ fontSize: "48px", marginBottom: "10px" }}>🛵</div>
              <h3 style={{ margin: "0 0 6px 0", fontSize: "18px", color: "#1e293b" }}>
                No online orders found in "{activeTab}" tab
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                {searchQuery
                  ? "No orders match your search keyword. Try clearing the search."
                  : "When customers place orders via the online catalog or shopping app, they will appear here in real-time."}
              </p>
              <button
                type="button"
                onClick={handleCreateTestOrder}
                style={{ ...styles.testBtn, marginTop: "16px" }}
              >
                + Create Test Online Order
              </button>
            </div>
          ) : (
            <div style={styles.ordersGrid}>
              {filteredOrders.map((order) => {
                const orderIdDisplay = order.orderId || order.id.slice(-6).toUpperCase();
                const total = computeOrderTotal(order, uid);
                const items = asArray(order.items);
                const statusColors = getOnlineOrderStatusColors(order.status);
                const progress = getOnlineOrderProgress(order.status);
                const isHeld = order.status === "Pending";
                const isDelivered = order.status === "Delivered";
                const isRejected = order.status === "Rejected";
                const next = getNextOnlineOrderStatus(order.status, order.lastStatus);

                const createdDate = order.createdAt?.toDate
                  ? order.createdAt.toDate().toLocaleString()
                  : order.createdAt
                  ? new Date(order.createdAt).toLocaleString()
                  : "Just now";

                const isOrdGlobal = Boolean(order.isGlobalMode || order.appMode === "global");

                return (
                  <div key={order.id} style={styles.orderCard}>
                    {/* Top Row: ID, Badges, Status */}
                    <div style={styles.cardTopRow}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span style={styles.orderIdBadge}>
                          🆔 #{orderIdDisplay}
                        </span>
                        <span style={{
                          ...styles.miniBadge,
                          backgroundColor: isOrdGlobal ? "#ecfdf5" : "#eef2ff",
                          color: isOrdGlobal ? "#059669" : "#4f46e5"
                        }}>
                          {isOrdGlobal ? "🌐 Global" : "🏪 Local"}
                        </span>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                          🕒 {createdDate}
                        </span>
                      </div>

                      <div style={{
                        ...styles.statusBadge,
                        backgroundColor: statusColors.bg,
                        color: statusColors.color,
                        borderColor: statusColors.border
                      }}>
                        {statusColors.label}
                      </div>
                    </div>

                    <div style={styles.cardDivider} />

                    {/* Customer & Delivery Details */}
                    <div style={styles.customerGrid}>
                      <div>
                        <div style={styles.customerName}>
                          👤 {asText(order.customerName || "Online Customer")}
                        </div>
                        {order.customerPhone && (
                          <div style={styles.customerDetailRow}>
                            <span>📞 {order.customerPhone}</span>
                            <a
                              href={`tel:${order.customerPhone}`}
                              style={styles.actionLink}
                              title="Call Customer"
                            >
                              Call
                            </a>
                            <a
                              href={`https://wa.me/${order.customerPhone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ ...styles.actionLink, color: "#16a34a" }}
                              title="Chat on WhatsApp"
                            >
                              WhatsApp
                            </a>
                          </div>
                        )}
                      </div>

                      <div>
                        <div style={styles.addressText}>
                          📍 {asText(order.deliveryAddress || "Store Pickup / Counter Collection")}
                        </div>
                        {order.deliveryAddress && (
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(order.deliveryAddress)}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ ...styles.actionLink, marginTop: "4px", display: "inline-block" }}
                          >
                            🗺️ Open in Google Maps
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Items Breakdown */}
                    {items.length > 0 && (
                      <div style={styles.itemsContainer}>
                        <div style={styles.itemsHeader}>
                          <span>Ordered Items ({items.length})</span>
                          <span>Qty × Price</span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {items.map((it, idx) => (
                            <div key={idx} style={styles.itemRow}>
                              <span style={{ fontWeight: "600", color: "#1e293b" }}>
                                • {asText(it.itemName || it.name || "Food Item")}
                              </span>
                              <span style={{ color: "#475569", fontSize: "12px" }}>
                                {it.qty || it.quantity || 1} × ₹{Number(it.price || it.salesPrice || 0).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Amount & Payment Method */}
                    <div style={styles.amountRow}>
                      <span style={{ fontSize: "13px", color: "#64748b", fontWeight: "600" }}>
                        Payment: <strong style={{ color: "#1e293b" }}>{order.paymentMode || order.paymentMethod || "COD"}</strong>
                      </span>
                      <span style={styles.totalAmountText}>
                        Total: ₹{Number(total).toFixed(2)}
                      </span>
                    </div>

                    {/* Order Lifecycle Progress Bar */}
                    <div style={{ marginTop: "12px", marginBottom: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>
                        <span>Progress</span>
                        <span>{progress}% ({order.status || "Pending Verification"})</span>
                      </div>
                      <div style={styles.progressTrack}>
                        <div style={{
                          ...styles.progressFill,
                          width: `${progress}%`,
                          backgroundColor: isDelivered ? "#16a34a" : isRejected ? "#ef4444" : "#fc8019"
                        }} />
                      </div>
                    </div>

                    {/* Assigned Delivery Boy Card (if assigned) */}
                    {order.assignedDeliveryBoyName && (
                      <div style={{
                        ...styles.deliveryBoyBadge,
                        backgroundColor: order.deliveryStatus === "rejected" ? "#fef2f2" : "#f0fdf4",
                        borderColor: order.deliveryStatus === "rejected" ? "#fca5a5" : "#bbf7d0"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "18px" }}>🛵</span>
                          <div>
                            <div style={{ fontWeight: "700", fontSize: "12px", color: order.deliveryStatus === "rejected" ? "#b91c1c" : "#15803d" }}>
                              Delivery Boy: {order.assignedDeliveryBoyName}
                              {order.deliveryStatus === "accepted" ? " (Accepted)" : order.deliveryStatus === "assigned" ? " (Dispatched)" : ""}
                            </div>
                            {order.assignedDeliveryBoyPhone && (
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                Ph: {order.assignedDeliveryBoyPhone}
                              </div>
                            )}
                          </div>
                        </div>

                        {order.assignedDeliveryBoyPhone && (
                          <a
                            href={`tel:${order.assignedDeliveryBoyPhone}`}
                            style={styles.callBoyBtn}
                            title="Call Delivery Boy"
                          >
                            📞 Call
                          </a>
                        )}
                      </div>
                    )}

                    {/* Hold Notice if on Hold */}
                    {isHeld && (
                      <div style={styles.holdBanner}>
                        <div style={{ fontWeight: "700", color: "#b45309", fontSize: "12px" }}>
                          ⏸ Order is on Hold
                        </div>
                        {order.pendingMessage && (
                          <div style={{ fontSize: "12px", color: "#92400e", marginTop: "2px" }}>
                            Reason: {order.pendingMessage}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions Button Bar */}
                    <div style={styles.actionsBar}>
                      {/* If order is Held -> Resume button */}
                      {isHeld ? (
                        <button
                          type="button"
                          onClick={() => handleResumeOrder(order)}
                          disabled={actionLoading}
                          style={{ ...styles.actionBtn, backgroundColor: "#10b981", color: "#ffffff" }}
                        >
                          ▶ Resume Order
                        </button>
                      ) : (
                        <>
                          {/* Door Delivery Active: Assign to Delivery Boy button */}
                          {doorDeliveryEnabled && (["Accepted", "Packed"].includes(order.status) || order.deliveryStatus === "rejected") && (
                            <button
                              type="button"
                              onClick={() => {
                                setOrderToAssign(order);
                                setSelectedStaff(deliveryStaffList[0] || null);
                                setCustomBoyName("");
                                setCustomBoyPhone("");
                                setAssignModalOpen(true);
                              }}
                              disabled={actionLoading}
                              style={{ ...styles.actionBtn, backgroundColor: "#16a34a", color: "#ffffff" }}
                            >
                              🛵 {order.deliveryStatus === "rejected" ? "Reassign Delivery Boy" : "Assign Delivery Boy"}
                            </button>
                          )}

                          {/* Door Delivery OFF: Pack & In-App Notification */}
                          {!doorDeliveryEnabled && order.status === "Accepted" && (
                            <button
                              type="button"
                              onClick={() => handleMarkPacked(order)}
                              disabled={actionLoading}
                              style={{ ...styles.actionBtn, backgroundColor: "#7c3aed", color: "#ffffff" }}
                            >
                              📦 Pack & Alert Customer
                            </button>
                          )}

                          {/* Door Delivery OFF & Packed: WhatsApp & Finish */}
                          {!doorDeliveryEnabled && order.status === "Packed" && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  const waUrl = getPickupWhatsAppUrl(order, shopProfile);
                                  if (waUrl) window.open(waUrl, "_blank");
                                }}
                                style={{ ...styles.actionBtn, backgroundColor: "#25d366", color: "#ffffff" }}
                              >
                                💬 WhatsApp Ready Alert
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStatusChange(order, "Delivered")}
                                disabled={actionLoading}
                                style={{ ...styles.actionBtn, backgroundColor: "#10b981", color: "#ffffff" }}
                              >
                                ✓ Collected in Shop (Finish)
                              </button>
                            </>
                          )}

                          {/* Out For Delivery -> Mark Delivered (Finish) */}
                          {order.status === "Out For Delivery" && (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(order, "Delivered")}
                              disabled={actionLoading}
                              style={{ ...styles.actionBtn, backgroundColor: "#16a34a", color: "#ffffff", fontWeight: "800" }}
                            >
                              ✓ Mark Delivered (Finish Order)
                            </button>
                          )}

                          {/* Standard next status button */}
                          {next &&
                            !(doorDeliveryEnabled && ["Accepted", "Packed"].includes(order.status)) &&
                            !(!doorDeliveryEnabled && ["Accepted", "Packed"].includes(order.status)) &&
                            order.status !== "Out For Delivery" && (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(order, next)}
                                disabled={actionLoading}
                                style={{ ...styles.actionBtn, backgroundColor: "#6366f1", color: "#ffffff" }}
                              >
                                Mark as {next}
                              </button>
                            )}
                        </>
                      )}

                      {/* Hold button */}
                      {!isDelivered && !isRejected && (
                        <button
                          type="button"
                          onClick={() => {
                            setOrderToHold(order);
                            setHoldReason(order.pendingMessage || "");
                            setHoldModalOpen(true);
                          }}
                          disabled={actionLoading}
                          style={{ ...styles.actionBtn, backgroundColor: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" }}
                        >
                          {isHeld ? "Edit Hold" : "⏸ Hold"}
                        </button>
                      )}

                      {/* Reject button */}
                      {!isDelivered && !isRejected && (
                        <button
                          type="button"
                          onClick={() => handleRejectOrder(order)}
                          disabled={actionLoading}
                          style={{ ...styles.actionBtn, backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5" }}
                        >
                          ✕ Reject
                        </button>
                      )}

                      {/* If Delivered: Completed Badge */}
                      {isDelivered && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#16a34a", fontWeight: "700", fontSize: "13px" }}>
                          <span>✓ Order Finished & Synchronized</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          VIEW B: SALES & BILL HISTORY (PRESERVED BILLING ARCHIVE)
         ======================================================== */}
      {mainView === "history" && (
        <div>
          <div style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "#1e293b" }}>
              🧾 Past Sales & Checkout Bills ({displayedSalesOrders.length})
            </h3>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              All counter bills, KOT checkouts, and completed online deliveries
            </span>
          </div>

          {displayedSalesOrders.length === 0 ? (
            <div style={styles.emptyCard}>
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>📜</div>
              <h4 style={{ margin: 0, color: "#64748b" }}>No sales bills found for the selected filter.</h4>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {displayedSalesOrders.map((ord, idx) => {
                const isOrdGlobal = Boolean(ord.isGlobalMode || ord.appMode === "global");
                const classification = getOrderClassification(ord);
                const billId = ord.invoiceId || ord.billNo || ord.id.slice(-6).toUpperCase();

                return (
                  <div
                    key={ord.id || idx}
                    onClick={() => onViewBillDetails && onViewBillDetails(ord)}
                    style={styles.historyCard}
                  >
                    <div style={{ flex: 1, minWidth: "220px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: "800", fontSize: "15px", color: "#0f172a" }}>
                          Bill #{billId}
                        </span>
                        {(ord.tokenNumber || ord.tokenNo) && (
                          <span style={{
                            ...styles.miniBadge,
                            backgroundColor: "#fff7ed",
                            color: "#c2410c",
                            fontWeight: "800",
                            border: "1px solid #fed7aa"
                          }}>
                            🎟️ Token #{ord.tokenNumber || ord.tokenNo}
                          </span>
                        )}
                        <span style={{
                          ...styles.miniBadge,
                          backgroundColor: isOrdGlobal ? "#ecfdf5" : "#eef2ff",
                          color: isOrdGlobal ? "#059669" : "#4f46e5"
                        }}>
                          {isOrdGlobal ? "🌐 Global" : "🏪 Local"}
                        </span>
                        {classification.isTable && (
                          <span style={{ ...styles.miniBadge, backgroundColor: "#e0f2fe", color: "#0369a1" }}>
                            🍽️ {classification.tableNo}
                          </span>
                        )}
                        {classification.isParcel && (
                          <span style={{ ...styles.miniBadge, backgroundColor: "#fef3c7", color: "#b45309" }}>
                            🥡 PARCEL
                          </span>
                        )}
                        {ord.orderType === "ONLINE" && (
                          <span style={{ ...styles.miniBadge, backgroundColor: "#ede9fe", color: "#6d28d9" }}>
                            🛵 ONLINE
                          </span>
                        )}
                        {ord.terminalName && (
                          <span style={{ ...styles.miniBadge, backgroundColor: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
                            🖥️ {ord.terminalName}{ord.floorName ? ` • ${ord.floorName}` : ""}
                          </span>
                        )}
                        {(ord.transactionStatus === "refunded" || ord.transactionStatus === "cancelled") && (
                          <span style={{ ...styles.miniBadge, backgroundColor: "#fee2e2", color: "#dc2626" }}>
                            {ord.transactionStatus.toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: "12px", color: "#64748b" }}>
                        Customer: {ord.customerName || "Walk-in"} • Mode: {ord.paymentMethod || ord.paymentMode || "Cash"} • Items: {asArray(ord.items).length}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "16px", fontWeight: "800", color: "#fc8019" }}>
                        ₹{Number(ord.totalAmount || ord.total || 0).toFixed(2)}
                      </div>
                      <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                        {ord.billDate || (ord.createdAt?.toDate ? ord.createdAt.toDate().toLocaleDateString() : "")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          MODAL 1: ASSIGN DELIVERY BOY
         ======================================================== */}
      {assignModalOpen && orderToAssign && (
        <div style={styles.modalOverlay} onClick={() => setAssignModalOpen(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: "18px", color: "#0f172a" }}>
                🛵 Assign Delivery Boy
              </h3>
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "20px" }}>
              <div style={{ marginBottom: "16px", backgroundColor: "#f8fafc", padding: "12px", borderRadius: "10px", fontSize: "13px" }}>
                <div><strong>Order:</strong> #{orderToAssign.orderId || orderToAssign.id.slice(-6)}</div>
                <div><strong>Customer:</strong> {orderToAssign.customerName || "Customer"} ({orderToAssign.customerPhone || "No phone"})</div>
                <div><strong>Address:</strong> {orderToAssign.deliveryAddress || "Address not provided"}</div>
                <div><strong>Amount:</strong> ₹{computeOrderTotal(orderToAssign, uid)} ({orderToAssign.paymentMode || "COD"})</div>
              </div>

              {/* Select Existing Delivery Staff */}
              <div style={{ marginBottom: "16px" }}>
                <label style={styles.formLabel}>
                  Select Registered Delivery Staff:
                </label>
                {deliveryStaffList.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "#64748b", padding: "8px 0" }}>
                    No delivery staff registered yet. You can enter delivery boy details below to auto-register.
                  </div>
                ) : (
                  <select
                    style={styles.selectInput}
                    value={selectedStaff?.staffId || selectedStaff?.id || ""}
                    onChange={(e) => {
                      const found = deliveryStaffList.find((s) => (s.staffId || s.id) === e.target.value);
                      setSelectedStaff(found || null);
                      if (found) {
                        setCustomBoyName("");
                        setCustomBoyPhone("");
                      }
                    }}
                  >
                    <option value="">-- Choose from your delivery staff --</option>
                    {deliveryStaffList.map((st) => (
                      <option key={st.id || st.staffId} value={st.staffId || st.id}>
                        {st.name} ({st.mobile || "No Mobile"})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Or Enter Custom Delivery Boy */}
              <div style={{ borderTop: "1px dashed #cbd5e1", paddingTop: "14px", marginTop: "14px" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#64748b", marginBottom: "8px" }}>
                  OR ENTER NEW DELIVERY BOY:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <input
                    type="text"
                    placeholder="Delivery Boy Name (e.g. Ramesh)"
                    value={customBoyName}
                    onChange={(e) => {
                      setCustomBoyName(e.target.value);
                      if (e.target.value) setSelectedStaff(null);
                    }}
                    style={styles.modalInput}
                  />
                  <input
                    type="tel"
                    placeholder="Mobile Number (e.g. 9876543210)"
                    value={customBoyPhone}
                    onChange={(e) => {
                      setCustomBoyPhone(e.target.value);
                      if (e.target.value) setSelectedStaff(null);
                    }}
                    style={styles.modalInput}
                  />
                </div>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignDelivery}
                disabled={actionLoading || (!selectedStaff && !customBoyName.trim())}
                style={{
                  ...styles.modalSubmitBtn,
                  backgroundColor: !selectedStaff && !customBoyName.trim() ? "#cbd5e1" : "#16a34a"
                }}
              >
                {actionLoading ? "Dispatching..." : "✓ Dispatch to Delivery App"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          MODAL 2: HOLD ORDER
         ======================================================== */}
      {holdModalOpen && orderToHold && (
        <div style={styles.modalOverlay} onClick={() => setHoldModalOpen(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: "18px", color: "#0f172a" }}>
                ⏸ Place Order on Hold
              </h3>
              <button
                type="button"
                onClick={() => setHoldModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "20px" }}>
              <div style={{ marginBottom: "14px" }}>
                <label style={styles.formLabel}>
                  Hold Duration:
                </label>
                <select
                  style={styles.selectInput}
                  value={holdDurationMinutes}
                  onChange={(e) => setHoldDurationMinutes(Number(e.target.value))}
                >
                  <option value={15}>15 Minutes</option>
                  <option value={30}>30 Minutes</option>
                  <option value={60}>1 Hour</option>
                  <option value={120}>2 Hours</option>
                  <option value={1440}>Tomorrow (24 Hours)</option>
                </select>
              </div>

              <div>
                <label style={styles.formLabel}>
                  Reason / Message for Customer:
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Item preparation taking extra time, high kitchen volume..."
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  style={styles.textareaInput}
                />
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setHoldModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmHold}
                disabled={actionLoading}
                style={{ ...styles.modalSubmitBtn, backgroundColor: "#d97706" }}
              >
                {actionLoading ? "Saving..." : "Confirm Hold"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "24px",
    maxWidth: "1100px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "18px",
    flexWrap: "wrap",
    gap: "12px",
  },
  title: {
    fontSize: "24px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0,
  },
  subtitle: {
    fontSize: "13px",
    color: "#64748b",
    margin: "4px 0 0 0",
  },
  modeBadge: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "3px 10px",
    borderRadius: "12px",
  },
  testBtn: {
    padding: "8px 14px",
    backgroundColor: "#eff6ff",
    color: "#2563eb",
    border: "1.5px solid #bfdbfe",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  deliveryBanner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    borderRadius: "14px",
    border: "1.5px solid",
    marginBottom: "20px",
    flexWrap: "wrap",
    gap: "12px",
  },
  deliveryToggleBtn: {
    padding: "8px 18px",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: "800",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
  },
  viewTabsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
    flexWrap: "wrap",
    gap: "10px",
  },
  viewTabBtn: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 18px",
    border: "none",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: "800",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  pulseBadge: {
    backgroundColor: "#ef4444",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: "800",
    padding: "1px 6px",
    borderRadius: "10px",
  },
  filterPill: {
    padding: "5px 12px",
    borderRadius: "16px",
    border: "1px solid",
    fontSize: "11px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  subTabsContainer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "18px",
    flexWrap: "wrap",
    gap: "12px",
    backgroundColor: "#ffffff",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
  },
  subTabBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 14px",
    borderRadius: "8px",
    border: "1px solid",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  subTabCount: {
    fontSize: "11px",
    padding: "1px 6px",
    borderRadius: "8px",
    fontWeight: "800",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "6px 12px",
    minWidth: "260px",
    flex: 1,
    maxWidth: "400px",
  },
  searchInput: {
    border: "none",
    background: "transparent",
    outline: "none",
    fontSize: "12px",
    width: "100%",
    color: "#0f172a",
  },
  clearSearchBtn: {
    border: "none",
    background: "transparent",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: "700",
  },
  ordersGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  orderCard: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e2e8f0",
    padding: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  },
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  orderIdBadge: {
    fontWeight: "800",
    fontSize: "15px",
    color: "#0f172a",
  },
  miniBadge: {
    fontSize: "10px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "10px",
  },
  statusBadge: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "4px 12px",
    borderRadius: "12px",
    border: "1px solid",
  },
  cardDivider: {
    height: "1px",
    backgroundColor: "#f1f5f9",
    margin: "12px 0",
  },
  customerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
    marginBottom: "12px",
  },
  customerName: {
    fontWeight: "700",
    fontSize: "14px",
    color: "#0f172a",
  },
  customerDetailRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    color: "#475569",
    marginTop: "4px",
    flexWrap: "wrap",
  },
  addressText: {
    fontSize: "12px",
    color: "#475569",
    lineHeight: "1.4",
  },
  actionLink: {
    fontSize: "11px",
    fontWeight: "700",
    color: "#2563eb",
    textDecoration: "none",
    cursor: "pointer",
  },
  itemsContainer: {
    backgroundColor: "#f8fafc",
    padding: "10px 14px",
    borderRadius: "10px",
    marginBottom: "12px",
  },
  itemsHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "11px",
    fontWeight: "700",
    color: "#64748b",
    marginBottom: "6px",
    borderBottom: "1px dashed #e2e8f0",
    paddingBottom: "4px",
  },
  itemRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "12px",
  },
  amountRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 0",
  },
  totalAmountText: {
    fontSize: "16px",
    fontWeight: "800",
    color: "#fc8019",
  },
  progressTrack: {
    width: "100%",
    height: "6px",
    backgroundColor: "#e2e8f0",
    borderRadius: "4px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: "4px",
    transition: "width 0.3s ease",
  },
  deliveryBoyBadge: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: "10px",
    border: "1px solid",
    marginTop: "10px",
    flexWrap: "wrap",
    gap: "6px",
  },
  callBoyBtn: {
    fontSize: "11px",
    fontWeight: "800",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    padding: "4px 10px",
    borderRadius: "6px",
    textDecoration: "none",
  },
  holdBanner: {
    backgroundColor: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: "10px",
    padding: "8px 12px",
    marginTop: "10px",
  },
  actionsBar: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: "14px",
    paddingTop: "12px",
    borderTop: "1px solid #f1f5f9",
  },
  actionBtn: {
    padding: "7px 14px",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    border: "none",
    transition: "all 0.15s ease",
  },
  historyCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "16px",
    border: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    flexWrap: "wrap",
    gap: "10px",
    transition: "box-shadow 0.15s ease",
  },
  emptyCard: {
    textAlign: "center",
    padding: "60px 20px",
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e2e8f0",
  },
  feedbackToast: {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    color: "#ffffff",
    padding: "12px 20px",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: "700",
    boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    zIndex: 999999,
    animation: "fadeIn 0.2s ease",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999999,
    padding: "16px",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    maxWidth: "500px",
    width: "100%",
    overflow: "hidden",
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
  },
  modalHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalCloseBtn: {
    border: "none",
    background: "transparent",
    fontSize: "16px",
    cursor: "pointer",
    color: "#64748b",
  },
  formLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
    marginBottom: "6px",
  },
  selectInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
  },
  modalInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
  },
  textareaInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
    resize: "vertical",
  },
  modalFooter: {
    padding: "14px 20px",
    borderTop: "1px solid #e2e8f0",
    backgroundColor: "#f8fafc",
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
  },
  modalCancelBtn: {
    padding: "8px 16px",
    backgroundColor: "#e2e8f0",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#475569",
    cursor: "pointer",
  },
  modalSubmitBtn: {
    padding: "8px 18px",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
  },
};
