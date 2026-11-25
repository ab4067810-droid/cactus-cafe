import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { Link } from "react-router-dom";
import { db } from "../services/firebase";
import { maskCustomerName } from "../utils/maskCustomerName";
import SiteFooter from "../components/SiteFooter";
import "../styles/HomePage.css";

const cafeImages = {
  hero: "/img0.jpg",
  coffee: "/img1.jpg",
  pastry: "/img2.jpg",
  interior: "/img3.jpg",
};

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

function PublicReviewAvatar({ photoURL, displayName }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl = typeof photoURL === "string" ? photoURL.trim() : "";
  const initial = Array.from(displayName || "")[0] || "";

  return (
    <span className="public-review-avatar" aria-hidden="true">
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
    </span>
  );
}

function HomePage() {
  const [publicReviews, setPublicReviews] = useState([]);
  const [showAllPublicReviews, setShowAllPublicReviews] = useState(false);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState(false);
  const [reviewLoadAttempt, setReviewLoadAttempt] = useState(0);
  const [menuItems, setMenuItems] = useState([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState(false);
  const visiblePublicReviews = showAllPublicReviews
    ? publicReviews
    : publicReviews.slice(0, 6);

  useEffect(() => {
    let isCurrent = true;

    const loadPublicReviews = async () => {
      try {
        setReviewsLoading(true);
        setReviewsError(false);

        const reviewsQuery = query(
          collection(db, "publicReviews"),
          orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(reviewsQuery);

        if (isCurrent) {
          setPublicReviews(
            snapshot.docs.map((reviewDoc) => ({
              id: reviewDoc.id,
              ...reviewDoc.data(),
            }))
          );
        }
      } catch (error) {
        console.error("Error loading public reviews:", error);

        if (isCurrent) {
          setReviewsError(true);
        }
      } finally {
        if (isCurrent) {
          setReviewsLoading(false);
        }
      }
    };

    loadPublicReviews();

    return () => {
      isCurrent = false;
    };
  }, [reviewLoadAttempt]);

  useEffect(() => {
    let isCurrent = true;

    const loadMenuItems = async () => {
      try {
        const snapshot = await getDocs(collection(db, "menuItems"));

        if (isCurrent) {
          setMenuItems(
            snapshot.docs.map((menuDoc) => ({
              id: menuDoc.id,
              ...menuDoc.data(),
            }))
          );
        }
      } catch (error) {
        console.error("Error loading featured menu items:", error);

        if (isCurrent) {
          setMenuError(true);
        }
      } finally {
        if (isCurrent) {
          setMenuLoading(false);
        }
      }
    };

    loadMenuItems();

    return () => {
      isCurrent = false;
    };
  }, []);

  const availableMenuItems = menuItems.filter(
    (item) => item.available !== false
  );
  const featuredMenuItems = [
    ...new Map(
      [
        ...availableMenuItems.filter((item) => item.featured === true),
        ...availableMenuItems.filter((item) => item.popular === true),
        ...availableMenuItems,
      ].map((item) => [item.id, item])
    ).values(),
  ].slice(0, 6);

  return (
    <>
      <main className="home-page">
        <section className="home-hero">
          <div className="hero-content">
            <p className="hero-eyebrow">A LITTLE PAUSE, MADE FRESH</p>

            <h1 className="home-title">
              Good coffee.
              <br />
              Better moments.
            </h1>

            <p className="home-subtitle">
              Find your quiet corner for carefully brewed coffee, fresh
              pastries, and comforting café favorites.
            </p>

            <div className="hero-actions">
              <Link to="/menu" className="primary-button">
                Explore our menu
              </Link>

              <Link to="/about" className="text-button">
                Get to know us
              </Link>
            </div>
          </div>

          <div className="hero-visual">
            <img
              src={cafeImages.hero}
              alt="A welcoming café setting at Cactus Café"
            />

            <p>Made for your everyday moments</p>
          </div>
        </section>

        <section className="home-intro" aria-labelledby="intro-title">
          <p className="section-eyebrow">YOUR NEIGHBORHOOD CAFÉ</p>
          <h2 id="intro-title">A good cup can change the pace of a day.</h2>
          <p>
            At Cactus Café, we make space for the small things worth
            savoring—from the first sip of coffee to one more story shared
            around the table.
          </p>
        </section>

        <section
          className="home-featured-menu"
          aria-labelledby="featured-menu-title"
        >
          <div className="featured-menu-heading">
            <div>
              <p className="section-eyebrow">FROM OUR COUNTER, WITH CARE</p>
              <h2 id="featured-menu-title">A few café favorites</h2>
            </div>
            <Link to="/menu" className="primary-button">
              Explore Full Menu
            </Link>
          </div>

          {menuLoading ? (
            <div
              className="featured-menu-grid featured-menu-skeleton-grid"
              role="status"
              aria-label="Loading featured menu"
              aria-busy="true"
            >
              {[1, 2, 3].map((item) => (
                <article
                  className="featured-menu-card featured-menu-skeleton-card"
                  key={item}
                  aria-hidden="true"
                >
                  <div className="featured-menu-image home-skeleton-image" />
                  <div className="featured-menu-copy">
                    <span className="home-skeleton-shape home-skeleton-category" />
                    <span className="home-skeleton-shape home-skeleton-title" />
                    <span className="home-skeleton-shape home-skeleton-description" />
                    <span className="home-skeleton-shape home-skeleton-price" />
                  </div>
                </article>
              ))}
            </div>
          ) : menuError ? (
            <p className="featured-menu-message" role="alert">
              The menu could not be loaded right now.
            </p>
          ) : featuredMenuItems.length === 0 ? (
            <p className="featured-menu-message">
              No menu items are available right now.
            </p>
          ) : (
            <div className="featured-menu-grid">
              {featuredMenuItems.map((item) => (
                <article className="featured-menu-card" key={item.id}>
                  {typeof item.imageUrl === "string" && item.imageUrl.trim() ? (
                    <img
                      className="featured-menu-image"
                      src={item.imageUrl}
                      alt={item.name || "Cactus Cafe menu item"}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="featured-menu-image featured-menu-image-placeholder"
                      role="img"
                      aria-label={`No photo available for ${item.name || "menu item"}`}
                    >
                      <span aria-hidden="true">☕</span>
                    </div>
                  )}
                  <div className="featured-menu-copy">
                    {item.category && (
                      <p className="featured-menu-category">
                        {item.category}
                      </p>
                    )}
                    <h3>{item.name}</h3>
                    <p>
                      {item.description || "Freshly prepared at Cactus Cafe."}
                    </p>
                    {item.price !== undefined &&
                      item.price !== null &&
                      item.price !== "" && (
                        <strong>{formatPrice(item.price)}</strong>
                      )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="home-reviews" aria-labelledby="reviews-title">
          <div className="reviews-heading">
            <p className="section-eyebrow">KIND WORDS FROM OUR COMMUNITY</p>
            <h2 id="reviews-title">Good coffee, kind words.</h2>
          </div>

          {reviewsLoading ? (
            <div
              className="public-review-grid public-review-skeleton-grid"
              role="status"
              aria-label="Loading customer reviews"
              aria-busy="true"
            >
              {[1, 2, 3].map((item) => (
                <article
                  className="public-review public-review-skeleton-card"
                  key={item}
                  aria-hidden="true"
                >
                  <span className="home-skeleton-shape home-skeleton-rating" />
                  <span className="home-skeleton-shape home-skeleton-quote" />
                  <span className="home-skeleton-shape home-skeleton-quote home-skeleton-quote-short" />
                  <span className="home-skeleton-shape home-skeleton-byline" />
                </article>
              ))}
            </div>
          ) : reviewsError ? (
            <div className="reviews-message" role="alert">
              <p>Reviews could not be loaded right now.</p>
              <button
                type="button"
                className="reviews-retry-button"
                onClick={() => setReviewLoadAttempt((attempt) => attempt + 1)}
              >
                Try again
              </button>
            </div>
          ) : publicReviews.length === 0 ? (
            <p className="reviews-message">
              No reviews to share just yet.
            </p>
          ) : (
            <div className="public-review-grid">
              {visiblePublicReviews.map((review) => {
                const rating = Math.min(
                  5,
                  Math.max(0, Number(review.rating) || 0)
                );
                const displayName = maskCustomerName(review.displayName, "");
                const reviewDate = review.createdAt?.toDate
                  ? review.createdAt.toDate()
                  : null;

                return (
                  <article className="public-review" key={review.id}>
                    <div
                      className="public-review-rating"
                      aria-label={`Rating: ${review.rating} out of 5`}
                    >
                      <span aria-hidden="true">
                        {"★".repeat(Math.round(rating))}
                        {"☆".repeat(5 - Math.round(rating))}
                      </span>
                      <span>{review.rating}/5</span>
                    </div>

                    <p className="public-review-comment">“{review.comment}”</p>

                    <div className="public-review-byline">
                      <div className="public-review-author">
                        <PublicReviewAvatar
                          photoURL={review.photoURL}
                          displayName={displayName}
                        />
                        <strong>{displayName}</strong>
                      </div>
                      <time
                        dateTime={reviewDate?.toISOString()}
                        className="public-review-date"
                      >
                        {reviewDate
                          ? reviewDate.toLocaleDateString("en-PH", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })
                          : "Date unavailable"}
                      </time>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!reviewsLoading &&
            !reviewsError &&
            publicReviews.length > 6 && (
              <button
                type="button"
                className="public-reviews-toggle"
                onClick={() =>
                  setShowAllPublicReviews((showingAll) => !showingAll)
                }
              >
                {showAllPublicReviews
                  ? "Show fewer reviews"
                  : `Show other customer reviews (${publicReviews.length - 6})`}
              </button>
            )}
        </section>

        <section className="home-features" aria-labelledby="features-title">
          <div className="features-heading">
            <div>
              <p className="section-eyebrow">THE LITTLE THINGS, DONE WELL</p>
              <h2 id="features-title">Thoughtful moments, made daily.</h2>
            </div>

            <Link to="/menu" className="text-button">
              Find Your Favorite
            </Link>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <img
                className="feature-image"
                src={cafeImages.coffee}
                alt="A freshly prepared cup of coffee"
                loading="lazy"
              />

              <div className="feature-copy">
                <span className="feature-number">01 / BREWED WITH CARE</span>

                <h3>Thoughtful coffee</h3>

                <p>Good beans, carefully brewed, and always worth a pause.</p>
              </div>
            </article>

            <article className="feature-card">
              <img
                className="feature-image"
                src={cafeImages.pastry}
                alt="A freshly baked café pastry"
                loading="lazy"
              />

              <div className="feature-copy">
                <span className="feature-number">02 / FRESH EACH DAY</span>

                <h3>A little something fresh</h3>

                <p>
                  Comforting bites and pastries made for an easy, happy
                  break.
                </p>
              </div>
            </article>

            <article className="feature-card">
              <img
                className="feature-image"
                src={cafeImages.interior}
                alt="A calm and welcoming café interior"
                loading="lazy"
              />

              <div className="feature-copy">
                <span className="feature-number">03 / ROOM TO UNWIND</span>

                <h3>Come as you are</h3>

                <p>
                  Settle in for a catch-up, a little work, or a moment to
                  yourself.
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

export default HomePage;