// src/screens/Dashboard.jsx
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";
import Profile from "./Profile";
import Settings from "./Settings";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("sales");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  
  // Restaurant Mode Detection
  const [shopType, setShopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant = (shopType || "").trim().toLowerCase() === "restaurant";

  // Shop Mode: Local vs Global
  const [appMode, setAppMode] = useState(() => localStorage.getItem("app_mode") || "local");
  const isGlobalMode = appMode === "global";
  const [rawUserData, setRawUserData] = useState(null);

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
  const [speedDialSlots, setSpeedDialSlots] = useState({});
  const [isConfiguringSpeedDial, setIsConfiguringSpeedDial] = useState(false);
  const [selectedSlotForConfig, setSelectedSlotForConfig] = useState(1);
  const [speedDialSearch, setSpeedDialSearch] = useState("");
  const [recentlyTappedSlot, setRecentlyTappedSlot] = useState(null);

  const [currentBill, setCurrentBill] = useState([]);
  const [ordersList, setOrdersList] = useState([]);
  const [statsTimeframe, setStatsTimeframe] = useState("all");

  // Profile Dropdown State and Dynamic Coordinates
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState({ top: 0, right: 0 });
  const profileBtnRef = useRef(null);

  // User Profile & Settings States
  const [userProfile, setUserProfile] = useState({ name: "", email: "", phone: "", storeName: "Kadai Pro Store", profileImage: "" });
  const [storeSettings, setStoreSettings] = useState({ upiId: "kadaippro@okaxis", allowCash: true, allowUpi: true, allowCard: true });

  // Checkout Modal State
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  // Success Animated Popup Modal State
  const [popupModal, setPopupModal] = useState({ show: false, message: "" });

  // View Bill Details Modal State (Receipt Popup)
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);

  // Modal States for Add & Edit Inventory
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [brand, setBrand] = useState("");
  const [image, setImage] = useState("");

  const toggleProfileDropdown = (e) => {
    e.stopPropagation();
    if (!profileDropdownOpen && profileBtnRef.current) {
      const rect = profileBtnRef.current.getBoundingClientRect();
      setMenuCoords({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right
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
    if (rawUserData) {
      const isRest = (shopType || "").trim().toLowerCase() === "restaurant";
      const activeStoreName = mode === "global"
        ? (rawUserData.global_shopName || rawUserData.globalStoreName || rawUserData.shopName || rawUserData.storeName || "Global Shop")
        : (rawUserData.local_shopName || rawUserData.localStoreName || rawUserData.shopName || rawUserData.storeName || (isRest ? "Restaurant POS" : "Local Shop"));

      setUserProfile(prev => ({
        ...prev,
        storeName: activeStoreName,
        profileImage: (mode === "global" ? rawUserData.global_shopLogo : rawUserData.local_shopLogo) || rawUserData.profileImage || rawUserData.shopLogo || ""
      }));

      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      const modeKey = isRest ? "restaurant" : (mode === "global" ? "global" : "local");
      const speedDialStorageKey = `speed_dial_slots_${modeKey}_${currentUid}`;
      const saved = localStorage.getItem(speedDialStorageKey);
      if (saved) {
        try { setSpeedDialSlots(JSON.parse(saved)); } catch (e) { setSpeedDialSlots({}); }
      } else if (rawUserData?.speedDialSlots?.[modeKey]) {
        setSpeedDialSlots(rawUserData.speedDialSlots[modeKey]);
      } else {
        setSpeedDialSlots({});
      }
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
    `;
    document.head.appendChild(styleSheet);

    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      setLoading(false);
      return;
    }

    const fetchUserData = async () => {
      try {
        const userDocRef = doc(db, "users", currentUid);
        const userSnap = await getDoc(userDocRef);
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

          const modeKey = isRest ? "restaurant" : (isGlobalMode ? "global" : "local");
          const speedDialStorageKey = `speed_dial_slots_${modeKey}_${currentUid}`;
          if (data.speedDialSlots?.[modeKey]) {
            setSpeedDialSlots(data.speedDialSlots[modeKey]);
            localStorage.setItem(speedDialStorageKey, JSON.stringify(data.speedDialSlots[modeKey]));
          } else {
            const savedSlots = localStorage.getItem(speedDialStorageKey);
            if (savedSlots) {
              try { setSpeedDialSlots(JSON.parse(savedSlots)); } catch (e) {}
            }
          }
        }
      } catch (err) {
        console.error("Error fetching user profile:", err);
      }
    };
    fetchUserData();

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

    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("scroll", () => setProfileDropdownOpen(false), true);
      window.removeEventListener("resize", () => setProfileDropdownOpen(false));
      unsubscribeInventory();
      unsubscribeOrders();
      unsubscribeActiveCart();
    };
  }, [isRestaurant, appMode]);

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
    const pId = product.id || product.barcode || String(Date.now());
    const pName = product.itemName || product.name || "Item";
    const pPrice = Number(product.salesPrice ?? product.price ?? 0);
    const pImg = product.image || product.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";

    let updated;
    const exist = currentBill.find(item => (item.id && item.id === pId) || (item.barcode && product.barcode && item.barcode === product.barcode));
    if (exist) {
      updated = currentBill.map(item => ((item.id && item.id === pId) || (item.barcode && product.barcode && item.barcode === product.barcode)) ? { ...item, qty: item.qty + 1 } : item);
    } else {
      updated = [
        ...currentBill, 
        { 
          ...product, 
          id: pId, 
          barcode: product.barcode || pId,
          name: pName, 
          itemName: pName,
          price: pPrice, 
          salesPrice: pPrice,
          image: pImg,
          imageUrl: pImg,
          purchasePrice: Number(product.purchasePrice || 0),
          taxPercent: product.taxPercent || 0,
          qty: 1 
        }
      ];
    }
    setCurrentBill(updated);
    await syncWebCartToCloud(updated);
  };

  const removeFromCurrentBill = async (id) => {
    const exist = currentBill.find(item => item.id === id || item.barcode === id);
    if (!exist) return;

    let updated;
    if (exist.qty === 1) {
      updated = currentBill.filter(item => item.id !== id && item.barcode !== id);
    } else {
      updated = currentBill.map(item => (item.id === id || item.barcode === id) ? { ...item, qty: item.qty - 1 } : item);
    }

    setCurrentBill(updated);
    await syncWebCartToCloud(updated);
  };

  const deleteFromCurrentBill = async (id) => {
    const updated = currentBill.filter(item => item.id !== id && item.barcode !== id);
    setCurrentBill(updated);
    await syncWebCartToCloud(updated);
  };

  const clearCurrentBill = async () => {
    setCurrentBill([]);
    await syncWebCartToCloud([]);
  };

  const handleAssignProductToSlot = async (slotNum, product) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    const modeKey = isRestaurant ? "restaurant" : (isGlobalMode ? "global" : "local");
    const speedDialStorageKey = `speed_dial_slots_${modeKey}_${currentUid}`;

    const updated = {
      ...speedDialSlots,
      [slotNum]: product ? {
        id: product.id || product.barcode || String(Date.now()),
        barcode: product.barcode || "",
        name: product.itemName || product.name || "Item",
        itemName: product.itemName || product.name || "Item",
        price: Number(product.salesPrice ?? product.price ?? 0),
        salesPrice: Number(product.salesPrice ?? product.price ?? 0),
        image: product.image || product.imageUrl || "",
        imageUrl: product.image || product.imageUrl || "",
        purchasePrice: Number(product.purchasePrice || 0),
        taxPercent: product.taxPercent || 0,
        category: product.category || "General"
      } : null
    };

    if (!product) {
      delete updated[slotNum];
    }

    setSpeedDialSlots(updated);
    localStorage.setItem(speedDialStorageKey, JSON.stringify(updated));

    if (currentUid) {
      try {
        await updateDoc(doc(db, "users", currentUid), {
          [`speedDialSlots.${modeKey}`]: updated
        });
      } catch (e) {
        console.warn("Could not sync speed dial to Firestore:", e);
      }
    }

    setPopupModal({
      show: true,
      message: product 
        ? `Slot #${slotNum} assigned to "${product.itemName || product.name}"! ⚡` 
        : `Slot #${slotNum} cleared successfully!`
    });
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
      if (activeTab !== "sales" || isCheckoutModalOpen || isModalOpen || isConfiguringSpeedDial) return;
      const targetTag = e.target.tagName?.toLowerCase();
      if (targetTag === "input" || targetTag === "textarea" || e.target.isContentEditable) {
        return;
      }
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 8) {
        e.preventDefault();
        handleSpeedDialClick(num);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, isCheckoutModalOpen, isModalOpen, isConfiguringSpeedDial, speedDialSlots]);

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
      
      const saleRecord = {
        billNo: bNo,
        invoiceId: bNo,
        billDate: bDate,
        items: currentBill,
        total: totalAmt,
        totalAmount: totalAmt,
        profit: totalProfit,
        customerName: customerName.trim() || (isRestaurant ? "Dine-in / Walk-in" : "Walk-in Customer"),
        customerPhone: customerPhone.trim() || "N/A",
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
        const cartRef = doc(db, "users", currentUid, "active_cart", "current");
        await setDoc(cartRef, {
          items: [],
          updatedAt: serverTimestamp(),
          lastConfirmedSale: {
            billNo: bNo,
            billDate: bDate,
            items: currentBill,
            total: totalAmt,
            timestamp: Date.now()
          }
        });
      }

      setIsCheckoutModalOpen(false);
      setCustomerName("");
      setCustomerPhone("");
      setCurrentBill([]);
      setPopupModal({ show: true, message: "Payment Successful & Order Recorded! 🎉" });
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Checkout failed: " + err.message);
    }
  };

  const handlePrintBill = (order) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    const orderDate = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : new Date().toLocaleString();
    const itemsHtml = (order.items || []).map(i => `
      <tr>
        <td style="padding: 4px 0;">${i.name || i.itemName}</td>
        <td style="text-align: center; padding: 4px 0;">${i.qty}</td>
        <td style="text-align: right; padding: 4px 0;">₹${(i.price || i.salesPrice || 0) * i.qty}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice - Kadai Pro</title>
          <style>
            body { font-family: monospace; padding: 20px; color: #000; width: 300px; margin: 0 auto; }
            h2, p { text-align: center; margin: 5px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
            th { border-bottom: 1px dashed #000; padding-bottom: 4px; text-align: left; }
            .total { border-top: 1px dashed #000; margin-top: 10px; padding-top: 8px; font-weight: bold; display: flex; justify-content: space-between; }
          </style>
        </head>
        <body>
          <h2>${userProfile.storeName}</h2>
          <p>Store Billing Receipt</p>
          <p style="font-size: 11px; color: #555;">Admin / Billed By: ${userProfile.name || "Store Owner"}</p>
          <p style="font-size: 11px; color: #555;">Customer: ${order.customerName || "Walk-in"}</p>
          <p style="font-size: 11px; color: #555;">Payment: ${order.paymentMethod || order.paymentMode || "Cash"}</p>
          <p style="font-size: 11px; color: #555;">Date: ${orderDate}</p>
          <hr style="border: 0; border-top: 1px dashed #000;" />
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align: center;">Qty</th>
                <th style="text-align: right;">Amt</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <div class="total">
            <span>TOTAL:</span>
            <span>₹${order.totalAmount || order.total || 0}</span>
          </div>
          <p style="margin-top: 20px; font-size: 11px; text-align: center;">*** Thank You Come Again ***</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const openAddModal = () => {
    setIsEditing(false);
    setEditId(null);
    setName("");
    setCategory(isRestaurant ? "Main Course" : "General");
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
    setCategory(item.category || (isRestaurant ? "Main Course" : "General"));
    setPrice(String(item.salesPrice ?? item.price ?? ""));
    setQty(String(item.quantity ?? "0"));
    setBrand(item.brand || "");
    setImage(item.image || item.imageUrl || "");
    setIsModalOpen(true);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      if (!currentUid) return;

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
    <div style={styles.appContainer}>
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
            right: `${menuCoords.right}px`
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
      <div style={styles.mainContent}>
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
                <button onClick={clearCurrentBill} style={styles.clearCartBtn}>CLEAR CART ✕</button>
              </div>

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
                <button 
                  style={{ ...styles.posCheckoutBtn, opacity: currentBill.length === 0 ? 0.5 : 1 }} 
                  disabled={currentBill.length === 0}
                  onClick={() => setIsCheckoutModalOpen(true)}
                >
                  CONTINUE தொடரவும் →
                </button>

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
                        <div style={styles.imageWrapper}>
                          <img 
                            src={imageVal} 
                            alt={itemName} 
                            style={styles.productImg} 
                            onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                          />
                          <span style={styles.stockBadge}>{typeof stock === "number" ? `Stock: ${stock}` : stock}</span>
                          {itemQtyInBill > 0 && (
                            <span style={styles.inCartBadge}>✓ {itemQtyInBill}</span>
                          )}
                        </div>
                        <div style={styles.productDetails}>
                          <h4 style={styles.productName} title={itemName}>{itemName}</h4>
                          <p style={styles.productCategory}>₹{priceVal}</p>
                          {itemQtyInBill === 0 ? (
                            <button 
                              onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} 
                              style={styles.addBillBtn}
                            >
                              {isRestaurant ? "+ Add to Order" : "+ Add to POS Bill"}
                            </button>
                          ) : (
                            <div style={styles.posCardQtyControl}>
                              <button 
                                onClick={() => removeFromCurrentBill(item.id || item.barcode)} 
                                style={styles.posCardQtyBtn}
                                title="Decrease"
                              >
                                -
                              </button>
                              <span style={styles.posCardQtyVal}>{itemQtyInBill}</span>
                              <button 
                                onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} 
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
            setPopupModal={setPopupModal} 
          />
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
                    return (
                      <div key={order.id || idx} onClick={() => setSelectedOrderDetails(order)} style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: "10px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
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
                          </div>
                          <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#64748b" }}>Customer: {order.customerName || "Walk-in"} | Payment: {order.paymentMethod || order.paymentMode || "Cash"}</p>
                          <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>Total: <strong style={{ color: "#fc8019" }}>₹{order.totalAmount || order.total}</strong></p>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); handlePrintBill(order); }} style={styles.printBillBtn}>🖨️ Print Bill</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

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

      {/* RECEIPT PREVIEW MODAL */}
      {selectedOrderDetails && (
        <div style={styles.modalOverlay} onClick={() => setSelectedOrderDetails(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "450px" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: "#1e3a8a", textAlign: "center" }}>{userProfile.storeName} RECEIPT</h3>
            <p style={{ textAlign: "center", fontSize: "12px", color: "#64748b", margin: "4px 0 12px 0" }}>
              Customer: {selectedOrderDetails.customerName || "Walk-in"} | Paid via: {selectedOrderDetails.paymentMethod || selectedOrderDetails.paymentMode || "Cash"}
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
              <button onClick={() => handlePrintBill(selectedOrderDetails)} style={{ flex: 1, padding: "10px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}>Print Receipt</button>
              <button onClick={() => setSelectedOrderDetails(null)} style={{ flex: 1, padding: "10px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}>Close</button>
            </div>
          </div>
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
            <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px", lineHeight: "1.4" }}>{popupModal.message}</p>
            
            <button 
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
            <h3>{isRestaurant ? (isEditing ? "Edit Food Item" : "Add New Food") : (isEditing ? "Edit Product" : "Add New Product")}</h3>
            <form onSubmit={handleSaveProduct} style={styles.modalForm}>
              <input 
                type="text" 
                placeholder={isRestaurant ? "Food Name (e.g. Chicken Biryani, Dosa)" : "Product Name"} 
                value={name} 
                onChange={e => setName(e.target.value)} 
                style={styles.modalInput} 
                required 
              />
              <input 
                type="text" 
                placeholder={isRestaurant ? "Category (e.g. Starters, Main Course, Beverages)" : "Category"} 
                value={category} 
                onChange={e => setCategory(e.target.value)} 
                style={styles.modalInput} 
                required 
              />
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
              </div>
              <div style={styles.modalBtns}>
                <button type="submit" style={styles.saveModalBtn}>{isRestaurant ? "Save Food" : "Save Product"}</button>
                <button type="button" onClick={() => setIsModalOpen(false)} style={styles.cancelModalBtn}>Cancel</button>
              </div>
            </form>
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
    boxSizing: "border-box"
  },
  navLeftGroup: { display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 },
  logoArea: { display: "flex", alignItems: "center", gap: "8px" },
  sidebarBrand: { fontSize: "16px", fontWeight: "800", color: "#1e3a8a", margin: 0, whiteSpace: "nowrap" },
  searchBarContainer: { display: "flex", alignItems: "center", backgroundColor: "#f1f5f9", padding: "6px 12px", borderRadius: "8px", width: "220px", gap: "6px" },
  searchInput: { border: "none", background: "transparent", outline: "none", width: "100%", fontSize: "12px", color: "#1e293b" },
  searchIcon: { fontSize: "14px" },
  navLinks: { display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 },
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
    height: "calc(100vh - 61px)", 
    boxSizing: "border-box", 
    overflow: "hidden" 
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
    flexShrink: 0 
  },
  posHeaderTop: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 28px", borderBottom: "1px solid #f1f5f9" },
  clearCartBtn: { background: "transparent", border: "none", color: "#ef4444", fontWeight: "800", fontSize: "13px", cursor: "pointer" },
  posBillItemsList: { flex: 1, overflowY: "auto", padding: "18px 28px", display: "flex", flexDirection: "column", gap: "14px" },
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

  posBillFooter: { borderTop: "2px solid #f1f5f9", padding: "20px 28px", backgroundColor: "#fff", flexShrink: 0 },
  posTotalRow: { display: "flex", justifyContent: "space-between", fontSize: "19px", fontWeight: "800", color: "#0f172a", marginBottom: "14px" },
  posTotalPrice: { color: "#fc8019", fontSize: "24px" },
  posCheckoutBtn: { width: "100%", padding: "16px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "12px", fontWeight: "800", fontSize: "16px", cursor: "pointer", textAlign: "center", boxShadow: "0 4px 14px rgba(37, 99, 235, 0.28)" },

  posRightPane: { flex: 1, backgroundColor: "#f8fafc", padding: "20px 24px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", boxSizing: "border-box", minWidth: 0 },
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
    backgroundColor: "#fc8019",
    color: "#ffffff",
    padding: "2px 8px",
    borderRadius: "10px",
    fontSize: "11px",
    fontWeight: "800",
    boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
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