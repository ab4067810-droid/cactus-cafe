import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/MyOrders.css";

const STATUS_STEPS = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready",
  "Completed",
];

const normalizeStatus = (status) => {
  const value = String(status || "Pending")
    .trim()
    .toLowerCase();

  if (value.includes("cancel")) return "Cancelled";
  if (value.includes("complete")) return "Completed";
  if (value.includes("ready")) return "Ready";
  if (value.includes("prepar")) return "Preparing";
  if (value.includes("confirm")) return "Confirmed";

  return "Pending";
};

const getStatusClass = (status) =>
  normalizeStatus(status).toLowerCase();

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
    delivery: "Delivery",
    "dine-in": "Dine-in",
  };

  return labels[orderType] || "Not specified";
};

function OrderStatusTracker({ status }) {
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

  const currentIndex = STATUS_STEPS.indexOf(normalizedStatus);

  return (
    <div className="status-tracker" aria-label="Order progress">
      {STATUS_STEPS.map((step, index) => {
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

            {index < STATUS_STEPS.length - 1 && (
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

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        await loadOrders(currentUser);
      }
    );

    return () => unsubscribe();
  }, [loadOrders, navigate]);

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

  const handleRetry = () => {
    const currentUser = auth.currentUser;

    if (currentUser) {
      loadOrders(currentUser);
    }
  };

  if (loading) {
    return (
      <main className="my-orders-page">
        <section className="my-orders-container">
          <div className="orders-skeleton-header" />

          <div className="orders-skeleton-card">
            <div className="skeleton-line skeleton-short" />
            <div className="skeleton-line skeleton-medium" />
            <div className="skeleton-block" />
          </div>

          <div className="orders-skeleton-card">
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

        {!error && orders.length === 0 && (
          <section className="no-orders">
            <div className="empty-icon">🛒</div>

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

                return (
                  <article
                    className="order-card"
                    key={order.id}
                  >
                    <div className="order-card-header">
                      <div>
                        <p className="order-label">ORDER</p>

                        <h3 title={order.id}>
                          #{order.id.slice(0, 8).toUpperCase()}
                        </h3>

                        <p className="order-date">
                          {formatDate(order.createdAt)}
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