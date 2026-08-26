// src/screens/Inventory.jsx
import React, { useState, useEffect } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  
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

    // Real-time listener for user's inventory
    const inventoryRef = collection(db, "users", currentUid, "inventory");
    const unsubscribe = onSnapshot(inventoryRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setItems(data);
      setLoading(false);
    }, (error) => {
      console.error("Inventory error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleOpenAddModal = () => {
    setCurrentItemId(null);
    setItemName("");
    setCategory("");
    setBrand("");
    setSalesPrice("");
    setQuantity("");
    setImage("");
    setModalVisible(true);
  };

  const handleOpenEditModal = (item) => {
    setCurrentItemId(item.id);
    setItemName(item.itemName || item.name || "");
    setCategory(item.category || "");
    setBrand(item.brand || "");
    setSalesPrice(String(item.salesPrice || item.price || ""));
    setQuantity(String(item.quantity || "0"));
    setImage(item.image || "");
    setModalVisible(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      const inventoryRef = collection(db, "users", currentUid, "inventory");
      const productData = {
        itemName: itemName.trim(),
        category: category.trim() || "General",
        brand: brand.trim() || "No Brand",
        salesPrice: Number(salesPrice) || 0,
        quantity: Number(quantity) || 0,
        image: image.trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"
      };

      if (currentItemId) {
        // Update existing item
        await updateDoc(doc(db, "users", currentUid, "inventory", currentItemId), productData);
      } else {
        // Add new item
        await addDoc(inventoryRef, productData);
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

    if (window.ensure || window.confirm("Are you sure you want to delete this product?")) {
      try {
        await deleteDoc(doc(db, "users", currentUid, "inventory", id));
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
          <h2 style={styles.title}>📦 Store Inventory</h2>
          <p style={styles.subtitle}>Manage your products, prices, and stock levels</p>
        </div>
        <button onClick={handleOpenAddModal} style={styles.addBtn}>+ Add New Product</button>
      </div>

      {/* Search Bar */}
      <div style={styles.searchContainer}>
        <input 
          type="text"
          placeholder="Search products by name, brand or category..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {/* Products List / Grid */}
      {loading ? (
        <div style={styles.centerBox}>Loading inventory items...</div>
      ) : filteredItems.length === 0 ? (
        <div style={styles.centerBox}>No products found in your inventory ❌</div>
      ) : (
        <div style={styles.grid}>
          {filteredItems.map((item) => {
            const name = item.itemName || item.name || "Unnamed";
            const price = item.salesPrice || item.price || 0;
            const stock = item.quantity || 0;
            const img = item.image || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";

            return (
              <div key={item.id} style={styles.card}>
                <div style={styles.imgBox}>
                  <img src={img} alt={name} style={styles.img} />
                  <span style={{ ...styles.stockTag, backgroundColor: stock <= 5 ? "#ef4444" : "#10b981" }}>
                    Stock: {stock}
                  </span>
                </div>
                <div style={styles.cardBody}>
                  <h4 style={styles.productName}>{name}</h4>
                  <p style={styles.productMeta}>{item.category || "General"} {item.brand ? `• ${item.brand}` : ""}</p>
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
            <h3>{currentItemId ? "Edit Product" : "Add New Product"}</h3>
            <form onSubmit={handleSaveItem} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Product Name</label>
                <input 
                  type="text" 
                  value={itemName} 
                  onChange={(e) => setItemName(e.target.value)} 
                  style={styles.input} 
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
                  placeholder="e.g. Grocery, Snacks" 
                  required 
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Brand</label>
                <input 
                  type="text" 
                  value={brand} 
                  onChange={(e) => setBrand(e.target.value)} 
                  style={styles.input} 
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
                  <label style={styles.label}>Quantity / Stock</label>
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
                <button type="submit" style={styles.saveBtn}>Save Product</button>
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
  container: { padding: "30px", maxWidth: "1400px", margin: "0 auto", fontFamily: "system-ui, sans-serif" },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" },
  title: { fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 },
  subtitle: { fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" },
  addBtn: { padding: "10px 20px", backgroundColor: "#fc8019", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" },
  searchContainer: { marginBottom: "24px" },
  searchInput: { width: "100%", padding: "14px 16px", borderRadius: "12px", border: "1.5px solid #cbd5e1", fontSize: "15px", outline: "none", boxSizing: "border-box" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "20px" },
  card: { backgroundColor: "#ffffff", borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", border: "1px solid #f1f5f9" },
  imgBox: { position: "relative", height: "160px", width: "100%" },
  img: { width: "100%", height: "100%", objectFit: "cover" },
  stockTag: { position: "absolute", bottom: "8px", left: "8px", color: "#fff", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" },
  cardBody: { padding: "16px", display: "flex", flexDirection: "column", gap: "6px" },
  productName: { fontSize: "16px", fontWeight: "700", color: "#1e293b", margin: 0 },
  productMeta: { fontSize: "13px", color: "#64748b", margin: 0 },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" },
  priceText: { fontSize: "17px", fontWeight: "800", color: "#0f172a" },
  actionBtns: { display: "flex", gap: "6px" },
  editBtn: { padding: "6px 12px", backgroundColor: "#e0e7ff", color: "#4f46e5", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer" },
  deleteBtn: { padding: "6px 12px", backgroundColor: "#fee2e2", color: "#dc2626", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer" },
  centerBox: { textAlign: "center", padding: "60px", color: "#64748b", fontSize: "16px", fontWeight: "600" },
  modalOverlay: { position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modalContent: { backgroundColor: "#fff", padding: "30px", borderRadius: "20px", width: "100%", maxWidth: "450px", boxShadow: "0 20px 25px rgba(0,0,0,0.2)" },
  form: { display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "6px", flex: 1 },
  rowInputs: { display: "flex", gap: "12px" },
  label: { fontSize: "13px", fontWeight: "700", color: "#334155" },
  input: { padding: "12px", borderRadius: "10px", border: "1.5px solid #cbd5e1", fontSize: "14px", outline: "none" },
  modalActions: { display: "flex", gap: "10px", marginTop: "10px" },
  saveBtn: { flex: 1, padding: "12px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" },
  cancelBtn: { flex: 1, padding: "12px", backgroundColor: "#e2e8f0", color: "#334155", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer" }
};