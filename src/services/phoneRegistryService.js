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

const getProfilePhone = (profile) => normalizePHPhone(
  profile.phoneNumber || profile.phone || "",
);

const isPermissionDenied = (error) => error?.code === "permission-denied"
  || error?.code === "firestore/permission-denied";

export const claimPhoneForUser = async (database, userId, phone) => {
  const normalizedPhone = normalizePhoneOrThrow(phone);
  const userRef = doc(database, "users", userId);
  const phoneRef = doc(database, "phoneRegistry", normalizedPhone);
  const phoneClaimRef = doc(database, "phoneClaims", normalizedPhone);

  await runTransaction(database, async (transaction) => {
    const [phoneClaimSnapshot, userSnapshot] = await Promise.all([
      transaction.get(phoneClaimRef),
      transaction.get(userRef),
    ]);

    if (!userSnapshot.exists()) {
      const error = new Error("Customer profile could not be found.");
      error.code = "profile/not-found";
      throw error;
    }

    const profile = userSnapshot.data();
    const storedPhone = String(
      profile.phoneNumber || profile.phone || "",
    ).trim();
    const userPhone = getProfilePhone(profile);
    if (userPhone && userPhone !== normalizedPhone) {
      const error = new Error(
        "The phone number does not match the customer's saved profile.",
      );
      error.code = "phone/profile-mismatch";
      throw error;
    }
    if (storedPhone && storedPhone !== normalizedPhone) {
      const error = new Error(
        "Save the phone number in normalized Philippine mobile format before claiming it.",
      );
      error.code = "phone/profile-mismatch";
      throw error;
    }
    if (phoneClaimSnapshot.exists() && userPhone !== normalizedPhone) {
      throw createPhoneConflictError();
    }

    transaction.set(phoneRef, {
      uid: userId,
      phone: normalizedPhone,
      updatedAt: serverTimestamp(),
    });
    if (!phoneClaimSnapshot.exists()) {
      transaction.set(phoneClaimRef, { phone: normalizedPhone });
    }

    if (!storedPhone) {
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
  const newPhoneClaimRef = doc(database, "phoneClaims", normalizedPhone);
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
      const previousPhone = getProfilePhone(userProfile);
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
      const previousPhoneClaimRef = previousPhone
        ? doc(database, "phoneClaims", previousPhone)
        : null;
      saveStage = "checking phoneClaims entries";
      const claimRefs = [
        newPhoneClaimRef,
        ...(previousPhoneClaimRef && previousPhone !== normalizedPhone
          ? [previousPhoneClaimRef]
          : []),
        ...(previousPhoneRef && previousPhone !== normalizedPhone
          ? [previousPhoneRef]
          : []),
      ];
      const claimSnapshots = await Promise.all(
        claimRefs.map((claimRef) => transaction.get(claimRef)),
      );
      const newPhoneClaimSnapshot = claimSnapshots[0];
      const previousPhoneClaimSnapshot = previousPhoneClaimRef
        && previousPhone !== normalizedPhone
        ? claimSnapshots[1]
        : null;
      const previousPhoneRegistrySnapshot = previousPhoneRef
        && previousPhone !== normalizedPhone
        ? claimSnapshots[previousPhoneClaimSnapshot ? 2 : 1]
        : null;

      if (newPhoneClaimSnapshot.exists() && previousPhone !== normalizedPhone) {
        throw createPhoneConflictError();
      }

      saveStage = "writing phone claims and users/{uid}";
      transaction.set(newPhoneRef, {
        uid: userId,
        phone: normalizedPhone,
        updatedAt: serverTimestamp(),
      });
      if (!newPhoneClaimSnapshot.exists()) {
        transaction.set(newPhoneClaimRef, { phone: normalizedPhone });
      }

      if (
        previousPhoneRef
        && previousPhone !== normalizedPhone
      ) {
        const ownsPreviousRegistry = previousPhoneRegistrySnapshot?.exists()
          && previousPhoneRegistrySnapshot.data().uid === userId;
        if (ownsPreviousRegistry) transaction.delete(previousPhoneRef);
        if (
          previousPhoneClaimSnapshot?.exists()
          && (
            !previousPhoneRegistrySnapshot?.exists()
            || ownsPreviousRegistry
          )
        ) {
          transaction.delete(previousPhoneClaimRef);
        }
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
    if (
      isPermissionDenied(error)
      && saveStage === "checking blockedPhones/{phone}"
    ) {
      throw createBlockedPhoneError();
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
