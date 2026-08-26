// src/screens/Dashboard.jsx
import React, { useState, useEffect } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("dashboard"); // "dashboard", "inventory", "wishlist", "cartPage", "orders"
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(["All"]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  
  const [currentBill, setCurrentBill] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [ordersList, setOrdersList] = useState([]);

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

    // 1. Real-time Inventory Listener
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

    // 2. Real-time Orders & Bills Listener
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

  const handleCheckout = async () => {
    if (currentBill.length === 0) return;
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      if (currentUid) {
        const ordersRef = collection(db, "users", currentUid, "local_orders");
        await addDoc(ordersRef, {
          items: currentBill,
          totalAmount: currentBill.reduce((sum, item) => sum + ((item.salesPrice || item.price || 0) * item.qty), 0),
          createdAt: serverTimestamp(),
          status: "Completed"
        });
      }
      setPopupModal({ show: true, message: "Checkout Successful! Order recorded 🎉" });
      setCurrentBill([]);
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
          <h2>KADAI PRO POS</h2>
          <p>Store Billing Receipt</p>
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

  const filteredProducts = products.filter(item => {
    const itemName = item.itemName || item.name || "";
    const itemCat = item.category || "General";
    const matchesSearch = itemName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || itemCat === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div style={styles.appContainer}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.logoArea}>
          <span style={{ fontSize: "28px" }}>🏪</span>
          <h2 style={styles.sidebarBrand}>Kadai Pro</h2>
        </div>
        <div style={styles.navLinks}>
          <button onClick={() => setActiveTab("dashboard")} style={{ ...styles.navBtn, backgroundColor: activeTab === "dashboard" ? "#ffedd5" : "transparent", color: activeTab === "dashboard" ? "#fc8019" : "#64748b" }}>
            🏠 Dashboard (POS)
          </button>
          <button onClick={() => setActiveTab("inventory")} style={{ ...styles.navBtn, backgroundColor: activeTab === "inventory" ? "#ffedd5" : "transparent", color: activeTab === "inventory" ? "#fc8019" : "#64748b" }}>
            📦 Store Inventory
          </button>
          <button onClick={() => setActiveTab("wishlist")} style={{ ...styles.navBtn, backgroundColor: activeTab === "wishlist" ? "#ffedd5" : "transparent", color: activeTab === "wishlist" ? "#fc8019" : "#64748b" }}>
            ❤️ Wishlist ({wishlist.length})
          </button>
          <button onClick={() => setActiveTab("orders")} style={{ ...styles.navBtn, backgroundColor: activeTab === "orders" ? "#ffedd5" : "transparent", color: activeTab === "orders" ? "#fc8019" : "#64748b" }}>
            📋 Orders & Bills ({ordersList.length})
          </button>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
      </div>

      {/* Main Content */}
      <div style={styles.mainContent}>
        <header style={styles.navbar}>
          <div style={styles.searchBarContainer}>
            <span style={styles.searchIcon}>🔍</span>
            <input 
              type="text"
              placeholder="Search products, brand, category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>
          <div style={styles.navRight}>
            <button onClick={() => setActiveTab("cartPage")} style={styles.navbarCartBtn}>
              🛒 Cart ({cartItems.reduce((a, c) => a + c.qty, 0)})
            </button>
          </div>
        </header>

        {/* TAB 1: DASHBOARD (POS) */}
        {activeTab === "dashboard" && (
          <div style={styles.mainLayout}>
            <div style={styles.contentArea}>
              <h2 style={styles.sectionTitle}>Shop Categories</h2>
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

              <h2 style={styles.sectionTitle}>Available Products ({filteredProducts.length})</h2>

              {loading ? (
                <div style={styles.centerBox}>Loading products...</div>
              ) : filteredProducts.length === 0 ? (
                <div style={styles.centerBox}>No products found in inventory ❌</div>
              ) : (
                <div style={styles.productGrid}>
                  {filteredProducts.map((item) => {
                    const itemName = item.itemName || item.name || "Unnamed Item";
                    const priceVal = item.salesPrice || item.price || 0;
                    const stock = item.quantity || 0;
                    const imageVal = item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
                    const isLiked = wishlist.some(w => w.id === item.id);
                    
                    return (
                      <div key={item.id} style={styles.productCard}>
                        <div style={styles.imageWrapper}>
                          <img src={imageVal} alt={itemName} style={styles.productImg} />
                          <span style={styles.stockBadge}>Stock: {stock}</span>
                          <button onClick={() => toggleWishlist(item)} style={styles.likeBtn}>
                            {isLiked ? "❤️" : "🤍"}
                          </button>
                        </div>
                        <div style={styles.productDetails}>
                          <h4 style={styles.productName}>{itemName}</h4>
                          <p style={styles.productCategory}>{item.category || "General"} {item.brand ? `• ${item.brand}` : ""}</p>
                          <div style={styles.priceRow}>
                            <span style={styles.productPrice}>₹{priceVal}</span>
                            <div style={styles.cardBtnGroup}>
                              <button onClick={() => addToCurrentBill({ ...item, name: itemName, price: priceVal })} style={styles.addBillBtn}>+ Add</button>
                              <button onClick={() => addToCart({ ...item, name: itemName, price: priceVal })} style={styles.addCartBtn}>Add to Cart</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Current Bill Sidebar */}
            <div style={styles.cartSidebar}>
              <h3 style={styles.cartTitle}>🛍️ Current Bill / POS</h3>
              {currentBill.length === 0 ? (
                <div style={styles.emptyCart}>
                  <p>No items added to current bill</p>
                  <span style={{ fontSize: "32px" }}>🧾</span>
                </div>
              ) : (
                <div style={styles.cartItemsList}>
                  {currentBill.map((item) => (
                    <div key={item.id} style={styles.cartItemRow}>
                      <div style={{ flex: 1 }}>
                        <h5 style={styles.cartItemName}>{item.name}</h5>
                        <span style={styles.cartItemPrice}>₹{item.price} x {item.qty}</span>
                      </div>
                      <div style={styles.cartControls}>
                        <button onClick={() => removeFromCurrentBill(item.id)} style={styles.qtyBtn}>-</button>
                        <span style={styles.qtyText}>{item.qty}</span>
                        <button onClick={() => addToCurrentBill(item)} style={styles.qtyBtn}>+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={styles.cartFooter}>
                <div style={styles.totalRow}>
                  <span>Total Amount:</span>
                  <span style={styles.totalPrice}>₹{totalBillAmount}</span>
                </div>
                <button 
                  style={{ ...styles.checkoutBtn, opacity: currentBill.length === 0 ? 0.5 : 1 }} 
                  disabled={currentBill.length === 0}
                  onClick={handleCheckout}
                >
                  Complete Sale / Checkout
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STORE INVENTORY */}
        {activeTab === "inventory" && (
          <div style={{ padding: "30px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>📦 Store Inventory Management</h2>
              <button onClick={openAddModal} style={styles.addNewBtn}>+ Add New Product</button>
            </div>

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

            <div style={styles.productGrid}>
              {products.filter(i => selectedCategory === "All" || (i.category || "General") === selectedCategory).map((item) => {
                const itemName = item.itemName || item.name || "Unnamed";
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
                      <p style={styles.productCategory}>{item.category || "General"} • ₹{priceVal}</p>
                      
                      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                        <button onClick={() => openEditModal(item)} style={styles.editCardBtn}>✏️ Edit</button>
                        <button onClick={() => handleDeleteProduct(item.id)} style={styles.deleteCardBtn}>🗑️ Delete</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: CART PAGE */}
        {activeTab === "cartPage" && (
          <div style={{ padding: "40px", maxWidth: "900px", margin: "0 auto", width: "100%" }}>
            <h2 style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>🛒 My Shopping Cart ({cartItems.reduce((a, c) => a + c.qty, 0)})</h2>
            {cartItems.length === 0 ? (
              <div style={styles.centerBox}>Your cart is empty. Add products using "Add to Cart" button!</div>
            ) : (
              <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                {cartItems.map((item) => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                      <img src={item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={item.name} style={{ width: "60px", height: "60px", objectFit: "cover", borderRadius: "10px" }} />
                      <div>
                        <h4 style={{ margin: 0, fontSize: "16px", color: "#1e293b" }}>{item.name}</h4>
                        <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>₹{item.price} each</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={styles.cartControls}>
                        <button onClick={() => removeFromCart(item.id)} style={styles.qtyBtn}>-</button>
                        <span style={styles.qtyText}>{item.qty}</span>
                        <button onClick={() => addToCart(item)} style={styles.qtyBtn}>+</button>
                      </div>
                      <span style={{ fontWeight: "800", fontSize: "16px", color: "#0f172a", minWidth: "70px", textAlign: "right" }}>₹{item.price * item.qty}</span>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "24px", paddingTop: "16px", borderTop: "2px solid #e2e8f0" }}>
                  <span style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>Total Cart Value: ₹{totalCartAmount}</span>
                  <button onClick={() => { setPopupModal({ show: true, message: "Cart Order Placed Successfully! 🎉" }); setCartItems([]); }} style={{ padding: "12px 28px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer", fontSize: "15px" }}>
                    Proceed to Checkout
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: WISHLIST */}
        {activeTab === "wishlist" && (
          <div style={{ padding: "30px" }}>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>❤️ Liked Products (Wishlist)</h2>
            {wishlist.length === 0 ? (
              <div style={styles.centerBox}>Your wishlist is empty. Like products to save them here!</div>
            ) : (
              <div style={styles.productGrid}>
                {wishlist.map((item) => (
                  <div key={item.id} style={styles.productCard}>
                    <div style={styles.imageWrapper}>
                      <img src={item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={item.name} style={styles.productImg} />
                    </div>
                    <div style={styles.productDetails}>
                      <h4 style={styles.productName}>{item.itemName || item.name}</h4>
                      <p style={styles.productCategory}>₹{item.salesPrice || item.price || 0}</p>
                      <button onClick={() => addToCart(item)} style={styles.addCartBtn}>+ Add to Cart</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: ORDERS & BILLS HISTORY */}
        {activeTab === "orders" && (
          <div style={{ padding: "30px", maxWidth: "1000px", margin: "0 auto", width: "100%" }}>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>📋 Orders & Billing History</h2>
            {ordersList.length === 0 ? (
              <div style={styles.centerBox}>No orders or bills recorded yet. Complete a sale from the dashboard!</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {ordersList.map((order, idx) => {
                  const orderDate = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleString() : "Just now";
                  const itemsCount = (order.items || []).reduce((sum, i) => sum + i.qty, 0);

                  return (
                    <div 
                      key={order.id || idx} 
                      onClick={() => setSelectedOrderDetails(order)}
                      style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", transition: "all 0.2s" }}
                    >
                      <div>
                        <h4 style={{ margin: "0 0 6px 0", fontSize: "16px", color: "#1e293b" }}>Order ID: #{order.id.slice(-6).toUpperCase()}</h4>
                        <p style={{ margin: "0 0 4px 0", fontSize: "12px", color: "#94a3b8" }}>📅 {orderDate}</p>
                        <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                          Items count: {itemsCount} | Total: <strong style={{ color: "#fc8019" }}>₹{order.totalAmount}</strong>
                        </p>
                        <span style={{ display: "inline-block", marginTop: "8px", backgroundColor: "#dcfce7", color: "#16a34a", padding: "2px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "700" }}>{order.status || "Completed"}</span>
                      </div>
                      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <button onClick={(e) => { e.stopPropagation(); handlePrintBill(order); }} style={styles.printBillBtn}>🖨️ Print Bill</button>
                        <span style={{ color: "#cbd5e1", fontSize: "18px" }}>›</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* BILL DETAILS POPUP MODAL (RECEIPT VIEW ON CLICK) */}
      {selectedOrderDetails && (
        <div style={styles.modalOverlay} onClick={() => setSelectedOrderDetails(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "450px" }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: "center", borderBottom: "2px dashed #cbd5e1", paddingBottom: "14px", marginBottom: "14px" }}>
              <h3 style={{ margin: 0, color: "#1e3a8a", fontSize: "20px" }}>KADAI PRO POS</h3>
              <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "13px" }}>Store Billing Receipt</p>
              <p style={{ margin: "4px 0 0 0", color: "#94a3b8", fontSize: "11px" }}>
                📅 {selectedOrderDetails.createdAt?.toDate ? selectedOrderDetails.createdAt.toDate().toLocaleString() : "Recent"}
              </p>
            </div>

            <div style={{ maxHeight: "250px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
              {(selectedOrderDetails.items || []).map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                  <div>
                    <strong style={{ color: "#1e293b" }}>{item.name || item.itemName}</strong>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>Qty: {item.qty} x ₹{item.price || item.salesPrice || 0}</div>
                  </div>
                  <span style={{ fontWeight: "800", color: "#0f172a" }}>₹{(item.price || item.salesPrice || 0) * item.qty}</span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: "2px dashed #cbd5e1", paddingTop: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "18px", fontWeight: "800", color: "#0f172a", marginBottom: "20px" }}>
              <span>Total Amount:</span>
              <span style={{ color: "#fc8019" }}>₹{selectedOrderDetails.totalAmount}</span>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => handlePrintBill(selectedOrderDetails)} style={{ flex: 1, padding: "12px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }}>
                🖨️ Print Receipt
              </button>
              <button onClick={() => setSelectedOrderDetails(null)} style={{ flex: 1, padding: "12px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM SUCCESS POPUP MODAL */}
      {popupModal.show && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, textAlign: "center", maxWidth: "360px" }}>
            <span style={{ fontSize: "40px" }}>🎉</span>
            <h3 style={{ margin: "14px 0", color: "#1e293b" }}>Success</h3>
            <p style={{ color: "#64748b", fontSize: "15px", marginBottom: "20px" }}>{popupModal.message}</p>
            <button onClick={() => setPopupModal({ show: false, message: "" })} style={{ width: "100%", padding: "12px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }}>
              OK
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
              <input type="text" placeholder="Category (e.g. Snacks, Grocery)" value={category} onChange={e => setCategory(e.target.value)} style={styles.modalInput} required />
              <input type="number" placeholder="Sales Price (₹)" value={price} onChange={e => setPrice(e.target.value)} style={styles.modalInput} required />
              <input type="number" placeholder="Quantity / Stock" value={qty} onChange={e => setQty(e.target.value)} style={styles.modalInput} required />
              <input type="text" placeholder="Brand Name" value={brand} onChange={e => setBrand(e.target.value)} style={styles.modalInput} />
              
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "13px", fontWeight: "700", color: "#334155" }}>Product Photo / DP</label>
                <input type="file" accept="image/*" onChange={handleImageChange} style={{ fontSize: "13px" }} />
                {image && <img src={image} alt="Preview" style={{ width: "50px", height: "50px", borderRadius: "8px", objectFit: "cover", marginTop: "4px" }} />}
              </div>

              <div style={styles.modalBtns}>
                <button type="submit" style={styles.saveModalBtn}>{isEditing ? "Update Product" : "Save Product"}</button>
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
  appContainer: { display: "flex", minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "system-ui, sans-serif" },
  sidebar: { width: "260px", backgroundColor: "#ffffff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", padding: "24px", position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" },
  logoArea: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "30px" },
  sidebarBrand: { fontSize: "22px", fontWeight: "800", color: "#1e3a8a", margin: 0 },
  navLinks: { display: "flex", flexDirection: "column", gap: "10px", flex: 1 },
  navBtn: { padding: "12px 16px", border: "none", borderRadius: "12px", textAlign: "left", fontWeight: "700", fontSize: "15px", cursor: "pointer", transition: "all 0.2s" },
  logoutBtn: { padding: "12px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "12px", fontWeight: "700", cursor: "pointer" },
  mainContent: { flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto" },
  navbar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 32px", backgroundColor: "#ffffff", borderBottom: "1px solid #e2e8f0", position: "sticky", top: 0, zIndex: 100 },
  searchBarContainer: { display: "flex", alignItems: "center", backgroundColor: "#f1f5f9", padding: "10px 16px", borderRadius: "12px", width: "45%", gap: "10px" },
  searchIcon: { fontSize: "16px" },
  searchInput: { border: "none", background: "transparent", outline: "none", width: "100%", fontSize: "14px", color: "#1e293b" },
  navRight: { display: "flex", alignItems: "center", gap: "20px" },
  navbarCartBtn: { fontWeight: "700", color: "#1e3a8a", fontSize: "15px", backgroundColor: "#eff6ff", padding: "10px 18px", borderRadius: "12px", border: "1.5px solid #bfdbfe", cursor: "pointer" },
  mainLayout: { display: "flex", flex: 1, padding: "24px", gap: "24px", boxSizing: "border-box" },
  contentArea: { flex: 1 },
  sectionTitle: { fontSize: "18px", fontWeight: "800", color: "#0f172a", marginBottom: "14px" },
  categoryScroll: { display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "12px", marginBottom: "20px" },
  categoryCard: { padding: "8px 18px", borderRadius: "20px", cursor: "pointer", fontWeight: "700", fontSize: "13px", whiteSpace: "nowrap", border: "1px solid #e2e8f0" },
  productGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "18px" },
  productCard: { backgroundColor: "#ffffff", borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column" },
  imageWrapper: { position: "relative", height: "140px", width: "100%" },
  productImg: { width: "100%", height: "100%", objectFit: "cover" },
  stockBadge: { position: "absolute", bottom: "8px", left: "8px", backgroundColor: "rgba(0, 0, 0, 0.75)", color: "#fff", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" },
  likeBtn: { position: "absolute", top: "8px", right: "8px", backgroundColor: "#fff", border: "none", borderRadius: "50%", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" },
  productDetails: { padding: "12px", display: "flex", flexDirection: "column", gap: "6px", flex: 1, justifyContent: "space-between" },
  productName: { fontSize: "14px", fontWeight: "700", color: "#1e293b", margin: 0 },
  productCategory: { fontSize: "11px", color: "#64748b", margin: 0 },
  priceRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" },
  productPrice: { fontSize: "15px", fontWeight: "800", color: "#0f172a" },
  cardBtnGroup: { display: "flex", gap: "6px" },
  addBillBtn: { padding: "6px 10px", backgroundColor: "#fff7ed", color: "#fc8019", border: "1px solid #fed7aa", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "12px" },
  addCartBtn: { padding: "6px 10px", backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "12px" },
  editCardBtn: { flex: 1, padding: "6px 10px", backgroundColor: "#e0e7ff", color: "#4f46e5", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "12px" },
  deleteCardBtn: { flex: 1, padding: "6px 10px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "12px" },
  cartSidebar: { width: "340px", backgroundColor: "#ffffff", borderRadius: "20px", padding: "20px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", position: "sticky", top: "80px" },
  cartTitle: { fontSize: "17px", fontWeight: "800", color: "#0f172a", marginBottom: "14px", borderBottom: "2px solid #f1f5f9", paddingBottom: "10px" },
  emptyCart: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "#94a3b8", gap: "8px" },
  cartItemsList: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" },
  cartItemRow: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px", borderBottom: "1px solid #f8fafc" },
  cartItemName: { fontSize: "13px", fontWeight: "700", color: "#1e293b", margin: "0 0 2px 0" },
  cartItemPrice: { fontSize: "11px", color: "#64748b" },
  cartControls: { display: "flex", alignItems: "center", gap: "6px", backgroundColor: "#f1f5f9", padding: "3px 6px", borderRadius: "6px" },
  qtyBtn: { border: "none", background: "transparent", fontWeight: "800", cursor: "pointer", color: "#fc8019" },
  qtyText: { fontSize: "12px", fontWeight: "700", color: "#1e293b" },
  cartFooter: { borderTop: "2px solid #f1f5f9", paddingTop: "14px", marginTop: "10px" },
  totalRow: { display: "flex", justifyContent: "space-between", fontSize: "15px", fontWeight: "800", color: "#0f172a", marginBottom: "12px" },
  totalPrice: { color: "#fc8019" },
  checkoutBtn: { width: "100%", padding: "12px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "800", fontSize: "14px", cursor: "pointer" },
  printBillBtn: { padding: "8px 16px", backgroundColor: "#f1f5f9", color: "#1e293b", border: "1px solid #cbd5e1", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" },
  centerBox: { gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#64748b", fontWeight: "600" },
  addNewBtn: { padding: "10px 18px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" },
  modalOverlay: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modalBox: { backgroundColor: "#fff", padding: "30px", borderRadius: "20px", width: "100%", maxWidth: "420px", boxShadow: "0 20px 25px rgba(0,0,0,0.2)" },
  modalForm: { display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" },
  modalInput: { padding: "12px", borderRadius: "10px", border: "1.5px solid #cbd5e1", fontSize: "14px", outline: "none" },
  modalBtns: { display: "flex", gap: "10px", marginTop: "10px" },
  saveModalBtn: { flex: 1, padding: "12px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" },
  cancelModalBtn: { flex: 1, padding: "12px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }
};