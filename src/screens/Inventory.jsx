// src/screens/Inventory.jsx
import React, { useState, useEffect } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  
  // Restaurant Mode Detection
  const [shopType, setShopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant = (shopType || "").trim().toLowerCase() === "restaurant";

  // Form states for Add/Edit
  const [currentItemId, setCurrentItemId] = useState(null);
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [image, setImage] = useState("");

  useEffect(() => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      setLoading(false);
      return;
    }

    // Check user profile for shopType
    const checkType = async () => {
      try {
        const uDoc = await getDoc(doc(db, "users", currentUid));
        if (uDoc.exists()) {
          const d = uDoc.data();
          const st = (d.shopType || d.shop_type || d.businessType || "").trim();
          if (st) {
            setShopType(st);
            localStorage.setItem("shop_type", st);
          }
        }
      } catch (e) {
        console.warn("Could not check shop type:", e);
      }
    };
    checkType();

    // Real-time listener for user's inventory or restaurant_menu
    const colName = isRestaurant ? "restaurant_menu" : "inventory";
    const itemsRef = collection(db, "users", currentUid, colName);
    const unsubscribe = onSnapshot(itemsRef, (snapshot) => {
      const data = snapshot.docs.map(docSnap => {
        const docData = docSnap.data();
        const pName = docData.name || docData.itemName || "Unnamed";
        const price = Number(docData.price ?? docData.salesPrice ?? 0);
        const img = docData.imageUrl || docData.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
        const isAvail = docData.isAvailable !== false;
        const qty = docData.quantity !== undefined ? docData.quantity : (isAvail ? "In Stock" : "Out of Stock");

        return {
          id: docSnap.id,
          ...docData,
          name: pName,
          itemName: pName,
          price: price,
          salesPrice: price,
          image: img,
          imageUrl: img,
          category: docData.category || (isRestaurant ? "Main Course" : "General"),
          quantity: qty,
          isAvailable: isAvail,
          brand: docData.brand || ""
        };
      });
      setItems(data);
      setLoading(false);
    }, (error) => {
      console.error("Inventory error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isRestaurant]);

  const handleOpenAddModal = () => {
    setCurrentItemId(null);
    setItemName("");
    setCategory(isRestaurant ? "Main Course" : "General");
    setBrand("");
    setSalesPrice("");
    setQuantity(isRestaurant ? "100" : "");
    setImage("");
    setModalVisible(true);
  };

  const handleOpenEditModal = (item) => {
    setCurrentItemId(item.id);
    setItemName(item.itemName || item.name || "");
    setCategory(item.category || (isRestaurant ? "Main Course" : "General"));
    setBrand(item.brand || "");
    setSalesPrice(String(item.salesPrice ?? item.price ?? ""));
    setQuantity(String(item.quantity ?? "0"));
    setImage(item.image || item.imageUrl || "");
    setModalVisible(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      const colName = isRestaurant ? "restaurant_menu" : "inventory";
      const targetRef = collection(db, "users", currentUid, colName);
      const productData = {
        name: itemName.trim(),
        itemName: itemName.trim(),
        category: category.trim() || (isRestaurant ? "Main Course" : "General"),
        brand: brand.trim() || (isRestaurant ? "" : "No Brand"),
        salesPrice: Number(salesPrice) || 0,
        price: Number(salesPrice) || 0,
        quantity: isNaN(Number(quantity)) ? 100 : Number(quantity),
        isAvailable: true,
        image: image.trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        imageUrl: image.trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"
      };

      if (currentItemId) {
        // Update existing item
        await updateDoc(doc(db, "users", currentUid, colName, currentItemId), productData);
      } else {
        // Add new item
        await addDoc(targetRef, productData);
      }

      setModalVisible(false);
    } catch (err) {
      console.error("Error saving product:", err);
      alert("Error saving item: " + err.message);
    }
  };

  const handleDeleteItem = async (id) => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    const label = isRestaurant ? "food item" : "product";
    if (window.confirm(`Are you sure you want to delete this ${label}?`)) {
      try {
        const colName = isRestaurant ? "restaurant_menu" : "inventory";
        await deleteDoc(doc(db, "users", currentUid, colName, id));
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const filteredItems = items.filter(item => {
    const name = item.itemName || item.name || "";
    const cat = item.category || "";
    const brd = item.brand || "";
    const q = searchQuery.toLowerCase();
    return name.toLowerCase().includes(q) || cat.toLowerCase().includes(q) || brd.toLowerCase().includes(q);
  });

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>{isRestaurant ? "🍽️ Restaurant Menu" : "📦 Store Inventory"}</h2>
          <p style={styles.subtitle}>{isRestaurant ? "Manage your food items, prices, and availability" : "Manage your products, prices, and stock levels"}</p>
        </div>
        <button onClick={handleOpenAddModal} style={styles.addBtn}>{isRestaurant ? "+ Add New Food" : "+ Add New Product"}</button>
      </div>

      {/* Search Bar */}
      <div style={styles.searchContainer}>
        <input 
          type="text"
          placeholder={isRestaurant ? "Search foods by name or category..." : "Search products by name, brand or category..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {/* Products List / Grid */}
      {loading ? (
        <div style={styles.centerBox}>{isRestaurant ? "Loading food menu..." : "Loading inventory items..."}</div>
      ) : filteredItems.length === 0 ? (
        <div style={styles.centerBox}>{isRestaurant ? "No food items found in menu ❌" : "No products found in your inventory ❌"}</div>
      ) : (
        <div style={styles.grid}>
          {filteredItems.map((item) => {
            const name = item.itemName || item.name || "Unnamed";
            const price = item.salesPrice || item.price || 0;
            const stock = item.quantity !== undefined ? item.quantity : (item.isAvailable !== false ? "In Stock" : "Unavailable");
            const img = item.image || item.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";

            return (
              <div key={item.id} style={styles.card}>
                <div style={styles.imgBox}>
                  <img 
                    src={img} 
                    alt={name} 
                    style={styles.img} 
                    onError={(e) => { e.target.onerror = null; e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"; }}
                  />
                  <span style={{ ...styles.stockTag, backgroundColor: (typeof stock === "number" && stock <= 5) ? "#ef4444" : "#10b981" }}>
                    Stock: {stock}
                  </span>
                </div>
                <div style={styles.cardBody}>
                  <h4 style={styles.productName}>{name}</h4>
                  <p style={styles.productMeta}>{item.category || (isRestaurant ? "Main Course" : "General")} {item.brand ? `• ${item.brand}` : ""}</p>
                  <div style={styles.cardFooter}>
                    <span style={styles.priceText}>₹{price}</span>
                    <div style={styles.actionBtns}>
                      <button onClick={() => handleOpenEditModal(item)} style={styles.editBtn}>Edit</button>
                      <button onClick={() => handleDeleteItem(item.id)} style={styles.deleteBtn}>Delete</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalVisible && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h3>{isRestaurant ? (currentItemId ? "Edit Food Item" : "Add New Food") : (currentItemId ? "Edit Product" : "Add New Product")}</h3>
            <form onSubmit={handleSaveItem} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>{isRestaurant ? "Food Name" : "Product Name"}</label>
                <input 
                  type="text" 
                  value={itemName} 
                  onChange={(e) => setItemName(e.target.value)} 
                  style={styles.input} 
                  placeholder={isRestaurant ? "e.g. Chicken Biryani, Butter Naan" : "Product Name"}
                  required 
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Category</label>
                <input 
                  type="text" 
                  value={category} 
                  onChange={(e) => setCategory(e.target.value)} 
                  style={styles.input} 
                  placeholder={isRestaurant ? "e.g. Starters, Main Course, Desserts" : "e.g. Grocery, Snacks"} 
                  required 
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>{isRestaurant ? "Serving / Diet Notes (Optional)" : "Brand"}</label>
                <input 
                  type="text" 
                  value={brand} 
                  onChange={(e) => setBrand(e.target.value)} 
                  style={styles.input} 
                  placeholder={isRestaurant ? "e.g. Spicy, Veg, Non-Veg" : "Brand Name"}
                />
              </div>
              <div style={styles.rowInputs}>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Sales Price (₹)</label>
                  <input 
                    type="number" 
                    value={salesPrice} 
                    onChange={(e) => setSalesPrice(e.target.value)} 
                    style={styles.input} 
                    required 
                  />
                </div>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>{isRestaurant ? "Available Stock / Portions" : "Quantity / Stock"}</label>
                  <input 
                    type="number" 
                    value={quantity} 
                    onChange={(e) => setQuantity(e.target.value)} 
                    style={styles.input} 
                    required 
                  />
                </div>
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Image URL (Optional)</label>
                <input 
                  type="text" 
                  value={image} 
                  onChange={(e) => setImage(e.target.value)} 
                  style={styles.input} 
                  placeholder="https://..." 
                />
              </div>

              <div style={styles.modalActions}>
                <button type="submit" style={styles.saveBtn}>{isRestaurant ? "Save Food" : "Save Product"}</button>
                <button type="button" onClick={() => setModalVisible(false)} style={styles.cancelBtn}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { padding: window.innerWidth <= 768 ? "14px" : "24px", maxWidth: "1400px", margin: "0 auto", fontFamily: "system-ui, sans-serif", boxSizing: "border-box" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" },
  title: { fontSize: "20px", fontWeight: "800", color: "#0f172a", margin: 0 },
  subtitle: { fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" },
  addBtn: { padding: "8px 16px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px", whiteSpace: "nowrap" },
  searchContainer: { marginBottom: "18px" },
  searchInput: { width: "100%", padding: "12px 14px", borderRadius: "10px", border: "1.5px solid #cbd5e1", fontSize: "14px", outline: "none", boxSizing: "border-box" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "14px" },
  card: { backgroundColor: "#ffffff", borderRadius: "14px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column" },
  imgBox: { position: "relative", height: "140px", width: "100%" },
  img: { width: "100%", height: "100%", objectFit: "cover" },
  stockTag: { position: "absolute", bottom: "6px", left: "6px", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "700" },
  cardBody: { padding: "12px", display: "flex", flexDirection: "column", gap: "4px", flex: 1, justifyContent: "space-between" },
  productName: { fontSize: "14px", fontWeight: "700", color: "#1e293b", margin: 0 },
  productMeta: { fontSize: "12px", color: "#64748b", margin: 0 },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", flexWrap: "wrap", gap: "6px" },
  priceText: { fontSize: "15px", fontWeight: "800", color: "#0f172a" },
  actionBtns: { display: "flex", gap: "4px", width: "100%" },
  editBtn: { flex: 1, padding: "6px 8px", backgroundColor: "#e0e7ff", color: "#4f46e5", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  deleteBtn: { flex: 1, padding: "6px 8px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "11px", textAlign: "center" },
  centerBox: { textAlign: "center", padding: "40px", color: "#64748b", fontSize: "14px", fontWeight: "600" },
  modalOverlay: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "16px", boxSizing: "border-box" },
  modalContent: { backgroundColor: "#fff", padding: "20px", borderRadius: "16px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 25px rgba(0,0,0,0.2)", boxSizing: "border-box", maxHeight: "90vh", overflowY: "auto" },
  form: { display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "4px", flex: 1 },
  rowInputs: { display: "flex", gap: "10px", flexDirection: window.innerWidth <= 480 ? "column" : "row" },
  label: { fontSize: "12px", fontWeight: "700", color: "#334155" },
  input: { padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" },
  modalActions: { display: "flex", gap: "8px", marginTop: "8px" },
  saveBtn: { flex: 1, padding: "10px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" },
  cancelBtn: { flex: 1, padding: "10px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "8px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }
};