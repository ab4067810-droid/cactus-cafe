import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { NavLink, useNavigate } from "react-router-dom";

import AdminWorkspaceNavigation from "../components/AdminWorkspaceNavigation";
import AdminLoadingSkeleton from "../components/AdminLoadingSkeleton";
import { auth, db } from "../services/firebase";
import { getEffectiveRole } from "../utils/userRole";
import "../styles/AdminReviews.css";
import "../styles/AdminMonthlyRecords.css";
import "../styles/AdminSidebar.css";

const getOrderDate = (order) => {
  const value = order.createdAt;

  if (value?.toDate) {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
};

const getMonthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const getOrderItems = (order) =>
  Array.isArray(order.items) ? order.items : [];

const getItemName = (item) =>
  item.name || item.itemName || item.title || "Menu item";

const getItemQuantity = (item) =>
  Math.max(0, Number(item.quantity) || 0);

const getItemRevenue = (item) => {
  const quantity = getItemQuantity(item);
  const subtotal = Number(item.subtotal);

  if (item.subtotal !== undefined && item.subtotal !== null && Number.isFinite(subtotal)) {
    return subtotal;
  }

  return (Number(item.price ?? item.unitPrice) || 0) * quantity;
};

const getOrderTotal = (order) => {
  const total = Number(order.totalPrice ?? order.total);

  if (Number.isFinite(total)) {
    return total;
  }

  return getOrderItems(order).reduce(
    (sum, item) => sum + getItemRevenue(item),
    0,
  );
};

const isValidOrder = (order) => {
  const status = String(order.status || "").trim().toLowerCase();
  return !["rejected", "cancelled", "canceled"].includes(status);
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);

const formatOrderDate = (date) =>
  date
    ? date.toLocaleDateString("en-PH", { dateStyle: "medium" })
    : "Date unavailable";

const formatOrderType = (orderType) => {
  const type = String(orderType || "").trim().toLowerCase();

  if (type === "delivery") return "Delivery";
  if (type === "dine-in" || type === "dinein") return "Dine-in";
  if (type === "takeout" || type === "pickup") return "Takeout";
  return "Not specified";
};

const getMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });
};

function AdminMonthlyRecords() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() =>
    getMonthKey(new Date()),
  );

  const loadOrders = useCallback(async () => {
    try {
      setError("");
      const snapshot = await getDocs(collection(db, "orders"));
      setOrders(
        snapshot.docs.map((orderDoc) => ({
          id: orderDoc.id,
          ...orderDoc.data(),
        })),
      );
    } catch (loadError) {
      console.error("Error loading monthly order records:", loadError);
      setError("Unable to load monthly order records. Please try again.");
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        setLoading(true);
        const userSnapshot = await getDoc(doc(db, "users", currentUser.uid));

        if (!userSnapshot.exists()) {
          alert("User profile not found.");
          navigate("/login", { replace: true });
          return;
        }

        const userRole = getEffectiveRole(userSnapshot.data());

        if (userRole !== "admin") {
          alert("Access denied. Admin account required.");
          navigate(
            userRole === "staff" ? "/admin/orders" : "/menu",
            { replace: true },
          );
          return;
        }

        await loadOrders();
      } catch (accessError) {
        console.error("Error checking admin access:", accessError);
        setError("Unable to verify administrator access.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [loadOrders, navigate]);

  const validOrders = useMemo(
    () => orders.filter(isValidOrder),
    [orders],
  );

  const monthOptions = useMemo(() => {
    const monthKeys = new Set([getMonthKey(new Date())]);

    validOrders.forEach((order) => {
      const date = getOrderDate(order);
      if (date) monthKeys.add(getMonthKey(date));
    });

    return [...monthKeys].sort((first, second) =>
      second.localeCompare(first),
    );
  }, [validOrders]);

  const selectedOrders = useMemo(
    () =>
      validOrders
        .filter((order) => {
          const date = getOrderDate(order);
          return date && getMonthKey(date) === selectedMonth;
        })
        .sort((first, second) => getOrderDate(first) - getOrderDate(second)),
    [selectedMonth, validOrders],
  );

  const report = useMemo(() => {
    const itemSales = new Map();
    const fulfillment = {
      "Dine-in": 0,
      Takeout: 0,
      Delivery: 0,
    };

    let revenue = 0;

    selectedOrders.forEach((order) => {
      revenue += getOrderTotal(order);
      const orderType = formatOrderType(order.orderType);
      if (Object.hasOwn(fulfillment, orderType)) {
        fulfillment[orderType] += 1;
      }

      getOrderItems(order).forEach((item) => {
        const name = getItemName(item);
        const current = itemSales.get(name) || { quantity: 0, revenue: 0 };
        current.quantity += getItemQuantity(item);
        current.revenue += getItemRevenue(item);
        itemSales.set(name, current);
      });
    });

    const topItems = [...itemSales.entries()]
      .map(([name, values]) => ({ name, ...values }))
      .sort(
        (first, second) =>
          second.quantity - first.quantity || first.name.localeCompare(second.name),
      )
      .slice(0, 5);

    return {
      revenue,
      averageOrderValue:
        selectedOrders.length > 0 ? revenue / selectedOrders.length : 0,
      fulfillment,
      topItems,
    };
  }, [selectedOrders]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (logoutError) {
      console.error("Logout error:", logoutError);
      setError("Unable to log out. Please try again.");
      setLoggingOut(false);
    }
  };

  const monthLabel = getMonthLabel(selectedMonth);

  return (
    <main className="admin-reviews-page admin-monthly-records-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="admin-reviews-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`admin-reviews-sidebar ${
          mobileNavigationOpen ? "is-open" : ""
        }`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/monthly-records"
          className="admin-reviews-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-reviews-brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-reviews-sidebar-label">WORKSPACE</div>
        <nav className="admin-reviews-nav">
          <AdminWorkspaceNavigation
            classPrefix="admin-reviews"
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </nav>

        <div className="admin-reviews-sidebar-footer">
          <div className="admin-reviews-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Every great visit starts with a warm welcome.</p>
          </div>
          <button
            type="button"
            className="admin-reviews-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ↪
            </span>
            <span>{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>

      <div className="admin-reviews-main">
        <div className="admin-reviews-container monthly-records-container">
          <header className="admin-reviews-header monthly-records-screen-header">
            <button
              type="button"
              className="admin-reviews-mobile-toggle"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavigationOpen}
              onClick={() => setMobileNavigationOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div className="admin-reviews-heading">
              <p className="admin-reviews-eyebrow">SALES REPORTING</p>
              <h1>Monthly Records</h1>
              <p>Review completed order activity and sales by month.</p>
            </div>
            <div className="admin-reviews-profile">
              <span className="admin-reviews-profile-avatar" aria-hidden="true">
                {(auth.currentUser?.displayName || "A").slice(0, 1).toUpperCase()}
              </span>
              <span className="admin-reviews-profile-copy">
                <strong>{auth.currentUser?.displayName || "Cafe Admin"}</strong>
                <small>Administrator</small>
              </span>
            </div>
          </header>

          {loading ? (
            <AdminLoadingSkeleton label="Loading monthly records" stats={4} rows={6} />
          ) : (
            <>
          <header className="monthly-records-print-header">
            <p>CACTUS CAFÉ</p>
            <h1>Cactus Café — Monthly Order &amp; Sales Report</h1>
            <div>
              <strong>{monthLabel}</strong>
              <span>
                Date Printed:{" "}
                {new Date().toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          </header>

          <section className="monthly-records-toolbar monthly-screen-controls">
            <div>
              <p className="admin-reviews-eyebrow">MONTHLY REPORT</p>
              <h2>{monthLabel}</h2>
            </div>
            <div className="monthly-records-actions">
              <label className="monthly-records-month-filter">
                <span>Month &amp; Year</span>
                <select
                  aria-label="Select report month and year"
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                >
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>
                      {getMonthLabel(month)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="monthly-records-refresh-button"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                className="monthly-records-print-button"
                onClick={() => window.print()}
              >
                Print / Save PDF
              </button>
            </div>
          </section>

          {error && (
            <div className="monthly-records-error" role="alert">
              <span>{error}</span>
              <button type="button" onClick={loadOrders}>
                Try again
              </button>
            </div>
          )}

          <section
            className="monthly-records-summary"
            aria-label="Monthly summary"
          >
            <article className="monthly-records-card">
              <span className="monthly-records-card-icon">▤</span>
              <div>
                <p>Total Monthly Orders</p>
                <strong>{selectedOrders.length}</strong>
              </div>
            </article>
            <article className="monthly-records-card">
              <span className="monthly-records-card-icon revenue">₱</span>
              <div>
                <p>Monthly Revenue</p>
                <strong>{formatCurrency(report.revenue)}</strong>
              </div>
            </article>
            <article className="monthly-records-card">
              <span className="monthly-records-card-icon average">↗</span>
              <div>
                <p>Average Order Value</p>
                <strong>{formatCurrency(report.averageOrderValue)}</strong>
              </div>
            </article>
            <article className="monthly-records-card">
              <span className="monthly-records-card-icon popular">☆</span>
              <div>
                <p>Most Ordered Item</p>
                <strong className="monthly-records-most-popular">
                  {report.topItems[0]
                    ? `${report.topItems[0].name} (${report.topItems[0].quantity} sold)`
                    : "No items sold"}
                </strong>
              </div>
            </article>
          </section>

          <section className="monthly-records-insights">
            <article className="monthly-records-panel">
              <div className="monthly-records-panel-heading">
                <div>
                  <p className="admin-reviews-eyebrow">ITEM PERFORMANCE</p>
                  <h2>Top 5 Most Ordered Items</h2>
                </div>
              </div>
              {report.topItems.length > 0 ? (
                <div className="monthly-records-table-wrap">
                  <table className="monthly-records-table compact-table">
                    <thead>
                      <tr>
                        <th>Item Name</th>
                        <th>Quantity Sold</th>
                        <th>Item Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.topItems.map((item) => (
                        <tr key={item.name}>
                          <td>{item.name}</td>
                          <td>{item.quantity}</td>
                          <td>{formatCurrency(item.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="monthly-records-empty">No item sales for this month.</p>
              )}
            </article>

            <article className="monthly-records-panel monthly-records-fulfillment">
              <div className="monthly-records-panel-heading">
                <div>
                  <p className="admin-reviews-eyebrow">ORDER MIX</p>
                  <h2>Fulfillment Breakdown</h2>
                </div>
              </div>
              {Object.entries(report.fulfillment).map(([label, count]) => (
                <div className="monthly-records-fulfillment-row" key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </article>
          </section>

          <section className="monthly-records-ledger">
            <div className="monthly-records-panel-heading ledger-heading">
              <div>
                <p className="admin-reviews-eyebrow">ORDER LEDGER</p>
                <h2>Monthly Orders</h2>
              </div>
              <span>{selectedOrders.length} orders</span>
            </div>
            <div className="monthly-records-table-wrap">
              <table className="monthly-records-table ledger-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Fulfillment</th>
                    <th>Items</th>
                    <th>Total (₱)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrders.map((order) => {
                    const orderDate = getOrderDate(order);
                    return (
                      <tr key={order.id}>
                        <td>{formatOrderDate(orderDate)}</td>
                        <td>{order.orderId || order.id}</td>
                        <td>{order.customerName || "Customer"}</td>
                        <td>{formatOrderType(order.orderType)}</td>
                        <td>
                          {getOrderItems(order).length > 0
                            ? getOrderItems(order)
                                .map(
                                  (item) =>
                                    `${getItemName(item)} × ${getItemQuantity(item)}`,
                                )
                                .join(", ")
                            : "No item details"}
                        </td>
                        <td>{formatCurrency(getOrderTotal(order))}</td>
                      </tr>
                    );
                  })}
                  {selectedOrders.length === 0 && (
                    <tr>
                      <td colSpan="6" className="monthly-records-empty-row">
                        No valid orders for {monthLabel}.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan="5">Total Revenue</th>
                    <th>{formatCurrency(report.revenue)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="monthly-records-signature">
              <span>Prepared by</span>
              <span className="monthly-records-signature-line" />
              <small>Authorized signature</small>
            </div>
          </section>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default AdminMonthlyRecords;
