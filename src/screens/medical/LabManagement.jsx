import { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../utils/firebase";

const DEFAULT_LAB_CATEGORIES = [
  "Blood Tests",
  "Urine Tests",
  "Biochemistry",
  "Haematology",
  "Microbiology",
  "Hormone Tests",
  "Imaging / Diagnostic Services",
  "Other Tests",
];

const SAMPLE_TYPES = [
  "Whole Blood",
  "Serum",
  "Plasma",
  "Urine",
  "Stool",
  "Sputum",
  "Swab (Throat/Nasal)",
  "Tissue / Biopsy",
  "CSF (Cerebrospinal Fluid)",
  "Other / Non-invasive",
];

export default function LabManagement({ ownerUid: propOwnerUid, isOwner = true, onBack }) {
  const currentUid = propOwnerUid || localStorage.getItem("uid");
  const currentStaffId = localStorage.getItem("staff_id") || (isOwner ? "OWNER" : "LAB-01");
  const currentStaffName = localStorage.getItem("staff_name") || (isOwner ? "Store Owner" : "Lab Technician");

  const [tests, setTests] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_LAB_CATEGORIES);
  const [loading, setLoading] = useState(true);

  // Filters & View Mode
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedSampleType, setSelectedSampleType] = useState("All");
  const [activeTabFilter, setActiveTabFilter] = useState("all"); // "all" | "active" | "inactive"
  const [groupByCategory, setGroupByCategory] = useState(false);

  // Add / Edit Test Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTestId, setEditingTestId] = useState(null);

  // Form Fields
  const [testName, setTestName] = useState("");
  const [testCode, setTestCode] = useState("");
  const [category, setCategory] = useState("Blood Tests");
  const [testDescription, setTestDescription] = useState("");
  const [sampleType, setSampleType] = useState("Whole Blood");
  const [price, setPrice] = useState("");
  const [processingTime, setProcessingTime] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Category Management Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);

  // Quick Price Edit Modal State
  const [quickPriceModal, setQuickPriceModal] = useState({ show: false, test: null, newPrice: "" });

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // 1. Subscribe to Lab Tests
  useEffect(() => {
    if (!currentUid) return;
    const testsColRef = collection(db, "users", currentUid, "lab_tests");
    const unsub = onSnapshot(
      testsColRef,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        list.sort((a, b) => String(a.testName || "").localeCompare(String(b.testName || "")));
        setTests(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading lab tests:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUid]);

  // 2. Subscribe to Custom Lab Categories
  useEffect(() => {
    if (!currentUid) return;
    const catColRef = collection(db, "users", currentUid, "lab_categories");
    const unsub = onSnapshot(
      catColRef,
      (snapshot) => {
        const customCats = snapshot.docs.map((d) => d.data().name).filter(Boolean);
        const merged = Array.from(new Set([...DEFAULT_LAB_CATEGORIES, ...customCats]));
        setCategories(merged);
      },
      (err) => console.warn("Notice reading lab categories:", err)
    );
    return () => unsub();
  }, [currentUid]);

  // Auto-dismiss status message
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const handleOpenAddModal = () => {
    setEditingTestId(null);
    setTestName("");
    setTestCode("");
    setCategory(categories[0] || "Blood Tests");
    setTestDescription("");
    setSampleType("Whole Blood");
    setPrice("");
    setProcessingTime("");
    setIsActive(true);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (t) => {
    setEditingTestId(t.id);
    setTestName(t.testName || "");
    setTestCode(t.testCode || "");
    setCategory(t.category || categories[0] || "Blood Tests");
    setTestDescription(t.testDescription || "");
    setSampleType(t.sampleType || "Whole Blood");
    setPrice(String(t.price ?? t.testPrice ?? "0"));
    setProcessingTime(t.processingTime || t.turnaroundTime || "");
    setIsActive(t.isActive !== false);
    setIsModalOpen(true);
  };

  const handleSaveTest = async (e) => {
    e.preventDefault();
    if (!currentUid) {
      alert("Missing store owner UID.");
      return;
    }
    const trimmedName = testName.trim();
    if (!trimmedName) {
      alert("Please enter a test name (e.g. CBC, Lipid Profile).");
      return;
    }
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      alert("Please enter a valid price for the test (₹).");
      return;
    }

    setSaving(true);
    try {
      const targetDocId = editingTestId || `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const payload = {
        testName: trimmedName,
        testCode: testCode.trim().toUpperCase(),
        category: category.trim(),
        testDescription: testDescription.trim(),
        sampleType: sampleType.trim(),
        price: priceNum,
        testPrice: priceNum,
        processingTime: processingTime.trim(),
        isActive: Boolean(isActive),
        ownerUid: currentUid,
        shopId: currentUid,
        updatedAt: serverTimestamp(),
        updatedBy: `${currentStaffName} (${currentStaffId})`,
      };

      if (!editingTestId) {
        payload.createdAt = serverTimestamp();
        payload.createdBy = `${currentStaffName} (${currentStaffId})`;
      }

      await setDoc(doc(db, "users", currentUid, "lab_tests", targetDocId), payload, { merge: true });

      setStatusMessage(`✅ Lab test "${trimmedName}" ${editingTestId ? "updated" : "added"} successfully!`);
      setIsModalOpen(false);
    } catch (err) {
      console.error("Error saving lab test:", err);
      alert("Failed to save lab test: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTestActive = async (test) => {
    if (!currentUid) return;
    const targetState = !test.isActive;
    const actionLabel = targetState ? "activate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${actionLabel} test "${test.testName}"?`)) {
      return;
    }
    try {
      await setDoc(
        doc(db, "users", currentUid, "lab_tests", test.id),
        {
          isActive: targetState,
          updatedAt: serverTimestamp(),
          updatedBy: `${currentStaffName} (${currentStaffId})`,
        },
        { merge: true }
      );
      setStatusMessage(`Test "${test.testName}" marked as ${targetState ? "Active" : "Inactive"}.`);
    } catch (err) {
      alert("Error updating status: " + err.message);
    }
  };

  const handleSaveQuickPrice = async (e) => {
    e.preventDefault();
    if (!currentUid || !quickPriceModal.test) return;
    const priceNum = parseFloat(quickPriceModal.newPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      alert("Please enter a valid price.");
      return;
    }
    try {
      await setDoc(
        doc(db, "users", currentUid, "lab_tests", quickPriceModal.test.id),
        {
          price: priceNum,
          testPrice: priceNum,
          updatedAt: serverTimestamp(),
          updatedBy: `${currentStaffName} (${currentStaffId})`,
        },
        { merge: true }
      );
      setStatusMessage(`Price for "${quickPriceModal.test.testName}" updated to ₹${priceNum}.`);
      setQuickPriceModal({ show: false, test: null, newPrice: "" });
    } catch (err) {
      alert("Error updating price: " + err.message);
    }
  };

  const handleDeleteTest = async (test) => {
    if (!currentUid) return;
    if (!window.confirm(`⚠️ Permanently delete test "${test.testName}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, "users", currentUid, "lab_tests", test.id));
      setStatusMessage(`Test "${test.testName}" deleted.`);
    } catch (err) {
      alert("Error deleting test: " + err.message);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    setCategorySaving(true);
    try {
      const catId = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
      await setDoc(
        doc(db, "users", currentUid, "lab_categories", catId),
        {
          name: name,
          ownerUid: currentUid,
          shopId: currentUid,
          createdAt: serverTimestamp(),
          createdBy: `${currentStaffName} (${currentStaffId})`,
          isActive: true,
        },
        { merge: true }
      );
      setCategories((prev) => Array.from(new Set([...prev, name])));
      setNewCategoryName("");
      setIsCategoryModalOpen(false);
      setStatusMessage(`Lab Category "${name}" added successfully.`);
    } catch (err) {
      alert("Failed to add category: " + err.message);
    } finally {
      setCategorySaving(false);
    }
  };

  // Filtered List
  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      // Tab filter
      if (activeTabFilter === "active" && t.isActive === false) return false;
      if (activeTabFilter === "inactive" && t.isActive !== false) return false;

      // Category filter
      if (selectedCategory !== "All" && t.category !== selectedCategory) return false;

      // Sample Type filter
      if (selectedSampleType !== "All" && t.sampleType !== selectedSampleType) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameStr = String(t.testName || "").toLowerCase();
        const codeStr = String(t.testCode || "").toLowerCase();
        const catStr = String(t.category || "").toLowerCase();
        const sampleStr = String(t.sampleType || "").toLowerCase();
        const descStr = String(t.testDescription || "").toLowerCase();
        if (!nameStr.includes(q) && !codeStr.includes(q) && !catStr.includes(q) && !sampleStr.includes(q) && !descStr.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [tests, activeTabFilter, selectedCategory, selectedSampleType, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const totalCount = tests.length;
    let activeCount = 0;
    let totalPrice = 0;

    tests.forEach((t) => {
      if (t.isActive !== false) {
        activeCount++;
        totalPrice += parseFloat(t.price ?? t.testPrice ?? 0) || 0;
      }
    });

    const avgPrice = totalCount > 0 ? Math.round(totalPrice / totalCount) : 0;
    return { totalCount, activeCount, categoryCount: categories.length, avgPrice };
  }, [tests, categories]);

  // Grouped by Category structure
  const groupedTests = useMemo(() => {
    const map = {};
    filteredTests.forEach((t) => {
      const cat = t.category || "Other Tests";
      if (!map[cat]) map[cat] = [];
      map[cat].push(t);
    });
    return map;
  }, [filteredTests]);

  const handleExportCsv = () => {
    if (tests.length === 0) {
      alert("No lab tests available to export.");
      return;
    }
    const headers = [
      "Test Name",
      "Test Code",
      "Category",
      "Sample Type",
      "Price (₹)",
      "Estimated Processing Time",
      "Description",
      "Active Status",
    ];
    const rows = filteredTests.map((t) => [
      `"${t.testName || ""}"`,
      `"${t.testCode || ""}"`,
      `"${t.category || ""}"`,
      `"${t.sampleType || ""}"`,
      t.price ?? t.testPrice ?? 0,
      `"${t.processingTime || ""}"`,
      `"${(t.testDescription || "").replace(/"/g, '""')}"`,
      t.isActive !== false ? "ACTIVE" : "INACTIVE",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encoded = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encoded);
    link.setAttribute("download", `Lab_Tests_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={styles.container}>
      {/* Top Header */}
      <div style={styles.header}>
        <div style={styles.headerTitleWrap}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn} title="Back to Dashboard">
              ← Back
            </button>
          )}
          <div>
            <h1 style={styles.title}>
              🧪 Laboratory Services & Diagnostic Pricing
            </h1>
            <p style={styles.subtitle}>
              Configure diagnostic tests, blood & pathology investigations, specimen sample types, and service prices.
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={() => setGroupByCategory(!groupByCategory)}
            style={{
              ...styles.secondaryBtn,
              backgroundColor: groupByCategory ? "#f1f5f9" : "#ffffff",
              borderColor: groupByCategory ? "#0284c7" : "#cbd5e1",
              color: groupByCategory ? "#0284c7" : "#334155",
            }}
            title="Toggle Group By Category"
          >
            {groupByCategory ? "🗂️ Flat View" : "📂 Group by Category"}
          </button>
          <button
            type="button"
            onClick={() => setIsCategoryModalOpen(true)}
            style={styles.secondaryBtn}
            title="Configure lab test categories"
          >
            🏷️ Test Categories
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            style={styles.secondaryBtn}
            title="Export CSV of all lab tests"
          >
            📥 Export CSV
          </button>
          <button
            type="button"
            onClick={handleOpenAddModal}
            style={styles.primaryBtn}
          >
            ➕ Add Lab Test
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {statusMessage && (
        <div style={styles.toast}>
          {statusMessage}
        </div>
      )}

      {/* Stats Summary Cards */}
      <div style={styles.statsRow}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🧪</div>
          <div>
            <div style={styles.statLabel}>Total Tests</div>
            <div style={styles.statValue}>{stats.totalCount}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #16a34a" }}>
          <div style={{ ...styles.statIcon, color: "#16a34a" }}>✅</div>
          <div>
            <div style={styles.statLabel}>Active Tests</div>
            <div style={{ ...styles.statValue, color: "#16a34a" }}>{stats.activeCount}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #7c3aed" }}>
          <div style={{ ...styles.statIcon, color: "#7c3aed" }}>🏷️</div>
          <div>
            <div style={styles.statLabel}>Categories</div>
            <div style={{ ...styles.statValue, color: "#7c3aed" }}>{stats.categoryCount}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #0284c7" }}>
          <div style={{ ...styles.statIcon, color: "#0284c7" }}>₹</div>
          <div>
            <div style={styles.statLabel}>Avg. Test Price</div>
            <div style={{ ...styles.statValue, color: "#0284c7" }}>₹{stats.avgPrice}</div>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Search test name, code (e.g. CBC), sample type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} style={styles.clearSearchBtn}>
              ✕
            </button>
          )}
        </div>

        <div style={styles.filtersGroup}>
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="All">All Categories ({categories.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Sample Type Filter */}
          <select
            value={selectedSampleType}
            onChange={(e) => setSelectedSampleType(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="All">All Specimen Types</option>
            {SAMPLE_TYPES.map((s) => (
              <option key={s} value={s}>
                🔬 {s}
              </option>
            ))}
          </select>

          {/* Active / Inactive Tabs */}
          <div style={styles.statusTabs}>
            <button
              type="button"
              onClick={() => setActiveTabFilter("all")}
              style={{
                ...styles.statusTabBtn,
                ...(activeTabFilter === "all" ? styles.statusTabBtnActive : {}),
              }}
            >
              All ({tests.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTabFilter("active")}
              style={{
                ...styles.statusTabBtn,
                ...(activeTabFilter === "active" ? styles.statusTabBtnActive : {}),
              }}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setActiveTabFilter("inactive")}
              style={{
                ...styles.statusTabBtn,
                ...(activeTabFilter === "inactive" ? styles.statusTabBtnActive : {}),
              }}
            >
              Inactive
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div style={styles.loadingBox}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>⏳</div>
          <div style={{ fontWeight: "700", color: "#64748b" }}>Loading lab tests & investigations...</div>
        </div>
      ) : filteredTests.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🧪</div>
          <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#1e293b", margin: "0 0 6px 0" }}>
            No lab tests found
          </h3>
          <p style={{ color: "#64748b", margin: "0 0 16px 0", maxWidth: "420px", fontSize: "14px" }}>
            {searchQuery || selectedCategory !== "All"
              ? "Try adjusting your search criteria or category filter."
              : "Get started by adding your first laboratory test, blood routine, or biochemistry panel."}
          </p>
          <button type="button" onClick={handleOpenAddModal} style={styles.primaryBtn}>
            ➕ Add Your First Test
          </button>
        </div>
      ) : groupByCategory ? (
        /* Grouped By Category View */
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {Object.entries(groupedTests).map(([catName, catTests]) => (
            <div key={catName} style={styles.groupSection}>
              <div style={styles.groupHeader}>
                <h2 style={styles.groupTitle}>
                  🏷️ {catName} ({catTests.length})
                </h2>
              </div>
              <div style={styles.grid}>
                {catTests.map((t) => renderTestCard(t))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Flat Grid View */
        <div style={styles.grid}>
          {filteredTests.map((t) => renderTestCard(t))}
        </div>
      )}

      {/* ADD / EDIT LAB TEST MODAL */}
      {isModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalBox}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                {editingTestId ? "✏️ Edit Laboratory Test" : "➕ Add New Laboratory Test"}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTest} style={styles.modalForm}>
              <div style={styles.formGrid2}>
                {/* Test Name */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>
                    Test Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. CBC (Complete Blood Count), Lipid Profile"
                    value={testName}
                    onChange={(e) => setTestName(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                {/* Test Code */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Test Code (optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. CBC-01, TSH, BS-F"
                    value={testCode}
                    onChange={(e) => setTestCode(e.target.value)}
                    style={styles.input}
                  />
                </div>

                {/* Category */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>
                    Category <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    style={styles.input}
                    required
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Test Price */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>
                    Test Price (₹) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 350"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                {/* Sample / Specimen Type */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Specimen / Sample Type</label>
                  <select
                    value={sampleType}
                    onChange={(e) => setSampleType(e.target.value)}
                    style={styles.input}
                  >
                    {SAMPLE_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Estimated Processing Time */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Estimated Processing Time</label>
                  <input
                    type="text"
                    placeholder="e.g. 2 hours, Same day, 24 hours"
                    value={processingTime}
                    onChange={(e) => setProcessingTime(e.target.value)}
                    style={styles.input}
                  />
                </div>

                {/* Active Status */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Service Status</label>
                  <select
                    value={isActive ? "active" : "inactive"}
                    onChange={(e) => setIsActive(e.target.value === "active")}
                    style={styles.input}
                  >
                    <option value="active">🟢 Active in Service Catalog</option>
                    <option value="inactive">⏸️ Inactive / Hidden</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div style={{ ...styles.inputGroup, marginTop: "12px" }}>
                <label style={styles.label}>Test Description & Notes (optional)</label>
                <textarea
                  rows="3"
                  placeholder="e.g. Fasting 8-10 hours required before blood draw. Measures RBC, WBC, Platelets, Haemoglobin..."
                  value={testDescription}
                  onChange={(e) => setTestDescription(e.target.value)}
                  style={{ ...styles.input, resize: "vertical" }}
                />
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={styles.secondaryBtn}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={styles.primaryBtn}
                  disabled={saving}
                >
                  {saving ? "Saving Test..." : editingTestId ? "💾 Update Test" : "➕ Add Test"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK PRICE UPDATE MODAL */}
      {quickPriceModal.show && quickPriceModal.test && (
        <div style={styles.modalBackdrop}>
          <div style={{ ...styles.modalBox, maxWidth: "400px" }}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>💰 Quick Price Update</h2>
              <button
                type="button"
                onClick={() => setQuickPriceModal({ show: false, test: null, newPrice: "" })}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveQuickPrice} style={styles.modalForm}>
              <p style={{ fontSize: "14px", color: "#475569", margin: "0 0 12px 0" }}>
                Updating test price for <strong>{quickPriceModal.test.testName}</strong>
              </p>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Test Price (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickPriceModal.newPrice}
                  onChange={(e) => setQuickPriceModal({ ...quickPriceModal, newPrice: e.target.value })}
                  style={styles.input}
                  required
                  autoFocus
                />
              </div>
              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setQuickPriceModal({ show: false, test: null, newPrice: "" })}
                  style={styles.secondaryBtn}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.primaryBtn}>
                  💾 Save Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MANAGE TEST CATEGORIES MODAL */}
      {isCategoryModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={{ ...styles.modalBox, maxWidth: "500px" }}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>🏷️ Laboratory Test Categories</h2>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "16px 20px" }}>
              <form onSubmit={handleAddCategory} style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                <input
                  type="text"
                  placeholder="New category name (e.g. Immunology)..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  style={{ ...styles.input, flex: 1 }}
                  required
                />
                <button
                  type="submit"
                  style={styles.primaryBtn}
                  disabled={categorySaving}
                >
                  {categorySaving ? "Adding..." : "➕ Add"}
                </button>
              </form>

              <div style={styles.categoryListWrap}>
                <label style={{ ...styles.label, marginBottom: "8px" }}>Configured Categories ({categories.length})</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {categories.map((c) => (
                    <span key={c} style={styles.categoryTagPill}>
                      🏷️ {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ ...styles.modalActions, padding: "12px 20px" }}>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                style={styles.primaryBtn}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderTestCard(t) {
    const isAct = t.isActive !== false;
    const testPrc = t.price ?? t.testPrice ?? 0;

    return (
      <div
        key={t.id}
        style={{
          ...styles.card,
          opacity: isAct ? 1 : 0.65,
          borderLeft: `5px solid ${isAct ? "#059669" : "#94a3b8"}`,
        }}
      >
        <div style={styles.cardHeader}>
          <div>
            <div style={styles.badgeRow}>
              <span style={styles.categoryBadge}>{t.category || "General Test"}</span>
              {t.testCode && <span style={styles.codeBadge}>{t.testCode}</span>}
              {!isAct && <span style={styles.inactiveBadge}>INACTIVE</span>}
            </div>
            <h3 style={styles.testName}>{t.testName}</h3>
            <div style={styles.testMetaSub}>
              {t.sampleType && <span>🔬 {t.sampleType}</span>}
              {t.processingTime && <span>• ⏱️ {t.processingTime}</span>}
            </div>
          </div>

          <div
            style={styles.priceTag}
            onClick={() =>
              setQuickPriceModal({
                show: true,
                test: t,
                newPrice: String(testPrc),
              })
            }
            title="Click to quickly update test price"
          >
            <div style={styles.priceLabel}>Test Price</div>
            <div style={styles.priceValue}>₹{testPrc}</div>
          </div>
        </div>

        {t.testDescription && <p style={styles.testDesc}>{t.testDescription}</p>}

        {t.updatedAt && (
          <div style={styles.auditText}>
            🕒 {t.updatedBy ? `Updated by ${t.updatedBy}` : "Active"}
          </div>
        )}

        <div style={styles.cardFooter}>
          <button
            type="button"
            onClick={() => handleToggleTestActive(t)}
            style={{
              ...styles.actionBtn,
              color: isAct ? "#d97706" : "#16a34a",
              backgroundColor: isAct ? "#fef3c7" : "#dcfce7",
            }}
            title={isAct ? "Deactivate Test" : "Activate Test"}
          >
            {isAct ? "⏸️ Deactivate" : "🟢 Activate"}
          </button>

          <button
            type="button"
            onClick={() => handleOpenEditModal(t)}
            style={{ ...styles.actionBtn, color: "#0284c7", backgroundColor: "#e0f2fe" }}
            title="Edit Test Details"
          >
            ✏️ Edit
          </button>

          <button
            type="button"
            onClick={() => handleDeleteTest(t)}
            style={{ ...styles.actionBtn, color: "#dc2626", backgroundColor: "#fee2e2" }}
            title="Delete Test Entry"
          >
            🗑️ Delete
          </button>
        </div>
      </div>
    );
  }
}

const styles = {
  container: {
    padding: "20px",
    backgroundColor: "#f8fafc",
    minHeight: "100%",
    boxSizing: "border-box",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "16px",
    marginBottom: "20px",
  },
  headerTitleWrap: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  backBtn: {
    padding: "8px 12px",
    backgroundColor: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    color: "#334155",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
  },
  title: {
    fontSize: "22px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "0 0 4px 0",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  subtitle: {
    fontSize: "13px",
    color: "#64748b",
    margin: 0,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  primaryBtn: {
    padding: "10px 18px",
    backgroundColor: "#059669",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  secondaryBtn: {
    padding: "9px 15px",
    backgroundColor: "#ffffff",
    color: "#334155",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  toast: {
    backgroundColor: "#ecfdf5",
    color: "#065f46",
    border: "1px solid #a7f3d0",
    padding: "10px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600",
    marginBottom: "16px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    marginBottom: "20px",
  },
  statCard: {
    backgroundColor: "#ffffff",
    borderRadius: "10px",
    padding: "14px 16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  statIcon: {
    fontSize: "24px",
  },
  statLabel: {
    fontSize: "11px",
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  statValue: {
    fontSize: "19px",
    fontWeight: "800",
    color: "#0f172a",
    marginTop: "2px",
  },
  toolbar: {
    backgroundColor: "#ffffff",
    padding: "14px 16px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    marginBottom: "20px",
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    justifyContent: "space-between",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    padding: "0 10px",
    flex: "1 1 280px",
    position: "relative",
  },
  searchIcon: {
    fontSize: "14px",
    marginRight: "6px",
    color: "#64748b",
  },
  searchInput: {
    border: "none",
    background: "transparent",
    padding: "9px 0",
    fontSize: "13px",
    width: "100%",
    outline: "none",
    color: "#1e293b",
  },
  clearSearchBtn: {
    background: "none",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "13px",
    padding: "4px",
  },
  filtersGroup: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },
  filterSelect: {
    padding: "8px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    color: "#334155",
    backgroundColor: "#ffffff",
    cursor: "pointer",
    outline: "none",
  },
  statusTabs: {
    display: "inline-flex",
    backgroundColor: "#f1f5f9",
    borderRadius: "8px",
    padding: "3px",
  },
  statusTabBtn: {
    padding: "6px 12px",
    border: "none",
    backgroundColor: "transparent",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
    color: "#64748b",
    cursor: "pointer",
  },
  statusTabBtnActive: {
    backgroundColor: "#ffffff",
    color: "#059669",
    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
  },
  groupSection: {
    backgroundColor: "#ffffff",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    padding: "16px",
  },
  groupHeader: {
    marginBottom: "14px",
    paddingBottom: "8px",
    borderBottom: "1px solid #f1f5f9",
  },
  groupTitle: {
    fontSize: "16px",
    fontWeight: "800",
    color: "#1e293b",
    margin: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))",
    gap: "16px",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    padding: "16px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },
  badgeRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    marginBottom: "4px",
  },
  categoryBadge: {
    backgroundColor: "#ecfdf5",
    color: "#059669",
    borderRadius: "6px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: "700",
  },
  codeBadge: {
    backgroundColor: "#f1f5f9",
    color: "#475569",
    borderRadius: "6px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: "700",
  },
  inactiveBadge: {
    backgroundColor: "#fee2e2",
    color: "#dc2626",
    borderRadius: "6px",
    padding: "2px 8px",
    fontSize: "10px",
    fontWeight: "800",
  },
  testName: {
    fontSize: "16px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "4px 0",
  },
  testMetaSub: {
    fontSize: "12px",
    color: "#64748b",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  priceTag: {
    backgroundColor: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: "8px",
    padding: "6px 10px",
    textAlign: "right",
    cursor: "pointer",
    minWidth: "85px",
  },
  priceLabel: {
    fontSize: "10px",
    color: "#166534",
    fontWeight: "700",
    textTransform: "uppercase",
  },
  priceValue: {
    fontSize: "16px",
    fontWeight: "800",
    color: "#15803d",
  },
  testDesc: {
    fontSize: "12px",
    color: "#475569",
    margin: 0,
    lineHeight: "1.4",
  },
  auditText: {
    fontSize: "11px",
    color: "#94a3b8",
  },
  cardFooter: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingTop: "10px",
    borderTop: "1px solid #f1f5f9",
  },
  actionBtn: {
    flex: 1,
    padding: "6px 10px",
    border: "none",
    borderRadius: "6px",
    fontWeight: "600",
    fontSize: "12px",
    cursor: "pointer",
    textAlign: "center",
  },
  loadingBox: {
    textAlign: "center",
    padding: "60px 20px",
    backgroundColor: "#ffffff",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
  },
  emptyState: {
    textAlign: "center",
    padding: "60px 20px",
    backgroundColor: "#ffffff",
    borderRadius: "10px",
    border: "1px dashed #cbd5e1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  modalBackdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    backdropFilter: "blur(4px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    padding: "16px",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    width: "100%",
    maxWidth: "620px",
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
  },
  modalTitle: {
    fontSize: "17px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0,
  },
  modalCloseBtn: {
    background: "none",
    border: "none",
    fontSize: "18px",
    color: "#64748b",
    cursor: "pointer",
    padding: "4px 8px",
  },
  modalForm: {
    padding: "20px",
  },
  formGrid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "14px",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
  },
  label: {
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
  },
  input: {
    padding: "9px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    color: "#1e293b",
    backgroundColor: "#ffffff",
    outline: "none",
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "20px",
    paddingTop: "16px",
    borderTop: "1px solid #e2e8f0",
  },
  categoryListWrap: {
    marginTop: "12px",
    padding: "12px",
    backgroundColor: "#f8fafc",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
  },
  categoryTagPill: {
    backgroundColor: "#ecfdf5",
    color: "#059669",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
  },
};
