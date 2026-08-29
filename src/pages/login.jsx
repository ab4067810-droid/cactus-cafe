import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";

import "../styles/Login.css";
import { login } from "../services/authService";
import { auth, db } from "../services/firebase";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  // =========================================
  // FIREBASE ERROR HANDLING
  // =========================================
  const getFriendlyErrorMessage = (errorCode) => {
    switch (errorCode) {
      case "auth/invalid-credential":
        return "Incorrect email or password. Please try again.";

      case "auth/invalid-email":
        return "Please enter a valid email address.";

      case "auth/user-not-found":
        return "No account was found with this email address.";

      case "auth/wrong-password":
        return "Incorrect email or password. Please try again.";

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

  // =========================================
  // DISPLAY MESSAGE
  // =========================================
  const showMessage = (text, type = "error") => {
    setMessage(text);
    setMessageType(type);
  };

  // =========================================
  // LOGIN
  // =========================================
  const handleLogin = async (event) => {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    setMessage("");
    setMessageType("");

    const cleanEmail = email.trim().toLowerCase();

    // Validate fields
    if (!cleanEmail || !password) {
      showMessage(
        "Please enter both your email address and password."
      );
      return;
    }

    try {
      setIsLoading(true);

      // -----------------------------------------
      // 1. FIREBASE AUTHENTICATION
      // -----------------------------------------
      await login(cleanEmail, password);

      // -----------------------------------------
      // 2. GET CURRENT AUTHENTICATED USER
      // -----------------------------------------
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error(
          "Unable to retrieve the authenticated user."
        );
      }

      // -----------------------------------------
      // 3. GET USER PROFILE FROM FIRESTORE
      // -----------------------------------------
      const userRef = doc(
        db,
        "users",
        currentUser.uid
      );

      const userSnapshot = await getDoc(userRef);

      // -----------------------------------------
      // 4. CHECK IF USER PROFILE EXISTS
      // -----------------------------------------
      if (!userSnapshot.exists()) {
        showMessage(
          "Your account was authenticated, but your user profile could not be found."
        );
        return;
      }

      // -----------------------------------------
      // 5. GET USER DATA
      // -----------------------------------------
      const userData = userSnapshot.data();

      // -----------------------------------------
      // 6. CHECK USER ROLE
      // -----------------------------------------
      const userRole = userData.role;

      if (userRole === "admin") {
        // Admin account
        navigate("/admin", { replace: true });
        return;
      }

      if (userRole === "voter") {
        // Keep this only if your current project
        // still uses the voting system.
        navigate("/voter", { replace: true });
        return;
      }

      // -----------------------------------------
      // 7. CUSTOMER ACCOUNT
      // -----------------------------------------
      if (userRole === "customer") {
        navigate("/customer", { replace: true });
        return;
      }

      // -----------------------------------------
      // 8. UNKNOWN ROLE
      // -----------------------------------------
      showMessage(
        "Your account does not have a valid user role. Please contact the administrator."
      );
    } catch (error) {
      console.error("Login error:", error);

      showMessage(
        getFriendlyErrorMessage(error?.code)
      );
    } finally {
      setIsLoading(false);
    }
  };

  // =========================================
  // COMPONENT
  // =========================================
  return (
    <main className="login-page">
      <section className="login-layout">

        {/* =====================================
            INTRODUCTION
        ===================================== */}
        <div className="login-intro">
          <p className="login-eyebrow">
            CACTUS CAFE
          </p>

          <h1>
            Good food is closer than you think.
          </h1>

          <p>
            Sign in to view your orders, manage your
            reservations, save your favorites, and enjoy
            an easier way to order from Cactus Cafe.
          </p>
        </div>

        {/* =====================================
            LOGIN FORM
        ===================================== */}
        <div className="login-container">

          <p className="login-eyebrow">
            WELCOME BACK
          </p>

          <h2 className="login-title">
            Sign in to your account
          </h2>

          <p className="login-subtitle">
            Enter your account details to continue.
          </p>

          {/* =====================================
              MESSAGE
          ===================================== */}
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
              {message}
            </div>
          )}

          {/* =====================================
              FORM
          ===================================== */}
          <form
            onSubmit={handleLogin}
            className="login-form"
          >

            {/* EMAIL */}
            <div className="form-group">
              <label
                htmlFor="email"
                className="form-label"
              >
                Email address
              </label>

              <input
                id="email"
                name="email"
                type="email"
                className="form-input"
                placeholder="you@example.com"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                autoComplete="email"
                autoCapitalize="none"
                spellCheck="false"
                disabled={isLoading}
                required
              />
            </div>

            {/* PASSWORD */}
            <div className="form-group">
              <label
                htmlFor="password"
                className="form-label"
              >
                Password
              </label>

              <input
                id="password"
                name="password"
                type="password"
                className="form-input"
                placeholder="Enter your password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                autoComplete="current-password"
                disabled={isLoading}
                required
              />
            </div>

            {/* LOGIN BUTTON */}
            <button
              type="submit"
              className="login-button"
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading
                ? "Signing in..."
                : "Sign in"}
            </button>

          </form>

        </div>

      </section>
    </main>
  );
}

export default Login;