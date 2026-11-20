import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import {
  CAFE_CONTACT_PHONE,
  CAFE_CONTACT_PHONE_TEL,
} from "../constants/cafeInfo.js";
import { isPhoneBlocked } from "../services/blockedPhoneService.js";
import { saveCustomerProfileWithPhone } from "../services/phoneRegistryService.js";
import { auth, db } from "../services/firebase";
import { useAuth } from "../context/Authcontext";
import {
  normalizePHPhone,
  PH_PHONE_VALIDATION_ERROR,
} from "../utils/phoneUtils.js";
import "../styles/ReservationsPage.css";

const RESERVATION_FEE_PER_HEAD = 50;
const BLOCKED_PHONE_MESSAGE =
  "This phone number is blocked and cannot be used for reservations. Please contact the café.";
const FIRST_PHONE_CONFIRMATION =
  "Please double-check this mobile number. Saving it to your profile will lock it for 30 days. Continue?";
const formatPHP = (amount) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(amount);

const getProfilePhone = (profile) =>
  String(profile?.phoneNumber || profile?.phone || "").trim();

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

function ReservationsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerProfile, setCustomerProfile] = useState(null);
  const [profileLoadedUid, setProfileLoadedUid] = useState("");
  const [profileLoadError, setProfileLoadError] = useState("");
  const [phoneCheck, setPhoneCheck] = useState({
    phone: "",
    loading: false,
    blocked: false,
    error: "",
  });
  const [formError, setFormError] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(1);
  const [notes, setNotes] = useState("");
  const [selectedPaymentOption, setSelectedPaymentOption] = useState("full");
  const [paymentReference, setPaymentReference] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contactCopyStatus, setContactCopyStatus] = useState("");
  const guestCount = Number(guests);
  const totalReservationFee =
    Number.isInteger(guestCount) && guestCount > 0
      ? guestCount * RESERVATION_FEE_PER_HEAD
      : 0;
  const amountPaidNow =
    selectedPaymentOption === "half"
      ? totalReservationFee / 2
      : totalReservationFee;
  const remainingBalance = totalReservationFee - amountPaidNow;
  const profileLoading = authLoading
    || Boolean(user?.uid && profileLoadedUid !== user.uid);
  const currentProfileLoadError =
    user?.uid && profileLoadedUid === user.uid ? profileLoadError : "";
  const profileReady = Boolean(
    user?.uid
    && profileLoadedUid === user.uid
    && customerProfile
    && !currentProfileLoadError
    && !profileLoading,
  );
  const profilePhoneValue = profileReady ? getProfilePhone(customerProfile) : "";
  const hasRegisteredPhone = Boolean(profilePhoneValue);
  const registeredPhone = normalizePHPhone(profilePhoneValue);
  const phoneToCheck = profileReady
    ? normalizePHPhone(
      hasRegisteredPhone ? profilePhoneValue : phone,
    )
    : "";
  const phoneCheckIsCurrent =
    Boolean(phoneToCheck) && phoneCheck.phone === phoneToCheck;
  const phoneBlocked = phoneCheckIsCurrent && phoneCheck.blocked;
  const phoneCheckError =
    phoneCheckIsCurrent ? phoneCheck.error : "";
  const phoneCheckPending =
    Boolean(phoneToCheck)
    && (!phoneCheckIsCurrent || phoneCheck.loading);
  const invalidRegisteredPhone =
    hasRegisteredPhone && !registeredPhone;

  const handleCopyCafePhone = async () => {
    try {
      await navigator.clipboard.writeText(CAFE_CONTACT_PHONE);
      setContactCopyStatus("Phone number copied.");
    } catch (error) {
      console.error("Unable to copy Cactus Café's contact number:", error);
      setContactCopyStatus(
        "Unable to copy. You can select and copy the number above.",
      );
    }
  };

  useEffect(() => {
    if (authLoading || !user?.uid) return undefined;

    let active = true;

    getDoc(doc(db, "users", user.uid))
      .then((profileSnapshot) => {
        if (!active) return;

        if (!profileSnapshot.exists()) {
          setProfileLoadError(
            "Your customer profile could not be found. Please contact the café before making a reservation.",
          );
          setProfileLoadedUid(user.uid);
          return;
        }

        const profile = profileSnapshot.data();
        setCustomerProfile(profile);
        setProfileLoadedUid(user.uid);
        setProfileLoadError("");
        setPhone(normalizePHPhone(getProfilePhone(profile)));
      })
      .catch((error) => {
        if (!active) return;
        console.error("Error loading reservation customer profile:", error);
        setProfileLoadError(
          "Your saved contact details could not be verified. Reload the page before making a reservation.",
        );
        setProfileLoadedUid(user.uid);
      });

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  useEffect(() => {
    if (!profileReady || !phoneToCheck) return undefined;

    let active = true;

    isPhoneBlocked(db, phoneToCheck)
      .then((blocked) => {
        if (!active) return;
        setPhoneCheck({
          phone: phoneToCheck,
          loading: false,
          blocked,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;
        console.error("Error checking reservation phone block status:", error);
        setPhoneCheck({
          phone: phoneToCheck,
          loading: false,
          blocked: false,
          error: "Unable to verify this mobile number. Please try again.",
        });
      });

    return () => {
      active = false;
    };
  }, [phoneToCheck, profileReady]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    setFormError("");

    const currentUser = auth.currentUser;

    if (!currentUser) {
      alert("Please log in before making a reservation.");
      navigate("/login");
      return;
    }

    if (!profileReady) {
      setFormError(
        currentProfileLoadError
          || "Please wait while we verify your saved contact details.",
      );
      return;
    }

    if (invalidRegisteredPhone) {
      setFormError(
        "Your saved mobile number is invalid. Please manage it in My Account.",
      );
      return;
    }

    const normalizedPhone = hasRegisteredPhone
      ? registeredPhone
      : normalizePHPhone(phone);
    if (!customerName.trim()) {
      alert("Please enter your name.");
      return;
    }
    if (!normalizedPhone) {
      alert(PH_PHONE_VALIDATION_ERROR);
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

    if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) {
      alert("Number of guests must be from 1 to 20.");
      return;
    }

    const cleanPaymentReference = paymentReference.trim();
    if (!cleanPaymentReference || cleanPaymentReference.length > 100) {
      alert("Enter a valid GCash / Maya payment reference number.");
      return;
    }

    if (phoneBlocked) {
      setFormError(BLOCKED_PHONE_MESSAGE);
      return;
    }

    if (phoneCheckPending || phoneCheckError) {
      setFormError(
        phoneCheckError || "Please wait while we verify your mobile number.",
      );
      return;
    }

    if (
      !hasRegisteredPhone
      && !window.confirm(FIRST_PHONE_CONFIRMATION)
    ) {
      return;
    }

    try {
      setIsSubmitting(true);
      if (await isPhoneBlocked(db, normalizedPhone)) {
        setFormError(BLOCKED_PHONE_MESSAGE);
        setPhoneCheck({
          phone: normalizedPhone,
          loading: false,
          blocked: true,
          error: "",
        });
        return;
      }

      await saveCustomerProfileWithPhone(
        db,
        currentUser.uid,
        normalizedPhone,
        {},
      );

      await addDoc(collection(db, "reservations"), {
        userId: currentUser.uid,
        customerEmail: currentUser.email || "",

        customerName: customerName.trim(),
        phone: normalizedPhone,

        date,
        time,
        guests: guestCount,

        notes: notes.trim(),

        status: "Pending",
        perHeadRate: RESERVATION_FEE_PER_HEAD,
        totalReservationFee,
        selectedPaymentOption,
        amountPaidNow,
        remainingBalance,
        paymentMethod: "qr",
        paymentReference: cleanPaymentReference,
        paymentStatus: "pending_review",

        createdAt: serverTimestamp(),
      });

      alert("Reservation submitted successfully! 🌵");

      navigate("/customer");
    } catch (error) {
      console.error("Error creating reservation:", error);

      if (error?.code === "phone/blocked") {
        setFormError(BLOCKED_PHONE_MESSAGE);
        setPhoneCheck({
          phone: normalizedPhone,
          loading: false,
          blocked: true,
          error: "",
        });
      } else {
        alert(
          error?.code === "phone/already-registered"
            ? "This phone number is already registered to another account. Please use another phone number."
            : "Unable to create reservation. Please try again.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <main className="reservations-page">
        <section className="reservations-container">

        <div className="reservations-header">
          <p className="reservations-eyebrow">CACTUS CAFE</p>

          <h1>Make a Reservation</h1>

          <p>
            Reserve a table and enjoy your time at Cactus Cafe.
          </p>
        </div>

        <aside
          className="reservation-contact-card"
          aria-label="Cactus Café reservation contact"
        >
          <div className="reservation-contact-content">
            <span className="reservation-contact-icon" aria-hidden="true">
              ☎
            </span>
            <div>
              <p className="reservation-contact-eyebrow">NEED HELP?</p>
              <h2>Questions about reservations?</h2>
              <p>Call our café team and we’ll be happy to help.</p>
            </div>
          </div>
          <div className="reservation-contact-actions">
            <a
              className="reservation-contact-call"
              href={CAFE_CONTACT_PHONE_TEL}
              aria-label={`Call Cactus Café at ${CAFE_CONTACT_PHONE}`}
            >
              <span>Call</span>
              <strong>{CAFE_CONTACT_PHONE}</strong>
            </a>
            <button
              className="reservation-contact-copy"
              type="button"
              onClick={handleCopyCafePhone}
            >
              {contactCopyStatus === "Phone number copied."
                ? "Copied!"
                : "Copy number"}
            </button>
          </div>
          {contactCopyStatus && (
            <p className="reservation-contact-feedback" role="status">
              {contactCopyStatus}
            </p>
          )}
        </aside>

        <form
          className="reservation-form"
          onSubmit={handleSubmit}
        >

          <h2>Reservation Details</h2>

          {currentProfileLoadError && (
            <p className="reservation-error" role="alert">
              {currentProfileLoadError}
            </p>
          )}
          {(formError || phoneBlocked) && (
            <p className="reservation-error" role="alert">
              {phoneBlocked ? BLOCKED_PHONE_MESSAGE : formError}
            </p>
          )}

          <div className="form-group">
            <label htmlFor="customerName">
              Full Name
            </label>

            <input
              id="customerName"
              type="text"
              value={customerName}
              maxLength={120}
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
              maxLength={40}
              onChange={(event) => {
                setPhone(event.target.value);
                setFormError("");
                setPhoneCheck({
                  phone: "",
                  loading: false,
                  blocked: false,
                  error: "",
                });
              }}
              placeholder="Enter your contact number"
              required
              readOnly={
                !profileReady
                || hasRegisteredPhone
                || Boolean(currentProfileLoadError)
              }
              aria-describedby={
                hasRegisteredPhone
                  ? "reservation-phone-profile-notice"
                  : "reservation-phone-setup-notice"
              }
            />
            {hasRegisteredPhone ? (
              <>
                <p
                  className="reservation-phone-notice"
                  id="reservation-phone-profile-notice"
                >
                  This number is saved to your profile and cannot be changed here.
                </p>
                <Link className="reservation-manage-link" to="/my-account">
                  Manage in My Account
                </Link>
              </>
            ) : (
              <p
                className="reservation-phone-notice"
                id="reservation-phone-setup-notice"
              >
                Saving your first number will lock it for 30 days. Double-check it before continuing.
              </p>
            )}
            {invalidRegisteredPhone && (
              <p className="reservation-error" role="alert">
                Your saved mobile number is invalid. Please manage it in My Account.
              </p>
            )}
            {phoneCheckPending && (
              <p className="reservation-phone-notice" role="status">
                Checking this mobile number...
              </p>
            )}
            {phoneCheckError && (
              <p className="reservation-error" role="alert">
                {phoneCheckError}
              </p>
            )}
            {phoneCheckError && (
              <p className="reservation-error" role="alert">
                {phoneCheckError}
              </p>
            )}
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
              step="1"
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

          <fieldset className="reservation-payment">
            <legend>Reservation Fee &amp; Payment</legend>
            <p className="reservation-payment-rate">
              {formatPHP(RESERVATION_FEE_PER_HEAD)} per guest
            </p>

            <div className="reservation-payment-options">
              <label
                className={`reservation-payment-card${
                  selectedPaymentOption === "full" ? " is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="reservationPaymentOption"
                  value="full"
                  checked={selectedPaymentOption === "full"}
                  onChange={() => setSelectedPaymentOption("full")}
                />
                <span className="reservation-payment-copy">
                  <strong>Pay Full Fee Now</strong>
                  <span>{formatPHP(totalReservationFee)} upfront</span>
                </span>
              </label>

              <label
                className={`reservation-payment-card${
                  selectedPaymentOption === "half" ? " is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="reservationPaymentOption"
                  value="half"
                  checked={selectedPaymentOption === "half"}
                  onChange={() => setSelectedPaymentOption("half")}
                />
                <span className="reservation-payment-copy">
                  <strong>Pay Half Payment Now</strong>
                  <span>
                    {formatPHP(totalReservationFee / 2)} upfront; remaining
                    balance due upon arrival and deducted from the bill
                  </span>
                </span>
              </label>
            </div>

            <div className="reservation-payment-totals" aria-live="polite">
              <div>
                <span>Total Reservation Fee</span>
                <strong>{formatPHP(totalReservationFee)}</strong>
              </div>
              <div className="reservation-payment-due">
                <span>Amount Due Now</span>
                <strong>{formatPHP(amountPaidNow)}</strong>
              </div>
              {remainingBalance > 0 && (
                <div>
                  <span>Remaining Balance (due upon arrival, deducted from bill)</span>
                  <strong>{formatPHP(remainingBalance)}</strong>
                </div>
              )}
            </div>

            <p className="reservation-payment-instructions">
              Pay using Cactus Café&apos;s official GCash / Maya QR details
              provided by the café, then enter your transaction reference
              below.               Your payment will remain pending review until verified.
            </p>

            <div className="form-group reservation-payment-reference">
              <label htmlFor="paymentReference">
                GCash / Maya Payment Reference
              </label>
              <input
                id="paymentReference"
                name="paymentReference"
                type="text"
                autoComplete="off"
                maxLength={100}
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="Enter your transaction reference number"
                required
              />
            </div>
          </fieldset>

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
              disabled={
                isSubmitting
                || (Boolean(user?.uid) && (!profileReady || profileLoading))
                || Boolean(currentProfileLoadError)
                || invalidRegisteredPhone
                || phoneBlocked
                || phoneCheckPending
                || Boolean(phoneCheckError)
              }
            >
              {isSubmitting
                ? "Submitting..."
                : "Reserve Table"}
            </button>

          </div>

        </form>

        </section>
      </main>
      <SiteFooter />
    </>
  );
}

export default ReservationsPage;