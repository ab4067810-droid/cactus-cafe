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
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { NavLink, useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import { listBlockedPhones } from "../services/blockedPhoneService";
import PhoneBlockControl from "../components/PhoneBlockControl";
import { approveOrderRequest } from "../services/orderApprovalService";
import {
  createCustomerNotification,
  updateStatusWithNotification,
} from "../services/notificationService";
import { getApprovalPricing } from "../utils/approvalPricing";
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
  return `Expected flow: ${steps.join(" > ")} (or Cancelled).`;
};

const getTotal = (order) => {
  if (order.totalPrice !== undefined) {
    return Number(order.totalPrice) || 0;
  }

  if (order.total !== undefined) {
    return Number(order.total) || 0;
  }

  if (Array.isArray(order.items)) {
    return order.items.reduce(
      (sum, item) =>
        sum +
        Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
  }

  return 0;
};

function AdminOrders() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [orderRequests, setOrderRequests] = useState([]);
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
  const [approvalDialogRequest, setApprovalDialogRequest] = useState(null);
  const [approvalDialogLoading, setApprovalDialogLoading] = useState(false);
  const [approvalDialogError, setApprovalDialogError] = useState("");
  const [approvingRequestId, setApprovingRequestId] = useState(null);
  const [rejectingRequestId, setRejectingRequestId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionReasonPreset, setRejectionReasonPreset] = useState("");

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
  const orderRequestsUnsubscribeRef = useRef(null);
  const orderRequestsListenerGenerationRef = useRef(0);

  useEffect(() => {
    const dialog = approvalDialogRef.current;
    if (!dialog) return;

    if (approvalDialogRequest && !dialog.open) {
      dialog.showModal();
    } else if (!approvalDialogRequest && dialog.open) {
      dialog.close();
    }
  }, [approvalDialogRequest]);

  const loadOrders = useCallback(async () => {
    try {
      setError("");

      const ordersSnapshot = await getDocs(
        collection(db, "orders")
      );

      const ordersList = ordersSnapshot.docs
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

      setOrders(ordersList);
      return true;
    } catch (loadError) {
      console.error("Error loading orders:", loadError);
      setError("Unable to load orders. Please try again.");
      return false;
    }
  }, []);

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

        setOrderRequests(requestsList);
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
  }, []);

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

          if (userData.role !== "admin") {
            alert("Access denied. Admin account required.");
            navigate("/customer");
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
        message: (status) => `Your order status is now ${status}.`,
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
    ? getApprovalPricing(approvalDialogRequest, menuItemsById)
    : null;

  const handleConfirmApproval = async () => {
    if (
      !approvalDialogRequest
      || !approvalPricing
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

  if (loading) {
    return (
      <main className="admin-orders-page">
        <section className="admin-orders-loading">
          <div className="loading-icon">📦</div>
          <p className="admin-orders-eyebrow">CACTUS CAFE</p>
          <h1>Loading order workspace</h1>
          <div className="loading-bar" />
        </section>
      </main>
    );
  }

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
          <span className="admin-orders-brand-mark" aria-hidden="true">🌵</span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-orders-sidebar-label">WORKSPACE</div>
        <nav className="admin-orders-nav">
          <NavLink
            to="/admin/menu"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">▦</span>
            <span>Menu Management</span>
          </NavLink>
          <NavLink
            to="/admin/orders"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">↗</span>
            <span>Orders</span>
          </NavLink>
          <NavLink
            to="/admin/payments"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">₱</span>
            <span>Payment Management</span>
          </NavLink>
          <NavLink
            to="/admin/reservations"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">◷</span>
            <span>Reservations</span>
          </NavLink>
          <NavLink
            to="/admin/reviews"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">☆</span>
            <span>Reviews</span>
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">◎</span>
            <span>Customers &amp; Security</span>
          </NavLink>
          <NavLink
            to="/admin/monthly-records"
            className={({ isActive }) =>
              `admin-orders-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-orders-nav-icon" aria-hidden="true">▤</span>
            <span>Monthly Records</span>
          </NavLink>
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
              {blockedPhonesLoading ? "Checking..." : "Try again"}
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
            <div className="request-state" role="status" aria-busy="true">
              Loading customer requests...
            </div>
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
                                  <p
                                    className="request-pricing-state"
                                    role="status"
                                  >
                                    Loading current menu prices...
                                  </p>
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
                                    const canShowTotal =
                                      canCalculateTotal
                                      && Number.isFinite(estimatedTotal);

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
                                            <span>Estimated total</span>
                                            <strong>
                                              {canShowTotal
                                                ? formatPrice(estimatedTotal)
                                                : "Unavailable"}
                                            </strong>
                                          </div>
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
                    </div>

                    {status === "pending" && (
                      <div className="request-pricing">
                        <button
                          type="button"
                          className="request-pricing-toggle"
                          disabled={
                            approvalDialogLoading
                            || Boolean(approvingRequestId || rejectingRequestId)
                          }
                          onClick={() => handleOpenApprovalDialog(request)}
                        >
                          {approvingRequestId === request.id
                            ? "Approving..."
                            : approvalDialogLoading
                              && approvalDialogRequest?.id === request.id
                              ? "Loading current prices..."
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

              {approvalDialogLoading && (
                <p className="request-pricing-state" role="status">
                  Loading current menu prices...
                </p>
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
                        TOTAL
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
                        order.paymentMethod) && (
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
                                {order.paymentMethod}
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
                        <span>Order total</span>
                        <strong>
                          {formatPrice(getTotal(order))}
                        </strong>
                      </div>
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
      </div>
      </div>
    </main>
  );
}

export default AdminOrders;