import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { NavLink, useNavigate } from "react-router-dom";

import AdminWorkspaceNavigation from "../components/AdminWorkspaceNavigation";
import AdminLoadingSkeleton from "../components/AdminLoadingSkeleton";
import { auth, db } from "../services/firebase";
import { getEffectiveRole } from "../utils/userRole";
import { listBlockedPhones } from "../services/blockedPhoneService";
import { updateStatusWithNotification } from "../services/notificationService";
import PhoneBlockControl from "../components/PhoneBlockControl";
import { normalizePHPhone } from "../utils/phoneUtils.js";
import "../styles/AdminReservations.css";
import "../styles/AdminSidebar.css";

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

const formatPHP = (amount) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);

const formatPaymentStatus = (status) =>
  String(status || "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatReservationDateForNotification = (reservation) => {
  const dateValue = reservation?.reservationDate || reservation?.date;
  if (typeof dateValue !== "string") return "your scheduled date";

  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "your scheduled date";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const getStatusClass = (status) =>
  String(status || "Pending")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");

const ReservationStatIcon = ({ name }) => {
  const icons = {
    total: (
      <>
        <rect x="4" y="5" width="16" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M4 10h16" />
      </>
    ),
    pending: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    confirmed: <path d="m5 12 4 4L19 6" />,
    completed: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
};

function AdminReservations() {
  const navigate = useNavigate();

  const receiptDialogRef = useRef(null);
  const [reservations, setReservations] = useState([]);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [blockedPhonesByNumber, setBlockedPhonesByNumber] = useState({});
  const [blockedPhonesLoading, setBlockedPhonesLoading] = useState(true);
  const [blockedPhonesError, setBlockedPhonesError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    const dialog = receiptDialogRef.current;
    if (!dialog) return;

    if (receiptPreview && !dialog.open) {
      dialog.showModal();
    } else if (!receiptPreview && dialog.open) {
      dialog.close();
    }
  }, [receiptPreview]);

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
      return true;
    } catch (loadError) {
      console.error(
        "Error loading reservations:",
        loadError
      );

      setNotice("");
      setError(
        "Unable to load reservations. Please try again."
      );
      return false;
    }
  }, []);

  const loadBlockedPhones = useCallback(async () => {
    setBlockedPhonesLoading(true);
    try {
      setBlockedPhonesError("");
      const blockedPhones = await listBlockedPhones(db);
      setBlockedPhonesByNumber(
        blockedPhones.reduce((lookup, blockedPhone) => {
          const phone = normalizePHPhone(
            blockedPhone.phoneNumber || blockedPhone.phone || blockedPhone.id,
          );
          if (phone) lookup[phone] = blockedPhone;
          return lookup;
        }, {}),
      );
      return true;
    } catch (loadError) {
      console.error("Error loading blocked phone numbers:", loadError);
      setBlockedPhonesError(
        "Unable to verify blocked phone numbers. Block actions are disabled until this is resolved.",
      );
      return false;
    } finally {
      setBlockedPhonesLoading(false);
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

          const userRole = getEffectiveRole(userData);

          if (userRole !== "admin" && userRole !== "staff") {
            alert(
              "Access denied. Administrator account required."
            );

            navigate(
              userRole === "customer" ? "/menu" : "/login",
              { replace: true },
            );
            return;
          }

          await Promise.all([loadReservations(), loadBlockedPhones()]);
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
  }, [loadBlockedPhones, loadReservations, navigate]);

  const handlePhoneBlocked = useCallback((phone) => {
    setBlockedPhonesByNumber((currentPhones) => ({
      ...currentPhones,
      [phone]: { phone, phoneNumber: phone },
    }));
  }, []);

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
      const [loaded, blockedPhonesLoaded] = await Promise.all([
        loadReservations(),
        loadBlockedPhones(),
      ]);

      if (loaded && blockedPhonesLoaded) {
        setNotice("Reservations and phone statuses refreshed.");
      }
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

      const reservation = reservations.find(
        (item) => item.id === reservationId,
      );
      const isApproval = newStatus === "Confirmed";
      const result = await updateStatusWithNotification({
        database: db,
        collectionName: "reservations",
        itemId: reservationId,
        userIdField: "userId",
        type: "reservation",
        newStatus,
        title: isApproval
          ? "Table reservation approved"
          : "Reservation status updated",
        message: (status) => isApproval
          ? `Your table reservation on ${formatReservationDateForNotification(
            reservation,
          )} is approved. We look forward to welcoming you at Cactus Café.`
          : `Your reservation status is now ${status}.`,
      });

      if (!result.changed) {
        setNotice(`Reservation status is already ${newStatus}.`);
        return;
      }

      if (!result.notificationCreated) {
        console.warn(
          `Reservation ${reservationId} has no customer ID; notification skipped.`,
        );
      }

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

      setNotice(result.notificationCreated
        ? `Reservation status updated to ${newStatus}.`
        : `Reservation status updated to ${newStatus}, but no customer ID was available for a notification.`);
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

  const handleLogout = async () => {
    if (loggingOut) return;

    try {
      setLoggingOut(true);
      await signOut(auth);
      navigate("/login");
    } catch (logoutError) {
      console.error("Logout error:", logoutError);
      setNotice("Unable to log out. Please try again.");
      setLoggingOut(false);
    }
  };

  return (
    <main className="admin-reservations-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="admin-reservations-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`admin-reservations-sidebar ${
          mobileNavigationOpen ? "is-open" : ""
        }`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/menu"
          className="admin-reservations-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-reservations-brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            <strong>Cactus Café</strong>
            <small>STAFF WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-reservations-sidebar-label">WORKSPACE</div>
        <nav className="admin-reservations-nav">
          <AdminWorkspaceNavigation
            classPrefix="admin-reservations"
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </nav>

        <div className="admin-reservations-sidebar-footer">
          <div className="admin-reservations-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Every great visit starts with a warm welcome.</p>
          </div>
          <button
            type="button"
            className="admin-reservations-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span className="admin-reservations-nav-icon" aria-hidden="true">
              ↪
            </span>
            <span>{loggingOut ? "Signing out..." : "Log out"}</span>
          </button>
        </div>
      </aside>

      <div className="admin-reservations-main">
        <div className="admin-reservations-container">
          <header className="admin-reservations-header">
            <button
              type="button"
              className="admin-reservations-mobile-toggle"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavigationOpen}
              onClick={() => setMobileNavigationOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>

            <div className="admin-reservations-heading">
              <p className="admin-reservations-eyebrow">
                RESERVATION MANAGEMENT
              </p>
              <h1>Manage Reservations</h1>
              <p>
                Review bookings, guest details, and reservation statuses in
                one place.
              </p>
            </div>

            <div className="admin-reservations-header-actions">
              <button
                type="button"
                className="admin-refresh-button"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16.5 8A6.7 6.7 0 0 0 4.7 5.4L3.5 7" />
                  <path d="M3.5 3.5V7h3.5M3.5 12a6.7 6.7 0 0 0 11.8 2.6l1.2-1.6" />
                  <path d="M16.5 16.5V13H13" />
                </svg>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="admin-reservations-profile">
              <span
                className="admin-reservations-profile-avatar"
                aria-hidden="true"
              >
                {(auth.currentUser?.displayName || "A")
                  .slice(0, 1)
                  .toUpperCase()}
              </span>
              <span className="admin-reservations-profile-copy">
                <strong>
                  {auth.currentUser?.displayName || "Cafe Admin"}
                </strong>
                <small>Administrator</small>
              </span>
            </div>
          </header>

          {loading ? (
            <AdminLoadingSkeleton label="Loading reservations" stats={4} rows={5} />
          ) : (
            <>
          <section className="reservations-overview">
            <div className="overview-stat">
              <span
                className="overview-stat-icon total-reservations-icon"
                aria-hidden="true"
              >
                <ReservationStatIcon name="total" />
              </span>
              <span className="overview-stat-copy">
                <span>Total Reservations</span>
                <strong>{statistics.total}</strong>
              </span>
            </div>

            <div className="overview-stat">
              <span
                className="overview-stat-icon pending-reservations-icon"
                aria-hidden="true"
              >
                <ReservationStatIcon name="pending" />
              </span>
              <span className="overview-stat-copy">
                <span>Pending</span>
                <strong>{statistics.pending}</strong>
              </span>
            </div>

            <div className="overview-stat">
              <span
                className="overview-stat-icon confirmed-reservations-icon"
                aria-hidden="true"
              >
                <ReservationStatIcon name="confirmed" />
              </span>
              <span className="overview-stat-copy">
                <span>Confirmed</span>
                <strong>{statistics.confirmed}</strong>
              </span>
            </div>

            <div className="overview-stat">
              <span
                className="overview-stat-icon completed-reservations-icon"
                aria-hidden="true"
              >
                <ReservationStatIcon name="completed" />
              </span>
              <span className="overview-stat-copy">
                <span>Completed</span>
                <strong>{statistics.completed}</strong>
              </span>
            </div>
          </section>

          {notice && (
            <div className="reservations-notice" role="status">
              <span>✓</span>
              {notice}
            </div>
          )}

          {blockedPhonesError && (
            <div className="admin-reservations-error" role="alert">
              <span>!</span>
              <p>{blockedPhonesError}</p>
              <button
                type="button"
                className="admin-retry-button"
                onClick={loadBlockedPhones}
                disabled={blockedPhonesLoading}
              >
                Try again
              </button>
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
                        <PhoneBlockControl
                          phone={getPhoneNumber(reservation)}
                          customerUid={
                            reservation.userId || reservation.customerId
                          }
                          adminUid={auth.currentUser?.uid}
                          isBlocked={Boolean(
                            blockedPhonesByNumber[
                              normalizePHPhone(getPhoneNumber(reservation))
                            ],
                          )}
                          canBlock={
                            !blockedPhonesLoading && !blockedPhonesError
                          }
                          onBlocked={handlePhoneBlocked}
                        />
                      </div>
                    </div>

                    {Number.isFinite(reservation.totalReservationFee) && (
                      <div className="admin-reservation-payment">
                        <div>
                          <span>PER-HEAD RATE</span>
                          <strong>{formatPHP(reservation.perHeadRate)}</strong>
                        </div>
                        <div>
                          <span>TOTAL RESERVATION FEE</span>
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
                          <strong>{formatPaymentStatus(reservation.paymentStatus)}</strong>
                        </div>
                        {reservation.paymentReference && (
                          <div className="admin-reservation-payment-reference">
                            <span>GCASH / MAYA REFERENCE</span>
                            <strong>{reservation.paymentReference}</strong>
                          </div>
                        )}
                        <div className="admin-reservation-payment-proof">
                          <span>RECEIPT SCREENSHOT</span>
                          {reservation.paymentProofUrl ? (
                            <>
                              <div className="admin-reservation-receipt-actions">
                                <button
                                  type="button"
                                  className="admin-reservation-receipt-thumbnail"
                                  onClick={() => setReceiptPreview({
                                    url: reservation.paymentProofUrl,
                                    label: `Reservation #${reservation.id
                                      .slice(0, 8)
                                      .toUpperCase()} receipt`,
                                  })}
                                  aria-label="Enlarge reservation payment receipt"
                                >
                                  <img
                                    src={reservation.paymentProofUrl}
                                    alt=""
                                  />
                                  <span>Enlarge receipt</span>
                                </button>
                                <a
                                  href={reservation.paymentProofUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="admin-reservation-receipt-original"
                                >
                                  Open original
                                </a>
                              </div>
                              <p>
                                Confirm the payment reference and exact amount
                                submitted before confirming this reservation.
                              </p>
                            </>
                          ) : (
                            <strong>No payment screenshot provided.</strong>
                          )}
                        </div>
                      </div>
                    )}

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
            </>
          )}
        </div>
      </div>
      <dialog
        ref={receiptDialogRef}
        className="admin-reservation-receipt-dialog"
        aria-label="Reservation payment receipt"
        onClose={() => setReceiptPreview(null)}
      >
        {receiptPreview && (
          <div className="admin-reservation-receipt-dialog-content">
            <header>
              <h2>{receiptPreview.label}</h2>
              <button
                type="button"
                onClick={() => receiptDialogRef.current?.close()}
                aria-label="Close receipt preview"
              >
                ×
              </button>
            </header>
            <img src={receiptPreview.url} alt={receiptPreview.label} />
            <a
              href={receiptPreview.url}
              target="_blank"
              rel="noreferrer"
            >
              Open original
            </a>
          </div>
        )}
      </dialog>
    </main>
  );
}

export default AdminReservations;