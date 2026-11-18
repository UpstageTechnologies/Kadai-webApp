import { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, addDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { getOrderClassification, playNotificationSound } from "../utils/restaurantOrderService";

const QUICK_TABLES = [
  "Table 1",
  "Table 2",
  "Table 3",
  "Table 4",
  "Table 5",
  "Table 6",
  "Table 7",
  "Table 8",
  "Table 9",
  "Table 10",
  "Table 11",
  "Table 12",
];

export default function WaiterOrder() {
  const masterUid = localStorage.getItem("uid") || auth.currentUser?.uid;
  const waiterName = localStorage.getItem("staff_name") || "Waiter / Captain";
  const waiterId = localStorage.getItem("staff_id") || "WTR-01";

  // Tab: "take_order" | "live_kot"
  const [activeTab, setActiveTab] = useState("take_order");

  // Table selection
  const [selectedTable, setSelectedTable] = useState("Table 1");
  const [customTable, setCustomTable] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [isTakeaway, setIsTakeaway] = useState(false);
  const [takeawayCustomerName, setTakeawayCustomerName] = useState("");

  // Menu items & categories
  const [menuFoods, setMenuFoods] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [loadingMenu, setLoadingMenu] = useState(true);

  // Cart for current table
  const [orderItems, setOrderItems] = useState([]);
  const [orderNotes, setOrderNotes] = useState("");
  const [isSendingKot, setIsSendingKot] = useState(false);

  // Live KOTs
  const [kitchenOrders, setKitchenOrders] = useState([]);

  // Waiter Real-time Table-Specific Food Ready Notification
  const [waiterToast, setWaiterToast] = useState(null);
  const isInitialLoadRef = useRef(true);
  const notifiedReadyIdsRef = useRef(new Set());

  // Note dialog for food item
  const [editingItemNoteIndex, setEditingItemNoteIndex] = useState(null);
  const [itemNoteText, setItemNoteText] = useState("");

  // 1. Load Restaurant Menu
  useEffect(() => {
    if (!masterUid) {
      setLoadingMenu(false);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "users", masterUid, "restaurant_menu"),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((item) => item.isAvailable !== false);
        setMenuFoods(list);

        const cats = ["All", ...new Set(list.map((i) => i.category || "Main Course").filter(Boolean))];
        setCategories(cats);
        setLoadingMenu(false);
      },
      (err) => {
        console.error("Error loading restaurant menu:", err);
        setLoadingMenu(false);
      }
    );

    return () => unsub();
  }, [masterUid]);

  // 2. Real-time Live Kitchen Orders with Table-Specific Food Ready Notifications for this Waiter
  useEffect(() => {
    if (!masterUid) return;

    const colRef = collection(db, "users", masterUid, "kitchen_orders");
    const unsub = onSnapshot(colRef, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((o) => o.status !== "completed")
        .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

      setKitchenOrders(list);

      // Trigger table-specific food ready notification ONLY on actual kitchen status transition to "ready"
      if (isInitialLoadRef.current) {
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.status === "ready" || data.status === "served") {
            notifiedReadyIdsRef.current.add(d.id);
          }
        });
        isInitialLoadRef.current = false;
      } else {
        snap.docChanges().forEach((change) => {
          if (change.type === "added" || change.type === "modified") {
            const o = { id: change.doc.id, ...change.doc.data() };
            if (o.status === "ready" && !notifiedReadyIdsRef.current.has(o.id)) {
              // Strictly verify order is assigned to THIS waiter
              const isMyOrder =
                (o.waiterId && String(o.waiterId) === String(waiterId)) ||
                (o.waiterName && String(o.waiterName) === String(waiterName));

              if (isMyOrder) {
                notifiedReadyIdsRef.current.add(o.id);
                playNotificationSound("foodReady");
                const classification = getOrderClassification(o);
                const tableText = classification.isParcel
                  ? `PARCEL (${classification.customerName})`
                  : classification.tableNo || "Table";

                setWaiterToast({
                  id: o.id,
                  message: `Food Ready – ${tableText}. Please collect the order.`,
                  tableNo: classification.isParcel ? "PARCEL" : classification.tableNo,
                });
              }
            }
          }
        });
      }
    });

    return () => unsub();
  }, [masterUid, waiterId, waiterName]);

  // Cart actions
  const addToOrder = (food) => {
    const pName = food.name || food.itemName || "Food Item";
    const pPrice = Number(food.price ?? food.salesPrice ?? 0);
    const pCost = Number(food.purchasePrice || 0);

    setOrderItems((prev) => {
      const existIndex = prev.findIndex((i) => i.id === food.id);
      if (existIndex >= 0) {
        return prev.map((item, idx) =>
          idx === existIndex ? { ...item, qty: item.qty + 1 } : item
        );
      } else {
        return [
          ...prev,
          {
            id: food.id,
            foodId: food.id,
            name: pName,
            itemName: pName,
            price: pPrice,
            salesPrice: pPrice,
            purchasePrice: pCost,
            qty: 1,
            portion: "Standard",
            notes: "",
          },
        ];
      }
    });
  };

  const decreaseQty = (id) => {
    setOrderItems((prev) => {
      const exist = prev.find((i) => i.id === id);
      if (!exist) return prev;
      if (exist.qty <= 1) {
        return prev.filter((i) => i.id !== id);
      }
      return prev.map((i) => (i.id === id ? { ...i, qty: i.qty - 1 } : i));
    });
  };

  const removeItem = (id) => {
    setOrderItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleOpenNoteModal = (index) => {
    setEditingItemNoteIndex(index);
    setItemNoteText(orderItems[index]?.notes || "");
  };

  const handleSaveItemNote = () => {
    if (editingItemNoteIndex !== null) {
      setOrderItems((prev) => {
        const next = [...prev];
        if (next[editingItemNoteIndex]) {
          next[editingItemNoteIndex].notes = itemNoteText.trim();
        }
        return next;
      });
    }
    setEditingItemNoteIndex(null);
    setItemNoteText("");
  };

  // 3. Send KOT to Kitchen
  const handleSendKotToKitchen = async () => {
    if (!masterUid) {
      alert("Store connection missing. Please log in again.");
      return;
    }
    if (orderItems.length === 0) {
      alert("Order is empty. Please select food items first.");
      return;
    }

    const isParcelOrder = isTakeaway;
    const finalTableName = isTakeaway
      ? null
      : isCustomMode
      ? customTable.trim() || "Custom Table"
      : selectedTable;

    const finalCustomer = isTakeaway
      ? takeawayCustomerName.trim() || "Walk-in Customer"
      : finalTableName;

    setIsSendingKot(true);

    try {
      const nowMs = Date.now();
      const kotNumber = `KOT-${nowMs.toString().slice(-4)}`;

      const sanitizedItems = orderItems.map((item) => ({
        foodId: String(item.id || item.foodId || ""),
        name: String(item.name || item.itemName || "Item").trim(),
        portion: String(item.portion || "Standard").trim(),
        price: Number(item.price || item.salesPrice || 0),
        purchasePrice: Number(item.purchasePrice || 0),
        qty: Math.max(1, Number(item.qty) || 1),
        notes: String(item.notes || "").trim(),
      }));

      const safeTotalAmount = sanitizedItems.reduce((acc, i) => acc + i.price * i.qty, 0);
      const safeTotalQty = sanitizedItems.reduce((acc, i) => acc + i.qty, 0);

      const kotPayload = {
        orderNumber: kotNumber,
        tableNo: isParcelOrder ? null : String(finalTableName).trim(),
        waiterId: String(waiterId),
        waiterName: String(waiterName),
        items: sanitizedItems,
        orderNotes: String(orderNotes || "").trim(),
        orderType: isParcelOrder ? "parcel" : "table",
        customerName: finalCustomer,
        status: "pending", // "pending" -> "preparing" -> "ready" -> "served" -> "completed"
        readyForBilling: false,
        totalAmount: safeTotalAmount,
        totalItems: safeTotalQty,
        masterUid: String(masterUid),
        createdAtMs: nowMs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // 1. Primary write to users/{masterUid}/kitchen_orders
      const docRef = await addDoc(collection(db, "users", masterUid, "kitchen_orders"), kotPayload);

      // 2. Also dual-write / mirror to root kitchen_orders collection
      try {
        await setDoc(doc(db, "kitchen_orders", docRef.id), {
          ...kotPayload,
          id: docRef.id,
        });
      } catch (rootErr) {
        console.warn("Root kitchen_orders mirror write notice:", rootErr);
      }

      // Reset cart
      setOrderItems([]);
      setOrderNotes("");
      setIsSendingKot(false);

      const successTableDisplay = isParcelOrder ? `PARCEL (${finalCustomer})` : finalTableName;
      alert(`✅ Order ${kotNumber} for ${successTableDisplay} sent to Kitchen successfully! 🍳\nKitchen staff has been notified.`);
      setActiveTab("live_kot");
    } catch (err) {
      console.error("Error sending KOT:", err);
      setIsSendingKot(false);
      alert("Failed to send order to kitchen: " + err.message);
    }
  };

  // 4. Waiter marks served & sends to counter for billing
  const handleMarkServed = async (orderId, tableDisplay) => {
    if (!masterUid || !orderId) return;

    try {
      const updateData = {
        status: "served",
        servedAt: serverTimestamp(),
        servedAtMs: Date.now(),
        readyForBilling: true,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, "users", masterUid, "kitchen_orders", orderId), updateData);
      try {
        await updateDoc(doc(db, "kitchen_orders", orderId), updateData);
      } catch (_) {}

      alert(`Dishes for "${tableDisplay}" marked as SERVED! ✓\nFull bill with amounts is now ready at the Counter for printing.`);
    } catch (err) {
      alert("Failed to update status: " + err.message);
    }
  };

  const filteredFoods = menuFoods.filter((f) => {
    const fName = (f.name || f.itemName || "").toLowerCase();
    const fCat = (f.category || "Main Course").toLowerCase();
    const q = search.toLowerCase();
    const matchCat = selectedCategory === "All" || fCat === selectedCategory.toLowerCase();
    const matchSearch = !q || fName.includes(q) || fCat.includes(q);
    return matchCat && matchSearch;
  });

  const totalBillAmount = orderItems.reduce((sum, i) => sum + i.price * i.qty, 0);
  const totalItemCount = orderItems.reduce((sum, i) => sum + i.qty, 0);

  const handleLogout = () => {
    if (window.confirm("Do you want to log out of Waiter Portal?")) {
      localStorage.removeItem("staff_id");
      localStorage.removeItem("staff_name");
      localStorage.removeItem("staff_role");
      localStorage.removeItem("is_staff");
      window.location.href = "/login";
    }
  };

  return (
    <div style={styles.container}>
      {/* Real-time Table-Specific Food Ready Alert Banner */}
      {waiterToast && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999999,
            backgroundColor: "#15803d",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "14px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontWeight: "800",
            fontSize: "14px",
            maxWidth: "92vw",
            boxSizing: "border-box",
          }}
        >
          <span style={{ fontSize: "20px" }}>🛎️</span>
          <span style={{ flex: 1 }}>{waiterToast.message}</span>
          <button
            type="button"
            onClick={() => {
              setWaiterToast(null);
              setActiveTab("live_kot");
            }}
            style={{
              backgroundColor: "#ffffff",
              color: "#15803d",
              border: "none",
              padding: "5px 12px",
              borderRadius: "8px",
              fontWeight: "800",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            View Orders ↗
          </button>
          <button
            type="button"
            onClick={() => setWaiterToast(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#bbf7d0",
              cursor: "pointer",
              fontSize: "18px",
              fontWeight: "800",
              padding: "0 4px",
            }}
            title="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Navbar */}
      <header style={styles.navbar}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={styles.logoBadge}>🍽️</div>
          <div>
            <h1 style={styles.brandTitle}>Waiter Order Taking Portal</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Staff:</span>
              <span style={{ fontSize: "12px", fontWeight: "800", color: "#0284c7" }}>
                {waiterName} ({waiterId})
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("take_order")}
            style={{
              ...styles.tabBtn,
              backgroundColor: activeTab === "take_order" ? "#0284c7" : "#f1f5f9",
              color: activeTab === "take_order" ? "#ffffff" : "#475569",
            }}
          >
            📋 Take Table Order
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("live_kot")}
            style={{
              ...styles.tabBtn,
              backgroundColor: activeTab === "live_kot" ? "#0284c7" : "#f1f5f9",
              color: activeTab === "live_kot" ? "#ffffff" : "#475569",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🍳 Live KOT Status</span>
            {kitchenOrders.length > 0 && (
              <span style={styles.badgeNum}>{kitchenOrders.length}</span>
            )}
          </button>
          <button type="button" onClick={handleLogout} style={styles.logoutBtn} title="Logout">
            🚪 Exit
          </button>
        </div>
      </header>

      {/* VIEW 1: TAKE TABLE ORDER */}
      {activeTab === "take_order" && (
        <div style={styles.orderLayout}>
          {/* LEFT COLUMN: Food Menu Selection */}
          <div style={styles.menuColumn}>
            {/* Table Selection Bar */}
            <div style={styles.tableSelectorBox}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "12px", fontWeight: "800", color: "#334155", textTransform: "uppercase" }}>
                  Select Table or Parcel / பார்சல்:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsTakeaway(!isTakeaway);
                    setIsCustomMode(false);
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "8px",
                    border: "1.5px solid " + (isTakeaway ? "#ea580c" : "#cbd5e1"),
                    backgroundColor: isTakeaway ? "#fff7ed" : "#ffffff",
                    color: isTakeaway ? "#ea580c" : "#475569",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  🥡 {isTakeaway ? "✓ Parcel Mode Active" : "+ Parcel / Takeaway"}
                </button>
              </div>

              {isTakeaway ? (
                <div style={{ backgroundColor: "#fff7ed", padding: "10px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
                  <label style={{ fontSize: "11px", fontWeight: "700", color: "#9a3412" }}>
                    Customer Name for Parcel (Will show in kitchen packing slip):
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Kumar / Order #1"
                    value={takeawayCustomerName}
                    onChange={(e) => setTakeawayCustomerName(e.target.value)}
                    style={{ ...styles.inputField, marginTop: "4px" }}
                    autoFocus
                  />
                </div>
              ) : (
                <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
                  {QUICK_TABLES.map((tbl) => {
                    const isSel = selectedTable === tbl && !isCustomMode;
                    const hasActiveOrder = kitchenOrders.some(
                      (o) => o.tableNo === tbl && o.status !== "completed"
                    );
                    return (
                      <button
                        key={tbl}
                        type="button"
                        onClick={() => {
                          setSelectedTable(tbl);
                          setIsCustomMode(false);
                        }}
                        style={{
                          ...styles.tablePill,
                          backgroundColor: isSel ? "#0284c7" : "#ffffff",
                          color: isSel ? "#ffffff" : "#334155",
                          borderColor: isSel ? "#0284c7" : hasActiveOrder ? "#f59e0b" : "#cbd5e1",
                          boxShadow: hasActiveOrder ? "0 0 0 2px rgba(245, 158, 11, 0.2)" : "none",
                        }}
                      >
                        <span>{tbl}</span>
                        {hasActiveOrder && (
                          <span style={{ fontSize: "9px", marginLeft: "4px" }}>🟡</span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setIsCustomMode(!isCustomMode)}
                    style={{
                      ...styles.tablePill,
                      backgroundColor: isCustomMode ? "#0284c7" : "#f1f5f9",
                      color: isCustomMode ? "#ffffff" : "#475569",
                      borderColor: isCustomMode ? "#0284c7" : "#cbd5e1",
                    }}
                  >
                    + Custom
                  </button>
                </div>
              )}

              {isCustomMode && !isTakeaway && (
                <div style={{ marginTop: "8px" }}>
                  <input
                    type="text"
                    placeholder="Enter Table Name (e.g. Table 15, Balcony 2)"
                    value={customTable}
                    onChange={(e) => setCustomTable(e.target.value)}
                    style={styles.inputField}
                    autoFocus
                  />
                </div>
              )}
            </div>

            {/* Menu Search & Category Filter */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "center" }}>
              <input
                type="text"
                placeholder="🔍 Search food menu..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...styles.inputField, flex: 1 }}
              />
            </div>

            <div style={styles.categoryScroll}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    ...styles.catPill,
                    backgroundColor: selectedCategory === cat ? "#0284c7" : "#ffffff",
                    color: selectedCategory === cat ? "#ffffff" : "#475569",
                    borderColor: selectedCategory === cat ? "#0284c7" : "#e2e8f0",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Food Items Grid */}
            {loadingMenu ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading menu foods...</div>
            ) : filteredFoods.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>No foods found</div>
            ) : (
              <div style={styles.foodGrid}>
                {filteredFoods.map((item) => {
                  const pName = item.name || item.itemName || "Food";
                  const pPrice = Number(item.price ?? item.salesPrice ?? 0);
                  const pImg = item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300";
                  const inCartItem = orderItems.find((i) => i.id === item.id);

                  return (
                    <div key={item.id} style={styles.foodCard} onClick={() => addToOrder(item)}>
                      <div style={styles.foodImgWrap}>
                        <img src={pImg} alt={pName} style={styles.foodImg} />
                        {inCartItem && <span style={styles.cartCountBadge}>{inCartItem.qty}</span>}
                      </div>
                      <div style={styles.foodInfo}>
                        <div style={styles.foodTitle} title={pName}>{pName}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                          <span style={styles.foodPrice}>₹{pPrice}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToOrder(item);
                            }}
                            style={styles.foodAddBtn}
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Table Order Ticket & KOT Action */}
          <div style={styles.cartColumn}>
            <div style={styles.cartHeader}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>
                  {isTakeaway ? "Order Type:" : "Active Table:"}
                </span>
                <h3 style={{ margin: "2px 0 0 0", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                  {isTakeaway ? `🥡 PARCEL${takeawayCustomerName ? `: ${takeawayCustomerName}` : ""}` : isCustomMode ? (customTable || "Custom Table") : selectedTable}
                </h3>
              </div>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "700" }}>
                {totalItemCount} items
              </span>
            </div>

            {/* Cart Items List */}
            <div style={styles.cartItemsScroll}>
              {orderItems.length === 0 ? (
                <div style={{ padding: "40px 10px", textAlign: "center", color: "#94a3b8" }}>
                  <span style={{ fontSize: "36px", display: "block", marginBottom: "8px" }}>🍽️</span>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>Order ticket is empty</div>
                  <p style={{ fontSize: "12px", margin: "4px 0 0 0" }}>Tap food items on the left to add to this table.</p>
                </div>
              ) : (
                orderItems.map((item, idx) => (
                  <div key={item.id} style={styles.cartItemRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                        ₹{item.price} each
                        {item.notes && <span style={{ color: "#ea580c", marginLeft: "6px" }}>• Note: {item.notes}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenNoteModal(idx)}
                        style={styles.addNoteBtn}
                      >
                        {item.notes ? "✏️ Edit Note" : "+ Cooking Note"}
                      </button>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "10px" }}>
                      <div style={styles.qtyPill}>
                        <button type="button" onClick={() => decreaseQty(item.id)} style={styles.qtyBtn}>-</button>
                        <span style={styles.qtyNum}>{item.qty}</span>
                        <button type="button" onClick={() => addToOrder(item)} style={styles.qtyBtn}>+</button>
                      </div>
                      <button type="button" onClick={() => removeItem(item.id)} style={styles.trashBtn}>
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Bottom / Send KOT */}
            <div style={styles.cartFooter}>
              <div style={{ marginBottom: "10px" }}>
                <input
                  type="text"
                  placeholder="Special instructions for kitchen (e.g. Serve together)..."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  style={{ ...styles.inputField, fontSize: "12px", padding: "8px 10px" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", color: "#334155" }}>
                  Estimated Amount (Counter Bill):
                </span>
                <span style={{ fontSize: "20px", fontWeight: "900", color: "#0284c7" }}>
                  ₹{totalBillAmount}.00
                </span>
              </div>

              <button
                type="button"
                onClick={handleSendKotToKitchen}
                disabled={orderItems.length === 0 || isSendingKot}
                style={{
                  ...styles.sendKotBtn,
                  opacity: orderItems.length === 0 || isSendingKot ? 0.6 : 1,
                  cursor: orderItems.length === 0 || isSendingKot ? "not-allowed" : "pointer",
                }}
              >
                {isSendingKot ? "Sending to Kitchen..." : "🍳 Send KOT to Kitchen (கிச்சனுக்கு அனுப்பு)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: LIVE KOT STATUS TRACKING */}
      {activeTab === "live_kot" && (
        <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                Live Table Orders & Kitchen Status
              </h2>
              <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                Track food cooking in kitchen. When dishes are served to table, click "Mark Served" so Counter gets the bill.
              </p>
            </div>
          </div>

          {kitchenOrders.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center", backgroundColor: "#ffffff", borderRadius: "16px", border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: "40px", display: "block", marginBottom: "8px" }}>🍳</span>
              <div style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>No pending kitchen orders!</div>
              <p style={{ fontSize: "13px", color: "#64748b" }}>All tables have been served and billed.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "14px" }}>
              {kitchenOrders.map((order) => {
                const classification = getOrderClassification(order);
                const isParcel = classification.isParcel;
                const isReady = order.status === "ready";
                const isServed = order.status === "served";
                const isPreparing = order.status === "preparing";

                return (
                  <div
                    key={order.id}
                    style={{
                      ...styles.kotLiveCard,
                      borderColor: isReady ? "#16a34a" : isServed ? "#0284c7" : isParcel ? "#ea580c" : isPreparing ? "#ea580c" : "#f59e0b",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <h4 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                            {isParcel ? "🥡 PARCEL" : classification.isTable ? `🍽️ ${classification.tableNo}` : "⚡ COUNTER"}
                            {classification.customerName && classification.customerName !== classification.tableNo && (
                              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "700", marginLeft: "6px" }}>
                                ({classification.customerName})
                              </span>
                            )}
                          </h4>
                          <span
                            style={{
                              ...styles.statusTag,
                              backgroundColor: isReady ? "#dcfce7" : isServed ? "#e0f2fe" : isPreparing ? "#ffedd5" : "#fef3c7",
                              color: isReady ? "#15803d" : isServed ? "#0369a1" : isPreparing ? "#c2410c" : "#b45309",
                            }}
                          >
                            {order.status?.toUpperCase() || "PENDING"}
                          </span>
                        </div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          KOT #: {order.orderNumber} • Waiter: {order.waiterName}
                        </div>
                      </div>

                      <div style={{ textAlign: "right", fontSize: "11px", color: "#64748b" }}>
                        {order.createdAtMs ? new Date(order.createdAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recently"}
                      </div>
                    </div>

                    {/* Items List */}
                    <div style={{ backgroundColor: "#f8fafc", borderRadius: "10px", padding: "10px", margin: "8px 0" }}>
                      {(order.items || []).map((itm, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "3px 0" }}>
                          <span style={{ fontWeight: "700", color: "#1e293b" }}>
                            {itm.name} {itm.notes ? <span style={{ color: "#ea580c", fontSize: "11px" }}>({itm.notes})</span> : ""}
                          </span>
                          <span style={{ fontWeight: "800", color: "#0284c7" }}>x{itm.qty}</span>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                      {!isServed ? (
                        <button
                          type="button"
                          onClick={() => handleMarkServed(order.id, isParcel ? `PARCEL (${classification.customerName})` : (classification.tableNo || "Order"))}
                          style={{
                            ...styles.serveBtn,
                            backgroundColor: isReady ? "#16a34a" : "#0284c7",
                          }}
                        >
                          {isReady ? "✓ Deliver & Send Bill to Counter" : "✓ Mark Served & Ready for Bill"}
                        </button>
                      ) : (
                        <div style={{ width: "100%", padding: "8px", backgroundColor: "#e0f2fe", borderRadius: "8px", color: "#0369a1", fontSize: "12px", fontWeight: "700", textAlign: "center" }}>
                          🔔 Served! Bill is awaiting checkout at the Counter.
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

      {/* ITEM NOTE MODAL */}
      {editingItemNoteIndex !== null && (
        <div style={styles.modalOverlay} onClick={() => setEditingItemNoteIndex(null)}>
          <div style={styles.noteModalBox} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>
              Cooking Note for "{orderItems[editingItemNoteIndex]?.name}"
            </h4>
            <input
              type="text"
              placeholder="e.g. Extra spicy, No onion, Less oil..."
              value={itemNoteText}
              onChange={(e) => setItemNoteText(e.target.value)}
              style={styles.inputField}
              autoFocus
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
              <button
                type="button"
                onClick={() => setEditingItemNoteIndex(null)}
                style={styles.cancelTinyBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveItemNote}
                style={styles.saveTinyBtn}
              >
                Save Note
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
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    maxHeight: "100vh",
    backgroundColor: "#f8fafc",
    fontFamily: "system-ui, sans-serif",
    overflow: "hidden",
  },
  navbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 20px",
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    flexShrink: 0,
  },
  logoBadge: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    backgroundColor: "#e0f2fe",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
  },
  brandTitle: {
    fontSize: "16px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0,
  },
  tabBtn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  badgeNum: {
    backgroundColor: "#ef4444",
    color: "#fff",
    borderRadius: "10px",
    padding: "1px 6px",
    fontSize: "11px",
    fontWeight: "800",
  },
  logoutBtn: {
    padding: "8px 12px",
    backgroundColor: "#fee2e2",
    color: "#dc2626",
    border: "none",
    borderRadius: "8px",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },

  orderLayout: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    minHeight: 0,
  },
  menuColumn: {
    flex: 1,
    padding: "16px 20px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  cartColumn: {
    width: "380px",
    backgroundColor: "#ffffff",
    borderLeft: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    height: "100%",
  },

  tableSelectorBox: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "12px 14px",
    border: "1px solid #e2e8f0",
    marginBottom: "12px",
  },
  tablePill: {
    padding: "6px 12px",
    borderRadius: "20px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
  },
  inputField: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    boxSizing: "border-box",
    outline: "none",
  },

  categoryScroll: {
    display: "flex",
    gap: "8px",
    overflowX: "auto",
    paddingBottom: "8px",
    marginBottom: "12px",
    flexShrink: 0,
  },
  catPill: {
    padding: "6px 14px",
    borderRadius: "20px",
    border: "1.5px solid #e2e8f0",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  foodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: "12px",
    paddingBottom: "20px",
  },
  foodCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #f1f5f9",
    overflow: "hidden",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
    display: "flex",
    flexDirection: "column",
    transition: "transform 0.1s ease",
  },
  foodImgWrap: {
    position: "relative",
    width: "100%",
    height: "105px",
    backgroundColor: "#f1f5f9",
  },
  foodImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  cartCountBadge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    backgroundColor: "#0284c7",
    color: "#fff",
    borderRadius: "12px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: "800",
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
  },
  foodInfo: {
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    justifyContent: "space-between",
  },
  foodTitle: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#0f172a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  foodPrice: {
    fontSize: "13px",
    fontWeight: "800",
    color: "#ea580c",
  },
  foodAddBtn: {
    padding: "4px 8px",
    borderRadius: "6px",
    backgroundColor: "#e0f2fe",
    color: "#0369a1",
    border: "none",
    fontSize: "11px",
    fontWeight: "700",
    cursor: "pointer",
  },

  cartHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #f1f5f9",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cartItemsScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "14px 18px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  cartItemRow: {
    backgroundColor: "#f8fafc",
    borderRadius: "10px",
    padding: "10px 12px",
    border: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qtyPill: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "16px",
    padding: "2px 6px",
  },
  qtyBtn: {
    background: "transparent",
    border: "none",
    color: "#0284c7",
    fontWeight: "800",
    fontSize: "14px",
    cursor: "pointer",
    padding: "0 4px",
  },
  qtyNum: {
    fontSize: "12px",
    fontWeight: "800",
    color: "#0f172a",
    minWidth: "18px",
    textAlign: "center",
  },
  trashBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "14px",
    padding: "0 2px",
  },
  addNoteBtn: {
    background: "transparent",
    border: "none",
    color: "#0284c7",
    fontSize: "10.5px",
    fontWeight: "700",
    cursor: "pointer",
    padding: 0,
    marginTop: "2px",
    display: "inline-block",
  },

  cartFooter: {
    padding: "16px 20px 20px",
    borderTop: "1px solid #e2e8f0",
    backgroundColor: "#ffffff",
  },
  sendKotBtn: {
    width: "100%",
    padding: "14px",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "12px",
    fontWeight: "800",
    fontSize: "14px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(22, 163, 74, 0.25)",
  },

  kotLiveCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "14px",
    border: "2px solid #e2e8f0",
    boxShadow: "0 3px 8px rgba(0,0,0,0.04)",
  },
  statusTag: {
    fontSize: "10.5px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "10px",
  },
  serveBtn: {
    width: "100%",
    padding: "10px",
    borderRadius: "8px",
    border: "none",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
  },

  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 99999,
    padding: "16px",
    boxSizing: "border-box",
  },
  noteModalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    padding: "20px",
    width: "100%",
    maxWidth: "400px",
    boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
  },
  cancelTinyBtn: {
    padding: "6px 14px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "12px",
    cursor: "pointer",
  },
  saveTinyBtn: {
    padding: "6px 16px",
    backgroundColor: "#0284c7",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
};
