import {
  createContext,
  useContext,
  useEffect,
  useState, 
} from "react";

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // This runs when the app first loads to check if anyone is logged in
    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        if (currentUser) {
          // User is logged in
          setUser({
            uid: currentUser.uid,
            email: currentUser.email,
          });
        } else {
          // User is not logged in
          setUser(null);
        }

        // Done checking, app can now render fully
        setLoading(false);
      }
    );

    // Clean up this listener when component is removed
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}