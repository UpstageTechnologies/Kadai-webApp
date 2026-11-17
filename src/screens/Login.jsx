import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, collection, getDocs, query, where, updateDoc } from "firebase/firestore";
import { auth, db } from "../utils/firebase";
import { Link } from "react-router-dom";

export default function Login() {
  const [loginType, setLoginType] = useState("owner"); // "owner" | "staff"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [staffId, setStaffId] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Store Owner Login via Firebase Auth
  const handleOwnerLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid = userCredential.user.uid;

      localStorage.setItem("uid", uid);
      localStorage.removeItem("is_staff");
      localStorage.removeItem("staff_id");
      localStorage.removeItem("staff_name");
      localStorage.removeItem("staff_role");

      // Pre-fetch user document to cache shop_type and storeName for seamless dashboard loading
      try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          const sType = (data.shopType || data.shop_type || data.businessType || "").trim();
          const sName = data.storeName || data.shopName || data.shop_name || "Kadai Pro Store";
          if (sType) {
            localStorage.setItem("shop_type", sType);
          }
          if (sName) {
            localStorage.setItem("store_name", sName);
          }
        }
      } catch (cacheErr) {
        console.warn("User profile pre-cache skipped:", cacheErr);
      }
      
      // Force reload and redirect to dashboard
      window.location.href = "/dashboard";
    } catch (err) {
      console.log("Firebase Login Error Code:", err.code);
      console.log("Firebase Login Error Message:", err.message);
      
      if (
        err.code === "auth/invalid-credential" || 
        err.code === "auth/wrong-password" || 
        err.code === "auth/user-not-found"
      ) {
        setError("Incorrect email or password ❌");
      } else if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address ⚠️");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many failed attempts. Please try again later ⏳");
      } else if (err.code === "auth/network-request-failed") {
        setError("Network error. Please check your internet connection 🌐");
      } else {
        setError(err.message || "Failed to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Staff Login (Waiter, Kitchen, Delivery, General Staff)
  const handleStaffLogin = async (e) => {
    e.preventDefault();
    setError("");
    const trimmedId = staffId.trim().toUpperCase();
    if (!trimmedId || !password) {
      setError("Please enter your Staff ID and Password ⚠️");
      return;
    }

    setLoading(true);
    try {
      // 1. Direct lookup by Staff ID (uppercase)
      let staffDocRef = doc(db, "staffs", trimmedId);
      let staffSnap = await getDoc(staffDocRef);
      let staffData = null;

      if (staffSnap.exists()) {
        staffData = staffSnap.data();
      } else {
        // Also check original case
        const originalRef = doc(db, "staffs", staffId.trim());
        const originalSnap = await getDoc(originalRef);
        if (originalSnap.exists()) {
          staffDocRef = originalRef;
          staffData = originalSnap.data();
        } else {
          // Query by staffId field in root staffs collection
          const q = query(collection(db, "staffs"), where("staffId", "in", [trimmedId, staffId.trim()]));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            staffDocRef = qSnap.docs[0].ref;
            staffData = qSnap.docs[0].data();
          }
        }
      }

      if (!staffData) {
        setError("Staff ID not found. Please verify with your store manager ❌");
        setLoading(false);
        return;
      }

      if (String(staffData.password).trim() !== String(password).trim()) {
        setError("Incorrect staff password. Please try again ❌");
        setLoading(false);
        return;
      }

      const staffRole = (staffData.role || "employee").toLowerCase();
      let masterUid = staffData.masterUid || staffData.ownerUid || staffData.userId || staffData.uid || "";

      // Auto-heal masterUid if missing from root doc (searches users/{uDoc}/staffs/{id})
      if (!masterUid) {
        try {
          const usersSnap = await getDocs(collection(db, "users"));
          for (const uDoc of usersSnap.docs) {
            const subStaffSnap = await getDoc(doc(db, "users", uDoc.id, "staffs", trimmedId));
            if (subStaffSnap.exists()) {
              masterUid = uDoc.id;
              try {
                await updateDoc(staffDocRef, { masterUid: uDoc.id });
              } catch (_) {}
              break;
            }
          }
        } catch (healErr) {
          console.warn("Auto-heal masterUid error:", healErr);
        }
      }

      if (!masterUid) {
        setError("Unable to find restaurant store link for this staff. Please ask manager to re-save account.");
        setLoading(false);
        return;
      }

      // Save staff session in localStorage
      localStorage.setItem("uid", masterUid);
      localStorage.setItem("staff_id", staffData.staffId || trimmedId);
      localStorage.setItem("staff_name", staffData.name || "Staff Member");
      localStorage.setItem("staff_role", staffRole);
      localStorage.setItem("is_staff", "true");

      // Pre-fetch store profile to set shop_type and store_name
      try {
        const uSnap = await getDoc(doc(db, "users", masterUid));
        if (uSnap.exists()) {
          const uData = uSnap.data();
          const sType = (uData.shopType || uData.shop_type || uData.businessType || "restaurant").trim();
          const sName = uData.storeName || uData.shopName || uData.shop_name || "Restaurant Store";
          localStorage.setItem("shop_type", sType);
          localStorage.setItem("store_name", sName);
        }
      } catch (uErr) {
        console.warn("Store profile read notice:", uErr);
      }

      // Dynamic role-based redirection
      if (staffRole === "waiter") {
        window.location.href = "/waiter";
      } else if (staffRole === "kitchen") {
        window.location.href = "/kitchen";
      } else {
        window.location.href = "/dashboard";
      }
    } catch (err) {
      console.error("Staff Login Error:", err);
      setError(err.message || "Failed to sign in staff account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.headerContainer}>
          <div style={styles.iconCircle}>
            {loginType === "owner" ? "🏪" : "👨‍🍳"}
          </div>
          <h2 style={styles.title}>Kadai Pro Web</h2>
          <p style={styles.subtitle}>
            {loginType === "owner"
              ? "Sign in to manage your shop, restaurant & inventory"
              : "Staff portal: Waiter orders, Kitchen KOT & Delivery"}
          </p>
        </div>

        {/* LOGIN TYPE TABS */}
        <div style={styles.tabContainer}>
          <button
            type="button"
            onClick={() => {
              setLoginType("owner");
              setError("");
            }}
            style={{
              ...styles.tabButton,
              ...(loginType === "owner" ? styles.tabButtonActive : styles.tabButtonInactive),
            }}
          >
            🏪 Store Owner
          </button>
          <button
            type="button"
            onClick={() => {
              setLoginType("staff");
              setError("");
            }}
            style={{
              ...styles.tabButton,
              ...(loginType === "staff" ? styles.tabButtonActive : styles.tabButtonInactive),
            }}
          >
            👥 Staff Login
          </button>
        </div>

        {/* OWNER FORM */}
        {loginType === "owner" ? (
          <form onSubmit={handleOwnerLogin} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                disabled={loading}
                required
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Password</label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...styles.input, paddingRight: "42px" }}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  tabIndex={-1}
                >
                  {showPassword ? "👁️" : "👁️‍🗨️"}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              style={{ ...styles.button, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }} 
              disabled={loading}
            >
              {loading ? "Signing in..." : "Login as Owner"}
            </button>

            {error && <div style={styles.errorBox}>{error}</div>}
          </form>
        ) : (
          /* STAFF FORM */
          <form onSubmit={handleStaffLogin} style={styles.form}>
            <div style={styles.staffNotice}>
              ℹ️ Waiters, Kitchen Chefs & Store Staff: Enter your assigned Staff ID (e.g. <b>WTR-01</b>, <b>KIT-01</b>).
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Staff ID</label>
              <input
                type="text"
                placeholder="e.g. WTR-01 / KIT-01"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                style={{ ...styles.input, textTransform: "uppercase", fontWeight: "700", letterSpacing: "1px" }}
                disabled={loading}
                required
                autoCapitalize="characters"
              />
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Staff Password</label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...styles.input, paddingRight: "42px" }}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  tabIndex={-1}
                >
                  {showPassword ? "👁️" : "👁️‍🗨️"}
                </button>
              </div>
            </div>

            <button 
              type="submit" 
              style={{
                ...styles.button,
                backgroundColor: "#0284c7",
                boxShadow: "0 4px 12px rgba(2, 132, 199, 0.3)",
                opacity: loading ? 0.7 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }} 
              disabled={loading}
            >
              {loading ? "Verifying Staff..." : "Login as Staff →"}
            </button>

            {error && <div style={styles.errorBox}>{error}</div>}
          </form>
        )}

        {loginType === "owner" && (
          <div style={styles.footerText}>
            Don't have an account? <Link to="/register" style={styles.link}>Register here →</Link>
          </div>
        )}

        {loginType === "staff" && (
          <div style={styles.footerText}>
            Need staff credentials? <span style={{ color: "#0f172a", fontWeight: "600" }}>Contact your restaurant owner.</span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    width: "100%",
    backgroundColor: "#0f172a",
    backgroundImage: "radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 100%)",
    margin: 0,
    padding: "20px",
    boxSizing: "border-box",
  },
  card: {
    backgroundColor: "#ffffff",
    padding: "36px 30px",
    borderRadius: "24px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)",
    width: "100%",
    maxWidth: "440px",
    boxSizing: "border-box",
  },
  headerContainer: {
    textAlign: "center",
    marginBottom: "20px",
  },
  iconCircle: {
    width: "56px",
    height: "56px",
    backgroundColor: "#eef2ff",
    borderRadius: "16px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "28px",
    margin: "0 auto 12px auto",
  },
  title: {
    fontSize: "24px",
    color: "#1e3a8a",
    margin: "0 0 6px 0",
    fontWeight: "800",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    color: "#64748b",
    margin: 0,
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.4",
  },
  tabContainer: {
    display: "flex",
    backgroundColor: "#f1f5f9",
    padding: "4px",
    borderRadius: "14px",
    marginBottom: "20px",
    gap: "4px",
  },
  tabButton: {
    flex: 1,
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: "700",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  tabButtonActive: {
    backgroundColor: "#ffffff",
    color: "#1e293b",
    boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
  },
  tabButtonInactive: {
    backgroundColor: "transparent",
    color: "#64748b",
  },
  staffNotice: {
    backgroundColor: "#f0f9ff",
    border: "1px solid #bae6fd",
    color: "#0369a1",
    padding: "10px 12px",
    borderRadius: "10px",
    fontSize: "12px",
    lineHeight: "1.4",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "13px",
    fontWeight: "700",
    color: "#334155",
  },
  input: {
    width: "100%",
    padding: "13px 14px",
    borderRadius: "12px",
    border: "1.5px solid #cbd5e1",
    fontSize: "14px",
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    boxSizing: "border-box",
    outline: "none",
  },
  eyeButton: {
    position: "absolute",
    right: "12px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "16px",
    color: "#64748b",
    padding: "4px",
  },
  button: {
    width: "100%",
    padding: "14px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
    marginTop: "6px",
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    padding: "12px",
    borderRadius: "10px",
    textAlign: "center",
    fontWeight: "600",
    fontSize: "13px",
    border: "1px solid #fee2e2",
  },
  footerText: {
    textAlign: "center",
    marginTop: "18px",
    fontSize: "13px",
    color: "#64748b",
    fontWeight: "500",
  },
  link: {
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: "700",
  },
};
