import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { NavLink, useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import { maskCustomerName } from "../utils/maskCustomerName";
import "../styles/AdminReviews.css";
import "../styles/AdminSidebar.css";

const REVIEW_STATUSES = ["All", "Pending", "Approved", "Rejected"];

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Date unavailable";
  }

  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getRating = (review) =>
  Number(review.rating ?? review.stars ?? 0);

const getComment = (review) =>
  review.comment ||
  review.review ||
  review.message ||
  "No comment provided.";

const getStatusClass = (status) =>
  String(status || "Pending")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

const ReviewStatIcon = ({ name }) => {
  const icons = {
    total: (
      <>
        <path d="M7 4h10a2 2 0 0 1 2 2v13H5V6a2 2 0 0 1 2-2Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    pending: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    approved: <path d="m5 12 4 4L19 6" />,
    rating: (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  );
};

function ReviewCustomerAvatar({ photoURL, customerName }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl = typeof photoURL === "string" ? photoURL.trim() : "";
  const initial = Array.from(customerName || "")[0] || "";

  return (
    <div className="customer-avatar" aria-hidden="true">
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : initial ? (
        <span>{initial.toUpperCase()}</span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      )}
    </div>
  );
}

function AdminReviews() {
  const navigate = useNavigate();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const loadReviews = useCallback(async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "reviews")
      );

      const reviewList = snapshot.docs
        .map((reviewDoc) => ({
          id: reviewDoc.id,
          ...reviewDoc.data(),
        }))
        .sort((firstReview, secondReview) => {
          const firstDate = firstReview.createdAt?.toDate
            ? firstReview.createdAt.toDate()
            : new Date(0);

          const secondDate = secondReview.createdAt?.toDate
            ? secondReview.createdAt.toDate()
            : new Date(0);

          return secondDate - firstDate;
        });

      setReviews(reviewList);
    } catch (loadError) {
      console.error("Error loading reviews:", loadError);
      setError("Unable to load reviews. Please try again.");
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

          const userSnapshot = await getDoc(
            doc(db, "users", currentUser.uid)
          );

          if (!userSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login", { replace: true });
            return;
          }

          const userData = userSnapshot.data();

          if (userData.role !== "admin") {
            alert("Access denied. Admin account required.");
            navigate("/customer", { replace: true });
            return;
          }

          await loadReviews();
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
  }, [loadReviews, navigate]);

  const filteredReviews = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return reviews.filter((review) => {
      const status = review.status || "Pending";

      const customerName =
        review.customerName ||
        review.name ||
        "Anonymous Customer";

      const customerEmail =
        review.customerEmail ||
        review.email ||
        "No email";

      const matchesStatus =
        statusFilter === "All" || status === statusFilter;

      const searchableText = `
        ${customerName}
        ${customerEmail}
        ${getComment(review)}
        ${review.id}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [reviews, searchTerm, statusFilter]);

  const statistics = useMemo(() => {
    const totalRating = reviews.reduce(
      (sum, review) => sum + getRating(review),
      0
    );

    const pending = reviews.filter(
      (review) => (review.status || "Pending") === "Pending"
    ).length;

    const approved = reviews.filter(
      (review) => review.status === "Approved"
    ).length;

    return {
      total: reviews.length,
      pending,
      approved,
      average:
        reviews.length > 0
          ? (totalRating / reviews.length).toFixed(1)
          : "0.0",
    };
  }, [reviews]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setNotice("");
      await loadReviews();
      setNotice("Reviews refreshed.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (logoutError) {
      console.error("Logout error:", logoutError);
      setNotice("Unable to log out. Please try again.");
      setLoggingOut(false);
    }
  };

  if (loading) {
    return (
      <main className="admin-reviews-page">
        <section className="admin-reviews-loading">
          <div className="loading-icon">◷</div>
          <p className="admin-reviews-eyebrow">
            CACTUS CAFE
          </p>
          <h1>Loading review workspace</h1>
          <div className="loading-bar" />
        </section>
      </main>
    );
  }

  return (
    <main className="admin-reviews-page">
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
          to="/admin/menu"
          className="admin-reviews-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-reviews-brand-mark" aria-hidden="true">
            🌵
          </span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-reviews-sidebar-label">WORKSPACE</div>
        <nav className="admin-reviews-nav">
          <NavLink
            to="/admin/menu"
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ▦
            </span>
            <span>Menu Management</span>
          </NavLink>
          <NavLink
            to="/admin/orders"
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ↗
            </span>
            <span>Orders</span>
          </NavLink>
          <NavLink
            to="/admin/payments"
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ₱
            </span>
            <span>Payment Management</span>
          </NavLink>
          <NavLink
            to="/admin/reservations"
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ◷
            </span>
            <span>Reservations</span>
          </NavLink>
          <NavLink
            to="/admin/reviews"
            end
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ☆
            </span>
            <span>Reviews</span>
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ◎
            </span>
            <span>Customers &amp; Security</span>
          </NavLink>
          <NavLink
            to="/admin/monthly-records"
            className={({ isActive }) =>
              `admin-reviews-nav-link${isActive ? " active" : ""}`
            }
            onClick={() => setMobileNavigationOpen(false)}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ▤
            </span>
            <span>Monthly Records</span>
          </NavLink>
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
        <div className="admin-reviews-container">
          <header className="admin-reviews-header">
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
              <p className="admin-reviews-eyebrow">
                REVIEW MANAGEMENT
              </p>
              <h1>Manage Reviews</h1>
              <p>
                Review customer feedback, ratings, and moderation status in
                one place.
              </p>
            </div>

            <div className="admin-reviews-header-actions">
              <button
                type="button"
                className="admin-refresh-button"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16.5 8A6.7 6.7 0 0 0 4.7 5.4L3.5 7" />
                  <path d="M3.5 3.5V7h3.5M3.5 12a6.7 6.7 0 0 0 11.8 2.6l1.2-1.6" />
                  <path d="M16.5 16.5V13H13" />
                </svg>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="admin-reviews-profile">
              <span
                className="admin-reviews-profile-avatar"
                aria-hidden="true"
              >
                {(auth.currentUser?.displayName || "A")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span className="admin-reviews-profile-copy">
                <strong>
                  {auth.currentUser?.displayName || "Cafe Admin"}
                </strong>
                <small>Administrator</small>
              </span>
            </div>
          </header>

          <section className="reviews-overview">
            <div className="overview-stat">
              <span className="overview-stat-icon total-reviews-icon">
                <ReviewStatIcon name="total" />
              </span>
              <span className="overview-stat-copy">
                <span>Total Reviews</span>
                <strong>{statistics.total}</strong>
              </span>
            </div>

            <div className="overview-stat">
              <span className="overview-stat-icon pending-reviews-icon">
                <ReviewStatIcon name="pending" />
              </span>
              <span className="overview-stat-copy">
                <span>Pending</span>
                <strong>{statistics.pending}</strong>
              </span>
            </div>

            <div className="overview-stat">
              <span className="overview-stat-icon approved-reviews-icon">
                <ReviewStatIcon name="approved" />
              </span>
              <span className="overview-stat-copy">
                <span>Approved</span>
                <strong>{statistics.approved}</strong>
              </span>
            </div>

            <div className="overview-stat">
              <span className="overview-stat-icon average-reviews-icon">
                <ReviewStatIcon name="rating" />
              </span>
              <span className="overview-stat-copy">
                <span>Average Rating</span>
                <strong>
                  {statistics.average}
                  <small>/5</small>
                </strong>
              </span>
            </div>
          </section>

          {notice && (
            <div className="admin-reviews-notice" role="status">
              <span>✓</span>
              {notice}
            </div>
          )}

          {error && (
            <div className="admin-reviews-error" role="alert">
              <span>!</span>
              <p>{error}</p>

              <button
                type="button"
                className="admin-reviews-retry-button"
                onClick={loadReviews}
              >
                Try again
              </button>
            </div>
          )}

          <section className="reviews-toolbar">
            <div>
              <p className="admin-reviews-eyebrow">FEEDBACK QUEUE</p>
              <h2>Customer review history</h2>
            </div>

            <div className="reviews-toolbar-actions">
              <label className="reviews-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  placeholder="Search customer or review"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </label>

              <select
                className="review-filter"
                aria-label="Filter reviews by status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {REVIEW_STATUSES.map((status) => (
                  <option value={status} key={status}>
                    {status === "All" ? "All statuses" : status}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {!error && reviews.length === 0 && (
            <section className="admin-reviews-empty">
              <div className="empty-icon">☆</div>
              <p className="admin-reviews-eyebrow">FEEDBACK QUEUE</p>
              <h2>No reviews yet</h2>
              <p>
                Customer feedback will appear here after customers submit a
                review.
              </p>
            </section>
          )}

          {!error &&
            reviews.length > 0 &&
            filteredReviews.length === 0 && (
              <section className="admin-reviews-empty compact-empty">
                <div className="empty-icon">⌕</div>
                <h2>No matching reviews</h2>
                <p>
                  Try another search term or choose a different status.
                </p>
              </section>
            )}

          {!error && filteredReviews.length > 0 && (
            <section className="admin-reviews-list">
              <div className="reviews-list-heading">
                <div>
                  <p className="admin-reviews-eyebrow">CUSTOMER ACTIVITY</p>
                  <h2>
                    {filteredReviews.length}{" "}
                    {filteredReviews.length === 1 ? "review" : "reviews"} shown
                  </h2>
                </div>
              </div>

              {filteredReviews.map((review) => {
                const rating = Math.min(
                  Math.max(Math.round(getRating(review)), 0),
                  5
                );

                const customerName = maskCustomerName(
                  review.customerName || review.name,
                  review.customerEmail || review.email
                );

                const customerEmail =
                  review.customerEmail ||
                  review.email ||
                  "No email";

                const currentStatus = review.status || "Pending";

                return (
                  <article className="admin-review-card" key={review.id}>
                    <div className="admin-review-card-header">
                      <div className="customer-profile">
                        <ReviewCustomerAvatar
                          photoURL={review.photoURL}
                          customerName={customerName}
                        />

                        <div className="customer-profile-copy">
                          <span className="review-label">CUSTOMER</span>
                          <h3>{customerName}</h3>
                          <p>{customerEmail}</p>
                        </div>
                      </div>

                      <div className="review-card-summary">
                        <span
                          className={`review-status status-${getStatusClass(
                            currentStatus
                          )}`}
                        >
                          <span className="status-dot" />
                          {currentStatus}
                        </span>
                        <div className="review-rating">
                          <div className="rating-stars" aria-label={`${rating} out of 5 stars`}>
                            <span className="filled-stars">
                              {"★".repeat(rating)}
                            </span>
                            <span className="empty-stars">
                              {"★".repeat(5 - rating)}
                            </span>
                          </div>
                          <strong>{rating}/5 rating</strong>
                        </div>
                      </div>
                    </div>

                    <div className="review-feedback">
                      <span className="review-label">CUSTOMER FEEDBACK</span>
                      <p>“{getComment(review)}”</p>
                    </div>

                    <div className="admin-review-footer">
                      <span>
                        <span className="review-label">SUBMITTED</span>
                        <strong>{formatDate(review.createdAt)}</strong>
                      </span>
                      <span>
                        <span className="review-label">REVIEW ID</span>
                        <strong>#{review.id.slice(0, 8).toUpperCase()}</strong>
                      </span>
                    </div>

                  </article>
                );
              })}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

export default AdminReviews;