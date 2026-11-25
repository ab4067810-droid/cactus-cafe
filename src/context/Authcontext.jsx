import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import { getEffectiveRole } from "../utils/userRole";

/**
 * AuthContext
 *
 * This context manages user authentication for the entire app.
 * It tracks:
 * - Whether a user is currently logged in
 * - The user's email and ID
 * - Whether the app is still checking the login status
 *
 * Usage:
 * 1. Wrap your app with AuthProvider (done in App.jsx)
 * 2. Use the useAuth hook in any component to get user info
 */
const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roleError, setRoleError] = useState("");

  useEffect(() => {
    let isMounted = true;
    let authCheckId = 0;
    let unsubscribeProfile = null;

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      const currentCheckId = ++authCheckId;
      unsubscribeProfile?.();
      unsubscribeProfile = null;
      setLoading(true);
      setRole(null);
      setRoleError("");

      if (!currentUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      setUser({
        uid: currentUser.uid,
        email: currentUser.email,
        displayName:
          typeof currentUser.displayName === "string"
            ? currentUser.displayName
            : "",
        photoURL:
          typeof currentUser.photoURL === "string"
            ? currentUser.photoURL
            : "",
      });

      unsubscribeProfile = onSnapshot(
        doc(db, "users", currentUser.uid),
        (userSnapshot) => {
          if (!isMounted || currentCheckId !== authCheckId) return;

          setLoading(false);

          if (!userSnapshot.exists()) {
            setRole(null);
            setRoleError("Your account role could not be verified.");
            return;
          }

          const profile = userSnapshot.data();
          const profileName =
            typeof profile.fullName === "string" && profile.fullName.trim()
              ? profile.fullName.trim()
              : typeof profile.name === "string"
                ? profile.name.trim()
                : "";

          setUser({
            uid: currentUser.uid,
            email: currentUser.email,
            displayName:
              typeof currentUser.displayName === "string"
                && currentUser.displayName.trim()
                ? currentUser.displayName
                : profileName,
            photoURL:
              typeof currentUser.photoURL === "string"
                && currentUser.photoURL.trim()
                ? currentUser.photoURL
                : typeof profile.photoURL === "string"
                  ? profile.photoURL
                  : "",
          });

          const userRole = getEffectiveRole(profile);

          if (!userRole) {
            setRole(null);
            setRoleError("Your account role could not be verified.");
            return;
          }

          setRole(userRole);
          setRoleError("");
          unsubscribeProfile?.();
          unsubscribeProfile = null;
        },
        (error) => {
          console.error("Error loading authenticated user role:", error);

          if (isMounted && currentCheckId === authCheckId) {
            setRole(null);
            setRoleError("Your account role could not be verified.");
            setLoading(false);
          }
        }
      );
    });

    return () => {
      isMounted = false;
      unsubscribeProfile?.();
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading, roleError }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
