import { useState, useEffect, useRef } from "react";
import { doc, getDoc, updateDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../utils/firebase";
import {
  createSubscriptionOrder,
  verifySubscriptionPayment,
} from "../services/subscriptionPaymentService";
import {
  PLAN_NAMES,
  PLAN_CONFIG,
  BILLING_CYCLES,
  normalizePlanName,
  calculateNewExpiry,
  formatExpiryDate,
  getPlanLimits,
  resolveUserSubscription,
} from "../utils/subscriptionService";

function generateShopUid(uid) {
  if (uid && typeof uid === "string" && uid.length >= 6) {
    return `UID-${uid.substring(0, 6).toUpperCase()}`;
  }
  return `UID-${Math.floor(100000 + Math.random() * 900000)}`;
}

export default function Subscription({ onBack, onSubscriptionUpdated, inventoryCount = 0 }) {
  const [userData, setUserData] = useState(null);
  const [billingCycle, setBillingCycle] = useState(BILLING_CYCLES.MONTHLY);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingPlanKey, setProcessingPlanKey] = useState(null);
  const [successModal, setSuccessModal] = useState({ show: false, planName: "", cycle: "", expiry: null });
  const [approvalModal, setApprovalModal] = useState(false);
  const isSubscribingRef = useRef(false);

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");

  // Real-time synchronization of user data from Firestore
  useEffect(() => {
    if (!currentUid) return;
    const userRef = doc(db, "users", currentUid);
    const unsubscribe = onSnapshot(
      userRef,
      (userSnap) => {
        if (userSnap.exists()) {
          const data = userSnap.data();
          setUserData(data);
          if (data.subscriptionCycle === BILLING_CYCLES.YEARLY) {
            setBillingCycle(BILLING_CYCLES.YEARLY);
          }
        }
      },
      (err) => {
        console.error("Error subscribing to user in Subscription:", err);
      }
    );

    return () => unsubscribe();
  }, [currentUid]);

  const userSub = resolveUserSubscription(userData);
  const isExpired = userSub.isExpired;
  const currentPlan = userSub.plan;
  const userCycle = userSub.cycle;
  const remainingDays = userSub.remainingDays;
  const formattedExpiry = userSub.formattedExpiry;
  const shopUid = userData?.customShopUid || (currentUid ? `UID-${currentUid.substring(0, 6).toUpperCase()}` : "N/A");

  const plans = [
    {
      name: PLAN_NAMES.BASIC,
      displayName: "Basic",
      tagline: "Ideal for small kiosks & startup vendors",
      priceMonthly: 0,
      priceYearly: 0,
      days: 365,
      color: PLAN_CONFIG[PLAN_NAMES.BASIC].color,
      badge: "Free Forever",
      badgeColor: "#6366f1",
      features: [
        { text: "Unlimited Barcode Scans", included: true },
        { text: "Inventory Limit: Max 10 Items", included: true },
        { text: "Sales & Purchase Limit: Max 10", included: true },
        { text: "Reports: Last 1 Month Only", included: true },
        { text: "Hold Bill & Split Tender", included: false },
        { text: "Priority Support & Multi-device", included: false },
      ],
    },
    {
      name: PLAN_NAMES.PREMIUM,
      displayName: "Premium",
      tagline: "Great for growing grocery & retail shops",
      priceMonthly: 499,
      priceYearly: 4999,
      daysMonthly: 30,
      daysYearly: 365,
      color: PLAN_CONFIG[PLAN_NAMES.PREMIUM].color,
      badge: "🌟 Most Popular",
      badgeColor: "#10b981",
      features: [
        { text: "Unlimited Barcode Scans", included: true },
        { text: "Inventory Limit: Up to 200 Items", included: true },
        { text: "Purchases & Orders: Up to 200", included: true },
        { text: "Reports: Last 3 Months", included: true },
        { text: "Hold Bill & Custom Receipt Print", included: true },
        { text: "Direct WhatsApp Invoicing", included: true },
      ],
    },
    {
      name: PLAN_NAMES.PRO,
      displayName: "Pro",
      tagline: "For busy supermarkets, restaurants & chains",
      priceMonthly: 1999,
      priceYearly: 19999,
      daysMonthly: 30,
      daysYearly: 365,
      color: PLAN_CONFIG[PLAN_NAMES.PRO].color,
      badge: "🚀 Ultimate Growth",
      badgeColor: "#f59e0b",
      features: [
        { text: "Unlimited Barcode Scans", included: true },
        { text: "Unlimited Inventory Storage (No Cap)", included: true },
        { text: "Unlimited Orders & Purchases", included: true },
        { text: "Reports: All Time (Unlimited History)", included: true },
        { text: "Speed Dial & Restaurant Kitchen POS", included: true },
        { text: "Dedicated Priority 24/7 Support", included: true },
      ],
    },
  ];

  // Subscribe / Upgrade / Renew Handler
  const handleSelectPlan = async (planItem) => {
    if (isSubscribingRef.current || isProcessing) return;

    if (!currentUid) {
      alert("Please sign in to manage your subscription.");
      return;
    }

    // Check if user is already actively on this plan with the same cycle
    const isSamePlan = currentPlan.toLowerCase() === planItem.name.toLowerCase();
    const isSameCycle = userCycle === billingCycle;
    if (isSamePlan && isSameCycle && !isExpired && planItem.name === PLAN_NAMES.BASIC) {
      alert(`You are currently on the active ${planItem.name} plan.`);
      return;
    }

    isSubscribingRef.current = true;
    const planKey = `${planItem.name}-${billingCycle}`;
    setProcessingPlanKey(planKey);
    setIsProcessing(true);

    // 1. FREE BASIC PLAN ACTIVATION
    if (planItem.name === PLAN_NAMES.BASIC) {
      try {
        const userRef = doc(db, "users", currentUid);
        const userSnap = await getDoc(userRef);
        let assignedUid = userSnap.data()?.customShopUid;
        if (!assignedUid || assignedUid === currentUid) {
          assignedUid = generateShopUid(currentUid);
        }

        const currentExpiry = userData?.subscriptionExpiry ? Number(userData.subscriptionExpiry) : null;
        const newExpiry = calculateNewExpiry(365, currentExpiry);
        const limits = getPlanLimits(PLAN_NAMES.BASIC);

        await updateDoc(userRef, {
          userPlan: PLAN_NAMES.BASIC,
          subscriptionPlan: PLAN_NAMES.BASIC,
          subscriptionCycle: BILLING_CYCLES.YEARLY,
          subscriptionDays: 365,
          subscriptionActive: true,
          subscriptionExpiry: newExpiry,
          customShopUid: assignedUid,
          inventoryLimit: limits.inventoryLimit,
          purchaseLimit: limits.purchaseLimit,
          reportLimitMonths: limits.reportLimitMonths,
          lastUpdated: serverTimestamp(),
        });

        if (onSubscriptionUpdated) await onSubscriptionUpdated();

        setSuccessModal({
          show: true,
          planName: PLAN_NAMES.BASIC,
          cycle: BILLING_CYCLES.YEARLY,
          expiry: newExpiry,
        });
      } catch (err) {
        console.error("Basic plan activation error:", err);
        alert(err?.message || "Failed to switch to Basic plan. Please try again.");
      } finally {
        setIsProcessing(false);
        setProcessingPlanKey(null);
        isSubscribingRef.current = false;
      }
      return;
    }

    // 2. PAID PLANS (PREMIUM & PRO) VIA RAZORPAY SERVER-SIDE ARCHITECTURE
    try {
      // Step A: Request server-side Razorpay Order from Cloud Function
      const orderResult = await createSubscriptionOrder({
        plan: planItem.name,
        cycle: billingCycle,
      });

      const { orderId, amount, currency, keyId } = orderResult;
      if (!orderId || !keyId) {
        throw new Error("Unable to create subscription order. Please check your network and try again.");
      }

      // Step B: Verify window.Razorpay is available
      if (typeof window.Razorpay === "undefined") {
        throw new Error("Razorpay checkout is currently unavailable. Please refresh the page or check your connection.");
      }

      const userEmail = auth.currentUser?.email || userData?.email || "";
      const userPhone = userData?.phone || userData?.mobile || auth.currentUser?.phoneNumber || "";
      const storeDisplayName = userData?.storeName || userData?.shopName || "Upstage Kadai POS";
      const ownerName = userData?.name || userData?.ownerName || storeDisplayName;

      // Step C: Initialize Razorpay Checkout Modal
      const options = {
        key: keyId,
        amount: amount,
        currency: currency || "INR",
        name: storeDisplayName,
        description: `${planItem.displayName} (${billingCycle === BILLING_CYCLES.YEARLY ? "Yearly" : "Monthly"}) Subscription`,
        order_id: orderId,
        image: userData?.profileImage || userData?.shopLogo || "https://upstageindia.com/favicon.svg",
        prefill: {
          name: ownerName,
          email: userEmail,
          contact: userPhone,
        },
        notes: {
          uid: currentUid,
          plan: planItem.name,
          cycle: billingCycle,
          platform: "kadai_web",
        },
        theme: {
          color: planItem.color,
        },
        handler: async function (response) {
          try {
            const returnedOrderId = response?.razorpay_order_id || orderId;
            const paymentId = response?.razorpay_payment_id;
            const signature = response?.razorpay_signature;

            if (!paymentId || !signature) {
              throw new Error("Payment gateway did not return valid verification details.");
            }

            // Step D: Cryptographic HMAC-SHA256 verification on backend
            const verifyResult = await verifySubscriptionPayment({
              orderId: returnedOrderId,
              paymentId,
              signature,
            });

            if (!verifyResult || !verifyResult.success || verifyResult.status !== "ACTIVATED") {
              throw new Error("Server payment verification could not confirm activation.");
            }

            if (onSubscriptionUpdated) await onSubscriptionUpdated();

            setSuccessModal({
              show: true,
              planName: planItem.displayName,
              cycle: billingCycle,
              expiry: verifyResult.expiry,
            });
          } catch (verifyErr) {
            console.error("Verification error:", verifyErr);
            alert(verifyErr?.message || "Payment verification failed. If amount was debited, your plan will activate shortly via webhook.");
          } finally {
            setIsProcessing(false);
            setProcessingPlanKey(null);
            isSubscribingRef.current = false;
          }
        },
        modal: {
          ondismiss: function () {
            setIsProcessing(false);
            setProcessingPlanKey(null);
            isSubscribingRef.current = false;
          },
        },
      };

      const rzpInstance = new window.Razorpay(options);

      rzpInstance.on("payment.failed", function (response) {
        console.error("Razorpay payment failed:", response.error);
        const errMsg = response.error?.description || response.error?.reason || "Payment could not be completed.";
        // Check for website domain authorization warning
        if (errMsg.toLowerCase().includes("domain") || errMsg.toLowerCase().includes("website") || errMsg.toLowerCase().includes("unauthorized")) {
          setApprovalModal(true);
        } else {
          alert(`Payment Failed: ${errMsg}`);
        }
        setIsProcessing(false);
        setProcessingPlanKey(null);
        isSubscribingRef.current = false;
      });

      rzpInstance.open();
    } catch (error) {
      console.error("Subscription initiation error:", error);
      const errMsg = error?.message || "Failed to start payment. Please try again.";
      if (errMsg.toLowerCase().includes("domain") || errMsg.toLowerCase().includes("website") || errMsg.toLowerCase().includes("unauthorized")) {
        setApprovalModal(true);
      } else {
        alert(errMsg);
      }
      setIsProcessing(false);
      setProcessingPlanKey(null);
      isSubscribingRef.current = false;
    }
  };

  const getPlanBadgeColor = (plan) => {
    const p = normalizePlanName(plan);
    if (p === PLAN_NAMES.PRO) return "#f59e0b";
    if (p === PLAN_NAMES.PREMIUM) return "#10b981";
    return "#6366f1";
  };

  return (
    <div style={styles.container}>
      {/* Top Header / Breadcrumb */}
      <div style={styles.headerRow}>
        <div>
          {onBack && (
            <button onClick={onBack} style={styles.backBtn}>
              ← Back to POS / Dashboard
            </button>
          )}
          <h1 style={styles.pageTitle}>👑 Kadai Pro Subscription & Plans</h1>
          <p style={styles.pageSubtitle}>
            Scale your business with higher inventory capacity, multi-month analytics, and priority features.
          </p>
        </div>
      </div>

      {/* Active Plan Hero Card */}
      <div style={styles.heroCard}>
        <div style={styles.heroLeft}>
          <div style={styles.heroBadgeRow}>
            <span
              style={{
                ...styles.planBadge,
                backgroundColor: `${getPlanBadgeColor(currentPlan)}20`,
                color: getPlanBadgeColor(currentPlan),
                borderColor: getPlanBadgeColor(currentPlan),
              }}
            >
              👑 {currentPlan.toUpperCase()} PLAN
            </span>
            <span
              style={{
                ...styles.statusBadge,
                backgroundColor: isExpired ? "#fef2f2" : "#ecfdf5",
                color: isExpired ? "#ef4444" : "#10b981",
                borderColor: isExpired ? "#fca5a5" : "#a7f3d0",
              }}
            >
              {isExpired ? "⚠️ Subscription Expired" : "● Active Subscription"}
            </span>
            <span style={styles.cycleBadge}>
              Billing: {userCycle === BILLING_CYCLES.YEARLY ? "Yearly" : "Monthly"}
            </span>
          </div>

          <h2 style={styles.heroTitle}>
            {isExpired ? "Your subscription has ended" : `Active until ${formattedExpiry}`}
          </h2>
          <p style={styles.heroMeta}>
            {isExpired
              ? "Renew your plan or upgrade to continue enjoying unlimited inventory and features."
              : `You have ${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining in your current billing cycle.`}
          </p>
        </div>

        <div style={styles.heroRight}>
          <div style={styles.statBox}>
            <div style={styles.statLabel}>Assigned Shop UID</div>
            <div style={styles.statValue}>{shopUid}</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statLabel}>Inventory Usage</div>
            <div style={styles.statValue}>
              {inventoryCount} /{" "}
              {userSub.limits.inventoryLimit === -1 ? "Unlimited" : `${userSub.limits.inventoryLimit} items`}
            </div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statLabel}>Report History</div>
            <div style={styles.statValue}>
              {userSub.limits.reportLimitMonths === -1
                ? "All Time"
                : `${userSub.limits.reportLimitMonths} Month${userSub.limits.reportLimitMonths === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
      </div>

      {/* Billing Cycle Toggle */}
      <div style={styles.toggleWrapper}>
        <div style={styles.toggleContainer}>
          <button
            onClick={() => setBillingCycle(BILLING_CYCLES.MONTHLY)}
            style={{
              ...styles.toggleBtn,
              backgroundColor: billingCycle === BILLING_CYCLES.MONTHLY ? "#fc8019" : "transparent",
              color: billingCycle === BILLING_CYCLES.MONTHLY ? "#ffffff" : "#64748b",
            }}
          >
            Monthly Billing
          </button>
          <button
            onClick={() => setBillingCycle(BILLING_CYCLES.YEARLY)}
            style={{
              ...styles.toggleBtn,
              backgroundColor: billingCycle === BILLING_CYCLES.YEARLY ? "#fc8019" : "transparent",
              color: billingCycle === BILLING_CYCLES.YEARLY ? "#ffffff" : "#64748b",
            }}
          >
            Yearly Billing
            <span style={styles.discountPill}>Save ~17% (2 Mo Free!)</span>
          </button>
        </div>
      </div>

      {/* Plan Cards Grid */}
      <div style={styles.grid}>
        {plans.map((plan) => {
          const isCurrentActivePlan =
            currentPlan.toLowerCase() === plan.name.toLowerCase() &&
            (plan.name === PLAN_NAMES.BASIC || userCycle === billingCycle);

          const isMatchingPlanName = currentPlan.toLowerCase() === plan.name.toLowerCase();
          const price = billingCycle === BILLING_CYCLES.YEARLY ? plan.priceYearly : plan.priceMonthly;
          const planKey = `${plan.name}-${billingCycle}`;
          const isThisPlanProcessing = isProcessing && processingPlanKey === planKey;

          let btnText;
          let isBtnDisabled = false;

          if (isCurrentActivePlan && !isExpired) {
            if (plan.name === PLAN_NAMES.BASIC) {
              btnText = "Current Active Plan";
              isBtnDisabled = true;
            } else {
              btnText = "Renew Plan (+Days)";
              isBtnDisabled = false;
            }
          } else if (isMatchingPlanName && isExpired) {
            btnText = "Renew Expired Plan";
          } else if (plan.name === PLAN_NAMES.BASIC) {
            btnText = "Switch to Free Basic";
          } else if (currentPlan.toLowerCase() === "basic") {
            btnText = `Upgrade to ${plan.displayName}`;
          } else {
            btnText = `Switch to ${plan.displayName}`;
          }

          return (
            <div
              key={plan.name}
              style={{
                ...styles.card,
                borderColor: isCurrentActivePlan ? plan.color : "#e2e8f0",
                boxShadow: isCurrentActivePlan
                  ? `0 10px 25px -5px ${plan.color}33, 0 8px 10px -6px ${plan.color}22`
                  : "0 4px 6px -1px rgba(0,0,0,0.05)",
              }}
            >
              {plan.badge && (
                <div
                  style={{
                    ...styles.cardTopBadge,
                    backgroundColor: plan.badgeColor,
                  }}
                >
                  {plan.badge}
                </div>
              )}

              <div style={styles.cardHeader}>
                <h3 style={{ ...styles.cardTitle, color: plan.color }}>{plan.displayName}</h3>
                <p style={styles.cardTagline}>{plan.tagline}</p>
              </div>

              <div style={styles.priceContainer}>
                <span style={styles.currencySymbol}>₹</span>
                <span style={styles.priceAmount}>{price.toLocaleString("en-IN")}</span>
                <span style={styles.pricePeriod}>
                  {plan.name === PLAN_NAMES.BASIC ? "/ year" : billingCycle === BILLING_CYCLES.YEARLY ? "/ year" : "/ month"}
                </span>
              </div>

              <button
                disabled={isBtnDisabled || isProcessing}
                onClick={() => handleSelectPlan(plan)}
                style={{
                  ...styles.actionBtn,
                  backgroundColor: isBtnDisabled ? "#94a3b8" : plan.color,
                  cursor: isBtnDisabled || isProcessing ? "not-allowed" : "pointer",
                  opacity: isProcessing && !isThisPlanProcessing ? 0.6 : 1,
                }}
              >
                {isThisPlanProcessing ? (
                  <span style={styles.btnLoading}>
                    <span style={styles.spinner} />
                    Processing...
                  </span>
                ) : (
                  btnText
                )}
              </button>

              <div style={styles.featuresDivider} />

              <div style={styles.featuresList}>
                <div style={styles.featuresHeading}>Plan Features:</div>
                {plan.features.map((feat, idx) => (
                  <div key={idx} style={styles.featureItem}>
                    <span style={{ ...styles.featureIcon, color: feat.included ? "#10b981" : "#94a3b8" }}>
                      {feat.included ? "✓" : "✕"}
                    </span>
                    <span
                      style={{
                        ...styles.featureText,
                        color: feat.included ? "#334155" : "#94a3b8",
                        textDecoration: feat.included ? "none" : "line-through",
                      }}
                    >
                      {feat.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Trust & Guarantee Banner */}
      <div style={styles.trustBanner}>
        <div style={styles.trustItem}>
          <span style={styles.trustIcon}>🔒</span>
          <div>
            <strong>100% Secure Payments</strong>
            <p style={styles.trustDesc}>HMAC-SHA256 encrypted verification via Razorpay Live Gateway</p>
          </div>
        </div>
        <div style={styles.trustItem}>
          <span style={styles.trustIcon}>🔄</span>
          <div>
            <strong>Remaining Days Preserved</strong>
            <p style={styles.trustDesc}>Upgrading or renewing extends on top of your existing days</p>
          </div>
        </div>
        <div style={styles.trustItem}>
          <span style={styles.trustIcon}>📱</span>
          <div>
            <strong>Synced Across Web & Mobile</strong>
            <p style={styles.trustDesc}>One account activates your subscription on both Mobile & Web</p>
          </div>
        </div>
      </div>

      {/* Success Modal */}
      {successModal.show && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalIcon}>🎉</div>
            <h2 style={styles.modalTitle}>Subscription Activated!</h2>
            <p style={styles.modalMessage}>
              Congratulations! Your <strong>{successModal.planName}</strong> plan (
              {successModal.cycle === BILLING_CYCLES.YEARLY ? "Yearly" : "Monthly"}) is now active.
            </p>
            {successModal.expiry && (
              <div style={styles.modalExpiryBox}>
                <span>Valid until:</span>
                <strong>{formatExpiryDate(successModal.expiry)}</strong>
              </div>
            )}
            <button
              onClick={() => {
                setSuccessModal({ show: false, planName: "", cycle: "", expiry: null });
                if (onBack) onBack();
              }}
              style={styles.modalBtn}
            >
              Continue to POS & Store
            </button>
          </div>
        </div>
      )}

      {/* Razorpay Website Approval Info Modal */}
      {approvalModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalIcon}>📋</div>
            <h2 style={styles.modalTitle}>Razorpay Website Authorization</h2>
            <p style={styles.modalMessage}>
              Your Razorpay Live account is active for Mobile POS. For web domains like{" "}
              <strong>https://www.kadai.website/</strong>, Razorpay requires adding the website URL under your Razorpay
              Merchant Dashboard:
            </p>
            <div style={styles.instructionBox}>
              <ol style={{ margin: 0, paddingLeft: "20px", textAlign: "left", fontSize: "13px", color: "#334155" }}>
                <li>Log in to <strong>dashboard.razorpay.com</strong></li>
                <li>Go to <strong>Settings</strong> → <strong>Websites and App Settings</strong></li>
                <li>Add website URL: <code>https://www.kadai.website</code></li>
                <li>Save and submit for instant verification</li>
              </ol>
            </div>
            <button onClick={() => setApprovalModal(false)} style={styles.modalBtn}>
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "24px 32px 48px",
    maxWidth: "1280px",
    margin: "0 auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#0f172a",
  },
  headerRow: {
    marginBottom: "24px",
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#fc8019",
    fontWeight: "600",
    fontSize: "14px",
    cursor: "pointer",
    padding: "0 0 12px 0",
    display: "inline-block",
  },
  pageTitle: {
    fontSize: "28px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "0 0 8px 0",
    letterSpacing: "-0.5px",
  },
  pageSubtitle: {
    fontSize: "15px",
    color: "#64748b",
    margin: 0,
  },
  heroCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "24px 28px",
    marginBottom: "32px",
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "24px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.03)",
  },
  heroLeft: {
    flex: "1 1 450px",
  },
  heroBadgeRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    marginBottom: "12px",
  },
  planBadge: {
    fontSize: "12px",
    fontWeight: "800",
    padding: "4px 10px",
    borderRadius: "9999px",
    border: "1px solid",
    letterSpacing: "0.5px",
  },
  statusBadge: {
    fontSize: "12px",
    fontWeight: "700",
    padding: "4px 10px",
    borderRadius: "9999px",
    border: "1px solid",
  },
  cycleBadge: {
    fontSize: "12px",
    fontWeight: "600",
    padding: "4px 10px",
    borderRadius: "9999px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
  },
  heroTitle: {
    fontSize: "20px",
    fontWeight: "700",
    color: "#0f172a",
    margin: "0 0 6px 0",
  },
  heroMeta: {
    fontSize: "14px",
    color: "#64748b",
    margin: 0,
  },
  heroRight: {
    display: "flex",
    flexWrap: "wrap",
    gap: "16px",
  },
  statBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "12px 18px",
    minWidth: "140px",
  },
  statLabel: {
    fontSize: "11px",
    fontWeight: "700",
    textTransform: "uppercase",
    color: "#64748b",
    marginBottom: "4px",
    letterSpacing: "0.5px",
  },
  statValue: {
    fontSize: "15px",
    fontWeight: "800",
    color: "#0f172a",
  },
  toggleWrapper: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "36px",
  },
  toggleContainer: {
    backgroundColor: "#f1f5f9",
    borderRadius: "9999px",
    padding: "4px",
    display: "inline-flex",
    alignItems: "center",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
  },
  toggleBtn: {
    border: "none",
    borderRadius: "9999px",
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s ease",
  },
  discountPill: {
    backgroundColor: "#10b981",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "9999px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "24px",
    marginBottom: "48px",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: "20px",
    border: "2px solid #e2e8f0",
    padding: "28px 24px",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  },
  cardTopBadge: {
    position: "absolute",
    top: "-12px",
    right: "24px",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: "800",
    padding: "4px 12px",
    borderRadius: "9999px",
    letterSpacing: "0.5px",
    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  },
  cardHeader: {
    marginBottom: "16px",
  },
  cardTitle: {
    fontSize: "24px",
    fontWeight: "800",
    margin: "0 0 6px 0",
  },
  cardTagline: {
    fontSize: "13px",
    color: "#64748b",
    margin: 0,
    minHeight: "36px",
  },
  priceContainer: {
    display: "flex",
    alignItems: "baseline",
    marginBottom: "20px",
  },
  currencySymbol: {
    fontSize: "20px",
    fontWeight: "700",
    color: "#0f172a",
    marginRight: "2px",
  },
  priceAmount: {
    fontSize: "36px",
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: "-1px",
  },
  pricePeriod: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#64748b",
    marginLeft: "6px",
  },
  actionBtn: {
    width: "100%",
    padding: "14px",
    borderRadius: "12px",
    border: "none",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: "700",
    marginBottom: "20px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    transition: "opacity 0.2s",
  },
  btnLoading: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  spinner: {
    width: "16px",
    height: "16px",
    border: "2px solid rgba(255,255,255,0.4)",
    borderTopColor: "#ffffff",
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.8s linear infinite",
  },
  featuresDivider: {
    height: "1px",
    backgroundColor: "#f1f5f9",
    marginBottom: "20px",
  },
  featuresList: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  featuresHeading: {
    fontSize: "12px",
    fontWeight: "800",
    textTransform: "uppercase",
    color: "#94a3b8",
    marginBottom: "4px",
    letterSpacing: "0.5px",
  },
  featureItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
  featureIcon: {
    fontSize: "14px",
    fontWeight: "800",
    marginTop: "2px",
  },
  featureText: {
    fontSize: "13px",
    lineHeight: "1.4",
  },
  trustBanner: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "24px 32px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "24px",
  },
  trustItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "16px",
  },
  trustIcon: {
    fontSize: "28px",
  },
  trustDesc: {
    fontSize: "12px",
    color: "#64748b",
    margin: "4px 0 0 0",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(4px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    padding: "16px",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: "20px",
    padding: "32px",
    maxWidth: "460px",
    width: "100%",
    textAlign: "center",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
  },
  modalIcon: {
    fontSize: "48px",
    marginBottom: "16px",
  },
  modalTitle: {
    fontSize: "22px",
    fontWeight: "800",
    color: "#0f172a",
    margin: "0 0 10px 0",
  },
  modalMessage: {
    fontSize: "14px",
    color: "#64748b",
    lineHeight: "1.5",
    marginBottom: "20px",
  },
  modalExpiryBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "12px",
    marginBottom: "24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "14px",
    color: "#0f172a",
  },
  instructionBox: {
    backgroundColor: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "14px",
    marginBottom: "24px",
  },
  modalBtn: {
    width: "100%",
    padding: "12px",
    borderRadius: "10px",
    border: "none",
    backgroundColor: "#fc8019",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: "700",
    cursor: "pointer",
  },
};
