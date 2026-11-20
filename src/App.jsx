import AppRoutes from "./routes/AppRoutes";
import { AuthProvider } from "./context/Authcontext";
import { CartProvider } from "./context/CartContext";
import "./styles/App.css";

/**
 * App Component - The main app
 * 
 * This is the root component of the Cactus Cafe website.
 * It wraps everything with AuthProvider so that any component can access user login info.
 * 
 * Structure:
 * - AuthProvider: manages user login state
 *   - AppRoutes: contains all the different pages and navigation
 */
function App() {
  return (
    <div id="App">
      <AuthProvider>
        <CartProvider>
          <AppRoutes />
        </CartProvider>
      </AuthProvider>
    </div>
  );
}

export default App;