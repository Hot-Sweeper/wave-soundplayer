"use client";

import { useState, useRef, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

type SubmitState = "idle" | "uploading" | "success" | "error";

export default function SubmitPage() {
  const [artistName, setArtistName] = useState("");
  const [artistNote, setArtistNote] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [audioDragging, setAudioDragging] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAudioDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setAudioDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setAudioFile(file);
  }, []);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setAvatarFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setAvatarPreview(url);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) return;
    setState("uploading");
    setError(null);
    setUploadProgress(0);

    const fd = new FormData();
    fd.append("artistName", artistName);
    fd.append("artistNote", artistNote);
    fd.append("audio", audioFile);
    if (avatarFile) fd.append("avatar", avatarFile);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/submissions");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as { id?: string; queuePos?: number; error?: string };
        if (xhr.status >= 200 && xhr.status < 300) {
          setState("success");
          setQueuePos(data.queuePos ?? null);
        } else {
          setState("error");
          setError(data.error ?? "Upload failed");
        }
      } catch {
        setState("error");
        setError("Upload failed");
      }
    };

    xhr.onerror = () => {
      setState("error");
      setError("Network error — please try again");
    };

    xhr.send(fd);
  };

  if (state === "success") {
    return (
      <div className="submit-page">
        <Link href="/" className="back-home" style={{
          position: "fixed", top: 20, left: 20, zIndex: 10,
          color: "rgba(255,255,255,0.5)", textDecoration: "none",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 13, fontWeight: 700, fontFamily: "var(--font-sans)",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
        onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}
        ><ArrowLeft size={18} /> HOME</Link>
        <div className="submit-success">
          <div className="success-icon">
            <svg width="80" height="80" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
              <path d="M21 2v13.5c0 1.93-1.57 3.5-3.5 3.5s-3.5-1.57-3.5-3.5 1.57-3.5 3.5-3.5c1.32 0 2.45.73 3 1.81V6.5l-11 2v12c0 1.93-1.57 3.5-3.5 3.5s-3.5-1.57-3.5-3.5 1.57-3.5 3.5-3.5c1.32 0 2.45.73 3 1.81V4.5L21 2z" />
            </svg>
          </div>
          <h1>You&apos;re in!</h1>
          {queuePos && <p className="queue-pos">Track #{queuePos} in the queue</p>}
          <p className="success-sub">Sir. Wxvey will play your track soon. Stay tuned!</p>
          <button className="btn-primary" onClick={() => { setState("idle"); setAudioFile(null); setAvatarFile(null); setAvatarPreview(null); setArtistName(""); setArtistNote(""); }}>
            Submit another
          </button>
        </div>
        <style jsx>{`
        .submit-page { min-height:100vh; display:flex; align-items:center; justify-content:center; background:radial-gradient(ellipse at top, #140b2e 0%, #000 70%); padding:32px; font-family:var(--font-sans); }
        .submit-success { width: 600px; max-width: 100%; background: #fff; border: 4px solid #000; box-shadow: 16px 16px 0 #a78bfa; display: flex; flex-direction: column; padding: 48px 32px; gap: 24px; align-items: center; text-align: center; }
        .success-icon { display: flex; transform-origin: bottom; animation: jump 0.5s cubic-bezier(0.175,0.885,0.32,1.275) infinite alternate; color: #000; padding: 16px; margin: -16px; filter: drop-shadow(6px 6px 0 #a78bfa); }
        .success-icon svg { overflow: visible !important; }
        @keyframes jump { 0%{transform:scaleY(0.9) translateY(4px)} 100%{transform:scaleY(1.1) translateY(-24px)} }
        h1 { font-size: 48px; font-weight: 900; letter-spacing: -0.05em; color: #000; text-transform: uppercase; margin: 0; line-height: 1; }
        .queue-pos { font-size: 1.5rem; color: #fff; background: #000; font-weight: 900; padding: 8px 16px; border: 4px solid #000; box-shadow: 6px 6px 0 #a78bfa; text-transform: uppercase; transform: rotate(-2deg); margin: 8px 0; }
        .success-sub { color: #000; font-weight: 800; max-width: 320px; font-size: 18px; text-transform: uppercase; margin-top: 8px; }
        .btn-primary { background: #fff; color: #000; border: 4px solid #000; padding: 16px 32px; font-size: 20px; font-weight: 900; text-transform: uppercase; cursor: pointer; box-shadow: 8px 8px 0 #000; transition: transform 0.05s ease-out, box-shadow 0.05s ease-out; margin-top: 24px; border-radius: 0; }
        .btn-primary:active { transform: translate(4px, 4px); box-shadow: 4px 4px 0 #000; }
        .btn-primary:hover { background: #a78bfa; color: #000; }
        .btn-primary:focus-visible { outline: 4px solid #a78bfa; outline-offset: 4px; }
      `}</style>
      </div>
    );
  }

  return (
    <div className="submit-page">
      <Link href="/" className="back-home" style={{
        position: "fixed", top: 20, left: 20, zIndex: 10,
        color: "rgba(255,255,255,0.5)", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 13, fontWeight: 700, fontFamily: "var(--font-sans)",
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
      onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}
      ><ArrowLeft size={18} /> HOME</Link>
      <div className="submit-card">
        <header className="submit-header">
          <div className="logo-mark">?</div>
          <h1>Submit Your Track</h1>
          <p>Drop your demo and get rated live on stream</p>
        </header>

        <form onSubmit={handleSubmit} className="submit-form">
          {/* Artist name */}
          <div className="field">
            <label htmlFor="artistName">Artist name *</label>
            <input
              id="artistName"
              type="text"
              value={artistName}
              onChange={e => setArtistName(e.target.value)}
              placeholder="Your name or alias"
              maxLength={100}
              required
            />
          </div>

          {/* Artist note */}
          <div className="field">
            <label htmlFor="artistNote">Note to Wxvey <span className="optional">(optional)</span></label>
            <textarea
              id="artistNote"
              value={artistNote}
              onChange={e => setArtistNote(e.target.value)}
              placeholder="Tell him anything about the track..."
              maxLength={500}
              rows={3}
            />
            <span className="char-count">{artistNote.length}/500</span>
          </div>

          {/* Audio drop zone */}
          <div className="field">
            <label>Audio file * <span className="optional">MP3, WAV, FLAC, OGG, OPUS, M4A · max 50MB</span></label>
            <div
              className={`drop-zone ${audioDragging ? "dragging" : ""} ${audioFile ? "has-file" : ""}`}
              onDragOver={e => { e.preventDefault(); setAudioDragging(true); }}
              onDragLeave={() => setAudioDragging(false)}
              onDrop={handleAudioDrop}
              onClick={() => audioInputRef.current?.click()}
            >
              {audioFile ? (
                <span className="file-name">? {audioFile.name}</span>
              ) : (
                <span className="drop-hint">Drop audio here or <u>click to browse</u></span>
              )}
              <input
                ref={audioInputRef}
                type="file"
                accept=".mp3,.wav,.flac,.ogg,.opus,.m4a,audio/*"
                style={{ display: "none" }}
                onChange={e => setAudioFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {/* Avatar */}
          <div className="field">
            <label>Profile picture <span className="optional">(optional)</span></label>
            <div className="avatar-row">
              {avatarPreview ? (
                <img src={avatarPreview} alt="preview" className="avatar-preview" />
              ) : (
                <div className="avatar-placeholder">?</div>
              )}
              <button type="button" className="btn-secondary" onClick={() => avatarInputRef.current?.click()}>
                {avatarPreview ? "Change photo" : "Add photo"}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={handleAvatarChange}
              />
            </div>
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={state === "uploading" || !audioFile || !artistName}
          >
            {state === "uploading" ? "Uploading\u2026" : "Submit track \u2192"}
          </button>

          {state === "uploading" && (
            <div className="progress-wrap">
              <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
              <span className="progress-text">{uploadProgress}%</span>
            </div>
          )}
        </form>
      </div>

      <style jsx>{`
        .submit-page { min-height:100vh; background:radial-gradient(ellipse at top, #140b2e 0%, #000 70%); display:flex; align-items:center; justify-content:center; padding:16px; font-family:var(--font-sans); user-select:none; }
        .submit-card { width:800px; max-width:90%; background:#fff; border:4px solid #000; box-shadow:16px 16px 0 #a78bfa; display:flex; flex-direction:column; padding:32px; gap:24px; position:relative; }
        .submit-header { display:flex; align-items:center; border-bottom:4px solid #000; padding-bottom:16px; flex-shrink:0; text-align: left; margin: 0; box-shadow: none; background: transparent; transform: none; }
        .logo-mark { display: none; }
        h1 { font-size:24px; font-weight:900; letter-spacing:-0.05em; color:#000; text-transform:uppercase; margin:0; }
        .submit-header p { display: none; }
        .submit-form { display:flex; flex-direction:column; gap:24px; }
        .field { display:flex; flex-direction:column; gap:8px; }
        label { font-size:14px; font-weight:800; color:#000; text-transform:uppercase; }
        .optional { color:#666; font-weight:600; font-size:12px; text-transform: lowercase; }
        input[type="text"], textarea {
          background:#fff; border:2px solid #000;
          padding:12px 16px;
          color:#000; font-size:16px; font-family:var(--font-mono); font-weight:600;
          transition:none; resize:vertical; border-radius:0; box-shadow:none;
        }
        input[type="text"]:focus, textarea:focus { outline:none; border:4px solid #000; padding:10px 14px; }
        input[type="text"]::placeholder, textarea::placeholder { color:#999; font-weight:600; text-transform:none; }
        .char-count { font-size:12px; font-family:var(--font-mono); color:#666; text-align:right; font-weight:600; }
        .drop-zone {
          border:2px dashed #000; background:#fafafa;
          padding:32px 16px; text-align:center;
          cursor:pointer; transition:none;
          color:#000; font-family:var(--font-mono); font-weight:600;
        }
        .drop-zone:hover, .drop-zone.dragging { background:#f0f0f0; border-style:solid; }
        .drop-zone.has-file { border:2px solid #000; color:#fff; background:#000; }
        .file-name { font-size:16px; font-weight:600; }
        .drop-hint { font-size:14px; }
        .avatar-row { display:flex; align-items:center; gap:16px; }
        .avatar-preview, .avatar-placeholder {
          width:40px; height:40px; border-radius:50%; object-fit:cover;
          border:2px solid #000; background:#000; color:#fff; 
          display:flex; align-items:center; justify-content:center;
          font-size:16px; font-weight:900; box-shadow:none;
        }
        .btn-primary {
          background:#000; color:#fff; border:2px solid #000; border-radius:0;
          padding:16px; font-size:18px; font-family:var(--font-sans); font-weight:900; text-transform:uppercase; cursor:pointer;
          box-shadow:none; transition:transform 0.05s ease-out; margin-top:24px;
        }
        .btn-primary:hover:not(:disabled) { transform:scale(1.02); }
        .btn-primary:active:not(:disabled) { transform:scale(0.98); }
        .btn-primary:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
        .btn-secondary {
          background:#f5f5f5; color:#000; border:2px solid #000; border-radius:0;
          padding:8px 16px; font-family:var(--font-sans);
          font-size:14px; font-weight:800; text-transform:uppercase; cursor:pointer; transition:none;
        }
        .btn-secondary:hover { background:#e5e5e5; }
        .btn-secondary:active { transform:scale(0.95); }
        .error-msg { background:#ff4444; color:#fff; border:2px solid #000; font-size:14px; font-family:var(--font-mono); font-weight:800; text-align:center; padding:12px; text-transform:uppercase; }
        .progress-wrap {
          position:relative; width:100%; height:32px; background:#e5e5e5; border:2px solid #000; overflow:hidden; margin-top:-8px;
        }
        .progress-bar {
          position:absolute; top:0; left:0; height:100%;
          background: linear-gradient(90deg, #a78bfa, #7c3aed);
          transition: width 0.2s ease-out;
        }
        .progress-text {
          position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
          font-size:13px; font-weight:900; font-family:var(--font-mono); color:#000;
          text-transform:uppercase; letter-spacing:0.05em; z-index:1;
        }
      `}</style>
    </div>
  );
}
