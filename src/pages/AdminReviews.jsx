import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminReviews.css";

function AdminReviews() {
  const navigate = useNavigate();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // =========================
  // LOAD REVIEWS
  // =========================
  const loadReviews = async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "reviews")
      );

      const reviewList = snapshot.docs.map((reviewDoc) => ({
        id: reviewDoc.id,
        ...reviewDoc.data(),
      }));

      // Newest reviews first
      reviewList.sort((a, b) => {
        const dateA = a.createdAt?.toDate
          ? a.createdAt.toDate()
          : new Date(0);

        const dateB = b.createdAt?.toDate
          ? b.createdAt.toDate()
          : new Date(0);

        return dateB - dateA;
      });

      setReviews(reviewList);
    } catch (err) {
      console.error("Error loading reviews:", err);

      setError(
        "Unable to load reviews. Please try again."
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

          // Get the logged-in user's profile
          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const userSnapshot = await getDoc(userRef);

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
          await loadReviews();
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
  // FORMAT DATE
  // =========================
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return "Date unavailable";
    }

    return timestamp.toDate().toLocaleString();
  };

  // =========================
  // GET RATING
  // =========================
  const getRating = (review) => {
    return review.rating ?? review.stars ?? 0;
  };

  // =========================
  // GET COMMENT
  // =========================
  const getComment = (review) => {
    return (
      review.comment ||
      review.review ||
      review.message ||
      "No comment provided."
    );
  };

  // =========================
  // DELETE REVIEW
  // =========================
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

      await deleteDoc(
        doc(db, "reviews", reviewId)
      );

      // Remove the deleted review from the screen
      setReviews((currentReviews) =>
        currentReviews.filter(
          (review) => review.id !== reviewId
        )
      );

      alert(
        "Review deleted successfully! 🌵"
      );
    } catch (err) {
      console.error(
        "Error deleting review:",
        err
      );

      alert(
        "Unable to delete review. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  };

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="admin-reviews-page">
        <div className="admin-reviews-container">
          <p className="admin-reviews-loading">
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
    <main className="admin-reviews-page">
      <div className="admin-reviews-container">

        {/* HEADER */}
        <header className="admin-reviews-header">
          <div>
            <p className="admin-reviews-eyebrow">
              CACTUS CAFE
            </p>

            <h1>Customer Reviews</h1>

            <p>
              View and manage feedback and ratings
              submitted by Cactus Cafe customers.
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
          <div className="admin-reviews-error">
            {error}
          </div>
        )}

        {/* EMPTY */}
        {!error && reviews.length === 0 && (
          <div className="admin-reviews-empty">
            <div className="empty-icon">
              ⭐
            </div>

            <h2>No Reviews Yet</h2>

            <p>
              Customer reviews will appear here
              after customers submit feedback.
            </p>
          </div>
        )}

        {/* REVIEWS */}
        {reviews.length > 0 && (
          <section className="admin-reviews-list">

            {/* REVIEW COUNT */}
            <div className="reviews-count">
              Total Reviews:{" "}
              <strong>
                {reviews.length}
              </strong>
            </div>

            {/* REVIEW CARDS */}
            {reviews.map((review) => {
              const rating =
                Number(getRating(review)) || 0;

              const customerName =
                review.customerName ||
                review.name ||
                "Anonymous Customer";

              const customerEmail =
                review.customerEmail ||
                review.email ||
                "No email";

              return (
                <article
                  className="admin-review-card"
                  key={review.id}
                >

                  {/* REVIEW TOP */}
                  <div className="admin-review-top">

                    <div>
                      <span className="review-label">
                        CUSTOMER
                      </span>

                      <h2>
                        {customerName}
                      </h2>

                      <p className="review-email">
                        {customerEmail}
                      </p>
                    </div>

                    {/* RATING */}
                    <div className="review-rating">
                      {"⭐".repeat(
                        Math.min(
                          Math.max(
                            Math.round(rating),
                            0
                          ),
                          5
                        )
                      )}

                      <span>
                        {rating}/5
                      </span>
                    </div>

                  </div>

                  {/* CUSTOMER FEEDBACK */}
                  <div className="admin-review-comment">
                    <span className="review-label">
                      CUSTOMER FEEDBACK
                    </span>

                    <p>
                      "{getComment(review)}"
                    </p>
                  </div>

                  {/* FOOTER */}
                  <div className="admin-review-footer">

                    <span>
                      Submitted:{" "}
                      {formatDate(
                        review.createdAt
                      )}
                    </span>

                    <span>
                      Review ID: {review.id}
                    </span>

                  </div>

                  {/* DELETE */}
                  <div className="admin-review-actions">

                    <button
                      type="button"
                      className="delete-review-button"
                      disabled={
                        deletingId === review.id
                      }
                      onClick={() =>
                        handleDeleteReview(
                          review.id,
                          customerName
                        )
                      }
                    >
                      {deletingId === review.id
                        ? "Deleting..."
                        : "Delete Review"}
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