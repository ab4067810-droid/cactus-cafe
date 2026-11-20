import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { normalizePHPhone } from "../utils/phoneUtils.js";

const createPhoneConflictError = () => {
  const error = new Error(
    "This phone number is already registered to another account. Please use another phone number.",
  );
  error.code = "phone/already-registered";
  return error;
};

const createBlockedPhoneError = () => {
  const error = new Error(
    "This mobile number is blocked and cannot be saved.",
  );
  error.code = "phone/blocked";
  return error;
};

const normalizePhoneOrThrow = (phone) => {
  const normalizedPhone = normalizePHPhone(phone);
  if (normalizedPhone) return normalizedPhone;

  const error = new Error(
    "Enter a valid 11-digit Philippine mobile number (e.g., 0917 123 4567).",
  );
  error.code = "phone/invalid";
  throw error;
};

export const claimPhoneForUser = async (database, userId, phone) => {
  const normalizedPhone = normalizePhoneOrThrow(phone);
  const userRef = doc(database, "users", userId);
  const phoneRef = doc(database, "phoneRegistry", normalizedPhone);

  await runTransaction(database, async (transaction) => {
    const [phoneSnapshot, userSnapshot] = await Promise.all([
      transaction.get(phoneRef),
      transaction.get(userRef),
    ]);

    if (
      phoneSnapshot.exists()
      && phoneSnapshot.data().uid !== userId
    ) {
      throw createPhoneConflictError();
    }

    if (!phoneSnapshot.exists()) {
      transaction.set(phoneRef, {
        uid: userId,
        phone: normalizedPhone,
        updatedAt: serverTimestamp(),
      });
    }

    if (
      userSnapshot.exists()
      && !String(
        userSnapshot.data().phoneNumber || userSnapshot.data().phone || "",
      ).trim()
    ) {
      transaction.update(userRef, {
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        phoneUpdatedAt: serverTimestamp(),
      });
    }
  });

  return normalizedPhone;
};

export const saveCustomerProfileWithPhone = async (
  database,
  userId,
  phone,
  profileUpdates,
) => {
  const normalizedPhone = normalizePhoneOrThrow(phone);
  const userRef = doc(database, "users", userId);
  const newPhoneRef = doc(database, "phoneRegistry", normalizedPhone);
  let saveStage = "starting profile transaction";

  try {
    await runTransaction(database, async (transaction) => {
      saveStage = "reading users/{uid}";
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists()) {
        const error = new Error("Customer profile could not be found.");
        error.code = "profile/not-found";
        throw error;
      }

      const userProfile = userSnapshot.data();
      const storedPhone = String(
        userProfile.phoneNumber || userProfile.phone || "",
      ).trim();
      const previousPhone = normalizePHPhone(
        storedPhone,
      );
      const phoneChanged = previousPhone !== normalizedPhone
        || (
          userProfile.phone
          && userProfile.phone !== normalizedPhone
        )
        || (
          userProfile.phoneNumber
          && userProfile.phoneNumber !== normalizedPhone
        );
      if (phoneChanged) {
        saveStage = "checking blockedPhones/{phone}";
        const blockedPhoneSnapshot = await transaction.get(
          doc(database, "blockedPhones", normalizedPhone),
        );
        if (blockedPhoneSnapshot.exists()) {
          throw createBlockedPhoneError();
        }
      }

      const previousPhoneRef = previousPhone
        ? doc(database, "phoneRegistry", previousPhone)
        : null;
      const phoneRefs = previousPhoneRef && previousPhone !== normalizedPhone
        ? [newPhoneRef, previousPhoneRef]
        : [newPhoneRef];
      saveStage = "reading phoneRegistry entries";
      const phoneSnapshots = await Promise.all(
        phoneRefs.map((phoneRef) => transaction.get(phoneRef)),
      );
      const newPhoneSnapshot = phoneSnapshots[0];

      if (
        newPhoneSnapshot.exists()
        && newPhoneSnapshot.data().uid !== userId
      ) {
        throw createPhoneConflictError();
      }

      saveStage = "writing phoneRegistry and users/{uid}";
      transaction.set(newPhoneRef, {
        uid: userId,
        phone: normalizedPhone,
        updatedAt: serverTimestamp(),
      });

      if (
        previousPhoneRef
        && previousPhone !== normalizedPhone
        && phoneSnapshots[1].exists()
        && phoneSnapshots[1].data().uid === userId
      ) {
        transaction.delete(previousPhoneRef);
      }

      transaction.update(userRef, {
        ...profileUpdates,
        phone: normalizedPhone,
        phoneNumber: normalizedPhone,
        ...(
          phoneChanged || !userProfile.phoneUpdatedAt
            ? { phoneUpdatedAt: serverTimestamp() }
            : {}
        ),
      });
    });
  } catch (error) {
    if (
      error?.code?.startsWith("phone/")
      || error?.code === "profile/not-found"
    ) {
      throw error;
    }

    const profileSaveError = new Error(
      error?.message || "Customer profile save failed.",
    );
    profileSaveError.code = error?.code || "profile/save-failed";
    profileSaveError.operation = saveStage;
    profileSaveError.cause = error;
    throw profileSaveError;
  }
};
