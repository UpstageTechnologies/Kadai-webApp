import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, getDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";

const ROLE_OPTIONS = [
  {
    id: "waiter",
    label: "Waiter / Captain",
    icon: "🍽️",
    badge: "Waiter",
    color: "#0284c7",
    bgColor: "#e0f2fe",
    desc: "Takes table orders & sends KOT to kitchen (No Billing)",
    portalPath: "/waiter",
  },
  {
    id: "kitchen",
    label: "Kitchen Staff",
    icon: "👨‍🍳",
    badge: "Kitchen",
    color: "#ea580c",
    bgColor: "#ffedd5",
    desc: "Receives live KOT orders & marks Dish Ready (No Billing)",
    portalPath: "/kitchen",
  },
  {
    id: "delivery",
    label: "Delivery Boy",
    icon: "🛵",
    badge: "Delivery",
    color: "#16a34a",
    bgColor: "#dcfce7",
    desc: "Delivers orders to customer door",
    portalPath: "/dashboard",
  },
  {
    id: "employee",
    label: "General Staff / Counter",
    icon: "💼",
    badge: "Staff",
    color: "#4f46e5",
    bgColor: "#ede9fe",
    desc: "General store employee / cashier",
    portalPath: "/dashboard",
  },
];

export default function StaffManagement({ onBack }) {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [selectedRole, setSelectedRole] = useState("waiter");
  const [staffId, setStaffId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Credentials Share Modal
  const [createdStaffModal, setCreatedStaffModal] = useState(null);
  const [copiedText, setCopiedText] = useState(false);

  // Sub Tab: "accounts" vs "attendance"
  const [activeSubTab, setActiveSubTab] = useState("accounts");

  // Attendance states
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendanceRecords, setAttendanceRecords] = useState({});

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

  // Real-time listener for selected date attendance
  useEffect(() => {
    if (!currentUid || !selectedDate) return;
    const unsub = onSnapshot(
      doc(db, "users", currentUid, "staff_attendance", selectedDate),
      (snap) => {
        if (snap.exists()) {
          setAttendanceRecords(snap.data().records || {});
        } else {
          setAttendanceRecords({});
        }
      },
      (err) => console.error("Attendance listener error:", err)
    );
    return () => unsub();
  }, [currentUid, selectedDate]);

  const handleSetStaffStatus = async (sId, status) => {
    if (!currentUid) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const existing = attendanceRecords[sId] || {};
    const updated = {
      ...attendanceRecords,
      [sId]: {
        ...existing,
        status,
        inTime: existing.inTime || (status === "present" || status === "half_day" ? timeStr : ""),
        outTime: existing.outTime || "",
        notes: existing.notes || "",
        updatedAtMs: Date.now()
      }
    };

    setAttendanceRecords(updated);
    try {
      await setDoc(
        doc(db, "users", currentUid, "staff_attendance", selectedDate),
        { date: selectedDate, records: updated, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      console.error("Error updating attendance:", err);
    }
  };

  const handleUpdateStaffTime = async (sId, field, val) => {
    if (!currentUid) return;
    const existing = attendanceRecords[sId] || { status: "present" };
    const updated = {
      ...attendanceRecords,
      [sId]: {
        ...existing,
        [field]: val,
        updatedAtMs: Date.now()
      }
    };
    setAttendanceRecords(updated);
    try {
      await setDoc(
        doc(db, "users", currentUid, "staff_attendance", selectedDate),
        { date: selectedDate, records: updated, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (err) {
      console.error("Error updating time:", err);
    }
  };

  const handleMarkAllPresent = async () => {
    if (!currentUid || staffList.length === 0) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const updated = { ...attendanceRecords };

    staffList.forEach((s) => {
      const sId = s.id || s.staffId;
      const existing = updated[sId] || {};
      updated[sId] = {
        ...existing,
        status: "present",
        inTime: existing.inTime || timeStr,
        notes: existing.notes || "On shift",
        updatedAtMs: Date.now()
      };
    });

    setAttendanceRecords(updated);
    try {
      await setDoc(
        doc(db, "users", currentUid, "staff_attendance", selectedDate),
        { date: selectedDate, records: updated, updatedAt: serverTimestamp() },
        { merge: true }
      );
      alert(`✅ Marked all ${staffList.length} staff as Present for ${selectedDate}!`);
    } catch (err) {
      alert("Error marking attendance: " + err.message);
    }
  };

  const handlePrevDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() - 1);
    setSelectedDate(cur.toISOString().slice(0, 10));
  };

  const handleNextDay = () => {
    const cur = new Date(selectedDate);
    cur.setDate(cur.getDate() + 1);
    setSelectedDate(cur.toISOString().slice(0, 10));
  };

  const handleExportAttendance = () => {
    if (staffList.length === 0) {
      alert("No staff members to export attendance for.");
      return;
    }

    const headers = ["Date", "Staff ID", "Staff Name", "Role", "Status", "Check-in Time", "Check-out Time", "Notes"];
    const rows = staffList.map((s) => {
      const sId = s.id || s.staffId;
      const rec = attendanceRecords[sId] || {};
      return [
        selectedDate,
        `"${sId}"`,
        `"${(s.name || "").replace(/"/g, '""')}"`,
        s.role || "staff",
        (rec.status || "not_marked").toUpperCase(),
        rec.inTime || "",
        rec.outTime || "",
        `"${(rec.notes || "").replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Staff_Attendance_${selectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (!currentUid) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "users", currentUid, "staffs"),
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        setStaffList(list);
        setLoading(false);
      },
      (err) => {
        console.error("Error fetching staff list:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUid]);

  const generateRandomPassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let pwd = "";
    for (let i = 0; i < 4; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd + Math.floor(10 + Math.random() * 89);
  };

  const generateAutoStaffId = (role = selectedRole) => {
    let prefix = "EMP";
    if (role === "waiter") prefix = "WTR";
    else if (role === "kitchen") prefix = "KIT";
    else if (role === "delivery") prefix = "DEL";

    const num = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${num}`;
  };

  const handleOpenAddModal = () => {
    setIsEditing(false);
    setEditId(null);
    setName("");
    setMobile("");
    setSelectedRole("waiter");
    setStaffId(generateAutoStaffId("waiter"));
    setPassword(generateRandomPassword());
    setShowPassword(false);
    setStatusMsg("");
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (staff) => {
    setIsEditing(true);
    setEditId(staff.id || staff.staffId);
    setName(staff.name || "");
    setMobile(staff.mobile || staff.phone || "");
    setSelectedRole(staff.role || "waiter");
    setStaffId(staff.staffId || staff.id);
    setPassword(staff.password || "");
    setShowPassword(false);
    setStatusMsg("");
    setIsModalOpen(true);
  };

  const handleSaveStaff = async (e) => {
    e.preventDefault();
    if (!currentUid) return;
    if (!name.trim()) {
      alert("Please enter staff member name.");
      return;
    }
    if (!staffId.trim() || !password.trim()) {
      alert("Staff ID and Password are required.");
      return;
    }

    setSaving(true);
    setStatusMsg("");

    try {
      const cleanStaffId = staffId.trim().toUpperCase();
      const staffPayload = {
        staffId: cleanStaffId,
        id: cleanStaffId,
        name: name.trim(),
        mobile: mobile.trim() || "",
        phone: mobile.trim() || "",
        role: selectedRole,
        password: password.trim(),
        masterUid: currentUid,
        ownerUid: currentUid,
        userId: currentUid,
        updatedAt: serverTimestamp(),
      };

      if (!isEditing) {
        staffPayload.createdAt = serverTimestamp();
      }

      // 1. Save to subcollection under master user
      await setDoc(doc(db, "users", currentUid, "staffs", cleanStaffId), staffPayload, { merge: true });

      // 2. Save / Mirror to root 'staffs' collection for quick Staff Login lookup
      await setDoc(doc(db, "staffs", cleanStaffId), staffPayload, { merge: true });

      setIsModalOpen(false);
      setSaving(false);

      if (!isEditing) {
        setCreatedStaffModal({
          staffId: cleanStaffId,
          password: password.trim(),
          name: name.trim(),
          role: selectedRole,
        });
      }
    } catch (err) {
      console.error("Error saving staff:", err);
      setSaving(false);
      alert("Failed to save staff account: " + err.message);
    }
  };

  const handleDeleteStaff = async (targetStaffId, staffName) => {
    if (!window.confirm(`Are you sure you want to delete staff account for "${staffName}" (${targetStaffId})?`)) {
      return;
    }

    try {
      if (currentUid) {
        await deleteDoc(doc(db, "users", currentUid, "staffs", targetStaffId));
      }
      try {
        await deleteDoc(doc(db, "staffs", targetStaffId));
      } catch (_) {}
    } catch (err) {
      alert("Error deleting staff: " + err.message);
    }
  };

  const copyCredentials = (sId, sPwd, sRole) => {
    const text = `🍽️ Staff Login Details:\n• Staff ID: ${sId}\n• Password: ${sPwd}\n• Role: ${sRole.toUpperCase()}\nLogin at your restaurant web portal.`;
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const attendanceStats = useMemo(() => {
    let present = 0;
    let halfDay = 0;
    let absent = 0;
    let leave = 0;

    staffList.forEach((s) => {
      const sId = s.id || s.staffId;
      const rec = attendanceRecords[sId];
      if (rec?.status === "present") present++;
      else if (rec?.status === "half_day") halfDay++;
      else if (rec?.status === "absent") absent++;
      else if (rec?.status === "leave") leave++;
    });

    const rate = staffList.length > 0 ? Math.round(((present + halfDay * 0.5) / staffList.length) * 100) : 0;
    return { present, halfDay, absent, leave, rate };
  }, [staffList, attendanceRecords]);

  return (
    <div style={styles.container}>
      {/* Top Header */}
      <div style={styles.headerRow}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn}>
              ← Back
            </button>
          )}
          <div>
            <h2 style={styles.pageTitle}>👥 Staff Accounts & Daily Attendance</h2>
            <p style={styles.pageSubtitle}>
              Manage staff permissions, roles, and track daily attendance (பணியாளர் வருகைப் பதிவு)
            </p>
          </div>
        </div>

        {activeSubTab === "accounts" ? (
          <button type="button" onClick={handleOpenAddModal} style={styles.addBtn}>
            + Create New Staff Account
          </button>
        ) : (
          <button type="button" onClick={handleMarkAllPresent} style={{ ...styles.addBtn, backgroundColor: "#16a34a" }}>
            ✅ Mark All Present
          </button>
        )}
      </div>

      {/* Sub Tabs Switcher: Accounts vs Attendance */}
      <div style={styles.subTabsRow}>
        <button
          type="button"
          onClick={() => setActiveSubTab("accounts")}
          style={{
            ...styles.subTabBtn,
            backgroundColor: activeSubTab === "accounts" ? "#0f172a" : "#ffffff",
            color: activeSubTab === "accounts" ? "#ffffff" : "#475569",
            borderColor: activeSubTab === "accounts" ? "#0f172a" : "#cbd5e1"
          }}
        >
          <span>👥</span>
          <span>Staff Accounts & Roles ({staffList.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab("attendance")}
          style={{
            ...styles.subTabBtn,
            backgroundColor: activeSubTab === "attendance" ? "#16a34a" : "#ffffff",
            color: activeSubTab === "attendance" ? "#ffffff" : "#475569",
            borderColor: activeSubTab === "attendance" ? "#16a34a" : "#cbd5e1"
          }}
        >
          <span>📅</span>
          <span>Daily Staff Attendance (வருகைப் பதிவு)</span>
          <span style={{
            fontSize: "11px",
            padding: "2px 7px",
            borderRadius: "10px",
            backgroundColor: activeSubTab === "attendance" ? "rgba(255,255,255,0.25)" : "#dcfce7",
            color: activeSubTab === "attendance" ? "#ffffff" : "#166534",
            fontWeight: "800"
          }}>
            {attendanceStats.present}/{staffList.length} Present
          </span>
        </button>
      </div>

      {activeSubTab === "accounts" && (
        <>
          {/* Role Quick Cards Summary */}
          <div style={styles.roleSummaryGrid}>
        {ROLE_OPTIONS.map((r) => {
          const count = staffList.filter((s) => s.role === r.id).length;
          return (
            <div key={r.id} style={{ ...styles.roleSummaryCard, borderColor: r.bgColor }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "24px" }}>{r.icon}</span>
                <span style={{ ...styles.countBadge, backgroundColor: r.bgColor, color: r.color }}>
                  {count} Active
                </span>
              </div>
              <div style={{ fontWeight: "800", fontSize: "14px", color: "#0f172a", marginTop: "8px" }}>
                {r.label}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", lineHeight: "1.3" }}>
                {r.desc}
              </div>
              {r.portalPath && (
                <a
                  href={r.portalPath}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: "11px",
                    fontWeight: "700",
                    color: r.color,
                    marginTop: "8px",
                    display: "inline-block",
                    textDecoration: "none",
                  }}
                >
                  Open {r.badge} View ↗
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Staff List Table */}
      <div style={styles.tableCard}>
        <div style={styles.tableCardHeader}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
            All Registered Staff ({staffList.length})
          </h3>
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            Staff members can login using their Staff ID and Password
          </span>
        </div>

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>Loading staff accounts...</div>
        ) : staffList.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
            <span style={{ fontSize: "36px", display: "block", marginBottom: "8px" }}>👥</span>
            <div style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a" }}>No staff accounts found</div>
            <p style={{ fontSize: "13px", margin: "4px 0 16px 0" }}>
              Add your waiters and kitchen cooks to start taking table KOT orders seamlessly.
            </p>
            <button type="button" onClick={handleOpenAddModal} style={styles.addBtn}>
              + Add First Staff Member
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thRow}>
                  <th style={styles.th}>Staff ID</th>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Role / Permission</th>
                  <th style={styles.th}>Contact</th>
                  <th style={styles.th}>Password</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((s, idx) => {
                  const roleObj = ROLE_OPTIONS.find((r) => r.id === s.role) || ROLE_OPTIONS[3];
                  return (
                    <tr key={s.id || idx} style={styles.tr}>
                      <td style={styles.td}>
                        <span style={styles.staffIdBadge}>{s.staffId || s.id}</span>
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontWeight: "700", color: "#0f172a", fontSize: "14px" }}>
                          {s.name || "Unnamed"}
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            ...styles.roleBadge,
                            backgroundColor: roleObj.bgColor,
                            color: roleObj.color,
                          }}
                        >
                          {roleObj.icon} {roleObj.label}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color: "#64748b", fontSize: "13px" }}>{s.mobile || s.phone || "—"}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={styles.passwordMask}>••••••••</span>
                        <button
                          type="button"
                          onClick={() => copyCredentials(s.staffId || s.id, s.password, s.role)}
                          style={styles.copyTinyBtn}
                          title="Copy login details"
                        >
                          📋 Copy
                        </button>
                      </td>
                      <td style={{ ...styles.td, textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(s)}
                            style={styles.editBtn}
                            title="Edit Staff"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStaff(s.id || s.staffId, s.name)}
                            style={styles.delBtn}
                            title="Delete Staff"
                          >
                            🗑️
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
      </>
      )}

      {/* ATTENDANCE SUB-TAB */}
      {activeSubTab === "attendance" && (
        <div>
          {/* Attendance Controls Bar */}
          <div style={styles.attControlsRow}>
            {/* Date Navigator */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={handlePrevDay} style={styles.dateNavBtn} title="Previous Day">
                ← Prev
              </button>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={styles.attDateInput}
              />
              <button type="button" onClick={handleNextDay} style={styles.dateNavBtn} title="Next Day">
                Next →
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
                style={{
                  ...styles.dateNavBtn,
                  backgroundColor: selectedDate === new Date().toISOString().slice(0, 10) ? "#0f172a" : "#f1f5f9",
                  color: selectedDate === new Date().toISOString().slice(0, 10) ? "#ffffff" : "#334155"
                }}
              >
                Today
              </button>
            </div>

            {/* Quick Actions */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" onClick={handleMarkAllPresent} style={styles.markAllBtn}>
                <span>✅</span>
                <span>Mark All Present</span>
              </button>
              <button type="button" onClick={() => window.print()} style={styles.attPrintBtn}>
                <span>🖨️</span>
                <span>Print Sheet</span>
              </button>
              <button type="button" onClick={handleExportAttendance} style={styles.attExportBtn}>
                <span>📥</span>
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Attendance Summary Stat Cards */}
          <div style={styles.attStatsGrid}>
            <div style={styles.attStatCard}>
              <div style={styles.attStatLabel}>Total Staff</div>
              <div style={{ fontSize: "22px", fontWeight: "900", color: "#0f172a" }}>{staffList.length}</div>
              <div style={styles.attStatSub}>Enrolled staff members</div>
            </div>
            <div style={{ ...styles.attStatCard, borderLeft: "4px solid #16a34a" }}>
              <div style={{ ...styles.attStatLabel, color: "#166534" }}>Present (வருகை)</div>
              <div style={{ fontSize: "22px", fontWeight: "900", color: "#16a34a" }}>{attendanceStats.present}</div>
              <div style={styles.attStatSub}>Full day on duty</div>
            </div>
            <div style={{ ...styles.attStatCard, borderLeft: "4px solid #f59e0b" }}>
              <div style={{ ...styles.attStatLabel, color: "#b45309" }}>Half Day (அரை நாள்)</div>
              <div style={{ fontSize: "22px", fontWeight: "900", color: "#f59e0b" }}>{attendanceStats.halfDay}</div>
              <div style={styles.attStatSub}>Half shift attended</div>
            </div>
            <div style={{ ...styles.attStatCard, borderLeft: "4px solid #ef4444" }}>
              <div style={{ ...styles.attStatLabel, color: "#991b1b" }}>Absent (வரவில்லை)</div>
              <div style={{ fontSize: "22px", fontWeight: "900", color: "#ef4444" }}>{attendanceStats.absent}</div>
              <div style={styles.attStatSub}>Did not report</div>
            </div>
            <div style={{ ...styles.attStatCard, borderLeft: "4px solid #6366f1" }}>
              <div style={{ ...styles.attStatLabel, color: "#4338ca" }}>On Leave (விடுப்பு)</div>
              <div style={{ fontSize: "22px", fontWeight: "900", color: "#6366f1" }}>{attendanceStats.leave}</div>
              <div style={styles.attStatSub}>Approved leave</div>
            </div>
            <div style={styles.attStatCard}>
              <div style={styles.attStatLabel}>Attendance Rate</div>
              <div style={{ fontSize: "22px", fontWeight: "900", color: attendanceStats.rate >= 80 ? "#16a34a" : "#ea580c" }}>
                {attendanceStats.rate}%
              </div>
              <div style={styles.attStatSub}>For {selectedDate}</div>
            </div>
          </div>

          {/* Attendance Table Card */}
          <div style={styles.tableCard}>
            <div style={styles.tableCardHeader}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>
                Daily Staff Attendance Log for {selectedDate}
              </h3>
              <span style={{ fontSize: "12px", color: "#64748b" }}>
                Click status button to mark staff attendance in real-time
              </span>
            </div>

            {staffList.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                No staff accounts added yet. Switch to "Staff Accounts & Roles" to add staff.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.thRow}>
                      <th style={styles.th}>Staff Member</th>
                      <th style={styles.th}>Role</th>
                      <th style={styles.th}>Attendance Status</th>
                      <th style={styles.th}>In Time</th>
                      <th style={styles.th}>Out Time</th>
                      <th style={styles.th}>Notes / Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffList.map((s, idx) => {
                      const sId = s.id || s.staffId;
                      const roleObj = ROLE_OPTIONS.find((r) => r.id === s.role) || ROLE_OPTIONS[3];
                      const rec = attendanceRecords[sId] || {};
                      const status = rec.status || "not_marked";

                      return (
                        <tr key={sId || idx} style={styles.tr}>
                          <td style={styles.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              <div style={{
                                width: "32px",
                                height: "32px",
                                borderRadius: "50%",
                                backgroundColor: roleObj.bgColor,
                                color: roleObj.color,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: "800",
                                fontSize: "13px"
                              }}>
                                {s.name ? s.name.charAt(0).toUpperCase() : "S"}
                              </div>
                              <div>
                                <div style={{ fontWeight: "700", color: "#0f172a", fontSize: "13.5px" }}>
                                  {s.name}
                                </div>
                                <div style={{ fontSize: "11px", color: "#64748b" }}>
                                  ID: {sId} {s.mobile ? `• ${s.mobile}` : ""}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td style={styles.td}>
                            <span style={{ ...styles.roleBadge, backgroundColor: roleObj.bgColor, color: roleObj.color }}>
                              {roleObj.icon} {roleObj.label}
                            </span>
                          </td>

                          <td style={styles.td}>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                type="button"
                                onClick={() => handleSetStaffStatus(sId, "present")}
                                style={{
                                  ...styles.statusBtn,
                                  backgroundColor: status === "present" ? "#16a34a" : "#f0fdf4",
                                  color: status === "present" ? "#ffffff" : "#166534",
                                  borderColor: status === "present" ? "#16a34a" : "#bbf7d0",
                                  fontWeight: status === "present" ? "800" : "600"
                                }}
                              >
                                🟢 Present
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetStaffStatus(sId, "half_day")}
                                style={{
                                  ...styles.statusBtn,
                                  backgroundColor: status === "half_day" ? "#f59e0b" : "#fffbeb",
                                  color: status === "half_day" ? "#ffffff" : "#b45309",
                                  borderColor: status === "half_day" ? "#f59e0b" : "#fde68a",
                                  fontWeight: status === "half_day" ? "800" : "600"
                                }}
                              >
                                🟡 Half Day
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetStaffStatus(sId, "absent")}
                                style={{
                                  ...styles.statusBtn,
                                  backgroundColor: status === "absent" ? "#ef4444" : "#fef2f2",
                                  color: status === "absent" ? "#ffffff" : "#991b1b",
                                  borderColor: status === "absent" ? "#ef4444" : "#fecaca",
                                  fontWeight: status === "absent" ? "800" : "600"
                                }}
                              >
                                🔴 Absent
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetStaffStatus(sId, "leave")}
                                style={{
                                  ...styles.statusBtn,
                                  backgroundColor: status === "leave" ? "#6366f1" : "#e0e7ff",
                                  color: status === "leave" ? "#ffffff" : "#4338ca",
                                  borderColor: status === "leave" ? "#6366f1" : "#c7d2fe",
                                  fontWeight: status === "leave" ? "800" : "600"
                                }}
                              >
                                🔵 Leave
                              </button>
                            </div>
                          </td>

                          <td style={styles.td}>
                            <input
                              type="text"
                              value={rec.inTime || ""}
                              onChange={(e) => handleUpdateStaffTime(sId, "inTime", e.target.value)}
                              placeholder="09:00 AM"
                              style={styles.timeInput}
                            />
                          </td>

                          <td style={styles.td}>
                            <input
                              type="text"
                              value={rec.outTime || ""}
                              onChange={(e) => handleUpdateStaffTime(sId, "outTime", e.target.value)}
                              placeholder="06:00 PM"
                              style={styles.timeInput}
                            />
                          </td>

                          <td style={styles.td}>
                            <input
                              type="text"
                              value={rec.notes || ""}
                              onChange={(e) => handleUpdateStaffTime(sId, "notes", e.target.value)}
                              placeholder="Remarks, shift notes..."
                              style={styles.notesInput}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE / EDIT STAFF MODAL */}
      {isModalOpen && (
        <div style={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
          <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "800", color: "#0f172a" }}>
                {isEditing ? "✏️ Edit Staff Account" : "➕ Create Staff Account"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ background: "transparent", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveStaff} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Role Selector Grid */}
              <div>
                <label style={styles.fieldLabel}>Select Role *</label>
                <div style={styles.rolePickerGrid}>
                  {ROLE_OPTIONS.map((r) => {
                    const isSelected = selectedRole === r.id;
                    return (
                      <div
                        key={r.id}
                        onClick={() => {
                          setSelectedRole(r.id);
                          if (!isEditing) {
                            setStaffId(generateAutoStaffId(r.id));
                          }
                        }}
                        style={{
                          ...styles.roleChoiceCard,
                          borderColor: isSelected ? r.color : "#e2e8f0",
                          backgroundColor: isSelected ? r.bgColor : "#ffffff",
                        }}
                      >
                        <span style={{ fontSize: "20px" }}>{r.icon}</span>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: isSelected ? r.color : "#334155" }}>
                          {r.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Name */}
              <div>
                <label style={styles.fieldLabel}>Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh Kumar"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={styles.modalInput}
                  required
                />
              </div>

              {/* Mobile */}
              <div>
                <label style={styles.fieldLabel}>Mobile Number (Optional)</label>
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  style={styles.modalInput}
                />
              </div>

              {/* Staff ID */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={styles.fieldLabel}>Staff Login ID *</label>
                  <button
                    type="button"
                    onClick={() => setStaffId(generateAutoStaffId(selectedRole))}
                    style={styles.genLinkBtn}
                  >
                    ⚡ Auto-Generate
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. WTR-101"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  style={styles.modalInput}
                  required
                />
              </div>

              {/* Password */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={styles.fieldLabel}>Password *</label>
                  <button
                    type="button"
                    onClick={() => setPassword(generateRandomPassword())}
                    style={styles.genLinkBtn}
                  >
                    🎲 Random Password
                  </button>
                </div>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...styles.modalInput, paddingRight: "44px" }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: "12px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    {showPassword ? "👁️" : "👁️‍🗨️"}
                  </button>
                </div>
              </div>

              <div style={styles.modalFooter}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={styles.cancelBtn}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" style={styles.submitBtn} disabled={saving}>
                  {saving ? "Saving..." : isEditing ? "Update Staff" : "Create Staff Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEWLY CREATED CREDENTIALS POPUP */}
      {createdStaffModal && (
        <div style={styles.modalOverlay} onClick={() => setCreatedStaffModal(null)}>
          <div style={{ ...styles.modalBox, maxWidth: "440px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.successIconCircle}>✓</div>
            <h3 style={{ margin: "10px 0 4px 0", fontSize: "19px", fontWeight: "800", color: "#0f172a" }}>
              Staff Account Created! 🎉
            </h3>
            <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
              Share these credentials with <strong>{createdStaffModal.name}</strong> to login.
            </p>

            <div style={styles.credCard}>
              <div style={styles.credRow}>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>STAFF LOGIN ID:</span>
                <span style={{ fontSize: "16px", fontWeight: "800", color: "#4f46e5" }}>
                  {createdStaffModal.staffId}
                </span>
              </div>
              <div style={styles.credRow}>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>PASSWORD:</span>
                <span style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                  {createdStaffModal.password}
                </span>
              </div>
              <div style={{ ...styles.credRow, borderBottom: "none" }}>
                <span style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>ROLE:</span>
                <span style={{ fontSize: "13px", fontWeight: "800", color: "#16a34a", textTransform: "uppercase" }}>
                  {createdStaffModal.role}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                onClick={() =>
                  copyCredentials(
                    createdStaffModal.staffId,
                    createdStaffModal.password,
                    createdStaffModal.role
                  )
                }
                style={{ ...styles.submitBtn, flex: 1, backgroundColor: copiedText ? "#16a34a" : "#4f46e5" }}
              >
                {copiedText ? "✓ Copied to Clipboard!" : "📋 Copy Login Details"}
              </button>
              <button
                type="button"
                onClick={() => setCreatedStaffModal(null)}
                style={{ ...styles.cancelBtn, flex: 0.8 }}
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
    padding: "24px",
    maxWidth: "1280px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    flexWrap: "wrap",
    gap: "12px",
  },
  backBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    border: "1.5px solid #cbd5e1",
    borderRadius: "10px",
    fontWeight: "700",
    fontSize: "13px",
    color: "#334155",
    cursor: "pointer",
  },
  pageTitle: {
    fontSize: "22px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "0 0 2px 0",
  },
  pageSubtitle: {
    fontSize: "13px",
    color: "#64748b",
    margin: 0,
  },
  addBtn: {
    padding: "10px 18px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: "10px",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(37, 99, 235, 0.25)",
  },
  roleSummaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "12px",
    marginBottom: "24px",
  },
  roleSummaryCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    padding: "16px",
    border: "1.5px solid #e2e8f0",
    boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
  },
  countBadge: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "3px 8px",
    borderRadius: "12px",
  },
  tableCard: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
    overflow: "hidden",
  },
  tableCardHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid #f1f5f9",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
  },
  thRow: {
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  },
  th: {
    padding: "12px 18px",
    fontSize: "12px",
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  tr: {
    borderBottom: "1px solid #f1f5f9",
    transition: "background 0.15s ease",
  },
  td: {
    padding: "14px 18px",
    fontSize: "13.5px",
    verticalAlign: "middle",
  },
  staffIdBadge: {
    backgroundColor: "#e0e7ff",
    color: "#4338ca",
    fontWeight: "800",
    padding: "3px 8px",
    borderRadius: "6px",
    fontSize: "12px",
    letterSpacing: "0.5px",
  },
  roleBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "3px 10px",
    borderRadius: "20px",
    fontSize: "11.5px",
    fontWeight: "700",
  },
  passwordMask: {
    color: "#94a3b8",
    fontSize: "12px",
    fontFamily: "monospace",
    marginRight: "8px",
  },
  copyTinyBtn: {
    background: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "2px 8px",
    fontSize: "11px",
    fontWeight: "600",
    cursor: "pointer",
    color: "#334155",
  },
  editBtn: {
    padding: "6px 10px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
    color: "#334155",
  },
  delBtn: {
    padding: "6px 10px",
    backgroundColor: "#fee2e2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    fontSize: "12px",
    cursor: "pointer",
    color: "#dc2626",
  },

  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999999,
    padding: "16px",
    boxSizing: "border-box",
  },
  modalBox: {
    backgroundColor: "#ffffff",
    borderRadius: "20px",
    padding: "24px",
    width: "100%",
    maxWidth: "520px",
    maxHeight: "90vh",
    overflowY: "auto",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
    boxSizing: "border-box",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  fieldLabel: {
    fontSize: "12.5px",
    fontWeight: "700",
    color: "#334155",
    marginBottom: "4px",
    display: "block",
  },
  modalInput: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: "10px",
    border: "1.5px solid #cbd5e1",
    fontSize: "14px",
    boxSizing: "border-box",
    outline: "none",
  },
  rolePickerGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px",
  },
  roleChoiceCard: {
    padding: "10px",
    borderRadius: "10px",
    border: "1.5px solid #e2e8f0",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.15s ease",
  },
  genLinkBtn: {
    background: "transparent",
    border: "none",
    color: "#4f46e5",
    fontSize: "11px",
    fontWeight: "700",
    cursor: "pointer",
    textDecoration: "underline",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "16px",
    borderTop: "1px solid #f1f5f9",
    paddingTop: "14px",
  },
  cancelBtn: {
    padding: "10px 18px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    color: "#475569",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
  },
  submitBtn: {
    padding: "10px 20px",
    backgroundColor: "#2563eb",
    border: "none",
    borderRadius: "10px",
    color: "#ffffff",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(37, 99, 235, 0.25)",
  },

  successIconCircle: {
    width: "56px",
    height: "56px",
    borderRadius: "28px",
    backgroundColor: "#dcfce7",
    color: "#16a34a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "28px",
    fontWeight: "bold",
    margin: "0 auto 12px auto",
  },
  credCard: {
    backgroundColor: "#f8fafc",
    border: "1.5px solid #e2e8f0",
    borderRadius: "12px",
    padding: "14px",
    textAlign: "left",
  },
  credRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid #e2e8f0",
  },
  subTabsRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "20px",
    flexWrap: "wrap",
  },
  subTabBtn: {
    padding: "9px 18px",
    borderRadius: "10px",
    border: "1.5px solid",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.15s ease",
  },
  attControlsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#ffffff",
    padding: "14px 18px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    marginBottom: "16px",
    flexWrap: "wrap",
    gap: "12px",
  },
  dateNavBtn: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#f1f5f9",
    color: "#334155",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer",
  },
  attDateInput: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "12.5px",
    fontWeight: "600",
    color: "#1e293b",
    outline: "none",
  },
  markAllBtn: {
    padding: "7px 14px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    fontSize: "12.5px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
  attPrintBtn: {
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontSize: "12.5px",
    fontWeight: "600",
    cursor: "pointer",
  },
  attExportBtn: {
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1px solid #c7d2fe",
    backgroundColor: "#eff6ff",
    color: "#4338ca",
    fontSize: "12.5px",
    fontWeight: "700",
    cursor: "pointer",
  },
  attStatsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "12px",
    marginBottom: "16px",
  },
  attStatCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "14px 16px",
    border: "1px solid #e2e8f0",
  },
  attStatLabel: {
    fontSize: "11px",
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: "4px",
  },
  attStatSub: {
    fontSize: "11px",
    color: "#94a3b8",
    marginTop: "2px",
  },
  statusBtn: {
    padding: "4px 9px",
    borderRadius: "6px",
    border: "1px solid",
    fontSize: "11.5px",
    cursor: "pointer",
    transition: "all 0.1s ease",
  },
  timeInput: {
    width: "85px",
    padding: "4px 8px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    fontSize: "11.5px",
    outline: "none",
    textAlign: "center",
  },
  notesInput: {
    width: "100%",
    minWidth: "120px",
    padding: "4px 8px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    fontSize: "11.5px",
    outline: "none",
  },
};
