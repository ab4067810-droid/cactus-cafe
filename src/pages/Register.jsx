import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { useAuth } from "../context/Authcontext";
import { auth } from "../services/firebase";

import {
  registerCustomer,
  registerWithGoogle,
  retryCustomerProfile,
} from "../services/authService";
import "../styles/Register.css";

const getRegistrationErrorMessage = (error) => {
  switch (error?.code) {
    case "auth/email-already-in-use":
      return "An account already exists with this email. Please log in instead.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/weak-password":
      return "Choose a stronger password with at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email and password registration is currently unavailable.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was cancelled. Try again when you are ready.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
    case "auth/account-exists-with-different-credential":
      return "An account already uses this email with another sign-in method. Sign in with that method instead; accounts are not automatically linked.";
    case "auth/credential-already-in-use":
      return "This Google account is already associated with another account. Sign in using the existing account; no accounts were linked.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "profile/already-exists":
      return "A profile already exists for this account. Please log in or contact support.";
    case "profile/create-failed":
      return "Your account was authenticated, but its profile could not be saved. Retry profile setup or sign in again to try again.";
    case "profile/recovery-session-missing":
      return "Your account session has expired. Please log in and contact support to finish setting up your profile.";
    case "profile/consent-required":
      return "Please accept both agreements before creating your account.";
    default:
      return "We could not complete registration. Please try again.";
  }
};

function Register() {
  const navigate = useNavigate();
  const { user, role, roleError } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [agreementErrors, setAgreementErrors] = useState({
    terms: false,
    privacy: false,
  });
  const [pendingConsent, setPendingConsent] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [canRetryProfile, setCanRetryProfile] = useState(false);
  const [canRetryGoogleProfile, setCanRetryGoogleProfile] = useState(false);
  const [showRegistrationSuccess, setShowRegistrationSuccess] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const showProfileRetry =
    canRetryProfile || Boolean(user && !role && roleError);
  const googleDisplayName = auth.currentUser?.providerData.some(
    (provider) => provider.providerId === "google.com"
  )
    ? auth.currentUser.displayName?.trim() || ""
    : "";

  const validateAgreements = () => {
    const errors = {
      terms: !termsAccepted,
      privacy: !privacyAccepted,
    };

    setAgreementErrors(errors);
    if (errors.terms || errors.privacy) return null;

    const consent = { termsAccepted: true, privacyAccepted: true };
    setPendingConsent(consent);
    return consent;
  };

  const handleAgreementChange = (agreement, setAccepted) => (event) => {
    setAccepted(event.target.checked);
    setAgreementErrors((current) => ({ ...current, [agreement]: false }));
  };

  const continueWithProfile = (profile) => {
    const destinations = {
      customer: "/menu",
      admin: "/admin/menu",
      voter: "/voter",
    };
    const destination = destinations[profile?.role];

    if (!destination) {
      setCanRetryProfile(false);
      setErrorMessage(
        "Your existing account profile has an unrecognized role and was not changed. Please contact support."
      );
      return;
    }

    navigate(destination, { replace: true });
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    if (isLoading) return;

    setErrorMessage("");
    setCanRetryProfile(false);

    const consent = validateAgreements();
    if (!consent) return;

    const nameFields = {
      firstName: firstName.trim(),
      middleInitial: middleInitial.trim(),
      lastName: lastName.trim(),
    };
    const cleanEmail = email.trim().toLowerCase();

    if (
      !nameFields.firstName
      || !nameFields.lastName
      || !cleanEmail
      || !password
      || !confirmPassword
    ) {
      setErrorMessage(
        "Please enter your first and last name and complete the remaining required fields."
      );
      return;
    }

    if (
      nameFields.firstName.length > 80
      || nameFields.lastName.length > 80
      || nameFields.middleInitial.length > 2
    ) {
      setErrorMessage(
        "First and last names must be 80 characters or fewer. If provided, the middle initial must be 1–2 characters."
      );
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Choose a password with at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Your passwords do not match.");
      return;
    }

    try {
      setIsLoading(true);
      setCanRetryGoogleProfile(false);
      const { profile } = await registerCustomer(
        nameFields,
        cleanEmail,
        password,
        consent
      );
      if (profile?.role === "customer") {
        setShowRegistrationSuccess(true);
      } else {
        continueWithProfile(profile);
      }
    } catch (error) {
      console.error("Registration error:", error);
      setErrorMessage(getRegistrationErrorMessage(error));
      setCanRetryProfile(error?.code === "profile/create-failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginNow = async () => {
    if (isSigningOut) return;

    try {
      setIsSigningOut(true);
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Sign-out after registration failed:", error);
      setErrorMessage(
        "Your account was created, but we couldn't sign you out. Please try again."
      );
      setIsSigningOut(false);
    }
  };

  const handleMaybeLater = () => {
    navigate("/login", { replace: true });
  };

  const handleGoogleRegister = async () => {
    if (isLoading) return;

    const consent = validateAgreements();
    if (!consent) return;

    setErrorMessage("");
    setCanRetryProfile(false);
    setCanRetryGoogleProfile(false);

    try {
      setIsLoading(true);
      setIsGoogleLoading(true);
      const { profile } = await registerWithGoogle(consent);

      if (profile?.role !== "admin" && profile?.role !== "customer") {
        setErrorMessage(
          "Your account does not have a valid customer or admin role. Please contact the administrator."
        );
        return;
      }

      continueWithProfile(profile);
    } catch (error) {
      console.error("Google registration error:", error);
      setErrorMessage(getRegistrationErrorMessage(error));
      setCanRetryGoogleProfile(error?.code === "profile/create-failed");
    } finally {
      setIsLoading(false);
      setIsGoogleLoading(false);
    }
  };

  const handleProfileRetry = async () => {
    if (isLoading) return;

    setErrorMessage("");
    const nameFields = {
      firstName: firstName.trim(),
      middleInitial: middleInitial.trim(),
      lastName: lastName.trim(),
    };
    const cleanName = [
      nameFields.firstName,
      nameFields.middleInitial,
      nameFields.lastName,
    ]
      .filter(Boolean)
      .join(" ") || googleDisplayName;

    if (!cleanName) {
      setErrorMessage(
        "Enter your first and last name to finish setting up your profile."
      );
      return;
    }

    if (
      !canRetryGoogleProfile
      && (!nameFields.firstName || !nameFields.lastName)
    ) {
      setErrorMessage(
        "Enter your first and last name to finish setting up your profile."
      );
      return;
    }

    try {
      setIsLoading(true);
      setIsGoogleLoading(canRetryGoogleProfile);
      const { profile } = canRetryGoogleProfile
        ? await registerWithGoogle(pendingConsent)
        : await retryCustomerProfile(cleanName, pendingConsent, nameFields);

      if (
        canRetryGoogleProfile
        && profile?.role !== "admin"
        && profile?.role !== "customer"
      ) {
        setErrorMessage(
          "Your account does not have a valid customer or admin role. Please contact the administrator."
        );
        return;
      }

      setCanRetryProfile(false);
      setCanRetryGoogleProfile(false);
      continueWithProfile(profile);
    } catch (error) {
      console.error("Customer profile recovery error:", error);
      setErrorMessage(getRegistrationErrorMessage(error));
      setCanRetryProfile(error?.code === "profile/create-failed");
      setCanRetryGoogleProfile(
        canRetryGoogleProfile || error?.code === "profile/create-failed"
      );
    } finally {
      setIsLoading(false);
      setIsGoogleLoading(false);
    }
  };

  return (
    <main className="register-page">
      <Link
        to="/"
        className="register-brand"
        aria-label="Cactus Cafe home"
      >
        <span className="register-brand-mark">C</span>
        <span>Cactus Cafe</span>
      </Link>

      <section className="register-card" aria-labelledby="register-title">
        <header className="register-header">
          <p className="register-eyebrow">WELCOME TO CACTUS CAFÉ</p>
          <h1 id="register-title">Create your account</h1>
          <p>Join us for your next café favorite.</p>
        </header>

        {(errorMessage || showProfileRetry) && (
          <div className="register-error" role="alert" aria-live="polite">
            {errorMessage && (
              <div className="register-error-copy">
                <span className="register-error-symbol" aria-hidden="true">
                  !
                </span>
                <span>{errorMessage}</span>
              </div>
            )}
            {showProfileRetry && (
              <>
                {!errorMessage && (
                  <div className="register-error-copy" role="status">
                    <span className="register-error-symbol" aria-hidden="true">
                      !
                    </span>
                    <span>
                      Your customer profile could not be verified. Retry profile
                      setup to continue.
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="register-retry"
                  onClick={handleProfileRetry}
                  disabled={isLoading}
                >
                  {isLoading
                    ? "Retrying..."
                    : canRetryGoogleProfile
                      ? "Retry Google profile setup"
                      : "Retry profile setup"}
                </button>
              </>
            )}
          </div>
        )}

        <form className="register-form" onSubmit={handleRegister}>
          <div className="register-name-stack">
            <div className="register-form-group">
              <label htmlFor="register-first-name">First Name</label>
              <input
                id="register-first-name"
                name="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={80}
                placeholder="e.g., Juan"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <div className="register-form-group">
              <label htmlFor="register-middle-initial">Middle Initial</label>
              <input
                id="register-middle-initial"
                name="middleInitial"
                type="text"
                autoComplete="additional-name"
                maxLength={2}
                placeholder="M.I."
                value={middleInitial}
                onChange={(event) => setMiddleInitial(event.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="register-form-group">
              <label htmlFor="register-last-name">Last Name</label>
              <input
                id="register-last-name"
                name="lastName"
                type="text"
                autoComplete="family-name"
                maxLength={80}
                placeholder="e.g., Cruz"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                disabled={isLoading}
                required
              />
            </div>
          </div>

          <div className="register-form-group">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="register-form-group">
            <label htmlFor="register-password">Password</label>
            <input
              id="register-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              placeholder="At least 6 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="register-form-group">
            <label htmlFor="register-confirm-password">
              Confirm Password
            </label>
            <input
              id="register-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={6}
              placeholder="Enter your password again"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div className="register-agreements">
            <p className="register-agreements-heading">
              Please review and accept both policies
            </p>
            <aside className="register-privacy-notice" role="note">
              <strong>Data Privacy Notice:</strong> We collect your full name,
              email address, phone number, delivery address, and order or
              reservation records to create and manage your account, process
              orders and reservations, coordinate delivery, and provide
              customer support. Your personal data is processed in accordance
              with the Philippine Data Privacy Act of 2012 (RA 10173). You may
              access or correct your data, or request its deletion, subject to
              applicable legal requirements. See our{" "}
              <Link to="/privacy">Privacy Notice</Link> for details.
            </aside>

            <div className="register-agreement">
              <input
                id="register-terms"
                name="termsAccepted"
                type="checkbox"
                checked={termsAccepted}
                onChange={handleAgreementChange("terms", setTermsAccepted)}
                onInvalid={(event) => {
                  event.preventDefault();
                  setAgreementErrors((current) => ({
                    ...current,
                    terms: true,
                  }));
                }}
                aria-invalid={agreementErrors.terms}
                aria-describedby={
                  agreementErrors.terms ? "register-terms-error" : undefined
                }
                disabled={isLoading}
                required
              />
              <div className="register-agreement-copy">
                <label htmlFor="register-terms">
                  I agree to the <Link to="/terms">Terms and Conditions</Link>.
                </label>
                {agreementErrors.terms && (
                  <p
                    className="register-agreement-error"
                    id="register-terms-error"
                    role="alert"
                  >
                    You must agree to the Terms and Conditions.
                  </p>
                )}
              </div>
            </div>

            <div className="register-agreement">
              <input
                id="register-privacy"
                name="privacyAccepted"
                type="checkbox"
                checked={privacyAccepted}
                onChange={handleAgreementChange("privacy", setPrivacyAccepted)}
                onInvalid={(event) => {
                  event.preventDefault();
                  setAgreementErrors((current) => ({
                    ...current,
                    privacy: true,
                  }));
                }}
                aria-invalid={agreementErrors.privacy}
                aria-describedby={
                  agreementErrors.privacy
                    ? "register-privacy-error"
                    : undefined
                }
                disabled={isLoading}
                required
              />
              <div className="register-agreement-copy">
                <label htmlFor="register-privacy">
                  I acknowledge and agree to the{" "}
                  <Link to="/privacy">Privacy Policy</Link>.
                </label>
                {agreementErrors.privacy && (
                  <p
                    className="register-agreement-error"
                    id="register-privacy-error"
                    role="alert"
                  >
                    You must acknowledge and agree to the Privacy Policy.
                  </p>
                )}
              </div>
            </div>
          </div>

          <button
            className="register-submit"
            type="submit"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isGoogleLoading
              ? "Signing in with Google..."
              : isLoading
                ? "Creating account..."
                : "Create Account"}
          </button>
        </form>

        <div className="register-divider" aria-hidden="true">
          <span>or continue with</span>
        </div>

        <button
          type="button"
          className="register-google-button"
          onClick={handleGoogleRegister}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="18"
            height="18"
            viewBox="0 0 48 48"
          >
            <path
              fill="#4285F4"
              d="M43.6 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11c-.5 2.7-2 5-4.3 6.5l7 5.4c4.1-3.8 6.4-9.4 6.4-15.9z"
            />
            <path
              fill="#34A853"
              d="M24 44c5.8 0 10.7-1.9 14.2-5.1l-7-5.4c-1.9 1.3-4.3 2-7.2 2-5.5 0-10.2-3.7-11.9-8.7l-7.2 5.6C8.4 39.3 15.6 44 24 44z"
            />
            <path
              fill="#FBBC05"
              d="M12.1 26.8c-.4-1.3-.6-2.7-.6-4.2s.2-2.9.6-4.2l-7.2-5.6C3.4 16.1 2.5 19.3 2.5 22.6s.9 6.5 2.4 9.8l7.2-5.6z"
            />
            <path
              fill="#EA4335"
              d="M24 9.5c3.1 0 5.9 1.1 8.1 3.2l6.1-6.1C34.5 3.1 29.8 1 24 1 13.4 1 4.4 6.6.1 15.7l7.2 5.6C8.7 14.3 15.2 9.5 24 9.5z"
            />
          </svg>
          {isGoogleLoading ? "Connecting to Google..." : "Continue with Google"}
        </button>

        <p className="register-login-prompt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
        <p className="register-home-link">
          <Link to="/">← Back to Home</Link>
        </p>
      </section>

      {showRegistrationSuccess && (
        <div className="register-success-backdrop">
          <section
            className="register-success-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-success-title"
            aria-describedby="register-success-message"
          >
            <div className="register-success-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" focusable="false">
                <path d="M24 4a20 20 0 1 0 0 40 20 20 0 0 0 0-40Zm-2.2 29.1-9-9 3.4-3.4 5.6 5.6 12-12 3.4 3.4-15.4 15.4Z" />
              </svg>
            </div>
            <h2 id="register-success-title">
              Account Created Successfully!
            </h2>
            <p id="register-success-message">
              Welcome to Cactus Café! Your account has been successfully
              created.
            </p>
            <p className="register-success-question">
              Would you like to log in now?
            </p>
            {errorMessage && (
              <div className="register-error" role="alert" aria-live="polite">
                <div className="register-error-copy">
                  <span className="register-error-symbol" aria-hidden="true">
                    !
                  </span>
                  <span>{errorMessage}</span>
                </div>
              </div>
            )}
            <div className="register-success-actions">
              <button
                type="button"
                className="register-success-primary"
                onClick={handleLoginNow}
                disabled={isSigningOut}
              >
                {isSigningOut ? "Signing out..." : "Log In Now"}
              </button>
              <button
                type="button"
                className="register-success-secondary"
                onClick={handleMaybeLater}
                disabled={isSigningOut}
              >
                Maybe Later
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default Register;
