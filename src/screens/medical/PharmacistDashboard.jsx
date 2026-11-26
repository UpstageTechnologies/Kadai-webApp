import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Dashboard from "../Dashboard";

export default function PharmacistDashboard() {
  const navigate = useNavigate();
  const masterUid = localStorage.getItem("uid");
  const staffRole = (localStorage.getItem("staff_role") || "").toLowerCase();
  const isStaff = localStorage.getItem("is_staff") === "true";

  useEffect(() => {
    if (!masterUid) {
      navigate("/login", { replace: true });
      return;
    }

    // Role-based Guard: Only Owner or Pharmacist allowed
    if (isStaff && staffRole !== "pharmacist") {
      alert("⚠️ Access Restricted: You do not have permission to access the Pharmacist POS module.");
      if (staffRole === "ward_incharge") navigate("/ward", { replace: true });
      else if (staffRole === "lab_technician") navigate("/lab", { replace: true });
      else navigate("/dashboard", { replace: true });
    }
  }, [masterUid, isStaff, staffRole, navigate]);

  return <Dashboard key="pharmacist_portal" initialTab="sales" pharmacistMode={true} />;
}
