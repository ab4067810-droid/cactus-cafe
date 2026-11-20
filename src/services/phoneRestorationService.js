import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { normalizePHPhone } from "../utils/phoneUtils.js";

const createRestorationError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getCreatedAtMillis = (request) => {
  const createdAt = request.createdAt;
  if (typeof createdAt?.toMillis === "function") {
    return createdAt.toMillis();
  }
  if (createdAt instanceof Date) {
    return createdAt.getTime();
  }
  return 0;
};

const mapRequestDocs = (snapshot) =>
  snapshot.docs.map((requestDoc) => ({
    id: requestDoc.id,
    ...requestDoc.data(),
  }));

export const getCustomerPhoneRestorationRequests = async (
  database,
  userId,
  phone,
) => {
  const normalizedPhone = normalizePHPhone(phone);
  if (!userId || !normalizedPhone) return [];

  const requestSnapshot = await getDocs(
    query(
      collection(database, "phoneRestorationRequests"),
      where("uid", "==", userId),
    ),
  );
  return mapRequestDocs(requestSnapshot)
    .filter((restorationRequest) =>
      restorationRequest.phoneNumber === normalizedPhone,
    )
    .sort((first, second) =>
      getCreatedAtMillis(second) - getCreatedAtMillis(first),
    );
};

export const listPhoneRestorationRequests = async (database) => {
  const requestsCollection = collection(
    database,
    "phoneRestorationRequests",
  );
  const [pendingSnapshot, recentSnapshot] = await Promise.all([
    getDocs(query(requestsCollection, where("status", "==", "pending"))),
    getDocs(
      query(
        requestsCollection,
        orderBy("createdAt", "desc"),
        limit(20),
      ),
    ),
  ]);
  const requestsById = new Map(
    [...mapRequestDocs(recentSnapshot), ...mapRequestDocs(pendingSnapshot)]
      .map((restorationRequest) => [
        restorationRequest.id,
        restorationRequest,
      ]),
  );

  return [...requestsById.values()].sort(
    (first, second) =>
      getCreatedAtMillis(second) - getCreatedAtMillis(first),
  );
};

export const createPhoneRestorationRequest = async (
  database,
  userId,
  phone,
  reason,
) => {
  const normalizedPhone = normalizePHPhone(phone);
  const cleanReason = String(reason || "").trim();

  if (!userId) {
    throw createRestorationError(
      "phone-restoration/unauthenticated",
      "Sign in before requesting phone number restoration.",
    );
  }
  if (!normalizedPhone) {
    throw createRestorationError(
      "phone-restoration/invalid-phone",
      "Your profile does not contain a valid normalized phone number.",
    );
  }
  if (!cleanReason) {
    throw createRestorationError(
      "phone-restoration/empty-reason",
      "Enter a reason for requesting restoration.",
    );
  }
  if (cleanReason.length > 1000) {
    throw createRestorationError(
      "phone-restoration/reason-too-long",
      "Your reason must be 1,000 characters or fewer.",
    );
  }

  const requestRef = doc(collection(database, "phoneRestorationRequests"));
  const pendingRef = doc(database, "phoneRestorationPending", userId);
  const blockedPhoneRef = doc(database, "blockedPhones", normalizedPhone);

  await runTransaction(database, async (transaction) => {
    const [pendingSnapshot, blockedPhoneSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(blockedPhoneRef),
    ]);

    if (pendingSnapshot.exists()) {
      throw createRestorationError(
        "phone-restoration/pending",
        "You already have a pending phone restoration request.",
      );
    }
    if (!blockedPhoneSnapshot.exists()) {
      throw createRestorationError(
        "phone-restoration/not-blocked",
        "This phone number is no longer blocked.",
      );
    }

    transaction.set(requestRef, {
      uid: userId,
      phoneNumber: normalizedPhone,
      reason: cleanReason,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(pendingRef, {
      uid: userId,
      phoneNumber: normalizedPhone,
      requestId: requestRef.id,
      createdAt: serverTimestamp(),
    });
  });

  return requestRef.id;
};

export const resolvePhoneRestorationRequest = async (
  database,
  requestId,
  decision,
  adminId,
) => {
  if (!["approved", "rejected"].includes(decision)) {
    throw createRestorationError(
      "phone-restoration/invalid-decision",
      "Choose approve or reject for this restoration request.",
    );
  }
  if (!adminId) {
    throw createRestorationError(
      "phone-restoration/admin-required",
      "An administrator ID is required to resolve this request.",
    );
  }

  const requestRef = doc(database, "phoneRestorationRequests", requestId);

  await runTransaction(database, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists()) {
      throw createRestorationError(
        "phone-restoration/not-found",
        "The restoration request could not be found.",
      );
    }
    const restorationRequest = requestSnapshot.data();
    if (restorationRequest.status !== "pending") {
      throw createRestorationError(
        "phone-restoration/not-pending",
        "This restoration request has already been resolved.",
      );
    }

    const pendingRef = doc(
      database,
      "phoneRestorationPending",
      restorationRequest.uid,
    );
    const blockedPhoneRef = doc(
      database,
      "blockedPhones",
      restorationRequest.phoneNumber,
    );
    const [pendingSnapshot, blockedPhoneSnapshot] = await Promise.all([
      transaction.get(pendingRef),
      transaction.get(blockedPhoneRef),
    ]);
    if (
      pendingSnapshot.exists()
      && pendingSnapshot.data().requestId !== requestId
    ) {
      throw createRestorationError(
        "phone-restoration/pending-mismatch",
        "A different restoration request is currently pending for this customer.",
      );
    }

    transaction.update(requestRef, {
      status: decision,
      reviewedBy: adminId,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (pendingSnapshot.exists()) transaction.delete(pendingRef);
    if (decision === "approved" && blockedPhoneSnapshot.exists()) {
      transaction.delete(blockedPhoneRef);
    }
  });
};
