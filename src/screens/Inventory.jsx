import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import {
  canAddInventoryItem,
  countProductsForTerminalLimit,
  resolveTerminalSubscription,
} from "../utils/subscriptionService";
import { logWasteRecord, WASTE_REASONS } from "../utils/wasteService";
import {
  INVENTORY_MODES,
  filterProductsForCatalog,
  getShopInventoryMode,
  subscribeFloors,
  subscribeTerminals,
} from "../utils/terminalService";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("uid")));
  const [searchQuery, setSearchQuery] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  
  // Restaurant Mode Detection
  const [shopType, setShopType] = useState(() => localStorage.getItem("shop_type") || "");
  const isRestaurant = (shopType || "").trim().toLowerCase() === "restaurant";
  const isMedical = (shopType || "").trim().toLowerCase() === "medical";

  // Shop Mode: Local vs Global
  const [appMode] = useState(() => localStorage.getItem("app_mode") || "local");
  const isGlobalMode = appMode === "global";

  // Form states for Add/Edit
  const [currentItemId, setCurrentItemId] = useState(null);
  const [itemName, setItemName] = useState("");
  const [category, setCategory] = useState("");
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [brand, setBrand] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [image, setImage] = useState("");
  const [productFloorId, setProductFloorId] = useState("all");
  const [productTerminalId, setProductTerminalId] = useState("all");
  const [floorsList, setFloorsList] = useState([]);
  const [terminalsList, setTerminalsList] = useState([]);
  const [explicitInvMode, setExplicitInvMode] = useState(null);
  const shopInvMode =
    explicitInvMode ||
    (terminalsList.length > 1 ? INVENTORY_MODES.TERMINAL_WISE : INVENTORY_MODES.SHARED);
  const primaryTerminalId =
    terminalsList.find((t) => t.isPrimary === true || t.id === "terminal_1")?.id ||
    terminalsList[0]?.id ||
    null;
  const [floorFilter, setFloorFilter] = useState("all");
  const [terminalFilter, setTerminalFilter] = useState("all");

  // Web Image Search States
  const [webImageModalOpen, setWebImageModalOpen] = useState(false);
  const [webImageQuery, setWebImageQuery] = useState("");
  const [webImageResults, setWebImageResults] = useState([]);
  const [webImageLoading, setWebImageLoading] = useState(false);

  // Quick Waste Modal States
  const [wasteModalItem, setWasteModalItem] = useState(null);
  const [wasteQty, setWasteQty] = useState("");
  const [wasteReason, setWasteReason] = useState(WASTE_REASONS[0].label);
  const [wasteNotes, setWasteNotes] = useState("");
  const [savingWaste, setSavingWaste] = useState(false);
  const [wasteSuccessToast, setWasteSuccessToast] = useState("");

  const MEDICAL_CATEGORIES = useMemo(() => [
    "Tablets",
    "Capsules",
    "Syrups & Suspensions",
    "Injections & Infusions",
    "Ointments & Creams",
    "Drops (Eye/Ear)",
    "Antibiotics",
    "Pain Relief",
    "Vitamins & Supplements",
    "Medical Devices & Consumables",
    "First Aid & Surgical",
    "General Health"
  ], []);

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
    const baseList = isMedical ? MEDICAL_CATEGORIES : (isRestaurant ? RESTAURANT_CATEGORIES : RETAIL_CATEGORIES);
    const catSet = new Set(baseList);
    items.forEach((p) => {
      const c = p.category;
      if (c && typeof c === "string" && c.trim()) {
        catSet.add(c.trim());
      }
    });
    return Array.from(catSet);
  }, [isMedical, isRestaurant, items, MEDICAL_CATEGORIES, RESTAURANT_CATEGORIES, RETAIL_CATEGORIES]);

  useEffect(() => {
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) {
      return;
    }

    // Check user profile for shopType
    const checkType = async () => {
      try {
        const uDoc = await getDoc(doc(db, "users", currentUid));
        if (uDoc.exists()) {
          const d = uDoc.data();
          setExplicitInvMode(d.inventoryMode ? getShopInventoryMode(d) : null);
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
    const unsubFloors = subscribeFloors(db, currentUid, setFloorsList, () => {});
    const unsubTerminals = subscribeTerminals(db, currentUid, setTerminalsList, () => {});

    // Real-time listener for user's inventory or restaurant_menu
    const colName = isRestaurant ? "restaurant_menu" : (isGlobalMode ? "global_inventory" : "inventory");
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

    return () => {
      unsubscribe();
      unsubFloors();
      unsubTerminals();
    };
  }, [isRestaurant, appMode]);

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

          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, size, size);

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

  const handleOpenAddModal = () => {
    setCurrentItemId(null);
    setItemName("");
    const defaultCat = isRestaurant ? "Main Course" : "General";
    setCategory(defaultCat);
    setShowCustomCategory(false);
    setBrand("");
    setSalesPrice("");
    setQuantity(isRestaurant ? "100" : "");
    setImage("");
    setProductTerminalId(terminalFilter !== "all" ? terminalFilter : "all");
    setProductFloorId(
      terminalFilter !== "all"
        ? terminalsList.find((t) => t.id === terminalFilter)?.floorId || "all"
        : "all"
    );
    setModalVisible(true);
  };

  const handleOpenEditModal = (item) => {
    setCurrentItemId(item.id);
    setItemName(item.itemName || item.name || "");
    const itemCat = item.category || (isRestaurant ? "Main Course" : "General");
    setCategory(itemCat);
    const existingList = isRestaurant ? RESTAURANT_CATEGORIES : RETAIL_CATEGORIES;
    setShowCustomCategory(!existingList.includes(itemCat));
    setBrand(item.brand || "");
    setSalesPrice(String(item.salesPrice ?? item.price ?? ""));
    setQuantity(String(item.quantity ?? "0"));
    setImage(item.image || item.imageUrl || "");
    setProductTerminalId(item.terminalId || "all");
    setProductFloorId(item.floorId || "all");
    setModalVisible(true);
  };

  const searchWebImages = async (searchTerm) => {
    const term = (searchTerm !== undefined ? searchTerm : webImageQuery || itemName || "").trim();
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
    const defaultQuery = itemName.trim() || (category && category !== "Main Course" && category !== "General" ? category.trim() : "") || "";
    setWebImageQuery(defaultQuery);
    setWebImageResults([]);
    setWebImageModalOpen(true);
    if (defaultQuery) {
      searchWebImages(defaultQuery);
    }
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      const colName = isRestaurant ? "restaurant_menu" : (isGlobalMode ? "global_inventory" : "inventory");
      const targetRef = collection(db, "users", currentUid, colName);
      const chosenTerminal = terminalsList.find((t) => t.id === productTerminalId);
      const resolvedFloorId = chosenTerminal?.floorId || productFloorId || "all";
      const chosenFloor = floorsList.find((f) => f.id === resolvedFloorId);
      const productData = {
        name: itemName.trim(),
        itemName: itemName.trim(),
        category: category.trim() || (isRestaurant ? "Main Course" : "General"),
        brand: brand.trim() || (isRestaurant ? "" : isGlobalMode ? "Global" : "Local"),
        salesPrice: Number(salesPrice) || 0,
        price: Number(salesPrice) || 0,
        quantity: isNaN(Number(quantity)) ? 100 : Number(quantity),
        isAvailable: true,
        image: image.trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        imageUrl: image.trim() || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
        isGlobalMode: isGlobalMode,
        inventoryMode: isGlobalMode ? "global" : "local",
        terminalId: chosenTerminal ? chosenTerminal.id : "all",
        terminalName: chosenTerminal ? chosenTerminal.name : "All Terminals",
        terminalCode: chosenTerminal ? chosenTerminal.code : "",
        floorId: resolvedFloorId !== "all" ? resolvedFloorId : "all",
        floorName: chosenFloor ? chosenFloor.name : "All Floors"
      };

      if (currentItemId) {
        // Update existing item
        await updateDoc(doc(db, "users", currentUid, colName, currentItemId), productData);
      } else {
        // Add new item - verify subscription limit per terminal independently
        const uDoc = await getDoc(doc(db, "users", currentUid));
        const uData = uDoc.exists() ? uDoc.data() : {};
        const sub = resolveTerminalSubscription(uData, chosenTerminal);
        const scopedCount = countProductsForTerminalLimit(items, {
          terminalId: chosenTerminal?.id || null,
          shopInventoryMode: shopInvMode,
          primaryTerminalId,
        });
        if (!canAddInventoryItem(scopedCount, sub.plan, sub.isExpired)) {
          alert(
            sub.isExpired
              ? "Your subscription has expired. Please renew your plan to add new inventory items."
              : chosenTerminal
              ? `Terminal "${chosenTerminal.name}" reached your ${sub.plan} plan limit (${sub.limits.inventoryLimit} items per terminal). You can add items to other terminals or upgrade to Pro.`
              : `Your ${sub.plan} plan limit (${sub.limits.inventoryLimit} items) has been reached. Please upgrade to Pro for unlimited items.`
          );
          return;
        }
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

    const label = isRestaurant ? "food item" : isGlobalMode ? "global product" : "local product";
    if (window.confirm(`Are you sure you want to delete this ${label}?`)) {
      try {
        const colName = isRestaurant ? "restaurant_menu" : (isGlobalMode ? "global_inventory" : "inventory");
        await deleteDoc(doc(db, "users", currentUid, colName, id));
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const handleConfirmWaste = async (e) => {
    e.preventDefault();
    if (!wasteModalItem) return;
    const qty = Number(wasteQty);
    if (isNaN(qty) || qty <= 0) {
      alert("Please enter a valid wasted quantity.");
      return;
    }
    const currentStock = Number(wasteModalItem.quantity) || 0;
    if (qty > currentStock) {
      alert(`Wasted quantity (${qty}) cannot exceed currently available stock (${currentStock}).`);
      return;
    }

    setSavingWaste(true);
    try {
      const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
      await logWasteRecord({
        db,
        uid: currentUid,
        itemId: wasteModalItem.id,
        itemType: isRestaurant ? "restaurant_food_item" : "shop_product",
        wastedQty: qty,
        reason: wasteReason,
        notes: wasteNotes,
        reportedBy: localStorage.getItem("staff_name") || "Owner",
        shopMode: appMode,
        unitCost: Number(wasteModalItem.purchasePrice ?? wasteModalItem.price ?? 0),
        unitType: wasteModalItem.unitType || "Qty",
        productName: wasteModalItem.itemName || wasteModalItem.name,
        category: wasteModalItem.category || "General",
        image: wasteModalItem.image || "",
      });

      setSavingWaste(false);
      setWasteModalItem(null);
      setWasteQty("");
      setWasteNotes("");
      setWasteSuccessToast(`Successfully recorded waste for ${wasteModalItem.itemName || wasteModalItem.name}.`);
      setTimeout(() => setWasteSuccessToast(""), 3500);
    } catch (err) {
      console.error("Waste error:", err);
      alert(err.message || "Failed to log waste.");
      setSavingWaste(false);
    }
  };

  const filteredItems = filterProductsForCatalog(items, {
    inventoryMode: shopInvMode,
    terminalId: terminalFilter !== "all" ? terminalFilter : null,
    floorId:
      terminalFilter !== "all"
        ? terminalsList.find((t) => t.id === terminalFilter)?.floorId || null
        : floorFilter,
    primaryTerminalId,
  }).filter(item => {
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

      {terminalsList.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#1d4ed8" }}>Terminal:</span>
          <button
            type="button"
            onClick={() => setTerminalFilter("all")}
            style={{
              padding: "5px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              backgroundColor: terminalFilter === "all" ? "#2563eb" : "#ffffff",
              color: terminalFilter === "all" ? "#ffffff" : "#334155",
              fontSize: "12px",
              fontWeight: "700",
              cursor: "pointer"
            }}
          >
            All Terminals
          </button>
          {terminalsList.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTerminalFilter(t.id)}
              style={{
                padding: "5px 12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                backgroundColor: terminalFilter === t.id ? "#2563eb" : "#ffffff",
                color: terminalFilter === t.id ? "#ffffff" : "#334155",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer"
              }}
            >
              {t.name} ({t.floorName})
            </button>
          ))}
        </div>
      )}

      {shopInvMode === INVENTORY_MODES.FLOOR_WISE && floorsList.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#4338ca" }}>Floor:</span>
          <button
            type="button"
            onClick={() => setFloorFilter("all")}
            style={{
              padding: "5px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              backgroundColor: floorFilter === "all" ? "#4f46e5" : "#ffffff",
              color: floorFilter === "all" ? "#ffffff" : "#334155",
              fontSize: "12px",
              fontWeight: "700",
              cursor: "pointer"
            }}
          >
            All Floors
          </button>
          {floorsList.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFloorFilter(f.id)}
              style={{
                padding: "5px 12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                backgroundColor: floorFilter === f.id ? "#4f46e5" : "#ffffff",
                color: floorFilter === f.id ? "#ffffff" : "#334155",
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
                      <button onClick={() => { setWasteModalItem(item); setWasteQty(""); setWasteNotes(""); }} style={styles.wasteBtn} title="Log spoilage or expired waste for this item">Waste</button>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ margin: 0 }}>
                {isRestaurant ? (currentItemId ? "Edit Food Item" : "Add New Food") : (currentItemId ? "Edit Product" : "Add New Product")}
              </h3>
              <button
                type="button"
                onClick={handleOpenWebImageSearch}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  backgroundColor: "#e0e7ff",
                  color: "#4338ca",
                  border: "none",
                  borderRadius: "14px",
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontWeight: "800",
                  cursor: "pointer"
                }}
              >
                <span>🔍</span> Search web
              </button>
            </div>
            <form onSubmit={handleSaveItem} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>{isRestaurant ? "Food Name *" : "Product Name *"}</label>
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
                  style={{ ...styles.input, cursor: "pointer", backgroundColor: "#ffffff" }}
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
                    placeholder={isRestaurant ? "Type custom food category..." : "Type custom category..."}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={{ ...styles.input, marginTop: "6px" }}
                    autoFocus
                    required
                  />
                )}
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
              {terminalsList.length > 0 && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Assigned Terminal</label>
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
                    style={{ ...styles.input, cursor: "pointer", backgroundColor: "#ffffff" }}
                  >
                    <option value="all">Shared Across All Terminals</option>
                    {terminalsList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.code}) — {t.floorName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {shopInvMode === INVENTORY_MODES.FLOOR_WISE && productTerminalId === "all" && floorsList.length > 0 && (
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Assigned Floor</label>
                  <select
                    value={productFloorId}
                    onChange={(e) => setProductFloorId(e.target.value)}
                    style={{ ...styles.input, cursor: "pointer", backgroundColor: "#ffffff" }}
                  >
                    <option value="all">Shared Across All Floors</option>
                    {floorsList.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
                <label style={styles.label}>{isRestaurant ? "Food Photo / URL" : "Product Photo / URL"}</label>
                <input 
                  type="text" 
                  value={image} 
                  onChange={(e) => setImage(e.target.value)} 
                  style={styles.input} 
                  placeholder="https://... (or search web above)" 
                />
                {image && (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px", backgroundColor: "#ffffff", padding: "6px 10px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
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

              <div style={styles.modalActions}>
                <button type="submit" style={styles.saveBtn}>{isRestaurant ? "Save Food" : "Save Product"}</button>
                <button type="button" onClick={() => setModalVisible(false)} style={styles.cancelBtn}>Cancel</button>
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

      {/* QUICK LOG WASTE MODAL */}
      {wasteModalItem && (
        <div style={styles.modalOverlay} onClick={() => setWasteModalItem(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                🗑️ Log Waste: {wasteModalItem.itemName || wasteModalItem.name}
              </h3>
              <button
                type="button"
                onClick={() => setWasteModalItem(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#94a3b8" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmWaste} style={styles.form}>
              <div style={{ padding: "10px", backgroundColor: "#f8fafc", borderRadius: "8px", fontSize: "12px", color: "#475569" }}>
                Available Stock: <strong>{wasteModalItem.quantity} {wasteModalItem.unitType || "units"}</strong> | Unit Cost: <strong>₹{wasteModalItem.purchasePrice || wasteModalItem.price}</strong>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Quantity to Expire / Waste *</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  max={Number(wasteModalItem.quantity) || 999999}
                  value={wasteQty}
                  onChange={(e) => setWasteQty(e.target.value)}
                  placeholder={`Max: ${wasteModalItem.quantity}`}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Reason for Loss *</label>
                <select
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value)}
                  style={styles.input}
                  required
                >
                  {WASTE_REASONS.map((r) => (
                    <option key={r.id} value={r.label}>
                      {r.icon} {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Notes (Optional)</label>
                <input
                  type="text"
                  value={wasteNotes}
                  onChange={(e) => setWasteNotes(e.target.value)}
                  placeholder="e.g. Expired batch, packaging ripped"
                  style={styles.input}
                />
              </div>

              {Number(wasteQty) > 0 && (
                <div style={{ padding: "10px 12px", backgroundColor: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca", fontSize: "13px", color: "#b91c1c" }}>
                  Financial Loss: <strong>₹{((Number(wasteModalItem.purchasePrice || wasteModalItem.price || 0)) * Number(wasteQty)).toFixed(2)}</strong>
                </div>
              )}

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setWasteModalItem(null)}
                  style={styles.cancelBtn}
                  disabled={savingWaste}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ ...styles.saveBtn, backgroundColor: "#ef4444" }}
                  disabled={savingWaste || !wasteQty}
                >
                  {savingWaste ? "Recording Loss..." : "Confirm & Reduce Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {wasteSuccessToast && (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", backgroundColor: "#065f46", color: "#fff", padding: "12px 20px", borderRadius: "10px", fontWeight: "700", zIndex: 9999, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
          {wasteSuccessToast}
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
  wasteBtn: { flex: 1, padding: "6px 8px", backgroundColor: "#ffedd5", color: "#c2410c", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "11px", textAlign: "center" },
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