import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { NavLink, useNavigate } from "react-router-dom";

import AdminWorkspaceNavigation from "../components/AdminWorkspaceNavigation";
import AdminLoadingSkeleton from "../components/AdminLoadingSkeleton";
import { auth, db } from "../services/firebase";
import { getEffectiveRole } from "../utils/userRole";
import { listBlockedPhones } from "../services/blockedPhoneService";
import PhoneBlockControl from "../components/PhoneBlockControl";
import {
  approveOrderRequest,
  updateQrOrderPaymentStatus,
} from "../services/orderApprovalService";
import { loadAdminOrderPaymentDetails } from "../services/paymentRecordService";
import {
  createCustomerNotification,
  updateStatusWithNotification,
} from "../services/notificationService";
import { getApprovalPricing } from "../utils/approvalPricing";
import { getOrderApprovalPricing } from "../utils/deliveryFees.js";
import { getDeliveryFeeForBarangay } from "../utils/deliveryFees.js";
import { normalizeDeliveryProofUrl } from "../utils/deliveryProofUrl.js";
import {
  canApplyDeliveryWaitingFee,
  DELIVERY_WAITING_FEE,
  formatDeliveryGraceRemaining,
  getDeliveryGracePeriod,
  hasDeliveryWaitingFee,
} from "../utils/orderStatus.js";
import { normalizePHPhone } from "../utils/phoneUtils.js";
import "../styles/AdminOrders.css";
import "../styles/AdminSidebar.css";

const BASE_STATUS_OPTIONS = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready",
  "Completed",
  "Cancelled",
];

const REQUEST_STATUS_OPTIONS = [
  "All",
  "pending",
  "approved",
  "rejected",
];

const DEFAULT_REJECTION_REASON =
  "We are unable to fulfill this order request at this time.";
const UNREACHABLE_ORDER_REASON =
  "Customer could not be reached after the 10-minute delivery grace period.";
const QUICK_REJECTION_REASONS = [
  {
    value: "unavailable",
    label: "One or more requested items are unavailable",
    reason: "One or more requested items are unavailable.",
  },
  {
    value: "fulfillment",
    label: "Unable to meet the requested fulfillment time",
    reason: "We cannot meet the requested pickup or delivery time.",
  },
  {
    value: "clarification",
    label: "Order details need clarification",
    reason: "The order details need clarification. Please contact the cafe.",
  },
];

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Date unavailable";
  }

  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const formatOrderType = (orderType) => {
  const labels = {
    takeout: "Takeout",
    pickup: "Pickup",
    delivery: "Delivery",
    "dine-in": "Dine-in",
    dinein: "Dine-in",
  };

  return labels[String(orderType || "").toLowerCase()] || "Not specified";
};

const getPaymentMethodLabel = (method) => (
  method === "cash"
    ? "Cash"
    : method === "qr" ? "GCash QR" : "Not recorded"
);

const getPaymentStatusLabel = (status) => ({
  unpaid: "Unpaid",
  paid: "Verified in GCash",
  pending_verification: "Awaiting GCash confirmation",
  pending_review: "Awaiting GCash confirmation",
  needs_review: "Needs review",
  admin_review_required: "Needs review",
  rejected: "Rejected",
  "not submitted": "Awaiting QR reference",
}[status] || status || "Not recorded");

const getPaymentStatusClass = (status) => String(status || "unknown")
  .toLowerCase()
  .replace(/_/g, "-")
  .replace(/\s+/g, "-");

const normalizeOrderType = (orderType) => {
  const normalizedType = String(orderType || "").trim().toLowerCase();

  if (normalizedType === "dine-in" || normalizedType === "dinein") {
    return "dine-in";
  }
  if (normalizedType === "takeout" || normalizedType === "pickup") {
    return "takeout";
  }
  if (normalizedType === "delivery") {
    return "delivery";
  }

  return "";
};

const OverviewStatIcon = ({ name }) => {
  const icons = {
    orders: (
      <>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </>
    ),
    active: <path d="M5 17 17 5M8 5h9v9" />,
    pending: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    revenue: (
      <>
        <path d="M8 3v18M8 4h5a4 4 0 0 1 0 8H8" />
        <path d="M6 14h8M6 18h8" />
      </>
    ),
    approved: <path d="m5 12 4 4L19 6" />,
    rejected: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
};

const OrderItemThumbnail = ({ imageUrl }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const normalizedImageUrl =
    typeof imageUrl === "string" ? imageUrl.trim() : "";

  return (
    <span className="admin-order-item-thumbnail" aria-hidden="true">
      {normalizedImageUrl && !imageFailed ? (
        <img
          src={normalizedImageUrl}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="admin-order-item-image-placeholder">☕</span>
      )}
    </span>
  );
};

const getStatusClass = (status) =>
  String(status || "Pending")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

const getStatusOptions = (order) => {
  const orderType = normalizeOrderType(order.orderType);

  let options = BASE_STATUS_OPTIONS;

  if (orderType === "delivery") {
    options = [
      "Pending",
      "Confirmed",
      "Preparing",
      "Ready",
      "Out for Delivery",
      "Completed",
      "Cancelled",
    ];
  }

  if (orderType === "takeout") {
    options = [
      "Pending",
      "Confirmed",
      "Preparing",
      "Ready for Pickup",
      "Completed",
      "Cancelled",
    ];
  }

  if (orderType === "dine-in") {
    options = [
      "Pending",
      "Confirmed",
      "Preparing",
      "Ready",
      "Completed",
      "Cancelled",
    ];
  }

  if (
    order.paymentMethod === "cash"
    && order.cashPaymentStatus !== "paid"
  ) {
    options = [...options, "On Hold"];
  }

  const currentStatus = order.status || "Pending";

  if (!options.includes(currentStatus)) {
    return [currentStatus, ...options];
  }

  return options;
};

const getStatusFlowDescription = (order) => {
  const orderType = normalizeOrderType(order.orderType);
  const steps = ["Pending", "Confirmed", "Preparing"];

  if (orderType === "delivery") {
    steps.push("Ready", "Out for Delivery");
  } else if (orderType === "takeout") {
    steps.push("Ready for Pickup");
  } else {
    steps.push("Ready");
  }

  steps.push("Completed");
  const cashNote = order.paymentMethod === "cash"
    ? " Use On Hold while waiting; mark a delivery Unreachable after the 10-minute grace period."
    : "";
  return `Expected flow: ${steps.join(" > ")} (or Cancelled).${cashNote}`;
};

const getTotal = (order) => {
  const waitingFee = hasDeliveryWaitingFee(order)
    ? DELIVERY_WAITING_FEE
    : 0;
  let baseTotal;

  if (order.totalPrice !== undefined) {
    baseTotal = Number(order.totalPrice) || 0;
  } else if (order.total !== undefined) {
    baseTotal = Number(order.total) || 0;
  } else if (Array.isArray(order.items)) {
    const itemSubtotal = order.items.reduce(
      (sum, item) =>
        sum +
        Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
    baseTotal = itemSubtotal + (Number(order.deliveryFee) || 0);
  } else {
    baseTotal = 0;
  }

  return baseTotal + waitingFee;
};

function DeliveryProofPreview({ proofUrl }) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  return (
    <div className="delivery-proof-preview">
      {!imageLoadFailed ? (
        <img
          className="delivery-proof-image"
          src={proofUrl}
          alt="Proof of Delivery"
          referrerPolicy="no-referrer"
          onError={() => setImageLoadFailed(true)}
        />
      ) : (
        <p role="status">
          The photo preview is unavailable. Use the link to open it.
        </p>
      )}
      <a
        href={proofUrl}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
      >
        Open Proof of Delivery photo
      </a>
    </div>
  );
}

function RequestQrPaymentDetails({
  orderId,
  payment,
  total,
  totalUnavailableLabel = "Open pricing preview to calculate",
  copiedPaymentReference,
  onCopyReference,
  onOpenReceipt,
}) {
  const numericTotal = typeof total === "number"
    ? total
    : typeof total === "string" && total.trim()
      ? Number(total)
      : Number.NaN;
  const paymentStatus = payment.paymentStatus || "pending_verification";
  const paymentReference = payment.paymentReference || "";
  const paymentProofUrl = payment.paymentProofUrl || "";
  const paymentStatusLabel = paymentStatus === "pending_verification"
    ? "Pending GCash Check"
    : getPaymentStatusLabel(paymentStatus);

  return (
    <section
      className="request-gcash-payment order-gcash-review order-gcash-request-card"
      aria-label="GCash QR payment details"
    >
      <div className="order-gcash-topbar">
        <div className="request-gcash-total-block">
          <div className="order-gcash-total">
            <span>Order Total</span>
            <strong>
              {Number.isFinite(numericTotal)
                ? formatPrice(numericTotal)
                : totalUnavailableLabel}
            </strong>
          </div>
          <p className="request-gcash-total-note">
            Estimated from current menu prices; confirm against the receipt.
          </p>
        </div>
        <div className="request-gcash-status">
          <span>Payment status</span>
          <div>
            <strong>{paymentStatusLabel}</strong>
            <code>{paymentStatus}</code>
          </div>
        </div>
      </div>

      <div className="order-gcash-details-grid">
        <div className="order-gcash-reference">
          <span>13-digit GCash Reference Number</span>
          {paymentReference ? (
            <div className="order-gcash-reference-row">
              <code>{paymentReference}</code>
              <button
                type="button"
                className={`order-gcash-copy${copiedPaymentReference === orderId ? " is-copied" : ""}`}
                onClick={() => onCopyReference({
                  id: orderId,
                  paymentReference,
                })}
                aria-label={
                  copiedPaymentReference === orderId
                    ? "GCash reference copied"
                    : `Copy GCash reference ${paymentReference}`
                }
              >
                {copiedPaymentReference === orderId ? "Copied!" : "Copy"}
              </button>
            </div>
          ) : (
            <p className="request-gcash-missing">
              Reference not available in the loaded payment selection.
            </p>
          )}
          <div className="request-gcash-reminder">
            <p>
              Before approving, confirm this reference and the exact amount
              were received in GCash. Payment remains pending until verified.
            </p>
          </div>
        </div>

        <div className="order-gcash-receipt">
          <span>Receipt Screenshot</span>
          {paymentProofUrl ? (
            <div className="order-gcash-receipt-actions">
              <button
                type="button"
                className="order-payment-proof-preview"
                onClick={() => onOpenReceipt({
                  orderId,
                  reference: paymentReference,
                  total,
                  url: paymentProofUrl,
                })}
                aria-label={`Enlarge GCash receipt for order ${orderId}`}
              >
                <img src={paymentProofUrl} alt="Customer GCash receipt preview" />
                <span>Enlarge receipt</span>
              </button>
              <a
                className="order-payment-proof-link"
                href={paymentProofUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open original
              </a>
            </div>
          ) : (
            <p className="request-gcash-missing">
              Receipt screenshot not available in the loaded payment selection.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminOrders() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [orderRequests, setOrderRequests] = useState([]);
  const [paymentSelectionsByRequestId, setPaymentSelectionsByRequestId] =
    useState(() => new Map());
  const [paymentSelectionLoadingIds, setPaymentSelectionLoadingIds] =
    useState(() => new Set());
  const [paymentSelectionErrorsByRequestId, setPaymentSelectionErrorsByRequestId] =
    useState({});
  const [loading, setLoading] = useState(true);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [refreshingRequests, setRefreshingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState("");
  const [blockedPhonesByNumber, setBlockedPhonesByNumber] = useState({});
  const [blockedPhonesLoading, setBlockedPhonesLoading] = useState(true);
  const [blockedPhonesError, setBlockedPhonesError] = useState("");
  const [menuItemsById, setMenuItemsById] = useState(null);
  const [menuItemsLoading, setMenuItemsLoading] = useState(false);
  const [menuItemsError, setMenuItemsError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState("");
  const [copiedPaymentReference, setCopiedPaymentReference] = useState("");
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [approvalDialogRequest, setApprovalDialogRequest] = useState(null);
  const [approvalDialogLoading, setApprovalDialogLoading] = useState(false);
  const [approvalDialogError, setApprovalDialogError] = useState("");
  const [approvingRequestId, setApprovingRequestId] = useState(null);
  const [rejectingRequestId, setRejectingRequestId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionReasonPreset, setRejectionReasonPreset] = useState("");
  const [savingProofId, setSavingProofId] = useState(null);
  const [deliveryProofUrlDrafts, setDeliveryProofUrlDrafts] = useState({});
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all");
  const [summaryFilter, setSummaryFilter] = useState("all");
  const [requestStatusFilter, setRequestStatusFilter] = useState("pending");
  const [requestSearchQuery, setRequestSearchQuery] = useState("");
  const [activeView, setActiveView] = useState("requests");
  const [ordersSectionTarget, setOrdersSectionTarget] = useState(null);
  const [expandedRequestIds, setExpandedRequestIds] = useState(
    () => new Set()
  );
  const menuItemsLoadPromise = useRef(null);
  const approvalInProgressIds = useRef(new Set());
  const approvalDialogRef = useRef(null);
  const receiptDialogRef = useRef(null);
  const orderRequestsUnsubscribeRef = useRef(null);
  const orderRequestsListenerGenerationRef = useRef(0);
  const orderRequestsRef = useRef([]);
  const paymentSelectionsByRequestIdRef = useRef(new Map());
  const paymentSelectionLoadsRef = useRef(new Set());
  const paymentSelectionsLoadedRef = useRef(false);

  useEffect(() => {
    const timerId = window.setInterval(
      () => setCurrentTime(Date.now()),
      30_000,
    );
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    const dialog = approvalDialogRef.current;
    if (!dialog) return;

    if (approvalDialogRequest && !dialog.open) {
      dialog.showModal();
    } else if (!approvalDialogRequest && dialog.open) {
      dialog.close();
    }
  }, [approvalDialogRequest]);

  useEffect(() => {
    const dialog = receiptDialogRef.current;
    if (!dialog) return;

    if (receiptPreview && !dialog.open) {
      dialog.showModal();
    } else if (!receiptPreview && dialog.open) {
      dialog.close();
    }
  }, [receiptPreview]);

  const loadRequestPaymentSelections = useCallback(async (requests) => {
    if (!paymentSelectionsLoadedRef.current) return;

    const missingRequests = requests.filter((request) =>
      typeof request.id === "string"
      && request.id
      && !paymentSelectionsByRequestIdRef.current.has(request.id)
      && !paymentSelectionLoadsRef.current.has(request.id)
    );
    if (missingRequests.length === 0) return;

    const loadingIds = new Set(paymentSelectionLoadsRef.current);
    missingRequests.forEach(({ id }) => loadingIds.add(id));
    paymentSelectionLoadsRef.current = loadingIds;
    setPaymentSelectionLoadingIds(new Set(loadingIds));
    setPaymentSelectionErrorsByRequestId((currentErrors) => {
      const nextErrors = { ...currentErrors };
      missingRequests.forEach(({ id }) => delete nextErrors[id]);
      return nextErrors;
    });

    await Promise.all(missingRequests.map(async ({ id }) => {
      try {
        const selectionSnapshot = await getDoc(
          doc(db, "paymentSelections", id),
        );
        if (!selectionSnapshot.exists()) {
          setPaymentSelectionErrorsByRequestId((currentErrors) => ({
            ...currentErrors,
            [id]: "Payment selection is missing. Reload the request queue before approving.",
          }));
          return;
        }

        const selection = selectionSnapshot.data();
        if (selection.method !== "cash" && selection.method !== "qr") {
          setPaymentSelectionErrorsByRequestId((currentErrors) => ({
            ...currentErrors,
            [id]: "Payment method is unavailable. Reload the request queue before approving.",
          }));
          return;
        }

        const paymentDetails = {
          method: selection.method,
          timing: selection.timing,
          paymentReference: selection.paymentReference || "",
          paymentProofUrl: selection.paymentProofUrl || "",
          paymentStatus: selection.paymentStatus || "",
          status: selection.method === "cash"
            ? "unpaid"
            : selection.paymentStatus || "not submitted",
        };
        const nextSelections = new Map(
          paymentSelectionsByRequestIdRef.current,
        );
        nextSelections.set(id, paymentDetails);
        paymentSelectionsByRequestIdRef.current = nextSelections;
        setPaymentSelectionsByRequestId(nextSelections);
      } catch (loadError) {
        console.error(
          `Unable to load payment selection for request ${id}:`,
          loadError,
        );
        setPaymentSelectionErrorsByRequestId((currentErrors) => ({
          ...currentErrors,
          [id]: "Unable to load payment details. Retry before approving this request.",
        }));
      } finally {
        const nextLoadingIds = new Set(paymentSelectionLoadsRef.current);
        nextLoadingIds.delete(id);
        paymentSelectionLoadsRef.current = nextLoadingIds;
        setPaymentSelectionLoadingIds(new Set(nextLoadingIds));
      }
    }));
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      setError("");

      const [ordersSnapshot, paymentDetails] = await Promise.all([
        getDocs(collection(db, "orders")),
        loadAdminOrderPaymentDetails(auth.currentUser?.uid),
      ]);

      const nextPaymentDetails = new Map(
        paymentSelectionsByRequestIdRef.current,
      );
      paymentDetails.forEach((payment, requestId) => {
        nextPaymentDetails.set(requestId, payment);
      });
      paymentSelectionsByRequestIdRef.current = nextPaymentDetails;
      paymentSelectionsLoadedRef.current = true;
      setPaymentSelectionsByRequestId(nextPaymentDetails);
      void loadRequestPaymentSelections(orderRequestsRef.current);
      const ordersList = ordersSnapshot.docs
        .map((orderDoc) => {
          const order = orderDoc.data();
          const payment = paymentDetails.get(orderDoc.id);
          const paymentMethod = order.paymentMethod || payment?.method;
          const hasCheckoutPaymentData = Boolean(
            order.paymentReference
            || order.paymentProofUrl
            || [
              "pending_verification",
              "paid",
              "needs_review",
              "rejected",
            ].includes(order.paymentStatus),
          );
          return {
            id: orderDoc.id,
            ...order,
            paymentMethod,
            paymentTiming: order.paymentTiming || payment?.timing,
            paymentStatus: paymentMethod === "cash"
              ? order.cashPaymentStatus || "unpaid"
              : hasCheckoutPaymentData
                ? order.paymentStatus
                  || payment?.status
                  || "pending_verification"
                : payment?.status || "not submitted",
          };
        })
        .sort((firstOrder, secondOrder) => {
          const firstDate = firstOrder.createdAt?.toDate
            ? firstOrder.createdAt.toDate()
            : new Date(0);

          const secondDate = secondOrder.createdAt?.toDate
            ? secondOrder.createdAt.toDate()
            : new Date(0);

          return secondDate - firstDate;
        });

      setOrders(ordersList);
      return true;
    } catch (loadError) {
      console.error("Error loading orders:", loadError);
      setError("Unable to load orders. Please try again.");
      return false;
    }
  }, [loadRequestPaymentSelections]);

  const loadBlockedPhones = useCallback(async () => {
    setBlockedPhonesLoading(true);
    try {
      setBlockedPhonesError("");
      const blockedPhones = await listBlockedPhones(db);
      setBlockedPhonesByNumber(
        blockedPhones.reduce((lookup, blockedPhone) => {
          const phone = normalizePHPhone(
            blockedPhone.phoneNumber || blockedPhone.phone || blockedPhone.id,
          );
          if (phone) lookup[phone] = blockedPhone;
          return lookup;
        }, {}),
      );
      return true;
    } catch (loadError) {
      console.error("Error loading blocked phone numbers:", loadError);
      setBlockedPhonesError(
        "Unable to verify blocked phone numbers. Block actions are disabled until this is resolved.",
      );
      return false;
    } finally {
      setBlockedPhonesLoading(false);
    }
  }, []);

  const subscribeOrderRequests = useCallback(() => {
    orderRequestsUnsubscribeRef.current?.();
    setRequestsError("");
    setRequestsLoading(true);

    const generation = ++orderRequestsListenerGenerationRef.current;
    const unsubscribe = onSnapshot(
      collection(db, "orderRequests"),
      (requestsSnapshot) => {
        if (generation !== orderRequestsListenerGenerationRef.current) {
          return;
        }

        const requestsList = requestsSnapshot.docs
          .map((requestDoc) => ({
            id: requestDoc.id,
            ...requestDoc.data(),
          }))
          .sort((firstRequest, secondRequest) => {
            const firstDate = firstRequest.createdAt?.toDate
              ? firstRequest.createdAt.toDate()
              : new Date(0);

            const secondDate = secondRequest.createdAt?.toDate
              ? secondRequest.createdAt.toDate()
              : new Date(0);

            return secondDate - firstDate;
          });

        orderRequestsRef.current = requestsList;
        setOrderRequests(requestsList);
        void loadRequestPaymentSelections(requestsList);
        setRequestsError("");
        setRequestsLoading(false);
        setRefreshingRequests(false);
      },
      (listenerError) => {
        if (generation !== orderRequestsListenerGenerationRef.current) {
          return;
        }

        console.error("Error listening to order requests:", listenerError);
        setRequestsError(
          "Unable to load customer requests. Please try again."
        );
        setRequestsLoading(false);
        setRefreshingRequests(false);
      }
    );

    orderRequestsUnsubscribeRef.current = unsubscribe;
    return unsubscribe;
  }, [loadRequestPaymentSelections]);

  const loadMenuItems = useCallback(async () => {
    if (menuItemsById) {
      return menuItemsById;
    }

    if (menuItemsLoadPromise.current) {
      return menuItemsLoadPromise.current;
    }

    setMenuItemsLoading(true);
    setMenuItemsError("");

    const loadPromise = (async () => {
      try {
        const menuSnapshot = await getDocs(
          collection(db, "menuItems")
        );
        const itemsById = new Map(
          menuSnapshot.docs.map((menuDoc) => [
            menuDoc.id,
            menuDoc.data(),
          ])
        );

        setMenuItemsById(itemsById);
        return itemsById;
      } catch (loadError) {
        console.error(
          "Error loading menu items for request pricing:",
          loadError
        );
        setMenuItemsError(
          "Unable to load current menu pricing. Please try again."
        );
        return null;
      } finally {
        setMenuItemsLoading(false);
        menuItemsLoadPromise.current = null;
      }
    })();

    menuItemsLoadPromise.current = loadPromise;
    return loadPromise;
  }, [menuItemsById]);

  useEffect(() => {
    let effectIsActive = true;
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        orderRequestsListenerGenerationRef.current += 1;
        orderRequestsUnsubscribeRef.current?.();
        orderRequestsUnsubscribeRef.current = null;

        if (!effectIsActive) {
          return;
        }

        if (!currentUser) {
          navigate("/login");
          return;
        }

        try {
          setLoading(true);

          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const userSnapshot = await getDoc(userRef);

          if (!effectIsActive) {
            return;
          }

          if (!userSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login");
            return;
          }

          const userData = userSnapshot.data();

          const userRole = getEffectiveRole(userData);

          if (userRole !== "admin" && userRole !== "staff") {
            alert("Access denied. Admin account required.");
            navigate(userRole === "customer" ? "/menu" : "/login");
            return;
          }

          subscribeOrderRequests();
          await Promise.all([loadOrders(), loadBlockedPhones()]);
        } catch (accessError) {
          console.error(
            "Error checking admin access:",
            accessError
          );

          setError(
            "Unable to verify administrator access."
          );
        } finally {
          setLoading(false);
        }
      }
    );

    return () => {
      effectIsActive = false;
      unsubscribe();
      orderRequestsListenerGenerationRef.current += 1;
      orderRequestsUnsubscribeRef.current?.();
      orderRequestsUnsubscribeRef.current = null;
    };
  }, [loadBlockedPhones, loadOrders, navigate, subscribeOrderRequests]);

  const handlePhoneBlocked = useCallback((phone) => {
    setBlockedPhonesByNumber((currentPhones) => ({
      ...currentPhones,
      [phone]: { phone, phoneNumber: phone },
    }));
  }, []);

  const filteredOrders = useMemo(() => {
    const normalizedSearch = searchTerm
      .trim()
      .toLowerCase()
      .replace(/^#+/, "");

    return orders.filter((order) => {
      const status = order.status || "Pending";

      const matchesStatus =
        statusFilter === "All" || status === statusFilter;
      const matchesFulfillment =
        fulfillmentFilter === "all"
        || normalizeOrderType(order.orderType) === fulfillmentFilter;

      const normalizedStatus = String(status || "Pending").toLowerCase();
      const matchesSummary =
        summaryFilter === "all" ||
        (summaryFilter === "active" &&
          normalizedStatus !== "completed" &&
          normalizedStatus !== "cancelled") ||
        (summaryFilter === "pending" && normalizedStatus === "pending");

      const searchableText = `
        ${order.id}
        ${order.customerName || ""}
        ${order.customerEmail || ""}
        ${order.phone || ""}
        ${order.orderType || ""}
        ${formatOrderType(order.orderType)}
        ${order.address || ""}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      return (
        matchesStatus
        && matchesFulfillment
        && matchesSummary
        && matchesSearch
      );
    });
  }, [orders, searchTerm, statusFilter, fulfillmentFilter, summaryFilter]);

  const handleCopyOrderId = async (orderId) => {
    try {
      await navigator.clipboard.writeText(orderId);
      setCopiedOrderId(orderId);
      setNoticeIsError(false);
      setNotice("Order ID copied.");
    } catch (copyError) {
      console.error("Unable to copy order ID:", copyError);
      setCopiedOrderId("");
      setNoticeIsError(true);
      setNotice("Unable to copy Order ID. Please select it manually.");
    }
  };

  const handleCopyPaymentReference = async (order) => {
    try {
      await navigator.clipboard.writeText(order.paymentReference);
      setCopiedPaymentReference(order.id);
      setNoticeIsError(false);
      setNotice("GCash reference copied.");
    } catch (copyError) {
      console.error("Unable to copy GCash reference:", copyError);
      setCopiedPaymentReference("");
      setNoticeIsError(true);
      setNotice("Unable to copy the GCash reference. Please select it manually.");
    }
  };

  const handleUpdateQrPaymentStatus = async (order, paymentStatus) => {
    const reviewerUid = auth.currentUser?.uid;
    if (!reviewerUid) {
      setNoticeIsError(true);
      setNotice("Sign in as staff or an administrator to review GCash payments.");
      return;
    }
    if (
      paymentStatus === "paid"
      && (
        !/^\d{13}$/.test(order.paymentReference || "")
        || !order.paymentProofUrl
      )
    ) {
      setNoticeIsError(true);
      setNotice("A 13-digit GCash reference and receipt are required before marking payment verified.");
      return;
    }
    if (
      paymentStatus === "paid"
      && !window.confirm(
        "Has an administrator confirmed that this GCash payment was received?",
      )
    ) {
      return;
    }

    try {
      setUpdatingId(order.id);
      setNotice("");
      await updateQrOrderPaymentStatus(
        db,
        order.id,
        reviewerUid,
        paymentStatus,
      );
      setOrders((currentOrders) =>
        currentOrders.map((currentOrder) =>
          currentOrder.id === order.id
            ? { ...currentOrder, paymentStatus }
            : currentOrder
        )
      );
      setNoticeIsError(false);
      setNotice(`GCash payment status updated: ${getPaymentStatusLabel(paymentStatus)}.`);
    } catch (updateError) {
      console.error("Unable to update GCash payment status:", updateError);
      setNoticeIsError(true);
      setNotice("Unable to update GCash payment status. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSummaryFilter = (filter) => {
    setSummaryFilter(
      filter !== "all" && summaryFilter === filter ? "all" : filter
    );
    setStatusFilter("All");
    setFulfillmentFilter("all");
    setSearchTerm("");
  };

  const handleFulfillmentFilter = (filter) => {
    setSummaryFilter("all");
    setFulfillmentFilter((currentFilter) => (
      filter !== "all" && currentFilter !== filter ? filter : "all"
    ));
  };

  const statistics = useMemo(() => {
    const activeOrders = orders.filter((order) => {
      const status = String(order.status || "Pending").toLowerCase();

      return (
        status !== "completed" &&
        status !== "cancelled"
      );
    });

    const pendingOrders = orders.filter(
      (order) =>
        String(order.status || "Pending").toLowerCase() ===
        "pending"
    );

    const revenue = orders
      .filter(
        (order) =>
          String(order.status || "").toLowerCase() !==
          "cancelled"
      )
      .reduce((sum, order) => sum + getTotal(order), 0);

    return {
      active: activeOrders.length,
      pending: pendingOrders.length,
      revenue,
    };
  }, [orders]);

  const requestStatistics = useMemo(() => {
    return orderRequests.reduce(
      (counts, request) => {
        const status = String(request.status || "pending").toLowerCase();

        if (status === "pending") counts.pending += 1;
        if (status === "approved") counts.approved += 1;
        if (status === "rejected") counts.rejected += 1;

        return counts;
      },
      {
        total: orderRequests.length,
        pending: 0,
        approved: 0,
        rejected: 0,
      }
    );
  }, [orderRequests]);

  const filteredOrderRequests = useMemo(() => {
    const normalizedRequestSearch = requestSearchQuery
      .trim()
      .toLowerCase()
      .replace(/^#+/, "");

    return orderRequests.filter((request) => {
      const status = String(request.status || "pending").toLowerCase();
      const matchesStatus = requestStatusFilter === "All"
        || status === requestStatusFilter;
      const searchableText = [
        request.id,
        request.customerName,
        request.customerEmail,
        request.phone,
        request.orderType,
        formatOrderType(request.orderType),
        request.address,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = normalizedRequestSearch === ""
        || searchableText.includes(normalizedRequestSearch);

      return matchesStatus && matchesSearch;
    });
  }, [orderRequests, requestSearchQuery, requestStatusFilter]);

  const handleRequestSummaryFilter = (filter) => {
    setRequestStatusFilter(
      filter !== "All" && requestStatusFilter === filter ? "All" : filter
    );
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setNotice("");
      const [ordersLoaded, blockedPhonesLoaded] = await Promise.all([
        loadOrders(),
        loadBlockedPhones(),
      ]);
      if (ordersLoaded && blockedPhonesLoaded) {
        setNoticeIsError(false);
        setNotice("Orders and phone statuses refreshed.");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefreshRequests = async () => {
    setRefreshingRequests(true);
    subscribeOrderRequests();
    await loadBlockedPhones();
  };

  const handleRequestPreviewToggle = (requestId) => {
    const isExpanded = expandedRequestIds.has(requestId);

    setExpandedRequestIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(requestId)) {
        nextIds.delete(requestId);
      } else {
        nextIds.add(requestId);
      }
      return nextIds;
    });

    if (!isExpanded) {
      loadMenuItems();
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    const order = orders.find((currentOrder) => currentOrder.id === orderId);

    try {
      setUpdatingId(orderId);
      setNoticeIsError(false);
      setNotice("");

      const result = await updateStatusWithNotification({
        database: db,
        collectionName: "orders",
        itemId: orderId,
        userIdField: "customerId",
        type: "order",
        newStatus,
        title: "Order status updated",
        message: (status) => (
          status === "Out for Delivery"
          && order?.orderType === "delivery"
            ? `Your delivery order is on the way. Please have the total of ${formatPrice(order.total)} and your payment details ready.`
            : `Your order status is now ${status}.`
        ),
      });

      if (!result.changed) {
        setNotice(`Order status is already ${newStatus}.`);
        return;
      }

      if (!result.notificationCreated) {
        console.warn(`Order ${orderId} has no customer ID; notification skipped.`);
      }

      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                status: newStatus,
              }
            : order
        )
      );

      setNotice(result.notificationCreated
        ? `Order status updated to ${newStatus}.`
        : `Order status updated to ${newStatus}, but no customer ID was available for a notification.`);
      setNoticeIsError(!result.notificationCreated);
    } catch (updateError) {
      console.error(
        "Error updating order status:",
        updateError
      );

      setNotice(
        "Unable to update order status. Please try again."
      );
      setNoticeIsError(true);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRecordDeliveryArrival = async (order) => {
    try {
      setUpdatingId(order.id);
      await updateDoc(doc(db, "orders", order.id), {
        deliveryArrivalAt: serverTimestamp(),
        deliveryArrivalBy: auth.currentUser.uid,
      });
      await loadOrders();
      setNotice("Delivery arrival recorded. The 10-minute grace period has started.");
      setNoticeIsError(false);
    } catch (arrivalError) {
      console.error("Unable to record delivery arrival:", arrivalError);
      setNotice(
        "Unable to record delivery arrival. Verify the order is Out for Delivery, then try again.",
      );
      setNoticeIsError(true);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleApplyWaitingFee = async (order) => {
    if (!canApplyDeliveryWaitingFee(order, Date.now())) {
      setNotice(
        "The one-time waiting fee is available only for delivery orders after the 10-minute grace period.",
      );
      setNoticeIsError(true);
      return;
    }

    try {
      setUpdatingId(order.id);
      await updateDoc(doc(db, "orders", order.id), {
        waitingFee: DELIVERY_WAITING_FEE,
        waitingFeeApplied: true,
        waitingFeeAppliedAt: serverTimestamp(),
        waitingFeeAppliedBy: auth.currentUser.uid,
      });
      await loadOrders();
      setNotice("The one-time ₱20 waiting fee was added to this order.");
      setNoticeIsError(false);
    } catch (feeError) {
      console.error("Unable to apply delivery waiting fee:", feeError);
      setNotice(
        "Unable to apply the waiting fee. Confirm the 10-minute grace period has elapsed and try again.",
      );
      setNoticeIsError(true);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkUnreachable = async (order) => {
    const gracePeriod = getDeliveryGracePeriod(order, Date.now());
    if (
      normalizeOrderType(order.orderType) !== "delivery"
      || order.paymentMethod !== "cash"
      || order.cashPaymentStatus === "paid"
      || order.status !== "Out for Delivery"
      || !gracePeriod?.elapsed
    ) {
      setNotice(
        "Only an unpaid cash delivery can be marked Unreachable after the 10-minute grace period.",
      );
      setNoticeIsError(true);
      return;
    }

    if (!window.confirm(
      "Mark this cash delivery as Unreachable? The one-time ₱20 waiting fee will be recorded if it has not already been applied."
    )) {
      return;
    }

    try {
      setUpdatingId(order.id);
      const batch = writeBatch(db);
      const alreadyCharged = hasDeliveryWaitingFee(order);
      const orderUpdate = {
        status: "Unreachable",
        unreachableAt: serverTimestamp(),
        unreachableBy: auth.currentUser.uid,
        unreachableReason: UNREACHABLE_ORDER_REASON,
      };

      if (!alreadyCharged) {
        orderUpdate.waitingFee = DELIVERY_WAITING_FEE;
        orderUpdate.waitingFeeApplied = true;
        orderUpdate.waitingFeeAppliedAt = serverTimestamp();
        orderUpdate.waitingFeeAppliedBy = auth.currentUser.uid;
      } else if (order.waitingFeeApplied !== true) {
        orderUpdate.waitingFeeApplied = true;
      }

      batch.update(doc(db, "orders", order.id), orderUpdate);
      const customerId = order.customerId || order.userId;
      if (typeof customerId === "string" && customerId.trim()) {
        const notificationRef = doc(collection(db, "notifications"));
        batch.set(notificationRef, {
          userId: customerId,
          type: "order",
          itemId: order.id,
          title: "We could not reach you for your delivery",
          message: `${UNREACHABLE_ORDER_REASON} Please contact the cafe to arrange next steps.`,
          isRead: false,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      await loadOrders();
      setNotice("Order marked Unreachable and the one-time waiting fee recorded.");
      setNoticeIsError(false);
    } catch (unreachableError) {
      console.error("Unable to mark delivery as unreachable:", unreachableError);
      setNotice(
        "Unable to mark this delivery Unreachable. Verify the 10-minute grace period and try again.",
      );
      setNoticeIsError(true);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeliveryProofSave = async (order) => {
    const proofUrl = normalizeDeliveryProofUrl(
      deliveryProofUrlDrafts[order.id] || "",
    );
    if (!proofUrl) {
      setNotice("Enter a valid HTTPS link to the delivery photo.");
      setNoticeIsError(true);
      return;
    }
    if (order.deliveryProofUrl) {
      setNotice("This order already has Proof of Delivery recorded.");
      setNoticeIsError(true);
      return;
    }

    const staffId = auth.currentUser?.uid;
    if (!staffId) {
      setNotice("Your staff session could not be verified. Please sign in again.");
      setNoticeIsError(true);
      return;
    }

    try {
      setSavingProofId(order.id);
      setNotice("");
      await updateDoc(doc(db, "orders", order.id), {
        deliveryProofUrl: proofUrl,
        deliveryProofRecordedAt: serverTimestamp(),
        deliveryProofRecordedBy: staffId,
      });
      await loadOrders();
      setDeliveryProofUrlDrafts((drafts) => ({
        ...drafts,
        [order.id]: "",
      }));
      setNotice("Proof of Delivery photo link saved to this order.");
      setNoticeIsError(false);
    } catch (saveError) {
      console.error("Unable to save Proof of Delivery link:", saveError);
      setNotice("Unable to save the photo link. Verify the order status and try again.");
      setNoticeIsError(true);
    } finally {
      setSavingProofId(null);
    }
  };

  const handleApproveRequest = async (request, confirmedPricing) => {
    const requestId = request?.id;

    if (
      typeof requestId !== "string"
      || !requestId
      || requestId.includes("/")
    ) {
      setNotice("Unable to approve this request because its ID is invalid.");
      setNoticeIsError(true);
      return false;
    }

    if (approvalInProgressIds.current.has(requestId)) {
      return false;
    }

    approvalInProgressIds.current.add(requestId);
    setNoticeIsError(false);
    setNotice("");

    try {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("You must be signed in as an administrator to approve requests.");
      }

      const { error: transactionError, freshMenuItemsById } =
        await approveOrderRequest(
          db,
          requestId,
          currentUser.uid,
          confirmedPricing
        );

      if (freshMenuItemsById) {
        setMenuItemsById(freshMenuItemsById);
        setMenuItemsError("");
      }
      if (transactionError) {
        throw transactionError;
      }

      await loadOrders();
      let notificationFailed = false;
      try {
        await createCustomerNotification({
          database: db,
          userId: request.customerId,
          type: "order",
          itemId: requestId,
          title: "Order approved",
          message: "Your order request has been approved by Cactus Café.",
        });
      } catch (notificationError) {
        notificationFailed = true;
        console.error(
          `Order request ${requestId} was approved, but its notification failed:`,
          notificationError,
        );
      }

      setNotice(notificationFailed
        ? `Request ${requestId} was approved and added to orders, but the customer notification could not be created.`
        : `Request ${requestId} approved and added to orders.`);
      setNoticeIsError(notificationFailed);
      return true;
    } catch (approvalError) {
      console.error("Error approving customer request:", approvalError);
      const errorMessage = approvalError instanceof Error
        ? approvalError.message
        : "Unable to approve this request. Please try again.";
      setApprovalDialogError(errorMessage);
      setNotice(
        errorMessage
      );
      setNoticeIsError(true);
      return false;
    } finally {
      approvalInProgressIds.current.delete(requestId);
    }
  };

  const handleOpenApprovalDialog = async (request) => {
    if (approvalDialogLoading || approvingRequestId || rejectingRequestId) return;

    setApprovalDialogRequest(request);
    setApprovalDialogLoading(true);
    setApprovalDialogError("");
    setRejectionReason("");
    setRejectionReasonPreset("");
    setNoticeIsError(false);
    setNotice("");

    try {
      const menuSnapshot = await getDocs(collection(db, "menuItems"));
      const freshMenuItemsById = new Map(
        menuSnapshot.docs.map((menuDoc) => [
          menuDoc.id,
          menuDoc.data(),
        ])
      );
      setMenuItemsById(freshMenuItemsById);
      setMenuItemsError("");
    } catch (loadError) {
      console.error(
        "Error loading menu prices for approval confirmation:",
        loadError
      );
      setMenuItemsById(null);
      setApprovalDialogError(
        "Unable to load current menu prices. Please close this dialog and try again."
      );
    } finally {
      setApprovalDialogLoading(false);
    }
  };

  const approvalPricing = approvalDialogRequest
    ? getOrderApprovalPricing(
      approvalDialogRequest,
      menuItemsById,
      getApprovalPricing,
    )
    : null;
  const getRequestPaymentDetails = (request) => {
    const selection = paymentSelectionsByRequestId.get(request?.id);
    return {
      method: request?.paymentMethod || selection?.method,
      paymentReference:
        request?.paymentReference || selection?.paymentReference || "",
      paymentProofUrl:
        request?.paymentProofUrl || selection?.paymentProofUrl || "",
      paymentStatus:
        request?.paymentStatus
        || selection?.paymentStatus
        || selection?.status
        || "pending_verification",
    };
  };
  const approvalDialogPayment = getRequestPaymentDetails(approvalDialogRequest);
  const approvalDialogIsQr = approvalDialogPayment.method === "qr";

  const handleConfirmApproval = async () => {
    if (!approvalDialogRequest) return;

    const payment = getRequestPaymentDetails(approvalDialogRequest);
    if (!payment.method) {
      setApprovalDialogError(
        "Payment details are still loading or unavailable. Load the request payment selection before approving.",
      );
      return;
    }
    if (
      payment.method === "qr"
      && (
        !/^\d{13}$/.test(payment.paymentReference)
        || !payment.paymentProofUrl
      )
    ) {
      setApprovalDialogError(
        "GCash reference and receipt details are unavailable. Reload the page before approving this request.",
      );
      return;
    }

    if (
      !approvalPricing
      || approvalPricing.errors.length > 0
      || approvalDialogLoading
      || approvingRequestId
      || rejectingRequestId
    ) {
      return;
    }

    setApprovingRequestId(approvalDialogRequest.id);
    setApprovalDialogError("");
    const approved = await handleApproveRequest(
      approvalDialogRequest,
      approvalPricing
    );
    setApprovingRequestId(null);

    if (approved) {
      setApprovalDialogRequest(null);
      setRejectionReason("");
      setRejectionReasonPreset("");
    }
  };

  const handleRejectRequest = async () => {
    const request = approvalDialogRequest;
    const requestId = request?.id;

    if (
      typeof requestId !== "string"
      || !requestId
      || requestId.length > 1500
      || requestId.includes("/")
    ) {
      setApprovalDialogError("Unable to reject this request because its ID is invalid.");
      return false;
    }

    if (String(request.status || "").toLowerCase() !== "pending") {
      setApprovalDialogError("This request is no longer pending.");
      return false;
    }

    if (approvalInProgressIds.current.has(requestId)) {
      return false;
    }

    const reason = rejectionReason.trim() || DEFAULT_REJECTION_REASON;
    if (reason.length > 500) {
      setApprovalDialogError("The rejection reason must be 500 characters or fewer.");
      return false;
    }

    approvalInProgressIds.current.add(requestId);
    setRejectingRequestId(requestId);
    setApprovalDialogError("");
    setNotice("");
    setNoticeIsError(false);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("You must be signed in as an administrator to reject requests.");
      }

      await updateDoc(doc(db, "orderRequests", requestId), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: currentUser.uid,
        rejectionReason: reason,
      });

      let notificationFailed = false;
      try {
        await createCustomerNotification({
          database: db,
          userId: request.customerId,
          type: "order",
          itemId: requestId,
          title: "Order request rejected",
          message: `Your order request was rejected by Cactus Cafe. Reason: ${reason}`,
        });
      } catch (notificationError) {
        notificationFailed = true;
        console.error(
          `Order request ${requestId} was rejected, but its notification failed:`,
          notificationError,
        );
      }

      setNotice(notificationFailed
        ? `Request ${requestId} was rejected, but the customer notification could not be created.`
        : `Request ${requestId} rejected.`);
      setNoticeIsError(notificationFailed);
      return true;
    } catch (rejectionError) {
      console.error("Error rejecting customer request:", rejectionError);
      const errorMessage = rejectionError instanceof Error
        ? rejectionError.message
        : "Unable to reject this request. Please try again.";
      setApprovalDialogError(errorMessage);
      setNotice(errorMessage);
      setNoticeIsError(true);
      return false;
    } finally {
      approvalInProgressIds.current.delete(requestId);
      setRejectingRequestId(null);
    }
  };

  const handleConfirmRejection = async () => {
    if (approvingRequestId || rejectingRequestId) return;

    const rejected = await handleRejectRequest();
    if (rejected) {
      setApprovalDialogRequest(null);
      setApprovalDialogError("");
      setRejectionReason("");
      setRejectionReasonPreset("");
    }
  };

  const closeApprovalDialog = () => {
    if (approvingRequestId || rejectingRequestId) return;
    setApprovalDialogRequest(null);
    setApprovalDialogError("");
    setRejectionReason("");
    setRejectionReasonPreset("");
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (logoutError) {
      console.error("Logout error:", logoutError);
      setNotice("Unable to log out. Please try again.");
      setNoticeIsError(true);
      setLoggingOut(false);
    }
  };

  return (
    <main className="admin-orders-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="admin-orders-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`admin-orders-sidebar ${
          mobileNavigationOpen ? "is-open" : ""
        }`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/menu"
          className="admin-orders-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-orders-brand-mark" aria-hidden="true">C</span>
          <span>
            <strong>Cactus Café</strong>
            <small>STAFF WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-orders-sidebar-label">WORKSPACE</div>
        <nav className="admin-orders-nav">
          <AdminWorkspaceNavigation
            classPrefix="admin-orders"
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </nav>

        <div className="admin-orders-sidebar-footer">
          <div className="admin-orders-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Thoughtful service starts with every order.</p>
          </div>
          <button
            type="button"
            className="admin-orders-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">↪</span>
            <span>{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>

      <div className="admin-orders-main">
        <div className="admin-orders-container">
        <header className="admin-orders-header">
          <button
            type="button"
            className="admin-orders-mobile-toggle"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavigationOpen}
            onClick={() => setMobileNavigationOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="admin-orders-heading">
            <p className="admin-orders-eyebrow">OPERATIONS</p>
            <h1>Order Management</h1>
            <p>Review requests, track fulfillment, and keep customers informed.</p>
          </div>
          <div className="admin-orders-profile">
            <span className="admin-orders-profile-avatar" aria-hidden="true">
              {(auth.currentUser?.displayName || "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="admin-orders-profile-copy">
              <strong>{auth.currentUser?.displayName || "Cafe Admin"}</strong>
              <small>Administrator</small>
            </span>
          </div>
        </header>

        {loading ? (
          <AdminLoadingSkeleton label="Loading orders" stats={4} rows={5} />
        ) : (
          <>
        <div
          className="admin-orders-view-switcher"
          role="tablist"
          aria-label="Order management views"
        >
          <button
            type="button"
            className="admin-orders-view-tab"
            id="official-orders-tab"
            role="tab"
            aria-selected={activeView === "official"}
            aria-controls="official-orders-panel"
            onClick={() => setActiveView("official")}
          >
            Official Orders
          </button>
          <button
            type="button"
            className="admin-orders-view-tab"
            id="customer-requests-tab"
            role="tab"
            aria-selected={activeView === "requests"}
            aria-controls="customer-requests-panel"
            onClick={() => setActiveView("requests")}
          >
            Customer Order Requests
          </button>
        </div>

        {blockedPhonesError && (
          <div className="request-error" role="alert">
            <span>!</span>
            <p>{blockedPhonesError}</p>
            <button
              type="button"
              onClick={loadBlockedPhones}
              disabled={blockedPhonesLoading}
            >
              Try again
            </button>
          </div>
        )}

        <section
          className="admin-orders-view-panel"
          id="official-orders-panel"
          role="tabpanel"
          aria-labelledby="official-orders-tab"
          hidden={activeView !== "official"}
        >
        <section className="orders-overview">
          <button
            type="button"
            className={`overview-stat overview-stat-button${summaryFilter === "all" ? " is-active" : ""}`}
            aria-pressed={summaryFilter === "all"}
            onClick={() => handleSummaryFilter("all")}
          >
            <span className="overview-stat-icon total-orders-icon" aria-hidden="true">
              <OverviewStatIcon name="orders" />
            </span>
            <span className="overview-stat-copy">
              <span>Total orders</span>
              <strong>{orders.length}</strong>
            </span>
          </button>

          <button
            type="button"
            className={`overview-stat overview-stat-button${summaryFilter === "active" ? " is-active" : ""}`}
            aria-pressed={summaryFilter === "active"}
            onClick={() => handleSummaryFilter("active")}
          >
            <span className="overview-stat-icon active-orders-icon" aria-hidden="true">
              <OverviewStatIcon name="active" />
            </span>
            <span className="overview-stat-copy">
              <span>Active orders</span>
              <strong>{statistics.active}</strong>
            </span>
          </button>

          <button
            type="button"
            className={`overview-stat overview-stat-button${summaryFilter === "pending" ? " is-active" : ""}`}
            aria-pressed={summaryFilter === "pending"}
            onClick={() => handleSummaryFilter("pending")}
          >
            <span className="overview-stat-icon pending-orders-icon" aria-hidden="true">
              <OverviewStatIcon name="pending" />
            </span>
            <span className="overview-stat-copy">
              <span>Pending review</span>
              <strong>{statistics.pending}</strong>
            </span>
          </button>

          <div className="overview-stat">
            <span className="overview-stat-icon revenue-orders-icon" aria-hidden="true">
              <OverviewStatIcon name="revenue" />
            </span>
            <span className="overview-stat-copy">
              <span>Order value</span>
              <strong>{formatPrice(statistics.revenue)}</strong>
            </span>
          </div>
        </section>

        <div
          className="official-orders-slot"
          ref={setOrdersSectionTarget}
        />
        </section>

        <section
          className="request-section admin-orders-view-panel"
          id="customer-requests-panel"
          role="tabpanel"
          aria-labelledby="customer-requests-tab"
          hidden={activeView !== "requests"}
        >
          <div className="request-section-header">
            <div>
              <p className="admin-orders-eyebrow">
                CUSTOMER SUBMISSIONS
              </p>
              <h2 id="request-section-title">
                Customer order requests
              </h2>
              <p>
                Review submitted requests separately from official orders.
              </p>
            </div>

            <button
              type="button"
              className="refresh-button"
              onClick={handleRefreshRequests}
              disabled={refreshingRequests}
            >
              {refreshingRequests ? "Refreshing..." : "Refresh requests"}
            </button>
          </div>

          <div className="request-overview" aria-label="Request counts">
            <button
              type="button"
              className={`overview-stat overview-stat-button${requestStatusFilter === "All" ? " is-active" : ""}`}
              aria-pressed={requestStatusFilter === "All"}
              onClick={() => handleRequestSummaryFilter("All")}
            >
              <span className="overview-stat-icon total-orders-icon" aria-hidden="true">
                <OverviewStatIcon name="orders" />
              </span>
              <span className="overview-stat-copy">
                <span>Total requests</span>
                <strong>{requestStatistics.total}</strong>
              </span>
            </button>
            <button
              type="button"
              className={`overview-stat overview-stat-button${requestStatusFilter === "pending" ? " is-active" : ""}`}
              aria-pressed={requestStatusFilter === "pending"}
              onClick={() => handleRequestSummaryFilter("pending")}
            >
              <span className="overview-stat-icon pending-orders-icon" aria-hidden="true">
                <OverviewStatIcon name="pending" />
              </span>
              <span className="overview-stat-copy">
                <span>Pending</span>
                <strong>{requestStatistics.pending}</strong>
              </span>
            </button>
            <button
              type="button"
              className={`overview-stat overview-stat-button${requestStatusFilter === "approved" ? " is-active" : ""}`}
              aria-pressed={requestStatusFilter === "approved"}
              onClick={() => handleRequestSummaryFilter("approved")}
            >
              <span className="overview-stat-icon active-orders-icon" aria-hidden="true">
                <OverviewStatIcon name="approved" />
              </span>
              <span className="overview-stat-copy">
                <span>Approved</span>
                <strong>{requestStatistics.approved}</strong>
              </span>
            </button>
            <button
              type="button"
              className={`overview-stat overview-stat-button${requestStatusFilter === "rejected" ? " is-active" : ""}`}
              aria-pressed={requestStatusFilter === "rejected"}
              onClick={() => handleRequestSummaryFilter("rejected")}
            >
              <span className="overview-stat-icon rejected-orders-icon" aria-hidden="true">
                <OverviewStatIcon name="rejected" />
              </span>
              <span className="overview-stat-copy">
                <span>Rejected</span>
                <strong>{requestStatistics.rejected}</strong>
              </span>
            </button>
          </div>

          <div className="request-toolbar">
            <h3>Request history</h3>
            <div className="request-toolbar-controls">
              <label className="request-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  aria-label="Search Order ID, customer, or phone"
                  placeholder="Search Order ID, customer, or phone"
                  value={requestSearchQuery}
                  onChange={(event) =>
                    setRequestSearchQuery(event.target.value)
                  }
                />
              </label>
              <label>
                <span>Filter requests</span>
                <select
                  className="status-filter"
                  value={requestStatusFilter}
                  onChange={(event) =>
                    setRequestStatusFilter(event.target.value)
                  }
                >
                  {REQUEST_STATUS_OPTIONS.map((status) => (
                    <option value={status} key={status}>
                      {status === "All"
                        ? "All request statuses"
                        : status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {requestsError && (
            <div className="request-error" role="alert">
              <span>!</span>
              <p>{requestsError}</p>
              <button
                type="button"
                onClick={handleRefreshRequests}
                disabled={refreshingRequests}
              >
                Try again
              </button>
            </div>
          )}

          {!requestsError && requestsLoading && (
            <AdminLoadingSkeleton
              label="Loading customer requests"
              compact
              rows={3}
            />
          )}

          {!requestsError && !requestsLoading && orderRequests.length === 0 && (
            <div className="request-state">
              <strong>No customer requests yet</strong>
              <span>New submissions will appear here for review.</span>
            </div>
          )}

          {!requestsError
            && !requestsLoading
            && orderRequests.length > 0
            && filteredOrderRequests.length === 0 && (
              <div className="request-state">
                <strong>
                  {requestSearchQuery.trim()
                    ? "No matching requests"
                    : `No ${requestStatusFilter.toLowerCase()} requests`}
                </strong>
                <span>
                  {requestSearchQuery.trim()
                    ? "Try another search or request status."
                    : "Choose another request status to view more."}
                </span>
              </div>
            )}

          {!requestsError && !requestsLoading && filteredOrderRequests.length > 0 && (
            <div className="request-list">
              {filteredOrderRequests.map((request) => {
                const status = String(request.status || "pending").toLowerCase();
                const requestItems = Array.isArray(request.items)
                  ? request.items
                  : [];
                const requestPayment = getRequestPaymentDetails(request);
                const isQrRequest = requestPayment.method === "qr";
                const paymentSelectionLoading =
                  paymentSelectionLoadingIds.has(request.id);
                const paymentSelectionError =
                  paymentSelectionErrorsByRequestId[request.id];
                const requestPricingEstimate = menuItemsById
                  ? getOrderApprovalPricing(
                    request,
                    menuItemsById,
                    getApprovalPricing,
                  )
                  : null;
                const savedRequestTotal = typeof request.total === "number"
                  ? request.total
                  : typeof request.total === "string"
                    && request.total.trim()
                    ? Number(request.total)
                    : Number.NaN;
                const requestOrderTotal = Number.isFinite(savedRequestTotal)
                  ? savedRequestTotal
                  : requestPricingEstimate?.total;

                return (
                  <article className="request-card" key={request.id}>
                    <div className="request-card-header">
                      <div>
                        <div className="order-reference-heading">
                          <span className="order-label">REQUEST</span>
                          <span className="order-reference-pill">
                            Ref #{request.id.slice(0, 8).toUpperCase()}
                          </span>
                        </div>
                        <div className="customer-order-id-block">
                          <span className="order-label">CUSTOMER ORDER ID</span>
                          <div className="customer-order-id-pill">
                            <code>{request.id}</code>
                            <button
                              type="button"
                              className={`customer-order-id-copy${copiedOrderId === request.id ? " is-copied" : ""}`}
                              onClick={() => handleCopyOrderId(request.id)}
                              aria-label={
                                copiedOrderId === request.id
                                  ? "Order ID copied"
                                  : "Copy customer Order ID"
                              }
                            >
                              {copiedOrderId === request.id ? "Copied!" : "Copy ID"}
                            </button>
                          </div>
                        </div>
                        <p className="order-date">
                          Submitted {formatDate(request.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`order-status status-${getStatusClass(status)}`}
                      >
                        <span className="status-dot" />
                        {status}
                      </span>
                    </div>

                    <div className="request-info">
                      <div>
                        <span className="order-label">CUSTOMER</span>
                        <strong>{request.customerName || "No name"}</strong>
                        <small>{request.customerEmail || "No email"}</small>
                      </div>
                      <div>
                        <span className="order-label">CONTACT</span>
                        <strong>{request.phone || "No phone number"}</strong>
                        <PhoneBlockControl
                          phone={request.phone}
                          customerUid={request.customerId || request.userId}
                          adminUid={auth.currentUser?.uid}
                          isBlocked={Boolean(
                            blockedPhonesByNumber[
                              normalizePHPhone(request.phone)
                            ],
                          )}
                          canBlock={
                            !blockedPhonesLoading && !blockedPhonesError
                          }
                          onBlocked={handlePhoneBlocked}
                        />
                      </div>
                      <div>
                        <span className="order-label">FULFILLMENT</span>
                        <strong>{formatOrderType(request.orderType)}</strong>
                      </div>
                    </div>

                    <div className="request-details">
                      <section>
                        <h4>Requested items</h4>
                        {requestItems.length > 0 ? (
                          <ul>
                            {requestItems.map((item, index) => (
                              <li key={`${request.id}-${item.id}-${index}`}>
                                <span>
                                  {menuItemsById?.get(item.id)?.name
                                    || item.name
                                    || "Menu item"}
                                </span>
                                <strong>Qty {item.quantity ?? 0}</strong>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No request items available.</p>
                        )}

                        {status === "pending" && requestItems.length > 0 && (
                          <div className="request-pricing">
                            <button
                              type="button"
                              className="request-pricing-toggle"
                              aria-expanded={expandedRequestIds.has(request.id)}
                              onClick={() =>
                                handleRequestPreviewToggle(request.id)
                              }
                            >
                              {expandedRequestIds.has(request.id)
                                ? "Hide pricing preview"
                                : "Preview current menu pricing"}
                            </button>

                            {expandedRequestIds.has(request.id) && (
                              <div className="request-pricing-content">
                                {menuItemsLoading && (
                                  <AdminLoadingSkeleton
                                    label="Loading current menu prices"
                                    compact
                                    rows={2}
                                  />
                                )}

                                {!menuItemsLoading && menuItemsError && (
                                  <div
                                    className="request-pricing-error"
                                    role="alert"
                                  >
                                    <span>{menuItemsError}</span>
                                    <button
                                      type="button"
                                      onClick={loadMenuItems}
                                    >
                                      Retry
                                    </button>
                                  </div>
                                )}

                                {!menuItemsLoading
                                  && !menuItemsError
                                  && menuItemsById
                                  && (() => {
                                    let estimatedTotal = 0;
                                    let canCalculateTotal =
                                      requestItems.length > 0;
                                    const pricingRows = requestItems.map(
                                      (item) => {
                                        const menuItem =
                                          typeof item.id === "string"
                                            ? menuItemsById.get(item.id)
                                            : undefined;
                                        const quantity = item.quantity;
                                        const hasValidQuantity =
                                          typeof quantity === "number"
                                          && Number.isInteger(quantity)
                                          && quantity > 0;
                                        const price = menuItem?.price;
                                        const hasValidPrice =
                                          typeof price === "number"
                                          && Number.isFinite(price)
                                          && price >= 0;
                                        const subtotal =
                                          hasValidQuantity && hasValidPrice
                                            ? price * quantity
                                            : null;
                                        const hasValidSubtotal =
                                          subtotal !== null
                                          && Number.isFinite(subtotal);

                                        if (hasValidSubtotal) {
                                          estimatedTotal += subtotal;
                                        } else {
                                          canCalculateTotal = false;
                                        }

                                        if (!menuItem) {
                                          canCalculateTotal = false;
                                        }

                                        return {
                                          id:
                                            typeof item.id === "string"
                                              ? item.id
                                              : "Unknown menu item",
                                          name:
                                            typeof menuItem?.name === "string"
                                            && menuItem.name.trim()
                                              ? menuItem.name.trim()
                                              : null,
                                          quantity: hasValidQuantity
                                            ? quantity
                                            : null,
                                          price: hasValidPrice ? price : null,
                                          subtotal: hasValidSubtotal
                                            ? subtotal
                                            : null,
                                          missing: !menuItem,
                                          unavailable:
                                            menuItem?.available === false,
                                          invalidPrice:
                                            Boolean(menuItem)
                                            && !hasValidPrice,
                                          invalidQuantity:
                                            !hasValidQuantity,
                                        };
                                      }
                                    );
                                    const hasUnavailableItems =
                                      pricingRows.some(
                                        (item) => item.unavailable
                                      );
                                    const hasMissingItems =
                                      pricingRows.some((item) => item.missing);
                                    const hasInvalidPricing =
                                      pricingRows.some(
                                        (item) =>
                                          !item.missing
                                          && (
                                            item.invalidPrice
                                            || item.invalidQuantity
                                            || item.subtotal === null
                                          )
                                      );
                                    const expectedDeliveryFee =
                                      request.orderType === "delivery"
                                        ? getDeliveryFeeForBarangay(
                                          request.deliveryBarangay,
                                        )
                                        : 0;
                                    const hasInvalidDeliveryFee =
                                      request.orderType === "delivery"
                                      && expectedDeliveryFee
                                        !== request.deliveryFee;
                                    const canShowTotal =
                                      canCalculateTotal
                                      && Number.isFinite(estimatedTotal)
                                      && !hasInvalidDeliveryFee;
                                    const estimatedGrandTotal = canShowTotal
                                      ? estimatedTotal + expectedDeliveryFee
                                      : null;

                                    return (
                                      <>
                                        {(hasMissingItems
                                          || hasUnavailableItems
                                          || hasInvalidPricing) && (
                                          <div
                                            className="request-pricing-warning"
                                            role="alert"
                                          >
                                            {hasMissingItems && (
                                              <p>
                                                One or more requested menu items
                                                no longer exist.
                                              </p>
                                            )}
                                            {hasUnavailableItems && (
                                              <p>
                                                One or more requested items are
                                                currently unavailable.
                                              </p>
                                            )}
                                            {hasInvalidPricing && (
                                              <p>
                                                Some item prices or quantities
                                                are invalid, so a complete
                                                estimated total cannot be
                                                calculated.
                                              </p>
                                            )}
                                            {hasInvalidDeliveryFee && (
                                              <p>
                                                The delivery barangay or fee
                                                does not match the café&apos;s
                                                delivery fee schedule.
                                              </p>
                                            )}
                                          </div>
                                        )}

                                        <div className="request-pricing-table">
                                          <div className="request-pricing-row request-pricing-header">
                                            <span>Menu item</span>
                                            <span>Qty</span>
                                            <span>Unit price</span>
                                            <span>Subtotal</span>
                                          </div>
                                          {pricingRows.map((item, index) => (
                                            <div
                                              className="request-pricing-row"
                                              key={`${request.id}-pricing-${index}`}
                                            >
                                              <span className="request-pricing-name">
                                                {item.name || item.id}
                                                {item.missing && (
                                                  <small>Missing menu item</small>
                                                )}
                                                {item.unavailable && (
                                                  <small>Unavailable</small>
                                                )}
                                                {item.invalidPrice && (
                                                  <small>Invalid price</small>
                                                )}
                                              </span>
                                              <span data-label="Quantity">
                                                {item.quantity ?? "Invalid"}
                                              </span>
                                              <span data-label="Unit price">
                                                {item.price === null
                                                  ? "Unavailable"
                                                  : formatPrice(item.price)}
                                              </span>
                                              <span data-label="Subtotal">
                                                {item.subtotal === null
                                                  ? "Unavailable"
                                                  : formatPrice(item.subtotal)}
                                              </span>
                                            </div>
                                          ))}
                                          <div className="request-pricing-total">
                                            <span>Items subtotal</span>
                                            <strong>
                                              {canShowTotal
                                                ? formatPrice(estimatedTotal)
                                                : "Unavailable"}
                                            </strong>
                                          </div>
                                          {request.orderType === "delivery" && (
                                            <>
                                              <div className="request-pricing-total">
                                                <span>Delivery fee</span>
                                                <strong>
                                                  {expectedDeliveryFee === null
                                                    || hasInvalidDeliveryFee
                                                    ? "Unavailable"
                                                    : formatPrice(expectedDeliveryFee)}
                                                </strong>
                                              </div>
                                              <div className="request-pricing-total">
                                                <span>Estimated total</span>
                                                <strong>
                                                  {estimatedGrandTotal === null
                                                    ? "Unavailable"
                                                    : formatPrice(estimatedGrandTotal)}
                                                </strong>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                        {hasUnavailableItems && canShowTotal && (
                                          <p className="request-pricing-note">
                                            Estimate uses current menu prices
                                            and includes unavailable items.
                                          </p>
                                        )}
                                      </>
                                    );
                                  })()}
                              </div>
                            )}
                          </div>
                        )}
                      </section>

                      <section className="request-notes">
                        <h4>Fulfillment details</h4>
                        <p>
                          <span>Address</span>
                          <strong>{request.address || "Not provided"}</strong>
                        </p>
                        <p>
                          <span>Notes</span>
                          <strong>{request.notes || "None"}</strong>
                        </p>
                        {request.rejectionReason && (
                          <p>
                            <span>Rejection reason</span>
                            <strong>{request.rejectionReason}</strong>
                          </p>
                        )}
                      </section>
                      {isQrRequest && (
                        <RequestQrPaymentDetails
                          orderId={request.id}
                          payment={requestPayment}
                          total={requestOrderTotal}
                          copiedPaymentReference={copiedPaymentReference}
                          onCopyReference={handleCopyPaymentReference}
                          onOpenReceipt={setReceiptPreview}
                        />
                      )}
                      {!requestPayment.method && (
                        <div
                          className="request-payment-selection-state"
                          role={paymentSelectionError ? "alert" : "status"}
                        >
                          <strong>
                            {paymentSelectionLoading
                              ? "Loading payment details"
                              : "Payment details unavailable"}
                          </strong>
                          <p>
                            {paymentSelectionError
                              || "Approval is disabled until the saved payment method loads."}
                          </p>
                          {paymentSelectionError && (
                            <button
                              type="button"
                              className="request-payment-retry"
                              disabled={paymentSelectionLoading}
                              onClick={() =>
                                loadRequestPaymentSelections([request])
                              }
                            >
                              Retry payment details
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {status === "pending" && (
                      <div className="request-pricing">
                        <button
                          type="button"
                          className="request-pricing-toggle"
                          disabled={
                            approvalDialogLoading
                            || !requestPayment.method
                            || paymentSelectionLoading
                            || Boolean(approvingRequestId || rejectingRequestId)
                          }
                          onClick={() => handleOpenApprovalDialog(request)}
                        >
                          {paymentSelectionLoading
                            ? "Loading payment details..."
                            : paymentSelectionError
                              ? "Payment details unavailable"
                              : approvingRequestId === request.id
                                ? "Approving..."
                                : "Approve request"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <dialog
          ref={approvalDialogRef}
          className="approval-dialog"
          aria-labelledby="approval-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            closeApprovalDialog();
          }}
        >
          {approvalDialogRequest && (
            <div className="request-pricing">
              <div>
                <p className="admin-orders-eyebrow">APPROVAL REVIEW</p>
                <h2 id="approval-dialog-title">Confirm this order</h2>
                <p>
                  Customer:{" "}
                  <strong>
                    {approvalDialogRequest.customerName || "No name"}
                  </strong>
                  {approvalDialogRequest.customerEmail
                    ? ` (${approvalDialogRequest.customerEmail})`
                    : ""}
                </p>
                <p>
                  Fulfillment:{" "}
                  <strong>
                    {formatOrderType(approvalDialogRequest.orderType)}
                  </strong>
                </p>
              </div>

              {approvalDialogIsQr && (
                <RequestQrPaymentDetails
                  orderId={approvalDialogRequest.id}
                  payment={approvalDialogPayment}
                  total={approvalPricing?.total}
                  totalUnavailableLabel="Unavailable"
                  copiedPaymentReference={copiedPaymentReference}
                  onCopyReference={handleCopyPaymentReference}
                  onOpenReceipt={setReceiptPreview}
                />
              )}
              {!approvalDialogPayment.method && (
                <div
                  className="request-payment-selection-state"
                  role={
                    paymentSelectionErrorsByRequestId[approvalDialogRequest.id]
                      ? "alert"
                      : "status"
                  }
                >
                  <strong>
                    {paymentSelectionLoadingIds.has(approvalDialogRequest.id)
                      ? "Loading payment details"
                      : "Payment details unavailable"}
                  </strong>
                  <p>
                    {paymentSelectionErrorsByRequestId[
                      approvalDialogRequest.id
                    ] || "Approval is disabled until the saved payment method loads."}
                  </p>
                  {paymentSelectionErrorsByRequestId[
                    approvalDialogRequest.id
                  ] && (
                    <button
                      type="button"
                      className="request-payment-retry"
                      disabled={paymentSelectionLoadingIds.has(
                        approvalDialogRequest.id,
                      )}
                      onClick={() =>
                        loadRequestPaymentSelections([approvalDialogRequest])
                      }
                    >
                      Retry payment details
                    </button>
                  )}
                </div>
              )}

              {approvalDialogLoading && (
                <AdminLoadingSkeleton
                  label="Loading current menu prices"
                  compact
                  rows={2}
                />
              )}

              {approvalDialogError && (
                <div className="request-pricing-warning" role="alert">
                  <p>{approvalDialogError}</p>
                </div>
              )}

              {String(approvalDialogRequest.status || "").toLowerCase()
                === "pending" && (
                <div className="approval-rejection">
                  <label htmlFor="approval-rejection-preset">
                    Reason for rejection
                  </label>
                  <select
                    id="approval-rejection-preset"
                    value={rejectionReasonPreset}
                    disabled={Boolean(approvingRequestId || rejectingRequestId)}
                    onChange={(event) => {
                      const { value } = event.target;
                      setRejectionReasonPreset(value);
                      const preset = QUICK_REJECTION_REASONS.find(
                        (reasonOption) => reasonOption.value === value
                      );
                      setRejectionReason(preset?.reason || "");
                    }}
                  >
                    <option value="">Choose a quick reason (optional)</option>
                    {QUICK_REJECTION_REASONS.map((reasonOption) => (
                      <option
                        key={reasonOption.value}
                        value={reasonOption.value}
                      >
                        {reasonOption.label}
                      </option>
                    ))}
                    <option value="other">Other (enter reason below)</option>
                  </select>
                  <textarea
                    id="approval-rejection-reason"
                    aria-label="Rejection reason details"
                    value={rejectionReason}
                    maxLength={500}
                    rows={3}
                    placeholder="Add a brief reason for the customer. A default reason is used if left blank."
                    disabled={Boolean(approvingRequestId || rejectingRequestId)}
                    onChange={(event) => {
                      setRejectionReasonPreset("");
                      setRejectionReason(event.target.value);
                    }}
                  />
                  <span className="approval-rejection-help">
                    This reason is saved with the request and included in the
                    customer notification.
                  </span>
                </div>
              )}

              {!approvalDialogLoading && approvalPricing && (
                <>
                  {approvalPricing.errors.length > 0 && (
                    <div className="request-pricing-warning" role="alert">
                      {approvalPricing.errors.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  )}

                  <div className="request-pricing-table">
                    <div className="request-pricing-row request-pricing-header">
                      <span>Menu item</span>
                      <span>Qty</span>
                      <span>Unit price</span>
                      <span>Subtotal</span>
                    </div>
                    {approvalPricing.rows.map((item, index) => (
                      <div
                        className="request-pricing-row"
                        key={`${approvalDialogRequest.id}-approval-${index}`}
                      >
                        <span className="request-pricing-name">
                          {item.name}
                        </span>
                        <span data-label="Quantity">{item.quantity}</span>
                        <span data-label="Unit price">
                          {item.price === null
                            ? "Unavailable"
                            : formatPrice(item.price)}
                        </span>
                        <span data-label="Subtotal">
                          {item.subtotal === null
                            ? "Unavailable"
                            : formatPrice(item.subtotal)}
                        </span>
                      </div>
                    ))}
                    <div className="request-pricing-total">
                      <span>Items subtotal</span>
                      <strong>
                        {approvalPricing.itemsSubtotal === null
                          ? "Unavailable"
                          : formatPrice(approvalPricing.itemsSubtotal)}
                      </strong>
                    </div>
                    {approvalDialogRequest.orderType === "delivery" && (
                      <div className="request-pricing-total">
                        <span>Delivery fee</span>
                        <strong>
                          {approvalPricing.deliveryFee === null
                            ? "Unavailable"
                            : formatPrice(approvalPricing.deliveryFee)}
                        </strong>
                      </div>
                    )}
                    <div className="request-pricing-total">
                      <span>Estimated total</span>
                      <strong>
                        {approvalPricing.total === null
                          ? "Unavailable"
                          : formatPrice(approvalPricing.total)}
                      </strong>
                    </div>
                  </div>
                </>
              )}

              <div className="request-pricing approval-dialog-actions">
                {String(approvalDialogRequest.status || "").toLowerCase()
                  === "pending" && (
                  <button
                    type="button"
                    className="approval-reject-button"
                    disabled={Boolean(approvingRequestId || rejectingRequestId)}
                    onClick={handleConfirmRejection}
                  >
                    {rejectingRequestId ? "Rejecting..." : "Reject order"}
                  </button>
                )}
                <button
                  type="button"
                  className="refresh-button"
                  disabled={
                    approvalDialogLoading
                    || !approvalPricing
                    || approvalPricing.errors.length > 0
                    || !approvalDialogPayment.method
                    || paymentSelectionLoadingIds.has(
                      approvalDialogRequest.id,
                    )
                    || (
                      approvalDialogIsQr
                      && (
                        !/^\d{13}$/.test(
                          approvalDialogPayment.paymentReference,
                        )
                        || !approvalDialogPayment.paymentProofUrl
                      )
                    )
                    || Boolean(approvingRequestId || rejectingRequestId)
                  }
                  onClick={handleConfirmApproval}
                >
                  {approvingRequestId
                    ? "Approving..."
                    : "Confirm approval"}
                </button>
                <button
                  type="button"
                  className="request-pricing-toggle"
                  disabled={Boolean(approvingRequestId || rejectingRequestId)}
                  onClick={closeApprovalDialog}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </dialog>

        <dialog
          ref={receiptDialogRef}
          className="order-receipt-dialog"
          aria-labelledby="order-receipt-dialog-title"
          onClose={() => setReceiptPreview(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              receiptDialogRef.current?.close();
            }
          }}
        >
          {receiptPreview && (
            <div className="order-receipt-dialog-card">
              <header>
                <div>
                  <p>GCASH PAYMENT RECEIPT</p>
                  <h2 id="order-receipt-dialog-title">
                    Order {receiptPreview.orderId}
                  </h2>
                </div>
                <button
                  type="button"
                  className="order-receipt-dialog-close"
                  onClick={() => receiptDialogRef.current?.close()}
                  aria-label="Close GCash receipt preview"
                >
                  Close
                </button>
              </header>
              <div className="order-receipt-dialog-meta">
                {receiptPreview.reference && (
                  <span>
                    Reference <strong>{receiptPreview.reference}</strong>
                  </span>
                )}
                <span>
                  Order total{" "}
                  <strong>
                    {Number.isFinite(receiptPreview.total)
                      ? formatPrice(receiptPreview.total)
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
                Open original in a new tab
              </a>
            </div>
          )}
        </dialog>

        {ordersSectionTarget && createPortal(
          <>
        {notice && (
          <div
            className={noticeIsError ? "admin-orders-error" : "orders-notice"}
            role={noticeIsError ? "alert" : "status"}
          >
            <span>{noticeIsError ? "!" : "✓"}</span>
            {notice}
          </div>
        )}

        {error && (
          <div className="admin-orders-error" role="alert">
            <span>!</span>
            <p>{error}</p>

            <button
              type="button"
              onClick={loadOrders}
            >
              Try again
            </button>
          </div>
        )}

        <section className="orders-toolbar">
          <div>
            <p className="admin-orders-eyebrow">
              ORDER QUEUE
            </p>

            <h2>Manage incoming orders</h2>
          </div>

          <div className="orders-toolbar-actions">
            <label className="orders-search">
              <span>⌕</span>

              <input
                type="search"
                placeholder="Search customer or order"
                value={searchTerm}
                onChange={(event) => {
                  setSummaryFilter("all");
                  setSearchTerm(event.target.value)
                }}
              />
            </label>

            <select
              className="status-filter"
              value={statusFilter}
              onChange={(event) => {
                setSummaryFilter("all");
                setStatusFilter(event.target.value)
              }}
            >
              <option value="All">All statuses</option>
              {BASE_STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
              <option value="Out for Delivery">
                Out for Delivery
              </option>
              <option value="Ready for Pickup">
                Ready for Pickup
              </option>
            </select>

            <div
              className="fulfillment-filter"
              role="group"
              aria-label="Filter by fulfillment type"
            >
              {[
                { value: "all", label: "All" },
                { value: "dine-in", label: "Dine-in" },
                { value: "takeout", label: "Takeout" },
                { value: "delivery", label: "Delivery" },
              ].map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`fulfillment-filter-button${fulfillmentFilter === option.value ? " is-active" : ""}`}
                  aria-pressed={fulfillmentFilter === option.value}
                  onClick={() => handleFulfillmentFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="refresh-button"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        {!error && orders.length === 0 && (
          <section className="admin-orders-empty">
            <div className="empty-icon">📦</div>

            <p className="admin-orders-eyebrow">
              ORDER QUEUE
            </p>

            <h2>No orders yet</h2>

            <p>
              Customer orders will appear here after they place
              an order.
            </p>
          </section>
        )}

        {!error &&
          orders.length > 0 &&
          filteredOrders.length === 0 && (
            <section className="admin-orders-empty compact-empty">
              <div className="empty-icon">⌕</div>

              <h2>No matching orders</h2>

              <p>
                Try another search term or choose a different
                status filter.
              </p>
            </section>
          )}

        {!error && filteredOrders.length > 0 && (
          <section className="admin-orders-list">
            <div className="orders-list-heading">
              <div>
                <p className="admin-orders-eyebrow">
                  CUSTOMER ACTIVITY
                </p>

                <h2>
                  {filteredOrders.length}{" "}
                  {filteredOrders.length === 1
                    ? "order"
                    : "orders"}{" "}
                  shown
                </h2>
              </div>
            </div>

            {filteredOrders.map((order) => {
              const status = order.status || "Pending";
              const orderItems = Array.isArray(order.items)
                ? order.items
                : [];
              const gracePeriod = getDeliveryGracePeriod(order, currentTime);
              const waitingFeeRecorded = hasDeliveryWaitingFee(order);
              const isUnpaidCashOrder =
                order.paymentMethod === "cash"
                && order.cashPaymentStatus !== "paid";
              const canReviewQrPayment =
                order.paymentMethod === "qr"
                && [
                  "pending_verification",
                  "needs_review",
                  "rejected",
                ].includes(order.paymentStatus);

              return (
                <article
                  className="admin-order-card"
                  key={order.id}
                >
                  <div className="admin-order-header">
                    <div>
                      <div className="order-reference-heading">
                        <span className="order-label">ORDER</span>
                        <span className="order-reference-pill">
                          Ref #{order.id.slice(0, 8).toUpperCase()}
                        </span>
                      </div>
                      <div className="customer-order-id-block">
                        <span className="order-label">CUSTOMER ORDER ID</span>
                        <div className="customer-order-id-pill">
                          <code>{order.id}</code>
                          <button
                            type="button"
                            className={`customer-order-id-copy${copiedOrderId === order.id ? " is-copied" : ""}`}
                            onClick={() => handleCopyOrderId(order.id)}
                            aria-label={
                              copiedOrderId === order.id
                                ? "Order ID copied"
                                : "Copy customer Order ID"
                            }
                          >
                            {copiedOrderId === order.id ? "Copied!" : "Copy ID"}
                          </button>
                        </div>
                      </div>
                      <p className="order-date">
                        {formatDate(order.createdAt)}
                      </p>
                    </div>

                    <span
                      className={`order-status status-${getStatusClass(
                        status
                      )}`}
                    >
                      <span className="status-dot" />
                      {status}
                    </span>
                  </div>

                  <div className="admin-order-info">
                    <div>
                      <span className="order-label">
                        CUSTOMER
                      </span>

                      <strong>
                        {order.customerName ||
                          order.name ||
                          "No name"}
                      </strong>

                      <small>
                        {order.customerEmail ||
                          order.email ||
                          "No email"}
                      </small>
                    </div>

                    <div>
                      <span className="order-label">
                        CONTACT
                      </span>

                      <strong>
                        {order.phone ||
                          order.contactNumber ||
                          "No phone number"}
                      </strong>
                      <PhoneBlockControl
                        phone={order.phone || order.contactNumber}
                        customerUid={order.customerId || order.userId}
                        adminUid={auth.currentUser?.uid}
                        isBlocked={Boolean(
                          blockedPhonesByNumber[
                            normalizePHPhone(order.phone || order.contactNumber)
                          ],
                        )}
                        canBlock={
                          !blockedPhonesLoading && !blockedPhonesError
                        }
                        onBlocked={handlePhoneBlocked}
                      />
                    </div>

                    <div>
                      <span className="order-label">
                        ORDER TYPE
                      </span>

                      <strong>
                        {formatOrderType(order.orderType)}
                      </strong>
                    </div>

                    <div>
                      <span className="order-label">
                        {isUnpaidCashOrder ? "CASH AMOUNT DUE" : "TOTAL"}
                      </span>

                      <strong className="order-total">
                        {formatPrice(getTotal(order))}
                      </strong>
                    </div>
                  </div>

                  <details
                    className="order-details"
                    onToggle={(event) => {
                      if (event.currentTarget.open) {
                        loadMenuItems();
                      }
                    }}
                  >
                    <summary>
                      View order details
                    </summary>

                    <div className="order-details-content">
                      <div className="order-items">
                        <h4>Items</h4>

                        {orderItems.length > 0 ? (
                          orderItems.map((item, index) => {
                            const menuItem = menuItemsById?.get(item.id);
                            const imageUrl = [
                              menuItem?.imageUrl,
                              item.imageUrl,
                              menuItem?.image,
                              item.image,
                            ].find(
                              (value) =>
                                typeof value === "string" && value.trim()
                            );

                            return (
                              <div
                                className="admin-order-item"
                                key={`${order.id}-${index}`}
                              >
                                <OrderItemThumbnail imageUrl={imageUrl} />

                                <div>
                                  <strong>
                                    {item.name || "Item"}
                                  </strong>

                                  <span>
                                    {item.quantity || 0} ×{" "}
                                    {formatPrice(item.price)}
                                  </span>
                                </div>

                                <strong>
                                  {formatPrice(
                                    item.subtotal ??
                                      Number(item.price || 0) *
                                        Number(item.quantity || 0)
                                  )}
                                </strong>
                              </div>
                            );
                          })
                        ) : (
                          <p className="no-items">
                            No order items available.
                          </p>
                        )}
                      </div>

                      {(order.address ||
                        order.pickupTime ||
                        order.tableNumber ||
                        order.notes ||
                        order.paymentMethod ||
                        order.orderType === "delivery") && (
                        <div className="order-extra-details">
                          {order.address && (
                            <div>
                              <span>Customer address</span>
                              <strong>{order.address}</strong>
                            </div>
                          )}

                          {order.pickupTime && (
                            <div>
                              <span>Pickup time</span>
                              <strong>
                                {order.pickupTime}
                              </strong>
                            </div>
                          )}

                          {order.tableNumber && (
                            <div>
                              <span>Table number</span>
                              <strong>
                                {order.tableNumber}
                              </strong>
                            </div>
                          )}

                          {order.paymentMethod && (
                            <div>
                              <span>Payment method</span>
                              <strong>
                                {getPaymentMethodLabel(order.paymentMethod)}
                              </strong>
                            </div>
                          )}

                          {order.paymentMethod && order.paymentMethod !== "qr" && (
                            <div>
                              <span>Payment status</span>
                              <strong
                                className={`order-payment-status order-payment-status-${getPaymentStatusClass(order.paymentStatus)}`}
                              >
                                {getPaymentStatusLabel(order.paymentStatus)}
                              </strong>
                            </div>
                          )}

                          {order.paymentMethod === "qr" && (
                            <div className="order-gcash-review order-gcash-order-card">
                              <div className="order-gcash-topbar">
                                <div className="order-gcash-total">
                                  <span>Order Total</span>
                                  <strong>{formatPrice(order.total)}</strong>
                                </div>
                                <div className="order-gcash-status">
                                  <span>Payment status</span>
                                  <div>
                                    <strong
                                      className={`order-payment-status order-payment-status-${getPaymentStatusClass(order.paymentStatus || "pending_verification")}`}
                                    >
                                      {(order.paymentStatus || "pending_verification") === "pending_verification"
                                        ? "Pending GCash Check"
                                        : getPaymentStatusLabel(order.paymentStatus)}
                                    </strong>
                                    <code>
                                      {order.paymentStatus || "pending_verification"}
                                    </code>
                                  </div>
                                </div>
                              </div>

                              <div className="order-gcash-details-grid">
                                {order.paymentReference && (
                                  <div className="order-gcash-reference">
                                    <span>13-digit GCash Reference Number</span>
                                    <div className="order-gcash-reference-row">
                                      <code>{order.paymentReference}</code>
                                      <button
                                        type="button"
                                        className={`order-gcash-copy${copiedPaymentReference === order.id ? " is-copied" : ""}`}
                                        onClick={() =>
                                          handleCopyPaymentReference(order)
                                        }
                                        aria-label={
                                          copiedPaymentReference === order.id
                                            ? "GCash reference copied"
                                            : `Copy GCash reference ${order.paymentReference}`
                                        }
                                      >
                                        {copiedPaymentReference === order.id
                                          ? "Copied!"
                                          : "Copy"}
                                      </button>
                                    </div>
                                    <p className="order-gcash-verification-note">
                                      Before approving, confirm this reference
                                      and the exact order total were received in
                                      GCash.
                                    </p>
                                  </div>
                                )}

                                {order.paymentProofUrl && (
                                  <div className="order-gcash-receipt">
                                    <span>Receipt Screenshot</span>
                                    <div className="order-gcash-receipt-actions">
                                      <button
                                        type="button"
                                        className="order-payment-proof-preview"
                                        onClick={() => setReceiptPreview({
                                          orderId: order.id,
                                          reference: order.paymentReference || "",
                                          total: order.total,
                                          url: order.paymentProofUrl,
                                        })}
                                        aria-label={`Enlarge GCash receipt for order ${order.id}`}
                                      >
                                        <img
                                          src={order.paymentProofUrl}
                                          alt="Customer GCash receipt preview"
                                        />
                                        <span>Enlarge receipt</span>
                                      </button>
                                      <a
                                        className="order-payment-proof-link"
                                        href={order.paymentProofUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Open original
                                      </a>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {canReviewQrPayment && (
                                <div className="order-gcash-actions">
                                  <div>
                                    <button
                                      type="button"
                                      className="order-gcash-action is-verified"
                                      disabled={
                                        Boolean(updatingId)
                                        || !/^\d{13}$/.test(
                                          order.paymentReference || "",
                                        )
                                        || !order.paymentProofUrl
                                      }
                                      onClick={() =>
                                        handleUpdateQrPaymentStatus(
                                          order,
                                          "paid",
                                        )
                                      }
                                    >
                                      {updatingId === order.id
                                        ? "Saving..."
                                        : "Mark verified"}
                                    </button>
                                    <button
                                      type="button"
                                      className="order-gcash-action is-review"
                                      disabled={
                                        Boolean(updatingId)
                                        || order.paymentStatus === "needs_review"
                                      }
                                      onClick={() =>
                                        handleUpdateQrPaymentStatus(
                                          order,
                                          "needs_review",
                                        )
                                      }
                                    >
                                      Needs review
                                    </button>
                                    <button
                                      type="button"
                                      className="order-gcash-action is-rejected"
                                      disabled={
                                        Boolean(updatingId)
                                        || order.paymentStatus === "rejected"
                                      }
                                      onClick={() =>
                                        handleUpdateQrPaymentStatus(
                                          order,
                                          "rejected",
                                        )
                                      }
                                    >
                                      Reject payment
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {order.orderType === "delivery" && (
                            <div>
                              <span>Delivery barangay</span>
                              <strong>
                                {order.deliveryBarangay || "Not recorded"}
                              </strong>
                            </div>
                          )}

                          {order.notes && (
                            <div>
                              <span>Order notes</span>
                              <strong>{order.notes}</strong>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="details-total">
                        <div className="order-price-breakdown">
                          <span>Items subtotal</span>
                          <strong>
                            {formatPrice(
                              order.itemsSubtotal ?? (Number(order.total || 0) - Number(order.deliveryFee || 0)),
                            )}
                          </strong>
                        </div>
                        {order.orderType === "delivery" && (
                          <div className="order-price-breakdown">
                            <span>Delivery fee</span>
                            <strong>{formatPrice(order.deliveryFee)}</strong>
                          </div>
                        )}
                        {waitingFeeRecorded && (
                          <div className="order-price-breakdown">
                            <span>Waiting fee</span>
                            <strong>{formatPrice(DELIVERY_WAITING_FEE)}</strong>
                          </div>
                        )}
                        <div className="order-price-breakdown is-total">
                          <span>
                            {isUnpaidCashOrder
                              ? "Cash amount due"
                              : "Total due"}
                          </span>
                          <strong>{formatPrice(getTotal(order))}</strong>
                        </div>
                      </div>

                      {order.orderType === "delivery" && (
                        <section className="delivery-operations" aria-label="Delivery operations">
                          <h4>Delivery handoff</h4>
                          {order.deliveryArrivalAt?.toDate ? (
                            <>
                              <p>
                                Arrival recorded: {formatDate(order.deliveryArrivalAt)}.
                                The 10-minute grace period ends at{" "}
                                {new Date(
                                  order.deliveryArrivalAt.toDate().getTime()
                                    + 10 * 60 * 1000,
                                ).toLocaleTimeString("en-PH", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                                .
                              </p>
                              <p className="delivery-grace-status" role="status">
                                {gracePeriod?.elapsed
                                  ? "The 10-minute grace period has elapsed."
                                  : `Grace time remaining: ${formatDeliveryGraceRemaining(
                                    gracePeriod?.remainingMs ?? 0,
                                  )}.`}
                              </p>
                              {waitingFeeRecorded ? (
                                <p role="status">
                                  One-time ₱20 waiting fee recorded.
                                </p>
                              ) : (
                                <button
                                  type="button"
                                  className="refresh-button"
                                  disabled={
                                    updatingId === order.id
                                    || !canApplyDeliveryWaitingFee(
                                      order,
                                      currentTime,
                                    )
                                  }
                                  onClick={() => handleApplyWaitingFee(order)}
                                >
                                  Add one-time ₱20 waiting fee
                                </button>
                              )}
                              {status === "Out for Delivery"
                                && isUnpaidCashOrder
                                && gracePeriod?.elapsed && (
                                  <button
                                    type="button"
                                    className="unreachable-order-button"
                                    disabled={updatingId === order.id}
                                    onClick={() => handleMarkUnreachable(order)}
                                  >
                                    {waitingFeeRecorded
                                      ? "Mark Unreachable"
                                      : "Apply ₱20 fee & mark Unreachable"}
                                  </button>
                                )}
                            </>
                          ) : (
                            <>
                              <p>
                                Record arrival when the rider reaches the customer.
                                The one-time ₱20 waiting fee may only be added after
                                the 10-minute grace period.
                              </p>
                              {status === "Out for Delivery" && (
                                <button
                                  type="button"
                                  className="refresh-button"
                                  disabled={updatingId === order.id}
                                  onClick={() => handleRecordDeliveryArrival(order)}
                                >
                                  Record customer arrival
                                </button>
                              )}
                            </>
                          )}

                          {order.deliveryProofUrl ? (
                            <div className="delivery-proof-preview">
                              <strong>Proof of Delivery</strong>
                              <DeliveryProofPreview
                                key={order.deliveryProofUrl}
                                proofUrl={order.deliveryProofUrl}
                              />
                            </div>
                          ) : ["Out for Delivery", "Completed"].includes(status) ? (
                            <form
                              className="delivery-proof-upload"
                              onSubmit={(event) => {
                                event.preventDefault();
                                handleDeliveryProofSave(order);
                              }}
                            >
                              <label htmlFor={`delivery-proof-${order.id}`}>
                                Proof of Delivery photo URL
                              </label>
                              <input
                                id={`delivery-proof-${order.id}`}
                                type="url"
                                inputMode="url"
                                autoComplete="url"
                                maxLength={2048}
                                placeholder="https://example.com/delivery-photo.jpg"
                                value={deliveryProofUrlDrafts[order.id] || ""}
                                disabled={savingProofId === order.id}
                                onChange={(event) => {
                                  const { value } = event.target;
                                  setDeliveryProofUrlDrafts((drafts) => ({
                                    ...drafts,
                                    [order.id]: value,
                                  }));
                                }}
                              />
                              <small>
                                Enter a publicly accessible HTTPS image link.
                              </small>
                              <button
                                type="submit"
                                className="refresh-button"
                                disabled={savingProofId === order.id}
                              >
                                {savingProofId === order.id
                                  ? "Saving photo link..."
                                  : "Save Proof of Delivery link"}
                              </button>
                            </form>
                          ) : (
                            <p>
                              Proof recording becomes available when the order is
                              Out for Delivery.
                            </p>
                          )}
                        </section>
                      )}
                    </div>
                  </details>

                  <div className="status-control">
                    <div className="status-control-info">
                      <label htmlFor={`status-${order.id}`}>
                        Update order status
                      </label>
                      <p className="status-control-hint">
                        {getStatusFlowDescription(order)}
                      </p>
                    </div>

                    <div className="status-control-row">
                      <select
                        id={`status-${order.id}`}
                        value={status}
                        disabled={updatingId === order.id}
                        onChange={(event) =>
                          handleStatusChange(
                            order.id,
                            event.target.value
                          )
                        }
                      >
                        {getStatusOptions(order).map(
                          (statusOption) => (
                            <option
                              key={statusOption}
                              value={statusOption}
                            >
                              {statusOption}
                            </option>
                          )
                        )}
                      </select>

                      {updatingId === order.id && (
                        <span className="updating-label">
                          Updating...
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
          </>,
          ordersSectionTarget
        )}
          </>
        )}
      </div>
      </div>
    </main>
  );
}

export default AdminOrders;