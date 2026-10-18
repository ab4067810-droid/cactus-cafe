import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { db } from "../services/firebase";
import "../styles/MenuPage.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

function ProductCard({ item, onAdd, featured = false }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl =
    typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";

  return (
    <article className={`menu-card ${featured ? "featured-product" : ""}`}>
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          className="product-image"
          src={imageUrl}
          alt={item.name || "Menu item"}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <div className="product-image product-image-placeholder">
          ☕
        </div>
      )}

      <div className="product-card-content">
        <div className="product-card-top">
          <p className="menu-category">
            {item.category || "Cafe favorite"}
          </p>

          {item.popular && (
            <span className="popular-badge">Popular</span>
          )}
        </div>

        <h3>{item.name}</h3>

        <p className="menu-description">
          {item.description || "Freshly prepared at Cactus Cafe."}
        </p>

        <div className="product-card-footer">
          <strong className="menu-price">
            {formatPrice(item.price)}
          </strong>

          <button
            type="button"
            className="add-to-cart-button"
            onClick={() => onAdd(item)}
            disabled={item.available === false}
          >
            {item.available === false ? "Unavailable" : "Add"}
          </button>
        </div>
      </div>
    </article>
  );
}

function MenuPage() {
  const navigate = useNavigate();

  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const loadMenuItems = async () => {
      try {
        setLoading(true);
        setError("");

        const snapshot = await getDocs(
          collection(db, "menuItems")
        );

        const items = snapshot.docs.map((menuDoc) => ({
          id: menuDoc.id,
          ...menuDoc.data(),
        }));

        setMenuItems(items);
      } catch (loadError) {
        console.error("Error loading menu items:", loadError);
        setError("We could not load the menu right now.");
      } finally {
        setLoading(false);
      }
    };

    loadMenuItems();
  }, []);

  const addToCart = (item) => {
    setCart((currentCart) => {
      const existingItem = currentCart.find(
        (cartItem) => cartItem.id === item.id
      );

      if (existingItem) {
        return currentCart.map((cartItem) =>
          cartItem.id === item.id
            ? {
                ...cartItem,
                quantity: cartItem.quantity + 1,
              }
            : cartItem
        );
      }

      return [
        ...currentCart,
        {
          ...item,
          quantity: 1,
        },
      ];
    });
  };

  const increaseQuantity = (id) => {
    setCart((currentCart) =>
      currentCart.map((item) =>
        item.id === id
          ? {
              ...item,
              quantity: item.quantity + 1,
            }
          : item
      )
    );
  };

  const decreaseQuantity = (id) => {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (id) => {
    setCart((currentCart) =>
      currentCart.filter((item) => item.id !== id)
    );
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

  const featuredItems = useMemo(
    () =>
      menuItems
        .filter((item) => item.featured === true)
        .slice(0, 4),
    [menuItems]
  );

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

  const totalItems = cart.reduce(
    (total, item) => total + item.quantity,
    0
  );

  const totalPrice = cart.reduce(
    (total, item) =>
      total + (Number(item.price) || 0) * item.quantity,
    0
  );

  if (loading) {
    return (
      <main className="menu-page">
        <section className="menu-header">
          <p className="menu-eyebrow">CACTUS CAFE MENU</p>
          <h1>Preparing something delicious...</h1>
          <p>Please wait while we load the latest menu.</p>
        </section>

        <section className="menu-grid loading-grid">
          {[1, 2, 3, 4].map((item) => (
            <div className="menu-skeleton" key={item} />
          ))}
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="menu-page">
        <section className="menu-empty">
          <div className="empty-icon">!</div>
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <button
            type="button"
            className="checkout-button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="menu-page">
      <section className="menu-header">
        <div>
          <p className="menu-eyebrow">CACTUS CAFE MENU</p>

          <h1>Made fresh, served with care.</h1>

          <p>
            Discover coffee, comforting food, and cafe favorites
            prepared just for you.
          </p>
        </div>

        <div className="menu-header-note">
          <span className="status-dot" />
          Freshly prepared today
        </div>
      </section>

      <section className="menu-toolbar">
        <div className="category-tabs" aria-label="Food categories">
          {categories.map((category) => (
            <button
              type="button"
              key={category}
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
          <span className="search-icon">⌕</span>

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

      {featuredItems.length > 0 && (
        <section className="featured-section">
          <div className="section-heading">
            <div>
              <p className="menu-eyebrow">CUSTOMER FAVORITES</p>
              <h2>Featured today</h2>
            </div>
          </div>

          <div className="featured-grid">
            {featuredItems.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                onAdd={addToCart}
                featured
              />
            ))}
          </div>
        </section>
      )}

      <section className="product-section">
        <div className="section-heading">
          <div>
            <p className="menu-eyebrow">OUR PRODUCTS</p>
            <h2>Choose something delicious</h2>
          </div>

          <span className="product-count">
            {visibleItems.length}{" "}
            {visibleItems.length === 1 ? "product" : "products"}
          </span>
        </div>

        {visibleItems.length === 0 ? (
          <section className="menu-empty">
            <div className="empty-icon">⌕</div>
            <h2>No products found</h2>
            <p>
              Try another category or search for something else.
            </p>
          </section>
        ) : (
          <div className="menu-grid">
            {visibleItems.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                onAdd={addToCart}
              />
            ))}
          </div>
        )}
      </section>

      {cart.length > 0 && (
        <section className="cart-section">
          <div className="cart-heading">
            <div>
              <p className="menu-eyebrow">YOUR ORDER</p>
              <h2>Cart summary</h2>
            </div>

            <span className="cart-count">
              {totalItems}{" "}
              {totalItems === 1 ? "item" : "items"}
            </span>
          </div>

          <div className="cart-items">
            {cart.map((item) => (
              <div className="cart-item" key={item.id}>
                <div className="cart-item-info">
                  <h3>{item.name}</h3>
                  <p>
                    {formatPrice(item.price)} each
                  </p>
                </div>

                <div className="cart-controls">
                  <button
                    type="button"
                    aria-label={`Decrease ${item.name}`}
                    onClick={() => decreaseQuantity(item.id)}
                  >
                    −
                  </button>

                  <span>{item.quantity}</span>

                  <button
                    type="button"
                    aria-label={`Increase ${item.name}`}
                    onClick={() => increaseQuantity(item.id)}
                  >
                    +
                  </button>

                  <button
                    type="button"
                    className="remove-button"
                    onClick={() => removeFromCart(item.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="cart-footer">
            <div>
              <span>Total</span>
              <strong>{formatPrice(totalPrice)}</strong>
            </div>

            <button
              type="button"
              className="checkout-button"
              onClick={() =>
                navigate("/checkout", {
                  state: { cart },
                })
              }
            >
              Proceed to checkout
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default MenuPage;