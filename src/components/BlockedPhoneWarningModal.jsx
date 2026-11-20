import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import { useAuth } from "../context/Authcontext";
import { getBlockedPhone } from "../services/blockedPhoneService";
import {
  createPhoneRestorationRequest,
  getCustomerPhoneRestorationRequests,
} from "../services/phoneRestorationService";
import { db } from "../services/firebase";
import { normalizePHPhone } from "../utils/phoneUtils.js";
import "../styles/BlockedPhoneWarningModal.css";

const getLatestRequest = (requests) =>
  requests.find((restorationRequest) =>
    restorationRequest.status === "pending",
  ) || requests[0] || null;

function BlockedPhoneWarningModal() {
  const { user, role, loading: authLoading } = useAuth();
  const [blockedPhone, setBlockedPhone] = useState(null);
  const [restorationRequest, setRestorationRequest] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [reason, setReason] = useState("");
  const [requestError, setRequestError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [retryStatus, setRetryStatus] = useState(0);

  useEffect(() => {
    let active = true;

    if (
      authLoading
      || !user?.uid
      || String(role || "").toLowerCase() !== "customer"
    ) {
      return () => {
        active = false;
      };
    }

    const checkBlockedPhone = async () => {
      try {
        const profileSnapshot = await getDoc(doc(db, "users", user.uid));
        if (!active) return;
        if (!profileSnapshot.exists()) {
          setBlockedPhone(null);
          return;
        }

        const profile = profileSnapshot.data();
        const phone = normalizePHPhone(
          profile.phoneNumber || profile.phone || "",
        );
        if (!phone) {
          setBlockedPhone(null);
          return;
        }

        const blockedRecord = await getBlockedPhone(db, phone);
        if (!active) return;
        if (!blockedRecord) {
          setBlockedPhone(null);
          return;
        }

        setBlockedPhone({
          uid: user.uid,
          phone,
          record: blockedRecord,
          canRequest:
            !blockedRecord.customerUid || blockedRecord.customerUid === user.uid,
        });
        setRestorationRequest(null);
        setRequestError("");
        setStatusError("");
        setDismissed(false);
        setStatusLoading(true);
        try {
          const requests = await getCustomerPhoneRestorationRequests(
            db,
            user.uid,
            phone,
          );
          if (active) {
            setRestorationRequest(getLatestRequest(requests));
            setStatusError("");
          }
        } catch (requestStatusError) {
          console.error(
            "Unable to load phone restoration request status:",
            requestStatusError,
          );
          if (active) {
            setStatusError(
              "Unable to check your restoration request status. Try again before submitting.",
            );
          }
        } finally {
          if (active) setStatusLoading(false);
        }
      } catch (blockedPhoneError) {
        console.error("Unable to check the signed-in customer's phone:", blockedPhoneError);
      }
    };

    checkBlockedPhone();
    return () => {
      active = false;
    };
  }, [authLoading, retryStatus, role, user?.uid]);

  const handleSubmitRequest = async (event) => {
    event.preventDefault();
    setRequestError("");
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setRequestError("Enter a reason for requesting restoration.");
      return;
    }
    if (cleanReason.length > 1000) {
      setRequestError("Your reason must be 1,000 characters or fewer.");
      return;
    }

    try {
      setSubmitting(true);
      const requestId = await createPhoneRestorationRequest(
        db,
        user.uid,
        blockedPhone.phone,
        cleanReason,
      );
      setRestorationRequest({
        id: requestId,
        uid: user.uid,
        phoneNumber: blockedPhone.phone,
        reason: cleanReason,
        status: "pending",
        createdAt: new Date(),
      });
      setReason("");
    } catch (submitError) {
      console.error("Unable to submit phone restoration request:", submitError);
      setRequestError(
        submitError?.code === "phone-restoration/pending"
          ? "You already have a pending phone restoration request."
          : submitError?.message
            || "Unable to submit your request. Please try again.",
      );
      if (submitError?.code === "phone-restoration/pending") {
        setRetryStatus((current) => current + 1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (
    authLoading
    || !user?.uid
    || String(role || "").toLowerCase() !== "customer"
    || !blockedPhone
    || blockedPhone.uid !== user.uid
    || dismissed
  ) {
    return null;
  }

  const hasPendingRequest = restorationRequest?.status === "pending";
  const blockReason = String(blockedPhone.record.reason || "").trim();

  return (
    <div className="blocked-phone-modal-backdrop">
      <section
        className="blocked-phone-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="blocked-phone-modal-title"
      >
        <button
          type="button"
          className="blocked-phone-modal-close"
          aria-label="Close blocked phone warning"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>

        <div className="blocked-phone-modal-icon" aria-hidden="true">!</div>
        <p className="blocked-phone-modal-eyebrow">ACCOUNT NOTICE</p>
        <h2 id="blocked-phone-modal-title">Your mobile number is blocked</h2>
        <p className="blocked-phone-modal-number">{blockedPhone.phone}</p>

        <div className="blocked-phone-modal-reason">
          <strong>Reason recorded</strong>
          <p>{blockReason || "No reason was recorded."}</p>
        </div>
        <p className="blocked-phone-modal-explanation">
          While this number is blocked, you cannot place orders or make
          reservations using it. If you believe this block was made in error,
          you can request a review below.
        </p>

        {restorationRequest && (
          <div className="restoration-request-status" role="status">
            <span>Request status</span>
            <strong className={`request-status-${restorationRequest.status}`}>
              {restorationRequest.status}
            </strong>
          </div>
        )}

        {statusLoading ? (
          <p className="restoration-status-loading" role="status">
            Checking restoration request status...
          </p>
        ) : statusError ? (
          <div className="restoration-request-error" role="alert">
            <p>{statusError}</p>
            <button
              type="button"
              onClick={() => setRetryStatus((current) => current + 1)}
            >
              Check again
            </button>
          </div>
        ) : hasPendingRequest ? (
          <p className="restoration-request-pending">
            Your request is pending review. You can continue using your account,
            but ordering and reservations remain restricted until the number is
            restored.
          </p>
        ) : blockedPhone.canRequest ? (
          <form
            className="restoration-request-form"
            onSubmit={handleSubmitRequest}
          >
            <label htmlFor="phone-restoration-reason">
              Why should this number be restored?
            </label>
            <textarea
              id="phone-restoration-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setRequestError("");
              }}
              maxLength={1000}
              rows={4}
              placeholder="Explain why you believe this block should be reviewed."
              required
              disabled={submitting}
            />
            {requestError && (
              <p className="restoration-request-error" role="alert">
                {requestError}
              </p>
            )}
            <button
              type="submit"
              className="restoration-request-submit"
              disabled={submitting || statusLoading}
            >
              {submitting ? "Submitting..." : "Request Restoration"}
            </button>
          </form>
        ) : (
          <p className="restoration-request-pending">
            Contact Cactus Cafe support to review this block. It is associated
            with a different customer account.
          </p>
        )}
      </section>
    </div>
  );
}

export default BlockedPhoneWarningModal;
