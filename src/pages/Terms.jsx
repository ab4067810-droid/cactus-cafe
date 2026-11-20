import { Link } from "react-router-dom";
import { useAuth } from "../context/Authcontext";
import { CAFE_CONTACT_PHONE } from "../constants/cafeInfo.js";
import "../styles/LegalPages.css";

const sections = [
  { id: "introduction", label: "Introduction and acceptance" },
  { id: "accounts", label: "Customer accounts" },
  { id: "orders", label: "Online orders and approval" },
  { id: "pickup-delivery", label: "Pickup and delivery" },
  { id: "payments", label: "Payment options" },
  { id: "cancellations", label: "Order cancellations" },
  { id: "refunds", label: "Refunds and adjustments" },
  { id: "responsibilities", label: "Customer responsibilities" },
  { id: "changes", label: "Changes to these terms" },
  { id: "contact", label: "Contact information" },
];

function PolicyTableOfContents() {
  return (
    <aside className="legal-toc">
      <nav aria-label="Terms and Conditions sections">
        <h2>On this page</h2>
        <ol>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

function Terms() {
  const { user } = useAuth();
  const homePath = user ? "/customer" : "/";
  const returnPath = user ? "/customer" : "/register";

  return (
    <main className="legal-page">
      <div className="legal-shell">
        <header className="legal-header">
          <Link className="legal-brand" to={homePath} aria-label="Cactus Café home">
            <span className="legal-brand-mark" aria-hidden="true">C</span>
            <span>Cactus Café</span>
          </Link>
          <p className="legal-eyebrow">CUSTOMER INFORMATION</p>
          <h1>Terms and Conditions</h1>
          <p className="legal-intro">
            These terms describe how Cactus Café’s online ordering and related
            customer features currently work.
          </p>
          <dl className="legal-meta">
            <div>
              <dt>Effective date</dt>
              <dd>November 16, 2026</dd>
            </div>
            <div>
              <dt>Policy version</dt>
              <dd>2026-11-16-v1</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>Isabela, Negros Occidental, Philippines</dd>
            </div>
          </dl>
        </header>

        <div className="legal-layout">
          <PolicyTableOfContents />

          <article className="legal-document">
            <aside className="legal-review-notice" role="note">
              <strong>Business-owner review required.</strong> Bracketed contact
              details and operational decisions must be completed and verified
              before this document is treated as final.
            </aside>

            <section id="introduction" className="legal-section">
              <h2>1. Introduction and acceptance</h2>
              <p>
                These Terms and Conditions apply to Cactus Café’s website,
                customer accounts, online order requests, reservations, and
                reviews. By creating an account or using these features, you
                agree to these terms. If you do not agree, do not use the
                relevant feature.
              </p>
              <p>
                Cactus Café is located in Isabela, Negros Occidental,
                Philippines. These terms should be read with our{" "}
                <Link to="/privacy">Privacy Policy</Link>.
              </p>
            </section>

            <section id="accounts" className="legal-section">
              <h2>2. Customer accounts</h2>
              <p>
                You may sign in using email and password or Google
                Authentication. You are responsible for providing accurate
                account details, keeping your sign-in credentials private, and
                notifying Cactus Café if you believe your account has been used
                without permission.
              </p>
              <p>
                Use your account only for your own lawful ordering and customer
                activities. Account access and available features may depend on
                the role associated with your account.
              </p>
            </section>

            <section id="orders" className="legal-section">
              <h2>3. Online orders and approval</h2>
              <p>
                Submitting checkout details creates an order request. The
                website initially records the request as pending; submission
                alone is not confirmation that Cactus Café has accepted it.
                An administrator reviews and approves or rejects the request.
                An approved order is created after the request and its pricing
                have been reviewed.
              </p>
              <p>
                Menu availability and prices may need confirmation when an
                order is reviewed. If an order cannot be fulfilled as
                requested, Cactus Café should contact you using the details
                provided with the request.
              </p>
            </section>

            <section id="pickup-delivery" className="legal-section">
              <h2>4. Pickup and delivery arrangements</h2>
              <p>
                Checkout currently supports takeout and delivery order types.
                For delivery, provide a complete address and any helpful
                delivery instructions. Your name and contact number are
                collected with an order request. The website does not specify
                delivery zones, fees, or guaranteed delivery times; confirm
                those details with Cactus Café before relying on delivery.
              </p>
              <p>
                Keep your phone available for order coordination. Any
                estimated preparation, pickup, or delivery time is subject to
                confirmation by Cactus Café.
              </p>
            </section>

            <section id="payments" className="legal-section">
              <h2>5. Payment options</h2>
              <p>
                Checkout currently records a selection of Cash or generic QR
                Payment, and a separate timing choice of Advance Payment or Pay
                Later. Pay Later is described in the interface as payment when
                the order is handed over. The website does not define a
                separate Cash on Delivery workflow.
              </p>
              <p>
                The current website does not identify a QR payment provider,
                display an in-app payment QR code, accept payment screenshots,
                or automatically verify QR payments. Selecting a payment
                option is not a payment receipt or confirmation. Follow
                payment instructions confirmed directly by Cactus Café and
                retain any receipt issued by the payment provider.
              </p>
            </section>

            <section id="cancellations" className="legal-section">
              <h2>6. Order cancellations</h2>
              <p>
                The current customer order page does not provide a
                self-service cancellation control. If you need to change or
                cancel a request, contact Cactus Café promptly using the
                official contact details that will be added below. A request
                is not cancelled until Cactus Café confirms the change.
              </p>
              <p>
                Administrators can update an order’s status to Cancelled.
                Cancellation availability may depend on the order’s status and
                preparation progress. The business should confirm its
                cancellation procedure before publishing this policy.
              </p>
            </section>

            <section id="refunds" className="legal-section">
              <h2>7. Refunds and adjustments</h2>
              <p>
                The website does not currently provide a customer refund
                request tool or an automated refund process. Refund examples
                shown in the administrative payment screen are sample data,
                not live refund requests.
              </p>
              <p>
                To ask about a payment or possible adjustment, contact Cactus
                Café with your order details using the official contact
                information below. Requests must be reviewed individually and
                handled in accordance with applicable law. This website does
                not promise a particular refund outcome, payment method, or
                processing time. The business must confirm its actual refund
                procedure before publication.
              </p>
            </section>

            <section id="responsibilities" className="legal-section">
              <h2>8. Customer responsibilities</h2>
              <ul>
                <li>Provide accurate contact, order, and delivery details.</li>
                <li>Review your order request and payment selection before submitting.</li>
                <li>Use the site lawfully and do not interfere with its operation.</li>
                <li>Contact Cactus Café promptly if order details need correction.</li>
              </ul>
            </section>

            <section id="changes" className="legal-section">
              <h2>9. Changes to these terms</h2>
              <p>
                Cactus Café may update these terms as its services or
                requirements change. The current version and effective date
                will be shown on this page. Material changes should be
                communicated in a manner appropriate to the change and
                applicable law.
              </p>
            </section>

            <section id="contact" className="legal-section">
              <h2>10. Contact information</h2>
              <p>
                For questions about orders or these terms, contact Cactus Café
                using its official customer-service channels:
              </p>
              <ul className="legal-placeholder-list">
                <li><strong>[Insert official customer-service email address]</strong></li>
                <li><strong>{CAFE_CONTACT_PHONE}</strong></li>
                <li>
                  Business location: Isabela, Negros Occidental, Philippines.
                  <strong> [Add a street address only if confirmed by the owner.]</strong>
                </li>
              </ul>
            </section>

            <nav className="legal-page-navigation" aria-label="Related pages">
              <Link className="legal-button legal-button-secondary" to="/privacy">
                Read the Privacy Policy
              </Link>
              <Link className="legal-button legal-button-primary" to={returnPath}>
                Return
              </Link>
            </nav>
          </article>
        </div>
      </div>
    </main>
  );
}

export default Terms;
