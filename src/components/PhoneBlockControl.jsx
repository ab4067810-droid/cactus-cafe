import { useState } from "react";

import { blockPhone } from "../services/blockedPhoneService";
import { db } from "../services/firebase";
import { normalizePHPhone } from "../utils/phoneUtils.js";
import "../styles/AdminPhoneManagement.css";

function PhoneBlockControl({
  phone,
  customerUid,
  adminUid,
  isBlocked,
  canBlock = true,
  allowUnblock = false,
  unblocking = false,
  onBlocked,
  onUnblocked,
}) {
  const [blocking, setBlocking] = useState(false);
  const [error, setError] = useState("");
  const normalizedPhone = normalizePHPhone(phone);

  if (!normalizedPhone || (!isBlocked && !canBlock)) return null;

  const handleBlock = async () => {
    const reason = window.prompt(
      "Enter a brief reason for blocking this number (e.g., Fake order / no-show):",
    );
    if (reason === null) return;

    const cleanReason = reason.trim();
    if (!cleanReason) {
      setError("Enter a brief reason before blocking this number.");
      return;
    }
    if (cleanReason.length > 500) {
      setError("The block reason must be 500 characters or fewer.");
      return;
    }

    const confirmed = window.confirm(
      `Block ${normalizedPhone}?\n\nReason: ${cleanReason}`,
    );
    if (!confirmed) return;

    try {
      setBlocking(true);
      setError("");
      await blockPhone(
        db,
        normalizedPhone,
        adminUid,
        cleanReason,
        customerUid,
      );
      await onBlocked?.(normalizedPhone);
    } catch (blockError) {
      console.error("Unable to block customer phone number:", blockError);
      setError(
        "Unable to block this number. Check your connection and try again.",
      );
    } finally {
      setBlocking(false);
    }
  };

  return (
    <span className="admin-phone-control">
      {isBlocked ? (
        <>
          <span className="admin-phone-blocked-badge">Blocked</span>
          {allowUnblock && (
            <button
              type="button"
              className="admin-phone-unblock-button"
              onClick={() => onUnblocked?.(normalizedPhone)}
              disabled={unblocking}
            >
              {unblocking ? "Unblocking..." : "Unblock Phone"}
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className="admin-phone-block-button"
          onClick={handleBlock}
          disabled={blocking}
        >
          {blocking ? "Blocking..." : "Block Phone"}
        </button>
      )}
      {error && (
        <span className="admin-phone-action-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

export default PhoneBlockControl;
