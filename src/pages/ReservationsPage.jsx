import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import SiteFooter from "../components/SiteFooter";
import {
  CAFE_CONTACT_PHONE,
  CAFE_CONTACT_PHONE_TEL,
} from "../constants/cafeInfo.js";
import {
  GCASH_ACCOUNT_NAME,
  GCASH_MOBILE_NUMBER,
  GCASH_QR_IMAGE_PATH,
} from "../constants/gcashPayment.js";
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
import { useAuth } from "../context/Authcontext";
import {
  normalizePHPhone,
  PH_PHONE_VALIDATION_ERROR,
} from "../utils/phoneUtils.js";
import "../styles/ReservationsPage.css";

const RESERVATION_FEE_PER_HEAD = 50;
const RESERVATION_DRAFT_STORAGE_KEY = "cactus-cafe:reservation-selections";
const NETWORK_ERROR_CODES = new Set([
  "unavailable",
  "deadline-exceeded",
  "network-request-failed",
]);
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

const getProfileName = (profile, authUser) => {
  const firstName = String(profile?.firstName || "").trim();
  const lastName = String(profile?.lastName || "").trim();

  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim();
  }

  return String(
    profile?.name
      || profile?.fullName
      || profile?.displayName
      || authUser?.displayName
      || "",
  ).trim();
};

const terminateReceiptOcrWorker = async (worker) => {
  try {
    await worker.terminate();
  } catch (error) {
    console.error("Unable to stop the reservation receipt OCR worker:", error);
  }
};

const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const isValidDraftDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === value;
};

const isValidDraftTime = (value) =>
  typeof value === "string"
  && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

function ReservationsPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [customerName, setCustomerName] = useState(
    () => user?.displayName?.trim() || "",
  );
  const customerNameEditedRef = useRef(false);
  const customerNameUserIdRef = useRef("");
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
  const [reservationSelection, setReservationSelection] = useState({
    userId: null,
    date: "",
    time: "",
    guests: 1,
    selectedPaymentOption: "full",
  });
  const savedReservationSelection = useMemo(() => {
    const restoredDraft = {
      date: "",
      time: "",
      guests: 1,
      selectedPaymentOption: "full",
    };
    const userId = user?.uid;
    if (authLoading || !userId) return restoredDraft;

    try {
      const savedDraft = window.sessionStorage.getItem(
        `${RESERVATION_DRAFT_STORAGE_KEY}:${userId}`
      );
      if (!savedDraft) return restoredDraft;

      const parsedDraft = JSON.parse(savedDraft);
      if (
        !parsedDraft
        || typeof parsedDraft !== "object"
        || Array.isArray(parsedDraft)
      ) {
        return restoredDraft;
      }

      if (isValidDraftDate(parsedDraft.date)) {
        restoredDraft.date = parsedDraft.date;
      }
      if (isValidDraftTime(parsedDraft.time)) {
        restoredDraft.time = parsedDraft.time;
      }

      const restoredGuestCount = Number(parsedDraft.guests);
      if (
        Number.isInteger(restoredGuestCount)
        && restoredGuestCount >= 1
        && restoredGuestCount <= 20
      ) {
        restoredDraft.guests = restoredGuestCount;
      }
      if (["full", "half"].includes(parsedDraft.selectedPaymentOption)) {
        restoredDraft.selectedPaymentOption =
          parsedDraft.selectedPaymentOption;
      }
    } catch (storageError) {
      console.error("Unable to load saved reservation selections:", storageError);
    }

    return restoredDraft;
  }, [authLoading, user]);
  const currentReservationSelection =
    reservationSelection.userId === (user?.uid ?? null)
      ? reservationSelection
      : { userId: user?.uid ?? null, ...savedReservationSelection };
  const {
    date,
    time,
    guests,
    selectedPaymentOption,
  } = currentReservationSelection;
  const [notes, setNotes] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReferenceCheck, setPaymentReferenceCheck] = useState({
    userId: "",
    reference: "",
    loading: false,
    duplicate: false,
    error: "",
  });
  const paymentReferenceCheckSequenceRef = useRef(0);
  const paymentReferenceCheckTimerRef = useRef(null);
  const paymentReferenceValueRef = useRef("");
  const paymentReferenceSourceRef = useRef("");
  const skipNextReferenceDebounceRef = useRef("");
  const [paymentProofUrl, setPaymentProofUrl] = useState("");
  const [paymentProofFileName, setPaymentProofFileName] = useState("");
  const [paymentProofBusy, setPaymentProofBusy] = useState(false);
  const [paymentProofError, setPaymentProofError] = useState("");
  const [receiptOcrStatus, setReceiptOcrStatus] = useState("idle");
  const receiptOcrGenerationRef = useRef(0);
  const receiptOcrWorkerRef = useRef(null);
  const [isGcashQrExpanded, setIsGcashQrExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgressRef = useRef(false);
  const submissionAttemptRef = useRef({ fingerprint: "", token: "" });
  const receiptFileInputRef = useRef(null);
  const receiptFileSelectionRef = useRef(0);
  const gcashQrTriggerRef = useRef(null);
  const gcashQrModalRef = useRef(null);
  const gcashQrCloseRef = useRef(null);
  const [submissionAttemptToken, setSubmissionAttemptToken] = useState("");
  const [submissionIssue, setSubmissionIssue] = useState("");
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine
  );
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
  const normalizedPaymentReference =
    normalizePaymentReference(paymentReference);
  const paymentReferenceCheckIsCurrent =
    Boolean(user?.uid && normalizedPaymentReference)
    && paymentReferenceCheck.userId === user.uid
    && paymentReferenceCheck.reference === normalizedPaymentReference;

  const runPaymentReferenceCheck = useCallback(async (
    referenceValue,
    userId,
  ) => {
    const reference = normalizePaymentReference(referenceValue);
    if (!userId || !isValidNormalizedPaymentReference(reference)) return null;

    const checkSequence = ++paymentReferenceCheckSequenceRef.current;
    setPaymentReferenceCheck({
      userId,
      reference,
      loading: true,
      duplicate: false,
      error: "",
    });

    try {
      const duplicate = await checkPaymentReference(db, userId, referenceValue);
      if (checkSequence !== paymentReferenceCheckSequenceRef.current) {
        return null;
      }

      setPaymentReferenceCheck({
        userId,
        reference,
        loading: false,
        duplicate,
        error: "",
      });
      return { duplicate, error: "" };
    } catch (error) {
      console.error("Unable to check reservation payment reference:", error);
      if (checkSequence !== paymentReferenceCheckSequenceRef.current) {
        return null;
      }

      setPaymentReferenceCheck({
        userId,
        reference,
        loading: false,
        duplicate: false,
        error: PAYMENT_REFERENCE_CHECK_ERROR,
      });
      return { duplicate: false, error: PAYMENT_REFERENCE_CHECK_ERROR };
    }
  }, []);

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

  useEffect(() => () => {
    receiptFileSelectionRef.current += 1;
    receiptOcrGenerationRef.current += 1;
    const worker = receiptOcrWorkerRef.current;
    receiptOcrWorkerRef.current = null;
    if (worker) void terminateReceiptOcrWorker(worker);
  }, []);

  useEffect(() => {
    const reference = normalizePaymentReference(paymentReference);
    const userId = user?.uid;

    if (!userId || !isValidNormalizedPaymentReference(reference)) {
      return undefined;
    }
    if (skipNextReferenceDebounceRef.current === reference) {
      skipNextReferenceDebounceRef.current = "";
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      paymentReferenceCheckTimerRef.current = null;
      void runPaymentReferenceCheck(paymentReference, userId);
    }, 500);
    paymentReferenceCheckTimerRef.current = timeoutId;

    return () => {
      window.clearTimeout(timeoutId);
      if (paymentReferenceCheckTimerRef.current === timeoutId) {
        paymentReferenceCheckTimerRef.current = null;
      }
      paymentReferenceCheckSequenceRef.current += 1;
    };
  }, [paymentReference, runPaymentReferenceCheck, user?.uid]);

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

  const saveReservationSelectionDraft = (updatedValues = {}) => {
    const userId = user?.uid;
    const nextSelection = {
      ...currentReservationSelection,
      ...updatedValues,
    };
    setReservationSelection(nextSelection);
    if (!userId) return;

    const nextDate = nextSelection.date;
    const nextTime = nextSelection.time;
    const nextGuests = nextSelection.guests;
    const nextPaymentOption = nextSelection.selectedPaymentOption;
    const guestCountForDraft = Number(nextGuests);
    const draft = {
      date: isValidDraftDate(nextDate) ? nextDate : "",
      time: isValidDraftTime(nextTime) ? nextTime : "",
      guests: Number.isInteger(guestCountForDraft)
        && guestCountForDraft >= 1
        && guestCountForDraft <= 20
        ? guestCountForDraft
        : 1,
      selectedPaymentOption: ["full", "half"].includes(nextPaymentOption)
        ? nextPaymentOption
        : "full",
    };

    try {
      window.sessionStorage.setItem(
        `${RESERVATION_DRAFT_STORAGE_KEY}:${userId}`,
        JSON.stringify(draft)
      );
    } catch (storageError) {
      console.error("Unable to save reservation selections:", storageError);
    }
  };

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
      } else if (!paymentReferenceValueRef.current.trim()) {
        paymentReferenceValueRef.current = detectedReference;
        paymentReferenceSourceRef.current = "auto";
        skipNextReferenceDebounceRef.current = detectedReference;
        setPaymentReference(detectedReference);
        setReceiptOcrStatus("auto_filled");
        void runPaymentReferenceCheck(detectedReference, user?.uid);
      } else {
        setReceiptOcrStatus("manual_kept");
      }
    } catch (error) {
      if (generation === receiptOcrGenerationRef.current) {
        console.error(
          "Unable to scan reservation receipt for a reference:",
          error,
        );
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
    const ocrGeneration = ++receiptOcrGenerationRef.current;
    const previousWorker = receiptOcrWorkerRef.current;
    receiptOcrWorkerRef.current = null;
    if (previousWorker) void terminateReceiptOcrWorker(previousWorker);
    if (paymentReferenceSourceRef.current === "auto") {
      paymentReferenceValueRef.current = "";
      paymentReferenceSourceRef.current = "";
      skipNextReferenceDebounceRef.current = "";
      setPaymentReference("");
    }
    setReceiptOcrStatus("idle");
    setPaymentProofError("");
    setPaymentProofBusy(true);

    try {
      const compressedReceipt = await compressReceiptImage(file);
      if (fileSelectionId !== receiptFileSelectionRef.current) return;
      setPaymentProofUrl(compressedReceipt);
      setPaymentProofFileName(file.name);
      setFormError("");
      void scanReceiptForReference(compressedReceipt, ocrGeneration);
    } catch (receiptError) {
      if (fileSelectionId !== receiptFileSelectionRef.current) return;
      console.error("Unable to process reservation receipt:", receiptError);
      setPaymentProofUrl("");
      setPaymentProofFileName("");
      setPaymentProofError(
        receiptError instanceof Error
          ? receiptError.message
          : "Unable to prepare the receipt image.",
      );
    } finally {
      if (fileSelectionId === receiptFileSelectionRef.current) {
        setPaymentProofBusy(false);
        fileInput.value = "";
      }
    }
  };

  const handleRemoveReceipt = () => {
    receiptFileSelectionRef.current += 1;
    void cancelReceiptOcr();
    if (paymentReferenceSourceRef.current === "auto") {
      paymentReferenceValueRef.current = "";
      paymentReferenceSourceRef.current = "";
      skipNextReferenceDebounceRef.current = "";
      setPaymentReference("");
    }
    setPaymentProofUrl("");
    setPaymentProofFileName("");
    setPaymentProofError("");
    setPaymentProofBusy(false);
    if (receiptFileInputRef.current) {
      receiptFileInputRef.current.value = "";
    }
  };

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

    if (customerNameUserIdRef.current !== user.uid) {
      customerNameUserIdRef.current = user.uid;
      customerNameEditedRef.current = false;
    }

    let active = true;

    getDoc(doc(db, "users", user.uid))
      .then((profileSnapshot) => {
        if (!active) return;

        if (!profileSnapshot.exists()) {
          if (!customerNameEditedRef.current) {
            setCustomerName(user.displayName?.trim() || "");
          }
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
        if (!customerNameEditedRef.current) {
          setCustomerName(getProfileName(profile, user));
        }
        setPhone(normalizePHPhone(getProfilePhone(profile)));
      })
      .catch((error) => {
        if (!active) return;
        console.error("Error loading reservation customer profile:", error);
        if (!customerNameEditedRef.current) {
          setCustomerName(user.displayName?.trim() || "");
        }
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
    if (submissionInProgressRef.current) return;
    setFormError("");

    if (!isOnline || (typeof navigator !== "undefined" && !navigator.onLine)) {
      setSubmissionIssue("offline");
      return;
    }

    setSubmissionIssue("");

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

    const cleanPaymentReference = normalizePaymentReference(paymentReference);
    if (!isValidNormalizedPaymentReference(cleanPaymentReference)) {
      alert("Enter a valid GCash / Maya payment reference number.");
      return;
    }
    if (paymentProofBusy) {
      setFormError("Please wait while we prepare your payment screenshot.");
      return;
    }
    if (!paymentProofUrl) {
      setFormError("Upload your GCash / Maya payment screenshot to continue.");
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

    submissionInProgressRef.current = true;
    setIsSubmitting(true);
    const referenceCheck = await runPaymentReferenceCheck(
      paymentReference,
      currentUser.uid,
    );
    if (!referenceCheck || referenceCheck.error) {
      setFormError(referenceCheck?.error || PAYMENT_REFERENCE_CHECK_ERROR);
      submissionInProgressRef.current = false;
      setIsSubmitting(false);
      return;
    }

    if (referenceCheck.duplicate) {
      submissionInProgressRef.current = false;
      setIsSubmitting(false);
      document.getElementById("paymentReference")?.focus();
      return;
    }

    const attemptFingerprint = JSON.stringify({
      customerName: customerName.trim(),
      phone: normalizedPhone,
      date,
      time,
      guests: guestCount,
      notes: notes.trim(),
      selectedPaymentOption,
      paymentReference: cleanPaymentReference,
      paymentProofUrl,
    });
    if (submissionAttemptRef.current.fingerprint !== attemptFingerprint) {
      submissionAttemptRef.current = {
        fingerprint: attemptFingerprint,
        token: doc(collection(db, "reservations")).id,
      };
    }
    const submissionToken = submissionAttemptRef.current.token;
    setSubmissionAttemptToken(submissionToken);
    submissionInProgressRef.current = true;

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

      const reservationBatch = writeBatch(db);
      claimPaymentReference(
        reservationBatch,
        db,
        currentUser.uid,
        paymentReference,
        "reservation",
      );
      reservationBatch.set(doc(db, "reservations", submissionToken), {
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
        paymentProofUrl,
        paymentStatus: "pending_review",

        createdAt: serverTimestamp(),
      });
      await reservationBatch.commit();

      try {
        window.sessionStorage.removeItem(
          `${RESERVATION_DRAFT_STORAGE_KEY}:${currentUser.uid}`
        );
      } catch (storageError) {
        console.error("Unable to clear saved reservation selections:", storageError);
      }
      submissionAttemptRef.current = { fingerprint: "", token: "" };
      setSubmissionAttemptToken("");
      setSubmissionIssue("");
      alert("Reservation submitted successfully! 🌵");

      navigate("/customer");
    } catch (error) {
      console.error("Error creating reservation:", error);

      if (error?.code === "permission-denied") {
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
            setFormError(DUPLICATE_PAYMENT_REFERENCE_MESSAGE);
            return;
          }
        } catch (referenceCheckError) {
          console.error(
            "Unable to identify a conflicting reservation reference:",
            referenceCheckError,
          );
        }
      }

      if (error?.code === "phone/blocked") {
        setFormError(BLOCKED_PHONE_MESSAGE);
        setPhoneCheck({
          phone: normalizedPhone,
          loading: false,
          blocked: true,
          error: "",
        });
      } else {
        if (error?.code === "phone/already-registered") {
          setFormError(
            "This phone number is already registered to another account. Please use another phone number."
          );
        } else {
          const networkInterrupted =
            NETWORK_ERROR_CODES.has(error?.code)
            || (typeof navigator !== "undefined" && !navigator.onLine);
          setSubmissionIssue(networkInterrupted ? "interrupted" : "uncertain");
          setFormError("Unable to confirm the reservation submission.");
        }
      }
    } finally {
      submissionInProgressRef.current = false;
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

          {(!isOnline || submissionIssue === "offline") && (
            <div className="reservation-connectivity-notice" role="status">
              <strong>
                {isOnline
                  ? "You’re back online"
                  : "Internet connection unavailable"}
              </strong>
              <p>
                {isOnline
                  ? "Your reservation has not been submitted. Continue when you’re ready."
                  : "Your selections are still here. Reconnect before submitting; reconnecting will not send this reservation automatically."}
              </p>
            </div>
          )}

          {(submissionIssue === "interrupted"
            || submissionIssue === "uncertain") && (
            <div className="reservation-submission-notice" role="status">
              <strong>
                {submissionIssue === "interrupted"
                  ? "Your connection was interrupted while submitting."
                  : "We couldn’t confirm whether your reservation was received."}
              </strong>
              <p>
                Check <Link to="/my-reservations">My Reservations</Link> before
                retrying. If it is not listed, you can retry manually; this
                attempt keeps the same request key.
              </p>
            </div>
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
              onChange={(event) => {
                customerNameEditedRef.current = true;
                setCustomerName(event.target.value)
              }}
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
                onChange={(event) => {
                  const nextDate = event.target.value;
                  saveReservationSelectionDraft({ date: nextDate });
                }}
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
                onChange={(event) => {
                  const nextTime = event.target.value;
                  saveReservationSelectionDraft({ time: nextTime });
                }}
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
              onChange={(event) => {
                const nextGuests = event.target.value;
                saveReservationSelectionDraft({ guests: nextGuests });
              }}
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
                  onChange={() => {
                    saveReservationSelectionDraft({
                      selectedPaymentOption: "full",
                    });
                  }}
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
                  onChange={() => {
                    saveReservationSelectionDraft({
                      selectedPaymentOption: "half",
                    });
                  }}
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

            <div className="reservation-gcash-info">
              <button
                ref={gcashQrTriggerRef}
                className="reservation-gcash-qr-button"
                type="button"
                onClick={() => setIsGcashQrExpanded(true)}
                aria-label="Enlarge Cactus Café's GCash and Maya payment QR code"
              >
                <img
                  className="reservation-gcash-qr"
                  src={GCASH_QR_IMAGE_PATH}
                  alt="Cactus Café's GCash and Maya payment QR code"
                />
              </button>
              <div className="reservation-gcash-recipient">
                <span className="reservation-gcash-label">
                  CACTUS CAFÉ GCASH / MAYA
                </span>
                <p>
                  Scan the QR code using GCash or Maya and pay the selected
                  amount due now.
                </p>
                <dl>
                  <div>
                    <dt>Account Name</dt>
                    <dd>{GCASH_ACCOUNT_NAME}</dd>
                  </div>
                  <div>
                    <dt>GCash / Maya Mobile No.</dt>
                    <dd>{GCASH_MOBILE_NUMBER}</dd>
                  </div>
                  <div className="reservation-gcash-amount">
                    <dt>Amount Due Now</dt>
                    <dd>{formatPHP(amountPaidNow)}</dd>
                  </div>
                </dl>
              </div>
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
              Enter the transaction reference from your payment receipt and
              upload a screenshot. Your payment remains pending review until
              café staff verifies it.
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
                disabled={isSubmitting}
                value={paymentReference}
                onChange={(event) => {
                  const nextReference = event.target.value;
                  paymentReferenceValueRef.current = nextReference;
                  paymentReferenceSourceRef.current = "manual";
                  skipNextReferenceDebounceRef.current = "";
                  setPaymentReference(nextReference);
                  setFormError("");
                }}
                onBlur={() => {
                  if (paymentReferenceCheckTimerRef.current !== null) {
                    window.clearTimeout(paymentReferenceCheckTimerRef.current);
                    paymentReferenceCheckTimerRef.current = null;
                  }
                  void runPaymentReferenceCheck(paymentReference, user?.uid);
                }}
                placeholder="Enter your transaction reference number"
                aria-describedby="reservation-payment-reference-feedback reservation-payment-reference-warning"
                required
              />
              <small
                id="reservation-payment-reference-feedback"
                className={
                  paymentReferenceCheckIsCurrent
                    && paymentReferenceCheck.error
                    ? "reservation-reference-feedback is-error"
                    : "reservation-reference-feedback"
                }
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
                      ? "Checking this reference against your previous payments…"
                      : ""}
              </small>
              {paymentReferenceCheckIsCurrent
                && paymentReferenceCheck.duplicate && (
                  <p
                    className="reservation-reference-warning"
                    id="reservation-payment-reference-warning"
                    role="alert"
                  >
                    {DUPLICATE_PAYMENT_REFERENCE_MESSAGE}
                  </p>
              )}
            </div>

            <div className="form-group reservation-payment-proof">
              <label htmlFor="reservationPaymentProof">
                Payment Screenshot <span>Required</span>
              </label>
              <input
                ref={receiptFileInputRef}
                id="reservationPaymentProof"
                name="reservationPaymentProof"
                className="reservation-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={paymentProofBusy || isSubmitting}
                aria-required="true"
                aria-invalid={Boolean(paymentProofError)}
                onChange={handleReceiptChange}
              />
              <div className="reservation-upload-controls">
                <button
                  className="reservation-upload-trigger"
                  type="button"
                  onClick={() => receiptFileInputRef.current?.click()}
                  disabled={paymentProofBusy || isSubmitting}
                  aria-describedby="reservation-payment-proof-status"
                >
                  {paymentProofFileName ? "Replace screenshot" : "Choose screenshot"}
                </button>
                <span
                  className="reservation-upload-status"
                  id="reservation-payment-proof-status"
                  role="status"
                >
                  {paymentProofBusy
                    ? "Preparing screenshot…"
                    : paymentProofFileName
                      ? paymentProofFileName
                      : "No screenshot selected"}
                </span>
                {paymentProofFileName && (
                  <span className="reservation-upload-ready">
                    Ready to upload
                  </span>
                )}
              </div>
              <small>
                JPEG, PNG, or WebP. The image is compressed in your browser
                before submission.
              </small>
              {receiptOcrStatus !== "idle" && (
                <small
                  className={`reservation-receipt-ocr reservation-receipt-ocr-${receiptOcrStatus}`}
                  role="status"
                  aria-live="polite"
                >
                  {receiptOcrStatus === "scanning"
                    ? "Scanning screenshot for a GCash reference number…"
                    : receiptOcrStatus === "auto_filled"
                      ? "Reference auto-filled from screenshot. Please verify it."
                      : receiptOcrStatus === "manual_kept"
                        ? "A reference was detected, but your entered value was kept."
                        : receiptOcrStatus === "not_found"
                          ? "Couldn't detect a 13-digit reference. Enter it from your receipt."
                          : "Automatic scan couldn't read the screenshot. Enter the reference manually."}
                </small>
              )}
              {paymentProofBusy && (
                <small role="status">Preparing payment screenshot…</small>
              )}
              {paymentProofError && (
                <small className="reservation-payment-proof-error" role="alert">
                  {paymentProofError}
                </small>
              )}
              {paymentProofUrl && (
                <div className="reservation-receipt-preview">
                  <img
                    src={paymentProofUrl}
                    alt="Compressed reservation payment screenshot preview"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveReceipt}
                    disabled={paymentProofBusy || isSubmitting}
                  >
                    Clear screenshot
                  </button>
                </div>
              )}
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
                || !isOnline
                || paymentProofBusy
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
                : (submissionIssue === "interrupted"
                  || submissionIssue === "uncertain")
                  && submissionAttemptToken
                  ? "Retry manually"
                  : "Reserve Table"}
            </button>

          </div>

        </form>

        </section>
      {isGcashQrExpanded && (
        <div
          className="reservation-gcash-qr-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsGcashQrExpanded(false);
            }
          }}
        >
          <section
            ref={gcashQrModalRef}
            className="reservation-gcash-qr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reservation-gcash-qr-modal-title"
          >
            <div className="reservation-gcash-qr-modal-header">
              <h2 id="reservation-gcash-qr-modal-title">
                Cactus Café GCash / Maya QR
              </h2>
              <button
                ref={gcashQrCloseRef}
                type="button"
                className="reservation-gcash-qr-modal-close"
                onClick={() => setIsGcashQrExpanded(false)}
                aria-label="Close expanded GCash QR code"
              >
                <span aria-hidden="true">×</span>
                Close
              </button>
            </div>
            <img
              className="reservation-gcash-qr-modal-image"
              src={GCASH_QR_IMAGE_PATH}
              alt="Expanded Cactus Café GCash and Maya payment QR code"
            />
            <p>
              Scan this QR code using GCash or Maya and pay the amount shown
              on your reservation form.
            </p>
          </section>
        </div>
      )}
      </main>
      <SiteFooter />
    </>
  );
}

export default ReservationsPage;