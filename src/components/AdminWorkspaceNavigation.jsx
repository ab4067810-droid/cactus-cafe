import { NavLink } from "react-router-dom";
import { useAuth } from "../context/Authcontext";

const workspaceLinks = [
  {
    icon: "⚙",
    label: "Delivery Settings",
    to: "/admin/delivery-settings",
    role: "admin",
  },
  { icon: "☆", label: "Reviews", to: "/admin/reviews", role: "admin" },
  {
    icon: "◎",
    label: "Customers & Security",
    to: "/admin/users",
    role: "admin",
  },
  {
    icon: "▤",
    label: "Monthly Records",
    to: "/admin/monthly-records",
    role: "admin",
  },
  {
    icon: "▦",
    label: "Menu Management",
    to: "/admin/menu",
    role: "staff",
  },
  { icon: "↗", label: "Orders", to: "/admin/orders", role: "staff" },
  {
    icon: "₱",
    label: "Payment Management",
    to: "/admin/payments",
    role: "staff",
  },
  {
    icon: "◷",
    label: "Reservations",
    to: "/admin/reservations",
    role: "staff",
  },
];

function AdminWorkspaceNavigation({ classPrefix, onNavigate }) {
  const { role } = useAuth();
  const visibleLinks = workspaceLinks.filter((link) => link.role === role);

  return visibleLinks.map(({ icon, label, to }) => (
    <NavLink
      key={to}
      to={to}
      end
      className={({ isActive }) =>
        `${classPrefix}-nav-link${isActive ? " active" : ""}`
      }
      onClick={onNavigate}
    >
      <span className={`${classPrefix}-nav-icon`} aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </NavLink>
  ));
}

export default AdminWorkspaceNavigation;
