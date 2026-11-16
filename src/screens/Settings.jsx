// src/screens/Settings.jsx
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import PrintSettings from "../components/PrintSettings";
import { normalizePrintSettings } from "../utils/printEngine";

export default function Settings({
  userProfile,
  setUserProfile,
  storeSettings,
  setStoreSettings,
  printSettings,
  setPrintSettings,
  setPopupModal,
}) {
  const [activeSection, setActiveSection] = useState("store"); // "store" | "print"
  const [savingSettings, setSavingSettings] = useState(false);

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      setSavingSettings(true);
      const userDocRef = doc(db, "users", currentUid);
      const normalizedPrint = normalizePrintSettings(printSettings);

      await setDoc(
        userDocRef,
        {
          storeName: userProfile.storeName,
          settings: {
            ...storeSettings,
            print: normalizedPrint,
          },
          printSettings: normalizedPrint,
        },
        { merge: true }
      );

      // Cache locally for instant loading
      try {
        localStorage.setItem(`kadai_print_settings_${currentUid}`, JSON.stringify(normalizedPrint));
      } catch (storageErr) {
        console.warn("Could not cache print settings locally:", storageErr);
      }

      setPopupModal({ show: true, message: "Settings Saved Successfully! ⚙️" });
    } catch (err) {
      alert("Error saving settings: " + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div
      style={{
        padding: "30px 24px",
        maxWidth: activeSection === "print" ? "1280px" : "720px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        transition: "max-width 0.2s ease-in-out",
      }}
    >
      {/* Top Tab Bar Switcher */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "20px",
          backgroundColor: "#e2e8f0",
          padding: "5px",
          borderRadius: "12px",
          width: "fit-content",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSection("store")}
          style={{
            padding: "8px 18px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: activeSection === "store" ? "#ffffff" : "transparent",
            color: activeSection === "store" ? "#0f172a" : "#64748b",
            fontWeight: "700",
            fontSize: "13px",
            cursor: "pointer",
            boxShadow: activeSection === "store" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>🏪</span>
          <span>Store & Payments</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("print")}
          style={{
            padding: "8px 18px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: activeSection === "print" ? "#ffffff" : "transparent",
            color: activeSection === "print" ? "#0f172a" : "#64748b",
            fontWeight: "700",
            fontSize: "13px",
            cursor: "pointer",
            boxShadow: activeSection === "print" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>🖨️</span>
          <span>Print & Invoices</span>
        </button>
      </div>

      {activeSection === "store" ? (
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: "20px",
            padding: "30px",
            boxShadow: "0 4px 15px rgba(0,0,0,0.05)",
            border: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", marginBottom: "6px" }}>
            ⚙️ Store & Payment Settings
          </h2>
          <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>
            Configure your store name and payment methods for POS checkout and QR generation.
          </p>

          <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Store Name</label>
              <input
                type="text"
                value={userProfile.storeName}
                onChange={(e) => setUserProfile({ ...userProfile, storeName: e.target.value })}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1.5px solid #cbd5e1",
                  fontSize: "13px",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                required
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                Your UPI ID (For QR Code Generation)
              </label>
              <input
                type="text"
                placeholder="e.g. yourname@okaxis"
                value={storeSettings.upiId}
                onChange={(e) => setStoreSettings({ ...storeSettings, upiId: e.target.value })}
                style={{
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1.5px solid #cbd5e1",
                  fontSize: "13px",
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                required
              />
              <small style={{ color: "#64748b", fontSize: "12px" }}>
                This UPI ID will automatically generate dynamic payment QR codes during checkout.
              </small>
            </div>

            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
              <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", marginBottom: "10px", display: "block" }}>
                Enabled Payment Methods at POS
              </label>
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
              <button
                type="submit"
                disabled={savingSettings}
                style={{
                  padding: "12px 28px",
                  backgroundColor: "#16a34a",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "15px",
                  boxShadow: "0 4px 10px rgba(22, 163, 74, 0.25)",
                }}
              >
                {savingSettings ? "Saving..." : "Save Settings 💾"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <PrintSettings
          userProfile={userProfile}
          storeSettings={storeSettings}
          printSettings={printSettings}
          setPrintSettings={setPrintSettings}
          onSaveSettings={handleSaveSettings}
          saving={savingSettings}
        />
      )}
    </div>
  );
}
