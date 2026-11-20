import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  linkWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "./firebase";

const POLICY_VERSION = "2026-11-16-v1";

const requirePolicyAcceptance = (consent) => {
  if (
    consent?.termsAccepted !== true
    || consent?.privacyAccepted !== true
  ) {
    const error = new Error("Both registration agreements must be accepted.");
    error.code = "profile/consent-required";
    throw error;
  }
};

export const login = async (email, password) => {
  return await signInWithEmailAndPassword(
    auth,
    email,
    password
  );
};

export const addEmailPasswordLogin = async (password) => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const error = new Error("No authenticated account is available.");
    error.code = "auth/no-current-user";
    throw error;
  }

  if (!currentUser.email) {
    const error = new Error("The authenticated account has no email address.");
    error.code = "auth/email-required";
    throw error;
  }

  const hasGoogleProvider = currentUser.providerData.some(
    (provider) => provider.providerId === GoogleAuthProvider.PROVIDER_ID
  );
  const hasPasswordProvider = currentUser.providerData.some(
    (provider) => provider.providerId === EmailAuthProvider.PROVIDER_ID
  );

  if (!hasGoogleProvider || hasPasswordProvider) {
    const error = new Error("This account cannot add an email/password login.");
    error.code = "auth/provider-already-linked";
    throw error;
  }

  const emailCredential = EmailAuthProvider.credential(
    currentUser.email,
    password
  );

  try {
    return await linkWithCredential(currentUser, emailCredential);
  } catch (error) {
    if (error?.code !== "auth/requires-recent-login") {
      throw error;
    }
  }

  const reauthentication = await reauthenticateWithPopup(
    currentUser,
    new GoogleAuthProvider()
  );

  if (
    auth.currentUser?.uid !== currentUser.uid
    || reauthentication.user.uid !== currentUser.uid
  ) {
    const error = new Error(
      "The signed-in account changed during Google reauthentication."
    );
    error.code = "auth/user-changed";
    throw error;
  }

  return linkWithCredential(reauthentication.user, emailCredential);
};

const createCustomerProfile = async (
  user,
  name,
  photoURL,
  consent,
  nameFields,
) => {
  const userRef = doc(db, "users", user.uid);
  try {
    return await runTransaction(db, async (transaction) => {
      const userSnapshot = await transaction.get(userRef);

      if (userSnapshot.exists()) {
        return {
          profile: userSnapshot.data(),
          created: false,
        };
      }

      const profile = {
        name,
        fullName: name,
        ...(nameFields
          ? {
              firstName: nameFields.firstName,
              middleInitial: nameFields.middleInitial,
              lastName: nameFields.lastName,
            }
          : {}),
        email: user.email || "",
        ...(photoURL !== undefined ? { photoURL } : {}),
        role: "customer",
        createdAt: serverTimestamp(),
        ...(consent
          ? {
              termsAccepted: true,
              privacyAccepted: true,
              acceptedAt: serverTimestamp(),
              policyVersion: POLICY_VERSION,
            }
          : {}),
      };

      transaction.set(userRef, profile);
      return { profile, created: true };
    });
  } catch (error) {
    const profileError = new Error(
      "The account was created, but its customer profile could not be saved."
    );
    profileError.code = "profile/create-failed";
    profileError.cause = error;
    throw profileError;
  }
};

export const signInWithGoogle = async () => {
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  const googleUser = credential.user;
  const profileResult = await createCustomerProfile(
    googleUser,
    googleUser.displayName || "",
    googleUser.photoURL || ""
  );

  return { ...credential, ...profileResult };
};

export const registerWithGoogle = async (consent) => {
  requirePolicyAcceptance(consent);

  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  const isNewUser = getAdditionalUserInfo(credential)?.isNewUser === true;
  const googleUser = credential.user;
  const profileResult = await createCustomerProfile(
    googleUser,
    googleUser.displayName || "",
    googleUser.photoURL || "",
    consent
  );

  return { ...credential, ...profileResult, isNewUser };
};

export const registerCustomer = async (
  nameFields,
  email,
  password,
  consent,
) => {
  requirePolicyAcceptance(consent);

  const cleanNameFields = {
    firstName: String(nameFields.firstName || "").trim(),
    middleInitial: String(nameFields.middleInitial || "").trim(),
    lastName: String(nameFields.lastName || "").trim(),
  };
  const fullName = [
    cleanNameFields.firstName,
    cleanNameFields.middleInitial,
    cleanNameFields.lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );
  const profileResult = await createCustomerProfile(
    credential.user,
    fullName,
    undefined,
    consent,
    cleanNameFields,
  );

  return { ...credential, ...profileResult };
};

export const retryCustomerProfile = async (name, consent, nameFields) => {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    const error = new Error("No authenticated account is available to recover.");
    error.code = "profile/recovery-session-missing";
    throw error;
  }

  if (consent) {
    requirePolicyAcceptance(consent);
  }

  const isGoogleUser = currentUser.providerData.some(
    (provider) => provider.providerId === "google.com"
  );

  return createCustomerProfile(
    currentUser,
    isGoogleUser ? currentUser.displayName || name : name,
    isGoogleUser ? currentUser.photoURL || "" : undefined,
    consent,
    isGoogleUser ? undefined : nameFields,
  );
};

export const logout = async () => {
  return await signOut(auth);
};