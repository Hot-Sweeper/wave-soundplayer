"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="home-page">
      <div className="home-content">
        <div className="logo-mark">?</div>
        <h1>Wave SoundPlayer</h1>
        <p>Stream-ready music submission and playback tool</p>
        <div className="home-links">
          <Link href="/submit" className="btn-primary">Submit a track</Link>
          <Link href="/player" className="btn-ghost">Open player</Link>
        </div>
      </div>
      <style jsx>{`
        .home-page { min-height:100vh; background:var(--color-bg); display:flex; align-items:center; justify-content:center; }
        .home-content { text-align:center; display:flex; flex-direction:column; align-items:center; gap:var(--space-4); padding:var(--space-8); border:4px solid var(--color-border); box-shadow:var(--glow-primary); background:var(--color-surface); }
        .logo-mark { font-size:4rem; color:var(--color-primary); font-weight:900; }
        h1 { font-size:3rem; font-weight:900; color:var(--color-text); letter-spacing:-0.05em; text-transform:uppercase; margin-bottom:var(--space-2); }
        p { color:var(--color-text); font-size:1.2rem; font-weight:700; background:var(--color-primary); color:var(--color-bg); padding:var(--space-1) var(--space-2); }
        .home-links { display:flex; gap:var(--space-6); margin-top:var(--space-6); }
        .btn-primary { background:var(--color-primary); color:var(--color-bg); text-decoration:none; border:2px solid var(--color-primary); padding:var(--space-3) var(--space-6); font-size:1.1rem; font-weight:800; text-transform:uppercase; transition:transform var(--anim-fast), box-shadow var(--anim-fast); box-shadow:4px 4px 0px var(--color-bg), 6px 6px 0px var(--color-border); }
        .btn-primary:active { transform:translate(4px, 4px); box-shadow:0px 0px 0px var(--color-bg), 2px 2px 0px var(--color-border); }
        .btn-ghost { background:var(--color-surface); color:var(--color-text); text-decoration:none; border:2px solid var(--color-border); padding:var(--space-3) var(--space-6); font-size:1.1rem; font-weight:800; text-transform:uppercase; transition:transform var(--anim-fast), box-shadow var(--anim-fast); box-shadow:4px 4px 0px var(--color-border); }
        .btn-ghost:active { transform:translate(4px, 4px); box-shadow:0px 0px 0px var(--color-border); }
      `}</style>
    </div>
  );
}
