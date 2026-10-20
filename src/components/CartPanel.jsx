import { useEffect, useMemo, useRef, useState } from "react";

import { useCart } from "../context/CartContext";
import "../styles/CartPanel.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

function CartItemImage({ item }) {
  const [hasImageError, setHasImageError] = useState(false);
  const imageUrl =
    typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";

  return (
    <div className="cart-panel-item-image">
      {imageUrl && !hasImageError ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          onError={() => setHasImageError(true)}
        />
      ) : (
        <span aria-hidden="true">☕</span>
      )}
    </div>
  );
}

function CartPanel({ isOpen, onClose, onCheckout }) {
  const closeButtonRef = useRef(null);
  const panelRef = useRef(null);
  const { cart, totalItems, increaseQuantity, decreaseQuantity, removeFromCart } =
    useCart();

  const totalPrice = useMemo(
    () =>
      cart.reduce(
        (total, item) =>
          total + (Number(item.price) || 0) * item.quantity,
        0
      ),
    [cart]
  );

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = panelRef.current?.querySelectorAll(
        'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div
      className={`cart-panel-backdrop${isOpen ? " is-open" : ""}`}
      aria-hidden={!isOpen}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        id="cart-summary-panel"
        ref={panelRef}
        className="cart-panel"
        role="dialog"
        aria-modal={isOpen ? "true" : undefined}
        aria-labelledby="cart-panel-title"
        inert={!isOpen}
      >
        <header className="cart-panel-header">
          <div>
            <p className="cart-panel-eyebrow">CACTUS CAFÉ</p>
            <h2 id="cart-panel-title">Your cart</h2>
            <p className="cart-panel-item-count" aria-live="polite">
              {totalItems} {totalItems === 1 ? "item" : "items"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="cart-panel-close"
            aria-label="Close cart"
            onClick={onClose}
            tabIndex={isOpen ? 0 : -1}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {cart.length > 0 ? (
          <>
            <div className="cart-panel-items">
              {cart.map((item) => (
                <article className="cart-panel-item" key={item.id}>
                  <CartItemImage item={item} />
                  <div className="cart-panel-item-details">
                    <h3>{item.name}</h3>
                    <p className="cart-panel-item-price">
                      {formatPrice(item.price)} each
                    </p>
                    <div className="cart-panel-item-bottom">
                      <div
                        className="cart-panel-quantity"
                        aria-label={`${item.name} quantity`}
                      >
                        <button
                          type="button"
                          aria-label={`Decrease ${item.name} quantity`}
                          onClick={() => decreaseQuantity(item.id)}
                        >
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Increase ${item.name} quantity`}
                          onClick={() => increaseQuantity(item.id)}
                        >
                          +
                        </button>
                      </div>
                      <strong className="cart-panel-subtotal">
                        {formatPrice(
                          (Number(item.price) || 0) * item.quantity
                        )}
                      </strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cart-panel-remove"
                    aria-label={`Remove ${item.name} from your cart`}
                    onClick={() => removeFromCart(item.id)}
                  >
                    Remove
                  </button>
                </article>
              ))}
            </div>

            <footer className="cart-panel-footer">
              <div className="cart-panel-total">
                <span>Total</span>
                <strong>{formatPrice(totalPrice)}</strong>
              </div>
              <button
                type="button"
                className="cart-panel-checkout"
                onClick={onCheckout}
              >
                Proceed to Checkout
              </button>
            </footer>
          </>
        ) : (
          <div className="cart-panel-empty">
            <div className="cart-panel-empty-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.5L21 8H6" />
                <circle cx="10" cy="20" r="1" />
                <circle cx="18" cy="20" r="1" />
              </svg>
            </div>
            <h3>Your cart is looking a little empty</h3>
            <p>Choose a café favorite from the menu to get started.</p>
            <button
              type="button"
              className="cart-panel-continue"
              onClick={onClose}
            >
              Continue shopping
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default CartPanel;
