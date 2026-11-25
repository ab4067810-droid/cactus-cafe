import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, useNavigate } from "react-router-dom";

import AdminWorkspaceNavigation from "../components/AdminWorkspaceNavigation";
import AdminLoadingSkeleton from "../components/AdminLoadingSkeleton";
import { useAuth } from "../context/Authcontext";
import { logout } from "../services/authService";
import { normalizeOrderStatus } from "../utils/orderStatus.js";
import {
  loadAdminQrVerificationQueue,
  loadAdminQrResolutionQueue,
  loadAdminCashPaymentOrders,
  loadAdminTransactionHistory,
  markCashOrderPaid,
  reviewQrPaymentSubmission,
  resolveAdminQrPaymentRecord,
  updateAdminQrOrderPaymentStatus,
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

const prototypeRecords = {
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
};

const historyFilters = [
  { id: "all", label: "All" },
  { id: "qr", label: "GCash QR" },
  { id: "cash", label: "Cash" },
  { id: "paid", label: "Paid" },
  { id: "attention", label: "Needs Attention" },
];

const isTransactionNeedsAttention = (transaction) =>
  transaction.paymentStatus !== "paid";

const transactionStatusLabels = {
  admin_review_required: "Admin review required",
  needs_review: "Needs review",
  paid: "Paid",
  pending_review: "Pending review",
  pending_verification: "Pending verification",
  rejected: "Rejected",
  unpaid: "Unpaid",
};

const getTransactionStatusLabel = (status) =>
  transactionStatusLabels[status] || status || "Unknown";

const getTransactionStatusTone = (transaction) => {
  if (transaction.paymentStatus === "paid") return "is-paid";
  if (isTransactionNeedsAttention(transaction)) return "is-attention";
  return "is-pending";
};

const formatPaymentAmount = (amountDue) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format((Number(amountDue) || 0) / 100);

const formatPeso = (amount) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(amount) || 0);

const formatPaymentDate = (timestamp) => {
  if (!timestamp?.toDate) return "Date unavailable";
  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

function CheckoutQrEvidence({
  entry,
  copyFeedback,
  onCopyReference,
  onOpenReceipt,
}) {
  const feedbackForEntry = copyFeedback?.orderId === entry.orderId
    ? copyFeedback
    : null;

  return (
    <section className="payments-checkout-evidence" aria-label="Checkout QR payment evidence">
      <div>
        <span className="payments-evidence-label">
          13-digit GCash Reference Number
        </span>
        {entry.paymentReference ? (
          <div className="payments-reference-row">
            <code>{entry.paymentReference}</code>
            <button
              type="button"
              className="payments-copy-button"
              onClick={() => onCopyReference(entry)}
              aria-label={
                feedbackForEntry?.copied
                  ? "GCash reference copied"
                  : `Copy GCash reference ${entry.paymentReference}`
              }
            >
              {feedbackForEntry?.copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="payments-missing-evidence">Reference number unavailable.</p>
        )}
        {feedbackForEntry && (
          <span className="payments-copy-feedback" role="status">
            {feedbackForEntry.message}
          </span>
        )}
      </div>
      <div>
        <span className="payments-evidence-label">Receipt Screenshot</span>
        {entry.paymentProofUrl ? (
          <button
            type="button"
            className="payments-receipt-preview"
            onClick={() => onOpenReceipt({
              orderId: entry.orderId,
              reference: entry.paymentReference,
              total: entry.orderTotal,
              url: entry.paymentProofUrl,
            })}
            aria-label={`Enlarge receipt screenshot for order ${entry.orderId}`}
          >
            <img
              src={entry.paymentProofUrl}
              alt={`Uploaded GCash receipt for order ${entry.orderId}`}
            />
            <span>Enlarge receipt</span>
          </button>
        ) : (
          <p className="payments-missing-evidence">Receipt screenshot unavailable.</p>
        )}
      </div>
    </section>
  );
}

function TransactionHistoryCard({
  transaction,
  copyFeedback,
  onCopyReference,
  onOpenReceipt,
}) {
  const feedbackForEntry = copyFeedback?.orderId === transaction.orderId
    ? copyFeedback
    : null;
  const isQr = transaction.kind === "qr";

  return (
    <article className="payments-history-card">
      <header className="payments-history-card-header">
        <div>
          <span className="payments-qr-overline">ORDER ID</span>
          <h4>{transaction.orderId}</h4>
        </div>
        <span
          className={`payments-status payments-history-status ${
            getTransactionStatusTone(transaction)
          }`}
        >
          <span />
          {getTransactionStatusLabel(transaction.paymentStatus)}
        </span>
      </header>
      <dl className="payments-history-details">
        <div>
          <dt>Customer</dt>
          <dd>{transaction.customerName || "Customer name unavailable"}</dd>
        </div>
        <div>
          <dt>Order type</dt>
          <dd>{transaction.orderType || "Unavailable"}</dd>
        </div>
        <div>
          <dt>Transaction date</dt>
          <dd>{formatPaymentDate(transaction.timestamp)}</dd>
        </div>
        <div>
          <dt>{isQr ? "Order total" : "Total due"}</dt>
          <dd>{formatPeso(transaction.total)}</dd>
        </div>
        <div>
          <dt>Payment method</dt>
          <dd>{isQr ? "GCash QR" : "Cash"}</dd>
        </div>
      </dl>
      {isQr && transaction.paymentReference && (
        <div className="payments-history-reference">
          <span>13-digit GCash Reference Number</span>
          <code>{transaction.paymentReference}</code>
          <button
            type="button"
            className="payments-copy-button"
            onClick={() => onCopyReference(transaction)}
            aria-label={
              feedbackForEntry?.copied
                ? "GCash reference copied"
                : `Copy GCash reference ${transaction.paymentReference}`
            }
          >
            {feedbackForEntry?.copied ? "Copied!" : "Copy"}
          </button>
          {feedbackForEntry && (
            <span className="payments-copy-feedback" role="status">
              {feedbackForEntry.message}
            </span>
          )}
        </div>
      )}
      {isQr && transaction.paymentProofUrl && (
        <button
          type="button"
          className="payments-history-receipt-button"
          onClick={() => onOpenReceipt({
            orderId: transaction.orderId,
            reference: transaction.paymentReference,
            total: transaction.total,
            url: transaction.paymentProofUrl,
          })}
        >
          View receipt
        </button>
      )}
    </article>
  );
}

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
  const [cashOrders, setCashOrders] = useState([]);
  const [cashQueueLoading, setCashQueueLoading] = useState(true);
  const [cashQueueError, setCashQueueError] = useState("");
  const [cashPaymentFeedback, setCashPaymentFeedback] = useState("");
  const [markingCashOrderId, setMarkingCashOrderId] = useState(null);
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [transactionHistoryLoading, setTransactionHistoryLoading] = useState(true);
  const [transactionHistoryError, setTransactionHistoryError] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
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
  const receiptDialogRef = useRef(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);

  useEffect(() => {
    const dialog = receiptDialogRef.current;
    if (!dialog) return;

    if (receiptPreview && !dialog.open) {
      dialog.showModal();
    } else if (!receiptPreview && dialog.open) {
      dialog.close();
    }
  }, [receiptPreview]);

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

  const loadCashQueue = useCallback(async (adminId) => {
    try {
      setCashQueueLoading(true);
      setCashQueueError("");
      setCashOrders(await loadAdminCashPaymentOrders(adminId));
      return true;
    } catch (queueError) {
      console.error("Error loading cash payment records:", queueError);
      setCashQueueError("Unable to load cash payment records. Please refresh.");
      return false;
    } finally {
      setCashQueueLoading(false);
    }
  }, []);

  const loadTransactionHistory = useCallback(async (adminId) => {
    try {
      setTransactionHistoryLoading(true);
      setTransactionHistoryError("");
      setTransactionHistory(await loadAdminTransactionHistory(adminId));
      return true;
    } catch (historyError) {
      console.error("Error loading transaction history:", historyError);
      setTransactionHistoryError(
        "Unable to load transaction history. Please refresh and try again.",
      );
      return false;
    } finally {
      setTransactionHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && (!user || !["admin", "staff"].includes(role))) {
      navigate(
        user && role === "customer" ? "/menu" : "/login",
        { replace: true },
      );
    }
  }, [loading, navigate, role, user]);

  useEffect(() => {
    if (!loading && user && ["admin", "staff"].includes(role)) {
      loadQrQueue(user.uid);
      loadResolutionQueue(user.uid);
      loadCashQueue(user.uid);
      loadTransactionHistory(user.uid);
    }
  }, [
    loadCashQueue,
    loadQrQueue,
    loadResolutionQueue,
    loadTransactionHistory,
    loading,
    role,
    user,
  ]);

  const handleMarkCashPaid = async (order) => {
    if (markingCashOrderId) return;
    setMarkingCashOrderId(order.id);
    setCashPaymentFeedback("");
    try {
      await markCashOrderPaid({ orderId: order.id, adminId: user.uid });
      setCashPaymentFeedback(`Cash payment for order ${order.id} was recorded.`);
      await loadCashQueue(user.uid);
    } catch (paymentError) {
      console.error("Unable to record cash payment:", paymentError);
      setCashPaymentFeedback(
        paymentError instanceof Error
          ? paymentError.message
          : "Unable to record this cash payment. Refresh the queue and try again.",
      );
    } finally {
      setMarkingCashOrderId(null);
    }
  };

  const handleCopyReference = async (entry) => {
    try {
      await navigator.clipboard.writeText(entry.paymentReference);
      setCopyFeedback({
        orderId: entry.orderId,
        message: "GCash reference copied.",
        copied: true,
      });
    } catch (copyError) {
      console.error("Unable to copy GCash reference:", copyError);
      setCopyFeedback({
        orderId: entry.orderId,
        message: "Unable to copy. Select the reference number manually.",
        copied: false,
      });
    }
  };

  const handleCheckoutPaymentDecision = async (entry, paymentStatus) => {
    const actionId = `${entry.orderId}/checkout`;
    if (reviewingIdsRef.current.has(actionId)) return;

    if (
      paymentStatus === "paid"
      && !externalVerification[actionId]
    ) {
      setReviewFeedback((current) => ({
        ...current,
        [actionId]: {
          type: "error",
          message: "Confirm the transaction was verified externally first.",
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
      await updateAdminQrOrderPaymentStatus({
        orderId: entry.orderId,
        adminId: user.uid,
        paymentStatus,
      });
      setExternalVerification((current) => ({
        ...current,
        [actionId]: false,
      }));
      setReviewNotice({
        type: "success",
        message: `Order ${entry.orderId} payment status was updated to ${paymentStatus}.`,
      });

      const [qrRefreshed, resolutionRefreshed] = await Promise.all([
        loadQrQueue(user.uid),
        loadResolutionQueue(user.uid),
      ]);
      if (!qrRefreshed || !resolutionRefreshed) {
        setReviewNotice({
          type: "error",
          message: "The payment status was saved, but a queue could not refresh.",
        });
      }
    } catch (reviewError) {
      console.error("Unable to update checkout QR payment:", reviewError);
      setReviewFeedback((current) => ({
        ...current,
        [actionId]: {
          type: "error",
          message: reviewError instanceof Error
            ? reviewError.message
            : "Unable to update this payment. Refresh the queue and try again.",
        },
      }));
    } finally {
      reviewingIdsRef.current.delete(actionId);
      setReviewingIds(new Set(reviewingIdsRef.current));
    }
  };

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
      entry.source === "checkout"
      && decision === "paid"
      && (
        !/^\d{13}$/.test(entry.paymentReference || "")
        || !entry.paymentProofUrl
      )
    ) {
      setResolutionFeedback((current) => ({
        ...current,
        [entry.orderId]: {
          type: "error",
          message: "A 13-digit GCash reference and receipt are required before marking payment paid.",
        },
      }));
      return;
    }
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
      && entry.source !== "checkout"
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
    if (
      decision === "rejected"
      && entry.source !== "checkout"
      && !reason.trim()
    ) return;

    resolvingIdsRef.current.add(orderId);
    setResolvingIds(new Set(resolvingIdsRef.current));
    setResolutionFeedback((current) => ({
      ...current,
      [orderId]: null,
    }));

    try {
      if (entry.source === "checkout") {
        await updateAdminQrOrderPaymentStatus({
          orderId,
          adminId: user.uid,
          paymentStatus: decision,
        });
      } else {
        await resolveAdminQrPaymentRecord({
          orderId,
          adminId: user.uid,
          decision,
          resolutionReason: reason,
        });
      }
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

      const refreshResults = await Promise.all([
        loadQrQueue(user.uid),
        loadResolutionQueue(user.uid),
      ]);
      if (refreshResults.some((refreshed) => !refreshed)) {
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

  const filteredTransactionHistory = useMemo(() => {
    const search = historySearch.trim().toLocaleLowerCase();
    return transactionHistory.filter((transaction) => {
      const matchesFilter = historyFilter === "all"
        || (historyFilter === "qr" && transaction.kind === "qr")
        || (historyFilter === "cash" && transaction.kind === "cash")
        || (historyFilter === "paid" && transaction.paymentStatus === "paid")
        || (
          historyFilter === "attention"
          && isTransactionNeedsAttention(transaction)
        );
      if (!matchesFilter) return false;
      if (!search) return true;

      return [
        transaction.orderId,
        transaction.customerName,
        transaction.paymentReference,
      ]
        .some((value) => String(value || "").toLocaleLowerCase().includes(search));
    });
  }, [historyFilter, historySearch, transactionHistory]);

  const collectedTotal = useMemo(
    () => transactionHistory.reduce(
      (total, transaction) => (
        transaction.paymentStatus === "paid"
          ? total + (Number(transaction.total) || 0)
          : total
      ),
      0,
    ),
    [transactionHistory],
  );
  const unpaidOrderCount = useMemo(() => {
    const unpaidOrderIds = new Set(
      cashOrders
        .filter((order) => (
          order.cashPaymentStatus !== "paid"
          && normalizeOrderStatus(order.status) !== "Cancelled"
        ))
        .map((order) => order.id),
    );

    transactionHistory.forEach((transaction) => {
      if (
        transaction.source === "order"
        && transaction.kind === "qr"
        && transaction.paymentStatus !== "paid"
      ) {
        unpaidOrderIds.add(transaction.orderId);
      }
    });
    [...qrQueue, ...resolutionQueue].forEach((payment) => {
      if (payment.orderId) unpaidOrderIds.add(payment.orderId);
    });

    return unpaidOrderIds.size;
  }, [cashOrders, qrQueue, resolutionQueue, transactionHistory]);

  if (!loading && (!user || !["admin", "staff"].includes(role))) {
    return null;
  }

  const activeTab = paymentSections.find(
    (section) => section.id === activeSection,
  );
  const isQrSection = activeSection === "qr";
  const isResolutionSection = activeSection === "qr-resolution";
  const isCashSection = activeSection === "cash";
  const isHistorySection = activeSection === "history";
  const isLiveSection =
    isQrSection || isResolutionSection || isCashSection || isHistorySection;
  const records = isLiveSection ? [] : prototypeRecords[activeSection] || [];
  const overviewCards = [
    {
      label: "Total Collected",
      value: transactionHistoryError ? "—" : formatPeso(collectedTotal),
      detail: transactionHistoryError
        ? "Live total unavailable"
        : "Paid QR/cash + legacy payment records",
      loading: transactionHistoryLoading,
      icon: "₱",
      tone: "green",
    },
    {
      label: "Unpaid Orders",
      value: cashQueueError
        || transactionHistoryError
        || qrQueueError
        || resolutionQueueError
        ? "—"
        : unpaidOrderCount,
      detail: cashQueueError
        || transactionHistoryError
        || qrQueueError
        || resolutionQueueError
        ? "Live count unavailable"
        : "Approved orders still awaiting payment",
      loading:
        cashQueueLoading
        || transactionHistoryLoading
        || qrQueueLoading
        || resolutionQueueLoading,
      icon: "◷",
      tone: "amber",
    },
    {
      label: "Pending QR Verification",
      value: qrQueueError ? "—" : qrQueue.length,
      detail: qrQueueError
        ? "Live queue unavailable"
        : "Live payments awaiting review",
      loading: qrQueueLoading,
      icon: "▧",
      tone: "blue",
    },
  ];

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
          <span className="payments-brand-mark" aria-hidden="true">C</span>
          <span>
            <strong>Cactus Café</strong>
            <small>STAFF WORKSPACE</small>
          </span>
        </NavLink>

        <div className="payments-sidebar-label">WORKSPACE</div>
        <nav className="payments-nav">
          <AdminWorkspaceNavigation
            classPrefix="payments"
            onNavigate={() => setMobileNavigationOpen(false)}
          />
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
            {loading ? (
              <AdminLoadingSkeleton
                label="Loading payment workspace"
                stats={4}
                rows={5}
              />
            ) : (
              <>
            <section className="payments-heading">
              <div>
                <p className="payments-eyebrow">FINANCE OVERVIEW</p>
                <h1>Payment Management</h1>
                <p className="payments-intro">
                  Review payment activity, verify QR submissions, and manage
                  prototype refund examples in one place.
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
                    : isCashSection
                      ? "Live cash records"
                      : isHistorySection
                        ? "Live transaction history"
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
                    ? "Checkout mismatches and legacy third-rejection records can be resolved here. Verify transactions externally before marking one paid."
                    : isCashSection
                      ? "Cash payments are recorded against approved Cash orders. Mark an order paid only after collecting the full amount due."
                      : isHistorySection
                        ? "Approved GCash QR and Cash orders, plus standalone legacy payment records, are loaded from Firestore."
                      : "Refund Management is prototype-only sample data and is not connected to Firestore."}
              </p>
            </div>

            <section className="payments-overview" aria-label="Payment overview">
              {overviewCards.map((card) => (
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
                      {card.loading ? (
                        <span className="admin-skeleton-shape admin-skeleton-value" aria-hidden="true" />
                      ) : card.value}
                    </strong>
                    <span className="payments-stat-detail">
                      {card.loading
                        ? <span className="admin-skeleton-shape admin-skeleton-label" aria-hidden="true" />
                        : card.detail}
                    </span>
                  </article>
              ))}
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
                      : isCashSection
                        ? "Live cash payment records"
                        : isHistorySection
                          ? "Live Firestore transaction history"
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
                        ? "Checkout QR orders and legacy payment submissions awaiting review are shown."
                        : isResolutionSection
                          ? "Checkout QR orders marked needs review and legacy records requiring final resolution are shown."
                          : isCashSection
                            ? "Approved Cash orders and their recorded collection status."
                            : isHistorySection
                              ? "All approved Cash and GCash QR orders plus unmatched legacy payment records."
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
                        : isCashSection
                          ? `${cashOrders.length} ${
                              cashOrders.length === 1 ? "order" : "orders"
                            }`
                          : isHistorySection
                            ? `${filteredTransactionHistory.length} of ${
                                transactionHistory.length
                              } transactions`
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
                          : isResolutionSection
                            ? loadResolutionQueue(user.uid)
                            : isCashSection
                              ? loadCashQueue(user.uid)
                              : loadTransactionHistory(user.uid)
                      }
                      disabled={
                        isQrSection
                          ? qrQueueLoading
                          : isResolutionSection
                            ? resolutionQueueLoading
                            : isCashSection
                              ? cashQueueLoading
                              : transactionHistoryLoading
                      }
                    >
                      {isHistorySection ? "Refresh history" : "Refresh queue"}
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
                      <AdminLoadingSkeleton
                        label="Loading pending QR submissions"
                        compact
                        rows={3}
                      />
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
                          New checkout QR orders and customer references will
                          appear here while awaiting payment review.
                        </p>
                      </div>
                    ) : (
                      <div className="payments-qr-queue">
                        {qrQueue.map((entry) => {
                          const actionId = entry.source === "checkout"
                            ? `${entry.orderId}/checkout`
                            : `${entry.orderId}/${entry.submission.id}`;
                          const verificationCheckboxId =
                            `verify-${entry.orderId}-${entry.source === "checkout"
                              ? "checkout"
                              : entry.submission.id}`;
                          const rejectionInputId =
                            `reject-${entry.orderId}-${entry.submission?.id || "checkout"}`;
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
                                  <dt>
                                    {entry.source === "checkout"
                                      ? "Order total"
                                      : "Amount due"}
                                  </dt>
                                  <dd>{formatPaymentAmount(entry.amountDue)}</dd>
                                </div>
                                {Number(entry.deliveryFee) > 0 && (
                                  <div>
                                    <dt>Delivery fee (included)</dt>
                                    <dd>{formatPeso(entry.deliveryFee)}</dd>
                                  </div>
                                )}
                                {Number(entry.waitingFee) > 0 && (
                                  <div>
                                    <dt>Waiting fee (collect at handoff)</dt>
                                    <dd>{formatPeso(entry.waitingFee)}</dd>
                                  </div>
                                )}
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
                                  <dt>Submitted</dt>
                                  <dd>
                                    {formatPaymentDate(
                                      entry.submission?.submittedAt || entry.submittedAt,
                                    )}
                                  </dd>
                                </div>
                                {entry.source === "checkout" ? (
                                  <div>
                                    <dt>Payment source</dt>
                                    <dd>Checkout QR</dd>
                                  </div>
                                ) : (
                                  <>
                                    <div>
                                      <dt>Attempt</dt>
                                      <dd>{entry.submission.attemptNumber} of 3</dd>
                                    </div>
                                    <div>
                                      <dt>Transaction reference</dt>
                                      <dd>{entry.submission.referenceNumber}</dd>
                                    </div>
                                  </>
                                )}
                              </dl>

                              {entry.source === "checkout" ? (
                                <CheckoutQrEvidence
                                  entry={entry}
                                  copyFeedback={copyFeedback}
                                  onCopyReference={handleCopyReference}
                                  onOpenReceipt={setReceiptPreview}
                                />
                              ) : (
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
                              )}

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
                                    entry.source === "checkout"
                                      ? handleCheckoutPaymentDecision(entry, "paid")
                                      : handleReviewDecision(entry, "verify")
                                  }
                                  disabled={
                                    isReviewing
                                    || !externalVerification[actionId]
                                    || (
                                      entry.source === "checkout"
                                      && (
                                        !/^\d{13}$/.test(entry.paymentReference || "")
                                        || !entry.paymentProofUrl
                                      )
                                    )
                                  }
                                >
                                  {isReviewing ? "Saving..." : "Verify payment"}
                                </button>
                                {entry.source === "checkout" && (
                                  <button
                                    type="button"
                                    className="payments-action-button is-review"
                                    onClick={() =>
                                      handleCheckoutPaymentDecision(
                                        entry,
                                        "needs_review",
                                      )
                                    }
                                    disabled={isReviewing}
                                  >
                                    {isReviewing ? "Saving..." : "Needs review"}
                                  </button>
                                )}
                                {entry.source !== "checkout" && (
                                  <>
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
                                      {isReviewing
                                        ? "Saving..."
                                        : "Reject reference"}
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
                                  </>
                                )}
                                {entry.source === "checkout" && (
                                  <button
                                    type="button"
                                    className="payments-action-button is-reject"
                                    onClick={() =>
                                      handleCheckoutPaymentDecision(
                                        entry,
                                        "rejected",
                                      )
                                    }
                                    disabled={isReviewing}
                                  >
                                    {isReviewing ? "Saving..." : "Reject payment"}
                                  </button>
                                )}
                                {entry.source === "checkout"
                                  && reviewFeedback[actionId] && (
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
                      <AdminLoadingSkeleton
                        label="Loading payments requiring final resolution"
                        compact
                        rows={3}
                      />
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
                          Checkout payments flagged for review and legacy
                          payments escalated after three rejections appear here.
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
                                  <dt>
                                    {entry.source === "checkout"
                                      ? "Order total"
                                      : "Amount due"}
                                  </dt>
                                  <dd>{formatPaymentAmount(entry.amountDue)}</dd>
                                </div>
                                {Number(entry.deliveryFee) > 0 && (
                                  <div>
                                    <dt>Delivery fee (included)</dt>
                                    <dd>{formatPeso(entry.deliveryFee)}</dd>
                                  </div>
                                )}
                                {Number(entry.waitingFee) > 0 && (
                                  <div>
                                    <dt>Waiting fee (collect at handoff)</dt>
                                    <dd>{formatPeso(entry.waitingFee)}</dd>
                                  </div>
                                )}
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
                                  <dt>
                                    {entry.source === "checkout"
                                      ? "Payment source"
                                      : "Attempts used"}
                                  </dt>
                                  <dd>
                                    {entry.source === "checkout"
                                      ? "Checkout QR"
                                      : `${entry.attemptCount} of 3`}
                                  </dd>
                                </div>
                              </dl>

                              {entry.source === "checkout" ? (
                                <CheckoutQrEvidence
                                  entry={entry}
                                  copyFeedback={copyFeedback}
                                  onCopyReference={handleCopyReference}
                                  onOpenReceipt={setReceiptPreview}
                                />
                              ) : (
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
                              )}

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

                                {entry.source !== "checkout" && (
                                  <>
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
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="payments-action-button is-reject"
                                  onClick={() =>
                                    handleStartResolution(entry, "rejected")
                                  }
                                  disabled={
                                    isResolving
                                    || Boolean(confirmation)
                                    || (
                                      entry.source !== "checkout"
                                      && !resolutionReasons[orderId]?.trim()
                                    )
                                  }
                                >
                                  {entry.source === "checkout"
                                    ? "Reject payment"
                                    : "Final Rejection"}
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
                                        : entry.source === "checkout"
                                          ? "Reject payment"
                                          : "Final Rejection"}
                                      ?
                                    </strong>
                                    <p>
                                      {entry.source === "checkout"
                                        ? "This updates the checkout order payment status immediately for Admin Orders and My Orders."
                                        : "This is a final decision after three rejected references. The payment record will not be reopened and submission history will remain unchanged."}
                                      {confirmation === "rejected"
                                        ? entry.source === "checkout"
                                          ? ""
                                          : ` Reason: ${
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
                ) : isCashSection ? (
                  <>
                    {cashPaymentFeedback && (
                      <p className="payments-action-feedback is-success" role="status">
                        {cashPaymentFeedback}
                      </p>
                    )}
                    {cashQueueLoading ? (
                      <AdminLoadingSkeleton
                        label="Loading cash payment records"
                        compact
                        rows={3}
                      />
                    ) : cashQueueError ? (
                      <div className="payments-queue-error" role="alert">
                        <p>{cashQueueError}</p>
                        <button
                          type="button"
                          className="payments-refresh-button"
                          onClick={() => loadCashQueue(user.uid)}
                        >
                          Try again
                        </button>
                      </div>
                    ) : cashOrders.length === 0 ? (
                      <div className="payments-empty-state">
                        <span className="payments-empty-icon" aria-hidden="true">
                          {activeTab?.icon}
                        </span>
                        <h3>No approved Cash orders</h3>
                        <p>
                          Cash orders will appear here after staff approves a
                          customer request.
                        </p>
                      </div>
                    ) : (
                      <div className="payments-table-wrap">
                        <table className="payments-table">
                          <thead>
                            <tr>
                              <th scope="col">Order</th>
                              <th scope="col">Customer</th>
                              <th scope="col">Items subtotal</th>
                              <th scope="col">Delivery / waiting fees</th>
                              <th scope="col">Total due</th>
                              <th scope="col">Collection</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cashOrders.map((order) => {
                              const deliveryFee = Number(order.deliveryFee) || 0;
                              const waitingFee = Number(order.waitingFee) || 0;
                              const canCollect =
                                order.cashPaymentStatus !== "paid"
                                && order.status !== "Cancelled";
                              return (
                                <tr key={order.id}>
                                  <td data-label="Order">
                                    <strong className="payments-record-id">
                                      {order.id}
                                    </strong>
                                    <span className="payments-record-subtitle">
                                      {order.status || "Pending"}
                                    </span>
                                  </td>
                                  <td data-label="Customer">
                                    {order.customerName || "Customer"}
                                  </td>
                                  <td data-label="Items subtotal" className="payments-amount">
                                    {formatPeso(
                                      Number(order.itemsSubtotal)
                                        || Number(order.total || 0) - deliveryFee,
                                    )}
                                  </td>
                                  <td data-label="Delivery / waiting fees">
                                    {deliveryFee > 0 && (
                                      <span>Delivery: {formatPeso(deliveryFee)}</span>
                                    )}
                                    {waitingFee > 0 && (
                                      <span>Waiting: {formatPeso(waitingFee)}</span>
                                    )}
                                    {!deliveryFee && !waitingFee && "—"}
                                  </td>
                                  <td data-label="Total due" className="payments-amount">
                                    {formatPeso(order.amountDue)}
                                  </td>
                                  <td data-label="Collection">
                                    {order.cashPaymentStatus === "paid" ? (
                                      <span className="payments-status is-paid">
                                        <span />
                                        Paid
                                        {order.cashPaymentAt?.toDate && (
                                          <small>
                                            {formatPaymentDate(order.cashPaymentAt)}
                                          </small>
                                        )}
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="payments-action-button is-verify"
                                        onClick={() => handleMarkCashPaid(order)}
                                        disabled={
                                          markingCashOrderId === order.id
                                          || !canCollect
                                        }
                                      >
                                        {markingCashOrderId === order.id
                                          ? "Recording..."
                                          : canCollect
                                            ? "Mark as Paid"
                                            : "Cancelled"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : isHistorySection ? (
                  <>
                    <div className="payments-history-controls">
                      <div
                        className="payments-history-filters"
                        role="group"
                        aria-label="Filter transaction history"
                      >
                        {historyFilters.map((filter) => (
                          <button
                            key={filter.id}
                            type="button"
                            className={`payments-history-filter${
                              historyFilter === filter.id ? " is-active" : ""
                            }`}
                            aria-pressed={historyFilter === filter.id}
                            onClick={() => setHistoryFilter(filter.id)}
                          >
                            {filter.label}
                          </button>
                        ))}
                      </div>
                      <label className="payments-history-search">
                        <span>Search transactions</span>
                        <input
                          type="search"
                          value={historySearch}
                          onChange={(event) => setHistorySearch(event.target.value)}
                          placeholder="Order ID, customer, or GCash reference"
                        />
                      </label>
                    </div>
                    {transactionHistoryLoading ? (
                      <AdminLoadingSkeleton
                        label="Loading transaction history"
                        compact
                        rows={3}
                      />
                    ) : transactionHistoryError ? (
                      <div className="payments-queue-error" role="alert">
                        <p>{transactionHistoryError}</p>
                        <button
                          type="button"
                          className="payments-refresh-button"
                          onClick={() => loadTransactionHistory(user.uid)}
                        >
                          Try again
                        </button>
                      </div>
                    ) : filteredTransactionHistory.length === 0 ? (
                      <div className="payments-empty-state">
                        <span className="payments-empty-icon" aria-hidden="true">
                          {activeTab?.icon}
                        </span>
                        <h3>
                          {transactionHistory.length === 0
                            ? "No transactions found"
                            : "No matching transactions"}
                        </h3>
                        <p>
                          {transactionHistory.length === 0
                            ? "Approved GCash QR and Cash orders will appear here."
                            : "Try another filter or search term."}
                        </p>
                      </div>
                    ) : (
                      <div className="payments-history-list">
                        {filteredTransactionHistory.map((transaction) => (
                          <TransactionHistoryCard
                            key={transaction.id}
                            transaction={transaction}
                            copyFeedback={copyFeedback}
                            onCopyReference={handleCopyReference}
                            onOpenReceipt={setReceiptPreview}
                          />
                        ))}
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
              </>
            )}
          </div>
        </div>
      </section>
      <dialog
        ref={receiptDialogRef}
        className="payments-receipt-dialog"
        aria-labelledby="payments-receipt-dialog-title"
        onClose={() => setReceiptPreview(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            receiptDialogRef.current?.close();
          }
        }}
      >
        {receiptPreview && (
          <div className="payments-receipt-dialog-card">
            <header>
              <div>
                <p>GCASH PAYMENT RECEIPT</p>
                <h2 id="payments-receipt-dialog-title">
                  Order {receiptPreview.orderId}
                </h2>
              </div>
              <button
                type="button"
                className="payments-receipt-dialog-close"
                onClick={() => receiptDialogRef.current?.close()}
                aria-label="Close GCash receipt preview"
              >
                Close
              </button>
            </header>
            <div className="payments-receipt-dialog-meta">
              {receiptPreview.reference && (
                <span>
                  Reference <strong>{receiptPreview.reference}</strong>
                </span>
              )}
              <span>
                Order total{" "}
                <strong>
                  {Number.isFinite(receiptPreview.total)
                    ? formatPeso(receiptPreview.total)
                    : "Unavailable"}
                </strong>
              </span>
            </div>
            <img
              src={receiptPreview.url}
              alt={`GCash receipt for order ${receiptPreview.orderId}`}
            />
            <a
              href={receiptPreview.url}
              target="_blank"
              rel="noreferrer"
            >
              Open original receipt
            </a>
          </div>
        )}
      </dialog>
    </main>
  );
}

export default AdminPayments;
