import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import RoomManagement from "./RoomManagement";
import { auth, db } from "../../utils/firebase";
import { doc, getDoc } from "firebase/firestore";

export default function WardDashboard() {
  const navigate = useNavigate();
  const [storeName, setStoreName] = useState(() => localStorage.getItem("store_name") || "Medical Hospital");
  const [loading, setLoading] = useState(true);

  const masterUid = localStorage.getItem("uid") || auth.currentUser?.uid;
  const staffRole = (localStorage.getItem("staff_role") || "").toLowerCase();
  const isStaff = localStorage.getItem("is_staff") === "true";
  const staffName = localStorage.getItem("staff_name") || "Ward In-charge";
  const staffId = localStorage.getItem("staff_id") || "WARD-01";
  const isOwner = !isStaff;

  useEffect(() => {
    // 1. Role-based Guard: only Owner or Ward In-charge allowed
    if (!masterUid) {
      navigate("/login", { replace: true });
      return;
    }

    if (isStaff && staffRole !== "ward_incharge" && staffRole !== "ward-incharge" && staffRole !== "wardincharge") {
      alert("⚠️ Access Restricted: You do not have permission to access the Ward & Room Management module.");
      if (staffRole === "lab_technician") navigate("/lab", { replace: true });
      else if (staffRole === "pharmacist") navigate("/pharmacist", { replace: true });
      else navigate("/dashboard", { replace: true });
      return;
    }

    // 2. Fetch Store Profile if needed
    const fetchProfile = async () => {
      try {
        const uSnap = await getDoc(doc(db, "users", masterUid));
        if (uSnap.exists()) {
          const data = uSnap.data();
          const name = data.storeName || data.shopName || data.shop_name;
          if (name) {
            setStoreName(name);
            localStorage.setItem("store_name", name);
          }
        }
      } catch (err) {
        console.warn("Could not fetch store name:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [masterUid, isStaff, staffRole, navigate]);

  const handleLogout = () => {
    if (window.confirm("Exit Ward Management Portal?")) {
      localStorage.removeItem("staff_id");
      localStorage.removeItem("staff_name");
      localStorage.removeItem("staff_role");
      localStorage.removeItem("is_staff");
      localStorage.removeItem("uid");
      localStorage.removeItem("shop_type");
      localStorage.removeItem("store_name");
      navigate("/login", { replace: true });
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingWrapper}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "36px", marginBottom: "8px" }}>🏥</div>
          <div style={{ fontWeight: "700", color: "#334155" }}>Loading Ward & Room Portal...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Top Portal Banner */}
      <header style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <div style={styles.logoCircle}>🏥</div>
          <div>
            <div style={styles.storeTitle}>{storeName}</div>
            <div style={styles.portalSub}>
              Ward In-charge Service Portal • <span style={styles.staffBadge}>Staff ID: {staffId}</span>
            </div>
          </div>
        </div>

        <div style={styles.topBarRight}>
          <div style={styles.userBox}>
            <span style={{ fontSize: "14px" }}>👨‍⚕️</span>
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b" }}>{staffName}</span>
            <span style={styles.roleTag}>{isOwner ? "Owner (Full Access)" : "Ward In-charge"}</span>
          </div>

          {isOwner && (
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              style={styles.switchOwnerBtn}
              title="Return to Owner Main Dashboard"
            >
              🏪 Owner Dashboard
            </button>
          )}

          <button
            type="button"
            onClick={handleLogout}
            style={styles.logoutBtn}
            title="Log out of portal"
          >
            🚪 Exit Portal
          </button>
        </div>
      </header>

      {/* Embedded Room Management Module */}
      <main style={styles.mainContent}>
        <RoomManagement
          ownerUid={masterUid}
          isOwner={isOwner}
          onBack={isOwner ? () => navigate("/dashboard") : undefined}
        />
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  loadingWrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  topBar: {
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "12px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "12px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logoCircle: {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    backgroundColor: "#f3e8ff",
    color: "#7c3aed",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
  },
  storeTitle: {
    fontSize: "17px",
    fontWeight: "800",
    color: "#0f172a",
  },
  portalSub: {
    fontSize: "12px",
    color: "#64748b",
    marginTop: "2px",
  },
  staffBadge: {
    fontWeight: "700",
    color: "#7c3aed",
  },
  topBarRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  userBox: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: "#f1f5f9",
    padding: "6px 12px",
    borderRadius: "8px",
  },
  roleTag: {
    fontSize: "11px",
    fontWeight: "700",
    color: "#7c3aed",
    backgroundColor: "#f3e8ff",
    padding: "2px 6px",
    borderRadius: "4px",
    marginLeft: "4px",
  },
  switchOwnerBtn: {
    padding: "8px 14px",
    backgroundColor: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    color: "#334155",
    fontWeight: "600",
    fontSize: "12px",
    cursor: "pointer",
  },
  logoutBtn: {
    padding: "8px 14px",
    backgroundColor: "#fee2e2",
    border: "none",
    borderRadius: "8px",
    color: "#dc2626",
    fontWeight: "700",
    fontSize: "12px",
    cursor: "pointer",
  },
  mainContent: {
    flex: 1,
  },
};
