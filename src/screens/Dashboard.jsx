// src/screens/Dashboard.jsx
import React, { useState, useEffect } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("sales"); // "sales", "dashboard", "inventory", "wishlist", "orders", "profile", "settings"
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  
  const [currentBill, setCurrentBill] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [ordersList, setOrdersList] = useState([]);

  // User Profile & Settings States
  const [userProfile, setUserProfile] = useState({ name: "", email: "", phone: "", storeName: "Kadai Pro Store" });
  const [storeSettings, setStoreSettings] = useState({ upiId: "kadaippro@okaxis", allowCash: true, allowUpi: true, allowCard: true });
  const [savingSettings, setSavingSettings] = useState(false);

  // Checkout Modal State
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Cash");

  // Success Popup Modal State
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

  useEffect(() => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      setLoading(false);
      return;
    }

    // 1. Fetch User Profile & Settings from Firestore
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
            storeName: data.storeName || "Kadai Pro Store"
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

    // 2. Real-time Inventory Listener
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

    // 3. Real-time Orders & Bills Listener
    const ordersRef = collection(db, "users", currentUid, "local_orders");
    const unsubscribeOrders = onSnapshot(ordersRef, (snapshot) => {
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      orders.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setOrdersList(orders);
    }, (error) => {
      console.error("Error fetching orders:", error);
    });

    return () => {
      unsubscribeInventory();
      unsubscribeOrders();
    };
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      setSavingSettings(true);
      const userDocRef = doc(db, "users", currentUid);
      await setDoc(userDocRef, { settings: storeSettings }, { merge: true });
      setPopupModal({ show: true, message: "Store & Payment Settings Saved Successfully! ⚙️" });
    } catch (err) {
      alert("Error saving settings: " + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

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

  const addToCart = (product) => {
    setCartItems(prev => {
      const exist = prev.find(item => item.id === product.id);
      if (exist) {
        return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { ...product, qty: 1 }];
    });
    setPopupModal({ show: true, message: `"${product.itemName || product.name}" added to Cart! 🛒` });
  };

  const removeFromCart = (id) => {
    setCartItems(prev => prev.map(item => item.id === id ? { ...item, qty: item.qty - 1 } : item).filter(item => item.qty > 0));
  };

  const toggleWishlist = (product) => {
    setWishlist(prev => {
      const exists = prev.some(item => item.id === product.id);
      if (exists) {
        return prev.filter(item => item.id !== product.id);
      } else {
        return [...prev, product];
      }
    });
  };

  // Professional Checkout Submission
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
      setPopupModal({ show: true, message: "Order Placed & Payment Recorded Successfully! 🎉" });
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Checkout failed: " + err.message);
    }
  };

  // Print Bill Function
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
  const totalCartAmount = cartItems.reduce((sum, item) => sum + ((item.salesPrice || item.price || 0) * item.qty), 0);
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
        <div style={styles.logoArea}>
          <span style={{ fontSize: "24px" }}>🏪</span>
          <h2 style={styles.sidebarBrand}>{userProfile.storeName}</h2>
        </div>

        {/* Navigation Links */}
        <div style={styles.navLinks}>
          <button onClick={() => setActiveTab("sales")} style={{ ...styles.navBtn, backgroundColor: activeTab === "sales" ? "#ffedd5" : "transparent", color: activeTab === "sales" ? "#fc8019" : "#64748b" }}>
            🧾 POS Terminal
          </button>
          <button onClick={() => setActiveTab("dashboard")} style={{ ...styles.navBtn, backgroundColor: activeTab === "dashboard" ? "#ffedd5" : "transparent", color: activeTab === "dashboard" ? "#fc8019" : "#64748b" }}>
            🏠 Dashboard Grid
          </button>
          <button onClick={() => setActiveTab("inventory")} style={{ ...styles.navBtn, backgroundColor: activeTab === "inventory" ? "#ffedd5" : "transparent", color: activeTab === "inventory" ? "#fc8019" : "#64748b" }}>
            📦 Store Inventory
          </button>
          <button onClick={() => setActiveTab("wishlist")} style={{ ...styles.navBtn, backgroundColor: activeTab === "wishlist" ? "#ffedd5" : "transparent", color: activeTab === "wishlist" ? "#fc8019" : "#64748b" }}>
            ❤️ Wishlist ({wishlist.length})
          </button>
          <button onClick={() => setActiveTab("orders")} style={{ ...styles.navBtn, backgroundColor: activeTab === "orders" ? "#ffedd5" : "transparent", color: activeTab === "orders" ? "#fc8019" : "#64748b" }}>
            📋 Orders ({ordersList.length})
          </button>
          <button onClick={() => setActiveTab("profile")} style={{ ...styles.navBtn, backgroundColor: activeTab === "profile" ? "#ffedd5" : "transparent", color: activeTab === "profile" ? "#fc8019" : "#64748b" }}>
            👤 Profile
          </button>
          <button onClick={() => setActiveTab("settings")} style={{ ...styles.navBtn, backgroundColor: activeTab === "settings" ? "#ffedd5" : "transparent", color: activeTab === "settings" ? "#fc8019" : "#64748b" }}>
            ⚙️ Settings
          </button>
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

        <div style={styles.navRight}>
          <button onClick={() => setActiveTab("cartPage")} style={styles.navbarCartBtn}>
            🛒 Cart ({cartItems.reduce((a, c) => a + c.qty, 0)})
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
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
                      <div style={{ flex: 1, marginLeft: "10px" }}>
                        <h5 style={styles.posRowTitle}>{item.name}</h5>
                        <p style={styles.posRowSub}>Quantity: {item.qty}</p>
                      </div>
                      <div style={{ textAlign: "right", marginRight: "10px" }}>
                        <span style={styles.posRowPrice}>₹{item.price * item.qty}</span>
                      </div>
                      <div style={styles.posRowActions}>
                        <div style={styles.cartControls}>
                          <button onClick={() => removeFromCurrentBill(item.id)} style={styles.qtyBtn}>-</button>
                          <span style={styles.qtyText}>{item.qty}</span>
                          <button onClick={() => addToCurrentBill(item)} style={styles.qtyBtn}>+</button>
                        </div>
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
                        <div style={{ flex: 1, marginLeft: "14px" }}>
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
          <div style={{ padding: "40px", maxWidth: "700px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <div style={{ backgroundColor: "#fff", borderRadius: "20px", padding: "30px", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "20px", borderBottom: "2px solid #f1f5f9", paddingBottom: "20px", marginBottom: "20px" }}>
                <div style={{ width: "70px", height: "70px", borderRadius: "50%", backgroundColor: "#ffedd5", color: "#fc8019", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "30px", fontWeight: "800" }}>
                  {userProfile.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 style={{ margin: "0 0 4px 0", fontSize: "22px", color: "#0f172a" }}>{userProfile.name}</h2>
                  <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>Registered Owner / Admin</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={styles.profileRow}>
                  <span style={styles.profileLabel}>Store Name</span>
                  <span style={styles.profileValue}>{userProfile.storeName}</span>
                </div>
                <div style={styles.profileRow}>
                  <span style={styles.profileLabel}>Email Address</span>
                  <span style={styles.profileValue}>{userProfile.email || "Not Provided"}</span>
                </div>
                <div style={styles.profileRow}>
                  <span style={styles.profileLabel}>Phone Number</span>
                  <span style={styles.profileValue}>{userProfile.phone || "Not Provided"}</span>
                </div>
                <div style={styles.profileRow}>
                  <span style={styles.profileLabel}>Configured UPI ID</span>
                  <span style={styles.profileValue}>{storeSettings.upiId}</span>
                </div>
              </div>

              <div style={{ marginTop: "30px", display: "flex", gap: "10px" }}>
                <button onClick={() => setActiveTab("settings")} style={{ padding: "12px 24px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }}>
                  ⚙️ Go to Settings & Payment Setup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SETTINGS PAGE TAB */}
        {activeTab === "settings" && (
          <div style={{ padding: "40px", maxWidth: "700px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <div style={{ backgroundColor: "#fff", borderRadius: "20px", padding: "30px", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", border: "1px solid #e2e8f0" }}>
              <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", marginBottom: "6px" }}>⚙️ Store & Payment Settings</h2>
              <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>Configure your store name and payment methods for POS checkout and QR generation.</p>

              <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Store Name</label>
                  <input 
                    type="text" 
                    value={userProfile.storeName} 
                    onChange={(e) => setUserProfile({ ...userProfile, storeName: e.target.value })} 
                    style={styles.modalInput} 
                    required 
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.label}>Your UPI ID (For QR Code Generation)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. yourname@okaxis" 
                    value={storeSettings.upiId} 
                    onChange={(e) => setStoreSettings({ ...storeSettings, upiId: e.target.value })} 
                    style={styles.modalInput} 
                    required 
                  />
                  <small style={{ color: "#64748b", fontSize: "12px" }}>This UPI ID will automatically generate dynamic payment QR codes during checkout.</small>
                </div>

                <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
                  <label style={{ ...styles.label, marginBottom: "10px", display: "block" }}>Enabled Payment Methods at POS</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>
                      <input 
                        type="checkbox" 
                        checked={storeSettings.allowCash} 
                        onChange={(e) => setStoreSettings({ ...storeSettings, allowCash: e.target.checked })} 
                        style={{ width: "16px", height: "16px" }}
                      />
                      💵 Cash Payments
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>
                      <input 
                        type="checkbox" 
                        checked={storeSettings.allowUpi} 
                        onChange={(e) => setStoreSettings({ ...storeSettings, allowUpi: e.target.checked })} 
                        style={{ width: "16px", height: "16px" }}
                      />
                      📱 UPI QR Code Payments
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>
                      <input 
                        type="checkbox" 
                        checked={storeSettings.allowCard} 
                        onChange={(e) => setStoreSettings({ ...storeSettings, allowCard: e.target.checked })} 
                        style={{ width: "16px", height: "16px" }}
                      />
                      💳 Credit / Debit Card Payments
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: "10px" }}>
                  <button type="submit" disabled={savingSettings} style={{ padding: "12px 28px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer", fontSize: "15px" }}>
                    {savingSettings ? "Saving..." : "Save Settings 💾"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: DASHBOARD */}
        {activeTab === "dashboard" && (
          <div style={{ padding: "24px", paddingBottom: "80px" }}>
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
          <div style={{ padding: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
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

        {/* TAB 4: CART PAGE */}
        {activeTab === "cartPage" && (
          <div style={{ padding: "40px", maxWidth: "900px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <h2 style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>🛒 My Shopping Cart</h2>
            {cartItems.length === 0 ? (
              <div style={styles.centerBox}>Your cart is empty.</div>
            ) : (
              <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                {cartItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: "16px" }}>{item.name}</h4>
                      <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>₹{item.price} x {item.qty}</p>
                    </div>
                    <span style={{ fontWeight: "800", fontSize: "16px" }}>₹{item.price * item.qty}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "24px", paddingTop: "16px", borderTop: "2px solid #e2e8f0" }}>
                  <span style={{ fontSize: "18px", fontWeight: "800" }}>Total: ₹{totalCartAmount}</span>
                  <button onClick={() => { setPopupModal({ show: true, message: "Cart Order Placed Successfully! 🎉" }); setCartItems([]); }} style={{ padding: "12px 28px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }}>
                    Proceed to Checkout
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: WISHLIST */}
        {activeTab === "wishlist" && (
          <div style={{ padding: "30px" }}>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>❤️ Wishlist</h2>
            {wishlist.length === 0 ? (
              <div style={styles.centerBox}>Your wishlist is empty.</div>
            ) : (
              <div style={styles.productGrid}>
                {wishlist.map((item) => (
                  <div key={item.id} style={styles.productCard}>
                    <img src={item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={item.name} style={styles.productImg} />
                    <div style={styles.productDetails}>
                      <h4 style={styles.productName}>{item.itemName || item.name}</h4>
                      <p>₹{item.salesPrice || item.price || 0}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: ORDERS */}
        {activeTab === "orders" && (
          <div style={{ padding: "30px", maxWidth: "1000px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>📋 Orders & Billing History</h2>
            {ordersList.length === 0 ? (
              <div style={styles.centerBox}>No orders recorded yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {ordersList.map((order, idx) => (
                  <div key={order.id || idx} onClick={() => setSelectedOrderDetails(order)} style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                    <div>
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

      {/* PROFESSIONAL CHECKOUT MODAL WITH DYNAMIC QR BASED ON SETTINGS */}
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

              {/* Customer Details Optional (Can skip easily) */}
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ ...styles.inputGroup, flex: 1 }}>
                  <label style={styles.label}>Customer Name (Optional)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Rahul" 
                    value={customerName} 
                    onChange={(e) => setCustomerName(e.target.value)} 
                    style={styles.modalInput} 
                  />
                </div>
                <div style={{ ...styles.inputGroup, flex: 1 }}>
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

{/* DYNAMIC UPI QR CODE DISPLAY USING SETTINGS UPI ID */}
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
      <p style={{ margin: "0 0 2px 0", fontSize: "12px", fontWeight: "700", color: "#1e293b" }}>Scan & Pay with GPay / PhonePe / Paytm</p>
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

      {/* SUCCESS POPUP */}
      {popupModal.show && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, textAlign: "center", maxWidth: "340px" }}>
            <span style={{ fontSize: "36px" }}>🎉</span>
            <p style={{ margin: "14px 0", fontSize: "14px", fontWeight: "600" }}>{popupModal.message}</p>
            <button onClick={() => setPopupModal({ show: false, message: "" })} style={{ width: "100%", padding: "10px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}>OK</button>
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
  navbar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", backgroundColor: "#ffffff", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 100, flexWrap: "wrap", gap: "10px" },
  logoArea: { display: "flex", alignItems: "center", gap: "10px" },
  sidebarBrand: { fontSize: "18px", fontWeight: "800", color: "#1e3a8a", margin: 0 },
  navLinks: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" },
  navBtn: { padding: "7px 12px", border: "none", borderRadius: "8px", fontWeight: "700", fontSize: "12px", cursor: "pointer", whiteSpace: "nowrap" },
  logoutBtn: { padding: "7px 12px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "12px" },
  mainContent: { flex: 1, display: "flex", flexDirection: "column", width: "100%", boxSizing: "border-box" },
  searchBarContainer: { display: "flex", alignItems: "center", backgroundColor: "#f1f5f9", padding: "6px 12px", borderRadius: "8px", width: "200px", gap: "6px" },
  searchIcon: { fontSize: "13px" },
  searchInput: { border: "none", background: "transparent", outline: "none", width: "100%", fontSize: "12px", color: "#1e293b" },
  navRight: { display: "flex", alignItems: "center", gap: "8px" },
  navbarCartBtn: { fontWeight: "700", color: "#1e3a8a", fontSize: "12px", backgroundColor: "#eff6ff", padding: "7px 12px", borderRadius: "8px", border: "1.5px solid #bfdbfe", cursor: "pointer" },
  
  posLayout: { display: "flex", flex: 1, height: "calc(100vh - 65px)", boxSizing: "border-box" },
  posLeftPane: { width: "380px", backgroundColor: "#ffffff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", boxSizing: "border-box", height: "100%", position: "sticky", top: "65px" },
  posHeaderTop: { padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 },
  clearCartBtn: { background: "transparent", border: "none", color: "#ef4444", fontWeight: "800", fontSize: "11px", cursor: "pointer" },
  posBillItemsList: { flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px", maxHeight: "calc(100vh - 180px)" },
  posEmptyBox: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "6px", minHeight: "200px" },
  posBillRow: { display: "flex", alignItems: "center", backgroundColor: "#f8fafc", padding: "8px", borderRadius: "10px", border: "1px solid #f1f5f9" },
  posRowImg: { width: "40px", height: "40px", objectFit: "cover", borderRadius: "6px" },
  posRowTitle: { fontSize: "12px", fontWeight: "700", color: "#1e293b", margin: "0 0 2px 0" },
  posRowSub: { fontSize: "10px", color: "#64748b", margin: 0 },
  posRowPrice: { fontSize: "13px", fontWeight: "800", color: "#0f172a" },
  posRowActions: { display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" },
  deleteRowBtn: { background: "transparent", border: "none", cursor: "pointer", fontSize: "12px" },
  posBillFooter: { borderTop: "2px solid #f1f5f9", padding: "16px", backgroundColor: "#fff", flexShrink: 0 },
  posTotalRow: { display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "800", color: "#0f172a", marginBottom: "12px" },
  posTotalPrice: { color: "#fc8019" },
  posCheckoutBtn: { width: "100%", padding: "14px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "800", fontSize: "14px", cursor: "pointer", textAlign: "center" },

  posRightPane: { flex: 1, backgroundColor: "#f8fafc", padding: "16px", height: "calc(100vh - 65px)", overflowY: "auto", display: "flex", flexDirection: "column", boxSizing: "border-box" },
  posVerticalList: { display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "40px" },
  posListItem: { backgroundColor: "#ffffff", borderRadius: "12px", padding: "10px 14px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.02)" },
  posListImg: { width: "48px", height: "48px", objectFit: "cover", borderRadius: "8px" },
  posListTitle: { fontSize: "13px", fontWeight: "700", color: "#1e293b", margin: "0 0 2px 0" },
  posListStock: { fontSize: "10px", color: "#64748b", margin: "0 0 2px 0" },
  posListPrice: { fontSize: "14px", fontWeight: "800", color: "#0f172a" },
  posListAddBtn: { padding: "6px 14px", backgroundColor: "#fff7ed", color: "#fc8019", border: "1px solid #fed7aa", borderRadius: "6px", fontWeight: "800", fontSize: "12px", cursor: "pointer" },
  posListQtyControl: { display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "6px", padding: "2px 8px", width: "80px" },
  posListQtyBtn: { border: "none", background: "transparent", fontWeight: "800", color: "#fc8019", cursor: "pointer", fontSize: "13px" },
  posListQtyVal: { fontSize: "13px", fontWeight: "800", color: "#1e293b" },

  sectionTitle: { fontSize: "17px", fontWeight: "800", color: "#0f172a", marginBottom: "12px" },
  categoryScroll: { display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "8px", marginBottom: "16px", flexShrink: 0 },
  categoryCard: { padding: "6px 14px", borderRadius: "18px", cursor: "pointer", fontWeight: "700", fontSize: "12px", whiteSpace: "nowrap", border: "1px solid #e2e8f0" },
  productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "14px" },
  productCard: { backgroundColor: "#ffffff", borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column" },
  imageWrapper: { position: "relative", height: "130px", width: "100%" },
  productImg: { width: "100%", height: "100%", objectFit: "cover" },
  stockBadge: { position: "absolute", bottom: "6px", left: "6px", backgroundColor: "rgba(0, 0, 0, 0.75)", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "700" },
  productDetails: { padding: "10px", display: "flex", flexDirection: "column", gap: "4px", flex: 1, justifyContent: "space-between" },
  productName: { fontSize: "13px", fontWeight: "700", color: "#1e293b", margin: 0 },
  productCategory: { fontSize: "10px", color: "#64748b", margin: 0 },
  addBillBtn: { width: "100%", padding: "6px", backgroundColor: "#fff7ed", color: "#fc8019", border: "1px solid #fed7aa", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  
  floatingBar: { position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", backgroundColor: "#fc8019", color: "#fff", padding: "12px 24px", borderRadius: "30px", display: "flex", justifyContent: "space-between", alignItems: "center", width: "90%", maxWidth: "500px", boxShadow: "0 10px 25px rgba(252, 128, 25, 0.4)", cursor: "pointer", zIndex: 999 },
  editCardBtn: { flex: 1, padding: "6px", backgroundColor: "#e0e7ff", color: "#4f46e5", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  deleteCardBtn: { flex: 1, padding: "6px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  cartControls: { display: "flex", alignItems: "center", gap: "4px", backgroundColor: "#f1f5f9", padding: "2px 4px", borderRadius: "6px" },
  qtyBtn: { border: "none", background: "transparent", fontWeight: "800", cursor: "pointer", color: "#fc8019", fontSize: "11px" },
  qtyText: { fontSize: "11px", fontWeight: "700", color: "#1e293b" },
  printBillBtn: { padding: "6px 12px", backgroundColor: "#f1f5f9", color: "#1e293b", border: "1px solid #cbd5e1", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "12px" },
  centerBox: { gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#64748b", fontWeight: "600", fontSize: "14px" },
  addNewBtn: { padding: "8px 16px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" },
  
  // Profile Row Styling
  profileRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px solid #f1f5f9" },
  profileLabel: { fontSize: "13px", fontWeight: "700", color: "#64748b" },
  profileValue: { fontSize: "14px", fontWeight: "800", color: "#0f172a" },

// Payment Cards Grid
  paymentCardsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "4px" },
  paymentCardOption: { padding: "12px", borderRadius: "10px", border: "2px solid #cbd5e1", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", cursor: "pointer", transition: "all 0.2s" },

  // QR Container
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