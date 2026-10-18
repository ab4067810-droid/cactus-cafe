import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
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

function MyReviews() {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login");
          return;
        }

        setUser(currentUser);
        await loadReviews(currentUser);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [loadReviews, navigate]);

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

    if (!user) {
      navigate("/login");
      return;
    }

    if (!comment.trim()) {
      setMessage("Please write a comment before submitting.");
      setMessageType("error");
      return;
    }

    try {
      setSubmitting(true);

      await addDoc(collection(db, "reviews"), {
        customerId: user.uid,
        customerEmail: user.email || "",
        rating: Number(rating),
        comment: comment.trim(),
        status: "Pending",
        createdAt: serverTimestamp(),
      });

      setComment("");
      setRating(5);

      await loadReviews(user);

      setMessage(
        "Thank you. Your review has been submitted for approval."
      );
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

  if (loading) {
    return (
      <main className="my-reviews-page">
        <section className="reviews-container reviews-loading">
          <div className="reviews-loading-line short" />
          <div className="reviews-loading-line large" />
          <div className="reviews-loading-card" />
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

            <h1>Your cafe experience matters.</h1>

            <p>
              Share what you loved, what could improve, and help
              us make every visit better.
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
            Reviews are reviewed by our cafe team before
            publication.
          </div>
        </section>

        {loadError && (
          <div className="reviews-error" role="alert">
            <span className="message-icon">!</span>
            <p>{loadError}</p>

            <button
              type="button"
              onClick={() => user && loadReviews(user)}
            >
              Try again
            </button>
          </div>
        )}

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
              </fieldset>

              <div className="review-form-group">
                <label htmlFor="comment">
                  Your review
                </label>

                <textarea
                  id="comment"
                  value={comment}
                  onChange={(event) =>
                    setComment(event.target.value)
                  }
                  placeholder="Tell us about your coffee, meal, or cafe experience..."
                  rows="6"
                  maxLength="500"
                  required
                />

                <div className="character-count">
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

            {reviews.length === 0 ? (
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
                {reviews.map((review) => (
                  <article
                    className="review-card"
                    key={review.id}
                  >
                    <div className="review-card-header">
                      <div>
                        <div className="review-stars">
                          {"★".repeat(Number(review.rating || 0))}
                          <span className="empty-stars">
                            {"★".repeat(
                              5 - Number(review.rating || 0)
                            )}
                          </span>
                        </div>

                        <p className="review-date">
                          {formatDate(review.createdAt)}
                        </p>
                      </div>

                      <span
                        className={`review-status status-${getStatusClass(
                          review.status
                        )}`}
                      >
                        {review.status || "Pending"}
                      </span>
                    </div>

                    <p className="review-comment">
                      “{review.comment}”
                    </p>

                    <div className="review-card-footer">
                      <span>
                        {review.status === "Approved"
                          ? "Published review"
                          : "Awaiting cafe review"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default MyReviews;