import { Link } from "react-router-dom";
import "../styles/HomePage.css";

const cafeImages = {
  hero: "/img0.jpg",
  coffee: "/img1.jpg",
  pastry: "/img2.jpg",
  interior: "/img3.jpg",
};

function HomePage() {
  return (
    <>
      <main className="home-page">
        <section className="home-hero">
          <div className="hero-content">
            <p className="hero-eyebrow">A LITTLE PAUSE, MADE FRESH</p>

            <h1 className="home-title">
              Good coffee.
              <br />
              Better moments.
            </h1>

            <p className="home-subtitle">
              Find your quiet corner for carefully brewed coffee, fresh
              pastries, and comforting café favorites.
            </p>

            <div className="hero-actions">
              <Link to="/menu" className="primary-button">
                Explore our menu
              </Link>

              <Link to="/about" className="text-button">
                Get to know us
              </Link>
            </div>
          </div>

          <div className="hero-visual">
            <img
              src={cafeImages.hero}
              alt="A welcoming café setting at Cactus Café"
            />

            <p>Made for your everyday moments</p>
          </div>
        </section>

        <section className="home-intro" aria-labelledby="intro-title">
          <p className="section-eyebrow">YOUR NEIGHBORHOOD CAFÉ</p>
          <h2 id="intro-title">A good cup can change the pace of a day.</h2>
          <p>
            At Cactus Café, we make space for the small things worth
            savoring—from the first sip of coffee to one more story shared
            around the table.
          </p>
        </section>

        <section className="home-features" aria-labelledby="features-title">
          <div className="features-heading">
            <div>
              <p className="section-eyebrow">THE CACTUS CAFÉ WAY</p>
              <h2 id="features-title">Simple things, thoughtfully made.</h2>
            </div>

            <Link to="/menu" className="text-button">
              Find your favorite
            </Link>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <img
                className="feature-image"
                src={cafeImages.coffee}
                alt="A freshly prepared cup of coffee"
                loading="lazy"
              />

              <div className="feature-copy">
                <span className="feature-number">01 / BREWED WITH CARE</span>

                <h3>Thoughtful coffee</h3>

                <p>Good beans, carefully brewed, and always worth a pause.</p>
              </div>
            </article>

            <article className="feature-card">
              <img
                className="feature-image"
                src={cafeImages.pastry}
                alt="A freshly baked café pastry"
                loading="lazy"
              />

              <div className="feature-copy">
                <span className="feature-number">02 / FRESH EACH DAY</span>

                <h3>A little something fresh</h3>

                <p>
                  Comforting bites and pastries made for an easy, happy
                  break.
                </p>
              </div>
            </article>

            <article className="feature-card">
              <img
                className="feature-image"
                src={cafeImages.interior}
                alt="A calm and welcoming café interior"
                loading="lazy"
              />

              <div className="feature-copy">
                <span className="feature-number">03 / ROOM TO UNWIND</span>

                <h3>Come as you are</h3>

                <p>
                  Settle in for a catch-up, a little work, or a moment to
                  yourself.
                </p>
              </div>
            </article>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="footer-inner">
          <Link to="/" className="footer-brand" aria-label="Cactus Café home">
            <span className="footer-monogram" aria-hidden="true">
              C
            </span>
            <span>Cactus Café</span>
          </Link>

          <p className="footer-note">
            Freshly made, thoughtfully shared.
          </p>

          <nav className="footer-links" aria-label="Footer navigation">
            <Link to="/menu">Menu</Link>
            <Link to="/about">Our story</Link>
            <Link to="/login">Log in</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

export default HomePage;