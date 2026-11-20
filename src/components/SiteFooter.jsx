import { Link } from "react-router-dom";
import { useAuth } from "../context/Authcontext";
import "../styles/SiteFooter.css";

function SiteFooter() {
  const { user } = useAuth();
  const homePath = user ? "/customer" : "/";

  return (
    <footer className="home-footer">
      <div className="footer-inner">
        <div className="footer-branding">
          <Link
            to={homePath}
            className="footer-brand"
            aria-label="Cactus Café home"
          >
            <span className="footer-monogram" aria-hidden="true">
              C
            </span>
            <span>Cactus Café</span>
          </Link>
          <p className="footer-note">Freshly made, thoughtfully shared.</p>
        </div>

        <nav className="footer-navigation" aria-label="Footer navigation">
          <section className="footer-link-group" aria-labelledby="footer-shop">
            <h2 id="footer-shop">Shop</h2>
            <ul>
              <li>
                <Link to="/menu">All Products</Link>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  Best Sellers
                </span>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  Deals
                </span>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  New Products
                </span>
              </li>
            </ul>
          </section>

          <section className="footer-link-group" aria-labelledby="footer-help">
            <h2 id="footer-help">Help</h2>
            <ul>
              <li>
                <Link to="/my-orders">Track Order</Link>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  Returns &amp; Refunds
                </span>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  Shipping Info
                </span>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  FAQs
                </span>
              </li>
            </ul>
          </section>

          <section className="footer-link-group" aria-labelledby="footer-about">
            <h2 id="footer-about">About</h2>
            <ul>
              <li>
                <Link to="/about">Our Story</Link>
              </li>
              <li>
                <span className="footer-link-unavailable" aria-disabled="true">
                  Careers
                </span>
              </li>
              <li>
                <Link to="/terms">Terms &amp; Conditions</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy Policy</Link>
              </li>
            </ul>
          </section>
        </nav>
      </div>
    </footer>
  );
}

export default SiteFooter;
