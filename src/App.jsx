import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./utils/firebase";
import Login from "./screens/Login";
import Register from "./screens/Register";
import Dashboard from "./screens/Dashboard";
import WaiterOrder from "./screens/WaiterOrder";
import KitchenDisplay from "./screens/KitchenDisplay";
import PharmacistDashboard from "./screens/medical/PharmacistDashboard";
import WardDashboard from "./screens/medical/WardDashboard";
import LabDashboard from "./screens/medical/LabDashboard";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem("uid"));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        localStorage.setItem("uid", user.uid);
        setIsAuthenticated(true);
      } else {
        // If no user from Firebase Auth, keep authenticated if staff logged in with uid in localStorage
        if (localStorage.getItem("uid")) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const getHomeRedirect = () => {
    const staffRole = (localStorage.getItem("staff_role") || "").toLowerCase();
    if (staffRole === "waiter") return "/waiter";
    if (staffRole === "kitchen") return "/kitchen";
    if (staffRole === "pharmacist") return "/pharmacist";
    if (staffRole === "ward_incharge" || staffRole === "ward-incharge" || staffRole === "wardincharge") return "/ward";
    if (staffRole === "lab_technician" || staffRole === "lab-technician" || staffRole === "labtechnician") return "/lab";
    return "/dashboard";
  };

  if (loading && !localStorage.getItem("uid")) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", backgroundColor: "#0f172a", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "36px", marginBottom: "12px" }}>🏪</div>
          <div style={{ fontSize: "16px", fontWeight: "700" }}>Loading Kadai Pro...</div>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to={getHomeRedirect()} replace />} />
        <Route path="/register" element={!isAuthenticated ? <Register /> : <Navigate to={getHomeRedirect()} replace />} />
        <Route path="/dashboard" element={isAuthenticated ? <Dashboard key="dash" initialTab="sales" /> : <Navigate to="/login" replace />} />
        <Route path="/billing" element={isAuthenticated ? <Dashboard key="billing" initialTab="sales" /> : <Navigate to="/login" replace />} />
        <Route path="/subscription" element={isAuthenticated ? <Dashboard key="sub" initialTab="subscription" /> : <Navigate to="/login" replace />} />
        <Route path="/staff" element={isAuthenticated ? <Dashboard key="staff" initialTab="staff" /> : <Navigate to="/login" replace />} />
        <Route path="/recipes" element={isAuthenticated ? <Dashboard key="recipes" initialTab="recipes" /> : <Navigate to="/login" replace />} />
        <Route path="/waste" element={isAuthenticated ? <Dashboard key="waste" initialTab="waste" /> : <Navigate to="/login" replace />} />
        <Route path="/purchases" element={isAuthenticated ? <Dashboard key="purchases" initialTab="purchases" /> : <Navigate to="/login" replace />} />
        <Route path="/feedback" element={isAuthenticated ? <Dashboard key="feedback" initialTab="feedback" /> : <Navigate to="/login" replace />} />
        <Route path="/customers" element={isAuthenticated ? <Dashboard key="customers" initialTab="customers" /> : <Navigate to="/login" replace />} />
        <Route path="/branches" element={isAuthenticated ? <Dashboard key="branches" initialTab="branches" /> : <Navigate to="/login" replace />} />
        <Route path="/terminals" element={isAuthenticated ? <Dashboard key="terminals" initialTab="terminals" /> : <Navigate to="/login" replace />} />
        <Route path="/attendance" element={isAuthenticated ? <Dashboard key="attendance" initialTab="staff" /> : <Navigate to="/login" replace />} />
        <Route path="/rooms" element={isAuthenticated ? <Dashboard key="rooms" initialTab="rooms" /> : <Navigate to="/login" replace />} />
        <Route path="/lab-tests" element={isAuthenticated ? <Dashboard key="lab_tests" initialTab="lab" /> : <Navigate to="/login" replace />} />
        <Route path="/waiter" element={isAuthenticated ? <WaiterOrder /> : <Navigate to="/login" replace />} />
        <Route path="/kitchen" element={isAuthenticated ? <KitchenDisplay /> : <Navigate to="/login" replace />} />
        <Route path="/pharmacist" element={isAuthenticated ? <PharmacistDashboard /> : <Navigate to="/login" replace />} />
        <Route path="/ward" element={isAuthenticated ? <WardDashboard /> : <Navigate to="/login" replace />} />
        <Route path="/lab" element={isAuthenticated ? <LabDashboard /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? getHomeRedirect() : "/login"} replace />} />
      </Routes>
    </Router>
  );
}
