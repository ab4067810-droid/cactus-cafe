import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

export const DUPLICATE_PAYMENT_REFERENCE_MESSAGE =
  "This GCash reference number has already been used in our system. Verify your receipt and upload the correct GCash payment screenshot.";
export const PAYMENT_REFERENCE_CHECK_ERROR =
  "Unable to verify this payment reference. Please try again before submitting.";

const PAYMENT_REFERENCE_SOURCE_TYPES = new Set([
  "checkout",
  "reservation",
  "order_payment",
]);

export const normalizePaymentReference = (reference) =>
  String(reference ?? "")
    .trim()
    .replace(/[\s-]/g, "")
    .toUpperCase();

export const isValidNormalizedPaymentReference = (reference) =>
  typeof reference === "string"
  && /^[A-Z0-9]{1,100}$/.test(reference);

export async function checkPaymentReference(database, userId, reference) {
  if (!userId) {
    throw new Error("Sign in before checking a payment reference.");
  }

  const normalizedReference = normalizePaymentReference(reference);
  if (!isValidNormalizedPaymentReference(normalizedReference)) {
    throw new Error("Enter a valid GCash / Maya reference number.");
  }

  const registrySnapshot = await getDoc(
    doc(database, "paymentReferences", normalizedReference),
  );
  if (registrySnapshot.exists()) return true;

  const [
    ordersSnapshot,
    reservationsSnapshot,
    selectionsSnapshot,
    recordsSnapshot,
  ] = await Promise.all([
    getDocs(query(
      collection(database, "orders"),
      where("customerId", "==", userId),
    )),
    getDocs(query(
      collection(database, "reservations"),
      where("userId", "==", userId),
    )),
    getDocs(query(
      collection(database, "paymentSelections"),
      where("customerId", "==", userId),
    )),
    getDocs(query(
      collection(database, "paymentRecords"),
      where("customerId", "==", userId),
    )),
  ]);
  const matchesReference = (snapshot, field) =>
    snapshot.docs.some((paymentDocument) =>
      normalizePaymentReference(paymentDocument.data()?.[field])
        === normalizedReference,
    );

  if (
    matchesReference(ordersSnapshot, "paymentReference")
    || matchesReference(reservationsSnapshot, "paymentReference")
    || matchesReference(selectionsSnapshot, "paymentReference")
  ) {
    return true;
  }

  const submissionSnapshots = await Promise.all(
    recordsSnapshot.docs.flatMap((paymentRecord) =>
      getDocs(query(
        collection(
          database,
          "paymentRecords",
          paymentRecord.id,
          "submissions",
        ),
        where("customerId", "==", userId),
      )),
    ),
  );

  return submissionSnapshots.some((snapshot) =>
    matchesReference(snapshot, "referenceNumber"),
  );
}

export function claimPaymentReference(
  batch,
  database,
  userId,
  reference,
  sourceType,
) {
  const normalizedReference = normalizePaymentReference(reference);
  if (!userId || !isValidNormalizedPaymentReference(normalizedReference)) {
    throw new Error("Enter a valid GCash / Maya reference number.");
  }
  if (!PAYMENT_REFERENCE_SOURCE_TYPES.has(sourceType)) {
    throw new Error("Unsupported payment reference source.");
  }

  batch.set(doc(database, "paymentReferences", normalizedReference), {
    normalizedReference,
    sourceType,
    createdBy: userId,
    createdAt: serverTimestamp(),
  });

  return normalizedReference;
}
