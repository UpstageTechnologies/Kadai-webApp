// src/components/PrintSettings.jsx
import { useState, useMemo } from "react";
import {
  PAPER_PROFILES,
  DOCUMENT_TYPES,
  normalizePrintSettings,
  createDefaultDocumentProfile,
  getBrowserPrinterCapabilities,
  resolvePaperDimensions,
  getSampleDocumentData,
  generatePrintHtml,
  executePrint,
} from "../utils/printEngine";

export default function PrintSettings({
  userProfile = {},
  storeSettings = {},
  printSettings,
  setPrintSettings,
  onSaveSettings,
  saving = false,
}) {
  const currentSettings = useMemo(
    () => normalizePrintSettings(printSettings),
    [printSettings]
  );

  const [activeDocType, setActiveDocType] = useState("posReceipt");
  const [testPrinting, setTestPrinting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const capabilities = useMemo(() => getBrowserPrinterCapabilities(), []);

  const activeProfile = currentSettings.profiles[activeDocType] || currentSettings.profiles.posReceipt;
  const paperDims = useMemo(() => resolvePaperDimensions(activeProfile), [activeProfile]);

  // Handler to update a field in the current document profile
  const updateProfileField = (field, value) => {
    setPrintSettings((prev) => {
      const normalized = normalizePrintSettings(prev);
      return {
        ...normalized,
        profiles: {
          ...normalized.profiles,
          [activeDocType]: {
            ...normalized.profiles[activeDocType],
            [field]: value,
          },
        },
      };
    });
  };

  // Reset current profile to default
  const handleResetCurrentProfile = () => {
    if (!window.confirm(`Reset "${DOCUMENT_TYPES[activeDocType]?.name}" settings to factory defaults?`)) {
      return;
    }
    const def = createDefaultDocumentProfile(activeDocType);
    setPrintSettings((prev) => {
      const normalized = normalizePrintSettings(prev);
      return {
        ...normalized,
        profiles: {
          ...normalized.profiles,
          [activeDocType]: def,
        },
      };
    });
  };

  // Generate live sample data
  const sampleData = useMemo(() => {
    return getSampleDocumentData(activeDocType, {
      storeName: userProfile.storeName || "Kadai Super Store",
      name: userProfile.name || "Store Admin",
      phone: userProfile.phone || "+91 94444 12345",
      email: userProfile.email || "store@kadai.in",
      address: userProfile.address || "12, Main Bazaar Road, Madurai - 625001",
      gst: userProfile.gst || userProfile.gstin || "33ABCDE1234F1Z5",
      profileImage: userProfile.profileImage || "",
      upiId: storeSettings.upiId || "kadaistore@okaxis",
    });
  }, [activeDocType, userProfile, storeSettings]);

  // Live preview HTML string
  const previewHtml = useMemo(() => {
    return generatePrintHtml(sampleData, currentSettings, activeDocType);
  }, [sampleData, currentSettings, activeDocType]);

  // Execute test print
  const handleTestPrint = async () => {
    setTestPrinting(true);
    setTestResult(null);
    try {
      await executePrint(sampleData, currentSettings, activeDocType);
      setTestResult({
        success: true,
        message: `Test print dispatched for ${DOCUMENT_TYPES[activeDocType]?.name} (${paperDims.presetKey.toUpperCase()})!`,
      });
    } catch (err) {
      console.error("Test print error:", err);
      setTestResult({
        success: false,
        message: err.message || "Failed to trigger print dialog.",
      });
    } finally {
      setTestPrinting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
      {/* Top Banner Card */}
      <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", padding: "24px", border: "1px solid #e2e8f0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px 0", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🖨️</span> Universal Print & Printer Settings
            </h2>
            <p style={{ margin: 0, fontSize: "13px", color: "#64748b", maxWidth: "600px", lineHeight: "1.5" }}>
              Configure independent paper sizes (A4, A5, A6, 80mm/76mm/58mm thermal rolls, or custom mm), margins, print scaling, typography, and content visibility for every invoice type.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleTestPrint}
              disabled={testPrinting}
              style={{
                padding: "10px 18px",
                backgroundColor: "#f8fafc",
                color: "#1e293b",
                border: "1.5px solid #cbd5e1",
                borderRadius: "10px",
                fontWeight: "700",
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>{testPrinting ? "⏳" : "🖨️"}</span>
              <span>{testPrinting ? "Printing..." : "Test Print"}</span>
            </button>

            <button
              type="button"
              onClick={onSaveSettings}
              disabled={saving}
              style={{
                padding: "10px 22px",
                backgroundColor: "#16a34a",
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                fontWeight: "800",
                fontSize: "13px",
                cursor: "pointer",
                boxShadow: "0 4px 10px rgba(22, 163, 74, 0.25)",
              }}
            >
              {saving ? "Saving..." : "Save Settings 💾"}
            </button>
          </div>
        </div>

        {testResult && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              backgroundColor: testResult.success ? "#f0fdf4" : "#fef2f2",
              color: testResult.success ? "#166534" : "#991b1b",
              border: `1px solid ${testResult.success ? "#bbf7d0" : "#fecaca"}`,
            }}
          >
            {testResult.success ? "✅ " : "❌ "}
            {testResult.message}
          </div>
        )}
      </div>

      {/* Printer Compatibility Status Card */}
      <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", padding: "16px 20px", border: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
          <span>🔌</span> Hardware Connection & Compatibility Status
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
          <div style={{ backgroundColor: "#ffffff", padding: "10px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px" }}>
            <div style={{ color: "#16a34a", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>🟢</span> Windows / macOS Spooler
            </div>
            <div style={{ color: "#64748b", marginTop: "2px" }}>
              All installed USB, Network, and Thermal drivers are 100% supported via OS Print Dialog.
            </div>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "10px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px" }}>
            <div style={{ color: capabilities.webBluetooth ? "#2563eb" : "#64748b", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>{capabilities.webBluetooth ? "🔵" : "⚪"}</span> Web Bluetooth
            </div>
            <div style={{ color: "#64748b", marginTop: "2px" }}>
              {capabilities.webBluetooth
                ? "Supported in Chrome/Edge. Pair Bluetooth printer as an OS printer for instant print."
                : "Not available in this browser. Use standard OS printer driver or Chrome."}
            </div>
          </div>

          <div style={{ backgroundColor: "#ffffff", padding: "10px 14px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px" }}>
            <div style={{ color: "#0f172a", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>📄</span> Continuous Roll Height
            </div>
            <div style={{ color: "#64748b", marginTop: "2px" }}>
              Enabled. Dynamic CSS automatically sets height based on item count, avoiding forced A4 gaps.
            </div>
          </div>
        </div>
      </div>

      {/* Document Type Profile Selector Tabs */}
      <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
        {Object.entries(DOCUMENT_TYPES).map(([key, info]) => {
          const isActive = activeDocType === key;
          const currentPaper = currentSettings.profiles[key]?.paperSize || info.defaultPaper;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveDocType(key)}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: "1.5px solid",
                borderColor: isActive ? "#fc8019" : "#cbd5e1",
                backgroundColor: isActive ? "#fff7ed" : "#ffffff",
                color: isActive ? "#fc8019" : "#334155",
                fontWeight: "700",
                fontSize: "13px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: "2px",
              }}
            >
              <span>{info.name}</span>
              <span style={{ fontSize: "10px", fontWeight: "800", color: isActive ? "#ea580c" : "#94a3b8" }}>
                {PAPER_PROFILES[currentPaper]?.shortName || currentPaper}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Settings & Live Preview Split Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "24px", alignItems: "flex-start" }}>
        {/* Left Column: Form Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Section: Paper Size & Orientation */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                1. Paper Size & Geometry
              </h3>
              <button
                type="button"
                onClick={handleResetCurrentProfile}
                style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "11px", fontWeight: "700", cursor: "pointer" }}
              >
                Reset Profile ↺
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "6px" }}>
                  Paper Preset Profile
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
                  {Object.entries(PAPER_PROFILES).map(([key, profile]) => {
                    const isSelected = activeProfile.paperSize === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateProfileField("paperSize", key)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "8px",
                          border: `1.5px solid ${isSelected ? "#2563eb" : "#e2e8f0"}`,
                          backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                          color: isSelected ? "#1d4ed8" : "#334155",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: "12px", fontWeight: "800" }}>{profile.shortName}</div>
                        <div style={{ fontSize: "10px", color: isSelected ? "#3b82f6" : "#64748b", marginTop: "2px" }}>
                          {profile.isContinuous ? `${profile.widthMm}mm Roll (Auto Height)` : `${profile.widthMm} × ${profile.heightMm} mm`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Dimensions (Conditional) */}
              {activeProfile.paperSize === "custom" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", padding: "12px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                      Custom Width (mm)
                    </label>
                    <input
                      type="number"
                      min="40"
                      max="350"
                      value={activeProfile.customWidth || 80}
                      onChange={(e) => updateProfileField("customWidth", Number(e.target.value))}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                    />
                    <small style={{ color: "#64748b", fontSize: "10px" }}>Range: 40 - 350 mm</small>
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                      Custom Height (mm)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="500"
                      value={activeProfile.customHeight || 0}
                      onChange={(e) => updateProfileField("customHeight", Number(e.target.value))}
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                    />
                    <small style={{ color: "#64748b", fontSize: "10px" }}>0 = Continuous Roll (Auto)</small>
                  </div>
                </div>
              )}

              {/* Orientation (For Sheet Papers) */}
              {!paperDims.isContinuous && (
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "6px" }}>
                    Orientation
                  </label>
                  <div style={{ display: "flex", gap: "10px" }}>
                    {["portrait", "landscape"].map((orient) => (
                      <label
                        key={orient}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          padding: "8px",
                          borderRadius: "8px",
                          border: `1.5px solid ${activeProfile.orientation === orient ? "#2563eb" : "#e2e8f0"}`,
                          backgroundColor: activeProfile.orientation === orient ? "#eff6ff" : "#ffffff",
                          fontSize: "12px",
                          fontWeight: "700",
                          color: activeProfile.orientation === orient ? "#1d4ed8" : "#334155",
                          cursor: "pointer",
                          textTransform: "capitalize",
                        }}
                      >
                        <input
                          type="radio"
                          name={`orient_${activeDocType}`}
                          checked={activeProfile.orientation === orient}
                          onChange={() => updateProfileField("orientation", orient)}
                          style={{ display: "none" }}
                        />
                        <span>{orient === "portrait" ? "📄 Portrait" : "📃 Landscape"}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Margins */}
              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "6px" }}>
                  Page Margins (mm)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {[
                    { label: "Top", field: "marginTop" },
                    { label: "Bottom", field: "marginBottom" },
                    { label: "Left", field: "marginLeft" },
                    { label: "Right", field: "marginRight" },
                  ].map((m) => (
                    <div key={m.field}>
                      <span style={{ fontSize: "11px", color: "#64748b", display: "block" }}>{m.label}</span>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={activeProfile[m.field] ?? 4}
                        onChange={(e) => updateProfileField(m.field, Math.max(0, Number(e.target.value)))}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", marginTop: "2px" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section: Typography, Scaling & Copies */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", margin: "0 0 14px 0" }}>
              2. Typography, Scaling & Copies
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Font Size
                </label>
                <select
                  value={activeProfile.fontSize || "medium"}
                  onChange={(e) => updateProfileField("fontSize", e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", backgroundColor: "#ffffff" }}
                >
                  <option value="small">Small (11px base - Best for 58mm)</option>
                  <option value="medium">Medium (12px base - Standard)</option>
                  <option value="large">Large (14px base - High Readability)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Line Spacing
                </label>
                <select
                  value={activeProfile.lineSpacing || "normal"}
                  onChange={(e) => updateProfileField("lineSpacing", e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", backgroundColor: "#ffffff" }}
                >
                  <option value="compact">Compact (Saves thermal paper)</option>
                  <option value="normal">Normal (Standard)</option>
                  <option value="relaxed">Relaxed (Spacious)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Font Family
                </label>
                <select
                  value={activeProfile.fontFamily || "system"}
                  onChange={(e) => updateProfileField("fontFamily", e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px", backgroundColor: "#ffffff" }}
                >
                  <option value="system">System Default</option>
                  <option value="monospace">Monospace (Thermal POS style)</option>
                  <option value="sans-serif">Modern Sans-Serif</option>
                  <option value="serif">Classic Serif</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Default Copies
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={activeProfile.copies || 1}
                  onChange={(e) => updateProfileField("copies", Math.max(1, Math.min(5, Number(e.target.value))))}
                  style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "12px" }}
                />
              </div>
            </div>

            <div style={{ marginTop: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                  Print Scaling ({activeProfile.scale || 100}%)
                </label>
                <span style={{ fontSize: "11px", color: "#64748b" }}>Recommended: 100%</span>
              </div>
              <input
                type="range"
                min="70"
                max="130"
                step="5"
                value={activeProfile.scale || 100}
                onChange={(e) => updateProfileField("scale", Number(e.target.value))}
                style={{ width: "100%", cursor: "pointer" }}
              />
            </div>
          </div>

          {/* Section: Content Visibility Toggles */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", margin: "0 0 14px 0" }}>
              3. Content & Information Visibility
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                { label: "Shop Logo", field: "showLogo", icon: "🖼️" },
                { label: "Address & Contact", field: "showAddress", icon: "📍" },
                { label: "GSTIN / Tax Details", field: "showGst", icon: "🏛️" },
                { label: "Item Brand / Description", field: "showItemDescription", icon: "🏷️" },
                { label: "Discounts & Savings", field: "showDiscount", icon: "🏷️" },
                { label: "Tax (GST) Breakdown", field: "showTax", icon: "📊" },
                { label: "Customer Info (Name/Phone)", field: "showCustomerInfo", icon: "👤" },
                { label: "Payment Mode (Cash/UPI)", field: "showPaymentMethod", icon: "💳" },
                { label: "Billed By Staff", field: "showBilledBy", icon: "👨‍💼" },
                { label: "UPI Payment QR Code", field: "showQrCode", icon: "📱" },
                { label: "Terms & Conditions", field: "showTerms", icon: "📜" },
                { label: "Auto-Fit Text (No Clip)", field: "autoFit", icon: "↔️" },
              ].map((item) => {
                const isChecked = activeProfile[item.field] !== false;
                return (
                  <label
                    key={item.field}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      backgroundColor: isChecked ? "#f0fdf4" : "#f8fafc",
                      border: `1px solid ${isChecked ? "#bbf7d0" : "#e2e8f0"}`,
                      fontSize: "12px",
                      fontWeight: "600",
                      color: isChecked ? "#166534" : "#64748b",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => updateProfileField(item.field, e.target.checked)}
                      style={{ width: "15px", height: "15px", accentColor: "#16a34a" }}
                    />
                    <span>{item.icon} {item.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section: Header & Footer Text Customization */}
          <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", padding: "20px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", margin: "0 0 14px 0" }}>
              4. Header & Footer Text
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Custom Header Title (Leave empty to use Store Name)
                </label>
                <input
                  type="text"
                  placeholder={userProfile.storeName || "Kadai Store"}
                  value={activeProfile.headerTitle || ""}
                  onChange={(e) => updateProfileField("headerTitle", e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Document Subtitle
                </label>
                <input
                  type="text"
                  value={activeProfile.headerSubtitle || ""}
                  onChange={(e) => updateProfileField("headerSubtitle", e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                  Footer Message / Greeting
                </label>
                <input
                  type="text"
                  value={activeProfile.footerMessage || ""}
                  onChange={(e) => updateProfileField("footerMessage", e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              {activeProfile.showTerms && (
                <div>
                  <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155", display: "block", marginBottom: "4px" }}>
                    Terms & Conditions
                  </label>
                  <textarea
                    rows="3"
                    value={activeProfile.termsAndConditions || ""}
                    onChange={(e) => updateProfileField("termsAndConditions", e.target.value)}
                    style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "12px", resize: "vertical" }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Live Preview */}
        <div style={{ position: "sticky", top: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ backgroundColor: "#ffffff", borderRadius: "16px", padding: "16px 20px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "16px" }}>👁️</span>
                <span style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                  Live Document Preview
                </span>
              </div>
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#2563eb", backgroundColor: "#eff6ff", padding: "2px 8px", borderRadius: "6px" }}>
                {paperDims.presetKey.toUpperCase()} • {paperDims.widthMm}mm {paperDims.isContinuous ? "Continuous" : `× ${paperDims.heightMm}mm`}
              </span>
            </div>

            <p style={{ margin: "0 0 12px 0", fontSize: "11px", color: "#64748b" }}>
              Realistic rendering matching active paper dimensions, scaling, typography, and visibility toggles.
            </p>

            {/* Preview Iframe Container */}
            <div
              style={{
                width: "100%",
                maxHeight: "560px",
                overflowY: "auto",
                backgroundColor: "#e2e8f0",
                padding: "16px",
                borderRadius: "10px",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: paperDims.isContinuous ? `${Math.min(380, paperDims.widthMm * 3.8)}px` : "100%",
                  maxWidth: "460px",
                  backgroundColor: "#ffffff",
                  boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <iframe
                  title="Live Print Preview"
                  srcDoc={previewHtml}
                  style={{
                    width: "100%",
                    minHeight: paperDims.isContinuous ? "480px" : "540px",
                    border: "none",
                    backgroundColor: "#ffffff",
                    display: "block",
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: "14px", display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={handleTestPrint}
                disabled={testPrinting}
                style={{
                  flex: 1,
                  padding: "10px",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: "700",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {testPrinting ? "Opening Print Dialog..." : "Print Test Document 🖨️"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
