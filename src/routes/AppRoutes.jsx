import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";

import HomePage from "../pages/HomePage";
import MenuPage from "../pages/MenuPage";
import AboutPage from "../pages/AboutPage";
import Login from "../pages/Login";
import Navigation from "../components/Navigation";
import CustomerDashboard from "../pages/CustomerDashboard";
import CheckoutPage from "../pages/CheckoutPage";
import MyOrders from "../pages/MyOrders";
import ReservationsPage from "../pages/ReservationsPage";
import MyReservations from "../pages/MyReservations";
import MyReviews from "../pages/MyReviews";
import AdminDashboard from "../pages/AdminDashboard";
import AdminOrders from "../pages/AdminOrders";
import AdminReservations from "../pages/AdminReservations";
import AdminReviews from "../pages/AdminReviews";
import AdminMenu from "../pages/AdminMenu";
import AdminUsers from "../pages/AdminUsers";
/**
 * AppRoutes Component
 * 
 * This component sets up all the routes for the Cactus Cafe website.
 * It shows the navigation bar on all pages (except login) and routes users to different pages
 * based on the URL.
 * 
 * Routes:
 * - / (home) -> HomePage
 * - /menu -> MenuPage
 * - /about -> AboutPage
 * - /login -> Login page (no navigation bar)
 */
function AppRoutesContent() {
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  return (
    <>
      {/* Navigation bar appears on all pages except login */}
      {!isLoginPage && <Navigation />}
      
      {/* Main content changes based on the current page/route */}
      <Routes>
        {/* Home Page - the main landing page */}
        <Route path="/" element={<HomePage />} />

        {/* Menu Page - will show all menu items later */}
        <Route path="/menu" element={<MenuPage />} />

        {/* About Page - will tell your cafe's story */}
        <Route path="/about" element={<AboutPage />} />

        {/* Login Page - for users to sign in (no navbar) */}
        <Route path="/login" element={<Login />} />
        <Route path="/customer" element={<CustomerDashboard />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/my-orders" element={<MyOrders />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/my-reservations" element={<MyReservations />} />
        <Route path="/my-reviews" element={<MyReviews />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/orders" element={<AdminOrders />} />
        <Route path="/admin/reservations" element={<AdminReservations />} />
        <Route path="/admin/reviews" element={<AdminReviews />} />
        <Route path="/admin/menu" element={<AdminMenu />} />
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
