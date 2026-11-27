import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export const DEFAULT_CRM_CONFIG = {
  loyaltyEnabled: true,
  pointsPerRupees: 100,
  pointsValueInRupees: 1,
  minBillForRedeem: 100,
  maxRedeemPercent: 50,
  defaultCreditLimit: 5000,
  autoTagVipSpend: 5000,
  autoTagVipOrders: 10,
};

export const normalizePhone10 = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

export const isValidPhone10 = (value) => /^\d{10}$/.test(normalizePhone10(value));

export const formatPhoneE164 = (value) => {
  const phone10 = normalizePhone10(value);
  return phone10.length === 10 ? `+91${phone10}` : "";
};

export const mergeCrmConfig = (raw = {}) => ({
  loyaltyEnabled: raw?.loyaltyEnabled ?? DEFAULT_CRM_CONFIG.loyaltyEnabled,
  pointsPerRupees: Math.max(1, Number(raw?.pointsPerRupees || DEFAULT_CRM_CONFIG.pointsPerRupees)),
  pointsValueInRupees: Math.max(0.1, Number(raw?.pointsValueInRupees || DEFAULT_CRM_CONFIG.pointsValueInRupees)),
  minBillForRedeem: Math.max(0, Number(raw?.minBillForRedeem ?? DEFAULT_CRM_CONFIG.minBillForRedeem)),
  maxRedeemPercent: Math.min(100, Math.max(1, Number(raw?.maxRedeemPercent || DEFAULT_CRM_CONFIG.maxRedeemPercent))),
  defaultCreditLimit: Math.max(0, Number(raw?.defaultCreditLimit ?? DEFAULT_CRM_CONFIG.defaultCreditLimit)),
  autoTagVipSpend: Math.max(500, Number(raw?.autoTagVipSpend || DEFAULT_CRM_CONFIG.autoTagVipSpend)),
  autoTagVipOrders: Math.max(2, Number(raw?.autoTagVipOrders || DEFAULT_CRM_CONFIG.autoTagVipOrders)),
});

export const calculateEarnedPoints = (netPayableAmount, crmConfig = DEFAULT_CRM_CONFIG) => {
  const cfg = mergeCrmConfig(crmConfig);
  if (!cfg.loyaltyEnabled) return 0;
  const amount = Number(netPayableAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount / cfg.pointsPerRupees);
};

export const calculateMaxRedeemable = (availablePoints, billTotal, crmConfig = DEFAULT_CRM_CONFIG) => {
  const cfg = mergeCrmConfig(crmConfig);
  const pts = Math.max(0, Math.floor(Number(availablePoints || 0)));
  const total = Math.max(0, Number(billTotal || 0));
  if (!cfg.loyaltyEnabled || pts <= 0 || total < cfg.minBillForRedeem) {
    return { maxPoints: 0, maxDiscount: 0 };
  }
  const maxAllowedDiscount = (total * cfg.maxRedeemPercent) / 100;
  const maxPointsByDiscount = Math.floor(maxAllowedDiscount / cfg.pointsValueInRupees);
  const usablePoints = Math.min(pts, maxPointsByDiscount);
  const discountAmount = Number((usablePoints * cfg.pointsValueInRupees).toFixed(2));
  return { maxPoints: usablePoints, maxDiscount: discountAmount };
};

export const getShopCustomerByPhone = async (shopId, rawPhone) => {
  const phone10 = normalizePhone10(rawPhone);
  if (!shopId || phone10.length !== 10) return null;
  const snap = await getDoc(doc(db, "users", shopId, "customers", phone10));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
};

export const upsertShopCustomer = async (shopId, payload = {}) => {
  const phone10 = normalizePhone10(payload.phone);
  if (!shopId || phone10.length !== 10) {
    throw new Error("Please enter a valid 10-digit mobile number.");
  }

  const ref = doc(db, "users", shopId, "customers", phone10);
  const cleanName = String(payload.name || "").trim() || "Customer";

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? snap.data() || {} : {};
    const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
    const incomingTags = Array.isArray(payload.tags) ? payload.tags : existingTags;
    const nextSource =
      existing.source && payload.source && existing.source !== payload.source
        ? "both"
        : existing.source || payload.source || "pos";

    const nextDoc = {
      id: phone10,
      phone: phone10,
      phoneE164: formatPhoneE164(phone10),
      name: cleanName || existing.name || "Customer",
      email: String(payload.email ?? existing.email ?? "").trim(),
      customerUid: String(payload.customerUid ?? existing.customerUid ?? ""),
      source: nextSource,
      tags: [...new Set(incomingTags)],
      notes: String(payload.notes ?? existing.notes ?? "").trim(),
      defaultAddress: String(payload.defaultAddress ?? existing.defaultAddress ?? "").trim(),
      gstin: String(payload.gstin ?? existing.gstin ?? "").trim().toUpperCase(),
      creditLimit: Number(payload.creditLimit ?? existing.creditLimit ?? DEFAULT_CRM_CONFIG.defaultCreditLimit),
      creditBalance: Number(existing.creditBalance || 0),
      loyaltyPoints: Number(existing.loyaltyPoints || 0),
      totalOrders: Number(existing.totalOrders || 0),
      posOrders: Number(existing.posOrders || 0),
      onlineOrders: Number(existing.onlineOrders || 0),
      totalSpent: Number(existing.totalSpent || 0),
      updatedAt: serverTimestamp(),
      createdAt: existing.createdAt || serverTimestamp(),
    };

    tx.set(ref, nextDoc, { merge: true });
    return nextDoc;
  });
};

export const updateShopCustomerMeta = async (shopId, phone, updates = {}) => {
  const phone10 = normalizePhone10(phone);
  if (!shopId || phone10.length !== 10) {
    throw new Error("Valid customer phone is required.");
  }
  const ref = doc(db, "users", shopId, "customers", phone10);
  const cleanUpdates = { ...updates, updatedAt: serverTimestamp() };
  if (cleanUpdates.name !== undefined) {
    cleanUpdates.name = String(cleanUpdates.name || "").trim() || "Customer";
  }
  if (cleanUpdates.gstin !== undefined) {
    cleanUpdates.gstin = String(cleanUpdates.gstin || "").trim().toUpperCase();
  }
  if (cleanUpdates.creditLimit !== undefined) {
    cleanUpdates.creditLimit = Math.max(0, Number(cleanUpdates.creditLimit || 0));
  }
  await updateDoc(ref, cleanUpdates);
};

export const recordPosSaleCustomerTransaction = async ({
  shopId,
  customer,
  billNo,
  grossTotal,
  netPayable,
  paymentMode,
  loyaltyRedeemedPoints = 0,
  loyaltyDiscountAmount = 0,
  crmConfig = DEFAULT_CRM_CONFIG,
  staffName = "Owner",
  shopName = "",
}) => {
  const phone10 = normalizePhone10(customer?.phone);
  if (!shopId || phone10.length !== 10) return null;

  const cfg = mergeCrmConfig(crmConfig);
  const customerRef = doc(db, "users", shopId, "customers", phone10);
  const ledgerColRef = collection(db, "users", shopId, "customers", phone10, "ledger");

  const redeemed = Math.max(0, Math.floor(Number(loyaltyRedeemedPoints || 0)));
  const discount = Math.max(0, Number(loyaltyDiscountAmount || 0));
  const payable = Math.max(0, Number(netPayable ?? grossTotal ?? 0));
  const normalizedPayMode = String(paymentMode || "").toUpperCase();
  const isCredit = normalizedPayMode === "CREDIT" || normalizedPayMode === "KHATA";
  const earned = isCredit ? 0 : calculateEarnedPoints(payable, cfg);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(customerRef);
    const existing = snap.exists() ? snap.data() || {} : {};
    const currentPoints = Math.max(0, Number(existing.loyaltyPoints || 0));
    const currentCredit = Math.max(0, Number(existing.creditBalance || 0));
    const creditLimit = Number(existing.creditLimit ?? cfg.defaultCreditLimit);

    if (redeemed > currentPoints) {
      throw new Error("Insufficient loyalty points on customer account.");
    }

    if (isCredit && creditLimit > 0 && currentCredit + payable > creditLimit) {
      throw new Error(
        `Credit limit exceeded! Limit: ₹${creditLimit.toFixed(0)}, Current Due: ₹${currentCredit.toFixed(0)}`
      );
    }

    const nextPoints = Math.max(0, currentPoints - redeemed + earned);
    const nextCredit = isCredit ? Number((currentCredit + payable).toFixed(2)) : currentCredit;
    const nextOrders = Number(existing.totalOrders || 0) + 1;
    const nextPosOrders = Number(existing.posOrders || 0) + 1;
    const nextSpent = Number((Number(existing.totalSpent || 0) + payable).toFixed(2));

    const tagSet = new Set(Array.isArray(existing.tags) ? existing.tags : []);
    if (isCredit) tagSet.add("Credit");
    if (nextOrders >= 3 && !tagSet.has("VIP")) tagSet.add("Regular");
    if (nextSpent >= cfg.autoTagVipSpend || nextOrders >= cfg.autoTagVipOrders) {
      tagSet.add("VIP");
    }

    const nextSource =
      existing.source === "website" || existing.source === "both" ? "both" : "pos";

    const updatedCustomer = {
      id: phone10,
      phone: phone10,
      phoneE164: formatPhoneE164(phone10),
      name: String(customer?.name || existing.name || "Customer").trim(),
      email: String(customer?.email || existing.email || "").trim(),
      customerUid: String(customer?.customerUid || existing.customerUid || ""),
      source: nextSource,
      tags: [...tagSet],
      notes: String(existing.notes || ""),
      defaultAddress: String(customer?.defaultAddress || existing.defaultAddress || ""),
      gstin: String(customer?.gstin || existing.gstin || ""),
      creditLimit,
      creditBalance: nextCredit,
      loyaltyPoints: nextPoints,
      totalOrders: nextOrders,
      posOrders: nextPosOrders,
      onlineOrders: Number(existing.onlineOrders || 0),
      totalSpent: nextSpent,
      lastOrderAt: serverTimestamp(),
      lastBillNo: billNo,
      updatedAt: serverTimestamp(),
      createdAt: existing.createdAt || serverTimestamp(),
    };

    tx.set(customerRef, updatedCustomer, { merge: true });

    if (isCredit && payable > 0) {
      tx.set(doc(ledgerColRef), {
        type: "credit_sale",
        amount: payable,
        balanceAfter: nextCredit,
        billNo: billNo || "",
        shopName,
        staffName,
        note: `Credit bill ${billNo || ""}`.trim(),
        createdAt: serverTimestamp(),
      });
    }

    if (redeemed > 0) {
      tx.set(doc(ledgerColRef), {
        type: "loyalty_redeem",
        points: -redeemed,
        discountAmount: discount,
        pointsAfter: currentPoints - redeemed,
        billNo: billNo || "",
        staffName,
        note: `Redeemed ${redeemed} pts (-₹${discount.toFixed(2)}) on ${billNo}`,
        createdAt: serverTimestamp(),
      });
    }

    if (earned > 0) {
      tx.set(doc(ledgerColRef), {
        type: "loyalty_earn",
        points: earned,
        pointsAfter: nextPoints,
        billNo: billNo || "",
        staffName,
        note: `Earned ${earned} pts on bill ${billNo}`,
        createdAt: serverTimestamp(),
      });
    }

    return {
      ...updatedCustomer,
      earnedPoints: earned,
      redeemedPoints: redeemed,
      discountAmount: discount,
    };
  });
};

export const recordCreditPayment = async ({
  shopId,
  phone,
  amount,
  paymentMode = "CASH",
  note = "",
  staffName = "Owner",
}) => {
  const phone10 = normalizePhone10(phone);
  const payAmount = Number(amount || 0);
  if (!shopId || phone10.length !== 10) {
    throw new Error("Invalid customer phone number.");
  }
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    throw new Error("Enter a valid payment amount greater than 0.");
  }

  const customerRef = doc(db, "users", shopId, "customers", phone10);
  const ledgerRef = doc(collection(db, "users", shopId, "customers", phone10, "ledger"));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(customerRef);
    if (!snap.exists()) throw new Error("Customer record not found.");
    const existing = snap.data() || {};
    const currentCredit = Math.max(0, Number(existing.creditBalance || 0));
    const applied = Math.min(currentCredit, Number(payAmount.toFixed(2)));
    const nextCredit = Math.max(0, Number((currentCredit - payAmount).toFixed(2)));

    tx.update(customerRef, {
      creditBalance: nextCredit,
      lastPaymentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    tx.set(ledgerRef, {
      type: "payment_received",
      amount: payAmount,
      appliedAmount: applied,
      paymentMode,
      balanceAfter: nextCredit,
      staffName,
      note: note.trim() || `Khata payment received via ${paymentMode}`,
      createdAt: serverTimestamp(),
    });

    return { previousCredit: currentCredit, nextCredit, amount: payAmount };
  });
};

export const adjustCustomerLoyaltyPoints = async ({
  shopId,
  phone,
  deltaPoints,
  reason = "Manual adjustment",
  staffName = "Owner",
}) => {
  const phone10 = normalizePhone10(phone);
  const delta = Math.trunc(Number(deltaPoints || 0));
  if (!shopId || phone10.length !== 10 || delta === 0) {
    throw new Error("Enter valid non-zero points.");
  }

  const customerRef = doc(db, "users", shopId, "customers", phone10);
  const ledgerRef = doc(collection(db, "users", shopId, "customers", phone10, "ledger"));

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(customerRef);
    if (!snap.exists()) throw new Error("Customer not found.");
    const existing = snap.data() || {};
    const current = Math.max(0, Number(existing.loyaltyPoints || 0));
    const next = Math.max(0, current + delta);

    tx.update(customerRef, {
      loyaltyPoints: next,
      updatedAt: serverTimestamp(),
    });

    tx.set(ledgerRef, {
      type: "manual_adjust",
      points: delta,
      pointsAfter: next,
      staffName,
      note: reason.trim() || "Manual points adjustment",
      createdAt: serverTimestamp(),
    });

    return { previousPoints: current, nextPoints: next };
  });
};

export const fetchCustomerLedger = async (shopId, phone, maxItems = 40) => {
  const phone10 = normalizePhone10(phone);
  if (!shopId || phone10.length !== 10) return [];
  const q = query(
    collection(db, "users", shopId, "customers", phone10, "ledger"),
    orderBy("createdAt", "desc"),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const buildWhatsAppReminderMessage = ({
  shopName,
  customerName,
  creditBalance,
  upiId = "",
}) => {
  const lines = [
    `Hello ${customerName || "Customer"} 🙏`,
    `Gentle reminder from *${shopName || "Our Store"}*.`,
    ``,
    `Your pending Khata (Credit) balance is *₹${Number(creditBalance || 0).toFixed(2)}*.`,
  ];
  if (upiId) {
    lines.push(`You can pay via UPI ID: *${upiId}*`);
  }
  lines.push(``, `Please ignore if already paid. Thank you!`);
  return lines.join("\n");
};

export const openWhatsAppChat = (rawPhone, message) => {
  const phone10 = normalizePhone10(rawPhone);
  if (phone10.length !== 10) {
    throw new Error("Valid 10-digit phone number required for WhatsApp.");
  }
  const url = `https://wa.me/91${phone10}?text=${encodeURIComponent(message || "")}`;
  window.open(url, "_blank", "noopener,noreferrer");
};
