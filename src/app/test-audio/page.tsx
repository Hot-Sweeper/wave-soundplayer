"use client";
import { useEffect, useRef } from "react";

export default function TestWS() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    let ws: any;
    (async () => {
      const { default: WaveSurfer } = await import("wavesurfer.js");
      console.log("[test] creating WaveSurfer...");
      ws = WaveSurfer.create({
        container: container.current!,
        height: 72,
        waveColor: "#7c3aed",
        progressColor: "#a78bfa",
        url: "/api/audio/cmnzre1ru0000potw6rysov7d",
      });
      ws.on("ready", () => {
        console.log("[test] READY - duration:", ws.getDuration());
        document.getElementById("status")!.textContent = "READY - " + ws.getDuration().toFixed(1) + "s";
      });
      ws.on("error", (err: unknown) => {
        console.error("[test] ERROR:", err);
        document.getElementById("status")!.textContent = "ERROR: " + err;
      });
      ws.on("loading", (pct: number) => {
        document.getElementById("status")!.textContent = "Loading: " + pct + "%";
      });
    })().catch((err) => {
      console.error("[test] init crash:", err);
      document.getElementById("status")!.textContent = "CRASH: " + err;
    });
    return () => ws?.destroy();
  }, []);

  return (
    <div style={{ padding: 40 }}>
      <h1>WaveSurfer Minimal Test</h1>
      <p id="status">Initializing...</p>
      <div ref={container} style={{ width: 600, height: 72, border: "2px solid red" }} />
      <br />
      <h2>Native audio element</h2>
      <audio controls src="/api/audio/cmnzre1ru0000potw6rysov7d" />
    </div>
  );
}
