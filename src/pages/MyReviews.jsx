import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Link, useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import { maskCustomerName } from "../utils/maskCustomerName";
import "../styles/MyReviews.css";

const RATING_OPTIONS = [
  { value: 5, label: "Excellent" },
  { value: 4, label: "Very good" },
  { value: 3, label: "Good" },
  { value: 2, label: "Fair" },
  { value: 1, label: "Poor" },
];

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Recently submitted";
  }

  return timestamp.toDate().toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getStatusClass = (status) =>
  String(status || "Pending")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

const isCompletedOrder = (status) => {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  return normalizedStatus.includes("complete") || normalizedStatus === "delivered";
};

function MyReviews() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [completedOrderCount, setCompletedOrderCount] = useState(0);
  const [ordersError, setOrdersError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [loadError, setLoadError] = useState("");

  const loadReviews = useCallback(async (currentUser) => {
    try {
      setLoadError("");

      const reviewsQuery = query(
        collection(db, "reviews"),
        where("customerId", "==", currentUser.uid)
      );

      const snapshot = await getDocs(reviewsQuery);

      const reviewData = snapshot.docs
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

      setReviews(reviewData);
    } catch (error) {
      console.error("Error loading reviews:", error);
      setLoadError(
        "Unable to load your reviews. Please try again."
      );
    }
  }, []);

  const loadCompletedOrderCount = useCallback(async (currentUser) => {
    try {
      setOrdersError("");
      const ordersQuery = query(
        collection(db, "orders"),
        where("customerId", "==", currentUser.uid)
      );
      const snapshot = await getDocs(ordersQuery);
      const completedCount = snapshot.docs.filter((orderDoc) =>
        isCompletedOrder(orderDoc.data().status)
      ).length;

      setCompletedOrderCount(completedCount);
    } catch (error) {
      console.error("Error checking completed orders for reviews:", error);
      setOrdersError(
        "Unable to verify completed orders. Please try again."
      );
    }
  }, []);

  const loadReviewData = useCallback(async (currentUser) => {
    setLoading(true);
    await Promise.all([
      loadReviews(currentUser),
      loadCompletedOrderCount(currentUser),
    ]);
    setLoading(false);
  }, [loadCompletedOrderCount, loadReviews]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        setUser(currentUser);
        await loadReviewData(currentUser);
      }
    );

    return () => unsubscribe();
  }, [loadReviewData, navigate]);

  const averageRating = useMemo(() => {
    if (reviews.length === 0) {
      return "0.0";
    }

    const total = reviews.reduce(
      (sum, review) => sum + Number(review.rating || 0),
      0
    );

    return (total / reviews.length).toFixed(1);
  }, [reviews]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setMessage("");
    setMessageType("");
    if (submitting) return;

    if (!user) {
      navigate("/login");
      return;
    }

    if (ordersError || loadError) {
      setMessage("Unable to verify review eligibility. Please try again.");
      setMessageType("error");
      return;
    }

    if (completedOrderCount === 0) {
      setMessage("Complete at least one order before leaving feedback.");
      setMessageType("error");
      return;
    }

    if (reviews.length >= completedOrderCount) {
      setMessage(
        "You have already submitted feedback for each completed order."
      );
      setMessageType("error");
      return;
    }

    if (!comment.trim()) {
      setMessage("Please write a comment before submitting.");
      setMessageType("error");
      return;
    }

    try {
      setSubmitting(true);

      const reviewRef = doc(collection(db, "reviews"));
      const publicReviewRef = doc(db, "publicReviews", reviewRef.id);
      const trimmedComment = comment.trim();
      const photoURL =
        typeof user.photoURL === "string" ? user.photoURL : "";
      const batch = writeBatch(db);

      batch.set(reviewRef, {
        customerId: user.uid,
        customerEmail: user.email || "",
        customerName: user.displayName || "",
        photoURL,
        rating: Number(rating),
        comment: trimmedComment,
        status: "Approved",
        createdAt: serverTimestamp(),
      });
      batch.set(publicReviewRef, {
        rating: Number(rating),
        comment: trimmedComment,
        createdAt: serverTimestamp(),
        displayName: maskCustomerName(user.displayName, user.email),
        photoURL,
      });

      await batch.commit();

      setComment("");
      setRating(5);

      await loadReviews(user);

      setMessage("Thank you. Your review has been published.");
      setMessageType("success");
    } catch (error) {
      console.error("Error submitting review:", error);

      setMessage(
        "Unable to submit your review. Please try again."
      );
      setMessageType("error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewDataRetry = () => {
    if (user) {
      loadReviewData(user);
    }
  };

  if (loading) {
    return (
      <main className="my-reviews-page">
        <section
          className="reviews-container reviews-loading"
          aria-busy="true"
          aria-label="Loading your reviews"
        >
          <div className="reviews-loading-heading">
            <div className="reviews-loading-line short" />
            <div className="reviews-loading-line large" />
            <div className="reviews-loading-line medium" />
          </div>
          <div className="reviews-loading-overview" />
          <div className="reviews-loading-layout">
            <div className="reviews-loading-card form-skeleton" />
            <div className="reviews-loading-card list-skeleton" />
          </div>
          <p className="reviews-loading-label" role="status">
            Loading your review history...
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="my-reviews-page">
      <section className="reviews-container">
        <header className="reviews-header">
          <div>
            <p className="reviews-eyebrow">CACTUS CAFE</p>

            <h1>Tell us about your Cactus Café moments.</h1>

            <p>
              Your feedback helps us make every cup, bite, and visit a little
              better. Share your experience and keep track of your reviews here.
            </p>
          </div>

          <button
            type="button"
            className="reviews-back-button"
            onClick={() => navigate("/customer")}
          >
            ← Back to dashboard
          </button>
        </header>

        <section className="reviews-overview">
          <div className="overview-rating">
            <span className="overview-stars">★</span>

            <div>
              <strong>{averageRating}</strong>
              <span>Average rating</span>
            </div>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <strong>{reviews.length}</strong>
            <span>
              {reviews.length === 1 ? "Review submitted" : "Reviews submitted"}
            </span>
          </div>

          <div className="overview-note">
            <span>✦</span>
            Submit one review for each completed order. Reviews are published
            immediately.
          </div>
        </section>

        <div className="reviews-layout">
          <section className="review-form-section">
            <div className="section-heading">
              <p className="reviews-eyebrow">TELL US ABOUT IT</p>
              <h2>Write a review</h2>
              <p>
                Your feedback helps us improve the food, service,
                and atmosphere at Cactus Cafe.
              </p>
            </div>

            {message && (
              <div
                className={`review-message ${messageType}`}
                role="status"
              >
                <span className="message-icon">
                  {messageType === "success" ? "✓" : "!"}
                </span>
                <span>{message}</span>
              </div>
            )}

            {ordersError ? (
              <div
                className="review-eligibility-message error"
                role="alert"
              >
                <p>{ordersError}</p>
                <button
                  type="button"
                  onClick={handleReviewDataRetry}
                >
                  Try again
                </button>
              </div>
            ) : loadError ? (
              <div
                className="review-eligibility-message error"
                role="alert"
              >
                <p>Unable to verify your review history. Please try again.</p>
                <button
                  type="button"
                  onClick={handleReviewDataRetry}
                >
                  Try again
                </button>
              </div>
            ) : completedOrderCount === 0 ? (
              <div className="review-eligibility-message" role="status">
                <p>
                  Complete at least one order before leaving customer feedback.
                </p>
                <Link className="review-eligibility-link" to="/menu">
                  Browse the menu
                </Link>
              </div>
            ) : reviews.length >= completedOrderCount ? (
              <div className="review-eligibility-message" role="status">
                <p>
                  You have already submitted feedback for each completed order.
                  You can post again after another completed order.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <fieldset className="review-form-group">
                  <legend>Your rating</legend>

                  <div className="rating-picker">
                    {RATING_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={`rating-option ${
                          rating === option.value ? "selected" : ""
                        }`}
                        onClick={() => setRating(option.value)}
                        aria-label={`${option.value} out of 5, ${option.label}`}
                        aria-pressed={rating === option.value}
                      >
                        <span className="rating-number">
                          {option.value}
                        </span>

                        <span className="rating-stars">
                          {"★".repeat(option.value)}
                        </span>

                        <span className="rating-label">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  <p className="rating-hint">
                    {RATING_OPTIONS.find((option) => option.value === rating)?.label}
                  </p>
                </fieldset>

                <div className="review-form-group">
                  <label htmlFor="comment">Your review</label>

                  <textarea
                    id="comment"
                    value={comment}
                    onChange={(event) =>
                      setComment(event.target.value)
                    }
                    placeholder="Tell us about your coffee, meal, or cafe experience..."
                    rows="6"
                    maxLength="500"
                    aria-describedby="review-character-count"
                    required
                  />

                  <div className="character-count" id="review-character-count">
                    {comment.length}/500
                  </div>
                </div>

                <button
                  type="submit"
                  className="submit-review-button"
                  disabled={submitting}
                >
                  {submitting
                    ? "Submitting your review..."
                    : "Submit review"}
                </button>
              </form>
            )}
          </section>

          <section className="existing-reviews">
            <div className="section-heading reviews-list-heading">
              <div>
                <p className="reviews-eyebrow">YOUR FEEDBACK</p>
                <h2>Review history</h2>
              </div>

              <span className="review-count">
                {reviews.length}{" "}
                {reviews.length === 1 ? "review" : "reviews"}
              </span>
            </div>

            {loadError ? (
              <div className="reviews-error" role="alert">
                <span className="message-icon">!</span>
                <p>{loadError}</p>

                <button
                  type="button"
                  onClick={handleReviewDataRetry}
                >
                  Try again
                </button>
              </div>
            ) : reviews.length === 0 ? (
              <div className="no-reviews">
                <div className="empty-review-icon">★</div>

                <h3>Your first review starts here</h3>

                <p>
                  Share your Cactus Cafe experience and your
                  review will appear in this space.
                </p>
              </div>
            ) : (
              <div className="reviews-list">
                {reviews.map((review) => {
                  const status = review.status || "Pending";
                  const reviewRating = Math.min(
                    5,
                    Math.max(0, Number(review.rating) || 0)
                  );

                  return (
                    <article className="review-card" key={review.id}>
                      <div className="review-card-header">
                        <div className="review-rating-date">
                          <div
                            className="review-rating"
                            aria-label={`Rating: ${review.rating} out of 5`}
                          >
                            <span className="review-stars" aria-hidden="true">
                              {"★".repeat(Math.round(reviewRating))}
                              <span className="empty-stars">
                                {"★".repeat(5 - Math.round(reviewRating))}
                              </span>
                            </span>
                            <strong>{review.rating}/5</strong>
                          </div>

                          <p className="review-date">
                            <span>Submitted</span>
                            {formatDate(review.createdAt)}
                          </p>
                        </div>

                        <span
                          className={`review-status status-${getStatusClass(
                            status
                          )}`}
                        >
                          {status}
                        </span>
                      </div>

                      <p className="review-comment">“{review.comment}”</p>

                      <div className="review-card-footer">
                        <span>
                          {status === "Approved"
                            ? "Published review"
                            : status === "Rejected"
                              ? "Not approved for publication"
                              : "Awaiting café review"}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default MyReviews;