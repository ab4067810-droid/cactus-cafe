import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { normalizePHPhone } from "../utils/phoneUtils.js";

const normalizePhoneOrThrow = (phone) => {
  const normalizedPhone = normalizePHPhone(phone);
  if (normalizedPhone) return normalizedPhone;

  const error = new Error(
    "Enter a valid 11-digit Philippine mobile number (e.g., 0917 123 4567).",
  );
  error.code = "phone/invalid";
  throw error;
};

export const isPhoneBlocked = async (database, phone) => {
  try {
    const blockedPhone = await getBlockedPhone(database, phone);
    return blockedPhone !== null;
  } catch (error) {
    if (
      error?.code === "permission-denied"
      || error?.code === "firestore/permission-denied"
    ) {
      return true;
    }
    throw error;
  }
};

export const getBlockedPhone = async (database, phone) => {
  const normalizedPhone = normalizePhoneOrThrow(phone);
  const blockedPhoneRef = doc(database, "blockedPhones", normalizedPhone);
  const blockedPhoneSnapshot = await getDoc(blockedPhoneRef);

  return blockedPhoneSnapshot.exists()
    ? { id: blockedPhoneSnapshot.id, ...blockedPhoneSnapshot.data() }
    : null;
};

export const listBlockedPhones = async (database) => {
  const blockedPhoneSnapshot = await getDocs(
    collection(database, "blockedPhones"),
  );

  return blockedPhoneSnapshot.docs.map((blockedPhoneDoc) => ({
    id: blockedPhoneDoc.id,
    ...blockedPhoneDoc.data(),
  }));
};

export const blockPhone = async (
  database,
  phone,
  adminId,
  reason = "",
  customerUid,
  metadata = {},
) => {
  const normalizedPhone = normalizePhoneOrThrow(phone);
  const cleanReason = String(reason).trim();
  if (
    metadata !== null
    && (typeof metadata !== "object" || Array.isArray(metadata))
  ) {
    throw new Error("Blocked phone metadata must be an object.");
  }

  const cleanCustomerName = metadata?.customerName === undefined
    || metadata.customerName === null
    ? ""
    : typeof metadata.customerName === "string"
      ? metadata.customerName.trim()
      : null;
  const cleanAddress = metadata?.address === undefined
    || metadata.address === null
    ? ""
    : typeof metadata.address === "string"
      ? metadata.address.trim()
      : null;

  if (!adminId) {
    throw new Error("An administrator ID is required to block a phone number.");
  }
  if (cleanReason.length > 500) {
    throw new Error("The block reason must be 500 characters or fewer.");
  }
  if (cleanCustomerName === null || cleanCustomerName.length > 120) {
    throw new Error("The customer name must be text with 120 characters or fewer.");
  }
  if (cleanAddress === null || cleanAddress.length > 500) {
    throw new Error("The address must be text with 500 characters or fewer.");
  }

  await setDoc(doc(database, "blockedPhones", normalizedPhone), {
    phone: normalizedPhone,
    phoneNumber: normalizedPhone,
    reason: cleanReason,
    blockedBy: adminId,
    blockedAt: serverTimestamp(),
    ...(customerUid ? { customerUid } : {}),
    ...(cleanCustomerName ? { customerName: cleanCustomerName } : {}),
    ...(cleanAddress ? { address: cleanAddress } : {}),
  });
};

export const unblockPhone = async (database, phone) => {
  const normalizedPhone = normalizePhoneOrThrow(phone);
  await deleteDoc(doc(database, "blockedPhones", normalizedPhone));
};
