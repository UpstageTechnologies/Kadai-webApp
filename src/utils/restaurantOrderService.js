/**
 * Restaurant POS Order Classification & Notification Utilities
 * Handles table, parcel, and counter orders consistently across all screens
 * and ensures backward compatibility with legacy orders.
 */

export const ORDER_TYPES = {
  TABLE: "table",
  PARCEL: "parcel",
  COUNTER: "counter",
};

/**
 * Classifies an order into Table, Parcel, or Counter order.
 * Backward compatible with legacy orders where tableNo had "🥡 PARCEL: rahul" or "Counter Table (Walk-in)".
 */
export function getOrderClassification(order) {
  if (!order) {
    return {
      type: ORDER_TYPES.COUNTER,
      isTable: false,
      isParcel: false,
      isCounter: true,
      tableNo: null,
      displayLabel: "",
      customerName: "Walk-in Customer",
    };
  }

  const rawOrderType = String(order.orderType || "").toLowerCase().trim();
  const rawTable = String(order.tableNo || "").trim();

  // 1. Parcel Check (explicit orderType === "parcel" OR tableNo containing "parcel" / "takeaway")
  if (
    rawOrderType === "parcel" ||
    rawOrderType === "takeaway" ||
    rawTable.toLowerCase().includes("parcel") ||
    rawTable.toLowerCase().includes("takeaway")
  ) {
    // Clean customer name if legacy tableNo had "🥡 PARCEL: rahul"
    let custName = (order.customerName || "").trim();
    if (!custName && rawTable.toLowerCase().includes("parcel")) {
      custName = rawTable.replace(/^[^\w]*parcel[:\s-]*/i, "").trim();
    }
    return {
      type: ORDER_TYPES.PARCEL,
      isTable: false,
      isParcel: true,
      isCounter: false,
      tableNo: null,
      displayLabel: "PARCEL",
      customerName: custName || "Takeaway",
    };
  }

  // 2. Fake / Null Table Check
  const isFakeTable =
    !rawTable ||
    rawTable.toLowerCase() === "null" ||
    rawTable.toLowerCase() === "undefined" ||
    rawTable.toLowerCase().includes("counter table") ||
    rawTable.toLowerCase() === "walk-in" ||
    rawTable.toLowerCase() === "walk-in customer" ||
    rawTable.toLowerCase() === "direct bill";

  // 3. Table Order Check
  if (!isFakeTable && (rawOrderType === "table" || rawOrderType === "dine-in" || !rawOrderType)) {
    return {
      type: ORDER_TYPES.TABLE,
      isTable: true,
      isParcel: false,
      isCounter: false,
      tableNo: rawTable,
      displayLabel: rawTable, // e.g. "Table 05"
      customerName: (order.customerName || rawTable).trim(),
    };
  }

  // 4. Counter Order Without Table (Coffee shop, retail walk-in, quick cashier billing)
  return {
    type: ORDER_TYPES.COUNTER,
    isTable: false,
    isParcel: false,
    isCounter: true,
    tableNo: null,
    displayLabel: "", // No table / parcel label
    customerName: (order.customerName || "Walk-in Customer").trim(),
  };
}

/**
 * Web Audio API chime player
 * toneType: "foodReady" | "orderServed" | "onlineOrder" | "orderDelivered"
 */
export function playNotificationSound(toneType = "foodReady") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (toneType === "onlineOrder") {
      // Vibrant double chime for incoming online order (C5 -> E5 -> G5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.7);
    } else if (toneType === "orderDelivered") {
      // Pleasant success tone for completed/finished delivery (D5 -> A5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880.00, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.45, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } else if (toneType === "orderServed") {
      // Ascending double chime for counter bill arrival (C5 -> G5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.45, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } else if (toneType === "paymentSuccess") {
      // POS Payment Success Cash Register Chord (C5 -> E5 -> G5 -> C6)
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
      osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } else {
      // Pleasant Bell chime for food ready (E5 -> B5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(987.77, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.45, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch (err) {
    console.warn("Audio chime error:", err);
  }
}

/**
 * Calculates the next daily sequential token number (1, 2, 3...)
 * Resets each day. Uses sales, kitchen orders, and localStorage cache.
 */
export function getNextDailyTokenNumber({ ordersList = [], kitchenOrders = [], uid = "" } = {}) {
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  const isToday = (timestamp) => {
    if (!timestamp) return false;
    let d;
    if (typeof timestamp.toDate === "function") d = timestamp.toDate();
    else if (timestamp.seconds) d = new Date(timestamp.seconds * 1000);
    else if (typeof timestamp === "number") d = new Date(timestamp);
    else d = new Date(timestamp);
    return (
      d.getFullYear() === todayYear &&
      d.getMonth() === todayMonth &&
      d.getDate() === todayDate
    );
  };

  let maxToken = 0;

  // Scan sales list for today's orders
  if (Array.isArray(ordersList)) {
    for (const o of ordersList) {
      const oTime = o.createdAt || o.billedAtMs || o.timestamp;
      if (isToday(oTime)) {
        const tok = Number(o.tokenNumber || o.tokenNo);
        if (!isNaN(tok) && tok > maxToken) {
          maxToken = tok;
        }
      }
    }
  }

  // Scan kitchen orders for today's orders
  if (Array.isArray(kitchenOrders)) {
    for (const ko of kitchenOrders) {
      const koTime = ko.createdAtMs || ko.createdAt;
      if (isToday(koTime)) {
        const tok = Number(ko.tokenNumber || ko.tokenNo);
        if (!isNaN(tok) && tok > maxToken) {
          maxToken = tok;
        }
      }
    }
  }

  // Check local cache for current day
  const dateKey = `${todayYear}-${String(todayMonth + 1).padStart(2, "0")}-${String(todayDate).padStart(2, "0")}`;
  const cacheKey = `daily_token_${dateKey}_${uid || "default"}`;
  try {
    const cachedVal = parseInt(localStorage.getItem(cacheKey) || "0", 10);
    if (!isNaN(cachedVal) && cachedVal > maxToken) {
      maxToken = cachedVal;
    }
  } catch (_) {}

  const nextToken = maxToken + 1;
  try {
    localStorage.setItem(cacheKey, String(nextToken));
  } catch (_) {}

  return nextToken;
}

/**
 * Helper to build WhatsApp Message URL for Customer E-Bill / Digital Receipt
 */
export function getWhatsAppEBillUrl(order, storeProfile = {}) {
  if (!order) return null;
  const rawPhone = order.customerPhone || "";
  const cleanPhone = String(rawPhone).replace(/\D/g, "");
  if (!cleanPhone || cleanPhone.length < 10) return null;

  const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  const storeName = storeProfile.storeName || storeProfile.name || storeProfile.shopName || "Our Store";
  const storeAddress = storeProfile.address || "";
  const storePhone = storeProfile.phone || "";
  const billNo = order.billNo || order.invoiceId || (order.id ? "#" + String(order.id).slice(-6).toUpperCase() : "BILL");
  const tokenNo = order.tokenNumber || order.tokenNo ? `#${order.tokenNumber || order.tokenNo}` : "";
  
  let dateStr = "";
  if (order.createdAt?.toDate) {
    dateStr = order.createdAt.toDate().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } else if (order.createdAt) {
    dateStr = new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } else {
    dateStr = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }

  const items = (order.items || []).map((item, idx) => {
    const name = item.name || item.itemName || "Item";
    const portion = item.portion && item.portion !== "Standard" ? ` (${item.portion})` : "";
    const qty = Number(item.qty || 1);
    const price = Number(item.price || item.salesPrice || 0);
    const total = qty * price;
    return `${idx + 1}. *${name}${portion}*\n   ${qty} × ₹${price.toFixed(2)} = ₹${total.toFixed(2)}`;
  }).join("\n");

  const totalAmount = Number(order.totalAmount || order.total || 0).toFixed(2);
  const paymentMode = (order.paymentMethod || order.paymentMode || "Cash").toUpperCase();
  const customerName = order.customerName && order.customerName !== "Walk-in Customer" ? order.customerName : "";

  const lines = [
    `🧾 *${storeName.toUpperCase()} - E-RECEIPT* 🧾`,
    `--------------------------------`,
    tokenNo ? `🎟️ *TOKEN NUMBER:* *${tokenNo}*` : null,
    `📄 *Bill No:* #${billNo}`,
    `📅 *Date:* ${dateStr}`,
    customerName ? `👤 *Customer:* ${customerName}` : null,
    `💳 *Payment:* ${paymentMode} (PAID ✅)`,
    `--------------------------------`,
    `*ORDER ITEMS:*`,
    items || "• Food & Beverage Items",
    `--------------------------------`,
    `*Grand Total:* *₹${totalAmount}*`,
    `--------------------------------`,
    `Thank you for visiting *${storeName}*! Please visit again! 🙏`,
    storeAddress ? `📍 ${storeAddress}` : null,
    storePhone ? `📞 Contact: ${storePhone}` : null,
  ].filter(Boolean);

  const message = lines.join("\n");
  return `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
}

/**
 * Dispatches an Owner Notification across both:
 * 1. Web Desktop Notification API (Browser push popup)
 * 2. Firestore Collection (users/{uid}/owner_notifications)
 */
export async function notifyOwner({
  db,
  uid,
  type = "sale", // "sale" | "online_order"
  title,
  body,
  data = {},
}) {
  const currentUid = uid || (typeof localStorage !== "undefined" ? localStorage.getItem("uid") : "");

  // 1. Browser Native Desktop Notification
  try {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "/vite.svg",
          tag: `${type}_${data.id || data.billNo || Date.now()}`,
          renotify: true,
        });
      }
    }
  } catch (e) {
    console.warn("Desktop notification notice:", e);
  }

  // 2. Persistent Firestore Log in users/{uid}/owner_notifications
  if (db && currentUid) {
    try {
      const { collection, addDoc, serverTimestamp } = await import("firebase/firestore");
      await addDoc(collection(db, "users", currentUid, "owner_notifications"), {
        type,
        title,
        body,
        data,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now(),
        read: false,
      });
    } catch (err) {
      console.warn("Firestore owner_notifications write notice:", err);
    }
  }
}


