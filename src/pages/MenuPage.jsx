import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/Authcontext";
import { useCart } from "../context/CartContext";
import { auth, db } from "../services/firebase";
import SiteFooter from "../components/SiteFooter";
import "../styles/MenuPage.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

const drinkSizes = ["8oz", "12oz", "16oz"];

const getSizePrices = (item) => {
  const sizes = item?.sizes;
  if (
    !sizes
    || typeof sizes !== "object"
    || Array.isArray(sizes)
    || drinkSizes.some((size) => (
      !Object.hasOwn(sizes, size)
      || typeof sizes[size] !== "number"
      || !Number.isFinite(sizes[size])
      || sizes[size] < 0
    ))
  ) {
    return null;
  }
  return sizes;
};

const fetchMenuItems = async () => {
  const snapshot = await getDocs(collection(db, "menuItems"));
  return snapshot.docs.map((menuDoc) => ({
    ...menuDoc.data(),
    id: menuDoc.id,
  }));
};

function FavoriteToggleButton({
  item,
  isFavorite,
  isPending,
  onToggle,
}) {
  return (
    <button
      type="button"
      className={`menu-favorite-toggle${isFavorite ? " is-favorite" : ""}`}
      aria-label={
        isFavorite
          ? `Remove ${item.name} from favorites`
          : `Add ${item.name} to favorites`
      }
      aria-pressed={isFavorite}
      disabled={isPending}
      onClick={() => onToggle(item.id)}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
      </svg>
    </button>
  );
}

function ProductCard({
  item,
  onAdd,
  actionLabel,
  isFavorite,
  isFavoritePending,
  onToggleFavorite,
  featured = false,
}) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const [selectedSize, setSelectedSize] = useState("8oz");
  const sizePrices = getSizePrices(item);
  const selectedPrice = sizePrices ? sizePrices[selectedSize] : item.price;
  const cartItem = sizePrices
    ? { ...item, price: selectedPrice, selectedSize }
    : item;
  const imageUrl =
    typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";

  return (
    <article className={`menu-card ${featured ? "featured-product" : ""}`}>
      <FavoriteToggleButton
        item={item}
        isFavorite={isFavorite}
        isPending={isFavoritePending}
        onToggle={onToggleFavorite}
      />

      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          className="product-image"
          src={imageUrl}
          alt={item.name || "Menu item"}
          loading="lazy"
          decoding="async"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <div
          className="product-image product-image-placeholder"
          role="img"
          aria-label={`No photo available for ${item.name || "menu item"}`}
        >
          <span aria-hidden="true">☕</span>
        </div>
      )}

      <div className="product-card-content">
        <div className="product-card-top">
          <p className="menu-category">
            {item.category || "Cafe favorite"}
          </p>

          {(item.featured || item.popular) && (
            <span className="popular-badge">
              {item.featured ? "Featured" : "Popular"}
            </span>
          )}
        </div>

        <h3>{item.name}</h3>

        <p className="menu-description">
          {item.description || "Freshly prepared at Cactus Cafe."}
        </p>

        <div className="product-card-footer">
          <strong className="menu-price">
            {formatPrice(selectedPrice)}
          </strong>

          <div className="product-card-order">
            {sizePrices && (
              <SizeSelector
                item={item}
                selectedSize={selectedSize}
                onSelectSize={setSelectedSize}
              />
            )}
            <AddToCartButton
              item={cartItem}
              onAdd={onAdd}
              className="add-to-cart-button"
              actionLabel={actionLabel}
              disabled={item.available === false}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function SizeSelector({ item, selectedSize, onSelectSize }) {
  return (
    <div className="size-selector" role="group" aria-label={`${item.name} size`}>
      {drinkSizes.map((size) => (
        <button
          key={size}
          type="button"
          className={`size-selector-option${selectedSize === size ? " is-selected" : ""}`}
          aria-label={`Select ${size} for ${item.name}`}
          aria-pressed={selectedSize === size}
          onClick={() => onSelectSize(size)}
        >
          {size}
        </button>
      ))}
    </div>
  );
}

function AddToCartButton({
  item,
  onAdd,
  className,
  actionLabel,
  disabled = false,
}) {
  const [wasAdded, setWasAdded] = useState(false);
  const feedbackTimeout = useRef(null);

  useEffect(
    () => () => window.clearTimeout(feedbackTimeout.current),
    []
  );

  const handleAdd = () => {
    if (onAdd(item) === false) return;

    setWasAdded(true);
    window.clearTimeout(feedbackTimeout.current);
    feedbackTimeout.current = window.setTimeout(
      () => setWasAdded(false),
      900
    );
  };

  return (
    <button
      type="button"
      className={`${className}${wasAdded ? " is-added" : ""}`}
      aria-label={
        wasAdded
          ? `${item.name} added to your order`
          : `Add ${item.name}${item.selectedSize ? ` (${item.selectedSize})` : ""} to your order`
      }
      onClick={handleAdd}
      disabled={disabled}
    >
      <span aria-live="polite" aria-atomic="true">
        {disabled ? "Unavailable" : wasAdded ? "Added!" : actionLabel}
      </span>
    </button>
  );
}

function FeaturedHero({
  item,
  onAdd,
  isFavorite,
  isFavoritePending,
  onToggleFavorite,
  isActive,
  slideDirection,
  slideKey,
}) {
  const imageUrl =
    typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const [selectedSize, setSelectedSize] = useState("8oz");
  const sizePrices = getSizePrices(item);
  const selectedPrice = sizePrices ? sizePrices[selectedSize] : item.price;
  const cartItem = sizePrices
    ? { ...item, price: selectedPrice, selectedSize }
    : item;

  return (
    <section
      className={`featured-hero${isActive ? ` is-active enter-from-${slideDirection}` : ""}`}
      aria-labelledby={`featured-hero-title-${slideKey}`}
      aria-hidden={!isActive}
      inert={!isActive}
    >
      <div className="featured-hero-copy">
        <p className="menu-eyebrow">FEATURED FAVORITE</p>
        <h1 id={`featured-hero-title-${slideKey}`}>
          A little something to look forward to.
        </h1>
        <p className="featured-hero-description">
          {item.description || "Details available in the café menu."}
        </p>

        <div className="featured-hero-item">
          {item.category && (
            <p className="featured-hero-category">{item.category}</p>
          )}
          <h2>{item.name || "Café favorite"}</h2>
          <strong className="featured-hero-price">
            {formatPrice(selectedPrice)}
          </strong>
        </div>

        <div className="featured-hero-actions">
          <FavoriteToggleButton
            item={item}
            isFavorite={isFavorite}
            isPending={isFavoritePending}
            onToggle={onToggleFavorite}
          />
          <div className="featured-hero-order-group">
            {sizePrices && (
              <SizeSelector
                item={item}
                selectedSize={selectedSize}
                onSelectSize={setSelectedSize}
              />
            )}
            <AddToCartButton
              item={cartItem}
              onAdd={onAdd}
              className="featured-hero-order"
              actionLabel="Order Now"
              disabled={item.available === false}
            />
          </div>
          <a className="featured-hero-explore" href="#menu-catalog">
            Explore Menu
          </a>
        </div>
      </div>

      <div className="featured-hero-media">
        {imageUrl && failedImageUrl !== imageUrl ? (
          <img
            src={imageUrl}
            alt={item.name || "Featured café menu item"}
            fetchPriority="high"
            decoding="async"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : (
          <div
            className="featured-hero-image-placeholder"
            role="img"
            aria-label={`No photo available for ${item.name || "featured menu item"}`}
          >
            <span aria-hidden="true">☕</span>
          </div>
        )}
        <div className="featured-hero-image-caption">
          <span className="status-dot" />
          <span>Selected from the Cactus Café menu</span>
        </div>
      </div>
    </section>
  );
}

function FeaturedHeroCarousel({
  items,
  onAdd,
  favoriteIds,
  pendingFavoriteIds,
  onToggleFavorite,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState("right");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const activeIndexRef = useRef(0);
  const activeItem = items[activeIndex];

  useEffect(() => {
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );
    const updateMotionPreference = () =>
      setPrefersReducedMotion(motionPreference.matches);

    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);

    return () =>
      motionPreference.removeEventListener("change", updateMotionPreference);
  }, []);

  useEffect(() => {
    if (items.length < 2 || prefersReducedMotion) return undefined;

    const intervalId = window.setInterval(() => {
      const currentIndex = activeIndexRef.current;
      const nextIndex = (currentIndex + 1) % items.length;
      activeIndexRef.current = nextIndex;
      setSlideDirection("right");
      setActiveIndex(nextIndex);
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [items.length, prefersReducedMotion]);

  const showItem = (index) => {
    if (index === activeIndex) return;

    activeIndexRef.current = index;
    setSlideDirection(index > activeIndex ? "right" : "left");
    setActiveIndex(index);
  };

  const showPrevious = () => {
    showItem((activeIndex - 1 + items.length) % items.length);
  };

  const showNext = () => {
    showItem((activeIndex + 1) % items.length);
  };

  return (
    <div
      className="featured-hero-carousel"
      role="region"
      aria-label="Featured menu items"
      aria-roledescription="carousel"
    >
      <div className="featured-hero-viewport">
        <FeaturedHero
          key={activeItem.id}
          item={activeItem}
          onAdd={onAdd}
          isFavorite={favoriteIds.has(activeItem.id)}
          isFavoritePending={pendingFavoriteIds.has(activeItem.id)}
          onToggleFavorite={onToggleFavorite}
          isActive
          slideDirection={slideDirection}
          slideKey={activeItem.id}
        />
      </div>

      {items.length > 1 && (
        <div className="featured-hero-navigation">
          <div className="featured-hero-pagination" aria-label="Choose a featured item">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`featured-hero-dot${index === activeIndex ? " active" : ""}`}
                aria-label={`Show featured item ${index + 1}: ${item.name || "Café favorite"}`}
                aria-pressed={index === activeIndex}
                onClick={() => showItem(index)}
              />
            ))}
          </div>

          <div className="featured-hero-arrows">
            <button
              type="button"
              className="featured-hero-arrow"
              aria-label="Show previous featured item"
              onClick={showPrevious}
            >
              <span aria-hidden="true">←</span>
            </button>
            <span className="featured-hero-position" aria-live="polite">
              {activeIndex + 1} / {items.length}
            </span>
            <button
              type="button"
              className="featured-hero-arrow"
              aria-label="Show next featured item"
              onClick={showNext}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}
      <span className="visually-hidden" aria-atomic="true">
        Featured item {activeIndex + 1} of {items.length}: {activeItem.name}
      </span>
    </div>
  );
}

function MenuPage() {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [favoriteIds, setFavoriteIds] = useState(() => new Set());
  const [favoriteOwnerId, setFavoriteOwnerId] = useState("");
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState(
    () => new Set()
  );
  const [favoritesError, setFavoritesError] = useState("");
  const { addToCart } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!user?.uid || auth.currentUser?.uid !== user.uid) {
      return undefined;
    }

    return onSnapshot(
      collection(db, "users", user.uid, "favorites"),
      (snapshot) => {
        setFavoriteIds(new Set(snapshot.docs.map((favorite) => favorite.id)));
        setFavoriteOwnerId(user.uid);
        setFavoritesError("");
      },
      (favoriteError) => {
        console.error("Error loading customer favorites:", favoriteError);
        setFavoritesError(
          "Your saved favorites could not be loaded. Please try again."
        );
      }
    );
  }, [user?.uid]);

  const handleToggleFavorite = async (itemId) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      navigate("/login");
      return;
    }

    if (pendingFavoriteIds.has(itemId)) return;

    setPendingFavoriteIds((currentIds) => new Set(currentIds).add(itemId));
    setFavoritesError("");

    try {
      const favoriteRef = doc(
        db,
        "users",
        currentUser.uid,
        "favorites",
        itemId
      );
      if (
        favoriteOwnerId === currentUser.uid &&
        favoriteIds.has(itemId)
      ) {
        await deleteDoc(favoriteRef);
      } else {
        await setDoc(
          favoriteRef,
          { itemId, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
    } catch (favoriteError) {
      console.error("Error updating customer favorite:", favoriteError);
      setFavoritesError(
        "We couldn't update that favorite. Please try again."
      );
    } finally {
      setPendingFavoriteIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(itemId);
        return nextIds;
      });
    }
  };

  const handleAddToCart = (item) => {
    if (!user) {
      navigate("/login");
      return false;
    }

    addToCart(item);
    return true;
  };

  const loadMenuItems = async () => {
    setLoading(true);
    setError("");

    try {
      setMenuItems(await fetchMenuItems());
    } catch (loadError) {
      console.error("Error loading menu items:", loadError);
      setError(
        "We couldn't load the menu right now. Please try again in a moment."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isCurrent = true;

    fetchMenuItems()
      .then((items) => {
        if (isCurrent) {
          setMenuItems(items);
        }
      })
      .catch((loadError) => {
        console.error("Error loading menu items:", loadError);
        if (isCurrent) {
          setError(
            "We couldn't load the menu right now. Please try again in a moment."
          );
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const retryMenuLoad = () => {
    loadMenuItems();
  };

  const categories = useMemo(() => {
    const uniqueCategories = [
      ...new Set(
        menuItems
          .map((item) => item.category?.trim())
          .filter(Boolean)
      ),
    ];

    return ["All", ...uniqueCategories];
  }, [menuItems]);

  const featuredCandidates = useMemo(() => {
    const availableItems = menuItems.filter(
      (item) => item.available !== false
    );
    const explicitlyFeatured = availableItems.filter(
      (item) => item.featured === true
    );
    const popularItems = availableItems.filter(
      (item) => item.popular === true
    );

    const prioritizedItems = [
      ...explicitlyFeatured,
      ...popularItems,
      ...availableItems,
    ];

    return [...new Map(
      prioritizedItems.map((item) => [item.id, item])
    ).values()];
  }, [menuItems]);

  const featuredItems = featuredCandidates.slice(0, 4);
  const showFeatured =
    featuredItems.length > 0 &&
    selectedCategory === "All" &&
    searchTerm.trim() === "";

  const visibleItems = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return menuItems.filter((item) => {
      const itemCategory = item.category?.toLowerCase() || "";

      const matchesCategory =
        selectedCategory === "All" ||
        itemCategory === selectedCategory.toLowerCase();

      const searchableText = `
        ${item.name || ""}
        ${item.description || ""}
        ${item.category || ""}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      return matchesCategory && matchesSearch;
    });
  }, [menuItems, selectedCategory, searchTerm]);

  const featuredItemIds = new Set(featuredItems.map((item) => item.id));
  const catalogItems = showFeatured
    ? visibleItems.filter((item) => !featuredItemIds.has(item.id))
    : visibleItems;

  if (loading) {
    return (
      <>
        <main className="menu-page">
          <section className="menu-header menu-header-loading">
            <p className="menu-eyebrow">CACTUS CAFE MENU</p>
            <h1>Good things are on the way.</h1>
            <p>We’re getting today’s menu ready for you.</p>
          </section>

          <section className="menu-grid loading-grid">
            {[1, 2, 3, 4].map((item) => (
              <div className="menu-skeleton" key={item} />
            ))}
          </section>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (error) {
    return (
      <>
        <main className="menu-page">
          <section className="menu-error" role="alert">
            <div className="empty-icon" aria-hidden="true">!</div>
            <p className="menu-eyebrow">A LITTLE CAFE PAUSE</p>
            <h1>Our menu couldn’t load.</h1>
            <p>{error}</p>
            <button
              type="button"
              className="checkout-button"
              onClick={retryMenuLoad}
            >
              Try again
            </button>
          </section>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <main className="menu-page">
        {showFeatured && featuredItems.length > 0 && (
          <FeaturedHeroCarousel
            items={featuredItems}
            onAdd={handleAddToCart}
            favoriteIds={favoriteIds}
            pendingFavoriteIds={pendingFavoriteIds}
            onToggleFavorite={handleToggleFavorite}
          />
        )}

        <section className="menu-toolbar" id="menu-catalog">
          <div
            className="category-tabs"
            role="group"
            aria-label="Filter by food category"
          >
            {categories.map((category) => (
              <button
                type="button"
                key={category}
                aria-pressed={selectedCategory === category}
                className={`category-tab ${
                  selectedCategory === category ? "active" : ""
                }`}
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <label className="menu-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="visually-hidden">Search the menu</span>

            <input
              type="search"
              placeholder="Search coffee, food, or drinks"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
            />
          </label>
        </section>

        {user?.uid && favoritesError && (
          <p className="menu-favorites-error" role="alert">
            {favoritesError}
          </p>
        )}

        {(catalogItems.length > 0 || !showFeatured) && (
          <section className="product-section">
            <div className="section-heading">
              <div>
                <p className="menu-eyebrow">CACTUS CAFÉ MENU</p>
                <h2>{showFeatured ? "More to explore" : "Explore the menu"}</h2>
              </div>

              <span className="product-count">
                {catalogItems.length}{" "}
                {catalogItems.length === 1 ? "item" : "items"}
              </span>
            </div>

            {visibleItems.length === 0 ? (
              <section className="menu-empty">
                <div className="empty-icon" aria-hidden="true">⌕</div>
                <h2>
                  {menuItems.length === 0
                    ? "Our menu is being refreshed"
                    : "No products found"}
                </h2>
                <p>
                  {menuItems.length === 0
                    ? "Please check back soon for today’s café favorites."
                    : "Try another category or search for something else."}
                </p>
              </section>
            ) : (
              <div className="menu-grid">
                {catalogItems.map((item) => (
                  <ProductCard
                    key={item.id}
                    item={item}
                    onAdd={handleAddToCart}
                    actionLabel={user ? "Add to Cart" : "Order Now"}
                    isFavorite={
                      favoriteOwnerId === user?.uid && favoriteIds.has(item.id)
                    }
                    isFavoritePending={pendingFavoriteIds.has(item.id)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            )}
          </section>
        )}

      </main>
      <SiteFooter />
    </>
  );
}

export default MenuPage;