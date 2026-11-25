import { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  serverTimestamp
} from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { getGroceryImage, GROCERY_IMAGE_PRESETS } from "../utils/groceryImages";
import { formatRawStockDisplay, calculatePortionYieldAndShortage } from "../utils/recipeStockService";
import { logWasteRecord } from "../utils/wasteService";

// Dummy starter item names to filter out and purge
const DUMMY_STARTER_NAMES = new Set([
  "paper cups (250ml)",
  "burger buns (sesame)",
  "fresh mint & lemon",
  "refined white sugar",
  "cheese slices",
  "veggie patty",
  "tea leaves (ctc)",
  "butter (salted)",
  "cooking oil",
  "farm fresh eggs",
  "full cream milk",
  "chicken patty",
  "burger mayo & sauce",
  "sandwich bread loaf",
  "coffee powder / beans",
  "burger takeaway box"
]);

// Default category presets for restaurants and shops
const DEFAULT_RESTAURANT_CATEGORIES = [
  "Groceries",
  "Dairy",
  "Meat & Poultry",
  "Produce / Vegetables",
  "Spices & Masala",
  "Bakery",
  "Oils & Ghee",
  "Sauces & Condiments",
  "Beverages",
  "Packaging"
];

const DEFAULT_SHOP_CATEGORIES = [
  "Stock",
  "General",
  "Retail",
  "Electronics",
  "Groceries",
  "Clothing",
  "Hardware"
];

export default function PurchaseReport({
  userProfile = {},
  isRestaurant = false,
  isGlobalMode = false,
  activeBranchId: propActiveBranchId,
  activeBranchName: propActiveBranchName,
  branchesList: propBranchesList = [],
  onSelectBranch,
  onBack
}) {
  // Unified single Shop Inventory mode ("restaurent groceries & food incredients intha option vendam ella stockkum shopinventorylaye add aagattum")
  const [reportMode, setReportMode] = useState("shop");
  
  // View mode: "cards" (Card Grid View like Menu items) vs "table" (Invoices log)
  const [viewMode, setViewMode] = useState("cards");

  // Multi-Branch Management State
  const [internalBranchId, setInternalBranchId] = useState(() => propActiveBranchId || localStorage.getItem("active_branch_id") || "main_branch");
  const [internalBranchName, setInternalBranchName] = useState(() => propActiveBranchName || localStorage.getItem("active_branch_name") || "Main Branch");
  const [branches, setBranches] = useState(propBranchesList || []);

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
  const storeName = userProfile.storeName || "Upstage Kadai";

  // Synchronize branch from Dashboard prop or localStorage
  useEffect(() => {
    if (propActiveBranchId) {
      setInternalBranchId(propActiveBranchId);
    }
  }, [propActiveBranchId]);

  useEffect(() => {
    if (propActiveBranchName) {
      setInternalBranchName(propActiveBranchName);
    }
  }, [propActiveBranchName]);

  // Listen to branches in Firestore if not passed
  useEffect(() => {
    if (propBranchesList && propBranchesList.length > 0) {
      setBranches(propBranchesList);
    } else if (currentUid) {
      const unsub = onSnapshot(collection(db, "users", currentUid, "branches"), (snap) => {
        let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.isPrimary || a.id === "main_branch" ? -1 : 1));
        setBranches(list);
      });
      return () => unsub();
    }
  }, [propBranchesList, currentUid]);

  const isPrimaryBranchId = (bId) => {
    if (!bId || bId === "main_branch" || bId === "main_default" || bId === "BR-01") return true;
    const b = branches.find((item) => item.id === bId);
    return b?.isPrimary === true;
  };

  // Branch isolation matcher: ensures each branch has its own stock & purchases
  const itemMatchesBranch = (item, bId) => {
    if (!bId || bId === "all") return true;
    const targetIsPrimary = isPrimaryBranchId(bId);

    // If item has no branchId or branchName, it belongs to the primary/main branch
    if (!item.branchId && !item.branchName) {
      return targetIsPrimary;
    }

    if (item.branchId) {
      if (item.branchId === bId) return true;
      if (targetIsPrimary && (item.branchId === "main_branch" || item.branchId === "main_default" || item.branchId === "BR-01")) {
        return true;
      }
    }

    if (item.branchName) {
      const targetBranch = branches.find((b) => b.id === bId);
      if (targetBranch && item.branchName === targetBranch.name) return true;
    }

    return false;
  };

  // Data states
  const [purchasesList, setPurchasesList] = useState([]);
  const [rawMaterialsList, setRawMaterialsList] = useState([]);
  const [shopProductsList, setShopProductsList] = useState([]);
  const [customCategories, setCustomCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all"); // "all" | "today" | "week" | "month" | "custom"
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");

  // Selected item for Detail Modal ("antha item a click panna show aakura mathiri")
  const [selectedItemDetail, setSelectedItemDetail] = useState(null);
  const [userRecipes, setUserRecipes] = useState([]);
  const [reconcilePacksUsed, setReconcilePacksUsed] = useState(1);
  const [reconcileActualServed, setReconcileActualServed] = useState(48);
  const [reconcilingShortage, setReconcilingShortage] = useState(false);
  const [reconcileSuccessMsg, setReconcileSuccessMsg] = useState("");

  // Add Purchase Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState("");
  const [formItemName, setFormItemName] = useState("");
  const [formCategory, setFormCategory] = useState("Groceries");
  const [showAddCategoryInline, setShowAddCategoryInline] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [formQty, setFormQty] = useState("");
  const [formUnit, setFormUnit] = useState("kg");
  const [formRate, setFormRate] = useState("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formBillNo, setFormBillNo] = useState("");
  const [formPaymentMode, setFormPaymentMode] = useState("Cash");
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formNotes, setFormNotes] = useState("");
  const [formImage, setFormImage] = useState("");

  // Smart measurement split states for Kilos/Grams, Litres/ML, Packets
  const [formKilo, setFormKilo] = useState("");
  const [formGram, setFormGram] = useState("");
  const [formLitre, setFormLitre] = useState("");
  const [formMl, setFormMl] = useState("");
  const [formPackCount, setFormPackCount] = useState("");
  const [formPackSizeVal, setFormPackSizeVal] = useState("");
  const [formPackSizeUnit, setFormPackSizeUnit] = useState("ml");

  // Web Image Search State ("search web option web appla irrukka purchaselayum add pannikkudu")
  const [webSearchModalOpen, setWebSearchModalOpen] = useState(false);
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [webSearchResults, setWebSearchResults] = useState([]);
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [webSearchTarget, setWebSearchTarget] = useState("purchase"); // "purchase" | "edit"

  // Edit Item Modal State ("dei apram ithula oru edit optionum set panniru da")
  const [editingItem, setEditingItem] = useState(null);
  const [editItemName, setEditItemName] = useState("");
  const [editCategory, setEditCategory] = useState("Groceries");
  const [showEditAddCategory, setShowEditAddCategory] = useState(false);
  const [newEditCategoryInput, setNewEditCategoryInput] = useState("");
  const [editStockQty, setEditStockQty] = useState("");
  const [editUnit, setEditUnit] = useState("kg");
  const [editRate, setEditRate] = useState("");
  const [editPackCapacity, setEditPackCapacity] = useState("");
  const [editPackUnit, setEditPackUnit] = useState("ml");
  const [editMinAlert, setEditMinAlert] = useState("5");
  const [editSupplier, setEditSupplier] = useState("");
  const [editImage, setEditImage] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Switch unit and sync smart input values
  const handleUnitChange = (newUnit) => {
    setFormUnit(newUnit);
    const currentVal = parseFloat(formQty) || 0;
    if (newUnit === "kg") {
      if (currentVal > 0) {
        setFormKilo(String(Math.floor(currentVal)));
        const remGrams = Math.round((currentVal % 1) * 1000);
        setFormGram(remGrams > 0 ? String(remGrams) : "");
      }
    } else if (newUnit === "L") {
      if (currentVal > 0) {
        setFormLitre(String(Math.floor(currentVal)));
        const remMl = Math.round((currentVal % 1) * 1000);
        setFormMl(remMl > 0 ? String(remMl) : "");
      }
    } else if (newUnit === "g") {
      if (currentVal > 0) {
        setFormGram(String(currentVal < 50 ? Math.round(currentVal * 1000) : currentVal));
      }
    } else if (newUnit === "ml") {
      if (currentVal > 0) {
        setFormMl(String(currentVal < 50 ? Math.round(currentVal * 1000) : currentVal));
      }
    } else {
      if (currentVal > 0) {
        setFormPackCount(String(Math.max(1, Math.round(currentVal))));
      }
    }
  };

  // Quick weight / volume increment helpers
  const addGrams = (gToAdd) => {
    const curG = Number(formGram || 0);
    const totalG = curG + gToAdd;
    if (formUnit === "kg") {
      if (totalG >= 1000) {
        const extraKilo = Math.floor(totalG / 1000);
        const remG = totalG % 1000;
        setFormKilo((prev) => String(Number(prev || 0) + extraKilo));
        setFormGram(remG > 0 ? String(remG) : "");
      } else {
        setFormGram(String(totalG));
      }
    } else {
      setFormGram(String(totalG));
    }
  };

  const addKilos = (kToAdd) => {
    setFormKilo((prev) => String(Number(prev || 0) + kToAdd));
  };

  const addMl = (mlToAdd) => {
    const curMl = Number(formMl || 0);
    const totalMl = curMl + mlToAdd;
    if (formUnit === "L") {
      if (totalMl >= 1000) {
        const extraL = Math.floor(totalMl / 1000);
        const remMl = totalMl % 1000;
        setFormLitre((prev) => String(Number(prev || 0) + extraL));
        setFormMl(remMl > 0 ? String(remMl) : "");
      } else {
        setFormMl(String(totalMl));
      }
    } else {
      setFormMl(String(totalMl));
    }
  };

  const addLitres = (lToAdd) => {
    setFormLitre((prev) => String(Number(prev || 0) + lToAdd));
  };

  const addPacks = (countToAdd) => {
    setFormPackCount((prev) => String(Number(prev || 0) + countToAdd));
  };

  // Calculate effective quantity and formatted measurement label
  const { effectiveQty, measurementDetailText, computedTotalAmount } = useMemo(() => {
    let q = 0;
    let label = "";
    const rate = parseFloat(formRate) || 0;

    if (formUnit === "kg") {
      const k = parseFloat(formKilo) || 0;
      const g = parseFloat(formGram) || 0;
      if (k > 0 || g > 0) {
        q = Number((k + g / 1000).toFixed(3));
        label = `${k > 0 ? `${k} kg` : ""} ${g > 0 ? `${g} g` : ""}`.trim();
      } else {
        q = parseFloat(formQty) || 0;
        label = `${q} kg`;
      }
    } else if (formUnit === "L") {
      const l = parseFloat(formLitre) || 0;
      const ml = parseFloat(formMl) || 0;
      if (l > 0 || ml > 0) {
        q = Number((l + ml / 1000).toFixed(3));
        label = `${l > 0 ? `${l} L` : ""} ${ml > 0 ? `${ml} ml` : ""}`.trim();
      } else {
        q = parseFloat(formQty) || 0;
        label = `${q} L`;
      }
    } else if (formUnit === "g") {
      const g = parseFloat(formGram) || parseFloat(formQty) || 0;
      q = g;
      label = `${g} g (${(g / 1000).toFixed(2)} kg)`;
    } else if (formUnit === "ml") {
      const ml = parseFloat(formMl) || parseFloat(formQty) || 0;
      q = ml;
      label = `${ml} ml (${(ml / 1000).toFixed(2)} L)`;
    } else {
      const cnt = parseFloat(formPackCount) || parseFloat(formQty) || 1;
      q = cnt;
      if (formPackSizeVal) {
        label = `${cnt} ${formUnit} (${formPackSizeVal} ${formPackSizeUnit} each)`;
      } else {
        label = `${cnt} ${formUnit}`;
      }
    }

    const total = Number((q * rate).toFixed(2));
    return { effectiveQty: q, measurementDetailText: label, computedTotalAmount: total };
  }, [formUnit, formKilo, formGram, formLitre, formMl, formPackCount, formPackSizeVal, formPackSizeUnit, formQty, formRate]);

  // Auto-generate invoice number when modal opens
  const openNewPurchaseModal = () => {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    setFormBillNo(`PUR-${randomSuffix}`);
    setFormItemName("");
    setSelectedExistingId("");
    setFormCategory("Stock");
    setShowAddCategoryInline(false);
    setNewCategoryInput("");
    setFormQty("");
    setFormKilo("");
    setFormGram("");
    setFormLitre("");
    setFormMl("");
    setFormPackCount("");
    setFormPackSizeVal("");
    setFormPackSizeUnit("ml");
    setFormUnit("pcs");
    setFormRate("");
    setFormSupplier("");
    setFormPaymentMode("Cash");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes("");
    setFormImage("");
    setShowAddModal(true);
  };

  // Open modal pre-filled for a specific raw material/stock item
  const openPurchaseForSpecificItem = (item) => {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    setFormBillNo(`PUR-${randomSuffix}`);
    setSelectedExistingId(item.id || "");
    const itemName = item.name || item.itemName || "";
    setFormItemName(itemName);
    setFormCategory(item.category || "Stock");
    setShowAddCategoryInline(false);
    const unit = item.unit || item.unitType || "pcs";
    setFormUnit(unit);
    setFormRate(
      item.costPerUnit != null ? String(item.costPerUnit) : item.purchasePrice != null ? String(item.purchasePrice) : ""
    );
    setFormSupplier(item.supplierName || item.latestSupplier || "");
    setFormImage(item.image || "");
    setFormQty("");
    setFormKilo("");
    setFormGram("");
    setFormLitre("");
    setFormMl("");
    setFormPackCount("");
    setFormPackSizeVal("");
    setFormPaymentMode("Cash");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormNotes("");
    setShowAddModal(true);
  };

  // 1. Listen to purchases, raw materials, inventory, and categories
  useEffect(() => {
    if (!currentUid) return;

    // A. Listen to main purchases collection
    const purchasesRef = collection(db, "users", currentUid, "purchases");
    const unsubPurchases = onSnapshot(
      purchasesRef,
      (snapshot) => {
        const records = snapshot.docs.map((d) => {
          const data = d.data();
          const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : (data.date ? new Date(data.date) : (data.createdAt ? new Date(data.createdAt) : new Date()));
          return {
            id: d.id,
            ...data,
            parsedDate: createdAt,
            totalAmount: Number(data.totalAmount || data.total || 0),
            qty: Number(data.qty || data.quantity || 1),
            rate: Number(data.rate || data.purchasePrice || data.costPerUnit || 0)
          };
        });
        setPurchasesList(records);
        setLoading(false);
      },
      (err) => {
        console.warn("Purchases listener error:", err);
        setLoading(false);
      }
    );

    // B. Listen to raw materials (restaurant groceries) & clean up any dummy starter data
    const rawRef = collection(db, "users", currentUid, "raw_materials");
    const unsubRaw = onSnapshot(rawRef, (snapshot) => {
      const rows = [];
      snapshot.docs.forEach((d) => {
        const data = d.data();
        const cleanName = (data.name || "").toLowerCase().trim();

        // If this is a dummy starter item, purge it from Firestore silently!
        if (DUMMY_STARTER_NAMES.has(cleanName)) {
          try {
            deleteDoc(doc(db, "users", currentUid, "raw_materials", d.id));
          } catch (_) {}
          return;
        }

        // Auto-fix coffe powder image if it had the generic vegetable shelf image
        if (cleanName.includes("coffe") && data.image && data.image.includes("542838132-92c53300491e")) {
          try {
            updateDoc(doc(db, "users", currentUid, "raw_materials", d.id), {
              image: GROCERY_IMAGE_PRESETS.coffee
            });
          } catch (_) {}
        }

        rows.push({
          id: d.id,
          ...data,
          costPerUnit: Number(data.costPerUnit || 0),
          stockQuantity: Number(data.stockQuantity || 0)
        });
      });
      setRawMaterialsList(rows);
    });

    // C. Listen to shop inventory
    const inventoryCol = isGlobalMode ? "global_inventory" : "inventory";
    const invRef = collection(db, "users", currentUid, inventoryCol);
    const unsubInv = onSnapshot(invRef, (snapshot) => {
      const rows = snapshot.docs.map((d) => {
        const data = d.data();
        const cleanName = (data.name || data.itemName || "").toLowerCase().trim();

        // Auto-fix coffe powder image if it had the generic vegetable shelf image
        if (cleanName.includes("coffe") && data.image && data.image.includes("542838132-92c53300491e")) {
          try {
            updateDoc(doc(db, "users", currentUid, inventoryCol, d.id), {
              image: GROCERY_IMAGE_PRESETS.coffee
            });
          } catch (_) {}
        }

        return {
          id: d.id,
          ...data,
          itemName: data.name || data.itemName || "Unnamed Item",
          purchasePrice: Number(data.purchasePrice || data.costPrice || 0),
          quantity: Number(data.quantity || 0)
        };
      });
      setShopProductsList(rows);
    });

    // D. Listen to user custom categories
    const catCol = isGlobalMode ? "global_categories" : "categories";
    const catRef = collection(db, "users", currentUid, catCol);
    const unsubCat = onSnapshot(catRef, (snapshot) => {
      const cats = snapshot.docs.map((d) => d.data().name || d.data().categoryName || d.id).filter(Boolean);
      setCustomCategories(cats);
    }, () => {});

    // E. Listen to user recipes for portion yield & shortage calculations
    const recipesRef = collection(db, "users", currentUid, "recipes");
    const unsubRecipes = onSnapshot(
      recipesRef,
      (snapshot) => {
        const rList = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }));
        setUserRecipes(rList);
      },
      (err) => {
        console.warn("Recipes listener notice:", err);
      }
    );

    return () => {
      unsubPurchases();
      unsubRaw();
      unsubInv();
      unsubCat();
      unsubRecipes();
    };
  }, [currentUid, isGlobalMode]);

  // Combined available categories for dropdown
  const availableCategories = useMemo(() => {
    const set = new Set([...DEFAULT_SHOP_CATEGORIES, ...DEFAULT_RESTAURANT_CATEGORIES, ...customCategories]);
    // Also include any categories from existing items
    [...shopProductsList, ...rawMaterialsList].forEach((it) => {
      if (it.category) set.add(it.category);
    });
    return Array.from(set);
  }, [customCategories, shopProductsList, rawMaterialsList]);

  // Handle adding a brand new category from modal dropdown
  const handleAddNewCategory = async () => {
    const name = newCategoryInput.trim();
    if (!name) return;
    setFormCategory(name);
    setShowAddCategoryInline(false);
    setNewCategoryInput("");

    if (currentUid) {
      try {
        const catCol = isGlobalMode ? "global_categories" : "categories";
        await addDoc(collection(db, "users", currentUid, catCol), {
          name: name,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.warn("Category save notice:", err);
      }
    }
  };

  // Typo & Synonym Normalizer for Indian Groceries and common search terms
  const normalizeGroceryQuery = (term) => {
    let q = (term || "").toLowerCase().trim();
    q = q.replace(/\bcoffe\b/g, "coffee");
    q = q.replace(/\bchikken\b/g, "chicken");
    q = q.replace(/\bchiken\b/g, "chicken");
    q = q.replace(/\bmilkk\b/g, "milk");
    q = q.replace(/\bpaal\b/g, "milk");
    q = q.replace(/\buppu\b/g, "salt");
    q = q.replace(/\bmuttai\b/g, "egg");
    q = q.replace(/\bennai\b/g, "cooking oil");
    q = q.replace(/\bsakkarai\b/g, "sugar");
    q = q.replace(/\bkaapi\b/g, "coffee");
    q = q.replace(/\bvengayam\b/g, "onion");
    q = q.replace(/\bthakkali\b/g, "tomato");
    q = q.replace(/\barisi\b/g, "rice");
    q = q.replace(/\bmeen\b/g, "fish");
    q = q.replace(/\bkoli\b/g, "chicken");
    return q;
  };

  // Handle Web Image Search (Multi-Source: Curated Presets, Open Food Facts, Wikipedia, Wikimedia)
  const handleOpenWebImageSearch = (initialQuery = "", target = "purchase") => {
    setWebSearchTarget(target);
    const q = initialQuery.trim() || (target === "edit" ? editItemName.trim() : formItemName.trim()) || "groceries";
    setWebSearchQuery(q);
    setWebSearchModalOpen(true);
    executeWebImageSearch(q);
  };

  const executeWebImageSearch = async (queryText) => {
    const rawTarget = (queryText || "").trim();
    if (!rawTarget) return;
    setWebSearchLoading(true);

    const normTarget = normalizeGroceryQuery(rawTarget);

    try {
      const results = [];

      // 1. Curated exact presets matching
      const targetLower = normTarget.toLowerCase();
      const exactPreset = getGroceryImage(targetLower, formCategory);
      if (exactPreset && !exactPreset.includes("542838132-92c53300491e")) {
        results.push(exactPreset);
      }
      Object.entries(GROCERY_IMAGE_PRESETS).forEach(([k, url]) => {
        if ((targetLower.includes(k) || k.includes(targetLower)) && !url.includes("542838132-92c53300491e")) {
          results.push(url);
        }
      });

      // 2. High-Resolution E-Commerce Product Pack Shots (via local dev proxy - Amazon, IndiaMART, Retail)
      try {
        const proxyRes = await fetch(`/api/search-web-images?q=${encodeURIComponent(normTarget)}`);
        if (proxyRes.ok) {
          const proxyData = await proxyRes.json();
          if (Array.isArray(proxyData?.images) && proxyData.images.length > 0) {
            proxyData.images.forEach((img) => {
              if (img && typeof img === "string" && img.startsWith("http")) {
                results.push(img);
              }
            });
          }
        }
      } catch (proxyErr) {
        console.log("Local web image search proxy notice:", proxyErr);
      }

      // 3. Open Food Facts API (Official verified packaged groceries & food items)
      try {
        const offUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(normTarget)}&search_simple=1&action=process&json=1&page_size=20`;
        const offRes = await fetch(offUrl);
        if (offRes.ok) {
          const offData = await offRes.json();
          if (Array.isArray(offData?.products)) {
            offData.products.forEach((p) => {
              const img1 = p.image_front_url || p.selected_images?.front?.display?.en || p.selected_images?.front?.display?.in;
              const img2 = p.image_url;
              const img3 = p.selected_images?.packaging?.display?.en;
              [img1, img2, img3].forEach((img) => {
                if (img && typeof img === "string" && img.startsWith("http")) {
                  results.push(img);
                }
              });
            });
          }
        }
      } catch (offErr) {
        console.log("OpenFoodFacts search notice:", offErr);
      }

      // 4. India Open Food Facts API (Indian retail brands & commodities)
      try {
        const inOffUrl = `https://in.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(normTarget)}&search_simple=1&action=process&json=1&page_size=20`;
        const inOffRes = await fetch(inOffUrl);
        if (inOffRes.ok) {
          const inOffData = await inOffRes.json();
          if (Array.isArray(inOffData?.products)) {
            inOffData.products.forEach((p) => {
              const img = p.image_front_url || p.image_url || p.selected_images?.front?.display?.en;
              if (img && typeof img === "string" && img.startsWith("http")) {
                results.push(img);
              }
            });
          }
        }
      } catch (inOffErr) {
        console.log("Indian OpenFoodFacts notice:", inOffErr);
      }

      // NO Wikipedia or Wikimedia Commons encyclopedic search!
      // This completely eliminates random non-product images (mountains, trees, historical photos, etc.)

      // Deduplicate results
      const unique = Array.from(new Set(results.filter(Boolean)));
      if (unique.length === 0) {
        unique.push(getGroceryImage(normTarget, "general"));
      }
      setWebSearchResults(unique);
    } catch (err) {
      console.warn("Web image search error:", err);
      setWebSearchResults([getGroceryImage(normTarget, "general")]);
    } finally {
      setWebSearchLoading(false);
    }
  };

  // Handle selecting an existing item from dropdown in Add Purchase modal
  const handleSelectExistingItem = (itemId) => {
    setSelectedExistingId(itemId);
    if (!itemId) {
      setFormItemName("");
      setFormRate("");
      setFormImage("");
      setFormKilo("");
      setFormGram("");
      setFormLitre("");
      setFormMl("");
      setFormPackCount("");
      return;
    }

    const allItems = [...rawMaterialsList, ...shopProductsList];
    const found = allItems.find((r) => r.id === itemId);
    if (found) {
      setFormItemName(found.name || found.itemName || "");
      setFormCategory(found.category || (reportMode === "restaurant" ? "Groceries" : "Stock"));
      const u = found.unit || found.unitType || "kg";
      setFormUnit(u);
      setFormRate(found.costPerUnit != null ? String(found.costPerUnit) : (found.purchasePrice != null ? String(found.purchasePrice) : ""));
      setFormImage(found.image || "");
      if (found.supplierName) setFormSupplier(found.supplierName);
    }
  };

  // Save new purchase record & update stock
  const handleSavePurchase = async (e) => {
    e.preventDefault();
    if (!currentUid) {
      alert("User not authenticated.");
      return;
    }

    const name = formItemName.trim();
    if (!name) {
      alert("Please enter item/grocery name.");
      return;
    }

    const qtyNum = effectiveQty > 0 ? effectiveQty : parseFloat(formQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      alert("Please enter a valid weight (kg/g), volume (L/ml), or quantity.");
      return;
    }

    const rateNum = parseFloat(formRate);
    if (isNaN(rateNum) || rateNum < 0) {
      alert("Please enter a valid rate/cost per unit.");
      return;
    }

    const totalAmt = Number((qtyNum * rateNum).toFixed(2));
    const resolvedImage = formImage.trim() || getGroceryImage(name, formCategory);
    setSavingPurchase(true);

    try {
      // Resolve active branch for this purchase
      const activeB = branches.find((b) => b.id === internalBranchId) || branches.find((b) => b.isPrimary || b.id === "main_branch") || { id: "main_branch", name: "Main Branch" };
      const branchIdToSave = internalBranchId && internalBranchId !== "all" ? internalBranchId : activeB.id;
      const branchNameToSave = activeB.name || internalBranchName || "Main Branch";

      // 1. Create Purchase record in Firestore tagged with branchId
      const purchaseData = {
        billNo: formBillNo.trim() || `PUR-${Date.now().toString().slice(-6)}`,
        invoiceId: formBillNo.trim() || `PUR-${Date.now().toString().slice(-6)}`,
        itemName: name,
        category: formCategory.trim() || (reportMode === "restaurant" ? "Groceries" : "Stock"),
        type: reportMode, // "restaurant" | "shop"
        qty: qtyNum,
        unit: formUnit.trim() || "unit",
        measurementDetail: measurementDetailText,
        rate: rateNum,
        purchasePrice: rateNum,
        totalAmount: totalAmt,
        supplierName: formSupplier.trim() || "Market / Vendor",
        paymentMode: formPaymentMode,
        purchaseDate: formDate,
        date: formDate,
        image: resolvedImage,
        notes: formNotes.trim(),
        branchId: branchIdToSave,
        branchName: branchNameToSave,
        createdAt: serverTimestamp(),
        recordedBy: userProfile.name || "Owner"
      };

      await addDoc(collection(db, "users", currentUid, "purchases"), purchaseData);

      // Record in mobile-compatible invoices collection
      const invoicesCol = isGlobalMode ? "global_invoices" : "invoices";
      await addDoc(collection(db, "users", currentUid, invoicesCol), {
        billNo: purchaseData.billNo,
        invoiceId: purchaseData.billNo,
        supplierName: purchaseData.supplierName,
        paymentMode: formPaymentMode,
        branchId: branchIdToSave,
        branchName: branchNameToSave,
        items: [
          {
            itemName: name,
            purchasePrice: rateNum,
            salesPrice: rateNum,
            qty: qtyNum,
            unitType: formUnit.trim() || "pcs"
          }
        ],
        total: totalAmt,
        createdAt: serverTimestamp()
      });

      // 2. Automatically update or create stock in Shop Inventory (users/{uid}/inventory) scoped to this branch
      const invCol = isGlobalMode ? "global_inventory" : "inventory";
      
      // Match existing items only within the SAME branch!
      const branchShopProducts = shopProductsList.filter((p) => itemMatchesBranch(p, branchIdToSave));
      const branchRawMaterials = rawMaterialsList.filter((r) => itemMatchesBranch(r, branchIdToSave));

      let existingProd = selectedExistingId ? branchShopProducts.find((p) => p.id === selectedExistingId) : null;
      if (!existingProd) {
        existingProd = branchShopProducts.find((p) => (p.itemName || p.name)?.toLowerCase().trim() === name.toLowerCase());
      }
      if (!existingProd) {
        existingProd = branchRawMaterials.find((r) => r.id === selectedExistingId || (r.name || "").toLowerCase().trim() === name.toLowerCase());
      }

      if (existingProd) {
        const curStock = Number(existingProd.quantity != null ? existingProd.quantity : (existingProd.stockQuantity || 0));
        const newStock = Number((curStock + qtyNum).toFixed(2));
        await updateDoc(doc(db, "users", currentUid, invCol, existingProd.id), {
          name: name,
          itemName: name,
          quantity: newStock,
          purchasePrice: rateNum,
          costPrice: rateNum,
          category: formCategory.trim() || existingProd.category || "Stock",
          unitType: formUnit.trim() || existingProd.unitType || existingProd.unit || "pcs",
          packQuantity: formPackSizeVal ? parseFloat(formPackSizeVal) : (existingProd.packQuantity || null),
          packUnit: formPackSizeVal ? formPackSizeUnit : (existingProd.packUnit || null),
          supplierName: formSupplier.trim() || existingProd.supplierName || "Vendor",
          image: resolvedImage || existingProd.image || "",
          branchId: branchIdToSave,
          branchName: branchNameToSave,
          updatedAt: serverTimestamp()
        });

        // Dual-write to raw_materials if doc exists
        try {
          await updateDoc(doc(db, "users", currentUid, "raw_materials", existingProd.id), {
            name: name,
            stockQuantity: newStock,
            costPerUnit: rateNum,
            packQuantity: formPackSizeVal ? parseFloat(formPackSizeVal) : (existingProd.packQuantity || null),
            packUnit: formPackSizeVal ? formPackSizeUnit : (existingProd.packUnit || null),
            supplierName: formSupplier.trim() || existingProd.supplierName || "",
            image: resolvedImage || existingProd.image || "",
            branchId: branchIdToSave,
            branchName: branchNameToSave,
            updatedAtMs: Date.now()
          });
        } catch (_) {}
      } else {
        const newDocRef = await addDoc(collection(db, "users", currentUid, invCol), {
          name: name,
          itemName: name,
          category: formCategory.trim() || "Stock",
          unitType: formUnit.trim() || "pcs",
          quantity: qtyNum,
          purchasePrice: rateNum,
          costPrice: rateNum,
          salesPrice: rateNum,
          price: rateNum,
          packQuantity: formPackSizeVal ? parseFloat(formPackSizeVal) : null,
          packUnit: formPackSizeVal ? formPackSizeUnit : null,
          image: resolvedImage,
          supplierName: formSupplier.trim() || "Vendor",
          branchId: branchIdToSave,
          branchName: branchNameToSave,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // Dual-write to raw_materials with same ID for recipe compatibility
        try {
          await setDoc(doc(db, "users", currentUid, "raw_materials", newDocRef.id), {
            name: name,
            category: formCategory.trim() || "Groceries",
            unit: formUnit.trim() || "kg",
            costPerUnit: rateNum,
            stockQuantity: qtyNum,
            packQuantity: formPackSizeVal ? parseFloat(formPackSizeVal) : null,
            packUnit: formPackSizeVal ? formPackSizeUnit : null,
            image: resolvedImage,
            supplierName: formSupplier.trim() || "Vendor",
            branchId: branchIdToSave,
            branchName: branchNameToSave,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now()
          });
        } catch (_) {}
      }

      setSavingPurchase(false);
      setShowAddModal(false);
      alert(`✅ Purchase of ₹${totalAmt.toLocaleString("en-IN")} recorded successfully for "${branchNameToSave}"!\nStock for "${name}" increased by +${qtyNum} ${formUnit}.`);
    } catch (err) {
      console.error("Save purchase error:", err);
      setSavingPurchase(false);
      alert("Error saving purchase: " + err.message);
    }
  };

  // Open Edit Item Modal ("dei apram ithula oru edit optionum set panniru da")
  const openEditItemModal = (item) => {
    if (!item) return;
    setEditingItem(item);
    setEditItemName(item.name || item.itemName || "");
    setEditCategory(item.category || "Stock");
    setShowEditAddCategory(false);
    setNewEditCategoryInput("");
    setEditStockQty(String(item.stockQuantity != null ? item.stockQuantity : (item.quantity ?? 0)));
    setEditUnit(item.unit || item.unitType || "pcs");
    setEditRate(String(item.costPerUnit != null ? item.costPerUnit : (item.purchasePrice ?? 0)));
    setEditPackCapacity(String(item.packQuantity || item.packCapacity || ""));
    setEditPackUnit(item.packUnit || item.packSubUnit || "ml");
    setEditMinAlert(String(item.minStockAlert || item.minAlertQuantity || 5));
    setEditSupplier(item.supplierName || item.latestSupplier || "");
    setEditImage(item.image || "");
  };

  // Add category inline from Edit modal
  const handleAddNewEditCategory = async () => {
    const name = newEditCategoryInput.trim();
    if (!name) return;
    setEditCategory(name);
    setShowEditAddCategory(false);
    setNewEditCategoryInput("");

    if (currentUid) {
      try {
        const catCol = isGlobalMode ? "global_categories" : "categories";
        await addDoc(collection(db, "users", currentUid, catCol), {
          name: name,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.warn("Category save notice:", err);
      }
    }
  };

  // Save changes to edited item in Shop Inventory
  const handleSaveEditedItem = async (e) => {
    e?.preventDefault();
    if (!currentUid || !editingItem) return;
    const name = editItemName.trim();
    if (!name) {
      alert("Please enter an item name.");
      return;
    }

    setSavingEdit(true);
    try {
      const stockQtyNum = Number(editStockQty) || 0;
      const rateNum = Number(editRate) || 0;
      const minAlertNum = Number(editMinAlert) || 5;
      const packCapNum = editPackCapacity ? parseFloat(editPackCapacity) : null;
      const resolvedImg = editImage.trim() || getGroceryImage(name, editCategory);
      
      const activeB = branches.find((b) => b.id === internalBranchId) || branches.find((b) => b.isPrimary || b.id === "main_branch") || { id: "main_branch", name: "Main Branch" };
      const branchIdToSave = editingItem.branchId || (internalBranchId !== "all" ? internalBranchId : activeB.id);
      const branchNameToSave = editingItem.branchName || branches.find((b) => b.id === branchIdToSave)?.name || internalBranchName || "Main Branch";

      // Save directly to Shop Inventory
      const invCol = isGlobalMode ? "global_inventory" : "inventory";
      const invRef = doc(db, "users", currentUid, invCol, editingItem.id);
      try {
        await updateDoc(invRef, {
          name: name,
          itemName: name,
          category: editCategory.trim() || "Stock",
          unitType: editUnit.trim() || "pcs",
          quantity: stockQtyNum,
          purchasePrice: rateNum,
          costPrice: rateNum,
          packQuantity: packCapNum,
          packUnit: packCapNum ? editPackUnit : null,
          minAlertQuantity: minAlertNum,
          supplierName: editSupplier.trim() || "Vendor",
          image: resolvedImg,
          branchId: branchIdToSave,
          branchName: branchNameToSave,
          updatedAt: serverTimestamp()
        });
      } catch (invErr) {
        // If doc only existed in raw_materials, create in inventory
        await setDoc(invRef, {
          name: name,
          itemName: name,
          category: editCategory.trim() || "Stock",
          unitType: editUnit.trim() || "pcs",
          quantity: stockQtyNum,
          purchasePrice: rateNum,
          costPrice: rateNum,
          packQuantity: packCapNum,
          packUnit: packCapNum ? editPackUnit : null,
          minAlertQuantity: minAlertNum,
          supplierName: editSupplier.trim() || "Vendor",
          image: resolvedImg,
          branchId: branchIdToSave,
          branchName: branchNameToSave,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      // Dual-sync to raw_materials if doc exists
      try {
        await updateDoc(doc(db, "users", currentUid, "raw_materials", editingItem.id), {
          name: name,
          category: editCategory.trim() || "Groceries",
          unit: editUnit.trim() || "kg",
          stockQuantity: stockQtyNum,
          costPerUnit: rateNum,
          packQuantity: packCapNum,
          packUnit: packCapNum ? editPackUnit : null,
          minStockAlert: minAlertNum,
          supplierName: editSupplier.trim() || "Vendor",
          image: resolvedImg,
          branchId: branchIdToSave,
          branchName: branchNameToSave,
          updatedAtMs: Date.now()
        });
      } catch (_) {}

      // Update selectedItemDetail if it was open
      if (selectedItemDetail && selectedItemDetail.id === editingItem.id) {
        setSelectedItemDetail((prev) => ({
          ...prev,
          name: name,
          category: editCategory.trim(),
          unit: editUnit.trim(),
          stockQuantity: stockQtyNum,
          costPerUnit: rateNum,
          supplierName: editSupplier.trim(),
          image: resolvedImg,
          packCapacity: packCapNum,
          packSubUnit: editPackUnit
        }));
      }

      setSavingEdit(false);
      setEditingItem(null);
      alert(`✅ Item "${name}" updated successfully!`);
    } catch (err) {
      console.error("Save edited item error:", err);
      setSavingEdit(false);
      alert("Error updating item: " + err.message);
    }
  };

  // Delete item from inventory
  const handleDeleteItem = async () => {
    if (!currentUid || !editingItem) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${editingItem.name}" from inventory? This cannot be undone.`
    );
    if (!confirmDelete) return;

    setSavingEdit(true);
    try {
      const invCol = isGlobalMode ? "global_inventory" : "inventory";
      try {
        await deleteDoc(doc(db, "users", currentUid, invCol, editingItem.id));
      } catch (_) {}
      try {
        await deleteDoc(doc(db, "users", currentUid, "raw_materials", editingItem.id));
      } catch (_) {}

      if (selectedItemDetail && selectedItemDetail.id === editingItem.id) {
        setSelectedItemDetail(null);
      }
      setSavingEdit(false);
      setEditingItem(null);
      alert(`🗑️ "${editingItem.name}" deleted successfully.`);
    } catch (err) {
      console.error("Delete item error:", err);
      setSavingEdit(false);
      alert("Error deleting item: " + err.message);
    }
  };

  // Combine actual purchase records + stock valuation items for Table View (Branch Filtered)
  const combinedRecords = useMemo(() => {
    const branchPurchases = purchasesList.filter((p) => itemMatchesBranch(p, internalBranchId));
    const branchShopProducts = shopProductsList.filter((p) => itemMatchesBranch(p, internalBranchId));

    if (branchPurchases.length === 0) {
      return branchShopProducts.map((it) => ({
        id: `stock-${it.id}`,
        billNo: "INITIAL-STOCK",
        itemName: it.name || it.itemName || "Stock Item",
        category: it.category || "Stock",
        type: "shop",
        qty: Number(it.quantity != null ? it.quantity : (it.stockQuantity || 0)),
        unit: it.unitType || it.unit || "unit",
        rate: Number(it.purchasePrice != null ? it.purchasePrice : (it.costPerUnit || 0)),
        totalAmount: Number(((Number(it.quantity ?? it.stockQuantity ?? 0)) * (Number(it.purchasePrice ?? it.costPerUnit ?? 0))).toFixed(2)),
        supplierName: it.supplierName || "Local Market",
        paymentMode: "Stock On Hand",
        purchaseDate: it.updatedAt ? new Date(it.updatedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        parsedDate: it.updatedAt ? new Date(it.updatedAt) : new Date(),
        isStockOnHand: true,
        image: it.image,
        branchId: it.branchId,
        branchName: it.branchName
      }));
    }

    return branchPurchases;
  }, [purchasesList, shopProductsList, internalBranchId, branches]);

  // Filtered Invoices/Records based on search, date range, and payment mode
  const filteredRecords = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    return combinedRecords.filter((rec) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (rec.itemName || "").toLowerCase().includes(q);
        const matchSupplier = (rec.supplierName || "").toLowerCase().includes(q);
        const matchBill = (rec.billNo || "").toLowerCase().includes(q);
        const matchCat = (rec.category || "").toLowerCase().includes(q);
        const matchBranch = (rec.branchName || "").toLowerCase().includes(q);
        if (!matchName && !matchSupplier && !matchBill && !matchCat && !matchBranch) return false;
      }

      if (paymentFilter !== "all" && rec.paymentMode !== paymentFilter) {
        return false;
      }

      const recDate = rec.parsedDate instanceof Date && !isNaN(rec.parsedDate) ? rec.parsedDate : new Date(rec.purchaseDate || Date.now());
      const recDateStr = recDate.toISOString().slice(0, 10);

      if (dateFilter === "today") {
        return recDateStr === todayStr;
      } else if (dateFilter === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return recDate >= weekAgo;
      } else if (dateFilter === "month") {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return recDate >= monthAgo;
      } else if (dateFilter === "custom") {
        if (customStartDate && recDateStr < customStartDate) return false;
        if (customEndDate && recDateStr > customEndDate) return false;
      }

      return true;
    }).sort((a, b) => (b.parsedDate || 0) - (a.parsedDate || 0));
  }, [combinedRecords, searchQuery, dateFilter, customStartDate, customEndDate, paymentFilter]);

  // Aggregated Product/Stock Cards for the Card Grid View
  // IMPORTANT: Single unified Shop Inventory (Branch Isolated & Zero dummy items!)
  const aggregatedCards = useMemo(() => {
    const branchShopProducts = shopProductsList.filter((p) => itemMatchesBranch(p, internalBranchId));
    const branchRawMaterials = rawMaterialsList.filter((r) => itemMatchesBranch(r, internalBranchId));
    const baseItems = [...branchShopProducts, ...branchRawMaterials];
    const branchPurchases = purchasesList.filter((p) => itemMatchesBranch(p, internalBranchId));
    const cardsMap = new Map();

    baseItems.forEach((item) => {
      const name = (item.name || item.itemName || "").trim();
      if (!name) return;
      if (DUMMY_STARTER_NAMES.has(name.toLowerCase())) return; // Filter out dummy starter items!
      const key = (internalBranchId === "all" ? `${item.branchId || "main"}_` : "") + name.toLowerCase();

      if (!cardsMap.has(key)) {
        cardsMap.set(key, {
          id: item.id,
          name: name,
          category: item.category || "Stock",
          stockQuantity: item.quantity != null ? Number(item.quantity || 0) : Number(item.stockQuantity || 0),
          unit: item.unitType || item.unit || "pcs",
          costPerUnit: item.purchasePrice != null ? Number(item.purchasePrice || 0) : Number(item.costPerUnit || 0),
          image: item.image || item.imageUrl || "",
          supplierName: item.supplierName || "",
          minStockAlert: Number(item.minAlertQuantity || item.minStockAlert || 5),
          packQuantity: item.packQuantity || null,
          packUnit: item.packUnit || null,
          branchId: item.branchId || internalBranchId,
          branchName: item.branchName || branches.find(b => b.id === (item.branchId || internalBranchId))?.name || internalBranchName,
          totalPurchasedQty: 0,
          totalSpent: 0,
          suppliers: new Set(item.supplierName ? [item.supplierName] : []),
          history: []
        });
      }
    });

    // Populate purchase history and total bought from branchPurchases
    branchPurchases.forEach((p) => {
      const pName = (p.itemName || "").trim();
      if (!pName) return;
      if (DUMMY_STARTER_NAMES.has(pName.toLowerCase())) return;

      const key = (internalBranchId === "all" ? `${p.branchId || "main"}_` : "") + pName.toLowerCase();
      let card = cardsMap.get(key);
      if (!card) {
        card = {
          id: p.id,
          name: pName,
          category: p.category || "Stock",
          stockQuantity: Number(p.qty || 0),
          unit: p.unit || "pcs",
          costPerUnit: Number(p.rate || 0),
          image: p.image || "",
          supplierName: p.supplierName || "",
          minStockAlert: 5,
          branchId: p.branchId || internalBranchId,
          branchName: p.branchName || branches.find(b => b.id === (p.branchId || internalBranchId))?.name || internalBranchName,
          totalPurchasedQty: 0,
          totalSpent: 0,
          suppliers: new Set(),
          history: []
        };
        cardsMap.set(key, card);
      }

      card.totalPurchasedQty += Number(p.qty || 0);
      card.totalSpent += Number(p.totalAmount || 0);
      if (p.supplierName) card.suppliers.add(p.supplierName.trim());
      card.history.push(p);
    });

    // Finalize card values
    const list = Array.from(cardsMap.values()).map((c) => {
      const totalPurchased = c.totalPurchasedQty > 0 ? c.totalPurchasedQty : c.stockQuantity;
      const totalSpend = c.totalSpent > 0 ? c.totalSpent : Number((c.stockQuantity * c.costPerUnit).toFixed(2));
      const suppliersArr = Array.from(c.suppliers).filter(Boolean);

      // Find if this ingredient is used in any recipe
      const matchingRecipeIng = userRecipes
        .flatMap((r) => (r.ingredients || []).map((ing) => ({ ...ing, dishName: r.dishName || r.name })))
        .find((ing) => {
          const iName = (ing.name || "").toLowerCase().trim();
          const cardName = c.name.toLowerCase().trim();
          return iName === cardName || (ing.rawMaterialId && ing.rawMaterialId === c.id);
        });

      const packCapacity = c.packQuantity || matchingRecipeIng?.packQuantity || (c.name.toLowerCase().includes("milk") ? 500 : (c.unit === "kg" || c.unit === "L") ? 1000 : 500);
      const packSubUnit = c.packUnit || matchingRecipeIng?.packUnit || (c.name.toLowerCase().includes("milk") ? "ml" : ["kg", "g"].includes(c.unit) ? "g" : ["l", "ml"].includes(c.unit) ? "ml" : "ml");

      const stockFormatted = formatRawStockDisplay(
        c.stockQuantity,
        c.unit,
        packCapacity,
        packSubUnit
      );

      const totalPurchasedFormatted = formatRawStockDisplay(
        totalPurchased,
        c.unit,
        packCapacity,
        packSubUnit
      );

      return {
        ...c,
        packCapacity,
        packSubUnit,
        stockFormatted,
        totalPurchasedFormatted,
        recipeInfo: matchingRecipeIng || null,
        totalPurchasedQty: Number(totalPurchased.toFixed(2)),
        totalSpent: Math.round(totalSpend),
        suppliersList: suppliersArr.length > 0 ? suppliersArr : [c.supplierName || "Walk-in Supplier"],
        latestSupplier: suppliersArr[0] || c.supplierName || "Walk-in Supplier",
        history: c.history.sort((a, b) => (b.parsedDate || 0) - (a.parsedDate || 0))
      };
    });

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        (c.branchName && c.branchName.toLowerCase().includes(q)) ||
        c.suppliersList.some((s) => s.toLowerCase().includes(q))
      );
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [rawMaterialsList, shopProductsList, purchasesList, searchQuery, userRecipes, internalBranchId, branches]);

  // Summary Metrics
  const summary = useMemo(() => {
    let totalSpend = 0;
    let totalQty = 0;
    const suppliersSet = new Set();
    const itemsSet = new Set();

    filteredRecords.forEach((r) => {
      totalSpend += Number(r.totalAmount || 0);
      totalQty += Number(r.qty || 0);
      if (r.supplierName) suppliersSet.add(r.supplierName.trim().toLowerCase());
      if (r.itemName) itemsSet.add(r.itemName.trim().toLowerCase());
    });

    return {
      totalSpend: Math.round(totalSpend),
      totalQty: Number(totalQty.toFixed(1)),
      itemCount: itemsSet.size || aggregatedCards.length,
      supplierCount: suppliersSet.size || 1
    };
  }, [filteredRecords, aggregatedCards]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) {
      alert("No purchase records to export.");
      return;
    }

    const headers = [
      "Invoice/Bill No",
      "Date",
      "Item / Grocery Name",
      "Type",
      "Category",
      "Quantity",
      "Unit",
      "Rate (INR)",
      "Total Amount (INR)",
      "Supplier",
      "Payment Mode",
      "Notes"
    ];

    const rows = filteredRecords.map((r) => [
      `"${(r.billNo || "").replace(/"/g, '""')}"`,
      r.purchaseDate || (r.parsedDate ? r.parsedDate.toISOString().slice(0, 10) : ""),
      `"${(r.itemName || "").replace(/"/g, '""')}"`,
      r.type === "restaurant" ? "Restaurant Grocery" : "Shop Stock",
      `"${(r.category || "").replace(/"/g, '""')}"`,
      r.qty || 0,
      r.unit || "unit",
      Number(r.rate || 0).toFixed(2),
      Number(r.totalAmount || 0).toFixed(2),
      `"${(r.supplierName || "").replace(/"/g, '""')}"`,
      r.paymentMode || "Cash",
      `"${(r.notes || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Purchase_Report_${reportMode}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate Clean Standalone HTML for Official Purchase Invoice Report
  const generatePurchaseReportPrintHtml = () => {
    const sName = userProfile.storeName || userProfile.businessName || "Turf Cafe";
    const activeB = branches.find((b) => b.id === internalBranchId);
    const bName = internalBranchId === "all" ? "All Outlets Combined" : (activeB?.name || internalBranchName || userProfile.branchName || "");
    const phone = userProfile.phone || userProfile.phoneNumber || "";
    const gstin = userProfile.gstNumber || userProfile.gstin || "";
    const address = userProfile.address || "";

    const now = new Date();
    const printDate = now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
    const printTime = now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });

    const periodLabel = dateFilter === "all"
      ? "All Time Records"
      : dateFilter === "today"
      ? `Today (${now.toLocaleDateString("en-IN")})`
      : dateFilter === "week"
      ? "Past 7 Days"
      : dateFilter === "month"
      ? "This Month"
      : `${customStartDate || "Start"} to ${customEndDate || "End"}`;

    const reportTypeName = reportMode === "restaurant"
      ? "RESTAURANT GROCERY & FOOD INGREDIENTS PURCHASE REPORT"
      : "SHOP INVENTORY & STOCK PURCHASES REPORT";

    const reportSubText = reportMode === "restaurant"
      ? "Official kitchen provisions, raw materials & grocery purchase invoices log"
      : "Official inventory stock purchases & vendor supplies log";

    const rowsHtml = filteredRecords.map((r, idx) => {
      const dStr = r.purchaseDate || (r.parsedDate ? r.parsedDate.toISOString().slice(0, 10) : "-");
      const bNo = r.billNo || "DIRECT";
      const iName = r.itemName || "Item";
      const cat = r.category || (reportMode === "restaurant" ? "Groceries" : "Stock");
      const qtyStr = `${r.qty || 0} ${r.unit || ""}`;
      const rateStr = `₹${Number(r.rate || 0).toFixed(2)}`;
      const amtStr = `₹${Number(r.totalAmount || 0).toLocaleString("en-IN")}`;
      const sup = r.supplierName || "Walk-in Supplier";
      const pay = r.paymentMode || "Cash";

      return `
        <tr>
          <td style="text-align: center; font-weight: 700; color: #64748b;">${idx + 1}</td>
          <td style="white-space: nowrap;">${dStr}</td>
          <td><span class="bill-tag">${bNo}</span></td>
          <td style="font-weight: 800; color: #0f172a;">${iName}</td>
          <td>${cat}</td>
          <td style="text-align: right; font-weight: 800;">${qtyStr}</td>
          <td style="text-align: right;">${rateStr}</td>
          <td style="text-align: right; font-weight: 900; color: #15803d;">${amtStr}</td>
          <td>${sup}</td>
          <td style="text-align: center;">
            <span class="pay-pill ${pay.toLowerCase()}">${pay}</span>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Purchase_Invoice_Report_${sName.replace(/\\s+/g, '_')}_${now.toISOString().slice(0,10)}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 10mm 12mm;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 11px;
            color: #0f172a;
            background: #ffffff;
            padding: 4px;
          }
          .header-box {
            border-bottom: 2.5px solid #0f172a;
            padding-bottom: 10px;
            margin-bottom: 12px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .store-name {
            font-size: 22px;
            font-weight: 900;
            color: #0f172a;
            letter-spacing: -0.3px;
          }
          .store-branch {
            font-size: 11px;
            font-weight: 800;
            color: #475569;
            margin-top: 2px;
          }
          .store-contact {
            font-size: 10px;
            color: #64748b;
            margin-top: 2px;
          }
          .report-meta-box {
            text-align: right;
          }
          .report-main-title {
            font-size: 13px;
            font-weight: 900;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }
          .report-sub-title {
            font-size: 9.5px;
            color: #64748b;
            margin-top: 2px;
          }
          .meta-pill {
            display: inline-block;
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            padding: 2px 7px;
            border-radius: 4px;
            font-size: 9.5px;
            font-weight: 800;
            color: #334155;
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            margin-top: 4px;
          }
          th {
            background-color: #f1f5f9;
            color: #1e293b;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 9px;
            letter-spacing: 0.3px;
            padding: 6px 7px;
            border: 1px solid #cbd5e1;
            text-align: left;
          }
          td {
            padding: 6px 7px;
            border: 1px solid #e2e8f0;
            color: #334155;
          }
          tr:nth-child(even) td {
            background-color: #fafbfc;
          }
          tr {
            page-break-inside: avoid;
          }
          .bill-tag {
            font-family: monospace;
            font-weight: 800;
            font-size: 9px;
            background: #f1f5f9;
            padding: 1.5px 4px;
            border-radius: 3px;
            border: 1px solid #cbd5e1;
            display: inline-block;
          }
          .pay-pill {
            font-size: 8.5px;
            font-weight: 800;
            padding: 1px 5px;
            border-radius: 4px;
            border: 1px solid #cbd5e1;
            display: inline-block;
          }
          .pay-pill.cash { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
          .pay-pill.upi { background: #e0e7ff; color: #4338ca; border-color: #c7d2fe; }
          .pay-pill.credit { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
          .tfoot-grand td {
            background-color: #f1f5f9;
            font-weight: 900;
            color: #0f172a;
            border-top: 2px solid #0f172a;
            border-bottom: 2px solid #0f172a;
            padding: 8px 7px;
          }
          .sign-section {
            margin-top: 36px;
            padding-top: 10px;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
          }
          .sign-col {
            width: 180px;
            text-align: center;
            border-top: 1px dashed #64748b;
            padding-top: 5px;
            font-size: 9.5px;
            color: #475569;
            font-weight: 700;
          }
          .footer-strip {
            margin-top: 24px;
            border-top: 1px solid #e2e8f0;
            padding-top: 6px;
            display: flex;
            justify-content: space-between;
            font-size: 8.5px;
            color: #94a3b8;
          }
        </style>
      </head>
      <body>
        <div class="header-box">
          <div>
            <div class="store-name">${sName}</div>
            ${bName ? `<div class="store-branch">📍 ${bName}</div>` : ""}
            ${address ? `<div class="store-contact">${address}</div>` : ""}
            ${phone || gstin ? `<div class="store-contact">${phone ? `📞 ${phone}` : ""} ${gstin ? ` | GSTIN: ${gstin}` : ""}</div>` : ""}
          </div>
          <div class="report-meta-box">
            <div class="report-main-title">${reportTypeName}</div>
            <div class="report-sub-title">${reportSubText}</div>
            <div class="meta-pill">📅 Period: ${periodLabel}</div>
            <div style="font-size: 9px; color: #64748b; margin-top: 3px;">Printed: ${printDate} at ${printTime}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 28px; text-align: center;">#</th>
              <th style="width: 75px;">Date</th>
              <th style="width: 90px;">Bill / Inv</th>
              <th>${reportMode === "restaurant" ? "Grocery / Food Ingredient" : "Product / Stock Item"}</th>
              <th style="width: 85px;">Category</th>
              <th style="width: 75px; text-align: right;">Quantity</th>
              <th style="width: 65px; text-align: right;">Rate (₹)</th>
              <th style="width: 85px; text-align: right;">Total (₹)</th>
              <th style="width: 105px;">Supplier</th>
              <th style="width: 65px; text-align: center;">Payment</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="10" style="text-align: center; padding: 25px; color: #64748b;">No purchase records found for the selected period.</td></tr>`}
          </tbody>
          ${filteredRecords.length > 0 ? `
            <tfoot>
              <tr class="tfoot-grand">
                <td colspan="5" style="text-align: right;">GRAND TOTAL (${filteredRecords.length} Invoices):</td>
                <td style="text-align: right;">${summary.totalQty} Units</td>
                <td></td>
                <td style="text-align: right; color: #15803d; font-size: 11px;">₹${summary.totalSpend.toLocaleString("en-IN")}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          ` : ""}
        </table>

        <div class="sign-section">
          <div class="sign-col">Prepared by / Store Incharge</div>
          <div class="sign-col">Accounts / Verified by</div>
          <div class="sign-col">Authorized Signature</div>
        </div>

        <div class="footer-strip">
          <span>Kadai Pro POS &bull; Purchase Management System</span>
          <span>Page 1 of 1 &bull; Confidential & Internal Store Document</span>
        </div>
      </body>
      </html>
    `;
  };

  // Dedicated Print Function - Isolates Purchase Invoice Report from the rest of the web app
  const handlePrint = () => {
    if (filteredRecords.length === 0) {
      alert("No purchase invoice records found to print.");
      return;
    }

    const printHtml = generatePurchaseReportPrintHtml();

    // Create an isolated hidden iframe
    let iframe = document.getElementById("kadai_purchase_print_iframe");
    if (iframe) {
      iframe.remove();
    }
    iframe = document.createElement("iframe");
    iframe.id = "kadai_purchase_print_iframe";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.zIndex = "-9999";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(printHtml);
    doc.close();

    // Wait a brief tick for render, then trigger print
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.error("Iframe print error:", err);
        // Fallback: window.open popup
        const printWindow = window.open("", "_blank", "width=850,height=700");
        if (printWindow) {
          printWindow.document.write(printHtml);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
        }
      } finally {
        setTimeout(() => {
          if (iframe && iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }, 60000);
      }
    }, 250);
  };

  // Keyboard shortcut listener: Cmd+P / Ctrl+P prints the clean purchase report instead of whole browser window
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredRecords, summary, reportMode, dateFilter, customStartDate, customEndDate, paymentFilter, userProfile]);

  return (
    <div style={styles.container}>
      {/* Top Header Bar */}
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "22px" }}>📊</span>
              <h1 style={styles.title}>Shop Inventory & Purchase Report</h1>
            </div>
          </div>
        </div>

        {/* Action Buttons: Add Purchase, Print & Export */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={openNewPurchaseModal} style={styles.recordBtn}>
            <span style={{ fontSize: "15px" }}>➕</span>
            <span>Record Purchase</span>
          </button>
          <button type="button" onClick={handlePrint} style={styles.printBtn}>
            <span style={{ fontSize: "15px" }}>🖨️</span>
            <span>Print Report</span>
          </button>
          <button type="button" onClick={handleExportCsv} style={styles.exportBtn}>
            <span style={{ fontSize: "15px" }}>📥</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Total Purchase Expenditure</span>
            <span style={{ fontSize: "20px" }}>💰</span>
          </div>
          <div style={styles.statValue}>₹{summary.totalSpend.toLocaleString("en-IN")}</div>
          <div style={styles.statSub}>For selected period & filters</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Total Inventory Items</span>
            <span style={{ fontSize: "20px" }}>📦</span>
          </div>
          <div style={styles.statValue}>{aggregatedCards.length}</div>
          <div style={styles.statSub}>Items in Shop Inventory</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Total Quantity Purchased</span>
            <span style={{ fontSize: "20px" }}>⚖️</span>
          </div>
          <div style={styles.statValue}>{summary.totalQty}</div>
          <div style={styles.statSub}>Total Units / Weight in Inventory</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statHeader}>
            <span style={styles.statLabel}>Active Suppliers / Vendors</span>
            <span style={{ fontSize: "20px" }}>🚚</span>
          </div>
          <div style={styles.statValue}>{summary.supplierCount}</div>
          <div style={styles.statSub}>Suppliers in selected records</div>
        </div>
      </div>

      {/* View Switcher Bar: Card Grid View (Default) vs Table View */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: "800", color: "#475569" }}>View Layout:</span>
          <div style={{ display: "inline-flex", backgroundColor: "#f1f5f9", padding: "3px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "none",
                fontSize: "12.5px",
                fontWeight: "800",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: viewMode === "cards" ? "#0f172a" : "transparent",
                color: viewMode === "cards" ? "#ffffff" : "#475569",
                boxShadow: viewMode === "cards" ? "0 2px 6px rgba(15, 23, 42, 0.2)" : "none",
                transition: "all 0.15s ease"
              }}
            >
              <span>🖼️</span>
              <span>Items Grid View ({aggregatedCards.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                border: "none",
                fontSize: "12.5px",
                fontWeight: "800",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: viewMode === "table" ? "#0f172a" : "transparent",
                color: viewMode === "table" ? "#ffffff" : "#475569",
                boxShadow: viewMode === "table" ? "0 2px 6px rgba(15, 23, 42, 0.2)" : "none",
                transition: "all 0.15s ease"
              }}
            >
              <span>📋</span>
              <span>Invoices Table ({filteredRecords.length})</span>
            </button>
          </div>
        </div>

        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>
          💡 Click any item card to see supplier history, total purchased amount & invoices!
        </div>
      </div>

      {/* Filters Bar */}
      <div className="no-print" style={styles.filterCard}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: "220px" }}>
          <label style={styles.filterLabel}>Search Records</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={reportMode === "restaurant" ? "Search grocery, milk, chicken, supplier, bill..." : "Search product, stock, supplier, invoice..."}
            style={styles.searchInput}
          />
        </div>

        {/* Date Filter Pills */}
        <div>
          <label style={styles.filterLabel}>Date Range</label>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All Time" },
              { id: "today", label: "Today" },
              { id: "week", label: "Past 7 Days" },
              { id: "month", label: "This Month" },
              { id: "custom", label: "Custom Date" }
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDateFilter(d.id)}
                style={{
                  ...styles.datePill,
                  backgroundColor: dateFilter === d.id ? "#0f172a" : "#f8fafc",
                  color: dateFilter === d.id ? "#ffffff" : "#475569",
                  borderColor: dateFilter === d.id ? "#0f172a" : "#cbd5e1"
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Inputs */}
        {dateFilter === "custom" && (
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <div>
              <label style={styles.filterLabel}>From Date</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={styles.dateInput}
              />
            </div>
            <div>
              <label style={styles.filterLabel}>To Date</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={styles.dateInput}
              />
            </div>
          </div>
        )}

        {/* Payment Filter */}
        <div>
          <label style={styles.filterLabel}>Payment Mode</label>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            style={styles.selectInput}
          >
            <option value="all">All Payment Modes</option>
            <option value="Cash">Cash</option>
            <option value="UPI">UPI / Online</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Credit">Credit / Unpaid</option>
            <option value="Stock On Hand">Stock On Hand</option>
          </select>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 1. CARD GRID VIEW (Default - like Menu Items with images & quantity) */}
      {/* ============================================================== */}
      {viewMode === "cards" && (
        <div>
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px", color: "#64748b", fontWeight: "700" }}>
              Loading purchased stock items...
            </div>
          ) : aggregatedCards.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px", backgroundColor: "#fff", borderRadius: "14px", border: "1px dashed #cbd5e1" }}>
              <div style={{ fontSize: "36px", marginBottom: "8px" }}>🛒</div>
              <div style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                No Purchased Stock Found in {branches.find(b => b.id === internalBranchId)?.name || internalBranchName || "Selected Outlet"}
              </div>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                This branch has its own isolated stock inventory. Click below to record purchases or stock specifically for this branch!
              </p>
              <button
                type="button"
                onClick={openNewPurchaseModal}
                style={{ ...styles.recordBtn, marginTop: "12px", display: "inline-flex" }}
              >
                ➕ Record First Purchase for {branches.find(b => b.id === internalBranchId)?.name || internalBranchName}
              </button>
            </div>
          ) : (
            <div style={styles.productGrid}>
              {aggregatedCards.map((item) => {
                const imgUrl = getGroceryImage(item.name, item.category, item.image);
                const isLow = item.stockQuantity <= item.minStockAlert;

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedItemDetail(item)}
                    style={{
                      ...styles.productCard,
                      cursor: "pointer",
                      border: isLow ? "1.5px solid #fca5a5" : "1px solid #f1f5f9"
                    }}
                    title="Click to view purchase details, supplier & invoices"
                  >
                    {/* Image with Stock Badge */}
                    <div style={styles.imageWrapper}>
                      <img
                        src={imgUrl}
                        alt={item.name}
                        style={styles.productImg}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = getGroceryImage("grocery", "general");
                        }}
                      />
                      {/* Floating Stock Badge */}
                      <span
                        style={{
                          ...styles.stockBadge,
                          backgroundColor: isLow ? "rgba(220, 38, 38, 0.88)" : "rgba(15, 23, 42, 0.78)"
                        }}
                      >
                        {isLow
                          ? `⚠️ Low: ${item.stockFormatted?.formatted || `${item.stockQuantity} ${item.unit}`}`
                          : `Stock: ${item.stockFormatted?.formatted || `${item.stockQuantity} ${item.unit}`}`}
                      </span>

                      {/* Outlet Badge when viewing All Branches */}
                      {internalBranchId === "all" && item.branchName && (
                        <span
                          style={{
                            position: "absolute",
                            top: "8px",
                            left: "8px",
                            backgroundColor: "rgba(79, 70, 229, 0.92)",
                            color: "#ffffff",
                            padding: "2px 7px",
                            borderRadius: "6px",
                            fontSize: "9.5px",
                            fontWeight: "800",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.15)"
                          }}
                        >
                          📍 {item.branchName}
                        </span>
                      )}

                      {/* Category Tag Top Right */}
                      <span
                        style={{
                          position: "absolute",
                          top: "8px",
                          right: "8px",
                          backgroundColor: "rgba(255, 255, 255, 0.92)",
                          color: "#0f172a",
                          padding: "2px 7px",
                          borderRadius: "6px",
                          fontSize: "10px",
                          fontWeight: "800",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                        }}
                      >
                        {item.category}
                      </span>
                    </div>

                    {/* Product Details Section */}
                    <div style={styles.productDetails}>
                      <div>
                        <h4 style={styles.productName} title={item.name}>
                          {item.name}
                        </h4>

                        {/* Medium Stock Available Row */}
                        <div style={{ marginTop: "4px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "6px" }}>
                          <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" }}>
                            Available:
                          </span>
                          <span style={{ fontSize: "13.5px", fontWeight: "900", color: isLow ? "#dc2626" : "#16a34a" }}>
                            {item.stockFormatted?.formatted || `${item.stockQuantity} ${item.unit}`}
                          </span>
                        </div>

                        {/* Breakdown Sub-detail */}
                        {item.stockFormatted?.fractionSubUnits > 0 && item.stockFormatted.detail ? (
                          <div style={{ fontSize: "10.5px", fontWeight: "600", color: "#64748b", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.stockFormatted.detail}>
                            ({item.stockFormatted.detail})
                          </div>
                        ) : item.measurementDetail ? (
                          <div style={{ fontSize: "10.5px", fontWeight: "600", color: "#64748b", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.measurementDetail}>
                            ({item.measurementDetail})
                          </div>
                        ) : null}

                        {/* Rate & Supplier Row */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11.5px", color: "#475569", fontWeight: "700", marginTop: "4px" }}>
                          <span>Rate: <strong style={{ color: "#0f172a" }}>₹{item.costPerUnit || 0}</strong> / {item.unit}</span>
                          {item.latestSupplier && (
                            <span style={{ fontSize: "10.5px", color: "#94a3b8", maxWidth: "90px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.latestSupplier}>
                              🚚 {item.latestSupplier}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Bottom Action Bar */}
                      <div style={{ marginTop: "8px", display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedItemDetail(item);
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            backgroundColor: "#f1f5f9",
                            color: "#0f172a",
                            border: "1px solid #cbd5e1",
                            borderRadius: "7px",
                            fontWeight: "800",
                            fontSize: "11.5px",
                            cursor: "pointer"
                          }}
                        >
                          🔍 Details
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPurchaseForSpecificItem(item);
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 8px",
                            backgroundColor: "#fff7ed",
                            color: "#ea580c",
                            border: "1px solid #fed7aa",
                            borderRadius: "7px",
                            fontWeight: "800",
                            fontSize: "11.5px",
                            cursor: "pointer"
                          }}
                        >
                          ➕ Restock
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. TABLE VIEW (Invoices Log & Records) */}
      {/* ============================================================== */}
      {viewMode === "table" && (
        <div style={styles.tableCard}>
          <div style={styles.tableHeaderBar}>
            <div style={{ fontWeight: "800", fontSize: "14px", color: "#1e293b" }}>
              {reportMode === "restaurant" ? "Grocery Purchase Invoices & Stock Log" : "Stock Purchase Invoices & Product Log"}
              <span style={{ marginLeft: "8px", color: "#64748b", fontWeight: "600", fontSize: "12px" }}>
                ({filteredRecords.length} records found)
              </span>
            </div>
            {filteredRecords.length > 0 && (
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                Total: <span style={{ color: "#16a34a" }}>₹{summary.totalSpend.toLocaleString("en-IN")}</span>
              </div>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thRow}>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Bill / Invoice</th>
                  {internalBranchId === "all" && <th style={styles.th}>Outlet</th>}
                  <th style={styles.th}>{reportMode === "restaurant" ? "Grocery / Ingredient" : "Product / Stock"}</th>
                  <th style={styles.th}>Category</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Quantity</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Rate (₹)</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Total (₹)</th>
                  <th style={styles.th}>Supplier</th>
                  <th style={styles.th}>Payment</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={internalBranchId === "all" ? 10 : 9} style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                      Loading purchase records...
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={internalBranchId === "all" ? 10 : 9} style={{ padding: "50px", textAlign: "center", color: "#94a3b8" }}>
                      <div style={{ fontSize: "32px", marginBottom: "6px" }}>🛒</div>
                      <div style={{ fontWeight: "700", fontSize: "14px", color: "#475569" }}>No purchase records found</div>
                      <div style={{ fontSize: "12px", marginTop: "4px" }}>Click "+ Record Purchase" above to log your groceries or stock purchases!</div>
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((r, idx) => {
                    const dateStr = r.purchaseDate || (r.parsedDate ? r.parsedDate.toISOString().slice(0, 10) : "");
                    const isEven = idx % 2 === 0;
                    return (
                      <tr key={r.id || idx} style={isEven ? styles.trEven : styles.trOdd}>
                        <td style={styles.td}>{dateStr}</td>
                        <td style={styles.td}>
                          <span style={styles.billBadge}>{r.billNo || "DIRECT"}</span>
                        </td>
                        {internalBranchId === "all" && (
                          <td style={styles.td}>
                            <span style={{ fontSize: "11px", fontWeight: "700", color: "#4338ca", backgroundColor: "#e0e7ff", padding: "2px 7px", borderRadius: "5px" }}>
                              📍 {r.branchName || "Main Outlet"}
                            </span>
                          </td>
                        )}
                        <td style={{ ...styles.td, fontWeight: "700", color: "#0f172a" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <img
                              src={getGroceryImage(r.itemName, r.category, r.image)}
                              alt={r.itemName}
                              style={{ width: "26px", height: "26px", borderRadius: "5px", objectFit: "cover" }}
                            />
                            <span>{r.itemName}</span>
                          </div>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.catBadge}>{r.category || (reportMode === "restaurant" ? "Groceries" : "Stock")}</span>
                        </td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: "700" }}>
                          {r.qty} {r.unit || "unit"}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right" }}>
                          ₹{Number(r.rate || 0).toFixed(2)}
                        </td>
                        <td style={{ ...styles.td, textAlign: "right", fontWeight: "800", color: "#16a34a" }}>
                          ₹{Number(r.totalAmount || 0).toLocaleString("en-IN")}
                        </td>
                        <td style={styles.td}>{r.supplierName || "Walk-in Supplier"}</td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.payBadge,
                            backgroundColor: r.paymentMode === "Cash" ? "#dcfce7" : r.paymentMode === "UPI" ? "#e0e7ff" : r.paymentMode === "Credit" ? "#fee2e2" : "#f1f5f9",
                            color: r.paymentMode === "Cash" ? "#15803d" : r.paymentMode === "UPI" ? "#4338ca" : r.paymentMode === "Credit" ? "#b91c1c" : "#475569",
                            borderColor: r.paymentMode === "Cash" ? "#bbf7d0" : r.paymentMode === "UPI" ? "#c7d2fe" : r.paymentMode === "Credit" ? "#fecaca" : "#e2e8f0",
                          }}>
                            {r.paymentMode || "Cash"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredRecords.length > 0 && (
                <tfoot>
                  <tr style={{ backgroundColor: "#f8fafc", borderTop: "2px solid #cbd5e1", fontWeight: "800" }}>
                    <td colSpan={internalBranchId === "all" ? 5 : 4} style={{ padding: "12px 14px", textAlign: "right", color: "#334155" }}>
                      Grand Total ({filteredRecords.length} entries):
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#0f172a" }}>
                      {summary.totalQty} Units
                    </td>
                    <td style={{ padding: "12px 14px" }}></td>
                    <td style={{ padding: "12px 14px", textAlign: "right", color: "#16a34a", fontSize: "15px" }}>
                      ₹{summary.totalSpend.toLocaleString("en-IN")}
                    </td>
                    <td colSpan="2"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. ITEM PURCHASE DETAIL MODAL ("antha item a click panna show aakura mathiri") */}
      {/* ============================================================== */}
      {selectedItemDetail && (
        <div style={styles.modalOverlay} onClick={() => setSelectedItemDetail(null)}>
          <div
            style={{
              ...styles.modalCard,
              maxWidth: "760px"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <img
                  src={getGroceryImage(selectedItemDetail.name, selectedItemDetail.category, selectedItemDetail.image)}
                  alt={selectedItemDetail.name}
                  style={{ width: "50px", height: "50px", borderRadius: "10px", objectFit: "cover" }}
                />
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "900", color: "#0f172a" }}>
                    {selectedItemDetail.name}
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Category: <strong>{selectedItemDetail.category}</strong> • Base Unit: <strong>{selectedItemDetail.unit}</strong> • Outlet: <strong style={{ color: "#4f46e5" }}>{selectedItemDetail.branchName || branches.find(b => b.id === internalBranchId)?.name || internalBranchName || "Main Outlet"}</strong>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => openEditItemModal(selectedItemDetail)}
                  style={{
                    backgroundColor: "#eff6ff",
                    color: "#2563eb",
                    border: "1px solid #bfdbfe",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                  title="Edit item details, price, category & photo"
                >
                  <span>✏️</span>
                  <span>Edit Item</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedItemDetail(null)}
                  style={styles.closeBtn}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Metrics Grid for this item */}
            <div style={{ padding: "18px 20px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", textAlign: "center" }}>
                <div style={{ backgroundColor: "#ffffff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                    Available Stock
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: "900", color: "#16a34a", marginTop: "2px" }}>
                    {selectedItemDetail.stockFormatted?.formatted || `${selectedItemDetail.stockQuantity} ${selectedItemDetail.unit}`}
                  </div>
                  {selectedItemDetail.stockFormatted?.detail && (
                    <div style={{ fontSize: "10.5px", color: "#64748b", fontWeight: "700", marginTop: "2px" }}>
                      {selectedItemDetail.stockFormatted.detail}
                    </div>
                  )}
                </div>

                <div style={{ backgroundColor: "#ffffff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                    Total Purchased
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: "900", color: "#0284c7", marginTop: "2px" }}>
                    {selectedItemDetail.totalPurchasedFormatted?.formatted || `${selectedItemDetail.totalPurchasedQty} ${selectedItemDetail.unit}`}
                  </div>
                </div>

                <div style={{ backgroundColor: "#ffffff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                    Total Spent
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: "900", color: "#ea580c", marginTop: "2px" }}>
                    ₹{selectedItemDetail.totalSpent.toLocaleString("en-IN")}
                  </div>
                </div>

                <div style={{ backgroundColor: "#ffffff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>
                    Current Rate
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: "900", color: "#0f172a", marginTop: "2px" }}>
                    ₹{selectedItemDetail.costPerUnit} / {selectedItemDetail.unit}
                  </div>
                </div>
              </div>

              {/* Suppliers List ("yarta purchase pannirukkom") */}
              <div style={{ marginTop: "12px", backgroundColor: "#ffffff", padding: "10px 14px", borderRadius: "10px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "16px" }}>🚚</span>
                <span style={{ fontSize: "12.5px", fontWeight: "700", color: "#334155" }}>
                  Suppliers & Vendors Purchased From:
                </span>
                <span style={{ fontSize: "12.5px", fontWeight: "800", color: "#0f172a" }}>
                  {selectedItemDetail.suppliersList.join(", ") || "Walk-in Supplier"}
                </span>
              </div>

              {/* Recipe Portion Yield & Shortage Reconcile (e.g. 1 packet 500ml = 50 coffees @ 10ml, actual 48 served = 2 cups / 20ml shortage) */}
              {Boolean(selectedItemDetail.recipeInfo || ["milk", "coffe", "tea", "salt", "sugar", "chicken", "oil", "bread", "paneer", "lemon"].some(k => selectedItemDetail.name.toLowerCase().includes(k)) || ["packet", "box", "kg", "g", "l", "ml"].includes(String(selectedItemDetail.unit).toLowerCase())) && (() => {
                const isMilk = selectedItemDetail.name.toLowerCase().includes("milk");
                const isCoffee = selectedItemDetail.name.toLowerCase().includes("coffe");
                
                // Recipe portion parameters
                const defaultCap = selectedItemDetail.packCapacity || (isMilk ? 500 : (selectedItemDetail.unit === "kg" || selectedItemDetail.unit === "L") ? 1000 : 500);
                const defaultPortionQty = selectedItemDetail.recipeInfo?.quantity || (isCoffee ? 5 : isMilk ? 10 : 20);
                const defaultPortionUnit = selectedItemDetail.packSubUnit || (isMilk ? "ml" : isCoffee ? "g" : (selectedItemDetail.unit === "kg" ? "g" : "ml"));

                const yieldInfo = calculatePortionYieldAndShortage({
                  packCapacity: defaultCap,
                  portionQty: defaultPortionQty,
                  packsUsed: reconcilePacksUsed,
                  actualPortionsServed: reconcileActualServed,
                  portionUnit: defaultPortionUnit,
                  packCost: selectedItemDetail.costPerUnit || 50
                });

                const handleLogShortageWaste = async () => {
                  if (!yieldInfo.isShortage) {
                    alert("No shortage detected! Actual output matches or exceeds expected yield.");
                    return;
                  }
                  setReconcilingShortage(true);
                  try {
                    const shortageBaseQty = Number((yieldInfo.shortageVolume / defaultCap).toFixed(4));
                    await logWasteRecord({
                      db,
                      uid: currentUid,
                      itemId: selectedItemDetail.id,
                      itemType: "shop_product",
                      wastedQty: shortageBaseQty > 0 ? shortageBaseQty : 0.01,
                      reason: "Kitchen Spoilage / Rotten",
                      notes: `Portion Yield Shortage Reconcile: 1 ${selectedItemDetail.unit} (${defaultCap} ${defaultPortionUnit}) should yield ${yieldInfo.totalExpectedPortions} cups. Actual obtained: ${yieldInfo.actualPortionsServed} cups. Shortage: ${yieldInfo.shortagePortions} cups (${yieldInfo.shortageVolume} ${defaultPortionUnit} / ₹${yieldInfo.shortageLossAmount}).`,
                      unitCost: selectedItemDetail.costPerUnit,
                      unitType: selectedItemDetail.unit,
                      productName: selectedItemDetail.name,
                      category: selectedItemDetail.category,
                      image: selectedItemDetail.image
                    });
                    setReconcileSuccessMsg(`✅ Shortage of ${yieldInfo.shortagePortions} cups (${yieldInfo.shortageVolume} ${defaultPortionUnit} / ₹${yieldInfo.shortageLossAmount}) logged as kitchen waste and deducted from stock!`);
                    setTimeout(() => setReconcileSuccessMsg(""), 6000);
                  } catch (err) {
                    alert("Error logging shortage: " + err.message);
                  } finally {
                    setReconcilingShortage(false);
                  }
                };

                return (
                  <div style={{ marginTop: "14px", backgroundColor: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: "12px", padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "18px" }}>☕</span>
                        <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "900", color: "#92400e" }}>
                          Recipe Portion Yield & Shortage Reconcile
                        </h4>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: "800", backgroundColor: "#fef3c7", color: "#b45309", padding: "3px 8px", borderRadius: "6px" }}>
                        {selectedItemDetail.recipeInfo ? `Recipe: ${selectedItemDetail.recipeInfo.dishName}` : "Active Ingredient"}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "#78350f", marginBottom: "12px", lineHeight: "1.4" }}>
                      Standard Formula: <strong>1 {selectedItemDetail.unit} ({defaultCap} {defaultPortionUnit})</strong> = <strong>{yieldInfo.yieldPerPack} cups/portions</strong> (at {defaultPortionQty} {defaultPortionUnit} per cup).
                    </div>

                    {/* Inputs */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                      <div style={{ backgroundColor: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid #fed7aa" }}>
                        <label style={{ display: "block", fontSize: "11px", fontWeight: "800", color: "#9a3412", marginBottom: "4px" }}>
                          📦 Packets / Units Opened:
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={reconcilePacksUsed}
                            onChange={(e) => setReconcilePacksUsed(Math.max(0.1, parseFloat(e.target.value) || 1))}
                            style={{ width: "70px", padding: "4px 8px", borderRadius: "6px", border: "1px solid #d97706", fontWeight: "800", fontSize: "13px" }}
                          />
                          <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>
                            {selectedItemDetail.unit} ({yieldInfo.totalVolumeOrWeight} {defaultPortionUnit})
                          </span>
                        </div>
                      </div>

                      <div style={{ backgroundColor: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid #fed7aa" }}>
                        <label style={{ display: "block", fontSize: "11px", fontWeight: "800", color: "#9a3412", marginBottom: "4px" }}>
                          ☕ Actual Cups / Portions Served:
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <input
                            type="number"
                            min="0"
                            value={reconcileActualServed}
                            onChange={(e) => setReconcileActualServed(Math.max(0, parseInt(e.target.value, 10) || 0))}
                            style={{ width: "70px", padding: "4px 8px", borderRadius: "6px", border: "1px solid #d97706", fontWeight: "800", fontSize: "13px" }}
                          />
                          <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>
                            cups (Expected: {yieldInfo.totalExpectedPortions} cups)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Shortage Result */}
                    {yieldInfo.isShortage ? (
                      <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: "900", color: "#b91c1c" }}>
                            ⚠️ Shortage: {yieldInfo.shortagePortions} cups ({yieldInfo.shortageVolume} {defaultPortionUnit})
                          </div>
                          <div style={{ fontSize: "11px", fontWeight: "700", color: "#7f1d1d", marginTop: "2px" }}>
                            {yieldInfo.shortagePercent}% Loss Variance • Financial Loss: ₹{yieldInfo.shortageLossAmount}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={reconcilingShortage}
                          onClick={handleLogShortageWaste}
                          style={{
                            backgroundColor: "#dc2626",
                            color: "#ffffff",
                            border: "none",
                            padding: "7px 14px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: "800",
                            cursor: reconcilingShortage ? "not-allowed" : "pointer",
                            boxShadow: "0 2px 4px rgba(220, 38, 38, 0.25)"
                          }}
                        >
                          {reconcilingShortage ? "Reconciling..." : "📝 Reconcile & Deduct Shortage as Waste"}
                        </button>
                      </div>
                    ) : (
                      <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "800", color: "#166534" }}>
                        ✅ Perfect Yield! {reconcileActualServed} cups obtained. Zero shortage variance.
                      </div>
                    )}

                    {reconcileSuccessMsg && (
                      <div style={{ backgroundColor: "#dcfce7", border: "1px solid #86efac", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", fontWeight: "800", color: "#15803d", marginTop: "8px" }}>
                        {reconcileSuccessMsg}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Purchase History / Invoices Table for this specific item */}
            <div style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                  Purchase Invoices & Log for "{selectedItemDetail.name}"
                </h4>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => openEditItemModal(selectedItemDetail)}
                    style={{
                      backgroundColor: "#eff6ff",
                      color: "#2563eb",
                      border: "1px solid #bfdbfe",
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontWeight: "800",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                  >
                    <span>✏️</span>
                    <span>Edit Item</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const target = selectedItemDetail;
                      setSelectedItemDetail(null);
                      openPurchaseForSpecificItem(target);
                    }}
                    style={{
                      backgroundColor: "#16a34a",
                      color: "#fff",
                      border: "none",
                      padding: "6px 12px",
                      borderRadius: "8px",
                      fontWeight: "800",
                      fontSize: "12px",
                      cursor: "pointer"
                    }}
                  >
                    ➕ Record New Purchase
                  </button>
                </div>
              </div>

              {selectedItemDetail.history.length === 0 ? (
                <div style={{ padding: "26px", textAlign: "center", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px dashed #cbd5e1", color: "#64748b", fontSize: "13px" }}>
                  Initial stock on hand ({selectedItemDetail.stockQuantity} {selectedItemDetail.unit}). No separate invoice logs yet.
                </div>
              ) : (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", textAlign: "left" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f1f5f9", borderBottom: "1px solid #cbd5e1", color: "#475569" }}>
                        <th style={{ padding: "8px 12px" }}>Date</th>
                        <th style={{ padding: "8px 12px" }}>Invoice / Bill</th>
                        <th style={{ padding: "8px 12px", textAlign: "right" }}>Quantity</th>
                        <th style={{ padding: "8px 12px", textAlign: "right" }}>Rate (₹)</th>
                        <th style={{ padding: "8px 12px", textAlign: "right" }}>Total (₹)</th>
                        <th style={{ padding: "8px 12px" }}>Supplier</th>
                        <th style={{ padding: "8px 12px" }}>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItemDetail.history.map((p, idx) => (
                        <tr key={p.id || idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 12px" }}>{p.purchaseDate || p.date}</td>
                          <td style={{ padding: "8px 12px", fontWeight: "700" }}>{p.billNo || p.invoiceId}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: "700" }}>{p.qty} {p.unit}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right" }}>₹{p.rate}</td>
                          <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: "800", color: "#16a34a" }}>₹{p.totalAmount}</td>
                          <td style={{ padding: "8px 12px" }}>{p.supplierName || "Vendor"}</td>
                          <td style={{ padding: "8px 12px" }}>{p.paymentMode || "Cash"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "14px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setSelectedItemDetail(null)}
                style={styles.modalCancelBtn}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3B. EDIT ITEM MODAL ("dei apram ithula oru edit optionum set panniru da") */}
      {/* ============================================================== */}
      {editingItem && (
        <div style={styles.modalOverlay} onClick={() => !savingEdit && setEditingItem(null)}>
          <div
            style={{
              ...styles.modalCard,
              maxWidth: "640px"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img
                  src={editImage.trim() || getGroceryImage(editItemName, editCategory)}
                  alt="Thumbnail"
                  style={{ width: "42px", height: "42px", borderRadius: "8px", objectFit: "cover", border: "1px solid #cbd5e1" }}
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = getGroceryImage("grocery", "general");
                  }}
                />
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800", color: "#0f172a" }}>
                    ✏️ Edit Item: {editingItem.name}
                  </h3>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Update item name, category, stock on hand, price, pack size or photo.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !savingEdit && setEditingItem(null)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditedItem} style={{ padding: "20px" }}>
              {/* Item Name & Category */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={styles.modalLabel}>Item Name *</label>
                    <button
                      type="button"
                      onClick={() => handleOpenWebImageSearch(editItemName, "edit")}
                      style={{
                        backgroundColor: "#e0e7ff",
                        color: "#4338ca",
                        border: "1px solid #c7d2fe",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontWeight: "800",
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}
                      title="Search web images for this product"
                    >
                      <span>🔍</span>
                      <span>Search web</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={editItemName}
                    onChange={(e) => setEditItemName(e.target.value)}
                    placeholder="e.g. Cheese, Coffee Powder, Milk"
                    style={styles.modalInput}
                  />
                </div>

                {/* Category with inline add */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={styles.modalLabel}>Category *</label>
                    <button
                      type="button"
                      onClick={() => setShowEditAddCategory(!showEditAddCategory)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#4338ca",
                        fontSize: "11.5px",
                        fontWeight: "800",
                        cursor: "pointer",
                        padding: "0"
                      }}
                    >
                      {showEditAddCategory ? "✕ Cancel" : "+ Add"}
                    </button>
                  </div>

                  {!showEditAddCategory ? (
                    <select
                      value={editCategory}
                      onChange={(e) => {
                        if (e.target.value === "__NEW__") {
                          setShowEditAddCategory(true);
                        } else {
                          setEditCategory(e.target.value);
                        }
                      }}
                      style={styles.modalInput}
                    >
                      {availableCategories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="__NEW__">➕ Add New Category...</option>
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: "4px" }}>
                      <input
                        type="text"
                        value={newEditCategoryInput}
                        onChange={(e) => setNewEditCategoryInput(e.target.value)}
                        placeholder="New category..."
                        style={{ ...styles.modalInput, flex: 1, padding: "7px 9px", fontSize: "12px" }}
                      />
                      <button
                        type="button"
                        onClick={handleAddNewEditCategory}
                        style={{
                          backgroundColor: "#4f46e5",
                          color: "#fff",
                          border: "none",
                          padding: "0 10px",
                          borderRadius: "6px",
                          fontWeight: "800",
                          fontSize: "12px",
                          cursor: "pointer"
                        }}
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Stock Quantity & Unit */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Available Stock Quantity *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={editStockQty}
                    onChange={(e) => setEditStockQty(e.target.value)}
                    placeholder="e.g. 10 or 3.5"
                    style={{ ...styles.modalInput, fontWeight: "700" }}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    Manual correction / stock on hand
                  </span>
                </div>

                <div>
                  <label style={styles.modalLabel}>Base Unit *</label>
                  <select
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    style={styles.modalInput}
                  >
                    <option value="kg">kg (Kilograms)</option>
                    <option value="g">g (Grams)</option>
                    <option value="L">L (Litres)</option>
                    <option value="ml">ml (Millilitres)</option>
                    <option value="packet">packet (Packets)</option>
                    <option value="box">box (Boxes)</option>
                    <option value="pcs">pcs (Pieces)</option>
                    <option value="bottle">bottle (Bottles)</option>
                    <option value="can">can (Cans)</option>
                    <option value="tin">tin (Tins)</option>
                    <option value="unit">unit (General Units)</option>
                  </select>
                </div>
              </div>

              {/* Rate & Min Stock Alert */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Rate / Cost per {editUnit} (₹) *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={editRate}
                    onChange={(e) => setEditRate(e.target.value)}
                    placeholder="e.g. 50"
                    style={styles.modalInput}
                  />
                </div>

                <div>
                  <label style={styles.modalLabel}>Low Stock Alert Limit</label>
                  <input
                    type="number"
                    step="any"
                    value={editMinAlert}
                    onChange={(e) => setEditMinAlert(e.target.value)}
                    placeholder="e.g. 5"
                    style={styles.modalInput}
                  />
                  <span style={{ fontSize: "11px", color: "#64748b" }}>
                    Card shows ⚠️ Low badge when at/below this
                  </span>
                </div>
              </div>

              {/* Pack Size & Capacity (for packets/boxes) */}
              {["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pcs"].includes(editUnit.toLowerCase()) && (
                <div style={{ backgroundColor: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "14px" }}>
                  <label style={{ ...styles.modalLabel, color: "#0f172a", marginBottom: "4px" }}>
                    📦 Pack Capacity / Measurement Size (Optional for Yield Calculation):
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#475569" }}>1 {editUnit} =</span>
                    <input
                      type="number"
                      step="any"
                      value={editPackCapacity}
                      onChange={(e) => setEditPackCapacity(e.target.value)}
                      placeholder="e.g. 500"
                      style={{ width: "90px", padding: "6px 8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontWeight: "700", fontSize: "13px" }}
                    />
                    <select
                      value={editPackUnit}
                      onChange={(e) => setEditPackUnit(e.target.value)}
                      style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontWeight: "700", fontSize: "13px" }}
                    >
                      <option value="ml">ml (Millilitres)</option>
                      <option value="g">g (Grams)</option>
                      <option value="pcs">pcs (Pieces)</option>
                      <option value="L">L (Litres)</option>
                    </select>
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>
                    Example: 1 packet milk = 500 ml. Used for calculating recipe yields & multi-unit stock display.
                  </div>
                </div>
              )}

              {/* Supplier & Image */}
              <div style={{ marginBottom: "14px" }}>
                <label style={styles.modalLabel}>Default Supplier / Vendor Name</label>
                <input
                  type="text"
                  value={editSupplier}
                  onChange={(e) => setEditSupplier(e.target.value)}
                  placeholder="e.g. Metro Cash & Carry, Local Mart"
                  style={styles.modalInput}
                />
              </div>

              {/* Photo & Search Web */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={styles.modalLabel}>Product Photo (Image URL or Search Web):</label>
                  <button
                    type="button"
                    onClick={() => handleOpenWebImageSearch(editItemName, "edit")}
                    style={{
                      backgroundColor: "#e0e7ff",
                      color: "#4338ca",
                      border: "1px solid #c7d2fe",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: "800",
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                  >
                    <span>🌐</span>
                    <span>Search Web Images</span>
                  </button>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <img
                    src={editImage.trim() || getGroceryImage(editItemName, editCategory)}
                    alt="Preview"
                    style={{ width: "48px", height: "48px", borderRadius: "8px", objectFit: "cover", border: "1.5px solid #cbd5e1" }}
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = getGroceryImage("grocery", "general");
                    }}
                  />
                  <input
                    type="text"
                    value={editImage}
                    onChange={(e) => setEditImage(e.target.value)}
                    placeholder="Paste image URL or click 'Search web'..."
                    style={{ ...styles.modalInput, flex: 1 }}
                  />
                </div>
              </div>

              {/* Actions: Delete on Left, Cancel & Save on Right */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={handleDeleteItem}
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "8px",
                    fontSize: "12px",
                    fontWeight: "800",
                    color: "#dc2626",
                    cursor: savingEdit ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                  title="Remove this item from inventory"
                >
                  <span>🗑️</span>
                  <span>Delete Item</span>
                </button>

                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={() => setEditingItem(null)}
                    style={styles.modalCancelBtn}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    style={styles.modalSubmitBtn}
                  >
                    {savingEdit ? "Saving..." : "✓ Save Changes"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 4. RECORD PURCHASE MODAL with Category Dropdown & Add Option & Search Web Image */}
      {/* ============================================================== */}
      {showAddModal && (
        <div style={styles.modalOverlay} onClick={() => !savingPurchase && setShowAddModal(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "800", color: "#0f172a" }}>
                  ➕ Record Purchase & Stock In
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Stock will automatically increase in your shop inventory upon recording.
                </div>
                <div style={{
                  marginTop: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "#eff6ff",
                  color: "#1d4ed8",
                  padding: "3px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: "800",
                  border: "1px solid #bfdbfe"
                }}>
                  <span>📍 Tagged to Outlet:</span>
                  <span>
                    {branches.find(b => b.id === (internalBranchId !== "all" ? internalBranchId : (branches[0]?.id || "main_branch")))?.name || internalBranchName}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !savingPurchase && setShowAddModal(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePurchase} style={{ padding: "20px" }}>
              {/* Select Existing Item or Enter New */}
              <div style={{ marginBottom: "14px" }}>
                <label style={styles.modalLabel}>
                  Select Existing Item to Restock (Optional):
                </label>
                <select
                  value={selectedExistingId}
                  onChange={(e) => handleSelectExistingItem(e.target.value)}
                  style={styles.modalInput}
                >
                  <option value="">-- Or enter new item below --</option>
                  {[...shopProductsList, ...rawMaterialsList].filter((it) => itemMatchesBranch(it, internalBranchId)).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name || it.itemName} ({it.category || "Stock"}) - In Stock: {it.quantity ?? it.stockQuantity ?? 0} {it.unitType || it.unit || "unit"}
                    </option>
                  ))}
                </select>
              </div>

              {/* Item Name & Category with Dropdown + Add Category */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.1fr", gap: "10px", marginBottom: "14px", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={styles.modalLabel}>Item / Grocery Name *</label>
                    {/* 🔍 Search Web button beside product name */}
                    <button
                      type="button"
                      onClick={() => handleOpenWebImageSearch(formItemName)}
                      style={{
                        backgroundColor: "#e0e7ff",
                        color: "#4338ca",
                        border: "1px solid #c7d2fe",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontWeight: "800",
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}
                      title="Search web images for this product"
                    >
                      <span>🔍</span>
                      <span>Search web</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={formItemName}
                    onChange={(e) => setFormItemName(e.target.value)}
                    placeholder="e.g. Chicken, Milk, Coffee Powder, Bread, Rice"
                    style={styles.modalInput}
                  />
                </div>

                {/* Category Dropdown with "+ Add Category" option */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={styles.modalLabel}>Category *</label>
                    <button
                      type="button"
                      onClick={() => setShowAddCategoryInline(!showAddCategoryInline)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#4338ca",
                        fontSize: "11.5px",
                        fontWeight: "800",
                        cursor: "pointer",
                        padding: "0"
                      }}
                    >
                      {showAddCategoryInline ? "✕ Cancel" : "+ Add"}
                    </button>
                  </div>

                  {!showAddCategoryInline ? (
                    <select
                      value={formCategory}
                      onChange={(e) => {
                        if (e.target.value === "__NEW__") {
                          setShowAddCategoryInline(true);
                        } else {
                          setFormCategory(e.target.value);
                        }
                      }}
                      style={styles.modalInput}
                    >
                      {availableCategories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="__NEW__">➕ Add New Category...</option>
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: "4px" }}>
                      <input
                        type="text"
                        autoFocus
                        value={newCategoryInput}
                        onChange={(e) => setNewCategoryInput(e.target.value)}
                        placeholder="Category name"
                        style={{ ...styles.modalInput, flex: 1, padding: "7px 8px", fontSize: "12px" }}
                      />
                      <button
                        type="button"
                        onClick={handleAddNewCategory}
                        style={{
                          padding: "7px 10px",
                          backgroundColor: "#4f46e5",
                          color: "#fff",
                          border: "none",
                          borderRadius: "8px",
                          fontWeight: "800",
                          fontSize: "11px",
                          cursor: "pointer",
                          whiteSpace: "nowrap"
                        }}
                      >
                        ✓ Save
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ⚖️ / 🧪 DYNAMIC UNIT & MEASUREMENT SECTION */}
              <div style={{
                backgroundColor: "#f8fafc",
                padding: "14px",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                marginBottom: "14px"
              }}>
                {/* Unit Selector Row with Pills */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <label style={{ ...styles.modalLabel, margin: 0, fontSize: "12.5px" }}>
                    Unit of Measurement *
                  </label>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                    {[
                      { id: "kg", label: "⚖️ kg" },
                      { id: "g", label: "⚖️ g" },
                      { id: "L", label: "🧪 Litre" },
                      { id: "ml", label: "🧪 ml" },
                      { id: "packet", label: "📦 Packet" },
                      { id: "pcs", label: "🔢 Pcs" },
                      { id: "box", label: "📦 Box" },
                      { id: "can", label: "🥫 Can" }
                    ].map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => handleUnitChange(u.id)}
                        style={{
                          padding: "4px 9px",
                          borderRadius: "7px",
                          fontSize: "11px",
                          fontWeight: "800",
                          border: formUnit === u.id ? "1.5px solid #16a34a" : "1px solid #cbd5e1",
                          backgroundColor: formUnit === u.id ? "#ecfdf5" : "#ffffff",
                          color: formUnit === u.id ? "#15803d" : "#475569",
                          cursor: "pointer",
                          transition: "all 0.15s ease"
                        }}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 1. When Unit is kg (Kilogram & Gram) */}
                {formUnit === "kg" && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: "10px" }}>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Kilos (kg) *</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={formKilo}
                          onChange={(e) => {
                            setFormKilo(e.target.value);
                            setFormQty(String(Number(e.target.value || 0) + (Number(formGram || 0) / 1000)));
                          }}
                          placeholder="e.g. 2"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Grams (g)</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="999"
                          value={formGram}
                          onChange={(e) => {
                            setFormGram(e.target.value);
                            setFormQty(String(Number(formKilo || 0) + (Number(e.target.value || 0) / 1000)));
                          }}
                          placeholder="e.g. 500"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Rate per kg (₹) *</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formRate}
                          onChange={(e) => setFormRate(e.target.value)}
                          placeholder="e.g. 180"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                    </div>

                    {/* Quick Grams / Kilo Helper Chips */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b" }}>Quick add:</span>
                      {[
                        { label: "+250g", fn: () => addGrams(250) },
                        { label: "+500g", fn: () => addGrams(500) },
                        { label: "+1 kg", fn: () => addKilos(1) },
                        { label: "+2 kg", fn: () => addKilos(2) },
                        { label: "+5 kg", fn: () => addKilos(5) },
                        { label: "Clear", fn: () => { setFormKilo(""); setFormGram(""); setFormQty(""); } }
                      ].map((chip, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={chip.fn}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            backgroundColor: "#ffffff",
                            border: "1px solid #cbd5e1",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: chip.label === "Clear" ? "#ef4444" : "#0f172a",
                            cursor: "pointer"
                          }}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>

                    {effectiveQty > 0 && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#15803d", fontWeight: "800", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>⚖️ Total Weight:</span>
                        <span style={{ backgroundColor: "#dcfce7", padding: "2px 8px", borderRadius: "6px" }}>
                          {effectiveQty} kg ({Math.round(effectiveQty * 1000)} grams)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. When Unit is g (Grams) */}
                {formUnit === "g" && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Weight in Grams (g) *</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formGram}
                          onChange={(e) => {
                            setFormGram(e.target.value);
                            setFormQty(e.target.value);
                          }}
                          placeholder="e.g. 500"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Rate (₹) *</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formRate}
                          onChange={(e) => setFormRate(e.target.value)}
                          placeholder="e.g. 40"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                    </div>

                    {/* Quick chips */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b" }}>Quick add:</span>
                      {[100, 250, 500, 1000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => {
                            const newG = Number(formGram || 0) + amt;
                            setFormGram(String(newG));
                            setFormQty(String(newG));
                          }}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            backgroundColor: "#ffffff",
                            border: "1px solid #cbd5e1",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: "#0f172a",
                            cursor: "pointer"
                          }}
                        >
                          +{amt}g
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => { setFormGram(""); setFormQty(""); }}
                        style={{ padding: "3px 9px", borderRadius: "6px", backgroundColor: "#ffffff", border: "1px solid #cbd5e1", fontSize: "11px", fontWeight: "700", color: "#ef4444", cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    </div>

                    {effectiveQty > 0 && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#15803d", fontWeight: "800" }}>
                        ⚖️ Total Weight: {effectiveQty} g ({(effectiveQty / 1000).toFixed(2)} kg)
                      </div>
                    )}
                  </div>
                )}

                {/* 3. When Unit is L (Litres & Millilitres) */}
                {formUnit === "L" && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.2fr", gap: "10px" }}>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Litres (L) *</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={formLitre}
                          onChange={(e) => {
                            setFormLitre(e.target.value);
                            setFormQty(String(Number(e.target.value || 0) + (Number(formMl || 0) / 1000)));
                          }}
                          placeholder="e.g. 1"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Millilitres (ml)</label>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          max="999"
                          value={formMl}
                          onChange={(e) => {
                            setFormMl(e.target.value);
                            setFormQty(String(Number(formLitre || 0) + (Number(e.target.value || 0) / 1000)));
                          }}
                          placeholder="e.g. 500"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Rate per Litre (₹) *</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formRate}
                          onChange={(e) => setFormRate(e.target.value)}
                          placeholder="e.g. 60"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                    </div>

                    {/* Quick Millilitre / Litre Helper Chips */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b" }}>Quick add:</span>
                      {[
                        { label: "+250ml", fn: () => addMl(250) },
                        { label: "+500ml", fn: () => addMl(500) },
                        { label: "+1 L", fn: () => addLitres(1) },
                        { label: "+2 L", fn: () => addLitres(2) },
                        { label: "+5 L", fn: () => addLitres(5) },
                        { label: "Clear", fn: () => { setFormLitre(""); setFormMl(""); setFormQty(""); } }
                      ].map((chip, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={chip.fn}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            backgroundColor: "#ffffff",
                            border: "1px solid #cbd5e1",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: chip.label === "Clear" ? "#ef4444" : "#0f172a",
                            cursor: "pointer"
                          }}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>

                    {effectiveQty > 0 && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#15803d", fontWeight: "800", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>🧪 Total Volume:</span>
                        <span style={{ backgroundColor: "#dcfce7", padding: "2px 8px", borderRadius: "6px" }}>
                          {effectiveQty} L ({Math.round(effectiveQty * 1000)} ml)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. When Unit is ml (Millilitres) */}
                {formUnit === "ml" && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Volume in Millilitres (ml) *</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formMl}
                          onChange={(e) => {
                            setFormMl(e.target.value);
                            setFormQty(e.target.value);
                          }}
                          placeholder="e.g. 500"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>Rate (₹) *</label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formRate}
                          onChange={(e) => setFormRate(e.target.value)}
                          placeholder="e.g. 30"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                    </div>

                    {/* Quick chips */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b" }}>Quick add:</span>
                      {[100, 250, 500, 1000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => {
                            const newMl = Number(formMl || 0) + amt;
                            setFormMl(String(newMl));
                            setFormQty(String(newMl));
                          }}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            backgroundColor: "#ffffff",
                            border: "1px solid #cbd5e1",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: "#0f172a",
                            cursor: "pointer"
                          }}
                        >
                          +{amt}ml
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => { setFormMl(""); setFormQty(""); }}
                        style={{ padding: "3px 9px", borderRadius: "6px", backgroundColor: "#ffffff", border: "1px solid #cbd5e1", fontSize: "11px", fontWeight: "700", color: "#ef4444", cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    </div>

                    {effectiveQty > 0 && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#15803d", fontWeight: "800" }}>
                        🧪 Total Volume: {effectiveQty} ml ({(effectiveQty / 1000).toFixed(2)} L)
                      </div>
                    )}
                  </div>
                )}

                {/* 5. When Unit is packet / box / can / pcs */}
                {!["kg", "g", "L", "ml"].includes(formUnit) && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr", gap: "10px" }}>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>
                          Number of {formUnit.charAt(0).toUpperCase() + formUnit.slice(1)}s Purchased *
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formPackCount}
                          onChange={(e) => {
                            setFormPackCount(e.target.value);
                            setFormQty(e.target.value);
                          }}
                          placeholder="e.g. 10"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                      <div>
                        <label style={{ ...styles.modalLabel, color: "#1e293b" }}>
                          Rate per {formUnit.charAt(0).toUpperCase() + formUnit.slice(1)} (₹) *
                        </label>
                        <input
                          type="number"
                          step="any"
                          required
                          value={formRate}
                          onChange={(e) => setFormRate(e.target.value)}
                          placeholder="e.g. 50"
                          style={{ ...styles.modalInput, backgroundColor: "#ffffff", fontWeight: "700" }}
                        />
                      </div>
                    </div>

                    {/* Pack size specification (e.g. 500 ml each, 100 g each) */}
                    <div style={{ marginTop: "10px", padding: "8px 10px", backgroundColor: "#ffffff", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
                      <div style={{ fontSize: "11px", fontWeight: "700", color: "#64748b", marginBottom: "4px" }}>
                        Weight / Volume per {formUnit} (Optional):
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ fontSize: "12px", color: "#475569" }}>Each {formUnit} is</span>
                        <input
                          type="number"
                          step="any"
                          value={formPackSizeVal}
                          onChange={(e) => setFormPackSizeVal(e.target.value)}
                          placeholder="e.g. 500"
                          style={{ ...styles.modalInput, width: "100px", padding: "4px 8px" }}
                        />
                        <select
                          value={formPackSizeUnit}
                          onChange={(e) => setFormPackSizeUnit(e.target.value)}
                          style={{ ...styles.modalInput, width: "110px", padding: "4px 8px" }}
                        >
                          <option value="ml">ml (Millilitres)</option>
                          <option value="g">g (Grams)</option>
                          <option value="L">L (Litres)</option>
                          <option value="kg">kg (Kilograms)</option>
                          <option value="pcs">pcs</option>
                        </select>
                      </div>
                    </div>

                    {/* Quick chips */}
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "#64748b" }}>Quick count:</span>
                      {[1, 5, 10, 20, 50].map((cnt) => (
                        <button
                          key={cnt}
                          type="button"
                          onClick={() => addPacks(cnt)}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            backgroundColor: "#ffffff",
                            border: "1px solid #cbd5e1",
                            fontSize: "11px",
                            fontWeight: "700",
                            color: "#0f172a",
                            cursor: "pointer"
                          }}
                        >
                          +{cnt}
                        </button>
                      ))}
                    </div>

                    {effectiveQty > 0 && formPackSizeVal && (
                      <div style={{ marginTop: "8px", fontSize: "12px", color: "#15803d", fontWeight: "800" }}>
                        📦 {effectiveQty} {formUnit}s × {formPackSizeVal} {formPackSizeUnit} = {effectiveQty * parseFloat(formPackSizeVal)} {formPackSizeUnit} Total Available Stock
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Total Calculation Preview */}
              {computedTotalAmount > 0 && (
                <div style={{
                  padding: "10px 14px",
                  backgroundColor: "#f0fdf4",
                  borderRadius: "8px",
                  border: "1px solid #bbf7d0",
                  marginBottom: "14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div>
                    <span style={{ fontSize: "13px", color: "#166534", fontWeight: "700" }}>Total Purchase Amount:</span>
                    <div style={{ fontSize: "11px", color: "#15803d", fontWeight: "600" }}>
                      {measurementDetailText} @ ₹{formRate}
                    </div>
                  </div>
                  <span style={{ fontSize: "18px", color: "#15803d", fontWeight: "900" }}>
                    ₹{computedTotalAmount.toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              {/* Image Preview & Search Web Option */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={styles.modalLabel}>Product Image (Auto-assigned or Search Web):</label>
                  <button
                    type="button"
                    onClick={() => handleOpenWebImageSearch(formItemName)}
                    style={{
                      backgroundColor: "#e0e7ff",
                      color: "#4338ca",
                      border: "1px solid #c7d2fe",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: "800",
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                  >
                    <span>🌐</span>
                    <span>Search Web Images</span>
                  </button>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <img
                    src={formImage.trim() || getGroceryImage(formItemName, formCategory)}
                    alt="Preview"
                    style={{ width: "48px", height: "48px", borderRadius: "8px", objectFit: "cover", border: "1.5px solid #cbd5e1" }}
                  />
                  <input
                    type="text"
                    value={formImage}
                    onChange={(e) => setFormImage(e.target.value)}
                    placeholder="Paste image URL or click 'Search web' above..."
                    style={{ ...styles.modalInput, flex: 1 }}
                  />
                </div>
              </div>

              {/* Supplier & Bill No */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "10px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Supplier / Vendor Name *</label>
                  <input
                    type="text"
                    required
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    placeholder="e.g. Metro Cash & Carry, Local Mart"
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Invoice / Bill No</label>
                  <input
                    type="text"
                    value={formBillNo}
                    onChange={(e) => setFormBillNo(e.target.value)}
                    placeholder="e.g. INV-10029"
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Payment Mode & Date */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Payment Mode</label>
                  <select
                    value={formPaymentMode}
                    onChange={(e) => setFormPaymentMode(e.target.value)}
                    style={styles.modalInput}
                  >
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI / GPay / PhonePe</option>
                    <option value="Bank Transfer">Bank Transfer / NEFT</option>
                    <option value="Credit">Credit (Pay Later)</option>
                  </select>
                </div>
                <div>
                  <label style={styles.modalLabel}>Purchase Date</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: "16px" }}>
                <label style={styles.modalLabel}>Notes / Remarks (Optional)</label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="e.g. Batch #45, Good quality chicken"
                  style={styles.modalInput}
                />
              </div>

              {/* Modal Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
                <button
                  type="button"
                  disabled={savingPurchase}
                  onClick={() => setShowAddModal(false)}
                  style={styles.modalCancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPurchase}
                  style={styles.modalSubmitBtn}
                >
                  {savingPurchase ? "Saving..." : "✓ Save Purchase & Add Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. WEB IMAGE SEARCH MODAL ("Search web option web appla irrukka purchaselayum add pannikkudu") */}
      {/* ============================================================== */}
      {webSearchModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setWebSearchModalOpen(false)}>
          <div
            style={{
              ...styles.modalCard,
              maxWidth: "680px"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                  🌐 Search Web Image for "{webSearchQuery}"
                </h3>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                  Click any image to select it as the product photo.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWebSearchModalOpen(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "16px 20px" }}>
              {/* Search Bar */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                <input
                  type="text"
                  value={webSearchQuery}
                  onChange={(e) => setWebSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") executeWebImageSearch(webSearchQuery);
                  }}
                  placeholder="Type product name (e.g. Chicken, Milk, Onion, Rice)..."
                  style={{ ...styles.modalInput, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={webSearchLoading}
                  onClick={() => executeWebImageSearch(webSearchQuery)}
                  style={{
                    backgroundColor: "#4f46e5",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontWeight: "800",
                    fontSize: "13px",
                    cursor: "pointer"
                  }}
                >
                  {webSearchLoading ? "Searching..." : "🔍 Search"}
                </button>
              </div>

              {/* Quick Item Suggestion Chips */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                {[
                  "Coffee Powder",
                  "Tata Salt",
                  "Milk",
                  "Chicken",
                  "Bread",
                  "Cooking Oil",
                  "Tea Powder",
                  "Sugar",
                  "Eggs",
                  "Onion",
                  "Tomato",
                  "Paneer"
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setWebSearchQuery(s);
                      executeWebImageSearch(s);
                    }}
                    style={{
                      padding: "3px 8px",
                      borderRadius: "6px",
                      backgroundColor: "#f1f5f9",
                      border: "1px solid #e2e8f0",
                      fontSize: "11px",
                      fontWeight: "700",
                      color: "#334155",
                      cursor: "pointer"
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Results Grid */}
              {webSearchLoading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                  Searching images on web...
                </div>
              ) : webSearchResults.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
                  No images found for "{webSearchQuery}". Try another keyword!
                </div>
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(115px, 1fr))",
                  gap: "10px",
                  maxHeight: "360px",
                  overflowY: "auto",
                  padding: "6px"
                }}>
                  {webSearchResults.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        if (webSearchTarget === "edit") {
                          setEditImage(imgUrl);
                        } else {
                          setFormImage(imgUrl);
                        }
                        setWebSearchModalOpen(false);
                      }}
                      style={{
                        position: "relative",
                        height: "110px",
                        borderRadius: "8px",
                        overflow: "hidden",
                        border: (webSearchTarget === "edit" ? editImage === imgUrl : formImage === imgUrl) ? "2.5px solid #16a34a" : "1px solid #e2e8f0",
                        cursor: "pointer",
                        backgroundColor: "#ffffff",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "4px",
                        transition: "all 0.15s ease"
                      }}
                      title="Click to select this image"
                    >
                      <img
                        src={imgUrl}
                        alt="Product"
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          width: "auto",
                          height: "auto",
                          objectFit: "contain",
                          display: "block"
                        }}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.parentElement.style.display = "none";
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setWebSearchModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "20px 24px 60px 24px",
    backgroundColor: "#f8fafc",
    minHeight: "100vh",
    fontFamily: "inherit"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
    flexWrap: "wrap",
    gap: "12px"
  },
  title: {
    fontSize: "20px",
    fontWeight: "900",
    color: "#0f172a",
    margin: 0
  },
  subtitle: {
    fontSize: "12px",
    color: "#64748b",
    margin: "4px 0 0 0"
  },
  backBtn: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer"
  },
  modeBadge: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "3px 8px",
    borderRadius: "8px"
  },
  recordBtn: {
    padding: "8px 16px",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "9px",
    fontWeight: "800",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)"
  },
  printBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#334155",
    border: "1.5px solid #cbd5e1",
    borderRadius: "9px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  exportBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#4338ca",
    border: "1.5px solid #c7d2fe",
    borderRadius: "9px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  modeTabsWrapper: {
    display: "flex",
    gap: "10px",
    marginBottom: "16px",
    flexWrap: "wrap"
  },
  modeTab: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1.5px solid",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    fontSize: "13px",
    transition: "all 0.15s ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "14px",
    marginBottom: "18px"
  },
  statCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "14px 16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 2px 5px rgba(0,0,0,0.02)"
  },
  statHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  statLabel: {
    fontSize: "11px",
    fontWeight: "800",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.3px"
  },
  statValue: {
    fontSize: "22px",
    fontWeight: "900",
    color: "#0f172a",
    marginTop: "4px"
  },
  statSub: {
    fontSize: "11px",
    color: "#94a3b8",
    marginTop: "2px"
  },
  filterCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "12px 16px",
    border: "1px solid #e2e8f0",
    marginBottom: "16px",
    display: "flex",
    alignItems: "flex-end",
    gap: "14px",
    flexWrap: "wrap"
  },
  filterLabel: {
    display: "block",
    fontSize: "11px",
    fontWeight: "800",
    color: "#475569",
    marginBottom: "4px",
    textTransform: "uppercase"
  },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    color: "#1e293b",
    outline: "none"
  },
  datePill: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.15s ease"
  },
  dateInput: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12px",
    color: "#1e293b",
    outline: "none"
  },
  selectInput: {
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12.5px",
    fontWeight: "600",
    color: "#1e293b",
    backgroundColor: "#fff",
    outline: "none"
  },

  // Card Grid Styles (like Menu Items)
  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "16px",
    paddingBottom: "30px"
  },
  productCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
    display: "flex",
    flexDirection: "column",
    transition: "transform 0.15s ease, box-shadow 0.15s ease"
  },
  imageWrapper: {
    position: "relative",
    height: "125px",
    width: "100%",
    backgroundColor: "#f1f5f9"
  },
  productImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover"
  },
  stockBadge: {
    position: "absolute",
    bottom: "8px",
    left: "8px",
    color: "#fff",
    padding: "3px 8px",
    borderRadius: "5px",
    fontSize: "10.5px",
    fontWeight: "800",
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
  },
  productDetails: {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    flex: 1,
    justifyContent: "space-between"
  },
  productName: {
    fontSize: "14px",
    fontWeight: "800",
    color: "#1e293b",
    margin: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },

  // Table styles
  tableCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    boxShadow: "0 2px 5px rgba(0,0,0,0.02)"
  },
  tableHeaderBar: {
    padding: "12px 16px",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    textAlign: "left"
  },
  thRow: {
    backgroundColor: "#f1f5f9",
    borderBottom: "1px solid #cbd5e1"
  },
  th: {
    padding: "10px 14px",
    fontWeight: "700",
    color: "#475569",
    fontSize: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.3px"
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #f1f5f9",
    color: "#334155"
  },
  trOdd: {
    backgroundColor: "#ffffff"
  },
  trEven: {
    backgroundColor: "#f8fafc"
  },
  billBadge: {
    padding: "2px 7px",
    borderRadius: "6px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    fontSize: "11px",
    fontWeight: "700",
    border: "1px solid #e2e8f0"
  },
  catBadge: {
    padding: "2px 7px",
    borderRadius: "6px",
    backgroundColor: "#e0f2fe",
    color: "#0369a1",
    fontSize: "11px",
    fontWeight: "700"
  },
  payBadge: {
    padding: "2px 7px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: "700",
    border: "1px solid"
  },

  // Modal styles
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "16px"
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    maxWidth: "580px",
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
    overflow: "hidden",
    maxHeight: "92vh",
    overflowY: "auto"
  },
  modalHeader: {
    padding: "16px 20px",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    fontSize: "18px",
    color: "#94a3b8",
    cursor: "pointer",
    padding: "2px 6px",
    fontWeight: "800"
  },
  modalLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
    marginBottom: "5px"
  },
  modalInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    color: "#1e293b",
    outline: "none"
  },
  modalCancelBtn: {
    padding: "8px 16px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    color: "#475569",
    cursor: "pointer"
  },
  modalSubmitBtn: {
    padding: "8px 20px",
    backgroundColor: "#16a34a",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "800",
    color: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.3)"
  }
};
