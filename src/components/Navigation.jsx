import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../context/Authcontext";
import { useCart } from "../context/CartContext";
import { logout } from "../services/authService";
import { auth, db } from "../services/firebase";
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
  { label: "Delivery Settings", to: "/admin/delivery-settings" },
  { label: "Reviews", to: "/admin/reviews" },
  { label: "Customers & Security", to: "/admin/users" },
  { label: "Monthly Records", to: "/admin/monthly-records" },
];

const staffLinks = [
  { label: "Menu Management", to: "/admin/menu" },
  { label: "Orders", to: "/admin/orders" },
  { label: "Payment Management", to: "/admin/payments" },
  { label: "Reservations", to: "/admin/reservations" },
];

const getAccountInitials = (name) => {
  const nameParts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return "";

  const firstInitial = Array.from(nameParts[0])[0];
  const lastInitial =
    nameParts.length > 1
      ? Array.from(nameParts[nameParts.length - 1])[0]
      : "";

  return `${firstInitial}${lastInitial}`.toUpperCase();
};

function AccountAvatar({ user }) {
  const [failedImageUrl, setFailedImageUrl] = useState("");
  const imageUrl =
    typeof user?.photoURL === "string" ? user.photoURL.trim() : "";
  const initials = getAccountInitials(user?.displayName);

  return (
    <span className="navbar-account-avatar" aria-hidden="true">
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
    </span>
  );
}

function OutForDeliveryToast({ notification, onDismiss }) {
  return (
    <aside className="delivery-status-toast" role="status" aria-live="polite">
      <span className="delivery-status-toast-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h11v11H3z" />
          <path d="M14 10h4l3 3v4h-7z" />
          <circle cx="7.5" cy="18" r="1.5" />
          <circle cx="17.5" cy="18" r="1.5" />
        </svg>
      </span>
      <div className="delivery-status-toast-copy">
        <span>OUT FOR DELIVERY</span>
        <strong>Your order is on the way</strong>
        <p>{notification.message}</p>
        <small>Order {notification.orderId}</small>
      </div>
      <button
        type="button"
        className="delivery-status-toast-dismiss"
        aria-label={`Dismiss delivery update for order ${notification.orderId}`}
        onClick={() => onDismiss(notification.key)}
      >
        ×
      </button>
    </aside>
  );
}

function Navigation() {
  const [openMenuPath, setOpenMenuPath] = useState(null);
  const [openAccountMenuPath, setOpenAccountMenuPath] = useState(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [unreadNotifications, setUnreadNotifications] = useState({
    userId: null,
    order: false,
    reservation: false,
  });
  const [deliveryToasts, setDeliveryToasts] = useState([]);
  const accountMenuRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const cartButtonRef = useRef(null);
  const seenDeliveryNotificationsRef = useRef(new Set());
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, role, loading, roleError } = useAuth();
  const userId = user?.uid;
  const homePath = user ? "/customer" : "/";
  const { cart, totalItems, cartChangeKey } = useCart();
  const [previousPath, setPreviousPath] = useState(pathname);

  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setOpenMenuPath(null);
    setOpenAccountMenuPath(null);
  }

  const isMenuOpen = openMenuPath === pathname;
  const isAccountMenuOpen = openAccountMenuPath === pathname;
  const hasUnreadOrderNotifications =
    role === "customer"
    && unreadNotifications.userId === userId
    && unreadNotifications.order;
  const hasUnreadReservationNotifications =
    role === "customer"
    && unreadNotifications.userId === userId
    && unreadNotifications.reservation;

  useEffect(() => {
    if (loading || role !== "customer" || !userId) {
      return undefined;
    }

    const unreadNotificationsQuery = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      where("isRead", "==", false),
    );

    return onSnapshot(
      unreadNotificationsQuery,
      (snapshot) => {
        const unreadTypes = { order: false, reservation: false };

        snapshot.forEach((notification) => {
          const type = notification.data().type;
          if (type === "order" || type === "reservation") {
            unreadTypes[type] = true;
          }
        });

        setUnreadNotifications({ userId, ...unreadTypes });

        snapshot.docChanges().forEach((change) => {
          if (change.type !== "added") return;

          const notification = change.doc.data();
          if (
            notification.type !== "order"
            || notification.title !== "Order status updated"
            || typeof notification.itemId !== "string"
            || !notification.itemId
            || typeof notification.message !== "string"
            || !notification.message.startsWith(
              "Your delivery order is on the way.",
            )
          ) {
            return;
          }

          const toastKey =
            `${userId}:${notification.itemId}:Out for Delivery`;
          const storageKey = `cactus-cafe:delivery-toast:${toastKey}`;
          let alreadySeen =
            seenDeliveryNotificationsRef.current.has(storageKey);

          try {
            alreadySeen = alreadySeen
              || window.sessionStorage.getItem(storageKey) === "shown";
          } catch (storageError) {
            console.error(
              "Unable to read delivery notification session state:",
              storageError,
            );
          }
          if (alreadySeen) return;

          seenDeliveryNotificationsRef.current.add(storageKey);
          try {
            window.sessionStorage.setItem(storageKey, "shown");
          } catch (storageError) {
            console.error(
              "Unable to save delivery notification session state:",
              storageError,
            );
          }

          setDeliveryToasts((currentToasts) => (
            currentToasts.some((toast) => toast.key === toastKey)
              ? currentToasts
              : [
                ...currentToasts,
                {
                  key: toastKey,
                  userId,
                  orderId: notification.itemId,
                  message: notification.message,
                },
              ]
          ));
        });
      },
      (error) => {
        console.error("Error listening for unread notifications:", error);
        setUnreadNotifications({
          userId,
          order: false,
          reservation: false,
        });
      },
    );
  }, [loading, role, userId]);

  const closeCart = useCallback(() => {
    setIsCartOpen(false);
    cartButtonRef.current?.focus();
  }, []);

  const proceedToCheckout = () => {
    setIsCartOpen(false);
    navigate("/checkout", { state: { cart } });
  };

  const continueShopping = () => {
    closeCart();
    navigate("/menu");
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
        : role === "staff"
          ? staffLinks
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
            to={homePath}
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

            {!loading && user && ["admin", "staff"].includes(role) && (
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
            {!loading && user && role === "customer" && (
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
              <NavLink
                to="/favorites"
                className={({ isActive }) =>
                  `navbar-favorites-link${isActive ? " active" : ""}`
                }
                aria-label="Favorites"
                title="Favorites"
                onClick={() => setOpenMenuPath(null)}
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
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
                </svg>
              </NavLink>
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
                  <AccountAvatar user={auth.currentUser} />
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
                      to="/my-account"
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
                        <circle cx="12" cy="8" r="3.5" />
                        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
                      </svg>
                      My Account
                    </NavLink>
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
                      {hasUnreadOrderNotifications && (
                        <span
                          className="navbar-unread-dot"
                          role="img"
                          aria-label="Unread notifications"
                        />
                      )}
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
                      {hasUnreadReservationNotifications && (
                        <span
                          className="navbar-unread-dot"
                          role="img"
                          aria-label="Unread notifications"
                        />
                      )}
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
      {role === "customer"
        && deliveryToasts.some((toast) => toast.userId === userId) && (
        <div className="delivery-status-toast-stack">
          {deliveryToasts
            .filter((toast) => toast.userId === userId)
            .map((notification) => (
            <OutForDeliveryToast
              key={notification.key}
              notification={notification}
              onDismiss={(toastKey) => {
                setDeliveryToasts((currentToasts) =>
                  currentToasts.filter((toast) => toast.key !== toastKey)
                );
              }}
            />
          ))}
        </div>
      )}
      <CartPanel
        isOpen={isCartOpen}
        onClose={closeCart}
        onCheckout={proceedToCheckout}
        onContinueShopping={continueShopping}
      />
    </>
  );
}

export default Navigation;