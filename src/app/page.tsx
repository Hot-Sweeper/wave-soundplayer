"use client";

import Link from "next/link";

export default function Home() {
  return (
    <main className="home-page">
      <section className="home-card">
        <div className="hero-copy">
          <div className="eyebrow">Wave SoundPlayer</div>
          <h1>Live Track Drops, Built for Stream.</h1>
          <p className="hero-text">
            A brutal, fast submission flow for artists and a clean queue for playback on stream.
          </p>

          <div className="home-links">
            <Link href="/submit" className="btn-primary">Submit a track</Link>
            <Link href="/player" className="btn-secondary">Open player</Link>
          </div>

          <dl className="feature-grid">
            <div>
              <dt>Queue-ready</dt>
              <dd>Artists drop a track, the queue updates, stream keeps moving.</dd>
            </div>
            <div>
              <dt>Stream-focused</dt>
              <dd>Built for on-air playback, live reactions, and quick handoff to the next song.</dd>
            </div>
          </dl>
        </div>

        <div className="hero-panel" aria-hidden="true">
          <div className="panel-stack">
            <div className="panel-top">Now loading submissions</div>
            <div className="panel-screen">
              <div className="logo-mark">?</div>
              <div className="panel-wave">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="panel-meta">
                <span>Live queue</span>
                <span>Audio ready</span>
              </div>
            </div>
            <div className="panel-bottom">Sir. Wxvey demo desk</div>
          </div>
        </div>
      </section>

      <style jsx>{`
        .home-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 20px;
          background:
            linear-gradient(90deg, rgba(167, 139, 250, 0.06) 0, rgba(167, 139, 250, 0.06) 1px, transparent 1px, transparent 32px),
            radial-gradient(circle at top, #140b2e 0%, #050505 58%, #000 100%);
        }
        .home-card {
          width: min(1160px, 100%);
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
          gap: 28px;
          align-items: stretch;
        }
        .hero-copy,
        .hero-panel {
          background: #fff;
          color: #000;
          border: 4px solid #000;
          box-shadow: 14px 14px 0 #a78bfa;
        }
        .hero-copy {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 32px;
          padding: 42px;
        }
        .eyebrow {
          width: fit-content;
          padding: 8px 12px;
          border: 3px solid #000;
          background: #000;
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 0.08em;
        }
        h1 {
          max-width: 11ch;
          font-size: clamp(3.3rem, 8vw, 6rem);
          line-height: 0.9;
          letter-spacing: -0.06em;
          font-weight: 900;
        }
        .hero-text {
          max-width: 30rem;
          font-size: clamp(1rem, 2vw, 1.25rem);
          line-height: 1.35;
          font-weight: 700;
          text-transform: none;
        }
        .home-links {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }
        .home-links :global(a) {
          min-width: 220px;
          display: block;
          text-decoration: none;
          text-align: center;
          padding: 18px 24px;
          border: 4px solid #000;
          font-size: 1rem;
          font-weight: 900;
          transition: transform 0.05s ease-out, box-shadow 0.05s ease-out, background 0.05s ease-out;
        }
        .home-links :global(.btn-primary) {
          background: #000;
          color: #fff;
          box-shadow: 8px 8px 0 #a78bfa;
        }
        .home-links :global(.btn-secondary) {
          background: #fff;
          color: #000;
          box-shadow: 8px 8px 0 #000;
        }
        .home-links :global(a:hover) {
          transform: translate(-2px, -2px);
        }
        .home-links :global(a:active) {
          transform: translate(4px, 4px);
          box-shadow: 4px 4px 0 currentColor;
        }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .feature-grid div {
          padding: 18px;
          border: 3px solid #000;
          background: #f3f3f3;
        }
        dt {
          margin-bottom: 10px;
          font-size: 0.95rem;
          font-weight: 900;
        }
        dd {
          font-size: 0.95rem;
          line-height: 1.45;
          font-weight: 700;
          text-transform: none;
        }
        .hero-panel {
          padding: 24px;
          background:
            linear-gradient(180deg, #ffffff 0%, #f6f6f6 100%);
        }
        .panel-stack {
          height: 100%;
          display: grid;
          grid-template-rows: auto 1fr auto;
          border: 4px solid #000;
          background: #000;
          color: #fff;
          overflow: hidden;
        }
        .panel-top,
        .panel-bottom {
          padding: 14px 18px;
          font-size: 0.85rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          background: #fff;
          color: #000;
          border-bottom: 4px solid #000;
        }
        .panel-bottom {
          border-top: 4px solid #000;
          border-bottom: 0;
        }
        .panel-screen {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 24px;
          min-height: 100%;
          padding: 28px;
          background:
            radial-gradient(circle at top, rgba(167, 139, 250, 0.22) 0%, rgba(167, 139, 250, 0.08) 28%, transparent 60%),
            linear-gradient(180deg, #0b0b0b 0%, #000 100%);
        }
        .logo-mark {
          width: 88px;
          height: 88px;
          display: grid;
          place-items: center;
          border: 4px solid #fff;
          font-size: 3.6rem;
          font-weight: 900;
          line-height: 1;
          box-shadow: 8px 8px 0 #a78bfa;
        }
        .panel-wave {
          display: grid;
          grid-template-columns: repeat(9, 1fr);
          align-items: end;
          gap: 10px;
          height: 220px;
        }
        .panel-wave span {
          display: block;
          width: 100%;
          border: 3px solid #fff;
          background: #a78bfa;
          box-shadow: 4px 4px 0 #fff;
        }
        .panel-wave span:nth-child(1) { height: 32%; }
        .panel-wave span:nth-child(2) { height: 56%; }
        .panel-wave span:nth-child(3) { height: 78%; }
        .panel-wave span:nth-child(4) { height: 42%; }
        .panel-wave span:nth-child(5) { height: 100%; }
        .panel-wave span:nth-child(6) { height: 68%; }
        .panel-wave span:nth-child(7) { height: 46%; }
        .panel-wave span:nth-child(8) { height: 86%; }
        .panel-wave span:nth-child(9) { height: 38%; }
        .panel-meta {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          font-size: 0.9rem;
          font-weight: 900;
        }

        @media (max-width: 960px) {
          .home-card {
            grid-template-columns: 1fr;
          }
          .hero-copy {
            padding: 28px;
          }
          h1 {
            max-width: none;
          }
        }

        @media (max-width: 640px) {
          .home-page {
            padding: 16px;
          }
          .hero-copy,
          .hero-panel {
            box-shadow: 10px 10px 0 #a78bfa;
          }
          .hero-copy {
            gap: 24px;
            padding: 22px;
          }
          .home-links {
            flex-direction: column;
          }
          .home-links :global(a) {
            min-width: 0;
            width: 100%;
          }
          .feature-grid {
            grid-template-columns: 1fr;
          }
          .hero-panel {
            padding: 14px;
          }
          .panel-screen {
            padding: 18px;
          }
          .panel-wave {
            height: 150px;
            gap: 8px;
          }
          .logo-mark {
            width: 72px;
            height: 72px;
            font-size: 3rem;
          }
          .panel-meta {
            flex-direction: column;
          }
        }
      `}</style>
    </main>
  );
}
