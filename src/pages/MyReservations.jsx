import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { useAuth } from "../context/Authcontext";
import { useNavigate } from "react-router-dom";
import "../styles/MyReservations.css";

const RESERVATION_STATUS_FILTERS = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

const formatPHP = (amount) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);

const getReservationStatus = (reservation) =>
  String(reservation.status || "Pending").toLowerCase().trim();

const getReservationDateState = (dateValue) => {
  if (typeof dateValue !== "string" || !dateValue) return "";

  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const reservationDate = dateParts
    ? new Date(
        Number(dateParts[1]),
        Number(dateParts[2]) - 1,
        Number(dateParts[3])
      )
    : new Date(dateValue);

  if (Number.isNaN(reservationDate.getTime())) return "";
  if (
    dateParts &&
    (reservationDate.getFullYear() !== Number(dateParts[1]) ||
      reservationDate.getMonth() !== Number(dateParts[2]) - 1 ||
      reservationDate.getDate() !== Number(dateParts[3]))
  ) {
    return "";
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  reservationDate.setHours(0, 0, 0, 0);

  return reservationDate >= today ? "upcoming" : "past";
};

function MyReservations() {
  const navigate = useNavigate();
  const { user, role } = useAuth();

  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [retryCount, setRetryCount] = useState(0);

  const reservationCounts = {
    total: reservations.length,
    pending: reservations.filter(
      (reservation) => getReservationStatus(reservation) === "pending"
    ).length,
    confirmed: reservations.filter(
      (reservation) => getReservationStatus(reservation) === "confirmed"
    ).length,
  };

  const filteredReservations =
    statusFilter === "all"
      ? reservations
      : reservations.filter(
          (reservation) =>
            getReservationStatus(reservation) === statusFilter
        );

  useEffect(() => {
    const fetchReservations = async () => {
      setLoading(true);
      setError("");

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
  }, [navigate, retryCount]);

  useEffect(() => {
    const userId = user?.uid;
    if (!userId || role !== "customer") return undefined;

    let active = true;
    const markReservationNotificationsAsRead = async () => {
      try {
        const unreadNotificationsQuery = query(
          collection(db, "notifications"),
          where("userId", "==", userId),
          where("type", "==", "reservation"),
          where("isRead", "==", false),
        );
        const snapshot = await getDocs(unreadNotificationsQuery);
        if (!active || snapshot.empty) return;

        for (let offset = 0; offset < snapshot.docs.length; offset += 500) {
          if (!active) return;
          const batch = writeBatch(db);
          snapshot.docs
            .slice(offset, offset + 500)
            .forEach((notification) => {
              batch.update(notification.ref, { isRead: true });
            });
          await batch.commit();
        }
      } catch (notificationError) {
        console.error(
          "Unable to mark reservation notifications as read:",
          notificationError,
        );
      }
    };

    markReservationNotificationsAsRead();
    return () => {
      active = false;
    };
  }, [role, user?.uid]);

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
            <div className="reservation-skeleton-header">
              <span />
              <span />
            </div>
            <div className="reservation-skeleton-details">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="reservation-skeleton-notes" />
          </div>
          <div className="reservations-loading-card" aria-hidden="true">
            <div className="reservation-skeleton-header">
              <span />
              <span />
            </div>
            <div className="reservation-skeleton-details">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="reservation-skeleton-notes" />
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

        {!error && (
          <section
            className="reservation-overview"
            aria-label="Reservation overview"
          >
            <div className="reservation-summary-grid">
              <article className="reservation-summary-card">
                <span className="reservation-summary-label">
                  Total Reservations
                </span>
                <strong>{reservationCounts.total}</strong>
                <span className="reservation-summary-detail">
                  All your table plans
                </span>
              </article>

              <article className="reservation-summary-card">
                <span className="reservation-summary-label">Pending</span>
                <strong>{reservationCounts.pending}</strong>
                <span className="reservation-summary-detail">
                  Awaiting confirmation
                </span>
              </article>

              <article className="reservation-summary-card">
                <span className="reservation-summary-label">Confirmed</span>
                <strong>{reservationCounts.confirmed}</strong>
                <span className="reservation-summary-detail">
                  Ready for your visit
                </span>
              </article>
            </div>

            {reservations.length > 0 && (
              <nav
                className="reservation-filter-tabs"
                aria-label="Filter reservations by status"
              >
                {RESERVATION_STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={`reservation-filter-tab${
                      statusFilter === filter.value ? " is-active" : ""
                    }`}
                    aria-pressed={statusFilter === filter.value}
                    onClick={() => setStatusFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </nav>
            )}
          </section>
        )}

        {error && (
          <div className="reservations-error" role="alert">
            <span className="reservations-error-icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>We could not load your reservations</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="reservations-retry-button"
              onClick={() => setRetryCount((count) => count + 1)}
            >
              Try Again
            </button>
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
          filteredReservations.length > 0 ? (
            <div className="reservations-list">
              {filteredReservations.map((reservation) => {
                const dateState = getReservationDateState(reservation.date);

                return (
                  <article
                    className={`reservation-card${
                      dateState ? ` reservation-card-${dateState}` : ""
                    }`}
                    key={reservation.id}
                  >
                    <div className="reservation-card-header">
                      <div>
                        <p className="reservation-label">
                          RESERVATION ID
                        </p>
                        <strong>{reservation.id}</strong>
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
                      <div className="reservation-detail-item reservation-detail-highlight">
                        <span className="reservation-detail-label">
                          <svg
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <rect x="3" y="5" width="14" height="12" rx="2" />
                            <path d="M6.5 3v4M13.5 3v4M3 9h14" />
                          </svg>
                          DATE
                          {dateState && (
                            <span
                              className={`reservation-date-context is-${dateState}`}
                            >
                              {dateState === "upcoming" ? "Upcoming" : "Past"}
                            </span>
                          )}
                        </span>
                        <p>{reservation.date || "Not specified"}</p>
                      </div>

                      <div className="reservation-detail-item reservation-detail-highlight">
                        <span className="reservation-detail-label">
                          <svg
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <circle cx="10" cy="10" r="7" />
                            <path d="M10 6v4l2.5 1.5" />
                          </svg>
                          TIME
                        </span>
                        <p>{reservation.time || "Not specified"}</p>
                      </div>

                      <div className="reservation-detail-item">
                        <span className="reservation-detail-label">
                          <svg
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <circle cx="7.5" cy="7" r="3" />
                            <path d="M2.5 16v-1a5 5 0 0 1 10 0v1zM13 4.5a3 3 0 0 1 0 5.8M15 12a4 4 0 0 1 2.5 3.7V16h-3" />
                          </svg>
                          GUESTS
                        </span>
                        <p>{reservation.guests || 0}</p>
                      </div>

                      <div className="reservation-detail-item">
                        <span className="reservation-detail-label">
                          <svg
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path d="M6 2.8h8a2 2 0 0 1 2 2v10.4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.8a2 2 0 0 1 2-2zM8 14.5h4" />
                          </svg>
                          CONTACT
                        </span>
                        <p>{reservation.phone || "Not specified"}</p>
                      </div>
                    </div>

                    {Number.isFinite(reservation.totalReservationFee) && (
                      <div className="reservation-payment-details">
                        <div>
                          <span>RESERVATION FEE</span>
                          <strong>
                            {formatPHP(reservation.totalReservationFee)}
                          </strong>
                        </div>
                        <div>
                          <span>PAYMENT OPTION</span>
                          <strong>
                            {reservation.selectedPaymentOption === "half"
                              ? "Half payment"
                              : "Full payment"}
                          </strong>
                        </div>
                        <div>
                          <span>AMOUNT SUBMITTED</span>
                          <strong>{formatPHP(reservation.amountPaidNow)}</strong>
                        </div>
                        <div>
                          <span>REMAINING BALANCE</span>
                          <strong>{formatPHP(reservation.remainingBalance)}</strong>
                        </div>
                        <div>
                          <span>PAYMENT STATUS</span>
                          <strong>
                            {String(reservation.paymentStatus || "pending")
                              .replace(/_/g, " ")
                              .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                          </strong>
                        </div>
                        {reservation.paymentReference && (
                          <div>
                            <span>PAYMENT REFERENCE</span>
                            <strong>{reservation.paymentReference}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {reservation.notes && (
                      <div className="reservation-notes">
                        <strong>Special Requests:</strong>
                        <p>{reservation.notes}</p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="reservations-filter-empty" role="status">
              <h2>No {statusFilter} reservations</h2>
              <p>
                There are no reservations with this status right now.
              </p>
              <button
                type="button"
                className="reservation-clear-filter"
                onClick={() => setStatusFilter("all")}
              >
                View all reservations
              </button>
            </div>
          )
        )}

      </section>
    </main>
  );
}

export default MyReservations;