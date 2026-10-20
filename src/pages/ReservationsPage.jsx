import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { useNavigate } from "react-router-dom";
import "../styles/ReservationsPage.css";

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

function ReservationsPage() {
  const navigate = useNavigate();

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(1);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const currentUser = auth.currentUser;

    if (!currentUser) {
      alert("Please log in before making a reservation.");
      navigate("/login");
      return;
    }

    if (!customerName.trim() || !phone.trim()) {
      alert("Please enter your name and contact number.");
      return;
    }

    if (!date || !time) {
      alert("Please select a reservation date and time.");
      return;
    }

    if (date < getTodayDate()) {
      alert(
        "Reservation date cannot be in the past. Please choose today or a future date."
      );
      return;
    }

    if (guests < 1) {
      alert("Number of guests must be at least 1.");
      return;
    }

    try {
      setIsSubmitting(true);

      await addDoc(collection(db, "reservations"), {
        userId: currentUser.uid,
        customerEmail: currentUser.email,

        customerName: customerName.trim(),
        phone: phone.trim(),

        date,
        time,
        guests: Number(guests),

        notes: notes.trim(),

        status: "Pending",

        createdAt: serverTimestamp(),
      });

      alert("Reservation submitted successfully! 🌵");

      navigate("/customer");
    } catch (error) {
      console.error("Error creating reservation:", error);

      alert("Unable to create reservation. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="reservations-page">
      <section className="reservations-container">

        <div className="reservations-header">
          <p className="reservations-eyebrow">CACTUS CAFE</p>

          <h1>Make a Reservation</h1>

          <p>
            Reserve a table and enjoy your time at Cactus Cafe.
          </p>
        </div>

        <form
          className="reservation-form"
          onSubmit={handleSubmit}
        >

          <h2>Reservation Details</h2>

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
              placeholder="Enter your full name"
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

          <div className="reservation-row">

            <div className="form-group">
              <label htmlFor="date">
                Reservation Date
              </label>

              <input
                id="date"
                type="date"
                value={date}
                min={getTodayDate()}
                onChange={(event) =>
                  setDate(event.target.value)
                }
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="time">
                Reservation Time
              </label>

              <input
                id="time"
                type="time"
                value={time}
                onChange={(event) =>
                  setTime(event.target.value)
                }
                required
              />
            </div>

          </div>

          <div className="form-group">
            <label htmlFor="guests">
              Number of Guests
            </label>

            <input
              id="guests"
              type="number"
              min="1"
              max="20"
              value={guests}
              onChange={(event) =>
                setGuests(event.target.value)
              }
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="notes">
              Special Request / Notes
            </label>

            <textarea
              id="notes"
              value={notes}
              onChange={(event) =>
                setNotes(event.target.value)
              }
              placeholder="Any special requests? (Optional)"
              rows="4"
            />
          </div>

          <div className="reservation-actions">

            <button
              type="button"
              className="back-button"
              onClick={() => navigate("/customer")}
            >
              Back to Dashboard
            </button>

            <button
              type="submit"
              className="reservation-button"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Submitting..."
                : "Reserve Table"}
            </button>

          </div>

        </form>

      </section>
    </main>
  );
}

export default ReservationsPage;