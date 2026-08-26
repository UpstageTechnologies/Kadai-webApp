// src/screens/Login.jsx
import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../utils/firebase";
import { Link } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const uid = userCredential.user.uid;

      localStorage.setItem("uid", uid);
      
      // Force reload and redirect to dashboard
      window.location.href = "/dashboard";
    } catch (err) {
      console.log("Firebase Login Error Code:", err.code);
      console.log("Firebase Login Error Message:", err.message);
      
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
        setError("Incorrect email or password ❌");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.headerContainer}>
          <div style={styles.iconCircle}>🏪</div>
          <h2 style={styles.title}>Kadai Pro Web</h2>
          <p style={styles.subtitle}>Sign in to manage your shop & inventory</p>
        </div>

        <form onSubmit={handleLogin} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              required
            />
          </div>

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Signing in..." : "Login to Dashboard"}
          </button>

          {error && <div style={styles.errorBox}>{error}</div>}
        </form>

        <div style={styles.footerText}>
          Don't have an account? <Link to="/register" style={styles.link}>Register here →</Link>
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
    width: "100%",
    backgroundColor: "#0f172a",
    backgroundImage: "radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 100%)",
    margin: 0,
    padding: "20px",
    boxSizing: "border-box",
  },
  card: {
    backgroundColor: "#ffffff",
    padding: "40px 32px",
    borderRadius: "24px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)",
    width: "100%",
    maxWidth: "440px",
    boxSizing: "border-box",
  },
  headerContainer: {
    textAlign: "center",
    marginBottom: "28px",
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
    margin: "0 auto 16px auto",
  },
  title: {
    fontSize: "26px",
    color: "#1e3a8a",
    margin: "0 0 6px 0",
    fontWeight: "800",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    color: "#64748b",
    margin: 0,
    fontSize: "14px",
    fontWeight: "500",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
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
    padding: "14px 16px",
    borderRadius: "12px",
    border: "1.5px solid #cbd5e1",
    fontSize: "15px",
    backgroundColor: "#f8fafc",
    color: "#0f172a",
    boxSizing: "border-box",
    outline: "none",
  },
  button: {
    width: "100%",
    padding: "15px",
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "12px",
    fontSize: "16px",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
    marginTop: "8px",
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
  }
};