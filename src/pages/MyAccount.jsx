import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { isPhoneBlocked } from "../services/blockedPhoneService.js";
import {
  ISABELA_BARANGAYS,
  ISABELA_MUNICIPALITY,
  ISABELA_OTHER_STREET_OPTION,
  ISABELA_STREETS_BY_BARANGAY,
  NEGROS_OCCIDENTAL_PROVINCE,
  isWithinIsabelaDeliveryBounds,
} from "../constants/isabelaAddress";
import IsabelaDeliveryMap from "../components/IsabelaDeliveryMap";
import { useAuth } from "../context/Authcontext";
import { addEmailPasswordLogin } from "../services/authService";
import { saveCustomerProfileWithPhone } from "../services/phoneRegistryService.js";
import { auth, db } from "../services/firebase";
import {
  normalizePHPhone,
  PH_PHONE_VALIDATION_ERROR,
} from "../utils/phoneUtils.js";
import "../styles/MyAccount.css";

const PHONE_EDIT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;

const EMPTY_PROFILE = {
  firstName: "",
  lastName: "",
  phone: "",
  houseNumberStreet: "",
  barangay: "",
  streetPurok: "",
  municipalityCity: ISABELA_MUNICIPALITY,
  province: NEGROS_OCCIDENTAL_PROVINCE,
  deliveryInstructions: "",
  deliveryLocation: null,
};

const getSavedProfilePhone = (profile) =>
  String(profile?.phoneNumber || profile?.phone || "").trim();

const getTimestampDate = (timestamp) => {
  const date = typeof timestamp?.toDate === "function"
    ? timestamp.toDate()
    : timestamp instanceof Date
      ? timestamp
      : null;

  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
};

const getProfileSaveErrorMessage = (error, fallbackOperation) => {
  const operation = error?.operation || fallbackOperation;

  if (error?.code === "permission-denied") {
    return `Unable to save your profile because Firestore denied the ${operation}. Verify that your phone number is available and any delivery pin is within Isabela, then try again. (permission-denied)`;
  }

  if (
    error?.code === "unavailable"
    || error?.code === "deadline-exceeded"
  ) {
    return "Unable to save your profile because the database is temporarily unavailable. Check your connection and try again.";
  }

  const errorCode = error?.code ? ` (${error.code})` : "";
  const errorDetails = error?.message || "Please try again.";
  return `Unable to save your changes${errorCode}: ${errorDetails}`;
};

const getNameParts = (profile, authUser) => {
  const firstName = String(profile.firstName || "").trim();
  const lastName = String(profile.lastName || "").trim();

  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const fullName = String(
    profile.name || profile.fullName || profile.displayName ||
      authUser.displayName || "",
  ).trim();
  const [derivedFirstName = "", ...remainingName] = fullName.split(/\s+/);

  return {
    firstName: derivedFirstName,
    lastName: remainingName.join(" "),
  };
};

const getInitials = (name) => {
  const nameParts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return "";

  const firstInitial = Array.from(nameParts[0])[0];
  const lastInitial =
    nameParts.length > 1
      ? Array.from(nameParts[nameParts.length - 1])[0]
      : "";

  return `${firstInitial}${lastInitial}`.toUpperCase();
};

function ProfileAvatar({ photoURL, name }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl = typeof photoURL === "string" ? photoURL.trim() : "";
  const initials = getInitials(name);

  return (
    <div className="account-profile-avatar" aria-hidden="true">
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : initials ? (
        <span>{initials}</span>
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
    </div>
  );
}

const getDeliveryAddress = (profile) => {
  const address = profile.deliveryAddress;

  if (address && typeof address === "object" && !Array.isArray(address)) {
    return address;
  }

  return {};
};

const toProfileForm = (profile, authUser) => {
  const address = getDeliveryAddress(profile);
  const houseNumberStreet = String(address.houseNumberStreet || "");
  const barangay = String(address.barangay || "");

  return {
    ...EMPTY_PROFILE,
    ...getNameParts(profile, authUser),
    phone: getSavedProfilePhone(profile),
    houseNumberStreet,
    barangay,
    streetPurok: String(
      address.streetPurok || (
        houseNumberStreet && ISABELA_STREETS_BY_BARANGAY[barangay]
          ? ISABELA_OTHER_STREET_OPTION
          : ""
      ),
    ),
    municipalityCity: ISABELA_MUNICIPALITY,
    province: NEGROS_OCCIDENTAL_PROVINCE,
    deliveryInstructions: String(address.deliveryInstructions || ""),
    deliveryLocation: isWithinIsabelaDeliveryBounds(address.deliveryLocation)
      ? {
        lat: address.deliveryLocation.lat,
        lng: address.deliveryLocation.lng,
      }
      : null,
  };
};

const validateProfile = (profile) => {
  if (
    profile.deliveryLocation !== null
    && !isWithinIsabelaDeliveryBounds(profile.deliveryLocation)
  ) {
    return "Select a delivery pin within Isabela, Negros Occidental.";
  }

  if (!profile.firstName.trim() || !profile.lastName.trim()) {
    return "Enter your first and last name.";
  }

  if (profile.firstName.trim().length > 80 || profile.lastName.trim().length > 80) {
    return "Names must be 80 characters or fewer.";
  }

  if (!normalizePHPhone(profile.phone)) return PH_PHONE_VALIDATION_ERROR;

  const addressFields = [
    profile.houseNumberStreet,
    profile.streetPurok,
    profile.barangay,
  ];
  const hasAddress = addressFields.some((value) => value.trim());

  if (hasAddress && addressFields.some((value) => !value.trim())) {
    return "Complete the barangay, street / purok, and house details, or leave the address blank.";
  }

  if (
    hasAddress
    && !ISABELA_BARANGAYS.includes(profile.barangay)
  ) {
    return "Select a barangay in Isabela.";
  }

  if (
    hasAddress
    && !ISABELA_STREETS_BY_BARANGAY[profile.barangay]?.includes(
      profile.streetPurok,
    )
  ) {
    return "Select a street / purok for the selected barangay.";
  }

  if (
    profile.houseNumberStreet.length > 150 ||
    profile.barangay.length > 100 ||
    profile.streetPurok.length > 100 ||
    profile.municipalityCity.length > 100 ||
    profile.province.length > 100 ||
    profile.deliveryInstructions.length > 300
  ) {
    return "Address fields exceed their maximum length.";
  }

  return "";
};

const getCredentialErrorMessage = (errorCode) => {
  switch (errorCode) {
    case "auth/credential-already-in-use":
    case "auth/email-already-in-use":
      return "That email/password login is already associated with another account. No accounts were merged. Sign in with the existing account instead.";
    case "auth/requires-recent-login":
      return "Google could not verify your session. Sign out and sign back in with Google, then try again.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a stronger password that meets the account security requirements.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google reauthentication was cancelled. Try again when you are ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google verification window. Allow pop-ups and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled for this project.";
    case "auth/no-current-user":
    case "auth/user-changed":
      return "Your signed-in account changed. Sign in again before adding a password login.";
    case "auth/provider-already-linked":
      return "This account already has an email/password login or is not signed in with Google.";
    case "auth/email-required":
      return "Your Google account does not provide an email address, so a password login cannot be added.";
    default:
      return "Unable to add an email/password login. Please try again.";
  }
};

function MyAccount() {
  const navigate = useNavigate();
  const { user, role, loading: authLoading, roleError } = useAuth();
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [profileDocument, setProfileDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoadedUid, setProfileLoadedUid] = useState("");
  const [loadError, setLoadError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [linkingLogin, setLinkingLogin] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState("");
  const [credentialMessageType, setCredentialMessageType] = useState("");
  const [passwordLoginLinked, setPasswordLoginLinked] = useState(false);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const authenticatedUser = auth.currentUser;
  const savedProfilePhone = getSavedProfilePhone(profileDocument);
  const savedPhoneUpdatedAt = getTimestampDate(profileDocument?.phoneUpdatedAt);
  const nextPhoneEditAt = savedPhoneUpdatedAt
    ? savedPhoneUpdatedAt.getTime() + PHONE_EDIT_COOLDOWN_MS
    : null;
  const phoneEditDisabled = Boolean(
    savedProfilePhone
    && (nextPhoneEditAt === null || nextPhoneEditAt > cooldownNow),
  );
  const cooldownDateLabel = nextPhoneEditAt === null
    ? ""
    : new Date(nextPhoneEditAt).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const authDisplayName =
    typeof authenticatedUser?.displayName === "string"
      ? authenticatedUser.displayName.trim()
      : "";
  const profileDisplayName = `${form.firstName} ${form.lastName}`.trim();
  const accountDisplayName = authDisplayName || profileDisplayName;
  const accountEmail =
    authenticatedUser?.email || user?.email || "Email unavailable";
  const hasGoogleProvider = authenticatedUser?.providerData.some(
    (provider) => provider.providerId === "google.com"
  );
  const hasPasswordProvider =
    passwordLoginLinked
    || authenticatedUser?.providerData.some(
      (provider) => provider.providerId === "password"
    );
  const showAddPasswordLogin =
    Boolean(hasGoogleProvider) && !hasPasswordProvider;

  useEffect(() => {
    if (nextPhoneEditAt === null || nextPhoneEditAt <= cooldownNow) {
      return undefined;
    }

    const timerId = window.setTimeout(
      () => setCooldownNow(Date.now()),
      Math.min(nextPhoneEditAt - cooldownNow, MAX_TIMEOUT_MS),
    );

    return () => window.clearTimeout(timerId);
  }, [cooldownNow, nextPhoneEditAt]);

  useEffect(() => {
    if (authLoading) return undefined;

    if (!user) {
      navigate("/login", { replace: true });
      return undefined;
    }

    if (roleError) {
      return undefined;
    }

    if (!role) return undefined;

    if (role !== "customer") {
      navigate(role === "admin" ? "/admin/menu" : "/login", {
        replace: true,
      });
      return undefined;
    }

    let isCurrent = true;

    getDoc(doc(db, "users", user.uid))
      .then((profileSnapshot) => {
        if (!isCurrent) return;

        setProfileLoadedUid(user.uid);
        setLoadError("");
        setFeedback("");

        if (!profileSnapshot.exists()) {
          setProfileDocument(null);
          setLoadError(
            "We could not find your customer profile. Please contact Cactus Café for help.",
          );
          return;
        }

        const profile = profileSnapshot.data();

        if (profile.role !== "customer") {
          setProfileDocument(null);
          setLoadError("This page is only available to customer accounts.");
          return;
        }

        setProfileDocument(profile);
        setForm(toProfileForm(profile, user));
      })
      .catch((error) => {
        if (!isCurrent) return;

        setProfileLoadedUid(user.uid);
        console.error("Error loading customer profile:", error);
        setLoadError("Unable to load your profile. Please try again.");
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [authLoading, loadAttempt, navigate, role, roleError, user]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((currentForm) => ({
      ...currentForm,
      [name]: value,
      ...(name === "barangay" ? { streetPurok: "" } : {}),
    }));
    setValidationError("");
    setFeedback("");
  };

  const retryProfileLoad = () => {
    if (!user) return;

    setLoading(true);
    setLoadError("");
    setFeedback("");
    setLoadAttempt((attempt) => attempt + 1);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setValidationError("");
    setFeedback("");

    if (!user || !profileDocument) {
      setLoadError("Your profile is unavailable. Reload it before saving.");
      return;
    }

    const errorMessage = validateProfile(form);

    if (errorMessage) {
      setValidationError(errorMessage);
      return;
    }

    const normalizedPhone = normalizePHPhone(form.phone);
    const storedPhoneValue = getSavedProfilePhone(profileDocument);
    const savedNormalizedPhone = normalizePHPhone(storedPhoneValue);
    const phoneWillChange = normalizedPhone !== savedNormalizedPhone
      || (
        storedPhoneValue
        && storedPhoneValue !== normalizedPhone
      );

    if (phoneWillChange && phoneEditDisabled) {
      setValidationError(
        nextPhoneEditAt
          ? `You can update your mobile number once every 30 days. Next edit available on ${cooldownDateLabel}.`
          : "Save your profile once to initialize the 30-day mobile-number edit period before changing your saved number.",
      );
      return;
    }

    if (
      phoneWillChange
      && !window.confirm(
        "Please double-check your mobile number. Once saved, it can only be changed again after 30 days. Continue?",
      )
    ) {
      return;
    }

    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    const deliveryAddress = {
      houseNumberStreet: form.houseNumberStreet.trim(),
      barangay: form.barangay.trim(),
      streetPurok: form.streetPurok.trim(),
      municipalityCity: ISABELA_MUNICIPALITY,
      province: NEGROS_OCCIDENTAL_PROVINCE,
      deliveryInstructions: form.deliveryInstructions.trim(),
      deliveryLocation: form.deliveryLocation,
    };
    const nameUpdate = {};
    if (
      Object.hasOwn(profileDocument, "firstName") ||
      Object.hasOwn(profileDocument, "lastName")
    ) {
      nameUpdate.firstName = form.firstName.trim();
      nameUpdate.lastName = form.lastName.trim();
    }

    const existingNameField = ["name", "fullName", "displayName"].find(
      (field) => Object.hasOwn(profileDocument, field),
    );
    const savedNameField = existingNameField || "name";
    nameUpdate[savedNameField] = fullName;

    let saveStage = "checking blockedPhones";
    try {
      setSaving(true);
      setValidationError("");
      if (phoneWillChange && await isPhoneBlocked(db, normalizedPhone)) {
        setValidationError(
          "This mobile number is blocked and cannot be saved. Please contact Cactus Café for assistance.",
        );
        return;
      }

      saveStage = "saving users/{uid}, phoneRegistry, and profile fields";
      await saveCustomerProfileWithPhone(
        db,
        user.uid,
        form.phone,
        { ...nameUpdate, deliveryAddress },
      );

      setProfileDocument((currentProfile) => ({
        ...currentProfile,
        ...nameUpdate,
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        phoneUpdatedAt: phoneWillChange || !currentProfile.phoneUpdatedAt
          ? new Date()
          : currentProfile.phoneUpdatedAt,
        deliveryAddress,
      }));
      setCooldownNow(Date.now());
      setFeedback("Your account information has been saved.");
    } catch (error) {
      console.error("Error saving customer profile:", {
        operation: error?.operation || saveStage,
        code: error?.code || "unknown",
        message: error?.message || "No error message provided.",
        phoneChanged: Boolean(phoneWillChange),
        hasDeliveryPin: Boolean(deliveryAddress.deliveryLocation),
      }, error);
      if (error?.code === "phone/already-registered") {
        setFeedback("");
        setValidationError(
          "This phone number is already registered to another account. Please use another phone number.",
        );
      } else if (error?.code === "phone/blocked") {
        setFeedback("");
        setValidationError(
          "This mobile number is blocked and cannot be saved. Please contact Cactus Café for assistance.",
        );
      } else {
        setFeedback(getProfileSaveErrorMessage(error, saveStage));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddPasswordLogin = async (event) => {
    event.preventDefault();
    if (linkingLogin) return;

    setCredentialMessage("");
    setCredentialMessageType("");

    const form = event.currentTarget;
    const passwordInput = form.elements.namedItem("newPassword");
    const confirmPasswordInput = form.elements.namedItem("confirmNewPassword");
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (password.length < 6) {
      setCredentialMessage("Choose a password with at least 6 characters.");
      setCredentialMessageType("error");
      passwordInput.focus();
      return;
    }

    if (password !== confirmPassword) {
      setCredentialMessage("The passwords do not match.");
      setCredentialMessageType("error");
      confirmPasswordInput.focus();
      return;
    }

    form.reset();

    try {
      setLinkingLogin(true);
      await addEmailPasswordLogin(password);
      setPasswordLoginLinked(true);
      setCredentialMessage(
        "Email/password login added. You can now sign in with this email and password."
      );
      setCredentialMessageType("success");
    } catch (error) {
      console.error("Error adding email/password login:", error);
      setCredentialMessage(getCredentialErrorMessage(error?.code));
      setCredentialMessageType("error");
    } finally {
      setLinkingLogin(false);
    }
  };

  const isProfileLoading =
    loading || (role === "customer" && profileLoadedUid !== user?.uid);

  if (authLoading || (isProfileLoading && !roleError)) {
    return (
      <main className="my-account-page">
        <section
          className="my-account-container account-loading"
          aria-busy="true"
          aria-label="Loading your account"
        >
          <div className="account-loading-line short" />
          <div className="account-loading-line large" />
          <div className="account-loading-card" />
          <p role="status">Loading your account information...</p>
        </section>
      </main>
    );
  }

  const streetOptions = ISABELA_STREETS_BY_BARANGAY[form.barangay] || [];

  return (
    <main className="my-account-page">
      <section className="my-account-container">
        <header className="account-header">
          <div>
            <p className="account-eyebrow">CACTUS CAFÉ · YOUR ACCOUNT</p>
            <h1>My Account</h1>
            <p>Keep your contact details and delivery address up to date.</p>
          </div>
          <button
            type="button"
            className="account-back-button"
            onClick={() => navigate("/menu")}
          >
            Back to menu
          </button>
        </header>

        {loadError || roleError ? (
          <section className="account-message account-error" role="alert">
            <p>{loadError || roleError}</p>
            {loadError && user && role === "customer" && (
              <button
                type="button"
                className="account-retry-button"
                onClick={retryProfileLoad}
              >
                Try again
              </button>
            )}
          </section>
        ) : (
          <>
          <form className="account-form" onSubmit={handleSubmit} noValidate>
            <section className="account-card" aria-labelledby="personal-title">
              <div className="account-card-heading">
                <span className="account-section-mark" aria-hidden="true">
                  01
                </span>
                <div>
                  <h2 id="personal-title">Personal information</h2>
                  <p>Your name and the best number to reach you.</p>
                </div>
              </div>

              <div className="account-profile-summary">
                <ProfileAvatar
                  photoURL={authenticatedUser?.photoURL}
                  name={accountDisplayName}
                />
                <div className="account-profile-summary-details">
                  <strong>{accountDisplayName || "Customer"}</strong>
                  <span>{accountEmail}</span>
                </div>
              </div>

              <div className="account-field-grid">
                <label className="account-field" htmlFor="firstName">
                  <span>First name</span>
                  <input
                    autoComplete="given-name"
                    id="firstName"
                    maxLength={80}
                    name="firstName"
                    onChange={handleChange}
                    required
                    value={form.firstName}
                  />
                </label>
                <label className="account-field" htmlFor="lastName">
                  <span>Last name</span>
                  <input
                    autoComplete="family-name"
                    id="lastName"
                    maxLength={80}
                    name="lastName"
                    onChange={handleChange}
                    required
                    value={form.lastName}
                  />
                </label>
                <label className="account-field account-field-wide" htmlFor="phone">
                  <span>Contact number</span>
                  <input
                    autoComplete="tel"
                    id="phone"
                    inputMode="tel"
                    maxLength={24}
                    name="phone"
                    onChange={handleChange}
                    placeholder="e.g. 0917 123 4567"
                    required
                    type="tel"
                    value={form.phone}
                    disabled={phoneEditDisabled}
                    aria-describedby={
                      phoneEditDisabled ? "phone-cooldown-notice" : undefined
                    }
                  />
                  {phoneEditDisabled && (
                    <small
                      className="account-phone-cooldown"
                      id="phone-cooldown-notice"
                      role="status"
                    >
                      {cooldownDateLabel
                        ? `You can update your mobile number once every 30 days. Next edit available on ${cooldownDateLabel}.`
                        : "Your saved number cannot be changed until its 30-day edit period is initialized. Save your profile once to start the period."}
                    </small>
                  )}
                </label>
              </div>
            </section>

            <section className="account-card" aria-labelledby="address-title">
              <div className="account-card-heading">
                <span className="account-section-mark" aria-hidden="true">
                  02
                </span>
                <div>
                  <h2 id="address-title">Saved delivery address</h2>
                  <p>
                    Add a complete address to make future deliveries easier.
                    You can leave this section blank for now. You can save any
                    Isabela barangay here; delivery availability is checked
                    separately for each order.
                  </p>
                </div>
              </div>

              <div className="account-field-grid">
                <label className="account-field" htmlFor="barangay">
                  <span>Barangay</span>
                  <select
                    autoComplete="address-level3"
                    id="barangay"
                    name="barangay"
                    onChange={handleChange}
                    value={form.barangay}
                  >
                    <option value="">Select barangay</option>
                    {form.barangay
                      && !ISABELA_BARANGAYS.includes(form.barangay) && (
                      <option value={form.barangay}>
                        {form.barangay} (saved value; choose an official barangay)
                      </option>
                    )}
                    {ISABELA_BARANGAYS.map((barangay) => (
                      <option key={barangay} value={barangay}>
                        {barangay}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="account-field" htmlFor="streetPurok">
                  <span>Street / Purok</span>
                  <select
                    disabled={!streetOptions.length}
                    id="streetPurok"
                    name="streetPurok"
                    onChange={handleChange}
                    value={form.streetPurok}
                  >
                    <option value="">
                      {streetOptions.length
                        ? "Select street / purok"
                        : "Select a barangay first"}
                    </option>
                    {form.streetPurok
                      && !streetOptions.includes(form.streetPurok) && (
                      <option value={form.streetPurok}>
                        {form.streetPurok} (saved value; choose a listed option)
                      </option>
                    )}
                    {streetOptions.map((streetPurok) => (
                      <option key={streetPurok} value={streetPurok}>
                        {streetPurok}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="account-field account-field-wide"
                  htmlFor="houseNumberStreet"
                >
                  <span>House number / Purok details</span>
                  <input
                    autoComplete="address-line1"
                    id="houseNumberStreet"
                    maxLength={150}
                    name="houseNumberStreet"
                    onChange={handleChange}
                    placeholder="House number, block / lot, or custom Purok"
                    value={form.houseNumberStreet}
                  />
                </label>
                <label className="account-field" htmlFor="municipalityCity">
                  <span>Municipality / city</span>
                  <input
                    autoComplete="address-level2"
                    id="municipalityCity"
                    name="municipalityCity"
                    readOnly
                    value={form.municipalityCity}
                  />
                </label>
                <label className="account-field account-field-wide" htmlFor="province">
                  <span>Province</span>
                  <input
                    autoComplete="address-level1"
                    id="province"
                    name="province"
                    readOnly
                    value={form.province}
                  />
                </label>
                <label
                  className="account-field account-field-wide"
                  htmlFor="deliveryInstructions"
                >
                  <span>Delivery instructions <small>Optional</small></span>
                  <textarea
                    id="deliveryInstructions"
                    maxLength={300}
                    name="deliveryInstructions"
                    onChange={handleChange}
                    placeholder="Landmarks, gate details, or other helpful notes"
                    rows={3}
                    value={form.deliveryInstructions}
                  />
                </label>
                <div className="account-field account-field-wide">
                  <span>Delivery pin <small>Optional</small></span>
                  <IsabelaDeliveryMap
                    location={form.deliveryLocation}
                    onChange={(deliveryLocation) => {
                      setForm((currentForm) => ({
                        ...currentForm,
                        deliveryLocation,
                      }));
                      setValidationError("");
                      setFeedback("");
                    }}
                  />
                </div>
              </div>
            </section>

            {(validationError || feedback) && (
              <p
                className={`account-message ${
                  validationError || feedback.startsWith("Unable")
                    ? "account-error"
                    : "account-success"
                }`}
                role={validationError || feedback.startsWith("Unable") ? "alert" : "status"}
              >
                {validationError || feedback}
              </p>
            )}

            <div className="account-form-footer">
              <p>Your information is saved securely to your customer profile.</p>
              <button
                className="account-save-button"
                disabled={saving}
                type="submit"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
          {credentialMessage && (
            <p
              className={`account-message ${
                credentialMessageType === "error"
                  ? "account-error"
                  : "account-success"
              }`}
              role={credentialMessageType === "error" ? "alert" : "status"}
            >
              {credentialMessage}
            </p>
          )}
          {showAddPasswordLogin && (
            <section
              className="account-card account-credential-card"
              aria-labelledby="password-login-title"
            >
              <div className="account-card-heading">
                <span className="account-section-mark" aria-hidden="true">
                  03
                </span>
                <div>
                  <h2 id="password-login-title">
                    Add Email &amp; Password Login
                  </h2>
                  <p>
                    Add another sign-in method to your existing Google account.
                    Your account and profile will not be replaced.
                  </p>
                </div>
              </div>

              <form
                className="account-credential-form"
                onSubmit={handleAddPasswordLogin}
              >
                <label className="account-field" htmlFor="account-login-email">
                  <span>Email address</span>
                  <input
                    autoComplete="email"
                    id="account-login-email"
                    readOnly
                    type="email"
                    value={user?.email || ""}
                  />
                </label>

                <div className="account-field-grid">
                  <label className="account-field" htmlFor="newPassword">
                    <span>Password</span>
                    <input
                      autoComplete="new-password"
                      id="newPassword"
                      minLength={6}
                      name="newPassword"
                      required
                      type="password"
                    />
                  </label>
                  <label className="account-field" htmlFor="confirmNewPassword">
                    <span>Confirm password</span>
                    <input
                      autoComplete="new-password"
                      id="confirmNewPassword"
                      minLength={6}
                      name="confirmNewPassword"
                      required
                      type="password"
                    />
                  </label>
                </div>

                <button
                  className="account-save-button"
                  disabled={linkingLogin}
                  type="submit"
                >
                  {linkingLogin ? "Adding login..." : "Add password login"}
                </button>
              </form>
            </section>
          )}
          </>
        )}
      </section>
    </main>
  );
}

export default MyAccount;
