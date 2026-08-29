import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import "../styles/AdminDashboard.css";

function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
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

        setUser(currentUser);
      } catch (error) {
        console.error("Error checking admin role:", error);
        navigate("/login");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (loading) {
    return (
      <main className="admin-dashboard">
        <p>Checking administrator access...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="admin-dashboard">
      <header className="admin-header">
        <div className="admin-brand">
          🌵 Cactus Cafe
        </div>

        <div className="admin-user">
          <span>{user.email}</span>

          <button onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="admin-welcome">
        <p className="admin-eyebrow">
          ADMINISTRATION
        </p>

        <h1>Admin Dashboard</h1>

        <p>
          Manage Cactus Cafe orders, reservations, reviews,
          menu items, and users.
        </p>
      </section>

      <section className="admin-cards">

        <div
          className="admin-card"
          onClick={() => navigate("/admin/orders")}
        >
          <div className="admin-card-icon">
            📦
          </div>

          <h2>Orders</h2>

          <p>
            View and manage customer orders.
          </p>
        </div>

        <div
          className="admin-card"
          onClick={() => navigate("/admin/reservations")}
        >
          <div className="admin-card-icon">
            📅
          </div>

          <h2>Reservations</h2>

          <p>
            View and manage table reservations.
          </p>
        </div>

        <div
          className="admin-card"
          onClick={() => navigate("/admin/reviews")}
        >
          <div className="admin-card-icon">
            ⭐
          </div>

          <h2>Reviews</h2>

          <p>
            Review and manage customer feedback.
          </p>
        </div>

        <div
          className="admin-card"
          onClick={() => navigate("/admin/menu")}
        >
          <div className="admin-card-icon">
            🍔
          </div>

          <h2>Menu Management</h2>

          <p>
            Add, edit, and manage cafe menu items.
          </p>
        </div>

        <div
          className="admin-card"
          onClick={() => navigate("/admin/users")}
        >
          <div className="admin-card-icon">
            👥
          </div>

          <h2>Users</h2>

          <p>
            View registered customer accounts.
          </p>
        </div>

      </section>
    </main>
  );
}

export default AdminDashboard;