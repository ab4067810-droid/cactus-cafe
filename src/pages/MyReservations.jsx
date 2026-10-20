import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { useNavigate } from "react-router-dom";
import "../styles/MyReservations.css";

function MyReservations() {
  const navigate = useNavigate();

  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchReservations = async () => {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        setLoading(false);
        navigate("/login");
        return;
      }

      try {
        const reservationsQuery = query(
          collection(db, "reservations"),
          where("userId", "==", currentUser.uid)
        );

        const snapshot = await getDocs(reservationsQuery);

        const reservationList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Newest reservations first
        reservationList.sort((a, b) => {
          const dateA = a.createdAt?.toDate?.() || new Date(0);
          const dateB = b.createdAt?.toDate?.() || new Date(0);

          return dateB - dateA;
        });

        setReservations(reservationList);
      } catch (err) {
        console.error("Error loading reservations:", err);
        setError("Unable to load your reservations.");
      } finally {
        setLoading(false);
      }
    };

    fetchReservations();
  }, [navigate]);

  if (loading) {
    return (
      <main className="my-reservations-page">
        <section
          className="my-reservations-container"
          aria-busy="true"
          aria-label="Loading your reservations"
        >
          <p className="reservations-loading-status" role="status">
            Loading your reservations...
          </p>
          <div className="reservations-loading-card" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="reservations-loading-card" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="my-reservations-page">
      <section className="my-reservations-container">

        <header className="my-reservations-header">
          <div className="my-reservations-heading">
            <p className="reservations-eyebrow">CACTUS CAFE</p>

            <h1>My Reservations</h1>

            <p>
              View your current and previous table reservations.
            </p>
          </div>

          <button
            type="button"
            className="back-button"
            onClick={() => navigate("/customer")}
          >
            ← Back to Dashboard
          </button>
        </header>

        {error && (
          <div className="reservations-error" role="alert">
            <span className="reservations-error-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>We could not load your reservations</strong>
              <p>{error}</p>
            </div>
          </div>
        )}

        {!error && reservations.length === 0 && (
          <div className="no-reservations">
            <div className="empty-icon" aria-hidden="true">
              <svg
                viewBox="0 0 32 32"
                width="32"
                height="32"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="8" width="22" height="19" rx="3" />
                <path d="M10 5v6M22 5v6M5 14h22M11 19h.01M16 19h.01M21 19h.01M11 23h.01M16 23h.01" />
              </svg>
            </div>

            <p className="reservations-eyebrow">YOUR TABLE PLANS</p>

            <h2>No reservations yet</h2>

            <p>
              Your table reservations will appear here after
              you make a reservation.
            </p>

            <button
              type="button"
              className="make-reservation-button"
              onClick={() => navigate("/reservations")}
            >
              Make a Reservation
            </button>
          </div>
        )}

        {!error && reservations.length > 0 && (
          <div className="reservations-list">

            {reservations.map((reservation) => (
              <article
                className="reservation-card"
                key={reservation.id}
              >

                <div className="reservation-card-header">

                  <div>
                    <p className="reservation-label">
                      RESERVATION ID
                    </p>

                    <strong>
                      {reservation.id}
                    </strong>
                  </div>

                  <span
                    className={`reservation-status status-${String(
                      reservation.status || "Pending"
                    )
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {reservation.status || "Pending"}
                  </span>

                </div>

                <div className="reservation-details">

                  <div>
                    <span className="reservation-label">
                      DATE
                    </span>

                    <p>
                      {reservation.date || "Not specified"}
                    </p>
                  </div>

                  <div>
                    <span className="reservation-label">
                      TIME
                    </span>

                    <p>
                      {reservation.time || "Not specified"}
                    </p>
                  </div>

                  <div>
                    <span className="reservation-label">
                      GUESTS
                    </span>

                    <p>
                      {reservation.guests || 0}
                    </p>
                  </div>

                  <div>
                    <span className="reservation-label">
                      CONTACT
                    </span>

                    <p>
                      {reservation.phone || "Not specified"}
                    </p>
                  </div>

                </div>

                {reservation.notes && (
                  <div className="reservation-notes">
                    <strong>Special Requests:</strong>

                    <p>
                      {reservation.notes}
                    </p>
                  </div>
                )}

              </article>
            ))}

          </div>
        )}

      </section>
    </main>
  );
}

export default MyReservations;