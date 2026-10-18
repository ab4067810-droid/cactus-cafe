import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminUsers.css";

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Date unavailable";
  }

  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getUserName = (user) =>
  user.name ||
  user.fullName ||
  user.displayName ||
  "Unnamed user";

const getUserRole = (user) =>
  String(user.role || "customer").toLowerCase();

const getInitials = (user) => {
  const name = getUserName(user);

  if (name === "Unnamed user") {
    return "U";
  }

  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

function AdminUsers() {
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");

  const loadUsers = useCallback(async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "users")
      );

      const usersList = snapshot.docs
        .map((userDoc) => ({
          id: userDoc.id,
          ...userDoc.data(),
        }))
        .sort((firstUser, secondUser) => {
          const firstDate = firstUser.createdAt?.toDate
            ? firstUser.createdAt.toDate()
            : new Date(0);

          const secondDate = secondUser.createdAt?.toDate
            ? secondUser.createdAt.toDate()
            : new Date(0);

          return secondDate - firstDate;
        });

      setUsers(usersList);
    } catch (loadError) {
      console.error("Error loading users:", loadError);
      setError("Unable to load users. Please try again.");
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login", { replace: true });
          return;
        }

        try {
          setLoading(true);

          const currentUserSnapshot = await getDoc(
            doc(db, "users", currentUser.uid)
          );

          if (!currentUserSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login", { replace: true });
            return;
          }

          const currentUserData =
            currentUserSnapshot.data();

          if (currentUserData.role !== "admin") {
            alert("Access denied. Admin account required.");
            navigate("/customer", { replace: true });
            return;
          }

          await loadUsers();
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
  }, [loadUsers, navigate]);

  const statistics = useMemo(() => {
    const adminCount = users.filter(
      (user) => getUserRole(user) === "admin"
    ).length;

    return {
      total: users.length,
      customers: users.length - adminCount,
      admins: adminCount,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return users.filter((user) => {
      const role = getUserRole(user);
      const name = getUserName(user);
      const email = user.email || "No email";

      const matchesRole =
        roleFilter === "All" || role === roleFilter;

      const searchableText = `
        ${name}
        ${email}
        ${role}
        ${user.id}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      return matchesRole && matchesSearch;
    });
  }, [users, searchTerm, roleFilter]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setNotice("");
      await loadUsers();
      setNotice("User list refreshed.");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <main className="admin-users-page">
        <section className="admin-users-loading">
          <div className="loading-icon">◎</div>

          <p className="admin-users-eyebrow">
            CACTUS CAFE
          </p>

          <h1>Loading user workspace</h1>

          <div className="loading-bar" />
        </section>
      </main>
    );
  }

  return (
    <main className="admin-users-page">
      <div className="admin-users-container">
        <header className="admin-users-header">
          <div>
            <p className="admin-users-eyebrow">
              CUSTOMER DIRECTORY
            </p>

            <h1>Registered users</h1>

            <p>
              View customer accounts and understand who is
              connected to the Cactus Cafe experience.
            </p>
          </div>

          <div className="admin-users-header-actions">
            <button
              type="button"
              className="refresh-users-button"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "↻ Refresh"}
            </button>

            <button
              type="button"
              className="admin-back-button"
              onClick={() => navigate("/admin")}
            >
              ← Back to dashboard
            </button>
          </div>
        </header>

        <section className="users-overview">
          <div className="overview-stat">
            <span>Total users</span>
            <strong>{statistics.total}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Customers</span>
            <strong>{statistics.customers}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Administrators</span>
            <strong>{statistics.admins}</strong>
          </div>
        </section>

        {notice && (
          <div className="admin-users-notice" role="status">
            <span>✓</span>
            {notice}
          </div>
        )}

        {error && (
          <div className="admin-users-error" role="alert">
            <span>!</span>
            <p>{error}</p>

            <button
              type="button"
              onClick={loadUsers}
            >
              Try again
            </button>
          </div>
        )}

        <section className="users-toolbar">
          <div>
            <p className="admin-users-eyebrow">
              ACCOUNT DIRECTORY
            </p>

            <h2>Manage registered accounts</h2>
          </div>

          <div className="users-toolbar-actions">
            <label className="users-search">
              <span>⌕</span>

              <input
                type="search"
                placeholder="Search name, email, or ID"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
              />
            </label>

            <select
              className="role-filter"
              value={roleFilter}
              onChange={(event) =>
                setRoleFilter(event.target.value)
              }
            >
              <option value="All">All roles</option>
              <option value="customer">Customers</option>
              <option value="admin">Administrators</option>
            </select>
          </div>
        </section>

        {!error && users.length === 0 && (
          <section className="admin-users-empty">
            <div className="empty-icon">◎</div>

            <p className="admin-users-eyebrow">
              ACCOUNT DIRECTORY
            </p>

            <h2>No users yet</h2>

            <p>
              Registered customer accounts will appear here.
            </p>
          </section>
        )}

        {!error &&
          users.length > 0 &&
          filteredUsers.length === 0 && (
            <section className="admin-users-empty compact-empty">
              <div className="empty-icon">⌕</div>

              <h2>No matching users</h2>

              <p>
                Try another search term or choose a different
                role.
              </p>
            </section>
          )}

        {!error && filteredUsers.length > 0 && (
          <section className="admin-users-list">
            <div className="users-list-heading">
              <div>
                <p className="admin-users-eyebrow">
                  USER ACTIVITY
                </p>

                <h2>
                  {filteredUsers.length}{" "}
                  {filteredUsers.length === 1
                    ? "account"
                    : "accounts"}{" "}
                  shown
                </h2>
              </div>
            </div>

            <div className="users-grid">
              {filteredUsers.map((user) => {
                const role = getUserRole(user);
                const name = getUserName(user);
                const email = user.email || "No email";

                return (
                  <article
                    className="admin-user-card"
                    key={user.id}
                  >
                    <div className="user-card-header">
                      <div className="user-profile">
                        <div className="user-avatar">
                          {getInitials(user)}
                        </div>

                        <div>
                          <span className="user-label">
                            ACCOUNT
                          </span>

                          <h3>{name}</h3>

                          <p>{email}</p>
                        </div>
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

                    <div className="user-details">
                      <div>
                        <span className="user-label">
                          EMAIL
                        </span>

                        <strong>{email}</strong>
                      </div>

                      <div>
                        <span className="user-label">
                          REGISTERED
                        </span>

                        <strong>
                          {formatDate(user.createdAt)}
                        </strong>
                      </div>
                    </div>

                    <div className="user-card-footer">
                      <span className="user-label">
                        USER ID
                      </span>

                      <code title={user.id}>
                        {user.id}
                      </code>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default AdminUsers;