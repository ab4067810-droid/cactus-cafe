import "../styles/MyReviews.css";
import { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../services/firebase";
import "../styles/MyReviews.css";

function MyReviews() {
  const [user, setUser] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const navigate = useNavigate();

  const loadReviews = async (currentUser) => {
    try {
      const reviewsQuery = query(
        collection(db, "reviews"),
        where("customerId", "==", currentUser.uid)
      );

      const snapshot = await getDocs(reviewsQuery);

      const reviewData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setReviews(reviewData);
    } catch (error) {
      console.error("Error loading reviews:", error);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        navigate("/login");
        return;
      }

      setUser(currentUser);

      await loadReviews(currentUser);

      setLoading(false);
    });

    return () => unsubscribe();
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      navigate("/login");
      return;
    }

    if (!comment.trim()) {
      setMessage("Please write a comment before submitting.");
      return;
    }

    try {
      setSubmitting(true);
      setMessage("");

      await addDoc(collection(db, "reviews"), {
        customerId: user.uid,
        customerEmail: user.email,
        rating: Number(rating),
        comment: comment.trim(),
        status: "Pending",
        createdAt: serverTimestamp(),
      });

      setComment("");
      setRating(5);

      await loadReviews(user);

      setMessage("Review submitted successfully! ⭐");
    } catch (error) {
      console.error("Error submitting review:", error);
      setMessage("Unable to submit review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="my-reviews-page">
        <p>Loading your reviews...</p>
      </main>
    );
  }

  return (
    <main className="my-reviews-page">
      <section className="reviews-container">

        <div className="reviews-header">
          <p className="reviews-eyebrow">CACTUS CAFE</p>

          <h1>My Reviews ⭐</h1>

          <p>
            Share your experience with Cactus Cafe.
          </p>
        </div>

        {/* SUBMIT REVIEW */}

        <section className="review-form-section">
          <h2>Write a Review</h2>

          {message && (
            <div className="review-message">
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit}>

            <div className="review-form-group">
              <label htmlFor="rating">
                Rating
              </label>

              <select
                id="rating"
                value={rating}
                onChange={(event) =>
                  setRating(event.target.value)
                }
              >
                <option value="5">⭐⭐⭐⭐⭐ Excellent</option>
                <option value="4">⭐⭐⭐⭐ Very Good</option>
                <option value="3">⭐⭐⭐ Good</option>
                <option value="2">⭐⭐ Fair</option>
                <option value="1">⭐ Poor</option>
              </select>
            </div>

            <div className="review-form-group">
              <label htmlFor="comment">
                Your Review
              </label>

              <textarea
                id="comment"
                value={comment}
                onChange={(event) =>
                  setComment(event.target.value)
                }
                placeholder="Tell us about your experience..."
                rows="5"
                required
              />
            </div>

            <button
              type="submit"
              className="submit-review-button"
              disabled={submitting}
            >
              {submitting
                ? "Submitting..."
                : "Submit Review"}
            </button>

          </form>
        </section>

        {/* EXISTING REVIEWS */}

        <section className="existing-reviews">
          <h2>Your Reviews</h2>

          {reviews.length === 0 ? (
            <div className="no-reviews">
              <h3>No reviews yet</h3>

              <p>
                Your submitted reviews will appear here.
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
                    <strong>
                      {"⭐".repeat(Number(review.rating))}
                    </strong>

                    <span>
                      {review.status || "Pending"}
                    </span>
                  </div>

                  <p className="review-comment">
                    {review.comment}
                  </p>

                  <small>
                    Status: {review.status || "Pending"}
                  </small>
                </article>
              ))}

            </div>
          )}
        </section>

        <div className="reviews-actions">
          <button
            onClick={() => navigate("/customer")}
          >
            Back to Dashboard
          </button>
        </div>

      </section>
    </main>
  );
}

export default MyReviews;