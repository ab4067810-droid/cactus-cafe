import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminOrders.css";

const BASE_STATUS_OPTIONS = [
  "Pending",
  "Confirmed",
  "Preparing",
  "Ready",
  "Completed",
  "Cancelled",
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

const getStatusClass = (status) =>
  String(status || "Pending")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

const getStatusOptions = (order) => {
  const orderType = String(order.orderType || "").toLowerCase();

  let options = BASE_STATUS_OPTIONS;

  if (orderType === "delivery") {
    options = [
      "Pending",
      "Confirmed",
      "Preparing",
      "Out for Delivery",
      "Completed",
      "Cancelled",
    ];
  }

  if (orderType === "pickup" || orderType === "takeout") {
    options = [
      "Pending",
      "Confirmed",
      "Preparing",
      "Ready for Pickup",
      "Completed",
      "Cancelled",
    ];
  }

  if (orderType === "dine-in" || orderType === "dinein") {
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [notice, setNotice] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

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
    } catch (loadError) {
      console.error("Error loading orders:", loadError);
      setError("Unable to load orders. Please try again.");
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

        try {
          setLoading(true);

          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const userSnapshot = await getDoc(userRef);

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

          await loadOrders();
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

    return () => unsubscribe();
  }, [loadOrders, navigate]);

  const filteredOrders = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return orders.filter((order) => {
      const status = order.status || "Pending";

      const matchesStatus =
        statusFilter === "All" || status === statusFilter;

      const searchableText = `
        ${order.id}
        ${order.customerName || ""}
        ${order.customerEmail || ""}
        ${order.phone || ""}
        ${order.orderType || ""}
        ${order.address || ""}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [orders, searchTerm, statusFilter]);

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

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await loadOrders();
      setNotice("Orders refreshed.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      setUpdatingId(orderId);
      setNotice("");

      await updateDoc(doc(db, "orders", orderId), {
        status: newStatus,
      });

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

      setNotice(`Order status updated to ${newStatus}.`);
    } catch (updateError) {
      console.error(
        "Error updating order status:",
        updateError
      );

      setNotice(
        "Unable to update order status. Please try again."
      );
    } finally {
      setUpdatingId(null);
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
      <div className="admin-orders-container">
        <header className="admin-orders-header">
          <div>
            <p className="admin-orders-eyebrow">
              OPERATIONS
            </p>

            <h1>Customer orders</h1>

            <p>
              Review incoming orders, track preparation, and
              keep customers up to date.
            </p>
          </div>

          <button
            type="button"
            className="admin-back-button"
            onClick={() => navigate("/admin")}
          >
            ← Back to dashboard
          </button>
        </header>

        <section className="orders-overview">
          <div className="overview-stat">
            <span>Total orders</span>
            <strong>{orders.length}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Active orders</span>
            <strong>{statistics.active}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Pending review</span>
            <strong>{statistics.pending}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Order value</span>
            <strong>{formatPrice(statistics.revenue)}</strong>
          </div>
        </section>

        {notice && (
          <div className="orders-notice" role="status">
            <span>✓</span>
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
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
              />
            </label>

            <select
              className="status-filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
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
                      <span className="order-label">
                        ORDER
                      </span>

                      <h3>
                        #{order.id.slice(0, 8).toUpperCase()}
                      </h3>

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

                  <details className="order-details">
                    <summary>
                      View order details
                    </summary>

                    <div className="order-details-content">
                      <div className="order-items">
                        <h4>Items</h4>

                        {orderItems.length > 0 ? (
                          orderItems.map((item, index) => (
                            <div
                              className="admin-order-item"
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
                          ))
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
                              <span>Delivery address</span>
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
                    <label
                      htmlFor={`status-${order.id}`}
                    >
                      Update order status
                    </label>

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
      </div>
    </main>
  );
}

export default AdminOrders;