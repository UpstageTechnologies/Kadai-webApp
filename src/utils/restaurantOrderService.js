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
 * toneType: "foodReady" (chime for ready food) | "orderServed" (chime for served bill at counter)
 */
export function playNotificationSound(toneType = "foodReady") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (toneType === "orderServed") {
      // Ascending double chime for counter bill arrival (C5 -> G5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } else {
      // Pleasant Bell chime for food ready (E5 -> B5)
      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(987.77, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch (_) {}
}
