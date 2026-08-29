import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBxALHO0ApnlD_Sp9BsrJxSNhc-3F3g8fc",
  authDomain: "cactus-cafev1.firebaseapp.com",
  projectId: "cactus-cafev1",
  storageBucket: "cactus-cafev1.firebasestorage.app",
  messagingSenderId: "215493411258",
  appId: "1:215493411258:web:4f88898eb9af7c2e215d83",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);