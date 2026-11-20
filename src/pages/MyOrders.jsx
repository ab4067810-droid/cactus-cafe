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
import "../styles/MyOrders.css";

const BASE_STATUS_STEPS = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready",
  "Completed",
];

const REVIEW_PROMPT_DISMISSALS_KEY = "cactus-cafe:dismissed-review-orders";

const normalizeStatus = (status) => {
  const value = String(status || "Pending")
    .trim()
    .toLowerCase();

  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("complete")) return "Completed";
  if (value.includes("out for delivery")) return "Out for Delivery";
  if (value === "delivered") return "Completed";
  if (value.includes("ready")) return "Ready";
  if (value.includes("prepar")) return "Preparing";
  if (value.includes("confirm")) return "Confirmed";

  return "Pending";
};

const getStatusClass = (status) =>
  normalizeStatus(status).toLowerCase().replace(/\s+/g, "-");

const getStatusSteps = (orderType, status) => {
  const normalizedOrderType = String(orderType || "").trim().toLowerCase();
  const normalizedStatus = normalizeStatus(status);
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

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Date unavailable";
  }

  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

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
  if (record.paymentStatus === "pending_review") {
    return "Awaiting administrator review";
  }
  if (record.paymentStatus === "admin_review_required") {
    return "Administrator review required";
  }
  if (record.paymentStatus === "paid") return "Paid — verified";
  if (
    record.paymentStatus === "rejected"
    && record.attemptCount >= 3
    && record.resolvedAt
  ) {
    return "Finally rejected";
  }
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

function OrderStatusTracker({ status, orderType }) {
  const normalizedStatus = normalizeStatus(status);

  if (normalizedStatus === "Cancelled") {
    return (
      <div className="cancelled-message">
        <span className="status-symbol">×</span>
        <div>
          <strong>Order cancelled</strong>
          <p>This order is no longer being prepared.</p>
        </div>
      </div>
    );
  }

  const statusSteps = getStatusSteps(orderType, normalizedStatus);
  const currentIndex = statusSteps.indexOf(normalizedStatus);

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
  const [loading, setLoading] = useState(true);
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
    } catch (loadError) {
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
    } catch (loadError) {
      console.error("Error loading customer review count:", loadError);
      setExistingReviewCount(null);
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
    } catch (loadError) {
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
    } catch (loadError) {
      console.error("Error loading menu items for order requests:", loadError);
      setMenuItemsById(new Map());
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
    } catch (loadError) {
      console.error("Error loading QR payment history:", loadError);
      setPaymentDataError(
        "Unable to load payment details and history. Please try again.",
      );
    } finally {
      setPaymentDataLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        await Promise.all([
          loadOrders(currentUser),
          loadReviewCount(currentUser),
          loadOrderRequests(currentUser),
          loadMenuItems(),
          loadPaymentData(currentUser),
        ]);
      }
    );

    return () => unsubscribe();
  }, [
    loadMenuItems,
    loadOrderRequests,
    loadOrders,
    loadPaymentData,
    loadReviewCount,
    navigate,
  ]);

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

  const activeOrders = useMemo(
    () =>
      orders.filter((order) => {
        const status = normalizeStatus(order.status);

        return (
          status !== "Completed" &&
          status !== "Cancelled"
        );
      }),
    [orders]
  );

  const completedOrders = useMemo(
    () =>
      orders.filter(
        (order) => normalizeStatus(order.status) === "Completed"
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
    { status: "rejected", label: "Rejected" },
  ];

  if (loading) {
    return (
      <main className="my-orders-page">
        <section
          className="my-orders-container"
          aria-busy="true"
          aria-label="Loading your orders"
        >
          <p className="orders-loading-status" role="status">
            Loading your orders...
          </p>

          <div className="orders-skeleton-header" aria-hidden="true" />

          <div className="orders-skeleton-card" aria-hidden="true">
            <div className="skeleton-line skeleton-short" />
            <div className="skeleton-line skeleton-medium" />
            <div className="skeleton-block" />
          </div>

          <div className="orders-skeleton-card" aria-hidden="true">
            <div className="skeleton-line skeleton-short" />
            <div className="skeleton-line skeleton-medium" />
            <div className="skeleton-block" />
          </div>
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

          <button
            type="button"
            className="my-orders-back-button"
            onClick={() => navigate("/customer")}
          >
            ← Back to dashboard
          </button>
        </header>

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

        <section
          className="request-history"
          aria-labelledby="request-history-title"
        >
          <div className="request-history-heading">
            <div>
              <p className="orders-eyebrow">AWAITING CAFE REVIEW</p>
              <h2 id="request-history-title">Order requests</h2>
            </div>
            {!requestsLoading && !requestsError && (
              <span className="orders-count">
                {orderRequests.length}{" "}
                {orderRequests.length === 1 ? "request" : "requests"}
              </span>
            )}
          </div>

          {requestsLoading && (
            <p className="request-state" role="status" aria-busy="true">
              Loading your order requests...
            </p>
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

          {!requestsLoading && !requestsError && orderRequests.length === 0 && (
            <div className="request-state request-empty">
              No order requests yet. Requests you submit will appear here
              while the cafe reviews them.
            </div>
          )}

          {!requestsLoading && !requestsError && orderRequests.length > 0 && (
            <div className="request-groups">
              {requestGroups.map((group) => {
                const requests = orderRequests.filter(
                  (request) =>
                    String(request.status || "").trim().toLowerCase() ===
                    group.status
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

        {!error && orders.length === 0 && (
          <section className="no-orders">
            <div className="empty-icon" aria-hidden="true">
              <svg
                viewBox="0 0 32 32"
                width="32"
                height="32"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 13h16l-1.5 13h-13L8 13Z" />
                <path d="m12 13 4-7 4 7M12.5 18v3M16 18v3M19.5 18v3" />
              </svg>
            </div>

            <p className="orders-eyebrow">YOUR ORDER HISTORY</p>

            <h2>No orders yet</h2>

            <p>
              Your completed and current orders will appear here
              after you order from Cactus Cafe.
            </p>

            <button
              type="button"
              className="browse-menu-button"
              onClick={() => navigate("/menu")}
            >
              Browse the menu
            </button>
          </section>
        )}

        {!error && orders.length > 0 && (
          <>
            <section className="orders-overview">
              <div className="overview-item">
                <span>Total orders</span>
                <strong>{orders.length}</strong>
              </div>

              <div className="overview-divider" />

              <div className="overview-item">
                <span>Active orders</span>
                <strong>{activeOrders.length}</strong>
              </div>

              <button
                type="button"
                className="overview-action"
                onClick={() => navigate("/menu")}
              >
                Order something new <span>↗</span>
              </button>
            </section>

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
                  <h2>Your recent orders</h2>
                </div>

                <span className="orders-count">
                  {orders.length}{" "}
                  {orders.length === 1 ? "order" : "orders"}
                </span>
              </div>

              {orders.map((order) => {
                const normalizedStatus = normalizeStatus(
                  order.status
                );
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
                const canSubmitReference = Boolean(
                  !paymentDataLoading
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
                      <div>
                        <div className="order-request-reference">
                          <span>ORDER REQUEST ID</span>
                          <code>{order.id}</code>
                        </div>
                        <p className="order-date">
                          Submitted {formatDate(order.createdAt)}
                        </p>
                        <p className="order-customer-reference">
                          <span>Customer ID</span>
                          <code>{order.customerId || "Not available"}</code>
                        </p>
                      </div>

                      <span
                        className={`order-status status-${getStatusClass(
                          order.status
                        )}`}
                      >
                        <span className="status-indicator" />
                        {normalizedStatus}
                      </span>
                    </div>

                    <OrderStatusTracker
                      status={order.status}
                      orderType={order.orderType}
                    />

                    <div className="order-summary-grid">
                      <div>
                        <span>Order type</span>
                        <strong>
                          {formatOrderType(order.orderType)}
                        </strong>
                      </div>

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
                        <span>Total</span>
                        <strong className="order-total">
                          {formatPrice(order.total)}
                        </strong>
                      </div>
                    </div>

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
                              paymentDataLoading
                                ? "loading"
                                : getPaymentStatusClass(paymentRecord)
                            }`}
                          >
                            {paymentDataLoading
                              ? "Loading payment status..."
                              : paymentDataError
                                ? "Payment status unavailable"
                                : getPaymentStatusLabel(paymentRecord)}
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
                        </dl>

                        <p className="qr-payment-guidance">
                          QR payment is selected for this order. Use the
                          payment instructions provided by the cafe, then
                          submit your transaction reference below.
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
                            <p className="payment-history-empty" role="status">
                              Loading payment history...
                            </p>
                          ) : paymentDataError ? (
                            <p className="payment-history-empty" role="alert">
                              Payment history is unavailable.
                            </p>
                          ) : paymentSubmissions.length === 0 ? (
                            <p className="payment-history-empty">
                              No transaction references submitted yet.
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

                        <div className="receipt-prototype" aria-disabled="true">
                          PROTOTYPE ONLY — Receipt image upload is not
                          available.
                        </div>

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
                          <span>Order total</span>
                          <strong>
                            {formatPrice(order.total)}
                          </strong>
                        </div>
                      </div>
                    </details>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

export default MyOrders;