import "../styles/AboutPage.css";

function AboutPage() {
  return (
    <main className="about-page">
      <section className="about-hero">
        <div>
          <p className="about-eyebrow">OUR STORY</p>

          <h1>More than a place for coffee.</h1>

          <p className="about-intro">
            Cactus Cafe is a calm, welcoming space built around good food,
            warm drinks, and the simple joy of slowing down together.
          </p>
        </div>

        <div className="about-mark" aria-hidden="true">
          <span>C</span>
          <p>Cactus Cafe</p>
        </div>
      </section>

      <section className="about-values">
        <article className="about-value">
          <span>01</span>
          <h2>Made with care</h2>
          <p>
            We choose simple ingredients and prepare every order with attention.
          </p>
        </article>

        <article className="about-value">
          <span>02</span>
          <h2>Made for people</h2>
          <p>
            Whether you are working, meeting friends, or taking a break, you
            are always welcome here.
          </p>
        </article>

        <article className="about-value">
          <span>03</span>
          <h2>Made to return to</h2>
          <p>
            Our goal is to create the familiar comfort that makes every visit
            feel easy.
          </p>
        </article>
      </section>
    </main>
  );
}

export default AboutPage;