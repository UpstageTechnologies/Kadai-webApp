/**
 * Kadai Web POS - Professional Universal Print Engine & Multi-Printer Compatibility
 * Supports: A4, A5, A6, Thermal 80mm, Thermal 76mm, Thermal 58mm, Custom dimensions.
 * Browser-compatible: Windows Spooler, macOS CUPS, USB, Network, Thermal drivers, Save as PDF.
 */

// Paper Profiles Definitions
export const PAPER_PROFILES = {
  A4: {
    id: "A4",
    name: "A4 Standard (210 × 297 mm)",
    shortName: "A4",
    widthMm: 210,
    heightMm: 297,
    isContinuous: false,
    type: "sheet",
    defaultMargins: { top: 10, bottom: 10, left: 10, right: 10 },
    description: "Standard full-page sheet for detailed GST tax invoices and quotations.",
  },
  A5: {
    id: "A5",
    name: "A5 Half-Page (148 × 210 mm)",
    shortName: "A5",
    widthMm: 148,
    heightMm: 210,
    isContinuous: false,
    type: "sheet",
    defaultMargins: { top: 8, bottom: 8, left: 8, right: 8 },
    description: "Compact half-size sheet ideal for retail bills and delivery challans.",
  },
  A6: {
    id: "A6",
    name: "A6 Mini-Page (105 × 148 mm)",
    shortName: "A6",
    widthMm: 105,
    heightMm: 148,
    isContinuous: false,
    type: "sheet",
    defaultMargins: { top: 6, bottom: 6, left: 6, right: 6 },
    description: "Pocket-sized sheet for counter receipts and express orders.",
  },
  thermal80: {
    id: "thermal80",
    name: "Thermal 80mm (3-inch Roll)",
    shortName: "80mm Thermal",
    widthMm: 80,
    printableWidthMm: 72,
    heightMm: 0, // continuous / auto
    isContinuous: true,
    type: "thermal",
    defaultMargins: { top: 3, bottom: 4, left: 3, right: 3 },
    description: "Standard POS thermal receipt paper used by Epson, Star, TVS, Rongta, etc.",
  },
  thermal76: {
    id: "thermal76",
    name: "Thermal 76mm (3-inch Roll)",
    shortName: "76mm Thermal",
    widthMm: 76,
    printableWidthMm: 68,
    heightMm: 0, // continuous / auto
    isContinuous: true,
    type: "thermal",
    defaultMargins: { top: 3, bottom: 4, left: 3, right: 3 },
    description: "Specialized 76mm desktop and mobile receipt printers.",
  },
  thermal58: {
    id: "thermal58",
    name: "Thermal 58mm (2-inch Roll)",
    shortName: "58mm Thermal",
    widthMm: 58,
    printableWidthMm: 48,
    heightMm: 0, // continuous / auto
    isContinuous: true,
    type: "thermal",
    defaultMargins: { top: 2, bottom: 4, left: 2, right: 2 },
    description: "Compact 2-inch Bluetooth & USB thermal printers.",
  },
  custom: {
    id: "custom",
    name: "Custom Dimensions (User Defined)",
    shortName: "Custom",
    widthMm: 80,
    heightMm: 0,
    isContinuous: true,
    type: "custom",
    defaultMargins: { top: 5, bottom: 5, left: 5, right: 5 },
    description: "Define custom width and height in millimeters for specialized stationary.",
  },
};

// Document Types
export const DOCUMENT_TYPES = {
  posReceipt: { id: "posReceipt", name: "POS Receipt", defaultPaper: "thermal80", isThermalDefault: true },
  salesInvoice: { id: "salesInvoice", name: "Sales Invoice", defaultPaper: "A4", isThermalDefault: false },
  purchaseInvoice: { id: "purchaseInvoice", name: "Purchase Invoice", defaultPaper: "A4", isThermalDefault: false },
  quotation: { id: "quotation", name: "Quotation / Estimate", defaultPaper: "A4", isThermalDefault: false },
  customerCopy: { id: "customerCopy", name: "Customer Copy", defaultPaper: "thermal80", isThermalDefault: true },
  report: { id: "report", name: "Sales / Inventory Report", defaultPaper: "A4", isThermalDefault: false },
};

/**
 * Creates default print configuration for a profile or document.
 */
export const createDefaultDocumentProfile = (docTypeId = "posReceipt") => {
  const docDef = DOCUMENT_TYPES[docTypeId] || DOCUMENT_TYPES.posReceipt;
  const isThermal = docDef.isThermalDefault;
  const paperKey = docDef.defaultPaper;
  const paper = PAPER_PROFILES[paperKey] || PAPER_PROFILES.thermal80;

  return {
    paperSize: paperKey,
    customWidth: 80,
    customHeight: 0,
    isContinuous: isThermal,
    orientation: "portrait",
    marginTop: paper.defaultMargins.top,
    marginBottom: paper.defaultMargins.bottom,
    marginLeft: paper.defaultMargins.left,
    marginRight: paper.defaultMargins.right,
    scale: 100,
    fontSize: isThermal ? "medium" : "medium", // "small" | "medium" | "large"
    lineSpacing: isThermal ? "compact" : "normal", // "compact" | "normal" | "relaxed"
    fontFamily: isThermal ? "monospace" : "system", // "system" | "monospace" | "sans-serif" | "serif"
    copies: 1,

    // Visibility toggles
    showLogo: true,
    showAddress: true,
    showContact: true,
    showGst: true,
    showItemDescription: true,
    showDiscount: true,
    showTax: true,
    showTotals: true,
    showPaymentMethod: true,
    showCustomerInfo: true,
    showBilledBy: true,
    showQrCode: true,
    showTerms: !isThermal,
    autoFit: true,

    // Text customizations
    headerTitle: "",
    headerSubtitle: isThermal ? "RETAIL RECEIPT" : "TAX INVOICE",
    footerMessage: "Thank You! Visit Again. / நன்றி மீண்டும் வருக.",
    termsAndConditions: "1. Goods once sold cannot be returned without original receipt.\n2. Warranty claims subject to manufacturer terms.",
  };
};

/**
 * Creates comprehensive shop print settings object.
 */
export const getDefaultPrintSettings = () => {
  return {
    version: 1,
    activeProfile: "posReceipt",
    globalAutoPrintOnCheckout: false,
    profiles: {
      posReceipt: createDefaultDocumentProfile("posReceipt"),
      salesInvoice: createDefaultDocumentProfile("salesInvoice"),
      purchaseInvoice: createDefaultDocumentProfile("purchaseInvoice"),
      quotation: createDefaultDocumentProfile("quotation"),
      customerCopy: createDefaultDocumentProfile("customerCopy"),
      report: createDefaultDocumentProfile("report"),
    },
  };
};

/**
 * Normalizes and merges saved settings with defaults to guarantee all fields exist.
 */
export const normalizePrintSettings = (rawSettings) => {
  const defaults = getDefaultPrintSettings();
  if (!rawSettings || typeof rawSettings !== "object") return defaults;

  const merged = { ...defaults, ...rawSettings };
  merged.profiles = { ...defaults.profiles };

  Object.keys(DOCUMENT_TYPES).forEach((docId) => {
    merged.profiles[docId] = {
      ...defaults.profiles[docId],
      ...(rawSettings.profiles?.[docId] || {}),
    };
  });

  return merged;
};

/**
 * Checks browser printer capabilities.
 */
export const getBrowserPrinterCapabilities = () => {
  const hasBluetooth = typeof navigator !== "undefined" && "bluetooth" in navigator;
  const hasSerial = typeof navigator !== "undefined" && "serial" in navigator;
  const hasUsb = typeof navigator !== "undefined" && "usb" in navigator;
  const isSecureContext = typeof window !== "undefined" && window.isSecureContext;

  return {
    systemPrint: true, // Universal window.print() supported everywhere
    webBluetooth: hasBluetooth && isSecureContext,
    webSerial: hasSerial && isSecureContext,
    webUsb: hasUsb && isSecureContext,
    isSecureContext,
    osPrintingDescription: "Supports all Windows, macOS, and Linux installed printers (USB, Network/Wi-Fi, Thermal receipt drivers, PDF).",
  };
};

/**
 * Computes paper dimensions in millimeters and CSS strings.
 */
export const resolvePaperDimensions = (profile) => {
  const presetKey = profile.paperSize || "thermal80";
  const preset = PAPER_PROFILES[presetKey] || PAPER_PROFILES.thermal80;

  let widthMm = preset.widthMm;
  let heightMm = preset.heightMm;
  let isContinuous = preset.isContinuous;

  if (presetKey === "custom") {
    widthMm = Math.max(40, Math.min(350, Number(profile.customWidth) || 80));
    const h = Number(profile.customHeight) || 0;
    if (h > 0) {
      heightMm = Math.max(50, Math.min(500, h));
      isContinuous = false;
    } else {
      heightMm = 0;
      isContinuous = true;
    }
  }

  const isLandscape = profile.orientation === "landscape" && !isContinuous;
  const finalWidth = isLandscape && heightMm > 0 ? heightMm : widthMm;
  const finalHeight = isLandscape && heightMm > 0 ? widthMm : heightMm;

  const pageSizeCss = isContinuous
    ? `${finalWidth}mm auto`
    : `${finalWidth}mm ${finalHeight}mm`;

  return {
    presetKey,
    widthMm: finalWidth,
    heightMm: finalHeight,
    isContinuous,
    isLandscape,
    pageSizeCss,
    printableWidthMm: preset.printableWidthMm || finalWidth - (Number(profile.marginLeft || 0) + Number(profile.marginRight || 0)),
  };
};

/**
 * Helper to format currency in INR style.
 */
export const formatCurrency = (val) => {
  const num = Number(val || 0);
  return "₹" + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Sample mock document data used for live preview and test printing.
 */
export const getSampleDocumentData = (docType = "posReceipt", storeInfo = {}) => {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const isInvoice = docType === "salesInvoice" || docType === "purchaseInvoice" || docType === "quotation";

  return {
    id: "INV-" + Math.floor(100000 + Math.random() * 900000),
    billNo: "B-" + Math.floor(1000 + Math.random() * 9000),
    orderDate: `${dateStr} ${timeStr}`,
    docTitle: docType === "quotation" ? "QUOTATION" : docType === "purchaseInvoice" ? "PURCHASE INVOICE" : docType === "salesInvoice" ? "TAX INVOICE" : "CASH RECEIPT",
    paymentMethod: "UPI / Cash",
    customerName: "Ramesh Sharma",
    customerPhone: "+91 98765 43210",
    customerAddress: "42, Gandhi Road, Chennai, TN - 600001",
    customerGst: "33AAAAA0000A1Z5",
    billedBy: storeInfo.name || "Manager",
    storeName: storeInfo.storeName || "Kadai Super Store",
    storeAddress: storeInfo.address || "12, Kamarajar Salai, Madurai - 625001",
    storePhone: storeInfo.phone || "+91 94444 12345",
    storeEmail: storeInfo.email || "support@kadaistore.com",
    storeGst: storeInfo.gst || "33ABCDE1234F1Z8",
    storeLogo: storeInfo.profileImage || storeInfo.logo || "",
    upiId: storeInfo.upiId || "kadaistore@okaxis",
    items: [
      {
        id: "1",
        name: "Fresh Farm Organic Milk (1L Pouch)",
        hsn: "0401",
        qty: 2,
        price: 36.00,
        mrp: 38.00,
        discount: 2.00,
        taxPercent: 5,
        total: 72.00,
      },
      {
        id: "2",
        name: "Aashirvaad Shudh Chakki Atta (5kg Bag)",
        hsn: "1101",
        qty: 1,
        price: 245.00,
        mrp: 260.00,
        discount: 15.00,
        taxPercent: 5,
        total: 245.00,
      },
      {
        id: "3",
        name: "Tata Premium Tea Gold (500g Jar)",
        hsn: "0902",
        qty: 1,
        price: 310.00,
        mrp: 340.00,
        discount: 30.00,
        taxPercent: 5,
        total: 310.00,
      },
      ...(isInvoice ? [
        {
          id: "4",
          name: "Fortune Sunlite Refined Sunflower Oil (1L)",
          hsn: "1512",
          qty: 3,
          price: 135.00,
          mrp: 150.00,
          discount: 15.00,
          taxPercent: 5,
          total: 405.00,
        },
        {
          id: "5",
          name: "Organic Toor Dal Premium Grade (1kg)",
          hsn: "0713",
          qty: 2,
          price: 165.00,
          mrp: 180.00,
          discount: 15.00,
          taxPercent: 0,
          total: 330.00,
        }
      ] : [])
    ],
    subtotal: isInvoice ? 1362.00 : 627.00,
    discountTotal: isInvoice ? 77.00 : 47.00,
    taxTotal: isInvoice ? 51.60 : 29.85,
    roundOff: 0.15,
    totalAmount: isInvoice ? 1362.00 : 627.00,
    totalItems: isInvoice ? 5 : 3,
    totalQuantity: isInvoice ? 9 : 4,
  };
};

/**
 * Generates pure CSS for the document based on profile settings.
 */
export const buildPrintStyles = (profile) => {
  const dims = resolvePaperDimensions(profile);
  const marginTop = Math.max(0, Number(profile.marginTop ?? 4));
  const marginBottom = Math.max(0, Number(profile.marginBottom ?? 4));
  const marginLeft = Math.max(0, Number(profile.marginLeft ?? 3));
  const marginRight = Math.max(0, Number(profile.marginRight ?? 3));
  const scalePercent = Math.max(50, Math.min(150, Number(profile.scale ?? 100)));

  // Font size mapping
  const fontSizes = {
    small: { base: "11px", heading: "14px", sub: "10px", tiny: "9px" },
    medium: { base: "12px", heading: "16px", sub: "11px", tiny: "10px" },
    large: { base: "14px", heading: "18px", sub: "12px", tiny: "11px" },
  };
  const fs = fontSizes[profile.fontSize] || fontSizes.medium;

  // Line spacing mapping
  const lineHeights = {
    compact: "1.2",
    normal: "1.4",
    relaxed: "1.6",
  };
  const lh = lineHeights[profile.lineSpacing] || lineHeights.normal;

  // Font family mapping
  const fontFamilies = {
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    monospace: "'Courier New', Courier, 'Lucida Console', Monaco, monospace",
    "sans-serif": "'Inter', 'Segoe UI', Roboto, Helvetica, sans-serif",
    serif: "'Times New Roman', Times, Georgia, serif",
  };
  const ff = fontFamilies[profile.fontFamily] || fontFamilies.system;

  return `
    @page {
      size: ${dims.pageSizeCss};
      margin: ${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    html, body {
      background-color: #ffffff;
      color: #000000;
      font-family: ${ff};
      font-size: ${fs.base};
      line-height: ${lh};
      width: 100%;
    }

    body {
      padding: 0;
      margin: 0;
      transform: scale(${scalePercent / 100});
      transform-origin: top left;
    }

    .print-container {
      width: 100%;
      max-width: ${dims.widthMm}mm;
      margin: 0 auto;
      padding: 0;
    }

    /* Thermal receipt specific styles */
    .thermal-receipt {
      width: 100%;
      max-width: ${dims.widthMm}mm;
      margin: 0 auto;
      text-align: left;
    }

    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .font-bold { font-weight: 700; }
    .font-heavy { font-weight: 800; }
    .uppercase { text-transform: uppercase; }

    .receipt-title {
      font-size: ${fs.heading};
      font-weight: 800;
      margin-bottom: 2px;
      line-height: 1.2;
    }

    .receipt-subtitle {
      font-size: ${fs.sub};
      color: #333;
      margin-bottom: 4px;
    }

    .receipt-meta {
      font-size: ${fs.tiny};
      color: #444;
      line-height: 1.3;
    }

    .dashed-divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
      width: 100%;
    }

    .solid-divider {
      border-top: 1px solid #000;
      margin: 6px 0;
      width: 100%;
    }

    .double-divider {
      border-top: 3px double #000;
      margin: 6px 0;
      width: 100%;
    }

    .flex-between {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 6px 0;
      font-size: ${fs.base};
    }

    .items-table th {
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      padding: 4px 2px;
      font-weight: 700;
    }

    .items-table td {
      padding: 4px 2px;
      vertical-align: top;
      overflow-wrap: break-word;
      word-break: break-word;
    }

    .avoid-page-break {
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Sheet Invoice specific styles (A4, A5, A6) */
    .sheet-invoice {
      width: 100%;
      border: 1px solid #cbd5e1;
      padding: 16px;
      border-radius: 4px;
    }

    .invoice-header-grid {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
    }

    .meta-box-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      background-color: #f8fafc;
      padding: 10px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      margin-bottom: 14px;
      font-size: ${fs.sub};
    }

    .sheet-table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
    }

    .sheet-table th {
      background-color: #0f172a;
      color: #ffffff;
      padding: 6px 8px;
      font-size: ${fs.sub};
      text-align: left;
    }

    .sheet-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #e2e8f0;
      font-size: ${fs.base};
    }

    .sheet-table tr:nth-child(even) {
      background-color: #f8fafc;
    }

    .summary-grid {
      display: flex;
      justify-content: flex-end;
      margin-top: 10px;
    }

    .summary-table {
      width: 280px;
      border-collapse: collapse;
    }

    .summary-table td {
      padding: 4px 8px;
    }

    .qr-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 8px 0;
    }

    .qr-img {
      width: 90px;
      height: 90px;
      object-fit: contain;
    }

    @media print {
      body {
        margin: 0;
        padding: 0;
      }
      .no-print {
        display: none !important;
      }
    }
  `;
};

/**
 * Builds HTML string for Thermal Receipts (58mm, 76mm, 80mm).
 */
export const buildThermalReceiptHtml = (data, profile) => {
  const storeName = profile.headerTitle || data.storeName || "KADAI STORE";
  const subtitle = profile.headerSubtitle || "STORE RECEIPT";
  const items = data.items || [];

  return `
    <div class="thermal-receipt">
      ${profile.showLogo && data.storeLogo ? `
        <div class="text-center" style="margin-bottom: 6px;">
          <img src="${data.storeLogo}" alt="Logo" style="max-height: 48px; max-width: 120px; object-fit: contain;" />
        </div>
      ` : ""}

      <div class="text-center receipt-title">${storeName}</div>
      <div class="text-center receipt-subtitle">${subtitle}</div>

      ${profile.showAddress && data.storeAddress ? `
        <div class="text-center receipt-meta">${data.storeAddress}</div>
      ` : ""}

      ${profile.showContact && (data.storePhone || data.storeEmail) ? `
        <div class="text-center receipt-meta">
          ${data.storePhone ? `Ph: ${data.storePhone}` : ""}
          ${data.storePhone && data.storeEmail ? " | " : ""}
          ${data.storeEmail ? `${data.storeEmail}` : ""}
        </div>
      ` : ""}

      ${profile.showGst && data.storeGst ? `
        <div class="text-center receipt-meta font-bold">GSTIN: ${data.storeGst}</div>
      ` : ""}

      <div class="dashed-divider"></div>

      <div class="receipt-meta">
        <div class="flex-between">
          <span>Bill No: <strong>${data.billNo || data.id}</strong></span>
          <span>${data.orderDate || new Date().toLocaleString()}</span>
        </div>
        ${profile.showCustomerInfo && data.customerName ? `
          <div class="flex-between" style="margin-top: 2px;">
            <span>Customer: ${data.customerName}</span>
            <span>${data.customerPhone || ""}</span>
          </div>
        ` : ""}
        ${profile.showPaymentMethod && data.paymentMethod ? `
          <div class="flex-between" style="margin-top: 2px;">
            <span>Payment: <strong>${data.paymentMethod}</strong></span>
            ${profile.showBilledBy && data.billedBy ? `<span>Billed by: ${data.billedBy}</span>` : ""}
          </div>
        ` : ""}
      </div>

      <table class="items-table">
        <thead>
          <tr>
            <th class="text-left" style="width: 50%;">ITEM</th>
            <th class="text-center" style="width: 20%;">QTY</th>
            <th class="text-right" style="width: 30%;">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr class="avoid-page-break">
              <td class="text-left">
                <div class="font-bold">${item.name || item.itemName}</div>
                ${profile.showItemDescription && (item.brand || item.hsn) ? `
                  <div style="font-size: 85%; color: #555;">
                    ${item.brand ? `Brand: ${item.brand}` : ""}
                    ${item.brand && item.hsn ? " | " : ""}
                    ${item.hsn ? `HSN: ${item.hsn}` : ""}
                  </div>
                ` : ""}
                <div style="font-size: 85%; color: #444;">
                  ${item.qty} × ${formatCurrency(item.price || item.salesPrice || 0)}
                  ${profile.showDiscount && item.discount > 0 ? ` (Save ₹${item.discount})` : ""}
                </div>
              </td>
              <td class="text-center" style="vertical-align: middle;">${item.qty}</td>
              <td class="text-right font-bold" style="vertical-align: middle;">
                ${formatCurrency((item.price || item.salesPrice || 0) * item.qty)}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="dashed-divider"></div>

      ${profile.showTotals ? `
        <div class="receipt-meta" style="line-height: 1.6;">
          <div class="flex-between">
            <span>Total Items / Qty:</span>
            <span>${data.totalItems || items.length} / ${data.totalQuantity || items.reduce((acc, i) => acc + (Number(i.qty) || 1), 0)}</span>
          </div>
          ${profile.showDiscount && data.discountTotal > 0 ? `
            <div class="flex-between" style="color: #16a34a;">
              <span>Total Discount:</span>
              <span>- ${formatCurrency(data.discountTotal)}</span>
            </div>
          ` : ""}
          ${profile.showTax && data.taxTotal > 0 ? `
            <div class="flex-between">
              <span>Total Tax (GST):</span>
              <span>${formatCurrency(data.taxTotal)}</span>
            </div>
          ` : ""}
        </div>

        <div class="solid-divider"></div>

        <div class="flex-between" style="font-size: 115%; font-weight: 800; padding: 2px 0;">
          <span>GRAND TOTAL:</span>
          <span>${formatCurrency(data.totalAmount || data.total)}</span>
        </div>

        <div class="double-divider"></div>
      ` : ""}

      ${profile.showQrCode && (data.upiId || data.upiQr) ? `
        <div class="qr-container">
          <img 
            src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
              `upi://pay?pa=${data.upiId || 'store@upi'}&pn=${encodeURIComponent(storeName)}&am=${data.totalAmount || data.total}&cu=INR`
            )}" 
            alt="UPI QR" 
            class="qr-img" 
          />
          <div style="font-size: 75%; color: #666; margin-top: 2px;">Scan & Pay with any UPI App</div>
        </div>
      ` : ""}

      ${profile.footerMessage ? `
        <div class="text-center" style="margin-top: 8px; font-size: 90%; font-weight: 600;">
          ${profile.footerMessage}
        </div>
      ` : ""}

      ${profile.showTerms && profile.termsAndConditions ? `
        <div style="margin-top: 6px; font-size: 75%; color: #555; text-align: center; white-space: pre-line;">
          ${profile.termsAndConditions}
        </div>
      ` : ""}
    </div>
  `;
};

/**
 * Builds HTML string for Sheet Invoices (A4, A5, A6).
 */
export const buildSheetInvoiceHtml = (data, profile) => {
  const storeName = profile.headerTitle || data.storeName || "KADAI SUPER STORE";
  const docTitle = profile.headerSubtitle || data.docTitle || "TAX INVOICE";
  const items = data.items || [];

  return `
    <div class="sheet-invoice">
      <!-- Top Header -->
      <div class="invoice-header-grid">
        <div style="display: flex; gap: 12px; align-items: center;">
          ${profile.showLogo && data.storeLogo ? `
            <img src="${data.storeLogo}" alt="Logo" style="max-height: 60px; max-width: 140px; object-fit: contain;" />
          ` : ""}
          <div>
            <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 2px;">${storeName}</h1>
            ${profile.showAddress && data.storeAddress ? `<div style="font-size: 12px; color: #475569;">${data.storeAddress}</div>` : ""}
            ${profile.showContact && (data.storePhone || data.storeEmail) ? `
              <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                ${data.storePhone ? `Phone: ${data.storePhone}` : ""}
                ${data.storePhone && data.storeEmail ? " | " : ""}
                ${data.storeEmail ? `Email: ${data.storeEmail}` : ""}
              </div>
            ` : ""}
            ${profile.showGst && data.storeGst ? `<div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-top: 2px;">GSTIN: ${data.storeGst}</div>` : ""}
          </div>
        </div>

        <div style="text-align: right;">
          <div style="font-size: 20px; font-weight: 800; color: #fc8019; letter-spacing: 0.5px;">${docTitle}</div>
          <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-top: 4px;">Invoice #: ${data.billNo || data.id}</div>
          <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Date: ${data.orderDate || new Date().toLocaleDateString("en-IN")}</div>
        </div>
      </div>

      <!-- Customer & Invoice Meta Grid -->
      <div class="meta-box-grid">
        <div>
          <div style="font-weight: 700; color: #334155; margin-bottom: 4px; text-transform: uppercase;">Billed To / Customer:</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${data.customerName || "Walk-in Customer"}</div>
          ${data.customerPhone ? `<div>Contact: ${data.customerPhone}</div>` : ""}
          ${profile.showAddress && data.customerAddress ? `<div>Address: ${data.customerAddress}</div>` : ""}
          ${profile.showGst && data.customerGst ? `<div style="font-weight: 600;">Customer GSTIN: ${data.customerGst}</div>` : ""}
        </div>
        <div style="text-align: right;">
          <div style="font-weight: 700; color: #334155; margin-bottom: 4px; text-transform: uppercase;">Payment Details:</div>
          <div>Payment Mode: <strong>${data.paymentMethod || "Cash"}</strong></div>
          <div>Status: <span style="color: #16a34a; font-weight: 700;">PAID & CONFIRMED</span></div>
          ${profile.showBilledBy && data.billedBy ? `<div>Generated By: ${data.billedBy}</div>` : ""}
        </div>
      </div>

      <!-- Items Table -->
      <table class="sheet-table">
        <thead>
          <tr>
            <th style="width: 5%; text-align: center;">#</th>
            <th style="width: 45%;">Description of Goods / Services</th>
            <th style="width: 10%; text-align: center;">HSN</th>
            <th style="width: 10%; text-align: center;">Qty</th>
            <th style="width: 15%; text-align: right;">Unit Rate</th>
            <th style="width: 15%; text-align: right;">Total Amount</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item, idx) => `
            <tr class="avoid-page-break">
              <td style="text-align: center;">${idx + 1}</td>
              <td>
                <div style="font-weight: 700; color: #0f172a;">${item.name || item.itemName}</div>
                ${profile.showItemDescription && item.brand ? `<div style="font-size: 11px; color: #64748b;">Brand: ${item.brand}</div>` : ""}
              </td>
              <td style="text-align: center; color: #64748b;">${item.hsn || "-"}</td>
              <td style="text-align: center; font-weight: 700;">${item.qty}</td>
              <td style="text-align: right;">${formatCurrency(item.price || item.salesPrice || 0)}</td>
              <td style="text-align: right; font-weight: 700;">${formatCurrency((item.price || item.salesPrice || 0) * item.qty)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <!-- Bottom Summary, Payment QR & Signature -->
      <div class="summary-grid avoid-page-break" style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 14px; gap: 20px;">
        <!-- Left: Payment QR Code & Bank/UPI Info -->
        <div style="flex: 1; max-width: 320px;">
          ${profile.showQrCode && (data.upiId || data.upiQr) ? `
            <div style="display: flex; gap: 14px; align-items: center; padding: 12px; border: 1px dashed #cbd5e1; border-radius: 6px; background-color: #f8fafc;">
              <img 
                src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                  `upi://pay?pa=${data.upiId || 'store@upi'}&pn=${encodeURIComponent(storeName)}&am=${data.totalAmount || data.total}&cu=INR`
                )}" 
                alt="UPI QR" 
                style="width: 85px; height: 85px; object-fit: contain; border-radius: 4px; background: #fff; padding: 2px;"
              />
              <div style="font-size: 11px; line-height: 1.4;">
                <div style="font-weight: 800; color: #0f172a; margin-bottom: 2px;">⚡ Scan & Pay via UPI</div>
                <div style="color: #475569;">UPI ID: <strong style="color: #0f172a;">${data.upiId}</strong></div>
                <div style="color: #16a34a; font-weight: 700; margin-top: 3px;">Amount: ${formatCurrency(data.totalAmount || data.total)}</div>
                <div style="font-size: 10px; color: #64748b; margin-top: 2px;">GPay • PhonePe • Paytm • BHIM</div>
              </div>
            </div>
          ` : ""}
        </div>

        <!-- Right: Summary Table -->
        <table class="summary-table">
          <tr>
            <td>Subtotal:</td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(data.subtotal || data.totalAmount)}</td>
          </tr>
          ${profile.showDiscount && data.discountTotal > 0 ? `
            <tr style="color: #16a34a;">
              <td>Discount:</td>
              <td style="text-align: right;">- ${formatCurrency(data.discountTotal)}</td>
            </tr>
          ` : ""}
          ${profile.showTax && data.taxTotal > 0 ? `
            <tr>
              <td>Applicable GST:</td>
              <td style="text-align: right;">${formatCurrency(data.taxTotal)}</td>
            </tr>
          ` : ""}
          <tr style="border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; font-size: 15px; font-weight: 800;">
            <td style="padding: 8px;">Total (INR):</td>
            <td style="padding: 8px; text-align: right; color: #fc8019;">${formatCurrency(data.totalAmount || data.total)}</td>
          </tr>
        </table>
      </div>

      <!-- Footer / Terms / Signatory -->
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 28px; padding-top: 14px; border-top: 1px solid #e2e8f0;" class="avoid-page-break">
        <div style="max-width: 60%;">
          ${profile.showTerms && profile.termsAndConditions ? `
            <div style="font-size: 10px; color: #64748b; margin-bottom: 6px;">
              <strong>Terms & Conditions:</strong><br />
              <span style="white-space: pre-line;">${profile.termsAndConditions}</span>
            </div>
          ` : ""}
          ${profile.footerMessage ? `
            <div style="font-size: 12px; font-weight: 700; color: #334155;">
              ${profile.footerMessage}
            </div>
          ` : ""}
        </div>

        <div style="text-align: center; min-width: 160px;">
          <div style="height: 40px;"></div>
          <div style="border-top: 1px dashed #94a3b8; padding-top: 4px; font-size: 11px; font-weight: 700; color: #334155;">
            Authorized Signatory<br />
            <span style="font-size: 10px; font-weight: normal; color: #64748b;">For ${storeName}</span>
          </div>
        </div>
      </div>
    </div>
  `;
};

/**
 * Builds the complete stand-alone HTML document ready for printing or preview.
 */
export const generatePrintHtml = (documentData, printSettings, docType = "posReceipt") => {
  const settings = normalizePrintSettings(printSettings);
  const profile = settings.profiles[docType] || settings.profiles.posReceipt;
  const isThermal = PAPER_PROFILES[profile.paperSize]?.isContinuous ?? true;

  const styles = buildPrintStyles(profile);
  const bodyContent = isThermal
    ? buildThermalReceiptHtml(documentData, profile)
    : buildSheetInvoiceHtml(documentData, profile);

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${documentData.docTitle || "Invoice"} - ${documentData.billNo || documentData.id}</title>
        <style>
          ${styles}
        </style>
      </head>
      <body>
        <div class="print-container">
          ${bodyContent}
        </div>
      </body>
    </html>
  `;
};

/**
 * Executes a clean browser print using a dedicated hidden iframe.
 * Avoids popup blockers and does not disrupt the active application window.
 */
export const executePrint = (documentData, printSettings, docType = "posReceipt") => {
  return new Promise((resolve, reject) => {
    try {
      const html = generatePrintHtml(documentData, printSettings, docType);

      // Remove any existing print iframe
      const oldFrame = document.getElementById("kadai_print_frame");
      if (oldFrame) {
        document.body.removeChild(oldFrame);
      }

      // Create new hidden iframe
      const iframe = document.createElement("iframe");
      iframe.id = "kadai_print_frame";
      iframe.style.position = "fixed";
      iframe.style.top = "-9999px";
      iframe.style.left = "-9999px";
      iframe.style.width = "0px";
      iframe.style.height = "0px";
      iframe.style.border = "none";
      iframe.style.zIndex = "-1000";

      document.body.appendChild(iframe);

      const frameDoc = iframe.contentWindow || iframe.contentDocument;
      const targetDoc = frameDoc.document || frameDoc;

      targetDoc.open();
      targetDoc.write(html);
      targetDoc.close();

      // Wait for content, fonts, and images to render
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
          resolve({ success: true, message: "Print dialog dispatched." });
        } catch (printErr) {
          console.error("Iframe print error:", printErr);
          // Fallback to window.open if iframe printing is blocked
          const popup = window.open("", "_blank", "width=800,height=900");
          if (popup) {
            popup.document.write(html);
            popup.document.close();
            popup.focus();
            setTimeout(() => {
              popup.print();
              popup.close();
              resolve({ success: true, message: "Printed via fallback window." });
            }, 400);
          } else {
            reject(new Error("Unable to open print dialog. Please check browser popup/print permissions."));
          }
        } finally {
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 60000); // Clean up after print dialog finishes
        }
      }, 350);
    } catch (err) {
      console.error("executePrint fatal error:", err);
      reject(err);
    }
  });
};
