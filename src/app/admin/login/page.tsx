"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid credentials");
      setLoading(false);
      return;
    }

    router.push("/admin");
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo-mark">?</div>
        <h1>Admin Login</h1>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Signing in\u2026" : "Sign in \u2192"}
          </button>
        </form>
      </div>
      <style jsx>{`
        .login-page { min-height:100vh; background:var(--color-bg); display:flex; align-items:center; justify-content:center; }
        .login-card { width:100%; max-width:360px; background:var(--color-surface); border:1px solid var(--color-border); border-radius:var(--radius-lg); padding:var(--space-12) var(--space-8); text-align:center; }
        .logo-mark { font-size:2rem; color:var(--color-primary); margin-bottom:var(--space-4); }
        h1 { font-size:1.5rem; font-weight:700; color:var(--color-text); margin-bottom:var(--space-8); }
        form { display:flex; flex-direction:column; gap:var(--space-4); }
        .field { display:flex; flex-direction:column; gap:var(--space-2); text-align:left; }
        label { font-size:0.875rem; font-weight:500; color:var(--color-text); }
        input { background:var(--color-surface-2); border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-3) var(--space-4); color:var(--color-text); font-size:0.95rem; }
        input:focus { border-color:var(--color-primary); outline:none; }
        .error { color:var(--color-danger); font-size:0.875rem; }
        .btn-primary { background:var(--color-primary); color:#fff; border:none; border-radius:var(--radius-full); padding:var(--space-4); font-size:1rem; font-weight:600; cursor:pointer; transition:opacity var(--anim-fast); }
        .btn-primary:hover:not(:disabled) { opacity:0.85; }
        .btn-primary:disabled { opacity:0.4; cursor:not-allowed; }
      `}</style>
    </div>
  );
}
