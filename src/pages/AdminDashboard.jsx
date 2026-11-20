import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import "../styles/AdminDashboard.css";

const adminModules = [
  {
    id: "orders",
    icon: "↗",
    label: "Orders",
    title: "Order management",
    description: "Review incoming orders and update their preparation status.",
    path: "/admin/orders",
    accent: "green",
  },
  {
    id: "reservations",
    icon: "◷",
    label: "Reservations",
    title: "Table reservations",
    description: "Manage bookings and keep the cafe schedule organized.",
    path: "/admin/reservations",
    accent: "blue",
  },
  {
    id: "reviews",
    icon: "★",
    label: "Reviews",
    title: "Customer feedback",
    description: "Review customer comments and moderate submitted reviews.",
    path: "/admin/reviews",
    accent: "orange",
  },
  {
    id: "menu",
    icon: "✦",
    label: "Menu",
    title: "Menu management",
    description: "Add, edit, feature, and remove products from your menu.",
    path: "/admin/menu",
    accent: "purple",
  },
  {
    id: "users",
    icon: "◎",
    label: "Users",
    title: "Customer accounts",
    description: "View registered customers and manage account access.",
    path: "/admin/users",
    accent: "teal",
  },
];

function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        try {
          const userRef = doc(db, "users", currentUser.uid);
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

          if (isMounted) {
            setUser(currentUser);
          }
        } catch (error) {
          console.error("Error checking admin role:", error);
          navigate("/login");
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <main className="admin-dashboard">
        <section className="admin-loading">
          <div className="loading-mark">🌵</div>
          <p className="admin-eyebrow">CACTUS CAFE</p>
          <h1>Preparing your workspace</h1>
          <div className="loading-bar" />
        </section>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const userEmail = user.email || "Admin account";
  const userInitial = userEmail.charAt(0).toUpperCase();

  return (
    <main className="admin-dashboard">
      <header className="admin-header">
        <button
          type="button"
          className="admin-brand"
          onClick={() => navigate("/admin/menu")}
          aria-label="Go to menu management"
        >
          <span className="brand-mark">🌵</span>

          <span>
            <strong>Cactus Cafe</strong>
            <small>Admin workspace</small>
          </span>
        </button>

        <div className="admin-header-actions">
          <span className="admin-access-badge">
            <span className="access-dot" />
            Administrator
          </span>

          <div className="admin-user">
            <span className="admin-avatar">{userInitial}</span>

            <span className="admin-email">{userEmail}</span>

            <button
              type="button"
              className="logout-button"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <section className="admin-welcome">
        <div className="welcome-copy">
          <p className="admin-eyebrow">ADMINISTRATION</p>

          <h1>Your cafe, clearly in view.</h1>

          <p>
            Manage the customer experience from one focused
            workspace. Choose a section below to get started.
          </p>
        </div>

        <div className="welcome-actions">
          <button
            type="button"
            className="primary-admin-button"
            onClick={() => navigate("/admin/orders")}
          >
            Open orders
            <span>↗</span>
          </button>

          <button
            type="button"
            className="secondary-admin-button"
            onClick={() => navigate("/admin/menu")}
          >
            Manage menu
          </button>
        </div>
      </section>

      <section className="admin-command-panel">
        <div className="command-panel-main">
          <div className="command-panel-icon">✦</div>

          <div>
            <p className="panel-eyebrow">CAFE COMMAND CENTER</p>

            <h2>Keep every guest touchpoint moving.</h2>

            <p>
              Orders, reservations, reviews, products, and
              customer accounts are organized in one place.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="panel-link"
          onClick={() => navigate("/admin/orders")}
        >
          View workspace
          <span>→</span>
        </button>
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <div>
            <p className="admin-eyebrow">WORKSPACE AREAS</p>
            <h2>What would you like to manage?</h2>
          </div>

          <span className="module-count">
            {adminModules.length} areas
          </span>
        </div>

        <div className="admin-module-grid">
          {adminModules.map((module, index) => (
            <button
              type="button"
              className={`admin-module-card accent-${module.accent} ${
                index === 0 ? "module-card-featured" : ""
              }`}
              key={module.id}
              onClick={() => navigate(module.path)}
            >
              <span className="module-card-top">
                <span className="module-icon">{module.icon}</span>
                <span className="module-arrow">↗</span>
              </span>

              <span className="module-card-content">
                <span className="module-label">{module.label}</span>
                <strong>{module.title}</strong>
                <span>{module.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="admin-footer-panel">
        <div>
          <p className="admin-eyebrow">QUICK ACCESS</p>
          <h2>Need to update today&apos;s offerings?</h2>
          <p>
            Keep your menu current so customers always see
            what is available.
          </p>
        </div>

        <button
          type="button"
          className="quick-action-button"
          onClick={() => navigate("/admin/menu")}
        >
          Update menu
          <span>→</span>
        </button>
      </section>
    </main>
  );
}

export default AdminDashboard;