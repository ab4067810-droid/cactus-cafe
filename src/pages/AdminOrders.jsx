import { useEffect, useState } from "react";
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

function AdminOrders() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  // =========================
  // LOAD ORDERS
  // =========================
  const loadOrders = async () => {
    try {
      setError("");

      const ordersSnapshot = await getDocs(
        collection(db, "orders")
      );

      const ordersList = ordersSnapshot.docs.map(
        (orderDoc) => ({
          id: orderDoc.id,
          ...orderDoc.data(),
        })
      );

      // Newest orders first
      ordersList.sort((a, b) => {
        const dateA = a.createdAt?.toDate
          ? a.createdAt.toDate()
          : new Date(0);

        const dateB = b.createdAt?.toDate
          ? b.createdAt.toDate()
          : new Date(0);

        return dateB - dateA;
      });

      setOrders(ordersList);
    } catch (err) {
      console.error(
        "Error loading orders:",
        err
      );

      setError(
        "Unable to load orders. Please try again."
      );
    }
  };

  // =========================
  // CHECK ADMIN LOGIN
  // =========================
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
          setError("");

          // Get logged-in user's profile
          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const userSnapshot = await getDoc(
            userRef
          );

          // User profile does not exist
          if (!userSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login");
            return;
          }

          const userData = userSnapshot.data();

          // Check admin role
          if (userData.role !== "admin") {
            alert(
              "Access denied. Admin account required."
            );

            navigate("/customer");
            return;
          }

          // User is an admin
          await loadOrders();
        } catch (err) {
          console.error(
            "Error checking admin access:",
            err
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
  }, [navigate]);

  // =========================
  // UPDATE ORDER STATUS
  // =========================
  const handleStatusChange = async (
    orderId,
    newStatus
  ) => {
    try {
      setUpdatingId(orderId);

      const orderRef = doc(
        db,
        "orders",
        orderId
      );

      await updateDoc(orderRef, {
        status: newStatus,
      });

      // Update screen immediately
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

      alert(
        `Order status updated to "${newStatus}".`
      );
    } catch (err) {
      console.error(
        "Error updating order status:",
        err
      );

      alert(
        "Unable to update order status. Please try again."
      );
    } finally {
      setUpdatingId(null);
    }
  };

  // =========================
  // FORMAT DATE
  // =========================
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return "Date unavailable";
    }

    return timestamp
      .toDate()
      .toLocaleString();
  };

  // =========================
  // GET TOTAL
  // =========================
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
          Number(item.price || 0) *
            Number(item.quantity || 0),
        0
      );
    }

    return 0;
  };

  // =========================
  // STATUS OPTIONS
  // =========================
  const getStatusOptions = (order) => {
    const orderType = String(
      order.orderType || ""
    ).toLowerCase();

    if (orderType === "delivery") {
      return [
        "Pending",
        "Confirmed",
        "Preparing",
        "Out for Delivery",
        "Completed",
      ];
    }

    if (orderType === "pickup") {
      return [
        "Pending",
        "Confirmed",
        "Preparing",
        "Ready for Pickup",
        "Completed",
      ];
    }

    if (
      orderType === "dine-in" ||
      orderType === "dinein"
    ) {
      return [
        "Pending",
        "Confirmed",
        "Preparing",
        "Ready",
        "Completed",
      ];
    }

    return [
      "Pending",
      "Confirmed",
      "Preparing",
      "Ready",
      "Completed",
    ];
  };

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="admin-orders-page">
        <div className="admin-orders-container">
          <p className="admin-orders-loading">
            Checking administrator access...
          </p>
        </div>
      </main>
    );
  }

  // =========================
  // PAGE
  // =========================
  return (
    <main className="admin-orders-page">
      <div className="admin-orders-container">

        {/* HEADER */}
        <header className="admin-orders-header">
          <div>
            <p className="admin-orders-eyebrow">
              CACTUS CAFE
            </p>

            <h1>Customer Orders</h1>

            <p>
              View and manage customer orders
              submitted through the Cactus Cafe
              website.
            </p>
          </div>

          <button
            className="admin-back-button"
            onClick={() =>
              navigate("/admin")
            }
          >
            ← Back to Dashboard
          </button>
        </header>

        {/* ERROR */}
        {error && (
          <div className="admin-orders-error">
            {error}
          </div>
        )}

        {/* EMPTY */}
        {!error && orders.length === 0 && (
          <div className="admin-orders-empty">
            <div className="empty-icon">
              📦
            </div>

            <h2>No Orders Yet</h2>

            <p>
              Customer orders will appear here
              after they place an order.
            </p>
          </div>
        )}

        {/* ORDERS */}
        {orders.length > 0 && (
          <section className="admin-orders-list">

            {/* ORDER COUNT */}
            <div className="orders-count">
              Total Orders:{" "}
              <strong>
                {orders.length}
              </strong>
            </div>

            {/* ORDER CARDS */}
            {orders.map((order) => (
              <article
                className="admin-order-card"
                key={order.id}
              >

                {/* ORDER HEADER */}
                <div className="admin-order-top">

                  <div>
                    <span className="order-label">
                      ORDER ID
                    </span>

                    <strong>
                      {order.id}
                    </strong>
                  </div>

                  <span className="order-status">
                    {order.status || "Pending"}
                  </span>

                </div>

                {/* CUSTOMER INFORMATION */}
                <div className="admin-order-info">

                  <div>
                    <span className="order-label">
                      CUSTOMER
                    </span>

                    <p>
                      {order.customerName ||
                        order.name ||
                        "No name"}
                    </p>

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

                    <p>
                      {order.phone ||
                        order.contactNumber ||
                        "No phone number"}
                    </p>
                  </div>

                  <div>
                    <span className="order-label">
                      ORDER TYPE
                    </span>

                    <p>
                      {order.orderType ||
                        "Not specified"}
                    </p>
                  </div>

                  <div>
                    <span className="order-label">
                      DATE
                    </span>

                    <p>
                      {formatDate(
                        order.createdAt
                      )}
                    </p>
                  </div>

                </div>

                {/* ITEMS */}
                <div className="admin-order-items">

                  <h3>Items</h3>

                  {Array.isArray(order.items) &&
                  order.items.length > 0 ? (
                    order.items.map(
                      (item, index) => (
                        <div
                          className="admin-order-item"
                          key={`${order.id}-${index}`}
                        >
                          <span>
                            {item.name ||
                              "Item"}
                          </span>

                          <span>
                            {item.quantity || 0}
                            {" × "}
                            ₱
                            {Number(
                              item.price || 0
                            ).toFixed(2)}
                          </span>
                        </div>
                      )
                    )
                  ) : (
                    <p>
                      No order items available.
                    </p>
                  )}

                </div>

                {/* DELIVERY ADDRESS */}
                {order.address && (
                  <div className="admin-order-detail">
                    <strong>
                      Delivery Address:
                    </strong>

                    <p>
                      {order.address}
                    </p>
                  </div>
                )}

                {/* PICKUP INFORMATION */}
                {order.pickupTime && (
                  <div className="admin-order-detail">
                    <strong>
                      Pickup Time:
                    </strong>

                    <p>
                      {order.pickupTime}
                    </p>
                  </div>
                )}

                {/* TABLE INFORMATION */}
                {order.tableNumber && (
                  <div className="admin-order-detail">
                    <strong>
                      Table Number:
                    </strong>

                    <p>
                      {order.tableNumber}
                    </p>
                  </div>
                )}

                {/* NOTES */}
                {order.notes && (
                  <div className="admin-order-detail">
                    <strong>
                      Order Notes:
                    </strong>

                    <p>
                      {order.notes}
                    </p>
                  </div>
                )}

                {/* PAYMENT METHOD */}
                {order.paymentMethod && (
                  <div className="admin-order-detail">
                    <strong>
                      Payment Method:
                    </strong>

                    <p>
                      {order.paymentMethod}
                    </p>
                  </div>
                )}

                {/* TOTAL */}
                <div className="admin-order-total">
                  <span>
                    Total:
                  </span>

                  <strong>
                    ₱
                    {getTotal(order).toFixed(2)}
                  </strong>
                </div>

                {/* STATUS MANAGEMENT */}
                <div className="admin-order-status-control">

                  <label
                    htmlFor={`status-${order.id}`}
                  >
                    Update Order Status
                  </label>

                  <select
                    id={`status-${order.id}`}
                    value={
                      order.status ||
                      "Pending"
                    }
                    disabled={
                      updatingId === order.id
                    }
                    onChange={(event) =>
                      handleStatusChange(
                        order.id,
                        event.target.value
                      )
                    }
                  >
                    {getStatusOptions(order).map(
                      (status) => (
                        <option
                          key={status}
                          value={status}
                        >
                          {status}
                        </option>
                      )
                    )}
                  </select>

                  {updatingId ===
                    order.id && (
                    <small>
                      Updating...
                    </small>
                  )}

                </div>

              </article>
            ))}

          </section>
        )}

      </div>
    </main>
  );
}

export default AdminOrders;