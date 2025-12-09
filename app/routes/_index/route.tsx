import { redirect, Form, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";
import styles from "./style.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();
  

  return (
    <div className={styles.container}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <div className={styles.navbarContent}>
          <div className={styles.navbarLogo}>
            <div className={styles.logoIcon}>P</div>
            <div className={styles.logoTextContainer}>
              <span className={styles.logoTitle}>Pixel</span>
              <span className={styles.logoSubtitle}>Track your store's performance</span>
            </div>
          </div>
          {showForm && (
            <Form method="post" action="/auth/login">
              <button className={styles.navButton} type="submit">
                <img src="/assets/shopify.png" alt="Shopify" className={styles.shopifyIcon} />
                Install App
              </button>
            </Form>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <img src="/assets/shopify.png" alt="Shopify" className={styles.badgeIcon} />
            <span>Pixel Event Tracker for Shopify</span>
          </div>

          <div className={styles.heroText}>
            <h1 className={styles.heroTitle}>
              Track every event, everywhere it fires
              <span className={styles.heroGradient}>
                See what triggered, where it happened, and what it's worth
              </span>
            </h1>
            <p className={styles.heroSubtitle}>
              Drop in Pixel, capture page views, clicks, carts, purchases, and errors with full context—URLs, sources, and devices—in one dashboard.
            </p>
          </div>

          {showForm ? (
            <Form method="post" action="/auth/login" className={styles.ctaForm}>
              <div className={styles.inputGroup}>
                <input 
                  className={styles.input} 
                  type="text" 
                  name="shop" 
                  placeholder="your-store.myshopify.com"
                  required
                />
                <button className={styles.ctaButton} type="submit">
                  <img src="/assets/shopify.png" alt="Shopify" className={styles.shopifyIcon} />
                  Install App
                </button>
              </div>
              <p className={styles.inputHint}>Enter your Shopify store domain to get started in seconds.</p>
            </Form>
          ) : (
            <div className={styles.ctaForm}>
              <p className={styles.inputHint}>Enter your Shopify store domain to get started in seconds.</p>
            </div>
          )}

          <div className={styles.featureCards}>
            <div className={styles.featureCard}>
              <p className={styles.featureCardTitle}>Reliability</p>
              <p className={styles.featureCardText}>Live health checks and event-delivery monitoring keep data flowing without gaps.</p>
            </div>
            <div className={styles.featureCard}>
              <p className={styles.featureCardTitle}>Security</p>
              <p className={styles.featureCardText}>Shopify-grade protections, scoped keys, and data minimization for safer tracking.</p>
            </div>
            <div className={styles.featureCard}>
              <p className={styles.featureCardTitle}>Support</p>
              <p className={styles.featureCardText}>Tracking specialists ready to help debug events, attribution, and theme rollouts.</p>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className={styles.about}>
        <div className={styles.aboutContent}>
          <div className={styles.aboutHeader}>
            <span className={styles.aboutBadge}>
              <img src="/assets/shopify.png" alt="" className={styles.badgeIconSmall} />
              About Pixel
            </span>
            <h2 className={styles.aboutTitle}>
              Track every event with the clarity of Meta Pixel—purpose-built for Shopify
            </h2>
            <p className={styles.aboutSubtitle}>
              Pixel shows what fired, where it fired, and why. Instrument once, see full-funnel analytics, and keep your theme clean without heavy engineering time.
            </p>
          </div>

          <div className={styles.featuresGrid}>
            <div className={styles.feature}>
              <p className={styles.featureTitle}>Event stream with context</p>
              <p className={styles.featureText}>Capture page views, clicks, carts, purchases, and errors with URLs, sources, and devices.</p>
            </div>
            <div className={styles.feature}>
              <p className={styles.featureTitle}>Where events fired</p>
              <p className={styles.featureText}>See exactly which page, theme block, or campaign triggered each event for faster fixes.</p>
            </div>
            <div className={styles.feature}>
              <p className={styles.featureTitle}>Themes & branding ready</p>
              <p className={styles.featureText}>Drop Pixel into any theme and keep your brand styling consistent with minimal changes.</p>
            </div>
            <div className={styles.feature}>
              <p className={styles.featureTitle}>Governed and safe</p>
              <p className={styles.featureText}>Role-aware controls, audit trails, and rollback-safe configs so teams can ship confidently.</p>
            </div>
          </div>

          <div className={styles.supportBanner}>
            <div className={styles.supportText}>
              <p className={styles.supportTitle}>Always-on support</p>
              <p className={styles.supportSubtitle}>Event-tracking specialists ready to help debug triggers, attribution, and rollouts.</p>
            </div>
            <button className={styles.supportButton}>Talk with us</button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <span className={styles.footerText}>©2025 Warewe Consultancy Private Limited</span>
          <a 
            href="/privacy-policy" 
            className={styles.footerLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
}