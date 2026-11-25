import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/Authcontext";
import { auth, db } from "../services/firebase";
import {
  loadCustomerPaymentHistory,
  submitQrPaymentReference,
} from "../services/paymentRecordService";
import { normalizeDeliveryProofUrl } from "../utils/deliveryProofUrl.js";
import {
  DELIVERY_WAITING_FEE,
  formatDeliveryGraceRemaining,
  getDeliveryGracePeriod,
  hasDeliveryWaitingFee,
  normalizeOrderStatus,
  partitionOrders,
} from "../utils/orderStatus.js";
import "../styles/MyOrders.css";

const BASE_STATUS_STEPS = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready",
  "Completed",
];

const REVIEW_PROMPT_DISMISSALS_KEY = "cactus-cafe:dismissed-review-orders";
const ACTIVE_ORDER_TAB_KEY = "cactus-cafe:my-orders-tab";

const getStatusClass = (status) =>
  normalizeOrderStatus(status).toLowerCase().replace(/\s+/g, "-");

const getDeclineReason = (record) => {
  for (const reason of [record?.rejectionReason, record?.declineReason]) {
    if (typeof reason === "string" && reason.trim()) {
      return reason.trim();
    }
  }

  return "";
};

const getStatusSteps = (orderType, status) => {
  const normalizedOrderType = String(orderType || "").trim().toLowerCase();
  const normalizedStatus = normalizeOrderStatus(status);
  const steps = BASE_STATUS_STEPS.slice(0, -1);

  if (
    normalizedOrderType === "delivery"
    || normalizedStatus === "Out for Delivery"
  ) {
    steps.push("Out for Delivery");
  }

  steps.push("Completed");
  return steps;
};

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

const getOrderCostBreakdown = (order) => {
  const itemsSubtotalFromItems = Array.isArray(order.items)
    ? order.items.reduce((sum, item) => {
      const lineTotal = item.subtotal
        ?? Number(item.price || 0) * Number(item.quantity || 0);
      const amount = Number(lineTotal);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0)
    : 0;
  const storedItemsSubtotal = Number(order.itemsSubtotal);
  const itemsSubtotal = order.itemsSubtotal !== undefined
    && order.itemsSubtotal !== null
    && Number.isFinite(storedItemsSubtotal)
    ? Math.max(0, storedItemsSubtotal)
    : itemsSubtotalFromItems;
  const isDelivery = String(order.orderType || "").trim().toLowerCase()
    === "delivery";
  const storedOrderTotal = Number(order.total);
  const hasStoredOrderTotal = order.total !== undefined
    && order.total !== null
    && Number.isFinite(storedOrderTotal);
  const storedDeliveryFee = Number(order.deliveryFee);
  const hasStoredDeliveryFee = order.deliveryFee !== undefined
    && order.deliveryFee !== null
    && Number.isFinite(storedDeliveryFee);
  const deliveryFee = isDelivery
    ? hasStoredDeliveryFee
      ? Math.max(0, storedDeliveryFee)
      : hasStoredOrderTotal
        ? Math.max(0, storedOrderTotal - itemsSubtotal)
        : 0
    : 0;
  const orderTotal = hasStoredOrderTotal
    ? Math.max(0, storedOrderTotal)
    : itemsSubtotal + deliveryFee;
  const waitingFee = hasDeliveryWaitingFee(order)
    ? DELIVERY_WAITING_FEE
    : 0;

  return {
    itemsSubtotal,
    deliveryFee,
    isDelivery,
    waitingFee,
    totalPayment: orderTotal + waitingFee,
  };
};

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Date unavailable";
  }

  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

function CustomerDeliveryProof({ proofUrl }) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewButtonRef = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!previewOpen) return undefined;

    const previewButton = previewButtonRef.current;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previewButton?.focus();
    };
  }, [previewOpen]);

  return (
    <div className="customer-delivery-proof">
      {!imageLoadFailed ? (
        <button
          ref={previewButtonRef}
          type="button"
          className="customer-delivery-proof-preview"
          aria-label="Preview Proof of Delivery photo"
          onClick={() => setPreviewOpen(true)}
        >
          <img
            src={proofUrl}
            alt="Proof of Delivery"
            referrerPolicy="no-referrer"
            onError={() => setImageLoadFailed(true)}
          />
        </button>
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
      {previewOpen && !imageLoadFailed && (
        <div
          className="delivery-proof-lightbox"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewOpen(false);
            }
          }}
        >
          <div
            className="delivery-proof-lightbox-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Proof of Delivery photo preview"
          >
            <button
              ref={closeButtonRef}
              type="button"
              className="delivery-proof-lightbox-close"
              aria-label="Close Proof of Delivery preview"
              onClick={() => setPreviewOpen(false)}
            >
              ×
            </button>
            <img
              src={proofUrl}
              alt="Proof of Delivery"
              referrerPolicy="no-referrer"
              onError={() => {
                setImageLoadFailed(true);
                setPreviewOpen(false);
              }}
            />
            <a
              className="delivery-proof-lightbox-link"
              href={proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              Open photo in a new tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

const getOrderItemName = (item) => {
  const name = typeof item.name === "string" && item.name.trim()
    ? item.name.trim()
    : item.id || "Item";
  const size = typeof item.size === "string" ? item.size.trim() : "";

  return size && !name.endsWith(`(${size})`)
    ? `${name} (${size})`
    : name;
};

const getRequestedItemName = (item, menuItem) => {
  const name = menuItem
    ? typeof menuItem.name === "string" && menuItem.name.trim()
      ? menuItem.name.trim()
      : "Item"
    : item?.id || "Item";
  const size = typeof item?.size === "string" ? item.size.trim() : "";

  return size && !name.endsWith(`(${size})`)
    ? `${name} (${size})`
    : name;
};

const getRequestedItemPrice = (item, menuItem) => {
  if (!menuItem) return null;

  const size = typeof item?.size === "string" ? item.size.trim() : "";
  if (size) {
    const sizePricesCents = menuItem.sizePricesCents;
    const sizePriceCents =
      sizePricesCents
      && Object.hasOwn(sizePricesCents, size)
        ? sizePricesCents[size]
        : null;

    if (
      Number.isInteger(sizePriceCents)
      && sizePriceCents >= 0
      && sizePriceCents <= 100000000
    ) {
      return sizePriceCents / 100;
    }

    const sizes = menuItem.sizes;
    const sizePrice =
      sizes && Object.hasOwn(sizes, size) ? sizes[size] : null;
    if (
      typeof sizePrice === "number"
      && Number.isFinite(sizePrice)
      && sizePrice >= 0
      && sizePrice <= 1000000
    ) {
      return sizePrice;
    }
  }

  const basePrice = menuItem.price;
  return typeof basePrice === "number"
    && Number.isFinite(basePrice)
    && basePrice >= 0
    && basePrice <= 1000000
    ? basePrice
    : null;
};

const getRequestedItemSubtotal = (unitPrice, quantity) => {
  if (
    unitPrice === null
    || !Number.isSafeInteger(quantity)
    || quantity < 1
    || quantity > 99
  ) {
    return null;
  }

  const subtotal = unitPrice * quantity;
  return Number.isFinite(subtotal) ? subtotal : null;
};

const getRequestedItemsTotal = (items, menuItemsById) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  let total = 0;
  for (const item of items) {
    const unitPrice = getRequestedItemPrice(
      item,
      menuItemsById.get(item?.id)
    );
    const subtotal = getRequestedItemSubtotal(unitPrice, item?.quantity);
    if (subtotal === null) return null;

    total += subtotal;
    if (!Number.isFinite(total)) return null;
  }

  return total;
};

function RequestItemImage({ menuItem }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl =
    typeof menuItem?.imageUrl === "string" ? menuItem.imageUrl.trim() : "";

  return (
    <div className="request-item-image">
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <span aria-hidden="true">☕</span>
      )}
    </div>
  );
}

function RequestItemsSection({
  request,
  menuItemsById,
  menuItemsError,
  isExpanded,
  onToggle,
}) {
  const items = Array.isArray(request.items) ? request.items : [];
  const visibleItems = isExpanded ? items : items.slice(0, 1);
  const hiddenCount = items.length - 1;
  const total = getRequestedItemsTotal(items, menuItemsById);

  return (
    <div className="request-items">
      <h4>Requested items</h4>
      {menuItemsError && (
        <p className="request-items-error">{menuItemsError}</p>
      )}
      <div className="request-item-list" id={`request-items-${request.id}`}>
        {items.length > 0 ? (
          visibleItems.map((item, index) => {
            const menuItem = menuItemsById.get(item?.id);
            const unitPrice = getRequestedItemPrice(item, menuItem);
            const lineSubtotal = getRequestedItemSubtotal(
              unitPrice,
              item?.quantity
            );

            return (
              <div
                className={`request-item${
                  index === visibleItems.length - 1
                    ? " request-item-last"
                    : ""
                }`}
                key={`${item?.id}-${index}`}
              >
                <RequestItemImage menuItem={menuItem} />
                <div className="request-item-details">
                  <strong className="request-item-name">
                    {getRequestedItemName(item, menuItem)}
                  </strong>
                  <div className="request-item-pricing">
                    <span>
                      {unitPrice === null
                        ? "Unit price: —"
                        : `${formatPrice(unitPrice)} each`}
                    </span>
                    {Number(item?.quantity) > 1 && (
                      <span>
                        Subtotal:{" "}
                        {lineSubtotal === null
                          ? "—"
                          : formatPrice(lineSubtotal)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="request-item-quantity">
                  Quantity: {Number(item?.quantity) || 0}
                </span>
              </div>
            );
          })
        ) : (
          <p className="request-group-empty">No item details available.</p>
        )}
      </div>
      {items.length > 1 && (
        <button
          type="button"
          className="request-items-toggle"
          aria-expanded={isExpanded}
          aria-controls={`request-items-${request.id}`}
          onClick={onToggle}
        >
          <span
            className={`request-items-toggle-chevron${
              isExpanded ? " expanded" : ""
            }`}
            aria-hidden="true"
          />
          {isExpanded
            ? "Show less"
            : `Show ${hiddenCount} more ${
              hiddenCount === 1 ? "item" : "items"
            }`}
        </button>
      )}
      <div className="request-total">
        <span>Total Payment</span>
        <strong>{total === null ? "—" : formatPrice(total)}</strong>
      </div>
    </div>
  );
}

const PAYMENT_TIMING_LABELS = {
  advance: "Advance Payment",
  pay_later: "Pay Later",
};

const getPaymentStatusLabel = (record) => {
  if (!record) return "Not submitted";
  if (
    record.paymentStatus === "pending_verification"
    || record.paymentStatus === "pending_review"
  ) {
    return "Awaiting GCash confirmation";
  }
  if (
    record.paymentStatus === "needs_review"
    || record.paymentStatus === "admin_review_required"
  ) {
    return "Needs review";
  }
  if (record.paymentStatus === "paid") return "Verified in GCash";
  if (record.paymentStatus === "rejected") return "Rejected";
  return "Payment status unavailable";
};

const getPaymentStatusClass = (record) => {
  if (!record) return "not-submitted";
  return String(record.paymentStatus || "unknown")
    .toLowerCase()
    .replace(/_/g, "-");
};

const formatOrderType = (orderType) => {
  const labels = {
    takeout: "Takeout",
    pickup: "Takeout",
    delivery: "Delivery",
    "dine-in": "Dine-in",
    dinein: "Dine-in",
  };

  const normalizedOrderType = String(orderType || "").trim().toLowerCase();
  return labels[normalizedOrderType] || "Not specified";
};

function OrderStatusTracker({
  status,
  orderType,
  rejectionReason,
  unreachableReason,
}) {
  const normalizedStatus = normalizeOrderStatus(status);
  const isDeclined = normalizedStatus === "Declined";
  const isRejected = normalizedStatus === "Rejected";
  const isUnreachable = normalizedStatus === "Unreachable";

  if (
    normalizedStatus === "Cancelled"
    || isDeclined
    || isRejected
    || isUnreachable
  ) {
    return (
      <div
        className={`cancelled-message${isUnreachable ? " unreachable-message" : ""}`}
      >
        <span className="status-symbol">×</span>
        <div>
          <strong>
            {isUnreachable
              ? "Delivery marked Unreachable"
              : isDeclined
                ? "Order declined"
                : isRejected
                  ? "Order rejected"
                  : "Order cancelled"}
          </strong>
          <p>
            {isUnreachable
              ? unreachableReason
                || "The rider could not reach you after the 10-minute waiting period. Please contact the cafe to arrange next steps."
              : isDeclined
                ? rejectionReason || "The cafe declined this order."
                : isRejected
                  ? rejectionReason || "This order was rejected."
                  : "This order is no longer being prepared."}
          </p>
        </div>
      </div>
    );
  }

  const statusSteps = getStatusSteps(orderType, normalizedStatus);
  const currentIndex = statusSteps.indexOf(
    normalizedStatus === "Approved" ? "Confirmed" : normalizedStatus,
  );

  return (
    <div className="status-tracker" aria-label="Order progress">
      {statusSteps.map((step, index) => {
        const isComplete = index <= currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div
            className={`status-step ${
              isComplete ? "complete" : ""
            } ${isCurrent ? "current" : ""}`}
            key={step}
          >
            <span className="status-step-dot">
              {isComplete && index < currentIndex ? "✓" : ""}
            </span>

            <span className="status-step-label">{step}</span>

            {index < statusSteps.length - 1 && (
              <span
                className={`status-step-line ${
                  index < currentIndex ? "complete" : ""
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MyOrders() {
  const navigate = useNavigate();
  const { user, role } = useAuth();

  const [orders, setOrders] = useState([]);
  const [activeOrderTab, setActiveOrderTab] = useState("active");
  const [tabStorageReadyForUser, setTabStorageReadyForUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [existingReviewCount, setExistingReviewCount] = useState(null);
  const [reviewCountLoading, setReviewCountLoading] = useState(true);
  const [reviewCountError, setReviewCountError] = useState("");
  const [dismissedReviewOrderIds, setDismissedReviewOrderIds] = useState(
    () => new Set()
  );
  const [dismissalsLoaded, setDismissalsLoaded] = useState(false);
  const [reviewPromptStorageError, setReviewPromptStorageError] = useState("");
  const [orderRequests, setOrderRequests] = useState([]);
  const [expandedRequestIds, setExpandedRequestIds] = useState(
    () => new Set()
  );
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const [menuItemsById, setMenuItemsById] = useState(() => new Map());
  const [menuItemsError, setMenuItemsError] = useState("");
  const [paymentSelections, setPaymentSelections] = useState({});
  const [paymentRecordsByOrderId, setPaymentRecordsByOrderId] = useState({});
  const [paymentDataLoading, setPaymentDataLoading] = useState(true);
  const [paymentDataError, setPaymentDataError] = useState("");
  const [referenceInputs, setReferenceInputs] = useState({});
  const [paymentFeedback, setPaymentFeedback] = useState({});
  const [submittingOrderIds, setSubmittingOrderIds] = useState(new Set());
  const submittingOrderIdsRef = useRef(new Set());
  const failedReadsRef = useRef(new Set());
  const successfulReadsRef = useRef(new Set());
  const initialReadsPendingRef = useRef(false);
  const retryAfterInitialReadsRef = useRef(false);
  const retryInProgressRef = useRef(false);
  const readUserIdRef = useRef("");
  const wasOfflineRef = useRef(
    typeof navigator !== "undefined" && !navigator.onLine
  );
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  const [isRetryingFailedReads, setIsRetryingFailedReads] = useState(false);

  useEffect(() => {
    const timerId = window.setInterval(
      () => setCurrentTime(Date.now()),
      30_000,
    );
    return () => window.clearInterval(timerId);
  }, []);

  const toggleRequestItems = (requestId) => {
    setExpandedRequestIds((current) => {
      const next = new Set(current);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };

  const loadOrders = useCallback(async (currentUser) => {
    try {
      setLoading(true);
      setError("");

      const ordersQuery = query(
        collection(db, "orders"),
        where("customerId", "==", currentUser.uid)
      );

      const snapshot = await getDocs(ordersQuery);

      const orderList = snapshot.docs
        .map((orderDoc) => ({
          id: orderDoc.id,
          ...orderDoc.data(),
        }))
        .sort((firstOrder, secondOrder) => {
          const firstDate = firstOrder.createdAt?.toDate
            ? firstOrder.createdAt.toDate()
            : new Date(0);

          const secondDate = secondOrder.createdAt?.toDate
            ? secondOrder.createdAt.toDate()
            : new Date(0);

          return secondDate - firstDate;
        });

      setOrders(orderList);
      failedReadsRef.current.delete("orders");
      successfulReadsRef.current.add("orders");
    } catch (loadError) {
      failedReadsRef.current.add("orders");
      console.error("Error loading orders:", loadError);
      setError("Unable to load your orders. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReviewCount = useCallback(async (currentUser) => {
    try {
      setReviewCountLoading(true);
      setReviewCountError("");

      const reviewsQuery = query(
        collection(db, "reviews"),
        where("customerId", "==", currentUser.uid)
      );
      const snapshot = await getDocs(reviewsQuery);
      setExistingReviewCount(snapshot.size);
      failedReadsRef.current.delete("reviews");
      successfulReadsRef.current.add("reviews");
    } catch (loadError) {
      failedReadsRef.current.add("reviews");
      console.error("Error loading customer review count:", loadError);
      setReviewCountError(
        "We could not check your review eligibility. Please try again."
      );
    } finally {
      setReviewCountLoading(false);
    }
  }, []);

  const loadOrderRequests = useCallback(async (currentUser) => {
    try {
      setRequestsLoading(true);
      setRequestsError("");

      const requestsQuery = query(
        collection(db, "orderRequests"),
        where("customerId", "==", currentUser.uid)
      );

      const snapshot = await getDocs(requestsQuery);

      const requestList = snapshot.docs
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

      setOrderRequests(requestList);
      failedReadsRef.current.delete("requests");
      successfulReadsRef.current.add("requests");
    } catch (loadError) {
      failedReadsRef.current.add("requests");
      console.error("Error loading order requests:", loadError);
      setRequestsError(
        "Unable to load your order requests. Please try again."
      );
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const loadMenuItems = useCallback(async () => {
    try {
      setMenuItemsError("");
      const snapshot = await getDocs(collection(db, "menuItems"));
      setMenuItemsById(
        new Map(
          snapshot.docs.map((menuItemDoc) => [
            menuItemDoc.id,
            { ...menuItemDoc.data(), id: menuItemDoc.id },
          ])
        )
      );
      failedReadsRef.current.delete("menuItems");
      successfulReadsRef.current.add("menuItems");
    } catch (loadError) {
      failedReadsRef.current.add("menuItems");
      console.error("Error loading menu items for order requests:", loadError);
      setMenuItemsError(
        "Menu item details could not be loaded. Showing saved item IDs."
      );
    }
  }, []);

  const loadPaymentData = useCallback(async (currentUser) => {
    try {
      setPaymentDataLoading(true);
      setPaymentDataError("");

      const selectionsQuery = query(
        collection(db, "paymentSelections"),
        where("customerId", "==", currentUser.uid),
      );
      const [selectionSnapshot, paymentRecords] = await Promise.all([
        getDocs(selectionsQuery),
        loadCustomerPaymentHistory(currentUser.uid),
      ]);
      const selectionMap = Object.fromEntries(
        selectionSnapshot.docs.map((selectionDocument) => [
          selectionDocument.id,
          selectionDocument.data(),
        ]),
      );

      setPaymentSelections(selectionMap);
      setPaymentRecordsByOrderId(paymentRecords);
      failedReadsRef.current.delete("paymentData");
      successfulReadsRef.current.add("paymentData");
    } catch (loadError) {
      failedReadsRef.current.add("paymentData");
      console.error("Error loading QR payment history:", loadError);
      setPaymentDataError(
        "Unable to load payment details and history. Please try again.",
      );
    } finally {
      setPaymentDataLoading(false);
    }
  }, []);

  const retryFailedReads = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser || retryInProgressRef.current) return;

    const failedReads = [...failedReadsRef.current];
    if (failedReads.length === 0) return;

    const retryers = {
      orders: () => loadOrders(currentUser),
      reviews: () => loadReviewCount(currentUser),
      requests: () => loadOrderRequests(currentUser),
      menuItems: () => loadMenuItems(),
      paymentData: () => loadPaymentData(currentUser),
    };

    retryInProgressRef.current = true;
    setIsRetryingFailedReads(true);
    try {
      await Promise.all(
        failedReads.map((readKey) => retryers[readKey]?.())
      );
    } finally {
      retryInProgressRef.current = false;
      setIsRetryingFailedReads(false);
    }
  }, [
    loadMenuItems,
    loadOrderRequests,
    loadOrders,
    loadPaymentData,
    loadReviewCount,
  ]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        if (readUserIdRef.current !== currentUser.uid) {
          failedReadsRef.current.clear();
          successfulReadsRef.current.clear();
          readUserIdRef.current = currentUser.uid;
        }

        initialReadsPendingRef.current = true;
        try {
          await Promise.all([
            loadOrders(currentUser),
            loadReviewCount(currentUser),
            loadOrderRequests(currentUser),
            loadMenuItems(),
            loadPaymentData(currentUser),
          ]);
        } finally {
          initialReadsPendingRef.current = false;
          if (retryAfterInitialReadsRef.current) {
            retryAfterInitialReadsRef.current = false;
            await retryFailedReads();
          }
        }
      }
    );

    return () => unsubscribe();
  }, [
    loadMenuItems,
    loadOrderRequests,
    loadOrders,
    loadPaymentData,
    loadReviewCount,
    retryFailedReads,
    navigate,
  ]);

  useEffect(() => {
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOnline(false);
    };

    const handleOnline = () => {
      setIsOnline(true);
      if (!wasOfflineRef.current) return;

      wasOfflineRef.current = false;
      if (initialReadsPendingRef.current) {
        retryAfterInitialReadsRef.current = true;
        return;
      }

      void retryFailedReads();
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [retryFailedReads]);

  useEffect(() => {
    const userId = user?.uid;
    if (!userId) {
      setTabStorageReadyForUser("");
      return;
    }

    let restoredTab = "active";
    try {
      const savedTab = window.localStorage.getItem(
        `${ACTIVE_ORDER_TAB_KEY}:${userId}`
      );
      if (savedTab === "active" || savedTab === "history") {
        restoredTab = savedTab;
      }
    } catch (storageError) {
      console.error("Unable to load the saved order tab:", storageError);
    }

    setActiveOrderTab(restoredTab);
    setTabStorageReadyForUser(userId);
  }, [user?.uid]);

  useEffect(() => {
    const userId = user?.uid;
    if (!userId || tabStorageReadyForUser !== userId) return;

    try {
      window.localStorage.setItem(
        `${ACTIVE_ORDER_TAB_KEY}:${userId}`,
        activeOrderTab
      );
    } catch (storageError) {
      console.error("Unable to save the selected order tab:", storageError);
    }
  }, [activeOrderTab, tabStorageReadyForUser, user?.uid]);

  useEffect(() => {
    const userId = user?.uid;
    setDismissalsLoaded(false);
    setDismissedReviewOrderIds(new Set());
    setReviewPromptStorageError("");

    if (!userId) {
      setDismissalsLoaded(true);
      return;
    }

    try {
      const storedDismissals = window.localStorage.getItem(
        `${REVIEW_PROMPT_DISMISSALS_KEY}:${userId}`
      );
      if (storedDismissals) {
        const parsedDismissals = JSON.parse(storedDismissals);
        if (!Array.isArray(parsedDismissals)) {
          throw new TypeError("Stored review prompt dismissals must be an array.");
        }
        setDismissedReviewOrderIds(
          new Set(parsedDismissals.filter((orderId) => typeof orderId === "string"))
        );
      }
    } catch (storageError) {
      console.error("Unable to load dismissed review prompts:", storageError);
      setReviewPromptStorageError(
        "Your saved review prompt preferences could not be loaded."
      );
    } finally {
      setDismissalsLoaded(true);
    }
  }, [user?.uid]);

  useEffect(() => {
    const userId = user?.uid;
    if (!userId || role !== "customer") return undefined;

    let active = true;
    const markOrderNotificationsAsRead = async () => {
      try {
        const unreadNotificationsQuery = query(
          collection(db, "notifications"),
          where("userId", "==", userId),
          where("type", "==", "order"),
          where("isRead", "==", false),
        );
        const snapshot = await getDocs(unreadNotificationsQuery);
        if (!active || snapshot.empty) return;

        for (let offset = 0; offset < snapshot.docs.length; offset += 500) {
          if (!active) return;
          const batch = writeBatch(db);
          snapshot.docs
            .slice(offset, offset + 500)
            .forEach((notification) => {
              batch.update(notification.ref, { isRead: true });
            });
          await batch.commit();
        }
      } catch (notificationError) {
        console.error(
          "Unable to mark order notifications as read:",
          notificationError,
        );
      }
    };

    markOrderNotificationsAsRead();
    return () => {
      active = false;
    };
  }, [role, user?.uid]);

  const { active: activeOrders, history: orderHistory } = useMemo(
    () => partitionOrders(orders),
    [orders],
  );
  const activeOrderRequests = useMemo(
    () => orderRequests.filter((request) =>
      ["Pending", "Approved"].includes(
        normalizeOrderStatus(request.status, "request"),
      )
    ),
    [orderRequests],
  );
  const declinedOrderRequests = useMemo(
    () => orderRequests.filter((request) =>
      normalizeOrderStatus(request.status, "request") === "Declined"
    ),
    [orderRequests],
  );
  const historyOrderCount = orderHistory.length + declinedOrderRequests.length;
  const visibleOrderCount = activeOrderTab === "history"
    ? historyOrderCount
    : activeOrders.length;
  const visibleOrders = activeOrderTab === "active"
    ? activeOrders
    : orderHistory;
  const hasStaleData = [...failedReadsRef.current].some((readKey) =>
    successfulReadsRef.current.has(readKey)
  );
  const showConnectivityNotice =
    !isOnline || isRetryingFailedReads || hasStaleData;
  const connectivityNotice = showConnectivityNotice && (
    <div className="orders-connectivity-notice" role="status" aria-live="polite">
      <span className="orders-connectivity-indicator" aria-hidden="true" />
      <p>
        {!isOnline
          ? "You're offline. Any order details shown may be out of date."
          : isRetryingFailedReads
            ? "Back online. Retrying only the details that failed to load."
            : "Some order details may be out of date. Use the available retry option if needed."}
      </p>
    </div>
  );

  const completedOrders = useMemo(
    () =>
      orders.filter(
        (order) => normalizeOrderStatus(order.status) === "Completed"
      ),
    [orders]
  );
  const reviewPromptOrder = completedOrders.find(
    (order) => !dismissedReviewOrderIds.has(order.id)
  );
  const showReviewPrompt = Boolean(
    role === "customer"
    && !reviewCountLoading
    && !reviewCountError
    && dismissalsLoaded
    && existingReviewCount !== null
    && completedOrders.length > 0
    && existingReviewCount < completedOrders.length
    && reviewPromptOrder
  );

  const dismissReviewPrompt = (orderId) => {
    const userId = user?.uid;
    if (!userId) return;

    const nextDismissedOrderIds = new Set(dismissedReviewOrderIds);
    nextDismissedOrderIds.add(orderId);
    setDismissedReviewOrderIds(nextDismissedOrderIds);

    try {
      window.localStorage.setItem(
        `${REVIEW_PROMPT_DISMISSALS_KEY}:${userId}`,
        JSON.stringify([...nextDismissedOrderIds])
      );
      setReviewPromptStorageError("");
    } catch (storageError) {
      console.error("Unable to save dismissed review prompt:", storageError);
      setReviewPromptStorageError(
        "Your choice could not be saved and may not persist after reloading."
      );
    }
  };

  const handleRetry = () => {
    const currentUser = auth.currentUser;

    if (currentUser) {
      loadOrders(currentUser);
      loadReviewCount(currentUser);
      loadPaymentData(currentUser);
    }
  };

  const handleReviewCountRetry = () => {
    const currentUser = auth.currentUser;
    if (currentUser) loadReviewCount(currentUser);
  };

  const handlePaymentRetry = () => {
    const currentUser = auth.currentUser;
    if (currentUser) loadPaymentData(currentUser);
  };

  const handleRequestsRetry = () => {
    const currentUser = auth.currentUser;

    if (currentUser) {
      loadOrderRequests(currentUser);
      loadMenuItems();
    }
  };

  const handleReferenceChange = (orderId, value) => {
    setReferenceInputs((current) => ({
      ...current,
      [orderId]: value,
    }));
  };

  const handlePaymentSubmit = async (event, order) => {
    event.preventDefault();
    if (submittingOrderIdsRef.current.has(order.id)) return;

    const reference = referenceInputs[order.id] || "";
    if (!reference.trim() || Array.from(reference.trim()).length > 100) {
      setPaymentFeedback((current) => ({
        ...current,
        [order.id]: {
          type: "error",
          message: "Enter a transaction reference from 1 to 100 characters.",
        },
      }));
      return;
    }

    submittingOrderIdsRef.current.add(order.id);
    setSubmittingOrderIds(new Set(submittingOrderIdsRef.current));
    setPaymentFeedback((current) => ({
      ...current,
      [order.id]: null,
    }));

    try {
      const attemptNumber = await submitQrPaymentReference(order, reference);
      setReferenceInputs((current) => ({
        ...current,
        [order.id]: "",
      }));
      setPaymentFeedback((current) => ({
        ...current,
        [order.id]: {
          type: "success",
          message: `Reference submitted as attempt ${attemptNumber}. Your payment is awaiting administrator review.`,
        },
      }));
      const currentUser = auth.currentUser;
      if (currentUser) await loadPaymentData(currentUser);
    } catch (submitError) {
      console.error("Error submitting QR payment reference:", submitError);
      setPaymentFeedback((current) => ({
        ...current,
        [order.id]: {
          type: "error",
          message: submitError instanceof Error
            ? submitError.message
            : "Unable to submit your reference. Please try again.",
        },
      }));
    } finally {
      submittingOrderIdsRef.current.delete(order.id);
      setSubmittingOrderIds(new Set(submittingOrderIdsRef.current));
    }
  };

  const requestGroups = [
    { status: "pending", label: "Pending" },
    { status: "approved", label: "Approved" },
  ];

  if (loading && orders.length === 0) {
    return (
      <main className="my-orders-page">
        <section
          className="my-orders-container"
          role="status"
          aria-busy="true"
          aria-label="Loading your orders"
        >
          {connectivityNotice}
          <div className="orders-skeleton-header" aria-hidden="true" />

          {[1, 2, 3].map((item) => (
            <div className="orders-skeleton-card" key={item} aria-hidden="true">
              <div className="orders-skeleton-card-heading">
                <div className="skeleton-line skeleton-short" />
                <div className="skeleton-line skeleton-status" />
              </div>
              <div className="skeleton-line skeleton-medium" />
              <div className="skeleton-details">
                <div className="skeleton-block" />
                <div className="skeleton-block" />
              </div>
              <div className="skeleton-line skeleton-total" />
            </div>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="my-orders-page">
      <section className="my-orders-container">
        <header className="my-orders-header">
          <div>
            <p className="orders-eyebrow">CACTUS CAFE</p>

            <h1>My orders</h1>

            <p>
              Track your cafe orders and view your order
              history in one place.
            </p>
          </div>

          <div className="my-orders-header-actions">
            <button
              type="button"
              className="browse-menu-button"
              onClick={() => navigate("/menu")}
            >
              Browse Menu
            </button>
            <button
              type="button"
              className="my-orders-back-button"
              onClick={() => navigate("/customer")}
            >
              ← Back to dashboard
            </button>
          </div>
        </header>

        {connectivityNotice}

        {error && (
          <div className="my-orders-error" role="alert">
            <div className="error-icon">!</div>

            <div>
              <strong>We could not load your orders</strong>
              <p>{error}</p>
            </div>

            <button type="button" onClick={handleRetry}>
              Try again
            </button>
          </div>
        )}

        {paymentDataError && (
          <div className="my-orders-error payment-load-error" role="alert">
            <div className="error-icon">!</div>
            <div>
              <strong>We could not load payment history</strong>
              <p>{paymentDataError}</p>
            </div>
            <button type="button" onClick={handlePaymentRetry}>
              Try again
            </button>
          </div>
        )}

        {(orders.length > 0 || !error) && (
          <>
            {orders.length > 0 && (
              <section className="orders-overview">
                <div className="overview-item">
                  <span>Total orders</span>
                  <strong>{orders.length}</strong>
                </div>

                <div className="overview-item">
                  <span>Active orders</span>
                  <strong>{activeOrders.length}</strong>
                </div>
              </section>
            )}

            {reviewCountError && completedOrders.length > 0 && (
              <div className="my-orders-error review-prompt-error" role="alert">
                <div className="error-icon">!</div>
                <div>
                  <strong>We could not check your review eligibility</strong>
                  <p>{reviewCountError}</p>
                </div>
                <button type="button" onClick={handleReviewCountRetry}>
                  Try again
                </button>
              </div>
            )}

            {reviewPromptStorageError && (
              <p className="review-prompt-storage-error" role="alert">
                {reviewPromptStorageError}
              </p>
            )}

            {showReviewPrompt && reviewPromptOrder && (
              <aside
                className="review-prompt"
                aria-labelledby="review-prompt-title"
              >
                <div className="review-prompt-copy">
                  <p className="orders-eyebrow">YOUR FEEDBACK</p>
                  <h2 id="review-prompt-title">
                    How was the menu? Give us an honest review!
                  </h2>
                  <p>
                    You completed an order. Share your feedback to help us
                    improve.
                  </p>
                </div>
                <div className="review-prompt-actions">
                  <Link className="review-prompt-primary" to="/my-reviews">
                    Leave a Review
                  </Link>
                  <button
                    type="button"
                    className="review-prompt-secondary"
                    onClick={() => dismissReviewPrompt(reviewPromptOrder.id)}
                  >
                    Maybe Later
                  </button>
                </div>
              </aside>
            )}

            <section className="orders-list">
              <div className="orders-list-heading">
                <div>
                  <p className="orders-eyebrow">ORDER ACTIVITY</p>
                  <h2>
                    {activeOrderTab === "active"
                      ? "Active Orders"
                      : "Order History"}
                  </h2>
                </div>

                <span className="orders-count">
                  {visibleOrderCount}{" "}
                  {visibleOrderCount === 1 ? "order" : "orders"}
                </span>
              </div>

              <div className="order-tabs" role="tablist" aria-label="Order categories">
                <button
                  type="button"
                  role="tab"
                  id="active-orders-tab"
                  aria-controls="orders-tab-panel"
                  aria-selected={activeOrderTab === "active"}
                  className={activeOrderTab === "active"
                    ? "order-tab is-selected"
                    : "order-tab"}
                  onClick={() => setActiveOrderTab("active")}
                >
                  <span>Active Orders</span>
                  <span className="order-tab-count">{activeOrders.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="order-history-tab"
                  aria-controls="orders-tab-panel"
                  aria-selected={activeOrderTab === "history"}
                  className={activeOrderTab === "history"
                    ? "order-tab is-selected"
                    : "order-tab"}
                  onClick={() => setActiveOrderTab("history")}
                >
                  <span>Order History</span>
                  <span className="order-tab-count">{historyOrderCount}</span>
                </button>
              </div>

              <div
                id="orders-tab-panel"
                className="orders-tab-panel"
                role="tabpanel"
                aria-labelledby={activeOrderTab === "active"
                  ? "active-orders-tab"
                  : "order-history-tab"}
              >
                {visibleOrderCount === 0 && (
                  <section className="orders-tab-empty">
                    <h3>
                      {orders.length === 0
                        ? "No orders yet"
                        : activeOrderTab === "active"
                          ? "No active orders right now"
                          : "No orders in history yet"}
                    </h3>
                    <p>
                      {orders.length === 0
                        ? "Your orders will appear here once they are approved. Requests awaiting cafe review remain in Order requests."
                        : activeOrderTab === "active"
                          ? "Your past orders are still available in Order History."
                          : "Your current orders will appear in Active Orders."}
                    </p>
                    <div className="orders-tab-empty-actions">
                      {activeOrderTab === "active" && historyOrderCount > 0 && (
                        <button
                          type="button"
                          className="order-empty-switch"
                          onClick={() => setActiveOrderTab("history")}
                        >
                          View Order History ({historyOrderCount})
                        </button>
                      )}
                      {activeOrderTab === "history" && activeOrders.length > 0 && (
                        <button
                          type="button"
                          className="order-empty-switch"
                          onClick={() => setActiveOrderTab("active")}
                        >
                          View Active Orders ({activeOrders.length})
                        </button>
                      )}
                      <button
                        type="button"
                        className="browse-menu-button"
                        onClick={() => navigate("/menu")}
                      >
                        Browse Menu
                      </button>
                    </div>
                  </section>
                )}

                {activeOrderTab === "history" &&
                  declinedOrderRequests.map((request) => {
                    const rejectionReason = getDeclineReason(request)
                      || "The cafe declined this order request.";

                    return (
                      <article
                        className="order-card declined-order-request"
                        key={`declined-request-${request.id}`}
                      >
                        <div className="order-card-header">
                          <div className="order-card-primary">
                            <div className="order-request-reference">
                              <span>ORDER REQUEST ID</span>
                              <code>{request.id}</code>
                            </div>
                            <p className="order-date">
                              Submitted {formatDate(request.createdAt)}
                            </p>
                          </div>

                          <div className="order-card-badges">
                            <span className="order-type-badge">
                              {formatOrderType(request.orderType)}
                            </span>
                            <span className="order-status status-declined">
                              <span className="status-indicator" />
                              Declined
                            </span>
                          </div>
                        </div>

                        <div className="request-rejection declined-order-reason">
                          <strong>Reason from the cafe</strong>
                          <p>{rejectionReason}</p>
                        </div>
                      </article>
                    );
                  })}

                {visibleOrders.map((order) => {
                const normalizedStatus = normalizeOrderStatus(
                  order.status
                );
                const gracePeriod = getDeliveryGracePeriod(order, currentTime);
                const deliveryProofUrl = normalizeDeliveryProofUrl(
                  order.deliveryProofUrl,
                );
                const {
                  itemsSubtotal,
                  deliveryFee,
                  isDelivery,
                  waitingFee,
                  totalPayment,
                } = getOrderCostBreakdown(order);
                const paymentSelection = paymentSelections[order.id];
                const isEligibleQrOrder = Boolean(
                  order.customerId === user?.uid
                  && order.requestId === order.id
                  && paymentSelection?.requestId === order.id
                  && paymentSelection?.customerId === user?.uid
                  && paymentSelection?.method === "qr"
                  && ["advance", "pay_later"].includes(
                    paymentSelection?.timing,
                  ),
                );
                const paymentRecord = paymentRecordsByOrderId[order.id];
                const paymentSubmissions = paymentRecord?.submissions || [];
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
                const hasCheckoutPaymentProof = Boolean(
                  order.paymentReference && order.paymentProofUrl,
                );
                const paymentStatusRecord = hasCheckoutPaymentData
                  ? order
                  : paymentRecord || null;
                const paymentStatus = paymentStatusRecord?.paymentStatus;
                const paymentGuidance = paymentStatus === "paid"
                  ? "Your payment has been confirmed in GCash."
                  : paymentStatus === "needs_review"
                    || paymentStatus === "admin_review_required"
                    ? "Your payment needs further review. Please contact the cafe if you need an update."
                    : paymentStatus === "rejected"
                      ? "This payment could not be verified. Please contact the cafe before placing another payment."
                      : paymentStatus === "pending_verification"
                        || paymentStatus === "pending_review"
                        || hasCheckoutPaymentProof
                        ? "Your GCash reference is awaiting confirmation that the funds were received."
                        : "QR payment is selected for this order. Use the cafe's payment instructions, then submit your transaction reference below.";
                const canSubmitReference = Boolean(
                  !hasCheckoutPaymentProof
                  && !paymentDataLoading
                  && !paymentDataError
                  && (
                    !paymentRecord
                    || (
                      paymentRecord.paymentStatus === "rejected"
                      && [1, 2].includes(paymentRecord.attemptCount)
                    )
                  ),
                );
                const paymentFeedbackForOrder = paymentFeedback[order.id];
                const isSubmitting = submittingOrderIds.has(order.id);

                return (
                  <article
                    className="order-card"
                    key={order.id}
                  >
                    <div className="order-card-header">
                      <div className="order-card-primary">
                        <div className="order-request-reference">
                          <span>ORDER ID</span>
                          <code>{order.id}</code>
                        </div>
                        <p className="order-date">
                          Submitted {formatDate(order.createdAt)}
                        </p>
                      </div>

                      <div className="order-card-badges">
                        <span className="order-type-badge">
                          {formatOrderType(order.orderType)}
                        </span>
                        <span
                          className={`order-status status-${getStatusClass(
                            order.status
                          )}`}
                        >
                          <span className="status-indicator" />
                          {normalizedStatus}
                        </span>
                      </div>
                    </div>

                    <OrderStatusTracker
                      status={order.status}
                      orderType={order.orderType}
                      rejectionReason={getDeclineReason(order)}
                      unreachableReason={order.unreachableReason}
                    />

                    {isDelivery
                      && normalizedStatus === "Out for Delivery"
                      && gracePeriod && (
                        <p
                          className="customer-delivery-grace-status"
                          role="status"
                        >
                          {gracePeriod.elapsed
                            ? "The rider’s 10-minute waiting period has elapsed."
                            : `Rider arrived. Grace time remaining: ${formatDeliveryGraceRemaining(
                              gracePeriod.remainingMs,
                            )}.`}
                        </p>
                      )}

                    <div className="order-summary-grid">
                      <div>
                        <span>Items</span>
                        <strong>
                          {order.items?.reduce(
                            (total, item) =>
                              total +
                              Number(item.quantity || 0),
                            0
                          ) || 0}
                        </strong>
                      </div>

                      <div>
                        <span>
                          {order.paymentMethod === "cash"
                            && order.cashPaymentStatus !== "paid"
                            ? "Cash due on delivery"
                            : "Total payment"}
                        </span>
                        <strong className="order-total">
                          {formatPrice(totalPayment)}
                        </strong>
                      </div>
                    </div>

                    <section
                      className="order-cost-breakdown"
                      aria-label={`Cost breakdown for order ${order.id}`}
                    >
                      <h3>Cost breakdown</h3>
                      <dl>
                        <div>
                          <dt>Items subtotal</dt>
                          <dd>{formatPrice(itemsSubtotal)}</dd>
                        </div>
                        {isDelivery && (
                          <div>
                            <dt>Delivery fee</dt>
                            <dd>{formatPrice(deliveryFee)}</dd>
                          </div>
                        )}
                        {waitingFee > 0 && (
                          <div>
                            <dt>Waiting fee</dt>
                            <dd>{formatPrice(waitingFee)}</dd>
                          </div>
                        )}
                        <div className="order-cost-breakdown-total">
                          <dt>
                            {order.paymentMethod === "cash"
                              && order.cashPaymentStatus !== "paid"
                              ? "Cash due on delivery"
                              : "Total payment"}
                          </dt>
                          <dd>{formatPrice(totalPayment)}</dd>
                        </div>
                      </dl>
                    </section>

                    {deliveryProofUrl && (
                      <section
                        className="customer-delivery-proof-panel"
                        aria-label="Proof of Delivery"
                      >
                        <h3>Proof of Delivery</h3>
                        <CustomerDeliveryProof proofUrl={deliveryProofUrl} />
                      </section>
                    )}

                    {isEligibleQrOrder && (
                      <section
                        className="qr-payment-panel"
                        aria-label={`QR payment details for order ${order.id}`}
                      >
                        <div className="qr-payment-heading">
                          <div>
                            <p className="orders-eyebrow">QR PAYMENT</p>
                            <h4>Payment details and history</h4>
                          </div>
                          <span
                            className={`payment-status payment-status-${
                              paymentDataLoading && !hasCheckoutPaymentData
                                ? "loading"
                                : getPaymentStatusClass(paymentStatusRecord)
                            }`}
                          >
                            {paymentDataLoading && !hasCheckoutPaymentData ? (
                              <span className="payment-status-skeleton" aria-hidden="true" />
                            ) : paymentDataError && !hasCheckoutPaymentData
                                ? "Payment status unavailable"
                            : getPaymentStatusLabel(paymentStatusRecord)}
                          </span>
                        </div>

                        <dl className="qr-payment-details">
                          <div>
                            <dt>Order ID</dt>
                            <dd><code>{order.id}</code></dd>
                          </div>
                          <div>
                            <dt>Payment method</dt>
                            <dd>QR Payment</dd>
                          </div>
                          <div>
                            <dt>Timing</dt>
                            <dd>
                              {PAYMENT_TIMING_LABELS[paymentSelection.timing]}
                            </dd>
                          </div>
                          <div>
                            <dt>Amount due</dt>
                            <dd>
                              {formatPrice(
                                paymentRecord
                                  ? paymentRecord.amountDue / 100
                                  : order.total,
                              )}
                            </dd>
                          </div>
                          {order.paymentReference && (
                            <div>
                              <dt>GCash reference number</dt>
                              <dd>{order.paymentReference}</dd>
                            </div>
                          )}
                          {order.paymentProofUrl && (
                            <div>
                              <dt>Receipt screenshot</dt>
                              <dd>
                                <a
                                  href={order.paymentProofUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <img
                                    className="checkout-payment-proof-thumbnail"
                                    src={order.paymentProofUrl}
                                    alt="Uploaded GCash payment receipt"
                                  />
                                  View receipt
                                </a>
                              </dd>
                            </div>
                          )}
                        </dl>

                        <p className="qr-payment-guidance">
                          {paymentGuidance}
                        </p>

                        {paymentRecord?.paymentStatus ===
                          "admin_review_required" && (
                          <div className="admin-review-notice" role="status">
                            Three submissions have been rejected. An
                            administrator must review this payment; another
                            reference cannot be submitted.
                          </div>
                        )}

                        {paymentRecord?.resolutionReason && (
                          <div className="payment-resolution-reason">
                            <strong>Administrator resolution</strong>
                            <p>{paymentRecord.resolutionReason}</p>
                          </div>
                        )}

                        {paymentRecord?.resolvedAt && (
                          <p className="payment-verified-date">
                            Final decision recorded{" "}
                            {formatDate(paymentRecord.resolvedAt)} by an
                            administrator.
                          </p>
                        )}

                        {paymentRecord?.verifiedAt && (
                          <p className="payment-verified-date">
                            Verified {formatDate(paymentRecord.verifiedAt)}
                          </p>
                        )}

                        <div className="payment-history">
                          <h5>Submission history</h5>
                          {paymentDataLoading ? (
                            <div
                              className="payment-history-skeleton"
                              role="status"
                              aria-label="Loading payment history"
                              aria-busy="true"
                            >
                              {[1, 2].map((item) => (
                                <div className="payment-history-skeleton-row" key={item} aria-hidden="true">
                                  <span />
                                  <span />
                                </div>
                              ))}
                            </div>
                          ) : paymentDataError ? (
                            <p className="payment-history-empty" role="alert">
                              Payment history is unavailable.
                            </p>
                          ) : paymentSubmissions.length === 0 ? (
                            <p className="payment-history-empty">
                              {hasCheckoutPaymentProof
                                ? "Your checkout reference is awaiting staff verification."
                                : "No transaction references submitted yet."}
                            </p>
                          ) : (
                            <ol className="payment-attempt-list">
                              {paymentSubmissions.map((submission) => (
                                <li
                                  className="payment-attempt"
                                  key={submission.id}
                                >
                                  <div className="payment-attempt-header">
                                    <strong>
                                      Attempt {submission.attemptNumber}
                                    </strong>
                                    <span
                                      className={`attempt-decision attempt-decision-${
                                        submission.status || "unknown"
                                      }`}
                                    >
                                      {submission.status === "verified"
                                        ? "Verified"
                                        : submission.status === "rejected"
                                          ? "Rejected"
                                          : "Awaiting review"}
                                    </span>
                                  </div>
                                  <dl className="payment-attempt-details">
                                    <div>
                                      <dt>Reference number</dt>
                                      <dd>{submission.referenceNumber}</dd>
                                    </div>
                                    <div>
                                      <dt>Submitted</dt>
                                      <dd>
                                        {formatDate(submission.submittedAt)}
                                      </dd>
                                    </div>
                                    {submission.reviewedAt && (
                                      <div>
                                        <dt>Decision date</dt>
                                        <dd>
                                          {formatDate(submission.reviewedAt)}
                                        </dd>
                                      </div>
                                    )}
                                    {submission.reviewedBy && (
                                      <div>
                                        <dt>Reviewed by</dt>
                                        <dd>Administrator</dd>
                                      </div>
                                    )}
                                  </dl>
                                  {submission.rejectionReason && (
                                    <p className="payment-rejection-reason">
                                      <strong>Rejection reason:</strong>{" "}
                                      {submission.rejectionReason}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>

                        {!hasCheckoutPaymentProof && (
                          <div className="receipt-prototype" aria-disabled="true">
                            PROTOTYPE ONLY — Receipt image upload is not
                            available.
                          </div>
                        )}

                        {paymentFeedbackForOrder && (
                          <p
                            className={`payment-feedback payment-feedback-${
                              paymentFeedbackForOrder.type
                            }`}
                            role={
                              paymentFeedbackForOrder.type === "error"
                                ? "alert"
                                : "status"
                            }
                          >
                            {paymentFeedbackForOrder.message}
                          </p>
                        )}

                        {canSubmitReference && (
                          <form
                            className="qr-reference-form"
                            onSubmit={(event) =>
                              handlePaymentSubmit(event, order)
                            }
                          >
                            <label htmlFor={`qr-reference-${order.id}`}>
                              Transaction reference number
                            </label>
                            <div className="qr-reference-controls">
                              <input
                                id={`qr-reference-${order.id}`}
                                type="text"
                                value={referenceInputs[order.id] || ""}
                                onChange={(event) =>
                                  handleReferenceChange(
                                    order.id,
                                    event.target.value,
                                  )
                                }
                                maxLength={100}
                                autoComplete="off"
                                aria-describedby={`qr-reference-help-${order.id}`}
                                placeholder="Enter your payment reference"
                                disabled={isSubmitting}
                              />
                              <button
                                type="submit"
                                disabled={
                                  isSubmitting
                                  || !referenceInputs[order.id]?.trim()
                                }
                              >
                                {isSubmitting
                                  ? "Submitting..."
                                  : paymentRecord
                                    ? "Submit new reference"
                                    : "Submit reference"}
                              </button>
                            </div>
                            <p
                              className="qr-reference-help"
                              id={`qr-reference-help-${order.id}`}
                            >
                              You can submit up to three references. A new
                              attempt is available only after an administrator
                              rejects the current one.
                            </p>
                          </form>
                        )}
                      </section>
                    )}

                    <details className="order-details">
                      <summary>View order details</summary>

                      <div className="details-content">
                        <div className="details-section">
                          <h4>Items</h4>

                          <div className="order-items">
                            {order.items?.map((item, index) => (
                              <div
                                className="order-item"
                                key={`${order.id}-${index}`}
                              >
                                <div>
                                  <strong>
                                    {getOrderItemName(item)}
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
                            ))}
                          </div>
                        </div>

                        <div className="details-section">
                          <h4>Customer information</h4>

                          <div className="customer-details">
                            <p>
                              <span>Name</span>
                              <strong>
                                {order.customerName ||
                                  "Not available"}
                              </strong>
                            </p>

                            <p>
                              <span>Contact</span>
                              <strong>
                                {order.phone || "Not available"}
                              </strong>
                            </p>
                          </div>
                        </div>

                        {order.orderType === "delivery" &&
                          order.address && (
                            <div className="details-section">
                              <h4>Delivery address</h4>
                              <p className="address-text">
                                {order.address}
                              </p>
                            </div>
                          )}

                        {order.notes && (
                          <div className="details-section">
                            <h4>Order notes</h4>
                            <p className="notes-text">
                              {order.notes}
                            </p>
                          </div>
                        )}

                        <div className="details-total">
                          <span>
                            {order.paymentMethod === "cash"
                              && order.cashPaymentStatus !== "paid"
                              ? "Cash due on delivery"
                              : "Total payment"}
                          </span>
                          <strong>
                            {formatPrice(totalPayment)}
                          </strong>
                        </div>
                      </div>
                    </details>
                  </article>
                );
                })}
              </div>
            </section>
          </>
        )}

        <section
          className="request-history"
          aria-labelledby="request-history-title"
          hidden={activeOrderTab === "history"}
        >
          <div className="request-history-heading">
            <div>
              <p className="orders-eyebrow">AWAITING CAFE REVIEW</p>
              <h2 id="request-history-title">Order requests</h2>
            </div>
            {!requestsLoading && !requestsError && (
              <span className="orders-count">
                {activeOrderRequests.length}{" "}
                {activeOrderRequests.length === 1 ? "request" : "requests"}
              </span>
            )}
          </div>

          {requestsLoading && (
            <div
              className="order-request-skeleton-list"
              role="status"
              aria-label="Loading order requests"
              aria-busy="true"
            >
              {[1, 2, 3].map((item) => (
                <div className="order-request-skeleton-row" key={item} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          )}

          {requestsError && (
            <div className="my-orders-error" role="alert">
              <div className="error-icon">!</div>

              <div>
                <strong>We could not load your order requests</strong>
                <p>{requestsError}</p>
              </div>

              <button type="button" onClick={handleRequestsRetry}>
                Try again
              </button>
            </div>
          )}

          {!requestsLoading
            && !requestsError
            && activeOrderRequests.length === 0 && (
            <div className="request-state request-empty">
              No requests awaiting cafe review. Declined requests appear in
              Order History.
            </div>
          )}

          {!requestsLoading
            && !requestsError
            && activeOrderRequests.length > 0 && (
            <div className="request-groups">
              {requestGroups.map((group) => {
                const requests = activeOrderRequests.filter(
                  (request) =>
                    normalizeOrderStatus(request.status, "request").toLowerCase()
                    === group.status
                );

                return (
                  <section
                    className="request-group"
                    key={group.status}
                    aria-labelledby={`request-group-${group.status}`}
                  >
                    <div className="request-group-heading">
                      <h3 id={`request-group-${group.status}`}>
                        {group.label}
                      </h3>
                      <span className="request-group-count">
                        {requests.length}
                      </span>
                    </div>

                    {requests.length === 0 ? (
                      <p className="request-group-empty">
                        No {group.status} requests.
                      </p>
                    ) : (
                      <div className="request-cards">
                        {requests.map((request) => (
                          <article className="request-card" key={request.id}>
                            <div className="request-card-header">
                              <div>
                                <div className="order-request-reference">
                                  <span>ORDER REQUEST ID</span>
                                  <code>{request.id}</code>
                                </div>
                                <p className="order-date">
                                  Submitted {formatDate(request.createdAt)}
                                </p>
                                <p className="order-customer-reference">
                                  <span>Customer ID</span>
                                  <code>{request.customerId || "Not available"}</code>
                                </p>
                              </div>
                              <span
                                className={`request-status request-status-${group.status}`}
                              >
                                {group.label}
                              </span>
                            </div>

                            <RequestItemsSection
                              request={request}
                              menuItemsById={menuItemsById}
                              menuItemsError={menuItemsError}
                              isExpanded={expandedRequestIds.has(request.id)}
                              onToggle={() => toggleRequestItems(request.id)}
                            />

                            {group.status === "rejected" &&
                              request.rejectionReason && (
                                <div className="request-rejection">
                                  <strong>Reason from the cafe</strong>
                                  <p>{request.rejectionReason}</p>
                                </div>
                              )}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export default MyOrders;