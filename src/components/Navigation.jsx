import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { logout } from "../services/authService";
import "../styles/Navigation.css";

const guestLinks = [
  { label: "Home", to: "/" },
  { label: "Menu", to: "/menu" },
  { label: "About", to: "/about" },
];

const customerLinks = [
  { label: "Customer Dashboard", to: "/customer" },
  { label: "Menu", to: "/menu" },
  { label: "My Orders", to: "/my-orders" },
  { label: "Reservations", to: "/reservations" },
  { label: "My Reservations", to: "/my-reservations" },
  { label: "My Reviews", to: "/my-reviews" },
];

const adminLinks = [
  { label: "Admin Dashboard", to: "/admin" },
  { label: "Menu Management", to: "/admin/menu" },
  { label: "Orders", to: "/admin/orders" },
  { label: "Reservations", to: "/admin/reservations" },
  { label: "Reviews", to: "/admin/reviews" },
];

function Navigation() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, role, loading, roleError } = useAuth();

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  const navLinkClass = ({ isActive }) =>
    isActive ? "navbar-link active" : "navbar-link";

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
      setIsMenuOpen(false);
      navigate("/", { replace: true });
    } catch (error) {
      console.error("Logout error:", error);
      setLogoutError("Unable to log out. Please try again.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <nav className="navbar" aria-label="Main navigation">
      <div className="navbar-container">
        <NavLink
          to="/"
          className="navbar-logo"
          aria-label="Cactus Cafe home"
          onClick={() => setIsMenuOpen(false)}
        >
          <span className="navbar-monogram" aria-hidden="true">
            C
          </span>
          <span>Cactus Cafe</span>
        </NavLink>

        <button
          type="button"
          className="navbar-toggle"
          aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={isMenuOpen}
          aria-controls="navbar-menu"
          onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
        >
          <span />
          <span />
          <span />
        </button>

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
                    onClick={() => setIsMenuOpen(false)}
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
              onClick={() => setIsMenuOpen(false)}
            >
              Login
            </NavLink>
          )}

          {!loading && user && (
            <button
              type="button"
              className="login-btn navbar-logout"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? "Logging out..." : "Logout"}
            </button>
          )}

          {(roleError || logoutError) && (
            <p className="navbar-error" role="alert">
              {logoutError || roleError}
            </p>
          )}
        </div>
      </div>
    </nav>
  );
}

export default Navigation;