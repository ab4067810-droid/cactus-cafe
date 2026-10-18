import "../styles/AboutPage.css";

const values = [
  {
    number: "01",
    title: "Made with care",
    text: "We choose simple ingredients and prepare every order with attention, patience, and a little pride.",
  },
  {
    number: "02",
    title: "Made for people",
    text: "Whether you are working, meeting friends, or taking a break, there is always room for you here.",
  },
  {
    number: "03",
    title: "Made to return to",
    text: "Our goal is to create the familiar comfort that makes every visit feel easy, warm, and worth repeating.",
  },
];

function AboutPage() {
  return (
    <main className="about-page">
      <section className="about-hero">
        <div className="about-hero-copy">
          <p className="about-eyebrow">OUR STORY</p>

          <h1>A little more room to slow down.</h1>

          <p className="about-intro">
            Cactus Cafe is a calm, welcoming space built around
            good food, warm drinks, and the simple joy of spending
            time together.
          </p>

          <div className="about-hero-actions">
            <a className="about-primary-button" href="/menu">
              Explore the menu <span>↗</span>
            </a>

            <a className="about-secondary-button" href="/my-reviews">
              Share your experience
            </a>
          </div>
        </div>

        <div className="about-hero-art" aria-label="Cactus Cafe">
          <div className="art-sun" />
          <div className="art-cactus art-cactus-main">
            <span className="cactus-arm cactus-arm-left" />
            <span className="cactus-arm cactus-arm-right" />
          </div>
          <div className="art-cactus art-cactus-small" />
          <div className="art-ground" />

          <div className="art-label">
            <span className="art-label-mark">C</span>
            <span>
              <strong>Cactus Cafe</strong>
              <small>Good food. Good company.</small>
            </span>
          </div>
        </div>
      </section>

      <section className="about-story">
        <div className="story-label">
          <p className="about-eyebrow">WHY WE EXIST</p>
          <span className="story-number">01</span>
        </div>

        <div className="story-copy">
          <h2>
            Built for the moments between the big ones.
          </h2>

          <p>
            Cactus Cafe began with a simple idea: a cafe should
            feel like more than a place to grab a drink. It should
            be somewhere you can settle in, reconnect, get things
            done, or do absolutely nothing for a while.
          </p>

          <p>
            From the first morning coffee to the last conversation
            of the day, we create food and drinks that make those
            ordinary moments feel a little better.
          </p>
        </div>

        <div className="story-note">
          <span>✦</span>
          <p>
            A welcoming space for slow mornings, quick lunches,
            creative work, and good conversations.
          </p>
        </div>
      </section>

      <section className="about-values">
        <div className="values-heading">
          <p className="about-eyebrow">WHAT GUIDES US</p>

          <h2>Simple principles, seriously practiced.</h2>
        </div>

        <div className="values-grid">
          {values.map((value) => (
            <article className="about-value" key={value.number}>
              <span className="value-number">{value.number}</span>

              <div>
                <h3>{value.title}</h3>
                <p>{value.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="about-experience">
        <div className="experience-card experience-card-primary">
          <p className="about-eyebrow">THE CACTUS CAFE WAY</p>

          <h2>Come as you are.</h2>

          <p>
            We care about thoughtful details, but we never want the
            experience to feel complicated. Find your favorite seat,
            order something good, and stay as long as you like.
          </p>
        </div>

        <div className="experience-card experience-card-secondary">
          <span className="experience-symbol">☕</span>

          <strong>Freshly prepared</strong>
          <p>Food and drinks made for the moment you are in.</p>
        </div>

        <div className="experience-card experience-card-secondary">
          <span className="experience-symbol">⌁</span>

          <strong>Easy to enjoy</strong>
          <p>A relaxed atmosphere with no pressure to rush.</p>
        </div>
      </section>

      <section className="about-cta">
        <div>
          <p className="about-eyebrow">YOUR TABLE IS WAITING</p>

          <h2>Make today a little more delicious.</h2>

          <p>
            Browse the menu and find something worth slowing down
            for.
          </p>
        </div>

        <a className="about-primary-button" href="/menu">
          View the menu <span>→</span>
        </a>
      </section>
    </main>
  );
}

export default AboutPage;