import { useState } from "react";
import SiteFooter from "../components/SiteFooter";
import "../styles/AboutPage.css";

// Edit the copy and image URLs here; replace sample gallery photos with café photos.
const aboutContent = {
  heroTitle: "Good food, familiar faces, and room to slow down.",
  heroIntro:
    "A welcoming place to enjoy a good cup, share a meal, and make time for the moments that matter.",
  storyTitle: "A café made for the everyday moments.",
  storyParagraphs: [
    "Cactus Café is a place to pause, settle in, and enjoy good food and warm drinks at your own pace.",
    "Whether you are catching up with a friend, getting a little work done, or taking a well-earned break, we are glad you are here.",
  ],
  owner: {
    name: "[Add owner name]",
    position: "[Add owner position]",
    biography: "[Add owner biography]",
    imageUrl: "",
  },
  mission:
    "To offer a welcoming café experience with thoughtfully prepared food, warm drinks, and genuine hospitality.",
  vision:
    "To be a favorite neighborhood place where people feel at home and look forward to coming back.",
  values: [
    {
      title: "Care in every detail",
      text: "Thoughtful preparation and a little extra attention in everything we serve.",
    },
    {
      title: "Warm hospitality",
      text: "A friendly welcome and a comfortable place for everyone.",
    },
    {
      title: "Good company",
      text: "Making room for connection, conversation, and time well spent.",
    },
  ],
  location: {
    address: "[Add Cactus Café's full street address, city, province, and postal code]",
    landmark: "[Add a nearby landmark and a short description of how to get here]",
    operatingHours: "[Add operating days and hours]",
    directionsUrl:
      "https://www.google.com/maps/search/?api=1&query=Cactus+Cafe",
  },
  gallery: [
    {
      imageUrl:
        "https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&w=1200&q=85",
      alt: "Cozy café counter with seating",
      caption: "A welcoming place to settle in",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=85",
      alt: "Coffee being prepared",
      caption: "A little care in every cup",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=1200&q=85",
      alt: "Bright café interior with tables",
      caption: "Room to share a moment",
    },
  ],
};

function AboutImage({ imageUrl, alt, className }) {
  const [hasImageError, setHasImageError] = useState(false);

  if (!imageUrl || hasImageError) {
    return (
      <div className={`${className} about-image-placeholder`} role="img" aria-label={alt}>
        <span aria-hidden="true">🌵</span>
        <small>Photo coming soon</small>
      </div>
    );
  }

  return (
    <img
      className={className}
      src={imageUrl}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setHasImageError(true)}
    />
  );
}

function AboutPage() {
  return (
    <>
      <main className="about-page">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-hero-copy">
            <p className="about-eyebrow">WELCOME TO CACTUS CAFÉ</p>
            <h1 id="about-title">{aboutContent.heroTitle}</h1>
            <p className="about-intro">{aboutContent.heroIntro}</p>
            <div className="about-hero-actions">
              <a className="about-button about-button-primary" href="/menu">
                Explore the menu <span aria-hidden="true">↗</span>
              </a>
              <a
                className="about-button about-button-secondary"
                href="/my-reviews"
              >
                Share your experience
              </a>
            </div>
          </div>
          <div className="about-hero-note">
            <span className="about-note-mark" aria-hidden="true">
              C
            </span>
            <div>
              <p className="about-eyebrow">GOOD FOOD. GOOD COMPANY.</p>
              <p>Make yourself at home.</p>
            </div>
            <span className="about-note-sun" aria-hidden="true" />
          </div>
        </section>

        <section
          className="about-story about-section"
          aria-labelledby="story-title"
        >
          <div className="about-section-heading">
            <p className="about-eyebrow">OUR STORY</p>
            <h2 id="story-title">{aboutContent.storyTitle}</h2>
          </div>
          <div className="about-story-copy">
            {aboutContent.storyParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section
          className="about-owner about-section"
          aria-labelledby="owner-title"
        >
          <AboutImage
            className="about-owner-photo"
            imageUrl={aboutContent.owner.imageUrl}
            alt="Portrait of the Cactus Café owner"
          />
          <div className="about-owner-copy">
            <p className="about-eyebrow">A LITTLE INTRODUCTION</p>
            <h2 id="owner-title">Meet the owner</h2>
            <p className="about-owner-position">
              {aboutContent.owner.position}
            </p>
            <h3>{aboutContent.owner.name}</h3>
            <p className="about-owner-bio">{aboutContent.owner.biography}</p>
          </div>
        </section>

        <section
          className="about-purpose about-section"
          aria-labelledby="purpose-title"
        >
          <div className="about-section-heading">
            <p className="about-eyebrow">WHAT WE BELIEVE</p>
            <h2 id="purpose-title">A little more of what matters.</h2>
          </div>
          <div className="about-purpose-grid">
            <article className="about-purpose-card">
              <span className="about-card-index">01</span>
              <p className="about-eyebrow">OUR MISSION</p>
              <h3>Make every visit feel welcoming.</h3>
              <p>{aboutContent.mission}</p>
            </article>
            <article className="about-purpose-card about-purpose-card-green">
              <span className="about-card-index">02</span>
              <p className="about-eyebrow">OUR VISION</p>
              <h3>A place you love to return to.</h3>
              <p>{aboutContent.vision}</p>
            </article>
          </div>
        </section>

        <section
          className="about-values about-section"
          aria-labelledby="values-title"
        >
          <div className="about-section-heading">
            <p className="about-eyebrow">THE CACTUS CAFÉ WAY</p>
            <h2 id="values-title">Our core values</h2>
          </div>
          <div className="about-values-grid">
            {aboutContent.values.map((value, index) => (
              <article className="about-value-card" key={value.title}>
                <span className="about-value-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3>{value.title}</h3>
                <p>{value.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="about-gallery about-section"
          aria-labelledby="gallery-title"
        >
          <div className="about-section-heading about-gallery-heading">
            <div>
              <p className="about-eyebrow">A GLIMPSE INSIDE</p>
              <h2 id="gallery-title">Little moments at Cactus Café.</h2>
            </div>
            <p>
              Replace these sample image URLs with your café photos in the
              content section above.
            </p>
          </div>
          <div className="about-gallery-grid">
            {aboutContent.gallery.map((photo) => (
              <figure className="about-gallery-item" key={photo.imageUrl}>
                <AboutImage
                  className="about-gallery-photo"
                  imageUrl={photo.imageUrl}
                  alt={photo.alt}
                />
                <figcaption>{photo.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="about-cta" aria-labelledby="about-cta-title">
          <div>
            <p className="about-eyebrow">YOUR TABLE IS WAITING</p>
            <h2 id="about-cta-title">We would love to have you in.</h2>
            <p>Find your next café favorite or tell us about your visit.</p>
          </div>
          <div className="about-cta-actions">
            <a className="about-button about-button-primary" href="/menu">
              View the menu <span aria-hidden="true">→</span>
            </a>
            <a
              className="about-button about-button-secondary"
              href="/my-reviews"
            >
              Share your experience
            </a>
          </div>
        </section>

        <section
          className="about-location about-section"
          aria-labelledby="location-title"
        >
          <div className="about-section-heading">
            <p className="about-eyebrow">COME VISIT US</p>
            <h2 id="location-title">Location &amp; Directions</h2>
            <p className="about-location-intro">
              We look forward to welcoming you to Cactus Café.
            </p>
          </div>
          <div className="about-location-details">
            <article className="about-location-card">
              <p className="about-eyebrow">FULL ADDRESS</p>
              <p>{aboutContent.location.address}</p>
            </article>
            <article className="about-location-card">
              <p className="about-eyebrow">NEARBY LANDMARK</p>
              <p>{aboutContent.location.landmark}</p>
            </article>
            <article className="about-location-card">
              <p className="about-eyebrow">OPERATING HOURS</p>
              <p>{aboutContent.location.operatingHours}</p>
            </article>
            <a
              className="about-button about-button-primary about-directions-link"
              href={aboutContent.location.directionsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Get Directions <span aria-hidden="true">↗</span>
            </a>
            <p className="about-location-note">
              Update the Google Maps link above with the café's exact map pin.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

export default AboutPage;
