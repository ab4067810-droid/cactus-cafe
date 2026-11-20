import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import {
  ISABELA_BARANGAYS,
  ISABELA_MUNICIPALITY,
  ISABELA_OTHER_STREET_OPTION,
  ISABELA_STREETS_BY_BARANGAY,
  NEGROS_OCCIDENTAL_PROVINCE,
  isWithinIsabelaDeliveryBounds,
} from "../constants/isabelaAddress";
import IsabelaDeliveryMap from "../components/IsabelaDeliveryMap";
import { getCartItemKey, useCart } from "../context/CartContext";
import { isPhoneBlocked } from "../services/blockedPhoneService.js";
import { saveCustomerProfileWithPhone } from "../services/phoneRegistryService.js";
import { auth, db } from "../services/firebase";
import {
  isValidPHPhone,
  normalizePHPhone,
} from "../utils/phoneUtils.js";
import {
  DELIVERY_SCOPE_BARANGAYS,
  getCanonicalDeliveryBarangay,
  isBarangayInDeliveryScope,
} from "../utils/deliveryScope.js";
import "../styles/CheckoutPage.css";

const formatPrice = (price) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(price) || 0);

const emptyCart = [];
const MAX_ORDER_LINES = 10;
const MIN_ITEM_QUANTITY = 1;
const MAX_ITEM_QUANTITY = 99;
const BLOCKED_PHONE_MESSAGE =
  "This phone number is blocked and cannot be used for orders. Please contact the café.";
const FIRST_PHONE_CONFIRMATION =
  "Please double-check this mobile number. Saving it to your profile will lock it for 30 days. Continue?";
const CUSTOMER_DETAIL_FIELDS = [
  "customerName",
  "phone",
];
const ADDRESS_DETAIL_FIELDS = [
  "houseNumberStreet",
  "barangay",
  "streetPurok",
  "municipalityCity",
  "province",
];
const DELIVERY_DETAIL_FIELDS = [
  "deliveryInstructions",
  "deliveryLocation",
];

const getProfileName = (profile, authUser) => {
  const firstName = String(profile.firstName || "").trim();
  const lastName = String(profile.lastName || "").trim();

  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim();
  }

  return String(
    profile.name ||
      profile.fullName ||
      profile.displayName ||
      authUser.displayName ||
      "",
  ).trim();
};

const getProfileAddress = (profile) => {
  const address = profile.deliveryAddress;

  if (address && typeof address === "object" && !Array.isArray(address)) {
    return address;
  }

  return {};
};

const getProfilePhone = (profile) =>
  String(profile.phoneNumber || profile.phone || "").trim();

const isEmptyDetail = (value) => (
  value == null || (typeof value === "string" && !value.trim())
);

const formatCustomerAddress = (details, includeDeliveryInstructions = false) => {
  const houseDetails = details.houseNumberStreet.trim();
  const selectedStreet = details.streetPurok === ISABELA_OTHER_STREET_OPTION
    ? ""
    : details.streetPurok.trim();
  const streetAddress = [
    houseDetails,
    selectedStreet,
  ]
    .filter((part, index, parts) => (
      part && (index === 0 || part.toLowerCase() !== parts[0].toLowerCase())
    ))
    .join(", ");
  const address = [
    streetAddress,
    details.barangay.trim(),
    ISABELA_MUNICIPALITY,
    NEGROS_OCCIDENTAL_PROVINCE,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

  if (
    !includeDeliveryInstructions
    || !address
    || !details.deliveryInstructions.trim()
  ) {
    return address;
  }

  return `${address}\nDelivery instructions: ${details.deliveryInstructions.trim()}`;
};

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

function ConfirmationCustomerAvatar({ photoURL }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl = typeof photoURL === "string" ? photoURL.trim() : "";

  return (
    <span className="checkout-customer-avatar" aria-hidden="true">
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
        </svg>
      )}
    </span>
  );
}

function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { clearCart } = useCart();

  const cart = location.state?.cart ?? emptyCart;

  const [orderType, setOrderType] = useState("takeout");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentTiming, setPaymentTiming] = useState("pay_later");
  const [details, setDetails] = useState({
    customerName: "",
    phone: "",
    houseNumberStreet: "",
    barangay: "",
    streetPurok: "",
    municipalityCity: ISABELA_MUNICIPALITY,
    province: NEGROS_OCCIDENTAL_PROVINCE,
    deliveryInstructions: "",
    deliveryLocation: null,
    notes: "",
  });
  const [customerProfile, setCustomerProfile] = useState(null);
  const [profileLoadDone, setProfileLoadDone] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState("");
  const editedFields = useRef(new Set());

  const submissionInProgress = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [phoneFieldError, setPhoneFieldError] = useState("");
  const [phoneCheck, setPhoneCheck] = useState({
    phone: "",
    loading: false,
    blocked: false,
    error: "",
  });
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [phoneConfirmationError, setPhoneConfirmationError] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState("");
  const [submittedCustomerName, setSubmittedCustomerName] = useState("");
  const [submittedCustomerPhotoURL, setSubmittedCustomerPhotoURL] =
    useState("");
  const [submittedAt, setSubmittedAt] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const copyFeedbackTimer = useRef(null);
  const phoneInputRef = useRef(null);
  const phoneConfirmationRef = useRef(null);

  useEffect(() => () => {
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current);
    }
  }, []);

  useEffect(() => {
    let isCurrent = true;
    let profileLoadId = 0;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const currentLoadId = ++profileLoadId;
      setCustomerProfile(null);
      setProfileLoadDone(false);
      setProfileLoadError("");

      if (!currentUser) {
        setProfileLoadDone(true);
        return;
      }

      const authProfile = {
        uid: currentUser.uid,
        authDisplayName: currentUser.displayName || "",
        data: {},
      };

      try {
        const profileSnapshot = await getDoc(
          doc(db, "users", currentUser.uid),
        );

        if (!isCurrent || currentLoadId !== profileLoadId) return;

        if (!profileSnapshot.exists()) {
          setCustomerProfile(authProfile);
          setProfileLoadError(
            "Your customer profile could not be found. Please contact the café before placing an order.",
          );
          setProfileLoadDone(true);
          return;
        }

        setCustomerProfile({
          ...authProfile,
          data: profileSnapshot.data(),
        });
        setProfileLoadDone(true);
      } catch (error) {
        if (!isCurrent || currentLoadId !== profileLoadId) return;

        console.error("Error loading checkout customer profile:", error);
        setCustomerProfile(authProfile);
        setProfileLoadError(
          "Your saved contact details could not be verified. Reload the page before placing an order.",
        );
        setProfileLoadDone(true);
      }
    });

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, []);

  const profilePhoneValue = customerProfile
    ? getProfilePhone(customerProfile.data)
    : "";
  const hasRegisteredPhone = Boolean(profilePhoneValue);
  const registeredPhone = normalizePHPhone(profilePhoneValue);
  const phoneToCheck = customerProfile
    ? normalizePHPhone(
      hasRegisteredPhone ? profilePhoneValue : details.phone,
    )
    : "";
  const phoneCheckIsCurrent =
    Boolean(phoneToCheck) && phoneCheck.phone === phoneToCheck;
  const phoneBlocked =
    phoneCheckIsCurrent && phoneCheck.blocked;
  const phoneCheckError =
    phoneCheckIsCurrent ? phoneCheck.error : "";
  const phoneCheckPending =
    Boolean(phoneToCheck)
    && (!phoneCheckIsCurrent || phoneCheck.loading);
  const invalidRegisteredPhone =
    hasRegisteredPhone && !registeredPhone;

  useEffect(() => {
    if (!customerProfile || !phoneToCheck) return undefined;

    let isCurrent = true;

    isPhoneBlocked(db, phoneToCheck)
      .then((blocked) => {
        if (!isCurrent) return;
        setPhoneCheck({
          phone: phoneToCheck,
          loading: false,
          blocked,
          error: "",
        });
      })
      .catch((error) => {
        if (!isCurrent) return;
        console.error("Error checking checkout phone block status:", error);
        setPhoneCheck({
          phone: phoneToCheck,
          loading: false,
          blocked: false,
          error: "Unable to verify this mobile number. Please try again.",
        });
      });

    return () => {
      isCurrent = false;
    };
  }, [customerProfile, phoneToCheck]);

  useEffect(() => {
    if (!customerProfile) return;

    const profile = customerProfile.data;
    const savedAddress = getProfileAddress(profile);
    const savedPhone = getProfilePhone(profile);
    const savedDetails = {
      customerName: getProfileName(profile, {
        displayName: customerProfile.authDisplayName,
      }),
      phone: normalizePHPhone(savedPhone),
      houseNumberStreet: String(savedAddress.houseNumberStreet || ""),
      barangay: String(savedAddress.barangay || ""),
      streetPurok: String(
        savedAddress.streetPurok || (
          savedAddress.houseNumberStreet
          && ISABELA_STREETS_BY_BARANGAY[savedAddress.barangay]
            ? ISABELA_OTHER_STREET_OPTION
            : ""
        ),
      ),
      municipalityCity: ISABELA_MUNICIPALITY,
      province: NEGROS_OCCIDENTAL_PROVINCE,
      deliveryInstructions: String(
        savedAddress.deliveryInstructions || "",
      ),
      deliveryLocation: isWithinIsabelaDeliveryBounds(
        savedAddress.deliveryLocation,
      )
        ? {
          lat: savedAddress.deliveryLocation.lat,
          lng: savedAddress.deliveryLocation.lng,
        }
        : null,
    };

    setDetails((currentDetails) => {
      const nextDetails = { ...currentDetails };
      const fieldsToFill = orderType === "delivery"
        ? [
          ...CUSTOMER_DETAIL_FIELDS,
          ...ADDRESS_DETAIL_FIELDS,
          ...DELIVERY_DETAIL_FIELDS,
        ]
        : [...CUSTOMER_DETAIL_FIELDS, ...ADDRESS_DETAIL_FIELDS];

      fieldsToFill.forEach((field) => {
        if (
          !editedFields.current.has(field) &&
          isEmptyDetail(currentDetails[field])
        ) {
          nextDetails[field] = savedDetails[field];
        }
      });

      if (savedPhone) {
        nextDetails.phone = normalizePHPhone(savedPhone);
      }

      return nextDetails;
    });
  }, [customerProfile, orderType]);

  const handleDetailChange = (event) => {
    const { name, value } = event.target;
    editedFields.current.add(name);
    if (name === "phone") {
      setPhoneFieldError("");
      setPhoneCheck({
        phone: "",
        loading: false,
        blocked: false,
        error: "",
      });
      setPhoneConfirmed(false);
      setPhoneConfirmationError(false);
      setErrorMessage("");
    }
    if (name === "barangay") {
      editedFields.current.add("streetPurok");
      setDetails((currentDetails) => ({
        ...currentDetails,
        barangay: value,
        streetPurok: "",
      }));
      return;
    }

    setDetails((currentDetails) => ({ ...currentDetails, [name]: value }));
  };

  const handleDeliveryLocationChange = (deliveryLocation) => {
    editedFields.current.add("deliveryLocation");
    setDetails((currentDetails) => ({
      ...currentDetails,
      deliveryLocation,
    }));
  };

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

  const cashPaymentOption =
    orderType === "delivery"
      ? {
          title: "Cash on Delivery (COD)",
          subtitle: "Pay cash to the rider when your order arrives",
        }
      : orderType === "dine-in"
        ? {
            title: "Pay at Counter",
            subtitle: "Pay cash at the cashier",
          }
        : {
            title: "Cash upon Pickup",
            subtitle: "Pay cash at the counter when picking up",
          };

  const handleCopyOrderId = async () => {
    try {
      await navigator.clipboard.writeText(submittedOrderId);
      setCopyFeedback("Copied!");
    } catch (error) {
      console.error("Unable to copy order ID:", error);
      setCopyFeedback("Unable to copy. Please select the ID manually.");
    }

    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current);
    }
    copyFeedbackTimer.current = setTimeout(() => {
      setCopyFeedback("");
      copyFeedbackTimer.current = null;
    }, 2500);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submissionInProgress.current) return;
    setErrorMessage("");

    if (cart.length === 0) {
      setErrorMessage("Your cart is empty.");
      return;
    }

    if (cart.length > MAX_ORDER_LINES) {
      setErrorMessage(
        `Your order can include no more than ${MAX_ORDER_LINES} items. Please update your cart.`
      );
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setErrorMessage("Your session has expired. Please log in again.");
      navigate("/login");
      return;
    }

    if (!customerProfile || profileLoadError) {
      setErrorMessage(
        profileLoadError
          || "Please wait while we verify your saved contact details.",
      );
      return;
    }

    if (invalidRegisteredPhone) {
      const invalidSavedPhoneMessage =
        "Your saved mobile number is invalid. Please manage it in My Account.";
      setPhoneFieldError(invalidSavedPhoneMessage);
      setErrorMessage(invalidSavedPhoneMessage);
      return;
    }

    const hasInvalidQuantity = cart.some(
      (item) =>
        !Number.isInteger(item?.quantity) ||
        item.quantity < MIN_ITEM_QUANTITY ||
        item.quantity > MAX_ITEM_QUANTITY
    );

    if (hasInvalidQuantity) {
      setErrorMessage(
        `Each item quantity must be a whole number from ${MIN_ITEM_QUANTITY} to ${MAX_ITEM_QUANTITY}.`
      );
      return;
    }

    if (!details.customerName.trim()) {
      setErrorMessage("Please enter your full name.");
      return;
    }

    if (!details.phone.trim()) {
      setPhoneFieldError(
        "Please enter your 11-digit mobile number (e.g., 0917 123 4567) so we can contact you about your order.",
      );
      setPhoneConfirmationError(false);
      setErrorMessage(
        "Please enter your 11-digit mobile number (e.g., 0917 123 4567) so we can contact you about your order.",
      );
      phoneInputRef.current?.focus();
      return;
    }

    if (!isValidPHPhone(details.phone)) {
      setPhoneFieldError(
        "Please enter a valid 11-digit Philippine mobile number starting with 09 (e.g., 0917 123 4567).",
      );
      setPhoneConfirmationError(false);
      setErrorMessage(
        "Please enter a valid 11-digit Philippine mobile number starting with 09 (e.g., 0917 123 4567).",
      );
      phoneInputRef.current?.focus();
      return;
    }
    const normalizedPhone = normalizePHPhone(details.phone);

    if (!phoneConfirmed) {
      setPhoneConfirmationError(true);
      setErrorMessage(
        "Confirm that this mobile number is valid and reachable for order updates.",
      );
      phoneConfirmationRef.current?.focus();
      return;
    }

    if (
      !details.houseNumberStreet.trim()
      || !ISABELA_BARANGAYS.includes(details.barangay)
      || !ISABELA_STREETS_BY_BARANGAY[details.barangay]?.includes(
        details.streetPurok,
      )
    ) {
      setErrorMessage(
        "Enter your house details, then select a barangay and street / purok.",
      );
      return;
    }

    if (
      orderType === "delivery"
      && !isBarangayInDeliveryScope(details.barangay)
    ) {
      setErrorMessage(
        "Delivery is currently available only in the 14 covered barangays. Choose one of them or switch to Store Pickup.",
      );
      return;
    }

    if (
      orderType === "delivery"
      && details.deliveryLocation !== null
      && !isWithinIsabelaDeliveryBounds(details.deliveryLocation)
    ) {
      setErrorMessage("Select a delivery pin within Isabela, Negros Occidental.");
      return;
    }

    const customerAddress = formatCustomerAddress(
      details,
      orderType === "delivery",
    );

    if (customerAddress.length > 500) {
      setErrorMessage(
        "Your address and instructions must be 500 characters or fewer.",
      );
      return;
    }

    if (details.notes.trim().length > 1000) {
      setErrorMessage("Order notes must be 1,000 characters or fewer.");
      return;
    }

    if (phoneBlocked) {
      setPhoneFieldError(BLOCKED_PHONE_MESSAGE);
      setErrorMessage(BLOCKED_PHONE_MESSAGE);
      return;
    }

    if (phoneCheckPending || phoneCheckError) {
      setErrorMessage(
        phoneCheckError
          || "Please wait while we verify your mobile number.",
      );
      return;
    }

    if (
      !hasRegisteredPhone
      && !window.confirm(FIRST_PHONE_CONFIRMATION)
    ) {
      return;
    }

    submissionInProgress.current = true;

    try {
      setSubmitting(true);
      if (await isPhoneBlocked(db, normalizedPhone)) {
        setPhoneFieldError(BLOCKED_PHONE_MESSAGE);
        setErrorMessage(BLOCKED_PHONE_MESSAGE);
        setPhoneCheck({
          phone: normalizedPhone,
          loading: false,
          blocked: true,
          error: "",
        });
        phoneInputRef.current?.focus();
        return;
      }

      try {
        await saveCustomerProfileWithPhone(
          db,
          currentUser.uid,
          normalizedPhone,
          {},
        );
        setCustomerProfile((currentProfile) => (
          currentProfile
            ? {
              ...currentProfile,
              data: {
                ...currentProfile.data,
                phone: normalizedPhone,
                phoneNumber: normalizedPhone,
              },
            }
            : currentProfile
        ));
        setDetails((currentDetails) => ({
          ...currentDetails,
          phone: normalizedPhone,
        }));
      } catch (phoneVerificationError) {
        console.error(
          "Unable to verify checkout phone ownership:",
          phoneVerificationError,
        );
        setPhoneConfirmationError(false);
        phoneInputRef.current?.focus();
        const verificationErrorMessage =
          phoneVerificationError?.code === "phone/already-registered"
            ? "This phone number is already registered to another account. Please use another phone number."
            : phoneVerificationError?.code === "phone/blocked"
              ? BLOCKED_PHONE_MESSAGE
              : "Unable to verify this phone number. Please try again.";
        setPhoneFieldError(verificationErrorMessage);
        setErrorMessage(verificationErrorMessage);
        if (phoneVerificationError?.code === "phone/blocked") {
          setPhoneCheck({
            phone: normalizedPhone,
            loading: false,
            blocked: true,
            error: "",
          });
        }
        return;
      }

      const requestRef = doc(collection(db, "orderRequests"));
      const selectionRef = doc(db, "paymentSelections", requestRef.id);
      const batch = writeBatch(db);

      batch.set(requestRef, {
        customerId: currentUser.uid,
        customerEmail: currentUser.email || "",
        customerName: details.customerName.trim(),
        phone: normalizedPhone,
        items: cart.map((item) => ({
          id: item.id,
          quantity: Number(item.quantity),
          ...(item.selectedSize ? { size: item.selectedSize } : {}),
        })),
        orderType,
        address: customerAddress,
        ...(orderType === "delivery"
          ? { deliveryLocation: details.deliveryLocation }
          : {}),
        notes: details.notes.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
      });
      batch.set(selectionRef, {
        requestId: requestRef.id,
        customerId: currentUser.uid,
        method: paymentMethod,
        timing: paymentTiming,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      clearCart();
      setSubmittedCustomerName(details.customerName.trim());
      setSubmittedCustomerPhotoURL(
        typeof currentUser.photoURL === "string" ? currentUser.photoURL : ""
      );
      setSubmittedAt(new Date());
      setSubmittedOrderId(requestRef.id);
    } catch (error) {
      console.error("Error placing order:", error);
      if (error?.code === "phone/blocked") {
        setPhoneFieldError(BLOCKED_PHONE_MESSAGE);
        setErrorMessage(BLOCKED_PHONE_MESSAGE);
        setPhoneCheck({
          phone: normalizedPhone,
          loading: false,
          blocked: true,
          error: "",
        });
      } else {
        setErrorMessage(
          error?.code === "phone/already-registered"
            ? "This phone number is already registered to another account. Please use another phone number."
            : error?.message || "Unable to place your order. Please try again."
        );
      }
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  };

  if (submittedOrderId) {
    return (
      <main className="checkout-page">
        <div className="checkout-shell">
          <section
            className="checkout-success-card"
            aria-labelledby="checkout-success-title"
          >
            <div className="checkout-success-icon" aria-hidden="true">
              ✓
            </div>
            <p className="checkout-eyebrow">ORDER REQUEST RECEIVED</p>
            <h1 id="checkout-success-title">Thank you for your order!</h1>
            <p>
              Your request is with the Cactus Café team for review. Please take
              a screenshot of your Order ID as proof of your order. Our staff
              will use this to verify your order at the counter.
            </p>
            <div className="checkout-success-order-id">
              <div className="checkout-success-detail">
                <span>Order ID</span>
                <div className="checkout-success-id-row">
                  <code>{submittedOrderId}</code>
                  <button
                    type="button"
                    className="checkout-copy-id-button"
                    onClick={handleCopyOrderId}
                    aria-label={
                      copyFeedback === "Copied!"
                        ? "Order ID copied"
                        : "Copy order ID"
                    }
                  >
                    {copyFeedback === "Copied!" ? "Copied!" : "Copy ID"}
                  </button>
                </div>
                {copyFeedback && copyFeedback !== "Copied!" && (
                  <span
                    className="checkout-copy-feedback"
                    role="status"
                  >
                    {copyFeedback}
                  </span>
                )}
              </div>
              <div className="checkout-success-detail">
                <span>Customer Name</span>
                <div className="checkout-success-customer">
                  <ConfirmationCustomerAvatar
                    photoURL={submittedCustomerPhotoURL}
                  />
                  <strong>{submittedCustomerName}</strong>
                </div>
              </div>
              <div className="checkout-success-detail">
                <span>Order Date &amp; Time</span>
                <strong>
                  {submittedAt?.toLocaleString("en-PH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </strong>
              </div>
            </div>
            <div className="checkout-success-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate("/my-orders")}
              >
                View My Orders
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate("/menu")}
              >
                Back to Menu
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

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

  const streetOptions = ISABELA_STREETS_BY_BARANGAY[details.barangay] || [];
  const deliveryBarangayOptions = DELIVERY_SCOPE_BARANGAYS.map(
    (canonicalBarangay) => ISABELA_BARANGAYS.find(
      (barangay) => (
        getCanonicalDeliveryBarangay(barangay) === canonicalBarangay
      ),
    ),
  ).filter(Boolean);
  const outOfScopeBarangays = ISABELA_BARANGAYS.filter(
    (barangay) => !isBarangayInDeliveryScope(barangay),
  );
  const customBarangay = details.barangay
    && !ISABELA_BARANGAYS.includes(details.barangay)
    ? details.barangay
    : "";
  const customBarangayInScope = customBarangay
    ? isBarangayInDeliveryScope(customBarangay)
    : false;

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
                  name="customerName"
                  type="text"
                  value={details.customerName}
                  onChange={handleDetailChange}
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
                  name="phone"
                  type="tel"
                  ref={phoneInputRef}
                  value={details.phone}
                  onChange={handleDetailChange}
                  placeholder="09XX XXX XXXX"
                  autoComplete="tel"
                  aria-required="true"
                  aria-invalid={Boolean(phoneFieldError)}
                  aria-describedby={[
                    phoneFieldError ? "phone-error" : "",
                    hasRegisteredPhone ? "phone-profile-notice" : "phone-setup-notice",
                  ].filter(Boolean).join(" ") || undefined}
                  readOnly={hasRegisteredPhone || !customerProfile || Boolean(profileLoadError)}
                />
                {phoneFieldError && (
                  <span className="phone-field-error" id="phone-error">
                    {phoneFieldError}
                  </span>
                )}
                {invalidRegisteredPhone && !phoneFieldError && (
                  <span className="phone-field-error" role="alert">
                    Your saved mobile number is invalid. Please manage it in My Account.
                  </span>
                )}
                {hasRegisteredPhone ? (
                  <>
                    <span className="phone-profile-notice" id="phone-profile-notice">
                      This number is saved to your profile and cannot be changed here.
                    </span>
                    <Link className="phone-manage-link" to="/my-account">
                      Manage in My Account
                    </Link>
                  </>
                ) : (
                  <span className="phone-profile-notice" id="phone-setup-notice">
                    Saving your first number will lock it for 30 days. Double-check it before continuing.
                  </span>
                )}
                {phoneCheckPending && (
                  <span className="phone-profile-notice" role="status">
                    Checking this mobile number...
                  </span>
                )}
                {phoneBlocked && (
                  <span className="phone-field-error" role="alert">
                    {BLOCKED_PHONE_MESSAGE}
                  </span>
                )}
                {phoneCheckError && (
                  <span className="phone-field-error" role="alert">
                    {phoneCheckError}
                  </span>
                )}
                <label
                  className={`phone-confirmation${phoneConfirmationError ? " has-error" : ""}`}
                >
                  <input
                    ref={phoneConfirmationRef}
                    type="checkbox"
                    checked={phoneConfirmed}
                    aria-invalid={phoneConfirmationError}
                    aria-describedby={
                      phoneConfirmationError
                        ? "phone-confirmation-error"
                        : undefined
                    }
                    onChange={(event) => {
                      setPhoneConfirmed(event.target.checked);
                      setPhoneConfirmationError(false);
                      setErrorMessage("");
                    }}
                  />
                  <span>
                    I confirm this mobile number is valid and reachable for
                    order updates.
                  </span>
                </label>
                {phoneConfirmationError && (
                  <span
                    className="phone-field-error"
                    id="phone-confirmation-error"
                  >
                    Confirm your phone number before placing the order.
                  </span>
                )}
              </div>
            </div>

            {profileLoadError && (
              <div className="checkout-error" role="status">
                <span>!</span>
                {profileLoadError}
              </div>
            )}

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
                  onChange={(event) => {
                    setOrderType(event.target.value);
                    setErrorMessage("");
                  }}
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
                  onChange={(event) => {
                    setOrderType(event.target.value);
                    setErrorMessage("");
                  }}
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
                  onChange={(event) => {
                    setOrderType(event.target.value);
                    setErrorMessage("");
                  }}
                />

                <span className="order-type-icon">🍽️</span>

                <span className="order-type-content">
                  <strong>Dine-in</strong>
                  <small>Enjoy it at the cafe</small>
                </span>

                <span className="radio-mark" />
              </label>
            </div>

            <div className="form-grid delivery-address-grid">
              <div className="form-group form-group-full">
                <h3>Customer address</h3>
                <p>Required for dine-in, takeout, and delivery.</p>
              </div>
              <div className="form-group">
                <label htmlFor="barangay">Barangay</label>
                <select
                  id="barangay"
                  name="barangay"
                  value={details.barangay}
                  onChange={handleDetailChange}
                  autoComplete="address-level3"
                  aria-describedby={
                    orderType === "delivery"
                    && details.barangay
                    && !isBarangayInDeliveryScope(details.barangay)
                      ? "delivery-scope-warning"
                      : undefined
                  }
                  aria-invalid={
                    orderType === "delivery"
                    && Boolean(details.barangay)
                    && !isBarangayInDeliveryScope(details.barangay)
                  }
                >
                  <option value="">Select barangay</option>
                  {orderType === "delivery" ? (
                    <>
                      {deliveryBarangayOptions.map((barangay) => (
                        <option key={barangay} value={barangay}>
                          {barangay}
                        </option>
                      ))}
                      {customBarangay && customBarangayInScope && (
                        <option value={customBarangay} disabled>
                          {customBarangay} (saved value; choose an official barangay)
                        </option>
                      )}
                      {outOfScopeBarangays.map((barangay) => (
                        <option key={barangay} value={barangay} disabled>
                          {barangay} (Out of delivery scope)
                        </option>
                      ))}
                      {customBarangay && !customBarangayInScope && (
                        <option value={customBarangay} disabled>
                          {customBarangay} (Out of delivery scope)
                        </option>
                      )}
                    </>
                  ) : (
                    <>
                      {customBarangay && (
                        <option value={customBarangay}>
                          {customBarangay} (saved value; choose an official barangay)
                        </option>
                      )}
                      {ISABELA_BARANGAYS.map((barangay) => (
                        <option key={barangay} value={barangay}>
                          {barangay}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>

              {orderType === "delivery"
                && details.barangay
                && !isBarangayInDeliveryScope(details.barangay) && (
                <div
                  className="delivery-scope-notice"
                  id="delivery-scope-warning"
                  role="alert"
                >
                  <p>
                    Delivery is currently available only in these 14 covered
                    barangays: {DELIVERY_SCOPE_BARANGAYS.join(", ")}. Choose
                    one of them to continue, or switch to Store Pickup.
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      setOrderType("takeout");
                      setErrorMessage("");
                    }}
                  >
                    Switch to Store Pickup
                  </button>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="streetPurok">Street / Purok</label>
                <select
                  disabled={!streetOptions.length}
                  id="streetPurok"
                  name="streetPurok"
                  value={details.streetPurok}
                  onChange={handleDetailChange}
                >
                  <option value="">
                    {streetOptions.length
                      ? "Select street / purok"
                      : "Select a barangay first"}
                  </option>
                  {details.streetPurok
                    && !streetOptions.includes(details.streetPurok) && (
                    <option value={details.streetPurok}>
                      {details.streetPurok} (saved value; choose a listed option)
                    </option>
                  )}
                  {streetOptions.map((streetPurok) => (
                    <option key={streetPurok} value={streetPurok}>
                      {streetPurok}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group form-group-full">
                <label htmlFor="houseNumberStreet">
                  House number / Purok details
                </label>
                <input
                  id="houseNumberStreet"
                  name="houseNumberStreet"
                  type="text"
                  value={details.houseNumberStreet}
                  onChange={handleDetailChange}
                  autoComplete="address-line1"
                  placeholder="House number, block / lot, or custom Purok"
                />
              </div>

              <div className="form-group">
                <label htmlFor="municipalityCity">
                  Municipality / city
                </label>
                <input
                  id="municipalityCity"
                  name="municipalityCity"
                  type="text"
                  value={details.municipalityCity}
                  readOnly
                  autoComplete="address-level2"
                />
              </div>

              <div className="form-group form-group-full">
                <label htmlFor="province">Province</label>
                <input
                  id="province"
                  name="province"
                  type="text"
                  value={details.province}
                  readOnly
                  autoComplete="address-level1"
                />
              </div>

              {orderType === "delivery" && (
                <>
                  <div className="form-group form-group-full">
                    <label htmlFor="deliveryInstructions">
                      Delivery instructions <span>Optional</span>
                    </label>
                    <textarea
                      id="deliveryInstructions"
                      name="deliveryInstructions"
                      value={details.deliveryInstructions}
                      onChange={handleDetailChange}
                      placeholder="Landmarks, gate details, or other helpful notes"
                      rows="3"
                    />
                  </div>
                  <div className="form-group form-group-full">
                    <label>Delivery pin <span>Optional</span></label>
                    <IsabelaDeliveryMap
                      location={details.deliveryLocation}
                      onChange={handleDeliveryLocationChange}
                      selectedBarangay={details.barangay}
                      barangays={DELIVERY_SCOPE_BARANGAYS}
                    />
                  </div>
                </>
              )}
            </div>

            <fieldset
              className="payment-selection-fieldset"
              aria-describedby="payment-instruction"
            >
              <legend>Payment</legend>
              <div className="payment-selection-options">
                <label
                  className={`order-type-card ${
                    paymentMethod === "qr" && paymentTiming === "advance"
                      ? "selected"
                      : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentChoice"
                    value="qr-advance"
                    checked={
                      paymentMethod === "qr" && paymentTiming === "advance"
                    }
                    onChange={() => {
                      setPaymentMethod("qr");
                      setPaymentTiming("advance");
                    }}
                  />
                  <span className="payment-card-heading">
                    <span className="payment-card-icon qr-payment-icon">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 3 19 6v5c0 4.5-2.8 7.7-7 10-4.2-2.3-7-5.5-7-10V6l7-3Z" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    </span>
                    <span className="payment-card-heading-copy">
                      <strong>QR Payment (Pay Now)</strong>
                      <span className="payment-method-badges">
                        <span className="payment-method-badge gcash-badge">
                          GCash
                        </span>
                        <span className="payment-method-badge maya-badge">
                          Maya
                        </span>
                        <span className="payment-method-badge secure-badge">
                          Secure
                        </span>
                      </span>
                    </span>
                  </span>
                  <small className="payment-card-subtitle">
                    Pay via GCash / Maya QR before we prepare your order
                  </small>
                  <span className="radio-mark" />
                </label>

                <label
                  className={`order-type-card ${
                    paymentMethod === "cash" && paymentTiming === "pay_later"
                      ? "selected"
                      : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentChoice"
                    value="cash-later"
                    checked={
                      paymentMethod === "cash" && paymentTiming === "pay_later"
                    }
                    onChange={() => {
                      setPaymentMethod("cash");
                      setPaymentTiming("pay_later");
                    }}
                  />
                  <span className="payment-card-heading">
                    <span className="payment-card-icon cash-payment-icon">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="6" width="18" height="13" rx="2" />
                        <path d="M7 6V4h12v2M3 10h18" />
                        <circle cx="12" cy="14" r="2" />
                      </svg>
                    </span>
                    <span className="payment-card-heading-copy">
                      <strong>{cashPaymentOption.title}</strong>
                      <span className="payment-method-badges">
                        <span className="payment-method-badge cash-badge">
                          Cash
                        </span>
                      </span>
                    </span>
                  </span>
                  <small className="payment-card-subtitle">
                    {cashPaymentOption.subtitle}
                  </small>
                  <span className="radio-mark" />
                </label>
              </div>
            </fieldset>
            <div
              className="payment-instruction"
              id="payment-instruction"
              role="status"
              aria-live="polite"
            >
              <span className="payment-instruction-icon" aria-hidden="true">
                ✦
              </span>
              <p>
                {paymentMethod === "qr" && paymentTiming === "advance" ? (
                  <>
                    Once your request is approved, follow the café&apos;s QR
                    payment instructions and submit your transaction reference
                    in My Orders. Preparation starts after payment is verified.
                  </>
                ) : (
                  <>
                    Please prepare the exact amount ({formatPrice(totalPrice)})
                    if possible for a smoother handover.
                  </>
                )}
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="notes">
                Order notes <span>Optional</span>
              </label>

              <textarea
                id="notes"
                name="notes"
                value={details.notes}
                onChange={handleDetailChange}
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
                disabled={
                  submitting
                  || !profileLoadDone
                  || (Boolean(auth.currentUser) && !customerProfile)
                  || Boolean(profileLoadError)
                  || invalidRegisteredPhone
                  || phoneBlocked
                  || phoneCheckPending
                  || Boolean(phoneCheckError)
                }
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
                <div className="summary-item" key={getCartItemKey(item)}>
                  <SummaryItemImage item={item} />

                  <div className="summary-item-info">
                    <h3>{item.name}</h3>
                    {item.selectedSize && (
                      <span className="summary-item-size">{item.selectedSize}</span>
                    )}

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