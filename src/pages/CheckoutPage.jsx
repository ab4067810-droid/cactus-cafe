import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
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
import {
  GCASH_ACCOUNT_NAME,
  GCASH_MOBILE_NUMBER,
} from "../constants/gcashPayment.js";
import IsabelaDeliveryMap from "../components/IsabelaDeliveryMap";
import { getCartItemKey, useCart } from "../context/CartContext";
import { isPhoneBlocked } from "../services/blockedPhoneService.js";
import { saveCustomerProfileWithPhone } from "../services/phoneRegistryService.js";
import { compressReceiptImage } from "../utils/compressReceiptImage.js";
import { extractGcashReference } from "../utils/gcashReferenceOcr.js";
import {
  checkPaymentReference,
  claimPaymentReference,
  DUPLICATE_PAYMENT_REFERENCE_MESSAGE,
  isValidNormalizedPaymentReference,
  normalizePaymentReference,
  PAYMENT_REFERENCE_CHECK_ERROR,
} from "../utils/paymentReferenceRegistry.js";
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
import { getDeliveryFeeForBarangay } from "../utils/deliveryFees.js";
import { getManilaDayState } from "../utils/manilaDay.js";
import { useAuth } from "../context/Authcontext";
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
const QR_REQUIRED_ORDER_TOTAL = 500;
const CHECKOUT_FULFILLMENT_DRAFT_KEY = "cactus-cafe:checkout-fulfillment";
const CHECKOUT_FULFILLMENT_MODES = new Set([
  "delivery",
  "takeout",
  "dine-in",
]);
const NETWORK_ERROR_CODES = new Set([
  "unavailable",
  "deadline-exceeded",
  "network-request-failed",
]);
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

const terminateReceiptOcrWorker = async (worker) => {
  try {
    await worker.terminate();
  } catch (error) {
    console.error("Unable to stop the receipt OCR worker:", error);
  }
};

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
  const { user } = useAuth();
  const { clearCart } = useCart();

  const cart = location.state?.cart ?? emptyCart;

  const [orderTypeSelection, setOrderTypeSelection] = useState({
    userId: null,
    mode: "takeout",
  });
  const savedOrderType = useMemo(() => {
    if (!user?.uid) return "takeout";

    try {
      const savedMode = window.sessionStorage.getItem(
        `${CHECKOUT_FULFILLMENT_DRAFT_KEY}:${user.uid}`
      );
      return CHECKOUT_FULFILLMENT_MODES.has(savedMode)
        ? savedMode
        : "takeout";
    } catch (storageError) {
      console.error("Unable to load the saved fulfillment mode:", storageError);
      return "takeout";
    }
  }, [user]);
  const orderType = orderTypeSelection.userId === (user?.uid ?? null)
    ? orderTypeSelection.mode
    : savedOrderType;
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentTiming, setPaymentTiming] = useState("pay_later");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReferenceCheck, setPaymentReferenceCheck] = useState({
    userId: "",
    reference: "",
    loading: false,
    duplicate: false,
    error: "",
  });
  const [receiptOcrStatus, setReceiptOcrStatus] = useState("idle");
  const [paymentProofUrl, setPaymentProofUrl] = useState("");
  const [paymentProofBusy, setPaymentProofBusy] = useState(false);
  const [paymentProofError, setPaymentProofError] = useState("");
  const [qrValidationAttempted, setQrValidationAttempted] = useState(false);
  const [recipientCopyFeedback, setRecipientCopyFeedback] = useState("");
  const [isGcashQrExpanded, setIsGcashQrExpanded] = useState(false);
  const [deliverySettings, setDeliverySettings] = useState({
    loaded: false,
    disableSundayDelivery: false,
    error: "",
  });
  const [currentTime, setCurrentTime] = useState(() => new Date());
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
  const submissionAttemptRef = useRef({ fingerprint: "", token: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submissionAttemptToken, setSubmissionAttemptToken] = useState("");
  const [submissionIssue, setSubmissionIssue] = useState("");
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
  const submissionWriteStartedRef = useRef(false);
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
  const recipientCopyFeedbackTimer = useRef(null);
  const receiptFileSelectionRef = useRef(0);
  const receiptOcrGenerationRef = useRef(0);
  const receiptOcrWorkerRef = useRef(null);
  const paymentReferenceValueRef = useRef("");
  const paymentReferenceSourceRef = useRef("");
  const manualPaymentReferenceOverrideRef = useRef(false);
  const gcashQrTriggerRef = useRef(null);
  const gcashQrModalRef = useRef(null);
  const gcashQrCloseRef = useRef(null);
  const phoneInputRef = useRef(null);
  const phoneConfirmationRef = useRef(null);

  useEffect(() => {
    const handleOffline = () => setIsOnline(false);
    const handleOnline = () => setIsOnline(true);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const handleOrderTypeChange = (nextMode) => {
    if (!CHECKOUT_FULFILLMENT_MODES.has(nextMode)) return;

    const userId = user?.uid;
    setOrderTypeSelection({ userId: userId ?? null, mode: nextMode });
    if (userId) {
      try {
        window.sessionStorage.setItem(
          `${CHECKOUT_FULFILLMENT_DRAFT_KEY}:${userId}`,
          nextMode
        );
      } catch (storageError) {
        console.error(
          "Unable to save the selected fulfillment mode:",
          storageError
        );
      }
    }
  };

  useEffect(() => () => {
    if (copyFeedbackTimer.current) {
      clearTimeout(copyFeedbackTimer.current);
    }
    if (recipientCopyFeedbackTimer.current) {
      clearTimeout(recipientCopyFeedbackTimer.current);
    }
  }, []);

  useEffect(() => () => {
    receiptFileSelectionRef.current += 1;
    receiptOcrGenerationRef.current += 1;
    const worker = receiptOcrWorkerRef.current;
    receiptOcrWorkerRef.current = null;
    if (worker) void terminateReceiptOcrWorker(worker);
  }, []);

  useEffect(() => {
    if (!isGcashQrExpanded) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const qrTrigger = gcashQrTriggerRef.current;
    document.body.style.overflow = "hidden";
    const handleModalKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsGcashQrExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = gcashQrModalRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (
        !event.shiftKey
        && document.activeElement === lastElement
      ) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener("keydown", handleModalKeyDown);
    gcashQrCloseRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", handleModalKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      qrTrigger?.focus();
    };
  }, [isGcashQrExpanded]);

  const cancelReceiptOcr = async () => {
    receiptOcrGenerationRef.current += 1;
    setReceiptOcrStatus("idle");
    const worker = receiptOcrWorkerRef.current;
    receiptOcrWorkerRef.current = null;
    if (worker) await terminateReceiptOcrWorker(worker);
  };

  const scanReceiptForReference = async (receiptDataUrl, generation) => {
    setReceiptOcrStatus("scanning");
    let worker;
    try {
      const { createWorker } = await import("tesseract.js");
      if (generation !== receiptOcrGenerationRef.current) return;

      worker = await createWorker("eng");
      if (generation !== receiptOcrGenerationRef.current) {
        await terminateReceiptOcrWorker(worker);
        worker = null;
        return;
      }

      receiptOcrWorkerRef.current = worker;
      const result = await worker.recognize(receiptDataUrl);
      if (generation !== receiptOcrGenerationRef.current) return;

      const detectedReference = extractGcashReference(result.data.text);
      if (!detectedReference) {
        setReceiptOcrStatus("not_found");
      } else if (
        !manualPaymentReferenceOverrideRef.current
        && !paymentReferenceValueRef.current.trim()
      ) {
        paymentReferenceValueRef.current = detectedReference;
        paymentReferenceSourceRef.current = "auto";
        setPaymentReference(detectedReference);
        setReceiptOcrStatus("auto_filled");
      } else {
        setReceiptOcrStatus("manual_kept");
      }
    } catch (error) {
      if (generation === receiptOcrGenerationRef.current) {
        console.error("Unable to scan GCash receipt for a reference:", error);
        setReceiptOcrStatus("error");
      }
    } finally {
      if (worker && receiptOcrWorkerRef.current === worker) {
        receiptOcrWorkerRef.current = null;
        await terminateReceiptOcrWorker(worker);
      }
    }
  };

  const handleReceiptChange = async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const fileInput = event.currentTarget;
    const fileSelectionId = ++receiptFileSelectionRef.current;
    setPaymentProofError("");
    setPaymentProofBusy(true);
    try {
      await cancelReceiptOcr();
      if (fileSelectionId !== receiptFileSelectionRef.current) return;
      if (paymentReferenceSourceRef.current === "auto") {
        paymentReferenceValueRef.current = "";
        paymentReferenceSourceRef.current = "";
        setPaymentReference("");
      }

      const compressedReceipt = await compressReceiptImage(file);
      if (fileSelectionId !== receiptFileSelectionRef.current) return;
      setPaymentProofUrl(compressedReceipt);
      void scanReceiptForReference(
        compressedReceipt,
        receiptOcrGenerationRef.current,
      );
    } catch (error) {
      if (fileSelectionId !== receiptFileSelectionRef.current) return;
      console.error("Unable to process GCash receipt:", error);
      setPaymentProofUrl("");
      setPaymentProofError(error.message);
    } finally {
      if (fileSelectionId === receiptFileSelectionRef.current) {
        setPaymentProofBusy(false);
        fileInput.value = "";
      }
    }
  };

  const handleCopyGCashNumber = async () => {
    try {
      await navigator.clipboard.writeText(GCASH_MOBILE_NUMBER);
      setRecipientCopyFeedback("Copied!");
    } catch (error) {
      console.error("Unable to copy GCash mobile number:", error);
      setRecipientCopyFeedback("Unable to copy. Please select the number.");
    }
    if (recipientCopyFeedbackTimer.current) {
      clearTimeout(recipientCopyFeedbackTimer.current);
    }
    recipientCopyFeedbackTimer.current = setTimeout(() => {
      setRecipientCopyFeedback("");
      recipientCopyFeedbackTimer.current = null;
    }, 2500);
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "cafeSettings", "delivery"),
      (settingsSnapshot) => {
        if (!settingsSnapshot.exists()) {
          setDeliverySettings({
            loaded: true,
            disableSundayDelivery: false,
            error: "",
          });
          return;
        }

        const disableSundayDelivery =
          settingsSnapshot.data().disableSundayDelivery;
        if (typeof disableSundayDelivery !== "boolean") {
          const error = new Error("Sunday delivery setting has an invalid value.");
          console.error("Unable to load Sunday delivery setting:", error);
          setDeliverySettings({
            loaded: true,
            disableSundayDelivery: false,
            error: "We could not verify Sunday delivery availability.",
          });
          return;
        }

        setDeliverySettings({
          loaded: true,
          disableSundayDelivery,
          error: "",
        });
      },
      (error) => {
        console.error("Unable to load Sunday delivery setting:", error);
        setDeliverySettings({
          loaded: true,
          disableSundayDelivery: false,
          error: "We could not verify Sunday delivery availability.",
        });
      },
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
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

  const requiresUpfrontQr =
    orderType !== "dine-in" && totalPrice >= QR_REQUIRED_ORDER_TOTAL;
  const selectedPaymentMethod = requiresUpfrontQr ? "qr" : paymentMethod;
  const selectedPaymentTiming = requiresUpfrontQr ? "advance" : paymentTiming;
  const isQrAdvancePayment =
    selectedPaymentMethod === "qr" && selectedPaymentTiming === "advance";
  const normalizedPaymentReference =
    normalizePaymentReference(paymentReference);
  const paymentReferenceCheckIsCurrent =
    Boolean(user?.uid && normalizedPaymentReference)
    && paymentReferenceCheck.userId === user.uid
    && paymentReferenceCheck.reference === normalizedPaymentReference;
  const deliveryBarangay = orderType === "delivery"
    ? getCanonicalDeliveryBarangay(details.barangay)
    : null;
  const deliveryFee = orderType === "delivery"
    ? getDeliveryFeeForBarangay(deliveryBarangay)
    : 0;
  const checkoutTotal = totalPrice + (deliveryFee || 0);
  const manilaDayState = getManilaDayState(currentTime);
  const sundayDeliveryBlocked =
    deliverySettings.disableSundayDelivery && manilaDayState.isSunday;

  useEffect(() => {
    const userId = user?.uid;
    const reference = normalizePaymentReference(paymentReference);
    if (
      !userId
      || !isQrAdvancePayment
      || !isValidNormalizedPaymentReference(reference)
      || !/^\d{13}$/.test(reference)
    ) {
      return undefined;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setPaymentReferenceCheck({
        userId,
        reference,
        loading: true,
        duplicate: false,
        error: "",
      });

      checkPaymentReference(db, userId, paymentReference)
        .then((duplicate) => {
          if (!active) return;
          setPaymentReferenceCheck({
            userId,
            reference,
            loading: false,
            duplicate,
            error: "",
          });
        })
        .catch((error) => {
          if (!active) return;
          console.error("Unable to check checkout payment reference:", error);
          setPaymentReferenceCheck({
            userId,
            reference,
            loading: false,
            duplicate: false,
            error: PAYMENT_REFERENCE_CHECK_ERROR,
          });
        });
    }, 500);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [isQrAdvancePayment, paymentReference, user?.uid]);

  const cashPaymentOption =
    orderType === "delivery"
      ? {
          title: "Cash on Delivery (COD)",
          subtitle: "Pay cash to the rider when your order arrives",
        }
      : orderType === "dine-in"
        ? {
            title: "Cash at Counter",
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

    if (!isOnline || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setSubmissionIssue("offline");
      return;
    }

    setSubmissionIssue("");

    const cleanPaymentReference = normalizePaymentReference(paymentReference);

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

    if (selectedPaymentMethod === "qr" && selectedPaymentTiming === "advance") {
      setQrValidationAttempted(true);
      if (!/^\d{13}$/.test(cleanPaymentReference)) {
        setErrorMessage("Enter the 13-digit GCash reference number.");
        document.getElementById("paymentReference")?.focus();
        return;
      }
      if (paymentProofBusy) {
        setErrorMessage("Please wait while we prepare your GCash receipt image.");
        return;
      }
      if (!paymentProofUrl) {
        setErrorMessage("Upload your GCash receipt screenshot to continue.");
        document.getElementById("paymentProof")?.focus();
        return;
      }
    }

    if (orderType === "delivery") {
      if (!deliverySettings.loaded) {
        setErrorMessage("Please wait while we check Sunday delivery availability.");
        return;
      }
      if (deliverySettings.error) {
        setErrorMessage(
          "Delivery is temporarily unavailable because Sunday availability could not be verified. Takeout and Dine-in are still available.",
        );
        return;
      }
      if (
        deliverySettings.disableSundayDelivery
        && getManilaDayState(new Date()).isSunday
      ) {
        setErrorMessage(
          "Delivery is unavailable on Sundays (Asia/Manila time). Please choose Takeout or Dine-in.",
        );
        return;
      }
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

    if (orderType === "delivery" && deliveryFee === null) {
      setErrorMessage(
        "We could not verify the delivery fee for this barangay. Please choose another covered barangay or contact the café.",
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

    if (isQrAdvancePayment) {
      submissionInProgress.current = true;
      setSubmitting(true);
      setPaymentReferenceCheck({
        userId: currentUser.uid,
        reference: cleanPaymentReference,
        loading: true,
        duplicate: false,
        error: "",
      });

      let duplicateReference;
      try {
        duplicateReference = await checkPaymentReference(
          db,
          currentUser.uid,
          paymentReference,
        );
      } catch (referenceCheckError) {
        console.error(
          "Unable to verify checkout payment reference:",
          referenceCheckError,
        );
        setPaymentReferenceCheck({
          userId: currentUser.uid,
          reference: cleanPaymentReference,
          loading: false,
          duplicate: false,
          error: PAYMENT_REFERENCE_CHECK_ERROR,
        });
        setErrorMessage(PAYMENT_REFERENCE_CHECK_ERROR);
        submissionInProgress.current = false;
        setSubmitting(false);
        return;
      }

      setPaymentReferenceCheck({
        userId: currentUser.uid,
        reference: cleanPaymentReference,
        loading: false,
        duplicate: duplicateReference,
        error: "",
      });
      if (duplicateReference) {
        setErrorMessage(DUPLICATE_PAYMENT_REFERENCE_MESSAGE);
        submissionInProgress.current = false;
        setSubmitting(false);
        document.getElementById("paymentReference")?.focus();
        return;
      }
    }

    const attemptFingerprint = JSON.stringify({
      customerName: details.customerName.trim(),
      phone: normalizedPhone,
      address: customerAddress,
      notes: details.notes.trim(),
      orderType,
      paymentMethod: selectedPaymentMethod,
      paymentTiming: selectedPaymentTiming,
      ...(isQrAdvancePayment
        ? { paymentReference: cleanPaymentReference, paymentProofUrl }
        : {}),
      cart: cart.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        selectedSize: item.selectedSize || "",
      })),
    });
    if (submissionAttemptRef.current.fingerprint !== attemptFingerprint) {
      submissionAttemptRef.current = {
        fingerprint: attemptFingerprint,
        token: doc(collection(db, "orderRequests")).id,
      };
    }
    const submissionToken = submissionAttemptRef.current.token;
    setSubmissionAttemptToken(submissionToken);

    submissionInProgress.current = true;
    submissionWriteStartedRef.current = false;
    let paymentReferenceClaimAttempted = false;

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
        submissionWriteStartedRef.current = true;
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

      const requestRef = doc(db, "orderRequests", submissionToken);
      const selectionRef = doc(db, "paymentSelections", requestRef.id);
      const batch = writeBatch(db);
      if (isQrAdvancePayment) {
        claimPaymentReference(
          batch,
          db,
          currentUser.uid,
          paymentReference,
          "checkout",
        );
        paymentReferenceClaimAttempted = true;
      }

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
          ? {
            deliveryBarangay,
            deliveryFee,
            deliveryLocation: details.deliveryLocation,
          }
          : {}),
        notes: details.notes.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
      });
      batch.set(selectionRef, {
        requestId: requestRef.id,
        customerId: currentUser.uid,
        method: selectedPaymentMethod,
        timing: selectedPaymentTiming,
        ...(isQrAdvancePayment
          ? {
            paymentReference: cleanPaymentReference,
            paymentProofUrl,
            paymentStatus: "pending_verification",
          }
          : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      clearCart();
      submissionAttemptRef.current = { fingerprint: "", token: "" };
      setSubmissionAttemptToken("");
      setSubmissionIssue("");
      setSubmittedCustomerName(details.customerName.trim());
      setSubmittedCustomerPhotoURL(
        typeof currentUser.photoURL === "string" ? currentUser.photoURL : ""
      );
      setSubmittedAt(new Date());
      setSubmittedOrderId(requestRef.id);
    } catch (error) {
      console.error("Error placing order:", error);
      if (
        paymentReferenceClaimAttempted
        && error?.code === "permission-denied"
      ) {
        try {
          if (await checkPaymentReference(
            db,
            currentUser.uid,
            cleanPaymentReference,
          )) {
            setPaymentReferenceCheck({
              userId: currentUser.uid,
              reference: cleanPaymentReference,
              loading: false,
              duplicate: true,
              error: "",
            });
            setErrorMessage(DUPLICATE_PAYMENT_REFERENCE_MESSAGE);
            setSubmissionIssue("");
            return;
          }
        } catch (referenceCheckError) {
          console.error(
            "Unable to identify a conflicting checkout reference:",
            referenceCheckError,
          );
        }
      }

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
        if (
          submissionWriteStartedRef.current
          || NETWORK_ERROR_CODES.has(error?.code)
          || (typeof navigator !== "undefined" && !navigator.onLine)
        ) {
          const networkInterrupted =
            NETWORK_ERROR_CODES.has(error?.code)
            || (typeof navigator !== "undefined" && !navigator.onLine);
          setSubmissionIssue(networkInterrupted ? "interrupted" : "uncertain");
        }
        setErrorMessage(
          error?.code === "phone/already-registered"
            ? "This phone number is already registered to another account. Please use another phone number."
            : error?.message || "Unable to place your order. Please try again."
        );
      }
    } finally {
      submissionInProgress.current = false;
      submissionWriteStartedRef.current = false;
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
  const showSundayDeliveryNotice = deliverySettings.disableSundayDelivery
    && (manilaDayState.isSunday || manilaDayState.isSaturdayEvening);

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
            noValidate
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
                    "phone-order-contact-note",
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
                <span className="phone-profile-notice" id="phone-order-contact-note">
                  Use a reachable number so we can confirm your order and coordinate pickup or delivery.
                </span>
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
                    handleOrderTypeChange(event.target.value);
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
                    handleOrderTypeChange(event.target.value);
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
                    handleOrderTypeChange(event.target.value);
                    setPaymentMethod("cash");
                    setPaymentTiming("pay_later");
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

            {orderType === "delivery" && !deliverySettings.loaded && (
              <div className="delivery-day-notice" role="status">
                Checking Sunday delivery availability...
              </div>
            )}
            {deliverySettings.error && (
              <div className="delivery-day-notice" role="alert">
                {deliverySettings.error} Delivery is unavailable until it can be checked; Takeout and Dine-in remain available.
              </div>
            )}
            {showSundayDeliveryNotice && (
              <div className="delivery-day-notice" role="status">
                Sunday delivery is disabled. Delivery orders cannot be submitted on Sundays in Asia/Manila time. This notice appears from Saturday at 6:00 PM; Takeout and Dine-in remain available.
              </div>
            )}

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
                      handleOrderTypeChange("takeout");
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
              {requiresUpfrontQr && (
                <div className="payment-requirement-notice" role="status">
                  Takeout and Delivery orders with an items subtotal of ₱500 or more require GCash / QR payment upfront. Cash is available below ₱500; delivery fees are shown separately.
                </div>
              )}
              {orderType === "delivery" && deliveryFee > 0 && (
                <div className="payment-requirement-notice" role="status">
                  Delivery to {deliveryBarangay} adds a {formatPrice(deliveryFee)} delivery fee.
                </div>
              )}
              {orderType === "dine-in" && (
                <div className="payment-requirement-notice" role="status">
                  Cash at Counter is the default for Dine-in; GCash / QR is optional.
                </div>
              )}
              <div className="payment-selection-options">
                <label
                  className={`order-type-card ${
                    selectedPaymentMethod === "qr" && selectedPaymentTiming === "advance"
                      ? "selected"
                      : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentChoice"
                    value="qr-advance"
                    checked={
                      selectedPaymentMethod === "qr" && selectedPaymentTiming === "advance"
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
                      </span>
                    </span>
                  </span>
                  <small className="payment-card-subtitle">
                    Pay via GCash QR before we prepare your order
                  </small>
                  <span className="radio-mark" />
                </label>

                <label
                  className={`order-type-card ${
                    selectedPaymentMethod === "cash" && selectedPaymentTiming === "pay_later"
                      ? "selected"
                      : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentChoice"
                    value="cash-later"
                    disabled={requiresUpfrontQr}
                    checked={
                      selectedPaymentMethod === "cash" && selectedPaymentTiming === "pay_later"
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
              {selectedPaymentMethod === "qr"
                && selectedPaymentTiming === "advance" && (
                  <section
                    className="gcash-payment-panel"
                    aria-labelledby="gcash-payment-title"
                  >
                    <div className="gcash-payment-heading">
                      <p className="section-eyebrow">GCASH QR PAYMENT</p>
                      <h3 id="gcash-payment-title">Scan &amp; Pay via GCash</h3>
                    </div>
                    <div className="gcash-payment-content">
                      <div className="gcash-payment-recipient">
                        <button
                          ref={gcashQrTriggerRef}
                          type="button"
                          className="gcash-qr-trigger"
                          onClick={() => setIsGcashQrExpanded(true)}
                          aria-label="Expand Cactus Café GCash QR code"
                          aria-haspopup="dialog"
                        >
                          <span className="gcash-qr-frame">
                            <img
                              src="/gcash.jpg"
                              alt="Cactus Café GCash QR code"
                            />
                          </span>
                          <span className="gcash-qr-expand-hint" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none">
                              <path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5" />
                              <path d="M9 9 3 3m12 6 6-6M9 15l-6 6m12-6 6 6" />
                            </svg>
                            Click or tap to enlarge
                          </span>
                        </button>
                        <div className="gcash-recipient-details">
                          <div>
                            <span>Account Name</span>
                            <strong>{GCASH_ACCOUNT_NAME}</strong>
                          </div>
                          <div>
                            <span>GCash Mobile No.</span>
                            <div className="gcash-mobile-row">
                              <strong>{GCASH_MOBILE_NUMBER}</strong>
                              <button
                                type="button"
                                className="gcash-copy-button"
                                onClick={handleCopyGCashNumber}
                              >
                                Copy
                              </button>
                            </div>
                            {recipientCopyFeedback && (
                              <small role="status">{recipientCopyFeedback}</small>
                            )}
                          </div>
                          <div className="gcash-order-total">
                            <span>Order Total</span>
                            <strong>{formatPrice(checkoutTotal)}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="gcash-payment-proof">
                        <div className="form-group form-group-full">
                          <label htmlFor="paymentReference">
                            GCash Reference Number <span>Required</span>
                          </label>
                          <input
                            id="paymentReference"
                            name="paymentReference"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={13}
                            disabled={submitting}
                            placeholder="13-digit GCash Ref No"
                            value={paymentReference}
                            onChange={(event) => {
                              const nextReference = event.target.value
                                .replace(/\D/g, "")
                                .slice(0, 13);
                              paymentReferenceValueRef.current = nextReference;
                              paymentReferenceSourceRef.current = "manual";
                              manualPaymentReferenceOverrideRef.current = true;
                              setPaymentReference(nextReference);
                              setReceiptOcrStatus((currentStatus) => (
                                currentStatus === "scanning" ? currentStatus : "idle"
                              ));
                              setErrorMessage("");
                            }}
                            aria-invalid={
                              (qrValidationAttempted
                                && !/^\d{13}$/.test(normalizedPaymentReference))
                              || (paymentReferenceCheckIsCurrent
                                && paymentReferenceCheck.duplicate)
                            }
                            aria-describedby="gcash-reference-check-status"
                            required
                          />
                          <small
                            id="gcash-reference-check-status"
                            className="gcash-reference-check-status"
                            role={
                              paymentReferenceCheckIsCurrent
                              && paymentReferenceCheck.error
                                ? "alert"
                                : "status"
                            }
                          >
                            {paymentReferenceCheckIsCurrent
                            && paymentReferenceCheck.error
                              ? paymentReferenceCheck.error
                              : paymentReferenceCheckIsCurrent
                                && paymentReferenceCheck.loading
                                ? "Checking this reference against existing payments…"
                                : ""}
                          </small>
                          {receiptOcrStatus !== "idle" && (
                            <small
                              className={`gcash-ocr-status gcash-ocr-status-${receiptOcrStatus}`}
                              role="status"
                              aria-live="polite"
                            >
                              {receiptOcrStatus === "scanning"
                                ? "Scanning receipt for GCash reference number..."
                                : receiptOcrStatus === "auto_filled"
                                  ? "Auto-filled from screenshot—please double-check before confirming."
                                  : receiptOcrStatus === "manual_kept"
                                    ? "A reference was detected, but your manually entered value was kept."
                                    : receiptOcrStatus === "not_found"
                                      ? "Couldn't detect a 13-digit reference. Type or paste it from your receipt."
                                      : "Automatic scan couldn't read the screenshot. Type or paste the 13-digit reference manually."}
                            </small>
                          )}
                          {qrValidationAttempted
                            && !/^\d{13}$/.test(paymentReference.trim()) && (
                              <small className="gcash-field-error" role="alert">
                                Enter all 13 digits from your GCash receipt.
                              </small>
                            )}
                        </div>
                        <div className="form-group form-group-full">
                          <label htmlFor="paymentProof">
                            Upload GCash Receipt Screenshot <span>Required</span>
                          </label>
                          <input
                            id="paymentProof"
                            name="paymentProof"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleReceiptChange}
                            aria-invalid={
                              qrValidationAttempted && !paymentProofUrl
                            }
                            required
                          />
                          <small className="gcash-upload-hint">
                            JPEG, PNG, or WebP. The image is compressed securely
                            in your browser before submission.
                          </small>
                          {paymentProofBusy && (
                            <small role="status">Preparing receipt image…</small>
                          )}
                          {paymentProofError && (
                            <small className="gcash-field-error" role="alert">
                              {paymentProofError}
                            </small>
                          )}
                          {qrValidationAttempted && !paymentProofUrl
                            && !paymentProofBusy && !paymentProofError && (
                              <small className="gcash-field-error" role="alert">
                                Upload your GCash receipt screenshot.
                              </small>
                            )}
                          {paymentProofUrl && (
                            <div className="gcash-receipt-preview">
                              <img
                                src={paymentProofUrl}
                                alt="Compressed GCash receipt preview"
                              />
                              <button
                                type="button"
                                className="gcash-remove-button"
                                onClick={async () => {
                                  await cancelReceiptOcr();
                                  if (paymentReferenceSourceRef.current === "auto") {
                                    paymentReferenceValueRef.current = "";
                                    paymentReferenceSourceRef.current = "";
                                    setPaymentReference("");
                                  }
                                  setPaymentProofUrl("");
                                  setPaymentProofError("");
                                  setQrValidationAttempted(false);
                                }}
                              >
                                Remove screenshot
                              </button>
                            </div>
                          )}
                        </div>
                        {paymentReferenceCheckIsCurrent
                          && paymentReferenceCheck.duplicate && (
                            <p
                              className="gcash-reference-warning"
                              role="alert"
                            >
                              {DUPLICATE_PAYMENT_REFERENCE_MESSAGE}
                            </p>
                        )}
                      </div>
                    </div>
                    <p className="gcash-payment-callout">
                      Scan the GCash QR code, pay the exact total, and upload your
                      receipt + reference number below. Preparation begins once
                      our staff verifies your payment.
                    </p>
                  </section>
                )}
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
                {selectedPaymentMethod === "qr" && selectedPaymentTiming === "advance" ? (
                  <>
                    Your GCash payment details and receipt will be sent with your
                    order request for staff verification.
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

            {(!isOnline || submissionIssue === "offline") && (
              <div className="checkout-connectivity-notice" role="status">
                <strong>
                  {isOnline
                    ? "You’re back online"
                    : "Internet connection unavailable"}
                </strong>
                <p>
                  {isOnline
                    ? "Your order has not been submitted. Continue when you’re ready."
                    : "Your selections are still here. Reconnect before placing your order; reconnecting will not submit it automatically."}
                </p>
              </div>
            )}

            {(submissionIssue === "interrupted"
              || submissionIssue === "uncertain") && (
              <div className="checkout-submission-notice" role="status">
                <strong>
                  {submissionIssue === "interrupted"
                    ? "Your connection was interrupted while placing the order."
                    : "We couldn’t confirm whether your order was received."}
                </strong>
                <p>
                  Check <Link to="/my-orders">My Orders</Link> before retrying.
                  If it is not listed, you can retry manually; this attempt keeps
                  the same request key.
                </p>
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
                  || !isOnline
                  || !profileLoadDone
                  || (Boolean(auth.currentUser) && !customerProfile)
                  || Boolean(profileLoadError)
                  || invalidRegisteredPhone
                  || phoneBlocked
                  || phoneCheckPending
                  || Boolean(phoneCheckError)
                  || (
                    orderType === "delivery"
                    && (
                      !deliverySettings.loaded
                      || Boolean(deliverySettings.error)
                      || sundayDeliveryBlocked
                    )
                  )
                }
              >
                {submitting
                  ? "Placing order..."
                  : (submissionIssue === "uncertain"
                    || submissionIssue === "interrupted")
                    && submissionAttemptToken
                    ? "Retry order manually"
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
              <span>Delivery fee</span>
              <strong>{formatPrice(deliveryFee || 0)}</strong>
            </div>

            <div className="summary-total">
              <span>Total</span>
              <strong>{formatPrice(checkoutTotal)}</strong>
            </div>

            <div className="summary-note">
              <span>✦</span>
              Your order will be reviewed by the cafe before
              preparation.
            </div>
          </aside>
        </div>
        {isGcashQrExpanded && (
          <div
            className="gcash-qr-modal-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setIsGcashQrExpanded(false);
              }
            }}
          >
            <section
              ref={gcashQrModalRef}
              className="gcash-qr-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gcash-qr-modal-title"
              aria-describedby="gcash-qr-modal-description"
            >
              <div className="gcash-qr-modal-header">
                <div>
                  <p className="section-eyebrow">GCASH QR PAYMENT</p>
                  <h2 id="gcash-qr-modal-title">Scan &amp; Pay via GCash</h2>
                </div>
                <button
                  ref={gcashQrCloseRef}
                  type="button"
                  className="gcash-qr-modal-close"
                  onClick={() => setIsGcashQrExpanded(false)}
                  aria-label="Close expanded GCash QR code"
                >
                  <span aria-hidden="true">×</span>
                  Close
                </button>
              </div>
              <div className="gcash-modal-qr-frame">
                <img
                  src="/gcash.jpg"
                  alt="Expanded Cactus Café GCash QR code"
                />
              </div>
              <p
                className="gcash-qr-modal-description"
                id="gcash-qr-modal-description"
              >
                Scan the QR code using GCash and pay the exact order total.
              </p>
              <div className="gcash-qr-modal-recipient">
                <div>
                  <span>Account Name</span>
                  <strong>{GCASH_ACCOUNT_NAME}</strong>
                </div>
                <div>
                  <span>GCash Mobile No.</span>
                  <div className="gcash-mobile-row">
                    <strong>{GCASH_MOBILE_NUMBER}</strong>
                    <button
                      type="button"
                      className="gcash-copy-button"
                      onClick={handleCopyGCashNumber}
                    >
                      Copy
                    </button>
                  </div>
                  {recipientCopyFeedback && (
                    <small role="status">{recipientCopyFeedback}</small>
                  )}
                </div>
                <div>
                  <span>Order Total</span>
                  <strong>{formatPrice(checkoutTotal)}</strong>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

export default CheckoutPage;