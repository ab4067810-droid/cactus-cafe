import { NavLink } from "react-router-dom";
import "../styles/Navigation.css";

function Navigation() {
  const navLinkClass = ({ isActive }) =>
    isActive ? "navbar-link active" : "navbar-link";

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <NavLink to="/" className="navbar-logo" aria-label="Cactus Cafe home">
          <span className="navbar-monogram" aria-hidden="true">
            C
          </span>
          <span>Cactus Cafe</span>
        </NavLink>

        <div className="navbar-actions">
          <ul className="navbar-links">
            <li>
              <NavLink to="/" end className={navLinkClass}>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to="/menu" className={navLinkClass}>
                Menu
              </NavLink>
            </li>
            <li>
              <NavLink to="/about" className={navLinkClass}>
                About
              </NavLink>
            </li>
          </ul>

          <NavLink to="/login" className="login-btn">
            Login
          </NavLink>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;