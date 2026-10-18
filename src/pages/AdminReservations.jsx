import { useCallback, useEffect, useMemo, useState } from "react";
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

const STATUS_OPTIONS = [
  "Pending",
  "Confirmed",
  "Completed",
  "Cancelled",
];

const formatDate = (timestamp) => {
  if (!timestamp?.toDate) {
    return "Date unavailable";
  }

  return timestamp.toDate().toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getStatusClass = (status) =>
  String(status || "Pending")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

function AdminReservations() {
  const navigate = useNavigate();

  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const loadReservations = useCallback(async () => {
    try {
      setError("");

      const snapshot = await getDocs(
        collection(db, "reservations")
      );

      const reservationList = snapshot.docs
        .map((reservationDoc) => ({
          id: reservationDoc.id,
          ...reservationDoc.data(),
        }))
        .sort((firstReservation, secondReservation) => {
          const firstDate = firstReservation.createdAt?.toDate
            ? firstReservation.createdAt.toDate()
            : new Date(0);

          const secondDate = secondReservation.createdAt?.toDate
            ? secondReservation.createdAt.toDate()
            : new Date(0);

          return secondDate - firstDate;
        });

      setReservations(reservationList);
    } catch (loadError) {
      console.error(
        "Error loading reservations:",
        loadError
      );

      setError(
        "Unable to load reservations. Please try again."
      );
    }
  }, []);

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

          const userRef = doc(
            db,
            "users",
            currentUser.uid
          );

          const userSnapshot = await getDoc(userRef);

          if (!userSnapshot.exists()) {
            alert("User profile not found.");
            navigate("/login", { replace: true });
            return;
          }

          const userData = userSnapshot.data();

          if (userData.role !== "admin") {
            alert(
              "Access denied. Administrator account required."
            );

            navigate("/customer", { replace: true });
            return;
          }

          await loadReservations();
        } catch (accessError) {
          console.error(
            "Error checking administrator access:",
            accessError
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
  }, [loadReservations, navigate]);

  const getCustomerName = (reservation) =>
    reservation.customerName ||
    reservation.name ||
    "Anonymous customer";

  const getCustomerEmail = (reservation) =>
    reservation.customerEmail ||
    reservation.email ||
    "No email";

  const getReservationDate = (reservation) =>
    reservation.reservationDate ||
    reservation.date ||
    "Not specified";

  const getReservationTime = (reservation) =>
    reservation.reservationTime ||
    reservation.time ||
    "Not specified";

  const getGuestCount = (reservation) =>
    reservation.numberOfGuests ||
    reservation.guests ||
    reservation.partySize ||
    "Not specified";

  const getPhoneNumber = (reservation) =>
    reservation.phone ||
    reservation.contactNumber ||
    "Not specified";

  const filteredReservations = useMemo(() => {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    return reservations.filter((reservation) => {
      const currentStatus = reservation.status || "Pending";

      const matchesStatus =
        statusFilter === "All" ||
        currentStatus === statusFilter;

      const searchableText = `
        ${reservation.id}
        ${getCustomerName(reservation)}
        ${getCustomerEmail(reservation)}
        ${getPhoneNumber(reservation)}
        ${getReservationDate(reservation)}
        ${getReservationTime(reservation)}
      `.toLowerCase();

      const matchesSearch =
        normalizedSearch === "" ||
        searchableText.includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [reservations, searchTerm, statusFilter]);

  const statistics = useMemo(() => {
    const pending = reservations.filter(
      (reservation) =>
        String(reservation.status || "Pending").toLowerCase() ===
        "pending"
    ).length;

    const confirmed = reservations.filter(
      (reservation) =>
        String(reservation.status || "").toLowerCase() ===
        "confirmed"
    ).length;

    const completed = reservations.filter(
      (reservation) =>
        String(reservation.status || "").toLowerCase() ===
        "completed"
    ).length;

    return {
      total: reservations.length,
      pending,
      confirmed,
      completed,
    };
  }, [reservations]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      setNotice("");
      await loadReservations();
      setNotice("Reservations refreshed.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleStatusChange = async (
    reservationId,
    newStatus
  ) => {
    try {
      setUpdatingId(reservationId);
      setNotice("");

      await updateDoc(
        doc(db, "reservations", reservationId),
        {
          status: newStatus,
        }
      );

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

      setNotice(
        `Reservation status updated to ${newStatus}.`
      );
    } catch (updateError) {
      console.error(
        "Error updating reservation status:",
        updateError
      );

      setNotice(
        "Unable to update reservation status. Please try again."
      );
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <main className="admin-reservations-page">
        <section className="admin-reservations-loading">
          <div className="loading-icon">◷</div>
          <p className="admin-reservations-eyebrow">
            CACTUS CAFE
          </p>
          <h1>Loading reservation workspace</h1>
          <div className="loading-bar" />
        </section>
      </main>
    );
  }

  return (
    <main className="admin-reservations-page">
      <div className="admin-reservations-container">
        <header className="admin-reservations-header">
          <div>
            <p className="admin-reservations-eyebrow">
              GUEST EXPERIENCE
            </p>

            <h1>Reservations</h1>

            <p>
              Keep every booking organized and give each guest
              a smooth arrival experience.
            </p>
          </div>

          <div className="admin-reservations-header-actions">
            <button
              type="button"
              className="admin-refresh-button"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "↻ Refresh"}
            </button>

            <button
              type="button"
              className="admin-back-button"
              onClick={() => navigate("/admin")}
            >
              ← Back to dashboard
            </button>
          </div>
        </header>

        <section className="reservations-overview">
          <div className="overview-stat">
            <span>Total reservations</span>
            <strong>{statistics.total}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Pending</span>
            <strong>{statistics.pending}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Confirmed</span>
            <strong>{statistics.confirmed}</strong>
          </div>

          <div className="overview-divider" />

          <div className="overview-stat">
            <span>Completed</span>
            <strong>{statistics.completed}</strong>
          </div>
        </section>

        {notice && (
          <div className="reservations-notice" role="status">
            <span>✓</span>
            {notice}
          </div>
        )}

        {error && (
          <div className="admin-reservations-error" role="alert">
            <span>!</span>
            <p>{error}</p>

            <button
              type="button"
              className="admin-retry-button"
              onClick={loadReservations}
            >
              Try again
            </button>
          </div>
        )}

        <section className="reservations-toolbar">
          <div>
            <p className="admin-reservations-eyebrow">
              BOOKING QUEUE
            </p>

            <h2>Manage guest reservations</h2>
          </div>

          <div className="reservations-toolbar-actions">
            <label className="reservation-search">
              <span>⌕</span>

              <input
                type="search"
                placeholder="Search guest or reservation"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
              />
            </label>

            <select
              className="reservation-filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value)
              }
            >
              <option value="All">All statuses</option>

              {STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        </section>

        {!error && reservations.length === 0 && (
          <section className="admin-reservations-empty">
            <div className="empty-icon">◷</div>

            <p className="admin-reservations-eyebrow">
              BOOKING QUEUE
            </p>

            <h2>No reservations yet</h2>

            <p>
              Customer reservations will appear here after
              guests book a table.
            </p>
          </section>
        )}

        {!error &&
          reservations.length > 0 &&
          filteredReservations.length === 0 && (
            <section className="admin-reservations-empty compact-empty">
              <div className="empty-icon">⌕</div>

              <h2>No matching reservations</h2>

              <p>
                Try another search term or choose a different
                status.
              </p>
            </section>
          )}

        {!error && filteredReservations.length > 0 && (
          <section className="admin-reservations-list">
            <div className="reservations-list-heading">
              <div>
                <p className="admin-reservations-eyebrow">
                  GUEST ACTIVITY
                </p>

                <h2>
                  {filteredReservations.length}{" "}
                  {filteredReservations.length === 1
                    ? "reservation"
                    : "reservations"}{" "}
                  shown
                </h2>
              </div>
            </div>

            {filteredReservations.map((reservation) => {
              const currentStatus =
                reservation.status || "Pending";

              return (
                <article
                  className="admin-reservation-card"
                  key={reservation.id}
                >
                  <div className="reservation-card-header">
                    <div>
                      <span className="reservation-label">
                        RESERVATION
                      </span>

                      <h3>
                        #
                        {reservation.id
                          .slice(0, 8)
                          .toUpperCase()}
                      </h3>

                      <p className="reservation-created">
                        Created{" "}
                        {formatDate(reservation.createdAt)}
                      </p>
                    </div>

                    <span
                      className={`reservation-status status-${getStatusClass(
                        currentStatus
                      )}`}
                    >
                      <span className="status-dot" />
                      {currentStatus}
                    </span>
                  </div>

                  <div className="reservation-highlight">
                    <div className="highlight-date">
                      <span className="calendar-icon">◷</span>

                      <div>
                        <span>BOOKING DATE</span>
                        <strong>
                          {getReservationDate(reservation)}
                        </strong>
                      </div>
                    </div>

                    <div>
                      <span>TIME</span>
                      <strong>
                        {getReservationTime(reservation)}
                      </strong>
                    </div>

                    <div>
                      <span>GUESTS</span>
                      <strong>
                        {getGuestCount(reservation)}
                      </strong>
                    </div>
                  </div>

                  <div className="reservation-info">
                    <div>
                      <span className="reservation-label">
                        CUSTOMER
                      </span>

                      <strong>
                        {getCustomerName(reservation)}
                      </strong>

                      <small>
                        {getCustomerEmail(reservation)}
                      </small>
                    </div>

                    <div>
                      <span className="reservation-label">
                        CONTACT
                      </span>

                      <strong>
                        {getPhoneNumber(reservation)}
                      </strong>
                    </div>
                  </div>

                  {reservation.notes && (
                    <div className="reservation-notes">
                      <span className="reservation-label">
                        GUEST NOTES
                      </span>

                      <p>{reservation.notes}</p>
                    </div>
                  )}

                  <div className="reservation-status-control">
                    <label
                      htmlFor={`status-${reservation.id}`}
                    >
                      Update reservation status
                    </label>

                    <div className="status-control-row">
                      <select
                        id={`status-${reservation.id}`}
                        value={currentStatus}
                        disabled={
                          updatingId === reservation.id
                        }
                        onChange={(event) =>
                          handleStatusChange(
                            reservation.id,
                            event.target.value
                          )
                        }
                      >
                        {STATUS_OPTIONS.map((status) => (
                          <option
                            value={status}
                            key={status}
                          >
                            {status}
                          </option>
                        ))}
                      </select>

                      {updatingId === reservation.id && (
                        <span className="updating-label">
                          Updating...
                        </span>
                      )}
                    </div>
                  </div>
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