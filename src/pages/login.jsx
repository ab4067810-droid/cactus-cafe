import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";

import "../styles/Login.css";
import { login } from "../services/authService";
import { auth, db } from "../services/firebase";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
      const userRole = userData.role;

      if (userRole === "admin") {
        navigate("/admin", { replace: true });
        return;
      }

      if (userRole === "voter") {
        navigate("/voter", { replace: true });
        return;
      }

      if (userRole === "customer") {
        navigate("/customer", { replace: true });
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
              <input type="checkbox" name="remember" />
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

            {isLoading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <footer className="login-footer">
          <p>
            By logging in, you agree to the Cactus Cafe terms
            and privacy policy.
          </p>
        </footer>
      </section>
    </main>
  );
}

export default Login;