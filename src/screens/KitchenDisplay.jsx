import { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { getOrderClassification } from "../utils/restaurantOrderService";
import { deductRecipeStock } from "../utils/recipeStockService";

const getElapsedTime = (createdAtMs, timestamp) => {
  let date;
  if (createdAtMs) {
    date = new Date(createdAtMs);
  } else if (!timestamp) {
    return "Just now";
  } else if (typeof timestamp.toDate === "function") {
    date = timestamp.toDate();
  } else if (timestamp.seconds) {
    date = new Date(timestamp.seconds * 1000);
  } else {
    date = new Date(timestamp);
  }
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes <= 0) return "Just now";
  if (diffMinutes === 1) return "1 min ago";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ${diffMinutes % 60}m ago`;
};

const getUrgencyColor = (createdAtMs) => {
  if (!createdAtMs) return "#10b981";
  const diffMinutes = Math.floor((Date.now() - createdAtMs) / 60000);
  if (diffMinutes < 8) return "#10b981"; // Fresh (green)
  if (diffMinutes < 15) return "#f59e0b"; // Warning (amber)
  return "#ef4444"; // Urgent (red > 15 mins)
};

export default function KitchenDisplay() {
  const masterUid = localStorage.getItem("uid") || auth.currentUser?.uid;
  const chefName = localStorage.getItem("staff_name") || "Kitchen Cook / Chef";
  const staffId = localStorage.getItem("staff_id") || "KIT-01";

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active"); // "active" | "pending" | "preparing" | "ready" | "all"
  const [checkedItems, setCheckedItems] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(true);

  const prevPendingCountRef = useRef(0);

  // Play audio chime when new KOT arrives
  const playChime = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (_) {}
  };

  useEffect(() => {
    if (!masterUid) {
      setLoading(false);
      return;
    }

    const colRef = collection(db, "users", masterUid, "kitchen_orders");
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((o) => o.status !== "completed")
          .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)); // Oldest first (FIFO)

        const pendingCount = list.filter((o) => o.status === "pending").length;
        if (pendingCount > prevPendingCountRef.current && soundEnabled) {
          playChime();
        }
        prevPendingCountRef.current = pendingCount;

        setOrders(list);
        setLoading(false);
      },
      (err) => {
        console.error("Kitchen orders listener error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [masterUid, soundEnabled]);

  // Update order status
  const handleUpdateStatus = async (orderId, newStatus) => {
    if (!masterUid || !orderId) return;

    try {
      const targetOrder = orders.find((o) => o.id === orderId);
      const shouldDeduct = (newStatus === "completed" || newStatus === "served") && targetOrder && !targetOrder.ingredientsDeducted;
      if (shouldDeduct && Array.isArray(targetOrder.items)) {
        try {
          deductRecipeStock(masterUid, targetOrder.items);
        } catch (_) {}
      }

      const updateData = {
        status: newStatus,
        updatedAt: serverTimestamp(),
      };
      if (shouldDeduct) {
        updateData.ingredientsDeducted = true;
      }
      if (newStatus === "ready") {
        updateData.readyAt = serverTimestamp();
        updateData.readyAtMs = Date.now();
      }

      await updateDoc(doc(db, "users", masterUid, "kitchen_orders", orderId), updateData);
      try {
        await updateDoc(doc(db, "kitchen_orders", orderId), updateData);
      } catch (_) {}
    } catch (err) {
      alert("Error updating order status: " + err.message);
    }
  };

  // Toggle item checkmark
  const toggleItemCheck = (orderId, itemIndex) => {
    const key = `${orderId}_${itemIndex}`;
    setCheckedItems((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Print Kitchen Order Ticket (KOT) without amounts!
  const printKotTicket = (order) => {
    const classification = getOrderClassification(order);
    const isParcel = classification.isParcel;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>KOT - ${order.orderNumber || "TICKET"}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body {
            font-family: monospace;
            padding: 10px 8px;
            color: #000;
            margin: 0;
            font-size: 13px;
          }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .divider { border-top: 1.5px dashed #000; margin: 8px 0; }
          .table-header {
            font-size: 18px;
            font-weight: 900;
            padding: 4px 0;
            text-transform: uppercase;
          }
          .kot-badge {
            background-color: #000;
            color: #fff;
            padding: 2px 6px;
            font-size: 14px;
            font-weight: bold;
            display: inline-block;
            margin: 4px 0;
          }
          table { width: 100%; border-collapse: collapse; margin-top: 6px; }
          th { text-align: left; border-bottom: 1px dashed #000; padding: 4px 0; font-size: 12px; }
          td { padding: 5px 0; vertical-align: top; }
          .qty-col { text-align: right; font-size: 15px; font-weight: 900; }
          .notes { font-size: 11px; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="center bold">
          <div style="font-size: 14px;">KITCHEN ORDER TICKET (KOT)</div>
          ${(order.tokenNumber || order.tokenNo) ? `
            <div style="font-size: 24px; font-weight: 900; background-color: #000; color: #fff; padding: 4px 12px; margin: 6px auto; display: inline-block; border-radius: 4px; letter-spacing: 1px;">
              TOKEN #${order.tokenNumber || order.tokenNo}
            </div>
          ` : ""}
          <div class="table-header">${isParcel ? "PARCEL" : classification.isTable ? classification.tableNo : "COUNTER ORDER"}</div>
          ${classification.customerName && classification.customerName !== classification.tableNo ? `<div style="font-size: 12px; margin-top: 2px;">Customer: ${classification.customerName}</div>` : ""}
          <div class="kot-badge">${isParcel ? "🥡 PARCEL PACKING" : classification.isTable ? "🍽️ DINE-IN" : "⚡ WALK-IN"}</div>
          ${order.isPaid ? `<div style="font-size: 12px; font-weight: 800; color: #000; margin-top: 2px;">[PAID AT COUNTER]</div>` : ""}
        </div>

        <div class="divider"></div>
        <div><strong>KOT No:</strong> ${order.orderNumber || "KOT"}</div>
        <div><strong>Waiter / Taken By:</strong> ${order.waiterName || "Counter"}</div>
        <div><strong>Time:</strong> ${new Date(order.createdAtMs || Date.now()).toLocaleTimeString()}</div>
        ${order.orderNotes ? `<div><strong>Kitchen Note:</strong> ${order.orderNotes}</div>` : ""}

        <div class="divider"></div>
        <table>
          <thead>
            <tr>
              <th>ITEM DESCRIPTION</th>
              <th class="qty-col">QTY</th>
            </tr>
          </thead>
          <tbody>
            ${(order.items || [])
              .map(
                (item) => `
              <tr>
                <td>
                  <span class="bold">${item.name}</span>
                  ${item.portion && item.portion !== "Standard" ? `<br/><small>(${item.portion})</small>` : ""}
                  ${item.notes ? `<br/><span class="notes">• Note: ${item.notes}</span>` : ""}
                </td>
                <td class="qty-col">x${item.qty}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>

        <div class="divider"></div>
        <div style="display: flex; justify-content: space-between;">
          <span><strong>Total Items:</strong></span>
          <span class="bold">${(order.items || []).reduce((acc, i) => acc + (Number(i.qty) || 1), 0)} items</span>
        </div>
        <div class="divider"></div>
        <div class="center" style="font-size: 11px;">* FOR KITCHEN / PACKING USE ONLY - NO PRICES *</div>
      </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=380,height=600");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 350);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (filter === "all") return true;
    if (filter === "active") return o.status !== "served" && o.status !== "completed";
    return o.status === filter;
  });

  const handleLogout = () => {
    if (window.confirm("Exit Kitchen Display Portal?")) {
      localStorage.removeItem("staff_id");
      localStorage.removeItem("staff_name");
      localStorage.removeItem("staff_role");
      localStorage.removeItem("is_staff");
      window.location.href = "/login";
    }
  };

  return (
    <div style={styles.container}>
      {/* Top KDS Header */}
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={styles.chefBadge}>👨‍🍳</div>
          <div>
            <h1 style={styles.headerTitle}>Kitchen Display System (KDS)</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Cook:</span>
              <span style={{ fontSize: "12px", fontWeight: "800", color: "#ea580c" }}>
                {chefName} ({staffId})
              </span>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setFilter("active")}
            style={{
              ...styles.filterBtn,
              backgroundColor: filter === "active" ? "#ea580c" : "#1e293b",
              color: "#ffffff",
            }}
          >
            🔥 Active ({orders.filter((o) => o.status !== "served").length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("pending")}
            style={{
              ...styles.filterBtn,
              backgroundColor: filter === "pending" ? "#f59e0b" : "#1e293b",
              color: "#ffffff",
            }}
          >
            ⏳ New / Pending ({orders.filter((o) => o.status === "pending").length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("preparing")}
            style={{
              ...styles.filterBtn,
              backgroundColor: filter === "preparing" ? "#3b82f6" : "#1e293b",
              color: "#ffffff",
            }}
          >
            🍳 Cooking ({orders.filter((o) => o.status === "preparing").length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("ready")}
            style={{
              ...styles.filterBtn,
              backgroundColor: filter === "ready" ? "#10b981" : "#1e293b",
              color: "#ffffff",
            }}
          >
            🛎️ Ready ({orders.filter((o) => o.status === "ready").length})
          </button>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            style={{ ...styles.iconBtn, backgroundColor: soundEnabled ? "#10b981" : "#475569" }}
            title={soundEnabled ? "Sound Alerts On" : "Sound Alerts Off"}
          >
            {soundEnabled ? "🔔 Sound On" : "🔕 Muted"}
          </button>

          <button type="button" onClick={handleLogout} style={styles.logoutBtn} title="Logout">
            🚪 Exit
          </button>
        </div>
      </header>

      {/* Main KDS Grid */}
      <main style={styles.mainArea}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#94a3b8" }}>
            <div style={{ fontSize: "16px", fontWeight: "700" }}>Loading incoming kitchen orders...</div>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={{ fontSize: "54px", display: "block", marginBottom: "12px" }}>👨‍🍳</span>
            <h2 style={{ margin: "0 0 6px 0", fontSize: "20px", fontWeight: "800", color: "#f8fafc" }}>
              All Caught Up! No pending dishes in kitchen.
            </h2>
            <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8" }}>
              New orders taken by waiters or counter will appear here with an audio chime.
            </p>
          </div>
        ) : (
          <div style={styles.kdsGrid}>
            {filteredOrders.map((order) => {
              const classification = getOrderClassification(order);
              const urgencyColor = getUrgencyColor(order.createdAtMs);
              const isPending = order.status === "pending";
              const isPreparing = order.status === "preparing";
              const isReady = order.status === "ready";
              const isParcel = classification.isParcel;

              return (
                <div
                  key={order.id}
                  style={{
                    ...styles.kdsCard,
                    borderColor: isParcel ? "#ea580c" : isReady ? "#10b981" : isPreparing ? "#3b82f6" : "#f59e0b",
                    boxShadow: isPending ? "0 0 15px rgba(245, 158, 11, 0.25)" : "none",
                  }}
                >
                  {/* Card Header */}
                  <div style={{ ...styles.cardHeader, backgroundColor: isParcel ? "#431407" : "#0f172a" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          {(order.tokenNumber || order.tokenNo) && (
                            <span style={{
                              backgroundColor: "#ea580c",
                              color: "#ffffff",
                              fontSize: "13px",
                              fontWeight: "900",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              letterSpacing: "0.5px"
                            }}>
                              TOKEN #{order.tokenNumber || order.tokenNo}
                            </span>
                          )}
                          <span style={styles.tableBadge}>
                            {isParcel ? "🥡 PARCEL" : classification.isTable ? `🍽️ ${classification.tableNo}` : "⚡ COUNTER"}
                          </span>
                          {order.isPaid && (
                            <span style={{
                              backgroundColor: "#065f46",
                              color: "#34d399",
                              fontSize: "11px",
                              fontWeight: "800",
                              padding: "2px 6px",
                              borderRadius: "6px",
                              border: "1px solid #059669"
                            }}>
                              PAID ✅
                            </span>
                          )}
                          {classification.customerName && classification.customerName !== classification.tableNo && (
                            <span style={{ fontSize: "12px", color: isParcel ? "#fed7aa" : "#cbd5e1", fontWeight: "800" }}>
                              ({classification.customerName})
                            </span>
                          )}
                          <span
                            style={{
                              ...styles.statusBadge,
                              backgroundColor: isReady ? "#10b981" : isPreparing ? "#2563eb" : "#f59e0b",
                            }}
                          >
                            {order.status?.toUpperCase() || "PENDING"}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
                          #{order.orderNumber} • Taken by: <strong>{order.waiterName || "Counter"}</strong>
                        </div>
                      </div>

                      {/* Elapsed Time & Print KOT */}
                      <div style={{ textAlign: "right" }}>
                        <div style={{ ...styles.timeElapsedBadge, color: urgencyColor }}>
                          ⏱️ {getElapsedTime(order.createdAtMs, order.createdAt)}
                        </div>
                        <button
                          type="button"
                          onClick={() => printKotTicket(order)}
                          style={styles.printTicketBtn}
                          title="Print KOT Ticket without prices"
                        >
                          🖨️ Print Slip
                        </button>
                      </div>
                    </div>

                    {order.orderNotes && (
                      <div style={styles.orderNotesBanner}>
                        ⚠️ Special Instruction: {order.orderNotes}
                      </div>
                    )}
                  </div>

                  {/* Items List (NO PRICES SHOWN!) */}
                  <div style={styles.cardBody}>
                    <div style={styles.itemsList}>
                      {(order.items || []).map((item, idx) => {
                        const isDone = !!checkedItems[`${order.id}_${idx}`];
                        return (
                          <div
                            key={idx}
                            onClick={() => toggleItemCheck(order.id, idx)}
                            style={{
                              ...styles.itemRow,
                              backgroundColor: isDone ? "#14532d" : "#1e293b",
                              opacity: isDone ? 0.6 : 1,
                              textDecoration: isDone ? "line-through" : "none",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                              <input
                                type="checkbox"
                                checked={isDone}
                                onChange={() => toggleItemCheck(order.id, idx)}
                                style={{ width: "16px", height: "16px", cursor: "pointer", accentColor: "#10b981" }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: "14px", fontWeight: "800", color: "#ffffff", wordBreak: "break-word" }}>
                                  {item.name}
                                </div>
                                {item.portion && item.portion !== "Standard" && (
                                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>Portion: {item.portion}</div>
                                )}
                                {item.notes && (
                                  <div style={{ fontSize: "11px", color: "#fb923c", fontWeight: "700" }}>
                                    • {item.notes}
                                  </div>
                                )}
                              </div>
                            </div>

                            <span style={styles.itemQtyBadge}>
                              x{item.qty}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={styles.cardFooter}>
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, "preparing")}
                        style={{ ...styles.actionBtn, backgroundColor: "#2563eb" }}
                      >
                        👨‍🍳 Start Cooking
                      </button>
                    )}

                    {isPreparing && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(order.id, "ready")}
                        style={{ ...styles.actionBtn, backgroundColor: "#10b981" }}
                      >
                        🛎️ Mark Food Ready / Packed
                      </button>
                    )}

                    {isReady && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                        <div style={styles.readyNotification}>
                          ✓ Dish Ready! Real-time notification sent to {(order.isPaid || order.billNo) ? "Counter for Customer Pickup (PAID ✅)" : isParcel ? "Counter & Packing" : (order.waiterName ? `Waiter (${order.waiterName})` : "Waiter")}.
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(order.id, (order.isPaid || order.billNo) ? "completed" : "served")}
                          style={{
                            ...styles.actionBtn,
                            backgroundColor: "#059669",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px"
                          }}
                        >
                          ✅ Food Picked Up / Handed Over
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    maxHeight: "100vh",
    backgroundColor: "#090d16",
    fontFamily: "system-ui, sans-serif",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 24px",
    backgroundColor: "#0f172a",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: "10px",
  },
  chefBadge: {
    width: "40px",
    height: "40px",
    borderRadius: "12px",
    backgroundColor: "#ea580c",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
  },
  headerTitle: {
    fontSize: "17px",
    fontWeight: "800",
    color: "#f8fafc",
    margin: 0,
  },
  filterBtn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "1px solid #334155",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  iconBtn: {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "none",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  logoutBtn: {
    padding: "8px 14px",
    backgroundColor: "#7f1d1d",
    color: "#fca5a5",
    border: "none",
    borderRadius: "8px",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },

  mainArea: {
    flex: 1,
    padding: "20px 24px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    padding: "40px",
  },
  kdsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "16px",
    paddingBottom: "30px",
  },
  kdsCard: {
    backgroundColor: "#0f172a",
    borderRadius: "16px",
    border: "2px solid #1e293b",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
  },
  cardHeader: {
    padding: "14px 16px",
    borderBottom: "1px solid #1e293b",
  },
  tableBadge: {
    fontSize: "16px",
    fontWeight: "900",
    color: "#ffffff",
    textTransform: "uppercase",
  },
  statusBadge: {
    fontSize: "10px",
    fontWeight: "800",
    color: "#ffffff",
    padding: "2px 8px",
    borderRadius: "10px",
  },
  timeElapsedBadge: {
    fontSize: "12px",
    fontWeight: "800",
    marginBottom: "4px",
  },
  printTicketBtn: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    color: "#cbd5e1",
    padding: "3px 8px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: "700",
    cursor: "pointer",
  },
  orderNotesBanner: {
    marginTop: "8px",
    backgroundColor: "#431407",
    color: "#fed7aa",
    padding: "6px 10px",
    borderRadius: "8px",
    fontSize: "11px",
    fontWeight: "700",
    border: "1px solid #9a3412",
  },

  cardBody: {
    padding: "14px 16px",
    flex: 1,
  },
  itemsList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  itemRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  itemQtyBadge: {
    backgroundColor: "#0284c7",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: "900",
    padding: "4px 10px",
    borderRadius: "8px",
    marginLeft: "10px",
    flexShrink: 0,
  },

  cardFooter: {
    padding: "12px 16px 16px",
    borderTop: "1px solid #1e293b",
    backgroundColor: "#0f172a",
  },
  actionBtn: {
    width: "100%",
    padding: "12px",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    fontWeight: "800",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  },
  readyNotification: {
    width: "100%",
    padding: "10px",
    backgroundColor: "#064e3b",
    color: "#6ee7b7",
    fontSize: "12px",
    fontWeight: "700",
    borderRadius: "8px",
    textAlign: "center",
    border: "1px solid #047857",
  },
};
