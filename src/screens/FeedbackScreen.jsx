import { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from "firebase/firestore";
import { db, auth } from "../utils/firebase";

export default function FeedbackScreen({
  userProfile = {},
  isRestaurant = false,
  activeBranchName = "Main Branch",
  onBack
}) {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [ratingFilter, setRatingFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");

  // Modal State for Adding Feedback
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Form Fields
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [overallRating, setOverallRating] = useState(5);
  const [foodOrProductRating, setFoodOrProductRating] = useState(5);
  const [serviceRating, setServiceRating] = useState(5);
  const [cleanlinessRating, setCleanlinessRating] = useState(5);
  const [comments, setComments] = useState("");
  const [billNo, setBillNo] = useState("");
  const [branchName, setBranchName] = useState(activeBranchName);

  const currentUid = auth.currentUser?.uid || localStorage.getItem("uid") || "";
  const storeName = userProfile.storeName || "Turf Cafe";

  // Listen to feedbacks in Firestore
  useEffect(() => {
    if (!currentUid) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      collection(db, "users", currentUid, "customer_feedbacks"),
      (snapshot) => {
        const list = snapshot.docs.map((d) => {
          const data = d.data();
          const parsedDate = data.createdAt?.toDate ? data.createdAt.toDate() : (data.date ? new Date(data.date) : new Date());
          return {
            id: d.id,
            ...data,
            parsedDate,
            rating: Number(data.rating || data.overallRating || 5)
          };
        });

        // Default demo feedback if empty
        if (list.length === 0) {
          const sample = [
            {
              id: "sample-1",
              customerName: "Karthik Raja",
              customerMobile: "9840123456",
              rating: 5,
              foodRating: 5,
              serviceRating: 5,
              comments: isRestaurant ? "Excellent taste! Mojito and Butterscotch shake were amazing. Quick service." : "Great store collection and fast checkout billing!",
              branch: activeBranchName,
              billNo: "INV-1042",
              parsedDate: new Date(),
              dateStr: new Date().toLocaleDateString("en-IN")
            },
            {
              id: "sample-2",
              customerName: "Priya S.",
              customerMobile: "9884567890",
              rating: 4,
              foodRating: 4,
              serviceRating: 5,
              comments: isRestaurant ? "Food was hot and fresh. Table atmosphere was great." : "Quality items and very helpful staff.",
              branch: activeBranchName,
              billNo: "INV-1038",
              parsedDate: new Date(Date.now() - 86400000),
              dateStr: new Date(Date.now() - 86400000).toLocaleDateString("en-IN")
            }
          ];
          setFeedbacks(sample);
        } else {
          setFeedbacks(list);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Error loading feedback:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUid, isRestaurant, activeBranchName]);

  const handleOpenAddModal = () => {
    setCustomerName("");
    setCustomerMobile("");
    setOverallRating(5);
    setFoodOrProductRating(5);
    setServiceRating(5);
    setCleanlinessRating(5);
    setComments("");
    setBillNo("");
    setBranchName(activeBranchName);
    setShowAddModal(true);
  };

  const handleSaveFeedback = async (e) => {
    e.preventDefault();
    if (!customerName.trim() && !comments.trim()) {
      alert("Please provide customer name or comments.");
      return;
    }

    setSavingFeedback(true);
    try {
      const payload = {
        customerName: customerName.trim() || "Valued Customer",
        customerMobile: customerMobile.trim(),
        rating: overallRating,
        foodOrProductRating,
        serviceRating,
        cleanlinessRating,
        comments: comments.trim(),
        billNo: billNo.trim(),
        branch: branchName || activeBranchName,
        storeType: isRestaurant ? "restaurant" : "shop",
        dateStr: new Date().toLocaleDateString("en-IN"),
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, "users", currentUid, "customer_feedbacks"), payload);
      alert("✅ Customer feedback recorded successfully!");
      setShowAddModal(false);
    } catch (err) {
      console.error("Save feedback error:", err);
      alert("Error saving feedback: " + err.message);
    } finally {
      setSavingFeedback(false);
    }
  };

  const handleDeleteFeedback = async (id) => {
    if (!confirm("Are you sure you want to delete this feedback?")) return;
    try {
      if (id.startsWith("sample-")) {
        setFeedbacks((prev) => prev.filter((item) => item.id !== id));
      } else {
        await deleteDoc(doc(db, "users", currentUid, "customer_feedbacks", id));
      }
    } catch (err) {
      alert("Error deleting feedback: " + err.message);
    }
  };

  // Filtered Feedbacks
  const filteredFeedbacks = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    return feedbacks.filter((item) => {
      // Rating filter
      if (ratingFilter !== "all") {
        if (ratingFilter === "5" && item.rating !== 5) return false;
        if (ratingFilter === "4" && item.rating !== 4) return false;
        if (ratingFilter === "3" && item.rating !== 3) return false;
        if (ratingFilter === "low" && item.rating > 2) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = (item.customerName || "").toLowerCase().includes(q);
        const matchComments = (item.comments || "").toLowerCase().includes(q);
        const matchMobile = (item.customerMobile || "").includes(q);
        const matchBill = (item.billNo || "").toLowerCase().includes(q);
        if (!matchName && !matchComments && !matchMobile && !matchBill) return false;
      }

      // Date filter
      if (dateFilter === "today") {
        const dStr = item.parsedDate?.toISOString ? item.parsedDate.toISOString().slice(0, 10) : "";
        if (dStr !== todayStr) return false;
      } else if (dateFilter === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        if (item.parsedDate < weekAgo) return false;
      }

      return true;
    }).sort((a, b) => (b.parsedDate || 0) - (a.parsedDate || 0));
  }, [feedbacks, ratingFilter, searchQuery, dateFilter]);

  // Aggregate Metrics
  const stats = useMemo(() => {
    if (feedbacks.length === 0) {
      return { avg: "5.0", total: 0, r5: 0, r4: 0, r3: 0, r2: 0, r1: 0, positivePct: 100 };
    }

    let sum = 0;
    let r5 = 0, r4 = 0, r3 = 0, r2 = 0, r1 = 0;
    feedbacks.forEach((f) => {
      const r = f.rating || 5;
      sum += r;
      if (r === 5) r5++;
      else if (r === 4) r4++;
      else if (r === 3) r3++;
      else if (r === 2) r2++;
      else r1++;
    });

    const avg = (sum / feedbacks.length).toFixed(1);
    const positiveCount = r5 + r4;
    const positivePct = Math.round((positiveCount / feedbacks.length) * 100);

    return { avg, total: feedbacks.length, r5, r4, r3, r2, r1, positivePct };
  }, [feedbacks]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredFeedbacks.length === 0) {
      alert("No feedback records to export.");
      return;
    }

    const headers = [
      "Date",
      "Customer Name",
      "Mobile",
      "Overall Rating",
      "Food / Product Rating",
      "Service Rating",
      "Cleanliness Rating",
      "Branch",
      "Bill No",
      "Customer Comments"
    ];

    const rows = filteredFeedbacks.map((f) => [
      f.dateStr || (f.parsedDate ? f.parsedDate.toISOString().slice(0, 10) : ""),
      `"${(f.customerName || "").replace(/"/g, '""')}"`,
      f.customerMobile || "",
      f.rating || 5,
      f.foodOrProductRating || f.foodRating || 5,
      f.serviceRating || 5,
      f.cleanlinessRating || 5,
      `"${(f.branch || "").replace(/"/g, '""')}"`,
      f.billNo || "",
      `"${(f.comments || "").replace(/"/g, '""')}"`
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Customer_Feedback_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyShareLink = () => {
    const url = window.location.origin + "/feedback";
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  return (
    <div style={styles.container}>
      {/* Top Header */}
      <div style={styles.topBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn}>
              ← Back
            </button>
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>⭐</span>
              <h1 style={styles.title}>Customer Feedback & Ratings</h1>
              <span style={styles.ratingPill}>{stats.avg} ★ ({stats.total} Reviews)</span>
            </div>
            <p style={styles.subtitle}>
              {isRestaurant
                ? "Collect diners feedback on food taste, portion size, service speed & atmosphere"
                : "Customer reviews on product quality, store staff service & overall satisfaction"}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setShowQrModal(true)} style={styles.qrBtn}>
            <span>📲</span>
            <span>Customer QR Code</span>
          </button>
          <button type="button" onClick={handleOpenAddModal} style={styles.addBtn}>
            <span>➕</span>
            <span>Record Feedback</span>
          </button>
          <button type="button" onClick={handleExportCsv} style={styles.exportBtn}>
            <span>📥</span>
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div style={styles.metricsGrid}>
        {/* Rating Score Card */}
        <div style={styles.ratingOverviewCard}>
          <div style={{ fontSize: "40px", fontWeight: "900", color: "#0f172a", lineHeight: 1 }}>
            {stats.avg}
          </div>
          <div style={{ color: "#f59e0b", fontSize: "20px", margin: "6px 0 2px" }}>
            {"★".repeat(Math.round(Number(stats.avg)))}
            {"☆".repeat(5 - Math.round(Number(stats.avg)))}
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "600" }}>
            Based on {stats.total} customer ratings
          </div>
          <div style={styles.posBadge}>{stats.positivePct}% Positive Rating</div>
        </div>

        {/* Star Rating Breakdown */}
        <div style={styles.breakdownCard}>
          <div style={{ fontSize: "12px", fontWeight: "800", color: "#475569", textTransform: "uppercase", marginBottom: "8px" }}>
            Rating Breakdown
          </div>
          {[
            { star: 5, count: stats.r5 },
            { star: 4, count: stats.r4 },
            { star: 3, count: stats.r3 },
            { star: 2, count: stats.r2 },
            { star: 1, count: stats.r1 }
          ].map((item) => {
            const pct = stats.total > 0 ? (item.count / stats.total) * 100 : 0;
            return (
              <div key={item.star} style={styles.progressRow}>
                <span style={{ fontSize: "12px", width: "45px", fontWeight: "700", color: "#334155" }}>
                  {item.star} Star
                </span>
                <div style={styles.progressBarBg}>
                  <div style={{ ...styles.progressBarFill, width: `${pct}%`, backgroundColor: item.star >= 4 ? "#16a34a" : item.star === 3 ? "#f59e0b" : "#ef4444" }} />
                </div>
                <span style={{ fontSize: "11px", width: "30px", textAlign: "right", color: "#64748b", fontWeight: "600" }}>
                  {item.count}
                </span>
              </div>
            );
          })}
        </div>

        {/* Branch / Outlet Card */}
        <div style={styles.branchInsightCard}>
          <div style={{ fontSize: "12px", fontWeight: "800", color: "#475569", textTransform: "uppercase", marginBottom: "4px" }}>
            Current Outlet / Branch
          </div>
          <div style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
            📍 {activeBranchName}
          </div>
          <p style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 12px" }}>
            Collect reviews directly at table bill checkout or share feedback link with customers.
          </p>
          <button type="button" onClick={copyShareLink} style={styles.linkCopyBtn}>
            {copiedLink ? "Link Copied! ✅" : "📋 Copy Direct Feedback Link"}
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div style={styles.filterCard}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: "220px" }}>
          <label style={styles.filterLabel}>Search Feedbacks</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customer name, mobile, bill or feedback comments..."
            style={styles.searchInput}
          />
        </div>

        {/* Star Rating Filter */}
        <div>
          <label style={styles.filterLabel}>Rating Filter</label>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {[
              { id: "all", label: "All" },
              { id: "5", label: "5 ★" },
              { id: "4", label: "4 ★" },
              { id: "3", label: "3 ★" },
              { id: "low", label: "1-2 ★ (Critical)" }
            ].map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRatingFilter(r.id)}
                style={{
                  ...styles.pillBtn,
                  backgroundColor: ratingFilter === r.id ? "#0f172a" : "#f8fafc",
                  color: ratingFilter === r.id ? "#ffffff" : "#475569",
                  borderColor: ratingFilter === r.id ? "#0f172a" : "#cbd5e1"
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date Filter */}
        <div>
          <label style={styles.filterLabel}>Date</label>
          <div style={{ display: "flex", gap: "6px" }}>
            {[
              { id: "all", label: "All Time" },
              { id: "today", label: "Today" },
              { id: "week", label: "This Week" }
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDateFilter(d.id)}
                style={{
                  ...styles.pillBtn,
                  backgroundColor: dateFilter === d.id ? "#0f172a" : "#f8fafc",
                  color: dateFilter === d.id ? "#ffffff" : "#475569",
                  borderColor: dateFilter === d.id ? "#0f172a" : "#cbd5e1"
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Feedbacks List */}
      <div style={styles.feedbacksContainer}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
            Loading customer feedbacks...
          </div>
        ) : filteredFeedbacks.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#64748b", backgroundColor: "#fff", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: "36px", marginBottom: "8px" }}>💬</div>
            <div style={{ fontWeight: "800", fontSize: "16px", color: "#334155" }}>No feedback matching your filters</div>
            <p style={{ fontSize: "12.5px", color: "#64748b", margin: "6px 0 14px" }}>
              Click <strong>"+ Record Feedback"</strong> to log customer feedback or share the QR code!
            </p>
          </div>
        ) : (
          <div style={styles.cardsGrid}>
            {filteredFeedbacks.map((item) => (
              <div key={item.id} style={styles.feedbackCard}>
                {/* Header */}
                <div style={styles.fbHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={styles.avatarCircle}>
                      {item.customerName ? item.customerName.charAt(0).toUpperCase() : "C"}
                    </div>
                    <div>
                      <div style={{ fontWeight: "800", fontSize: "14px", color: "#0f172a" }}>
                        {item.customerName || "Customer"}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        {item.customerMobile ? `📞 ${item.customerMobile}` : "Walk-in Guest"}
                        {item.billNo && ` • Bill #${item.billNo}`}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#f59e0b", fontSize: "16px", fontWeight: "900" }}>
                      {"★".repeat(item.rating || 5)}
                      <span style={{ color: "#cbd5e1" }}>{"★".repeat(5 - (item.rating || 5))}</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                      {item.dateStr || (item.parsedDate ? item.parsedDate.toLocaleDateString("en-IN") : "Recent")}
                    </div>
                  </div>
                </div>

                {/* Comment Box */}
                {item.comments && (
                  <div style={styles.commentBox}>
                    "{item.comments}"
                  </div>
                )}

                {/* Aspect Ratings Badges */}
                <div style={styles.aspectTags}>
                  <span style={styles.aspectBadge}>
                    🍽️ {isRestaurant ? "Food" : "Product"}: {item.foodOrProductRating || item.foodRating || item.rating || 5}★
                  </span>
                  <span style={styles.aspectBadge}>
                    ⚡ Service: {item.serviceRating || item.rating || 5}★
                  </span>
                  <span style={styles.aspectBadge}>
                    ✨ Cleanliness: {item.cleanlinessRating || item.rating || 5}★
                  </span>
                  <span style={styles.branchTag}>
                    📍 {item.branch || activeBranchName}
                  </span>
                </div>

                {/* Footer Delete */}
                <div style={styles.fbFooter}>
                  <button
                    type="button"
                    onClick={() => handleDeleteFeedback(item.id)}
                    style={styles.delBtn}
                    title="Delete feedback"
                  >
                    🗑️ Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RECORD FEEDBACK MODAL */}
      {showAddModal && (
        <div style={styles.modalOverlay} onClick={() => !savingFeedback && setShowAddModal(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <h3 style={{ margin: "0 0 4px", fontSize: "17px", fontWeight: "800", color: "#0f172a" }}>
                  Record Customer Feedback (கருத்து பதிவு)
                </h3>
                <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
                  Capture diner experience, ratings, service quality and suggestions
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={styles.closeBtn}
                disabled={savingFeedback}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveFeedback} style={{ padding: "20px" }}>
              {/* Overall Star Rating */}
              <div style={{ textAlign: "center", marginBottom: "18px", padding: "12px", backgroundColor: "#fffbeb", borderRadius: "10px", border: "1px solid #fde68a" }}>
                <div style={{ fontSize: "12px", fontWeight: "800", color: "#92400e", textTransform: "uppercase", marginBottom: "6px" }}>
                  Overall Customer Rating (மதிப்பீடு)
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: "8px", fontSize: "32px", cursor: "pointer" }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      onClick={() => setOverallRating(star)}
                      style={{
                        color: star <= overallRating ? "#f59e0b" : "#cbd5e1",
                        transform: star <= overallRating ? "scale(1.1)" : "scale(1)",
                        transition: "all 0.1s ease"
                      }}
                    >
                      ★
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "#b45309", marginTop: "4px" }}>
                  {overallRating === 5 ? "⭐⭐⭐⭐⭐ Outstanding / அருமை!" : overallRating === 4 ? "⭐⭐⭐⭐ Very Good / நன்று" : overallRating === 3 ? "⭐⭐⭐ Average / சராசரி" : "Needs Improvement / முன்னேற்றம் தேவை"}
                </div>
              </div>

              {/* Customer Name & Mobile */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Customer Name</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Anand Kumar"
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Mobile Number (Optional)</label>
                  <input
                    type="tel"
                    value={customerMobile}
                    onChange={(e) => setCustomerMobile(e.target.value)}
                    placeholder="e.g. 9876543210"
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Aspect Ratings (Food, Service, Cleanliness) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>{isRestaurant ? "Food Taste" : "Product Quality"}</label>
                  <select
                    value={foodOrProductRating}
                    onChange={(e) => setFoodOrProductRating(Number(e.target.value))}
                    style={styles.modalInput}
                  >
                    <option value={5}>5 ★ Excellent</option>
                    <option value={4}>4 ★ Good</option>
                    <option value={3}>3 ★ Average</option>
                    <option value={2}>2 ★ Poor</option>
                    <option value={1}>1 ★ Bad</option>
                  </select>
                </div>
                <div>
                  <label style={styles.modalLabel}>Service Speed</label>
                  <select
                    value={serviceRating}
                    onChange={(e) => setServiceRating(Number(e.target.value))}
                    style={styles.modalInput}
                  >
                    <option value={5}>5 ★ Fast</option>
                    <option value={4}>4 ★ Good</option>
                    <option value={3}>3 ★ Normal</option>
                    <option value={2}>2 ★ Slow</option>
                    <option value={1}>1 ★ Very Slow</option>
                  </select>
                </div>
                <div>
                  <label style={styles.modalLabel}>Cleanliness</label>
                  <select
                    value={cleanlinessRating}
                    onChange={(e) => setCleanlinessRating(Number(e.target.value))}
                    style={styles.modalInput}
                  >
                    <option value={5}>5 ★ Spotless</option>
                    <option value={4}>4 ★ Clean</option>
                    <option value={3}>3 ★ Decent</option>
                    <option value={2}>2 ★ Poor</option>
                    <option value={1}>1 ★ Dirty</option>
                  </select>
                </div>
              </div>

              {/* Bill No & Branch */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                <div>
                  <label style={styles.modalLabel}>Bill Number (Optional)</label>
                  <input
                    type="text"
                    value={billNo}
                    onChange={(e) => setBillNo(e.target.value)}
                    placeholder="e.g. INV-2051"
                    style={styles.modalInput}
                  />
                </div>
                <div>
                  <label style={styles.modalLabel}>Branch Outlet</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="e.g. Main Branch"
                    style={styles.modalInput}
                  />
                </div>
              </div>

              {/* Comments */}
              <div style={{ marginBottom: "20px" }}>
                <label style={styles.modalLabel}>Customer Feedback & Suggestions</label>
                <textarea
                  rows="3"
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="What did the customer say about food, portion, billing or ambiance?"
                  style={{ ...styles.modalInput, resize: "vertical" }}
                />
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={savingFeedback}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFeedback}
                  style={styles.saveBtn}
                >
                  {savingFeedback ? "Saving..." : "Save Feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR CODE SHARE MODAL */}
      {showQrModal && (
        <div style={styles.modalOverlay} onClick={() => setShowQrModal(false)}>
          <div style={{ ...styles.modalCard, maxWidth: "420px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                Customer Feedback QR Code
              </h3>
              <button type="button" onClick={() => setShowQrModal(false)} style={styles.closeBtn}>
                ✕
              </button>
            </div>
            <div style={{ padding: "24px 20px" }}>
              <div style={{ fontSize: "13px", color: "#475569", marginBottom: "16px" }}>
                Place this QR code at table stands, counter bills or takeaway packs so customers can rate on their phone!
              </div>

              {/* QR Image using quick chart API for robust rendering */}
              <div style={{ display: "inline-block", padding: "14px", backgroundColor: "#fff", borderRadius: "12px", border: "2px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.06)" }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(window.location.origin + "/feedback")}`}
                  alt="Feedback QR"
                  style={{ width: "180px", height: "180px", display: "block" }}
                />
              </div>

              <div style={{ marginTop: "14px", fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                Scan to Rate {storeName} ⭐
              </div>

              <div style={{ marginTop: "18px", display: "flex", gap: "10px", justifyContent: "center" }}>
                <button type="button" onClick={copyShareLink} style={styles.linkCopyBtn}>
                  {copiedLink ? "Link Copied! ✅" : "Copy Direct URL"}
                </button>
                <button type="button" onClick={() => window.print()} style={styles.printQrBtn}>
                  🖨️ Print QR Stand
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: "24px",
    maxWidth: "1400px",
    margin: "0 auto",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "system-ui, -apple-system, sans-serif"
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px",
    flexWrap: "wrap",
    gap: "14px"
  },
  backBtn: {
    padding: "7px 12px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    color: "#334155",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer"
  },
  title: {
    fontSize: "20px",
    fontWeight: "800",
    color: "#0f172a",
    margin: 0
  },
  subtitle: {
    fontSize: "12.5px",
    color: "#64748b",
    margin: "4px 0 0"
  },
  ratingPill: {
    fontSize: "12px",
    fontWeight: "800",
    padding: "2px 8px",
    borderRadius: "8px",
    backgroundColor: "#fef3c7",
    color: "#b45309",
    border: "1px solid #fde68a"
  },
  qrBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#0369a1",
    border: "1.5px solid #bae6fd",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  addBtn: {
    padding: "8px 16px",
    backgroundColor: "#16a34a",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)"
  },
  exportBtn: {
    padding: "8px 14px",
    backgroundColor: "#ffffff",
    color: "#4f46e5",
    border: "1.5px solid #c7d2fe",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px"
  },
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "16px",
    marginBottom: "20px"
  },
  ratingOverviewCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "20px",
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center"
  },
  posBadge: {
    marginTop: "10px",
    fontSize: "11px",
    fontWeight: "800",
    padding: "3px 10px",
    borderRadius: "12px",
    backgroundColor: "#dcfce7",
    color: "#166534"
  },
  breakdownCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "16px 20px",
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center"
  },
  progressRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px"
  },
  progressBarBg: {
    flex: 1,
    height: "7px",
    backgroundColor: "#f1f5f9",
    borderRadius: "4px",
    overflow: "hidden"
  },
  progressBarFill: {
    height: "100%",
    borderRadius: "4px"
  },
  branchInsightCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "18px 20px",
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center"
  },
  linkCopyBtn: {
    padding: "7px 12px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: "700",
    color: "#334155",
    cursor: "pointer"
  },
  printQrBtn: {
    padding: "7px 12px",
    backgroundColor: "#0284c7",
    border: "none",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: "700",
    color: "#fff",
    cursor: "pointer"
  },
  filterCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    padding: "14px 18px",
    border: "1px solid #e2e8f0",
    marginBottom: "20px",
    display: "flex",
    alignItems: "flex-end",
    gap: "14px",
    flexWrap: "wrap"
  },
  filterLabel: {
    display: "block",
    fontSize: "11px",
    fontWeight: "700",
    color: "#475569",
    marginBottom: "5px",
    textTransform: "uppercase"
  },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "7px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    outline: "none"
  },
  pillBtn: {
    padding: "5px 12px",
    borderRadius: "8px",
    border: "1px solid",
    fontSize: "12px",
    fontWeight: "700",
    cursor: "pointer"
  },
  feedbacksContainer: {
    width: "100%"
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
    gap: "16px"
  },
  feedbackCard: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
  },
  fbHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "10px"
  },
  avatarCircle: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    backgroundColor: "#fef3c7",
    color: "#b45309",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "800",
    fontSize: "14px"
  },
  commentBox: {
    fontSize: "13px",
    color: "#334155",
    fontStyle: "italic",
    lineHeight: "1.5",
    backgroundColor: "#f8fafc",
    padding: "10px 12px",
    borderRadius: "8px",
    marginBottom: "12px",
    borderLeft: "3px solid #f59e0b"
  },
  aspectTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "10px"
  },
  aspectBadge: {
    fontSize: "10.5px",
    fontWeight: "700",
    padding: "2px 7px",
    borderRadius: "6px",
    backgroundColor: "#f1f5f9",
    color: "#475569"
  },
  branchTag: {
    fontSize: "10.5px",
    fontWeight: "700",
    padding: "2px 7px",
    borderRadius: "6px",
    backgroundColor: "#dcfce7",
    color: "#166534"
  },
  fbFooter: {
    borderTop: "1px solid #f1f5f9",
    paddingTop: "8px",
    display: "flex",
    justifyContent: "flex-end"
  },
  delBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "11.5px",
    fontWeight: "600",
    cursor: "pointer"
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "16px"
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    maxWidth: "520px",
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
    overflow: "hidden",
    maxHeight: "92vh",
    overflowY: "auto"
  },
  modalHeader: {
    padding: "16px 20px",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start"
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    fontSize: "18px",
    color: "#94a3b8",
    cursor: "pointer",
    padding: "2px 6px",
    fontWeight: "800"
  },
  modalLabel: {
    display: "block",
    fontSize: "11.5px",
    fontWeight: "700",
    color: "#334155",
    marginBottom: "5px"
  },
  modalInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1.5px solid #cbd5e1",
    fontSize: "13px",
    outline: "none"
  },
  cancelBtn: {
    padding: "8px 16px",
    backgroundColor: "#f1f5f9",
    border: "1px solid #cbd5e1",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700",
    color: "#475569",
    cursor: "pointer"
  },
  saveBtn: {
    padding: "8px 20px",
    backgroundColor: "#16a34a",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "800",
    color: "#ffffff",
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(22, 163, 74, 0.3)"
  }
};
