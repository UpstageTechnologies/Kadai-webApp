import { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "firebase/firestore";
import { db, auth } from "../utils/firebase";

export default function BranchManagement({
  userProfile = {},
  activeBranchId,
  onSelectBranch,
  onBack
}) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [managerName, setManagerName] = useState("");
  const [saving, setSaving] = useState(false);

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
  const storeName = userProfile.storeName || "My Store";

  // Listen to branches in Firestore
  useEffect(() => {
    if (!currentUid) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "users", currentUid, "branches"),
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }));

        // If no branch exists yet, initialize a default Main Branch
        if (list.length === 0) {
          const defaultBranch = {
            id: "main_default",
            name: `${storeName} - Main Branch`,
            code: "BR-01",
            address: "Main Store Location",
            phone: userProfile.mobile || "",
            managerName: userProfile.name || "Owner",
            isPrimary: true,
            status: "active"
          };
          setBranches([defaultBranch]);
        } else {
          setBranches(list);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Error loading branches:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUid, storeName, userProfile]);

  const openCreateModal = () => {
    setEditingBranch(null);
    setBranchName("");
    const nextNum = branches.length + 1;
    setBranchCode(`BR-0${nextNum}`);
    setAddress("");
    setPhone("");
    setManagerName("");
    setIsModalOpen(true);
  };

  const openEditModal = (b) => {
    setEditingBranch(b);
    setBranchName(b.name || "");
    setBranchCode(b.code || "");
    setAddress(b.address || "");
    setPhone(b.phone || "");
    setManagerName(b.managerName || "");
    setIsModalOpen(true);
  };

  const handleSaveBranch = async (e) => {
    e.preventDefault();
    if (!branchName.trim()) {
      alert("Please enter branch name.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: branchName.trim(),
        code: branchCode.trim() || `BR-${Math.floor(10 + Math.random() * 90)}`,
        address: address.trim(),
        phone: phone.trim(),
        managerName: managerName.trim(),
        status: "active",
        updatedAt: serverTimestamp()
      };

      if (editingBranch && editingBranch.id !== "main_default") {
        await updateDoc(doc(db, "users", currentUid, "branches", editingBranch.id), payload);
        alert(`✅ Branch "${payload.name}" updated successfully!`);
      } else {
        payload.createdAt = serverTimestamp();
        payload.isPrimary = branches.length === 0;
        const newRef = await addDoc(collection(db, "users", currentUid, "branches"), payload);
        alert(`✅ New Branch "${payload.name}" created successfully!`);
        if (onSelectBranch) {
          onSelectBranch(newRef.id, payload.name);
        }
      }

      setIsModalOpen(false);
    } catch (err) {
      console.error("Save branch error:", err);
      alert("Error saving branch: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBranch = async (b) => {
    if (b.isPrimary) {
      alert("Cannot delete the primary/main branch.");
      return;
    }
    if (!confirm(`Are you sure you want to delete branch "${b.name}"?`)) return;

    try {
      await deleteDoc(doc(db, "users", currentUid, "branches", b.id));
      if (activeBranchId === b.id && onSelectBranch) {
        const remaining = branches.filter((item) => item.id !== b.id);
        if (remaining.length > 0) {
          onSelectBranch(remaining[0].id, remaining[0].name);
        }
      }
      alert("Branch removed successfully.");
    } catch (err) {
      alert("Error deleting branch: " + err.message);
    }
  };

  return (
    <div style={styles.container}>
      {/* Top Header */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn}>
              ← Back
            </button>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>🏢</span>
              <h1 style={styles.title}>Multi-Store & Branch Management</h1>
              <span style={styles.countBadge}>{branches.length} Branches</span>
            </div>
            <p style={styles.subtitle}>
              Manage multiple shop outlets, restaurant branches, and locations from a single dashboard
            </p>
          </div>
        </div>

        <button type="button" onClick={openCreateModal} style={styles.addBtn}>
          <span style={{ fontSize: "15px" }}>➕</span>
          <span>Add New Branch</span>
        </button>
      </div>

      {/* Active Branch Highlight Banner */}
      <div style={styles.activeBranchBanner}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={styles.activeIconBox}>📍</div>
          <div>
            <div style={{ fontSize: "11px", fontWeight: "800", color: "#166534", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Currently Active Branch (தற்போதைய கிளை)
            </div>
            <div style={{ fontSize: "17px", fontWeight: "900", color: "#0f172a", marginTop: "2px" }}>
              {branches.find((b) => b.id === activeBranchId)?.name || branches[0]?.name || `${storeName} - Main Branch`}
            </div>
            <div style={{ fontSize: "12px", color: "#475569", marginTop: "2px" }}>
              Billing, orders, attendance, and stock records will be tagged to this selected branch.
            </div>
          </div>
        </div>
      </div>

      {/* Branches Grid */}
      <div style={styles.grid}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#64748b", gridColumn: "1 / -1" }}>
            Loading store branches...
          </div>
        ) : branches.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#64748b", gridColumn: "1 / -1", backgroundColor: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>🏪</div>
            <div style={{ fontWeight: "800", fontSize: "16px", color: "#334155" }}>No Branches Configured Yet</div>
            <p style={{ fontSize: "13px", color: "#64748b", maxWidth: "400px", margin: "6px auto 16px" }}>
              Create your branches to track sales and inventory across different store outlets.
            </p>
            <button type="button" onClick={openCreateModal} style={styles.addBtn}>
              + Add First Branch
            </button>
          </div>
        ) : (
          branches.map((b) => {
            const isActive = (activeBranchId && activeBranchId === b.id) || (!activeBranchId && b.isPrimary);

            return (
              <div
                key={b.id}
                style={{
                  ...styles.branchCard,
                  borderColor: isActive ? "#16a34a" : "#e2e8f0",
                  boxShadow: isActive ? "0 4px 14px rgba(22, 163, 74, 0.15)" : "0 1px 3px rgba(0,0,0,0.03)"
                }}
              >
                {/* Card Header */}
                <div style={styles.cardHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "10px",
                      backgroundColor: isActive ? "#dcfce7" : "#f1f5f9",
                      color: isActive ? "#16a34a" : "#475569",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "18px"
                    }}>
                      🏪
                    </div>
                    <div>
                      <h3 style={styles.branchName}>{b.name}</h3>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "2px" }}>
                        <span style={styles.codeBadge}>{b.code || "BR-01"}</span>
                        {b.isPrimary && <span style={styles.primaryBadge}>Primary Outlet</span>}
                      </div>
                    </div>
                  </div>

                  {isActive ? (
                    <span style={styles.activePill}>Active Now ✓</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectBranch && onSelectBranch(b.id, b.name)}
                      style={styles.switchBtn}
                      title="Switch active store session to this branch"
                    >
                      Switch Here →
                    </button>
                  )}
                </div>

                {/* Details */}
                <div style={styles.cardBody}>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>📍 Location:</span>
                    <span style={styles.detailVal}>{b.address || "Address not specified"}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>📞 Contact:</span>
                    <span style={styles.detailVal}>{b.phone || "No phone added"}</span>
                  </div>
                  <div style={styles.detailRow}>
                    <span style={styles.detailLabel}>👤 Manager:</span>
                    <span style={styles.detailVal}>{b.managerName || "Store Owner"}</span>
                  </div>
                </div>

                {/* Footer Actions */}
                <div style={styles.cardFooter}>
                  <button
                    type="button"
                    onClick={() => openEditModal(b)}
                    style={styles.actionBtnEdit}
                  >
                    ✏️ Edit Details
                  </button>
                  {!b.isPrimary && (
                    <button
                      type="button"
                      onClick={() => handleDeleteBranch(b)}
                      style={styles.actionBtnDelete}
                    >
                      🗑️ Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* CREATE / EDIT BRANCH MODAL */}
      {isModalOpen && (
        <div style={styles.modalOverlay} onClick={() => !saving && setIsModalOpen(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: "800", color: "#0f172a" }}>
                  {editingBranch ? "Edit Branch Details" : "Add New Store / Branch Outlet"}
                </h3>
                <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                  Configure outlet name, code, contact details and manager in-charge
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={styles.closeBtn}
                disabled={saving}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBranch} style={{ padding: "20px" }}>
              <div style={{ marginBottom: "14px" }}>
                <label style={styles.modalLabel}>Branch / Outlet Name *</label>
                <input
                  type="text"
                  required
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g. Turf Cafe - Anna Nagar Branch, Express Outlet"
                  style={styles.modalInput}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Branch Code</label>
                  <input
                    type="text"
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                    placeholder="e.g. BR-02, ANNA-01"
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Contact Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +91 9876543210"
                    style={styles.modalInput}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={styles.modalLabel}>Outlet Address / Street Location</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. No. 45, 2nd Avenue, Anna Nagar East, Chennai"
                  style={styles.modalInput}
                />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={styles.modalLabel}>Branch Manager / Person In-Charge</label>
                <input
                  type="text"
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  style={styles.modalInput}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={saving}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={styles.saveBtn}
                >
                  {saving ? "Saving..." : editingBranch ? "Update Branch" : "Create Branch Outlet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "24px",
    maxWidth: "1400px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "system-ui, -apple-system, sans-serif"
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    flexWrap: "wrap",
    gap: "14px"
  },
  backBtn: {
    padding: "7px 12px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer"
  },
  title: {
    fontSize: "20px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0
  },
  subtitle: {
    fontSize: "12.5px",
    color: "#64748b",
    margin: "4px 0 0"
  },
  countBadge: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "8px",
    backgroundColor: "#e0f2fe",
    color: "#0369a1",
    border: "1px solid #bae6fd"
  },
  addBtn: {
    padding: "8px 16px",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)"
  },
  activeBranchBanner: {
    backgroundColor: "#f0fdf4",
    border: "1.5px solid #bbf7d0",
    borderRadius: "12px",
    padding: "16px 20px",
    marginBottom: "20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  activeIconBox: {
    width: "42px",
    height: "42px",
    borderRadius: "10px",
    backgroundColor: "#16a34a",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "18px"
  },
  branchCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    border: "1.5px solid #e2e8f0",
    padding: "18px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    transition: "all 0.15s ease"
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "14px"
  },
  branchName: {
    fontSize: "15px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0
  },
  codeBadge: {
    fontSize: "10px",
    fontWeight: "800",
    padding: "1px 6px",
    borderRadius: "4px",
    backgroundColor: "#f1f5f9",
    color: "#475569"
  },
  primaryBadge: {
    fontSize: "10px",
    fontWeight: "800",
    padding: "1px 6px",
    borderRadius: "4px",
    backgroundColor: "#fef3c7",
    color: "#b45309"
  },
  activePill: {
    fontSize: "11px",
    fontWeight: "800",
    padding: "3px 9px",
    borderRadius: "12px",
    backgroundColor: "#16a34a",
    color: "#ffffff"
  },
  switchBtn: {
    fontSize: "11.5px",
    fontWeight: "700",
    padding: "4px 10px",
    borderRadius: "6px",
    backgroundColor: "#f8fafc",
    border: "1px solid #cbd5e1",
    color: "#334155",
    cursor: "pointer"
  },
  cardBody: {
    borderTop: "1px solid #f1f5f9",
    paddingTop: "12px",
    marginBottom: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  detailRow: {
    display: "flex",
    fontSize: "12.5px"
  },
  detailLabel: {
    color: "#64748b",
    width: "80px",
    fontWeight: "600",
    flexShrink: 0
  },
  detailVal: {
    color: "#1e293b",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis"
  },
  cardFooter: {
    borderTop: "1px solid #f1f5f9",
    paddingTop: "12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  actionBtnEdit: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #cbd5e1",
    backgroundColor: "#ffffff",
    color: "#334155",
    fontSize: "11.5px",
    fontWeight: "600",
    cursor: "pointer"
  },
  actionBtnDelete: {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #fecaca",
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    fontSize: "11.5px",
    fontWeight: "600",
    cursor: "pointer"
  },
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
    maxWidth: "500px",
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
    overflow: "hidden"
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
  cancelBtn: {
    padding: "8px 16px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    color: "#475569",
    cursor: "pointer"
  },
  saveBtn: {
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
