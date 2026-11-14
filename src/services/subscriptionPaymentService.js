import { auth, functions } from "../utils/firebase";
import { httpsCallable } from "firebase/functions";

/**
 * Creates a server-side Razorpay Order for Premium or Pro subscription plans
 * using Firebase Cloud Functions callable SDK (httpsCallable).
 *
 * @param {Object} params
 * @param {string} params.plan - "Premium" | "Pro"
 * @param {string} params.cycle - "monthly" | "yearly"
 * @returns {Promise<{ orderId: string, amount: number, currency: string, keyId: string, plan: string, cycle: string }>}
 */
export async function createSubscriptionOrder({ plan, cycle = "monthly" }) {
  if (!plan) throw new Error("Subscription plan is required.");
  if (!auth?.currentUser) {
    throw new Error("No authenticated user found. Please sign in to continue.");
  }

  try {
    const callable = httpsCallable(functions, "createSubscriptionOrder");
    const result = await callable({
      plan,
      cycle,
    });
    return result.data;
  } catch (error) {
    console.error("[createSubscriptionOrder] Callable invocation error:", error);
    const errorDetails = error?.message || error?.details || "Failed to create subscription order.";
    throw new Error(errorDetails, { cause: error });
  }
}

/**
 * Submits payment details to Firebase Cloud Functions for backend cryptographic
 * HMAC-SHA256 signature verification, direct Razorpay API validation, and atomic activation
 * using Firebase Cloud Functions callable SDK (httpsCallable).
 *
 * @param {Object} params
 * @param {string} params.orderId - Razorpay order ID (e.g. order_xxx)
 * @param {string} params.paymentId - Razorpay payment ID (e.g. pay_xxx)
 * @param {string} params.signature - HMAC SHA256 signature returned by Razorpay Checkout
 * @returns {Promise<{ success: boolean, status: string, orderId: string, paymentId: string, plan: string, cycle: string, expiry: number, alreadyActivated?: boolean }>}
 */
export async function verifySubscriptionPayment({ orderId, paymentId, signature }) {
  if (!orderId) throw new Error("Order ID is required for verification.");
  if (!paymentId) throw new Error("Payment ID is required for verification.");
  if (!signature) throw new Error("Payment signature is required for verification.");
  if (!auth?.currentUser) {
    throw new Error("No authenticated user found. Please sign in to continue.");
  }

  try {
    const callable = httpsCallable(functions, "verifySubscriptionPayment");
    const result = await callable({
      orderId,
      paymentId,
      signature,
    });
    return result.data;
  } catch (error) {
    console.error("[verifySubscriptionPayment] Callable invocation error:", error);
    const errorDetails = error?.message || error?.details || "Payment verification failed.";
    throw new Error(errorDetails, { cause: error });
  }
}
