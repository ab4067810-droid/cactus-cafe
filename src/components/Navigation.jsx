import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { logout } from "../services/authService";
import CartPanel from "./CartPanel";
import "../styles/Navigation.css";

const guestLinks = [
  { label: "Home", to: "/" },
  { label: "Menu", to: "/menu" },
  { label: "About", to: "/about" },
];

const customerLinks = [
  { label: "Menu", to: "/menu" },
  { label: "Reservations", to: "/reservations" },
];

const adminLinks = [
  { label: "Admin Dashboard", to: "/admin" },
  { label: "Menu Management", to: "/admin/menu" },
  { label: "Orders", to: "/admin/orders" },
  { label: "Reservations", to: "/admin/reservations" },
  { label: "Reviews", to: "/admin/reviews" },
];

function Navigation() {
  const [openMenuPath, setOpenMenuPath] = useState(null);
  const [openAccountMenuPath, setOpenAccountMenuPath] = useState(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const accountMenuRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const cartButtonRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, role, loading, roleError } = useAuth();
  const { cart, totalItems, cartChangeKey } = useCart();
  const [previousPath, setPreviousPath] = useState(pathname);

  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setOpenMenuPath(null);
    setOpenAccountMenuPath(null);
  }

  const isMenuOpen = openMenuPath === pathname;
  const isAccountMenuOpen = openAccountMenuPath === pathname;

  const closeCart = useCallback(() => {
    setIsCartOpen(false);
    cartButtonRef.current?.focus();
  }, []);

  const proceedToCheckout = () => {
    setIsCartOpen(false);
    navigate("/checkout", { state: { cart } });
  };

  useEffect(() => {
    if (!isAccountMenuOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) {
        setOpenAccountMenuPath(null);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setOpenAccountMenuPath(null);
        accountTriggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAccountMenuOpen]);

  const navLinkClass = ({ isActive }) =>
    isActive ? "navbar-link active" : "navbar-link";
  const accountLinkClass = ({ isActive }) =>
    `navbar-account-link${isActive ? " active" : ""}`;

  const links = !user
    ? guestLinks
    : role === "customer"
      ? customerLinks
      : role === "admin"
        ? adminLinks
        : [];

  const handleLogout = async () => {
    if (isLoggingOut) return;

    setLogoutError("");
    setIsLoggingOut(true);

    try {
      await logout();
      setOpenMenuPath(null);
      setOpenAccountMenuPath(null);
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Logout error:", error);
      setLogoutError("Unable to log out. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <nav className="navbar" aria-label="Main navigation">
        <div className="navbar-container">
          <NavLink
            to="/"
            className="navbar-logo"
            aria-label="Cactus Cafe home"
            onClick={() => {
              setOpenMenuPath(null);
              setOpenAccountMenuPath(null);
            }}
          >
            <span className="navbar-monogram" aria-hidden="true">
              C
            </span>
            <span>Cactus Cafe</span>
          </NavLink>

          <div
            className={`navbar-actions${isMenuOpen ? " is-open" : ""}`}
            id="navbar-menu"
          >
            <ul className="navbar-links">
              {loading ? (
                <li className="navbar-loading" role="status">
                  Checking account...
                </li>
              ) : (
                links.map((link) => (
                  <li key={link.to}>
                    <NavLink
                      to={link.to}
                      end={link.to === "/"}
                      className={navLinkClass}
                      onClick={() => setOpenMenuPath(null)}
                    >
                      {link.label}
                    </NavLink>
                  </li>
                ))
              )}
            </ul>

            {!loading && !user && (
              <NavLink
                to="/login"
                className="login-btn"
                onClick={() => setOpenMenuPath(null)}
              >
                Login
              </NavLink>
            )}

            {!loading && user && role === "admin" && (
              <button
                type="button"
                className="login-btn navbar-logout"
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? "Logging out..." : "Logout"}
              </button>
            )}

            {(roleError || (logoutError && role !== "customer")) && (
              <p className="navbar-error" role="alert">
                {logoutError || roleError}
              </p>
            )}
          </div>

          <div className="navbar-tools">
            {!loading && role !== "admin" && (
              <button
                ref={cartButtonRef}
                type="button"
                className="navbar-cart-link"
                aria-expanded={isCartOpen}
                aria-controls="cart-summary-panel"
                aria-label={`My cart, ${totalItems} ${
                  totalItems === 1 ? "item" : "items"
                }`}
                onClick={() => setIsCartOpen(true)}
              >
                <span
                  className="navbar-cart-announcement"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  Cart has {totalItems} {totalItems === 1 ? "item" : "items"}
                </span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.5L21 8H6" />
                  <circle cx="10" cy="20" r="1" />
                  <circle cx="18" cy="20" r="1" />
                </svg>
                {totalItems > 0 && (
                  <span
                    key={cartChangeKey}
                    className="navbar-cart-count"
                    aria-hidden="true"
                  >
                    {totalItems}
                  </span>
                )}
              </button>
            )}

            {!loading && user && role === "customer" && (
              <div className="navbar-account" ref={accountMenuRef}>
                <button
                  ref={accountTriggerRef}
                  type="button"
                  className="navbar-account-trigger"
                  aria-label="Account menu"
                  aria-expanded={isAccountMenuOpen}
                  aria-controls="navbar-account-menu"
                  onClick={() =>
                    setOpenAccountMenuPath((openPath) =>
                      openPath === pathname ? null : pathname,
                    )
                  }
                >
                  <svg
                    aria-hidden="true"
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
                </button>
                {isAccountMenuOpen && (
                  <div
                    className="navbar-account-menu"
                    id="navbar-account-menu"
                    role="group"
                    aria-label="Account"
                  >
                    <p className="navbar-account-heading">Your account</p>
                    <NavLink
                      to="/my-orders"
                      className={accountLinkClass}
                      onClick={() => setOpenAccountMenuPath(null)}
                    >
                      <svg
                        className="navbar-account-icon"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m21 8-2-5H5L3 8" />
                        <path d="M3 8h18v12H3z" />
                        <path d="M10 12h4" />
                      </svg>
                      My Orders
                    </NavLink>
                    <NavLink
                      to="/my-reservations"
                      className={accountLinkClass}
                      onClick={() => setOpenAccountMenuPath(null)}
                    >
                      <svg
                        className="navbar-account-icon"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="5" width="18" height="16" rx="2" />
                        <path d="M16 3v4M8 3v4M3 10h18" />
                      </svg>
                      My Reservations
                    </NavLink>
                    <NavLink
                      to="/my-reviews"
                      className={accountLinkClass}
                      onClick={() => setOpenAccountMenuPath(null)}
                    >
                      <svg
                        className="navbar-account-icon"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
                      </svg>
                      My Reviews
                    </NavLink>
                    <div className="navbar-account-divider" />
                    <button
                      type="button"
                      className="navbar-account-logout"
                      onClick={handleLogout}
                      disabled={isLoggingOut}
                    >
                      <svg
                        className="navbar-account-icon"
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M10 17l5-5-5-5M15 12H3" />
                        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
                      </svg>
                      {isLoggingOut ? "Logging out..." : "Logout"}
                    </button>
                    {logoutError && (
                      <p
                        className="navbar-error account-menu-error"
                        role="alert"
                      >
                        {logoutError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="navbar-toggle"
              aria-label={
                isMenuOpen ? "Close navigation menu" : "Open navigation menu"
              }
              aria-expanded={isMenuOpen}
              aria-controls="navbar-menu"
              onClick={() =>
                setOpenMenuPath((openPath) =>
                  openPath === pathname ? null : pathname,
                )
              }
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </nav>
      <CartPanel
        isOpen={isCartOpen}
        onClose={closeCart}
        onCheckout={proceedToCheckout}
      />
    </>
  );
}

export default Navigation;