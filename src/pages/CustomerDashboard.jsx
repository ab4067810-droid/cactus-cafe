import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../services/firebase";
import "../styles/CustomerDashboard.css";

function CustomerDashboard() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        navigate("/login");
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

  if (!user) {
    return <p>Checking login...</p>;
  }

  return (
    <main className="customer-dashboard">
      <header className="dashboard-header">
        <div className="dashboard-brand">🌵 Cactus Cafe</div>

        <div className="dashboard-user">
          {user.email}
        </div>
      </header>

      <section className="dashboard-welcome">
        <h1>Welcome back! 👋</h1>
        <p>What would you like to do today?</p>
      </section>

      <section className="dashboard-cards">
        <div
          className="dashboard-card"
          onClick={() => navigate("/menu")}
        >
          <div className="dashboard-card-icon">🍔</div>
          <h2>Browse Menu</h2>
          <p>
            Explore our food and drinks and find something delicious.
          </p>
        </div>

        <div
       className="dashboard-card"
          onClick={() => navigate("/my-orders")}
        >
        <div className="dashboard-card-icon">📦</div>

       <h2>My Orders</h2>

       <p>
       View your current and previous Cactus Cafe orders.
       </p>
       </div>

       <div
       className="dashboard-card"
        onClick={() => navigate("/my-reservations")}
      >
      <div className="dashboard-card-icon">📅</div>

      <h2>Reservations</h2>

     <p>
        View and manage your table reservations.
        </p>
     </div>

       <div
         className="dashboard-card"
      onClick={() => navigate("/my-reviews")}
       >
     <div className="dashboard-card-icon">
    ⭐
       </div>

      <h2>My Reviews</h2>

      <p>
        View and manage the reviews you have submitted.
       </p>
       </div>
      </section>

      <section className="dashboard-account">
        <h2>My Account</h2>

        <p>
          Logged in as: <strong>{user.email}</strong>
        </p>

        <button
          className="logout-button"
          onClick={handleLogout}
        >
          Logout
        </button>
      </section>
    </main>
  );
}

export default CustomerDashboard;