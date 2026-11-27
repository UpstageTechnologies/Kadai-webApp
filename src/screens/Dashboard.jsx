import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";
import Profile from "./Profile";
import Settings from "./Settings";
import Subscription from "./Subscription";
import StaffManagement from "./StaffManagement";
import OnlineOrders from "./OnlineOrders";
import RecipeManagement from "./RecipeManagement";
import WasteManagement from "./WasteManagement";
import PurchaseReport from "./PurchaseReport";
import FeedbackScreen from "./FeedbackScreen";
import BranchManagement from "./BranchManagement";
import TerminalManagement from "./TerminalManagement";
import PosTerminalBar from "../components/PosTerminalBar";
import RoomManagement from "./medical/RoomManagement";
import LabManagement from "./medical/LabManagement";
import CustomerManagement from "./CustomerManagement";
import { resolveUserSubscription, canAddInventoryItem } from "../utils/subscriptionService";
import { getDefaultPrintSettings, normalizePrintSettings, executePrint } from "../utils/printEngine";
import { getOrderClassification, playNotificationSound, getNextDailyTokenNumber, getWhatsAppEBillUrl, notifyOwner } from "../utils/restaurantOrderService";
import { subscribeWasteRecords, calculateWasteStats } from "../utils/wasteService";
import { deductRecipeStock } from "../utils/recipeStockService";
import {
  INVENTORY_MODES,
  assignUnassignedProductsToTerminal,
  ensurePrimaryTerminalSeeded,
  filterProductsForCatalog,
  getAuthorizedTerminalsForStaff,
  getShopInventoryMode,
  recordTerminalSaleTransaction,
  setShopInventoryMode,
  subscribeFloors,
  subscribeTerminals,
} from "../utils/terminalService";
import {
  DEFAULT_CRM_CONFIG,
  calculateMaxRedeemable,
  isValidPhone10,
  mergeCrmConfig,
  normalizePhone10,
  recordPosSaleCustomerTransaction,
} from "../utils/customerCrmService";

export default function Dashboard({ initialTab = "sales", pharmacistMode = false }) {
  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
  const [activeTab, setActiveTab] = useState(initialTab === "dashboard" ? "sales" : initialTab);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("uid")));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Hamburger Drawer & Centered Search Bar States
  const [hamburgerOpen, setHamburgerOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef(null);
  
  // Restaurant Mode Detection
  const [shopType, setShopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant = (shopType || "").trim().toLowerCase() === "restaurant";

  // Medical Mode Detection
  const isMedical = (shopType || "").trim().toLowerCase() === "medical";

  // Staff Role & Mode Detection
  const isStaff = localStorage.getItem("is_staff") === "true";
  const staffRole = (localStorage.getItem("staff_role") || "").toLowerCase();
  const staffName = localStorage.getItem("staff_name") || "Staff Member";
  const staffId = localStorage.getItem("staff_id") || "";
  const isPharmacist = pharmacistMode || (isStaff && staffRole === "pharmacist");
  const isWardIncharge = isStaff && (staffRole === "ward_incharge" || staffRole === "ward-incharge" || staffRole === "wardincharge");
  const isLabTechnician = isStaff && (staffRole === "lab_technician" || staffRole === "lab-technician" || staffRole === "labtechnician");

  // Strict role-based tab access enforcement
  useEffect(() => {
    if (isWardIncharge && activeTab !== "rooms") {
      setActiveTab("rooms");
    } else if (isLabTechnician && activeTab !== "lab") {
      setActiveTab("lab");
    } else if (isPharmacist && activeTab !== "sales" && activeTab !== "inventory") {
      setActiveTab("sales");
    } else if (isStaff && activeTab === "terminals") {
      setActiveTab("sales");
    }
  }, [isWardIncharge, isLabTechnician, isPharmacist, isStaff, activeTab]);

  // Shop Mode: Local vs Global
  const [appMode, setAppMode] = useState(() => localStorage.getItem("app_mode") || "local");
  const isGlobalMode = appMode === "global";
  const [rawUserData, setRawUserData] = useState(null);
  const userSubscription = resolveUserSubscription(rawUserData);

  // User Profile & Settings States
  const [userProfile, setUserProfile] = useState({ name: "", email: "", phone: "", storeName: "Kadai Pro Store", profileImage: "" });

  // Multi-Store Branches Management State
  const [activeBranchId, setActiveBranchId] = useState(() => localStorage.getItem("active_branch_id") || "main_branch");
  const [activeBranchName, setActiveBranchName] = useState(() => localStorage.getItem("active_branch_name") || "Main Branch");
  const [branchesList, setBranchesList] = useState([]);

  useEffect(() => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    const unsub = onSnapshot(collection(db, "users", currentUid, "branches"), async (snap) => {
      let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Ensure Primary Main Branch exists in Firestore
      const hasPrimary = list.some((b) => b.isPrimary || b.id === "main_branch" || b.code === "BR-01");
      if (list.length === 0 || !hasPrimary) {
        try {
          const mainRef = doc(db, "users", currentUid, "branches", "main_branch");
          const defaultBranch = {
            name: `${userProfile.storeName || "Turf Cafe"} - Main Branch`,
            code: "BR-01",
            address: "Main Store Location",
            phone: userProfile.mobile || userProfile.phone || "",
            managerName: userProfile.name || "Restaurant Manager",
            isPrimary: true,
            status: "active",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          await setDoc(mainRef, defaultBranch, { merge: true });
          if (!list.some(b => b.id === "main_branch")) {
            list = [{ id: "main_branch", ...defaultBranch }, ...list];
          }
        } catch (e) {
          console.warn("Could not seed main branch in Firestore:", e);
        }
      }

      // Sort so primary branch is always first
      list.sort((a, b) => {
        if (a.isPrimary || a.id === "main_branch") return -1;
        if (b.isPrimary || b.id === "main_branch") return 1;
        return (a.code || "").localeCompare(b.code || "");
      });

      setBranchesList(list);

      // Keep active branch valid
      if (list.length > 0) {
        const found = list.find((b) => b.id === activeBranchId || (activeBranchId === "main_default" && (b.isPrimary || b.id === "main_branch")));
        if (found) {
          setActiveBranchId(found.id);
          setActiveBranchName(found.name);
          localStorage.setItem("active_branch_id", found.id);
          localStorage.setItem("active_branch_name", found.name);
        } else {
          const primary = list.find((b) => b.isPrimary || b.id === "main_branch") || list[0];
          setActiveBranchId(primary.id);
          setActiveBranchName(primary.name);
          localStorage.setItem("active_branch_id", primary.id);
          localStorage.setItem("active_branch_name", primary.name);
        }
      }
    });

    return () => unsub();
  }, [activeBranchId, userProfile.storeName]);

  const handleSelectBranch = (branchId, bName) => {
    setActiveBranchId(branchId);
    setActiveBranchName(bName);
    localStorage.setItem("active_branch_id", branchId);
    localStorage.setItem("active_branch_name", bName);
  };

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
  const [wasteRecords, setWasteRecords] = useState([]);
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

  // Store Settings States
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
  const [sendWhatsAppBill, setSendWhatsAppBill] = useState(false);
  const [crmConfig, setCrmConfig] = useState(DEFAULT_CRM_CONFIG);
  const [crmCustomers, setCrmCustomers] = useState([]);
  const [redeemLoyaltyPoints, setRedeemLoyaltyPoints] = useState(false);

  // Success Animated Popup Modal State
  const [popupModal, setPopupModal] = useState({ show: false, message: "" });

  // Customer Product Feedback & Rating Modal States
  const [customerFeedbacks, setCustomerFeedbacks] = useState([]);
  const [selectedProductForFeedback, setSelectedProductForFeedback] = useState(null);
  const [showProductFeedbackModal, setShowProductFeedbackModal] = useState(false);
  const [feedbackCustomerName, setFeedbackCustomerName] = useState("");
  const [feedbackCustomerMobile, setFeedbackCustomerMobile] = useState("");
  const [feedbackRatingStars, setFeedbackRatingStars] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [savingProductFeedback, setSavingProductFeedback] = useState(false);
  const [showAddReviewForm, setShowAddReviewForm] = useState(false);

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

  // Real-time Online Orders & Delivery States
  const [onlineOrdersList, setOnlineOrdersList] = useState([]);
  const [deliveryStaffList, setDeliveryStaffList] = useState([]);
  const [doorDeliveryEnabled, setDoorDeliveryEnabled] = useState(true);
  const [onlineOrderToast, setOnlineOrderToast] = useState(null);
  const knownOnlineOrderIdsRef = useRef(new Set());
  const isFirstOnlineOrdersSyncRef = useRef(true);

  // Store Owner Live Sales & Online Notifications Feed
  const [ownerNotifications, setOwnerNotifications] = useState([]);
  const [ownerNotifDropdownOpen, setOwnerNotifDropdownOpen] = useState(false);
  const ownerNotifBtnRef = useRef(null);

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
  const [productFloorId, setProductFloorId] = useState("all");
  const [productTerminalId, setProductTerminalId] = useState("all");
  const [inventoryFloorFilter, setInventoryFloorFilter] = useState("all");
  const [inventoryTerminalFilter, setInventoryTerminalFilter] = useState("all");

  // POS Floor & Terminal Architecture States
  const [floorsList, setFloorsList] = useState([]);
  const [terminalsList, setTerminalsList] = useState([]);
  const [terminalsLoaded, setTerminalsLoaded] = useState(false);
  const [activeTerminalId, setActiveTerminalId] = useState(() => {
    const uid = localStorage.getItem("uid") || "";
    return uid ? localStorage.getItem(`active_terminal_id_${uid}`) || "" : "";
  });
  const [activeSessionDoc, setActiveSessionDoc] = useState(null);
  const [isSubmittingCheckout, setIsSubmittingCheckout] = useState(false);
  const checkoutIdempotencyRef = useRef("");
  const primarySeedAttemptedRef = useRef(false);

  const shopInventoryMode = rawUserData?.inventoryMode
    ? getShopInventoryMode(rawUserData)
    : terminalsList.length > 1
    ? INVENTORY_MODES.TERMINAL_WISE
    : INVENTORY_MODES.SHARED;

  const primaryTerminalObj = useMemo(() => {
    if (terminalsList.length === 0) return null;
    const explicit = terminalsList.find((t) => t.isPrimary === true || t.id === "terminal_1");
    if (explicit) return explicit;
    const sorted = [...terminalsList].sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() || (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
      const bMs = b.createdAt?.toMillis?.() || (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
      if (aMs !== bMs) return aMs - bMs;
      return String(a.code || a.name || "").localeCompare(String(b.code || b.name || ""));
    });
    return sorted[0] || null;
  }, [terminalsList]);

  const authorizedTerminalsForUser = useMemo(
    () =>
      getAuthorizedTerminalsForStaff({
        terminals: terminalsList,
        floors: floorsList,
        shopId: currentUid,
        staffId,
        isOwner: !isStaff,
      }),
    [terminalsList, floorsList, currentUid, staffId, isStaff]
  );

  const activeTerminalObj = useMemo(() => {
    if (!activeTerminalId) {
      if (isStaff && authorizedTerminalsForUser.length === 1) {
        return authorizedTerminalsForUser[0];
      }
      if (!isStaff && authorizedTerminalsForUser.length > 0) {
        return (
          authorizedTerminalsForUser.find((t) => t.id === primaryTerminalObj?.id) ||
          authorizedTerminalsForUser[0]
        );
      }
      return null;
    }
    return (
      authorizedTerminalsForUser.find((t) => t.id === activeTerminalId) ||
      (!isStaff ? authorizedTerminalsForUser[0] || null : null)
    );
  }, [activeTerminalId, isStaff, authorizedTerminalsForUser, primaryTerminalObj?.id]);

  const handleSelectActiveTerminal = (term) => {
    const tId = term?.id || "";
    setActiveTerminalId(tId);
    if (currentUid) {
      if (tId) {
        localStorage.setItem(`active_terminal_id_${currentUid}`, tId);
      } else {
        localStorage.removeItem(`active_terminal_id_${currentUid}`);
      }
    }
  };

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

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setHamburgerOpen(false);
        setProfileDropdownOpen(false);
        setShopModeDropdownOpen(false);
      }
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

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
      @keyframes slideInLeft {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(0); }
      }
      @keyframes fadeInOverlay {
        0% { opacity: 0; }
        100% { opacity: 1; }
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
          phone: data.phone || data.mobile || "",
          address: typeof data.address === "string" ? data.address : (data.address?.fullAddress || ""),
          storeName: activeStoreName,
          shopName: activeStoreName,
          profileImage: (isGlobalMode ? data.global_shopLogo : data.local_shopLogo) || data.profileImage || data.shopLogo || ""
        });
        const dEnabled = data.doorDeliveryEnabled ?? data.deliveryConfig?.doorDeliveryEnabled ?? true;
        setDoorDeliveryEnabled(dEnabled);
        if (data.settings) {
          setStoreSettings(data.settings);
        }
        if (data.crmConfig) {
          setCrmConfig(mergeCrmConfig(data.crmConfig));
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
                isPaid: false,
                message: `Table ${classification.tableNo} – Order Completed. Bill is Ready at Counter.`,
                order: o,
              });
            }

            // Kitchen marked order ready
            if (o.status === "ready" && !notifiedServedOrdersRef.current.has(o.id + "_ready_alert")) {
              notifiedServedOrdersRef.current.add(o.id + "_ready_alert");
              playNotificationSound("foodReady");
              const tokStr = o.tokenNumber || o.tokenNo ? `TOKEN #${o.tokenNumber || o.tokenNo}` : (o.orderNumber || "Order");
              const isOrderPaid = o.isPaid === true || !!o.billNo || !!o.billedAt;
              
              if (isOrderPaid) {
                setCounterToast({
                  id: o.id,
                  isPaid: true,
                  message: `🛎️ Food Ready: ${tokStr} (PAID ✅) • Bill #${o.billNo || "Direct"} – Ready for Customer Pickup!`,
                  order: o,
                });
              } else if (classification.isParcel) {
                setCounterToast({
                  id: o.id,
                  isPaid: false,
                  message: `Food Ready & Packed – ${tokStr ? `${tokStr} • ` : ""}PARCEL (${classification.customerName}). Ready to Bill!`,
                  order: o,
                });
              } else {
                setCounterToast({
                  id: o.id,
                  isPaid: false,
                  message: `🛎️ Food Ready for ${tokStr} (${classification.customerName})!`,
                  order: o,
                });
              }
            }
          }
        });
      }
    }, (err) => {
      console.warn("Kitchen orders sync listener notice:", err);
    });

    // 6. Real-time Customer Online Orders & Delivery Sync
    const localOrdersRef = collection(db, "users", currentUid, "local_orders");
    const globalOrdersRef = collection(db, "users", currentUid, "global_orders");
    const staffColRef = collection(db, "users", currentUid, "staffs");

    let currentLocalOnline = [];
    let currentGlobalOnline = [];

    const syncCombinedOnlineOrders = () => {
      const combined = [...currentLocalOnline, ...currentGlobalOnline];
      combined.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0);
        const timeB = b.createdAt?.toMillis?.() || (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0);
        return timeB - timeA;
      });
      setOnlineOrdersList(combined);
    };

    const processOnlineOrderChanges = (snapshot, isGlobal) => {
      if (isFirstOnlineOrdersSyncRef.current) {
        snapshot.docs.forEach((d) => {
          knownOnlineOrderIdsRef.current.add(d.id);
        });
      } else {
        snapshot.docChanges().forEach((change) => {
          const ord = { ...change.doc.data(), id: String(change.doc.id), orderDocId: String(change.doc.id), isGlobalMode: isGlobal };
          const custName = (ord.customerName || "").toLowerCase().trim();
          const orderType = (ord.orderType || ord.type || "").toLowerCase().trim();
          if (
            custName.includes("walk-in") ||
            custName === "walk in customer" ||
            orderType.includes("walk-in") ||
            ord.isWalkIn === true
          ) {
            return;
          }

          if (change.type === "added") {
            if (!knownOnlineOrderIdsRef.current.has(change.doc.id)) {
              knownOnlineOrderIdsRef.current.add(change.doc.id);
              const s = (ord.status || "Pending Verification").toLowerCase();
              if (["pending verification", "accepted"].includes(s)) {
                playNotificationSound("onlineOrder");
                setOnlineOrderToast({
                  id: ord.id,
                  isDelivered: false,
                  message: `Order #${ord.orderId || ord.id.slice(-6).toUpperCase()} • ₹${ord.totalAmount || ord.total || 0} (${ord.customerName || "Customer"})`,
                  order: ord,
                });

                // Send real-time notification to store owner for online sales
                try {
                  notifyOwner({
                    db,
                    uid: currentUid,
                    type: "online_order",
                    title: `🛵 New Online Order: ₹${ord.totalAmount || ord.total || 0}`,
                    body: `${ord.customerName || "Customer"} • Order #${ord.orderId || ord.id.slice(-6).toUpperCase()} (${isGlobal ? "Global Delivery" : "Local Store Order"})`,
                    data: {
                      orderId: ord.orderId || ord.id,
                      totalAmount: ord.totalAmount || ord.total || 0,
                      customerName: ord.customerName || "Customer",
                      isGlobalMode: isGlobal,
                      storeName: userProfile.storeName || "Turf Cafe",
                    }
                  });
                } catch (notifErr) {
                  console.warn("Online order owner notification notice:", notifErr);
                }
              }
            }
          } else if (change.type === "modified") {
            if (ord.status === "Delivered" && !knownOnlineOrderIdsRef.current.has(ord.id + "_delivered_notified")) {
              knownOnlineOrderIdsRef.current.add(ord.id + "_delivered_notified");
              playNotificationSound("orderDelivered");
              setOnlineOrderToast({
                id: ord.id,
                isDelivered: true,
                message: `Order #${ord.orderId || ord.id.slice(-6).toUpperCase()} Marked Finished & Delivered!`,
                order: ord,
              });
            }
          }
        });
      }
    };

    const unsubscribeLocalOrders = onSnapshot(localOrdersRef, (snap) => {
      currentLocalOnline = snap.docs.map((d) => ({
        ...d.data(),
        id: String(d.id),
        orderDocId: String(d.id),
        isGlobalMode: false,
      }));
      processOnlineOrderChanges(snap, false);
      syncCombinedOnlineOrders();
      isFirstOnlineOrdersSyncRef.current = false;
    }, (err) => {
      console.warn("Local online orders sync notice:", err?.message);
    });

    const unsubscribeGlobalOrders = onSnapshot(globalOrdersRef, (snap) => {
      currentGlobalOnline = snap.docs.map((d) => ({
        ...d.data(),
        id: String(d.id),
        orderDocId: String(d.id),
        isGlobalMode: true,
      }));
      processOnlineOrderChanges(snap, true);
      syncCombinedOnlineOrders();
      isFirstOnlineOrdersSyncRef.current = false;
    }, (err) => {
      console.warn("Global online orders sync notice:", err?.message);
    });

    const unsubscribeDeliveryStaff = onSnapshot(staffColRef, (snap) => {
      const dStaff = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.role === "delivery");
      setDeliveryStaffList(dStaff);
    }, (err) => {
      console.warn("Staff listener notice:", err?.message);
    });

    // 7. Real-time Store Owner Sales & Online Notifications Feed
    const ownerNotifRef = collection(db, "users", currentUid, "owner_notifications");
    const unsubscribeOwnerNotif = onSnapshot(ownerNotifRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      setOwnerNotifications(list.slice(0, 40));
    }, (err) => {
      console.warn("Owner notifications listener notice:", err);
    });

    // 8. Real-time Waste & Spoilage Records Sync
    const unsubscribeWaste = subscribeWasteRecords(
      db,
      currentUid,
      (records) => {
        setWasteRecords(records);
      },
      (err) => {
        console.warn("Waste records listener notice:", err);
      }
    );

    // 9. Real-time Customer Feedbacks Sync (Product level reviews)
    const feedbackRef = collection(db, "users", currentUid, "customer_feedbacks");
    const unsubscribeFeedback = onSnapshot(feedbackRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCustomerFeedbacks(list);
    }, (err) => {
      console.warn("Customer feedbacks listener notice:", err);
    });

    // 10. Real-time Customer CRM Directory Sync
    const crmCustRef = collection(db, "users", currentUid, "customers");
    const unsubscribeCrmCustomers = onSnapshot(crmCustRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => Number(b.totalOrders || 0) - Number(a.totalOrders || 0));
      setCrmCustomers(list);
    }, (err) => {
      console.warn("Customer CRM listener notice:", err);
    });

    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("scroll", () => setProfileDropdownOpen(false), true);
      window.removeEventListener("resize", () => setProfileDropdownOpen(false));
      window.removeEventListener("keydown", handleKeyDown);
      unsubscribeUser();
      unsubscribeInventory();
      unsubscribeOrders();
      unsubscribeHeldOrders();
      unsubscribeKitchenOrders();
      unsubscribeLocalOrders();
      unsubscribeGlobalOrders();
      unsubscribeDeliveryStaff();
      unsubscribeOwnerNotif();
      unsubscribeWaste();
      unsubscribeFeedback();
      unsubscribeCrmCustomers();
    };
  }, [isRestaurant, appMode]);

  // Real-time Active Cart Sync (scoped per selected POS terminal to prevent counter collisions)
  useEffect(() => {
    const uid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!uid) return undefined;
    const cartDocId = activeTerminalObj?.id ? `terminal_${activeTerminalObj.id}` : "current";
    const activeCartRef = doc(db, "users", uid, "active_cart", cartDocId);
    const unsub = onSnapshot(
      activeCartRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCurrentBill(data.items || []);
        } else {
          setCurrentBill([]);
        }
      },
      (err) => {
        console.error("Cart sync listener error:", err);
      }
    );
    return () => unsub();
  }, [activeTerminalObj?.id]);

  // Real-time Floors & POS Terminals Sync
  useEffect(() => {
    const uid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!uid) return undefined;

    const unsubFloors = subscribeFloors(
      db,
      uid,
      (list) => setFloorsList(list),
      (err) => console.warn("Floors sync notice:", err)
    );
    const unsubTerminals = subscribeTerminals(
      db,
      uid,
      (list) => {
        setTerminalsList(list);
        setTerminalsLoaded(true);
      },
      (err) => {
        console.warn("Terminals sync notice:", err);
        setTerminalsLoaded(true);
      }
    );

    return () => {
      unsubFloors();
      unsubTerminals();
    };
  }, []);

  // Auto-seed Primary Terminal 1 when a shop starts using multiple terminals (preserves existing cafe/shop items on Terminal 1)
  useEffect(() => {
    const uid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (
      !uid ||
      isStaff ||
      !terminalsLoaded ||
      !rawUserData ||
      primarySeedAttemptedRef.current
    ) {
      return;
    }
    if (rawUserData.primaryTerminalSeeded === true) {
      primarySeedAttemptedRef.current = true;
      return;
    }
    if (terminalsList.length === 0) return;
    primarySeedAttemptedRef.current = true;
    ensurePrimaryTerminalSeeded(db, uid, {
      floors: floorsList,
      terminals: terminalsList,
      rawUserData,
      storeName: userProfile.storeName || "Main Counter",
    }).catch((err) => console.warn("Primary terminal auto-seed notice:", err));
  }, [isStaff, terminalsLoaded, rawUserData, terminalsList, floorsList, userProfile.storeName]);

  // Real-time Active Billing Session Sync for Selected Terminal
  useEffect(() => {
    const uid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!uid || !activeTerminalObj?.id || !activeTerminalObj?.currentSessionId) {
      return undefined;
    }
    const sessRef = doc(
      db,
      "users",
      uid,
      "terminals",
      activeTerminalObj.id,
      "sessions",
      activeTerminalObj.currentSessionId
    );
    const unsub = onSnapshot(
      sessRef,
      (snap) => {
        if (snap.exists() && snap.data().status === "open") {
          setActiveSessionDoc({ id: snap.id, ...snap.data() });
        } else {
          setActiveSessionDoc(null);
        }
      },
      (err) => console.warn("Active session sync notice:", err)
    );
    return () => unsub();
  }, [activeTerminalObj?.id, activeTerminalObj?.currentSessionId]);

  // Scope Speed Dial slots per active terminal so each terminal keeps its own quick keys
  useEffect(() => {
    const uid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
    if (!uid) return;
    const isRest = (shopType || "").trim().toLowerCase() === "restaurant";
    const modeKey = isRest ? "restaurant" : isGlobalMode ? "global" : "local";
    const termSuffix = activeTerminalObj?.id ? `_${activeTerminalObj.id}` : "";
    const termStorageKey = `speed_dial_slots_${modeKey}_${uid}${termSuffix}`;
    const legacyStorageKey = `speed_dial_slots_${modeKey}_${uid}`;
    const isPrimary = !activeTerminalObj?.id || activeTerminalObj.id === primaryTerminalObj?.id;

    const savedTermSlots = localStorage.getItem(termStorageKey);
    if (savedTermSlots) {
      try {
        setSpeedDialSlots(JSON.parse(savedTermSlots));
        return;
      } catch (e) {
        console.warn("Could not parse terminal speed dial slots:", e);
      }
    }
    if (rawUserData?.speedDialSlots?.[`${modeKey}${termSuffix}`]) {
      setSpeedDialSlots(rawUserData.speedDialSlots[`${modeKey}${termSuffix}`]);
      return;
    }
    if (isPrimary) {
      const legacySaved = localStorage.getItem(legacyStorageKey);
      if (legacySaved) {
        try {
          setSpeedDialSlots(JSON.parse(legacySaved));
          return;
        } catch (e) {
          console.warn("Could not parse legacy speed dial slots:", e);
        }
      }
      if (rawUserData?.speedDialSlots?.[modeKey]) {
        setSpeedDialSlots(rawUserData.speedDialSlots[modeKey]);
        return;
      }
    }
    setSpeedDialSlots({});
  }, [activeTerminalObj?.id, primaryTerminalObj?.id, shopType, isGlobalMode, rawUserData]);

  const resolvedActiveSession =
    activeTerminalObj?.currentSessionId &&
    activeSessionDoc?.id === activeTerminalObj.currentSessionId &&
    activeSessionDoc?.status === "open"
      ? activeSessionDoc
      : null;

  // Derived Kitchen & Table Orders
  const activeKitchenOrders = kitchenOrders.filter((o) => o.status !== "completed");
  
  // 1. Unpaid orders waiting to be billed at counter (Dine-in tables served, unpaid parcel ready)
  // MUST NOT be already paid or billed!
  const unpaidReadyToBillOrders = activeKitchenOrders.filter((o) => {
    if (o.status === "completed") return false;
    if (o.isPaid === true || o.billNo || o.billedAt || o.billedAtMs) return false;
    const classification = getOrderClassification(o);
    if (classification.isParcel) {
      return o.status === "ready" || o.status === "served";
    }
    if (classification.isTable) {
      return o.status === "served";
    }
    return o.status === "served" || o.status === "ready";
  });

  // 2. Already paid orders whose food is cooked & ready for customer pickup / handover:
  const paidReadyOrders = activeKitchenOrders.filter((o) => {
    if (o.status === "completed") return false;
    if (!o.isPaid && !o.billNo && !o.billedAt && !o.billedAtMs) return false;
    return o.status === "ready" || o.status === "served";
  });

  // Alias for backward compatibility:
  const servedTableOrders = unpaidReadyToBillOrders;

  const cookingTableOrders = activeKitchenOrders.filter((o) => {
    return o.status === "pending" || o.status === "preparing";
  });

  // Derived New Online Orders Count for Navbar Notification Badge
  const newOnlineOrdersCount = useMemo(() => {
    return onlineOrdersList.filter(o => {
      const custName = (o.customerName || "").toLowerCase().trim();
      const orderType = (o.orderType || o.type || "").toLowerCase().trim();
      if (
        custName.includes("walk-in") ||
        custName === "walk in customer" ||
        orderType.includes("walk-in") ||
        o.isWalkIn === true
      ) {
        return false;
      }
      const s = (o.status || "Pending Verification").toLowerCase();
      return ["pending verification", "accepted", "packed", "out for delivery"].includes(s);
    }).length;
  }, [onlineOrdersList]);

  const getOrderElapsedMinutes = (createdAtMs) => {
    if (!createdAtMs) return "Just now";
    const diff = Math.floor((Date.now() - createdAtMs) / 60000);
    if (diff <= 0) return "Just now";
    if (diff === 1) return "1 min ago";
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
  };

  // Helper to get Customer Feedback & Star Ratings for any product (Real Customer Data Only)
  const getProductFeedbackData = (product) => {
    if (!product) return { avg: null, count: 0, reviews: [] };
    const pId = String(product.id || "");
    const pName = (product.itemName || product.name || "").toLowerCase().trim();

    // 1. Check real customer feedbacks saved in Firestore matching this product
    const firestoreReviews = (customerFeedbacks || []).filter((fb) => {
      const fbProdId = String(fb.productId || "");
      const fbProdName = (fb.productName || "").toLowerCase().trim();
      return (pId && fbProdId === pId) || (pName && fbProdName === pName);
    });

    // 2. Also check customer ratings/reviews submitted on online customer orders
    const orderReviews = [];
    (onlineOrdersList || []).forEach((ord) => {
      if (Array.isArray(ord.items)) {
        ord.items.forEach((it) => {
          const itId = String(it.id || it.productId || "");
          const itName = (it.name || it.itemName || "").toLowerCase().trim();
          if ((pId && itId === pId) || (pName && itName === pName)) {
            const rVal = Number(it.rating || it.itemRating || ord.rating || ord.orderRating || 0);
            if (rVal > 0) {
              orderReviews.push({
                id: ord.id + "_" + (it.id || "item"),
                name: ord.customerName || "Customer",
                rating: Math.min(5, Math.max(1, Math.round(rVal))),
                date: ord.createdAt?.toDate ? ord.createdAt.toDate().toLocaleDateString("en-IN") : "Recent Order",
                comment: it.review || it.feedback || ord.review || ord.customerFeedback || "Verified Customer Order",
                isReal: true,
              });
            }
          }
        });
      }
    });

    const allRealReviews = [
      ...firestoreReviews.map((r) => ({
        id: r.id,
        name: r.customerName || "Customer",
        rating: Math.min(5, Math.max(1, Math.round(Number(r.rating || r.foodOrProductRating || r.overallRating || 5)))),
        date: r.dateStr || "Recently",
        comment: r.comments || "",
        isReal: true,
      })),
      ...orderReviews
    ];

    if (allRealReviews.length > 0) {
      const sum = allRealReviews.reduce((acc, r) => acc + r.rating, 0);
      const avg = (sum / allRealReviews.length).toFixed(1);
      return {
        avg,
        count: allRealReviews.length,
        reviews: allRealReviews,
      };
    }

    // Check if the product document itself has a real rating from customer app / catalog sync
    const productDocRating = Number(product.rating || product.averageRating || 0);
    const productDocCount = Number(product.ratingsCount || product.reviewCount || product.totalRatings || 0);
    if (productDocRating > 0) {
      return {
        avg: productDocRating.toFixed(1),
        count: productDocCount || 1,
        reviews: [],
      };
    }

    // No reviews yet - NO DUMMY DATA!
    return {
      avg: null,
      count: 0,
      reviews: [],
    };
  };

  const openProductFeedbackModal = (item) => {
    setSelectedProductForFeedback(item);
    setFeedbackRatingStars(5);
    setFeedbackComment("");
    setFeedbackCustomerName("");
    setFeedbackCustomerMobile("");
    setShowAddReviewForm(false);
    setShowProductFeedbackModal(true);
  };

  const handleSaveProductFeedback = async (e) => {
    e.preventDefault();
    if (!selectedProductForFeedback) return;
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      alert("Please log in to record customer feedback.");
      return;
    }

    setSavingProductFeedback(true);
    try {
      const pName = selectedProductForFeedback.itemName || selectedProductForFeedback.name || "Food Item";
      const payload = {
        productId: selectedProductForFeedback.id || "",
        productName: pName,
        customerName: feedbackCustomerName.trim() || "Valued Customer",
        customerMobile: feedbackCustomerMobile.trim(),
        rating: Number(feedbackRatingStars || 5),
        foodOrProductRating: Number(feedbackRatingStars || 5),
        comments: feedbackComment.trim() || `Great taste and quality for ${pName}!`,
        branch: activeBranchName || "Main Branch",
        storeType: isRestaurant ? "restaurant" : "shop",
        dateStr: new Date().toLocaleDateString("en-IN"),
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "users", currentUid, "customer_feedbacks"), payload);

      setFeedbackComment("");
      setFeedbackCustomerName("");
      setFeedbackCustomerMobile("");
      setFeedbackRatingStars(5);
      setShowAddReviewForm(false);
      alert(`⭐ Customer review for "${pName}" saved successfully!`);
    } catch (err) {
      console.error("Error saving customer feedback:", err);
      alert("Error saving review: " + err.message);
    } finally {
      setSavingProductFeedback(false);
    }
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
      const targetKot = kitchenOrders.find((k) => k.id === orderId);
      if (targetKot && Array.isArray(targetKot.items) && !targetKot.ingredientsDeducted) {
        try {
          await deductRecipeStock(currentUid, targetKot.items, { branchId: targetKot.branchId || activeBranchId });
        } catch (stockErr) {
          console.warn("[Dashboard] KOT recipe deduction notice:", stockErr);
        }
      }

      await updateDoc(doc(db, "users", currentUid, "kitchen_orders", orderId), {
        status: "completed",
        ingredientsDeducted: true,
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
    const nextTokenNo = getNextDailyTokenNumber({ ordersList, kitchenOrders, uid: currentUid });

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
      tokenNumber: nextTokenNo,
      tokenNo: nextTokenNo,
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
      branchId: activeBranchId || "main_branch",
      branchName: activeBranchName || "Main Branch",
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
        tokenNumber: nextTokenNo,
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
    const prevUid = localStorage.getItem("uid");
    if (prevUid) {
      localStorage.removeItem(`active_terminal_id_${prevUid}`);
    }
    localStorage.removeItem("uid");
    localStorage.removeItem("shop_type");
    localStorage.removeItem("store_name");
    localStorage.removeItem("is_staff");
    localStorage.removeItem("staff_id");
    localStorage.removeItem("staff_name");
    localStorage.removeItem("staff_role");
    window.location.href = "/login";
  };

  const syncWebCartToCloud = async (updatedItems) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;
    try {
      const cartDocId = activeTerminalObj?.id ? `terminal_${activeTerminalObj.id}` : "current";
      const activeCartRef = doc(db, "users", currentUid, "active_cart", cartDocId);
      await setDoc(activeCartRef, {
        items: updatedItems,
        terminalId: activeTerminalObj?.id || null,
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
      appMode: appMode,
      terminalId: activeTerminalObj?.id || null,
      terminalName: activeTerminalObj?.name || null,
      terminalCode: activeTerminalObj?.code || null,
      floorId: activeTerminalObj?.floorId || null,
      floorName: activeTerminalObj?.floorName || null,
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
        appMode: appMode,
        terminalId: activeTerminalObj?.id || null,
        terminalName: activeTerminalObj?.name || null,
        terminalCode: activeTerminalObj?.code || null,
        floorId: activeTerminalObj?.floorId || null,
        floorName: activeTerminalObj?.floorName || null,
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
    const termSuffix = activeTerminalObj?.id ? `_${activeTerminalObj.id}` : "";
    const speedDialKey = `${modeKey}${termSuffix}`;
    const speedDialStorageKey = `speed_dial_slots_${speedDialKey}_${currentUid}`;

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
          [`speedDialSlots.${speedDialKey}`]: updatedSlots
        });
      } catch {
        try {
          await setDoc(doc(db, "users", currentUid), {
            speedDialSlots: {
              [speedDialKey]: updatedSlots
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
    if (currentBill.length === 0 || isSubmittingCheckout) return;
    if (isStaff && terminalsList.length > 0 && (!activeTerminalObj || !resolvedActiveSession)) {
      alert("Please select an authorized POS terminal and open a billing session before completing a sale.");
      return;
    }
    if (paymentMethod === "Credit" && !isValidPhone10(customerPhone)) {
      alert("Please enter a valid 10-digit customer mobile number for Khata / Credit billing.");
      return;
    }
    setIsSubmittingCheckout(true);
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      const idempotencyKey =
        checkoutIdempotencyRef.current ||
        `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      checkoutIdempotencyRef.current = idempotencyKey;

      const totalAmt = totalBillAmount;
      const netPayable = netCheckoutTotal;
      const totalProfit = currentBill.reduce((sum, i) => sum + (Number(i.salesPrice || i.price || 0) - Number(i.purchasePrice || 0)) * i.qty, 0);

      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const datePrefix = `${year}${month}${day}`;
      const termOrdersCount = activeTerminalObj?.id
        ? ordersList.filter((o) => o.terminalId === activeTerminalObj.id).length
        : ordersList.length;
      const sequenceNum = String(termOrdersCount + 1).padStart(4, "0");
      const codePrefix = activeTerminalObj?.code ? `${activeTerminalObj.code}-` : "";
      const bNo = `${codePrefix}${datePrefix}-${sequenceNum}`;
      const bDate = now.toLocaleDateString("en-GB");
      const nextTokenNo = activeTableOrderInfo?.tokenNumber || getNextDailyTokenNumber({ ordersList, kitchenOrders, uid: currentUid });
      
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

      let crmResult = null;
      const validPhone10 = isValidPhone10(customerPhone) ? normalizePhone10(customerPhone) : "";
      if (currentUid && validPhone10) {
        crmResult = await recordPosSaleCustomerTransaction({
          shopId: currentUid,
          customer: {
            ...(matchedCheckoutCustomer || {}),
            phone: validPhone10,
            name: customerName.trim() || matchedCheckoutCustomer?.name || "Customer",
          },
          billNo: bNo,
          grossTotal: totalAmt,
          netPayable,
          paymentMode: paymentMethod === "Credit" ? "CREDIT" : paymentMethod.toUpperCase(),
          loyaltyRedeemedPoints: appliedLoyaltyPoints,
          loyaltyDiscountAmount: appliedLoyaltyDiscount,
          crmConfig,
          staffName: localStorage.getItem("staff_name") || userProfile.name || "Owner",
          shopName: userProfile.storeName || "My Store",
        });
      }

      const saleRecord = {
        billNo: bNo,
        invoiceId: bNo,
        tokenNumber: nextTokenNo,
        tokenNo: nextTokenNo,
        billDate: bDate,
        items: sanitizedBillItems,
        grossTotal: totalAmt,
        total: netPayable,
        totalAmount: netPayable,
        loyaltyDiscount: appliedLoyaltyDiscount,
        loyaltyRedeemedPoints: appliedLoyaltyPoints,
        loyaltyEarnedPoints: crmResult?.earnedPoints || 0,
        profit: Number((totalProfit - appliedLoyaltyDiscount).toFixed(2)),
        customerName: customerName.trim() || matchedCheckoutCustomer?.name || (saleTableNo ? saleTableNo : "Walk-in Customer"),
        customerPhone: validPhone10 || customerPhone.trim() || "N/A",
        customerId: validPhone10 || "",
        customerUid: crmResult?.customerUid || matchedCheckoutCustomer?.customerUid || "",
        orderType: saleOrderType,
        tableNo: saleTableNo,
        paymentMode: paymentMethod === "Credit" ? "CREDIT" : paymentMethod.toUpperCase(),
        paymentMethod: paymentMethod,
        paymentStatus: paymentMethod === "Credit" ? "CREDIT_DUE" : "SUCCESS",
        isGlobalMode: isGlobalMode,
        appMode: appMode,
        isRestaurant: isRestaurant,
        shopType: isRestaurant ? "restaurant" : "retail",
        branchId: activeBranchId || "main_branch",
        branchName: activeBranchName || "Main Branch",
        shopId: currentUid || "",
        floorId: activeTerminalObj?.floorId || null,
        floorName: activeTerminalObj?.floorName || null,
        terminalId: activeTerminalObj?.id || null,
        terminalName: activeTerminalObj?.name || null,
        terminalCode: activeTerminalObj?.code || null,
        sessionId: resolvedActiveSession?.id || null,
        staffId: isStaff ? staffId : "OWNER",
        staffName: isStaff ? staffName : (userProfile.name || "Owner"),
        createdAt: serverTimestamp()
      };

      if (currentUid) {
        // 1. Save sale atomically against active terminal session if open, else standard sales collection
        if (activeTerminalObj && resolvedActiveSession) {
          await recordTerminalSaleTransaction(db, {
            shopId: currentUid,
            terminal: activeTerminalObj,
            session: resolvedActiveSession,
            staffId: isStaff ? staffId : "OWNER",
            staffName: isStaff ? staffName : (userProfile.name || "Store Owner"),
            saleDocId: idempotencyKey,
            saleRecord,
            idempotencyKey,
          });
        } else {
          await setDoc(doc(db, "users", currentUid, "sales", idempotencyKey), saleRecord);
        }

        // Deduct raw material recipe ingredients from stock in real-time
        try {
          await deductRecipeStock(currentUid, sanitizedBillItems, { branchId: activeBranchId || "main_branch" });
        } catch (stockErr) {
          console.warn("Recipe stock deduction notice:", stockErr);
        }

        // 2. Transmit confirmation event to Mobile App
        try {
          const cartDocId = activeTerminalObj?.id ? `terminal_${activeTerminalObj.id}` : "current";
          const cartRef = doc(db, "users", currentUid, "active_cart", cartDocId);
          await setDoc(cartRef, {
            items: [],
            terminalId: activeTerminalObj?.id || null,
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
              tokenNumber: nextTokenNo,
              tokenNo: nextTokenNo,
              tableNo: null,
              waiterId: "COUNTER",
              waiterName: "Counter Billing",
              items: sanitizedKotItems,
              orderNotes: `Direct counter bill: ${bNo}`,
              orderType: isParcelOrder ? "parcel" : "counter",
              customerName: customerName.trim() || (isParcelOrder ? "Parcel Customer" : "Walk-in Customer"),
              customerPhone: customerPhone.trim() || "",
              status: "pending", // KDS receives in real-time as a pending order to cook/pack
              readyForBilling: false,
              isPaid: true, // Food already paid at billing counter
              totalAmount: totalAmt,
              totalItems: currentBill.reduce((sum, i) => sum + (Number(i.qty) || 1), 0),
              masterUid: String(currentUid),
              billNo: bNo,
              branchId: activeBranchId || "main_branch",
              branchName: activeBranchName || "Main Branch",
              billedAtMs: Date.now(),
              createdAtMs: Date.now(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            };

            const docRef = await addDoc(collection(db, "users", currentUid, "kitchen_orders"), directKotPayload);
            try {
              await setDoc(doc(db, "kitchen_orders", docRef.id), {
                ...directKotPayload,
                id: docRef.id,
              });
            } catch (rootErr) {
              console.warn("Root kitchen_orders mirror notice:", rootErr);
            }
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
        totalAmount: netPayable,
        total: netPayable,
        tokenNumber: nextTokenNo,
        tokenNo: nextTokenNo,
        orderType: saleOrderType,
        customerName: customerName.trim() || matchedCheckoutCustomer?.name || (isRestaurant ? "Dine-in / Walk-in" : "Walk-in Customer"),
        customerPhone: validPhone10 || customerPhone.trim() || "N/A",
        paymentMethod: paymentMethod,
        paymentMode: paymentMethod === "Credit" ? "CREDIT" : paymentMethod.toUpperCase(),
        terminalName: activeTerminalObj?.name || null,
        terminalCode: activeTerminalObj?.code || null,
        floorName: activeTerminalObj?.floorName || null,
      };

      // Real-Time Notification to Store Owner for this sale
      try {
        notifyOwner({
          db,
          uid: currentUid,
          type: "sale",
          title: `💰 New In-Store Sale: ₹${totalAmt}.00 (Token #${nextTokenNo})`,
          body: `${userProfile.storeName || "Turf Cafe"} • Bill #${bNo} • Paid via ${paymentMethod} (${sanitizedBillItems.reduce((acc, i) => acc + (Number(i.qty) || 1), 0)} items)`,
          data: {
            billNo: bNo,
            tokenNumber: nextTokenNo,
            totalAmount: totalAmt,
            itemsCount: sanitizedBillItems.reduce((acc, i) => acc + (Number(i.qty) || 1), 0),
            paymentMethod: paymentMethod,
            customerName: customerName.trim() || "Walk-in Customer",
            storeName: userProfile.storeName || "Turf Cafe",
          }
        });
      } catch (notifErr) {
        console.warn("Owner notification dispatch notice:", notifErr);
      }

      // Auto-trigger WhatsApp E-Bill if requested & phone number provided
      if (sendWhatsAppBill) {
        try {
          const rawPhone = customerPhone.replace(/\D/g, "");
          if (rawPhone && rawPhone.length >= 10) {
            const waUrl = getWhatsAppEBillUrl(completedOrderData, {
              storeName: userProfile.storeName || userProfile.name || "Turf Cafe",
              address: userProfile.address || rawUserData?.address?.fullAddress || "",
              phone: userProfile.phone || rawUserData?.phone || "",
            });
            if (waUrl) {
              window.open(waUrl, "_blank");
            }
          }
        } catch (waErr) {
          console.warn("Auto WhatsApp E-Bill error:", waErr);
        }
      }

      setIsCheckoutModalOpen(false);
      checkoutIdempotencyRef.current = "";
      setCustomerName("");
      setCustomerPhone("");
      setSendWhatsAppBill(false);
      setRedeemLoyaltyPoints(false);
      setCurrentBill([]);
      setActiveResumedOrderId(null);
      setActiveTableOrderId(null);
      setActiveTableOrderInfo(null);
      playNotificationSound("paymentSuccess");
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
    } finally {
      setIsSubmittingCheckout(false);
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
        tokenNumber: order.tokenNumber || order.tokenNo || null,
        tokenNo: order.tokenNumber || order.tokenNo || null,
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

  const handleSendWhatsAppBill = (order) => {
    if (!order) return;
    let phone = String(order.customerPhone || "").replace(/\D/g, "");
    if (!phone || phone.length < 10) {
      const prompted = window.prompt("Enter customer 10-digit mobile number for WhatsApp E-Bill:", "");
      if (!prompted) return;
      phone = prompted.replace(/\D/g, "");
      if (phone.length < 10) {
        alert("Please enter a valid 10-digit mobile number.");
        return;
      }
    }
    const orderWithPhone = { ...order, customerPhone: phone };
    const waUrl = getWhatsAppEBillUrl(orderWithPhone, {
      storeName: userProfile.storeName || userProfile.name || "Turf Cafe",
      address: userProfile.address || rawUserData?.address?.fullAddress || "",
      phone: userProfile.phone || rawUserData?.phone || "",
    });
    if (waUrl) {
      window.open(waUrl, "_blank");
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

  const openAddModal = (forcedTerminal = null) => {
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
    const targetTerm =
      (forcedTerminal && forcedTerminal.id ? forcedTerminal : null) ||
      (activeTab === "inventory" && inventoryTerminalFilter !== "all"
        ? terminalsList.find((t) => t.id === inventoryTerminalFilter)
        : null) ||
      (activeTab === "sales" && activeTerminalObj ? activeTerminalObj : null);

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
    if (targetTerm) {
      setProductTerminalId(targetTerm.id);
      setProductFloorId(targetTerm.floorId || "all");
    } else {
      setProductTerminalId("all");
      setProductFloorId("all");
    }
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
    setProductTerminalId(item.terminalId || "all");
    setProductFloorId(item.floorId || "all");
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
      const chosenTerminal = terminalsList.find((t) => t.id === productTerminalId);
      const resolvedFloorId = chosenTerminal?.floorId || productFloorId || "all";
      const chosenFloor = floorsList.find((f) => f.id === resolvedFloorId);
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
        branchId: activeBranchId || "main_branch",
        branchName: activeBranchName || "Main Branch",
        terminalId: chosenTerminal ? chosenTerminal.id : "all",
        terminalName: chosenTerminal ? chosenTerminal.name : "All Terminals",
        terminalCode: chosenTerminal ? chosenTerminal.code : "",
        floorId: resolvedFloorId !== "all" ? resolvedFloorId : "all",
        floorName: chosenFloor ? chosenFloor.name : "All Floors",
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

  const normalizedCheckoutPhone = normalizePhone10(customerPhone);
  const matchedCheckoutCustomer = useMemo(() => {
    if (normalizedCheckoutPhone.length !== 10) return null;
    return crmCustomers.find((c) => normalizePhone10(c.phone || c.id) === normalizedCheckoutPhone) || null;
  }, [crmCustomers, normalizedCheckoutPhone]);

  const loyaltyRedeemInfo = useMemo(() => {
    if (!matchedCheckoutCustomer) return { maxPoints: 0, maxDiscount: 0 };
    return calculateMaxRedeemable(matchedCheckoutCustomer.loyaltyPoints || 0, totalBillAmount, crmConfig);
  }, [matchedCheckoutCustomer, totalBillAmount, crmConfig]);

  const appliedLoyaltyPoints = redeemLoyaltyPoints && matchedCheckoutCustomer ? loyaltyRedeemInfo.maxPoints : 0;
  const appliedLoyaltyDiscount = redeemLoyaltyPoints && matchedCheckoutCustomer ? loyaltyRedeemInfo.maxDiscount : 0;
  const netCheckoutTotal = Math.max(0, Number((totalBillAmount - appliedLoyaltyDiscount).toFixed(2)));

  const terminalScopedProducts = filterProductsForCatalog(products, {
    inventoryMode: shopInventoryMode,
    terminalId: activeTerminalObj?.id || null,
    floorId: activeTerminalObj?.floorId || null,
    primaryTerminalId: primaryTerminalObj?.id || null,
  });

  const scopedCategories = useMemo(() => {
    const defaultCategory = isRestaurant ? "Main Course" : "General";
    const pool = activeTerminalObj ? terminalScopedProducts : products;
    const unique = ["All", ...new Set(pool.map((item) => item.category || defaultCategory).filter(Boolean))];
    return unique;
  }, [activeTerminalObj, terminalScopedProducts, products, isRestaurant]);

  const terminalHeldOrders = useMemo(() => {
    if (!activeTerminalObj?.id) return heldOrders;
    const isPrimary = activeTerminalObj.id === primaryTerminalObj?.id;
    return heldOrders.filter((h) => {
      if (!h.terminalId) return isPrimary;
      return h.terminalId === activeTerminalObj.id;
    });
  }, [heldOrders, activeTerminalObj?.id, primaryTerminalObj?.id]);

  const filteredProducts = terminalScopedProducts.filter(item => {
    // Branch Filter: Match activeBranchId. If item has no branchId or isAllBranches is true, show in primary or all branches.
    const isCurrentPrimary = activeBranchId === "main_branch" || activeBranchId === "main_default" || branchesList.find(b => b.id === activeBranchId)?.isPrimary;
    const matchesBranch = (() => {
      if (!item.branchId || item.isAllBranches === true) {
        return true;
      }
      return item.branchId === activeBranchId || (isCurrentPrimary && (item.branchId === "main_default" || item.branchId === "main_branch"));
    })();

    if (!matchesBranch) return false;

    const itemName = item.itemName || item.name || "";
    const itemCat = item.category || "General";
    const matchesSearch = itemName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || itemCat === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // --- Sales Top Stat Cards Metrics Calculation ---
  const relevantOrders = ordersList.filter(o => {
    // Separate billing stats per active terminal when a terminal is selected
    if (activeTerminalObj?.id) {
      if (o.terminalId !== activeTerminalObj.id) return false;
    }

    // Branch Filter: If order has branchId, match activeBranchId. If order has no branchId, assign to primary branch.
    const isCurrentPrimary = activeBranchId === "main_branch" || activeBranchId === "main_default" || branchesList.find(b => b.id === activeBranchId)?.isPrimary;
    const matchesBranch = (() => {
      if (!o.branchId && !o.branchName) {
        return isCurrentPrimary;
      }
      return o.branchId === activeBranchId || o.branchName === activeBranchName;
    })();

    if (!matchesBranch) return false;

    if (isRestaurant) {
      return o.shopType === "restaurant" || o.isRestaurant === true || isRestaurant;
    }
    const isOrdGlobal = o.isGlobalMode === true || o.appMode === "global";
    return isGlobalMode ? isOrdGlobal : !isOrdGlobal;
  });

  const ordersPool = relevantOrders;

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
  const statTotalSalesText = `₹${computedTotalSales.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const statOrdersText = computedOrdersCount;
  const statCustomersText = computedCustomersCount;
  const statAvgOrderText = `₹${computedAvgOrderVal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Waste & Spoilage Expense Statistics
  const wasteStats = useMemo(() => calculateWasteStats(wasteRecords), [wasteRecords]);
  const computedWasteLoss = statsTimeframe === "today" ? wasteStats.todayLoss : wasteStats.totalLoss;
  const statWasteLossText = `₹${computedWasteLoss.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
        {/* Left Area: Sidebar Menu Button + Brand & Shop Mode */}
        <div style={styles.navLeftGroup}>
          {!isPharmacist && (
            <button
              type="button"
              onClick={() => setHamburgerOpen(true)}
              style={styles.hamburgerBtn}
              title="Open Sidebar Menu (Terminal Management & Modules)"
              aria-label="Open Sidebar Menu"
            >
              <div style={styles.hamburgerIconBox}>
                <span style={styles.hamburgerBar} />
                <span style={styles.hamburgerBar} />
                <span style={styles.hamburgerBar} />
              </div>
            </button>
          )}
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
        </div>

        {/* Center Area: Main Navigation Bar Options (moved from hamburger menu) */}
        <nav style={styles.navLinksGroup}>
          {/* 1. Billing / Sales */}
          <button
            type="button"
            onClick={() => setActiveTab("sales")}
            style={{
              ...styles.navTabBtn,
              ...(activeTab === "sales" ? styles.navTabBtnActive : {})
            }}
            title={isMedical ? "Pharmacy POS & Medicine Dispensing" : (isRestaurant ? "POS Billing & Orders" : "Sales & Billing")}
          >
            <span style={{ fontSize: "14px" }}>{isMedical ? "💊" : "🧾"}</span>
            <span>{isMedical ? "Pharmacy POS" : (isRestaurant ? "Billing" : (isGlobalMode ? "Global Sales" : "Sales"))}</span>
          </button>

          {/* 2. Menu Items / Inventory */}
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            style={{
              ...styles.navTabBtn,
              ...(activeTab === "inventory" ? styles.navTabBtnActive : {})
            }}
            title={isMedical ? "Medicine inventory, tablets, syrups & stock" : (isRestaurant ? "Food items, categories & pricing" : "Inventory management")}
          >
            <span style={{ fontSize: "14px" }}>📦</span>
            <span>{isMedical ? "Medicine Stock" : (isRestaurant ? "Menu Items" : (isGlobalMode ? "Global Inventory" : "Inventory"))}</span>
          </button>

          {/* MEDICAL: Rooms & Beds (Visible to Owner, hidden from Pharmacist) */}
          {isMedical && !isPharmacist && (
            <button
              type="button"
              onClick={() => setActiveTab("rooms")}
              style={{
                ...styles.navTabBtn,
                ...(activeTab === "rooms" ? styles.navTabBtnActive : {}),
              }}
              title="Hospital Room Inventory, Daily Charges & Bed Availability"
            >
              <span style={{ fontSize: "14px" }}>🏥</span>
              <span>Rooms & Beds</span>
            </button>
          )}

          {/* MEDICAL: Lab Tests & Pricing (Visible to Owner, hidden from Pharmacist) */}
          {isMedical && !isPharmacist && (
            <button
              type="button"
              onClick={() => setActiveTab("lab")}
              style={{
                ...styles.navTabBtn,
                ...(activeTab === "lab" ? styles.navTabBtnActive : {}),
              }}
              title="Laboratory Services, Diagnostic Tests & Service Pricing"
            >
              <span style={{ fontSize: "14px" }}>🧪</span>
              <span>Lab Tests</span>
            </button>
          )}

          {/* 3. Online Orders & Delivery (Not shown to Pharmacist) */}
          {!isPharmacist && (
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              style={{
                ...styles.navTabBtn,
                ...(activeTab === "orders" ? styles.navTabBtnActive : {})
              }}
              title="Customer online orders & live delivery dispatch"
            >
              <span style={{ fontSize: "14px" }}>🌐</span>
              <span>Orders</span>
              {newOnlineOrdersCount > 0 ? (
                <span style={styles.navBadgeRed}>
                  {newOnlineOrdersCount}
                </span>
              ) : onlineOrdersList.length > 0 ? (
                <span style={styles.navBadgeGray}>
                  {onlineOrdersList.length}
                </span>
              ) : null}
            </button>
          )}

          {/* 4. Purchase Report (Shop Stocks & Restaurant Groceries - Not shown to Pharmacist) */}
          {!isPharmacist && (
            <button
              type="button"
              onClick={() => setActiveTab("purchases")}
              style={{
                ...styles.navTabBtn,
                ...(activeTab === "purchases" ? styles.navTabBtnActive : {})
              }}
              title={isRestaurant ? "Restaurant groceries, raw materials & food supplies purchase report" : "Shop product stocks & inventory purchase report"}
            >
              <span style={{ fontSize: "14px" }}>📊</span>
              <span>Purchase Report</span>
            </button>
          )}

          {/* 6. Customer CRM, Loyalty & Khata (Not shown to Pharmacist) */}
          {!isPharmacist && (
            <button
              type="button"
              onClick={() => setActiveTab("customers")}
              style={{
                ...styles.navTabBtn,
                ...(activeTab === "customers" ? styles.navTabBtnActive : {})
              }}
              title="Customer Directory, Loyalty Points & Khata Credit Ledger"
            >
              <span style={{ fontSize: "14px" }}>👥</span>
              <span>Customers</span>
              {crmCustomers.length > 0 && (
                <span style={styles.navBadgeGray}>{crmCustomers.length}</span>
              )}
            </button>
          )}
          {/* RESTAURANT OPERATIONS */}
          {isRestaurant && !isPharmacist && (
            <button
              type="button"
              onClick={() => setActiveTab("recipes")}
              style={{
                ...styles.navTabBtn,
                ...(activeTab === "recipes" ? styles.navTabBtnActive : {})
              }}
              title="Recipe Management, Food Costing & Raw Materials"
            >
              <span style={{ fontSize: "14px" }}>🥘</span>
              <span>Recipes</span>
            </button>
          )}
        </nav>

        {/* Right Area: Held Orders, Owner Alerts & Profile */}
        <div style={styles.navRightGroup}>
          {isPharmacist && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                backgroundColor: "#e0f2fe",
                color: "#0369a1",
                padding: "6px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: "700",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}>
                <span>💊 Pharmacist:</span>
                <span>{staffName}</span>
                {staffId && <span style={{ opacity: 0.8 }}>({staffId})</span>}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  backgroundColor: "#fee2e2",
                  color: "#dc2626",
                  border: "none",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer"
                }}
                title="Log out"
              >
                🚪 Exit
              </button>
            </div>
          )}

          {/* Owner Notifications Bell */}
          {!isPharmacist && (
          <div style={{ position: "relative" }}>
            <button
              ref={ownerNotifBtnRef}
              type="button"
              onClick={() => setOwnerNotifDropdownOpen(!ownerNotifDropdownOpen)}
              style={{
                backgroundColor: ownerNotifDropdownOpen ? "#ffedd5" : "#f8fafc",
                border: "1.5px solid #cbd5e1",
                borderRadius: "10px",
                padding: "6px 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontWeight: "700",
                fontSize: "12.5px",
                color: "#1e293b",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}
              title="Store Owner Live Sales & Online Notifications"
            >
              <span style={{ fontSize: "14px" }}>🔔</span>
              <span>Alerts</span>
              {ownerNotifications.filter((n) => !n.read).length > 0 && (
                <span
                  style={{
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    fontSize: "10px",
                    fontWeight: "900",
                    padding: "1px 6px",
                    borderRadius: "10px",
                    marginLeft: "2px"
                  }}
                >
                  {ownerNotifications.filter((n) => !n.read).length}
                </span>
              )}
            </button>

            {/* Owner Notifications Dropdown Panel */}
            {ownerNotifDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: "0",
                  width: "360px",
                  maxHeight: "440px",
                  backgroundColor: "#ffffff",
                  borderRadius: "16px",
                  boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
                  border: "1.5px solid #e2e8f0",
                  zIndex: 999999,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden"
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#0f172a", color: "#ffffff" }}>
                  <div>
                    <div style={{ fontWeight: "800", fontSize: "14px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>📢</span>
                      <span>Owner Live Sales Feed</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      Real-time alerts for in-store & online sales
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOwnerNotifDropdownOpen(false)}
                    style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "16px", cursor: "pointer", fontWeight: "800" }}
                  >
                    ✕
                  </button>
                </div>

                {/* Desktop Push Banner Button */}
                <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", borderBottom: "1px solid #bbf7d0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "11.5px", color: "#166534", fontWeight: "600" }}>
                    Desktop Push: {typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted" ? "Active ✅" : "Not Enabled"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if ("Notification" in window) {
                        Notification.requestPermission().then((perm) => {
                          if (perm === "granted") {
                            new Notification("🔔 Owner Notifications Enabled!", {
                              body: "You will receive desktop alerts for all in-store and online sales."
                            });
                          }
                        });
                      }
                    }}
                    style={{
                      padding: "4px 8px",
                      backgroundColor: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "11px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    Enable Push
                  </button>
                </div>

                {/* Notifications List */}
                <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
                  {ownerNotifications.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 16px", color: "#94a3b8" }}>
                      <div style={{ fontSize: "32px", marginBottom: "6px" }}>🎉</div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>All caught up!</div>
                      <div style={{ fontSize: "11px" }}>New counter sales and online orders will appear here instantly.</div>
                    </div>
                  ) : (
                    ownerNotifications.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "10px",
                          backgroundColor: n.type === "online_order" ? "#f5f3ff" : "#fff7ed",
                          border: `1px solid ${n.type === "online_order" ? "#ddd6fe" : "#fed7aa"}`,
                          marginBottom: "6px"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <span style={{ fontWeight: "800", fontSize: "12.5px", color: n.type === "online_order" ? "#6d28d9" : "#c2410c" }}>
                            {n.title}
                          </span>
                          <span style={{ fontSize: "10px", color: "#64748b" }}>
                            {n.createdAtMs ? new Date(n.createdAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now"}
                          </span>
                        </div>
                        <div style={{ fontSize: "11.5px", color: "#334155", marginTop: "2px" }}>
                          {n.body}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          {/* Held orders quick chip if any held */}
          {terminalHeldOrders.length > 0 && (
            <button 
              type="button"
              onClick={() => setShowResumeModal(true)} 
              style={styles.quickHeldAlertBtn}
              title="View pending held bills"
            >
              <span>⏸️ Held</span>
              <span style={styles.quickHeldBadge}>
                {terminalHeldOrders.length}
              </span>
            </button>
          )}

          {/* Profile Trigger Button */}
          {!isPharmacist && (
            <button 
              ref={profileBtnRef}
              type="button"
              onClick={toggleProfileDropdown} 
              style={{ 
                ...styles.navProfileBtn, 
                backgroundColor: (activeTab === "profile" || activeTab === "settings" || profileDropdownOpen) ? "#ffedd5" : "#f8fafc", 
                color: (activeTab === "profile" || activeTab === "settings" || profileDropdownOpen) ? "#fc8019" : "#334155",
              }}
            >
              <div style={styles.profileAvatarBox}>
                {userProfile.profileImage ? (
                  <img src={userProfile.profileImage} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "11px", fontWeight: "800", color: "#fc8019" }}>
                    {userProfile.name ? userProfile.name.charAt(0).toUpperCase() : "A"}
                  </span>
                )}
              </div>
              <span style={styles.profileBtnText}>{userProfile.name ? userProfile.name.split(" ")[0] : "Profile"} ▾</span>
            </button>
          )}
        </div>
      </header>

      {/* SHOP MODE DROPDOWN PORTAL */}
      {shopModeDropdownOpen && createPortal(
        <div 
          style={{
            ...styles.portalDropdownMenu,
            top: `${shopMenuCoords.top}px`,
            left: `${shopMenuCoords.left}px`,
            minWidth: "260px"
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

          {/* MULTI-STORE BRANCH SELECTOR */}
          <div style={{ height: "1px", backgroundColor: "#e2e8f0", margin: "6px 0" }} />
          <div style={{ padding: "6px 12px 4px", fontSize: "11px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Store Branch (கிளை)</span>
            <span 
              style={{ fontSize: "11px", color: "#7c3aed", cursor: "pointer", fontWeight: "700" }} 
              onClick={() => { setShopModeDropdownOpen(false); setActiveTab("branches"); }}
            >
              Manage ↗
            </span>
          </div>
          {branchesList.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => { handleSelectBranch(b.id, b.name); setShopModeDropdownOpen(false); }}
              style={{
                ...styles.dropdownItem,
                backgroundColor: activeBranchId === b.id ? "#f5f3ff" : "transparent",
                color: activeBranchId === b.id ? "#7c3aed" : "#334155",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "15px" }}>📍</span>
                <span style={{ fontWeight: activeBranchId === b.id ? "700" : "500", fontSize: "13px" }}>{b.name}</span>
              </div>
              {activeBranchId === b.id && <span style={{ color: "#7c3aed", fontWeight: "800", fontSize: "14px" }}>✓</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setShopModeDropdownOpen(false); setActiveTab("branches"); }}
            style={{
              ...styles.dropdownItem,
              color: "#7c3aed",
              fontWeight: "700",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              paddingTop: "6px"
            }}
          >
            <span>➕</span>
            <span>Add / Manage Branches</span>
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
            👥 {isMedical ? "Medical Staff Accounts" : "Staff Accounts & Attendance"}
          </button>
          {isMedical && (
            <>
              <button 
                type="button"
                onClick={() => { setActiveTab("rooms"); setProfileDropdownOpen(false); }}
                style={{ ...styles.dropdownItem, backgroundColor: activeTab === "rooms" ? "#fff7ed" : "transparent", color: activeTab === "rooms" ? "#fc8019" : "#334155" }}
              >
                🏥 Hospital Ward & Rooms
              </button>
              <button 
                type="button"
                onClick={() => { setActiveTab("lab"); setProfileDropdownOpen(false); }}
                style={{ ...styles.dropdownItem, backgroundColor: activeTab === "lab" ? "#fff7ed" : "transparent", color: activeTab === "lab" ? "#fc8019" : "#334155" }}
              >
                🧪 Laboratory & Diagnostics
              </button>
            </>
          )}
          <button 
            type="button"
            onClick={() => { setActiveTab("customers"); setProfileDropdownOpen(false); }}
            style={{ ...styles.dropdownItem, backgroundColor: activeTab === "customers" ? "#fff7ed" : "transparent", color: activeTab === "customers" ? "#fc8019" : "#334155" }}
          >
            🎁 Customer CRM &amp; Khata
          </button>
          <button 
            type="button"
            onClick={() => { setActiveTab("branches"); setProfileDropdownOpen(false); }}
            style={{ ...styles.dropdownItem, backgroundColor: activeTab === "branches" ? "#fff7ed" : "transparent", color: activeTab === "branches" ? "#fc8019" : "#334155" }}
          >
            🏢 Multi-Store Branches (கிளைகள்)
          </button>
          {!isStaff && (
            <button 
              type="button"
              onClick={() => { setActiveTab("terminals"); setProfileDropdownOpen(false); }}
              style={{ ...styles.dropdownItem, backgroundColor: activeTab === "terminals" ? "#fff7ed" : "transparent", color: activeTab === "terminals" ? "#fc8019" : "#334155" }}
            >
              🖥️ Terminal Management
            </button>
          )}
          <button 
            type="button"
            onClick={() => { setActiveTab("waste"); setProfileDropdownOpen(false); }}
            style={{ ...styles.dropdownItem, backgroundColor: activeTab === "waste" ? "#fff7ed" : "transparent", color: activeTab === "waste" ? "#fc8019" : "#334155" }}
          >
            📊 Profit, Loss &amp; Waste Tracking
          </button>
          <div style={{ height: "1px", backgroundColor: "#e2e8f0", margin: "4px 0" }} />
          {isMedical ? (
            <>
              <a 
                href="/pharmacist"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.dropdownItem, textDecoration: "none", color: "#0284c7", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>💊 Open Pharmacist Portal</span>
                <span style={{ fontSize: "11px" }}>↗</span>
              </a>
              <a 
                href="/ward"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.dropdownItem, textDecoration: "none", color: "#7c3aed", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>🏥 Open Ward Portal</span>
                <span style={{ fontSize: "11px" }}>↗</span>
              </a>
              <a 
                href="/lab"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.dropdownItem, textDecoration: "none", color: "#059669", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span>🧪 Open Lab Portal</span>
                <span style={{ fontSize: "11px" }}>↗</span>
              </a>
            </>
          ) : (
            <>
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
            </>
          )}
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

      {/* SIDEBAR NAVIGATION DRAWER */}
      {hamburgerOpen && createPortal(
        <div style={styles.drawerOverlay} onClick={() => setHamburgerOpen(false)}>
          <aside style={styles.drawerContainer} onClick={(e) => e.stopPropagation()}>
            <div style={styles.drawerHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "22px" }}>{isRestaurant ? "🍽️" : "🏪"}</span>
                <div>
                  <div style={{ fontWeight: "800", fontSize: "15px", color: "#0f172a" }}>
                    {userProfile.storeName || "Kadai Pro"}
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>
                    {isStaff ? `Staff: ${staffName}` : "Store Management"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHamburgerOpen(false)}
                style={styles.drawerCloseBtn}
                aria-label="Close Sidebar Menu"
              >
                ✕
              </button>
            </div>

            <div style={styles.drawerContent}>
              <div style={styles.drawerSectionHeader}>POS &amp; Operations</div>
              <button
                type="button"
                onClick={() => { setActiveTab("sales"); setHamburgerOpen(false); }}
                style={{
                  ...styles.drawerItem,
                  backgroundColor: activeTab === "sales" ? "#fff7ed" : "transparent",
                  color: activeTab === "sales" ? "#ea580c" : "#1e293b",
                  fontWeight: activeTab === "sales" ? "800" : "600",
                }}
              >
                <span>🧾</span>
                <span>POS Billing</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab("inventory"); setHamburgerOpen(false); }}
                style={{
                  ...styles.drawerItem,
                  backgroundColor: activeTab === "inventory" ? "#fff7ed" : "transparent",
                  color: activeTab === "inventory" ? "#ea580c" : "#1e293b",
                  fontWeight: activeTab === "inventory" ? "800" : "600",
                }}
              >
                <span>📦</span>
                <span>{isRestaurant ? "Menu Items" : "Inventory"}</span>
              </button>
              {!isStaff && (
                <button
                  type="button"
                  onClick={() => { setActiveTab("terminals"); setHamburgerOpen(false); }}
                  style={{
                    ...styles.drawerItem,
                    backgroundColor: activeTab === "terminals" ? "#eef2ff" : "transparent",
                    color: activeTab === "terminals" ? "#4338ca" : "#1e293b",
                    fontWeight: activeTab === "terminals" ? "800" : "700",
                  }}
                >
                  <span>🖥️</span>
                  <span>Terminal Management</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => { setActiveTab("orders"); setHamburgerOpen(false); }}
                style={{
                  ...styles.drawerItem,
                  backgroundColor: activeTab === "orders" ? "#fff7ed" : "transparent",
                  color: activeTab === "orders" ? "#ea580c" : "#1e293b",
                  fontWeight: activeTab === "orders" ? "800" : "600",
                }}
              >
                <span>🌐</span>
                <span>Online Orders &amp; Sales</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab("purchases"); setHamburgerOpen(false); }}
                style={{
                  ...styles.drawerItem,
                  backgroundColor: activeTab === "purchases" ? "#fff7ed" : "transparent",
                  color: activeTab === "purchases" ? "#ea580c" : "#1e293b",
                  fontWeight: activeTab === "purchases" ? "800" : "600",
                }}
              >
                <span>📊</span>
                <span>Purchase Report</span>
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab("customers"); setHamburgerOpen(false); }}
                style={{
                  ...styles.drawerItem,
                  backgroundColor: activeTab === "customers" ? "#fff7ed" : "transparent",
                  color: activeTab === "customers" ? "#ea580c" : "#1e293b",
                  fontWeight: activeTab === "customers" ? "800" : "600",
                }}
              >
                <span>👥</span>
                <span>Customer CRM &amp; Khata</span>
              </button>

              {!isStaff && (
                <>
                  <div style={styles.drawerSectionHeader}>Management</div>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("staff"); setHamburgerOpen(false); }}
                    style={{
                      ...styles.drawerItem,
                      backgroundColor: activeTab === "staff" ? "#fff7ed" : "transparent",
                      color: activeTab === "staff" ? "#ea580c" : "#1e293b",
                      fontWeight: activeTab === "staff" ? "800" : "600",
                    }}
                  >
                    <span>👨‍💼</span>
                    <span>Staff &amp; Attendance</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("branches"); setHamburgerOpen(false); }}
                    style={{
                      ...styles.drawerItem,
                      backgroundColor: activeTab === "branches" ? "#fff7ed" : "transparent",
                      color: activeTab === "branches" ? "#ea580c" : "#1e293b",
                      fontWeight: activeTab === "branches" ? "800" : "600",
                    }}
                  >
                    <span>🏢</span>
                    <span>Multi-Store Branches</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("waste"); setHamburgerOpen(false); }}
                    style={{
                      ...styles.drawerItem,
                      backgroundColor: activeTab === "waste" ? "#fff7ed" : "transparent",
                      color: activeTab === "waste" ? "#ea580c" : "#1e293b",
                      fontWeight: activeTab === "waste" ? "800" : "600",
                    }}
                  >
                    <span>🗑️</span>
                    <span>Waste &amp; Loss Tracking</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab("settings"); setHamburgerOpen(false); }}
                    style={{
                      ...styles.drawerItem,
                      backgroundColor: activeTab === "settings" ? "#fff7ed" : "transparent",
                      color: activeTab === "settings" ? "#ea580c" : "#1e293b",
                      fontWeight: activeTab === "settings" ? "800" : "600",
                    }}
                  >
                    <span>⚙️</span>
                    <span>Settings</span>
                  </button>
                </>
              )}
            </div>
          </aside>
        </div>,
        document.body
      )}

      {/* Main Content Area */}
      <div style={{
        ...styles.mainContent,
        ...(activeTab === "sales" ? { minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" } : {})
      }}>
        {/* TAB 1: POS TERMINAL */}
        {activeTab === "sales" && (
          <>
            <PosTerminalBar
              shopId={currentUid}
              storeName={userProfile.storeName}
              isStaff={isStaff}
              staffId={staffId}
              staffName={staffName}
              floors={floorsList}
              terminals={terminalsList}
              terminalsLoaded={terminalsLoaded}
              activeTerminal={activeTerminalObj}
              activeSession={resolvedActiveSession}
              onSelectTerminal={handleSelectActiveTerminal}
              onSessionOpened={(term, sess) => {
                handleSelectActiveTerminal(term);
                setActiveSessionDoc(sess);
              }}
              onSessionClosed={() => {
                setActiveSessionDoc(null);
              }}
              onOpenTerminalManagement={!isStaff ? () => setActiveTab("terminals") : undefined}
            />
            <div style={{ ...styles.posLayout, flex: 1, minHeight: 0 }}>
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
                        if (paidReadyOrders.length > 0) {
                          setTableOrderTab("pickup");
                        } else if (unpaidReadyToBillOrders.length > 0) {
                          setTableOrderTab("served");
                        } else {
                          setTableOrderTab("kitchen");
                        }
                        setShowTableOrdersModal(true);
                      }} 
                      style={{
                        backgroundColor: paidReadyOrders.length > 0 ? "#ffedd5" : unpaidReadyToBillOrders.length > 0 ? "#dcfce7" : "#f1f5f9",
                        border: paidReadyOrders.length > 0 ? "1.5px solid #fdba74" : unpaidReadyToBillOrders.length > 0 ? "1.5px solid #86efac" : "1.5px solid #cbd5e1",
                        color: paidReadyOrders.length > 0 ? "#c2410c" : unpaidReadyToBillOrders.length > 0 ? "#15803d" : "#475569",
                        padding: "4px 10px",
                        borderRadius: "8px",
                        fontWeight: "800",
                        fontSize: "12px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                      }}
                      title="View Live Table Orders & KOT"
                    >
                      <span>🍽️ TABLES</span>
                      {paidReadyOrders.length > 0 && (
                        <span style={{
                          backgroundColor: "#ea580c",
                          color: "#fff",
                          borderRadius: "10px",
                          padding: "0 6px",
                          fontSize: "10.5px",
                          fontWeight: "800"
                        }}>
                          🛎️ {paidReadyOrders.length}
                        </span>
                      )}
                      {unpaidReadyToBillOrders.length > 0 && (
                        <span style={{
                          backgroundColor: "#16a34a",
                          color: "#fff",
                          borderRadius: "10px",
                          padding: "0 6px",
                          fontSize: "10.5px",
                          fontWeight: "800"
                        }}>
                          🔔 {unpaidReadyToBillOrders.length}
                        </span>
                      )}
                      {paidReadyOrders.length === 0 && unpaidReadyToBillOrders.length === 0 && activeKitchenOrders.length > 0 && (
                        <span style={{
                          backgroundColor: "#64748b",
                          color: "#fff",
                          borderRadius: "10px",
                          padding: "0 6px",
                          fontSize: "10.5px",
                          fontWeight: "800"
                        }}>
                          {activeKitchenOrders.length}
                        </span>
                      )}
                    </button>
                  )}
                  <button 
                    type="button"
                    onClick={() => setShowResumeModal(true)} 
                    style={{
                      backgroundColor: terminalHeldOrders.length > 0 ? "#fef3c7" : "#f8fafc",
                      border: terminalHeldOrders.length > 0 ? "1.5px solid #fde68a" : "1.5px solid #e2e8f0",
                      color: terminalHeldOrders.length > 0 ? "#b45309" : "#64748b",
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
                    {terminalHeldOrders.length > 0 && (
                      <span style={{
                        backgroundColor: "#d97706",
                        color: "#fff",
                        borderRadius: "10px",
                        padding: "0 6px",
                        fontSize: "10.5px",
                        fontWeight: "800"
                      }}>
                        {terminalHeldOrders.length}
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
                    onClick={() => {
                      checkoutIdempotencyRef.current = `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                      setIsCheckoutModalOpen(true);
                    }}
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
              {/* 1. PAID ORDERS READY FOR CUSTOMER PICKUP BANNER (Orange/Amber Alert) */}
              {isRestaurant && paidReadyOrders.length > 0 && (() => {
                const pickupSummary = paidReadyOrders
                  .map((o) => {
                    const c = getOrderClassification(o);
                    const tok = o.tokenNumber || o.tokenNo ? `Token #${o.tokenNumber || o.tokenNo}` : (o.orderNumber || "Order");
                    const cust = c.customerName && c.customerName !== "Walk-in Customer" ? ` (${c.customerName})` : "";
                    const bNo = o.billNo ? ` • Bill #${o.billNo}` : "";
                    return `${tok}${cust}${bNo}`;
                  })
                  .join(", ");

                return (
                  <div
                    onClick={() => {
                      setTableOrderTab("pickup");
                      setShowTableOrdersModal(true);
                    }}
                    style={{
                      backgroundColor: "#fff7ed",
                      border: "1.5px solid #fdba74",
                      borderRadius: "14px",
                      padding: "12px 18px",
                      marginBottom: "12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: "pointer",
                      boxShadow: "0 4px 14px rgba(234, 88, 12, 0.12)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "10px",
                        backgroundColor: "#ea580c",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "20px"
                      }}>
                        🛎️
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontWeight: "800", color: "#9a3412", fontSize: "14px" }}>
                            {paidReadyOrders.length} Paid Order{paidReadyOrders.length > 1 ? "s" : ""} Ready for Customer Pickup!
                          </span>
                          <span style={{
                            backgroundColor: "#16a34a",
                            color: "#ffffff",
                            fontSize: "11px",
                            fontWeight: "900",
                            padding: "2px 7px",
                            borderRadius: "6px"
                          }}>
                            PAID ✅
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#c2410c", marginTop: "2px" }}>
                          🎟️ {pickupSummary} • Food is cooked & packed! Hand over to customer.
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        backgroundColor: "#ea580c",
                        color: "#ffffff",
                        padding: "8px 16px",
                        borderRadius: "10px",
                        fontWeight: "800",
                        fontSize: "12.5px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        whiteSpace: "nowrap"
                      }}
                    >
                      <span>Hand Over ({paidReadyOrders.length})</span>
                      <span>→</span>
                    </div>
                  </div>
                );
              })()}

              {/* 2. LIVE UNPAID TABLE & PARCEL ORDERS READY FOR BILLING BANNER (Green Alert) */}
              {isRestaurant && unpaidReadyToBillOrders.length > 0 && (() => {
                const tableOrdersList = unpaidReadyToBillOrders.filter((o) => getOrderClassification(o).isTable);
                const parcelOrdersList = unpaidReadyToBillOrders.filter((o) => getOrderClassification(o).isParcel);
                const bannerTitle =
                  tableOrdersList.length > 0 && parcelOrdersList.length > 0
                    ? `${unpaidReadyToBillOrders.length} Orders Ready to Bill (${tableOrdersList.length} Tables, ${parcelOrdersList.length} Parcels) 🧾`
                    : tableOrdersList.length > 0
                    ? `${tableOrdersList.length} Table Order${tableOrdersList.length > 1 ? "s" : ""} Served — Ready to Bill! 🧾`
                    : `${parcelOrdersList.length} Parcel Order${parcelOrdersList.length > 1 ? "s" : ""} Ready & Packed! 🥡`;

                const namesSummary = unpaidReadyToBillOrders
                  .map((o) => {
                    const c = getOrderClassification(o);
                    return c.isParcel ? `🥡 PARCEL: ${c.customerName || "Customer"}` : `🍽️ ${c.tableNo || "Table"}`;
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
                        whiteSpace: "nowrap"
                      }}
                    >
                      <span>Bill Orders ({unpaidReadyToBillOrders.length})</span>
                      <span>→</span>
                    </div>
                  </div>
                );
              })()}

              {/* Top Compact Stat Cards Row & Welcome Banner on Right Side */}
              <div style={styles.salesStatsBanner}>
                {/* Top Row: Full Width Search Bar + Timeframe Selector */}
                <div style={styles.salesStatsHeaderRow}>
                  {/* Full Width Professional Search Bar */}
                  <div style={{
                    flex: 1,
                    minWidth: 0,
                    marginRight: "14px"
                  }}>
                    <div style={{
                      ...styles.searchBarContainer,
                      height: "42px",
                      backgroundColor: "#ffffff",
                      borderRadius: "10px",
                      boxShadow: searchFocused ? "0 0 0 3.5px rgba(252, 128, 25, 0.14)" : "0 1px 3px rgba(0, 0, 0, 0.04)",
                      borderColor: searchFocused ? "#fc8019" : "#cbd5e1",
                      ...(searchFocused ? styles.searchBarFocused : {})
                    }}>
                      <span style={{ ...styles.searchIcon, fontSize: "15px" }}>🔍</span>
                      <input 
                        ref={searchInputRef}
                        type="text"
                        placeholder={isRestaurant ? "Search food or menu items... (Press / to search)" : `Search ${isGlobalMode ? "global" : "local"} products... (Press / to search)`}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => setSearchFocused(false)}
                        style={{ ...styles.searchInput, fontSize: "13.5px" }}
                      />
                      {searchQuery ? (
                        <button 
                          type="button"
                          onClick={() => {
                            setSearchQuery("");
                            if (searchInputRef.current) searchInputRef.current.focus();
                          }}
                          style={styles.searchClearBtn}
                          title="Clear search"
                        >
                          ✕
                        </button>
                      ) : (
                        <kbd style={styles.searchKbdHint} title="Press / to focus search">/</kbd>
                      )}
                    </div>
                  </div>

                  <div style={{ ...styles.statsTimeframePill, flexShrink: 0 }}>
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
                {(scopedCategories.length > 0 ? scopedCategories : categories).map((cat, idx) => (
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

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                <h2 style={{ ...styles.sectionTitle, margin: 0 }}>
                  {activeTerminalObj
                    ? `${activeTerminalObj.name} — ${isRestaurant ? "Menu" : "Products"} (${filteredProducts.length})`
                    : isRestaurant
                    ? `Available Foods (${filteredProducts.length})`
                    : `Available Products (${filteredProducts.length})`}
                </h2>
                {activeTerminalObj && !isStaff && (
                  <button
                    type="button"
                    onClick={() => openAddModal(activeTerminalObj)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "8px",
                      border: "1.5px solid #2563eb",
                      backgroundColor: "#eff6ff",
                      color: "#1d4ed8",
                      fontSize: "12px",
                      fontWeight: "800",
                      cursor: "pointer",
                    }}
                  >
                    + Add {isRestaurant ? "Food" : "Item"} to {activeTerminalObj.name}
                  </button>
                )}
              </div>

              {loading ? (
                <div style={styles.centerBox}>{isRestaurant ? "Loading menu items..." : "Loading products..."}</div>
              ) : filteredProducts.length === 0 ? (
                <div style={{ ...styles.centerBox, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                  <div>
                    {activeTerminalObj
                      ? `No ${isRestaurant ? "food items" : "products"} added to "${activeTerminalObj.name}" yet.`
                      : isRestaurant
                      ? "No food items found ❌"
                      : "No products found ❌"}
                  </div>
                  {activeTerminalObj && !isStaff && (
                    <button
                      type="button"
                      onClick={() => openAddModal(activeTerminalObj)}
                      style={{
                        padding: "9px 18px",
                        borderRadius: "10px",
                        border: "none",
                        backgroundColor: "#2563eb",
                        color: "#ffffff",
                        fontSize: "13px",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      + Add {isRestaurant ? "Hotel Food" : "Product"} to {activeTerminalObj.name}
                    </button>
                  )}
                </div>
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
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px", marginBottom: "4px" }}>
                            <p style={{ ...styles.productCategory, margin: 0 }}>₹{priceVal}</p>
                            {(() => {
                              const fbData = getProductFeedbackData(item);
                              return (
                                <div 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openProductFeedbackModal(item);
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "3px",
                                    padding: "2px 6px",
                                    borderRadius: "6px",
                                    backgroundColor: fbData.count > 0 ? "#fffbeb" : "#f8fafc",
                                    border: "1px solid " + (fbData.count > 0 ? "#fef3c7" : "#e2e8f0"),
                                    cursor: "pointer",
                                    fontSize: "11px"
                                  }}
                                  title={fbData.count > 0 ? `Customer Rating: ${fbData.avg}★ (${fbData.count} reviews) - Click to view` : "No customer ratings yet - Click to rate"}
                                >
                                  <span style={{ color: fbData.count > 0 ? "#f59e0b" : "#94a3b8", fontSize: "11px" }}>★</span>
                                  <span style={{ fontWeight: "800", color: fbData.count > 0 ? "#b45309" : "#64748b" }}>
                                    {fbData.count > 0 ? fbData.avg : "Rate"}
                                  </span>
                                  <span style={{ color: fbData.count > 0 ? "#92400e" : "#94a3b8", fontSize: "10px" }}>
                                    ({fbData.count})
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
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
          </>
        )}

        {/* TERMINAL MANAGEMENT TAB */}
        {activeTab === "terminals" && !isStaff && (
          <TerminalManagement
            userProfile={userProfile}
            rawUserData={rawUserData}
            ordersList={ordersList}
            onSelectTerminalForPos={(term) => {
              handleSelectActiveTerminal(term);
              setActiveTab("sales");
            }}
            onBack={() => setActiveTab("sales")}
          />
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
            crmConfig={crmConfig}
            setCrmConfig={setCrmConfig}
            setPopupModal={setPopupModal} 
          />
        )}

        {/* CUSTOMER CRM, LOYALTY & KHATA TAB */}
        {activeTab === "customers" && (
          <CustomerManagement
            userProfile={userProfile}
            storeSettings={storeSettings}
            ordersList={ordersList}
            onlineOrdersList={onlineOrdersList}
            onBack={() => setActiveTab("sales")}
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

        {/* MEDICAL: HOSPITAL WARD & ROOMS TAB */}
        {activeTab === "rooms" && (
          <RoomManagement
            ownerUid={currentUid}
            isOwner={!isStaff}
            onBack={() => setActiveTab("sales")}
          />
        )}

        {/* MEDICAL: LABORATORY & DIAGNOSTIC SERVICES TAB */}
        {activeTab === "lab" && (
          <LabManagement
            ownerUid={currentUid}
            isOwner={!isStaff}
            onBack={() => setActiveTab("sales")}
          />
        )}

        {/* STAFF MANAGEMENT & ATTENDANCE TAB */}
        {activeTab === "staff" && (
          <StaffManagement 
            onBack={() => setActiveTab("sales")} 
            activeBranchName={activeBranchName}
          />
        )}

        {/* CUSTOMER FEEDBACK & RATINGS TAB */}
        {activeTab === "feedback" && (
          <FeedbackScreen
            userProfile={userProfile}
            isRestaurant={isRestaurant}
            activeBranchName={activeBranchName}
            onBack={() => setActiveTab("sales")}
          />
        )}

        {/* MULTI-STORE / BRANCH MANAGEMENT TAB */}
        {activeTab === "branches" && (
          <BranchManagement
            userProfile={userProfile}
            activeBranchId={activeBranchId}
            onSelectBranch={handleSelectBranch}
            ordersList={ordersList}
            products={products}
            onBack={() => setActiveTab("sales")}
          />
        )}

        {/* RECIPE MANAGEMENT & FOOD COSTING TAB */}
        {activeTab === "recipes" && (
          <RecipeManagement
            products={products}
            userProfile={userProfile}
            onBack={() => setActiveTab("sales")}
          />
        )}

        {/* PROFIT, LOSS & WASTE MANAGEMENT TAB (SHOP & RESTAURANT) */}
        {activeTab === "waste" && (
          <WasteManagement
            userProfile={userProfile}
            isRestaurant={isRestaurant}
            isGlobalMode={isGlobalMode}
            activeBranchId={activeBranchId}
            activeBranchName={activeBranchName}
            onBack={() => setActiveTab("sales")}
          />
        )}

        {/* PURCHASE REPORTS TAB (SHOP STOCKS & RESTAURANT GROCERIES) */}
        {activeTab === "purchases" && (
          <PurchaseReport
            userProfile={userProfile}
            isRestaurant={isRestaurant}
            isGlobalMode={isGlobalMode}
            activeBranchId={activeBranchId}
            activeBranchName={activeBranchName}
            branchesList={branchesList}
            onSelectBranch={handleSelectBranch}
            onBack={() => setActiveTab("sales")}
          />
        )}


        {/* TAB 3: STORE INVENTORY */}
        {activeTab === "inventory" && (
          <div style={{ padding: "30px", maxWidth: "1400px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                  {isMedical ? "💊 Pharmacy Medicine Inventory" : isRestaurant ? "🍽️ Restaurant Menu Management" : isGlobalMode ? "🌐 Global Inventory Management" : "🏪 Local Store Inventory Management"}
                </h2>
                <span style={{
                  fontSize: "11px",
                  fontWeight: "800",
                  padding: "3px 10px",
                  borderRadius: "12px",
                  backgroundColor: isMedical ? "#e0f2fe" : isRestaurant ? "#f0fdf4" : isGlobalMode ? "#ecfdf5" : "#eef2ff",
                  color: isMedical ? "#0284c7" : isRestaurant ? "#16a34a" : isGlobalMode ? "#059669" : "#4f46e5",
                  border: "1px solid " + (isMedical ? "#bae6fd" : isRestaurant ? "#bbf7d0" : isGlobalMode ? "#a7f3d0" : "#c7d2fe")
                }}>
                  {isMedical ? "PHARMACY" : isRestaurant ? "MENU" : isGlobalMode ? "GLOBAL" : "LOCAL"} ({products.length} Items)
                </span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {isRestaurant && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("recipes")}
                    style={{
                      backgroundColor: "#fff7ed",
                      border: "1.5px solid #fed7aa",
                      color: "#c2410c",
                      padding: "8px 16px",
                      borderRadius: "10px",
                      fontWeight: "800",
                      fontSize: "12.5px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span>🥘</span>
                    <span>Recipes & Food Costing</span>
                    <span>→</span>
                  </button>
                )}
                <button onClick={() => openAddModal()} style={styles.addNewBtn}>
                  {isRestaurant ? "+ Add New Food" : isGlobalMode ? "+ Add Global Product" : "+ Add Local Product"}
                </button>
              </div>
            </div>
            {terminalsList.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px", backgroundColor: "#f8fafc", padding: "12px 16px", borderRadius: "14px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "12px", fontWeight: "800", color: "#0f172a" }}>
                      📦 Catalog Mode:
                    </span>
                    {[
                      { id: INVENTORY_MODES.SHARED, label: "Shared (All Terminals)" },
                      { id: INVENTORY_MODES.FLOOR_WISE, label: "Floor-wise" },
                      { id: INVENTORY_MODES.TERMINAL_WISE, label: "Terminal-wise (Separate per Terminal)" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={async () => {
                          try {
                            await setShopInventoryMode(db, currentUid, m.id);
                          } catch (err) {
                            alert("Could not switch mode: " + err.message);
                          }
                        }}
                        style={{
                          padding: "5px 11px",
                          borderRadius: "8px",
                          border: "1px solid " + (shopInventoryMode === m.id ? "#0f172a" : "#cbd5e1"),
                          backgroundColor: shopInventoryMode === m.id ? "#0f172a" : "#ffffff",
                          color: shopInventoryMode === m.id ? "#ffffff" : "#475569",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {primaryTerminalObj && products.some((p) => !p.terminalId && (!p.floorId || p.floorId === "all")) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const targetCol = isRestaurant ? "restaurant_menu" : isGlobalMode ? "global_inventory" : "inventory";
                        const unassignedCount = products.filter((p) => !p.terminalId && (!p.floorId || p.floorId === "all")).length;
                        if (!window.confirm(`Assign ${unassignedCount} unassigned items (e.g. existing items) to "${primaryTerminalObj.name}"?`)) {
                          return;
                        }
                        try {
                          const count = await assignUnassignedProductsToTerminal(db, currentUid, targetCol, products, primaryTerminalObj);
                          setPopupModal({ show: true, message: `Assigned ${count} items to ${primaryTerminalObj.name}! ✅` });
                        } catch (err) {
                          alert("Failed to assign items: " + err.message);
                        }
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "8px",
                        border: "1px solid #bbf7d0",
                        backgroundColor: "#f0fdf4",
                        color: "#15803d",
                        fontSize: "11.5px",
                        fontWeight: "800",
                        cursor: "pointer",
                      }}
                    >
                      📌 Save Existing Items to {primaryTerminalObj.name}
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", fontWeight: "800", color: "#3730a3" }}>
                    🖥️ View by Terminal:
                  </span>
                  <button
                    type="button"
                    onClick={() => setInventoryTerminalFilter("all")}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "8px",
                      border: "1px solid " + (inventoryTerminalFilter === "all" ? "#2563eb" : "#cbd5e1"),
                      backgroundColor: inventoryTerminalFilter === "all" ? "#2563eb" : "#ffffff",
                      color: inventoryTerminalFilter === "all" ? "#ffffff" : "#334155",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    All Items ({products.length})
                  </button>
                  {terminalsList.map((t) => {
                    const tCount = filterProductsForCatalog(products, {
                      inventoryMode: shopInventoryMode,
                      terminalId: t.id,
                      floorId: t.floorId,
                      primaryTerminalId: primaryTerminalObj?.id || null,
                    }).length;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setInventoryTerminalFilter(t.id)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "8px",
                          border: "1px solid " + (inventoryTerminalFilter === t.id ? "#2563eb" : "#cbd5e1"),
                          backgroundColor: inventoryTerminalFilter === t.id ? "#2563eb" : "#ffffff",
                          color: inventoryTerminalFilter === t.id ? "#ffffff" : "#334155",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer"
                        }}
                      >
                        {t.name} ({t.floorName}) • {tCount}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {shopInventoryMode === INVENTORY_MODES.FLOOR_WISE && floorsList.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", flexWrap: "wrap", backgroundColor: "#eef2ff", padding: "10px 14px", borderRadius: "12px", border: "1px solid #c7d2fe" }}>
                <span style={{ fontSize: "12px", fontWeight: "800", color: "#3730a3" }}>
                  🏢 Floor-wise Inventory Filter:
                </span>
                <button
                  type="button"
                  onClick={() => setInventoryFloorFilter("all")}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "8px",
                    border: "1px solid " + (inventoryFloorFilter === "all" ? "#4338ca" : "#cbd5e1"),
                    backgroundColor: inventoryFloorFilter === "all" ? "#4338ca" : "#ffffff",
                    color: inventoryFloorFilter === "all" ? "#ffffff" : "#334155",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  All Floors ({products.length})
                </button>
                {floorsList.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setInventoryFloorFilter(f.id)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "8px",
                      border: "1px solid " + (inventoryFloorFilter === f.id ? "#4338ca" : "#cbd5e1"),
                      backgroundColor: inventoryFloorFilter === f.id ? "#4338ca" : "#ffffff",
                      color: inventoryFloorFilter === f.id ? "#ffffff" : "#334155",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            {products.length === 0 ? (
              <div style={styles.centerBox}>
                No {isRestaurant ? "food items" : isGlobalMode ? "global products" : "local products"} found. Click above to add your first item!
              </div>
            ) : (
              <div style={styles.productGrid}>
                {filterProductsForCatalog(products, {
                  inventoryMode: shopInventoryMode,
                  terminalId: inventoryTerminalFilter !== "all" ? inventoryTerminalFilter : null,
                  floorId:
                    inventoryTerminalFilter !== "all"
                      ? terminalsList.find((t) => t.id === inventoryTerminalFilter)?.floorId || null
                      : inventoryFloorFilter,
                  primaryTerminalId: primaryTerminalObj?.id || null,
                }).map((item) => (
                  <div 
                    key={item.id} 
                    style={{ ...styles.productCard, cursor: "pointer" }}
                    onClick={() => openProductFeedbackModal(item)}
                    title={`Click to view customer feedback for ${item.itemName || item.name}`}
                  >
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
                      {item.terminalId && item.terminalId !== "all" ? (
                        <div style={{ fontSize: "10.5px", color: "#15803d", fontWeight: "700", backgroundColor: "#f0fdf4", padding: "2px 7px", borderRadius: "6px", display: "inline-block", marginTop: "3px" }}>
                          🖥️ {item.terminalName || terminalsList.find((t) => t.id === item.terminalId)?.name || "Terminal"}
                          {item.floorName && item.floorName !== "All Floors" ? ` • ${item.floorName}` : ""}
                        </div>
                      ) : shopInventoryMode === INVENTORY_MODES.FLOOR_WISE && item.floorId && item.floorId !== "all" ? (
                        <div style={{ fontSize: "10.5px", color: "#4338ca", fontWeight: "700", backgroundColor: "#eef2ff", padding: "2px 7px", borderRadius: "6px", display: "inline-block", marginTop: "3px" }}>
                          🏢 {item.floorName || floorsList.find((f) => f.id === item.floorId)?.name || "Assigned Floor"}
                        </div>
                      ) : null}
                      {item.makingCost !== undefined && item.makingCost > 0 && (
                        <div style={{ fontSize: "11px", color: "#16a34a", fontWeight: "800", marginTop: "2px", backgroundColor: "#f0fdf4", padding: "2px 6px", borderRadius: "6px", display: "inline-block" }}>
                          Making: ₹{item.makingCost} • Profit: +₹{item.grossProfit} ({item.profitMarginPercent}%)
                        </div>
                      )}

                      {/* Customer Ratings & Feedback Stars (Real Customer Data Only) */}
                      {(() => {
                        const fbData = getProductFeedbackData(item);
                        return (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              openProductFeedbackModal(item);
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              marginTop: "6px",
                              padding: "4px 8px",
                              borderRadius: "8px",
                              backgroundColor: fbData.count > 0 ? "#fffbeb" : "#f8fafc",
                              border: "1px solid " + (fbData.count > 0 ? "#fef3c7" : "#e2e8f0"),
                              cursor: "pointer",
                              transition: "all 0.15s ease"
                            }}
                            title={fbData.count > 0 ? `Customer Rating: ${fbData.avg}★ (${fbData.count} reviews) - Click to view` : "No customer ratings yet - Click to rate"}
                          >
                            <span style={{ color: fbData.count > 0 ? "#f59e0b" : "#94a3b8", fontSize: "13px", letterSpacing: "1px" }}>
                              {fbData.count > 0 ? (
                                "★".repeat(Math.min(5, Math.max(1, Math.round(Number(fbData.avg))))) +
                                "☆".repeat(Math.max(0, 5 - Math.round(Number(fbData.avg))))
                              ) : "☆☆☆☆☆"}
                            </span>
                            <span style={{ fontWeight: "800", fontSize: "12px", color: fbData.count > 0 ? "#b45309" : "#64748b" }}>
                              {fbData.count > 0 ? fbData.avg : "No ratings"}
                            </span>
                            <span style={{ fontSize: "11px", color: fbData.count > 0 ? "#92400e" : "#94a3b8" }}>
                              ({fbData.count})
                            </span>
                          </div>
                        );
                      })()}

                      <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                        <button onClick={(e) => { e.stopPropagation(); openEditModal(item); }} style={styles.editCardBtn}>✏️ Edit</button>
                        {isRestaurant && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActiveTab("recipes"); }}
                            style={{
                              ...styles.editCardBtn,
                              backgroundColor: "#fff7ed",
                              color: "#c2410c",
                              border: "1px solid #fed7aa",
                            }}
                            title="Configure Recipe & Ingredients Costing"
                          >
                            🥘 Recipe
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteProduct(item.id); }} style={styles.deleteCardBtn}>🗑️ Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ONLINE ORDERS & DELIVERY (Real-time synced with Mobile App) */}
        {activeTab === "orders" && (
          <OnlineOrders
            db={db}
            uid={auth.currentUser?.uid || localStorage.getItem("uid") || ""}
            onlineOrders={onlineOrdersList}
            salesOrders={ordersList}
            deliveryStaffList={deliveryStaffList}
            doorDeliveryEnabled={doorDeliveryEnabled}
            setDoorDeliveryEnabled={setDoorDeliveryEnabled}
            shopProfile={{
              name: userProfile.shopName || userProfile.name || userProfile.storeName || "My Store",
              address: userProfile.address || "",
              phone: userProfile.phone || userProfile.mobile || "",
            }}
            isGlobalMode={isGlobalMode}
            isRestaurant={isRestaurant}
            onViewBillDetails={(bill) => {
              setSelectedOrderDetails(bill);
            }}
          />
        )}
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
                  backgroundColor: terminalHeldOrders.length > 0 ? "#fef3c7" : "#f1f5f9",
                  color: terminalHeldOrders.length > 0 ? "#b45309" : "#64748b",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  fontSize: "12px",
                  fontWeight: "800"
                }}>
                  {terminalHeldOrders.length} {terminalHeldOrders.length === 1 ? "Bill" : "Bills"}
                </span>
              </div>
              <button onClick={() => setShowResumeModal(false)} style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", fontWeight: "800" }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: "160px", paddingRight: "4px" }}>
              {terminalHeldOrders.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                  <span style={{ fontSize: "40px", display: "block", marginBottom: "10px" }}>🧾</span>
                  <h4 style={{ margin: "0 0 6px 0", color: "#0f172a", fontSize: "16px" }}>No bills on hold!</h4>
                  <p style={{ margin: 0, fontSize: "13px" }}>Bills placed on hold during checkout will appear here.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {terminalHeldOrders.map((order) => {
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
                <span style={{
                  backgroundColor: "#ea580c",
                  color: "#ffffff",
                  padding: "3px 10px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "900",
                  letterSpacing: "0.5px"
                }}>
                  🎟️ Token: #{activeTableOrderInfo?.tokenNumber || getNextDailyTokenNumber({ ordersList, kitchenOrders, uid: auth.currentUser?.uid || localStorage.getItem("uid") })}
                </span>
                <span style={{ fontSize: "18px", fontWeight: "800", color: "#fc8019" }}>
                  ₹{netCheckoutTotal.toFixed(2)}
                  {appliedLoyaltyDiscount > 0 ? ` (Saved ₹${appliedLoyaltyDiscount.toFixed(0)})` : ""}
                </span>
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
                  <label style={styles.label}>Phone No. (CRM / Loyalty / Khata)</label>
                  <input 
                    type="tel" 
                    list="kadai-crm-customer-phones"
                    placeholder="10-digit mobile" 
                    value={customerPhone} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomerPhone(val);
                      setRedeemLoyaltyPoints(false);
                      const phone10 = normalizePhone10(val);
                      if (phone10.length === 10) {
                        const match = crmCustomers.find((c) => normalizePhone10(c.phone || c.id) === phone10);
                        if (match?.name && !customerName.trim()) {
                          setCustomerName(match.name);
                        }
                      }
                    }} 
                    style={styles.modalInput} 
                  />
                  <datalist id="kadai-crm-customer-phones">
                    {crmCustomers.slice(0, 30).map((c) => (
                      <option key={c.id} value={c.phone}>{c.name} ({Number(c.loyaltyPoints || 0)} pts)</option>
                    ))}
                  </datalist>
                </div>
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
              </div>

              {isValidPhone10(customerPhone) && (
                <div style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid #c7d2fe",
                  backgroundColor: "#eef2ff",
                  marginBottom: "6px",
                  fontSize: "12px",
                }}>
                  {matchedCheckoutCustomer ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: "700", color: "#3730a3", flexWrap: "wrap", gap: "6px" }}>
                        <span>✓ {matchedCheckoutCustomer.name}</span>
                        <span>
                          🎁 {Number(matchedCheckoutCustomer.loyaltyPoints || 0)} pts
                          {Number(matchedCheckoutCustomer.creditBalance || 0) > 0
                            ? ` • Due: ₹${Number(matchedCheckoutCustomer.creditBalance).toFixed(0)}`
                            : ""}
                        </span>
                      </div>
                      {loyaltyRedeemInfo.maxPoints > 0 && (
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: "700", color: "#15803d", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={redeemLoyaltyPoints}
                            onChange={(e) => setRedeemLoyaltyPoints(e.target.checked)}
                            style={{ accentColor: "#16a34a" }}
                          />
                          <span>Redeem {loyaltyRedeemInfo.maxPoints} Loyalty Pts (-₹{loyaltyRedeemInfo.maxDiscount.toFixed(2)})</span>
                        </label>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: "#4338ca", fontWeight: "700" }}>
                      ✨ New CRM Customer (+91 {normalizedCheckoutPhone}) — will auto-save &amp; earn Loyalty Points
                    </span>
                  )}
                </div>
              )}

              {/* WhatsApp E-Bill Option */}
              <div style={{ width: "100%", marginTop: "-4px", marginBottom: "8px" }}>
                <label style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12.5px",
                  color: "#166534",
                  fontWeight: "700",
                  cursor: "pointer",
                  backgroundColor: "#f0fdf4",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0"
                }}>
                  <input
                    type="checkbox"
                    checked={sendWhatsAppBill}
                    onChange={(e) => setSendWhatsAppBill(e.target.checked)}
                    style={{ accentColor: "#16a34a", width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <span>📲 Send E-Bill via WhatsApp {customerPhone.trim() ? `to ${customerPhone.trim()}` : "(Opens WhatsApp with E-Bill)"}</span>
                </label>
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

                  <div 
                    onClick={() => setPaymentMethod("Credit")}
                    style={{
                      ...styles.paymentCardOption,
                      borderColor: paymentMethod === "Credit" ? "#dc2626" : "#cbd5e1",
                      backgroundColor: paymentMethod === "Credit" ? "#fef2f2" : "#ffffff"
                    }}
                  >
                    <span style={{ fontSize: "22px" }}>📒</span>
                    <span style={{ fontWeight: "700", fontSize: "13px", color: paymentMethod === "Credit" ? "#dc2626" : "#1e293b" }}>Khata</span>
                  </div>
                </div>
              </div>

              {paymentMethod === "UPI / QR" && (
                <div style={styles.qrContainer}>
                  <div style={styles.qrBox}>
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(`upi://pay?pa=${storeSettings.upiId}&pn=${encodeURIComponent(userProfile.storeName)}&am=${netCheckoutTotal}&cu=INR`)}`} 
                      alt="UPI QR Code" 
                      style={{ width: "120px", height: "120px", borderRadius: "8px" }}
                    />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ margin: "0 0 2px 0", fontSize: "12px", fontWeight: "700", color: "#1e293b" }}>Scan &amp; Pay ₹{netCheckoutTotal.toFixed(2)}</p>
                    <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>UPI ID: {storeSettings.upiId}</p>
                  </div>
                </div>
              )}

              <div style={{ ...styles.modalBtns, display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  disabled={isSubmittingCheckout}
                  style={{ ...styles.saveModalBtn, flex: 1, minWidth: "150px", opacity: isSubmittingCheckout ? 0.65 : 1 }}
                >
                  {isSubmittingCheckout ? "Processing..." : "Confirm & Print Bill 🖨️"}
                </button>
                <button 
                  type="button"
                  disabled={isSubmittingCheckout}
                  onClick={(e) => {
                    setSendWhatsAppBill(true);
                    handleFinalCheckoutSubmit(e);
                  }}
                  style={{ 
                    ...styles.saveModalBtn, 
                    flex: 1, 
                    minWidth: "150px", 
                    backgroundColor: "#16a34a", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center", 
                    gap: "6px",
                    opacity: isSubmittingCheckout ? 0.65 : 1,
                  }}
                >
                  <span>{isSubmittingCheckout ? "Processing..." : "Confirm & WhatsApp 📲"}</span>
                </button>
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
                onClick={() => setTableOrderTab("pickup")}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: "9px",
                  border: "none",
                  fontWeight: "800",
                  fontSize: "13px",
                  cursor: "pointer",
                  backgroundColor: tableOrderTab === "pickup" ? "#ffffff" : "transparent",
                  color: tableOrderTab === "pickup" ? "#c2410c" : "#64748b",
                  boxShadow: tableOrderTab === "pickup" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                <span>🛎️ Ready</span>
                <span style={{ backgroundColor: "#ffedd5", color: "#c2410c", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: "800" }}>
                  {paidReadyOrders.length}
                </span>
              </button>

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
                <span style={{ backgroundColor: "#dcfce7", color: "#166534", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: "800" }}>
                  {unpaidReadyToBillOrders.length}
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
                <span style={{ backgroundColor: "#ffedd5", color: "#c2410c", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: "800" }}>
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
                <span style={{ backgroundColor: "#e0f2fe", color: "#0369a1", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: "800" }}>
                  {activeKitchenOrders.length}
                </span>
              </button>
            </div>

            {/* Orders Scrollable List */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", paddingRight: "4px" }}>
              {(() => {
                const displayList = tableOrderTab === "pickup"
                  ? paidReadyOrders
                  : tableOrderTab === "served"
                  ? unpaidReadyToBillOrders
                  : tableOrderTab === "kitchen"
                  ? cookingTableOrders
                  : activeKitchenOrders;

                if (displayList.length === 0) {
                  return (
                    <div style={{ textAlign: "center", padding: "50px 20px", color: "#94a3b8" }}>
                      <div style={{ fontSize: "42px", marginBottom: "8px" }}>
                        {tableOrderTab === "pickup" ? "🛎️" : tableOrderTab === "served" ? "🔔" : "🍳"}
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155" }}>
                        {tableOrderTab === "pickup"
                          ? "No paid orders waiting for customer pickup"
                          : tableOrderTab === "served"
                          ? "No table orders waiting for billing"
                          : "No active orders in kitchen"}
                      </div>
                      <p style={{ margin: "4px 0 0 0", fontSize: "13px" }}>
                        {tableOrderTab === "pickup"
                          ? "When kitchen cooks food for already-paid counter or parcel orders, they appear here ready for customer handover!"
                          : tableOrderTab === "served"
                          ? "When a waiter marks an unpaid table order as 'Served', it appears here ready for checkout!"
                          : "New KOT orders from waiters or counter will appear here in real-time."}
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
                  const isPaidOrder = order.isPaid === true || !!order.billNo || !!order.billedAt || !!order.billedAtMs;
                  const orderTotal = (order.items || []).reduce((acc, i) => acc + (Number(i.price || i.salesPrice || 0) * Number(i.qty || 1)), 0);

                  const cardTitle = isParcel
                    ? `PARCEL: ${classification.customerName}`
                    : classification.isTable
                    ? classification.tableNo
                    : `Counter Order (${classification.customerName})`;

                  const isPickupReady = isPaidOrder && (isReady || isServed);
                  const isBillReady = !isPaidOrder && (isServed || (isParcel && isReady));

                  return (
                    <div
                      key={order.id}
                      style={{
                        backgroundColor: isPickupReady ? "#fff7ed" : isBillReady ? "#f0fdf4" : "#ffffff",
                        border: isPickupReady ? "2px solid #fdba74" : isBillReady ? "2px solid #86efac" : "1.5px solid #e2e8f0",
                        borderRadius: "16px",
                        padding: "16px",
                        boxShadow: isPickupReady ? "0 4px 12px rgba(234, 88, 12, 0.12)" : isBillReady ? "0 4px 12px rgba(34, 197, 94, 0.12)" : "0 2px 6px rgba(0,0,0,0.04)"
                      }}
                    >
                      {/* Card Header Row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            {(order.tokenNumber || order.tokenNo) && (
                              <span style={{
                                fontSize: "12px",
                                fontWeight: "900",
                                padding: "3px 9px",
                                borderRadius: "8px",
                                backgroundColor: "#ffedd5",
                                color: "#c2410c",
                                border: "1.5px solid #fdba74"
                              }}>
                                🎟️ TOKEN #{order.tokenNumber || order.tokenNo}
                              </span>
                            )}
                            <span style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a" }}>
                              {cardTitle}
                            </span>
                            {isPaidOrder && (
                              <span style={{
                                fontSize: "11px",
                                fontWeight: "900",
                                padding: "2px 8px",
                                borderRadius: "8px",
                                backgroundColor: "#dcfce7",
                                color: "#15803d",
                                border: "1px solid #86efac"
                              }}>
                                PAID ✅
                              </span>
                            )}
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
                            {order.billNo && (
                              <span style={{ fontSize: "12px", color: "#0369a1", fontWeight: "700" }}>
                                Bill #{order.billNo}
                              </span>
                            )}
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
                          {isPaidOrder && (isReady || isServed) ? (
                            <span style={{ backgroundColor: "#ea580c", color: "#fff", padding: "4px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: "800" }}>
                              🛎️ READY
                            </span>
                          ) : isServed ? (
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
                        {isPaidOrder ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSendWhatsAppBill(order)}
                              style={{
                                padding: "8px 14px",
                                backgroundColor: "#25D366",
                                border: "none",
                                borderRadius: "10px",
                                color: "#ffffff",
                                fontWeight: "800",
                                fontSize: "12.5px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "5px"
                              }}
                              title="Send or resend e-bill to customer via WhatsApp"
                            >
                              <span>📲</span>
                              <span>WhatsApp E-Bill</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handlePrintBill(order, "posReceipt")}
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
                              title="Reprint Customer Bill Receipt"
                            >
                              <span>🖨️</span>
                              <span>Reprint Bill</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleMarkOrderCompleted(order.id)}
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
                              <span>✅</span>
                              <span>Food Handed Over / Complete</span>
                            </button>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}

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
            <div style={{ textAlign: "center", marginBottom: "6px" }}>
              <h3 style={{ margin: 0, color: "#1e3a8a" }}>{userProfile.storeName || "Turf Cafe"} RECEIPT</h3>
              {(selectedOrderDetails.tokenNumber || selectedOrderDetails.tokenNo) && (
                <div style={{
                  display: "inline-block",
                  backgroundColor: "#fff7ed",
                  color: "#c2410c",
                  border: "1.5px solid #fed7aa",
                  padding: "2px 10px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "900",
                  marginTop: "6px"
                }}>
                  🎟️ TOKEN #{selectedOrderDetails.tokenNumber || selectedOrderDetails.tokenNo}
                </div>
              )}
            </div>
            <p style={{ textAlign: "center", fontSize: "12px", color: "#64748b", margin: "4px 0 12px 0" }}>
              Customer: {selectedOrderDetails.customerName || "Walk-in"}
              {(() => {
                const c = getOrderClassification(selectedOrderDetails);
                if (c.isTable) return ` | Table: ${c.tableNo}`;
                if (c.isParcel) return ` | PARCEL`;
                return "";
              })()}
              {" | Paid via: " + (selectedOrderDetails.paymentMethod || selectedOrderDetails.paymentMode || "Cash")}
              {selectedOrderDetails.terminalName && (
                <span>
                  {" | 🖥️ " + selectedOrderDetails.terminalName + (selectedOrderDetails.floorName ? ` (${selectedOrderDetails.floorName})` : "")}
                </span>
              )}
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
            <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
              <button 
                type="button" 
                onClick={() => handlePrintBill(selectedOrderDetails, "posReceipt")} 
                style={{ flex: 1, minWidth: "100px", padding: "10px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
              >
                🧾 Print Receipt
              </button>
              <button 
                type="button" 
                onClick={() => handleSendWhatsAppBill(selectedOrderDetails)} 
                style={{ flex: 1, minWidth: "100px", padding: "10px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}
              >
                <span>📲 WhatsApp</span>
              </button>
              <button 
                type="button" 
                onClick={() => handlePrintBill(selectedOrderDetails, "salesInvoice")} 
                style={{ flex: 1, minWidth: "100px", padding: "10px", backgroundColor: "#0f172a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}
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

      {/* REAL-TIME COUNTER TOAST NOTIFICATION (Table Order Served & Food Ready) */}
      {counterToast && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999999,
            backgroundColor: counterToast.isPaid ? "#c2410c" : "#065f46",
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
          <span style={{ fontSize: "20px" }}>{counterToast.isPaid ? "🛎️" : "🔔"}</span>
          <span style={{ flex: 1 }}>{counterToast.message}</span>
          {counterToast.isPaid ? (
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => {
                  handleMarkOrderCompleted(counterToast.id);
                  setCounterToast(null);
                }}
                style={{
                  backgroundColor: "#ffffff",
                  color: "#c2410c",
                  border: "none",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  fontWeight: "800",
                  fontSize: "12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap"
                }}
              >
                ✅ Hand Over Food
              </button>
              <button
                type="button"
                onClick={() => {
                  setCounterToast(null);
                  setTableOrderTab("pickup");
                  setShowTableOrdersModal(true);
                }}
                style={{
                  backgroundColor: "rgba(255,255,255,0.2)",
                  color: "#ffffff",
                  border: "1px solid rgba(255,255,255,0.4)",
                  padding: "6px 10px",
                  borderRadius: "8px",
                  fontWeight: "700",
                  fontSize: "12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap"
                }}
              >
                View ↗
              </button>
            </div>
          ) : (
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
                whiteSpace: "nowrap"
              }}
            >
              Load Bill ↗
            </button>
          )}
          <button
            type="button"
            onClick={() => setCounterToast(null)}
            style={{
              background: "transparent",
              border: "none",
              color: counterToast.isPaid ? "#fed7aa" : "#a7f3d0",
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

      {/* REAL-TIME ONLINE ORDER TOAST NOTIFICATION */}
      {onlineOrderToast && (
        <div
          style={{
            position: "fixed",
            top: counterToast ? "76px" : "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999999,
            backgroundColor: onlineOrderToast.isDelivered ? "#059669" : "#4338ca",
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
          <span style={{ fontSize: "22px" }}>{onlineOrderToast.isDelivered ? "🎉" : "🛵"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "13.5px" }}>{onlineOrderToast.message}</div>
            {!onlineOrderToast.isDelivered && (
              <div style={{ fontSize: "11px", opacity: 0.9, fontWeight: "500", marginTop: "1px" }}>
                Click below to view details and assign delivery boy / pack order
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOnlineOrderToast(null);
              setActiveTab("orders");
            }}
            style={{
              backgroundColor: "#ffffff",
              color: onlineOrderToast.isDelivered ? "#059669" : "#4338ca",
              border: "none",
              padding: "5px 14px",
              borderRadius: "8px",
              fontWeight: "800",
              fontSize: "12px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            View Order ↗
          </button>
          <button
            type="button"
            onClick={() => setOnlineOrderToast(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#c7d2fe",
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

            {(popupModal.lastOrder?.tokenNumber || popupModal.lastOrder?.tokenNo) && (
              <div style={{
                display: "inline-block",
                backgroundColor: "#fff7ed",
                border: "2px solid #ea580c",
                color: "#c2410c",
                padding: "6px 18px",
                borderRadius: "10px",
                fontSize: "20px",
                fontWeight: "900",
                marginBottom: "12px",
                letterSpacing: "0.5px"
              }}>
                🎟️ TOKEN #{popupModal.lastOrder.tokenNumber || popupModal.lastOrder.tokenNo}
              </div>
            )}

            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "16px", lineHeight: "1.4" }}>{popupModal.message}</p>
            
            {popupModal.lastOrder && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                <div style={{ display: "flex", gap: "8px" }}>
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

                <button
                  type="button"
                  onClick={() => handleSendWhatsAppBill(popupModal.lastOrder)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    backgroundColor: "#16a34a",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: "800",
                    cursor: "pointer",
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                  }}
                >
                  <span>📲 Send WhatsApp E-Bill</span>
                </button>

                {popupModal.lastOrder?.items?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstItem = popupModal.lastOrder.items[0];
                      const foundProd = products.find(p => (p.id && p.id === firstItem.id) || ((p.itemName || p.name) === (firstItem.name || firstItem.itemName))) || firstItem;
                      openProductFeedbackModal(foundProd);
                    }}
                    style={{
                      width: "100%",
                      padding: "10px",
                      backgroundColor: "#fffbeb",
                      color: "#b45309",
                      border: "1.5px solid #fde68a",
                      borderRadius: "8px",
                      fontWeight: "800",
                      cursor: "pointer",
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px"
                    }}
                  >
                    <span>⭐ Rate Ordered Foods / Customer Feedback</span>
                  </button>
                )}
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

      {/* CUSTOMER PRODUCT FEEDBACK & REVIEWS MODAL */}
      {showProductFeedbackModal && selectedProductForFeedback && (() => {
        const fbData = getProductFeedbackData(selectedProductForFeedback);
        const pName = selectedProductForFeedback.itemName || selectedProductForFeedback.name || "Food Item";
        const pPrice = selectedProductForFeedback.salesPrice || selectedProductForFeedback.price || 0;
        const pImage = selectedProductForFeedback.image || selectedProductForFeedback.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";

        return (
          <div style={styles.modalOverlay} onClick={() => setShowProductFeedbackModal(false)}>
            <div 
              style={{
                ...styles.modalBox,
                maxWidth: "520px",
                width: "92%",
                maxHeight: "90vh",
                overflowY: "auto",
                padding: "22px",
                borderRadius: "16px",
                boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid #e2e8f0", paddingBottom: "14px", marginBottom: "16px" }}>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <img 
                    src={pImage} 
                    alt={pName} 
                    style={{ width: "56px", height: "56px", borderRadius: "10px", objectFit: "cover", border: "1px solid #e2e8f0" }}
                    onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                  />
                  <div>
                    <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>{pName}</h3>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
                      <span style={{ fontSize: "14px", fontWeight: "800", color: "#fc8019" }}>₹{pPrice}</span>
                      <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "600" }}>• Customer Ratings & Reviews</span>
                    </div>
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={() => setShowProductFeedbackModal(false)}
                  style={{ background: "transparent", border: "none", fontSize: "18px", color: "#94a3b8", cursor: "pointer", fontWeight: "800", padding: "4px" }}
                >
                  ✕
                </button>
              </div>

              {/* Rating Summary Card */}
              <div style={{
                backgroundColor: "#fffbeb",
                border: "1.5px solid #fef3c7",
                borderRadius: "12px",
                padding: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px"
              }}>
                {fbData.count > 0 ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontSize: "32px", fontWeight: "900", color: "#b45309" }}>{fbData.avg}</span>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: "#d97706" }}>/ 5.0</span>
                    </div>
                    <div style={{ color: "#f59e0b", fontSize: "18px", letterSpacing: "2px", margin: "2px 0" }}>
                      {"★".repeat(Math.min(5, Math.max(1, Math.round(Number(fbData.avg)))))}
                      {"☆".repeat(Math.max(0, 5 - Math.round(Number(fbData.avg))))}
                    </div>
                    <div style={{ fontSize: "12px", color: "#92400e", fontWeight: "600" }}>
                      Based on {fbData.count} verified customer {fbData.count === 1 ? "rating" : "ratings"}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontSize: "20px", fontWeight: "800", color: "#b45309" }}>No Ratings Yet</span>
                    </div>
                    <div style={{ color: "#d1d5db", fontSize: "18px", letterSpacing: "2px", margin: "2px 0" }}>
                      ☆☆☆☆☆
                    </div>
                    <div style={{ fontSize: "12px", color: "#92400e", fontWeight: "600" }}>
                      0 customer reviews recorded so far
                    </div>
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={() => setShowAddReviewForm(!showAddReviewForm)}
                  style={{
                    padding: "9px 14px",
                    backgroundColor: showAddReviewForm ? "#f1f5f9" : "#f59e0b",
                    color: showAddReviewForm ? "#475569" : "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer",
                    boxShadow: showAddReviewForm ? "none" : "0 2px 6px rgba(245, 158, 11, 0.3)"
                  }}
                >
                  {showAddReviewForm ? "Cancel Review" : "✍️ Rate this Item"}
                </button>
              </div>

              {/* Add Review Form */}
              {showAddReviewForm && (
                <form onSubmit={handleSaveProductFeedback} style={{
                  backgroundColor: "#f8fafc",
                  border: "1.5px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "14px",
                  marginBottom: "16px"
                }}>
                  <h4 style={{ margin: "0 0 10px 0", fontSize: "13.5px", fontWeight: "800", color: "#1e293b" }}>
                    📝 Customer Feedback for {pName}
                  </h4>
                  <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>Customer Name</label>
                      <input 
                        type="text" 
                        value={feedbackCustomerName} 
                        onChange={(e) => setFeedbackCustomerName(e.target.value)}
                        placeholder="e.g. Ramesh" 
                        style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "12px", outline: "none" }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>Mobile (Optional)</label>
                      <input 
                        type="tel" 
                        value={feedbackCustomerMobile} 
                        onChange={(e) => setFeedbackCustomerMobile(e.target.value)}
                        placeholder="e.g. 9876543210" 
                        style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "12px", outline: "none" }}
                      />
                    </div>
                  </div>

                  {/* Interactive Star Rating Selector */}
                  <div style={{ marginBottom: "10px" }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>Rating</label>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setFeedbackRatingStars(star)}
                          style={{
                            background: "none",
                            border: "none",
                            fontSize: "24px",
                            cursor: "pointer",
                            padding: "0 2px",
                            color: star <= feedbackRatingStars ? "#f59e0b" : "#cbd5e1",
                            transition: "transform 0.1s ease"
                          }}
                        >
                          ★
                        </button>
                      ))}
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "#b45309", marginLeft: "6px" }}>
                        {feedbackRatingStars} of 5 Stars
                      </span>
                    </div>
                  </div>

                  {/* Comment */}
                  <div style={{ marginBottom: "10px" }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "4px" }}>Customer Review / Feedback</label>
                    <textarea
                      value={feedbackComment}
                      onChange={(e) => setFeedbackComment(e.target.value)}
                      placeholder={`How was the taste and quality of ${pName}?`}
                      rows={2}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "7px", border: "1px solid #cbd5e1", fontSize: "12px", resize: "vertical", outline: "none" }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button 
                      type="button" 
                      onClick={() => setShowAddReviewForm(false)}
                      style={{ padding: "6px 12px", backgroundColor: "#e2e8f0", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: "700", color: "#475569", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      disabled={savingProductFeedback}
                      style={{ padding: "6px 16px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }}
                    >
                      {savingProductFeedback ? "Saving..." : "Submit Review"}
                    </button>
                  </div>
                </form>
              )}

              {/* Customer Reviews List */}
              <div>
                <h4 style={{ margin: "0 0 10px 0", fontSize: "13px", fontWeight: "800", color: "#334155" }}>
                  💬 Diner Feedback & Reviews ({fbData.reviews.length})
                </h4>
                {fbData.reviews.length === 0 ? (
                  <div style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    backgroundColor: "#f8fafc",
                    borderRadius: "10px",
                    border: "1px dashed #cbd5e1"
                  }}>
                    <span style={{ fontSize: "26px", display: "block", marginBottom: "6px" }}>🍽️</span>
                    <div style={{ fontSize: "13.5px", fontWeight: "700", color: "#334155" }}>No customer reviews recorded yet</div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                      Ratings and feedback from customer orders will automatically appear here.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {fbData.reviews.map((rev, rIdx) => (
                      <div 
                        key={rev.id || rIdx}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "9px",
                          backgroundColor: "#f8fafc",
                          border: "1px solid #e2e8f0"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontWeight: "800", fontSize: "12.5px", color: "#0f172a" }}>{rev.name}</span>
                            <span style={{ fontSize: "10px", backgroundColor: "#dcfce7", color: "#166534", padding: "1px 6px", borderRadius: "4px", fontWeight: "700" }}>Verified Order</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ color: "#f59e0b", fontSize: "12px" }}>{"★".repeat(rev.rating || 5)}</span>
                            <span style={{ fontSize: "10.5px", color: "#94a3b8" }}>{rev.date}</span>
                          </div>
                        </div>
                        {rev.comment ? (
                          <p style={{ margin: 0, fontSize: "12px", color: "#475569", fontStyle: "italic", lineHeight: "1.4" }}>
                            "{rev.comment}"
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
              {terminalsList.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                    Assigned Terminal (Separate Menu / Billing)
                  </label>
                  <select
                    value={productTerminalId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProductTerminalId(val);
                      const chosen = terminalsList.find((t) => t.id === val);
                      if (chosen) {
                        setProductFloorId(chosen.floorId || "all");
                      }
                    }}
                    style={{ ...styles.modalInput, cursor: "pointer", backgroundColor: "#ffffff" }}
                  >
                    <option value="all">🌐 Shared Across All Terminals</option>
                    {terminalsList.map((t) => (
                      <option key={t.id} value={t.id}>
                        🖥️ {t.name} ({t.code}) — {t.floorName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {shopInventoryMode === INVENTORY_MODES.FLOOR_WISE && productTerminalId === "all" && floorsList.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                    Assigned Floor (Floor-wise Inventory)
                  </label>
                  <select
                    value={productFloorId}
                    onChange={(e) => setProductFloorId(e.target.value)}
                    style={{ ...styles.modalInput, cursor: "pointer", backgroundColor: "#ffffff" }}
                  >
                    <option value="all">🌐 Shared Across All Floors</option>
                    {floorsList.map((f) => (
                      <option key={f.id} value={f.id}>
                        🏢 {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
              {(activeTerminalObj ? terminalScopedProducts : products)
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
    display: "grid", 
    gridTemplateColumns: "1.3fr auto 0.7fr", 
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
  navLeftGroup: { 
    display: "flex", 
    alignItems: "center", 
    gap: "12px", 
    justifySelf: "start",
    flexShrink: 0 
  },
  hamburgerBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "38px",
    height: "38px",
    borderRadius: "10px",
    border: "1.5px solid #e2e8f0",
    backgroundColor: "#ffffff",
    cursor: "pointer",
    position: "relative",
    flexShrink: 0,
    transition: "all 0.15s ease",
    padding: 0
  },
  hamburgerIconBox: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: "3.5px",
    width: "18px"
  },
  hamburgerBar: {
    width: "18px",
    height: "2.2px",
    backgroundColor: "#334155",
    borderRadius: "2px"
  },
  hamburgerBadgeDot: {
    position: "absolute",
    top: "4px",
    right: "4px",
    width: "8px",
    height: "8px",
    backgroundColor: "#ef4444",
    borderRadius: "50%",
    border: "1.5px solid #ffffff",
    boxShadow: "0 0 4px rgba(239, 68, 68, 0.6)"
  },
  logoArea: { display: "flex", alignItems: "center", gap: "8px" },
  sidebarBrand: { fontSize: "16px", fontWeight: "800", color: "#1e3a8a", margin: 0, whiteSpace: "nowrap" },
  navLinksGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    justifySelf: "center",
    justifyContent: "center",
    overflowX: "auto",
    scrollbarWidth: "none",
    msOverflowStyle: "none",
    padding: "0 8px",
    minWidth: 0
  },
  navTabBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "12.5px",
    fontWeight: "600",
    color: "#475569",
    backgroundColor: "transparent",
    border: "1.5px solid transparent",
    cursor: "pointer",
    transition: "all 0.15s ease",
    whiteSpace: "nowrap",
    userSelect: "none",
    flexShrink: 0
  },
  navTabBtnActive: {
    backgroundColor: "#fff7ed",
    color: "#ea580c",
    border: "1.5px solid #fed7aa",
    fontWeight: "700",
    boxShadow: "0 1px 2px rgba(234, 88, 12, 0.08)"
  },
  navTabBtnAlert: {
    backgroundColor: "#f0fdf4",
    color: "#15803d",
    border: "1.5px solid #bbf7d0",
    fontWeight: "700"
  },
  navBadgeRed: {
    backgroundColor: "#ef4444",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: "800",
    padding: "1px 6px",
    borderRadius: "10px",
    lineHeight: "1.2"
  },
  navBadgeGreen: {
    backgroundColor: "#16a34a",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: "800",
    padding: "1px 6px",
    borderRadius: "10px",
    lineHeight: "1.2"
  },
  navBadgeGray: {
    backgroundColor: "#e2e8f0",
    color: "#475569",
    fontSize: "10px",
    fontWeight: "700",
    padding: "1px 6px",
    borderRadius: "10px",
    lineHeight: "1.2"
  },
  navCenterGroup: {
    flex: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minWidth: "220px",
    maxWidth: "580px",
    padding: "0 12px"
  },
  searchBarContainer: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    padding: "0 14px",
    borderRadius: "12px",
    width: "100%",
    height: "42px",
    boxSizing: "border-box",
    gap: "10px",
    transition: "all 0.2s ease",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.03)"
  },
  searchBarFocused: {
    backgroundColor: "#ffffff",
    borderColor: "#fc8019",
    boxShadow: "0 0 0 3.5px rgba(252, 128, 25, 0.14), 0 2px 6px rgba(0, 0, 0, 0.04)"
  },
  searchInput: {
    border: "none",
    background: "transparent",
    outline: "none",
    width: "100%",
    fontSize: "13.5px",
    fontWeight: "500",
    color: "#1e293b"
  },
  searchIcon: {
    fontSize: "15px",
    color: "#94a3b8"
  },
  searchClearBtn: {
    background: "#e2e8f0",
    border: "none",
    borderRadius: "50%",
    width: "18px",
    height: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "10px",
    cursor: "pointer",
    color: "#475569",
    padding: 0,
    flexShrink: 0
  },
  searchKbdHint: {
    fontSize: "11px",
    fontWeight: "700",
    color: "#94a3b8",
    backgroundColor: "#f1f5f9",
    padding: "2px 7px",
    borderRadius: "6px",
    border: "1px solid #e2e8f0",
    fontFamily: "inherit",
    userSelect: "none"
  },
  navRightGroup: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    justifySelf: "end",
    flexShrink: 0
  },
  activeTabBadge: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#fff7ed",
    border: "1.5px solid #fed7aa",
    padding: "5px 12px",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    userSelect: "none"
  },
  activeTabBadgeText: {
    fontSize: "12.5px",
    fontWeight: "800",
    color: "#ea580c"
  },
  quickTableAlertBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#dcfce7",
    border: "1.5px solid #86efac",
    padding: "5px 10px",
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: "800",
    fontSize: "12px",
    color: "#15803d"
  },
  quickAlertBadge: {
    backgroundColor: "#16a34a",
    color: "#ffffff",
    borderRadius: "10px",
    padding: "1px 7px",
    fontSize: "10.5px",
    fontWeight: "800"
  },
  quickHeldAlertBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#fef3c7",
    border: "1.5px solid #fde68a",
    padding: "5px 10px",
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: "800",
    fontSize: "12px",
    color: "#b45309"
  },
  quickHeldBadge: {
    backgroundColor: "#d97706",
    color: "#ffffff",
    borderRadius: "10px",
    padding: "1px 7px",
    fontSize: "10.5px",
    fontWeight: "800"
  },
  navProfileBtn: {
    padding: "4px 10px 4px 6px",
    border: "1.5px solid #e2e8f0",
    borderRadius: "10px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.15s ease"
  },
  profileAvatarBox: {
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    overflow: "hidden",
    backgroundColor: "#ffedd5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #fc8019",
    flexShrink: 0
  },
  profileBtnText: {
    fontWeight: "700",
    fontSize: "13px"
  },

  // Hamburger Drawer Styles
  drawerOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    backdropFilter: "blur(3px)",
    WebkitBackdropFilter: "blur(3px)",
    zIndex: 9998,
    animation: "fadeInOverlay 0.2s ease forwards"
  },
  drawerContainer: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "330px",
    maxWidth: "86vw",
    backgroundColor: "#ffffff",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    boxShadow: "8px 0 32px rgba(15, 23, 42, 0.2)",
    animation: "slideInLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards"
  },
  drawerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 18px",
    borderBottom: "1px solid #f1f5f9",
    backgroundColor: "#ffffff"
  },
  drawerCloseBtn: {
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "#64748b",
    fontSize: "14px",
    fontWeight: "700"
  },
  drawerContent: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  },
  drawerSectionHeader: {
    fontSize: "11px",
    fontWeight: "800",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    margin: "12px 6px 6px",
    userSelect: "none"
  },
  drawerItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "transparent",
    cursor: "pointer",
    width: "100%",
    textAlign: "left",
    transition: "all 0.15s ease",
    boxSizing: "border-box"
  },
  drawerItemActive: {
    backgroundColor: "#fff7ed",
    boxShadow: "inset 3px 0 0 #ea580c"
  },
  drawerIconBox: {
    width: "34px",
    height: "34px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    flexShrink: 0
  },
  drawerItemContent: {
    flex: 1,
    minWidth: 0
  },
  drawerItemTitle: {
    fontSize: "13.5px",
    fontWeight: "700",
    color: "#1e293b"
  },
  drawerItemSub: {
    fontSize: "11px",
    color: "#64748b",
    marginTop: "1px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  drawerBadge: {
    backgroundColor: "#f1f5f9",
    color: "#475569",
    fontSize: "11px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "10px"
  },
  activeDot: {
    color: "#ea580c",
    fontSize: "12px",
    fontWeight: "900"
  },
  drawerFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    borderTop: "1px solid #f1f5f9",
    backgroundColor: "#f8fafc",
    gap: "10px"
  },
  drawerLogoutBtn: {
    width: "34px",
    height: "34px",
    borderRadius: "8px",
    border: "1px solid #fee2e2",
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: "16px",
    flexShrink: 0
  },
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
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
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