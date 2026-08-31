// src/screens/Dashboard.jsx
import React, { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";
import Profile from "./Profile";
import Settings from "./Settings";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("sales"); // "sales", "dashboard", "inventory", "orders", "profile", "settings"
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  
  const [currentBill, setCurrentBill] = useState([]);
  const [ordersList, setOrdersList] = useState([]);

  // Dropdown State for Profile & Settings
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

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

  const handleClickOutside = (e) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
      setProfileDropdownOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);

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
          setUserProfile({
            name: data.name || auth.currentUser?.displayName || "Store Owner",
            email: data.email || auth.currentUser?.email || "",
            phone: data.phone || "",
            storeName: data.storeName || "Kadai Pro Store",
            profileImage: data.profileImage || ""
          });
          if (data.settings) {
            setStoreSettings(data.settings);
          }
        }
      } catch (err) {
        console.error("Error fetching user profile:", err);
      }
    };
    fetchUserData();

    const inventoryRef = collection(db, "users", currentUid, "inventory");
    const unsubscribeInventory = onSnapshot(inventoryRef, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProducts(items);

      const uniqueCats = ["All", ...new Set(items.map(item => item.category || "General").filter(Boolean))];
      setCategories(uniqueCats);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching inventory:", error);
      setLoading(false);
    });

    const ordersRef = collection(db, "users", currentUid, "local_orders");
    const unsubscribeOrders = onSnapshot(ordersRef, (snapshot) => {
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      orders.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setOrdersList(orders);
    }, (error) => {
      console.error("Error fetching orders:", error);
    });

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      unsubscribeInventory();
      unsubscribeOrders();
    };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem("uid");
    window.location.href = "/login";
  };

  const addToCurrentBill = (product) => {
    setCurrentBill(prev => {
      const exist = prev.find(item => item.id === product.id);
      if (exist) {
        return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const removeFromCurrentBill = (id) => {
    setCurrentBill(prev => prev.map(item => item.id === id ? { ...item, qty: item.qty - 1 } : item).filter(item => item.qty > 0));
  };

  const deleteFromCurrentBill = (id) => {
    setCurrentBill(prev => prev.filter(item => item.id !== id));
  };

  const clearCurrentBill = () => {
    setCurrentBill([]);
  };

  const handleFinalCheckoutSubmit = async (e) => {
    e.preventDefault();
    if (currentBill.length === 0) return;
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      const totalAmt = currentBill.reduce((sum, item) => sum + ((item.salesPrice || item.price || 0) * item.qty), 0);
      
      const orderData = {
        items: currentBill,
        totalAmount: totalAmt,
        customerName: customerName.trim() || "Walk-in Customer",
        customerPhone: customerPhone.trim() || "N/A",
        paymentMethod: paymentMethod,
        createdAt: serverTimestamp(),
        status: "Completed"
      };

      if (currentUid) {
        const ordersRef = collection(db, "users", currentUid, "local_orders");
        await addDoc(ordersRef, orderData);
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
          <p style="font-size: 11px; color: #555;">Payment: ${order.paymentMethod || "Cash"}</p>
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
            <span>₹${order.totalAmount || 0}</span>
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
    setCategory("General");
    setPrice("");
    setQty("");
    setBrand("");
    setImage("");
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    setIsEditing(true);
    setEditId(item.id);
    setName(item.itemName || item.name || "");
    setCategory(item.category || "General");
    setPrice(String(item.salesPrice || item.price || ""));
    setQty(String(item.quantity || "0"));
    setBrand(item.brand || "");
    setImage(item.image || "");
    setIsModalOpen(true);
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      if (!currentUid) return;

      const productData = {
        itemName: name.trim(),
        category: category.trim(),
        salesPrice: Number(price) || 0,
        quantity: Number(qty) || 0,
        brand: brand.trim() || "Local",
        image: image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        updatedAt: serverTimestamp()
      };

      if (isEditing && editId) {
        await updateDoc(doc(db, "users", currentUid, "inventory", editId), productData);
        setPopupModal({ show: true, message: "Product updated successfully! ✅" });
      } else {
        await addDoc(collection(db, "users", currentUid, "inventory"), { ...productData, createdAt: serverTimestamp() });
        setPopupModal({ show: true, message: "Product added successfully! 🚀" });
      }

      setIsModalOpen(false);
    } catch (err) {
      alert("Error saving product: " + err.message);
    }
  };

  const handleDeleteProduct = async (id) => {
    if (window.confirm("Are you sure you want to delete this product?")) {
      try {
        const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
        if (!currentUid) return;
        await deleteDoc(doc(db, "users", currentUid, "inventory", id));
        setPopupModal({ show: true, message: "Product deleted successfully 🗑️" });
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

  return (
    <div style={styles.appContainer}>
      {/* Top Navbar Header */}
      <header style={styles.navbar}>
        <div style={styles.navLeftGroup}>
          <div style={styles.logoArea}>
            <span style={{ fontSize: "22px" }}>🏪</span>
            <h2 style={styles.sidebarBrand}>{userProfile.storeName}</h2>
          </div>

          <div style={styles.searchBarContainer}>
            <span style={styles.searchIcon}>🔍</span>
            <input 
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>
        </div>

        {/* Navigation Links */}
        <div style={styles.navLinks}>
          <button onClick={() => setActiveTab("sales")} style={{ ...styles.navBtn, backgroundColor: activeTab === "sales" ? "#ffedd5" : "transparent", color: activeTab === "sales" ? "#fc8019" : "#64748b" }}>
            🧾 Sales
          </button>
          <button onClick={() => setActiveTab("dashboard")} style={{ ...styles.navBtn, backgroundColor: activeTab === "dashboard" ? "#ffedd5" : "transparent", color: activeTab === "dashboard" ? "#fc8019" : "#64748b" }}>
            🏠 Dashboard
          </button>
          <button onClick={() => setActiveTab("inventory")} style={{ ...styles.navBtn, backgroundColor: activeTab === "inventory" ? "#ffedd5" : "transparent", color: activeTab === "inventory" ? "#fc8019" : "#64748b" }}>
            📦 Inventory
          </button>
          <button onClick={() => setActiveTab("orders")} style={{ ...styles.navBtn, backgroundColor: activeTab === "orders" ? "#ffedd5" : "transparent", color: activeTab === "orders" ? "#fc8019" : "#64748b" }}>
            📋 Orders ({ordersList.length})
          </button>

          {/* Profile & Settings Dropdown */}
          <div style={styles.dropdownWrapper} ref={dropdownRef}>
            <button 
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)} 
              style={{ 
                ...styles.navBtn, 
                backgroundColor: (activeTab === "profile" || activeTab === "settings" || profileDropdownOpen) ? "#ffedd5" : "transparent", 
                color: (activeTab === "profile" || activeTab === "settings" || profileDropdownOpen) ? "#fc8019" : "#64748b",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <div style={{ width: "22px", height: "22px", borderRadius: "50%", overflow: "hidden", backgroundColor: "#ffedd5", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #fc8019", flexShrink: 0 }}>
                {userProfile.profileImage ? (
                  <img src={userProfile.profileImage} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "10px", fontWeight: "800", color: "#fc8019" }}>
                    {userProfile.name ? userProfile.name.charAt(0).toUpperCase() : "A"}
                  </span>
                )}
              </div>
              <span>{userProfile.name ? userProfile.name.split(" ")[0] : "Profile"} ▾</span>
            </button>

            {profileDropdownOpen && (
              <div style={styles.dropdownMenu}>
                <button 
                  onClick={() => { setActiveTab("profile"); setProfileDropdownOpen(false); }}
                  style={{ ...styles.dropdownItem, backgroundColor: activeTab === "profile" ? "#fff7ed" : "transparent", color: activeTab === "profile" ? "#fc8019" : "#334155" }}
                >
                  👤 My Profile
                </button>
                <button 
                  onClick={() => { setActiveTab("settings"); setProfileDropdownOpen(false); }}
                  style={{ ...styles.dropdownItem, backgroundColor: activeTab === "settings" ? "#fff7ed" : "transparent", color: activeTab === "settings" ? "#fc8019" : "#334155" }}
                >
                  ⚙️ Settings
                </button>
                <div style={{ height: "1px", backgroundColor: "#e2e8f0", margin: "4px 0" }} />
                <button 
                  onClick={() => { setProfileDropdownOpen(false); handleLogout(); }}
                  style={{ ...styles.dropdownItem, backgroundColor: "transparent", color: "#dc2626" }}
                >
                  🚪 Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div style={styles.mainContent}>
        {/* TAB 1: POS TERMINAL */}
        {activeTab === "sales" && (
          <div style={styles.posLayout}>
            {/* LEFT SIDE: Current Bill / Cart Summary */}
            <div style={styles.posLeftPane}>
              <div style={styles.posHeaderTop}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#0f172a" }}>{totalBillItemsCount} Items</h3>
                <button onClick={clearCurrentBill} style={styles.clearCartBtn}>CLEAR CART ✕</button>
              </div>

              <div style={styles.posBillItemsList}>
                {currentBill.length === 0 ? (
                  <div style={styles.posEmptyBox}>
                    <p style={{ color: "#94a3b8", fontSize: "14px" }}>No items in current bill</p>
                    <span style={{ fontSize: "28px" }}>🧾</span>
                  </div>
                ) : (
                  currentBill.map((item) => (
                    <div key={item.id} style={styles.posBillRow}>
                      <img src={item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={item.name} style={styles.posRowImg} />
                      <div style={{ flex: 1, marginLeft: "10px", minWidth: 0 }}>
                        <h5 style={styles.posRowTitle}>{item.name}</h5>
                        <p style={styles.posRowSub}>Quantity: {item.qty}</p>
                      </div>
                      <div style={{ textAlign: "right", marginRight: "10px" }}>
                        <span style={styles.posRowPrice}>₹{item.price * item.qty}</span>
                      </div>
                      <div style={styles.posRowActions}>
                        <button onClick={() => deleteFromCurrentBill(item.id)} style={styles.deleteRowBtn}>🗑️</button>
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
              </div>
            </div>

            {/* RIGHT SIDE: Products Vertical List */}
            <div style={styles.posRightPane}>
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

              {loading ? (
                <div style={styles.centerBox}>Loading products...</div>
              ) : filteredProducts.length === 0 ? (
                <div style={styles.centerBox}>No products found ❌</div>
              ) : (
                <div style={styles.posVerticalList}>
                  {filteredProducts.map((item) => {
                    const itemName = item.itemName || item.name || "Unnamed Item";
                    const priceVal = item.salesPrice || item.price || 0;
                    const stock = item.quantity || 0;
                    const imageVal = item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
                    
                    const existingBillItem = currentBill.find(b => b.id === item.id);
                    const itemQtyInBill = existingBillItem ? existingBillItem.qty : 0;

                    return (
                      <div key={item.id} style={styles.posListItem}>
                        <img src={imageVal} alt={itemName} style={styles.posListImg} />
                        <div style={{ flex: 1, marginLeft: "14px", minWidth: 0 }}>
                          <h4 style={styles.posListTitle}>{itemName}</h4>
                          <p style={styles.posListStock}>Stock: {stock}</p>
                          <span style={styles.posListPrice}>₹{priceVal}</span>
                        </div>
                        <div style={{ minWidth: "100px", textAlign: "right" }}>
                          {itemQtyInBill === 0 ? (
                            <button onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} style={styles.posListAddBtn}>ADD +</button>
                          ) : (
                            <div style={styles.posListQtyControl}>
                              <button onClick={() => removeFromCurrentBill(item.id)} style={styles.posListQtyBtn}>-</button>
                              <span style={styles.posListQtyVal}>{itemQtyInBill}</span>
                              <button onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} style={styles.posListQtyBtn}>+</button>
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
            <h2 style={styles.sectionTitle}>Shop Categories</h2>
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

            <h2 style={styles.sectionTitle}>Available Products ({filteredProducts.length})</h2>

            <div style={styles.productGrid}>
              {filteredProducts.map((item) => {
                const itemName = item.itemName || item.name || "Unnamed Item";
                const priceVal = item.salesPrice || item.price || 0;
                const stock = item.quantity || 0;
                const imageVal = item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
                
                return (
                  <div key={item.id} style={styles.productCard}>
                    <div style={styles.imageWrapper}>
                      <img src={imageVal} alt={itemName} style={styles.productImg} />
                      <span style={styles.stockBadge}>Stock: {stock}</span>
                    </div>
                    <div style={styles.productDetails}>
                      <h4 style={styles.productName}>{itemName}</h4>
                      <p style={styles.productCategory}>₹{priceVal}</p>
                      <button onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} style={styles.addBillBtn}>+ Add to POS Bill</button>
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
              <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>📦 Store Inventory Management</h2>
              <button onClick={openAddModal} style={styles.addNewBtn}>+ Add New Product</button>
            </div>
            <div style={styles.productGrid}>
              {products.map((item) => (
                <div key={item.id} style={styles.productCard}>
                  <div style={styles.imageWrapper}>
                    <img src={item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={item.name} style={styles.productImg} />
                    <span style={styles.stockBadge}>Stock: {item.quantity || 0}</span>
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
          </div>
        )}

        {/* TAB 4: ORDERS */}
        {activeTab === "orders" && (
          <div style={{ padding: "30px", maxWidth: "1000px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>📋 Orders & Billing History</h2>
            {ordersList.length === 0 ? (
              <div style={styles.centerBox}>No orders recorded yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {ordersList.map((order, idx) => (
                  <div key={order.id || idx} onClick={() => setSelectedOrderDetails(order)} style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{ margin: "0 0 6px 0", fontSize: "16px" }}>Order ID: #{order.id.slice(-6).toUpperCase()}</h4>
                      <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#64748b" }}>Customer: {order.customerName || "Walk-in"} | Payment: {order.paymentMethod || "Cash"}</p>
                      <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>Total: <strong style={{ color: "#fc8019" }}>₹{order.totalAmount}</strong></p>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handlePrintBill(order); }} style={styles.printBillBtn}>🖨️ Print Bill</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* PROFESSIONAL CHECKOUT MODAL WITH AMOUNT-FIXED UPI QR CODE */}
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

              {/* Customer Details Optional */}
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

              {/* BIG PAYMENT CARDS SELECTION */}
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

              {/* DYNAMIC AMOUNT-FIXED UPI QR CODE */}
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

      {/* BILL DETAILS POPUP MODAL */}
      {selectedOrderDetails && (
        <div style={styles.modalOverlay} onClick={() => setSelectedOrderDetails(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "450px" }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, color: "#1e3a8a", textAlign: "center" }}>{userProfile.storeName} RECEIPT</h3>
            <p style={{ textAlign: "center", fontSize: "12px", color: "#64748b", margin: "4px 0 12px 0" }}>
              Customer: {selectedOrderDetails.customerName || "Walk-in"} | Paid via: {selectedOrderDetails.paymentMethod || "Cash"}
            </p>
            <div style={{ maxHeight: "220px", overflowY: "auto", margin: "10px 0", borderTop: "1px solid #eee", borderBottom: "1px solid #eee", padding: "10px 0" }}>
              {(selectedOrderDetails.items || []).map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", paddingBottom: "6px" }}>
                  <span>{item.name} (x{item.qty})</span>
                  <span>₹{item.price * item.qty}</span>
                </div>
              ))}
            </div>
            <div style={{ paddingTop: "6px", display: "flex", justifyContent: "space-between", fontWeight: "800", fontSize: "16px" }}>
              <span>Total:</span>
              <span style={{ color: "#fc8019" }}>₹{selectedOrderDetails.totalAmount}</span>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <button onClick={() => handlePrintBill(selectedOrderDetails)} style={{ flex: 1, padding: "10px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}>Print Receipt</button>
              <button onClick={() => setSelectedOrderDetails(null)} style={{ flex: 1, padding: "10px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* PROFESSIONAL SUCCESS ANIMATED POPUP */}
      {popupModal.show && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, textAlign: "center", maxWidth: "340px", padding: "30px 20px" }}>
            {/* Animated Green Checkmark SVG */}
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
            <h3>{isEditing ? "Edit Product" : "Add New Product"}</h3>
            <form onSubmit={handleSaveProduct} style={styles.modalForm}>
              <input type="text" placeholder="Product Name" value={name} onChange={e => setName(e.target.value)} style={styles.modalInput} required />
              <input type="text" placeholder="Category" value={category} onChange={e => setCategory(e.target.value)} style={styles.modalInput} required />
              <input type="number" placeholder="Sales Price (₹)" value={price} onChange={e => setPrice(e.target.value)} style={styles.modalInput} required />
              <input type="number" placeholder="Quantity / Stock" value={qty} onChange={e => setQty(e.target.value)} style={styles.modalInput} required />
              <input type="text" placeholder="Brand Name" value={brand} onChange={e => setBrand(e.target.value)} style={styles.modalInput} />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700" }}>Product Photo</label>
                <input type="file" accept="image/*" onChange={handleImageChange} style={{ fontSize: "12px" }} />
              </div>
              <div style={styles.modalBtns}>
                <button type="submit" style={styles.saveModalBtn}>Save</button>
                <button type="button" onClick={() => setIsModalOpen(false)} style={styles.cancelModalBtn}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  appContainer: { display: "flex", minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "system-ui, sans-serif", flexDirection: "column" },
navbar: { 
  display: "flex", 
  justifyContent: "space-between", 
  alignItems: "center", 
  padding: "8px 14px", 
  backgroundColor: "#ffffff", 
  borderBottom: "1px solid #e2e8f0", 
  position: "sticky", 
  top: 0, 
  zIndex: 100, 
  gap: "12px", 
  width: "100%", 
  boxSizing: "border-box", 
  flexWrap: "wrap" 
},  navLeftGroup: { display: "flex", alignItems: "center", gap: "12px", flexShrink: 1, minWidth: 0 },
  sidebarBrand: { fontSize: "14px", fontWeight: "800", color: "#1e3a8a", margin: 0, whiteSpace: "nowrap" },
  navLinks: { display: "flex", gap: "6px", flexWrap: "nowrap", alignItems: "center", overflowX: "auto", flexShrink: 0, paddingBottom: "2px" },
  navBtn: { padding: "5px 8px", border: "none", borderRadius: "6px", fontWeight: "700", fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 },
  searchBarContainer: { display: "flex", alignItems: "center", backgroundColor: "#f1f5f9", padding: "4px 8px", borderRadius: "8px", width: "140px", gap: "4px", flexShrink: 1, minWidth: "90px" },
  searchInput: { border: "none", background: "transparent", outline: "none", width: "100%", fontSize: "11px", color: "#1e293b" },
  searchIcon: { fontSize: "14px" },
  
  // Dropdown Styles
  dropdownWrapper: { position: "relative", display: "inline-block", overflow: "visible", zIndex: 9999 },  
  dropdownMenu: { position: "absolute", top: "100%", right: 0, marginTop: "8px", backgroundColor: "#ffffff", borderRadius: "10px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", minWidth: "160px", zIndex: 99999, padding: "4px" },  
  dropdownItem: { padding: "10px 14px", textAlign: "left", background: "transparent", border: "none", fontSize: "12px", fontWeight: "700", cursor: "pointer", borderRadius: "6px", whiteSpace: "nowrap", width: "100%" },

  posLayout: { display: "flex", flexDirection: "row", flex: 1, height: "calc(100vh - 57px)", boxSizing: "border-box", overflow: "hidden" },  
  posLeftPane: { width: "340px", minWidth: "320px", backgroundColor: "#ffffff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", boxSizing: "border-box", height: "100%", flexShrink: 0 },  clearCartBtn: { background: "transparent", border: "none", color: "#ef4444", fontWeight: "800", fontSize: "11px", cursor: "pointer" },
  posBillItemsList: { flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" },
  posEmptyBox: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "6px", minHeight: "200px" },
  posBillRow: { display: "flex", alignItems: "center", backgroundColor: "#f8fafc", padding: "8px", borderRadius: "10px", border: "1px solid #f1f5f9" },
  posRowImg: { width: "40px", height: "40px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 },
  posRowTitle: { fontSize: "12px", fontWeight: "700", color: "#1e293b", margin: "0 0 2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  posRowSub: { fontSize: "10px", color: "#64748b", margin: 0 },
  posRowPrice: { fontSize: "13px", fontWeight: "800", color: "#0f172a", whiteSpace: "nowrap" },
  posRowActions: { display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end", flexShrink: 0 },
  deleteRowBtn: { background: "transparent", border: "none", cursor: "pointer", fontSize: "12px" },
  posBillFooter: { borderTop: "2px solid #f1f5f9", padding: "16px", backgroundColor: "#fff", flexShrink: 0 },
  posTotalRow: { display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "800", color: "#0f172a", marginBottom: "12px" },
  posTotalPrice: { color: "#fc8019" },
  posCheckoutBtn: { width: "100%", padding: "14px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "800", fontSize: "14px", cursor: "pointer", textAlign: "center" },

  posRightPane: { flex: 1, backgroundColor: "#f8fafc", padding: "16px", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column", boxSizing: "border-box", minWidth: 0 },
  posVerticalList: { display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "40px" },
  posListItem: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "10px 14px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.02)" },
  posListImg: { width: "48px", height: "48px", objectFit: "cover", borderRadius: "8px", flexShrink: 0 },
  posListTitle: { fontSize: "13px", fontWeight: "700", color: "#1e293b", margin: "0 0 2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  posListStock: { fontSize: "10px", color: "#64748b", margin: "0 0 2px 0" },
  posListPrice: { fontSize: "14px", fontWeight: "800", color: "#0f172a" },
  posListAddBtn: { padding: "6px 14px", backgroundColor: "#fff7ed", color: "#fc8019", border: "1px solid #fed7aa", borderRadius: "6px", fontWeight: "800", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" },
  posListQtyControl: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "6px", padding: "2px 6px", width: "75px", flexShrink: 0 },
  posListQtyBtn: { border: "none", background: "transparent", fontWeight: "800", color: "#fc8019", cursor: "pointer", fontSize: "13px" },
  posListQtyVal: { fontSize: "13px", fontWeight: "800", color: "#1e293b" },

  sectionTitle: { fontSize: "17px", fontWeight: "800", color: "#0f172a", marginBottom: "12px" },
  categoryScroll: { display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "8px", marginBottom: "16px", flexShrink: "0" },
  categoryCard: { padding: "6px 14px", borderRadius: "18px", cursor: "pointer", fontWeight: "700", fontSize: "12px", whiteSpace: "nowrap", border: "1px solid #e2e8f0", flexShrink: 0 },
  productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "14px" },
  productCard: { backgroundColor: "#ffffff", borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column" },
  imageWrapper: { position: "relative", height: "130px", width: "100%" },
  productImg: { width: "100%", height: "100%", objectFit: "cover" },
  stockBadge: { position: "absolute", bottom: "6px", left: "6px", backgroundColor: "rgba(0, 0, 0, 0.75)", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "700" },
  productDetails: { padding: "10px", display: "flex", flexDirection: "column", gap: "4px", flex: 1, justifyContent: "space-between" },
  productName: { fontSize: "13px", fontWeight: "700", color: "#1e293b", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  productCategory: { fontSize: "10px", color: "#64748b", margin: 0 },
  addBillBtn: { width: "100%", padding: "6px", backgroundColor: "#fff7ed", color: "#fc8019", border: "1px solid #fed7aa", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  
  floatingBar: { position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", backgroundColor: "#fc8019", color: "#fff", padding: "12px 24px", borderRadius: "30px", display: "flex", justifyContent: "space-between", alignItems: "center", width: "90%", maxWidth: "500px", boxShadow: "0 10px 25px rgba(252, 128, 25, 0.4)", cursor: "pointer", zIndex: 999, boxSizing: "border-box" },
  editCardBtn: { flex: 1, padding: "6px", backgroundColor: "#e0e7ff", color: "#4f46e5", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center", whiteSpace: "nowrap" },
  deleteCardBtn: { flex: 1, padding: "6px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center", whiteSpace: "nowrap" },
  cartControls: { display: "flex", alignItems: "center", gap: "4px", backgroundColor: "#f1f5f9", padding: "2px 4px", borderRadius: "6px" },
  qtyBtn: { border: "none", background: "transparent", fontWeight: "800", cursor: "pointer", color: "#fc8019", fontSize: "11px" },
  qtyText: { fontSize: "11px", fontWeight: "700", color: "#1e293b" },
  printBillBtn: { padding: "6px 12px", backgroundColor: "#f1f5f9", color: "#1e293b", border: "1.5px solid #cbd5e1", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "12px", whiteSpace: "nowrap" },
  centerBox: { gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#64748b", fontWeight: "600", fontSize: "14px" },
  addNewBtn: { padding: "8px 16px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px", whiteSpace: "nowrap" },
  
  profileRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #e2e8f0", gap: "10px", flexWrap: "wrap" },
  profileLabel: { fontSize: "13px", fontWeight: "700", color: "#64748b" },
  profileValue: { fontSize: "14px", fontWeight: "800", color: "#0f172a" },
  profileEditInput: { padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "14px", fontWeight: "700", color: "#1e293b", outline: "none", width: "240px", boxSizing: "border-box", backgroundColor: "#f8fafc" },

  paymentCardsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "4px" },
  paymentCardOption: { padding: "10px", borderRadius: "10px", border: "2px solid #cbd5e1", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", cursor: "pointer", transition: "all 0.2s" },

  qrContainer: { display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: "#f8fafc", padding: "12px", borderRadius: "10px", border: "1px dashed #cbd5e1", margin: "10px 0", gap: "8px" },
  qrBox: { backgroundColor: "#fff", padding: "8px", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },

  modalOverlay: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "16px", boxSizing: "border-box" },
  modalBox: { backgroundColor: "#fff", padding: "24px", borderRadius: "16px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 25px rgba(0,0,0,0.2)", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto" },
  modalForm: { display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "4px" },
  label: { fontSize: "12px", fontWeight: "700", color: "#334155" },
  modalInput: { padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" },
  modalBtns: { display: "flex", gap: "8px", marginTop: "12px" },
  saveModalBtn: { flex: 1, padding: "12px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" },
  cancelModalBtn: { flex: 1, padding: "12px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }
};