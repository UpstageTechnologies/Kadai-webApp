import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../utils/firebase";
import { formatCurrency, formatDateTime } from "../utils/terminalService";
import {
  canAddInventoryItem,
  resolveTerminalSubscription,
} from "../utils/subscriptionService";
import {
  DEFAULT_PRODUCT_IMAGE,
  DISCOUNT_TYPES,
  PRODUCT_SOURCES,
  STOCK_MODES,
  adjustTerminalProductStock,
  assignShopProductsToTerminals,
  calculateProductEffectivePricing,
  createIndependentTerminalProduct,
  deleteTerminalCategory,
  removeOrDeleteTerminalProduct,
  resolveTerminalCatalog,
  saveTerminalCategory,
  subscribeTerminalAssignments,
  subscribeTerminalCategories,
  subscribeTerminalInventory,
  subscribeTerminalStockMovements,
  toggleTerminalProductAssignmentStatus,
  updateIndependentTerminalProduct,
  updateSharedProductAssignmentOverrides,
} from "../utils/terminalProductService";

const UNIT_OPTIONS = [
  "pcs",
  "plate",
  "cup",
  "glass",
  "bottle",
  "bowl",
  "box",
  "pack",
  "kg",
  "g",
  "L",
  "ml",
];

const EMPTY_PRODUCT_FORM = {
  name: "",
  image: "",
  sku: "",
  barcode: "",
  description: "",
  categoryId: "",
  categoryName: "General",
  purchasePrice: "0",
  sellingPrice: "",
  discountType: DISCOUNT_TYPES.PERCENT,
  discountValue: "0",
  taxPercent: "0",
  unit: "pcs",
  stockQuantity: "100",
  lowStockAlert: "5",
  isAvailable: true,
  isActive: true,
};

export default function TerminalProductManagement({
  shopId,
  rawUserData = null,
  terminals = [],
  shopProducts = [],
  productCollection = "inventory",
  shopInventoryMode = "terminal_wise",
  primaryTerminalId = null,
  salesList = [],
  allTransactions = [],
  selectedTerminalId = "",
  onSelectTerminalId,
  onShowToast,
  allowNegativeStock = false,
}) {
  const activeTerminal = useMemo(() => {
    if (terminals.length === 0) return null;
    return (
      terminals.find((t) => t.id === selectedTerminalId) ||
      terminals.find((t) => t.id === primaryTerminalId) ||
      terminals[0]
    );
  }, [terminals, selectedTerminalId, primaryTerminalId]);

  const currentTerminalId = activeTerminal?.id || "";

  const [terminalAssignments, setTerminalAssignments] = useState([]);
  const [terminalCategories, setTerminalCategories] = useState([]);
  const [terminalInventoryDocs, setTerminalInventoryDocs] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("all"); // "all" | "independent" | "shared"
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "active" | "inactive" | "low_stock"

  // Model A Independent Product Modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingIndProduct, setEditingIndProduct] = useState(null);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT_FORM);
  const [savingProduct, setSavingProduct] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState(false);

  // Model B Override Modal
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [editingSharedItem, setEditingSharedItem] = useState(null);
  const [overrideForm, setOverrideForm] = useState({
    categoryId: "",
    categoryName: "",
    sellingPriceOverride: "",
    discountTypeOverride: DISCOUNT_TYPES.PERCENT,
    discountValueOverride: "",
    taxOverride: "",
    stockMode: STOCK_MODES.SHARED,
    stockQuantity: "0",
    lowStockAlert: "5",
    isAvailable: true,
    isActive: true,
  });
  const [savingOverride, setSavingOverride] = useState(false);

  // Model B Bulk Assign Modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignSearch, setAssignSearch] = useState("");
  const [selectedShopProductIds, setSelectedShopProductIds] = useState([]);
  const [targetTerminalIds, setTargetTerminalIds] = useState([]);
  const [assignConfigs, setAssignConfigs] = useState({}); // keyed by `${terminalId}__${productId}`
  const [bulkDefaultStockMode, setBulkDefaultStockMode] = useState(STOCK_MODES.SHARED);
  const [bulkDefaultInitialStock, setBulkDefaultInitialStock] = useState("50");
  const [savingAssign, setSavingAssign] = useState(false);

  // Category Management Modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catColor, setCatColor] = useState("#2563eb");
  const [savingCat, setSavingCat] = useState(false);

  // Stock Adjust + Ledger Modal
  const [stockModalItem, setStockModalItem] = useState(null);
  const [stockAdjMode, setStockAdjMode] = useState("add");
  const [stockAdjQty, setStockAdjQty] = useState("");
  const [stockAdjAlert, setStockAdjAlert] = useState("");
  const [stockAdjReason, setStockAdjReason] = useState("Restock / Purchase");
  const [savingStock, setSavingStock] = useState(false);

  const notify = useCallback(
    (msg, type = "success") => {
      if (onShowToast) onShowToast(msg, type);
    },
    [onShowToast]
  );

  // Subscriptions scoped to selected terminal
  useEffect(() => {
    if (!shopId || !currentTerminalId) return undefined;
    const unsubAssign = subscribeTerminalAssignments(
      db,
      shopId,
      currentTerminalId,
      setTerminalAssignments,
      (err) => notify("Failed to load terminal products: " + err.message, "error")
    );
    const unsubCats = subscribeTerminalCategories(
      db,
      shopId,
      currentTerminalId,
      setTerminalCategories,
      (err) => notify("Failed to load categories: " + err.message, "error")
    );
    const unsubInv = subscribeTerminalInventory(
      db,
      shopId,
      currentTerminalId,
      setTerminalInventoryDocs,
      (err) => notify("Failed to load terminal inventory: " + err.message, "error")
    );
    const unsubMoves = subscribeTerminalStockMovements(
      db,
      shopId,
      currentTerminalId,
      setStockMovements
    );

    return () => {
      unsubAssign();
      unsubCats();
      unsubInv();
      unsubMoves();
    };
  }, [shopId, currentTerminalId, notify]);

  const resolvedCatalog = useMemo(() => {
    if (!activeTerminal) return [];
    return resolveTerminalCatalog({
      terminal: activeTerminal,
      shopProducts,
      terminalAssignments,
      terminalCategories,
      terminalInventoryDocs,
      shopInventoryMode,
      primaryTerminalId,
      includeInactive: true,
    });
  }, [
    activeTerminal,
    shopProducts,
    terminalAssignments,
    terminalCategories,
    terminalInventoryDocs,
    shopInventoryMode,
    primaryTerminalId,
  ]);

  const categoryFilterList = useMemo(() => {
    const names = new Set();
    terminalCategories.forEach((c) => {
      if (c?.name) names.add(c.name);
    });
    resolvedCatalog.forEach((p) => {
      if (p?.category) names.add(p.category);
    });
    return ["All", ...Array.from(names)];
  }, [terminalCategories, resolvedCatalog]);

  const stats = useMemo(() => {
    const productCount = resolvedCatalog.length;
    const activeProducts = resolvedCatalog.filter((p) => p.isActive && p.isAvailable).length;
    const inactiveProducts = productCount - activeProducts;
    const independentCount = resolvedCatalog.filter(
      (p) => p.productSource === PRODUCT_SOURCES.INDEPENDENT
    ).length;
    const sharedCount = productCount - independentCount;
    const lowStockCount = resolvedCatalog.filter((p) => p.isLowStock).length;
    const inventoryValue = resolvedCatalog.reduce((sum, p) => {
      const unitCost = Number(p.purchasePrice) > 0 ? Number(p.purchasePrice) : Number(p.effectivePrice || 0);
      return sum + Math.max(0, Number(p.effectiveStock || 0)) * unitCost;
    }, 0);
    return {
      productCount,
      categoryCount: Math.max(0, categoryFilterList.length - 1),
      activeProducts,
      inactiveProducts,
      independentCount,
      sharedCount,
      lowStockCount,
      inventoryValue,
    };
  }, [resolvedCatalog, categoryFilterList]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return resolvedCatalog.filter((item) => {
      if (selectedCategory !== "All" && item.category !== selectedCategory) return false;
      if (sourceFilter !== "all" && item.productSource !== sourceFilter) return false;
      if (statusFilter === "active" && (!item.isActive || !item.isAvailable)) return false;
      if (statusFilter === "inactive" && item.isActive && item.isAvailable) return false;
      if (statusFilter === "low_stock" && !item.isLowStock) return false;
      if (q) {
        const hay = `${item.name} ${item.sku} ${item.barcode} ${item.category} ${item.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [resolvedCatalog, selectedCategory, sourceFilter, statusFilter, searchQuery]);

  // Eligible main shop products for Model B assignment (excludes products exclusive to any single terminal)
  const assignableShopProducts = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    return shopProducts
      .filter((p) => !p.isTerminalExclusive && p.productSource !== PRODUCT_SOURCES.INDEPENDENT)
      .filter((p) => !p.terminalId || p.terminalId === "all")
      .filter((p) => {
        if (!q) return true;
        const hay = `${p.itemName || p.name || ""} ${p.category || ""} ${p.barcode || ""} ${p.sku || ""}`.toLowerCase();
        return hay.includes(q);
      });
  }, [shopProducts, assignSearch]);

  const activeTerminalSub = useMemo(
    () =>
      rawUserData
        ? resolveTerminalSubscription(rawUserData, activeTerminal)
        : { plan: "Pro", isExpired: false, limits: { inventoryLimit: -1 } },
    [rawUserData, activeTerminal]
  );

  // Handlers
  const openAddIndependentModal = () => {
    if (
      rawUserData &&
      !canAddInventoryItem(resolvedCatalog.length, activeTerminalSub.plan, activeTerminalSub.isExpired)
    ) {
      const limit = activeTerminalSub.limits.inventoryLimit;
      notify(
        activeTerminalSub.isExpired
          ? "Your subscription has expired. Please renew your plan to add items."
          : `Terminal "${activeTerminal?.name}" reached your ${activeTerminalSub.plan} plan limit (${limit} items per terminal). You can add items to other terminals or upgrade your plan.`,
        "error"
      );
      return;
    }
    setEditingIndProduct(null);
    const defaultCat = terminalCategories[0];
    setCustomCategoryInput(false);
    setProductForm({
      ...EMPTY_PRODUCT_FORM,
      categoryId: defaultCat?.id || "",
      categoryName: defaultCat?.name || "General",
    });
    setProductModalOpen(true);
  };

  const openEditProductModal = (item) => {
    if (item.productSource === PRODUCT_SOURCES.SHARED) {
      setEditingSharedItem(item);
      setOverrideForm({
        categoryId: item.categoryId || "",
        categoryName: item.category || "General",
        sellingPriceOverride: item.hasPriceOverride ? String(item.effectivePrice) : "",
        discountTypeOverride: item.effectiveDiscountType || DISCOUNT_TYPES.PERCENT,
        discountValueOverride: item.hasDiscountOverride ? String(item.effectiveDiscountValue) : "",
        taxOverride: item.hasTaxOverride ? String(item.effectiveTaxPercent) : "",
        stockMode: item.stockMode || STOCK_MODES.SHARED,
        stockQuantity: String(item.terminalStockQuantity ?? 0),
        lowStockAlert: String(item.lowStockAlert ?? 5),
        isAvailable: item.isAvailable !== false,
        isActive: item.isActive !== false,
      });
      setOverrideModalOpen(true);
      return;
    }

    setEditingIndProduct(item);
    setCustomCategoryInput(false);
    setProductForm({
      name: item.name || "",
      image: item.image || "",
      sku: item.sku || "",
      barcode: item.barcode || "",
      description: item.description || "",
      categoryId: item.categoryId || "",
      categoryName: item.category || "General",
      purchasePrice: String(item.purchasePrice ?? 0),
      sellingPrice: String(item.effectivePrice ?? item.salesPrice ?? 0),
      discountType: item.effectiveDiscountType || DISCOUNT_TYPES.PERCENT,
      discountValue: String(item.effectiveDiscountValue ?? 0),
      taxPercent: String(item.effectiveTaxPercent ?? 0),
      unit: item.unit || "pcs",
      stockQuantity: String(item.effectiveStock ?? 0),
      lowStockAlert: String(item.lowStockAlert ?? 5),
      isAvailable: item.isAvailable !== false,
      isActive: item.isActive !== false,
    });
    setProductModalOpen(true);
  };

  const handleProductImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setProductForm((prev) => ({ ...prev, image: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveIndependentProduct = async (e) => {
    e.preventDefault();
    if (!activeTerminal) return;
    setSavingProduct(true);
    try {
      if (editingIndProduct) {
        await updateIndependentTerminalProduct(db, {
          shopId,
          terminal: activeTerminal,
          productId: editingIndProduct.productId,
          assignmentId: editingIndProduct.assignmentId,
          productCollection: editingIndProduct.productCollection || productCollection,
          form: productForm,
          existingCategories: terminalCategories,
        });
        notify(`Updated "${productForm.name}" in ${activeTerminal.name}`);
      } else {
        if (
          rawUserData &&
          !canAddInventoryItem(resolvedCatalog.length, activeTerminalSub.plan, activeTerminalSub.isExpired)
        ) {
          throw new Error(
            activeTerminalSub.isExpired
              ? "Your subscription has expired."
              : `Terminal "${activeTerminal.name}" reached your ${activeTerminalSub.plan} plan limit (${activeTerminalSub.limits.inventoryLimit} items per terminal).`
          );
        }
        await createIndependentTerminalProduct(db, {
          shopId,
          terminal: activeTerminal,
          productCollection,
          form: productForm,
          existingCategories: terminalCategories,
        });
        notify(`Added independent product "${productForm.name}" to ${activeTerminal.name}`);
      }
      setProductModalOpen(false);
    } catch (err) {
      notify(err.message || "Failed to save product.", "error");
    } finally {
      setSavingProduct(false);
    }
  };

  const handleSaveSharedOverrides = async (e) => {
    e.preventDefault();
    if (!activeTerminal || !editingSharedItem) return;
    setSavingOverride(true);
    try {
      await updateSharedProductAssignmentOverrides(db, {
        shopId,
        terminalId: activeTerminal.id,
        assignmentId: editingSharedItem.assignmentId,
        productId: editingSharedItem.productId,
        productCollection: editingSharedItem.productCollection || productCollection,
        overrides: {
          ...overrideForm,
          unit: editingSharedItem.unit || "pcs",
        },
        existingCategories: terminalCategories,
      });
      notify(`Saved terminal settings for "${editingSharedItem.name}" (${activeTerminal.name})`);
      setOverrideModalOpen(false);
    } catch (err) {
      notify(err.message || "Failed to update terminal overrides.", "error");
    } finally {
      setSavingOverride(false);
    }
  };

  const handleToggleProductField = async (item, field, nextVal) => {
    if (!activeTerminal) return;
    try {
      await toggleTerminalProductAssignmentStatus(db, {
        shopId,
        terminalId: activeTerminal.id,
        item,
        field,
        nextValue: nextVal,
      });
      notify(
        `${item.name} marked ${
          field === "isActive"
            ? nextVal
              ? "Active"
              : "Inactive"
            : nextVal
            ? "Available"
            : "Unavailable"
        }`
      );
    } catch (err) {
      notify(err.message || "Update failed.", "error");
    }
  };

  const handleRemoveOrDelete = async (item) => {
    if (!activeTerminal) return;
    const isShared = item.productSource === PRODUCT_SOURCES.SHARED;
    const msg = isShared
      ? `Remove shared product "${item.name}" from ${activeTerminal.name}? The main Shop Product will NOT be deleted.`
      : `Permanently delete independent product "${item.name}" from ${activeTerminal.name}?`;
    if (!window.confirm(msg)) return;

    try {
      await removeOrDeleteTerminalProduct(db, {
        shopId,
        terminalId: activeTerminal.id,
        item,
        salesList,
        transactionsList: allTransactions,
        defaultCollection: productCollection,
      });
      notify(
        isShared
          ? `Removed "${item.name}" from ${activeTerminal.name}`
          : `Deleted "${item.name}" from ${activeTerminal.name}`
      );
    } catch (err) {
      notify(err.message || "Could not delete product.", "error");
    }
  };

  // Bulk Assign Shared Products handlers
  const openBulkAssignModal = () => {
    setAssignSearch("");
    setSelectedShopProductIds([]);
    setTargetTerminalIds(activeTerminal ? [activeTerminal.id] : []);
    setAssignConfigs({});
    setBulkDefaultStockMode(STOCK_MODES.SHARED);
    setBulkDefaultInitialStock("50");
    setAssignModalOpen(true);
  };

  const toggleProductSelectForAssign = (prodId) => {
    setSelectedShopProductIds((prev) =>
      prev.includes(prodId) ? prev.filter((id) => id !== prodId) : [...prev, prodId]
    );
  };

  const toggleTerminalTarget = (tId) => {
    setTargetTerminalIds((prev) =>
      prev.includes(tId) ? prev.filter((id) => id !== tId) : [...prev, tId]
    );
  };

  const updateAssignConfig = (tId, pId, field, value) => {
    const key = `${tId}__${pId}`;
    setAssignConfigs((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [field]: value,
      },
    }));
  };

  const handleConfirmBulkAssign = async (e) => {
    e.preventDefault();
    if (selectedShopProductIds.length === 0 || targetTerminalIds.length === 0) {
      notify("Select at least one shop product and one terminal.", "error");
      return;
    }
    setSavingAssign(true);
    try {
      const payload = [];
      targetTerminalIds.forEach((tId) => {
        selectedShopProductIds.forEach((pId) => {
          const prod = shopProducts.find((p) => p.id === pId);
          if (!prod) return;
          const cfg = assignConfigs[`${tId}__${pId}`] || {};
          payload.push({
            terminalId: tId,
            product: prod,
            sellingPriceOverride: cfg.sellingPriceOverride ?? "",
            discountTypeOverride: cfg.discountTypeOverride || DISCOUNT_TYPES.PERCENT,
            discountValueOverride: cfg.discountValueOverride ?? "",
            taxOverride: cfg.taxOverride ?? "",
            categoryName: cfg.categoryName || prod.category || "General",
            stockMode: cfg.stockMode || bulkDefaultStockMode,
            initialStockQuantity: cfg.initialStockQuantity ?? bulkDefaultInitialStock,
            lowStockAlert: cfg.lowStockAlert ?? prod.lowStockAlert ?? 5,
          });
        });
      });

      const count = await assignShopProductsToTerminals(db, {
        shopId,
        productCollection,
        assignmentsPayload: payload,
      });
      notify(`Assigned ${count} product slot(s) across selected terminals!`);
      setAssignModalOpen(false);
    } catch (err) {
      notify(err.message || "Assignment failed.", "error");
    } finally {
      setSavingAssign(false);
    }
  };

  // Category modal handlers
  const handleSaveCat = async (e) => {
    e.preventDefault();
    if (!activeTerminal) return;
    setSavingCat(true);
    try {
      await saveTerminalCategory(
        db,
        shopId,
        activeTerminal.id,
        {
          name: catName,
          description: catDesc,
          color: catColor,
          sortOrder: editingCat ? editingCat.sortOrder : terminalCategories.length + 1,
        },
        terminalCategories,
        editingCat?.id || null
      );
      notify(editingCat ? "Category updated." : `Category "${catName}" created.`);
      setEditingCat(null);
      setCatName("");
      setCatDesc("");
      setCatColor("#2563eb");
    } catch (err) {
      notify(err.message || "Failed to save category.", "error");
    } finally {
      setSavingCat(false);
    }
  };

  const handleDeleteCat = async (cat) => {
    if (!activeTerminal) return;
    if (!window.confirm(`Delete category "${cat.name}" from ${activeTerminal.name}?`)) return;
    try {
      await deleteTerminalCategory(db, shopId, activeTerminal.id, cat.id, terminalAssignments);
      notify(`Deleted category "${cat.name}".`);
    } catch (err) {
      notify(err.message || "Cannot delete category.", "error");
    }
  };

  // Stock adjustment handlers
  const openStockModal = (item) => {
    setStockModalItem(item);
    setStockAdjMode("add");
    setStockAdjQty("");
    setStockAdjAlert(String(item.lowStockAlert ?? 5));
    setStockAdjReason("Restock / Purchase");
  };

  const handleSubmitStockAdjust = async (e) => {
    e.preventDefault();
    if (!activeTerminal || !stockModalItem) return;
    setSavingStock(true);
    try {
      await adjustTerminalProductStock(db, {
        shopId,
        terminalId: activeTerminal.id,
        productId: stockModalItem.productId,
        productName: stockModalItem.name,
        productSource: stockModalItem.productSource,
        stockMode: stockModalItem.stockMode,
        productCollection: stockModalItem.productCollection || productCollection,
        mode: stockAdjMode,
        quantity: Number(stockAdjQty || 0),
        lowStockAlert: stockAdjAlert,
        reason: stockAdjReason,
        allowNegativeStock,
      });
      notify(`Stock updated for "${stockModalItem.name}" (${activeTerminal.name})`);
      setStockModalItem(null);
    } catch (err) {
      notify(err.message || "Stock adjustment failed.", "error");
    } finally {
      setSavingStock(false);
    }
  };

  if (terminals.length === 0) {
    return (
      <div style={styles.emptyCard}>
        <div style={{ fontSize: "38px" }}>🛍️</div>
        <h3 style={{ margin: "6px 0", color: "#0f172a" }}>No POS Terminals Created Yet</h3>
        <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
          Create at least one Floor &amp; Terminal first in the Floors &amp; Terminals tab to manage
          terminal-specific catalogs and pricing.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* TERMINAL SELECTOR + QUICK STATS HEADER */}
      <div style={styles.topPanel}>
        <div style={styles.termSelectorRow}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12.5px", fontWeight: "800", color: "#0f172a" }}>
              🖥️ Select Terminal:
            </span>
            {terminals.map((t) => {
              const selected = t.id === activeTerminal?.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onSelectTerminalId?.(t.id);
                    setSelectedCategory("All");
                  }}
                  style={{
                    ...styles.termPillBtn,
                    ...(selected ? styles.termPillBtnActive : {}),
                  }}
                >
                  <span>{t.name}</span>
                  <span style={selected ? styles.codePillDark : styles.codePill}>{t.code}</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" onClick={() => setCatModalOpen(true)} style={styles.secondaryBtn}>
              🏷️ Categories ({stats.categoryCount})
            </button>
            <button type="button" onClick={openBulkAssignModal} style={styles.tealBtn}>
              🔗 Assign Existing Shop Products
            </button>
            <button type="button" onClick={openAddIndependentModal} style={styles.primaryBtn}>
              + Add Independent Product
            </button>
          </div>
        </div>

        {/* Selected Terminal KPI Strip */}
        {activeTerminal && (
          <div style={styles.termKpiStrip}>
            <div style={styles.miniStat}>
              <span style={styles.miniLabel}>Terminal</span>
              <span style={styles.miniValue}>
                {activeTerminal.name}{" "}
                <span style={{ fontSize: "11px", color: "#2563eb" }}>({activeTerminal.code})</span>
              </span>
              <span style={styles.miniSub}>🏢 {activeTerminal.floorName || "Floor"}</span>
            </div>
            <div style={styles.miniStat}>
              <span style={styles.miniLabel}>Products ({activeTerminalSub.plan} Plan)</span>
              <span style={styles.miniValue}>
                {stats.productCount}
                {activeTerminalSub.limits.inventoryLimit > 0
                  ? ` / ${activeTerminalSub.limits.inventoryLimit}`
                  : ""}
              </span>
              <span style={styles.miniSub}>
                {stats.independentCount} Indep • {stats.sharedCount} Shared
              </span>
            </div>
            <div style={styles.miniStat}>
              <span style={styles.miniLabel}>Categories</span>
              <span style={styles.miniValue}>{stats.categoryCount}</span>
              <span style={styles.miniSub}>Terminal-scoped</span>
            </div>
            <div style={styles.miniStat}>
              <span style={styles.miniLabel}>Status Split</span>
              <span style={styles.miniValue}>
                <span style={{ color: "#15803d" }}>{stats.activeProducts}</span> /{" "}
                <span style={{ color: "#94a3b8" }}>{stats.inactiveProducts}</span>
              </span>
              <span style={styles.miniSub}>Active / Inactive</span>
            </div>
            <div style={styles.miniStat}>
              <span style={styles.miniLabel}>Inventory Value</span>
              <span style={{ ...styles.miniValue, color: "#059669" }}>
                {formatCurrency(stats.inventoryValue)}
              </span>
              <span
                style={{
                  ...styles.miniSub,
                  color: stats.lowStockCount > 0 ? "#dc2626" : "#64748b",
                  fontWeight: stats.lowStockCount > 0 ? "800" : "500",
                }}
              >
                {stats.lowStockCount > 0
                  ? `⚠️ ${stats.lowStockCount} Low Stock`
                  : "All stock healthy"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* FILTER BAR */}
      <div style={styles.filterPanel}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search products by name, SKU, barcode, or category..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All Models (Independent &amp; Shared)</option>
            <option value="independent">Model A: Independent Only</option>
            <option value="shared">Model B: Shared Only</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active &amp; Available</option>
            <option value="inactive">Inactive / Unavailable</option>
            <option value="low_stock">Low Stock Alerts</option>
          </select>
        </div>

        {/* Category Filter Pills */}
        <div style={styles.catFilterRow}>
          {categoryFilterList.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              style={{
                ...styles.catPill,
                ...(selectedCategory === cat ? styles.catPillActive : {}),
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* TERMINAL PRODUCT GRID */}
      {filteredProducts.length === 0 ? (
        <div style={styles.emptyCard}>
          <div style={{ fontSize: "34px" }}>📦</div>
          <h3 style={{ margin: "6px 0", color: "#0f172a" }}>
            No Products Found in {activeTerminal?.name}
          </h3>
          <p style={{ margin: "0 0 14px", color: "#64748b", fontSize: "13px" }}>
            Add an exclusive Model A product for this terminal or assign Shared Shop Products (Model B).
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={openAddIndependentModal} style={styles.primaryBtn}>
              + Add Independent Product
            </button>
            <button type="button" onClick={openBulkAssignModal} style={styles.tealBtn}>
              🔗 Assign Existing Shop Products
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.productGrid}>
          {filteredProducts.map((item) => {
            const isInd = item.productSource === PRODUCT_SOURCES.INDEPENDENT;
            const isSharedStock = item.stockMode === STOCK_MODES.SHARED;
            const activeFlag = item.isActive && item.isAvailable;

            return (
              <div
                key={`${item.productId}_${item.assignmentId || "legacy"}`}
                style={{
                  ...styles.prodCard,
                  opacity: activeFlag ? 1 : 0.72,
                  borderColor: item.isLowStock
                    ? "#fca5a5"
                    : activeFlag
                    ? "#e2e8f0"
                    : "#cbd5e1",
                }}
              >
                <div style={styles.prodImgWrap}>
                  <img
                    src={item.image || DEFAULT_PRODUCT_IMAGE}
                    alt={item.name}
                    style={styles.prodImg}
                    onError={(e) => {
                      e.target.onerror = null;
                      e.target.src = DEFAULT_PRODUCT_IMAGE;
                    }}
                  />
                  <span
                    style={{
                      ...styles.sourceBadge,
                      backgroundColor: isInd ? "#eef2ff" : "#ecfeff",
                      color: isInd ? "#4338ca" : "#0e7490",
                    }}
                  >
                    {isInd ? "Independent" : "Shared"}
                  </span>
                  <span
                    style={{
                      ...styles.stockCornerBadge,
                      backgroundColor: item.isLowStock ? "#fee2e2" : "#f0fdf4",
                      color: item.isLowStock ? "#dc2626" : "#15803d",
                    }}
                  >
                    {item.isLowStock ? "⚠️ " : ""}
                    {item.effectiveStock} {item.unit || "pcs"}
                  </span>
                </div>

                <div style={styles.prodBody}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "6px" }}>
                    <h4 style={styles.prodName} title={item.name}>
                      {item.name}
                    </h4>
                  </div>

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                    <span style={styles.catBadge}>{item.category}</span>
                    <span style={styles.stockModeTag}>
                      {isSharedStock ? "🌐 Central Stock" : "🖥️ Terminal Stock"}
                    </span>
                    {!activeFlag && <span style={styles.inactiveBadge}>Inactive</span>}
                  </div>

                  {(item.sku || item.barcode) && (
                    <div style={{ fontSize: "11px", color: "#64748b" }}>
                      {item.sku ? `SKU: ${item.sku}` : ""}
                      {item.sku && item.barcode ? " • " : ""}
                      {item.barcode ? `Bar: ${item.barcode}` : ""}
                    </div>
                  )}

                  {/* Pricing Row */}
                  <div style={styles.priceBox}>
                    <div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                        <span style={{ fontSize: "17px", fontWeight: "900", color: "#0f172a" }}>
                          ₹{item.effectivePrice}
                        </span>
                        {item.hasPriceOverride && item.basePrice !== item.effectivePrice && (
                          <span
                            style={{
                              fontSize: "11px",
                              color: "#94a3b8",
                              textDecoration: "line-through",
                            }}
                          >
                            Shop ₹{item.basePrice}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        {item.effectiveDiscountValue > 0
                          ? `Disc: ${
                              item.effectiveDiscountType === DISCOUNT_TYPES.FLAT
                                ? `₹${item.effectiveDiscountValue}`
                                : `${item.effectiveDiscountValue}%`
                            } • `
                          : ""}
                        GST: {item.effectiveTaxPercent || 0}% • Net ₹{item.unitFinalPrice}
                      </div>
                    </div>
                  </div>

                  {/* Quick Toggles */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => handleToggleProductField(item, "isActive", !item.isActive)}
                      style={{
                        ...styles.miniActionBtn,
                        backgroundColor: item.isActive ? "#dcfce7" : "#f1f5f9",
                        color: item.isActive ? "#15803d" : "#475569",
                      }}
                    >
                      {item.isActive ? "✓ Active" : "⏸ Inactive"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleToggleProductField(item, "isAvailable", !item.isAvailable)
                      }
                      style={{
                        ...styles.miniActionBtn,
                        backgroundColor: item.isAvailable ? "#eff6ff" : "#fee2e2",
                        color: item.isAvailable ? "#1d4ed8" : "#dc2626",
                      }}
                    >
                      {item.isAvailable ? "In Menu" : "Out of Stock"}
                    </button>
                  </div>

                  {/* Primary Item Actions */}
                  <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => openEditProductModal(item)}
                      style={styles.cardBtn}
                    >
                      ✏️ {isInd ? "Edit" : "Override"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openStockModal(item)}
                      style={{ ...styles.cardBtn, backgroundColor: "#f0fdf4", color: "#15803d", borderColor: "#bbf7d0" }}
                    >
                      ⚖️ Stock
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveOrDelete(item)}
                      style={{ ...styles.cardBtn, color: "#dc2626", borderColor: "#fecaca" }}
                    >
                      {isInd ? "🗑️" : "Unlink"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 1: ADD / EDIT MODEL A INDEPENDENT PRODUCT                   */}
      {/* ================================================================= */}
      {productModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setProductModalOpen(false)}>
          <div
            style={{ ...styles.modalBox, maxWidth: "680px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>
                  {editingIndProduct ? "✏️ Edit Terminal Product" : "➕ Add Independent Product (Model A)"}
                </h3>
                <p style={styles.modalSub}>
                  Exclusive to <strong>{activeTerminal?.name} ({activeTerminal?.code})</strong> — will not appear in other terminals.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveIndependentProduct} style={styles.modalBody}>
              <div style={styles.formGrid2}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Product Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ghee Roast Dosa, Filter Coffee"
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    style={styles.input}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Category *</label>
                  {!customCategoryInput ? (
                    <select
                      value={productForm.categoryName}
                      onChange={(e) => {
                        if (e.target.value === "__new__") {
                          setCustomCategoryInput(true);
                          setProductForm({ ...productForm, categoryId: "", categoryName: "" });
                        } else {
                          const matched = terminalCategories.find(
                            (c) => c.name === e.target.value
                          );
                          setProductForm({
                            ...productForm,
                            categoryId: matched?.id || "",
                            categoryName: e.target.value,
                          });
                        }
                      }}
                      style={styles.input}
                    >
                      {Array.from(
                        new Set([
                          ...terminalCategories.map((c) => c.name),
                          productForm.categoryName || "General",
                          "General",
                        ])
                      )
                        .filter(Boolean)
                        .map((cname) => (
                          <option key={cname} value={cname}>
                            {cname}
                          </option>
                        ))}
                      <option value="__new__">➕ Create New Terminal Category...</option>
                    </select>
                  ) : (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="text"
                        required
                        autoFocus
                        placeholder="Type new category name..."
                        value={productForm.categoryName}
                        onChange={(e) =>
                          setProductForm({ ...productForm, categoryName: e.target.value })
                        }
                        style={styles.input}
                      />
                      <button
                        type="button"
                        onClick={() => setCustomCategoryInput(false)}
                        style={styles.cancelBtn}
                      >
                        List
                      </button>
                    </div>
                  )}
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>SKU</label>
                  <input
                    type="text"
                    placeholder="e.g. HTL-DOSA-01"
                    value={productForm.sku}
                    onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                    style={styles.input}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Barcode</label>
                  <input
                    type="text"
                    placeholder="e.g. 8901234567890"
                    value={productForm.barcode}
                    onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })}
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Purchase Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={productForm.purchasePrice}
                    onChange={(e) =>
                      setProductForm({ ...productForm, purchasePrice: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Selling Price (₹) *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={productForm.sellingPrice}
                    onChange={(e) =>
                      setProductForm({ ...productForm, sellingPrice: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Discount</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select
                      value={productForm.discountType}
                      onChange={(e) =>
                        setProductForm({ ...productForm, discountType: e.target.value })
                      }
                      style={{ ...styles.input, width: "100px" }}
                    >
                      <option value="percent">% Off</option>
                      <option value="flat">₹ Flat</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={productForm.discountValue}
                      onChange={(e) =>
                        setProductForm({ ...productForm, discountValue: e.target.value })
                      }
                      style={styles.input}
                    />
                  </div>
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Tax / GST (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={productForm.taxPercent}
                    onChange={(e) =>
                      setProductForm({ ...productForm, taxPercent: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Stock Quantity *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={productForm.stockQuantity}
                    onChange={(e) =>
                      setProductForm({ ...productForm, stockQuantity: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Low Stock Alert Threshold</label>
                  <input
                    type="number"
                    min="0"
                    value={productForm.lowStockAlert}
                    onChange={(e) =>
                      setProductForm({ ...productForm, lowStockAlert: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Unit</label>
                  <select
                    value={productForm.unit}
                    onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                    style={styles.input}
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Image URL or Upload</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={productForm.image}
                      onChange={(e) => setProductForm({ ...productForm, image: e.target.value })}
                      style={styles.input}
                    />
                    <label style={styles.uploadLabel}>
                      📷
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleProductImageUpload}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Description</label>
                <textarea
                  rows={2}
                  placeholder="Optional product description..."
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  style={styles.input}
                />
              </div>

              <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", padding: "6px 0" }}>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={productForm.isAvailable}
                    onChange={(e) =>
                      setProductForm({ ...productForm, isAvailable: e.target.checked })
                    }
                  />
                  Available for POS Billing
                </label>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={productForm.isActive}
                    onChange={(e) =>
                      setProductForm({ ...productForm, isActive: e.target.checked })
                    }
                  />
                  Active Status
                </label>
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingProduct} style={styles.primaryBtn}>
                  {savingProduct
                    ? "Saving..."
                    : editingIndProduct
                    ? "Save Changes"
                    : "Create Independent Product"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 2: EDIT SHARED PRODUCT OVERRIDES (MODEL B)                  */}
      {/* ================================================================= */}
      {overrideModalOpen && editingSharedItem && (
        <div style={styles.modalOverlay} onClick={() => setOverrideModalOpen(false)}>
          <div
            style={{ ...styles.modalBox, maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>🔧 Terminal Override: {editingSharedItem.name}</h3>
                <p style={styles.modalSub}>
                  Applies ONLY to <strong>{activeTerminal?.name}</strong> — original Shop Product
                  remains unchanged.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOverrideModalOpen(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveSharedOverrides} style={styles.modalBody}>
              <div style={styles.shopBaselineBanner}>
                <span>
                  Main Shop Price: <strong>₹{editingSharedItem.basePrice}</strong>
                </span>
                <span>
                  Central Shop Stock:{" "}
                  <strong>
                    {editingSharedItem.sharedStockQuantity} {editingSharedItem.unit}
                  </strong>
                </span>
              </div>

              <div style={styles.formGrid2}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Terminal Category</label>
                  <input
                    type="text"
                    list="term-cat-suggestions"
                    value={overrideForm.categoryName}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, categoryName: e.target.value, categoryId: "" })
                    }
                    style={styles.input}
                  />
                  <datalist id="term-cat-suggestions">
                    {terminalCategories.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>
                    Terminal Selling Price Override (Blank = Shop ₹{editingSharedItem.basePrice})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={`Default ₹${editingSharedItem.basePrice}`}
                    value={overrideForm.sellingPriceOverride}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, sellingPriceOverride: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Discount Override</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <select
                      value={overrideForm.discountTypeOverride}
                      onChange={(e) =>
                        setOverrideForm({ ...overrideForm, discountTypeOverride: e.target.value })
                      }
                      style={{ ...styles.input, width: "95px" }}
                    >
                      <option value="percent">% Off</option>
                      <option value="flat">₹ Flat</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Inherit"
                      value={overrideForm.discountValueOverride}
                      onChange={(e) =>
                        setOverrideForm({ ...overrideForm, discountValueOverride: e.target.value })
                      }
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Tax / GST Override (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="Inherit Shop GST"
                    value={overrideForm.taxOverride}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, taxOverride: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Stock Mode for this Terminal</label>
                  <select
                    value={overrideForm.stockMode}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, stockMode: e.target.value })
                    }
                    style={styles.input}
                  >
                    <option value={STOCK_MODES.SHARED}>
                      🌐 Shared Central Shop Stock (Deducts Central)
                    </option>
                    <option value={STOCK_MODES.INDEPENDENT}>
                      🖥️ Independent Terminal Stock (Separate Qty)
                    </option>
                  </select>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Low Stock Alert</label>
                  <input
                    type="number"
                    min="0"
                    value={overrideForm.lowStockAlert}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, lowStockAlert: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>
              </div>

              {overrideForm.stockMode === STOCK_MODES.INDEPENDENT && (
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Terminal Stock Quantity</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={overrideForm.stockQuantity}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, stockQuantity: e.target.value })
                    }
                    style={styles.input}
                  />
                </div>
              )}

              <div style={{ display: "flex", gap: "18px", padding: "6px 0" }}>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={overrideForm.isAvailable}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, isAvailable: e.target.checked })
                    }
                  />
                  Available on POS
                </label>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={overrideForm.isActive}
                    onChange={(e) =>
                      setOverrideForm({ ...overrideForm, isActive: e.target.checked })
                    }
                  />
                  Active
                </label>
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingOverride} style={styles.primaryBtn}>
                  {savingOverride ? "Saving..." : "Save Terminal Override"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 3: BULK ASSIGN EXISTING SHOP PRODUCTS (MODEL B)             */}
      {/* ================================================================= */}
      {assignModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setAssignModalOpen(false)}>
          <div
            style={{ ...styles.modalBox, maxWidth: "820px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>🔗 Assign Existing Shop Products (Model B)</h3>
                <p style={styles.modalSub}>
                  Select shop products and terminals, then customize per-terminal selling price &amp;
                  stock mode without changing the original Shop Product.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleConfirmBulkAssign} style={styles.modalBody}>
              {/* Target Terminals Checkboxes */}
              <div style={styles.fieldGroup}>
                <label style={styles.label}>1. Target Terminals *</label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {terminals.map((t) => {
                    const checked = targetTerminalIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        style={{
                          ...styles.checkChip,
                          borderColor: checked ? "#2563eb" : "#cbd5e1",
                          backgroundColor: checked ? "#eff6ff" : "#ffffff",
                          color: checked ? "#1d4ed8" : "#334155",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTerminalTarget(t.id)}
                        />
                        {t.name} ({t.code})
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Default Stock Mode */}
              <div style={styles.formGrid2}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Default Stock Mode for Assignment</label>
                  <select
                    value={bulkDefaultStockMode}
                    onChange={(e) => setBulkDefaultStockMode(e.target.value)}
                    style={styles.input}
                  >
                    <option value={STOCK_MODES.SHARED}>
                      🌐 Shared Central Shop Stock (All consume main stock)
                    </option>
                    <option value={STOCK_MODES.INDEPENDENT}>
                      🖥️ Independent Terminal Stock (Separate qty per terminal)
                    </option>
                  </select>
                </div>
                {bulkDefaultStockMode === STOCK_MODES.INDEPENDENT && (
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Initial Stock Qty per Terminal</label>
                    <input
                      type="number"
                      min="0"
                      value={bulkDefaultInitialStock}
                      onChange={(e) => setBulkDefaultInitialStock(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                )}
              </div>

              {/* Search Shop Products */}
              <div style={styles.fieldGroup}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <label style={styles.label}>
                    2. Select Shop Products ({selectedShopProductIds.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const ids = assignableShopProducts.map((p) => p.id);
                      setSelectedShopProductIds((prev) =>
                        prev.length === ids.length ? [] : ids
                      );
                    }}
                    style={styles.miniActionBtn}
                  >
                    {selectedShopProductIds.length === assignableShopProducts.length &&
                    assignableShopProducts.length > 0
                      ? "Clear Selection"
                      : "Select All Shown"}
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Search main shop products by name, category, barcode, or SKU..."
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  style={styles.input}
                />
              </div>

              {/* Shop Products List */}
              <div style={styles.assignListBox}>
                {assignableShopProducts.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px", color: "#64748b", fontSize: "13px" }}>
                    No shared shop products available matching your search. Add products in Shop
                    Inventory or clear filters.
                  </div>
                ) : (
                  assignableShopProducts.map((prod) => {
                    const checked = selectedShopProductIds.includes(prod.id);
                    const pricing = calculateProductEffectivePricing(prod, null);
                    return (
                      <div
                        key={prod.id}
                        style={{
                          ...styles.assignItemRow,
                          backgroundColor: checked ? "#f0f9ff" : "#ffffff",
                          borderColor: checked ? "#93c5fd" : "#e2e8f0",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            flex: 1,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProductSelectForAssign(prod.id)}
                          />
                          <div>
                            <div style={{ fontWeight: "800", fontSize: "13.5px", color: "#0f172a" }}>
                              {prod.itemName || prod.name}
                            </div>
                            <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                              {prod.category || "General"} • Shop Price: ₹{pricing.basePrice} • Central
                              Stock: {Number(prod.quantity ?? 0)}
                              {prod.barcode ? ` • Bar: ${prod.barcode}` : ""}
                            </div>
                          </div>
                        </label>

                        {checked && targetTerminalIds.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%", marginTop: "6px", paddingTop: "6px", borderTop: "1px dashed #cbd5e1" }}>
                            {targetTerminalIds.map((tId) => {
                              const tObj = terminals.find((t) => t.id === tId);
                              const cfg = assignConfigs[`${tId}__${prod.id}`] || {};
                              const effMode = cfg.stockMode || bulkDefaultStockMode;
                              return (
                                <div key={tId} style={styles.perTermOverrideRow}>
                                  <span style={{ fontSize: "11.5px", fontWeight: "800", color: "#1e3a8a", minWidth: "120px" }}>
                                    {tObj?.name}:
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder={`Price (₹${pricing.basePrice})`}
                                    value={cfg.sellingPriceOverride ?? ""}
                                    onChange={(e) =>
                                      updateAssignConfig(tId, prod.id, "sellingPriceOverride", e.target.value)
                                    }
                                    style={styles.smallInput}
                                  />
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="GST %"
                                    value={cfg.taxOverride ?? ""}
                                    onChange={(e) =>
                                      updateAssignConfig(tId, prod.id, "taxOverride", e.target.value)
                                    }
                                    style={{ ...styles.smallInput, width: "75px" }}
                                  />
                                  <input
                                    type="text"
                                    placeholder="Category"
                                    value={cfg.categoryName ?? prod.category ?? ""}
                                    onChange={(e) =>
                                      updateAssignConfig(tId, prod.id, "categoryName", e.target.value)
                                    }
                                    style={styles.smallInput}
                                  />
                                  <select
                                    value={effMode}
                                    onChange={(e) =>
                                      updateAssignConfig(tId, prod.id, "stockMode", e.target.value)
                                    }
                                    style={styles.smallInput}
                                  >
                                    <option value={STOCK_MODES.SHARED}>Central Stock</option>
                                    <option value={STOCK_MODES.INDEPENDENT}>Terminal Stock</option>
                                  </select>
                                  {effMode === STOCK_MODES.INDEPENDENT && (
                                    <input
                                      type="number"
                                      min="0"
                                      placeholder={`Qty (${bulkDefaultInitialStock})`}
                                      value={cfg.initialStockQuantity ?? ""}
                                      onChange={(e) =>
                                        updateAssignConfig(tId, prod.id, "initialStockQuantity", e.target.value)
                                      }
                                      style={{ ...styles.smallInput, width: "80px" }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingAssign} style={styles.tealBtn}>
                  {savingAssign
                    ? "Assigning..."
                    : `Assign ${selectedShopProductIds.length} Product(s) to ${targetTerminalIds.length} Terminal(s)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 4: TERMINAL CATEGORY MANAGER                                */}
      {/* ================================================================= */}
      {catModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setCatModalOpen(false)}>
          <div
            style={{ ...styles.modalBox, maxWidth: "540px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>🏷️ Terminal Categories ({activeTerminal?.name})</h3>
                <p style={styles.modalSub}>
                  Independent categories scoped strictly to {activeTerminal?.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <form
                onSubmit={handleSaveCat}
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  backgroundColor: "#f8fafc",
                  padding: "12px",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <input
                  type="text"
                  required
                  placeholder="Category Name (e.g. Breakfast, Hot Drinks)"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  style={{ ...styles.input, flex: 2, minWidth: "160px" }}
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  style={{ ...styles.input, flex: 2, minWidth: "140px" }}
                />
                <input
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  style={{ width: "42px", height: "38px", borderRadius: "8px", border: "1px solid #cbd5e1", cursor: "pointer" }}
                />
                <button type="submit" disabled={savingCat} style={styles.primaryBtn}>
                  {savingCat ? "..." : editingCat ? "Update" : "+ Add"}
                </button>
                {editingCat && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCat(null);
                      setCatName("");
                      setCatDesc("");
                    }}
                    style={styles.cancelBtn}
                  >
                    Cancel Edit
                  </button>
                )}
              </form>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
                {terminalCategories.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "#64748b", fontSize: "13px" }}>
                    No custom categories created yet for {activeTerminal?.name}.
                  </div>
                ) : (
                  terminalCategories.map((c) => (
                    <div key={c.id} style={styles.catRow}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            width: "12px",
                            height: "12px",
                            borderRadius: "50%",
                            backgroundColor: c.color || "#2563eb",
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: "800", fontSize: "13.5px", color: "#0f172a" }}>
                            {c.name}
                          </div>
                          {c.description && (
                            <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                              {c.description}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCat(c);
                            setCatName(c.name);
                            setCatDesc(c.description || "");
                            setCatColor(c.color || "#2563eb");
                          }}
                          style={styles.miniActionBtn}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCat(c)}
                          style={{ ...styles.miniActionBtn, color: "#dc2626" }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 5: STOCK ADJUSTMENT & TRACEABLE AUDIT LOG                   */}
      {/* ================================================================= */}
      {stockModalItem && (
        <div style={styles.modalOverlay} onClick={() => setStockModalItem(null)}>
          <div
            style={{ ...styles.modalBox, maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <h3 style={styles.modalTitle}>⚖️ Manage Stock: {stockModalItem.name}</h3>
                <p style={styles.modalSub}>
                  {stockModalItem.stockMode === STOCK_MODES.SHARED
                    ? "🌐 Updating Shared Central Shop Stock (affects all terminals using shared stock)"
                    : `🖥️ Updating Independent Terminal Stock for ${activeTerminal?.name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStockModalItem(null)}
                style={styles.closeBtn}
              >
                ✕
              </button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.shopBaselineBanner}>
                <span>
                  Current Stock:{" "}
                  <strong>
                    {stockModalItem.effectiveStock} {stockModalItem.unit}
                  </strong>
                </span>
                <span>
                  Low Stock Alert: <strong>{stockModalItem.lowStockAlert}</strong>
                </span>
              </div>

              <form onSubmit={handleSubmitStockAdjust} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={styles.formGrid2}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Adjustment Action</label>
                    <select
                      value={stockAdjMode}
                      onChange={(e) => setStockAdjMode(e.target.value)}
                      style={styles.input}
                    >
                      <option value="add">➕ Add Stock (+)</option>
                      <option value="subtract">➖ Deduct / Wastage (-)</option>
                      <option value="set">🎯 Set Exact Stock Qty</option>
                    </select>
                  </div>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Quantity ({stockModalItem.unit}) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={stockAdjQty}
                      onChange={(e) => setStockAdjQty(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Low Stock Alert Threshold</label>
                    <input
                      type="number"
                      min="0"
                      value={stockAdjAlert}
                      onChange={(e) => setStockAdjAlert(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Reason (Audit Log)</label>
                    <input
                      type="text"
                      required
                      value={stockAdjReason}
                      onChange={(e) => setStockAdjReason(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setStockModalItem(null)}
                    style={styles.cancelBtn}
                  >
                    Close
                  </button>
                  <button type="submit" disabled={savingStock} style={styles.primaryBtn}>
                    {savingStock ? "Saving..." : "Apply Stock Adjustment"}
                  </button>
                </div>
              </form>

              {/* Recent Audit Log for this Product */}
              <div style={{ marginTop: "8px" }}>
                <div style={{ fontSize: "12px", fontWeight: "800", color: "#334155", marginBottom: "6px" }}>
                  📜 Traceable Stock Movements
                </div>
                <div style={{ maxHeight: "170px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {stockMovements
                    .filter((m) => m.productId === stockModalItem.productId)
                    .slice(0, 15)
                    .map((m) => (
                      <div key={m.id} style={styles.moveRow}>
                        <div>
                          <div style={{ fontWeight: "700", fontSize: "12px", color: "#0f172a" }}>
                            {m.reason}
                          </div>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {formatDateTime(m.createdAt || m.createdAtMs)} • By {m.staffName}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div
                            style={{
                              fontWeight: "800",
                              fontSize: "12.5px",
                              color: Number(m.changeQty) >= 0 ? "#15803d" : "#dc2626",
                            }}
                          >
                            {Number(m.changeQty) >= 0 ? `+${m.changeQty}` : m.changeQty}
                          </div>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>
                            {m.previousQty} → {m.newQty}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  topPanel: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  termSelectorRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  termPillBtn: {
    padding: "7px 12px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#f8fafc",
    color: "#334155",
    fontSize: "12.5px",
    fontWeight: "700",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  termPillBtnActive: {
    backgroundColor: "#0f172a",
    color: "#ffffff",
    borderColor: "#0f172a",
  },
  codePill: {
    fontSize: "10.5px",
    fontWeight: "800",
    backgroundColor: "#e2e8f0",
    color: "#1e293b",
    padding: "2px 6px",
    borderRadius: "6px",
  },
  codePillDark: {
    fontSize: "10.5px",
    fontWeight: "800",
    backgroundColor: "#334155",
    color: "#f8fafc",
    padding: "2px 6px",
    borderRadius: "6px",
  },
  primaryBtn: {
    padding: "9px 14px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  tealBtn: {
    padding: "9px 14px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#0d9488",
    color: "#ffffff",
    fontWeight: "800",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "9px 14px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontWeight: "700",
    fontSize: "12.5px",
    cursor: "pointer",
  },
  termKpiStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "10px",
  },
  miniStat: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  miniLabel: { fontSize: "11px", fontWeight: "700", color: "#64748b", textTransform: "uppercase" },
  miniValue: { fontSize: "16px", fontWeight: "900", color: "#0f172a" },
  miniSub: { fontSize: "11px", color: "#64748b" },
  filterPanel: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "14px",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  searchInput: {
    flex: 1,
    minWidth: "220px",
    padding: "9px 12px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    outline: "none",
  },
  filterSelect: {
    padding: "9px 12px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#f8fafc",
    fontSize: "12.5px",
    fontWeight: "700",
  },
  catFilterRow: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  catPill: {
    padding: "5px 12px",
    borderRadius: "20px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
  },
  catPillActive: {
    backgroundColor: "#fc8019",
    borderColor: "#fc8019",
    color: "#ffffff",
  },
  productGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: "14px",
  },
  prodCard: {
    backgroundColor: "#ffffff",
    border: "1.5px solid #e2e8f0",
    borderRadius: "14px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  prodImgWrap: { position: "relative", height: "135px", backgroundColor: "#f1f5f9" },
  prodImg: { width: "100%", height: "100%", objectFit: "cover" },
  sourceBadge: {
    position: "absolute",
    top: "8px",
    left: "8px",
    fontSize: "10.5px",
    fontWeight: "800",
    padding: "3px 8px",
    borderRadius: "8px",
  },
  stockCornerBadge: {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    fontSize: "11px",
    fontWeight: "800",
    padding: "3px 8px",
    borderRadius: "8px",
  },
  prodBody: { padding: "12px", display: "flex", flexDirection: "column", gap: "6px", flex: 1 },
  prodName: { margin: 0, fontSize: "14.5px", fontWeight: "800", color: "#0f172a" },
  catBadge: {
    fontSize: "10.5px",
    fontWeight: "700",
    backgroundColor: "#fff7ed",
    color: "#c2410c",
    padding: "2px 7px",
    borderRadius: "6px",
  },
  stockModeTag: {
    fontSize: "10.5px",
    fontWeight: "700",
    backgroundColor: "#f1f5f9",
    color: "#334155",
    padding: "2px 7px",
    borderRadius: "6px",
  },
  inactiveBadge: {
    fontSize: "10.5px",
    fontWeight: "800",
    backgroundColor: "#fee2e2",
    color: "#dc2626",
    padding: "2px 7px",
    borderRadius: "6px",
  },
  priceBox: {
    backgroundColor: "#f8fafc",
    borderRadius: "10px",
    padding: "7px 9px",
    border: "1px solid #e2e8f0",
    marginTop: "2px",
  },
  miniActionBtn: {
    padding: "4px 8px",
    borderRadius: "7px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#ffffff",
    fontSize: "11px",
    fontWeight: "700",
    cursor: "pointer",
  },
  cardBtn: {
    flex: 1,
    padding: "6px 8px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#1e293b",
    fontSize: "11.5px",
    fontWeight: "700",
    cursor: "pointer",
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    border: "1px dashed #cbd5e1",
    borderRadius: "16px",
    padding: "42px 20px",
    textAlign: "center",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10050,
    padding: "16px",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "18px",
    width: "100%",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 24px 48px rgba(0,0,0,0.22)",
  },
  modalHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  modalTitle: { margin: 0, fontSize: "17px", fontWeight: "800", color: "#0f172a" },
  modalSub: { margin: "3px 0 0", fontSize: "12px", color: "#64748b" },
  closeBtn: {
    background: "transparent",
    border: "none",
    fontSize: "18px",
    color: "#64748b",
    cursor: "pointer",
    fontWeight: "800",
  },
  modalBody: {
    padding: "16px 20px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  formGrid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "10px",
  },
  fieldGroup: { display: "flex", flexDirection: "column", gap: "4px" },
  label: { fontSize: "11.5px", fontWeight: "700", color: "#334155" },
  input: {
    padding: "8px 10px",
    borderRadius: "9px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  smallInput: {
    padding: "5px 8px",
    borderRadius: "7px",
    border: "1px solid #cbd5e1",
    fontSize: "12px",
    width: "110px",
  },
  uploadLabel: {
    padding: "8px 12px",
    borderRadius: "9px",
    border: "1.5px solid #cbd5e1",
    backgroundColor: "#f8fafc",
    cursor: "pointer",
    fontWeight: "700",
  },
  checkLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12.5px",
    fontWeight: "700",
    color: "#1e293b",
    cursor: "pointer",
  },
  checkChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "9px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
  },
  shopBaselineBanner: {
    backgroundColor: "#f0f9ff",
    border: "1px solid #bae6fd",
    borderRadius: "10px",
    padding: "10px 12px",
    display: "flex",
    justifyContent: "space-between",
    fontSize: "12.5px",
    color: "#0c4a6e",
  },
  assignListBox: {
    maxHeight: "300px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "10px",
    backgroundColor: "#f8fafc",
  },
  assignItemRow: {
    padding: "10px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
  },
  perTermOverrideRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  catRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#ffffff",
  },
  moveRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: "9px",
    border: "1px solid #e2e8f0",
    backgroundColor: "#f8fafc",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    paddingTop: "8px",
    borderTop: "1px solid #f1f5f9",
  },
  cancelBtn: {
    padding: "9px 15px",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#475569",
    fontWeight: "700",
    fontSize: "12.5px",
    cursor: "pointer",
  },
};
