"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

interface Submission {
  id: string;
  artistName: string;
  artistNote: string | null;
  audioExt: string;
  queuePos: number;
  playedAt: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [retentionDays, setRetentionDays] = useState("30");
  const [bannedWords, setBannedWords] = useState("");
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadSubmissions = async () => {
    const res = await fetch("/api/queue");
    if (res.ok) {
      const data = await res.json() as Submission[];
      setSubmissions(data);
    }
  };

  const loadSettings = async () => {
    const res = await fetch("/api/admin/settings");
    if (res.ok) {
      const data = await res.json() as Record<string, string>;
      if (data.retention_days) setRetentionDays(data.retention_days);
      if (data.banned_words) {
        const words = JSON.parse(data.banned_words) as string[];
        setBannedWords(words.join(", "));
      }
    }
  };

  useEffect(() => {
    void loadSubmissions();
    void loadSettings();
  }, []);

  const deleteSubmission = async (id: string) => {
    await fetch(`/api/submissions/${id}`, { method: "DELETE" });
    void loadSubmissions();
  };

  const markPlayed = async (id: string) => {
    await fetch(`/api/submissions/${id}/played`, { method: "PUT" });
    void loadSubmissions();
  };

  const saveSettings = async () => {
    const words = bannedWords.split(",").map(w => w.trim()).filter(Boolean);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retention_days: retentionDays,
        banned_words: JSON.stringify(words),
      }),
    });
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="header-left">
          <span className="logo-mark">?</span>
          <h1>Wave Admin</h1>
        </div>
        <button className="btn-ghost" onClick={() => signOut({ callbackUrl: "/admin/login" })}>Sign out</button>
      </header>

      <main className="admin-main">
        {/* Queue section */}
        <section className="section">
          <h2>Submission Queue <span className="badge">{submissions.length}</span></h2>
          {submissions.length === 0 ? (
            <p className="empty">No submissions in queue.</p>
          ) : (
            <div className="submission-list">
              {submissions.map((s) => (
                <div key={s.id} className="submission-row">
                  <div className="sub-info">
                    <span className="sub-pos">#{s.queuePos}</span>
                    <div>
                      <p className="sub-name">{s.artistName}</p>
                      {s.artistNote && <p className="sub-note">{s.artistNote}</p>}
                    </div>
                  </div>
                  <div className="sub-actions">
                    <span className="sub-ext">.{s.audioExt}</span>
                    <button className="btn-sm btn-success" onClick={() => markPlayed(s.id)}>\u2713 Played</button>
                    <button className="btn-sm btn-danger" onClick={() => deleteSubmission(s.id)}>\u2715 Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Settings section */}
        <section className="section">
          <h2>Settings</h2>
          <div className="settings-grid">
            <div className="field">
              <label>Retention days</label>
              <input type="number" min="1" max="365" value={retentionDays} onChange={e => setRetentionDays(e.target.value)} />
            </div>
            <div className="field">
              <label>Banned words <span className="hint">(comma-separated)</span></label>
              <input type="text" value={bannedWords} onChange={e => setBannedWords(e.target.value)} placeholder="word1, word2, word3" />
            </div>
          </div>
          <button className="btn-primary" onClick={saveSettings}>
            {settingsSaved ? "Saved \u2713" : "Save settings"}
          </button>
        </section>
      </main>

      <style jsx>{`
        .admin-page { min-height:100vh; background:var(--color-bg); }
        .admin-header { display:flex; align-items:center; justify-content:space-between; padding:var(--space-4) var(--space-8); border-bottom:1px solid var(--color-border); background:var(--color-surface); }
        .header-left { display:flex; align-items:center; gap:var(--space-3); }
        .logo-mark { font-size:1.5rem; color:var(--color-primary); }
        h1 { font-size:1.25rem; font-weight:700; color:var(--color-text); }
        .btn-ghost { background:transparent; color:var(--color-text-muted); border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-2) var(--space-4); font-size:0.875rem; cursor:pointer; transition:color var(--anim-fast), border-color var(--anim-fast); }
        .btn-ghost:hover { color:var(--color-text); border-color:var(--color-text-muted); }
        .admin-main { max-width:900px; margin:0 auto; padding:var(--space-8); display:flex; flex-direction:column; gap:var(--space-8); }
        .section { background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-lg); padding:var(--space-6); }
        h2 { font-size:1.1rem; font-weight:700; color:var(--color-text); margin-bottom:var(--space-4); display:flex; align-items:center; gap:var(--space-2); }
        .badge { background:var(--color-primary); color:#fff; font-size:0.75rem; padding:2px 8px; border-radius:var(--radius-full); }
        .empty { color:var(--color-text-muted); font-size:0.9rem; }
        .submission-list { display:flex; flex-direction:column; gap:var(--space-2); }
        .submission-row { display:flex; align-items:center; justify-content:space-between; padding:var(--space-3) var(--space-4); background:var(--color-surface-2); border-radius:var(--radius-md); gap:var(--space-4); }
        .sub-info { display:flex; align-items:center; gap:var(--space-3); flex:1; min-width:0; }
        .sub-pos { color:var(--color-text-muted); font-size:0.75rem; font-weight:600; flex-shrink:0; }
        .sub-name { font-size:0.95rem; font-weight:600; color:var(--color-text); }
        .sub-note { font-size:0.8rem; color:var(--color-text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px; }
        .sub-actions { display:flex; align-items:center; gap:var(--space-2); flex-shrink:0; }
        .sub-ext { font-size:0.75rem; color:var(--color-text-muted); font-family:var(--font-mono); }
        .btn-sm { padding:var(--space-1) var(--space-3); border:none; border-radius:var(--radius-sm); font-size:0.75rem; font-weight:600; cursor:pointer; transition:opacity var(--anim-fast); }
        .btn-sm:hover { opacity:0.8; }
        .btn-success { background:#10b98120; color:var(--color-success); }
        .btn-danger  { background:#ef444420; color:var(--color-danger); }
        .settings-grid { display:grid; grid-template-columns:1fr 2fr; gap:var(--space-4); margin-bottom:var(--space-4); }
        .field { display:flex; flex-direction:column; gap:var(--space-2); }
        label { font-size:0.875rem; font-weight:500; color:var(--color-text); }
        .hint { color:var(--color-text-muted); font-weight:400; }
        input[type="text"], input[type="number"] { background:var(--color-surface-2); border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-3) var(--space-4); color:var(--color-text); font-size:0.9rem; }
        input:focus { border-color:var(--color-primary); outline:none; }
        .btn-primary { background:var(--color-primary); color:#fff; border:none; border-radius:var(--radius-md); padding:var(--space-3) var(--space-6); font-size:0.9rem; font-weight:600; cursor:pointer; transition:opacity var(--anim-fast); }
        .btn-primary:hover { opacity:0.85; }
      `}</style>
    </div>
  );
}
