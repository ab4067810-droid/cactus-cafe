import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../context/Authcontext";
import { logout } from "../services/authService";
import {
  loadAdminQrVerificationQueue,
  loadAdminQrResolutionQueue,
  reviewQrPaymentSubmission,
  resolveAdminQrPaymentRecord,
} from "../services/paymentRecordService";
import "../styles/AdminPayments.css";
import "../styles/AdminSidebar.css";

const paymentSections = [
  { id: "qr", label: "QR Verification", icon: "▧" },
  { id: "qr-resolution", label: "QR Admin Resolution", icon: "✓" },
  { id: "cash", label: "Cash Payment Records", icon: "₱" },
  { id: "refunds", label: "Refund Management", icon: "↩" },
  { id: "history", label: "Transaction History", icon: "↗" },
];

const overviewCards = [
  {
    label: "Total Collected",
    value: "₱24,680.00",
    detail: "Sample total · this month",
    icon: "₱",
    tone: "green",
  },
  {
    label: "Unpaid Orders",
    value: "08",
    detail: "Sample outstanding orders",
    icon: "◷",
    tone: "amber",
  },
  {
    label: "Pending QR Verification",
    value: "03",
    detail: "Sample receipts to review",
    icon: "▧",
    tone: "blue",
  },
  {
    label: "Pending Refund Requests",
    value: "02",
    detail: "Sample requests to review",
    icon: "↩",
    tone: "rose",
  },
];

const demoRecords = {
  cash: [
    {
      id: "ORD-4D8A12",
      customer: "Eli Garcia",
      amount: "₱350.00",
      submitted: "Today, 11:06 AM",
      status: "Collected",
    },
    {
      id: "ORD-9B341C",
      customer: "Ana Flores",
      amount: "₱790.00",
      submitted: "Today, 8:54 AM",
      status: "Pay later",
    },
  ],
  refunds: [
    {
      id: "RFD-0148",
      customer: "Kai Mendoza",
      amount: "₱220.00",
      submitted: "Today, 10:15 AM",
      status: "Pending review",
    },
    {
      id: "RFD-0147",
      customer: "Zoe Ramirez",
      amount: "₱180.00",
      submitted: "Yesterday, 2:27 PM",
      status: "Pending review",
    },
  ],
  history: [
    {
      id: "ORD-4D8A12",
      customer: "Eli Garcia",
      amount: "₱350.00",
      submitted: "Today, 11:06 AM",
      status: "Cash received",
    },
    {
      id: "ORD-76F02D",
      customer: "Sam Rivera",
      amount: "₱540.00",
      submitted: "Today, 10:22 AM",
      status: "QR verified",
    },
    {
      id: "RFD-0146",
      customer: "Bea Navarro",
      amount: "₱125.00",
      submitted: "Yesterday, 5:48 PM",
      status: "Refund issued",
    },
  ],
};

const formatPaymentAmount = (amountDue) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format((Number(amountDue) || 0) / 100);

const formatPaymentDate = (timestamp) => {
  if (!timestamp?.toDate) return "Date unavailable";
  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

function AdminPayments() {
  const navigate = useNavigate();
  const { user, role, loading } = useAuth();
  const [activeSection, setActiveSection] = useState("qr");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [qrQueue, setQrQueue] = useState([]);
  const [qrQueueLoading, setQrQueueLoading] = useState(true);
  const [qrQueueError, setQrQueueError] = useState("");
  const [resolutionQueue, setResolutionQueue] = useState([]);
  const [resolutionQueueLoading, setResolutionQueueLoading] = useState(true);
  const [resolutionQueueError, setResolutionQueueError] = useState("");
  const [reviewReasons, setReviewReasons] = useState({});
  const [externalVerification, setExternalVerification] = useState({});
  const [reviewFeedback, setReviewFeedback] = useState({});
  const [reviewNotice, setReviewNotice] = useState(null);
  const [reviewingIds, setReviewingIds] = useState(new Set());
  const reviewingIdsRef = useRef(new Set());
  const [resolutionReasons, setResolutionReasons] = useState({});
  const [resolutionVerification, setResolutionVerification] = useState({});
  const [resolutionConfirmations, setResolutionConfirmations] = useState({});
  const [resolutionFeedback, setResolutionFeedback] = useState({});
  const [resolutionNotice, setResolutionNotice] = useState(null);
  const [resolvingIds, setResolvingIds] = useState(new Set());
  const resolvingIdsRef = useRef(new Set());

  const loadQrQueue = useCallback(async (adminId) => {
    try {
      setQrQueueLoading(true);
      setQrQueueError("");
      setQrQueue(await loadAdminQrVerificationQueue(adminId));
      return true;
    } catch (queueError) {
      console.error("Error loading QR verification queue:", queueError);
      setQrQueueError(
        "Unable to load QR submissions. Please refresh the queue.",
      );
      return false;
    } finally {
      setQrQueueLoading(false);
    }
  }, []);

  const loadResolutionQueue = useCallback(async (adminId) => {
    try {
      setResolutionQueueLoading(true);
      setResolutionQueueError("");
      setResolutionQueue(await loadAdminQrResolutionQueue(adminId));
      return true;
    } catch (queueError) {
      console.error("Error loading QR admin-resolution queue:", queueError);
      setResolutionQueueError(
        "Unable to load QR payments requiring final administrator resolution.",
      );
      return false;
    } finally {
      setResolutionQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) {
      navigate(user ? "/customer" : "/login", { replace: true });
    }
  }, [loading, navigate, role, user]);

  useEffect(() => {
    if (!loading && user && role === "admin") {
      loadQrQueue(user.uid);
      loadResolutionQueue(user.uid);
    }
  }, [loadQrQueue, loadResolutionQueue, loading, role, user]);

  const handleReviewDecision = async (entry, decision) => {
    const actionId = `${entry.orderId}/${entry.submission.id}`;
    if (reviewingIdsRef.current.has(actionId)) return;

    if (decision === "verify" && !externalVerification[actionId]) {
      setReviewFeedback((current) => ({
        ...current,
        [actionId]: {
          type: "error",
          message: "Confirm the transaction was verified externally first.",
        },
      }));
      return;
    }

    const rejectionReason = reviewReasons[actionId] || "";
    if (
      decision === "reject"
      && (
        !rejectionReason.trim()
        || Array.from(rejectionReason.trim()).length > 500
      )
    ) {
      setReviewFeedback((current) => ({
        ...current,
        [actionId]: {
          type: "error",
          message: "Enter a rejection reason from 1 to 500 characters.",
        },
      }));
      return;
    }

    reviewingIdsRef.current.add(actionId);
    setReviewingIds(new Set(reviewingIdsRef.current));
    setReviewFeedback((current) => ({
      ...current,
      [actionId]: null,
    }));

    try {
      await reviewQrPaymentSubmission({
        orderId: entry.orderId,
        submissionId: entry.submission.id,
        adminId: user.uid,
        decision,
        rejectionReason,
      });
      setReviewReasons((current) => ({
        ...current,
        [actionId]: "",
      }));
      setExternalVerification((current) => ({
        ...current,
        [actionId]: false,
      }));
      setReviewNotice({
        type: "success",
        message: decision === "verify"
          ? `Payment for order ${entry.orderId} was verified.`
          : `Attempt ${entry.submission.attemptNumber} for order ${entry.orderId} was rejected.`,
      });

      const refreshed = await loadQrQueue(user.uid);
      if (!refreshed) {
        setReviewNotice({
          type: "error",
          message: "The decision was saved, but the queue could not refresh.",
        });
      }
    } catch (reviewError) {
      console.error("Error reviewing QR payment:", reviewError);
      setReviewFeedback((current) => ({
        ...current,
        [actionId]: {
          type: "error",
          message: reviewError instanceof Error
            ? reviewError.message
            : "Unable to save this decision. Refresh the queue and try again.",
        },
      }));
    } finally {
      reviewingIdsRef.current.delete(actionId);
      setReviewingIds(new Set(reviewingIdsRef.current));
    }
  };

  const handleStartResolution = (entry, decision) => {
    const reason = resolutionReasons[entry.orderId] || "";
    if (
      decision === "paid"
      && !resolutionVerification[entry.orderId]
    ) {
      setResolutionFeedback((current) => ({
        ...current,
        [entry.orderId]: {
          type: "error",
          message: "Confirm the transaction was independently verified externally.",
        },
      }));
      return;
    }
    if (
      decision === "rejected"
      && (
        !reason.trim()
        || Array.from(reason.trim()).length > 500
      )
    ) {
      setResolutionFeedback((current) => ({
        ...current,
        [entry.orderId]: {
          type: "error",
          message: "Enter a final rejection reason from 1 to 500 characters.",
        },
      }));
      return;
    }

    setResolutionFeedback((current) => ({
      ...current,
      [entry.orderId]: null,
    }));
    setResolutionConfirmations((current) => ({
      ...current,
      [entry.orderId]: decision,
    }));
  };

  const handleCancelResolution = (orderId) => {
    setResolutionConfirmations((current) => ({
      ...current,
      [orderId]: null,
    }));
  };

  const handleConfirmResolution = async (entry) => {
    const orderId = entry.orderId;
    const decision = resolutionConfirmations[orderId];
    if (!decision || resolvingIdsRef.current.has(orderId)) return;

    const reason = resolutionReasons[orderId] || "";
    if (decision === "paid" && !resolutionVerification[orderId]) return;
    if (decision === "rejected" && !reason.trim()) return;

    resolvingIdsRef.current.add(orderId);
    setResolvingIds(new Set(resolvingIdsRef.current));
    setResolutionFeedback((current) => ({
      ...current,
      [orderId]: null,
    }));

    try {
      await resolveAdminQrPaymentRecord({
        orderId,
        adminId: user.uid,
        decision,
        resolutionReason: reason,
      });
      setResolutionReasons((current) => ({
        ...current,
        [orderId]: "",
      }));
      setResolutionVerification((current) => ({
        ...current,
        [orderId]: false,
      }));
      setResolutionConfirmations((current) => ({
        ...current,
        [orderId]: null,
      }));
      setResolutionNotice({
        type: "success",
        message: decision === "paid"
          ? `Payment for order ${orderId} was resolved as paid.`
          : `Payment for order ${orderId} was finally rejected.`,
      });

      const refreshed = await loadResolutionQueue(user.uid);
      if (!refreshed) {
        setResolutionNotice({
          type: "error",
          message: "The resolution was saved, but the queue could not refresh.",
        });
      }
    } catch (resolutionError) {
      console.error("Error resolving QR payment:", resolutionError);
      setResolutionFeedback((current) => ({
        ...current,
        [orderId]: {
          type: "error",
          message: resolutionError instanceof Error
            ? resolutionError.message
            : "Unable to resolve this payment. Refresh the queue and try again.",
        },
      }));
    } finally {
      resolvingIdsRef.current.delete(orderId);
      setResolvingIds(new Set(resolvingIdsRef.current));
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  };

  if (loading || !user || role !== "admin") {
    return (
      <main className="admin-payments-page">
        <div className="admin-payments-loading" role="status">
          Preparing payment workspace...
        </div>
      </main>
    );
  }

  const activeTab = paymentSections.find(
    (section) => section.id === activeSection,
  );
  const isQrSection = activeSection === "qr";
  const isResolutionSection = activeSection === "qr-resolution";
  const isLiveSection = isQrSection || isResolutionSection;
  const records = isLiveSection ? [] : demoRecords[activeSection] || [];

  return (
    <main className="admin-payments-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="payments-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`payments-sidebar${mobileNavigationOpen ? " is-open" : ""}`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/payments"
          className="payments-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="payments-brand-mark" aria-hidden="true">🌵</span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="payments-sidebar-label">WORKSPACE</div>
        <nav className="payments-nav">
          <NavLink
            to="/admin/menu"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">▦</span>
            <span>Menu Management</span>
          </NavLink>
          <NavLink
            to="/admin/orders"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">↗</span>
            <span>Orders</span>
          </NavLink>
          <NavLink
            to="/admin/payments"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">₱</span>
            <span>Payment Management</span>
          </NavLink>
          <NavLink
            to="/admin/reservations"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">◷</span>
            <span>Reservations</span>
          </NavLink>
          <NavLink
            to="/admin/reviews"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">☆</span>
            <span>Reviews</span>
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">◎</span>
            <span>Customers &amp; Security</span>
          </NavLink>
          <NavLink
            to="/admin/monthly-records"
            className={({ isActive }) =>
              `payments-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="payments-nav-icon" aria-hidden="true">▤</span>
            <span>Monthly Records</span>
          </NavLink>
        </nav>

        <div className="payments-sidebar-footer">
          <div className="payments-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Every transaction deserves a clear record.</p>
          </div>
          <button
            type="button"
            className="payments-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="payments-nav-icon" aria-hidden="true">↪</span>
            <span>{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>

      <section className="payments-main">
        <div className="payments-container">
          <header className="payments-topbar">
            <button
              type="button"
              className="payments-mobile-toggle"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavigationOpen}
              onClick={() => setMobileNavigationOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div className="payments-breadcrumb">
              <span>Workspace</span>
              <span aria-hidden="true">/</span>
              <strong>Payment Management</strong>
            </div>
            <div className="payments-admin-chip">
              <span aria-hidden="true">●</span>
              Admin workspace
            </div>
          </header>

          <div className="payments-content">
            <section className="payments-heading">
              <div>
                <p className="payments-eyebrow">FINANCE OVERVIEW</p>
                <h1>Payment Management</h1>
                <p className="payments-intro">
                  Review payment activity, verify QR submissions, and manage
                  refund requests in one place.
                </p>
              </div>
              <span
                className={`payments-demo-badge${isLiveSection ? " is-live" : ""}`}
              >
                <span aria-hidden="true">◆</span>
                {isQrSection
                  ? "Live QR queue"
                  : isResolutionSection
                    ? "Live resolution queue"
                    : "Prototype data"}
              </span>
            </section>

            <div
              className={`payments-demo-notice${isLiveSection ? " is-live" : ""}`}
              role="note"
            >
              <span aria-hidden="true">ⓘ</span>
              <p>
                {isQrSection
                  ? "QR submissions below are loaded from Firestore. Verify transactions externally before marking them paid."
                  : isResolutionSection
                    ? "These third-rejection records can only be resolved by an administrator. Verify transactions externally before resolving a record as paid."
                    : "Cash Payment Records, Refund Management, and Transaction History are prototype-only sample data and are not connected to Firestore."}
              </p>
            </div>

            <section className="payments-overview" aria-label="Payment overview">
              {overviewCards.map((card) => {
                const isQrCount = card.label === "Pending QR Verification";
                return (
                  <article
                    className={`payments-stat-card tone-${card.tone}`}
                    key={card.label}
                  >
                    <div className="payments-stat-top">
                      <span>{card.label}</span>
                      <span className="payments-stat-icon" aria-hidden="true">
                        {card.icon}
                      </span>
                    </div>
                    <strong className="payments-stat-value">
                      {isQrCount ? qrQueue.length : card.value}
                    </strong>
                    <span className="payments-stat-detail">
                      {isQrCount
                        ? qrQueueLoading
                          ? "Loading live submissions"
                          : "Live submissions awaiting review"
                        : card.detail}
                    </span>
                  </article>
                );
              })}
            </section>

            <section className="payments-workspace">
              <div className="payments-section-heading">
                <div>
                  <p className="payments-eyebrow">PAYMENT WORKSPACE</p>
                  <h2>Manage transactions</h2>
                </div>
                <span
                  className={`payments-sample-label${isLiveSection ? " is-live" : ""}`}
                >
                  {isQrSection
                    ? "Live Firestore queue"
                    : isResolutionSection
                      ? "Live admin-resolution queue"
                      : "Prototype records"}
                </span>
              </div>

              <div
                className="payments-tabs"
                role="tablist"
                aria-label="Payment management sections"
              >
                {paymentSections.map((section) => (
                  <button
                    type="button"
                    role="tab"
                    id={`payments-tab-${section.id}`}
                    aria-selected={activeSection === section.id}
                    aria-controls={`payments-panel-${section.id}`}
                    className={`payments-tab${activeSection === section.id ? " active" : ""}`}
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                  >
                    <span aria-hidden="true">{section.icon}</span>
                    {section.label}
                  </button>
                ))}
              </div>

              <section
                className="payments-records-panel"
                id={`payments-panel-${activeSection}`}
                role="tabpanel"
                aria-labelledby={`payments-tab-${activeSection}`}
                tabIndex={0}
              >
                <div className="payments-panel-heading">
                  <div>
                    <h3>{activeTab?.label}</h3>
                    <p>
                      {isQrSection
                        ? "Only submissions awaiting administrator review are shown."
                        : isResolutionSection
                          ? "Only records requiring final resolution after three rejections are shown."
                          : "Illustrative entries only; not connected to Firestore."}
                    </p>
                  </div>
                  <span className="payments-record-count">
                    {isQrSection
                      ? `${qrQueue.length} pending ${
                          qrQueue.length === 1 ? "submission" : "submissions"
                        }`
                      : isResolutionSection
                        ? `${resolutionQueue.length} ${
                            resolutionQueue.length === 1 ? "record" : "records"
                          }`
                        : `${records.length} sample ${
                          records.length === 1 ? "record" : "records"
                        }`}
                  </span>
                  {isLiveSection && (
                    <button
                      type="button"
                      className="payments-refresh-button"
                      onClick={() =>
                        isQrSection
                          ? loadQrQueue(user.uid)
                          : loadResolutionQueue(user.uid)
                      }
                      disabled={
                        isQrSection
                          ? qrQueueLoading
                          : resolutionQueueLoading
                      }
                    >
                      {(isQrSection
                        ? qrQueueLoading
                        : resolutionQueueLoading)
                        ? "Refreshing..."
                        : "Refresh queue"}
                    </button>
                  )}
                </div>

                {isQrSection ? (
                  <>
                    {reviewNotice && (
                      <div
                        className={`payments-review-notice is-${reviewNotice.type}`}
                        role={reviewNotice.type === "error" ? "alert" : "status"}
                      >
                        {reviewNotice.message}
                      </div>
                    )}
                    {qrQueueLoading ? (
                      <div className="payments-queue-state" role="status">
                        Loading pending QR submissions...
                      </div>
                    ) : qrQueueError ? (
                      <div className="payments-queue-error" role="alert">
                        <p>{qrQueueError}</p>
                        <button
                          type="button"
                          className="payments-refresh-button"
                          onClick={() => loadQrQueue(user.uid)}
                        >
                          Try again
                        </button>
                      </div>
                    ) : qrQueue.length === 0 ? (
                      <div className="payments-empty-state">
                        <span className="payments-empty-icon" aria-hidden="true">
                          {activeTab?.icon}
                        </span>
                        <h3>No QR submissions awaiting review</h3>
                        <p>
                          New customer references will appear here while their
                          payment status is pending review.
                        </p>
                      </div>
                    ) : (
                      <div className="payments-qr-queue">
                        {qrQueue.map((entry) => {
                          const actionId = `${entry.orderId}/${entry.submission.id}`;
                          const verificationCheckboxId =
                            `verify-${entry.orderId}-${entry.submission.id}`;
                          const rejectionInputId =
                            `reject-${entry.orderId}-${entry.submission.id}`;
                          const isReviewing = reviewingIds.has(actionId);

                          return (
                            <article
                              className="payments-qr-card"
                              key={actionId}
                            >
                              <div className="payments-qr-card-heading">
                                <div>
                                  <span className="payments-qr-overline">
                                    ORDER ID
                                  </span>
                                  <h4>{entry.orderId}</h4>
                                  <p>
                                    {entry.customerName || "Customer name unavailable"}
                                    <span> · </span>
                                    <code>{entry.customerId}</code>
                                  </p>
                                </div>
                                <span className="payments-status is-pending">
                                  <span />
                                  {entry.paymentStatus}
                                </span>
                              </div>

                              <dl className="payments-qr-details">
                                <div>
                                  <dt>Amount due</dt>
                                  <dd>{formatPaymentAmount(entry.amountDue)}</dd>
                                </div>
                                <div>
                                  <dt>Payment timing</dt>
                                  <dd>
                                    {entry.paymentTiming === "advance"
                                      ? "Advance"
                                      : entry.paymentTiming === "pay_later"
                                        ? "Pay Later"
                                        : "Unavailable"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Attempt</dt>
                                  <dd>{entry.submission.attemptNumber} of 3</dd>
                                </div>
                                <div>
                                  <dt>Transaction reference</dt>
                                  <dd>{entry.submission.referenceNumber}</dd>
                                </div>
                                <div>
                                  <dt>Submitted</dt>
                                  <dd>
                                    {formatPaymentDate(entry.submission.submittedAt)}
                                  </dd>
                                </div>
                              </dl>

                              <div className="payments-previous-attempts">
                                <strong>Previous attempts</strong>
                                {entry.previousAttempts.length === 0 ? (
                                  <p>No previous attempts.</p>
                                ) : (
                                  <ol>
                                    {entry.previousAttempts.map((attempt) => (
                                      <li key={attempt.id}>
                                        <span>
                                          Attempt {attempt.attemptNumber} ·{" "}
                                          {attempt.status}
                                        </span>
                                        <code>{attempt.referenceNumber}</code>
                                        {attempt.rejectionReason && (
                                          <p>
                                            Rejection reason:{" "}
                                            {attempt.rejectionReason}
                                          </p>
                                        )}
                                      </li>
                                    ))}
                                  </ol>
                                )}
                              </div>

                              <div className="payments-review-actions">
                                <label
                                  className="payments-verification-confirm"
                                  htmlFor={verificationCheckboxId}
                                >
                                  <input
                                    id={verificationCheckboxId}
                                    type="checkbox"
                                    checked={Boolean(
                                      externalVerification[actionId],
                                    )}
                                    onChange={(event) =>
                                      setExternalVerification((current) => ({
                                        ...current,
                                        [actionId]: event.target.checked,
                                      }))
                                    }
                                    disabled={isReviewing}
                                  />
                                  <span>
                                    I verified this transaction externally
                                    before marking it paid.
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  className="payments-action-button is-verify"
                                  onClick={() =>
                                    handleReviewDecision(entry, "verify")
                                  }
                                  disabled={
                                    isReviewing
                                    || !externalVerification[actionId]
                                  }
                                >
                                  {isReviewing ? "Saving..." : "Verify payment"}
                                </button>
                                <label
                                  className="payments-rejection-label"
                                  htmlFor={rejectionInputId}
                                >
                                  Rejection reason
                                </label>
                                <textarea
                                  id={rejectionInputId}
                                  value={reviewReasons[actionId] || ""}
                                  onChange={(event) =>
                                    setReviewReasons((current) => ({
                                      ...current,
                                      [actionId]: event.target.value,
                                    }))
                                  }
                                  maxLength={500}
                                  rows={3}
                                  placeholder="Explain why this reference is rejected"
                                  disabled={isReviewing}
                                />
                                <button
                                  type="button"
                                  className="payments-action-button is-reject"
                                  onClick={() =>
                                    handleReviewDecision(entry, "reject")
                                  }
                                  disabled={
                                    isReviewing
                                    || !reviewReasons[actionId]?.trim()
                                  }
                                >
                                  {isReviewing ? "Saving..." : "Reject reference"}
                                </button>
                                {reviewFeedback[actionId] && (
                                  <p
                                    className={`payments-action-feedback is-${
                                      reviewFeedback[actionId].type
                                    }`}
                                    role={
                                      reviewFeedback[actionId].type === "error"
                                        ? "alert"
                                        : "status"
                                    }
                                  >
                                    {reviewFeedback[actionId].message}
                                  </p>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : isResolutionSection ? (
                  <>
                    {resolutionNotice && (
                      <div
                        className={`payments-review-notice is-${resolutionNotice.type}`}
                        role={
                          resolutionNotice.type === "error" ? "alert" : "status"
                        }
                      >
                        {resolutionNotice.message}
                      </div>
                    )}
                    {resolutionQueueLoading ? (
                      <div className="payments-queue-state" role="status">
                        Loading payments requiring final resolution...
                      </div>
                    ) : resolutionQueueError ? (
                      <div className="payments-queue-error" role="alert">
                        <p>{resolutionQueueError}</p>
                        <button
                          type="button"
                          className="payments-refresh-button"
                          onClick={() => loadResolutionQueue(user.uid)}
                        >
                          Try again
                        </button>
                      </div>
                    ) : resolutionQueue.length === 0 ? (
                      <div className="payments-empty-state">
                        <span className="payments-empty-icon" aria-hidden="true">
                          {activeTab?.icon}
                        </span>
                        <h3>No payments require final resolution</h3>
                        <p>
                          Payments move here after the third reference is
                          rejected and require a final administrator decision.
                        </p>
                      </div>
                    ) : (
                      <div className="payments-qr-queue">
                        {resolutionQueue.map((entry) => {
                          const orderId = entry.orderId;
                          const confirmation = resolutionConfirmations[orderId];
                          const isResolving = resolvingIds.has(orderId);

                          return (
                            <article
                              className="payments-qr-card payments-resolution-card"
                              key={orderId}
                            >
                              <div className="payments-qr-card-heading">
                                <div>
                                  <span className="payments-qr-overline">
                                    ORDER ID
                                  </span>
                                  <h4>{orderId}</h4>
                                  <p>
                                    {entry.customerName || "Customer name unavailable"}
                                    <span> · </span>
                                    <code>{entry.customerId}</code>
                                  </p>
                                </div>
                                <span className="payments-status is-resolution">
                                  <span />
                                  {entry.paymentStatus}
                                </span>
                              </div>

                              <dl className="payments-qr-details">
                                <div>
                                  <dt>Amount due</dt>
                                  <dd>{formatPaymentAmount(entry.amountDue)}</dd>
                                </div>
                                <div>
                                  <dt>Payment timing</dt>
                                  <dd>
                                    {entry.paymentTiming === "advance"
                                      ? "Advance"
                                      : entry.paymentTiming === "pay_later"
                                        ? "Pay Later"
                                        : "Unavailable"}
                                  </dd>
                                </div>
                                <div>
                                  <dt>Attempts used</dt>
                                  <dd>{entry.attemptCount} of 3</dd>
                                </div>
                              </dl>

                              <div className="payments-previous-attempts">
                                <strong>Submission history</strong>
                                <ol>
                                  {entry.submissions.map((submission) => (
                                    <li key={submission.id}>
                                      <span>
                                        Attempt {submission.attemptNumber} ·{" "}
                                        {submission.status}
                                      </span>
                                      <code>
                                        Reference: {submission.referenceNumber}
                                      </code>
                                      <span>
                                        Submitted{" "}
                                        {formatPaymentDate(submission.submittedAt)}
                                      </span>
                                      {submission.rejectionReason && (
                                        <p>
                                          Rejection reason:{" "}
                                          {submission.rejectionReason}
                                        </p>
                                      )}
                                    </li>
                                  ))}
                                </ol>
                              </div>

                              <div className="payments-resolution-actions">
                                <label className="payments-verification-confirm">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(
                                      resolutionVerification[orderId],
                                    )}
                                    onChange={(event) =>
                                      setResolutionVerification((current) => ({
                                        ...current,
                                        [orderId]: event.target.checked,
                                      }))
                                    }
                                    disabled={isResolving || Boolean(confirmation)}
                                  />
                                  <span>
                                    I independently verified the actual
                                    transaction outside this app.
                                  </span>
                                </label>
                                <button
                                  type="button"
                                  className="payments-action-button is-verify"
                                  onClick={() =>
                                    handleStartResolution(entry, "paid")
                                  }
                                  disabled={
                                    isResolving
                                    || Boolean(confirmation)
                                    || !resolutionVerification[orderId]
                                  }
                                >
                                  Mark as Paid
                                </button>

                                <label
                                  className="payments-rejection-label"
                                  htmlFor={`resolution-reason-${orderId}`}
                                >
                                  Final rejection reason
                                </label>
                                <textarea
                                  id={`resolution-reason-${orderId}`}
                                  value={resolutionReasons[orderId] || ""}
                                  onChange={(event) =>
                                    setResolutionReasons((current) => ({
                                      ...current,
                                      [orderId]: event.target.value,
                                    }))
                                  }
                                  maxLength={500}
                                  rows={3}
                                  placeholder="Explain the final rejection decision"
                                  disabled={isResolving || Boolean(confirmation)}
                                />
                                <p className="payments-reason-help">
                                  Required for final rejection; maximum 500
                                  characters.
                                </p>
                                <button
                                  type="button"
                                  className="payments-action-button is-reject"
                                  onClick={() =>
                                    handleStartResolution(entry, "rejected")
                                  }
                                  disabled={
                                    isResolving
                                    || Boolean(confirmation)
                                    || !resolutionReasons[orderId]?.trim()
                                  }
                                >
                                  Final Rejection
                                </button>

                                {confirmation && (
                                  <div
                                    className="payments-resolution-confirmation"
                                    role="group"
                                    aria-label="Confirm final payment resolution"
                                  >
                                    <strong>
                                      Confirm{" "}
                                      {confirmation === "paid"
                                        ? "Mark as Paid"
                                        : "Final Rejection"}
                                      ?
                                    </strong>
                                    <p>
                                      This is a final decision after three
                                      rejected references. The payment record
                                      will not be reopened and submission
                                      history will remain unchanged.
                                      {confirmation === "rejected"
                                        ? ` Reason: ${
                                            resolutionReasons[orderId]?.trim()
                                          }`
                                        : " You are confirming that the actual transaction was verified externally."}
                                    </p>
                                    <div>
                                      <button
                                        type="button"
                                        className="payments-action-button is-verify"
                                        onClick={() =>
                                          handleConfirmResolution(entry)
                                        }
                                        disabled={isResolving}
                                      >
                                        {isResolving
                                          ? "Resolving..."
                                          : "Confirm final resolution"}
                                      </button>
                                      <button
                                        type="button"
                                        className="payments-cancel-button"
                                        onClick={() =>
                                          handleCancelResolution(orderId)
                                        }
                                        disabled={isResolving}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {resolutionFeedback[orderId] && (
                                  <p
                                    className={`payments-action-feedback is-${
                                      resolutionFeedback[orderId].type
                                    }`}
                                    role={
                                      resolutionFeedback[orderId].type ===
                                      "error"
                                        ? "alert"
                                        : "status"
                                    }
                                  >
                                    {resolutionFeedback[orderId].message}
                                  </p>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : records.length === 0 ? (
                  <div className="payments-empty-state">
                    <span className="payments-empty-icon" aria-hidden="true">
                      {activeTab?.icon}
                    </span>
                    <h3>No sample records</h3>
                    <p>
                      There are no illustrative records in this section yet.
                    </p>
                  </div>
                ) : (
                  <div className="payments-table-wrap">
                    <table className="payments-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            {activeSection === "refunds" ? "Request" : "Order"}
                          </th>
                          <th scope="col">Customer</th>
                          <th scope="col">Amount</th>
                          <th scope="col">Updated</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
                          <tr key={record.id}>
                            <td data-label={activeSection === "refunds" ? "Request" : "Order"}>
                              <strong className="payments-record-id">
                                {record.id}
                              </strong>
                            </td>
                            <td data-label="Customer">{record.customer}</td>
                            <td data-label="Amount" className="payments-amount">
                              {record.amount}
                            </td>
                            <td data-label="Updated">
                              {record.submitted}
                            </td>
                            <td data-label="Status">
                              <span className="payments-status">
                                <span />
                                {record.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}

export default AdminPayments;
