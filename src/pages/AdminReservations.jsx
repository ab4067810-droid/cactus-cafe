import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../services/firebase";
import "../styles/AdminReservations.css";

function AdminReservations() {
  const navigate = useNavigate();

  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  // =========================
  // LOAD RESERVATIONS
  // =========================
  const loadReservations = async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "reservations")
      );

      const reservationList = snapshot.docs.map(
        (reservationDoc) => ({
          id: reservationDoc.id,
          ...reservationDoc.data(),
        })
      );

      // Newest reservations first
      reservationList.sort((a, b) => {
        const dateA = a.createdAt?.toDate
          ? a.createdAt.toDate()
          : new Date(0);

        const dateB = b.createdAt?.toDate
          ? b.createdAt.toDate()
          : new Date(0);

        return dateB - dateA;
      });

      setReservations(reservationList);
    } catch (err) {
      console.error(
        "Error loading reservations:",
        err
      );

      setError(
        "Unable to load reservations. Please try again."
      );
    }
  };

  // =========================
  // CHECK ADMIN LOGIN
  // =========================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (!currentUser) {
          navigate("/login", { replace: true });
          return;
        }

        try {
          setLoading(true);
          setError("");

          // Get the currently logged-in user's profile
          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const userSnapshot = await getDoc(userRef);

          // User profile does not exist
          if (!userSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login", { replace: true });
            return;
          }

          const userData = userSnapshot.data();

          // Verify administrator role
          if (userData.role !== "admin") {
            alert(
              "Access denied. Administrator account required."
            );

            navigate("/customer", { replace: true });
            return;
          }

          // Load reservations after admin verification
          await loadReservations();
        } catch (err) {
          console.error(
            "Error checking administrator access:",
            err
          );

          setError(
            "Unable to verify administrator access."
          );
        } finally {
          setLoading(false);
        }
      }
    );

    return () => unsubscribe();
  }, [navigate]);

  // =========================
  // REFRESH RESERVATIONS
  // =========================
  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await loadReservations();
    } finally {
      setRefreshing(false);
    }
  };

  // =========================
  // FORMAT DATE
  // =========================
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return "Date unavailable";
    }

    return timestamp.toDate().toLocaleString();
  };

  // =========================
  // GET CUSTOMER NAME
  // =========================
  const getCustomerName = (reservation) => {
    return (
      reservation.customerName ||
      reservation.name ||
      "Anonymous Customer"
    );
  };

  // =========================
  // GET CUSTOMER EMAIL
  // =========================
  const getCustomerEmail = (reservation) => {
    return (
      reservation.customerEmail ||
      reservation.email ||
      "No email"
    );
  };

  // =========================
  // GET RESERVATION DATE
  // =========================
  const getReservationDate = (reservation) => {
    return (
      reservation.reservationDate ||
      reservation.date ||
      "Not specified"
    );
  };

  // =========================
  // GET RESERVATION TIME
  // =========================
  const getReservationTime = (reservation) => {
    return (
      reservation.reservationTime ||
      reservation.time ||
      "Not specified"
    );
  };

  // =========================
  // GET NUMBER OF GUESTS
  // =========================
  const getGuestCount = (reservation) => {
    return (
      reservation.numberOfGuests ||
      reservation.guests ||
      reservation.partySize ||
      "Not specified"
    );
  };

  // =========================
  // GET PHONE NUMBER
  // =========================
  const getPhoneNumber = (reservation) => {
    return (
      reservation.phone ||
      reservation.contactNumber ||
      "Not specified"
    );
  };

  // =========================
  // UPDATE RESERVATION STATUS
  // =========================
  const handleStatusChange = async (
    reservationId,
    newStatus
  ) => {
    try {
      setUpdatingId(reservationId);

      const reservationRef = doc(
        db,
        "reservations",
        reservationId
      );

      await updateDoc(reservationRef, {
        status: newStatus,
      });

      // Update the UI immediately
      setReservations((currentReservations) =>
        currentReservations.map((reservation) =>
          reservation.id === reservationId
            ? {
                ...reservation,
                status: newStatus,
              }
            : reservation
        )
      );
    } catch (err) {
      console.error(
        "Error updating reservation status:",
        err
      );

      alert(
        "Unable to update reservation status. Please try again."
      );
    } finally {
      setUpdatingId(null);
    }
  };

  // =========================
  // LOADING
  // =========================
  if (loading) {
    return (
      <main className="admin-reservations-page">
        <div className="admin-reservations-container">
          <p className="admin-reservations-loading">
            Checking administrator access...
          </p>
        </div>
      </main>
    );
  }

  // =========================
  // PAGE
  // =========================
  return (
    <main className="admin-reservations-page">
      <div className="admin-reservations-container">

        {/* HEADER */}
        <header className="admin-reservations-header">
          <div>
            <p className="admin-reservations-eyebrow">
              CACTUS CAFE
            </p>

            <h1>Customer Reservations</h1>

            <p>
              View and manage table reservations
              submitted by Cactus Cafe customers.
            </p>
          </div>

          <div className="admin-reservations-header-actions">

            <button
              className="admin-refresh-button"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing
                ? "Refreshing..."
                : "↻ Refresh"}
            </button>

            <button
              className="admin-back-button"
              onClick={() =>
                navigate("/admin")
              }
            >
              ← Back to Dashboard
            </button>

          </div>
        </header>

        {/* ERROR */}
        {error && (
          <div className="admin-reservations-error">
            <p>{error}</p>

            <button
              className="admin-retry-button"
              onClick={loadReservations}
            >
              Try Again
            </button>
          </div>
        )}

        {/* EMPTY */}
        {!error && reservations.length === 0 && (
          <div className="admin-reservations-empty">

            <div className="empty-icon">
              📅
            </div>

            <h2>No Reservations Yet</h2>

            <p>
              Customer reservations will appear
              here after customers make a reservation.
            </p>

          </div>
        )}

        {/* RESERVATIONS */}
        {!error && reservations.length > 0 && (
          <section className="admin-reservations-list">

            {/* COUNT */}
            <div className="reservations-count">
              Total Reservations:{" "}
              <strong>
                {reservations.length}
              </strong>
            </div>

            {/* RESERVATION CARDS */}
            {reservations.map((reservation) => {

              const customerName =
                getCustomerName(reservation);

              const customerEmail =
                getCustomerEmail(reservation);

              const currentStatus =
                reservation.status || "Pending";

              return (
                <article
                  className="admin-reservation-card"
                  key={reservation.id}
                >

                  {/* TOP */}
                  <div className="admin-reservation-top">

                    <div>
                      <span className="reservation-label">
                        RESERVATION ID
                      </span>

                      <strong>
                        {reservation.id}
                      </strong>
                    </div>

                    {/* STATUS */}
                    <div className="reservation-status-control">

                      <span className="reservation-label">
                        STATUS
                      </span>

                      <select
                        value={currentStatus}
                        disabled={
                          updatingId ===
                          reservation.id
                        }
                        onChange={(event) =>
                          handleStatusChange(
                            reservation.id,
                            event.target.value
                          )
                        }
                      >
                        <option value="Pending">
                          Pending
                        </option>

                        <option value="Confirmed">
                          Confirmed
                        </option>

                        <option value="Completed">
                          Completed
                        </option>

                        <option value="Cancelled">
                          Cancelled
                        </option>
                      </select>

                      {updatingId ===
                        reservation.id && (
                        <small>
                          Updating...
                        </small>
                      )}

                    </div>

                  </div>

                  {/* CUSTOMER INFORMATION */}
                  <div className="admin-reservation-info">

                    {/* CUSTOMER */}
                    <div>
                      <span className="reservation-label">
                        CUSTOMER
                      </span>

                      <p>
                        {customerName}
                      </p>

                      <small>
                        {customerEmail}
                      </small>
                    </div>

                    {/* DATE */}
                    <div>
                      <span className="reservation-label">
                        DATE
                      </span>

                      <p>
                        {getReservationDate(
                          reservation
                        )}
                      </p>
                    </div>

                    {/* TIME */}
                    <div>
                      <span className="reservation-label">
                        TIME
                      </span>

                      <p>
                        {getReservationTime(
                          reservation
                        )}
                      </p>
                    </div>

                    {/* GUESTS */}
                    <div>
                      <span className="reservation-label">
                        GUESTS
                      </span>

                      <p>
                        {getGuestCount(
                          reservation
                        )}
                      </p>
                    </div>

                    {/* CONTACT */}
                    <div>
                      <span className="reservation-label">
                        CONTACT
                      </span>

                      <p>
                        {getPhoneNumber(
                          reservation
                        )}
                      </p>
                    </div>

                    {/* CREATED */}
                    <div>
                      <span className="reservation-label">
                        CREATED
                      </span>

                      <p>
                        {formatDate(
                          reservation.createdAt
                        )}
                      </p>
                    </div>

                  </div>

                  {/* NOTES */}
                  {reservation.notes && (
                    <div className="admin-reservation-notes">

                      <strong>
                        Reservation Notes
                      </strong>

                      <p>
                        {reservation.notes}
                      </p>

                    </div>
                  )}

                </article>
              );
            })}

          </section>
        )}

      </div>
    </main>
  );
}

export default AdminReservations;