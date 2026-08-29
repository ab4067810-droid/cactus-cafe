import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminUsers.css";

function AdminUsers() {
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // =========================
  // LOAD USERS
  // =========================
  const loadUsers = async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "users")
      );

      const usersList = snapshot.docs.map((userDoc) => ({
        id: userDoc.id,
        ...userDoc.data(),
      }));

      // Newest users first
      usersList.sort((a, b) => {
        const dateA = a.createdAt?.toDate
          ? a.createdAt.toDate()
          : new Date(0);

        const dateB = b.createdAt?.toDate
          ? b.createdAt.toDate()
          : new Date(0);

        return dateB - dateA;
      });

      setUsers(usersList);
    } catch (err) {
      console.error("Error loading users:", err);

      setError(
        "Unable to load users. Please try again."
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

          // Check the logged-in user's Firestore profile
          const snapshot = await getDocs(
            collection(db, "users")
          );

          const currentUserData = snapshot.docs.find(
            (userDoc) => userDoc.id === currentUser.uid
          );

          if (!currentUserData) {
            alert("User profile not found.");
            navigate("/login");
            return;
          }

          const userData = currentUserData.data();

          if (userData.role !== "admin") {
            alert(
              "Access denied. Admin account required."
            );

            navigate("/customer");
            return;
          }

          await loadUsers();
        } finally {
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [navigate]);

  // =========================
  // FORMAT CREATED DATE
  // =========================
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return "Date unavailable";
    }

    return timestamp.toDate().toLocaleString();
  };

  // =========================
  // GET DISPLAY NAME
  // =========================
  const getUserName = (user) => {
    return (
      user.name ||
      user.fullName ||
      user.displayName ||
      "Unnamed User"
    );
  };

  // =========================
  // GET USER ROLE
  // =========================
  const getUserRole = (user) => {
    return user.role || "customer";
  };

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="admin-users-page">
        <div className="admin-users-container">
          <p className="admin-users-loading">
            Loading users...
          </p>
        </div>
      </main>
    );
  }

  // =========================
  // PAGE
  // =========================
  return (
    <main className="admin-users-page">
      <div className="admin-users-container">

        {/* HEADER */}
        <header className="admin-users-header">
          <div>
            <p className="admin-users-eyebrow">
              CACTUS CAFE
            </p>

            <h1>Registered Users</h1>

            <p>
              View customer accounts registered on
              the Cactus Cafe website.
            </p>
          </div>

          <button
            className="admin-back-button"
            onClick={() => navigate("/admin")}
          >
            ← Back to Dashboard
          </button>
        </header>

        {/* ERROR */}
        {error && (
          <div className="admin-users-error">
            {error}
          </div>
        )}

        {/* EMPTY */}
        {!error && users.length === 0 && (
          <div className="admin-users-empty">
            <div className="empty-icon">
              👥
            </div>

            <h2>No Users Yet</h2>

            <p>
              Registered customer accounts will
              appear here.
            </p>
          </div>
        )}

        {/* USERS */}
        {users.length > 0 && (
          <section className="admin-users-list">

            <div className="users-count">
              Total Users:{" "}
              <strong>{users.length}</strong>
            </div>

            {users.map((user) => {
              const role = getUserRole(user);

              return (
                <article
                  className="admin-user-card"
                  key={user.id}
                >

                  {/* USER HEADER */}
                  <div className="admin-user-top">

                    <div>
                      <span className="user-label">
                        USER
                      </span>

                      <h2>
                        {getUserName(user)}
                      </h2>

                      <p className="user-email">
                        {user.email || "No email"}
                      </p>
                    </div>

                    <span
                      className={`user-role ${
                        role === "admin"
                          ? "user-role-admin"
                          : "user-role-customer"
                      }`}
                    >
                      {role}
                    </span>

                  </div>

                  {/* USER INFORMATION */}
                  <div className="admin-user-info">

                    <div>
                      <span className="user-label">
                        EMAIL
                      </span>

                      <p>
                        {user.email || "No email"}
                      </p>
                    </div>

                    <div>
                      <span className="user-label">
                        ROLE
                      </span>

                      <p>
                        {role}
                      </p>
                    </div>

                    <div>
                      <span className="user-label">
                        USER ID
                      </span>

                      <p className="user-id">
                        {user.id}
                      </p>
                    </div>

                    <div>
                      <span className="user-label">
                        REGISTERED
                      </span>

                      <p>
                        {formatDate(user.createdAt)}
                      </p>
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

export default AdminUsers;