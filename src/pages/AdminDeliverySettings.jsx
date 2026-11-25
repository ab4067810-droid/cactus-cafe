import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { NavLink, useNavigate } from "react-router-dom";

import AdminWorkspaceNavigation from "../components/AdminWorkspaceNavigation";
import { useAuth } from "../context/Authcontext";
import { auth, db } from "../services/firebase";
import "../styles/AdminReviews.css";
import "../styles/AdminSidebar.css";
import "../styles/AdminDeliverySettings.css";

function AdminDeliverySettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [disableSundayDelivery, setDisableSundayDelivery] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribe = onSnapshot(
      doc(db, "cafeSettings", "delivery"),
      (settingSnapshot) => {
        if (!settingSnapshot.exists()) {
          setDisableSundayDelivery(false);
          setErrorMessage("");
          setSettingsLoading(false);
          return;
        }

        const value = settingSnapshot.data().disableSundayDelivery;
        if (typeof value !== "boolean") {
          const error = new Error("Sunday delivery setting has an invalid value.");
          console.error("Unable to load Sunday delivery setting:", error);
          setErrorMessage(
            "The saved setting is invalid. Choose a value and save to replace it.",
          );
          setSettingsLoading(false);
          return;
        }

        setDisableSundayDelivery(value);
        setErrorMessage("");
        setSettingsLoading(false);
      },
      (error) => {
        console.error("Unable to load Sunday delivery setting:", error);
        setErrorMessage(
          "Could not load the current setting. You can try saving a valid value.",
        );
        setSettingsLoading(false);
      },
    );

    return unsubscribe;
  }, [user]);

  const handleSave = async () => {
    if (!user || saving || settingsLoading) return;

    try {
      setSaving(true);
      setErrorMessage("");
      setSuccessMessage("");
      await setDoc(doc(db, "cafeSettings", "delivery"), {
        disableSundayDelivery,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
      setSuccessMessage("Sunday delivery setting saved.");
    } catch (error) {
      console.error("Unable to save Sunday delivery setting:", error);
      setErrorMessage("Could not save this setting. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Unable to sign out:", error);
      setLogoutError("Could not sign out. Please try again.");
    }
  };

  const profileName = user?.displayName || user?.email || "Cafe Admin";

  return (
    <main className="admin-reviews-page delivery-settings-page">
      {mobileNavigationOpen && (
        <button
          type="button"
          className="admin-reviews-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}

      <aside
        className={`admin-reviews-sidebar ${
          mobileNavigationOpen ? "is-open" : ""
        }`}
        aria-label="Admin navigation"
      >
        <NavLink
          to="/admin/monthly-records"
          className="admin-reviews-brand"
          onClick={() => setMobileNavigationOpen(false)}
        >
          <span className="admin-reviews-brand-mark" aria-hidden="true">
            C
          </span>
          <span>
            <strong>Cactus Café</strong>
            <small>ADMIN WORKSPACE</small>
          </span>
        </NavLink>

        <div className="admin-reviews-sidebar-label">WORKSPACE</div>
        <nav className="admin-reviews-nav">
          <AdminWorkspaceNavigation
            classPrefix="admin-reviews"
            onNavigate={() => setMobileNavigationOpen(false)}
          />
        </nav>

        <div className="admin-reviews-sidebar-footer">
          <div className="admin-reviews-sidebar-note">
            <span aria-hidden="true">✦</span>
            <p>Keep delivery availability current for every guest.</p>
          </div>
          <button
            type="button"
            className="admin-reviews-logout"
            onClick={handleLogout}
          >
            <span className="admin-reviews-nav-icon" aria-hidden="true">
              ↪
            </span>
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <div className="admin-reviews-main">
        <div className="admin-reviews-container">
          <header className="admin-reviews-header">
            <button
              type="button"
              className="admin-reviews-mobile-toggle"
              aria-label="Open navigation menu"
              aria-expanded={mobileNavigationOpen}
              onClick={() => setMobileNavigationOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>

            <div className="admin-reviews-heading">
              <p className="admin-reviews-eyebrow">DELIVERY CONFIGURATION</p>
              <h1>Delivery Settings</h1>
              <p>Manage the days customers can place delivery orders.</p>
            </div>

            <div className="admin-reviews-profile">
              <span
                className="admin-reviews-profile-avatar"
                aria-hidden="true"
              >
                {profileName.slice(0, 1).toUpperCase()}
              </span>
              <span className="admin-reviews-profile-copy">
                <strong>{profileName}</strong>
                <small>Administrator</small>
              </span>
            </div>
          </header>

          <section
            className="delivery-settings-card"
            aria-labelledby="sunday-delivery-title"
          >
            <div className="delivery-settings-copy">
              <p className="admin-reviews-eyebrow">ORDER AVAILABILITY</p>
              <h2 id="sunday-delivery-title">Sunday delivery</h2>
              <p>
                This schedule uses the Asia/Manila timezone. When disabled,
                customers cannot submit Delivery orders on Sundays.
              </p>
              <p className="delivery-settings-note">
                Takeout and Dine-in remain available.
              </p>
            </div>

            <label className="delivery-settings-toggle">
              <input
                type="checkbox"
                checked={disableSundayDelivery}
                disabled={settingsLoading || saving}
                onChange={(event) => {
                  setDisableSundayDelivery(event.target.checked);
                  setSuccessMessage("");
                }}
              />
              <span>Disable Sunday delivery</span>
            </label>

            {settingsLoading && (
              <p className="delivery-settings-feedback" role="status">
                Loading current setting...
              </p>
            )}
            {errorMessage && (
              <p className="delivery-settings-feedback is-error" role="alert">
                {errorMessage}
              </p>
            )}
            {successMessage && (
              <p className="delivery-settings-feedback" role="status">
                {successMessage}
              </p>
            )}
            {logoutError && (
              <p className="delivery-settings-feedback is-error" role="alert">
                {logoutError}
              </p>
            )}

            <div className="delivery-settings-actions">
              <button
                type="button"
                className="admin-refresh-button"
                disabled={settingsLoading || saving}
                onClick={handleSave}
              >
                {saving ? "Saving..." : "Save setting"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default AdminDeliverySettings;
