import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../services/firebase";

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

          const userRole = userSnapshot.data().role;

          if (typeof userRole !== "string" || !userRole.trim()) {
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

export function useAuth() {
  return useContext(AuthContext);
}
