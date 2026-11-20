import {
  BrowserRouter,
  Navigate,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";

import HomePage from "../pages/HomePage";
import MenuPage from "../pages/MenuPage";
import AboutPage from "../pages/AboutPage";
import Login from "../pages/login";
import Register from "../pages/Register";
import Terms from "../pages/Terms";
import PrivacyPolicy from "../pages/PrivacyPolicy";
import Navigation from "../components/Navigation";
import CheckoutPage from "../pages/CheckoutPage";
import MyOrders from "../pages/MyOrders";
import Favorites from "../pages/Favorites";
import ReservationsPage from "../pages/ReservationsPage";
import MyReservations from "../pages/MyReservations";
import MyReviews from "../pages/MyReviews";
import MyAccount from "../pages/MyAccount";
import AdminOrders from "../pages/AdminOrders";
import AdminReservations from "../pages/AdminReservations";
import AdminReviews from "../pages/AdminReviews";
import AdminMonthlyRecords from "../pages/AdminMonthlyRecords";
import AdminMenu from "../pages/AdminMenu";
import AdminUsers from "../pages/AdminUsers";
import AdminPayments from "../pages/AdminPayments";
import BlockedPhoneWarningModal from "../components/BlockedPhoneWarningModal";

/**
 * AppRoutes Component
 * 
 * This component sets up all the routes for the Cactus Cafe website.
 * It shows the navigation bar on all pages except login and routes users
 * to the appropriate page based on the URL.
 * 
 * Routes:
 * - / (home) -> HomePage
 * - /menu -> MenuPage
 * - /about -> AboutPage
 * - /login -> Login page (no navigation bar)
 */
function AppRoutesContent() {
  const location = useLocation();
  const isAuthPage = ["/login", "/log%20in", "/register"].includes(
    location.pathname,
  );
  const hasAdminSidebar = [
    "/admin/menu",
    "/admin/orders",
    "/admin/reservations",
    "/admin/reviews",
    "/admin/monthly-records",
    "/admin/payments",
    "/admin/users",
  ].includes(location.pathname);

  return (
    <>
      <BlockedPhoneWarningModal />
      {!isAuthPage && !hasAdminSidebar && <Navigation />}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/log in" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<Register />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/customer" element={<Navigate to="/menu" replace />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/my-account" element={<MyAccount />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/my-reservations" element={<MyReservations />} />
        <Route path="/my-reviews" element={<MyReviews />} />
        <Route path="/admin" element={<Navigate to="/admin/menu" replace />} />
        <Route path="/admin/orders" element={<AdminOrders />} />
        <Route path="/admin/reservations" element={<AdminReservations />} />
        <Route path="/admin/reviews" element={<AdminReviews />} />
        <Route
          path="/admin/monthly-records"
          element={<AdminMonthlyRecords />}
        />
        <Route path="/admin/menu" element={<AdminMenu />} />
        <Route path="/admin/payments" element={<AdminPayments />} />
        <Route path="/admin/users" element={<AdminUsers />} />
      </Routes>
    </>
  );
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <AppRoutesContent />
    </BrowserRouter>
  );
}

export default AppRoutes;
