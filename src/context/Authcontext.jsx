import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

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

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const currentCheckId = ++authCheckId;
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

      try {
        const userSnapshot = await getDoc(
          doc(db, "users", currentUser.uid)
        );

        if (!isMounted || currentCheckId !== authCheckId) {
          return;
        }

        if (!userSnapshot.exists()) {
          setRoleError("Your account role could not be verified.");
          return;
        }

        const userRole = userSnapshot.data().role;

        if (typeof userRole !== "string" || !userRole.trim()) {
          setRoleError("Your account role could not be verified.");
          return;
        }

        setRole(userRole);
      } catch (error) {
        console.error("Error loading authenticated user role:", error);

        if (isMounted && currentCheckId === authCheckId) {
          setRoleError("Your account role could not be verified.");
        }
      } finally {
        if (isMounted && currentCheckId === authCheckId) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
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