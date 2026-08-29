import { Link } from "react-router-dom";
import "../styles/HomePage.css";

function HomePage() {
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="hero-content">
          <p className="hero-eyebrow">WELCOME TO CACTUS CAFE</p>

          <h1 className="home-title">
            Fresh coffee.
            <br />
            Calm moments.
          </h1>

          <p className="home-subtitle">
            Your quiet corner for carefully brewed coffee, fresh pastries,
            and comforting food made for good conversations.
          </p>

          <div className="hero-actions">
            <Link to="/menu" className="primary-button">
              Explore our menu
            </Link>

            <Link to="/about" className="text-button">
              Discover our story
            </Link>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="hero-circle">
            <span className="hero-cactus">C</span>
          </div>
          <p>Freshly made for you</p>
        </div>
      </section>

      <section className="home-features">
        <article className="feature-card">
          <span className="feature-number">01</span>
          <h2>Thoughtful coffee</h2>
          <p>Made with quality beans and care in every cup.</p>
        </article>

        <article className="feature-card">
          <span className="feature-number">02</span>
          <h2>Fresh every day</h2>
          <p>Simple food and pastries prepared for a comforting break.</p>
        </article>

        <article className="feature-card">
          <span className="feature-number">03</span>
          <h2>Come as you are</h2>
          <p>A relaxed place for catch-ups, work, or a quiet moment.</p>
        </article>
      </section>
    </main>
  );
}

export default HomePage;