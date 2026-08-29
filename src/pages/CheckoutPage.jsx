import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import "../styles/CheckoutPage.css";
function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const cart = location.state?.cart || [];

  const [orderType, setOrderType] = useState("takeout");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  const totalPrice = cart.reduce(
    (total, item) => total + item.price * item.quantity,
    0
  );

const handleSubmit = async (event) => {
  event.preventDefault();

  if (cart.length === 0) {
    alert("Your cart is empty.");
    navigate("/menu");
    return;
  }

  if (!customerName.trim()) {
    alert("Please enter your full name.");
    return;
  }

  if (!phone.trim()) {
    alert("Please enter your contact number.");
    return;
  }

  if (orderType === "delivery" && !address.trim()) {
    alert("Please enter your delivery address.");
    return;
  }

  const currentUser = auth.currentUser;

  if (!currentUser) {
    alert("Your session has expired. Please log in again.");
    navigate("/login");
    return;
  }

  try {
    const orderData = {
      customerId: currentUser.uid,
      customerEmail: currentUser.email,

      customerName: customerName.trim(),
      phone: phone.trim(),

      orderType: orderType,

      address:
        orderType === "delivery"
          ? address.trim()
          : "",

      notes: notes.trim(),

      items: cart.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
      })),

      total: totalPrice,

      status: "Pending",

      createdAt: serverTimestamp(),
    };

    await addDoc(collection(db, "orders"), orderData);

    alert("Order placed successfully! 🌵");

    navigate("/customer");
  } catch (error) {
    console.error("Error placing order:", error);

    alert("Unable to place your order. Please try again.");
  }
};

  if (cart.length === 0) {
    return (
      <main className="checkout-page">
        <div className="checkout-empty">
          <h1>Your cart is empty 🛒</h1>

          <p>Please add some items before checking out.</p>

          <button onClick={() => navigate("/menu")}>
            Back to Menu
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <section className="checkout-container">

        <div className="checkout-header">
          <p className="checkout-eyebrow">CACTUS CAFE</p>

          <h1>Checkout</h1>

          <p>
            Review your order and provide your order details.
          </p>
        </div>

        <section className="checkout-order">
          <h2>Your Order</h2>

          {cart.map((item) => (
            <div className="checkout-item" key={item.id}>
              <div>
                <h3>{item.name}</h3>

                <p>
                  ₱{item.price} × {item.quantity}
                </p>
              </div>

              <strong>
                ₱{item.price * item.quantity}
              </strong>
            </div>
          ))}

          <div className="checkout-total">
            Total: ₱{totalPrice}
          </div>
        </section>

        <form
          className="checkout-form"
          onSubmit={handleSubmit}
        >
          <h2>Customer Information</h2>

          <div className="form-group">
            <label htmlFor="customerName">
              Full Name
            </label>

            <input
              id="customerName"
              type="text"
              value={customerName}
              onChange={(event) =>
                setCustomerName(event.target.value)
              }
              placeholder="Enter your name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">
              Contact Number
            </label>

            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value)
              }
              placeholder="Enter your contact number"
              required
            />
          </div>

          <h2>Order Type</h2>

          <div className="order-type-options">
            <label>
              <input
                type="radio"
                name="orderType"
                value="takeout"
                checked={orderType === "takeout"}
                onChange={(event) =>
                  setOrderType(event.target.value)
                }
              />
              🥡 Takeout
            </label>

            <label>
              <input
                type="radio"
                name="orderType"
                value="delivery"
                checked={orderType === "delivery"}
                onChange={(event) =>
                  setOrderType(event.target.value)
                }
              />
              🚚 Delivery
            </label>

            <label>
              <input
                type="radio"
                name="orderType"
                value="dine-in"
                checked={orderType === "dine-in"}
                onChange={(event) =>
                  setOrderType(event.target.value)
                }
              />
              🍽️ Dine-in
            </label>
          </div>

          {orderType === "delivery" && (
            <div className="form-group">
              <label htmlFor="address">
                Delivery Address
              </label>

              <textarea
                id="address"
                value={address}
                onChange={(event) =>
                  setAddress(event.target.value)
                }
                placeholder="Enter your delivery address"
                rows="3"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="notes">
              Order Notes (Optional)
            </label>

            <textarea
              id="notes"
              value={notes}
              onChange={(event) =>
                setNotes(event.target.value)
              }
              placeholder="Special instructions..."
              rows="3"
            />
          </div>

          <div className="checkout-actions">
            <button
              type="button"
              className="back-button"
              onClick={() => navigate("/menu")}
            >
              Back to Menu
            </button>

            <button
              type="submit"
              className="confirm-button"
            >
              Confirm Order
            </button>
          </div>
        </form>

      </section>
    </main>
  );
}

export default CheckoutPage;