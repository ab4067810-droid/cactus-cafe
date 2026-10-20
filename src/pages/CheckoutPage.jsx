import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";

import { useCart } from "../context/CartContext";
import { auth, functions } from "../services/firebase";
import "../styles/CheckoutPage.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

const emptyCart = [];

function SummaryItemImage({ item }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl =
    typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";

  return (
    <div className="summary-item-image">
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt={item.name || "Menu item"}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        "☕"
      )}
    </div>
  );
}

function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { clearCart } = useCart();

  const cart = location.state?.cart ?? emptyCart;

  const [orderType, setOrderType] = useState("takeout");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const totalItems = useMemo(
    () =>
      cart.reduce(
        (total, item) => total + Number(item.quantity || 0),
        0
      ),
    [cart]
  );

  const totalPrice = useMemo(
    () =>
      cart.reduce(
        (total, item) =>
          total +
          (Number(item.price) || 0) *
            Number(item.quantity || 0),
        0
      ),
    [cart]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    if (cart.length === 0) {
      setErrorMessage("Your cart is empty.");
      return;
    }

    if (!customerName.trim()) {
      setErrorMessage("Please enter your full name.");
      return;
    }

    if (!phone.trim()) {
      setErrorMessage("Please enter your contact number.");
      return;
    }

    if (orderType === "delivery" && !address.trim()) {
      setErrorMessage("Please enter your delivery address.");
      return;
    }

    const currentUser = auth.currentUser;

    if (!currentUser) {
      setErrorMessage(
        "Your session has expired. Please log in again."
      );
      navigate("/login");
      return;
    }

    try {
      setSubmitting(true);

      const createOrder = httpsCallable(functions, "createOrder");
      await createOrder({
        items: cart.map((item) => ({
          id: item.id,
          quantity: Number(item.quantity),
        })),
        customerName: customerName.trim(),
        phone: phone.trim(),
        orderType,
        address:
          orderType === "delivery"
            ? address.trim()
            : "",
        notes: notes.trim(),
      });

      alert("Order placed successfully! 🌵");
      clearCart();
      navigate("/customer");
    } catch (error) {
      console.error("Error placing order:", error);
      setErrorMessage(
        error?.message || "Unable to place your order. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (cart.length === 0) {
    return (
      <main className="checkout-page">
        <section className="checkout-empty">
          <div className="checkout-empty-icon">🛒</div>

          <p className="checkout-eyebrow">CACTUS CAFE</p>

          <h1>Your cart is empty</h1>

          <p>
            Add something delicious from the menu before
            checking out.
          </p>

          <button
            type="button"
            className="primary-button"
            onClick={() => navigate("/menu")}
          >
            Back to Menu
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <div className="checkout-shell">
        <header className="checkout-header">
          <div>
            <p className="checkout-eyebrow">CACTUS CAFE</p>

            <h1>Complete your order</h1>

            <p>
              Review your items, choose how you would like to
              receive them, and confirm your details.
            </p>
          </div>

          <button
            type="button"
            className="header-back-button"
            onClick={() => navigate("/menu")}
          >
            ← Back to menu
          </button>
        </header>

        <div className="checkout-layout">
          <form
            className="checkout-form-card"
            onSubmit={handleSubmit}
          >
            <div className="form-card-heading">
              <div className="step-number">01</div>

              <div>
                <p className="section-eyebrow">YOUR DETAILS</p>
                <h2>Customer information</h2>
              </div>
            </div>

            <div className="form-grid">
              <div className="form-group form-group-full">
                <label htmlFor="customerName">
                  Full name
                </label>

                <input
                  id="customerName"
                  type="text"
                  value={customerName}
                  onChange={(event) =>
                    setCustomerName(event.target.value)
                  }
                  placeholder="Enter your full name"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="form-group form-group-full">
                <label htmlFor="phone">
                  Contact number
                </label>

                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value)
                  }
                  placeholder="09XX XXX XXXX"
                  autoComplete="tel"
                  required
                />
              </div>
            </div>

            <div className="form-divider" />

            <div className="form-card-heading">
              <div className="step-number">02</div>

              <div>
                <p className="section-eyebrow">FULFILLMENT</p>
                <h2>How would you like your order?</h2>
              </div>
            </div>

            <div className="order-type-options">
              <label
                className={`order-type-card ${
                  orderType === "takeout" ? "selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="orderType"
                  value="takeout"
                  checked={orderType === "takeout"}
                  onChange={(event) =>
                    setOrderType(event.target.value)
                  }
                />

                <span className="order-type-icon">🥡</span>

                <span className="order-type-content">
                  <strong>Takeout</strong>
                  <small>Pick up at Cactus Cafe</small>
                </span>

                <span className="radio-mark" />
              </label>

              <label
                className={`order-type-card ${
                  orderType === "delivery" ? "selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="orderType"
                  value="delivery"
                  checked={orderType === "delivery"}
                  onChange={(event) =>
                    setOrderType(event.target.value)
                  }
                />

                <span className="order-type-icon">🚚</span>

                <span className="order-type-content">
                  <strong>Delivery</strong>
                  <small>Delivered to your address</small>
                </span>

                <span className="radio-mark" />
              </label>

              <label
                className={`order-type-card ${
                  orderType === "dine-in" ? "selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="orderType"
                  value="dine-in"
                  checked={orderType === "dine-in"}
                  onChange={(event) =>
                    setOrderType(event.target.value)
                  }
                />

                <span className="order-type-icon">🍽️</span>

                <span className="order-type-content">
                  <strong>Dine-in</strong>
                  <small>Enjoy it at the cafe</small>
                </span>

                <span className="radio-mark" />
              </label>
            </div>

            {orderType === "delivery" && (
              <div className="form-group">
                <label htmlFor="address">
                  Delivery address
                </label>

                <textarea
                  id="address"
                  value={address}
                  onChange={(event) =>
                    setAddress(event.target.value)
                  }
                  placeholder="House number, street, barangay, city"
                  rows="3"
                  autoComplete="street-address"
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="notes">
                Order notes <span>Optional</span>
              </label>

              <textarea
                id="notes"
                value={notes}
                onChange={(event) =>
                  setNotes(event.target.value)
                }
                placeholder="Any special instructions for your order?"
                rows="3"
              />
            </div>

            {errorMessage && (
              <div className="checkout-error" role="alert">
                <span>!</span>
                {errorMessage}
              </div>
            )}

            <div className="checkout-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate("/menu")}
                disabled={submitting}
              >
                Continue shopping
              </button>

              <button
                type="submit"
                className="primary-button"
                disabled={submitting}
              >
                {submitting
                  ? "Placing order..."
                  : "Confirm order"}
              </button>
            </div>
          </form>

          <aside className="order-summary-card">
            <div className="summary-heading">
              <div>
                <p className="section-eyebrow">ORDER SUMMARY</p>
                <h2>Your order</h2>
              </div>

              <span className="item-count">
                {totalItems}{" "}
                {totalItems === 1 ? "item" : "items"}
              </span>
            </div>

            <div className="summary-items">
              {cart.map((item) => (
                <div className="summary-item" key={item.id}>
                  <SummaryItemImage item={item} />

                  <div className="summary-item-info">
                    <h3>{item.name}</h3>

                    <p>
                      <span className="summary-quantity">
                        {item.quantity} ×
                      </span>
                      <span>
                        {formatPrice(item.price)} each
                      </span>
                    </p>
                  </div>

                  <strong>
                    {formatPrice(
                      Number(item.price || 0) *
                        Number(item.quantity || 0)
                    )}
                  </strong>
                </div>
              ))}
            </div>

            <div className="summary-divider" />

            <div className="summary-row">
              <span>Subtotal</span>
              <strong>{formatPrice(totalPrice)}</strong>
            </div>

            <div className="summary-row">
              <span>Service fee</span>
              <strong>₱0.00</strong>
            </div>

            <div className="summary-total">
              <span>Total</span>
              <strong>{formatPrice(totalPrice)}</strong>
            </div>

            <div className="summary-note">
              <span>✦</span>
              Your order will be reviewed by the cafe before
              preparation.
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

export default CheckoutPage;