// src/screens/Settings.jsx
import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import PrintSettings from "../components/PrintSettings";
import { normalizePrintSettings } from "../utils/printEngine";
import { DEFAULT_CRM_CONFIG, mergeCrmConfig } from "../utils/customerCrmService";

export default function Settings({
  userProfile,
  setUserProfile,
  storeSettings,
  setStoreSettings,
  printSettings,
  setPrintSettings,
  crmConfig = DEFAULT_CRM_CONFIG,
  setCrmConfig,
  setPopupModal,
}) {
  const [activeSection, setActiveSection] = useState("store"); // "store" | "print" | "crm"
  const [savingSettings, setSavingSettings] = useState(false);
  const [localCrm, setLocalCrm] = useState(() => mergeCrmConfig(crmConfig));

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
    if (!currentUid) return;

    try {
      setSavingSettings(true);
      const userDocRef = doc(db, "users", currentUid);
      const normalizedPrint = normalizePrintSettings(printSettings);
      const normalizedCrm = mergeCrmConfig(localCrm);

      await setDoc(
        userDocRef,
        {
          storeName: userProfile.storeName,
          settings: {
            ...storeSettings,
            print: normalizedPrint,
          },
          printSettings: normalizedPrint,
          crmConfig: normalizedCrm,
        },
        { merge: true }
      );
      if (typeof setCrmConfig === "function") {
        setCrmConfig(normalizedCrm);
      }

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
          <span>Print &amp; Invoices</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("crm")}
          style={{
            padding: "8px 18px",
            borderRadius: "8px",
            border: "none",
            backgroundColor: activeSection === "crm" ? "#ffffff" : "transparent",
            color: activeSection === "crm" ? "#0f172a" : "#64748b",
            fontWeight: "700",
            fontSize: "13px",
            cursor: "pointer",
            boxShadow: activeSection === "crm" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>🎁</span>
          <span>CRM &amp; Loyalty</span>
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
      ) : activeSection === "print" ? (
        <PrintSettings
          userProfile={userProfile}
          storeSettings={storeSettings}
          printSettings={printSettings}
          setPrintSettings={setPrintSettings}
          onSaveSettings={handleSaveSettings}
          saving={savingSettings}
        />
      ) : (
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
            🎁 Customer CRM, Loyalty &amp; Khata Settings
          </h2>
          <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>
            Configure loyalty point earn/redeem rules and default Khata credit limits across POS and Website.
          </p>

          <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>
              <input
                type="checkbox"
                checked={localCrm.loyaltyEnabled}
                onChange={(e) => setLocalCrm({ ...localCrm, loyaltyEnabled: e.target.checked })}
                style={{ width: "16px", height: "16px", accentColor: "#4f46e5" }}
              />
              Enable Loyalty Points Program
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px", opacity: localCrm.loyaltyEnabled ? 1 : 0.5 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Spend Amount per 1 Point (₹)</label>
                <input
                  type="number"
                  min="1"
                  disabled={!localCrm.loyaltyEnabled}
                  value={localCrm.pointsPerRupees}
                  onChange={(e) => setLocalCrm({ ...localCrm, pointsPerRupees: e.target.value })}
                  style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Value of 1 Point (₹ Discount)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  disabled={!localCrm.loyaltyEnabled}
                  value={localCrm.pointsValueInRupees}
                  onChange={(e) => setLocalCrm({ ...localCrm, pointsValueInRupees: e.target.value })}
                  style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Min Bill to Redeem Points (₹)</label>
                <input
                  type="number"
                  min="0"
                  disabled={!localCrm.loyaltyEnabled}
                  value={localCrm.minBillForRedeem}
                  onChange={(e) => setLocalCrm({ ...localCrm, minBillForRedeem: e.target.value })}
                  style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Max Discount per Bill (%)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  disabled={!localCrm.loyaltyEnabled}
                  value={localCrm.maxRedeemPercent}
                  onChange={(e) => setLocalCrm({ ...localCrm, maxRedeemPercent: e.target.value })}
                  style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Default Khata / Credit Limit (₹)</label>
              <input
                type="number"
                min="0"
                value={localCrm.defaultCreditLimit}
                onChange={(e) => setLocalCrm({ ...localCrm, defaultCreditLimit: e.target.value })}
                style={{ padding: "10px", borderRadius: "8px", border: "1.5px solid #cbd5e1", fontSize: "13px" }}
              />
            </div>

            <div>
              <button
                type="submit"
                disabled={savingSettings}
                style={{
                  padding: "12px 28px",
                  backgroundColor: "#4f46e5",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontWeight: "700",
                  cursor: "pointer",
                  fontSize: "15px",
                }}
              >
                {savingSettings ? "Saving..." : "Save CRM Settings 💾"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
