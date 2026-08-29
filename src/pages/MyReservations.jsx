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
        <section className="my-reservations-container">
          <p>Loading your reservations...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="my-reservations-page">
      <section className="my-reservations-container">

        <div className="my-reservations-header">
          <p className="reservations-eyebrow">
            CACTUS CAFE
          </p>

          <h1>My Reservations</h1>

          <p>
            View your current and previous table reservations.
          </p>

          <button
            className="back-button"
            onClick={() => navigate("/customer")}
          >
            ← Back to Dashboard
          </button>
        </div>

        {error && (
          <div className="reservations-error">
            {error}
          </div>
        )}

        {!error && reservations.length === 0 && (
          <div className="no-reservations">
            <div className="empty-icon">📅</div>

            <h2>No Reservations Yet</h2>

            <p>
              Your table reservations will appear here after
              you make a reservation.
            </p>

            <button
              onClick={() => navigate("/reservations")}
            >
              Make a Reservation
            </button>
          </div>
        )}

        {reservations.length > 0 && (
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