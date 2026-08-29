import { useEffect, useState } from "react";
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

function MyOrders() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // =========================
  // LOAD CUSTOMER ORDERS
  // =========================
  const loadOrders = async (currentUser) => {
    try {
      setLoading(true);
      setError("");

      const ordersQuery = query(
        collection(db, "orders"),
        where("customerId", "==", currentUser.uid)
      );

      const snapshot = await getDocs(ordersQuery);

      const orderList = snapshot.docs.map((orderDoc) => ({
        id: orderDoc.id,
        ...orderDoc.data(),
      }));

      // Newest orders first
      orderList.sort((a, b) => {
        const dateA = a.createdAt?.toDate
          ? a.createdAt.toDate()
          : new Date(0);

        const dateB = b.createdAt?.toDate
          ? b.createdAt.toDate()
          : new Date(0);

        return dateB - dateA;
      });

      setOrders(orderList);
    } catch (err) {
      console.error("Error loading orders:", err);

      setError(
        "Unable to load your orders. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // CHECK LOGIN
  // =========================
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
  }, [navigate]);

  // =========================
  // FORMAT DATE
  // =========================
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return "Date unavailable";
    }

    return timestamp.toDate().toLocaleString();
  };

  // =========================
  // FORMAT PRICE
  // =========================
  const formatPrice = (price) => {
    return Number(price || 0).toFixed(2);
  };

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="my-orders-page">
        <section className="my-orders-container">
          <p className="my-orders-loading">
            Loading your orders...
          </p>
        </section>
      </main>
    );
  }

  // =========================
  // PAGE
  // =========================
  return (
    <main className="my-orders-page">
      <section className="my-orders-container">

        {/* =========================
            HEADER
        ========================= */}
        <header className="my-orders-header">

          <div>
            <p className="orders-eyebrow">
              CACTUS CAFE
            </p>

            <h1>My Orders</h1>

            <p>
              View your previous and current Cactus Cafe
              orders.
            </p>
          </div>

          <button
            className="my-orders-back-button"
            onClick={() => navigate("/customer")}
          >
            ← Back to Dashboard
          </button>

        </header>

        {/* =========================
            ERROR
        ========================= */}
        {error && (
          <div className="my-orders-error">
            <p>{error}</p>

            <button
              onClick={() => {
                const currentUser = auth.currentUser;

                if (currentUser) {
                  loadOrders(currentUser);
                }
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* =========================
            NO ORDERS
        ========================= */}
        {!error && orders.length === 0 && (
          <section className="no-orders">

            <div className="empty-icon">
              📦
            </div>

            <h2>No Orders Yet 🛒</h2>

            <p>
              Your orders will appear here after you
              place an order.
            </p>

            <button
              className="browse-menu-button"
              onClick={() => navigate("/menu")}
            >
              Browse Menu
            </button>

          </section>
        )}

        {/* =========================
            ORDERS
        ========================= */}
        {!error && orders.length > 0 && (
          <section className="orders-list">

            <div className="orders-count">
              Total Orders:{" "}
              <strong>{orders.length}</strong>
            </div>

            {orders.map((order) => (

              <article
                className="order-card"
                key={order.id}
              >

                {/* =========================
                    ORDER HEADER
                ========================= */}
                <div className="order-card-header">

                  <div>
                    <p className="order-label">
                      ORDER ID
                    </p>

                    <strong>
                      {order.id}
                    </strong>
                  </div>

                  <span
                    className={`order-status status-${String(
                      order.status || "Pending"
                    )
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {order.status || "Pending"}
                  </span>

                </div>

                {/* =========================
                    ORDER DETAILS
                ========================= */}
                <div className="order-details">

                  <div>
                    <p>
                      <strong>Order Type:</strong>
                    </p>

                    <p>
                      {order.orderType || "Not specified"}
                    </p>
                  </div>

                  <div>
                    <p>
                      <strong>Date:</strong>
                    </p>

                    <p>
                      {formatDate(order.createdAt)}
                    </p>
                  </div>

                  <div>
                    <p>
                      <strong>Total:</strong>
                    </p>

                    <p className="order-total">
                      ₱{formatPrice(order.total)}
                    </p>
                  </div>

                </div>

                {/* =========================
                    CUSTOMER INFORMATION
                ========================= */}
                <div className="order-customer-info">

                  <h3>Customer Information</h3>

                  <p>
                    <strong>Name:</strong>{" "}
                    {order.customerName || "Not available"}
                  </p>

                  <p>
                    <strong>Contact:</strong>{" "}
                    {order.phone || "Not available"}
                  </p>

                </div>

                {/* =========================
                    DELIVERY ADDRESS
                ========================= */}
                {order.orderType === "delivery" &&
                  order.address && (
                    <div className="order-address">

                      <strong>
                        Delivery Address:
                      </strong>

                      <p>
                        {order.address}
                      </p>

                    </div>
                  )}

                {/* =========================
                    ORDER ITEMS
                ========================= */}
                <div className="order-items">

                  <h3>Items</h3>

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
                          {item.quantity || 0} × ₱
                          {formatPrice(item.price)}
                        </span>
                      </div>

                      <strong>
                        ₱
                        {formatPrice(
                          item.subtotal ??
                            Number(item.price || 0) *
                              Number(item.quantity || 0)
                        )}
                      </strong>

                    </div>

                  ))}

                </div>

                {/* =========================
                    NOTES
                ========================= */}
                {order.notes && (
                  <div className="order-notes">

                    <strong>
                      Order Notes:
                    </strong>

                    <p>
                      {order.notes}
                    </p>

                  </div>
                )}

                {/* =========================
                    TOTAL
                ========================= */}
                <div className="order-card-total">

                  <span>
                    Order Total
                  </span>

                  <strong>
                    ₱{formatPrice(order.total)}
                  </strong>

                </div>

              </article>

            ))}

          </section>
        )}

      </section>
    </main>
  );
}

export default MyOrders;