import React, { useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../utils/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate, Link } from "react-router-dom";

export default function Register() {
  const [shopName, setShopName] = useState("");
  const [shopType, setShopType] = useState("Store");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!shopName.trim()) {
      setError("Please enter your shop or restaurant name ⚠️");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters ⚠️");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = userCredential.user.uid;

      const trimmedName = shopName.trim();
      const sType = shopType.trim();

      await setDoc(doc(db, "users", uid), {
        shopName: trimmedName,
        shop_name: trimmedName,
        storeName: trimmedName,
        shopType: sType,
        shop_type: sType,
        businessType: sType,
        email: email.trim(),
        createdAt: serverTimestamp(),
        subscriptionPlan: "Free Trial",
        subscriptionExpiry: Date.now() + 7 * 24 * 60 * 60 * 1000
      });

      localStorage.setItem("uid", uid);
      localStorage.setItem("shop_type", sType);
      localStorage.setItem("store_name", trimmedName);

      window.location.href = "/dashboard";
    } catch (err) {
      console.error("Registration error:", err);
      if (err.code === "auth/email-already-in-use") {
        setError("Email already in use ❌");
      } else if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address ⚠️");
      } else if (err.code === "auth/weak-password") {
        setError("Password is too weak. Must be at least 6 characters ⚠️");
      } else {
        setError(err.message || "Failed to create account.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.headerContainer}>
          <div style={styles.iconCircle}>🚀</div>
          <h2 style={styles.title}>Create Shop Account</h2>
          <p style={styles.subtitle}>Get started with Kadai Pro Web</p>
        </div>

        <form onSubmit={handleRegister} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Shop / Restaurant Name</label>
            <input
              type="text"
              placeholder="e.g. Malabar Restaurant or Fresh Supermarket"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              style={styles.input}
              disabled={loading}
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Shop Type / வகை</label>
            <select
              value={shopType}
              onChange={(e) => setShopType(e.target.value)}
              style={{ ...styles.input, cursor: "pointer", backgroundColor: "#fff" }}
              disabled={loading}
            >
              <option value="Store">🏪 Store (General Retail)</option>
              <option value="Restaurant">🍽️ Restaurant (Food & Dining)</option>
              <option value="Super Market">🛒 Super Market</option>
              <option value="Factory">🏭 Factory</option>
              <option value="Medical">💊 Medical / Pharmacy</option>
              <option value="Other">🏢 Other</option>
            </select>
          </div>

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
                style={{
                  position: "absolute",
                  right: "12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "16px",
                  color: "#64748b",
                  padding: "4px"
                }}
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
            {loading ? "Creating Account..." : "Sign Up"}
          </button>

          {error && <div style={styles.errorBox}>{error}</div>}
        </form>

        <div style={styles.footerText}>
          Already have an account?{" "}
          <Link to="/login" style={styles.link}>
            Login here →
          </Link>
        </div>
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
    width: "100vw",
    backgroundColor: "#0f172a",
    backgroundImage: "radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 100%)",
    padding: "16px",
    boxSizing: "border-box",
  },
  card: {
    backgroundColor: "#ffffff",
    padding: "36px 28px",
    borderRadius: "24px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 10px 10px -5px rgba(0, 0, 0, 0.2)",
    width: "100%",
    maxWidth: "420px",
    boxSizing: "border-box",
  },
  headerContainer: {
    textAlign: "center",
    marginBottom: "24px",
  },
  iconCircle: {
    width: "52px",
    height: "52px",
    backgroundColor: "#eef2ff",
    borderRadius: "14px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: "24px",
    margin: "0 auto 12px auto",
  },
  title: {
    fontSize: "24px",
    color: "#1e3a8a",
    margin: "0 0 4px 0",
    fontWeight: "800",
  },
  subtitle: {
    color: "#64748b",
    margin: 0,
    fontSize: "13px",
    fontWeight: "500",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
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
    width: "100%",
    padding: "13px 15px",
    borderRadius: "12px",
    border: "1.5px solid #cbd5e1",
    fontSize: "14px",
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    boxSizing: "border-box",
    outline: "none",
  },
  button: {
    width: "100%",
    padding: "14px",
    backgroundColor: "#16a34a",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(22, 163, 74, 0.3)",
    marginTop: "6px",
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    padding: "10px",
    borderRadius: "8px",
    textAlign: "center",
    fontWeight: "600",
    fontSize: "12px",
    border: "1px solid #fee2e2",
  },
  footerText: {
    textAlign: "center",
    marginTop: "16px",
    fontSize: "13px",
    color: "#64748b",
    fontWeight: "500",
  },
  link: {
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: "700",
    cursor: "pointer",
  }
};