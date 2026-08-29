// src/screens/Settings.jsx
import React from "react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";

export default function Settings({ userProfile, setUserProfile, storeSettings, setStoreSettings, setPopupModal }) {
  const [savingSettings, setSavingSettings] = React.useState(false);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      setSavingSettings(true);
      const userDocRef = doc(db, "users", currentUid);
      await setDoc(userDocRef, { 
        storeName: userProfile.storeName,
        settings: storeSettings 
      }, { merge: true });
      setPopupModal({ show: true, message: "Settings Saved Successfully! ⚙️" });
    } catch (err) {
      alert("Error saving settings: " + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div style={{ padding: "40px", maxWidth: "700px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ backgroundColor: "#fff", borderRadius: "20px", padding: "30px", boxShadow: "0 4px 15px rgba(0,0,0,0.05)", border: "1px solid #e2e8f0" }}>
        <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", marginBottom: "6px" }}>⚙️ Store & Payment Settings</h2>
        <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>Configure your store name and payment methods for POS checkout and QR generation.</p>

        <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Store Name</label>
            <input 
              type="text" 
              value={userProfile.storeName} 
              onChange={(e) => setUserProfile({ ...userProfile, storeName: e.target.value })} 
              style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" }} 
              required 
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Your UPI ID (For QR Code Generation)</label>
            <input 
              type="text" 
              placeholder="e.g. yourname@okaxis" 
              value={storeSettings.upiId} 
              onChange={(e) => setStoreSettings({ ...storeSettings, upiId: e.target.value })} 
              style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px", outline: "none", width: "100%", boxSizing: "border-box" }} 
              required 
            />
            <small style={{ color: "#64748b", fontSize: "12px" }}>This UPI ID will automatically generate dynamic payment QR codes during checkout.</small>
          </div>

          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "10px", display: "block" }}>Enabled Payment Methods at POS</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>
                <input 
                  type="checkbox" 
                  checked={storeSettings.allowCash} 
                  onChange={(e) => setStoreSettings({ ...storeSettings, allowCash: e.target.checked })} 
                  style={{ width: "16px", height: "16px" }}
                />
                💵 Cash Payments
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>
                <input 
                  type="checkbox" 
                  checked={storeSettings.allowUpi} 
                  onChange={(e) => setStoreSettings({ ...storeSettings, allowUpi: e.target.checked })} 
                  style={{ width: "16px", height: "16px" }}
                />
                📱 UPI QR Code Payments
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>
                <input 
                  type="checkbox" 
                  checked={storeSettings.allowCard} 
                  onChange={(e) => setStoreSettings({ ...storeSettings, allowCard: e.target.checked })} 
                  style={{ width: "16px", height: "16px" }}
                />
                💳 Credit / Debit Card Payments
              </label>
            </div>
          </div>

          <div style={{ marginTop: "10px" }}>
            <button type="submit" disabled={savingSettings} style={{ padding: "12px 28px", backgroundColor: "#16a34a", color: "#fff", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer", fontSize: "15px" }}>
              {savingSettings ? "Saving..." : "Save Settings 💾"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}