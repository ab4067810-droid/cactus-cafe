import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import { updateQrOrderPaymentStatus } from "./orderApprovalService";
import {
  checkPaymentReference,
  claimPaymentReference,
  DUPLICATE_PAYMENT_REFERENCE_MESSAGE,
  isValidNormalizedPaymentReference,
  normalizePaymentReference,
} from "../utils/paymentReferenceRegistry.js";

const CHECKOUT_QR_PAYMENT_STATUSES = new Set([
  "pending_verification",
  "paid",
  "needs_review",
  "rejected",
]);

function getTimestampMillis(timestamp) {
  if (timestamp?.toDate) return timestamp.toDate().getTime();
  if (timestamp instanceof Date) return timestamp.getTime();
  return 0;
}

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

  const reference = normalizePaymentReference(referenceNumber);
  if (!isValidNormalizedPaymentReference(reference)) {
    throw new Error("Enter a transaction reference from 1 to 100 characters.");
  }
  if (await checkPaymentReference(db, currentUser.uid, referenceNumber)) {
    throw new Error(DUPLICATE_PAYMENT_REFERENCE_MESSAGE);
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
  claimPaymentReference(
    batch,
    db,
    currentUser.uid,
    referenceNumber,
    "order_payment",
  );

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

  try {
    await batch.commit();
  } catch (error) {
    if (error?.code === "permission-denied") {
      let duplicateReference = false;
      try {
        duplicateReference = await checkPaymentReference(
          db,
          currentUser.uid,
          reference,
        );
      } catch (referenceCheckError) {
        console.error(
          "Unable to identify a conflicting payment reference:",
          referenceCheckError,
        );
      }
      if (duplicateReference) {
        throw new Error(DUPLICATE_PAYMENT_REFERENCE_MESSAGE, { cause: error });
      }
    }
    throw error;
  }
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
        itemsSubtotal: order.itemsSubtotal ?? order.total ?? 0,
        deliveryFee: order.deliveryFee || 0,
        waitingFee: order.waitingFee || 0,
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

async function loadAdminCheckoutQrOrders(adminId, paymentStatus) {
  requireCurrentAdmin(adminId);

  const ordersSnapshot = await getDocs(
    query(
      collection(db, "orders"),
      where("paymentMethod", "==", "qr"),
      where("paymentStatus", "==", paymentStatus),
    ),
  );

  return ordersSnapshot.docs.map((orderDocument) => {
    const order = orderDocument.data();
    const total = Number(order.total) || 0;
    return {
      source: "checkout",
      orderId: orderDocument.id,
      customerId: order.customerId || "",
      customerName: order.customerName || "",
      amountDue: Math.round(total * 100),
      orderTotal: total,
      itemsSubtotal: order.itemsSubtotal ?? total,
      deliveryFee: order.deliveryFee || 0,
      waitingFee: order.waitingFee || 0,
      paymentTiming: order.paymentTiming || "",
      paymentStatus: order.paymentStatus,
      paymentReference: order.paymentReference || "",
      paymentProofUrl: order.paymentProofUrl || "",
      submittedAt: order.createdAt || null,
    };
  });
}

export async function loadAdminQrVerificationQueue(adminId) {
  const [records, checkoutOrders] = await Promise.all([
    loadAdminQrRecords(adminId, "pending_review"),
    loadAdminCheckoutQrOrders(adminId, "pending_verification"),
  ]);
  const recordSubmissions = records.flatMap((record) =>
    record.submissions
      .filter((submission) => submission.status === "pending_review")
      .map((submission) => ({
        ...record,
        submission,
        previousAttempts: record.submissions.filter(
          (previous) => previous.attemptNumber < submission.attemptNumber,
        ),
      })),
  );

  return [...recordSubmissions, ...checkoutOrders]
    .sort((first, second) => {
      const firstTimestamp = first.submission?.submittedAt || first.submittedAt;
      const secondTimestamp = second.submission?.submittedAt || second.submittedAt;
      const firstDate = firstTimestamp?.toDate
        ? firstTimestamp.toDate().getTime()
        : 0;
      const secondDate = secondTimestamp?.toDate
        ? secondTimestamp.toDate().getTime()
        : 0;

      return firstDate - secondDate;
    });
}

export async function loadAdminOrderPaymentDetails(adminId) {
  requireCurrentAdmin(adminId);
  const [selectionsSnapshot, recordsSnapshot] = await Promise.all([
    getDocs(collection(db, "paymentSelections")),
    getDocs(collection(db, "paymentRecords")),
  ]);
  const recordById = new Map(
    recordsSnapshot.docs.map((recordDocument) => [
      recordDocument.id,
      recordDocument.data(),
    ]),
  );

  return new Map(
    selectionsSnapshot.docs.map((selectionDocument) => {
      const selection = selectionDocument.data();
      const record = recordById.get(selectionDocument.id);
      return [
        selectionDocument.id,
        {
          method: selection.method,
          timing: selection.timing,
          paymentReference: selection.paymentReference || "",
          paymentProofUrl: selection.paymentProofUrl || "",
          paymentStatus: selection.paymentStatus || "",
          status: selection.method === "cash"
            ? "unpaid"
            : record?.paymentStatus
              || selection.paymentStatus
              || "not submitted",
        },
      ];
    }),
  );
}

export async function loadAdminCashPaymentOrders(adminId) {
  requireCurrentAdmin(adminId);
  const ordersSnapshot = await getDocs(collection(db, "orders"));
  return ordersSnapshot.docs
    .map((orderDocument) => ({
      id: orderDocument.id,
      ...orderDocument.data(),
    }))
    .filter((order) => order.paymentMethod === "cash")
    .map((order) => ({
      ...order,
      cashPaymentStatus: order.cashPaymentStatus || "unpaid",
      amountDue: Number(order.total || 0) + Number(order.waitingFee || 0),
    }))
    .sort((first, second) => (
      Number(first.cashPaymentStatus === "paid")
      - Number(second.cashPaymentStatus === "paid")
    ));
}

export async function loadAdminTransactionHistory(adminId) {
  requireCurrentAdmin(adminId);
  const [ordersSnapshot, recordsSnapshot] = await Promise.all([
    getDocs(collection(db, "orders")),
    getDocs(collection(db, "paymentRecords")),
  ]);
  const orderIds = new Set(ordersSnapshot.docs.map((orderDocument) =>
    orderDocument.id,
  ));
  const orderTransactions = ordersSnapshot.docs.flatMap((orderDocument) => {
    const order = orderDocument.data();
    if (order.paymentMethod === "qr") {
      if (!CHECKOUT_QR_PAYMENT_STATUSES.has(order.paymentStatus)) return [];
      return [{
        id: orderDocument.id,
        orderId: orderDocument.id,
        kind: "qr",
        source: "order",
        customerId: order.customerId || "",
        customerName: order.customerName || "",
        orderType: order.orderType || "Unavailable",
        timestamp: order.paymentStatusUpdatedAt || order.createdAt || null,
        total: Number(order.total) || 0,
        paymentStatus: order.paymentStatus,
        paymentReference: order.paymentReference || "",
        paymentProofUrl: order.paymentProofUrl || "",
      }];
    }

    if (order.paymentMethod === "cash") {
      const cashPaymentStatus = order.cashPaymentStatus || "unpaid";
      return [{
        id: orderDocument.id,
        orderId: orderDocument.id,
        kind: "cash",
        source: "order",
        customerId: order.customerId || "",
        customerName: order.customerName || "",
        orderType: order.orderType || "Unavailable",
        timestamp: order.cashPaymentAt || order.createdAt || null,
        total: (Number(order.total) || 0) + (Number(order.waitingFee) || 0),
        paymentStatus: cashPaymentStatus,
        paymentReference: "",
        paymentProofUrl: "",
      }];
    }

    return [];
  });

  const representedOrderIds = new Set(orderIds);
  const legacyTransactions = recordsSnapshot.docs.flatMap((recordDocument) => {
    const record = recordDocument.data();
    const orderId = record.orderId || recordDocument.id;
    if (representedOrderIds.has(orderId)) return [];
    representedOrderIds.add(orderId);
    return [{
      id: `payment-record-${recordDocument.id}`,
      orderId,
      kind: "qr",
      source: "paymentRecord",
      customerId: record.customerId || "",
      customerName: record.customerName || "",
      orderType: record.orderType || "Legacy payment record",
      timestamp: record.updatedAt
        || record.lastSubmittedAt
        || record.createdAt
        || null,
      total: (Number(record.amountDue) || 0) / 100,
      paymentStatus: record.paymentStatus || "unknown",
      paymentReference: record.paymentReference || "",
      paymentProofUrl: record.paymentProofUrl || "",
    }];
  });

  return [...orderTransactions, ...legacyTransactions].sort(
    (first, second) =>
      getTimestampMillis(second.timestamp) - getTimestampMillis(first.timestamp),
  );
}

export async function markCashOrderPaid({ orderId, adminId }) {
  const currentUser = requireCurrentAdmin(adminId);
  if (
    typeof orderId !== "string"
    || !orderId
    || orderId.includes("/")
  ) {
    throw new Error("This order is not eligible for cash payment recording.");
  }

  await updateDoc(doc(db, "orders", orderId), {
    cashPaymentStatus: "paid",
    cashPaymentAt: serverTimestamp(),
    cashPaymentBy: currentUser.uid,
  });
}

export async function loadAdminQrResolutionQueue(adminId) {
  const [records, checkoutOrders] = await Promise.all([
    loadAdminQrRecords(adminId, "admin_review_required"),
    loadAdminCheckoutQrOrders(adminId, "needs_review"),
  ]);
  const legacyRecords = records.filter((record) =>
    record.attemptCount === 3
    && record.currentSubmissionId === "attempt-3"
    && record.submissions.some(
      (submission) =>
        submission.id === "attempt-3"
        && submission.status === "rejected",
    ),
  );

  return [...legacyRecords, ...checkoutOrders];
}

export async function updateAdminQrOrderPaymentStatus({
  orderId,
  adminId,
  paymentStatus,
  rejectionReason = "",
}) {
  const currentUser = requireCurrentAdmin(adminId);
  await updateQrOrderPaymentStatus(
    db,
    orderId,
    currentUser.uid,
    paymentStatus,
    rejectionReason,
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
  const orderReference = doc(db, "orders", orderId);
  const [recordSnapshot, submissionSnapshot, orderSnapshot] = await Promise.all([
    getDoc(recordReference),
    getDoc(submissionReference),
    getDoc(orderReference),
  ]);

  if (!recordSnapshot.exists() || !submissionSnapshot.exists()) {
    const error = new Error(
      "This QR submission or payment record no longer exists.",
    );
    error.code = "not-found";
    throw error;
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
    const error = new Error(
      "This payment record has already been reviewed.",
    );
    error.code = "failed-precondition";
    throw error;
  }

  const timestamp = serverTimestamp();
  const syncedPaymentStatus = decision === "verify"
    ? "paid"
    : record.attemptCount === 3
      ? "needs_review"
      : "rejected";
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

  if (orderSnapshot.exists()) {
    batch.update(orderReference, {
      paymentStatus: syncedPaymentStatus,
      paymentStatusUpdatedAt: timestamp,
      paymentStatusUpdatedBy: currentUser.uid,
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    if (error?.code === "permission-denied") {
      const permissionError = new Error(
        "Permission denied. Administrator access is required to review this payment.",
      );
      permissionError.code = "permission-denied";
      throw permissionError;
    }
    throw error;
  }
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
  const orderReference = doc(db, "orders", orderId);
  const [recordSnapshot, submissionSnapshot, orderSnapshot] = await Promise.all([
    getDoc(recordReference),
    getDoc(finalSubmissionReference),
    getDoc(orderReference),
  ]);
  if (!recordSnapshot.exists() || !submissionSnapshot.exists()) {
    const error = new Error(
      "This payment record or final submission no longer exists.",
    );
    error.code = "not-found";
    throw error;
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
    const error = new Error(
      "This payment record has already been resolved.",
    );
    error.code = "failed-precondition";
    throw error;
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
  if (orderSnapshot.exists()) {
    batch.update(orderReference, {
      paymentStatus: decision,
      paymentStatusUpdatedAt: timestamp,
      paymentStatusUpdatedBy: currentUser.uid,
    });
  }
  await batch.commit().catch((error) => {
    if (error?.code === "permission-denied") {
      const permissionError = new Error(
        "Permission denied. Administrator access is required to resolve this payment.",
      );
      permissionError.code = "permission-denied";
      throw permissionError;
    }
    throw error;
  });
}
