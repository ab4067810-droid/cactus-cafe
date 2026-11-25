import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { Link } from "react-router-dom";

import { useAuth } from "../context/Authcontext";
import { useCart } from "../context/CartContext";
import { auth, db } from "../services/firebase";
import "../styles/Favorites.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

function Favorites() {
  const { user, loading: authLoading } = useAuth();
  const { addToCart } = useCart();
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [menuItemsById, setMenuItemsById] = useState({});
  const [loadedUserId, setLoadedUserId] = useState("");
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [addedId, setAddedId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const addedTimer = useRef(null);
  const userId = user?.uid;
  const isAuthenticated = Boolean(userId && auth.currentUser?.uid === userId);

  useEffect(() => {
    if (authLoading || !userId || auth.currentUser?.uid !== userId) {
      return undefined;
    }

    let active = true;
    let menuLoaded = false;
    let favoritesLoaded = false;
    const markReady = () => {
      if (active && menuLoaded && favoritesLoaded) {
        setLoadedUserId(userId);
      }
    };

    getDocs(collection(db, "menuItems"))
      .then((snapshot) => {
        if (!active) return;
        const itemsById = Object.fromEntries(
          snapshot.docs.map((menuItem) => [
            menuItem.id,
            { ...menuItem.data(), id: menuItem.id },
          ])
        );
        setMenuItemsById(itemsById);
      })
      .catch((loadError) => {
        console.error("Error loading menu items for favorites:", loadError);
        if (active) {
          setError("Your menu items could not be loaded. Please try again.");
        }
      })
      .finally(() => {
        if (active) {
          menuLoaded = true;
          markReady();
        }
      });

    const unsubscribe = onSnapshot(
      collection(db, "users", userId, "favorites"),
      (snapshot) => {
        if (!active) return;
        setFavoriteIds(snapshot.docs.map((favorite) => favorite.id));
        favoritesLoaded = true;
        markReady();
      },
      (loadError) => {
        console.error("Error loading saved favorites:", loadError);
        if (active) {
          setError("Your saved favorites could not be loaded. Please try again.");
          favoritesLoaded = true;
          markReady();
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authLoading, reloadKey, userId]);

  useEffect(
    () => () => window.clearTimeout(addedTimer.current),
    []
  );

  const favoriteItems = useMemo(
    () => favoriteIds.map((id) => menuItemsById[id]).filter(Boolean),
    [favoriteIds, menuItemsById]
  );

  const removeFavorite = async (itemId) => {
    if (!isAuthenticated || removingId) return;

    try {
      setRemovingId(itemId);
      setError("");
      await deleteDoc(doc(db, "users", userId, "favorites", itemId));
    } catch (removeError) {
      console.error("Error removing saved favorite:", removeError);
      setError("We couldn't remove that favorite. Please try again.");
    } finally {
      setRemovingId("");
    }
  };

  const handleAddToCart = (item) => {
    addToCart(item);
    setAddedId(item.id);
    window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => setAddedId(""), 1000);
  };

  if (authLoading || (isAuthenticated && loadedUserId !== userId)) {
    return (
      <main className="favorites-page">
        <div className="favorites-shell">
          <header className="favorites-header">
            <p className="favorites-eyebrow">YOUR CACTUS CAFÉ PICKS</p>
            <h1>Favorites</h1>
            <p>Keep the treats you love close, and add them to your cart anytime.</p>
          </header>
          <section
            className="favorites-grid favorites-skeleton-grid"
            role="status"
            aria-label="Loading favorites"
            aria-busy="true"
          >
            {[1, 2, 3].map((item) => (
              <article className="favorite-skeleton-card" key={item} aria-hidden="true">
                <span className="favorite-skeleton-image" />
                <span className="favorite-skeleton-content">
                  <span className="favorite-skeleton-line favorite-skeleton-category" />
                  <span className="favorite-skeleton-line favorite-skeleton-title" />
                  <span className="favorite-skeleton-line" />
                  <span className="favorite-skeleton-line favorite-skeleton-description" />
                  <span className="favorite-skeleton-line favorite-skeleton-footer" />
                </span>
              </article>
            ))}
          </section>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="favorites-page">
        <section className="favorites-empty">
          <h1>Log in to view your favorites</h1>
          <p>Your saved menu items are available when you’re signed in.</p>
          <Link className="favorites-primary-link" to="/login">
            Log In
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="favorites-page">
      <div className="favorites-shell">
        <header className="favorites-header">
          <p className="favorites-eyebrow">YOUR CACTUS CAFÉ PICKS</p>
          <h1>Favorites</h1>
          <p>Keep the treats you love close, and add them to your cart anytime.</p>
        </header>

        {error && (
          <div className="favorites-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoadedUserId("");
                setReloadKey((key) => key + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}

        {favoriteItems.length > 0 ? (
          <section className="favorites-grid" aria-label="Saved menu items">
            {favoriteItems.map((item) => {
              const imageUrl =
                typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";

              return (
                <article className="favorite-card" key={item.id}>
                  {imageUrl ? (
                    <img
                      className="favorite-card-image"
                      src={imageUrl}
                      alt={item.name || "Menu item"}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="favorite-card-image favorite-image-placeholder">
                      <span aria-hidden="true">☕</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="favorite-remove-button"
                    aria-label={`Remove ${item.name} from favorites`}
                    onClick={() => removeFavorite(item.id)}
                    disabled={Boolean(removingId)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
                    </svg>
                  </button>

                  <div className="favorite-card-content">
                    <p className="favorite-card-category">
                      {item.category || "Cafe favorite"}
                    </p>
                    <h2>{item.name || "Menu item"}</h2>
                    <p className="favorite-card-description">
                      {item.description || "Freshly prepared at Cactus Cafe."}
                    </p>
                    <div className="favorite-card-footer">
                      <strong>{formatPrice(item.price)}</strong>
                      <button
                        type="button"
                        className="favorites-add-button"
                        onClick={() => handleAddToCart(item)}
                        disabled={item.available === false}
                      >
                        {item.available === false
                          ? "Unavailable"
                          : addedId === item.id
                            ? "Added!"
                            : "Add to Cart"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          !error && (
            <section className="favorites-empty">
              <span className="favorites-empty-heart" aria-hidden="true">♡</span>
              <h2>No favorites saved yet</h2>
              <p>Tap the heart on any menu item to save it here.</p>
              <Link className="favorites-primary-link" to="/menu">
                Explore the Menu
              </Link>
            </section>
          )
        )}
      </div>
    </main>
  );
}

export default Favorites;
