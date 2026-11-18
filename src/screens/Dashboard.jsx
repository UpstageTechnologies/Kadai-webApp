import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";
import Profile from "./Profile";
import Settings from "./Settings";
import Subscription from "./Subscription";
import StaffManagement from "./StaffManagement";
import { resolveUserSubscription, canAddInventoryItem } from "../utils/subscriptionService";
import { getDefaultPrintSettings, normalizePrintSettings, executePrint } from "../utils/printEngine";
import { getOrderClassification, playNotificationSound } from "../utils/restaurantOrderService";

export default function Dashboard({ initialTab = "sales" }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("uid")));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  
  // Restaurant Mode Detection
  const [shopType, setShopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant = (shopType || "").trim().toLowerCase() === "restaurant";

  // Shop Mode: Local vs Global
  const [appMode, setAppMode] = useState(() => localStorage.getItem("app_mode") || "local");
  const isGlobalMode = appMode === "global";
  const [rawUserData, setRawUserData] = useState(null);
  const userSubscription = resolveUserSubscription(rawUserData);

  // Shop Mode Dropdown State and Dynamic Coordinates
  const [shopModeDropdownOpen, setShopModeDropdownOpen] = useState(false);
  const [shopMenuCoords, setShopMenuCoords] = useState({ top: 0, left: 0 });
  const shopModeBtnRef = useRef(null);

  // Orders Mode Filter: "current" | "local" | "global" | "all"
  const [orderModeFilter, setOrderModeFilter] = useState("current");

  // Speed Dial (1 - 8) Quick Sale Feature States
  const [showSpeedDial, setShowSpeedDial] = useState(() => {
    const saved = localStorage.getItem("speed_dial_visible");
    return saved !== null ? saved === "true" : true;
  });
  const [speedDialSlots, setSpeedDialSlots] = useState(() => {
    try {
      const sType = (localStorage.getItem("shop_type") || "").trim().toLowerCase();
      const isRest = sType === "restaurant";
      const aMode = localStorage.getItem("app_mode") || "local";
      const modeKey = isRest ? "restaurant" : (aMode === "global" ? "global" : "local");
      const currentUid = localStorage.getItem("uid") || "";
      if (currentUid) {
        const saved = localStorage.getItem(`speed_dial_slots_${modeKey}_${currentUid}`);
        if (saved) return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Error reading initial speed dial slots:", e);
    }
    return {};
  });
  const speedDialSlotsRef = useRef(speedDialSlots);
  useEffect(() => {
    speedDialSlotsRef.current = speedDialSlots;
  }, [speedDialSlots]);

  const [isConfiguringSpeedDial, setIsConfiguringSpeedDial] = useState(false);
  const [selectedSlotForConfig, setSelectedSlotForConfig] = useState(1);
  const [speedDialSearch, setSpeedDialSearch] = useState("");
  const [recentlyTappedSlot, setRecentlyTappedSlot] = useState(null);

  const [currentBill, setCurrentBill] = useState([]);
  const [ordersList, setOrdersList] = useState([]);
  const [statsTimeframe, setStatsTimeframe] = useState("all");

  // Hold Bill Feature States
  const [heldOrders, setHeldOrders] = useState([]);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdCustomerName, setHoldCustomerName] = useState("");
  const [holdCustomerPhone, setHoldCustomerPhone] = useState("");
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [activeResumedOrderId, setActiveResumedOrderId] = useState(null);
  const [holdConflictModal, setHoldConflictModal] = useState({ show: false, pendingOrder: null });

  // Profile Dropdown State and Dynamic Coordinates
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState({ top: 0, right: 0 });
  const profileBtnRef = useRef(null);

  // User Profile & Settings States
  const [userProfile, setUserProfile] = useState({ name: "", email: "", phone: "", storeName: "Kadai Pro Store", profileImage: "" });
  const [storeSettings, setStoreSettings] = useState({ upiId: "kadaippro@okaxis", allowCash: true, allowUpi: true, allowCard: true });
  const [printSettings, setPrintSettings] = useState(() => {
    try {
      const currentUid = localStorage.getItem("uid") || "";
      if (currentUid) {
        const saved = localStorage.getItem(`kadai_print_settings_${currentUid}`);
        if (saved) return normalizePrintSettings(JSON.parse(saved));
      }
    } catch (e) {
      console.warn("Could not load local cached print settings:", e);
    }
    return getDefaultPrintSettings();
  });

  // Checkout Modal State
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  // Success Animated Popup Modal State
  const [popupModal, setPopupModal] = useState({ show: false, message: "" });

  // View Bill Details Modal State (Receipt Popup)
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);

  // Restaurant Table Orders & KOT States
  const [kitchenOrders, setKitchenOrders] = useState([]);
  const [showTableOrdersModal, setShowTableOrdersModal] = useState(false);
  const [tableOrderTab, setTableOrderTab] = useState("served"); // "served" | "kitchen" | "all"
  const [activeTableOrderId, setActiveTableOrderId] = useState(null);
  const [activeTableOrderInfo, setActiveTableOrderInfo] = useState(null);
  const [sendKotWithCheckout, setSendKotWithCheckout] = useState(true);
  const [checkoutOrderType, setCheckoutOrderType] = useState("counter"); // "counter" | "dine-in" | "parcel"
  const [showDirectParcelModal, setShowDirectParcelModal] = useState(false);
  const [directParcelName, setDirectParcelName] = useState("");
  const [directParcelPhone, setDirectParcelPhone] = useState("");

  // Real-time Counter Notification States
  const [counterToast, setCounterToast] = useState(null);
  const notifiedServedOrdersRef = useRef(new Set());
  const isFirstKitchenSyncRef = useRef(true);

  // Modal States for Add & Edit Inventory
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [brand, setBrand] = useState("");
  const [image, setImage] = useState("");

  // Web Image Search Modal States
  const [webImageModalOpen, setWebImageModalOpen] = useState(false);
  const [webImageQuery, setWebImageQuery] = useState("");
  const [webImageResults, setWebImageResults] = useState([]);
  const [webImageLoading, setWebImageLoading] = useState(false);

  const RESTAURANT_CATEGORIES = useMemo(() => [
    "Starters",
    "Main Course",
    "Breads & Roti",
    "Rice & Biryani",
    "Beverages",
    "Desserts",
    "Snacks & Chaat",
    "Combos & Thali",
    "Breakfast / Tiffin"
  ], []);

  const RETAIL_CATEGORIES = useMemo(() => [
    "General",
    "Grocery & Staples",
    "Snacks & Munchies",
    "Beverages",
    "Dairy & Bakery",
    "Personal Care",
    "Household Essentials"
  ], []);

  const availableCategories = useMemo(() => {
    const baseList = isRestaurant ? RESTAURANT_CATEGORIES : RETAIL_CATEGORIES;
    const catSet = new Set(baseList);
    products.forEach((p) => {
      const c = p.category;
      if (c && typeof c === "string" && c.trim()) {
        catSet.add(c.trim());
      }
    });
    return Array.from(catSet);
  }, [isRestaurant, products, RESTAURANT_CATEGORIES, RETAIL_CATEGORIES]);

  const toggleProfileDropdown = (e) => {
    e.stopPropagation();
    if (!profileDropdownOpen && profileBtnRef.current) {
      const rect = profileBtnRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      // Collision handling: properly align to right side of Profile button and clamp within viewport
      let rightOffset = viewportWidth - rect.right;
      if (rightOffset < 12) {
        rightOffset = 12;
      }
      setMenuCoords({
        top: Math.min(rect.bottom + 8, window.innerHeight - 150),
        right: rightOffset
      });
      setProfileDropdownOpen(true);
      setShopModeDropdownOpen(false);
    } else {
      setProfileDropdownOpen(false);
    }
  };

  const toggleShopModeDropdown = (e) => {
    e.stopPropagation();
    if (!shopModeDropdownOpen && shopModeBtnRef.current) {
      const rect = shopModeBtnRef.current.getBoundingClientRect();
      setShopMenuCoords({
        top: rect.bottom + 8,
        left: rect.left
      });
      setShopModeDropdownOpen(true);
      setProfileDropdownOpen(false);
    } else {
      setShopModeDropdownOpen(false);
    }
  };

  const handleSelectAppMode = (mode) => {
    setAppMode(mode);
    localStorage.setItem("app_mode", mode);
    setShopModeDropdownOpen(false);
    const isRest = (shopType || "").trim().toLowerCase() === "restaurant";
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
    const modeKey = isRest ? "restaurant" : (mode === "global" ? "global" : "local");
    const speedDialStorageKey = `speed_dial_slots_${modeKey}_${currentUid}`;

    if (rawUserData) {
      const activeStoreName = mode === "global"
        ? (rawUserData.global_shopName || rawUserData.globalStoreName || rawUserData.shopName || rawUserData.storeName || "Global Shop")
        : (rawUserData.local_shopName || rawUserData.localStoreName || rawUserData.shopName || rawUserData.storeName || (isRest ? "Restaurant POS" : "Local Shop"));

      setUserProfile(prev => ({
        ...prev,
        storeName: activeStoreName,
        profileImage: (mode === "global" ? rawUserData.global_shopLogo : rawUserData.local_shopLogo) || rawUserData.profileImage || rawUserData.shopLogo || ""
      }));
    }

    const saved = localStorage.getItem(speedDialStorageKey);
    if (saved) {
      try { 
        setSpeedDialSlots(JSON.parse(saved)); 
      } catch (err) { 
        console.warn("Could not parse speed dial slots on mode switch:", err);
        setSpeedDialSlots({}); 
      }
    } else if (rawUserData?.speedDialSlots?.[modeKey]) {
      setSpeedDialSlots(rawUserData.speedDialSlots[modeKey]);
      localStorage.setItem(speedDialStorageKey, JSON.stringify(rawUserData.speedDialSlots[modeKey]));
    } else {
      setSpeedDialSlots({});
    }
  };

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (profileBtnRef.current && profileBtnRef.current.contains(e.target)) {
        return;
      }
      if (shopModeBtnRef.current && shopModeBtnRef.current.contains(e.target)) {
        return;
      }
      setProfileDropdownOpen(false);
      setShopModeDropdownOpen(false);
    };

    window.addEventListener("click", handleOutsideClick);
    window.addEventListener("scroll", () => {
      setProfileDropdownOpen(false);
      setShopModeDropdownOpen(false);
    }, true);
    window.addEventListener("resize", () => {
      setProfileDropdownOpen(false);
      setShopModeDropdownOpen(false);
    });

    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = `
      @keyframes scaleUp {
        0% { transform: scale(0); opacity: 0; }
        60% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes checkDraw {
        0% { stroke-dashoffset: 48; }
        100% { stroke-dashoffset: 0; }
      }
      .animate-circle {
        animation: scaleUp 0.4s ease-in-out forwards;
      }
      .animate-check {
        stroke-dasharray: 48;
        animation: checkDraw 0.4s 0.3s ease-in-out forwards;
      }
      @keyframes badgePop {
        0% { transform: scale(0.6); opacity: 0.8; }
        60% { transform: scale(1.22); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .animate-badge-pop {
        animation: badgePop 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
      }
    `;
    document.head.appendChild(styleSheet);

    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      return;
    }

    const userDocRef = doc(db, "users", currentUid);
    const unsubscribeUser = onSnapshot(userDocRef, (userSnap) => {
      if (userSnap.exists()) {
        const data = userSnap.data();
        setRawUserData(data);
        const sType = (data.shopType || data.shop_type || data.businessType || "").trim();
        if (sType) {
          setShopType(sType);
          localStorage.setItem("shop_type", sType);
        }
        const isRest = sType.toLowerCase() === "restaurant";
        const activeStoreName = isGlobalMode
          ? (data.global_shopName || data.globalStoreName || data.shopName || data.storeName || "Global Shop")
          : (data.local_shopName || data.localStoreName || data.shopName || data.storeName || (isRest ? "Restaurant POS" : "Local Shop"));

        setUserProfile({
          name: data.name || auth.currentUser?.displayName || (isRest ? "Restaurant Manager" : "Store Owner"),
          email: data.email || auth.currentUser?.email || "",
          phone: data.phone || "",
          storeName: activeStoreName,
          profileImage: (isGlobalMode ? data.global_shopLogo : data.local_shopLogo) || data.profileImage || data.shopLogo || ""
        });
        if (data.settings) {
          setStoreSettings(data.settings);
        }
        if (data.printSettings || data.settings?.print) {
          const loadedPrint = normalizePrintSettings(data.printSettings || data.settings?.print);
          setPrintSettings(loadedPrint);
          try {
            localStorage.setItem(`kadai_print_settings_${currentUid}`, JSON.stringify(loadedPrint));
          } catch (storageErr) {
            console.warn("Could not cache print settings locally:", storageErr);
          }
        }

        const modeKey = isRest ? "restaurant" : (isGlobalMode ? "global" : "local");
        const speedDialStorageKey = `speed_dial_slots_${modeKey}_${currentUid}`;
        if (data.speedDialSlots?.[modeKey]) {
          setSpeedDialSlots(data.speedDialSlots[modeKey]);
          localStorage.setItem(speedDialStorageKey, JSON.stringify(data.speedDialSlots[modeKey]));
        } else {
          const savedSlots = localStorage.getItem(speedDialStorageKey);
          if (savedSlots) {
            try { 
              setSpeedDialSlots(JSON.parse(savedSlots)); 
            } catch (err) {
              console.warn("Could not parse speed dial slots:", err);
            }
          }
        }

        // Load local cached held orders for immediate availability
        const savedHeld = localStorage.getItem(`held_orders_${currentUid}`);
        if (savedHeld) {
          try { 
            setHeldOrders(JSON.parse(savedHeld)); 
          } catch (err) {
            console.warn("Could not parse saved held orders:", err);
          }
        }
      }
    }, (err) => {
      console.error("Error subscribing to user profile:", err);
    });

    // 1. Items Sync (Listens to restaurant_menu for Restaurant, global_inventory for Global, inventory for Local)
    const collectionName = isRestaurant ? "restaurant_menu" : (isGlobalMode ? "global_inventory" : "inventory");
    const inventoryRef = collection(db, "users", currentUid, collectionName);
    const unsubscribeInventory = onSnapshot(inventoryRef, (snapshot) => {
      const items = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        const itemName = data.name || data.itemName || "Unnamed Item";
        const price = Number(data.price ?? data.salesPrice ?? 0);
        const image = data.imageUrl || data.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
        const isAvailable = data.isAvailable !== false;
        const quantity = data.quantity !== undefined ? data.quantity : (isAvailable ? "In Stock" : "Out of Stock");

        return {
          id: docSnap.id,
          ...data,
          name: itemName,
          itemName: itemName,
          price: price,
          salesPrice: price,
          image: image,
          imageUrl: image,
          category: data.category || (isRestaurant ? "Main Course" : "General"),
          quantity: quantity,
          isAvailable: isAvailable,
          brand: data.brand || ""
        };
      });
      setProducts(items);

      const defaultCategory = isRestaurant ? "Main Course" : "General";
      const uniqueCats = ["All", ...new Set(items.map(item => item.category || defaultCategory).filter(Boolean))];
      setCategories(uniqueCats);
      setLoading(false);
    }, (error) => {
      console.error(`Error fetching ${collectionName}:`, error);
      setLoading(false);
    });

    // 2. Orders History Sync (Sales Collection)
    const salesRef = collection(db, "users", currentUid, "sales");
    const unsubscribeOrders = onSnapshot(salesRef, (snapshot) => {
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      orders.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setOrdersList(orders);
    }, (error) => {
      console.error("Error fetching orders:", error);
    });

    // 3. Real-time Active Cart Sync with Mobile App
    const activeCartRef = doc(db, "users", currentUid, "active_cart", "current");
    const unsubscribeActiveCart = onSnapshot(activeCartRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setCurrentBill(data.items || []);
      } else {
        setCurrentBill([]);
      }
    }, (err) => {
      console.error("Cart sync listener error:", err);
    });

    // 4. Real-time Held Orders Sync across Web and Mobile
    const heldOrdersRef = collection(db, "users", currentUid, "held_orders");
    const unsubscribeHeldOrders = onSnapshot(heldOrdersRef, (snapshot) => {
      const list = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      list.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || (typeof a.id === "number" ? a.id : Number(a.id) || 0);
        const timeB = b.createdAt?.toMillis?.() || (typeof b.id === "number" ? b.id : Number(b.id) || 0);
        return timeB - timeA;
      });
      setHeldOrders(list);
      localStorage.setItem(`held_orders_${currentUid}`, JSON.stringify(list));
    }, (err) => {
      console.warn("Held orders sync listener notice:", err);
    });

    // 5. Real-time Kitchen Orders (KOT & Live Table Orders) Sync
    const kitchenOrdersRef = collection(db, "users", currentUid, "kitchen_orders");
    const unsubscribeKitchenOrders = onSnapshot(kitchenOrdersRef, (snapshot) => {
      const list = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      setKitchenOrders(list);

      // Real-time table-specific notifications to Counter
      if (isFirstKitchenSyncRef.current) {
        snapshot.docs.forEach((d) => {
          const data = d.data();
          if (data.status === "served" || data.status === "completed") {
            notifiedServedOrdersRef.current.add(d.id);
          }
        });
        isFirstKitchenSyncRef.current = false;
      } else {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added" || change.type === "modified") {
            const o = { id: change.doc.id, ...change.doc.data() };
            const classification = getOrderClassification(o);

            // Waiter marked table order completed & sent to counter
            if (classification.isTable && o.status === "served" && !notifiedServedOrdersRef.current.has(o.id)) {
              notifiedServedOrdersRef.current.add(o.id);
              playNotificationSound("orderServed");
              setCounterToast({
                id: o.id,
                message: `Table ${classification.tableNo} – Order Completed. Bill is Ready at Counter.`,
                order: o,
              });
            }

            // Kitchen marked parcel food ready & packed
            if (classification.isParcel && o.status === "ready" && !notifiedServedOrdersRef.current.has(o.id + "_parcel_ready")) {
              notifiedServedOrdersRef.current.add(o.id + "_parcel_ready");
              playNotificationSound("foodReady");
              setCounterToast({
                id: o.id,
                message: `Food Ready & Packed – PARCEL (${classification.customerName}). Ready to Bill!`,
                order: o,
              });
            }
          }
        });
      }
    }, (err) => {
      console.warn("Kitchen orders sync listener notice:", err);
    });

    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("scroll", () => setProfileDropdownOpen(false), true);
      window.removeEventListener("resize", () => setProfileDropdownOpen(false));
      unsubscribeUser();
      unsubscribeInventory();
      unsubscribeOrders();
      unsubscribeActiveCart();
      unsubscribeHeldOrders();
      unsubscribeKitchenOrders();
    };
  }, [isRestaurant, appMode]);

  // Derived Kitchen & Table Orders
  const activeKitchenOrders = kitchenOrders.filter((o) => o.status !== "completed");
  
  // Ready to Bill Orders:
  // - Table orders: ONLY when waiter completed and marked as "served"
  // - Parcel orders: ONLY when kitchen marked Food Ready ("ready" or "served")
  // Never when status is "pending" or "preparing"!
  const servedTableOrders = activeKitchenOrders.filter((o) => {
    if (o.status === "completed") return false;
    const classification = getOrderClassification(o);
    if (classification.isParcel) {
      return o.status === "ready" || o.status === "served";
    }
    if (classification.isTable) {
      return o.status === "served";
    }
    return o.status === "served" || o.status === "ready";
  });

  const cookingTableOrders = activeKitchenOrders.filter((o) => {
    return !servedTableOrders.some((s) => s.id === o.id);
  });

  const getOrderElapsedMinutes = (createdAtMs) => {
    if (!createdAtMs) return "Just now";
    const diff = Math.floor((Date.now() - createdAtMs) / 60000);
    if (diff <= 0) return "Just now";
    if (diff === 1) return "1 min ago";
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
  };

  // 1. Load Table order items into current billing register with full prices & amounts
  const handleLoadTableOrderToBill = (order) => {
    const classification = getOrderClassification(order);
    const orderDisplay = classification.isParcel
      ? `PARCEL (${classification.customerName})`
      : classification.isTable
      ? classification.tableNo
      : "Counter Order";

    if (currentBill.length > 0) {
      if (!window.confirm(`Cart already has ${currentBill.length} item(s). Replace with items from ${orderDisplay}?`)) {
        return;
      }
    }

    const formattedItems = (order.items || []).map((item, idx) => ({
      id: item.foodId || item.id || `kot_item_${idx}`,
      barcode: item.foodId || item.id || `kot_item_${idx}`,
      name: item.name || "Food Item",
      itemName: item.name || "Food Item",
      price: Number(item.price || item.salesPrice || 0),
      salesPrice: Number(item.price || item.salesPrice || 0),
      purchasePrice: Number(item.purchasePrice || 0),
      portion: item.portion || "Standard",
      qty: Number(item.qty || 1),
      notes: item.notes || "",
      image: item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
      imageUrl: item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
    }));

    setCurrentBill(formattedItems);
    setCustomerName(classification.customerName || (classification.isTable ? classification.tableNo : "Walk-in Customer"));
    if (order.customerPhone) setCustomerPhone(order.customerPhone);
    setActiveTableOrderId(order.id);
    setActiveTableOrderInfo({
      id: order.id,
      tableNo: classification.isTable ? classification.tableNo : null,
      isParcel: classification.isParcel,
      isTable: classification.isTable,
      customerName: classification.customerName,
      orderNumber: order.orderNumber,
      waiterName: order.waiterName,
      createdAtMs: order.createdAtMs,
    });
    setShowTableOrdersModal(false);
    setIsCheckoutModalOpen(true);
    syncWebCartToCloud(formattedItems);
  };

  // 2. Print Pre-Bill / Table Slip (with full amounts) before formal checkout
  const handlePrintPreBill = (order) => {
    if (!order) return;
    const classification = getOrderClassification(order);
    const subtotal = (order.items || []).reduce((acc, i) => acc + (Number(i.price || i.salesPrice || 0) * Number(i.qty || 1)), 0);
    const preBillData = {
      ...order,
      billNo: `PRE-${order.orderNumber || "BILL"}`,
      docTitle: classification.isParcel ? "PARCEL PACKING SLIP" : classification.isTable ? "PRE-BILL / TABLE SLIP" : "ORDER SLIP",
      paymentMethod: "Pending (Pre-Bill)",
      customerName: classification.isParcel
        ? `PARCEL (${classification.customerName})`
        : classification.isTable
        ? classification.tableNo
        : (classification.customerName || "Walk-in Customer"),
      items: order.items || [],
      totalAmount: order.totalAmount || subtotal,
      total: order.totalAmount || subtotal,
      createdAt: order.createdAtMs ? new Date(order.createdAtMs) : new Date(),
    };
    handlePrintBill(preBillData, "posReceipt");
  };

  // 3. Mark Table Order Completed
  const handleMarkOrderCompleted = async (orderId) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid || !orderId) return;
    try {
      await updateDoc(doc(db, "users", currentUid, "kitchen_orders", orderId), {
        status: "completed",
        billedAt: serverTimestamp(),
        billedAtMs: Date.now(),
        readyForBilling: false,
      });
      try {
        await updateDoc(doc(db, "kitchen_orders", orderId), {
          status: "completed",
          billedAt: serverTimestamp(),
          billedAtMs: Date.now(),
          readyForBilling: false,
        });
      } catch (_) {}
      if (activeTableOrderId === orderId) {
        setActiveTableOrderId(null);
        setActiveTableOrderInfo(null);
      }
    } catch (err) {
      console.error("Error marking order completed:", err);
    }
  };

  // 4. Send Direct Parcel KOT to Kitchen & Packing Staff
  const handleSendDirectParcelToKitchen = async () => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      alert("Store connection missing.");
      return;
    }
    if (currentBill.length === 0) {
      alert("Please add food items to cart before sending parcel to kitchen.");
      return;
    }

    const finalCustomer = (directParcelName || customerName || "Walk-in Customer").trim();
    const finalPhone = (directParcelPhone || customerPhone || "").trim();
    const nowMs = Date.now();
    const kotNumber = `KOT-${nowMs.toString().slice(-4)}`;

    const sanitizedItems = currentBill.map((item) => ({
      foodId: String(item.id || item.barcode || ""),
      name: String(item.name || item.itemName || "Item").trim(),
      portion: String(item.portion || "Standard").trim(),
      price: Number(item.salesPrice || item.price || 0),
      purchasePrice: Number(item.purchasePrice || 0),
      qty: Math.max(1, Number(item.qty) || 1),
      notes: String(item.notes || "").trim(),
    }));

    const safeTotalAmount = sanitizedItems.reduce((acc, i) => acc + i.price * i.qty, 0);
    const safeTotalQty = sanitizedItems.reduce((acc, i) => acc + i.qty, 0);

    const kotPayload = {
      orderNumber: kotNumber,
      tableNo: null,
      waiterId: "COUNTER",
      waiterName: "Counter Staff",
      items: sanitizedItems, // In Kitchen Display & KOT print slips, prices/amounts are strictly NOT shown!
      orderNotes: `Takeaway / Parcel for ${finalCustomer} ${finalPhone ? `(${finalPhone})` : ""}`,
      orderType: "parcel",
      customerName: finalCustomer,
      customerPhone: finalPhone,
      status: "pending",
      readyForBilling: false,
      totalAmount: safeTotalAmount,
      totalItems: safeTotalQty,
      masterUid: String(currentUid),
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const docRef = await addDoc(collection(db, "users", currentUid, "kitchen_orders"), kotPayload);
      try {
        await setDoc(doc(db, "kitchen_orders", docRef.id), {
          ...kotPayload,
          id: docRef.id,
        });
      } catch (_) {}

      setActiveTableOrderId(docRef.id);
      setActiveTableOrderInfo({
        id: docRef.id,
        tableNo: null,
        isParcel: true,
        customerName: finalCustomer,
        orderNumber: kotNumber,
        waiterName: "Counter Staff",
      });
      setCustomerName(finalCustomer);
      if (finalPhone) setCustomerPhone(finalPhone);
      setShowDirectParcelModal(false);

      alert(`✅ Parcel KOT ${kotNumber} for "${finalCustomer}" sent to Kitchen & Packing Staff! 🥡\nStatus is Preparing. Once food is ready, packing staff marks it Ready.`);
    } catch (err) {
      console.error("Error creating direct parcel KOT:", err);
      alert("Failed to send parcel order to kitchen: " + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Sign out error:", e);
    }
    localStorage.removeItem("uid");
    localStorage.removeItem("shop_type");
    localStorage.removeItem("store_name");
    window.location.href = "/login";
  };

  const syncWebCartToCloud = async (updatedItems) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;
    try {
      const activeCartRef = doc(db, "users", currentUid, "active_cart", "current");
      await setDoc(activeCartRef, {
        items: updatedItems,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error("Cloud cart push error:", e);
    }
  };

  const addToCurrentBill = async (product) => {
    if (!product) return;
    const pId = String(product.id || product.barcode || "");
    const pBarcode = product.barcode ? String(product.barcode) : "";
    const pName = product.itemName || product.name || "Item";
    const pPrice = Number(product.salesPrice ?? product.price ?? 0);
    const pImg = product.image || product.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
    const pPurchasePrice = Number(product.purchasePrice || 0);
    const pTax = Number(product.taxPercent || 0);

    let updatedCart;
    setCurrentBill(prevBill => {
      const existIndex = prevBill.findIndex(item => {
        const itemId = String(item.id || item.barcode || "");
        const itemBarcode = item.barcode ? String(item.barcode) : "";
        if (pId && itemId && pId === itemId) return true;
        if (pBarcode && itemBarcode && pBarcode === itemBarcode) return true;
        return false;
      });

      if (existIndex >= 0) {
        updatedCart = prevBill.map((item, idx) => 
          idx === existIndex ? { ...item, qty: (Number(item.qty) || 1) + 1 } : item
        );
      } else {
        const newItem = {
          ...product,
          id: pId || String(new Date().getTime()),
          barcode: pBarcode || pId,
          name: pName,
          itemName: pName,
          price: pPrice,
          salesPrice: pPrice,
          image: pImg,
          imageUrl: pImg,
          purchasePrice: pPurchasePrice,
          taxPercent: pTax,
          qty: 1
        };
        updatedCart = [...prevBill, newItem];
      }
      return updatedCart;
    });

    if (updatedCart) {
      await syncWebCartToCloud(updatedCart);
    }
  };

  const removeFromCurrentBill = async (id) => {
    const targetId = String(id);
    let updatedCart;
    setCurrentBill(prevBill => {
      const exist = prevBill.find(item => String(item.id) === targetId || String(item.barcode) === targetId);
      if (!exist) return prevBill;

      if (exist.qty <= 1) {
        updatedCart = prevBill.filter(item => String(item.id) !== targetId && String(item.barcode) !== targetId);
      } else {
        updatedCart = prevBill.map(item => 
          (String(item.id) === targetId || String(item.barcode) === targetId) 
            ? { ...item, qty: item.qty - 1 } 
            : item
        );
      }
      return updatedCart;
    });

    if (updatedCart) {
      await syncWebCartToCloud(updatedCart);
    }
  };

  const deleteFromCurrentBill = async (id) => {
    const targetId = String(id);
    let updatedCart;
    setCurrentBill(prevBill => {
      updatedCart = prevBill.filter(item => String(item.id) !== targetId && String(item.barcode) !== targetId);
      return updatedCart;
    });
    if (updatedCart) {
      await syncWebCartToCloud(updatedCart);
    }
  };

  const clearCurrentBill = async () => {
    setCurrentBill([]);
    setActiveResumedOrderId(null);
    setActiveTableOrderId(null);
    setActiveTableOrderInfo(null);
    await syncWebCartToCloud([]);
  };

  // Hold Bill Actions
  const handleHoldOrder = () => {
    if (!currentBill || currentBill.length === 0) {
      alert("⚠️ Empty Cart: Cannot hold an empty bill. Please add items to the cart first.");
      return;
    }
    const defaultName = isRestaurant 
      ? `Table / Order #${heldOrders.length + 1}` 
      : "";
    setHoldCustomerName(defaultName);
    setHoldCustomerPhone("");
    setShowHoldModal(true);
  };

  const handleConfirmHoldOrder = async () => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentBill || currentBill.length === 0) {
      setShowHoldModal(false);
      return;
    }

    const holdId = new Date().getTime();
    const finalHoldName = holdCustomerName.trim() || (isRestaurant ? `Table / Order #${heldOrders.length + 1}` : "Guest");
    const finalHoldPhone = holdCustomerPhone.trim();

    const newHold = {
      id: holdId,
      name: finalHoldName,
      customerName: finalHoldName,
      customerPhone: finalHoldPhone || "N/A",
      items: [...currentBill],
      total: totalBillAmount,
      totalAmount: totalBillAmount,
      totalQty: totalBillItemsCount,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      createdAt: serverTimestamp(),
      source: "web_pos",
      isRestaurant: isRestaurant,
      appMode: appMode
    };

    // Update local state immediately for instant feedback
    const updated = [newHold, ...heldOrders.filter(o => String(o.id) !== String(holdId))];
    setHeldOrders(updated);
    if (currentUid) {
      localStorage.setItem(`held_orders_${currentUid}`, JSON.stringify(updated));
      try {
        await setDoc(doc(db, "users", currentUid, "held_orders", String(holdId)), newHold);
      } catch (err) {
        console.error("Failed to save held order to Firestore:", err);
      }
    }

    // Clear active cart in UI and cloud
    setCurrentBill([]);
    setActiveResumedOrderId(null);
    await syncWebCartToCloud([]);

    setHoldCustomerName("");
    setHoldCustomerPhone("");
    setShowHoldModal(false);
    setPopupModal({
      show: true,
      message: `Bill held successfully as "${finalHoldName}"! ⏸️`
    });
  };

  const handleInitiateResumeOrder = (order) => {
    if (currentBill && currentBill.length > 0) {
      // Active cart has items, open conflict resolution modal
      setHoldConflictModal({ show: true, pendingOrder: order });
    } else {
      handleExecuteResumeOrder(order, false);
    }
  };

  const handleExecuteResumeOrder = async (order, holdCurrentFirst = false) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

    if (holdCurrentFirst && currentBill.length > 0) {
      // Hold current bill first before resuming
      const autoHoldId = new Date().getTime();
      const autoHoldName = isRestaurant ? `Table / Order #${heldOrders.length + 1}` : "Auto Held Order";
      const autoHold = {
        id: autoHoldId,
        name: autoHoldName,
        customerName: autoHoldName,
        customerPhone: "N/A",
        items: [...currentBill],
        total: totalBillAmount,
        totalAmount: totalBillAmount,
        totalQty: totalBillItemsCount,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        createdAt: serverTimestamp(),
        source: "web_pos",
        isRestaurant: isRestaurant,
        appMode: appMode
      };
      if (currentUid) {
        try {
          await setDoc(doc(db, "users", currentUid, "held_orders", String(autoHoldId)), autoHold);
        } catch (e) {
          console.warn("Could not auto-hold current bill:", e);
        }
      }
    }

    const restoredItems = order.items || [];
    setCurrentBill(restoredItems);
    await syncWebCartToCloud(restoredItems);

    if (order.customerName && order.customerName !== "Guest" && !order.customerName.startsWith("Table / Order #")) {
      setCustomerName(order.customerName);
    }
    if (order.customerPhone && order.customerPhone !== "N/A") {
      setCustomerPhone(order.customerPhone);
    }

    setActiveResumedOrderId(order.id);

    // Remove resumed order from held orders so it doesn't stay duplicated in held list
    if (currentUid) {
      try {
        await deleteDoc(doc(db, "users", currentUid, "held_orders", String(order.id)));
      } catch (err) {
        console.warn("Could not delete resumed held order doc:", err);
      }
      const updated = heldOrders.filter(o => String(o.id) !== String(order.id));
      setHeldOrders(updated);
      localStorage.setItem(`held_orders_${currentUid}`, JSON.stringify(updated));
    }

    setShowResumeModal(false);
    setHoldConflictModal({ show: false, pendingOrder: null });
    setPopupModal({
      show: true,
      message: `Order "${order.name || order.customerName || 'Held Order'}" restored to cart! ⏵`
    });
  };

  const handleDeleteHeldOrder = async (orderId, orderName) => {
    const ok = window.confirm(`Are you sure you want to delete the held bill for "${orderName || 'Guest'}"? This action will not affect past completed sales.`);
    if (!ok) return;

    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (currentUid) {
      try {
        await deleteDoc(doc(db, "users", currentUid, "held_orders", String(orderId)));
      } catch (e) {
        console.error("Failed to delete held order:", e);
      }
      const updated = heldOrders.filter(o => String(o.id) !== String(orderId));
      setHeldOrders(updated);
      localStorage.setItem(`held_orders_${currentUid}`, JSON.stringify(updated));
    }

    if (activeResumedOrderId === orderId) {
      setActiveResumedOrderId(null);
    }
  };

  const handleAssignProductToSlot = async (slotNum, product) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    const modeKey = isRestaurant ? "restaurant" : (isGlobalMode ? "global" : "local");
    const speedDialStorageKey = `speed_dial_slots_${modeKey}_${currentUid}`;

    const normalizedProduct = product ? {
      id: String(product.id || product.barcode || new Date().getTime()),
      barcode: product.barcode ? String(product.barcode) : "",
      name: product.itemName || product.name || "Item",
      itemName: product.itemName || product.name || "Item",
      price: Number(product.salesPrice ?? product.price ?? 0),
      salesPrice: Number(product.salesPrice ?? product.price ?? 0),
      image: product.image || product.imageUrl || "",
      imageUrl: product.image || product.imageUrl || "",
      purchasePrice: Number(product.purchasePrice || 0),
      taxPercent: product.taxPercent || 0,
      category: product.category || "General"
    } : null;

    let updatedSlots;
    setSpeedDialSlots(prev => {
      const next = { ...prev };
      if (normalizedProduct) {
        next[slotNum] = normalizedProduct;
      } else {
        delete next[slotNum];
      }
      updatedSlots = next;
      if (currentUid) {
        localStorage.setItem(speedDialStorageKey, JSON.stringify(next));
      }
      return next;
    });

    let firestoreError = null;
    if (currentUid && updatedSlots !== undefined) {
      try {
        await updateDoc(doc(db, "users", currentUid), {
          [`speedDialSlots.${modeKey}`]: updatedSlots
        });
      } catch {
        try {
          await setDoc(doc(db, "users", currentUid), {
            speedDialSlots: {
              [modeKey]: updatedSlots
            }
          }, { merge: true });
        } catch (setErr) {
          console.error("Could not sync speed dial to Firestore:", setErr);
          firestoreError = setErr;
        }
      }
    }

    if (firestoreError) {
      setPopupModal({
        show: true,
        message: `Slot #${slotNum} saved locally, but cloud sync failed (${firestoreError.message || 'offline'}).`
      });
    } else {
      setPopupModal({
        show: true,
        message: product 
          ? `Slot #${slotNum} assigned to "${product.itemName || product.name}"! ⚡` 
          : `Slot #${slotNum} cleared successfully!`
      });
    }
    setIsConfiguringSpeedDial(false);
  };

  const handleSpeedDialClick = (slotNum) => {
    const item = speedDialSlots[slotNum];
    if (item && (item.name || item.itemName)) {
      addToCurrentBill(item);
      setRecentlyTappedSlot(slotNum);
      setTimeout(() => setRecentlyTappedSlot(null), 300);
    } else {
      setSelectedSlotForConfig(slotNum);
      setIsConfiguringSpeedDial(true);
    }
  };

  const toggleSpeedDialVisibility = () => {
    setShowSpeedDial(prev => {
      const next = !prev;
      localStorage.setItem("speed_dial_visible", String(next));
      return next;
    });
  };

  // Physical Keyboard Shortcut (Press 1 - 8 to quickly add assigned item to cart)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activeTab !== "sales") return;
      if (
        isCheckoutModalOpen || 
        isModalOpen || 
        isConfiguringSpeedDial || 
        showHoldModal || 
        showResumeModal || 
        holdConflictModal.show || 
        selectedOrderDetails || 
        popupModal.show ||
        showTableOrdersModal ||
        showDirectParcelModal
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target;
      if (
        target && (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest?.("input, textarea, select, [contenteditable='true']")
        )
      ) {
        return;
      }

      if (e.key >= "1" && e.key <= "8") {
        const slotNum = Number(e.key);
        const assignedItem = speedDialSlotsRef.current[slotNum];
        if (assignedItem && (assignedItem.name || assignedItem.itemName)) {
          e.preventDefault();
          addToCurrentBill(assignedItem);
          setRecentlyTappedSlot(slotNum);
          setTimeout(() => setRecentlyTappedSlot(null), 300);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTab, 
    isCheckoutModalOpen, 
    isModalOpen, 
    isConfiguringSpeedDial, 
    showHoldModal, 
    showResumeModal, 
    holdConflictModal.show, 
    selectedOrderDetails, 
    popupModal.show,
    showTableOrdersModal,
    showDirectParcelModal
  ]);

  const handleFinalCheckoutSubmit = async (e) => {
    e.preventDefault();
    if (currentBill.length === 0) return;
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      const totalAmt = currentBill.reduce((sum, item) => sum + ((item.salesPrice || item.price || 0) * item.qty), 0);
      const totalProfit = currentBill.reduce((sum, i) => sum + (Number(i.salesPrice || i.price || 0) - Number(i.purchasePrice || 0)) * i.qty, 0);

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const datePrefix = `${year}${month}${day}`;
      const sequenceNum = String(ordersList.length + 1).padStart(4, "0");
      const bNo = `${datePrefix}-${sequenceNum}`;
      const bDate = now.toLocaleDateString("en-GB");
      
      const sanitizedBillItems = currentBill.map((i) => ({
        id: String(i.id || i.barcode || ""),
        barcode: String(i.barcode || i.id || ""),
        name: String(i.name || i.itemName || "Item"),
        itemName: String(i.name || i.itemName || "Item"),
        price: Number(i.salesPrice || i.price || 0),
        salesPrice: Number(i.salesPrice || i.price || 0),
        purchasePrice: Number(i.purchasePrice || 0),
        qty: Math.max(1, Number(i.qty) || 1),
        portion: String(i.portion || "Standard"),
        notes: String(i.notes || ""),
        image: String(i.image || i.imageUrl || ""),
        imageUrl: String(i.image || i.imageUrl || ""),
      }));

      const saleOrderType = activeTableOrderId
        ? (activeTableOrderInfo?.isParcel ? "parcel" : "table")
        : (checkoutOrderType === "parcel" || (customerName && customerName.toLowerCase().includes("parcel")))
        ? "parcel"
        : (checkoutOrderType === "dine-in" && activeTableOrderInfo?.tableNo)
        ? "table"
        : "counter";

      const saleTableNo = activeTableOrderId && activeTableOrderInfo?.isTable ? activeTableOrderInfo.tableNo : null;

      const saleRecord = {
        billNo: bNo,
        invoiceId: bNo,
        billDate: bDate,
        items: sanitizedBillItems,
        total: totalAmt,
        totalAmount: totalAmt,
        profit: totalProfit,
        customerName: customerName.trim() || (saleTableNo ? saleTableNo : "Walk-in Customer"),
        customerPhone: customerPhone.trim() || "N/A",
        orderType: saleOrderType,
        tableNo: saleTableNo,
        paymentMode: paymentMethod.toUpperCase(),
        paymentMethod: paymentMethod,
        isGlobalMode: isGlobalMode,
        appMode: appMode,
        isRestaurant: isRestaurant,
        shopType: isRestaurant ? "restaurant" : "retail",
        createdAt: serverTimestamp()
      };

      if (currentUid) {
        // 1. Direct save in "sales" collection (No online order notification)
        await addDoc(collection(db, "users", currentUid, "sales"), saleRecord);

        // 2. Transmit confirmation event to Mobile App
        try {
          const cartRef = doc(db, "users", currentUid, "active_cart", "current");
          await setDoc(cartRef, {
            items: [],
            updatedAt: serverTimestamp(),
            lastConfirmedSale: {
              billNo: bNo,
              billDate: bDate,
              items: sanitizedBillItems,
              total: totalAmt,
              timestamp: Date.now()
            }
          });
        } catch (cartErr) {
          console.warn("Active cart sync notice:", cartErr);
        }

        // 3. Clean up active resumed held order if this sale finalized a held bill
        if (activeResumedOrderId) {
          try {
            await deleteDoc(doc(db, "users", currentUid, "held_orders", String(activeResumedOrderId)));
          } catch (e) {
            console.warn("Could not delete finalized resumed held order:", e);
          }
          const updated = heldOrders.filter(o => String(o.id) !== String(activeResumedOrderId));
          setHeldOrders(updated);
          localStorage.setItem(`held_orders_${currentUid}`, JSON.stringify(updated));
          setActiveResumedOrderId(null);
        }

        // 4. Update and complete Table/KOT order if loaded
        if (activeTableOrderId) {
          try {
            await updateDoc(doc(db, "users", currentUid, "kitchen_orders", activeTableOrderId), {
              status: "completed",
              billedAt: serverTimestamp(),
              billedAtMs: Date.now(),
              billNo: bNo,
              readyForBilling: false,
              finalAmount: totalAmt,
            });
            try {
              await updateDoc(doc(db, "kitchen_orders", activeTableOrderId), {
                status: "completed",
                billedAt: serverTimestamp(),
                billedAtMs: Date.now(),
                billNo: bNo,
                readyForBilling: false,
                finalAmount: totalAmt,
              });
            } catch (_) {}
          } catch (tErr) {
            console.warn("Could not mark table KOT order completed:", tErr);
          }
        } else if (isRestaurant && sendKotWithCheckout) {
          // If a direct restaurant sale was made at counter with KOT dispatch
          try {
            const isParcelOrder = checkoutOrderType === "parcel" || (customerName && customerName.toLowerCase().includes("parcel"));
            const kotNum = `KOT-${Date.now().toString().slice(-4)}`;
            const sanitizedKotItems = currentBill.map((item) => ({
              foodId: String(item.id || item.barcode || ""),
              name: String(item.name || item.itemName || "Item").trim(),
              portion: String(item.portion || "Standard").trim(),
              price: Number(item.salesPrice || item.price || 0),
              purchasePrice: Number(item.purchasePrice || 0),
              qty: Math.max(1, Number(item.qty) || 1),
              notes: String(item.notes || "").trim(),
            }));

            const directKotPayload = {
              orderNumber: kotNum,
              tableNo: null,
              waiterId: "COUNTER",
              waiterName: "Counter Billing",
              items: sanitizedKotItems,
              orderNotes: `Direct bill: ${bNo}`,
              orderType: isParcelOrder ? "parcel" : "counter",
              customerName: customerName.trim() || "Walk-in Customer",
              customerPhone: customerPhone.trim() || "",
              status: "completed",
              readyForBilling: false,
              totalAmount: totalAmt,
              totalItems: currentBill.reduce((sum, i) => sum + (Number(i.qty) || 1), 0),
              masterUid: String(currentUid),
              billNo: bNo,
              billedAtMs: Date.now(),
              createdAtMs: Date.now(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };

            await addDoc(collection(db, "users", currentUid, "kitchen_orders"), directKotPayload);
          } catch (kErr) {
            console.warn("Could not record direct restaurant KOT:", kErr);
          }
        }
      }

      const completedOrderData = {
        id: bNo || "ORD-PENDING",
        billNo: bNo,
        billDate: bDate,
        createdAt: new Date(),
        items: [...currentBill],
        totalAmount: totalAmt,
        total: totalAmt,
        customerName: customerName.trim() || (isRestaurant ? "Dine-in / Walk-in" : "Walk-in Customer"),
        customerPhone: customerPhone.trim() || "N/A",
        paymentMethod: paymentMethod,
        paymentMode: paymentMethod.toUpperCase(),
      };

      setIsCheckoutModalOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      setCurrentBill([]);
      setActiveResumedOrderId(null);
      setActiveTableOrderId(null);
      setActiveTableOrderInfo(null);
      setPopupModal({ 
        show: true, 
        message: "Payment Successful & Order Recorded! 🎉",
        lastOrder: completedOrderData 
      });

      // Automatically execute print receipt for customer
      try {
        handlePrintBill(completedOrderData, "posReceipt");
      } catch (pErr) {
        console.warn("Auto-print receipt notice:", pErr);
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Checkout failed: " + err.message);
    }
  };

  const handlePrintBill = (order, docType = "posReceipt") => {
    if (!order) return;
    try {
      const orderDate = order.createdAt?.toDate 
        ? order.createdAt.toDate().toLocaleString("en-IN") 
        : (order.createdAt ? new Date(order.createdAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN"));

      const rawItems = order.items || [];
      const subtotal = rawItems.reduce((acc, i) => acc + (Number(i.price || i.salesPrice || 0) * Number(i.qty || 1)), 0);
      const totalAmount = Number(order.totalAmount || order.total || subtotal);

      const docData = {
        id: order.id || order.billNo || "ORD-SALE",
        billNo: order.billNo || (order.id ? "#" + String(order.id).slice(-6).toUpperCase() : "B-SALE"),
        orderDate: orderDate,
        docTitle: docType === "quotation" ? "QUOTATION" : docType === "salesInvoice" ? "TAX INVOICE" : docType === "purchaseInvoice" ? "PURCHASE INVOICE" : "STORE RECEIPT",
        paymentMethod: order.paymentMethod || order.paymentMode || "Cash",
        customerName: order.customerName || "Walk-in Customer",
        customerPhone: order.customerPhone || "",
        customerAddress: order.customerAddress || "",
        customerGst: order.customerGst || "",
        billedBy: order.billedBy || userProfile.name || "Store Admin",
        storeName: userProfile.storeName || "Kadai Store",
        storeAddress: userProfile.address || rawUserData?.address?.fullAddress || "",
        storePhone: userProfile.phone || rawUserData?.phone || "",
        storeEmail: userProfile.email || rawUserData?.email || "",
        storeGst: userProfile.gst || userProfile.gstin || rawUserData?.gstin || rawUserData?.gst || "",
        storeLogo: userProfile.profileImage || "",
        upiId: storeSettings.upiId || "",
        items: rawItems.map(i => ({
          name: i.name || i.itemName || "Item",
          itemName: i.name || i.itemName || "Item",
          brand: i.brand || "",
          hsn: i.hsn || "",
          qty: Number(i.qty || 1),
          price: Number(i.price || i.salesPrice || 0),
          salesPrice: Number(i.price || i.salesPrice || 0),
          discount: Number(i.discount || 0),
          total: (Number(i.price || i.salesPrice || 0) * Number(i.qty || 1)),
        })),
        subtotal: subtotal,
        discountTotal: Number(order.discountTotal || 0),
        taxTotal: Number(order.taxTotal || 0),
        totalAmount: totalAmount,
        total: totalAmount,
        totalItems: rawItems.length,
        totalQuantity: rawItems.reduce((acc, i) => acc + (Number(i.qty) || 1), 0),
      };

      executePrint(docData, printSettings, docType);
    } catch (err) {
      console.error("Print bill error:", err);
      alert("Could not trigger print: " + err.message);
    }
  };

  const convertToWhiteStudioBackground = (imageUrl) => {
    return new Promise((resolve) => {
      if (!imageUrl) return resolve("");
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const size = 600;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");

          // Fill clean, pure white studio background
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, size, size);

          // Calculate aspect ratio preserving center placement with 6% padding
          const pad = size * 0.06;
          const maxW = size - (pad * 2);
          const maxH = size - (pad * 2);
          const nw = img.naturalWidth || img.width || size;
          const nh = img.naturalHeight || img.height || size;
          const scale = Math.min(maxW / nw, maxH / nh);
          const drawW = nw * scale;
          const drawH = nh * scale;
          const drawX = (size - drawW) / 2;
          const drawY = (size - drawH) / 2;

          ctx.drawImage(img, drawX, drawY, drawW, drawH);
          const studioWhiteUrl = canvas.toDataURL("image/jpeg", 0.92);
          resolve(studioWhiteUrl);
        } catch (err) {
          resolve(imageUrl);
        }
      };
      img.onerror = () => resolve(imageUrl);
      img.src = imageUrl;
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const whiteBg = await convertToWhiteStudioBackground(reader.result);
        setImage(whiteBg);
      };
      reader.readAsDataURL(file);
    }
  };

  const openAddModal = () => {
    if (!canAddInventoryItem(products.length, userSubscription.plan, userSubscription.isExpired)) {
      const limit = userSubscription.limits.inventoryLimit;
      const msg = userSubscription.isExpired
        ? "Your subscription has expired. Please renew your plan to add new inventory items."
        : `Your ${userSubscription.plan} plan limit of ${limit} items has been reached. Please upgrade to Pro for unlimited items.`;
      if (window.confirm(`${msg}\n\nWould you like to upgrade your subscription now?`)) {
        setActiveTab("subscription");
      }
      return;
    }
    setIsEditing(false);
    setEditId(null);
    setName("");
    const defaultCat = isRestaurant ? "Main Course" : "General";
    setCategory(defaultCat);
    setShowCustomCategory(false);
    setPrice("");
    setQty(isRestaurant ? "100" : "");
    setBrand("");
    setImage("");
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    setIsEditing(true);
    setEditId(item.id);
    setName(item.itemName || item.name || "");
    const itemCat = item.category || (isRestaurant ? "Main Course" : "General");
    setCategory(itemCat);
    const existingList = isRestaurant ? RESTAURANT_CATEGORIES : RETAIL_CATEGORIES;
    setShowCustomCategory(!existingList.includes(itemCat));
    setPrice(String(item.salesPrice ?? item.price ?? ""));
    setQty(String(item.quantity ?? "0"));
    setBrand(item.brand || "");
    setImage(item.image || item.imageUrl || "");
    setIsModalOpen(true);
  };

  const searchWebImages = async (searchTerm) => {
    const term = (searchTerm !== undefined ? searchTerm : webImageQuery || name || "").trim();
    if (!term) return;
    setWebImageLoading(true);
    try {
      const cleanTerm = term
        .replace(/\b\d+(\.\d+)?\s*(g|gm|gms|kg|ml|l|ltr|pcs|pack|pk)\b/gi, "")
        .replace(/[^\w\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim() || term;

      const direct = [];

      // 1. TheMealDB (curated restaurant-grade food dish photos)
      try {
        const mealRes = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(cleanTerm)}`);
        const mealData = await mealRes.json();
        mealData?.meals?.forEach((m) => {
          if (m.strMealThumb && !direct.includes(m.strMealThumb)) {
            direct.push(m.strMealThumb);
          }
        });
      } catch (e) {
        console.error("MealDB search error:", e);
      }

      // 2. Wikipedia Food Articles (official dish images)
      try {
        const wikiArticleUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(cleanTerm + " food")}&gsrlimit=12&prop=pageimages&pithumbsize=600&format=json&origin=*`;
        const wikiArtRes = await fetch(wikiArticleUrl);
        const wikiArtData = await wikiArtRes.json();
        if (wikiArtData?.query?.pages) {
          Object.values(wikiArtData.query.pages).forEach((p) => {
            const src = p.thumbnail?.source;
            if (src && !src.endsWith(".svg.png") && !src.includes("logo") && !direct.includes(src)) {
              direct.push(src);
            }
          });
        }
      } catch (e) {
        console.error("Wiki articles error:", e);
      }

      // 3. Open Food Facts (real product packaging & foods)
      try {
        const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(cleanTerm)}&search_simple=1&action=process&json=1&page_size=10`;
        const offRes = await fetch(offUrl);
        const offData = await offRes.json();
        offData?.products?.forEach((p) => {
          if (p.image_url && !direct.includes(p.image_url)) {
            direct.push(p.image_url);
          }
        });
      } catch (e) {
        console.error("Open Food Facts error:", e);
      }

      // 4. Wikimedia Commons (Strictly filtered for food dishes, excluding buildings/streets)
      try {
        const encoded = encodeURIComponent(cleanTerm + " food dish meal");
        const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encoded}&gsrnamespace=6&gsrlimit=25&prop=imageinfo&iiprop=url&iiurlwidth=500&format=json&origin=*`;
        const wikiRes = await fetch(wikiUrl);
        const wikiData = await wikiRes.json();
        const badWords = ["magdeburg", "building", "street", "house", "road", "fence", "station", "church", "monument", "statue", "park", "town", "city", "germany", "graveyard", "cemetery", "car", "vehicle", "portrait", "castle", "burg bei", "convent", "architecture", "facade", "sidewalk", "hall", "plaza", "avenue", "sign", "map", "flag", "diagram", "chart"];
        if (wikiData?.query?.pages) {
          Object.values(wikiData.query.pages).forEach((page) => {
            const title = (page.title || "").toLowerCase();
            const isBad = badWords.some((w) => title.includes(w)) || title.endsWith(".pdf") || title.endsWith(".tif") || title.endsWith(".svg") || title.endsWith(".djvu");
            if (!isBad && page.imageinfo?.[0]) {
              const u = page.imageinfo[0].thumburl || page.imageinfo[0].url;
              if (u && !direct.includes(u)) {
                direct.push(u);
              }
            }
          });
        }
      } catch (e) {
        console.error("Wikimedia error:", e);
      }

      setWebImageResults(direct);
    } catch (e) {
      console.error("Web image search error:", e);
    } finally {
      setWebImageLoading(false);
    }
  };

  const handleOpenWebImageSearch = () => {
    const defaultQuery = name.trim() || (category && category !== "Main Course" && category !== "General" ? category.trim() : "") || "";
    setWebImageQuery(defaultQuery);
    setWebImageResults([]);
    setWebImageModalOpen(true);
    if (defaultQuery) {
      searchWebImages(defaultQuery);
    }
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      if (!currentUid) return;

      if (!isEditing && !canAddInventoryItem(products.length, userSubscription.plan, userSubscription.isExpired)) {
        const limit = userSubscription.limits.inventoryLimit;
        alert(
          userSubscription.isExpired
            ? "Your subscription has expired. Please renew to add new items."
            : `Your ${userSubscription.plan} plan limit (${limit} items) has been reached. Upgrade to Pro for unlimited items.`
        );
        return;
      }

      const targetCol = isRestaurant ? "restaurant_menu" : (isGlobalMode ? "global_inventory" : "inventory");
      const productData = {
        name: name.trim(),
        itemName: name.trim(),
        category: category.trim() || (isRestaurant ? "Main Course" : "General"),
        salesPrice: Number(price) || 0,
        price: Number(price) || 0,
        quantity: isNaN(Number(qty)) ? 100 : Number(qty),
        isAvailable: true,
        brand: brand.trim() || (isRestaurant ? "" : isGlobalMode ? "Global" : "Local"),
        image: image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        imageUrl: image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        isGlobalMode: isGlobalMode,
        inventoryMode: isGlobalMode ? "global" : "local",
        updatedAt: serverTimestamp()
      };

      const itemNoun = isRestaurant ? "Food item" : isGlobalMode ? "Global product" : "Local product";

      if (isEditing && editId) {
        await updateDoc(doc(db, "users", currentUid, targetCol, editId), productData);
        setPopupModal({ show: true, message: `${itemNoun} updated successfully! ✅` });
      } else {
        await addDoc(collection(db, "users", currentUid, targetCol), { ...productData, createdAt: serverTimestamp() });
        setPopupModal({ show: true, message: `${itemNoun} added successfully! 🚀` });
      }

      setIsModalOpen(false);
    } catch (err) {
      alert("Error saving item: " + err.message);
    }
  };

  const handleDeleteProduct = async (id) => {
    const itemLabel = isRestaurant ? "food item" : isGlobalMode ? "global product" : "local product";
    if (window.confirm(`Are you sure you want to delete this ${itemLabel}?`)) {
      try {
        const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
        if (!currentUid) return;
        const targetCol = isRestaurant ? "restaurant_menu" : (isGlobalMode ? "global_inventory" : "inventory");
        await deleteDoc(doc(db, "users", currentUid, targetCol, id));
        const itemNoun = isRestaurant ? "Food item" : isGlobalMode ? "Global product" : "Local product";
        setPopupModal({ show: true, message: `${itemNoun} deleted successfully 🗑️` });
      } catch (err) {
        alert("Delete failed: " + err.message);
      }
    }
  };

  const totalBillAmount = currentBill.reduce((sum, item) => sum + ((item.salesPrice || item.price || 0) * item.qty), 0);
  const totalBillItemsCount = currentBill.reduce((sum, item) => sum + item.qty, 0);

  const filteredProducts = products.filter(item => {
    const itemName = item.itemName || item.name || "";
    const itemCat = item.category || "General";
    const matchesSearch = itemName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || itemCat === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // --- Sales Top Stat Cards Metrics Calculation ---
  const relevantOrders = ordersList.filter(o => {
    if (isRestaurant) {
      return o.shopType === "restaurant" || o.isRestaurant === true || isRestaurant;
    }
    const isOrdGlobal = o.isGlobalMode === true || o.appMode === "global";
    return isGlobalMode ? isOrdGlobal : !isOrdGlobal;
  });

  const ordersPool = relevantOrders.length > 0 ? relevantOrders : ordersList;

  const now = new Date();
  const isSameDay = (d1, d2) => 
    d1.getFullYear() === d2.getFullYear() && 
    d1.getMonth() === d2.getMonth() && 
    d1.getDate() === d2.getDate();

  const yesterdayDate = new Date();
  yesterdayDate.setDate(now.getDate() - 1);

  const parseOrderDate = (o) => {
    if (o.createdAt?.toDate) return o.createdAt.toDate();
    if (o.createdAt?.seconds) return new Date(o.createdAt.seconds * 1000);
    if (o.createdAt) return new Date(o.createdAt);
    return new Date();
  };

  const todayOrders = ordersPool.filter(o => isSameDay(parseOrderDate(o), now));
  const yesterdayOrders = ordersPool.filter(o => isSameDay(parseOrderDate(o), yesterdayDate));

  const activeOrdersForStats = statsTimeframe === "today" ? todayOrders : ordersPool;

  const calcSalesTotal = (list) => list.reduce((sum, o) => sum + Number(o.totalAmount || o.total || 0), 0);
  const calcCustomersCount = (list) => new Set(list.map(o => o.customerPhone || o.customerName || o.id).filter(Boolean)).size;

  const computedTotalSales = calcSalesTotal(activeOrdersForStats);
  const computedOrdersCount = activeOrdersForStats.length;
  const computedCustomersCount = calcCustomersCount(activeOrdersForStats);
  const computedAvgOrderVal = computedOrdersCount > 0 ? (computedTotalSales / computedOrdersCount) : 0;

  const yesterdaySales = calcSalesTotal(yesterdayOrders);
  const yesterdayOrdersCount = yesterdayOrders.length;
  const yesterdayCustomersCount = calcCustomersCount(yesterdayOrders);
  const yesterdayAvg = yesterdayOrdersCount > 0 ? (yesterdaySales / yesterdayOrdersCount) : 0;

  const getGrowthText = (curr, prev, defaultText) => {
    if (prev > 0) {
      const diff = ((curr - prev) / prev) * 100;
      return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}% from yesterday`;
    }
    if (curr > 0) {
      return "+100% from yesterday";
    }
    return defaultText;
  };

  const hasOrdersData = ordersPool.length > 0;
  const statTotalSalesText = hasOrdersData 
    ? `₹${computedTotalSales.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "₹4,892.45";
  const statOrdersText = hasOrdersData ? computedOrdersCount : 128;
  const statCustomersText = hasOrdersData ? (computedCustomersCount || computedOrdersCount) : 256;
  const statAvgOrderText = hasOrdersData 
    ? `₹${computedAvgOrderVal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "₹38.22";

  const statSalesGrowth = hasOrdersData && statsTimeframe === "today" 
    ? getGrowthText(computedTotalSales, yesterdaySales, "12.5% from yesterday")
    : "12.5% from yesterday";
  const statOrdersGrowth = hasOrdersData && statsTimeframe === "today"
    ? getGrowthText(computedOrdersCount, yesterdayOrdersCount, "8.2% from yesterday")
    : "8.2% from yesterday";
  const statCustomersGrowth = hasOrdersData && statsTimeframe === "today"
    ? getGrowthText(computedCustomersCount, yesterdayCustomersCount, "5.4% from yesterday")
    : "5.4% from yesterday";
  const statAvgGrowth = hasOrdersData && statsTimeframe === "today"
    ? getGrowthText(computedAvgOrderVal, yesterdayAvg, "3.1% from yesterday")
    : "3.1% from yesterday";

  return (
    <div style={{
      ...styles.appContainer,
      ...(activeTab === "sales" ? { height: "100vh", maxHeight: "100vh", overflow: "hidden" } : {})
    }}>
      {/* Top Navbar Header */}
      <header style={styles.navbar}>
        <div style={styles.navLeftGroup}>
          <div 
            ref={shopModeBtnRef}
            onClick={toggleShopModeDropdown}
            style={{ ...styles.logoArea, cursor: "pointer", userSelect: "none" }}
            title="Click to switch between Local and Global Shop Mode"
          >
            <div style={{
              width: "38px",
              height: "38px",
              borderRadius: "10px",
              backgroundColor: isRestaurant ? "#16a34a" : (isGlobalMode ? "#10b981" : "#6366f1"),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "19px",
              color: "#fff",
              boxShadow: `0 3px 8px ${isRestaurant ? "rgba(22,163,74,0.3)" : isGlobalMode ? "rgba(16,185,129,0.3)" : "rgba(99,102,241,0.3)"}`,
              flexShrink: 0
            }}>
              {isRestaurant ? "🍽️" : (isGlobalMode ? "🌐" : "🏪")}
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <h2 style={styles.sidebarBrand}>{userProfile.storeName}</h2>
                <span style={{ fontSize: "10px", color: "#64748b" }}>▼</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                <span style={{
                  backgroundColor: isRestaurant ? "#16a34a" : (isGlobalMode ? "#10b981" : "#6366f1"),
                  color: "#ffffff",
                  fontSize: "9.5px",
                  fontWeight: "800",
                  padding: "1.5px 7px",
                  borderRadius: "10px",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase"
                }}>
                  {isRestaurant ? "RESTAURANT" : isGlobalMode ? "GLOBAL SHOP" : "LOCAL SHOP"}
                </span>
                <span 
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab("subscription");
                  }}
                  style={{
                    backgroundColor: userSubscription.plan === "Pro" ? "#fef3c7" : userSubscription.plan === "Premium" ? "#ecfdf5" : "#e0e7ff",
                    color: userSubscription.plan === "Pro" ? "#b45309" : userSubscription.plan === "Premium" ? "#047857" : "#4338ca",
                    border: `1px solid ${userSubscription.plan === "Pro" ? "#fde68a" : userSubscription.plan === "Premium" ? "#a7f3d0" : "#c7d2fe"}`,
                    fontSize: "9.5px",
                    fontWeight: "800",
                    padding: "1.5px 7px",
                    borderRadius: "10px",
                    letterSpacing: "0.5px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px"
                  }}
                  title={`Active Plan: ${userSubscription.plan} (${userSubscription.remainingDays} days remaining). Click to manage subscription.`}
                >
                  👑 {userSubscription.plan.toUpperCase()}
                  {userSubscription.isExpired && " (EXPIRED)"}
                </span>
              </div>
            </div>
          </div>

          <div style={styles.searchBarContainer}>
            <span style={styles.searchIcon}>🔍</span>
            <input 
              type="text"
              placeholder={isRestaurant ? "Search food or menu items..." : `Search ${isGlobalMode ? "global" : "local"} products...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>
        </div>

        {/* Navigation Links Right Area */}
        <div style={styles.navLinks}>
          <button onClick={() => setActiveTab("sales")} style={{ ...styles.navBtn, backgroundColor: activeTab === "sales" ? "#ffedd5" : "transparent", color: activeTab === "sales" ? "#fc8019" : "#64748b" }}>
            🧾 {isRestaurant ? "Billing" : isGlobalMode ? "Global Sales" : "Sales"}
          </button>
          <button onClick={() => setActiveTab("dashboard")} style={{ ...styles.navBtn, backgroundColor: activeTab === "dashboard" ? "#ffedd5" : "transparent", color: activeTab === "dashboard" ? "#fc8019" : "#64748b" }}>
            🏠 Dashboard
          </button>
          <button onClick={() => setActiveTab("inventory")} style={{ ...styles.navBtn, backgroundColor: activeTab === "inventory" ? "#ffedd5" : "transparent", color: activeTab === "inventory" ? "#fc8019" : "#64748b" }}>
            📦 {isRestaurant ? "Menu" : isGlobalMode ? "Global Inventory" : "Inventory"}
          </button>
          <button onClick={() => setActiveTab("orders")} style={{ ...styles.navBtn, backgroundColor: activeTab === "orders" ? "#ffedd5" : "transparent", color: activeTab === "orders" ? "#fc8019" : "#64748b" }}>
            📋 Orders ({ordersList.length})
          </button>
          <button 
            onClick={() => setActiveTab("staff")} 
            style={{ 
              ...styles.navBtn, 
              backgroundColor: activeTab === "staff" ? "#ffedd5" : "transparent", 
              color: activeTab === "staff" ? "#fc8019" : "#64748b" 
            }}
          >
            👥 Staff
          </button>
          {isRestaurant && (
            <button 
              type="button"
              onClick={() => {
                setTableOrderTab("served");
                setShowTableOrdersModal(true);
              }} 
              style={{ 
                ...styles.navBtn, 
                backgroundColor: servedTableOrders.length > 0 ? "#dcfce7" : "transparent", 
                color: servedTableOrders.length > 0 ? "#15803d" : "#64748b",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontWeight: servedTableOrders.length > 0 ? "800" : "600"
              }}
              title="Live Restaurant Table & KOT Orders"
            >
              <span>🍽️ Tables</span>
              {activeKitchenOrders.length > 0 && (
                <span style={{
                  backgroundColor: servedTableOrders.length > 0 ? "#16a34a" : "#64748b",
                  color: "#ffffff",
                  borderRadius: "10px",
                  padding: "1px 7px",
                  fontSize: "11px",
                  fontWeight: "800"
                }}>
                  {servedTableOrders.length > 0 ? `🔔 ${servedTableOrders.length}` : activeKitchenOrders.length}
                </span>
              )}
            </button>
          )}
          <button 
            type="button"
            onClick={() => setShowResumeModal(true)} 
            style={{ 
              ...styles.navBtn, 
              backgroundColor: heldOrders.length > 0 ? "#fef3c7" : "transparent", 
              color: heldOrders.length > 0 ? "#b45309" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
            title="View Pending Held Bills"
          >
            <span>⏸️ Held</span>
            {heldOrders.length > 0 && (
              <span style={{
                backgroundColor: "#d97706",
                color: "#ffffff",
                borderRadius: "10px",
                padding: "1px 7px",
                fontSize: "11px",
                fontWeight: "800"
              }}>
                {heldOrders.length}
              </span>
            )}
          </button>

          {/* Profile Trigger Button */}
          <button 
            ref={profileBtnRef}
            type="button"
            onClick={toggleProfileDropdown} 
            style={{ 
              ...styles.navBtn, 
              backgroundColor: (activeTab === "profile" || activeTab === "settings" || profileDropdownOpen) ? "#ffedd5" : "transparent", 
              color: (activeTab === "profile" || activeTab === "settings" || profileDropdownOpen) ? "#fc8019" : "#64748b",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer"
            }}
          >
            <div style={{ width: "24px", height: "24px", borderRadius: "50%", overflow: "hidden", backgroundColor: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #fc8019", flexShrink: 0 }}>
              {userProfile.profileImage ? (
                <img src={userProfile.profileImage} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: "11px", fontWeight: "800", color: "#fc8019" }}>
                  {userProfile.name ? userProfile.name.charAt(0).toUpperCase() : "A"}
                </span>
              )}
            </div>
            <span>{userProfile.name ? userProfile.name.split(" ")[0] : "Profile"} ▾</span>
          </button>
        </div>
      </header>

      {/* SHOP MODE DROPDOWN PORTAL */}
      {shopModeDropdownOpen && createPortal(
        <div 
          style={{
            ...styles.portalDropdownMenu,
            top: `${shopMenuCoords.top}px`,
            left: `${shopMenuCoords.left}px`,
            minWidth: "240px"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: "8px 12px 6px", fontSize: "11px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Select Shop Mode
          </div>
          <button 
            type="button"
            onClick={() => handleSelectAppMode("local")}
            style={{
              ...styles.dropdownItem,
              backgroundColor: !isGlobalMode ? "#eef2ff" : "transparent",
              color: !isGlobalMode ? "#4f46e5" : "#334155",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "18px" }}>🏪</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: "700", fontSize: "13px" }}>Local Shop</div>
                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "500" }}>Local inventory & POS billing</div>
              </div>
            </div>
            {!isGlobalMode && <span style={{ color: "#4f46e5", fontWeight: "800", fontSize: "15px" }}>✓</span>}
          </button>
          <button 
            type="button"
            onClick={() => handleSelectAppMode("global")}
            style={{
              ...styles.dropdownItem,
              backgroundColor: isGlobalMode ? "#ecfdf5" : "transparent",
              color: isGlobalMode ? "#059669" : "#334155",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "18px" }}>🌐</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: "700", fontSize: "13px" }}>Global Shop</div>
                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "500" }}>Global inventory & orders</div>
              </div>
            </div>
            {isGlobalMode && <span style={{ color: "#059669", fontWeight: "800", fontSize: "15px" }}>✓</span>}
          </button>
        </div>,
        document.body
      )}

      {/* REACT PORTAL: Escapes all containers and renders directly in Document Body */}
      {profileDropdownOpen && createPortal(
        <div 
          style={{
            ...styles.portalDropdownMenu,
            top: `${menuCoords.top}px`,
            right: `${menuCoords.right}px`,
            maxWidth: "calc(100vw - 24px)",
            boxSizing: "border-box"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            type="button"
            onClick={() => { setActiveTab("profile"); setProfileDropdownOpen(false); }}
            style={{ ...styles.dropdownItem, backgroundColor: activeTab === "profile" ? "#fff7ed" : "transparent", color: activeTab === "profile" ? "#fc8019" : "#334155" }}
          >
            👤 My Profile
          </button>
          <button 
            type="button"
            onClick={() => { setActiveTab("settings"); setProfileDropdownOpen(false); }}
            style={{ ...styles.dropdownItem, backgroundColor: activeTab === "settings" ? "#fff7ed" : "transparent", color: activeTab === "settings" ? "#fc8019" : "#334155" }}
          >
            ⚙️ Settings
          </button>
          <button 
            type="button"
            onClick={() => { setActiveTab("subscription"); setProfileDropdownOpen(false); }}
            style={{ 
              ...styles.dropdownItem, 
              backgroundColor: activeTab === "subscription" ? "#fff7ed" : "transparent", 
              color: activeTab === "subscription" ? "#fc8019" : "#334155",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>👑</span>
              <span>Subscription & Plans</span>
            </div>
            <span style={{
              backgroundColor: userSubscription.plan === "Pro" ? "#f59e0b" : userSubscription.plan === "Premium" ? "#10b981" : "#6366f1",
              color: "#ffffff",
              borderRadius: "6px",
              padding: "1px 6px",
              fontSize: "10px",
              fontWeight: "800",
              letterSpacing: "0.5px"
            }}>
              {userSubscription.plan.toUpperCase()}
            </span>
          </button>
          <button 
            type="button"
            onClick={() => { setActiveTab("staff"); setProfileDropdownOpen(false); }}
            style={{ ...styles.dropdownItem, backgroundColor: activeTab === "staff" ? "#fff7ed" : "transparent", color: activeTab === "staff" ? "#fc8019" : "#334155" }}
          >
            👥 Staff Accounts & Roles
          </button>
          <div style={{ height: "1px", backgroundColor: "#e2e8f0", margin: "4px 0" }} />
          <a 
            href="/waiter"
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...styles.dropdownItem, textDecoration: "none", color: "#0284c7", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>🍽️ Open Waiter Portal</span>
            <span style={{ fontSize: "11px" }}>↗</span>
          </a>
          <a 
            href="/kitchen"
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...styles.dropdownItem, textDecoration: "none", color: "#ea580c", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>👨‍🍳 Open Kitchen Display (KDS)</span>
            <span style={{ fontSize: "11px" }}>↗</span>
          </a>
          <div style={{ height: "1px", backgroundColor: "#e2e8f0", margin: "4px 0" }} />
          <button 
            type="button"
            onClick={() => { setProfileDropdownOpen(false); handleLogout(); }}
            style={{ ...styles.dropdownItem, backgroundColor: "transparent", color: "#dc2626" }}
          >
            🚪 Logout
          </button>
        </div>,
        document.body
      )}

      {/* Main Content Area */}
      <div style={{
        ...styles.mainContent,
        ...(activeTab === "sales" ? { minHeight: 0, overflow: "hidden" } : {})
      }}>
        {/* TAB 1: POS TERMINAL */}
        {activeTab === "sales" && (
          <div style={styles.posLayout}>
            {/* LEFT SIDE: Current Bill / Cart Summary (Full Height) */}
            <div style={styles.posLeftPane}>
              <div style={styles.posHeaderTop}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#0f172a" }}>
                    {totalBillItemsCount} {isRestaurant ? "Food Items" : "Items"}
                  </h3>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: "800",
                    padding: "2px 7px",
                    borderRadius: "10px",
                    backgroundColor: isRestaurant ? "#f0fdf4" : isGlobalMode ? "#ecfdf5" : "#eef2ff",
                    color: isRestaurant ? "#16a34a" : isGlobalMode ? "#059669" : "#4f46e5"
                  }}>
                    {isRestaurant ? "RESTAURANT POS" : isGlobalMode ? "🌐 GLOBAL POS" : "🏪 LOCAL POS"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {isRestaurant && (
                    <button 
                      type="button"
                      onClick={() => {
                        setTableOrderTab(servedTableOrders.length > 0 ? "served" : "kitchen");
                        setShowTableOrdersModal(true);
                      }} 
                      style={{
                        backgroundColor: servedTableOrders.length > 0 ? "#dcfce7" : "#f1f5f9",
                        border: servedTableOrders.length > 0 ? "1.5px solid #86efac" : "1.5px solid #cbd5e1",
                        color: servedTableOrders.length > 0 ? "#15803d" : "#475569",
                        padding: "4px 10px",
                        borderRadius: "8px",
                        fontWeight: "800",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px"
                      }}
                      title="View Live Table Orders & KOT"
                    >
                      <span>🍽️ TABLES</span>
                      {activeKitchenOrders.length > 0 && (
                        <span style={{
                          backgroundColor: servedTableOrders.length > 0 ? "#16a34a" : "#64748b",
                          color: "#fff",
                          borderRadius: "10px",
                          padding: "0 6px",
                          fontSize: "10.5px",
                          fontWeight: "800"
                        }}>
                          {servedTableOrders.length > 0 ? `🔔 ${servedTableOrders.length}` : activeKitchenOrders.length}
                        </span>
                      )}
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => setShowResumeModal(true)} 
                    style={{
                      backgroundColor: heldOrders.length > 0 ? "#fef3c7" : "#f8fafc",
                      border: heldOrders.length > 0 ? "1.5px solid #fde68a" : "1.5px solid #e2e8f0",
                      color: heldOrders.length > 0 ? "#b45309" : "#64748b",
                      padding: "4px 10px",
                      borderRadius: "8px",
                      fontWeight: "700",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px"
                    }}
                    title="View Held Bills"
                  >
                    <span>⏸️ HELD</span>
                    {heldOrders.length > 0 && (
                      <span style={{
                        backgroundColor: "#d97706",
                        color: "#fff",
                        borderRadius: "10px",
                        padding: "0 6px",
                        fontSize: "10.5px",
                        fontWeight: "800"
                      }}>
                        {heldOrders.length}
                      </span>
                    )}
                  </button>
                  <button 
                    type="button"
                    onClick={handleHoldOrder} 
                    disabled={currentBill.length === 0}
                    style={{
                      backgroundColor: currentBill.length === 0 ? "#f8fafc" : "#fff7ed",
                      border: currentBill.length === 0 ? "1.5px solid #e2e8f0" : "1.5px solid #fed7aa",
                      color: currentBill.length === 0 ? "#94a3b8" : "#ea580c",
                      padding: "4px 10px",
                      borderRadius: "8px",
                      fontWeight: "700",
                      fontSize: "12px",
                      cursor: currentBill.length === 0 ? "not-allowed" : "pointer"
                    }}
                    title="Hold Current Bill"
                  >
                    ⏸️ HOLD
                  </button>
                  <button onClick={clearCurrentBill} style={styles.clearCartBtn}>CLEAR ✕</button>
                </div>
              </div>

              {/* Active Table Order Link Banner */}
              {activeTableOrderId && activeTableOrderInfo && (
                <div style={{
                  backgroundColor: "#eff6ff",
                  borderBottom: "1.5px solid #bfdbfe",
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px" }}>{activeTableOrderInfo.isParcel ? "🥡" : "🍽️"}</span>
                    <div>
                      <div style={{ fontSize: "12.5px", fontWeight: "800", color: "#1e40af" }}>
                        Billing Active: {activeTableOrderInfo.isParcel ? `PARCEL (${activeTableOrderInfo.customerName || "Takeaway"})` : activeTableOrderInfo.tableNo ? activeTableOrderInfo.tableNo : "Counter Order"}
                      </div>
                      <div style={{ fontSize: "11px", color: "#3b82f6" }}>
                        Staff: {activeTableOrderInfo.waiterName || "Staff"} • #{activeTableOrderInfo.orderNumber || "KOT"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Unlink table order from current cart? (Items will stay)")) {
                        setActiveTableOrderId(null);
                        setActiveTableOrderInfo(null);
                      }
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      fontSize: "11px",
                      fontWeight: "700",
                      padding: "3px 6px"
                    }}
                  >
                    Unlink ✕
                  </button>
                </div>
              )}

              <div style={styles.posBillItemsList}>
                {currentBill.length === 0 ? (
                  <div style={styles.posEmptyBox}>
                    <p style={{ color: "#94a3b8", fontSize: "14px" }}>{isRestaurant ? "No food items in current order" : "No items in current bill"}</p>
                    <span style={{ fontSize: "28px" }}>{isRestaurant ? "🍽️" : "🧾"}</span>
                  </div>
                ) : (
                  currentBill.map((item, idx) => (
                    <div key={item.id || item.barcode || idx} style={styles.posBillRow}>
                      <img 
                        src={item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} 
                        alt={item.name || item.itemName} 
                        style={styles.posRowImg}
                        onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                      />
                      <div style={{ flex: 1, marginLeft: "10px", minWidth: 0 }}>
                        <h5 style={styles.posRowTitle}>{item.name || item.itemName}</h5>
                        <p style={styles.posRowSub}>₹{item.salesPrice || item.price || 0}</p>
                      </div>

                      {/* Pill Shaped - 1 + Control UI matching exact reference */}
                      <div style={styles.cartQtyPill}>
                        <button onClick={() => removeFromCurrentBill(item.id || item.barcode)} style={styles.cartQtyBtn}>-</button>
                        <span style={styles.cartQtyNum}>{item.qty}</span>
                        <button onClick={() => addToCurrentBill(item)} style={styles.cartQtyBtn}>+</button>
                      </div>

                      <div style={{ textAlign: "right", marginLeft: "10px" }}>
                        <span style={styles.posRowPrice}>₹{(item.salesPrice || item.price || 0) * item.qty}</span>
                      </div>
                      <div style={styles.posRowActions}>
                        <button onClick={() => deleteFromCurrentBill(item.id || item.barcode)} style={styles.deleteRowBtn}>🗑️</button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={styles.posBillFooter}>
                <div style={styles.posTotalRow}>
                  <span>Total / மொத்தம்:</span>
                  <span style={styles.posTotalPrice}>₹{totalBillAmount}.00</span>
                </div>
                {isRestaurant && (
                  <button 
                    type="button"
                    onClick={() => {
                      setDirectParcelName(customerName || "");
                      setShowDirectParcelModal(true);
                    }}
                    disabled={currentBill.length === 0}
                    style={{ 
                      width: "100%", 
                      padding: "10px", 
                      marginBottom: "10px",
                      backgroundColor: currentBill.length === 0 ? "#f8fafc" : "#ffedd5", 
                      color: currentBill.length === 0 ? "#94a3b8" : "#c2410c", 
                      border: currentBill.length === 0 ? "1.5px solid #e2e8f0" : "1.5px solid #fdba74", 
                      borderRadius: "10px", 
                      fontWeight: "800", 
                      fontSize: "13px", 
                      cursor: currentBill.length === 0 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px"
                    }}
                    title="Send KOT to Kitchen & Packing Staff (No amounts shown to kitchen)"
                  >
                    <span>🥡</span>
                    <span>Send Parcel to Kitchen / Packing (KOT)</span>
                  </button>
                )}
                <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                  <button 
                    type="button"
                    style={{ 
                      flex: 1, 
                      padding: "14px 10px", 
                      backgroundColor: currentBill.length === 0 ? "#f8fafc" : "#fff7ed", 
                      color: currentBill.length === 0 ? "#94a3b8" : "#ea580c", 
                      border: currentBill.length === 0 ? "1.5px solid #e2e8f0" : "1.5px solid #fed7aa", 
                      borderRadius: "12px", 
                      fontWeight: "800", 
                      fontSize: "13.5px", 
                      cursor: currentBill.length === 0 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px"
                    }}
                    disabled={currentBill.length === 0}
                    onClick={handleHoldOrder}
                    title="Place active bill on hold"
                  >
                    <span>⏸️</span>
                    <span>Hold / நிறுத்திவை</span>
                  </button>
                  <button 
                    style={{ 
                      flex: 2, 
                      padding: "14px 16px", 
                      backgroundColor: "#2563eb", 
                      color: "#fff", 
                      border: "none", 
                      borderRadius: "12px", 
                      fontWeight: "800", 
                      fontSize: "15px", 
                      cursor: currentBill.length === 0 ? "not-allowed" : "pointer", 
                      textAlign: "center", 
                      boxShadow: currentBill.length === 0 ? "none" : "0 4px 14px rgba(37, 99, 235, 0.28)",
                      opacity: currentBill.length === 0 ? 0.5 : 1
                    }} 
                    disabled={currentBill.length === 0}
                    onClick={() => setIsCheckoutModalOpen(true)}
                  >
                    CONTINUE தொடரவும் →
                  </button>
                </div>

                {/* SPEED DIAL SECTION (1 - 8 FAST SELLING PRODUCTS) */}
                <div style={styles.speedDialSection}>
                  <button 
                    type="button" 
                    onClick={toggleSpeedDialVisibility}
                    style={styles.speedDialToggleBtn}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px" }}>⚡</span>
                      <span style={{ fontWeight: "800", fontSize: "13px", color: "#0f172a" }}>
                        Speed Dial / விரைவு பில் (Keys 1 - 8)
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "10.5px", fontWeight: "800", color: "#4f46e5", backgroundColor: "#eef2ff", padding: "2px 8px", borderRadius: "10px" }}>
                        Fast Selling Items
                      </span>
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "800" }}>
                        {showSpeedDial ? "▲" : "▼"}
                      </span>
                    </div>
                  </button>

                  {showSpeedDial && (
                    <div style={styles.speedDialBody}>
                      <div style={styles.speedDialGrid}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((slotNum) => {
                          const item = speedDialSlots[slotNum];
                          const hasItem = !!(item && (item.name || item.itemName));
                          const isTapped = recentlyTappedSlot === slotNum;

                          return (
                            <div 
                              key={slotNum}
                              onClick={() => handleSpeedDialClick(slotNum)}
                              style={{
                                ...styles.speedDialKeyBtn,
                                backgroundColor: isTapped ? "#e0e7ff" : (hasItem ? "#ffffff" : "#f8fafc"),
                                borderColor: isTapped ? "#4f46e5" : (hasItem ? "#c7d2fe" : "#e2e8f0"),
                                transform: isTapped ? "scale(0.96)" : "scale(1)"
                              }}
                              title={hasItem ? `${item.name || item.itemName} (₹${item.salesPrice || item.price || 0}) - Click or press [${slotNum}] on keyboard to add to bill` : `Slot #${slotNum} (Empty) - Click to assign product`}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                                <span style={{
                                  ...styles.speedDialKeyNum,
                                  backgroundColor: hasItem ? "#4f46e5" : "#94a3b8"
                                }}>
                                  {slotNum}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedSlotForConfig(slotNum);
                                    setIsConfiguringSpeedDial(true);
                                  }}
                                  style={styles.speedDialSlotCog}
                                  title="Change or set item"
                                >
                                  {hasItem ? "⚙️" : "+"}
                                </button>
                              </div>

                              {hasItem ? (
                                <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: "3px" }}>
                                  <span style={styles.speedDialItemName} title={item.name || item.itemName}>
                                    {item.name || item.itemName}
                                  </span>
                                  <span style={styles.speedDialItemPrice}>
                                    ₹{item.salesPrice || item.price || 0}
                                  </span>
                                </div>
                              ) : (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "30px", width: "100%" }}>
                                  <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "700" }}>+ Set Item</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", padding: "0 2px" }}>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          💡 Keyboard shortcut: <strong>1 - 8</strong> எண்களை அழுத்தினால் பில்லில் சேரும்
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSlotForConfig(1);
                            setIsConfiguringSpeedDial(true);
                          }}
                          style={{ background: "transparent", border: "none", color: "#4f46e5", fontSize: "11px", fontWeight: "800", cursor: "pointer", textDecoration: "underline" }}
                        >
                          Manage Slots ⚙️
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT SIDE: Products Grid Matching Image 2 */}
            <div style={styles.posRightPane}>
              {/* LIVE TABLE & PARCEL ORDERS READY FOR BILLING BANNER */}
              {isRestaurant && servedTableOrders.length > 0 && (() => {
                const tableOrdersList = servedTableOrders.filter((o) => getOrderClassification(o).isTable);
                const parcelOrdersList = servedTableOrders.filter((o) => getOrderClassification(o).isParcel);
                const bannerTitle =
                  tableOrdersList.length > 0 && parcelOrdersList.length > 0
                    ? `${servedTableOrders.length} Orders Ready to Bill (${tableOrdersList.length} Tables, ${parcelOrdersList.length} Parcels) 🧾`
                    : tableOrdersList.length > 0
                    ? `${tableOrdersList.length} Table Order${tableOrdersList.length > 1 ? "s" : ""} Served — Ready to Bill! 🧾`
                    : `${parcelOrdersList.length} Parcel Order${parcelOrdersList.length > 1 ? "s" : ""} Ready & Packed! 🥡`;

                const namesSummary = servedTableOrders
                  .map((o) => {
                    const c = getOrderClassification(o);
                    return c.isParcel ? `🥡 PARCEL: ${c.customerName}` : `🍽️ ${c.tableNo}`;
                  })
                  .join(", ");

                return (
                  <div
                    onClick={() => {
                      setTableOrderTab("served");
                      setShowTableOrdersModal(true);
                    }}
                    style={{
                      backgroundColor: "#ecfdf5",
                      border: "1.5px solid #6ee7b7",
                      borderRadius: "14px",
                      padding: "12px 18px",
                      marginBottom: "16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      boxShadow: "0 4px 14px rgba(16, 185, 129, 0.15)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "38px", height: "38px", borderRadius: "10px", backgroundColor: "#10b981", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>
                        🔔
                      </div>
                      <div>
                        <div style={{ fontWeight: "800", color: "#065f46", fontSize: "14px" }}>
                          {bannerTitle}
                        </div>
                        <div style={{ fontSize: "12px", color: "#047857" }}>
                          {namesSummary} • Ready for counter billing. Click to load bill with amounts & print!
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        backgroundColor: "#059669",
                        color: "#ffffff",
                        padding: "8px 16px",
                        borderRadius: "10px",
                        fontWeight: "800",
                        fontSize: "12.5px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span>Bill Orders ({servedTableOrders.length})</span>
                      <span>→</span>
                    </div>
                  </div>
                );
              })()}

              {/* Top Compact Stat Cards Row & Welcome Banner on Right Side */}
              <div style={styles.salesStatsBanner}>
                {/* Top Row: Welcome & Subtitle + Timeframe Selector */}
                <div style={styles.salesStatsHeaderRow}>
                  <div>
                    <h2 style={styles.salesStatsWelcomeTitle}>
                      Welcome back, {userProfile.name ? userProfile.name.split(" ")[0] : (isRestaurant ? "Chef" : "Owner")}! 👋
                    </h2>
                    <p style={styles.salesStatsWelcomeSub}>
                      Here's what's happening with your {isRestaurant ? "restaurant" : "store"} today.
                    </p>
                  </div>

                  <div style={styles.statsTimeframePill}>
                    <button
                      type="button"
                      onClick={() => setStatsTimeframe("today")}
                      style={{
                        ...styles.statsTimeframeBtn,
                        backgroundColor: statsTimeframe === "today" ? "#0d9488" : "transparent",
                        color: statsTimeframe === "today" ? "#ffffff" : "#64748b",
                        fontWeight: statsTimeframe === "today" ? "700" : "600"
                      }}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatsTimeframe("all")}
                      style={{
                        ...styles.statsTimeframeBtn,
                        backgroundColor: statsTimeframe === "all" ? "#0d9488" : "transparent",
                        color: statsTimeframe === "all" ? "#ffffff" : "#64748b",
                        fontWeight: statsTimeframe === "all" ? "700" : "600"
                      }}
                    >
                      All Time
                    </button>
                  </div>
                </div>

                {/* 4 Compact Analytics Metric Cards Grid */}
                <div style={styles.salesStatsCardsGrid}>
                  {/* CARD 1: Total Sales */}
                  <div style={styles.salesStatCard}>
                    <div style={styles.statCardHeader}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                        <div style={styles.statCardIconCircle}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a4.5 4.5 0 0 0 0-9"/>
                          </svg>
                        </div>
                        <span style={styles.statCardTitle}>Total Sales</span>
                      </div>
                      <span style={styles.statCardThreeDots} title="Total revenue from sales">⋮</span>
                    </div>
                    <div style={styles.statCardValue}>{statTotalSalesText}</div>
                    <div style={styles.statCardSubtext}>
                      <span style={styles.statCardArrowUp}>↑</span> {statSalesGrowth}
                    </div>
                  </div>

                  {/* CARD 2: Orders */}
                  <div style={styles.salesStatCard}>
                    <div style={styles.statCardHeader}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                        <div style={styles.statCardIconCircle}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="4" width="14" height="16" rx="2"/>
                            <path d="M9 4a2 2 0 0 1 4 0"/>
                            <path d="M9 12l2 2 4-4"/>
                          </svg>
                        </div>
                        <span style={styles.statCardTitle}>Orders</span>
                      </div>
                      <span style={styles.statCardThreeDots} title="Total number of orders">⋮</span>
                    </div>
                    <div style={styles.statCardValue}>{statOrdersText}</div>
                    <div style={styles.statCardSubtext}>
                      <span style={styles.statCardArrowUp}>↑</span> {statOrdersGrowth}
                    </div>
                  </div>

                  {/* CARD 3: Customers */}
                  <div style={styles.salesStatCard}>
                    <div style={styles.statCardHeader}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                        <div style={styles.statCardIconCircle}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                        </div>
                        <span style={styles.statCardTitle}>Customers</span>
                      </div>
                      <span style={styles.statCardThreeDots} title="Total unique customers">⋮</span>
                    </div>
                    <div style={styles.statCardValue}>{statCustomersText}</div>
                    <div style={styles.statCardSubtext}>
                      <span style={styles.statCardArrowUp}>↑</span> {statCustomersGrowth}
                    </div>
                  </div>

                  {/* CARD 4: Avg. Order Value */}
                  <div style={styles.salesStatCard}>
                    <div style={styles.statCardHeader}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
                        <div style={styles.statCardIconCircle}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                            <line x1="3" y1="6" x2="21" y2="6"/>
                            <path d="M16 10a4 4 0 0 1-8 0"/>
                          </svg>
                        </div>
                        <span style={styles.statCardTitle}>Avg. Order Value</span>
                      </div>
                      <span style={styles.statCardThreeDots} title="Average sale value per order">⋮</span>
                    </div>
                    <div style={styles.statCardValue}>{statAvgOrderText}</div>
                    <div style={styles.statCardSubtext}>
                      <span style={styles.statCardArrowUp}>↑</span> {statAvgGrowth}
                    </div>
                  </div>
                </div>
              </div>

              <div style={styles.categoryScroll}>
                {categories.map((cat, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      ...styles.categoryCard,
                      backgroundColor: selectedCategory === cat ? "#fc8019" : "#ffffff",
                      color: selectedCategory === cat ? "#ffffff" : "#334155",
                      boxShadow: selectedCategory === cat ? "0 4px 12px rgba(252, 128, 25, 0.4)" : "0 2px 6px rgba(0,0,0,0.05)"
                    }}
                  >
                    <span>{cat}</span>
                  </div>
                ))}
              </div>

              <h2 style={styles.sectionTitle}>
                {isRestaurant ? `Available Foods (${filteredProducts.length})` : `Available Products (${filteredProducts.length})`}
              </h2>

              {loading ? (
                <div style={styles.centerBox}>{isRestaurant ? "Loading menu items..." : "Loading products..."}</div>
              ) : filteredProducts.length === 0 ? (
                <div style={styles.centerBox}>{isRestaurant ? "No food items found ❌" : "No products found ❌"}</div>
              ) : (
                <div style={styles.productGrid}>
                  {filteredProducts.map((item) => {
                    const itemName = item.itemName || item.name || "Unnamed Item";
                    const priceVal = item.salesPrice || item.price || 0;
                    const stock = item.quantity !== undefined ? item.quantity : (item.isAvailable !== false ? "In Stock" : "Out of Stock");
                    const imageVal = item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
                    
                    const existingBillItem = currentBill.find(b => (b.id && b.id === item.id) || (b.barcode && b.barcode === item.barcode));
                    const itemQtyInBill = existingBillItem ? existingBillItem.qty : 0;

                    return (
                      <div key={item.id} style={styles.productCard}>
                        {/* Interactive Image Area: Click image adds to cart */}
                        <div 
                          style={{
                            ...styles.imageWrapper,
                            cursor: "pointer"
                          }}
                          onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })}
                          title={`Click image to add "${itemName}" to bill`}
                        >
                          <img 
                            src={imageVal} 
                            alt={itemName} 
                            style={styles.productImg} 
                            onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                          />
                          <span style={styles.stockBadge}>{typeof stock === "number" ? `Stock: ${stock}` : stock}</span>
                          {/* Redesigned Red Circular Quantity Badge with Micro-Animation */}
                          {itemQtyInBill > 0 && (
                            <span 
                              key={itemQtyInBill}
                              className="animate-badge-pop"
                              style={styles.inCartBadge}
                              title={`${itemQtyInBill} in current cart`}
                            >
                              {itemQtyInBill}
                            </span>
                          )}
                        </div>
                        <div style={styles.productDetails}>
                          <h4 style={styles.productName} title={itemName}>{itemName}</h4>
                          <p style={styles.productCategory}>₹{priceVal}</p>
                          {itemQtyInBill === 0 ? (
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addToCurrentBill({ ...item, name: itemName, price: priceVal });
                              }} 
                              style={styles.addBillBtn}
                            >
                              {isRestaurant ? "+ Add to Order" : "+ Add to POS Bill"}
                            </button>
                          ) : (
                            <div style={styles.posCardQtyControl} onClick={(e) => e.stopPropagation()}>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFromCurrentBill(item.id || item.barcode);
                                }} 
                                style={styles.posCardQtyBtn}
                                title="Decrease"
                              >
                                -
                              </button>
                              <span style={styles.posCardQtyVal}>{itemQtyInBill}</span>
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addToCurrentBill({ ...item, name: itemName, price: priceVal });
                                }} 
                                style={styles.posCardQtyBtn}
                                title="Add more"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PROFILE PAGE TAB */}
        {activeTab === "profile" && (
          <Profile 
            userProfile={userProfile} 
            setUserProfile={setUserProfile} 
            storeSettings={storeSettings} 
            setStoreSettings={setStoreSettings} 
            setPopupModal={setPopupModal} 
          />
        )}

        {/* SETTINGS PAGE TAB */}
        {activeTab === "settings" && (
          <Settings 
            userProfile={userProfile} 
            setUserProfile={setUserProfile} 
            storeSettings={storeSettings} 
            setStoreSettings={setStoreSettings} 
            printSettings={printSettings}
            setPrintSettings={setPrintSettings}
            setPopupModal={setPopupModal} 
          />
        )}

        {/* SUBSCRIPTION PAGE TAB */}
        {activeTab === "subscription" && (
          <Subscription 
            onBack={() => setActiveTab("sales")}
            onSubscriptionUpdated={async () => {
              const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
              if (currentUid) {
                const snap = await getDoc(doc(db, "users", currentUid));
                if (snap.exists()) setRawUserData(snap.data());
              }
            }}
            inventoryCount={products.length}
          />
        )}

        {/* STAFF MANAGEMENT TAB */}
        {activeTab === "staff" && (
          <StaffManagement onBack={() => setActiveTab("sales")} />
        )}

        {/* TAB 2: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div style={{ padding: "24px", paddingBottom: "80px", maxWidth: "1400px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <h2 style={styles.sectionTitle}>{isRestaurant ? "Food Categories" : "Shop Categories"}</h2>
            <div style={styles.categoryScroll}>
              {categories.map((cat, idx) => (
                <div 
                  key={idx} 
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    ...styles.categoryCard,
                    backgroundColor: selectedCategory === cat ? "#fc8019" : "#ffffff",
                    color: selectedCategory === cat ? "#ffffff" : "#334155"
                  }}
                >
                  <span>{cat}</span>
                </div>
              ))}
            </div>

            <h2 style={styles.sectionTitle}>{isRestaurant ? `Available Foods (${filteredProducts.length})` : `Available Products (${filteredProducts.length})`}</h2>

            <div style={styles.productGrid}>
              {filteredProducts.map((item) => {
                const itemName = item.itemName || item.name || "Unnamed Item";
                const priceVal = item.salesPrice || item.price || 0;
                const stock = item.quantity !== undefined ? item.quantity : (item.isAvailable !== false ? "In Stock" : "Out of Stock");
                const imageVal = item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
                
                return (
                  <div key={item.id} style={styles.productCard}>
                    <div style={styles.imageWrapper}>
                      <img 
                        src={imageVal} 
                        alt={itemName} 
                        style={styles.productImg} 
                        onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                      />
                      <span style={styles.stockBadge}>{typeof stock === "number" ? `Stock: ${stock}` : stock}</span>
                    </div>
                    <div style={styles.productDetails}>
                      <h4 style={styles.productName}>{itemName}</h4>
                      <p style={styles.productCategory}>₹{priceVal}</p>
                      <button onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} style={styles.addBillBtn}>{isRestaurant ? "+ Add to Order" : "+ Add to POS Bill"}</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FLOATING BAR */}
            {totalBillItemsCount > 0 && (
              <div style={styles.floatingBar} onClick={() => setActiveTab("sales")}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ backgroundColor: "#fff", color: "#fc8019", padding: "4px 10px", borderRadius: "20px", fontWeight: "800", fontSize: "13px" }}>
                    {totalBillItemsCount} items
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: "700" }}>Total: ₹{totalBillAmount}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: "800", fontSize: "14px" }}>
                  <span>Open POS Terminal</span>
                  <span>→</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: STORE INVENTORY */}
        {activeTab === "inventory" && (
          <div style={{ padding: "30px", maxWidth: "1400px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                  {isRestaurant ? "🍽️ Restaurant Menu Management" : isGlobalMode ? "🌐 Global Inventory Management" : "🏪 Local Store Inventory Management"}
                </h2>
                <span style={{
                  fontSize: "11px",
                  fontWeight: "800",
                  padding: "3px 10px",
                  borderRadius: "12px",
                  backgroundColor: isRestaurant ? "#f0fdf4" : isGlobalMode ? "#ecfdf5" : "#eef2ff",
                  color: isRestaurant ? "#16a34a" : isGlobalMode ? "#059669" : "#4f46e5",
                  border: "1px solid " + (isRestaurant ? "#bbf7d0" : isGlobalMode ? "#a7f3d0" : "#c7d2fe")
                }}>
                  {isRestaurant ? "MENU" : isGlobalMode ? "GLOBAL" : "LOCAL"} ({products.length} Items)
                </span>
              </div>
              <button onClick={openAddModal} style={styles.addNewBtn}>
                {isRestaurant ? "+ Add New Food" : isGlobalMode ? "+ Add Global Product" : "+ Add Local Product"}
              </button>
            </div>
            {products.length === 0 ? (
              <div style={styles.centerBox}>
                No {isRestaurant ? "food items" : isGlobalMode ? "global products" : "local products"} found. Click above to add your first item!
              </div>
            ) : (
              <div style={styles.productGrid}>
                {products.map((item) => (
                  <div key={item.id} style={styles.productCard}>
                    <div style={styles.imageWrapper}>
                      <img 
                        src={item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} 
                        alt={item.name || item.itemName} 
                        style={styles.productImg} 
                        onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                      />
                      <span style={styles.stockBadge}>
                        {typeof item.quantity === "number" ? `Stock: ${item.quantity}` : (item.isAvailable !== false ? "In Stock" : "Unavailable")}
                      </span>
                    </div>
                    <div style={styles.productDetails}>
                      <h4 style={styles.productName}>{item.itemName || item.name}</h4>
                      <p style={styles.productCategory}>₹{item.salesPrice || item.price || 0}</p>
                      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                        <button onClick={() => openEditModal(item)} style={styles.editCardBtn}>✏️ Edit</button>
                        <button onClick={() => handleDeleteProduct(item.id)} style={styles.deleteCardBtn}>🗑️ Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ORDERS */}
        {activeTab === "orders" && (() => {
          const localOrdersCount = ordersList.filter(o => (o.isGlobalMode || false) === false && o.appMode !== "global").length;
          const globalOrdersCount = ordersList.filter(o => o.isGlobalMode === true || o.appMode === "global").length;
          const displayedOrders = ordersList.filter(o => {
            if (orderModeFilter === "all") return true;
            const isOrdGlobal = o.isGlobalMode === true || o.appMode === "global";
            if (orderModeFilter === "local") return !isOrdGlobal;
            if (orderModeFilter === "global") return isOrdGlobal;
            return isGlobalMode ? isOrdGlobal : !isOrdGlobal;
          });

          return (
            <div style={{ padding: "30px", maxWidth: "1000px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                  {isRestaurant ? "📋 Restaurant Orders & Bills" : isGlobalMode ? "🌐 Global Orders & Billing" : "🏪 Local Orders & Billing"}
                </h2>
              </div>

              {/* Order Mode Filter Pills */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
                <button 
                  onClick={() => setOrderModeFilter("current")} 
                  style={{
                    padding: "6px 14px",
                    borderRadius: "20px",
                    border: "1.5px solid " + (orderModeFilter === "current" ? (isGlobalMode ? "#10b981" : "#6366f1") : "#e2e8f0"),
                    backgroundColor: orderModeFilter === "current" ? (isGlobalMode ? "#ecfdf5" : "#eef2ff") : "#fff",
                    color: orderModeFilter === "current" ? (isGlobalMode ? "#059669" : "#4f46e5") : "#64748b",
                    fontWeight: "700",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  Current Active Mode ({isGlobalMode ? `Global: ${globalOrdersCount}` : `Local: ${localOrdersCount}`})
                </button>

                <button 
                  onClick={() => setOrderModeFilter("local")} 
                  style={{
                    padding: "6px 14px",
                    borderRadius: "20px",
                    border: "1.5px solid " + (orderModeFilter === "local" ? "#6366f1" : "#e2e8f0"),
                    backgroundColor: orderModeFilter === "local" ? "#eef2ff" : "#fff",
                    color: orderModeFilter === "local" ? "#4f46e5" : "#64748b",
                    fontWeight: "700",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  🏪 Local Orders ({localOrdersCount})
                </button>

                <button 
                  onClick={() => setOrderModeFilter("global")} 
                  style={{
                    padding: "6px 14px",
                    borderRadius: "20px",
                    border: "1.5px solid " + (orderModeFilter === "global" ? "#10b981" : "#e2e8f0"),
                    backgroundColor: orderModeFilter === "global" ? "#ecfdf5" : "#fff",
                    color: orderModeFilter === "global" ? "#059669" : "#64748b",
                    fontWeight: "700",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  🌐 Global Orders ({globalOrdersCount})
                </button>

                <button 
                  onClick={() => setOrderModeFilter("all")} 
                  style={{
                    padding: "6px 14px",
                    borderRadius: "20px",
                    border: "1.5px solid " + (orderModeFilter === "all" ? "#0f172a" : "#e2e8f0"),
                    backgroundColor: orderModeFilter === "all" ? "#f1f5f9" : "#fff",
                    color: orderModeFilter === "all" ? "#0f172a" : "#64748b",
                    fontWeight: "700",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  All Orders ({ordersList.length})
                </button>
              </div>

              {displayedOrders.length === 0 ? (
                <div style={styles.centerBox}>
                  No {orderModeFilter === "local" ? "local" : orderModeFilter === "global" ? "global" : ""} orders recorded yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {displayedOrders.map((order, idx) => {
                    const isOrdGlobal = order.isGlobalMode === true || order.appMode === "global";
                    const classification = getOrderClassification(order);
                    return (
                      <div key={order.id || idx} onClick={() => setSelectedOrderDetails(order)} style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: "10px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                            <h4 style={{ margin: 0, fontSize: "16px" }}>Order ID: #{order.id.slice(-6).toUpperCase()}</h4>
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "10px",
                              fontWeight: "800",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              backgroundColor: isOrdGlobal ? "#ecfdf5" : "#eef2ff",
                              color: isOrdGlobal ? "#059669" : "#4f46e5"
                            }}>
                              {isOrdGlobal ? "🌐 Global" : "🏪 Local"}
                            </span>
                            {classification.isTable && (
                              <span style={{
                                fontSize: "10px",
                                fontWeight: "800",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                backgroundColor: "#e0f2fe",
                                color: "#0369a1"
                              }}>
                                🍽️ {classification.tableNo}
                              </span>
                            )}
                            {classification.isParcel && (
                              <span style={{
                                fontSize: "10px",
                                fontWeight: "800",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                backgroundColor: "#fef3c7",
                                color: "#b45309"
                              }}>
                                🥡 PARCEL
                              </span>
                            )}
                          </div>
                          <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#64748b" }}>
                            Customer: {order.customerName || "Walk-in"}
                            {classification.isTable ? ` | Table: ${classification.tableNo}` : classification.isParcel ? ` | PARCEL` : ""}
                            {" | Payment: " + (order.paymentMethod || order.paymentMode || "Cash")}
                          </p>
                          <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>Total: <strong style={{ color: "#fc8019" }}>₹{order.totalAmount || order.total}</strong></p>
                        </div>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                          <button 
                            type="button"
                            onClick={() => handlePrintBill(order, "posReceipt")} 
                            style={styles.printBillBtn}
                            title="Print Thermal Receipt"
                          >
                            🧾 Receipt
                          </button>
                          <button 
                            type="button"
                            onClick={() => handlePrintBill(order, "salesInvoice")} 
                            style={{ ...styles.printBillBtn, backgroundColor: "#0f172a", color: "#ffffff", borderColor: "#0f172a" }}
                            title="Print A4 / Sheet Tax Invoice"
                          >
                            📄 Invoice
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* HOLD ORDER MODAL */}
      {showHoldModal && (
        <div style={styles.modalOverlay} onClick={() => setShowHoldModal(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "460px" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "20px" }}>⏸️</span>
                <h3 style={{ margin: 0, color: "#0f172a", fontSize: "18px", fontWeight: "800" }}>
                  Hold Current Bill / பில் நிறுத்திவை
                </h3>
              </div>
              <button onClick={() => setShowHoldModal(false)} style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", fontWeight: "800" }}>✕</button>
            </div>

            <div style={{ backgroundColor: "#fff7ed", padding: "12px 16px", borderRadius: "10px", border: "1px solid #fed7aa", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontSize: "13.5px", fontWeight: "700", color: "#9a3412" }}>
                Bill Summary: {totalBillItemsCount} items
              </span>
              <span style={{ fontSize: "18px", fontWeight: "800", color: "#fc8019" }}>
                ₹{totalBillAmount}.00
              </span>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleConfirmHoldOrder(); }} style={styles.modalForm}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>
                  {isRestaurant ? "Table Number / Order Name / Customer" : "Customer Name / Note (Optional)"}
                </label>
                <input 
                  type="text" 
                  placeholder={isRestaurant ? "e.g. Table 4 / Ramesh / Order #2" : "e.g. Ramesh / Guest"} 
                  value={holdCustomerName} 
                  onChange={(e) => setHoldCustomerName(e.target.value)} 
                  style={styles.modalInput} 
                  autoFocus
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Customer Phone (Optional)</label>
                <input 
                  type="tel" 
                  placeholder="10-digit mobile number" 
                  value={holdCustomerPhone} 
                  onChange={(e) => setHoldCustomerPhone(e.target.value)} 
                  style={styles.modalInput} 
                />
              </div>

              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b", lineHeight: "1.4" }}>
                Holding this bill clears the active cart so you can serve the next customer. You can restore this bill anytime from the <strong>Held Bills</strong> button.
              </p>

              <div style={styles.modalBtns}>
                <button type="submit" style={{ ...styles.saveModalBtn, backgroundColor: "#ea580c" }}>
                  Confirm Hold ⏸️
                </button>
                <button type="button" onClick={() => setShowHoldModal(false)} style={styles.cancelModalBtn}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HELD BILLS LIST MODAL */}
      {showResumeModal && (
        <div style={styles.modalOverlay} onClick={() => setShowResumeModal(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "620px", maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "22px" }}>⏸️</span>
                <h3 style={{ margin: 0, color: "#0f172a", fontSize: "18px", fontWeight: "800" }}>
                  Pending Held Bills / நிலுவை பில்கள்
                </h3>
                <span style={{
                  backgroundColor: heldOrders.length > 0 ? "#fef3c7" : "#f1f5f9",
                  color: heldOrders.length > 0 ? "#b45309" : "#64748b",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "12px",
                  fontWeight: "800"
                }}>
                  {heldOrders.length} {heldOrders.length === 1 ? "Bill" : "Bills"}
                </span>
              </div>
              <button onClick={() => setShowResumeModal(false)} style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", fontWeight: "800" }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: "160px", paddingRight: "4px" }}>
              {heldOrders.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                  <span style={{ fontSize: "40px", display: "block", marginBottom: "10px" }}>🧾</span>
                  <h4 style={{ margin: "0 0 6px 0", color: "#0f172a", fontSize: "16px" }}>No bills on hold!</h4>
                  <p style={{ margin: 0, fontSize: "13px" }}>Bills placed on hold during checkout will appear here.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {heldOrders.map((order) => {
                    const itemCount = (order.items || []).reduce((sum, itm) => sum + (itm.qty || 1), 0);
                    const orderTotal = Number(order.totalAmount || order.total || 0);

                    return (
                      <div 
                        key={order.id} 
                        style={{
                          backgroundColor: "#f8fafc",
                          border: "1.5px solid #e2e8f0",
                          borderRadius: "12px",
                          padding: "14px 16px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px",
                          transition: "border-color 0.2s"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <h4 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                                {order.name || order.customerName || "Guest"}
                              </h4>
                              {order.customerPhone && order.customerPhone !== "N/A" && (
                                <span style={{ fontSize: "11px", color: "#64748b", backgroundColor: "#fff", border: "1px solid #e2e8f0", padding: "1px 6px", borderRadius: "6px" }}>
                                  📞 {order.customerPhone}
                                </span>
                              )}
                              <span style={{ fontSize: "11px", color: "#64748b" }}>
                                🕒 {order.timestamp || "Recently"}
                              </span>
                            </div>
                            <p style={{ margin: "4px 0 0 0", fontSize: "12.5px", color: "#64748b" }}>
                              {itemCount} {itemCount === 1 ? "item" : "items"} in bill
                            </p>
                          </div>

                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "18px", fontWeight: "800", color: "#fc8019" }}>
                              ₹{orderTotal}.00
                            </div>
                          </div>
                        </div>

                        {/* Items preview pills */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", backgroundColor: "#ffffff", padding: "8px 10px", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                          {(order.items || []).slice(0, 5).map((itm, idx) => (
                            <span 
                              key={idx} 
                              style={{ 
                                fontSize: "11px", 
                                color: "#334155", 
                                backgroundColor: "#f1f5f9", 
                                padding: "2px 8px", 
                                borderRadius: "6px",
                                fontWeight: "600"
                              }}
                            >
                              {itm.name || itm.itemName} × {itm.qty || 1}
                            </span>
                          ))}
                          {(order.items || []).length > 5 && (
                            <span style={{ fontSize: "11px", color: "#64748b", padding: "2px 4px" }}>
                              +{((order.items || []).length - 5)} more
                            </span>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "2px" }}>
                          <button
                            type="button"
                            onClick={() => handleDeleteHeldOrder(order.id, order.name || order.customerName)}
                            style={{
                              padding: "7px 12px",
                              backgroundColor: "#fee2e2",
                              color: "#dc2626",
                              border: "none",
                              borderRadius: "8px",
                              fontWeight: "700",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px"
                            }}
                          >
                            <span>🗑️</span>
                            <span>Delete / நீக்கு</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateResumeOrder(order)}
                            style={{
                              padding: "7px 16px",
                              backgroundColor: "#2563eb",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "8px",
                              fontWeight: "800",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)"
                            }}
                          >
                            <span>⏵</span>
                            <span>Restore to Cart / தொடர்க</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "12px", marginTop: "14px", display: "flex", justifyContent: "flex-end" }}>
              <button 
                type="button" 
                onClick={() => setShowResumeModal(false)} 
                style={{ padding: "8px 20px", backgroundColor: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFLICT RESOLUTION MODAL */}
      {holdConflictModal.show && holdConflictModal.pendingOrder && (
        <div style={styles.modalOverlay} onClick={() => setHoldConflictModal({ show: false, pendingOrder: null })}>
          <div style={{ ...styles.modalBox, maxWidth: "440px" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <span style={{ fontSize: "24px" }}>⚠️</span>
              <h3 style={{ margin: 0, color: "#0f172a", fontSize: "17px", fontWeight: "800" }}>
                Active Cart Already Has Items
              </h3>
            </div>
            
            <p style={{ margin: "0 0 16px 0", fontSize: "13.5px", color: "#475569", lineHeight: "1.5" }}>
              You currently have <strong>{totalBillItemsCount} item(s) (₹{totalBillAmount}.00)</strong> in the active cart. What would you like to do before restoring <strong>"{holdConflictModal.pendingOrder.name || holdConflictModal.pendingOrder.customerName || 'Held Bill'}"</strong>?
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                type="button"
                onClick={() => handleExecuteResumeOrder(holdConflictModal.pendingOrder, true)}
                style={{
                  padding: "12px 14px",
                  backgroundColor: "#fff7ed",
                  color: "#ea580c",
                  border: "1.5px solid #fed7aa",
                  borderRadius: "10px",
                  fontWeight: "800",
                  fontSize: "13.5px",
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <span>⏸️</span>
                <div>
                  <div style={{ fontWeight: "800" }}>Hold Current Bill & Restore</div>
                  <div style={{ fontSize: "11px", color: "#9a3412", fontWeight: "500" }}>Saves current cart items as a new held bill first</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteResumeOrder(holdConflictModal.pendingOrder, false)}
                style={{
                  padding: "12px 14px",
                  backgroundColor: "#fef2f2",
                  color: "#dc2626",
                  border: "1.5px solid #fecaca",
                  borderRadius: "10px",
                  fontWeight: "800",
                  fontSize: "13.5px",
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <span>🗑️</span>
                <div>
                  <div style={{ fontWeight: "800" }}>Discard Current Cart & Restore</div>
                  <div style={{ fontSize: "11px", color: "#b91c1c", fontWeight: "500" }}>Replaces current cart with the held bill</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setHoldConflictModal({ show: false, pendingOrder: null })}
                style={{
                  padding: "10px 14px",
                  backgroundColor: "#f1f5f9",
                  color: "#475569",
                  border: "1px solid #cbd5e1",
                  borderRadius: "10px",
                  fontWeight: "700",
                  fontSize: "13px",
                  cursor: "pointer",
                  textAlign: "center",
                  marginTop: "4px"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL */}
      {isCheckoutModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, maxWidth: "480px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ margin: 0, color: "#1e3a8a", fontSize: "18px" }}>💳 Secure Checkout & Payment</h3>
              <button onClick={() => setIsCheckoutModalOpen(false)} style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", fontWeight: "800" }}>✕</button>
            </div>

            <form onSubmit={handleFinalCheckoutSubmit} style={styles.modalForm}>
              <div style={{ backgroundColor: "#fff7ed", padding: "12px 16px", borderRadius: "10px", border: "1px solid #fed7aa", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "14px", fontWeight: "700", color: "#9a3412" }}>Total Items: {totalBillItemsCount}</span>
                <span style={{ fontSize: "18px", fontWeight: "800", color: "#fc8019" }}>₹{totalBillAmount}.00</span>
              </div>

              {/* Restaurant Mode Table / Parcel Indicator & Option */}
              {isRestaurant && (
                <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "10px 12px" }}>
                  {activeTableOrderId && activeTableOrderInfo ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: "12.5px", fontWeight: "800", color: "#166534" }}>
                          {activeTableOrderInfo.isParcel ? `🥡 Parcel Order: ${activeTableOrderInfo.customerName || "Takeaway"}` : activeTableOrderInfo.tableNo ? `🍽️ Table Order: ${activeTableOrderInfo.tableNo}` : "Counter Walk-in Order"}
                        </div>
                        <div style={{ fontSize: "11px", color: "#15803d" }}>
                          Staff: {activeTableOrderInfo.waiterName || "Staff"} • #{activeTableOrderInfo.orderNumber || "KOT"}
                        </div>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: "800", backgroundColor: "#16a34a", color: "#fff", padding: "2px 8px", borderRadius: "8px" }}>
                        {activeTableOrderInfo.isParcel ? "PARCEL" : activeTableOrderInfo.tableNo ? "Active Table" : "Counter"}
                      </span>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                        <button
                          type="button"
                          onClick={() => setCheckoutOrderType("counter")}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: "8px",
                            border: "none",
                            fontWeight: "700",
                            fontSize: "12px",
                            cursor: "pointer",
                            backgroundColor: checkoutOrderType === "counter" ? "#2563eb" : "#ffffff",
                            color: checkoutOrderType === "counter" ? "#ffffff" : "#475569",
                          }}
                        >
                          ⚡ Counter / Walk-in
                        </button>
                        <button
                          type="button"
                          onClick={() => setCheckoutOrderType("parcel")}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: "8px",
                            border: "none",
                            fontWeight: "700",
                            fontSize: "12px",
                            cursor: "pointer",
                            backgroundColor: checkoutOrderType === "parcel" ? "#ea580c" : "#ffffff",
                            color: checkoutOrderType === "parcel" ? "#ffffff" : "#475569",
                          }}
                        >
                          🥡 Parcel / Takeaway
                        </button>
                      </div>

                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#166534", fontWeight: "600", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={sendKotWithCheckout}
                          onChange={(e) => setSendKotWithCheckout(e.target.checked)}
                          style={{ accentColor: "#16a34a" }}
                        />
                        <span>Send KOT to Kitchen / Packing Staff (No amounts shown)</span>
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ ...styles.inputGroup, flex: 1, minWidth: "140px" }}>
                  <label style={styles.label}>Customer Name (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Rahul" 
                    value={customerName} 
                    onChange={(e) => setCustomerName(e.target.value)} 
                    style={styles.modalInput} 
                  />
                </div>
                <div style={{ ...styles.inputGroup, flex: 1, minWidth: "140px" }}>
                  <label style={styles.label}>Phone No. (Optional)</label>
                  <input 
                    type="tel" 
                    placeholder="10-digit number" 
                    value={customerPhone} 
                    onChange={(e) => setCustomerPhone(e.target.value)} 
                    style={styles.modalInput} 
                  />
                </div>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Select Payment Method</label>
                <div style={styles.paymentCardsGrid}>
                  {storeSettings.allowCash && (
                    <div 
                      onClick={() => setPaymentMethod("Cash")}
                      style={{
                        ...styles.paymentCardOption,
                        borderColor: paymentMethod === "Cash" ? "#fc8019" : "#cbd5e1",
                        backgroundColor: paymentMethod === "Cash" ? "#fff7ed" : "#ffffff"
                      }}
                    >
                      <span style={{ fontSize: "22px" }}>💵</span>
                      <span style={{ fontWeight: "700", fontSize: "13px", color: "#1e293b" }}>Cash</span>
                    </div>
                  )}

                  {storeSettings.allowUpi && (
                    <div 
                      onClick={() => setPaymentMethod("UPI / QR")}
                      style={{
                        ...styles.paymentCardOption,
                        borderColor: paymentMethod === "UPI / QR" ? "#fc8019" : "#cbd5e1",
                        backgroundColor: paymentMethod === "UPI / QR" ? "#fff7ed" : "#ffffff"
                      }}
                    >
                      <span style={{ fontSize: "22px" }}>📱</span>
                      <span style={{ fontWeight: "700", fontSize: "13px", color: "#1e293b" }}>UPI / QR</span>
                    </div>
                  )}

                  {storeSettings.allowCard && (
                    <div 
                      onClick={() => setPaymentMethod("Card")}
                      style={{
                        ...styles.paymentCardOption,
                        borderColor: paymentMethod === "Card" ? "#fc8019" : "#cbd5e1",
                        backgroundColor: paymentMethod === "Card" ? "#fff7ed" : "#ffffff"
                      }}
                    >
                      <span style={{ fontSize: "22px" }}>💳</span>
                      <span style={{ fontWeight: "700", fontSize: "13px", color: "#1e293b" }}>Card</span>
                    </div>
                  )}
                </div>
              </div>

              {paymentMethod === "UPI / QR" && (
                <div style={styles.qrContainer}>
                  <div style={styles.qrBox}>
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(`upi://pay?pa=${storeSettings.upiId}&pn=${encodeURIComponent(userProfile.storeName)}&am=${totalBillAmount}&cu=INR`)}`} 
                      alt="UPI QR Code" 
                      style={{ width: "120px", height: "120px", borderRadius: "8px" }}
                    />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: "0 0 2px 0", fontSize: "12px", fontWeight: "700", color: "#1e293b" }}>Scan & Pay ₹{totalBillAmount}.00</p>
                    <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>UPI ID: {storeSettings.upiId}</p>
                  </div>
                </div>
              )}

              <div style={styles.modalBtns}>
                <button type="submit" style={styles.saveModalBtn}>Confirm & Print Bill 🖨️</button>
                <button type="button" onClick={() => setIsCheckoutModalOpen(false)} style={styles.cancelModalBtn}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESTAURANT LIVE TABLE ORDERS MODAL */}
      {showTableOrdersModal && (
        <div style={styles.modalOverlay} onClick={() => setShowTableOrdersModal(false)}>
          <div 
            style={{ 
              ...styles.modalBox, 
              maxWidth: "820px", 
              maxHeight: "90vh", 
              display: "flex", 
              flexDirection: "column",
              padding: "24px"
            }} 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", borderBottom: "1.5px solid #f1f5f9", paddingBottom: "12px" }}>
              <div>
                <h3 style={{ margin: 0, color: "#0f172a", fontSize: "20px", fontWeight: "800", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🍽️</span>
                  <span>Restaurant Table & KOT Orders</span>
                </h3>
                <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                  Live orders from Waiters & Kitchen. Ready orders can be loaded with full prices into the billing register.
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowTableOrdersModal(false)} 
                style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: "#64748b", fontWeight: "800", padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>

            {/* Filter Tabs */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", backgroundColor: "#f1f5f9", padding: "4px", borderRadius: "12px" }}>
              <button
                type="button"
                onClick={() => setTableOrderTab("served")}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "9px",
                  border: "none",
                  fontWeight: "800",
                  fontSize: "13px",
                  cursor: "pointer",
                  backgroundColor: tableOrderTab === "served" ? "#ffffff" : "transparent",
                  color: tableOrderTab === "served" ? "#15803d" : "#64748b",
                  boxShadow: tableOrderTab === "served" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                <span>🔔 Ready to Bill</span>
                <span style={{ backgroundColor: "#dcfce7", color: "#166534", padding: "1px 7px", borderRadius: "10px", fontSize: "11px" }}>
                  {servedTableOrders.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTableOrderTab("kitchen")}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "9px",
                  border: "none",
                  fontWeight: "800",
                  fontSize: "13px",
                  cursor: "pointer",
                  backgroundColor: tableOrderTab === "kitchen" ? "#ffffff" : "transparent",
                  color: tableOrderTab === "kitchen" ? "#ea580c" : "#64748b",
                  boxShadow: tableOrderTab === "kitchen" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                <span>🍳 In Kitchen</span>
                <span style={{ backgroundColor: "#ffedd5", color: "#c2410c", padding: "1px 7px", borderRadius: "10px", fontSize: "11px" }}>
                  {cookingTableOrders.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTableOrderTab("all")}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "9px",
                  border: "none",
                  fontWeight: "800",
                  fontSize: "13px",
                  cursor: "pointer",
                  backgroundColor: tableOrderTab === "all" ? "#ffffff" : "transparent",
                  color: tableOrderTab === "all" ? "#0284c7" : "#64748b",
                  boxShadow: tableOrderTab === "all" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                <span>📋 All Orders</span>
                <span style={{ backgroundColor: "#e0f2fe", color: "#0369a1", padding: "1px 7px", borderRadius: "10px", fontSize: "11px" }}>
                  {activeKitchenOrders.length}
                </span>
              </button>
            </div>

            {/* Orders Scrollable List */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", paddingRight: "4px" }}>
              {(() => {
                const displayList = tableOrderTab === "served"
                  ? servedTableOrders
                  : tableOrderTab === "kitchen"
                  ? cookingTableOrders
                  : activeKitchenOrders;

                if (displayList.length === 0) {
                  return (
                    <div style={{ textAlign: "center", padding: "50px 20px", color: "#94a3b8" }}>
                      <div style={{ fontSize: "42px", marginBottom: "8px" }}>
                        {tableOrderTab === "served" ? "🔔" : "🍳"}
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155" }}>
                        {tableOrderTab === "served" ? "No table orders waiting for billing" : "No active orders in kitchen"}
                      </div>
                      <p style={{ margin: "4px 0 0 0", fontSize: "13px" }}>
                        {tableOrderTab === "served" ? "When a waiter marks a table order as 'Served', it appears here ready for checkout!" : "New KOT orders from waiters or counter will appear here in real-time."}
                      </p>
                    </div>
                  );
                }

                return displayList.map((order) => {
                  const classification = getOrderClassification(order);
                  const isParcel = classification.isParcel;
                  const isServed = order.status === "served";
                  const isReady = order.status === "ready";
                  const isPreparing = order.status === "preparing";
                  const orderTotal = (order.items || []).reduce((acc, i) => acc + (Number(i.price || i.salesPrice || 0) * Number(i.qty || 1)), 0);

                  const cardTitle = isParcel
                    ? `PARCEL: ${classification.customerName}`
                    : classification.isTable
                    ? classification.tableNo
                    : `Counter Order (${classification.customerName})`;

                  return (
                    <div
                      key={order.id}
                      style={{
                        backgroundColor: (isServed || (isParcel && isReady)) ? "#f0fdf4" : "#ffffff",
                        border: (isServed || (isParcel && isReady)) ? "2px solid #86efac" : "1.5px solid #e2e8f0",
                        borderRadius: "16px",
                        padding: "16px",
                        boxShadow: (isServed || (isParcel && isReady)) ? "0 4px 12px rgba(34, 197, 94, 0.12)" : "0 2px 6px rgba(0,0,0,0.04)"
                      }}
                    >
                      {/* Card Header Row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a" }}>
                              {cardTitle}
                            </span>
                            <span style={{
                              fontSize: "11px",
                              fontWeight: "800",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              backgroundColor: isParcel ? "#fef3c7" : classification.isTable ? "#e0f2fe" : "#f1f5f9",
                              color: isParcel ? "#b45309" : classification.isTable ? "#0369a1" : "#475569"
                            }}>
                              {isParcel ? "🥡 PARCEL" : classification.isTable ? "🍽️ DINE-IN" : "⚡ COUNTER"}
                            </span>
                            <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>
                              #{order.orderNumber || "KOT"}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                            Staff: <b style={{ color: "#334155" }}>{order.waiterName || "Counter"}</b> • Ordered: {getOrderElapsedMinutes(order.createdAtMs)}
                          </div>
                          {order.orderNotes && (
                            <div style={{ fontSize: "12px", color: "#d97706", fontStyle: "italic", marginTop: "2px" }}>
                              📝 Note: {order.orderNotes}
                            </div>
                          )}
                        </div>

                        {/* Status Badge */}
                        <div>
                          {isServed ? (
                            <span style={{ backgroundColor: "#16a34a", color: "#fff", padding: "4px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: "800" }}>
                              ✓ SERVED (Ready to Bill)
                            </span>
                          ) : isReady ? (
                            <span style={{ backgroundColor: isParcel ? "#16a34a" : "#0284c7", color: "#fff", padding: "4px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: "800" }}>
                              {isParcel ? "✓ FOOD READY (Ready to Bill)" : "🔔 FOOD READY"}
                            </span>
                          ) : isPreparing ? (
                            <span style={{ backgroundColor: "#f59e0b", color: "#fff", padding: "4px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: "800" }}>
                              🍳 COOKING
                            </span>
                          ) : (
                            <span style={{ backgroundColor: "#94a3b8", color: "#fff", padding: "4px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: "800" }}>
                              ⏳ PENDING
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Item Details Table WITH PRICES & AMOUNTS (Counter View) */}
                      <div style={{ backgroundColor: isServed ? "#ffffff" : "#f8fafc", borderRadius: "10px", padding: "10px 12px", border: "1px solid #e2e8f0", margin: "10px 0" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                          <thead>
                            <tr style={{ borderBottom: "1px solid #cbd5e1", color: "#64748b", textAlign: "left" }}>
                              <th style={{ padding: "4px 0", fontWeight: "700" }}>Item Description</th>
                              <th style={{ padding: "4px 0", textAlign: "center", fontWeight: "700", width: "60px" }}>Qty</th>
                              <th style={{ padding: "4px 0", textAlign: "right", fontWeight: "700", width: "80px" }}>Price</th>
                              <th style={{ padding: "4px 0", textAlign: "right", fontWeight: "700", width: "90px" }}>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(order.items || []).map((item, iIdx) => {
                              const iPrice = Number(item.price || item.salesPrice || 0);
                              const iQty = Number(item.qty || 1);
                              return (
                                <tr key={iIdx} style={{ borderBottom: "1px dashed #f1f5f9" }}>
                                  <td style={{ padding: "6px 0", color: "#0f172a", fontWeight: "600" }}>
                                    {item.name || item.itemName}
                                    {item.portion && item.portion !== "Standard" && (
                                      <span style={{ fontSize: "11px", color: "#64748b", marginLeft: "6px" }}>({item.portion})</span>
                                    )}
                                    {item.notes ? <div style={{ fontSize: "11px", color: "#f59e0b" }}>↳ {item.notes}</div> : null}
                                  </td>
                                  <td style={{ padding: "6px 0", textAlign: "center", fontWeight: "800", color: "#0f172a" }}>
                                    {iQty}
                                  </td>
                                  <td style={{ padding: "6px 0", textAlign: "right", color: "#64748b" }}>
                                    ₹{iPrice}
                                  </td>
                                  <td style={{ padding: "6px 0", textAlign: "right", fontWeight: "800", color: "#0f172a" }}>
                                    ₹{iPrice * iQty}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: "1.5px solid #cbd5e1" }}>
                              <td colSpan={2} style={{ padding: "8px 0", fontWeight: "800", color: "#0f172a", fontSize: "14px" }}>
                                Total: {(order.items || []).reduce((s, i) => s + (Number(i.qty) || 1), 0)} items
                              </td>
                              <td style={{ padding: "8px 0", textAlign: "right", fontWeight: "700", color: "#64748b" }}>
                                Subtotal:
                              </td>
                              <td style={{ padding: "8px 0", textAlign: "right", fontWeight: "900", color: "#16a34a", fontSize: "16px" }}>
                                ₹{orderTotal}.00
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* Card Action Buttons */}
                      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "10px" }}>
                        <button
                          type="button"
                          onClick={() => handlePrintPreBill(order)}
                          style={{
                            padding: "8px 14px",
                            backgroundColor: "#f8fafc",
                            border: "1.5px solid #cbd5e1",
                            borderRadius: "10px",
                            color: "#334155",
                            fontWeight: "700",
                            fontSize: "12.5px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "5px"
                          }}
                          title="Print Table Slip with amounts before checkout"
                        >
                          <span>🖨️</span>
                          <span>Print Table Slip</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleLoadTableOrderToBill(order)}
                          style={{
                            padding: "8px 18px",
                            backgroundColor: "#16a34a",
                            border: "none",
                            borderRadius: "10px",
                            color: "#ffffff",
                            fontWeight: "800",
                            fontSize: "13px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "0 2px 8px rgba(22, 163, 74, 0.28)"
                          }}
                        >
                          <span>🧾</span>
                          <span>Load into Bill & Print Receipt →</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const confName = isParcel ? `PARCEL (${classification.customerName})` : (classification.tableNo || "Order");
                            if (window.confirm(`Mark ${confName} as completed?`)) {
                              handleMarkOrderCompleted(order.id);
                            }
                          }}
                          style={{
                            padding: "8px 12px",
                            backgroundColor: "transparent",
                            border: "1px solid #e2e8f0",
                            borderRadius: "10px",
                            color: "#94a3b8",
                            fontWeight: "600",
                            fontSize: "12px",
                            cursor: "pointer"
                          }}
                          title="Close / archive this order"
                        >
                          Archive ✕
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* DIRECT PARCEL ORDER MODAL */}
      {showDirectParcelModal && (
        <div style={styles.modalOverlay} onClick={() => setShowDirectParcelModal(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ margin: 0, color: "#c2410c", fontSize: "18px", fontWeight: "800", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🥡</span>
                <span>Send Parcel to Kitchen & Packing</span>
              </h3>
              <button 
                type="button" 
                onClick={() => setShowDirectParcelModal(false)} 
                style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", fontWeight: "800", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: "0 0 14px 0", fontSize: "13px", color: "#64748b", lineHeight: "1.4" }}>
              Sends a Kitchen Order Ticket (KOT) directly to the kitchen display & packing staff <b>without displaying amounts</b>. You can collect payment from the customer and hand over the printed bill.
            </p>

            <div style={{ backgroundColor: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "10px", padding: "10px 12px", marginBottom: "14px" }}>
              <div style={{ fontSize: "12.5px", fontWeight: "800", color: "#9a3412", marginBottom: "4px" }}>
                Selected Food Items ({currentBill.reduce((s, i) => s + (Number(i.qty) || 1), 0)} items):
              </div>
              <div style={{ fontSize: "12px", color: "#c2410c" }}>
                {currentBill.map((i) => `${i.name || i.itemName} (x${i.qty})`).join(", ")}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Customer Name (for Parcel label) *</label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh / Parcel 1"
                  value={directParcelName}
                  onChange={(e) => setDirectParcelName(e.target.value)}
                  style={styles.modalInput}
                  autoFocus
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Customer Mobile (Optional)</label>
                <input
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={directParcelPhone}
                  onChange={(e) => setDirectParcelPhone(e.target.value)}
                  style={styles.modalInput}
                />
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={handleSendDirectParcelToKitchen}
                  style={{
                    flex: 2,
                    padding: "12px",
                    backgroundColor: "#ea580c",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: "800",
                    fontSize: "14px",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(234, 88, 12, 0.3)"
                  }}
                >
                  🥡 Send to Kitchen & Packing Staff
                </button>
                <button
                  type="button"
                  onClick={() => setShowDirectParcelModal(false)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    backgroundColor: "#f1f5f9",
                    color: "#64748b",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: "700",
                    fontSize: "13px",
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT PREVIEW MODAL */}
      {selectedOrderDetails && (
        <div style={styles.modalOverlay} onClick={() => setSelectedOrderDetails(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "450px" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: "#1e3a8a", textAlign: "center" }}>{userProfile.storeName} RECEIPT</h3>
            <p style={{ textAlign: "center", fontSize: "12px", color: "#64748b", margin: "4px 0 12px 0" }}>
              Customer: {selectedOrderDetails.customerName || "Walk-in"}
              {(() => {
                const c = getOrderClassification(selectedOrderDetails);
                if (c.isTable) return ` | Table: ${c.tableNo}`;
                if (c.isParcel) return ` | PARCEL`;
                return "";
              })()}
              {" | Paid via: " + (selectedOrderDetails.paymentMethod || selectedOrderDetails.paymentMode || "Cash")}
            </p>
            <div style={{ maxHeight: "220px", overflowY: "auto", margin: "10px 0", borderTop: "1px solid #eee", borderBottom: "1px solid #eee", padding: "10px 0" }}>
              {(selectedOrderDetails.items || []).map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", paddingBottom: "6px" }}>
                  <span>{item.name || item.itemName} (x{item.qty})</span>
                  <span>₹{(item.price || item.salesPrice || 0) * item.qty}</span>
                </div>
              ))}
            </div>
            <div style={{ paddingTop: "6px", display: "flex", justifyContent: "space-between", fontWeight: "800", fontSize: "16px" }}>
              <span>Total:</span>
              <span style={{ color: "#fc8019" }}>₹{selectedOrderDetails.totalAmount || selectedOrderDetails.total}</span>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button 
                type="button" 
                onClick={() => handlePrintBill(selectedOrderDetails, "posReceipt")} 
                style={{ flex: 1, padding: "10px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
              >
                🧾 Print Receipt
              </button>
              <button 
                type="button" 
                onClick={() => handlePrintBill(selectedOrderDetails, "salesInvoice")} 
                style={{ flex: 1, padding: "10px", backgroundColor: "#0f172a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
              >
                📄 A4 Invoice
              </button>
              <button 
                type="button" 
                onClick={() => setSelectedOrderDetails(null)} 
                style={{ padding: "10px 14px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REAL-TIME COUNTER TOAST NOTIFICATION (Table Order Served & Parcel Food Ready) */}
      {counterToast && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999999,
            backgroundColor: "#065f46",
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
          <span style={{ fontSize: "20px" }}>🔔</span>
          <span style={{ flex: 1 }}>{counterToast.message}</span>
          <button
            type="button"
            onClick={() => {
              setCounterToast(null);
              setTableOrderTab("served");
              setShowTableOrdersModal(true);
            }}
            style={{
              backgroundColor: "#ffffff",
              color: "#065f46",
              border: "none",
              padding: "5px 12px",
              borderRadius: "8px",
              fontWeight: "800",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Load Bill ↗
          </button>
          <button
            type="button"
            onClick={() => setCounterToast(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#a7f3d0",
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

      {/* POPUP MODAL */}
      {popupModal.show && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, textAlign: "center", maxWidth: "340px", padding: "30px 20px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
              <div className="animate-circle" style={{ width: "70px", height: "70px", borderRadius: "50%", backgroundColor: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline className="animate-check" points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>

            <h3 style={{ margin: "0 0 8px 0", color: "#0f172a", fontSize: "20px", fontWeight: "800" }}>
              {popupModal.message.includes("Payment") ? "Payment Successful!" : "Success!"}
            </h3>
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "16px", lineHeight: "1.4" }}>{popupModal.message}</p>
            
            {popupModal.lastOrder && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button
                  type="button"
                  onClick={() => handlePrintBill(popupModal.lastOrder, "posReceipt")}
                  style={{ flex: 1, padding: "10px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
                >
                  🧾 Print Receipt
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintBill(popupModal.lastOrder, "salesInvoice")}
                  style={{ flex: 1, padding: "10px", backgroundColor: "#0f172a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
                >
                  📄 A4 Invoice
                </button>
              </div>
            )}

            <button 
              type="button"
              onClick={() => setPopupModal({ show: false, message: "" })} 
              style={{ width: "100%", padding: "12px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "800", fontSize: "15px", cursor: "pointer", boxShadow: "0 4px 12px rgba(22, 163, 74, 0.3)" }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ADD / EDIT INVENTORY MODAL */}
      {isModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ margin: 0 }}>
                {isRestaurant ? (isEditing ? "Edit Food Item" : "Add New Food") : (isEditing ? "Edit Product" : "Add New Product")}
              </h3>
              <button
                type="button"
                onClick={handleOpenWebImageSearch}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  backgroundColor: "#e0e7ff",
                  color: "#4338ca",
                  border: "none",
                  borderRadius: "14px",
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: "800",
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                }}
              >
                <span>🔍</span> Search web
              </button>
            </div>
            <form onSubmit={handleSaveProduct} style={styles.modalForm}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <input 
                  type="text" 
                  placeholder={isRestaurant ? "Food Name (e.g. Chicken Biryani, Dosa)" : "Product Name"} 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  style={styles.modalInput} 
                  required 
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <select
                  value={showCustomCategory ? "__custom__" : category}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setShowCustomCategory(true);
                      setCategory("");
                    } else {
                      setShowCustomCategory(false);
                      setCategory(e.target.value);
                    }
                  }}
                  style={{ ...styles.modalInput, cursor: "pointer", backgroundColor: "#ffffff" }}
                  required
                >
                  <option value="" disabled>-- Select Category --</option>
                  {availableCategories.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat}</option>
                  ))}
                  <option value="__custom__">➕ + Add Custom Category...</option>
                </select>
                {showCustomCategory && (
                  <input
                    type="text"
                    placeholder={isRestaurant ? "Type custom food category (e.g. Soups, Tandoori)" : "Type custom category..."}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{ ...styles.modalInput, marginTop: "4px" }}
                    autoFocus
                    required
                  />
                )}
              </div>
              <input 
                type="number" 
                placeholder="Sales Price (₹)" 
                value={price} 
                onChange={e => setPrice(e.target.value)} 
                style={styles.modalInput} 
                required 
              />
              <input 
                type="number" 
                placeholder={isRestaurant ? "Available Stock / Portions (e.g. 100)" : "Quantity / Stock"} 
                value={qty} 
                onChange={e => setQty(e.target.value)} 
                style={styles.modalInput} 
                required 
              />
              <input 
                type="text" 
                placeholder={isRestaurant ? "Serving / Diet Notes (e.g. Spicy, Veg, Non-Veg)" : "Brand Name"} 
                value={brand} 
                onChange={e => setBrand(e.target.value)} 
                style={styles.modalInput} 
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700" }}>{isRestaurant ? "Food Photo" : "Product Photo"}</label>
                <input type="file" accept="image/*" onChange={handleImageChange} style={{ fontSize: "12px" }} />
                {image && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", backgroundColor: "#ffffff", padding: "6px 10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <img 
                      src={image} 
                      alt="Selected preview" 
                      style={{ width: "42px", height: "42px", borderRadius: "8px", objectFit: "contain", backgroundColor: "#ffffff", border: "1.5px solid #6366f1" }} 
                      onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                    />
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ fontSize: "11px", color: "#16a34a", fontWeight: "700" }}>✓ Studio photo selected</div>
                      <div style={{ fontSize: "10px", color: "#64748b", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{image.substring(0, 42)}...</div>
                    </div>
                    <button 
                      type="button" 
                      onClick={() => setImage("")} 
                      style={{ background: "none", border: "none", color: "#ef4444", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                )}
              </div>
              <div style={styles.modalBtns}>
                <button type="submit" style={styles.saveModalBtn}>{isRestaurant ? "Save Food" : "Save Product"}</button>
                <button type="button" onClick={() => setIsModalOpen(false)} style={styles.cancelModalBtn}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WEB IMAGE SEARCH MODAL */}
      {webImageModalOpen && (
        <div 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100000,
            padding: "16px"
          }}
          onClick={() => setWebImageModalOpen(false)}
        >
          <div 
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "640px",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800", color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🔍</span> {isRestaurant ? "Search Food Photos Online" : "Search Product Photos Online"}
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#64748b" }}>
                  Click any photo to instantly set it as your {isRestaurant ? "food" : "product"} photo
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWebImageModalOpen(false)}
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: "50%",
                  width: "32px",
                  height: "32px",
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b"
                }}
              >
                ✕
              </button>
            </div>

            {/* Search Input Bar */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder={isRestaurant ? "e.g. Chicken Biryani, Paneer Butter Masala, Dosa..." : "e.g. Milk, Chocolate, Shampoo..."}
                value={webImageQuery}
                onChange={(e) => setWebImageQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    searchWebImages(webImageQuery);
                  }
                }}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1.5px solid #cbd5e1",
                  fontSize: "14px",
                  outline: "none"
                }}
                autoFocus
              />
              <button
                type="button"
                onClick={() => searchWebImages(webImageQuery)}
                disabled={webImageLoading}
                style={{
                  backgroundColor: "#4f46e5",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "10px",
                  padding: "0 18px",
                  fontSize: "13px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                {webImageLoading ? "Searching..." : "Search"}
              </button>
            </div>

            {/* Images Grid */}
            <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, minHeight: "260px" }}>
              {webImageLoading ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                  <div style={{ fontSize: "28px" }}>🔄</div>
                  <div style={{ marginTop: "12px", fontSize: "14px", fontWeight: "600" }}>Searching high-quality photos on web...</div>
                </div>
              ) : webImageResults.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "12px" }}>
                  {webImageResults.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      onClick={async () => {
                        setWebImageModalOpen(false);
                        const whiteBg = await convertToWhiteStudioBackground(imgUrl);
                        setImage(whiteBg);
                      }}
                      style={{
                        position: "relative",
                        aspectRatio: "1",
                        borderRadius: "10px",
                        overflow: "hidden",
                        border: image === imgUrl ? "3px solid #4f46e5" : "1.5px solid #e2e8f0",
                        cursor: "pointer",
                        backgroundColor: "#ffffff",
                        transition: "transform 0.15s, box-shadow 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "scale(1.03)";
                        e.currentTarget.style.boxShadow = "0 6px 12px rgba(0,0,0,0.12)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "scale(1)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <img
                        src={imgUrl}
                        alt={`Result ${idx}`}
                        style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#ffffff" }}
                        loading="lazy"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                      {image === imgUrl && (
                        <div style={{ position: "absolute", top: "6px", right: "6px", backgroundColor: "#4f46e5", color: "#fff", borderRadius: "50%", width: "20px", height: "20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800" }}>
                          ✓
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "50px 20px", color: "#94a3b8" }}>
                  <div style={{ fontSize: "42px", marginBottom: "8px" }}>🖼️</div>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: "#64748b" }}>
                    {webImageQuery ? `No photos found for "${webImageQuery}". Try another keyword!` : "Type a dish name above and click Search."}
                  </div>
                  <div style={{ fontSize: "12px", marginTop: "6px" }}>
                    Examples: "Biryani", "Masala Dosa", "Chicken Curry", "Fried Rice", "Parotta"
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f8fafc" }}>
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                {webImageResults.length > 0 ? `${webImageResults.length} photos found` : ""}
              </span>
              <button
                type="button"
                onClick={() => setWebImageModalOpen(false)}
                style={{
                  backgroundColor: "#f1f5f9",
                  color: "#475569",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SPEED DIAL CONFIGURATION MODAL */}
      {isConfiguringSpeedDial && (
        <div style={styles.modalOverlay} onClick={() => setIsConfiguringSpeedDial(false)}>
          <div style={{ ...styles.modalBox, maxWidth: "560px", maxHeight: "88vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  backgroundColor: "#4f46e5",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: "800",
                  fontSize: "14px"
                }}>
                  {selectedSlotForConfig}
                </span>
                <h3 style={{ margin: 0, color: "#0f172a", fontSize: "17px", fontWeight: "800" }}>
                  Configure Speed Dial Slot #{selectedSlotForConfig}
                </h3>
              </div>
              <button 
                onClick={() => setIsConfiguringSpeedDial(false)} 
                style={{ background: "transparent", border: "none", fontSize: "18px", cursor: "pointer", fontWeight: "800", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            {/* Quick Switch Slot Tabs 1 to 8 */}
            <div style={{ display: "flex", gap: "6px", marginBottom: "14px", alignItems: "center", overflowX: "auto", paddingBottom: "2px" }}>
              <span style={{ fontSize: "12px", fontWeight: "700", color: "#64748b", whiteSpace: "nowrap" }}>Select Slot:</span>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSelectedSlotForConfig(s)}
                  style={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "8px",
                    border: "1.5px solid " + (selectedSlotForConfig === s ? "#4f46e5" : "#e2e8f0"),
                    backgroundColor: selectedSlotForConfig === s ? "#4f46e5" : (speedDialSlots[s] ? "#eef2ff" : "#fff"),
                    color: selectedSlotForConfig === s ? "#fff" : (speedDialSlots[s] ? "#4f46e5" : "#64748b"),
                    fontWeight: "800",
                    fontSize: "13px",
                    cursor: "pointer",
                    flexShrink: 0
                  }}
                  title={speedDialSlots[s] ? `Slot #${s}: ${speedDialSlots[s].name || speedDialSlots[s].itemName}` : `Slot #${s}: Empty`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Current Assignment Card */}
            {speedDialSlots[selectedSlotForConfig] ? (
              <div style={{ backgroundColor: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: "700", color: "#4f46e5", textTransform: "uppercase" }}>Current Item on Slot #{selectedSlotForConfig}</div>
                  <div style={{ fontSize: "15px", fontWeight: "800", color: "#1e1b4b", marginTop: "2px" }}>
                    {speedDialSlots[selectedSlotForConfig].name || speedDialSlots[selectedSlotForConfig].itemName} — ₹{speedDialSlots[selectedSlotForConfig].salesPrice || speedDialSlots[selectedSlotForConfig].price || 0}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAssignProductToSlot(selectedSlotForConfig, null)}
                  style={{ backgroundColor: "#fee2e2", border: "1px solid #fecaca", color: "#dc2626", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }}
                >
                  Remove Item 🗑️
                </button>
              </div>
            ) : (
              <div style={{ backgroundColor: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "10px", padding: "10px 14px", marginBottom: "14px", color: "#64748b", fontSize: "13px", fontWeight: "600" }}>
                Slot #{selectedSlotForConfig} is currently empty. Choose an item from the list below to assign.
              </div>
            )}

            {/* Search Input for Products */}
            <div style={{ marginBottom: "10px" }}>
              <input
                type="text"
                placeholder={isRestaurant ? "🔍 Search food name to assign..." : "🔍 Search product name to assign..."}
                value={speedDialSearch}
                onChange={(e) => setSpeedDialSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1.5px solid #cbd5e1",
                  fontSize: "13px",
                  outline: "none",
                  boxSizing: "border-box"
                }}
              />
            </div>

            {/* List of Products */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", maxHeight: "320px", paddingRight: "4px" }}>
              {products
                .filter(p => {
                  const pName = p.itemName || p.name || "";
                  const pCat = p.category || "";
                  const q = speedDialSearch.toLowerCase();
                  return pName.toLowerCase().includes(q) || pCat.toLowerCase().includes(q);
                })
                .map((product) => {
                  const pName = product.itemName || product.name || "Item";
                  const pPrice = product.salesPrice || product.price || 0;
                  const isCurrentAssigned = speedDialSlots[selectedSlotForConfig]?.id === product.id;

                  return (
                    <div
                      key={product.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid " + (isCurrentAssigned ? "#818cf8" : "#f1f5f9"),
                        backgroundColor: isCurrentAssigned ? "#f5f3ff" : "#ffffff",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: 1 }}>
                        <img
                          src={product.image || product.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"}
                          alt={pName}
                          style={{ width: "42px", height: "42px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }}
                          onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h5 style={{ margin: "0 0 2px 0", fontSize: "14px", fontWeight: "700", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {pName}
                          </h5>
                          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                            {product.category || "General"} • <strong style={{ color: "#fc8019" }}>₹{pPrice}</strong>
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAssignProductToSlot(selectedSlotForConfig, product)}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "8px",
                          border: "none",
                          backgroundColor: isCurrentAssigned ? "#10b981" : "#4f46e5",
                          color: "#fff",
                          fontWeight: "800",
                          fontSize: "12px",
                          cursor: "pointer",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                          flexShrink: 0,
                          marginLeft: "10px"
                        }}
                      >
                        {isCurrentAssigned ? "✓ Assigned" : `Set to Slot #${selectedSlotForConfig}`}
                      </button>
                    </div>
                  );
                })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px", borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
              <button
                type="button"
                onClick={() => setIsConfiguringSpeedDial(false)}
                style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid #cbd5e1", backgroundColor: "#fff", color: "#64748b", fontWeight: "700", fontSize: "13px", cursor: "pointer" }}
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  appContainer: { display: "flex", minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "system-ui, sans-serif", flexDirection: "column", width: "100%" },
  navbar: { 
    display: "flex", 
    justifyContent: "space-between", 
    alignItems: "center", 
    padding: "10px 20px", 
    backgroundColor: "#ffffff", 
    borderBottom: "1px solid #e2e8f0", 
    position: "sticky", 
    top: 0, 
    zIndex: 100, 
    gap: "16px", 
    width: "100%", 
    boxSizing: "border-box",
    flexShrink: 0
  },
  navLeftGroup: { display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 },
  logoArea: { display: "flex", alignItems: "center", gap: "8px" },
  sidebarBrand: { fontSize: "16px", fontWeight: "800", color: "#1e3a8a", margin: 0, whiteSpace: "nowrap" },
  searchBarContainer: { display: "flex", alignItems: "center", backgroundColor: "#f1f5f9", padding: "6px 12px", borderRadius: "8px", width: "220px", maxWidth: "220px", minWidth: "130px", flexShrink: 1, gap: "6px" },
  searchInput: { border: "none", background: "transparent", outline: "none", width: "100%", fontSize: "12px", color: "#1e293b" },
  searchIcon: { fontSize: "14px" },
  navLinks: { display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 },
  navBtn: { padding: "7px 14px", border: "none", borderRadius: "8px", fontWeight: "700", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" },

  speedDialSection: {
    marginTop: "12px",
    paddingTop: "12px",
    borderTop: "1.5px dashed #e2e8f0"
  },
  speedDialToggleBtn: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.15s ease"
  },
  speedDialBody: {
    marginTop: "8px"
  },
  speedDialGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "8px"
  },
  speedDialKeyBtn: {
    display: "flex",
    flexDirection: "column",
    padding: "6px 8px",
    borderRadius: "10px",
    border: "1.5px solid #e2e8f0",
    cursor: "pointer",
    transition: "all 0.12s ease",
    boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
    boxSizing: "border-box",
    minHeight: "64px",
    justifyContent: "space-between",
    userSelect: "none"
  },
  speedDialKeyNum: {
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    color: "#fff",
    fontSize: "10.5px",
    fontWeight: "800",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  speedDialSlotCog: {
    background: "transparent",
    border: "none",
    fontSize: "11px",
    color: "#64748b",
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1
  },
  speedDialItemName: {
    fontSize: "11.5px",
    fontWeight: "700",
    color: "#0f172a",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    lineHeight: "1.2"
  },
  speedDialItemPrice: {
    fontSize: "11px",
    fontWeight: "800",
    color: "#fc8019",
    marginTop: "2px"
  },

  portalDropdownMenu: { 
    position: "fixed", 
    backgroundColor: "#ffffff", 
    borderRadius: "12px", 
    boxShadow: "0 14px 35px rgba(0,0,0,0.22)", 
    border: "1px solid #cbd5e1", 
    display: "flex", 
    flexDirection: "column", 
    minWidth: "180px", 
    maxWidth: "calc(100vw - 24px)",
    boxSizing: "border-box",
    zIndex: 9999999, 
    padding: "6px" 
  },  
  dropdownItem: { padding: "10px 14px", textAlign: "left", background: "transparent", border: "none", fontSize: "13px", fontWeight: "700", cursor: "pointer", borderRadius: "8px", whiteSpace: "nowrap", width: "100%" },

  mainContent: { flex: 1, display: "flex", flexDirection: "column" },

  salesStatsBanner: {
    marginBottom: "16px",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    boxSizing: "border-box",
    width: "100%"
  },
  salesStatsHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "10px",
    flexWrap: "wrap",
    gap: "8px"
  },
  salesStatsWelcomeTitle: {
    fontSize: "17px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "0 0 2px 0",
    letterSpacing: "-0.3px"
  },
  salesStatsWelcomeSub: {
    fontSize: "12px",
    color: "#64748b",
    margin: 0,
    fontWeight: "500"
  },
  statsTimeframePill: {
    display: "flex",
    backgroundColor: "#e2e8f0",
    borderRadius: "20px",
    padding: "2px",
    gap: "2px"
  },
  statsTimeframeBtn: {
    border: "none",
    padding: "4px 10px",
    borderRadius: "16px",
    fontSize: "11px",
    cursor: "pointer",
    transition: "all 0.15s ease"
  },
  salesStatsCardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "10px",
    width: "100%",
    boxSizing: "border-box"
  },
  salesStatCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "9px 12px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    minWidth: 0
  },
  statCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "4px"
  },
  statCardIconCircle: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    backgroundColor: "#0d9488",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  statCardTitle: {
    fontSize: "11.5px",
    fontWeight: "600",
    color: "#64748b",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  statCardThreeDots: {
    fontSize: "14px",
    color: "#94a3b8",
    cursor: "pointer",
    fontWeight: "800",
    lineHeight: 1,
    padding: "0 2px"
  },
  statCardValue: {
    fontSize: "17px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "0 0 3px 0",
    letterSpacing: "-0.4px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  statCardSubtext: {
    fontSize: "10px",
    fontWeight: "600",
    color: "#10b981",
    display: "flex",
    alignItems: "center",
    gap: "3px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  statCardArrowUp: {
    fontSize: "10.5px",
    fontWeight: "800"
  },

  posLayout: { 
    display: "flex", 
    flexDirection: "row", 
    flex: 1, 
    height: "100%", 
    maxHeight: "100%",
    boxSizing: "border-box", 
    overflow: "hidden",
    minHeight: 0
  },  
  posLeftPane: { 
    width: "640px", 
    minWidth: "520px", 
    maxWidth: "720px", 
    backgroundColor: "#ffffff", 
    borderRight: "1px solid #e2e8f0", 
    display: "flex", 
    flexDirection: "column", 
    boxSizing: "border-box", 
    height: "100%", 
    maxHeight: "100%",
    flexShrink: 0,
    overflow: "hidden" 
  },
  posHeaderTop: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 28px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 },
  clearCartBtn: { background: "transparent", border: "none", color: "#ef4444", fontWeight: "800", fontSize: "13px", cursor: "pointer" },
  posBillItemsList: { flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 28px", display: "flex", flexDirection: "column", gap: "14px" },
  posEmptyBox: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "8px", minHeight: "220px" },
  posBillRow: { display: "flex", alignItems: "center", backgroundColor: "#f8fafc", padding: "14px 20px", borderRadius: "14px", border: "1px solid #f1f5f9" },
  posRowImg: { width: "54px", height: "54px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 },
  posRowTitle: { fontSize: "15px", fontWeight: "700", color: "#1e293b", margin: "0 0 3px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  posRowSub: { fontSize: "13px", color: "#64748b", margin: 0, fontWeight: "600" },
  posRowPrice: { fontSize: "17px", fontWeight: "800", color: "#0f172a", whiteSpace: "nowrap" },
  posRowActions: { display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end", flexShrink: 0, marginLeft: "12px" },
  deleteRowBtn: { background: "transparent", border: "none", cursor: "pointer", fontSize: "17px" },
  
  // Custom Orange Border Pill for Quantity control in Web Cart
  cartQtyPill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff7ed",
    border: "1.5px solid #fed7aa",
    borderRadius: "18px",
    padding: "2px 10px",
    width: "86px",
    height: "34px",
    flexShrink: 0,
    boxSizing: "border-box"
  },
  cartQtyBtn: {
    background: "transparent",
    border: "none",
    color: "#ea580c",
    fontSize: "17px",
    fontWeight: "800",
    cursor: "pointer",
    padding: "0 4px",
    lineHeight: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  cartQtyNum: {
    fontSize: "14px",
    fontWeight: "800",
    color: "#0f172a"
  },

  posBillFooter: { borderTop: "2px solid #f1f5f9", padding: "16px 28px 20px", backgroundColor: "#fff", flexShrink: 0, marginTop: "auto" },
  posTotalRow: { display: "flex", justifyContent: "space-between", fontSize: "19px", fontWeight: "800", color: "#0f172a", marginBottom: "14px" },
  posTotalPrice: { color: "#fc8019", fontSize: "24px" },
  posCheckoutBtn: { width: "100%", padding: "16px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "12px", fontWeight: "800", fontSize: "16px", cursor: "pointer", textAlign: "center", boxShadow: "0 4px 14px rgba(37, 99, 235, 0.28)" },

  posRightPane: { flex: 1, backgroundColor: "#f8fafc", padding: "20px 24px", height: "100%", maxHeight: "100%", overflowY: "auto", display: "flex", flexDirection: "column", boxSizing: "border-box", minWidth: 0 },
  posCardQtyControl: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    border: "1.5px solid #fed7aa",
    borderRadius: "8px",
    padding: "2px 8px",
    width: "100%",
    height: "33px",
    boxSizing: "border-box"
  },
  posCardQtyBtn: {
    border: "none",
    background: "transparent",
    fontWeight: "800",
    color: "#fc8019",
    cursor: "pointer",
    fontSize: "17px",
    padding: "0 6px",
    lineHeight: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  posCardQtyVal: {
    fontSize: "13px",
    fontWeight: "800",
    color: "#1e293b"
  },
  inCartBadge: {
    position: "absolute",
    top: "8px",
    right: "8px",
    backgroundColor: "#dc2626",
    color: "#ffffff",
    minWidth: "28px",
    height: "28px",
    borderRadius: "14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: "800",
    boxShadow: "0 3px 8px rgba(220, 38, 38, 0.45), 0 1px 3px rgba(0, 0, 0, 0.25)",
    border: "2px solid #ffffff",
    padding: "0 4px",
    boxSizing: "border-box",
    lineHeight: "1",
    zIndex: 2,
    pointerEvents: "none",
    userSelect: "none"
  },

  sectionTitle: { fontSize: "18px", fontWeight: "800", color: "#0f172a", marginBottom: "14px" },
  categoryScroll: { display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "10px", marginBottom: "16px", flexShrink: 0 },
  categoryCard: { padding: "8px 16px", borderRadius: "20px", cursor: "pointer", fontWeight: "700", fontSize: "13px", whiteSpace: "nowrap", border: "1px solid #e2e8f0", flexShrink: 0 },
  productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "16px", paddingBottom: "30px" },
  productCard: { backgroundColor: "#ffffff", borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column", transition: "transform 0.15s ease, box-shadow 0.15s ease" },
  imageWrapper: { position: "relative", height: "145px", width: "100%", backgroundColor: "#f1f5f9" },
  productImg: { width: "100%", height: "100%", objectFit: "cover" },
  stockBadge: { position: "absolute", bottom: "8px", left: "8px", backgroundColor: "rgba(0, 0, 0, 0.75)", color: "#fff", padding: "3px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: "700" },
  productDetails: { padding: "12px", display: "flex", flexDirection: "column", gap: "6px", flex: 1, justifyContent: "space-between" },
  productName: { fontSize: "14px", fontWeight: "700", color: "#1e293b", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  productCategory: { fontSize: "13px", color: "#64748b", margin: 0, fontWeight: "600" },
  addBillBtn: { width: "100%", padding: "8px 10px", backgroundColor: "#fff7ed", color: "#fc8019", border: "1px solid #fed7aa", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "12px", textAlign: "center", boxSizing: "border-box" },
  
  floatingBar: { position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", backgroundColor: "#fc8019", color: "#fff", padding: "12px 24px", borderRadius: "30px", display: "flex", justifyContent: "space-between", alignItems: "center", width: "90%", maxWidth: "500px", boxShadow: "0 10px 25px rgba(252, 128, 25, 0.4)", cursor: "pointer", zIndex: 999, boxSizing: "border-box" },
  editCardBtn: { flex: 1, padding: "6px", backgroundColor: "#e0e7ff", color: "#4f46e5", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  deleteCardBtn: { flex: 1, padding: "6px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  printBillBtn: { padding: "6px 12px", backgroundColor: "#f1f5f9", color: "#1e293b", border: "1.5px solid #cbd5e1", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "12px", whiteSpace: "nowrap" },
  centerBox: { gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#64748b", fontWeight: "600", fontSize: "14px" },
  addNewBtn: { padding: "8px 16px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px", whiteSpace: "nowrap" },

  paymentCardsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "4px" },
  paymentCardOption: { padding: "10px", borderRadius: "10px", border: "2px solid #cbd5e1", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", cursor: "pointer", transition: "all 0.2s" },

  qrContainer: { display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: "#f8fafc", padding: "12px", borderRadius: "10px", border: "1px dashed #cbd5e1", margin: "10px 0", gap: "8px" },
  qrBox: { backgroundColor: "#fff", padding: "8px", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },

  modalOverlay: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 10000, padding: "16px", boxSizing: "border-box" },
  modalBox: { backgroundColor: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 25px rgba(0,0,0,0.2)", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto" },
  modalForm: { display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "4px" },
  label: { fontSize: "12px", fontWeight: "700", color: "#334155" },
  modalInput: { padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" },
  modalBtns: { display: "flex", gap: "8px", marginTop: "12px" },
  saveModalBtn: { flex: 1, padding: "12px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" },
  cancelModalBtn: { flex: 1, padding: "12px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }
};