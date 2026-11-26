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

const DEFAULT_ROOM_CATEGORIES = [
  "General Ward",
  "Semi-Private Room",
  "Private Room",
  "Deluxe Room",
  "ICU",
  "Emergency Room",
  "Speciality Room",
];

const DEFAULT_SPECIALITIES = [
  "General Medicine",
  "Cardiology",
  "Neurology",
  "Orthopaedics",
  "Paediatrics",
  "Gynaecology",
  "Oncology",
  "Nephrology",
  "Other",
];

const ROOM_TYPES = [
  "Single Bed",
  "Double Sharing",
  "Triple Sharing",
  "Multi-Bed Ward",
  "VIP Suite",
  "Critical Care / ICU Bed",
  "Observation Bed",
];

const AVAILABILITY_STATUSES = [
  { id: "Available", label: "Available", color: "#16a34a", bg: "#dcfce7", icon: "🟢" },
  { id: "Occupied", label: "Occupied", color: "#dc2626", bg: "#fee2e2", icon: "🔴" },
  { id: "Maintenance", label: "Maintenance", color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  { id: "Cleaning", label: "Cleaning", color: "#2563eb", bg: "#dbeafe", icon: "🔵" },
];

export default function RoomManagement({ ownerUid: propOwnerUid, isOwner = true, onBack }) {
  const currentUid = propOwnerUid || localStorage.getItem("uid");
  const currentStaffId = localStorage.getItem("staff_id") || (isOwner ? "OWNER" : "WARD-01");
  const currentStaffName = localStorage.getItem("staff_name") || (isOwner ? "Store Owner" : "Ward In-charge");

  const [rooms, setRooms] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_ROOM_CATEGORIES);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [selectedAcFilter, setSelectedAcFilter] = useState("All");
  const [activeTabFilter, setActiveTabFilter] = useState("all"); // "all" | "active" | "inactive"

  // Add / Edit Room Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState(null);

  // Form Fields
  const [roomNumber, setRoomNumber] = useState("");
  const [category, setCategory] = useState("General Ward");
  const [roomType, setRoomType] = useState("Single Bed");
  const [acType, setAcType] = useState("AC");
  const [roomSize, setRoomSize] = useState("");
  const [speciality, setSpeciality] = useState("General Medicine");
  const [floor, setFloor] = useState("");
  const [numberOfBeds, setNumberOfBeds] = useState("1");
  const [description, setDescription] = useState("");
  const [dailyCharge, setDailyCharge] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState("");
  const [availabilityStatus, setAvailabilityStatus] = useState("Available");
  const [isActive, setIsActive] = useState(true);

  // Category Management Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);

  // Quick Price Edit Modal State
  const [quickPriceModal, setQuickPriceModal] = useState({ show: false, room: null, newPrice: "", newAddl: "" });

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // 1. Subscribe to Rooms
  useEffect(() => {
    if (!currentUid) {
      return;
    }
    const roomsColRef = collection(db, "users", currentUid, "pharmacy_rooms");
    const unsub = onSnapshot(
      roomsColRef,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        // Sort by roomNumber
        list.sort((a, b) => String(a.roomNumber || "").localeCompare(String(b.roomNumber || "")));
        setRooms(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error loading pharmacy rooms:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUid]);

  // 2. Subscribe to Custom Room Categories
  useEffect(() => {
    if (!currentUid) return;
    const catColRef = collection(db, "users", currentUid, "pharmacy_room_categories");
    const unsub = onSnapshot(
      catColRef,
      (snapshot) => {
        const customCats = snapshot.docs.map((d) => d.data().name).filter(Boolean);
        const merged = Array.from(new Set([...DEFAULT_ROOM_CATEGORIES, ...customCats]));
        setCategories(merged);
      },
      (err) => console.warn("Notice reading room categories:", err)
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
    setEditingRoomId(null);
    setRoomNumber("");
    setCategory(categories[0] || "General Ward");
    setRoomType("Single Bed");
    setAcType("AC");
    setRoomSize("");
    setSpeciality("General Medicine");
    setFloor("");
    setNumberOfBeds("1");
    setDescription("");
    setDailyCharge("");
    setAdditionalCharges("");
    setAvailabilityStatus("Available");
    setIsActive(true);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (r) => {
    setEditingRoomId(r.id);
    setRoomNumber(r.roomNumber || r.roomName || "");
    setCategory(r.category || categories[0] || "General Ward");
    setRoomType(r.roomType || "Single Bed");
    setAcType(r.acType || (r.isAc ? "AC" : "Non-AC"));
    setRoomSize(r.roomSize || "");
    setSpeciality(r.speciality || "General Medicine");
    setFloor(r.floor || "");
    setNumberOfBeds(String(r.numberOfBeds || "1"));
    setDescription(r.description || "");
    setDailyCharge(String(r.dailyCharge || "0"));
    setAdditionalCharges(r.additionalCharges !== undefined ? String(r.additionalCharges) : "");
    setAvailabilityStatus(r.availabilityStatus || "Available");
    setIsActive(r.isActive !== false);
    setIsModalOpen(true);
  };

  const handleSaveRoom = async (e) => {
    e.preventDefault();
    if (!currentUid) {
      alert("Missing store owner UID.");
      return;
    }
    const trimmedNum = roomNumber.trim();
    if (!trimmedNum) {
      alert("Please enter a Room Name or Number (e.g. Room 101, ICU-04).");
      return;
    }
    const chargeVal = parseFloat(dailyCharge);
    if (isNaN(chargeVal) || chargeVal < 0) {
      alert("Please enter a valid daily room charge (₹).");
      return;
    }

    setSaving(true);
    try {
      const targetDocId = editingRoomId || `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const payload = {
        roomNumber: trimmedNum,
        roomName: trimmedNum,
        category: category.trim(),
        roomType: roomType.trim(),
        acType: acType,
        isAc: acType === "AC",
        roomSize: roomSize.trim(),
        speciality: speciality.trim(),
        floor: floor.trim(),
        numberOfBeds: parseInt(numberOfBeds, 10) || 1,
        description: description.trim(),
        dailyCharge: chargeVal,
        additionalCharges: additionalCharges ? parseFloat(additionalCharges) || 0 : 0,
        availabilityStatus: availabilityStatus,
        isActive: Boolean(isActive),
        ownerUid: currentUid,
        shopId: currentUid,
        updatedAt: serverTimestamp(),
        updatedBy: `${currentStaffName} (${currentStaffId})`,
      };

      if (!editingRoomId) {
        payload.createdAt = serverTimestamp();
        payload.createdBy = `${currentStaffName} (${currentStaffId})`;
      }

      await setDoc(doc(db, "users", currentUid, "pharmacy_rooms", targetDocId), payload, { merge: true });

      setStatusMessage(`✅ Room "${trimmedNum}" ${editingRoomId ? "updated" : "added"} successfully!`);
      setIsModalOpen(false);
    } catch (err) {
      console.error("Error saving room:", err);
      alert("Failed to save room: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRoomActive = async (room) => {
    if (!currentUid) return;
    const targetState = !room.isActive;
    const actionLabel = targetState ? "activate" : "deactivate";
    if (!window.confirm(`Are you sure you want to ${actionLabel} room "${room.roomNumber}"?`)) {
      return;
    }
    try {
      await setDoc(
        doc(db, "users", currentUid, "pharmacy_rooms", room.id),
        {
          isActive: targetState,
          updatedAt: serverTimestamp(),
          updatedBy: `${currentStaffName} (${currentStaffId})`,
        },
        { merge: true }
      );
      setStatusMessage(`Room "${room.roomNumber}" marked as ${targetState ? "Active" : "Inactive"}.`);
    } catch (err) {
      alert("Error updating status: " + err.message);
    }
  };

  const handleQuickAvailabilityChange = async (room, newStatus) => {
    if (!currentUid || room.availabilityStatus === newStatus) return;
    try {
      await setDoc(
        doc(db, "users", currentUid, "pharmacy_rooms", room.id),
        {
          availabilityStatus: newStatus,
          updatedAt: serverTimestamp(),
          updatedBy: `${currentStaffName} (${currentStaffId})`,
        },
        { merge: true }
      );
      setStatusMessage(`Room "${room.roomNumber}" status changed to ${newStatus}.`);
    } catch (err) {
      alert("Error updating availability: " + err.message);
    }
  };

  const handleSaveQuickPrice = async (e) => {
    e.preventDefault();
    if (!currentUid || !quickPriceModal.room) return;
    const priceNum = parseFloat(quickPriceModal.newPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      alert("Please enter a valid price.");
      return;
    }
    try {
      await setDoc(
        doc(db, "users", currentUid, "pharmacy_rooms", quickPriceModal.room.id),
        {
          dailyCharge: priceNum,
          additionalCharges: quickPriceModal.newAddl ? parseFloat(quickPriceModal.newAddl) || 0 : 0,
          updatedAt: serverTimestamp(),
          updatedBy: `${currentStaffName} (${currentStaffId})`,
        },
        { merge: true }
      );
      setStatusMessage(`Price for "${quickPriceModal.room.roomNumber}" updated to ₹${priceNum}.`);
      setQuickPriceModal({ show: false, room: null, newPrice: "", newAddl: "" });
    } catch (err) {
      alert("Error updating price: " + err.message);
    }
  };

  const handleDeleteRoom = async (room) => {
    if (!currentUid) return;
    if (!window.confirm(`⚠️ Permanently delete room "${room.roomNumber}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, "users", currentUid, "pharmacy_rooms", room.id));
      setStatusMessage(`Room "${room.roomNumber}" deleted.`);
    } catch (err) {
      alert("Error deleting room: " + err.message);
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
        doc(db, "users", currentUid, "pharmacy_room_categories", catId),
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
      setStatusMessage(`Category "${name}" added successfully.`);
    } catch (err) {
      alert("Failed to add category: " + err.message);
    } finally {
      setCategorySaving(false);
    }
  };

  // Filtered List
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      // Tab filter
      if (activeTabFilter === "active" && r.isActive === false) return false;
      if (activeTabFilter === "inactive" && r.isActive !== false) return false;

      // Category filter
      if (selectedCategory !== "All" && r.category !== selectedCategory) return false;

      // Status filter
      if (selectedStatus !== "All" && r.availabilityStatus !== selectedStatus) return false;

      // AC filter
      if (selectedAcFilter !== "All") {
        const isAcStr = r.acType || (r.isAc ? "AC" : "Non-AC");
        if (isAcStr !== selectedAcFilter) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const num = String(r.roomNumber || "").toLowerCase();
        const cat = String(r.category || "").toLowerCase();
        const spec = String(r.speciality || "").toLowerCase();
        const fl = String(r.floor || "").toLowerCase();
        const rType = String(r.roomType || "").toLowerCase();
        if (!num.includes(q) && !cat.includes(q) && !spec.includes(q) && !fl.includes(q) && !rType.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [rooms, activeTabFilter, selectedCategory, selectedStatus, selectedAcFilter, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    let totalRooms = rooms.length;
    let availableCount = 0;
    let occupiedCount = 0;
    let maintenanceCount = 0;
    let totalBeds = 0;
    let totalDailyRevenuePotential = 0;

    rooms.forEach((r) => {
      if (r.isActive !== false) {
        const status = r.availabilityStatus || "Available";
        if (status === "Available") availableCount++;
        else if (status === "Occupied") occupiedCount++;
        else maintenanceCount++;

        totalBeds += parseInt(r.numberOfBeds, 10) || 1;
        totalDailyRevenuePotential += parseFloat(r.dailyCharge) || 0;
      }
    });

    const avgPrice = totalRooms > 0 ? Math.round(totalDailyRevenuePotential / totalRooms) : 0;
    return { totalRooms, availableCount, occupiedCount, maintenanceCount, totalBeds, avgPrice };
  }, [rooms]);

  const handleExportCsv = () => {
    if (rooms.length === 0) {
      alert("No room records available to export.");
      return;
    }
    const headers = [
      "Room Number",
      "Category",
      "Room Type",
      "AC / Non-AC",
      "Speciality",
      "Floor",
      "Beds",
      "Daily Charge (₹)",
      "Additional Charges (₹)",
      "Availability Status",
      "Active Status",
    ];
    const rows = filteredRooms.map((r) => [
      `"${r.roomNumber || ""}"`,
      `"${r.category || ""}"`,
      `"${r.roomType || ""}"`,
      r.acType || (r.isAc ? "AC" : "Non-AC"),
      `"${r.speciality || ""}"`,
      `"${r.floor || ""}"`,
      r.numberOfBeds || 1,
      r.dailyCharge || 0,
      r.additionalCharges || 0,
      r.availabilityStatus || "Available",
      r.isActive !== false ? "ACTIVE" : "INACTIVE",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const encoded = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encoded);
    link.setAttribute("download", `Hospital_Rooms_${new Date().toISOString().slice(0, 10)}.csv`);
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
              🏥 Hospital Ward & Room Management
            </h1>
            <p style={styles.subtitle}>
              Configure hospital room service inventory, daily room charges, bed capacity, and real-time room availability.
            </p>
          </div>
        </div>

        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={() => setIsCategoryModalOpen(true)}
            style={styles.secondaryBtn}
            title="Configure room categories"
          >
            🏷️ Manage Categories
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            style={styles.secondaryBtn}
            title="Export CSV of all rooms"
          >
            📥 Export CSV
          </button>
          <button
            type="button"
            onClick={handleOpenAddModal}
            style={styles.primaryBtn}
          >
            ➕ Add New Room
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
          <div style={styles.statIcon}>🚪</div>
          <div>
            <div style={styles.statLabel}>Total Rooms</div>
            <div style={styles.statValue}>{stats.totalRooms}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #16a34a" }}>
          <div style={{ ...styles.statIcon, color: "#16a34a" }}>🟢</div>
          <div>
            <div style={styles.statLabel}>Available Now</div>
            <div style={{ ...styles.statValue, color: "#16a34a" }}>{stats.availableCount}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #dc2626" }}>
          <div style={{ ...styles.statIcon, color: "#dc2626" }}>🔴</div>
          <div>
            <div style={styles.statLabel}>Occupied Beds</div>
            <div style={{ ...styles.statValue, color: "#dc2626" }}>{stats.occupiedCount}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #0284c7" }}>
          <div style={{ ...styles.statIcon, color: "#0284c7" }}>🛏️</div>
          <div>
            <div style={styles.statLabel}>Total Beds</div>
            <div style={{ ...styles.statValue, color: "#0284c7" }}>{stats.totalBeds}</div>
          </div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: "4px solid #7c3aed" }}>
          <div style={{ ...styles.statIcon, color: "#7c3aed" }}>₹</div>
          <div>
            <div style={styles.statLabel}>Avg. Room Charge</div>
            <div style={{ ...styles.statValue, color: "#7c3aed" }}>₹{stats.avgPrice} / day</div>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Search by Room #, Ward, Speciality, or Type..."
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

          {/* Availability Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="All">All Statuses</option>
            {AVAILABILITY_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.label}
              </option>
            ))}
          </select>

          {/* AC / Non-AC Filter */}
          <select
            value={selectedAcFilter}
            onChange={(e) => setSelectedAcFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="All">AC & Non-AC</option>
            <option value="AC">❄️ AC Rooms</option>
            <option value="Non-AC">🌬️ Non-AC</option>
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
              All ({rooms.length})
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

      {/* Main Content Area: Rooms List */}
      {loading ? (
        <div style={styles.loadingBox}>
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>⏳</div>
          <div style={{ fontWeight: "700", color: "#64748b" }}>Loading hospital rooms...</div>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🏨</div>
          <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#1e293b", margin: "0 0 6px 0" }}>
            No rooms found
          </h3>
          <p style={{ color: "#64748b", margin: "0 0 16px 0", maxWidth: "420px", fontSize: "14px" }}>
            {searchQuery || selectedCategory !== "All" || selectedStatus !== "All"
              ? "Try adjusting your search criteria or category filter."
              : "Get started by adding your first hospital room, general ward or ICU bed."}
          </p>
          <button type="button" onClick={handleOpenAddModal} style={styles.primaryBtn}>
            ➕ Add Your First Room
          </button>
        </div>
      ) : (
        <div style={styles.grid}>
          {filteredRooms.map((r) => {
            const availMeta =
              AVAILABILITY_STATUSES.find((s) => s.id === (r.availabilityStatus || "Available")) ||
              AVAILABILITY_STATUSES[0];
            const isAcRoom = r.acType === "AC" || r.isAc === true;

            return (
              <div
                key={r.id}
                style={{
                  ...styles.card,
                  opacity: r.isActive === false ? 0.65 : 1,
                  borderLeft: `5px solid ${r.isActive === false ? "#94a3b8" : availMeta.color}`,
                }}
              >
                {/* Card Header */}
                <div style={styles.cardHeader}>
                  <div>
                    <div style={styles.roomBadgeRow}>
                      <span style={styles.categoryBadge}>{r.category || "General"}</span>
                      <span
                        style={{
                          ...styles.acBadge,
                          backgroundColor: isAcRoom ? "#e0f2fe" : "#f1f5f9",
                          color: isAcRoom ? "#0369a1" : "#475569",
                        }}
                      >
                        {isAcRoom ? "❄️ AC" : "🌬️ Non-AC"}
                      </span>
                      {r.isActive === false && (
                        <span style={styles.inactiveBadge}>INACTIVE</span>
                      )}
                    </div>
                    <h3 style={styles.roomName}>{r.roomNumber || r.roomName}</h3>
                    <div style={styles.roomMetaSub}>
                      {r.floor && <span>📍 {r.floor}</span>}
                      {r.roomType && <span>• {r.roomType}</span>}
                      {r.speciality && <span>• 🩺 {r.speciality}</span>}
                    </div>
                  </div>

                  {/* Daily Room Price Tag */}
                  <div
                    style={styles.priceTag}
                    onClick={() =>
                      setQuickPriceModal({
                        show: true,
                        room: r,
                        newPrice: String(r.dailyCharge || 0),
                        newAddl: String(r.additionalCharges || 0),
                      })
                    }
                    title="Click to quickly update daily charge"
                  >
                    <div style={styles.priceLabel}>Daily Charge</div>
                    <div style={styles.priceValue}>₹{r.dailyCharge || 0}</div>
                    {r.additionalCharges > 0 && (
                      <div style={styles.priceAddl}>+₹{r.additionalCharges} addl.</div>
                    )}
                  </div>
                </div>

                {/* Description if present */}
                {r.description && (
                  <p style={styles.roomDesc}>{r.description}</p>
                )}

                {/* Details Pills */}
                <div style={styles.detailsRow}>
                  <div style={styles.detailPill}>
                    🛏️ <strong>{r.numberOfBeds || 1}</strong> Bed{(r.numberOfBeds || 1) > 1 ? "s" : ""}
                  </div>
                  {r.roomSize && (
                    <div style={styles.detailPill}>
                      📐 {r.roomSize} sq.ft.
                    </div>
                  )}
                  {r.updatedAt && (
                    <div style={styles.detailPillMuted}>
                      🕒 {r.updatedBy ? `Updated by ${r.updatedBy}` : "Active"}
                    </div>
                  )}
                </div>

                {/* Quick Availability Status Selector */}
                <div style={styles.statusRow}>
                  <span style={styles.statusSelectLabel}>Status:</span>
                  <div style={styles.statusButtonsGroup}>
                    {AVAILABILITY_STATUSES.map((s) => {
                      const isCur = (r.availabilityStatus || "Available") === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleQuickAvailabilityChange(r, s.id)}
                          style={{
                            ...styles.statusQuickBtn,
                            backgroundColor: isCur ? s.bg : "#f8fafc",
                            color: isCur ? s.color : "#64748b",
                            borderColor: isCur ? s.color : "#e2e8f0",
                            fontWeight: isCur ? "700" : "500",
                          }}
                          title={`Set status to ${s.label}`}
                        >
                          {s.icon} {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div style={styles.cardFooter}>
                  <button
                    type="button"
                    onClick={() => handleToggleRoomActive(r)}
                    style={{
                      ...styles.actionBtn,
                      color: r.isActive === false ? "#16a34a" : "#d97706",
                      backgroundColor: r.isActive === false ? "#dcfce7" : "#fef3c7",
                    }}
                    title={r.isActive === false ? "Activate Room" : "Deactivate Room"}
                  >
                    {r.isActive === false ? "🟢 Activate" : "⏸️ Deactivate"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(r)}
                    style={{ ...styles.actionBtn, color: "#0284c7", backgroundColor: "#e0f2fe" }}
                    title="Edit Room Details"
                  >
                    ✏️ Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteRoom(r)}
                    style={{ ...styles.actionBtn, color: "#dc2626", backgroundColor: "#fee2e2" }}
                    title="Delete Room Entry"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ADD / EDIT ROOM MODAL */}
      {isModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalBox}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                {editingRoomId ? "✏️ Edit Room Information" : "➕ Add New Hospital Room"}
              </h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRoom} style={styles.modalForm}>
              <div style={styles.formGrid2}>
                {/* Room Number / Name */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>
                    Room Name / Number <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Room 101, Deluxe Suite 2, ICU-Bed 5"
                    value={roomNumber}
                    onChange={(e) => setRoomNumber(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                {/* Room Category */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>
                    Room Category <span style={{ color: "#ef4444" }}>*</span>
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

                {/* Room Type */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Room Type</label>
                  <select
                    value={roomType}
                    onChange={(e) => setRoomType(e.target.value)}
                    style={styles.input}
                  >
                    {ROOM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* AC / Non-AC */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Air Conditioning</label>
                  <select
                    value={acType}
                    onChange={(e) => setAcType(e.target.value)}
                    style={styles.input}
                  >
                    <option value="AC">❄️ AC Room</option>
                    <option value="Non-AC">🌬️ Non-AC Room</option>
                  </select>
                </div>

                {/* Daily Room Charge */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>
                    Daily Room Charge (₹ / day) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 1500"
                    value={dailyCharge}
                    onChange={(e) => setDailyCharge(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                {/* Additional Charges */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Additional Charges (₹, optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 200 (Nursing/Amenities)"
                    value={additionalCharges}
                    onChange={(e) => setAdditionalCharges(e.target.value)}
                    style={styles.input}
                  />
                </div>

                {/* Floor / Ward */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Floor / Ward</label>
                  <input
                    type="text"
                    placeholder="e.g. 2nd Floor, Ward B, West Wing"
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    style={styles.input}
                  />
                </div>

                {/* Number of Beds */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Number of Beds</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    placeholder="1"
                    value={numberOfBeds}
                    onChange={(e) => setNumberOfBeds(e.target.value)}
                    style={styles.input}
                  />
                </div>

                {/* Speciality */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Speciality</label>
                  <select
                    value={speciality}
                    onChange={(e) => setSpeciality(e.target.value)}
                    style={styles.input}
                  >
                    {DEFAULT_SPECIALITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Room Size (sq. ft.) */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Room Size (sq. ft., optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 240 sq ft"
                    value={roomSize}
                    onChange={(e) => setRoomSize(e.target.value)}
                    style={styles.input}
                  />
                </div>

                {/* Availability Status */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Initial Availability Status</label>
                  <select
                    value={availabilityStatus}
                    onChange={(e) => setAvailabilityStatus(e.target.value)}
                    style={styles.input}
                  >
                    {AVAILABILITY_STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.icon} {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Active / Inactive Status */}
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Entry Status</label>
                  <select
                    value={isActive ? "active" : "inactive"}
                    onChange={(e) => setIsActive(e.target.value === "active")}
                    style={styles.input}
                  >
                    <option value="active">🟢 Active in Inventory</option>
                    <option value="inactive">⏸️ Inactive / Hidden</option>
                  </select>
                </div>
              </div>

              {/* Room Description */}
              <div style={{ ...styles.inputGroup, marginTop: "12px" }}>
                <label style={styles.label}>Room Description & Amenities (optional)</label>
                <textarea
                  rows="3"
                  placeholder="e.g. Attached washroom, TV, nurse call bell, attendant sofa couch..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ ...styles.input, resize: "vertical" }}
                />
              </div>

              {/* Modal Buttons */}
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
                  {saving ? "Saving Room..." : editingRoomId ? "💾 Update Room" : "➕ Add Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK PRICE UPDATE MODAL */}
      {quickPriceModal.show && quickPriceModal.room && (
        <div style={styles.modalBackdrop}>
          <div style={{ ...styles.modalBox, maxWidth: "420px" }}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>
                💰 Quick Price Update
              </h2>
              <button
                type="button"
                onClick={() => setQuickPriceModal({ show: false, room: null, newPrice: "", newAddl: "" })}
                style={styles.modalCloseBtn}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveQuickPrice} style={styles.modalForm}>
              <p style={{ fontSize: "14px", color: "#475569", margin: "0 0 12px 0" }}>
                Updating room charges for <strong>{quickPriceModal.room.roomNumber}</strong> ({quickPriceModal.room.category})
              </p>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Daily Room Charge (₹)</label>
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
              <div style={{ ...styles.inputGroup, marginTop: "10px" }}>
                <label style={styles.label}>Additional Charges (₹, optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickPriceModal.newAddl}
                  onChange={(e) => setQuickPriceModal({ ...quickPriceModal, newAddl: e.target.value })}
                  style={styles.input}
                />
              </div>
              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setQuickPriceModal({ show: false, room: null, newPrice: "", newAddl: "" })}
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

      {/* MANAGE CATEGORIES MODAL */}
      {isCategoryModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={{ ...styles.modalBox, maxWidth: "500px" }}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>🏷️ Hospital Room Categories</h2>
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
                  placeholder="New category name (e.g. Neonatal ICU)..."
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
    backgroundColor: "#0284c7",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
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
    color: "#0284c7",
    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
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
    gap: "12px",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },
  roomBadgeRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    marginBottom: "4px",
  },
  categoryBadge: {
    backgroundColor: "#f3e8ff",
    color: "#7c3aed",
    borderRadius: "6px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: "700",
  },
  acBadge: {
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
    letterSpacing: "0.5px",
  },
  roomName: {
    fontSize: "17px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "4px 0",
  },
  roomMetaSub: {
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
  priceAddl: {
    fontSize: "10px",
    color: "#64748b",
  },
  roomDesc: {
    fontSize: "12px",
    color: "#475569",
    margin: 0,
    lineHeight: "1.4",
  },
  detailsRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  detailPill: {
    backgroundColor: "#f1f5f9",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    color: "#334155",
    fontWeight: "500",
  },
  detailPillMuted: {
    fontSize: "11px",
    color: "#94a3b8",
    marginLeft: "auto",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    paddingTop: "6px",
    borderTop: "1px solid #f1f5f9",
  },
  statusSelectLabel: {
    fontSize: "11px",
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
  },
  statusButtonsGroup: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap",
    flex: 1,
  },
  statusQuickBtn: {
    border: "1px solid",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "11px",
    cursor: "pointer",
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
    maxWidth: "680px",
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
    backgroundColor: "#e0f2fe",
    color: "#0284c7",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: "600",
  },
};
