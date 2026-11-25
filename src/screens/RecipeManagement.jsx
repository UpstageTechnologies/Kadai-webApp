import { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { getGroceryImage } from "../utils/groceryImages";

// Helper to parse net quantity from item names (e.g., "Milk 500ml", "Coffee 100g", "Oil 1L")
export function parsePackSizeFromName(name) {
  if (!name || typeof name !== "string") return null;
  const match = name.match(/(\d+(?:\.\d+)?)\s*(ml|l|ltr|litres?|liters?|g|gm|gms|grams?|kg|kilo|pcs|pieces?|slice|slices)/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  let unit = match[2].toLowerCase();
  if (["l", "ltr", "litre", "litres", "liter", "liters"].includes(unit)) unit = "L";
  else if (["ml"].includes(unit)) unit = "ml";
  else if (["g", "gm", "gms", "gram", "grams"].includes(unit)) unit = "g";
  else if (["kg", "kilo"].includes(unit)) unit = "kg";
  else if (["pcs", "pieces", "piece", "slice", "slices"].includes(unit)) unit = "pcs";
  return { val, unit };
}

// Convert standard metric quantities to common base (weight -> g, volume -> ml, count -> pcs)
export function toBaseMetric(qty, unit) {
  const u = String(unit || "").toLowerCase().trim();
  const q = Number(qty) || 0;
  if (u === "kg" || u === "kilo" || u === "kilogram") return { val: q * 1000, type: "weight" };
  if (u === "g" || u === "gm" || u === "gram" || u === "grams") return { val: q, type: "weight" };
  if (u === "l" || u === "ltr" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return { val: q * 1000, type: "volume" };
  if (u === "ml" || u === "millilitre" || u === "milliliter") return { val: q, type: "volume" };
  if (u === "pcs" || u === "piece" || u === "pieces") return { val: q, type: "count" };
  return { val: q, type: "custom" };
}

// Unit conversion and portion cost calculator
export function computeIngredientCost(qty, unit, rawMaterial, overridePackQty, overridePackUnit) {
  if (!rawMaterial || !qty || qty <= 0) return 0;
  const baseCost = Number(rawMaterial.costPerUnit ?? rawMaterial.purchasePrice ?? rawMaterial.baseCost ?? 0);
  const baseUnit = String(rawMaterial.unit || rawMaterial.baseUnit || rawMaterial.unitType || "pcs").toLowerCase().trim();
  const targetUnit = String(unit || baseUnit).toLowerCase().trim();
  const quantity = Number(qty) || 0;

  if (baseCost <= 0 || quantity <= 0) return 0;

  // 1. Identical unit (e.g. g with g, ml with ml, pcs with pcs, packet with packet)
  if (baseUnit === targetUnit) {
    return quantity * baseCost;
  }

  // 2. Direct Liquid metric: Litre & ml
  if (baseUnit === "l" && targetUnit === "ml") {
    return (quantity / 1000) * baseCost;
  }
  if (baseUnit === "ml" && targetUnit === "l") {
    return quantity * 1000 * baseCost;
  }

  // 3. Direct Weight metric: Kilogram & gram
  if (baseUnit === "kg" && targetUnit === "g") {
    return (quantity / 1000) * baseCost;
  }
  if (baseUnit === "g" && targetUnit === "kg") {
    return quantity * 1000 * baseCost;
  }

  // 4. Packaged Goods (packet, box, bottle, can, tin, pouch, pcs used with sub-units like ml/g)
  const isPackaged = ["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pouch", "bag", "carton", "jar", "pcs", "piece"].includes(baseUnit);
  if (isPackaged) {
    let packCapacity = Number(overridePackQty || rawMaterial.packQuantity || rawMaterial.packSizeVal || 0);
    let packCapacityUnit = String(overridePackUnit || rawMaterial.packUnit || rawMaterial.packSizeUnit || "").toLowerCase().trim();

    // Auto-detect from name if not specified (e.g., "Milk 500ml" -> 500 ml)
    if ((!packCapacity || packCapacity <= 0) && rawMaterial.name) {
      const parsed = parsePackSizeFromName(rawMaterial.name);
      if (parsed) {
        packCapacity = parsed.val;
        packCapacityUnit = parsed.unit.toLowerCase();
      }
    }

    // Smart default fallbacks if still unknown:
    if (!packCapacity || packCapacity <= 0) {
      if (targetUnit === "ml" || targetUnit === "l") {
        packCapacity = 500; // Standard 500 ml milk / beverage packet
        packCapacityUnit = "ml";
      } else if (targetUnit === "g" || targetUnit === "kg") {
        packCapacity = 100; // Standard 100 g coffee / spice powder packet
        packCapacityUnit = "g";
      } else {
        packCapacity = 1;
        packCapacityUnit = baseUnit;
      }
    }

    // Convert both recipe qty and pack capacity to base metric
    const ingMetric = toBaseMetric(quantity, targetUnit);
    const packMetric = toBaseMetric(packCapacity, packCapacityUnit || targetUnit);

    if (ingMetric.type === packMetric.type && packMetric.val > 0) {
      const packetFraction = ingMetric.val / packMetric.val;
      return packetFraction * baseCost;
    }

    if (packCapacity > 0) {
      return (quantity / packCapacity) * baseCost;
    }
  }

  // Fallback
  return quantity * baseCost;
}

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

// Starter Raw Materials for Cafes & Restaurants (1-Click Load if empty)
const STARTER_RAW_MATERIALS = [
  { name: "Full Cream Milk", category: "Dairy", unit: "L", costPerUnit: 60, stockQuantity: 25, minAlertQuantity: 5 },
  { name: "Coffee Powder / Beans", category: "Beverages", unit: "kg", costPerUnit: 450, stockQuantity: 4, minAlertQuantity: 1 },
  { name: "Refined White Sugar", category: "Groceries", unit: "kg", costPerUnit: 42, stockQuantity: 12, minAlertQuantity: 2 },
  { name: "Tea Leaves (CTC)", category: "Beverages", unit: "kg", costPerUnit: 320, stockQuantity: 3, minAlertQuantity: 1 },
  { name: "Burger Buns (Sesame)", category: "Bakery", unit: "pcs", costPerUnit: 12, stockQuantity: 40, minAlertQuantity: 10 },
  { name: "Chicken Patty", category: "Meat & Poultry", unit: "pcs", costPerUnit: 45, stockQuantity: 35, minAlertQuantity: 8 },
  { name: "Veggie Patty", category: "Groceries", unit: "pcs", costPerUnit: 25, stockQuantity: 25, minAlertQuantity: 8 },
  { name: "Cheese Slices", category: "Dairy", unit: "pcs", costPerUnit: 14, stockQuantity: 50, minAlertQuantity: 10 },
  { name: "Farm Fresh Eggs", category: "Poultry", unit: "pcs", costPerUnit: 6, stockQuantity: 60, minAlertQuantity: 12 },
  { name: "Sandwich Bread Loaf", category: "Bakery", unit: "pcs", costPerUnit: 35, stockQuantity: 10, minAlertQuantity: 3 },
  { name: "Butter (Salted)", category: "Dairy", unit: "kg", costPerUnit: 520, stockQuantity: 3, minAlertQuantity: 1 },
  { name: "Cooking Oil", category: "Groceries", unit: "L", costPerUnit: 140, stockQuantity: 15, minAlertQuantity: 4 },
  { name: "Burger Mayo & Sauce", category: "Sauces & Condiments", unit: "kg", costPerUnit: 180, stockQuantity: 3, minAlertQuantity: 1 },
  { name: "Fresh Mint & Lemon", category: "Produce", unit: "kg", costPerUnit: 120, stockQuantity: 2, minAlertQuantity: 0.5 },
  { name: "Paper Cups (250ml)", category: "Packaging", unit: "pcs", costPerUnit: 1.5, stockQuantity: 250, minAlertQuantity: 50 },
  { name: "Burger Takeaway Box", category: "Packaging", unit: "pcs", costPerUnit: 4.0, stockQuantity: 100, minAlertQuantity: 20 },
];

export default function RecipeManagement({ products = [], onBack, userProfile = {} }) {
  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

  // Navigation tab inside Recipe screen
  const [activeTab, setActiveTab] = useState("recipes"); // "recipes" | "raw_materials" | "batch_planner"

  // Data states
  const [recipes, setRecipes] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [posInventoryItems, setPosInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Recipe Configurator Modal
  const [editingRecipeProduct, setEditingRecipeProduct] = useState(null);
  const [currentIngredients, setCurrentIngredients] = useState([]);
  const [wastagePercent, setWastagePercent] = useState(3);
  const [prepInstructions, setPrepInstructions] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);

  // Add Ingredient Row Form & Visual Shelf Filter
  const [selectedRawId, setSelectedRawId] = useState("");
  const [ingredientQty, setIngredientQty] = useState("");
  const [ingredientUnit, setIngredientUnit] = useState("g");
  const [ingredientPackQty, setIngredientPackQty] = useState("");
  const [ingredientPackUnit, setIngredientPackUnit] = useState("ml");
  const [recipeRawSearch, setRecipeRawSearch] = useState("");
  const [recipeRawCategory, setRecipeRawCategory] = useState("All");

  // Raw Material Modal (Add/Edit)
  const [showRawModal, setShowRawModal] = useState(false);
  const [editingRawItem, setEditingRawItem] = useState(null);
  const [rawName, setRawName] = useState("");
  const [rawCategory, setRawCategory] = useState("Groceries");
  const [rawUnit, setRawUnit] = useState("kg");
  const [rawCost, setRawCost] = useState("");
  const [rawStock, setRawStock] = useState("");
  const [rawMinAlert, setRawMinAlert] = useState("");
  const [rawPackQty, setRawPackQty] = useState("");
  const [rawPackUnit, setRawPackUnit] = useState("ml");
  const [savingRaw, setSavingRaw] = useState(false);

  // Restock Modal
  const [restockItem, setRestockItem] = useState(null);
  const [restockAmount, setRestockAmount] = useState("");
  const [restockCost, setRestockCost] = useState("");

  // Batch Production Planner state
  const [batchProductId, setBatchProductId] = useState("");
  const [batchServings, setBatchServings] = useState(25);

  // Load Firestore data
  useEffect(() => {
    if (!currentUid) {
      setLoading(false);
      return;
    }

    // 1. Raw Materials Sync (filters and purges dummy items)
    const rawRef = collection(db, "users", currentUid, "raw_materials");
    const unsubRaw = onSnapshot(rawRef, (snap) => {
      // Clean up any dummy starter materials from database
      snap.docs.forEach((d) => {
        const dName = (d.data()?.name || "").toLowerCase().trim();
        if (DUMMY_STARTER_NAMES.has(dName)) {
          deleteDoc(doc(db, "users", currentUid, "raw_materials", d.id)).catch(() => {});
        }
      });

      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((item) => {
          const name = (item.name || "").toLowerCase().trim();
          return !DUMMY_STARTER_NAMES.has(name);
        });
      list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setRawMaterials(list);
    }, (err) => {
      console.warn("Raw materials sync error:", err);
    });

    // 2. POS Inventory Sync (Chicken, Chinthu chicken, TATA Salt, bread etc. purchased in POS)
    const invRef = collection(db, "users", currentUid, "inventory");
    const unsubInv = onSnapshot(invRef, (snap) => {
      const list = snap.docs
        .map((d) => {
          const data = d.data();
          const itemName = data.itemName || data.name || "Stock Item";
          return {
            id: d.id,
            name: itemName,
            category: data.category || "Groceries",
            unit: data.unitType || "kg",
            costPerUnit: Number(data.purchasePrice || 0),
            stockQuantity: Number(data.quantity || 0),
            minAlertQuantity: 5,
            image: data.image || data.imageUrl || "",
            supplierName: data.supplierName || "Walk-in Supplier",
            fromInventory: true,
          };
        })
        .filter((item) => {
          const name = (item.name || "").toLowerCase().trim();
          return !DUMMY_STARTER_NAMES.has(name);
        });
      setPosInventoryItems(list);
    }, (err) => {
      console.warn("POS inventory sync error:", err);
    });

    // 3. Recipes Sync
    const recipesRef = collection(db, "users", currentUid, "recipes");
    const unsubRecipes = onSnapshot(recipesRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRecipes(list);
      setLoading(false);
    }, (err) => {
      console.warn("Recipes sync error:", err);
      setLoading(false);
    });

    return () => {
      unsubRaw();
      unsubInv();
      unsubRecipes();
    };
  }, [currentUid]);

  // Combined real raw materials (raw_materials + POS inventory items without dummy data)
  const combinedRawMaterials = useMemo(() => {
    const map = new Map();
    // 1. Add raw materials
    rawMaterials.forEach((r) => {
      const k = (r.name || "").toLowerCase().trim();
      if (k && !DUMMY_STARTER_NAMES.has(k)) {
        map.set(k, r);
      }
    });
    // 2. Add POS inventory items (Chicken, Chinthu chicken, TATA Salt, bread, etc.)
    posInventoryItems.forEach((p) => {
      const k = (p.name || "").toLowerCase().trim();
      if (k && !DUMMY_STARTER_NAMES.has(k)) {
        if (!map.has(k)) {
          map.set(k, p);
        } else {
          const existing = map.get(k);
          map.set(k, {
            ...existing,
            stockQuantity: Number(existing.stockQuantity ?? p.stockQuantity ?? 0),
            image: existing.image || p.image || "",
          });
        }
      }
    });
    const list = Array.from(map.values());
    list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return list;
  }, [rawMaterials, posInventoryItems]);

  // Map of recipe by productId for quick lookup
  const recipeMap = useMemo(() => {
    const map = {};
    recipes.forEach((r) => {
      if (r.productId) map[String(r.productId)] = r;
      if (r.id) map[String(r.id)] = r;
    });
    return map;
  }, [recipes]);

  // Categories list for filter
  const categoriesList = useMemo(() => {
    const set = new Set(["All"]);
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch =
        (p.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.category || "").toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        selectedCategory === "All" || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  // Low stock raw materials
  const lowStockMaterials = useMemo(() => {
    return combinedRawMaterials.filter((m) => {
      const stock = Number(m.stockQuantity) || 0;
      const min = Number(m.minAlertQuantity) || 0;
      return stock <= min;
    });
  }, [combinedRawMaterials]);

  // Raw categories for recipe configurator
  const rawCategories = useMemo(() => {
    const set = new Set(["All"]);
    combinedRawMaterials.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set);
  }, [combinedRawMaterials]);

  // Filtered raw materials for recipe ingredient picker shelf
  const filteredRawForRecipe = useMemo(() => {
    return combinedRawMaterials.filter((r) => {
      const matchSearch =
        (r.name || "").toLowerCase().includes(recipeRawSearch.toLowerCase()) ||
        (r.category || "").toLowerCase().includes(recipeRawSearch.toLowerCase());
      const matchCat = recipeRawCategory === "All" || r.category === recipeRawCategory;
      return matchSearch && matchCat;
    });
  }, [combinedRawMaterials, recipeRawSearch, recipeRawCategory]);

  // Quick Starter Loader
  const handleLoadStarterMaterials = async () => {
    if (!currentUid) return;
    if (rawMaterials.length > 0 && !window.confirm("Add standard cafe/restaurant starter ingredients to your list?")) {
      return;
    }
    setLoading(true);
    try {
      for (const item of STARTER_RAW_MATERIALS) {
        const docRef = doc(collection(db, "users", currentUid, "raw_materials"));
        await setDoc(docRef, {
          ...item,
          id: docRef.id,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        });
      }
      alert("✅ Added 16 standard cafe/restaurant ingredients successfully!");
    } catch (err) {
      alert("Error adding starter ingredients: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Select raw material and auto-detect best unit & pack size
  const handleSelectRawMaterial = (raw) => {
    if (!raw) return;
    setSelectedRawId(raw.id);
    const rUnit = String(raw.unit || "pcs").toLowerCase().trim();
    const isLiquid = /milk|juice|water|oil|syrup|sauce|soda|beverage/i.test(raw.name || "");

    let defaultUnit = "g";
    if (rUnit === "l" || rUnit === "ml" || isLiquid) {
      defaultUnit = "ml";
    } else if (rUnit === "kg" || rUnit === "g") {
      defaultUnit = "g";
    } else if (rUnit === "pcs") {
      defaultUnit = "pcs";
    } else {
      defaultUnit = isLiquid ? "ml" : "g";
    }
    setIngredientUnit(defaultUnit);

    // Determine pack size from raw material, item name, or smart defaults
    let pQty = raw.packQuantity || raw.packSizeVal || "";
    let pUnit = raw.packUnit || raw.packSizeUnit || "";
    if (!pQty && raw.name) {
      const parsed = parsePackSizeFromName(raw.name);
      if (parsed) {
        pQty = parsed.val;
        pUnit = parsed.unit;
      }
    }
    if (!pQty) {
      if (defaultUnit === "ml" || isLiquid) {
        pQty = "500"; // e.g. 500 ml packet for milk
        pUnit = "ml";
      } else if (defaultUnit === "g") {
        pQty = "100"; // e.g. 100 g packet for spices/powder
        pUnit = "g";
      }
    }
    setIngredientPackQty(pQty ? String(pQty) : "");
    setIngredientPackUnit(pUnit || defaultUnit);
  };

  // Open Recipe Modal for a Product
  const handleOpenRecipeModal = (product) => {
    setEditingRecipeProduct(product);
    const existing = recipeMap[String(product.id)];
    if (existing) {
      // Auto-sanitize existing ingredients to fix previously inflated unscaled costs
      const sanitizedIngredients = (existing.ingredients || []).map((ing) => {
        const raw = combinedRawMaterials.find((r) => r.id === ing.rawMaterialId) ||
                    rawMaterials.find((r) => r.id === ing.rawMaterialId) ||
                    combinedRawMaterials.find((r) => (r.name || "").toLowerCase().trim() === (ing.name || "").toLowerCase().trim()) ||
                    { costPerUnit: ing.baseCost, unit: ing.baseUnit, packQuantity: ing.packQuantity, packUnit: ing.packUnit, name: ing.name };

        let pQty = ing.packQuantity || raw.packQuantity || raw.packSizeVal;
        let pUnit = ing.packUnit || raw.packUnit || raw.packSizeUnit;

        if (!pQty && raw.name) {
          const parsed = parsePackSizeFromName(raw.name);
          if (parsed) {
            pQty = parsed.val;
            pUnit = parsed.unit;
          }
        }
        if (!pQty) {
          if (/milk|juice|water|oil|syrup/i.test(ing.name || "")) {
            pQty = 500;
            pUnit = "ml";
          } else if (/coffee|powder|tea|spice|masala/i.test(ing.name || "")) {
            pQty = 100;
            pUnit = "g";
          }
        }

        const calculatedCost = computeIngredientCost(
          ing.quantity,
          ing.unit,
          raw,
          pQty,
          pUnit
        );

        return {
          ...ing,
          baseCost: Number(raw.costPerUnit || ing.baseCost || 0),
          baseUnit: raw.unit || ing.baseUnit || "pcs",
          packQuantity: pQty ? Number(pQty) : ing.packQuantity || null,
          packUnit: pUnit || ing.packUnit || ing.unit,
          cost: Number(calculatedCost.toFixed(2)),
        };
      });

      setCurrentIngredients(sanitizedIngredients);
      setWastagePercent(existing.wastagePercent !== undefined ? existing.wastagePercent : 3);
      setPrepInstructions(existing.prepInstructions || "");
    } else {
      setCurrentIngredients([]);
      setWastagePercent(3);
      setPrepInstructions("");
    }
    setSelectedRawId("");
    setIngredientQty("");
    setIngredientPackQty("");
  };

  // Add Ingredient to Current Recipe
  const handleAddIngredient = async () => {
    if (!selectedRawId) {
      alert("Please select a raw material ingredient from the shelf above.");
      return;
    }
    const raw = combinedRawMaterials.find((r) => r.id === selectedRawId) || rawMaterials.find((r) => r.id === selectedRawId);
    if (!raw) return;

    const qty = parseFloat(ingredientQty);
    if (isNaN(qty) || qty <= 0) {
      alert("Please enter a valid quantity greater than 0.");
      return;
    }

    const calculatedCost = computeIngredientCost(
      qty,
      ingredientUnit,
      raw,
      ingredientPackQty ? parseFloat(ingredientPackQty) : undefined,
      ingredientPackUnit
    );

    const newIng = {
      rawMaterialId: raw.id,
      name: raw.name,
      category: raw.category || "General",
      quantity: qty,
      unit: ingredientUnit,
      baseUnit: raw.unit || "pcs",
      baseCost: Number(raw.costPerUnit || raw.purchasePrice || 0),
      packQuantity: ingredientPackQty ? parseFloat(ingredientPackQty) : null,
      packUnit: ingredientPackUnit || ingredientUnit,
      cost: Number(calculatedCost.toFixed(2)),
      image: raw.image || "",
    };

    setCurrentIngredients((prev) => [...prev, newIng]);

    // Persist pack size to raw material in Firestore if not already saved
    if (ingredientPackQty && currentUid && (!raw.packQuantity || raw.packQuantity !== parseFloat(ingredientPackQty))) {
      try {
        await updateDoc(doc(db, "users", currentUid, "raw_materials", raw.id), {
          packQuantity: parseFloat(ingredientPackQty),
          packUnit: ingredientPackUnit || ingredientUnit,
          updatedAtMs: Date.now(),
        });
      } catch (_) {}
    }

    setSelectedRawId("");
    setIngredientQty("");
    setIngredientPackQty("");
  };

  // Inline update of pack capacity in recipe ingredients table
  const handleUpdateIngredientPack = (index, newPackQty) => {
    const pQty = parseFloat(newPackQty);
    setCurrentIngredients((prev) =>
      prev.map((ing, i) => {
        if (i !== index) return ing;
        const raw = combinedRawMaterials.find((r) => r.id === ing.rawMaterialId) ||
                    rawMaterials.find((r) => r.id === ing.rawMaterialId) || ing;
        const targetPackQty = pQty > 0 ? pQty : ing.packQuantity;
        const newCost = computeIngredientCost(
          ing.quantity,
          ing.unit,
          raw,
          targetPackQty,
          ing.packUnit || ing.unit
        );
        return {
          ...ing,
          packQuantity: targetPackQty,
          cost: Number(newCost.toFixed(2)),
        };
      })
    );
  };

  const handleRemoveIngredient = (index) => {
    setCurrentIngredients((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Live Recipe Financials
  const recipeFinancials = useMemo(() => {
    const rawCostSum = currentIngredients.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
    const wastageAmt = (rawCostSum * (Number(wastagePercent) || 0)) / 100;
    const totalMakingCost = Number((rawCostSum + wastageAmt).toFixed(2));
    const sellingPrice = Number(editingRecipeProduct?.price || editingRecipeProduct?.salesPrice || 0);
    const grossProfit = Number((sellingPrice - totalMakingCost).toFixed(2));
    const profitMarginPercent = sellingPrice > 0 ? Number(((grossProfit / sellingPrice) * 100).toFixed(1)) : 0;
    const foodCostPercent = sellingPrice > 0 ? Number(((totalMakingCost / sellingPrice) * 100).toFixed(1)) : 0;

    // Target Selling Price Calculator (e.g. at 30% food cost target)
    const target30Price = totalMakingCost > 0 ? Number((totalMakingCost / 0.30).toFixed(2)) : 0;
    const target35Price = totalMakingCost > 0 ? Number((totalMakingCost / 0.35).toFixed(2)) : 0;

    return {
      rawCostSum,
      wastageAmt,
      totalMakingCost,
      sellingPrice,
      grossProfit,
      profitMarginPercent,
      foodCostPercent,
      target30Price,
      target35Price,
    };
  }, [currentIngredients, wastagePercent, editingRecipeProduct]);

  // Save Recipe to Firestore
  const handleSaveRecipe = async () => {
    if (!currentUid || !editingRecipeProduct) return;
    setSavingRecipe(true);
    try {
      const prodId = String(editingRecipeProduct.id);
      const recipeData = {
        id: prodId,
        productId: prodId,
        productName: editingRecipeProduct.name || "Food Item",
        productCategory: editingRecipeProduct.category || "General",
        productImage: editingRecipeProduct.image || editingRecipeProduct.imageUrl || "",
        sellingPrice: recipeFinancials.sellingPrice,
        ingredients: currentIngredients,
        wastagePercent: Number(wastagePercent) || 0,
        totalMakingCost: recipeFinancials.totalMakingCost,
        grossProfit: recipeFinancials.grossProfit,
        profitMarginPercent: recipeFinancials.profitMarginPercent,
        foodCostPercent: recipeFinancials.foodCostPercent,
        prepInstructions: prepInstructions.trim(),
        ingredientCount: currentIngredients.length,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      };

      // 1. Save in recipes collection
      await setDoc(doc(db, "users", currentUid, "recipes", prodId), recipeData);

      // 2. Also update product in restaurant_menu / inventory for instant badge display
      try {
        await updateDoc(doc(db, "users", currentUid, "restaurant_menu", prodId), {
          makingCost: recipeFinancials.totalMakingCost,
          grossProfit: recipeFinancials.grossProfit,
          profitMarginPercent: recipeFinancials.profitMarginPercent,
          foodCostPercent: recipeFinancials.foodCostPercent,
          hasRecipe: currentIngredients.length > 0,
        });
      } catch (_) {
        try {
          await updateDoc(doc(db, "users", currentUid, "inventory", prodId), {
            makingCost: recipeFinancials.totalMakingCost,
            grossProfit: recipeFinancials.grossProfit,
            profitMarginPercent: recipeFinancials.profitMarginPercent,
            foodCostPercent: recipeFinancials.foodCostPercent,
            hasRecipe: currentIngredients.length > 0,
          });
        } catch (_) {}
      }

      setEditingRecipeProduct(null);
      alert(`✅ Recipe for "${editingRecipeProduct.name}" saved! Making cost: ₹${recipeFinancials.totalMakingCost}`);
    } catch (err) {
      alert("Error saving recipe: " + err.message);
    } finally {
      setSavingRecipe(false);
    }
  };

  // Save Raw Material (Add/Edit)
  const handleSaveRawMaterial = async () => {
    if (!currentUid || !rawName.trim()) {
      alert("Please enter ingredient name.");
      return;
    }
    const cost = parseFloat(rawCost);
    if (isNaN(cost) || cost < 0) {
      alert("Please enter a valid cost per unit.");
      return;
    }
    setSavingRaw(true);
    try {
      const payload = {
        name: rawName.trim(),
        category: rawCategory,
        unit: rawUnit,
        costPerUnit: cost,
        stockQuantity: parseFloat(rawStock) || 0,
        minAlertQuantity: parseFloat(rawMinAlert) || 0,
        packQuantity: rawPackQty ? parseFloat(rawPackQty) : null,
        packUnit: rawPackQty ? rawPackUnit : null,
        updatedAtMs: Date.now(),
      };

      if (editingRawItem?.id) {
        await updateDoc(doc(db, "users", currentUid, "raw_materials", editingRawItem.id), payload);
      } else {
        const newRef = doc(collection(db, "users", currentUid, "raw_materials"));
        await setDoc(newRef, {
          ...payload,
          id: newRef.id,
          createdAtMs: Date.now(),
        });
      }

      setShowRawModal(false);
      setEditingRawItem(null);
      setRawName("");
      setRawCost("");
      setRawStock("");
      setRawMinAlert("");
      setRawPackQty("");
      setRawPackUnit("ml");
    } catch (err) {
      alert("Error saving ingredient: " + err.message);
    } finally {
      setSavingRaw(false);
    }
  };

  // Delete Raw Material
  const handleDeleteRawMaterial = async (id, name) => {
    if (!window.confirm(`Delete "${name}" from ingredients?`)) return;
    try {
      await deleteDoc(doc(db, "users", currentUid, "raw_materials", id));
    } catch (err) {
      alert("Error deleting ingredient: " + err.message);
    }
  };

  // Handle Restock
  const handleApplyRestock = async () => {
    if (!currentUid || !restockItem) return;
    const added = parseFloat(restockAmount);
    if (isNaN(added) || added <= 0) {
      alert("Please enter a valid stock quantity to add.");
      return;
    }
    try {
      const newStock = (Number(restockItem.stockQuantity) || 0) + added;
      const updates = {
        stockQuantity: Number(newStock.toFixed(2)),
        updatedAtMs: Date.now(),
      };
      if (restockCost && !isNaN(parseFloat(restockCost))) {
        updates.costPerUnit = parseFloat(restockCost);
      }
      await updateDoc(doc(db, "users", currentUid, "raw_materials", restockItem.id), updates);
      setRestockItem(null);
      setRestockAmount("");
      setRestockCost("");
      alert(`✅ Added +${added} ${restockItem.unit} to ${restockItem.name}! New stock: ${newStock} ${restockItem.unit}`);
    } catch (err) {
      alert("Error updating stock: " + err.message);
    }
  };

  // Print Recipe Card
  const handlePrintRecipeCard = (product, recipe) => {
    if (!recipe || !recipe.ingredients?.length) {
      alert("No recipe configured for this item yet.");
      return;
    }
    const store = userProfile.storeName || "Turf Cafe";
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Recipe SOP - ${product.name}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #0f172a; max-width: 650px; margin: auto; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
            .title { font-size: 22px; font-weight: 900; margin: 0; color: #0f172a; }
            .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
            .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 6px; font-weight: 800; font-size: 12px; margin-top: 6px; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
            th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
            th { background: #f8fafc; font-weight: 800; color: #475569; text-transform: uppercase; font-size: 11px; }
            .qty { font-weight: 800; color: #0f172a; }
            .cost { text-align: right; font-weight: 700; color: #334155; }
            .financial-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
            .fin-item { text-align: center; }
            .fin-lbl { font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; }
            .fin-val { font-size: 16px; font-weight: 900; margin-top: 2px; }
            .instructions { background: #fffbeb; border: 1px solid #fef3c7; padding: 12px; border-radius: 8px; margin-top: 16px; font-size: 12.5px; }
            .footer { margin-top: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px dashed #cbd5e1; padding-top: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="subtitle">${store} • Standard Operating Procedure</div>
              <h1 class="title">🥘 Recipe: ${product.name}</h1>
              <span class="badge">${product.category || "Food Item"}</span>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: 900; color: #16a34a;">₹${recipe.sellingPrice || product.price || 0}</div>
              <div style="font-size: 11px; color: #64748b;">Selling Price</div>
            </div>
          </div>

          <h3 style="font-size: 14px; margin: 14px 0 6px 0; color: #334155; text-transform: uppercase;">Ingredients per Portion:</h3>
          <table>
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Quantity</th>
                <th style="text-align: right;">Cost (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${(recipe.ingredients || []).map((i) => `
                <tr>
                  <td><strong>${i.name}</strong></td>
                  <td class="qty">${i.quantity} ${i.unit}</td>
                  <td class="cost">₹${Number(i.cost || 0).toFixed(2)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div class="financial-grid">
            <div class="fin-item">
              <div class="fin-lbl">Food Cost (COGS)</div>
              <div class="fin-val" style="color: #ea580c;">₹${recipe.totalMakingCost}</div>
            </div>
            <div class="fin-item">
              <div class="fin-lbl">Gross Margin</div>
              <div class="fin-val" style="color: #16a34a;">+₹${recipe.grossProfit} (${recipe.profitMarginPercent}%)</div>
            </div>
            <div class="fin-item">
              <div class="fin-lbl">Food Cost %</div>
              <div class="fin-val" style="color: ${recipe.foodCostPercent > 40 ? '#ef4444' : '#16a34a'};">${recipe.foodCostPercent}%</div>
            </div>
          </div>

          ${recipe.prepInstructions ? `
            <div class="instructions">
              <strong>👨‍🍳 Preparation & Cooking Steps:</strong><br/>
              ${recipe.prepInstructions.replace(/\n/g, "<br/>")}
            </div>
          ` : ""}

          <div class="footer">
            Printed from ${store} POS Recipe Management • Accurate portion control ensures taste consistency & maximum profit!
          </div>
          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100vh", padding: "24px 32px", boxSizing: "border-box", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Top Header */}
      <div style={{ maxWidth: "1400px", margin: "0 auto 20px auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                style={{
                  backgroundColor: "#ffffff",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: "10px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontWeight: "800",
                  fontSize: "13px",
                  color: "#334155",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}
              >
                <span>←</span>
                <span>Back to POS</span>
              </button>
            )}
            <div>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: "900", color: "#0f172a", display: "flex", alignItems: "center", gap: "10px" }}>
                <span>🥘</span>
                <span>Recipe Management & Food Costing</span>
                <span style={{ fontSize: "11px", backgroundColor: "#dbeafe", color: "#1e40af", padding: "3px 9px", borderRadius: "8px", fontWeight: "800" }}>
                  BOM & PROFIT CALCULATOR
                </span>
              </h1>
              <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b" }}>
                Define exact ingredients for each food item, calculate true making costs (COGS), track profit margins, and manage raw stock.
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {rawMaterials.length === 0 && (
              <button
                type="button"
                onClick={handleLoadStarterMaterials}
                style={{
                  backgroundColor: "#eff6ff",
                  border: "1.5px solid #bfdbfe",
                  borderRadius: "10px",
                  padding: "9px 16px",
                  fontWeight: "800",
                  fontSize: "13px",
                  color: "#1d4ed8",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>✨</span>
                <span>Load Starter Ingredients</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setEditingRawItem(null);
                setRawName("");
                setRawCategory("Groceries");
                setRawUnit("kg");
                setRawCost("");
                setRawStock("");
                setRawMinAlert("");
                setShowRawModal(true);
              }}
              style={{
                backgroundColor: "#ea580c",
                border: "none",
                borderRadius: "10px",
                padding: "9px 18px",
                fontWeight: "800",
                fontSize: "13px",
                color: "#ffffff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 8px rgba(234, 88, 12, 0.25)",
              }}
            >
              <span>+</span>
              <span>Add Raw Ingredient</span>
            </button>
          </div>
        </div>

        {/* Low Stock Alert Banner */}
        {lowStockMaterials.length > 0 && (
          <div
            style={{
              backgroundColor: "#fff7ed",
              border: "1.5px solid #fed7aa",
              borderRadius: "12px",
              padding: "10px 16px",
              marginTop: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠️</span>
              <div>
                <span style={{ fontWeight: "800", color: "#c2410c", fontSize: "13px" }}>
                  {lowStockMaterials.length} Raw Ingredient{lowStockMaterials.length > 1 ? "s" : ""} Low on Stock!
                </span>
                <span style={{ fontSize: "12px", color: "#9a3412", marginLeft: "8px" }}>
                  {lowStockMaterials.map((m) => `${m.name} (${m.stockQuantity} ${m.unit})`).join(", ")}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("raw_materials")}
              style={{
                backgroundColor: "#ea580c",
                color: "#fff",
                border: "none",
                padding: "6px 14px",
                borderRadius: "8px",
                fontWeight: "800",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Restock Now →
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: "8px", marginTop: "18px", borderBottom: "1.5px solid #e2e8f0", paddingBottom: "10px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("recipes")}
            style={{
              padding: "9px 18px",
              borderRadius: "10px",
              border: "none",
              fontWeight: "800",
              fontSize: "13.5px",
              cursor: "pointer",
              backgroundColor: activeTab === "recipes" ? "#0f172a" : "#ffffff",
              color: activeTab === "recipes" ? "#ffffff" : "#475569",
              boxShadow: activeTab === "recipes" ? "0 2px 8px rgba(15, 23, 42, 0.2)" : "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>📖</span>
            <span>Food Recipes & Costing</span>
            <span style={{
              backgroundColor: activeTab === "recipes" ? "#334155" : "#f1f5f9",
              color: activeTab === "recipes" ? "#93c5fd" : "#64748b",
              padding: "1px 7px",
              borderRadius: "8px",
              fontSize: "11px",
              fontWeight: "900",
            }}>
              {products.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("raw_materials")}
            style={{
              padding: "9px 18px",
              borderRadius: "10px",
              border: "none",
              fontWeight: "800",
              fontSize: "13.5px",
              cursor: "pointer",
              backgroundColor: activeTab === "raw_materials" ? "#0f172a" : "#ffffff",
              color: activeTab === "raw_materials" ? "#ffffff" : "#475569",
              boxShadow: activeTab === "raw_materials" ? "0 2px 8px rgba(15, 23, 42, 0.2)" : "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🌾</span>
            <span>Raw Materials Store</span>
            <span style={{
              backgroundColor: activeTab === "raw_materials" ? "#334155" : "#f1f5f9",
              color: activeTab === "raw_materials" ? "#93c5fd" : "#64748b",
              padding: "1px 7px",
              borderRadius: "8px",
              fontSize: "11px",
              fontWeight: "900",
            }}>
              {rawMaterials.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("batch_planner")}
            style={{
              padding: "9px 18px",
              borderRadius: "10px",
              border: "none",
              fontWeight: "800",
              fontSize: "13.5px",
              cursor: "pointer",
              backgroundColor: activeTab === "batch_planner" ? "#0f172a" : "#ffffff",
              color: activeTab === "batch_planner" ? "#ffffff" : "#475569",
              boxShadow: activeTab === "batch_planner" ? "0 2px 8px rgba(15, 23, 42, 0.2)" : "0 1px 3px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🥣</span>
            <span>Batch Production Planner</span>
          </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* ================= TAB 1: RECIPES & FOOD COSTING ================= */}
        {activeTab === "recipes" && (
          <div>
            {/* Filter & Search Bar */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "260px", position: "relative" }}>
                <input
                  type="text"
                  placeholder="🔍 Search food dish by name or category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "1.5px solid #cbd5e1",
                    fontSize: "13.5px",
                    boxSizing: "border-box",
                    outline: "none",
                    backgroundColor: "#ffffff",
                  }}
                />
              </div>

              {/* Category Pills */}
              <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
                {categoriesList.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "8px",
                      border: "none",
                      fontSize: "12.5px",
                      fontWeight: "700",
                      cursor: "pointer",
                      backgroundColor: selectedCategory === cat ? "#0284c7" : "#ffffff",
                      color: selectedCategory === cat ? "#ffffff" : "#475569",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Food Items Recipe Grid */}
            {filteredProducts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", backgroundColor: "#fff", borderRadius: "16px", border: "1px dashed #cbd5e1" }}>
                <div style={{ fontSize: "40px", marginBottom: "8px" }}>🍽️</div>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "#334155" }}>No Food Items Found</div>
                <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0 0" }}>
                  Add food items in the Menu Items screen to configure their recipes and costing here.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "18px" }}>
                {filteredProducts.map((product) => {
                  const recipe = recipeMap[String(product.id)];
                  const hasRecipe = !!(recipe && recipe.ingredients && recipe.ingredients.length > 0);
                  const price = Number(product.price || product.salesPrice || 0);
                  let makingCost = hasRecipe ? Number(recipe.totalMakingCost || 0) : 0;
                  if (hasRecipe && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) {
                    const rawSum = recipe.ingredients.reduce((sum, ing) => {
                      const raw = combinedRawMaterials.find((r) => r.id === ing.rawMaterialId) ||
                                  combinedRawMaterials.find((r) => (r.name || "").toLowerCase().trim() === (ing.name || "").toLowerCase().trim()) || ing;
                      return sum + computeIngredientCost(ing.quantity, ing.unit, raw, ing.packQuantity, ing.packUnit);
                    }, 0);
                    const wastage = (rawSum * (Number(recipe.wastagePercent !== undefined ? recipe.wastagePercent : 3))) / 100;
                    makingCost = Number((rawSum + wastage).toFixed(2));
                  }
                  const profit = hasRecipe ? Number((price - makingCost).toFixed(2)) : 0;
                  const foodCostPct = hasRecipe && price > 0 ? Number(((makingCost / price) * 100).toFixed(1)) : 0;
                  const profitMarginPct = hasRecipe && price > 0 ? Number(((profit / price) * 100).toFixed(1)) : 0;

                  // Health Status Tag
                  const isHealthy = foodCostPct > 0 && foodCostPct <= 35;
                  const isModerate = foodCostPct > 35 && foodCostPct <= 45;
                  const isHighCost = foodCostPct > 45;

                  return (
                    <div
                      key={product.id}
                      style={{
                        backgroundColor: "#ffffff",
                        borderRadius: "16px",
                        border: hasRecipe ? "1.5px solid #e2e8f0" : "1.5px dashed #cbd5e1",
                        padding: "16px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div>
                        {/* Top Product Info Row */}
                        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "12px" }}>
                          <img
                            src={product.image || product.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"}
                            alt={product.name}
                            style={{ width: "64px", height: "64px", borderRadius: "12px", objectFit: "cover", backgroundColor: "#f1f5f9" }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "900", color: "#0f172a", wordBreak: "break-word" }}>
                                {product.name}
                              </h3>
                              <span style={{ fontSize: "16px", fontWeight: "900", color: "#0284c7" }}>
                                ₹{price}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                              <span style={{ fontSize: "11px", backgroundColor: "#f1f5f9", color: "#475569", padding: "2px 7px", borderRadius: "6px", fontWeight: "700" }}>
                                {product.category || "General"}
                              </span>
                              {hasRecipe ? (
                                <span style={{ fontSize: "11px", backgroundColor: "#dcfce7", color: "#166534", padding: "2px 7px", borderRadius: "6px", fontWeight: "800" }}>
                                  ✓ Recipe ({recipe.ingredients.length} items)
                                </span>
                              ) : (
                                <span style={{ fontSize: "11px", backgroundColor: "#fef3c7", color: "#b45309", padding: "2px 7px", borderRadius: "6px", fontWeight: "800" }}>
                                  ⚠️ No Recipe Configured
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Financial Analysis Grid if configured */}
                        {hasRecipe ? (
                          <div style={{ backgroundColor: "#f8fafc", borderRadius: "12px", padding: "12px", border: "1px solid #e2e8f0", marginBottom: "14px" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", textAlign: "center" }}>
                              <div>
                                <div style={{ fontSize: "10.5px", color: "#64748b", fontWeight: "800", textTransform: "uppercase" }}>Making Cost</div>
                                <div style={{ fontSize: "15px", fontWeight: "900", color: "#ea580c", marginTop: "2px" }}>
                                  ₹{makingCost}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: "10.5px", color: "#64748b", fontWeight: "800", textTransform: "uppercase" }}>Gross Profit</div>
                                <div style={{ fontSize: "15px", fontWeight: "900", color: profit >= 0 ? "#16a34a" : "#ef4444", marginTop: "2px" }}>
                                  ₹{profit}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: "10.5px", color: "#64748b", fontWeight: "800", textTransform: "uppercase" }}>Food Cost %</div>
                                <div style={{ fontSize: "15px", fontWeight: "900", color: isHealthy ? "#16a34a" : isModerate ? "#f59e0b" : "#ef4444", marginTop: "2px" }}>
                                  {foodCostPct}%
                                </div>
                              </div>
                            </div>

                            {/* Margin Gauge Tag */}
                            <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed #cbd5e1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: "11px", color: "#64748b" }}>
                                Profit Margin: <strong style={{ color: "#0f172a" }}>{profitMarginPct}%</strong>
                              </span>
                              <span style={{
                                fontSize: "10.5px",
                                fontWeight: "800",
                                padding: "2px 8px",
                                borderRadius: "6px",
                                backgroundColor: isHealthy ? "#dcfce7" : isModerate ? "#fef3c7" : "#fee2e2",
                                color: isHealthy ? "#15803d" : isModerate ? "#b45309" : "#b91c1c",
                              }}>
                                {isHealthy ? "🟢 High Margin" : isModerate ? "🟡 Healthy Margin" : "🔴 Low Margin / High Cost"}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ backgroundColor: "#fefce8", border: "1px dashed #fde047", borderRadius: "10px", padding: "12px", marginBottom: "14px", textAlign: "center" }}>
                            <div style={{ fontSize: "12px", color: "#854d0e", fontWeight: "700" }}>
                              Tap "Configure Recipe" to add ingredients and calculate profit margin per serving!
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Card Action Buttons */}
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => handleOpenRecipeModal(product)}
                          style={{
                            flex: 1,
                            backgroundColor: hasRecipe ? "#0f172a" : "#ea580c",
                            color: "#ffffff",
                            border: "none",
                            padding: "9px 12px",
                            borderRadius: "10px",
                            fontWeight: "800",
                            fontSize: "12.5px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                          }}
                        >
                          <span>{hasRecipe ? "✏️ Edit Recipe" : "➕ Configure Recipe"}</span>
                        </button>

                        {hasRecipe && (
                          <button
                            type="button"
                            onClick={() => handlePrintRecipeCard(product, recipe)}
                            style={{
                              backgroundColor: "#f8fafc",
                              border: "1.5px solid #cbd5e1",
                              color: "#334155",
                              padding: "9px 12px",
                              borderRadius: "10px",
                              fontWeight: "700",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                            title="Print Kitchen Recipe SOP Slip"
                          >
                            <span>🖨️</span>
                            <span>Print SOP</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: RAW MATERIALS STORE ================= */}
        {activeTab === "raw_materials" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                  🌾 Ingredients & Raw Materials Inventory
                </h2>
                <div style={{ fontSize: "12.5px", color: "#64748b" }}>
                  Add raw materials with purchase rates (per kg, per litre, per piece). Recipes use these rates for automatic food costing.
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingRawItem(null);
                  setRawName("");
                  setRawCategory("Groceries");
                  setRawUnit("kg");
                  setRawCost("");
                  setRawStock("");
                  setRawMinAlert("");
                  setRawPackQty("");
                  setRawPackUnit("ml");
                  setShowRawModal(true);
                }}
                style={{
                  backgroundColor: "#ea580c",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "10px",
                  fontWeight: "800",
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>+</span>
                <span>Add Ingredient</span>
              </button>
            </div>

            {/* Raw Materials Table */}
            {combinedRawMaterials.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", backgroundColor: "#fff", borderRadius: "16px", border: "1px dashed #cbd5e1" }}>
                <div style={{ fontSize: "40px", marginBottom: "8px" }}>🌾</div>
                <div style={{ fontSize: "16px", fontWeight: "800", color: "#334155" }}>No Raw Materials or Stock Added Yet</div>
                <p style={{ fontSize: "13px", color: "#64748b", margin: "6px 0 16px 0" }}>
                  Record stock purchases in POS or Purchase Report, or add custom restaurant ingredients.
                </p>
              </div>
            ) : (
              <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", border: "1.5px solid #e2e8f0", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1.5px solid #e2e8f0", color: "#475569" }}>
                      <th style={{ padding: "12px 16px", fontWeight: "800" }}>Ingredient Name</th>
                      <th style={{ padding: "12px 16px", fontWeight: "800" }}>Category</th>
                      <th style={{ padding: "12px 16px", fontWeight: "800" }}>Base Unit</th>
                      <th style={{ padding: "12px 16px", fontWeight: "800", textAlign: "right" }}>Purchase Cost</th>
                      <th style={{ padding: "12px 16px", fontWeight: "800", textAlign: "right" }}>In-Hand Stock</th>
                      <th style={{ padding: "12px 16px", fontWeight: "800", textAlign: "center" }}>Status</th>
                      <th style={{ padding: "12px 16px", fontWeight: "800", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combinedRawMaterials.map((item) => {
                      const stock = Number(item.stockQuantity) || 0;
                      const min = Number(item.minAlertQuantity) || 0;
                      const isLow = stock <= min;

                      return (
                        <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "12px 16px", fontWeight: "800", color: "#0f172a" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <img
                                src={getGroceryImage(item.name, item.category, item.image)}
                                alt={item.name}
                                style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "cover" }}
                                onError={(e) => {
                                  e.target.onerror = null;
                                  e.target.src = getGroceryImage("grocery", "general");
                                }}
                              />
                              <span>{item.name}</span>
                            </div>
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span style={{ fontSize: "11px", backgroundColor: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: "6px", fontWeight: "700" }}>
                              {item.category || "General"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", color: "#64748b", fontWeight: "700" }}>
                            {item.unit}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: "800", color: "#0f172a" }}>
                            <div>₹{item.costPerUnit} / {item.unit}</div>
                            {item.packQuantity ? (
                              <div style={{ fontSize: "11px", color: "#ea580c", fontWeight: "700" }}>
                                1 {item.unit} = {item.packQuantity} {item.packUnit}
                              </div>
                            ) : null}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: "900", color: isLow ? "#ea580c" : "#16a34a" }}>
                            {stock} {item.unit}
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "center" }}>
                            <span style={{
                              fontSize: "11px",
                              fontWeight: "800",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              backgroundColor: isLow ? "#fff7ed" : "#dcfce7",
                              color: isLow ? "#c2410c" : "#15803d",
                              border: isLow ? "1px solid #fed7aa" : "1px solid #86efac",
                            }}>
                              {isLow ? `⚠️ Low (Min: ${min})` : "✓ In Stock"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setRestockItem(item);
                                  setRestockAmount("");
                                  setRestockCost(String(item.costPerUnit || ""));
                                }}
                                style={{
                                  backgroundColor: "#f0fdf4",
                                  border: "1px solid #86efac",
                                  color: "#166534",
                                  padding: "5px 10px",
                                  borderRadius: "7px",
                                  fontSize: "11.5px",
                                  fontWeight: "800",
                                  cursor: "pointer",
                                }}
                              >
                                + Restock
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRawItem(item);
                                  setRawName(item.name || "");
                                  setRawCategory(item.category || "Groceries");
                                  setRawUnit(item.unit || "kg");
                                  setRawCost(String(item.costPerUnit || ""));
                                  setRawStock(String(item.stockQuantity || ""));
                                  setRawMinAlert(String(item.minAlertQuantity || ""));
                                  setRawPackQty(item.packQuantity ? String(item.packQuantity) : "");
                                  setRawPackUnit(item.packUnit || (item.unit === "L" || item.unit === "ml" ? "ml" : "g"));
                                  setShowRawModal(true);
                                }}
                                style={{
                                  backgroundColor: "#f1f5f9",
                                  border: "1px solid #cbd5e1",
                                  color: "#334155",
                                  padding: "5px 10px",
                                  borderRadius: "7px",
                                  fontSize: "11.5px",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRawMaterial(item.id, item.name)}
                                style={{
                                  backgroundColor: "transparent",
                                  border: "1px solid #fee2e2",
                                  color: "#dc2626",
                                  padding: "5px 8px",
                                  borderRadius: "7px",
                                  fontSize: "11px",
                                  cursor: "pointer",
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 3: BATCH PRODUCTION PLANNER ================= */}
        {activeTab === "batch_planner" && (
          <div>
            <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", border: "1.5px solid #e2e8f0", padding: "20px", marginBottom: "20px" }}>
              <h2 style={{ margin: "0 0 6px 0", fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                🥣 Batch Production & Kitchen Prep Calculator
              </h2>
              <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
                Planning to cook in bulk for morning rush or party orders? Select a dish and batch quantity to calculate exact raw material weights and total batch cost.
              </p>

              {/* Selector Controls */}
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "240px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "6px" }}>
                    Select Food Dish with Configured Recipe:
                  </label>
                  <select
                    value={batchProductId}
                    onChange={(e) => setBatchProductId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1.5px solid #cbd5e1",
                      fontSize: "13.5px",
                      fontWeight: "700",
                      backgroundColor: "#ffffff",
                    }}
                  >
                    <option value="">-- Choose a dish --</option>
                    {products.map((p) => {
                      const rec = recipeMap[String(p.id)];
                      if (!rec || !rec.ingredients?.length) return null;
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name} (Making Cost: ₹{rec.totalMakingCost})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "6px" }}>
                    Portions / Cups to Prepare:
                  </label>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {[10, 25, 50, 100].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setBatchServings(qty)}
                        style={{
                          padding: "8px 14px",
                          borderRadius: "8px",
                          border: "none",
                          fontSize: "12px",
                          fontWeight: "800",
                          cursor: "pointer",
                          backgroundColor: batchServings === qty ? "#ea580c" : "#f1f5f9",
                          color: batchServings === qty ? "#ffffff" : "#475569",
                        }}
                      >
                        {qty} Servings
                      </button>
                    ))}
                    <input
                      type="number"
                      min="1"
                      value={batchServings}
                      onChange={(e) => setBatchServings(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{
                        width: "80px",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "1.5px solid #cbd5e1",
                        fontSize: "13px",
                        fontWeight: "800",
                        textAlign: "center",
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Batch Results View */}
            {(() => {
              if (!batchProductId) {
                return (
                  <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
                    <div style={{ fontSize: "36px", marginBottom: "8px" }}>📋</div>
                    <div style={{ fontSize: "14px", fontWeight: "700" }}>Choose a dish above to calculate bulk batch requirements</div>
                  </div>
                );
              }

              const product = products.find((p) => String(p.id) === String(batchProductId));
              const recipe = recipeMap[String(batchProductId)];
              if (!recipe || !recipe.ingredients?.length) {
                return (
                  <div style={{ textAlign: "center", padding: "30px", color: "#b45309", backgroundColor: "#fffbeb", borderRadius: "12px" }}>
                    This dish doesn't have a configured recipe yet. Please configure it in the Recipes tab first.
                  </div>
                );
              }

              const multiplier = Number(batchServings) || 1;
              const totalBatchCost = (Number(recipe.totalMakingCost) || 0) * multiplier;
              const totalBatchRevenue = (Number(recipe.sellingPrice || product.price) || 0) * multiplier;
              const totalBatchProfit = totalBatchRevenue - totalBatchCost;

              return (
                <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", border: "1.5px solid #e2e8f0", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                  {/* Summary Metric Cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "20px" }}>
                    <div style={{ backgroundColor: "#fff7ed", padding: "14px", borderRadius: "12px", border: "1px solid #fed7aa" }}>
                      <div style={{ fontSize: "11px", fontWeight: "800", color: "#9a3412", textTransform: "uppercase" }}>Batch Target</div>
                      <div style={{ fontSize: "20px", fontWeight: "900", color: "#ea580c", marginTop: "2px" }}>
                        {multiplier} Servings of {product.name}
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#fef2f2", padding: "14px", borderRadius: "12px", border: "1px solid #fecaca" }}>
                      <div style={{ fontSize: "11px", fontWeight: "800", color: "#991b1b", textTransform: "uppercase" }}>Total Ingredients Cost</div>
                      <div style={{ fontSize: "20px", fontWeight: "900", color: "#dc2626", marginTop: "2px" }}>
                        ₹{totalBatchCost.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#eff6ff", padding: "14px", borderRadius: "12px", border: "1px solid #bfdbfe" }}>
                      <div style={{ fontSize: "11px", fontWeight: "800", color: "#1e40af", textTransform: "uppercase" }}>Expected Sales Revenue</div>
                      <div style={{ fontSize: "20px", fontWeight: "900", color: "#2563eb", marginTop: "2px" }}>
                        ₹{totalBatchRevenue.toFixed(2)}
                      </div>
                    </div>
                    <div style={{ backgroundColor: "#f0fdf4", padding: "14px", borderRadius: "12px", border: "1px solid #bbf7d0" }}>
                      <div style={{ fontSize: "11px", fontWeight: "800", color: "#166534", textTransform: "uppercase" }}>Estimated Net Profit</div>
                      <div style={{ fontSize: "20px", fontWeight: "900", color: "#16a34a", marginTop: "2px" }}>
                        +₹{totalBatchProfit.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {/* Bulk Ingredients Weight Breakdown Table */}
                  <h3 style={{ margin: "0 0 10px 0", fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>
                    📦 Required Raw Materials for this Batch:
                  </h3>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1.5px solid #cbd5e1" }}>
                        <th style={{ padding: "10px 14px", fontWeight: "800" }}>Raw Ingredient</th>
                        <th style={{ padding: "10px 14px", fontWeight: "800" }}>Per Serving</th>
                        <th style={{ padding: "10px 14px", fontWeight: "800", color: "#ea580c" }}>Total Batch Quantity</th>
                        <th style={{ padding: "10px 14px", fontWeight: "800", textAlign: "right" }}>Total Ingredient Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipe.ingredients.map((ing, idx) => {
                        const totalQty = (Number(ing.quantity) || 0) * multiplier;
                        const totalCost = (Number(ing.cost) || 0) * multiplier;

                        // Display formatted unit (e.g. 1500 ml -> 1.5 L, 1500 g -> 1.5 kg)
                        let displayFormatted = `${totalQty} ${ing.unit}`;
                        if (ing.unit === "ml" && totalQty >= 1000) {
                          displayFormatted = `${(totalQty / 1000).toFixed(2)} Litres (${totalQty} ml)`;
                        } else if (ing.unit === "g" && totalQty >= 1000) {
                          displayFormatted = `${(totalQty / 1000).toFixed(2)} Kilograms (${totalQty} g)`;
                        }

                        return (
                          <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 14px", fontWeight: "800", color: "#0f172a" }}>{ing.name}</td>
                            <td style={{ padding: "10px 14px", color: "#64748b" }}>{ing.quantity} {ing.unit}</td>
                            <td style={{ padding: "10px 14px", fontWeight: "900", color: "#ea580c" }}>{displayFormatted}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: "800", color: "#0f172a" }}>₹{totalCost.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ================= MODAL: RECIPE CONFIGURATOR ================= */}
      {editingRecipeProduct && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setEditingRecipeProduct(null)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "20px",
              width: "100%",
              maxWidth: "840px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ padding: "18px 24px", borderBottom: "1.5px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#0f172a", color: "#ffffff", borderTopLeftRadius: "20px", borderTopRightRadius: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <img
                  src={editingRecipeProduct.image || editingRecipeProduct.imageUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"}
                  alt={editingRecipeProduct.name}
                  style={{ width: "46px", height: "46px", borderRadius: "10px", objectFit: "cover" }}
                />
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "900", color: "#ffffff" }}>
                    Configure Recipe: {editingRecipeProduct.name}
                  </h3>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                    Menu Price: <strong style={{ color: "#38bdf8" }}>₹{editingRecipeProduct.price || editingRecipeProduct.salesPrice || 0}</strong> • Add ingredients below to compute making cost.
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingRecipeProduct(null)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "20px", cursor: "pointer", fontWeight: "900" }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
              {/* Financial Summary Dashboard */}
              <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", textAlign: "center" }}>
                  <div style={{ backgroundColor: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Total Food Cost</div>
                    <div style={{ fontSize: "18px", fontWeight: "900", color: "#ea580c", marginTop: "2px" }}>
                      ₹{recipeFinancials.totalMakingCost}
                    </div>
                  </div>
                  <div style={{ backgroundColor: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Selling Price</div>
                    <div style={{ fontSize: "18px", fontWeight: "900", color: "#0284c7", marginTop: "2px" }}>
                      ₹{recipeFinancials.sellingPrice}
                    </div>
                  </div>
                  <div style={{ backgroundColor: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Gross Profit</div>
                    <div style={{ fontSize: "18px", fontWeight: "900", color: recipeFinancials.grossProfit >= 0 ? "#16a34a" : "#ef4444", marginTop: "2px" }}>
                      ₹{recipeFinancials.grossProfit}
                    </div>
                  </div>
                  <div style={{ backgroundColor: "#fff", padding: "10px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: "11px", fontWeight: "800", color: "#64748b", textTransform: "uppercase" }}>Food Cost %</div>
                    <div style={{
                      fontSize: "18px",
                      fontWeight: "900",
                      color: recipeFinancials.foodCostPercent <= 35 ? "#16a34a" : recipeFinancials.foodCostPercent <= 45 ? "#f59e0b" : "#ef4444",
                      marginTop: "2px"
                    }}>
                      {recipeFinancials.foodCostPercent}%
                    </div>
                  </div>
                </div>

                {/* Target Price Recommendation Hint */}
                {recipeFinancials.totalMakingCost > 0 && (
                  <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px dashed #cbd5e1", fontSize: "12px", color: "#475569", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                    <span>
                      💡 Target Recommendation: To achieve industry standard <strong>30% Food Cost</strong>, suggested price is: <strong style={{ color: "#16a34a" }}>₹{recipeFinancials.target30Price}</strong>
                    </span>
                    <span style={{
                      fontSize: "11px",
                      fontWeight: "800",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      backgroundColor: recipeFinancials.foodCostPercent <= 35 ? "#dcfce7" : recipeFinancials.foodCostPercent <= 45 ? "#fef3c7" : "#fee2e2",
                      color: recipeFinancials.foodCostPercent <= 35 ? "#15803d" : recipeFinancials.foodCostPercent <= 45 ? "#b45309" : "#b91c1c",
                    }}>
                      {recipeFinancials.foodCostPercent <= 35 ? "🟢 Excellent Margin" : recipeFinancials.foodCostPercent <= 45 ? "🟡 Healthy Margin" : "🔴 Low Margin Warning"}
                    </span>
                  </div>
                )}
              </div>

              {/* Visual Purchased Products / Ingredients Shelf ("intha purchasela irrukka products ellam show aakanum image oda") */}
              <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "13.5px", fontWeight: "900", color: "#0f172a" }}>
                      🥘 Purchased Raw Materials & Ingredients Shelf:
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                      Click any purchased ingredient below to select it with its image and set required portion quantity.
                    </div>
                  </div>

                  {/* Search box for ingredients */}
                  <div style={{ width: "200px" }}>
                    <input
                      type="text"
                      placeholder="🔍 Search ingredient..."
                      value={recipeRawSearch}
                      onChange={(e) => setRecipeRawSearch(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        borderRadius: "8px",
                        border: "1.5px solid #cbd5e1",
                        fontSize: "12px",
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                </div>

                {/* Category Pills */}
                {rawCategories.length > 2 && (
                  <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "6px", marginBottom: "8px" }}>
                    {rawCategories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setRecipeRawCategory(cat)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: "12px",
                          border: "1px solid",
                          fontSize: "11px",
                          fontWeight: "700",
                          cursor: "pointer",
                          backgroundColor: recipeRawCategory === cat ? "#0f172a" : "#ffffff",
                          color: recipeRawCategory === cat ? "#ffffff" : "#475569",
                          borderColor: recipeRawCategory === cat ? "#0f172a" : "#cbd5e1",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* Visual Shelf Grid */}
                {filteredRawForRecipe.length === 0 ? (
                  <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: "12px", backgroundColor: "#fff", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
                    No ingredients found for "{recipeRawSearch}". Record purchases in Purchase Report or load starter ingredients!
                  </div>
                ) : (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))",
                    gap: "10px",
                    maxHeight: "220px",
                    overflowY: "auto",
                    padding: "6px",
                    backgroundColor: "#ffffff",
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0"
                  }}>
                    {filteredRawForRecipe.map((r) => {
                      const isSelected = selectedRawId === r.id;
                      const img = getGroceryImage(r.name, r.category, r.image);
                      return (
                        <div
                          key={r.id}
                          onClick={() => handleSelectRawMaterial(r)}
                          style={{
                            borderRadius: "10px",
                            border: isSelected ? "2.5px solid #ea580c" : "1.5px solid #e2e8f0",
                            backgroundColor: isSelected ? "#fff7ed" : "#ffffff",
                            overflow: "hidden",
                            cursor: "pointer",
                            display: "flex",
                            flexDirection: "column",
                            transition: "all 0.15s ease",
                            boxShadow: isSelected ? "0 4px 12px rgba(234, 88, 12, 0.2)" : "0 1px 3px rgba(0,0,0,0.02)",
                            position: "relative"
                          }}
                          title={`Click to select ${r.name}`}
                        >
                          <div style={{ position: "relative", height: "72px", width: "100%", backgroundColor: "#f1f5f9" }}>
                            <img
                              src={img}
                              alt={r.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = getGroceryImage("grocery", "general");
                              }}
                            />
                            <span style={{
                              position: "absolute",
                              bottom: "4px",
                              left: "4px",
                              backgroundColor: "rgba(15, 23, 42, 0.78)",
                              color: "#ffffff",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              fontSize: "9.5px",
                              fontWeight: "800"
                            }}>
                              Stock: {r.stockQuantity} {r.unit}
                            </span>
                            {isSelected && (
                              <span style={{
                                position: "absolute",
                                top: "4px",
                                right: "4px",
                                backgroundColor: "#ea580c",
                                color: "#ffffff",
                                width: "18px",
                                height: "18px",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "11px",
                                fontWeight: "900"
                              }}>
                                ✓
                              </span>
                            )}
                          </div>

                          <div style={{ padding: "6px 8px" }}>
                            <div style={{
                              fontSize: "12px",
                              fontWeight: "800",
                              color: isSelected ? "#c2410c" : "#0f172a",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis"
                            }} title={r.name}>
                              {r.name}
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px", fontWeight: "600" }}>
                              ₹{r.costPerUnit} / {r.unit}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Selected Ingredient Input Row */}
                {(() => {
                  const selectedRaw = selectedRawId
                    ? (combinedRawMaterials.find((r) => r.id === selectedRawId) || rawMaterials.find((r) => r.id === selectedRawId))
                    : null;
                  const isPackaged = selectedRaw && (["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pcs"].includes(String(selectedRaw.unit || "").toLowerCase()) || (selectedRaw.unit !== ingredientUnit && !["kg","g","l","ml"].includes(String(selectedRaw.unit || "").toLowerCase())));

                  return (
                    <div style={{
                      marginTop: "12px",
                      padding: "12px 14px",
                      backgroundColor: "#ffffff",
                      borderRadius: "10px",
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px"
                    }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "10px"
                      }}>
                        {/* Selected Indicator */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "180px" }}>
                          {selectedRaw ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <img
                                src={getGroceryImage(selectedRaw.name, selectedRaw.category, selectedRaw.image)}
                                alt={selectedRaw.name}
                                style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "cover" }}
                              />
                              <div>
                                <strong style={{ fontSize: "13.5px", color: "#0f172a", display: "block" }}>{selectedRaw.name}</strong>
                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                  Base Rate: <strong>₹{selectedRaw.costPerUnit}</strong> / {selectedRaw.unit}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: "12px", color: "#94a3b8", fontWeight: "600" }}>
                              👆 Click an ingredient card above to select
                            </span>
                          )}
                        </div>

                        {/* Quantity Input + Unit Select + Pack Size + Add Button */}
                        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", flexWrap: "wrap" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "3px" }}>
                              Recipe Qty:
                            </label>
                            <input
                              type="number"
                              step="any"
                              placeholder="e.g. 8"
                              value={ingredientQty}
                              onChange={(e) => setIngredientQty(e.target.value)}
                              style={{
                                width: "105px",
                                padding: "8px 10px",
                                borderRadius: "8px",
                                border: "1.5px solid #cbd5e1",
                                fontSize: "13px",
                                fontWeight: "700"
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: "700", color: "#475569", marginBottom: "3px" }}>
                              Unit:
                            </label>
                            <select
                              value={ingredientUnit}
                              onChange={(e) => setIngredientUnit(e.target.value)}
                              style={{
                                padding: "8px 10px",
                                borderRadius: "8px",
                                border: "1.5px solid #cbd5e1",
                                fontSize: "12.5px",
                                fontWeight: "700",
                                backgroundColor: "#fff"
                              }}
                            >
                              <option value="ml">Millilitre (ml)</option>
                              <option value="L">Litre (L)</option>
                              <option value="g">Gram (g)</option>
                              <option value="kg">Kilogram (kg)</option>
                              <option value="pcs">Pieces (pcs)</option>
                              <option value="packet">Packet</option>
                            </select>
                          </div>

                          {/* Pack Size / Capacity specification when ingredient is packaged */}
                          {isPackaged && (
                            <div style={{
                              backgroundColor: "#fff7ed",
                              padding: "4px 8px",
                              borderRadius: "8px",
                              border: "1px solid #fed7aa",
                              display: "flex",
                              flexDirection: "column",
                              gap: "2px"
                            }}>
                              <label style={{ fontSize: "10.5px", fontWeight: "800", color: "#c2410c" }}>
                                📦 1 {selectedRaw.unit || "packet"} =
                              </label>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="500"
                                  value={ingredientPackQty}
                                  onChange={(e) => setIngredientPackQty(e.target.value)}
                                  style={{
                                    width: "65px",
                                    padding: "6px 6px",
                                    borderRadius: "6px",
                                    border: "1px solid #fdba74",
                                    fontSize: "12px",
                                    fontWeight: "800",
                                    textAlign: "center"
                                  }}
                                  title="Enter how many ml or grams are inside 1 packet"
                                />
                                <select
                                  value={ingredientPackUnit}
                                  onChange={(e) => setIngredientPackUnit(e.target.value)}
                                  style={{
                                    padding: "6px 6px",
                                    borderRadius: "6px",
                                    border: "1px solid #fdba74",
                                    fontSize: "11.5px",
                                    fontWeight: "700",
                                    backgroundColor: "#fff"
                                  }}
                                >
                                  <option value="ml">ml</option>
                                  <option value="L">L</option>
                                  <option value="g">g</option>
                                  <option value="kg">kg</option>
                                  <option value="pcs">pcs</option>
                                </select>
                              </div>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={handleAddIngredient}
                            style={{
                              backgroundColor: "#ea580c",
                              color: "#fff",
                              border: "none",
                              padding: "9px 16px",
                              borderRadius: "8px",
                              fontWeight: "800",
                              fontSize: "13px",
                              cursor: "pointer",
                              boxShadow: "0 2px 6px rgba(234, 88, 12, 0.25)",
                              height: "36px"
                            }}
                          >
                            + Add to Recipe
                          </button>
                        </div>
                      </div>

                      {/* Instant Cost Preview with Exact Portion Price */}
                      {selectedRaw && ingredientQty && (
                        <div style={{
                          padding: "8px 12px",
                          backgroundColor: "#f0fdf4",
                          borderRadius: "8px",
                          border: "1px solid #bbf7d0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "8px"
                        }}>
                          <div style={{ fontSize: "12px", color: "#166534" }}>
                            Rate: <strong>₹{selectedRaw.costPerUnit} / {selectedRaw.unit}</strong>
                            {ingredientPackQty && (
                              <span> • (₹{(selectedRaw.costPerUnit / parseFloat(ingredientPackQty)).toFixed(4)} per {ingredientPackUnit})</span>
                            )}
                          </div>
                          <div style={{ fontSize: "13.5px", color: "#15803d", fontWeight: "900" }}>
                            Portion Cost for {ingredientQty} {ingredientUnit} = ₹
                            {computeIngredientCost(
                              parseFloat(ingredientQty),
                              ingredientUnit,
                              selectedRaw,
                              ingredientPackQty ? parseFloat(ingredientPackQty) : undefined,
                              ingredientPackUnit
                            ).toFixed(2)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Ingredients Table */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontSize: "13.5px", fontWeight: "800", color: "#0f172a" }}>
                    Configured Ingredients ({currentIngredients.length} items):
                  </div>
                  {currentIngredients.length > 0 && (
                    <div style={{ fontSize: "12px", color: "#64748b" }}>
                      Raw Ingredients Total: <strong style={{ color: "#0f172a" }}>₹{recipeFinancials.rawCostSum.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                {currentIngredients.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "26px", color: "#94a3b8", backgroundColor: "#f8fafc", borderRadius: "10px", border: "1px dashed #cbd5e1" }}>
                    No ingredients added yet. Select ingredients above to build this recipe!
                  </div>
                ) : (
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #cbd5e1", color: "#475569" }}>
                          <th style={{ padding: "8px 12px" }}>Ingredient</th>
                          <th style={{ padding: "8px 12px" }}>Quantity Used</th>
                          <th style={{ padding: "8px 12px" }}>Base Purchase Rate</th>
                          <th style={{ padding: "8px 12px", textAlign: "right" }}>Portion Cost</th>
                          <th style={{ padding: "8px 12px", textAlign: "center", width: "40px" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentIngredients.map((ing, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 12px", fontWeight: "700", color: "#0f172a" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <img
                                  src={getGroceryImage(ing.name, ing.category, ing.image)}
                                  alt={ing.name}
                                  style={{ width: "28px", height: "28px", borderRadius: "6px", objectFit: "cover" }}
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = getGroceryImage("grocery", "general");
                                  }}
                                />
                                <div>
                                  <div style={{ fontWeight: "800", color: "#0f172a" }}>{ing.name}</div>
                                  {ing.category && <div style={{ fontSize: "10px", color: "#64748b" }}>{ing.category}</div>}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: "8px 12px", fontWeight: "800", color: "#0284c7" }}>
                              {ing.quantity} {ing.unit}
                            </td>
                            <td style={{ padding: "8px 12px", color: "#64748b" }}>
                              <div>₹{ing.baseCost} / {ing.baseUnit}</div>
                              {(ing.packQuantity || ["packet", "pkt", "pack", "box", "bottle", "pcs"].includes(String(ing.baseUnit).toLowerCase())) && (
                                <div style={{ marginTop: "4px" }}>
                                  <div style={{ fontSize: "11px", color: "#ea580c", fontWeight: "700", display: "flex", alignItems: "center", gap: "4px" }}>
                                    <span>1 {ing.baseUnit} =</span>
                                    <input
                                      type="number"
                                      value={ing.packQuantity || ""}
                                      placeholder="500"
                                      onChange={(e) => handleUpdateIngredientPack(idx, e.target.value)}
                                      style={{
                                        width: "55px",
                                        padding: "1px 4px",
                                        fontSize: "11px",
                                        fontWeight: "800",
                                        borderRadius: "5px",
                                        border: "1px solid #fdba74",
                                        textAlign: "center"
                                      }}
                                      title="Edit pack size to adjust portion cost"
                                    />
                                    <span>{ing.packUnit || ing.unit}</span>
                                  </div>
                                  {Number(ing.quantity) > 0 && Number(ing.packQuantity || 500) > 0 && (
                                    <div style={{ fontSize: "10.5px", color: "#16a34a", fontWeight: "800", marginTop: "2px" }}>
                                      🎯 Yield: ~{Math.floor(Number(ing.packQuantity || 500) / Number(ing.quantity))} portions / {ing.baseUnit}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: "900", color: "#ea580c", fontSize: "14px" }}>
                              ₹{Number(ing.cost).toFixed(2)}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              <button
                                type="button"
                                onClick={() => handleRemoveIngredient(idx)}
                                style={{ background: "transparent", border: "none", color: "#ef4444", fontWeight: "900", cursor: "pointer", fontSize: "14px" }}
                                title="Remove ingredient"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Wastage Factor & Prep Notes */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px", alignItems: "flex-start" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                    Wastage & Spillage Allowance (%):
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={wastagePercent}
                    onChange={(e) => setWastagePercent(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1.5px solid #cbd5e1",
                      fontSize: "13px",
                      fontWeight: "700",
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "3px" }}>
                    Standard: 3% - 5% (Adds ₹{recipeFinancials.wastageAmt.toFixed(2)})
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                    Preparation Steps / SOP for Kitchen (Optional):
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. 1. Steam milk to 65°C, 2. Pull espresso shot, 3. Pour with latte art"
                    value={prepInstructions}
                    onChange={(e) => setPrepInstructions(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: "1.5px solid #cbd5e1",
                      fontSize: "12.5px",
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "16px 24px", borderTop: "1.5px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: "10px", backgroundColor: "#f8fafc", borderBottomLeftRadius: "20px", borderBottomRightRadius: "20px" }}>
              <button
                type="button"
                onClick={() => setEditingRecipeProduct(null)}
                style={{
                  backgroundColor: "#ffffff",
                  border: "1.5px solid #cbd5e1",
                  color: "#475569",
                  padding: "10px 18px",
                  borderRadius: "10px",
                  fontWeight: "700",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSaveRecipe}
                disabled={savingRecipe}
                style={{
                  backgroundColor: "#16a34a",
                  color: "#ffffff",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: "10px",
                  fontWeight: "800",
                  fontSize: "13px",
                  cursor: savingRecipe ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 8px rgba(22, 163, 74, 0.25)",
                }}
              >
                {savingRecipe ? "Saving..." : "💾 Save Recipe & Costing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD / EDIT RAW MATERIAL ================= */}
      {showRawModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setShowRawModal(false)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "18px",
              width: "100%",
              maxWidth: "480px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
              padding: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "900", color: "#0f172a" }}>
                {editingRawItem ? "✏️ Edit Raw Material" : "🌾 Add Raw Ingredient"}
              </h3>
              <button
                type="button"
                onClick={() => setShowRawModal(false)}
                style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "18px", cursor: "pointer", fontWeight: "900" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                  Ingredient Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Full Cream Milk / Coffee Beans"
                  value={rawName}
                  onChange={(e) => setRawName(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                  autoFocus
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                    Category
                  </label>
                  <select
                    value={rawCategory}
                    onChange={(e) => setRawCategory(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", backgroundColor: "#fff" }}
                  >
                    <option value="Dairy">Dairy</option>
                    <option value="Bakery">Bakery</option>
                    <option value="Meat & Poultry">Meat & Poultry</option>
                    <option value="Groceries">Groceries</option>
                    <option value="Beverages">Beverages</option>
                    <option value="Packaging">Packaging</option>
                    <option value="Sauces & Condiments">Sauces & Condiments</option>
                    <option value="Produce">Produce / Veggies</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                    Base Unit *
                  </label>
                  <select
                    value={rawUnit}
                    onChange={(e) => setRawUnit(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", backgroundColor: "#fff" }}
                  >
                    <option value="kg">Kilogram (kg)</option>
                    <option value="g">Gram (g)</option>
                    <option value="L">Litre (L)</option>
                    <option value="ml">Millilitre (ml)</option>
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="packet">Packet</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                  Purchase Rate per {rawUnit} (₹) *
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder={`e.g. 60 (₹60 per ${rawUnit})`}
                  value={rawCost}
                  onChange={(e) => setRawCost(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>

              {["packet", "pkt", "pack", "box", "bottle", "can", "tin", "pcs"].includes(String(rawUnit).toLowerCase()) && (
                <div style={{ backgroundColor: "#fff7ed", padding: "10px 12px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#c2410c", marginBottom: "4px" }}>
                    📦 Pack Net Capacity / Volume (Optional)
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 500 (for 500 ml packet)"
                      value={rawPackQty}
                      onChange={(e) => setRawPackQty(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #fdba74", fontSize: "13px", boxSizing: "border-box" }}
                    />
                    <select
                      value={rawPackUnit}
                      onChange={(e) => setRawPackUnit(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #fdba74", fontSize: "12.5px", fontWeight: "700", backgroundColor: "#fff" }}
                    >
                      <option value="ml">ml</option>
                      <option value="L">L</option>
                      <option value="g">g</option>
                      <option value="kg">kg</option>
                      <option value="pcs">pcs</option>
                    </select>
                  </div>
                  <div style={{ fontSize: "11px", color: "#9a3412", marginTop: "4px" }}>
                    E.g. 1 packet of milk contains 500 ml. This lets recipes calculate exact portion costs for 8 ml, 50 ml, etc.
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                    Current Stock in Hand ({rawUnit})
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 20"
                    value={rawStock}
                    onChange={(e) => setRawStock(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                    Min Alert Stock ({rawUnit})
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 5"
                    value={rawMinAlert}
                    onChange={(e) => setRawMinAlert(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setShowRawModal(false)}
                style={{ backgroundColor: "#f1f5f9", border: "none", padding: "9px 16px", borderRadius: "8px", color: "#475569", fontWeight: "700", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRawMaterial}
                disabled={savingRaw}
                style={{ backgroundColor: "#ea580c", border: "none", padding: "9px 20px", borderRadius: "8px", color: "#ffffff", fontWeight: "800", cursor: "pointer" }}
              >
                {savingRaw ? "Saving..." : "Save Ingredient"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: QUICK RESTOCK ================= */}
      {restockItem && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
          onClick={() => setRestockItem(null)}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "18px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
              padding: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "900", color: "#0f172a" }}>
                🌾 Restock: {restockItem.name}
              </h3>
              <button
                type="button"
                onClick={() => setRestockItem(null)}
                style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "18px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ backgroundColor: "#f8fafc", padding: "10px 14px", borderRadius: "10px", marginBottom: "14px", fontSize: "12.5px" }}>
              Current In-Hand Stock: <strong>{restockItem.stockQuantity || 0} {restockItem.unit}</strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                  Quantity to Add ({restockItem.unit}) *
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder={`e.g. 10 (${restockItem.unit})`}
                  value={restockAmount}
                  onChange={(e) => setRestockAmount(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "14px", fontWeight: "800", boxSizing: "border-box" }}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "4px" }}>
                  Updated Cost per {restockItem.unit} (₹) (Optional)
                </label>
                <input
                  type="number"
                  step="any"
                  value={restockCost}
                  onChange={(e) => setRestockCost(e.target.value)}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ marginTop: "18px", display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setRestockItem(null)}
                style={{ backgroundColor: "#f1f5f9", border: "none", padding: "9px 16px", borderRadius: "8px", color: "#475569", fontWeight: "700", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyRestock}
                style={{ backgroundColor: "#16a34a", border: "none", padding: "9px 20px", borderRadius: "8px", color: "#ffffff", fontWeight: "800", cursor: "pointer" }}
              >
                + Update Stock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
