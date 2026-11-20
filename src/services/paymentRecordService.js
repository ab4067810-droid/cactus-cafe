import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "./firebase";

function requireCurrentAdmin(adminId) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Sign in again before reviewing QR payments.");
  }

  if (adminId && currentUser.uid !== adminId) {
    throw new Error("The signed-in account changed. Reload the review queue.");
  }

  return currentUser;
}

function requireCurrentCustomer(customerId) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Sign in again before accessing payment history.");
  }

  if (customerId && currentUser.uid !== customerId) {
    throw new Error("The signed-in account changed. Reload your orders.");
  }

  return currentUser;
}

export async function loadCustomerPaymentHistory(customerId) {
  const currentUser = requireCurrentCustomer(customerId);
  const recordsSnapshot = await getDocs(
    query(
      collection(db, "paymentRecords"),
      where("customerId", "==", currentUser.uid),
    ),
  );

  const records = await Promise.all(
    recordsSnapshot.docs.map(async (recordDocument) => {
      const submissionsSnapshot = await getDocs(
        query(
          collection(
            db,
            "paymentRecords",
            recordDocument.id,
            "submissions",
          ),
          where("customerId", "==", currentUser.uid),
        ),
      );
      const submissions = submissionsSnapshot.docs
        .map((submissionDocument) => ({
          id: submissionDocument.id,
          ...submissionDocument.data(),
        }))
        .sort((first, second) => first.attemptNumber - second.attemptNumber);

      return [
        recordDocument.id,
        {
          id: recordDocument.id,
          ...recordDocument.data(),
          submissions,
        },
      ];
    }),
  );

  return Object.fromEntries(records);
}

export async function submitQrPaymentReference(order, referenceNumber) {
  const currentUser = requireCurrentCustomer(order?.customerId);

  if (
    typeof order?.id !== "string"
    || !order.id
    || order.id.includes("/")
    || order.requestId !== order.id
  ) {
    throw new Error("This order is not eligible for QR payment submission.");
  }

  const reference = typeof referenceNumber === "string"
    ? referenceNumber.trim()
    : "";
  const referenceLength = Array.from(reference).length;

  if (referenceLength < 1 || referenceLength > 100) {
    throw new Error("Enter a transaction reference from 1 to 100 characters.");
  }

  const recordsSnapshot = await getDocs(
    query(
      collection(db, "paymentRecords"),
      where("customerId", "==", currentUser.uid),
    ),
  );
  const existingRecord = recordsSnapshot.docs.find(
    (recordDocument) => recordDocument.id === order.id,
  );
  const recordReference = doc(db, "paymentRecords", order.id);
  let attemptNumber = 1;
  const batch = writeBatch(db);
  const timestamp = serverTimestamp();

  if (existingRecord) {
    const record = existingRecord.data();
    if (
      record.orderId !== order.id
      || record.customerId !== currentUser.uid
      || record.paymentStatus !== "rejected"
      || ![1, 2].includes(record.attemptCount)
    ) {
      throw new Error(
        "A new reference can only be submitted after a rejection and before the three-attempt limit.",
      );
    }

    attemptNumber = record.attemptCount + 1;
    batch.update(recordReference, {
      paymentStatus: "pending_review",
      attemptCount: attemptNumber,
      currentSubmissionId: `attempt-${attemptNumber}`,
      updatedAt: timestamp,
      lastSubmittedAt: timestamp,
    });
  } else {
    const amountDue = Math.round(Number(order.total) * 100);
    if (!Number.isSafeInteger(amountDue) || amountDue < 0) {
      throw new Error("This order has an invalid amount due.");
    }

    batch.set(recordReference, {
      orderId: order.id,
      customerId: currentUser.uid,
      amountDue,
      paymentStatus: "pending_review",
      attemptCount: attemptNumber,
      currentSubmissionId: "attempt-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSubmittedAt: timestamp,
      verifiedAt: null,
      verifiedBy: "",
      resolutionReason: "",
      resolvedAt: null,
      resolvedBy: "",
    });
  }

  batch.set(
    doc(
      db,
      "paymentRecords",
      order.id,
      "submissions",
      `attempt-${attemptNumber}`,
    ),
    {
      orderId: order.id,
      customerId: currentUser.uid,
      attemptNumber,
      referenceNumber: reference,
      submittedAt: timestamp,
      status: "pending_review",
      reviewedAt: null,
      reviewedBy: "",
      rejectionReason: "",
    },
  );

  await batch.commit();
  return attemptNumber;
}

async function loadAdminQrRecords(adminId, paymentStatus) {
  requireCurrentAdmin(adminId);

  const recordsSnapshot = await getDocs(
    query(
      collection(db, "paymentRecords"),
      where("paymentStatus", "==", paymentStatus),
    ),
  );
  const matchingRecords = await Promise.all(
    recordsSnapshot.docs.map(async (recordDocument) => {
      const orderId = recordDocument.id;
      const record = recordDocument.data();
      const submissionsSnapshot = await getDocs(
        collection(db, "paymentRecords", orderId, "submissions"),
      );
      const submissions = submissionsSnapshot.docs
        .map((submissionDocument) => ({
          id: submissionDocument.id,
          ...submissionDocument.data(),
        }))
        .sort((first, second) => first.attemptNumber - second.attemptNumber);
      const relevantSubmissions = submissions.filter((submission) =>
        paymentStatus === "pending_review"
          ? submission.status === "pending_review"
          : submission.attemptNumber === 3
            && submission.status === "rejected",
      );

      if (relevantSubmissions.length === 0) return null;

      const [orderSnapshot, selectionSnapshot] = await Promise.all([
        getDoc(doc(db, "orders", orderId)),
        getDoc(doc(db, "paymentSelections", orderId)),
      ]);
      const order = orderSnapshot.exists() ? orderSnapshot.data() : {};
      const selection = selectionSnapshot.exists()
        ? selectionSnapshot.data()
        : {};

      return {
        orderId,
        customerId: record.customerId,
        customerName: order.customerName || "",
        amountDue: record.amountDue,
        paymentTiming: selection.timing || "",
        paymentStatus: record.paymentStatus,
        attemptCount: record.attemptCount,
        currentSubmissionId: record.currentSubmissionId,
        submissions,
      };
    }),
  );

  return matchingRecords.filter(Boolean);
}

export async function loadAdminQrVerificationQueue(adminId) {
  const records = await loadAdminQrRecords(adminId, "pending_review");
  return records
    .flatMap((record) =>
      record.submissions
        .filter((submission) => submission.status === "pending_review")
        .map((submission) => ({
          ...record,
          submission,
          previousAttempts: record.submissions.filter(
            (previous) => previous.attemptNumber < submission.attemptNumber,
          ),
        })),
    )
    .sort((first, second) => {
      const firstDate = first.submission.submittedAt?.toDate
        ? first.submission.submittedAt.toDate().getTime()
        : 0;
      const secondDate = second.submission.submittedAt?.toDate
        ? second.submission.submittedAt.toDate().getTime()
        : 0;

      return firstDate - secondDate;
    });
}

export async function loadAdminQrResolutionQueue(adminId) {
  const records = await loadAdminQrRecords(
    adminId,
    "admin_review_required",
  );
  return records.filter((record) =>
    record.attemptCount === 3
    && record.currentSubmissionId === "attempt-3"
    && record.submissions.some(
      (submission) =>
        submission.id === "attempt-3"
        && submission.status === "rejected",
    ),
  );
}

export async function reviewQrPaymentSubmission({
  orderId,
  submissionId,
  adminId,
  decision,
  rejectionReason = "",
}) {
  const currentUser = requireCurrentAdmin(adminId);

  if (!["verify", "reject"].includes(decision)) {
    throw new Error("Choose a valid QR payment decision.");
  }

  const reason = typeof rejectionReason === "string"
    ? rejectionReason.trim()
    : "";
  const reasonLength = Array.from(reason).length;

  if (decision === "reject" && (reasonLength < 1 || reasonLength > 500)) {
    throw new Error("Enter a rejection reason from 1 to 500 characters.");
  }

  const recordReference = doc(db, "paymentRecords", orderId);
  const submissionReference = doc(
    db,
    "paymentRecords",
    orderId,
    "submissions",
    submissionId,
  );
  const [recordSnapshot, submissionSnapshot] = await Promise.all([
    getDoc(recordReference),
    getDoc(submissionReference),
  ]);

  if (!recordSnapshot.exists() || !submissionSnapshot.exists()) {
    throw new Error("This QR submission is no longer available for review.");
  }

  const record = recordSnapshot.data();
  const submission = submissionSnapshot.data();
  if (
    record.orderId !== orderId
    || record.paymentStatus !== "pending_review"
    || record.currentSubmissionId !== submissionId
    || submission.orderId !== orderId
    || submission.status !== "pending_review"
    || submission.attemptNumber !== record.attemptCount
  ) {
    throw new Error("This QR submission has already been reviewed.");
  }

  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  if (decision === "verify") {
    batch.update(recordReference, {
      paymentStatus: "paid",
      updatedAt: timestamp,
      verifiedAt: timestamp,
      verifiedBy: currentUser.uid,
    });
    batch.update(submissionReference, {
      status: "verified",
      reviewedAt: timestamp,
      reviewedBy: currentUser.uid,
      rejectionReason: "",
    });
  } else {
    batch.update(recordReference, {
      paymentStatus: record.attemptCount === 3
        ? "admin_review_required"
        : "rejected",
      updatedAt: timestamp,
    });
    batch.update(submissionReference, {
      status: "rejected",
      reviewedAt: timestamp,
      reviewedBy: currentUser.uid,
      rejectionReason: reason,
    });
  }

  await batch.commit();
}

export async function resolveAdminQrPaymentRecord({
  orderId,
  adminId,
  decision,
  resolutionReason = "",
}) {
  const currentUser = requireCurrentAdmin(adminId);

  if (!["paid", "rejected"].includes(decision)) {
    throw new Error("Choose a valid final payment decision.");
  }

  const reason = typeof resolutionReason === "string"
    ? resolutionReason.trim()
    : "";
  const reasonLength = Array.from(reason).length;
  if (decision === "rejected" && (reasonLength < 1 || reasonLength > 500)) {
    throw new Error("Enter a final rejection reason from 1 to 500 characters.");
  }

  const recordReference = doc(db, "paymentRecords", orderId);
  const finalSubmissionReference = doc(
    db,
    "paymentRecords",
    orderId,
    "submissions",
    "attempt-3",
  );
  const [recordSnapshot, submissionSnapshot] = await Promise.all([
    getDoc(recordReference),
    getDoc(finalSubmissionReference),
  ]);
  if (!recordSnapshot.exists() || !submissionSnapshot.exists()) {
    throw new Error("This payment is no longer available for resolution.");
  }

  const record = recordSnapshot.data();
  const finalSubmission = submissionSnapshot.data();
  if (
    record.orderId !== orderId
    || record.paymentStatus !== "admin_review_required"
    || record.attemptCount !== 3
    || record.currentSubmissionId !== "attempt-3"
    || record.verifiedAt !== null
    || record.verifiedBy !== ""
    || record.resolutionReason !== ""
    || record.resolvedAt !== null
    || record.resolvedBy !== ""
    || finalSubmission.orderId !== orderId
    || finalSubmission.customerId !== record.customerId
    || finalSubmission.attemptNumber !== 3
    || finalSubmission.status !== "rejected"
  ) {
    throw new Error("This payment is not awaiting administrator resolution.");
  }

  const timestamp = serverTimestamp();
  const batch = writeBatch(db);
  batch.update(recordReference, {
    paymentStatus: decision,
    updatedAt: timestamp,
    verifiedAt: decision === "paid" ? timestamp : record.verifiedAt,
    verifiedBy: decision === "paid" ? currentUser.uid : record.verifiedBy,
    resolutionReason: decision === "rejected" ? reason : "",
    resolvedAt: timestamp,
    resolvedBy: currentUser.uid,
  });
  await batch.commit();
}
