import { useState, useEffect } from "react";
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

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

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
            <h2 style={styles.pageTitle}>👥 Staff Accounts & Permissions</h2>
            <p style={styles.pageSubtitle}>
              Create & manage accounts for Waiters, Kitchen Staff, Delivery Boys and Cashiers
            </p>
          </div>
        </div>

        <button type="button" onClick={handleOpenAddModal} style={styles.addBtn}>
          + Create New Staff Account
        </button>
      </div>

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
};
