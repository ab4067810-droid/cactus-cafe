import { Link } from "react-router-dom";
import { useAuth } from "../context/Authcontext";
import "../styles/LegalPages.css";

const sections = [
  { id: "information", label: "Personal information collected" },
  { id: "accounts", label: "Account information" },
  { id: "orders", label: "Orders and delivery" },
  { id: "reservations", label: "Reservations" },
  { id: "reviews", label: "Customer reviews" },
  { id: "payments", label: "Payment-related information" },
  { id: "purposes", label: "Purposes of processing" },
  { id: "storage", label: "Firebase and storage" },
  { id: "sharing", label: "Sharing and service providers" },
  { id: "retention", label: "Retention and deletion" },
  { id: "security", label: "Security safeguards" },
  { id: "rights", label: "Your rights under RA 10173" },
  { id: "inquiries", label: "Inquiries and complaints" },
  { id: "updates", label: "Policy updates" },
];

function PolicyTableOfContents() {
  return (
    <aside className="legal-toc">
      <nav aria-label="Privacy Policy sections">
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

function PrivacyPolicy() {
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
          <p className="legal-eyebrow">YOUR PRIVACY</p>
          <h1>Privacy Policy</h1>
          <p className="legal-intro">
            This policy explains the customer information handled by Cactus
            Café’s online ordering and related website features.
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
            <aside className="legal-privacy-highlight" role="note">
              <span className="legal-highlight-icon" aria-hidden="true">i</span>
              <div>
                <strong>At a glance</strong>
                <p>
                  The site uses Firebase Authentication and Firestore. Approved
                  reviews may be displayed publicly with a generic customer
                  name. Reservation forms may collect QR payment references
                  for manual review; the site does not upload payment
                  screenshots or automatically verify payments.
                </p>
              </div>
            </aside>

            <section id="information" className="legal-section">
              <h2>1. Personal information collected</h2>
              <p>
                Depending on which features you use, the site may collect
                account identifiers and contact details, order and delivery
                details, reservation details, saved menu item IDs, review
                content, and payment selections and reservation payment
                references. Information is collected when you create or use an
                account, save a favorite, submit an order or reservation, or
                submit a review.
              </p>
              <p>
                Order and reservation notifications may contain your account
                identifier, the related order or reservation identifier,
                notification type, title and message, read status, and
                creation time.
              </p>
            </section>

            <section id="accounts" className="legal-section">
              <h2>2. Customer account information</h2>
              <p>
                Firebase Authentication handles email/password and Google
                sign-in. The application uses your Firebase user identifier
                and may use your email, name, and Google profile name or photo
                when available. The related Firestore user profile stores
                account details such as name, email, role, and creation time.
                A profile photo may be stored when supplied by Google.
              </p>
              <p>
                Customers can save a phone number and structured delivery
                address in their account profile. The application does not
                write account passwords into the Firestore profile.
              </p>
            </section>

            <section id="orders" className="legal-section">
              <h2>3. Ordering and delivery information</h2>
              <p>
                An order request may contain your account ID and email, name,
                phone number, item identifiers and quantities, order type,
                order notes, status, and submission time. For delivery, the
                request includes the address you provide and any delivery
                instructions.
              </p>
              <p>
                When an administrator approves a request, the resulting order
                also stores priced order items, the total, order status, and
                customer/order details needed to prepare and fulfill it.
              </p>
            </section>

            <section id="reservations" className="legal-section">
              <h2>4. Reservation information</h2>
              <p>
                A reservation may contain your account ID and email, name,
                phone number, requested date and time, guest count, notes,
                reservation status, and creation time.
              </p>
            </section>

            <section id="reviews" className="legal-section">
              <h2>5. Customer reviews</h2>
              <p>
                A submitted review stores your account ID and email, rating,
                comment, moderation status, and creation time. Reviews are
                reviewed by the café team before publication.
              </p>
              <p>
                If approved, a separate public review record contains the
                rating, comment, date, and the generic display name “Cactus
                Café Customer”; the public copy does not include the review
                document’s customer ID or email. Public reviews can be read
                without signing in.
              </p>
            </section>

            <section id="payments" className="legal-section">
              <h2>6. Payment-related information</h2>
              <p>
                Checkout records the selected payment method (Cash or generic
                QR Payment), payment timing (Advance Payment or Pay Later),
                customer and request identifiers, and timestamps. Approved
                orders store order totals and priced items.
              </p>
              <p>
                Reservation submissions include a per-guest fee, the selected
                full or half payment option, the amount due now, any remaining
                balance, a customer-entered QR transaction reference, and a
                pending-review status. The café must verify references
                manually. The application does not collect card or bank
                credentials, upload payment screenshots, or integrate with
                GCash, Maya, or another named payment provider.
              </p>
            </section>

            <section id="purposes" className="legal-section">
              <h2>7. Purposes of collection and processing</h2>
              <p>
                The application uses information to authenticate accounts,
                maintain customer profiles, receive and review order requests,
                arrange pickup or delivery, handle reservations, moderate and
                display approved reviews, and send order or reservation
                notifications. Information may also be used to respond to
                customer inquiries and operate or protect the service, subject
                to applicable law.
              </p>
            </section>

            <section id="storage" className="legal-section">
              <h2>8. Firebase and data storage</h2>
              <p>
                The application uses Firebase Authentication for sign-in and
                Cloud Firestore for customer profiles and saved menu item IDs,
                order requests and orders, payment selections, reservations
                and their payment references, reviews, and notifications.
                Firebase is a Google service provider. The application’s code
                does not establish a separate payment processor or payment
                screenshot storage workflow.
              </p>
              <p>
                Storage locations, service terms, and any cross-border
                processing depend on the relevant Firebase configuration and
                Google service arrangements. Information may be processed
                outside the Philippines under those arrangements and
                applicable safeguards.
              </p>
            </section>

            <section id="sharing" className="legal-section">
              <h2>9. Sharing and service providers</h2>
              <p>
                Customer information is available to authorized café
                administrators when needed to manage orders, reservations,
                reviews, and customer accounts. Google/Firebase processes
                information to provide authentication and database services.
                Approved review content is made publicly available as
                described above.
              </p>
              <p>
                The inspected application does not show an integration with a
                named QR payment provider. The business should verify whether
                any additional providers, disclosures, or operational sharing
                practices need to be described here.
              </p>
            </section>

            <section id="retention" className="legal-section">
              <h2>10. Data retention and deletion</h2>
              <p>
                Account and profile information is retained while your account
                remains active. Order and reservation records are retained only
                for as long as needed to fulfill your requests, meet accounting
                or other legal obligations, and resolve disputes.
              </p>
              <p>
                You may request deletion by contacting the Privacy Contact /
                Data Protection Officer below. After verifying your identity,
                Cactus Café will delete personal data that is no longer needed
                for these purposes. Data that must be kept to meet legal or
                accounting obligations will be retained for the required
                period and securely deleted afterward.
              </p>
            </section>

            <section id="security" className="legal-section">
              <h2>11. Security safeguards</h2>
              <p>
                The application uses Firebase Authentication and Firestore
                security rules that restrict many records by account ownership
                and administrator role. These controls are safeguards, not a
                guarantee that information can never be accessed, lost, or
                disclosed improperly. Do not share your account credentials.
              </p>
              <p>
                No fixed security certification, independent audit, or
                absolute security guarantee is stated by this policy.
              </p>
            </section>

            <section id="rights" className="legal-section">
              <h2>12. Your rights under Republic Act No. 10173</h2>
              <p>
                Under the Philippine Data Privacy Act of 2012 (Republic Act
                No. 10173), you may have rights as a data subject, including
                the right to be informed, access and correct personal
                information, object to certain processing, request erasure or
                blocking where applicable, seek damages as provided by law,
                data portability where applicable, and lodge a complaint with
                the National Privacy Commission. These rights are subject to
                the conditions and exceptions in applicable law and regulations.
              </p>
              <p>
                To exercise these rights, including a request to access,
                correct, or delete your personal data, contact the Privacy
                Contact / Data Protection Officer below. We may ask you to
                verify your identity before acting on a request.
              </p>
            </section>

            <section id="inquiries" className="legal-section">
              <h2>13. Privacy Contact / Data Protection Officer</h2>
              <p>
                For privacy questions, data-subject requests, or complaints,
                contact Cactus Café’s Privacy Contact / Data Protection Officer:
              </p>
              <p>
                <a href="mailto:privacy@cactuscafe.ph">
                  privacy@cactuscafe.ph
                </a>
              </p>
              <p>
                You may also contact or lodge a complaint with the Philippine
                National Privacy Commission (NPC) through its{" "}
                <a href="https://privacy.gov.ph">
                  official website
                </a>
                .
              </p>
            </section>

            <section id="updates" className="legal-section">
              <h2>14. Policy updates</h2>
              <p>
                Cactus Café may update this policy to reflect changes in its
                services, data practices, or legal requirements. The effective
                date and version will be shown at the top of the current
                policy. Material updates should be communicated as required
                by applicable law.
              </p>
            </section>

            <nav className="legal-page-navigation" aria-label="Related pages">
              <Link className="legal-button legal-button-secondary" to="/terms">
                Read the Terms and Conditions
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

export default PrivacyPolicy;
