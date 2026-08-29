import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { db } from "../services/firebase";
import "../styles/MenuPage.css";

function MenuPage() {
  const navigate = useNavigate();

  const [menuItems, setMenuItems] = useState([]);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);

  // =========================
  // LOAD MENU FROM FIRESTORE
  // =========================
  useEffect(() => {
    const loadMenuItems = async () => {
      try {
        const snapshot = await getDocs(
          collection(db, "menuItems")
        );

        const items = snapshot.docs.map((menuDoc) => ({
          id: menuDoc.id,
          ...menuDoc.data(),
        }));

        setMenuItems(items);
      } catch (error) {
        console.error(
          "Error loading menu items:",
          error
        );
      } finally {
        setLoading(false);
      }
    };

    loadMenuItems();
  }, []);

  // =========================
  // ADD TO CART
  // =========================
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
                quantity:
                  cartItem.quantity + 1,
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

  // =========================
  // INCREASE QUANTITY
  // =========================
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

  // =========================
  // DECREASE QUANTITY
  // =========================
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

  // =========================
  // REMOVE FROM CART
  // =========================
  const removeFromCart = (id) => {
    setCart((currentCart) =>
      currentCart.filter(
        (item) => item.id !== id
      )
    );
  };

  // =========================
  // CART TOTALS
  // =========================
  const totalItems = cart.reduce(
    (total, item) =>
      total + item.quantity,
    0
  );

  const totalPrice = cart.reduce(
    (total, item) =>
      total + item.price * item.quantity,
    0
  );

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="menu-page">
        <section className="menu-header">
          <p className="menu-eyebrow">
            CACTUS CAFE MENU
          </p>

          <h1>
            Loading our menu...
          </h1>

          <p>
            Please wait while we get the
            latest menu items.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="menu-page">

      {/* =========================
          HEADER
      ========================= */}
      <section className="menu-header">
        <p className="menu-eyebrow">
          CACTUS CAFE MENU
        </p>

        <h1>
          Made fresh, served with care.
        </h1>

        <p>
          A small selection of coffee,
          comforting food, and cafe favorites.
        </p>
      </section>

      {/* =========================
          CART SUMMARY
      ========================= */}
      <section className="menu-cart-summary">
        🛒 Cart:{" "}
        <strong>{totalItems}</strong>{" "}
        item(s)
      </section>

      {/* =========================
          MENU
      ========================= */}
      {menuItems.length === 0 ? (
        <section className="menu-empty">
          <div>🍔</div>

          <h2>
            No Menu Items Available
          </h2>

          <p>
            Our menu is currently being
            updated. Please check again later.
          </p>
        </section>
      ) : (
        <section className="menu-grid">

          {menuItems.map((item) => (
            <article
              className="menu-card"
              key={item.id}
            >

              <p className="menu-category">
                {item.category}
              </p>

              <h2>
                {item.name}
              </h2>

              <p className="menu-description">
                {item.description}
              </p>

              <p className="menu-price">
                ₱{item.price}
              </p>

              <button
                className="add-to-cart-button"
                onClick={() =>
                  addToCart(item)
                }
              >
                Add to Cart
              </button>

            </article>
          ))}

        </section>
      )}

      {/* =========================
          CART
      ========================= */}
      {cart.length > 0 && (
        <section className="cart-section">

          <h2>
            Your Cart 🛒
          </h2>

          {cart.map((item) => (
            <div
              className="cart-item"
              key={item.id}
            >

              <div>
                <h3>
                  {item.name}
                </h3>

                <p>
                  ₱{item.price} ×{" "}
                  {item.quantity}
                </p>
              </div>

              <div className="cart-controls">

                <button
                  onClick={() =>
                    decreaseQuantity(item.id)
                  }
                >
                  −
                </button>

                <span>
                  {item.quantity}
                </span>

                <button
                  onClick={() =>
                    increaseQuantity(item.id)
                  }
                >
                  +
                </button>

                <button
                  onClick={() =>
                    removeFromCart(item.id)
                  }
                >
                  Remove
                </button>

              </div>

            </div>
          ))}

          <div className="cart-total">
            <strong>
              Total: ₱{totalPrice}
            </strong>
          </div>

          <button
            className="checkout-button"
            onClick={() =>
              navigate("/checkout", {
                state: { cart },
              })
            }
          >
            Proceed to Checkout
          </button>

        </section>
      )}

    </main>
  );
}

export default MenuPage;