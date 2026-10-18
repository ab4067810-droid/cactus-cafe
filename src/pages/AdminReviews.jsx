import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminReviews.css";

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

function AdminReviews() {
  const navigate = useNavigate();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState(null);

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

  const handleDeleteReview = async (
    reviewId,
    customerName
  ) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this review from ${
        customerName || "this customer"
      }?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(reviewId);
      setNotice("");

      await deleteDoc(doc(db, "reviews", reviewId));

      setReviews((currentReviews) =>
        currentReviews.filter(
          (review) => review.id !== reviewId
        )
      );

      setNotice("Review deleted successfully.");
    } catch (deleteError) {
      console.error("Error deleting review:", deleteError);
      setNotice(
        "Unable to delete review. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <main className="admin-reviews-page">
        <section className="admin-reviews-loading">
          <div className="loading-icon">★</div>
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
      <div className="admin-reviews-container">
        <header className="admin-reviews-header">
          <div>
            <p className="admin-reviews-eyebrow">
              GUEST EXPERIENCE
            </p>

            <h1>Customer reviews</h1>

            <p>
              Understand what customers love about Cactus Cafe
              and where the experience can improve.
            </p>
          </div>

          <div className="admin-reviews-header-actions">
            <button
              type="button"
              className="admin-refresh-button"
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

        <section className="reviews-overview">
          <div className="overview-stat">
            <span>Total reviews</span>
            <strong>{statistics.total}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Average rating</span>
            <strong>
              {statistics.average}
              <small>/5</small>
            </strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Pending review</span>
            <strong>{statistics.pending}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Approved</span>
            <strong>{statistics.approved}</strong>
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
              onClick={loadReviews}
            >
              Try again
            </button>
          </div>
        )}

        <section className="reviews-toolbar">
          <div>
            <p className="admin-reviews-eyebrow">
              FEEDBACK LIBRARY
            </p>

            <h2>Manage customer feedback</h2>
          </div>

          <div className="reviews-toolbar-actions">
            <label className="reviews-search">
              <span>⌕</span>

              <input
                type="search"
                placeholder="Search reviews"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
              />
            </label>

            <select
              className="review-filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
            >
              {REVIEW_STATUSES.map((status) => (
                <option value={status} key={status}>
                  {status === "All"
                    ? "All statuses"
                    : status}
                </option>
              ))}
            </select>
          </div>
        </section>

        {!error && reviews.length === 0 && (
          <section className="admin-reviews-empty">
            <div className="empty-icon">★</div>

            <p className="admin-reviews-eyebrow">
              FEEDBACK LIBRARY
            </p>

            <h2>No reviews yet</h2>

            <p>
              Customer feedback will appear here after customers
              submit a review.
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
                Try another search term or choose a different
                status.
              </p>
            </section>
          )}

        {!error && filteredReviews.length > 0 && (
          <section className="admin-reviews-list">
            <div className="reviews-list-heading">
              <div>
                <p className="admin-reviews-eyebrow">
                  CUSTOMER VOICE
                </p>

                <h2>
                  {filteredReviews.length}{" "}
                  {filteredReviews.length === 1
                    ? "review"
                    : "reviews"}{" "}
                  shown
                </h2>
              </div>
            </div>

            {filteredReviews.map((review) => {
              const rating = Math.min(
                Math.max(Math.round(getRating(review)), 0),
                5
              );

              const customerName =
                review.customerName ||
                review.name ||
                "Anonymous Customer";

              const customerEmail =
                review.customerEmail ||
                review.email ||
                "No email";

              const currentStatus =
                review.status || "Pending";

              return (
                <article
                  className="admin-review-card"
                  key={review.id}
                >
                  <div className="admin-review-card-header">
                    <div className="customer-profile">
                      <div className="customer-avatar">
                        {customerName.charAt(0).toUpperCase()}
                      </div>

                      <div>
                        <span className="review-label">
                          CUSTOMER
                        </span>

                        <h3>{customerName}</h3>

                        <p>{customerEmail}</p>
                      </div>
                    </div>

                    <div className="review-rating">
                      <div className="rating-stars">
                        <span className="filled-stars">
                          {"★".repeat(rating)}
                        </span>

                        <span className="empty-stars">
                          {"★".repeat(5 - rating)}
                        </span>
                      </div>

                      <strong>{rating}/5</strong>
                    </div>
                  </div>

                  <div className="review-feedback">
                    <div className="feedback-heading">
                      <span className="review-label">
                        CUSTOMER FEEDBACK
                      </span>

                      <span
                        className={`review-status status-${getStatusClass(
                          currentStatus
                        )}`}
                      >
                        {currentStatus}
                      </span>
                    </div>

                    <p>“{getComment(review)}”</p>
                  </div>

                  <div className="admin-review-footer">
                    <span>
                      Submitted: {formatDate(review.createdAt)}
                    </span>

                    <span>
                      ID: {review.id.slice(0, 8)}
                    </span>
                  </div>

                  <div className="admin-review-actions">
                    <button
                      type="button"
                      className="delete-review-button"
                      disabled={deletingId === review.id}
                      onClick={() =>
                        handleDeleteReview(
                          review.id,
                          customerName
                        )
                      }
                    >
                      {deletingId === review.id
                        ? "Deleting..."
                        : "Delete review"}
                    </button>
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

export default AdminReviews;