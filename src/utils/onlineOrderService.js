import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { auth } from "./firebase";
import { deductRecipeStock } from "./recipeStockService";
import { recordOrderCustomerFallback } from "./customerCrmService";

export const asArray = (value) => (Array.isArray(value) ? value : []);
export const asText = (value) => (value == null ? "" : String(value));

export const ONLINE_ORDER_TABS = ["All", "New", "Hold", "Completed", "Rejected"];

/**
 * Robustly resolves the store owner / master UID with fallbacks across auth, localStorage, and order metadata
 */
export function resolveSellerUid(uid, order) {
  const candidate =
    uid ||
    auth?.currentUser?.uid ||
    (typeof localStorage !== "undefined" ? localStorage.getItem("uid") : "") ||
    order?.shopId ||
    order?.sellerUid ||
    order?.masterUid ||
    order?.userId ||
    "";
  return String(candidate || "").trim();
}

/**
 * Robustly resolves order document ID from various order shapes
 */
export function resolveOrderDocId(order) {
  if (!order) return "";
  const candidate = order.id || order.orderDocId || order.orderId || order._id || "";
  return String(candidate || "").trim();
}

/**
 * Calculates delivery progress percentage
 */
export function getOnlineOrderProgress(status) {
  const s = asText(status).toLowerCase();
  switch (s) {
    case "pending verification":
      return 20;
    case "accepted":
      return 40;
    case "packed":
      return 60;
    case "pending":
      return 50;
    case "out for delivery":
      return 85;
    case "delivered":
      return 100;
    default:
      return 0;
  }
}

/**
 * Visual badge colors matching existing app theme
 */
export function getOnlineOrderStatusColors(status) {
  const s = asText(status).toLowerCase();
  switch (s) {
    case "delivered":
      return { bg: "#dcfce7", color: "#15803d", border: "#86efac", label: "Delivered" };
    case "pending verification":
      return { bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc", label: "Pending Verification" };
    case "accepted":
      return { bg: "#ffedd5", color: "#c2410c", border: "#fdba74", label: "Accepted" };
    case "packed":
      return { bg: "#f3e8ff", color: "#7e22ce", border: "#d8b4fe", label: "Packed" };
    case "out for delivery":
      return { bg: "#ede9fe", color: "#4f46e5", border: "#c4b5fd", label: "Out For Delivery" };
    case "pending":
      return { bg: "#fef3c7", color: "#b45309", border: "#fde68a", label: "On Hold" };
    case "rejected":
      return { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5", label: "Rejected" };
    default:
      return { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1", label: status || "Unknown" };
  }
}

/**
 * Determine the next logical status in standard lifecycle
 */
export function getNextOnlineOrderStatus(currentStatus, lastStatus) {
  const status = currentStatus === "Pending" ? lastStatus : currentStatus;
  switch (status) {
    case "Pending Verification":
      return "Accepted";
    case "Accepted":
      return "Packed";
    case "Packed":
      return "Out For Delivery";
    case "Out For Delivery":
      return "Delivered";
    default:
      return null;
  }
}

/**
 * Computes order total considering multi-vendor or legacy payloads
 */
export function computeOrderTotal(order, uid) {
  const sellerUid = resolveSellerUid(uid, order);
  let displayItems = asArray(order?.items);
  if (!displayItems.length && Array.isArray(order?.orderedShops)) {
    const myShop = order.orderedShops.find((s) => s?.shopId === sellerUid);
    if (myShop) displayItems = myShop.items || [];
  }
  displayItems = asArray(displayItems);

  if (order?.totalAmount != null && !isNaN(Number(order.totalAmount))) {
    return Number(order.totalAmount);
  }
  if (order?.total != null && !isNaN(Number(order.total))) {
    return Number(order.total);
  }
  return displayItems.reduce((sum, p) => sum + (Number(p?.price) || 0) * (Number(p?.qty) || 1), 0);
}

/**
 * Filter online orders by Tab, Search query, and Mode
 */
export function filterOnlineOrders(orders, activeTab, searchQuery, modeFilter, isGlobalMode, uid) {
  return orders.filter((item) => {
    // 1. Filter out walk-in customers to strictly keep online customer orders
    const custName = asText(item.customerName).toLowerCase().trim();
    const orderType = asText(item.orderType || item.type).toLowerCase().trim();
    if (
      custName.includes("walk-in") ||
      custName === "walk in customer" ||
      orderType.includes("walk-in") ||
      item.isWalkIn === true
    ) {
      return false;
    }

    // 2. Mode Filter (Local vs Global)
    const isOrdGlobal = Boolean(item.isGlobalMode || item.appMode === "global");
    if (modeFilter === "current") {
      if (isGlobalMode ? !isOrdGlobal : isOrdGlobal) return false;
    } else if (modeFilter === "local") {
      if (isOrdGlobal) return false;
    } else if (modeFilter === "global") {
      if (!isOrdGlobal) return false;
    }

    // 3. Status Tab Filter
    const currentStatus = asText(item.status || "Pending Verification").trim();
    const lowerStatus = currentStatus.toLowerCase();

    if (activeTab === "New") {
      const isNew = ["pending verification", "accepted", "packed", "out for delivery"].includes(lowerStatus);
      if (!isNew) return false;
    } else if (activeTab === "Hold") {
      if (lowerStatus !== "pending") return false;
    } else if (activeTab === "Completed") {
      if (lowerStatus !== "delivered") return false;
    } else if (activeTab === "Rejected") {
      if (lowerStatus !== "rejected") return false;
    }

    // 4. Search Filter
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const idMatch = asText(item.orderId || item.id).toLowerCase().includes(q);
      const nameMatch = asText(item.customerName).toLowerCase().includes(q);
      const phoneMatch = asText(item.customerPhone).includes(q);
      const itemMatch = asArray(item.items).some((prod) =>
        asText(prod?.itemName || prod?.name).toLowerCase().includes(q)
      );
      if (!idMatch && !nameMatch && !phoneMatch && !itemMatch) return false;
    }

    return true;
  });
}

/**
 * Update Online Order Status with Two-Way Synchronization:
 * When status is "Delivered", it finalizes the order in shop orders, customer orders,
 * delivery orders, deducts inventory, and records sale entry in sales collection.
 */
export async function updateOnlineOrderStatus({
  db,
  uid,
  order,
  newStatus,
  mode = "local",
  shopProfile = {},
}) {
  const sellerUid = resolveSellerUid(uid, order);
  const orderId = resolveOrderDocId(order);
  if (!sellerUid) throw new Error("Store session ID missing. Please refresh or re-login.");
  if (!orderId) throw new Error("Order document ID missing for this order.");

  const customerUid = order.customerUid || order.customerId || order.userId || "";
  const subCol = mode === "global" || order.isGlobalMode ? "global_orders" : "local_orders";

  const statusUpdatePayload = {
    status: newStatus,
    updatedAt: serverTimestamp(),
  };

  if (newStatus === "Delivered") {
    statusUpdatePayload.deliveredAt = serverTimestamp();
    statusUpdatePayload.deliveryStatus = "delivered";
  }

  // 1. Update shop order in local_orders or global_orders (with fallback to orders)
  try {
    await updateDoc(doc(db, "users", sellerUid, subCol, orderId), statusUpdatePayload);
  } catch {
    await updateDoc(doc(db, "users", sellerUid, "orders", orderId), statusUpdatePayload);
  }

  // 2. If delivered, update delivery_orders tasks (for delivery boy app)
  if (newStatus === "Delivered") {
    try {
      await updateDoc(doc(db, "delivery_orders", orderId), {
        status: "delivered",
        deliveredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (_) {}

    try {
      await updateDoc(doc(db, "users", sellerUid, "delivery_orders", orderId), {
        status: "delivered",
        deliveredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (_) {}
  }

  // 3. Update customer order document and push customer notification
  if (customerUid) {
    try {
      const customerRef = doc(db, "customers", customerUid, "orders", orderId);
      const snap = await getDoc(customerRef);
      if (snap.exists()) {
        const data = snap.data();
        const updatedShops = asArray(data.orderedShops).map((shop) => {
          if (shop.shopId === sellerUid) {
            return { ...shop, status: newStatus };
          }
          return shop;
        });
        await updateDoc(customerRef, {
          status: newStatus,
          orderedShops: updatedShops,
          updatedAt: serverTimestamp(),
        });
      }

      if (newStatus === "Delivered") {
        await addDoc(collection(db, "customers", customerUid, "notifications"), {
          title: "🎉 Order Delivered!",
          message: `Your order #${order.orderId || orderId} from ${shopProfile.name || "our store"} has been delivered. Thank you!`,
          orderId: orderId,
          type: "order_delivered",
          createdAt: serverTimestamp(),
        });
      }
    } catch (custErr) {
      console.warn("Notice updating customer order doc:", custErr?.message);
    }
  }

  // 4. If status is "Delivered", deduct inventory and record completed sale (matching mobile app)
  if (newStatus === "Delivered") {
    try {
      let orderedItems = asArray(order.items);
      if (!orderedItems.length && Array.isArray(order.orderedShops)) {
        const myShop = order.orderedShops.find((s) => s?.shopId === sellerUid);
        if (myShop) orderedItems = myShop.items || [];
      }

      // Deduct raw material recipe ingredients for completed online food orders
      try {
        deductRecipeStock(sellerUid, orderedItems);
      } catch (_) {}

      let localItems = [];
      let globalItems = [];
      let localTotal = 0;
      let globalTotal = 0;
      let localProfit = 0;
      let globalProfit = 0;
      const isOrderGlobal = Boolean(order.isGlobalMode || mode === "global");

      for (const prod of orderedItems) {
        const currentItemName = prod.itemName || prod.name || "";
        const currentBarcode = prod.barcode || "";
        const orderedQty = Number(prod.qty || prod.quantity || 1);
        let itemFound = false;

        const invCollectionName = isOrderGlobal ? "global_inventory" : "inventory";

        let invSnap = { empty: true };
        if (currentBarcode) {
          invSnap = await getDocs(
            query(collection(db, "users", sellerUid, invCollectionName), where("barcode", "==", currentBarcode))
          );
        }
        if (invSnap.empty && currentItemName) {
          invSnap = await getDocs(
            query(collection(db, "users", sellerUid, invCollectionName), where("itemName", "==", currentItemName))
          );
        }

        if (!invSnap.empty) {
          itemFound = true;
          const invDocRef = invSnap.docs[0].ref;
          const currentQty = invSnap.docs[0].data().quantity || 0;
          await updateDoc(invDocRef, {
            quantity: Math.max(0, currentQty - orderedQty),
          });
          const itemData = invSnap.docs[0].data();
          const pPrice = Number(itemData.purchasePrice || 0);
          const sPrice = Number(prod.price || itemData.salesPrice || prod.salesPrice || 0);

          if (isOrderGlobal) {
            globalItems.push({ ...prod, itemName: itemData.itemName || currentItemName, price: sPrice, purchasePrice: pPrice });
            globalTotal += sPrice * orderedQty;
            globalProfit += (sPrice - pPrice) * orderedQty;
          } else {
            localItems.push({ ...prod, itemName: itemData.itemName || currentItemName, price: sPrice, purchasePrice: pPrice });
            localTotal += sPrice * orderedQty;
            localProfit += (sPrice - pPrice) * orderedQty;
          }
        } else {
          const fallbackPrice = Number(prod.price || prod.salesPrice || 0);
          if (isOrderGlobal) {
            globalItems.push({ ...prod, itemName: currentItemName, price: fallbackPrice, purchasePrice: fallbackPrice * 0.8 });
            globalTotal += fallbackPrice * orderedQty;
            globalProfit += fallbackPrice * 0.2 * orderedQty;
          } else {
            localItems.push({ ...prod, itemName: currentItemName, price: fallbackPrice, purchasePrice: fallbackPrice * 0.8 });
            localTotal += fallbackPrice * orderedQty;
            localProfit += fallbackPrice * 0.2 * orderedQty;
          }
        }
      }

      const bNo = order.orderId || order.billNo || order.invoiceId || `ONL-${orderId.slice(-6).toUpperCase()}`;
      const bDate = new Date().toLocaleDateString("en-GB");

      if (localItems.length > 0) {
        await addDoc(collection(db, "users", sellerUid, "sales"), {
          billNo: bNo,
          invoiceId: bNo,
          billDate: bDate,
          customerName: order.customerName || "Online Customer",
          customerPhone: order.customerPhone || "",
          deliveryAddress: order.deliveryAddress || "",
          items: localItems,
          total: localTotal,
          profit: localProfit,
          paymentMode: order.paymentMode || "ONLINE",
          orderType: "ONLINE",
          isGlobalMode: false,
          onlineOrderId: orderId,
          createdAt: serverTimestamp(),
        });
      }

      if (globalItems.length > 0) {
        await addDoc(collection(db, "users", sellerUid, "sales"), {
          billNo: bNo,
          invoiceId: bNo,
          billDate: bDate,
          customerName: order.customerName || "Online Customer",
          customerPhone: order.customerPhone || "",
          deliveryAddress: order.deliveryAddress || "",
          items: globalItems,
          total: globalTotal,
          profit: globalProfit,
          paymentMode: order.paymentMode || "ONLINE",
          orderType: "ONLINE",
          isGlobalMode: true,
          onlineOrderId: orderId,
          createdAt: serverTimestamp(),
        });
      }

      // Ensure online customer appears in Customer Management CRM directory
      try {
        await recordOrderCustomerFallback({
          shopId: sellerUid,
          order: {
            ...order,
            totalAmount: localTotal + globalTotal || computeOrderTotal(order, sellerUid),
          },
          source: "website",
          billNo: bNo,
        });
      } catch (crmErr) {
        console.warn("Online order customer CRM notice:", crmErr?.message);
      }
    } catch (invErr) {
      console.warn("Notice updating inventory / sales on delivery:", invErr?.message);
    }
  }

  return { success: true };
}

/**
 * Assign Order to Delivery Boy & Create Delivery Task for Delivery App
 */
export async function assignDeliveryBoyToOnlineOrder({
  db,
  uid,
  order,
  selectedStaff,
  customName,
  customPhone,
  deliveryStaffList = [],
  shopProfile = {},
  mode = "local",
}) {
  const sellerUid = resolveSellerUid(uid, order);
  const orderId = resolveOrderDocId(order);
  if (!sellerUid) throw new Error("Store session ID missing. Please refresh or re-login.");
  if (!orderId) throw new Error("Order document ID missing for this order.");

  let finalStaffName = selectedStaff?.name || (customName || "").trim();
  let finalStaffPhone = selectedStaff?.mobile || (customPhone || "").trim();
  let finalStaffId = selectedStaff?.staffId || selectedStaff?.id || "";

  if (!finalStaffName) {
    throw new Error("Please select or enter the Delivery Boy's name.");
  }

  // Auto-register custom delivery staff if new
  if (!selectedStaff && finalStaffPhone) {
    const cleanCustomPhone = finalStaffPhone.replace(/\D/g, "");
    const existingStaff = deliveryStaffList.find(
      (s) => (s.mobile || "").replace(/\D/g, "") === cleanCustomPhone
    );

    if (existingStaff) {
      finalStaffId = existingStaff.staffId || existingStaff.id;
      finalStaffName = existingStaff.name || finalStaffName;
    } else {
      const currentYear = new Date().getFullYear();
      finalStaffId = `${currentYear}DEL${Date.now().toString().slice(-4)}`;
      const autoPass = cleanCustomPhone.length >= 6 ? cleanCustomPhone.slice(-6) : "del12345";
      const newStaffPayload = {
        staffId: finalStaffId,
        name: finalStaffName,
        mobile: finalStaffPhone,
        password: autoPass,
        role: "delivery",
        masterUid: sellerUid,
        createdAt: serverTimestamp(),
      };

      try {
        await setDoc(doc(db, "users", sellerUid, "staffs", finalStaffId), newStaffPayload);
        await setDoc(doc(db, "staffs", finalStaffId), newStaffPayload);
      } catch (regErr) {
        console.warn("Staff auto-registration notice:", regErr?.message);
      }
    }
  }

  if (!finalStaffId) {
    finalStaffId = `DEL-${Date.now().toString().slice(-4)}`;
  }

  const displayItems = asArray(order.items);
  const orderTotal = computeOrderTotal(order, sellerUid);
  const customerId = asText(order.customerUid || order.customerId || order.userId || "");

  const deliveryTask = {
    id: orderId,
    orderId: String(order.orderId || orderId),
    orderDocId: orderId,
    shopId: sellerUid,
    shopName: shopProfile.name || "My Store",
    shopAddress: shopProfile.address || "",
    shopPhone: shopProfile.phone || "",
    customerName: asText(order.customerName || "Customer"),
    customerPhone: asText(order.customerPhone || ""),
    customerUid: customerId,
    deliveryAddress: asText(order.deliveryAddress || "Address not provided"),
    items: displayItems,
    totalAmount: orderTotal,
    paymentMode: order.paymentMode || "COD",
    assignedStaffId: finalStaffId,
    assignedStaffName: finalStaffName,
    assignedStaffPhone: finalStaffPhone,
    assignedDeliveryAuthUid: selectedStaff?.authUid || "",
    status: "assigned",
    orderMode: mode || (order.isGlobalMode ? "global" : "local"),
    assignedAt: serverTimestamp(),
    createdAt: order.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // 1. Write task into global delivery_orders (listened by Delivery App)
  await setDoc(doc(db, "delivery_orders", orderId), deliveryTask, { merge: true });

  // 2. Write copy under shop's delivery_orders
  await setDoc(doc(db, "users", sellerUid, "delivery_orders", orderId), deliveryTask, { merge: true });

  // 3. Update order in POS shop collection (local_orders or global_orders)
  const subCol = mode === "global" || order.isGlobalMode ? "global_orders" : "local_orders";
  const posUpdate = {
    status: "Out For Delivery",
    deliveryStatus: "assigned",
    assignedDeliveryBoyId: finalStaffId,
    assignedDeliveryBoyName: finalStaffName,
    assignedDeliveryBoyPhone: finalStaffPhone,
    dispatchedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, "users", sellerUid, subCol, orderId), posUpdate);
  } catch {
    await updateDoc(doc(db, "users", sellerUid, "orders", orderId), posUpdate);
  }

  // 4. Update customer doc
  if (customerId) {
    try {
      await updateDoc(doc(db, "customers", customerId, "orders", orderId), {
        status: "Out For Delivery",
        deliveryStatus: "assigned",
        deliveryBoyName: finalStaffName,
        deliveryBoyPhone: finalStaffPhone,
        updatedAt: serverTimestamp(),
      });
    } catch (_) {}
  }

  return { finalStaffName, finalStaffPhone, finalStaffId };
}

/**
 * Mark order as Packed & Send In-App notification to customer for store pickup
 */
export async function markOnlineOrderPackedAndNotify({
  db,
  uid,
  order,
  shopProfile = {},
  mode = "local",
}) {
  const sellerUid = resolveSellerUid(uid, order);
  const orderId = resolveOrderDocId(order);
  if (!sellerUid) throw new Error("Store session ID missing. Please refresh or re-login.");
  if (!orderId) throw new Error("Order document ID missing for this order.");

  const subCol = mode === "global" || order.isGlobalMode ? "global_orders" : "local_orders";
  const packedUpdate = {
    status: "Packed",
    pickupReady: true,
    packedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, "users", sellerUid, subCol, orderId), packedUpdate);
  } catch {
    await updateDoc(doc(db, "users", sellerUid, "orders", orderId), packedUpdate);
  }

  if (order.customerUid) {
    try {
      await updateDoc(doc(db, "customers", order.customerUid, "orders", orderId), {
        status: "Packed",
        pickupStatus: "ready_for_pickup",
        pickupMessage: `Your order is packed! Please get your product in shop: ${shopProfile.name || "Our Store"}`,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, "customers", order.customerUid, "notifications"), {
        title: "🛍️ Your order is packed!",
        message: `Your order is packed! Get your product in shop: ${shopProfile.name || "Our Store"} (${shopProfile.address || ""})`,
        orderId: orderId,
        type: "order_packed",
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("Customer notification error:", e?.message);
    }
  }

  return { success: true };
}

/**
 * Hold Online Order (Set to Pending with reason and duration)
 */
export async function holdOnlineOrder({
  db,
  uid,
  order,
  reason,
  pendingUntilIso,
  mode = "local",
}) {
  const sellerUid = resolveSellerUid(uid, order);
  const orderId = resolveOrderDocId(order);
  if (!sellerUid) throw new Error("Store session ID missing. Please refresh or re-login.");
  if (!orderId) throw new Error("Order document ID missing for this order.");

  const subCol = mode === "global" || order.isGlobalMode ? "global_orders" : "local_orders";
  const originalStatus = order.status === "Pending" ? order.lastStatus || "Accepted" : order.status || "Accepted";

  const holdPayload = {
    status: "Pending",
    lastStatus: originalStatus,
    pendingUntil: pendingUntilIso,
    pendingMessage: reason || "Your order is placed on hold by the store.",
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, "users", sellerUid, subCol, orderId), holdPayload);
  } catch {
    await updateDoc(doc(db, "users", sellerUid, "orders", orderId), holdPayload);
  }

  if (order.customerUid) {
    try {
      await updateDoc(doc(db, "customers", order.customerUid, "orders", orderId), {
        status: "Pending",
        lastStatus: originalStatus,
        pendingUntil: pendingUntilIso,
        pendingMessage: reason || "",
        updatedAt: serverTimestamp(),
      });
    } catch (_) {}
  }

  return { success: true };
}

/**
 * Resume a Held Online Order
 */
export async function resumeHeldOnlineOrder({ db, uid, order, mode = "local" }) {
  const sellerUid = resolveSellerUid(uid, order);
  const orderId = resolveOrderDocId(order);
  if (!sellerUid) throw new Error("Store session ID missing. Please refresh or re-login.");
  if (!orderId) throw new Error("Order document ID missing for this order.");

  const restoredStatus = order.lastStatus || "Accepted";
  const subCol = mode === "global" || order.isGlobalMode ? "global_orders" : "local_orders";

  const resumePayload = {
    status: restoredStatus,
    pendingMessage: "",
    pendingUntil: null,
    updatedAt: serverTimestamp(),
  };

  try {
    await updateDoc(doc(db, "users", sellerUid, subCol, orderId), resumePayload);
  } catch {
    await updateDoc(doc(db, "users", sellerUid, "orders", orderId), resumePayload);
  }

  if (order.customerUid) {
    try {
      const customerRef = doc(db, "customers", order.customerUid, "orders", orderId);
      const snap = await getDoc(customerRef);
      if (snap.exists()) {
        const data = snap.data();
        const updatedShops = asArray(data.orderedShops).map((shop) => {
          if (shop.shopId === sellerUid) {
            return { ...shop, status: restoredStatus, pendingMessage: "", pendingUntil: null };
          }
          return shop;
        });
        await updateDoc(customerRef, {
          status: restoredStatus,
          orderedShops: updatedShops,
          pendingMessage: "",
          pendingUntil: null,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (_) {}
  }

  return { restoredStatus };
}

/**
 * Reject Online Order
 */
export async function rejectOnlineOrder({ db, uid, order, mode = "local" }) {
  const sellerUid = resolveSellerUid(uid, order);
  const orderId = resolveOrderDocId(order);
  if (!sellerUid) throw new Error("Store session ID missing. Please refresh or re-login.");
  if (!orderId) throw new Error("Order document ID missing for this order.");

  const subCol = mode === "global" || order.isGlobalMode ? "global_orders" : "local_orders";

  try {
    await updateDoc(doc(db, "users", sellerUid, subCol, orderId), {
      status: "Rejected",
      updatedAt: serverTimestamp(),
    });
  } catch {
    await updateDoc(doc(db, "users", sellerUid, "orders", orderId), {
      status: "Rejected",
      updatedAt: serverTimestamp(),
    });
  }

  if (order.customerUid) {
    try {
      await updateDoc(doc(db, "customers", order.customerUid, "orders", orderId), {
        status: "Rejected",
        updatedAt: serverTimestamp(),
      });
    } catch (_) {}
  }

  return { success: true };
}

/**
 * Toggle Store Door Delivery Setting
 */
export async function toggleShopDoorDelivery({ db, uid, currentSetting }) {
  const sellerUid = resolveSellerUid(uid);
  if (!sellerUid) throw new Error("Missing uid");
  const nextVal = !currentSetting;
  await updateDoc(doc(db, "users", sellerUid), {
    doorDeliveryEnabled: nextVal,
    "deliveryConfig.doorDeliveryEnabled": nextVal,
    updatedAt: serverTimestamp(),
  });
  return nextVal;
}

/**
 * Helper to build WhatsApp Message URL for Customer Store Pickup
 */
export function getPickupWhatsAppUrl(order, shopProfile = {}) {
  if (!order?.customerPhone) return null;
  const cleanPhone = order.customerPhone.replace(/\D/g, "");
  const shopName = shopProfile.name || "Our Store";
  const msg = `Hello ${order.customerName || "Customer"}! 👋\n\nYour order #${order.orderId || order.id} from *${shopName}* is packed and ready! 🛍️\n\n📍 *Get your product in our shop:*\n${shopProfile.address || shopName}\n${shopProfile.phone ? "📞 Phone: " + shopProfile.phone : ""}\n\nThank you for shopping with us! 😊`;
  return `https://wa.me/${cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone}?text=${encodeURIComponent(msg)}`;
}

/**
 * Helper to build WhatsApp Message URL for Delivery Boy Dispatch
 */
export function getDeliveryBoyWhatsAppUrl(order, staffPhone, shopProfile = {}) {
  if (!staffPhone) return null;
  const cleanPhone = staffPhone.replace(/\D/g, "");
  const shopName = shopProfile.name || "Our Store";
  const msg = `🛵 *NEW DELIVERY ASSIGNED* 🛵\n\n*Order ID:* #${order.orderId || order.id}\n*Customer:* ${order.customerName || "Customer"}\n*Phone:* ${order.customerPhone || "N/A"}\n*Delivery Address:* ${order.deliveryAddress || "Address not provided"}\n*Amount to Collect:* ₹${order.totalAmount || order.total || 0} (${order.paymentMode || "COD"})\n\n📍 *Google Maps Navigation:*\nhttps://maps.google.com/?q=${encodeURIComponent(order.deliveryAddress || "")}\n\n*Pickup from:* ${shopName}, ${shopProfile.address || ""}`;
  return `https://wa.me/${cleanPhone.length === 10 ? "91" + cleanPhone : cleanPhone}?text=${encodeURIComponent(msg)}`;
}

/**
 * Simulates an incoming Online Order for end-to-end verification and testing
 */
export async function createSimulatedOnlineOrder({ db, uid, isGlobalMode = false, sampleItems = [] }) {
  const sellerUid = resolveSellerUid(uid);
  if (!sellerUid) throw new Error("Missing uid");

  const orderNum = Math.floor(1000 + Math.random() * 9000);
  const orderId = `ONL-${orderNum}`;
  const subCol = isGlobalMode ? "global_orders" : "local_orders";

  const defaultItems = [
    { itemName: "Special Masala Tea", price: 30, qty: 2 },
    { itemName: "Crispy Samosa (Plate of 2)", price: 40, qty: 1 },
    { itemName: "Chicken Biryani", price: 180, qty: 1 }
  ];

  const items = sampleItems.length > 0 ? sampleItems : defaultItems;
  const total = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);

  const sampleOrder = {
    orderId,
    customerName: "Rahul Sharma",
    customerPhone: "9876543210",
    customerUid: `cust_test_${Date.now()}`,
    deliveryAddress: "Flat 402, Green Valley Apartments, Anna Nagar, Chennai",
    items,
    totalAmount: total,
    total: total,
    paymentMode: "COD",
    status: "Pending Verification",
    isGlobalMode: Boolean(isGlobalMode),
    appMode: isGlobalMode ? "global" : "local",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(collection(db, "users", sellerUid, subCol), sampleOrder);
  return { id: docRef.id, ...sampleOrder };
}
