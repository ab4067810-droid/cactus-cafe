import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import "../styles/Login.css";
import { login, signInWithGoogle } from "../services/authService";
import { auth, db } from "../services/firebase";
import { getEffectiveRole } from "../utils/userRole";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const getFriendlyErrorMessage = (errorCode) => {
    switch (errorCode) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "Incorrect email or password. Please try again.";

      case "auth/invalid-email":
        return "Please enter a valid email address.";

      case "auth/user-not-found":
        return "No account was found with this email address.";

      case "auth/too-many-requests":
        return "Too many login attempts. Please try again later.";

      case "auth/user-disabled":
        return "This account has been disabled. Please contact Cactus Cafe.";

      case "auth/network-request-failed":
        return "Network error. Please check your internet connection.";

      case "auth/unsupported-persistence-type":
      case "auth/invalid-persistence-type":
      case "auth/operation-not-supported-in-this-environment":
        return "This browser cannot save the selected login session. Please try another browser or update your browser settings.";

      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "Google sign-in was cancelled. Try again when you are ready.";

      case "auth/popup-blocked":
        return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";

      case "auth/account-exists-with-different-credential":
        return "An account already uses this email with another sign-in method. Sign in with that method instead; accounts are not automatically linked.";

      case "auth/credential-already-in-use":
        return "This Google account is already associated with another account. Sign in using the existing account; no accounts were linked.";

      case "profile/create-failed":
        return "Google sign-in succeeded, but your profile could not be saved. Try Google sign-in again to retry.";

      default:
        return "Login failed. Please try again.";
    }
  };

  const showMessage = (text, type = "error") => {
    setMessage(text);
    setMessageType(type);
  };

  const handleLogin = async (event) => {
    event.preventDefault();

    if (isLoading) return;

    setMessage("");
    setMessageType("");

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      showMessage("Please enter both your email address and password.");
      return;
    }

    try {
      setIsLoading(true);

      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence
      );
      await login(cleanEmail, password);

      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error("Unable to retrieve the authenticated user.");
      }

      const userRef = doc(db, "users", currentUser.uid);
      const userSnapshot = await getDoc(userRef);

      if (!userSnapshot.exists()) {
        showMessage(
          "Your account was authenticated, but your user profile could not be found."
        );
        return;
      }

      const userData = userSnapshot.data();
      const userRole = getEffectiveRole(userData);

      if (userRole === "admin") {
        navigate("/admin/monthly-records", { replace: true });
        return;
      }

      if (userRole === "staff") {
        navigate("/admin/orders", { replace: true });
        return;
      }

      if (userData.role === "voter") {
        navigate("/voter", { replace: true });
        return;
      }

      if (userRole === "customer") {
        navigate("/menu", { replace: true });
        return;
      }

      showMessage(
        "Your account does not have a valid user role. Please contact the administrator."
      );
    } catch (error) {
      console.error("Login error:", error);
      showMessage(getFriendlyErrorMessage(error?.code));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isLoading) return;

    setMessage("");
    setMessageType("");

    try {
      setIsLoading(true);
      setIsGoogleLoading(true);

      await setPersistence(
        auth,
        rememberMe ? browserLocalPersistence : browserSessionPersistence
      );
      const { profile } = await signInWithGoogle();

      const userRole = getEffectiveRole(profile);

      if (userRole === "admin") {
        navigate("/admin/monthly-records", { replace: true });
        return;
      }

      if (userRole === "staff") {
        navigate("/admin/orders", { replace: true });
        return;
      }

      if (userRole === "customer") {
        navigate("/menu", { replace: true });
        return;
      }

      showMessage(
        "Your account does not have a valid customer or admin role. Please contact the administrator."
      );
    } catch (error) {
      console.error("Google login error:", error);
      showMessage(getFriendlyErrorMessage(error?.code));
    } finally {
      setIsLoading(false);
      setIsGoogleLoading(false);
    }
  };

  return (
    <main className="login-page">
      <Link
        to="/"
        className="login-brand"
        aria-label="Cactus Cafe home"
      >
        <span className="login-brand-mark">C</span>
        <span>Cactus Cafe</span>
      </Link>

      <section
        className="login-card"
        aria-labelledby="login-title"
      >
        <Link
          to="/"
          className="login-close"
          aria-label="Return to home"
        >
          ×
        </Link>

        <header className="login-header">
          <p className="login-eyebrow">WELCOME BACK</p>

          <h1 id="login-title" className="login-title">
            Log in
          </h1>

          <p className="login-subtitle">
            Enter your account details to continue.
          </p>
        </header>

        {message && (
          <div
            className={
              messageType === "success"
                ? "success-message"
                : "error-message"
            }
            role="alert"
            aria-live="polite"
          >
            <span
              className="message-symbol"
              aria-hidden="true"
            >
              {messageType === "success" ? "✓" : "!"}
            </span>

            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email address
            </label>

            <input
              id="email"
              name="email"
              type="email"
              className="form-input"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck="false"
              disabled={isLoading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">
              Password
            </label>

            <div className="password-wrapper">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className="form-input password-input"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={isLoading}
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() =>
                  setShowPassword((current) => !current)
                }
                disabled={isLoading}
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div className="login-options">
            <label className="remember-option">
              <input
                type="checkbox"
                name="remember"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                disabled={isLoading}
              />
              <span>Remember me</span>
            </label>

            <a
              href="mailto:support@cactuscafe.com"
              className="help-link"
            >
              Need help?
            </a>
          </div>

          <button
            type="submit"
            className="login-button"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading && (
              <span
                className="button-loader"
                aria-hidden="true"
              />
            )}

            {isGoogleLoading
              ? "Signing in with Google..."
              : isLoading
                ? "Logging in..."
                : "Log in"}
          </button>
        </form>

        <button
          type="button"
          className="login-button"
          style={{
            marginTop: 12,
            border: "1px solid #28734a",
            background: "#fff",
            color: "#28734a",
            boxShadow: "none",
          }}
          onClick={handleGoogleLogin}
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

        <footer className="login-footer">
          <p>
            Review our{" "}
            <Link className="login-legal-link" to="/terms">
              Terms of Use
            </Link>{" "}
            and{" "}
            <Link className="login-legal-link" to="/privacy">
              Privacy Notice
            </Link>
            .
          </p>
          <p className="login-register-prompt">
            New to Cactus Café? <Link to="/register">Create an account</Link>
          </p>
        </footer>
      </section>
    </main>
  );
}

export default Login;