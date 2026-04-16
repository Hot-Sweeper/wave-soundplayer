"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ThumbsUp,
  ThumbsDown,
  Flame,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  PlaySquare,
} from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────── */
type Submission = {
  id: string;
  artistName: string;
  artistNote: string | null;
  avatarPath: string | null;
  audioExt: string;
  queuePos: number;
  createdAt: string;
};

type ReactionType = "LIKE" | "DISLIKE" | "FIRE";

/* ─── Constants ─────────────────────────────────────────────── */
const BAR_COUNT = 64;
const MAX_BAR_H = 7.5;
const ANALYSER_FFT_SIZE = 1024;
const ANALYSER_SMOOTHING = 0.55;
const DEFAULT_SAMPLE_RATE = 44100;
const VISUALIZER_MIN_FREQ = 30;
const VISUALIZER_MAX_FREQ = 16000;

/* ─── Frequency band helpers ────────────────────────────────── */
function freqToBin(
  freq: number,
  sampleRate: number,
  fftSize: number,
  maxBin: number,
  method: "floor" | "round" | "ceil" = "round",
): number {
  const nyquistSafeFreq = Math.max(1, Math.min(freq, sampleRate / 2));
  const rawBin = Math[method](nyquistSafeFreq * fftSize / sampleRate);
  return Math.max(0, Math.min(rawBin, maxBin));
}

function bandEnergy(data: Uint8Array, from: number, to: number): number {
  if (to < from) return 0;
  let sum = 0;
  const start = Math.max(0, from);
  const end = Math.min(data.length - 1, to);
  for (let i = start; i <= end; i++) sum += data[i];
  return sum / Math.max(1, end - start + 1) / 255;
}

function bandEnergyHz(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
  startHz: number,
  endHz: number,
): number {
  const maxBin = data.length - 1;
  const startBin = freqToBin(startHz, sampleRate, fftSize, maxBin, "floor");
  const endBin = freqToBin(endHz, sampleRate, fftSize, maxBin, "ceil");
  return bandEnergy(data, startBin, endBin);
}

function bandFlux(
  data: Uint8Array,
  prevData: Uint8Array,
  from: number,
  to: number,
): number {
  if (!prevData.length || to < from) return 0;

  const start = Math.max(0, from);
  const end = Math.min(data.length - 1, to, prevData.length - 1);
  let flux = 0;
  for (let i = start; i <= end; i++) {
    const delta = data[i] - prevData[i];
    if (delta > 0) flux += delta;
  }

  return flux / Math.max(1, end - start + 1) / 255;
}

function logFrequencyAt(index: number, total: number, minFreq: number, maxFreq: number): number {
  if (total <= 1) return minFreq;
  const ratio = index / (total - 1);
  return minFreq * (maxFreq / minFreq) ** ratio;
}

/* HSL color helper */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${h % 360}, ${s}%, ${l}%)`;
}

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

/* ─── Player ─────────────────────────────────────────────────── */
export default function PlayerPage() {
  /* State */
  const [queue, setQueue] = useState<Submission[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [reactedWith, setReactedWith] = useState<ReactionType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [waveReady, setWaveReady] = useState(false);

  /* DOM refs */
  const waveformRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Audio refs — never recreated */
  const wsRef = useRef<any>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fftDataRef = useRef(new Uint8Array(128));

  /* Beat detection state */
  const hueRef = useRef(0);
  const lastKickRef = useRef(0);
  const kickAccumRef = useRef(0);
  const lastBassPulseRef = useRef(0);

  /* Three.js refs */
  const rendererRef = useRef<any>(null);
  const barsRef = useRef<Array<{ main: any; mirror: any }>>([]);
  const rafRef = useRef<number>(0);

  /* Stable refs for stale closure safety */
  const queueRef = useRef<Submission[]>([]);
  queueRef.current = queue;
  const currentIdRef = useRef<string | null>(null);
  const activeIdxRef = useRef(0);
  activeIdxRef.current = activeIdx;

  const current = queue[activeIdx] ?? null;

  /* ─── Fetch Queue ─── */
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue");
      const data: Submission[] = await res.json();
      setQueue(data);
    } catch {
      setQueue([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  /* ─── SSE: live queue count ─── */
  useEffect(() => {
    const es = new EventSource("/api/events/queue-count");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setQueueCount(data.queueCount || 0);
      } catch (err) {
        setQueueCount(Number(e.data) || 0);
      }
    };
    return () => es.close();
  }, []);

  /* ─── Three.js: init once ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cleanupFn: (() => void) | undefined;
    (async () => {
      const THREE = await import("three");

      const getSize = () => ({
        w: canvas.clientWidth || 1400,
        h: canvas.clientHeight || 300,
      });

      const { w, h } = getSize();

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
      renderer.setClearColor(0x000000, 0);
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100);
      camera.position.set(0, 4.5, 16);
      camera.lookAt(0, 0.5, 0);

      /* Lights — will be color-shifted */
      const ambientLight = new THREE.AmbientLight(0x1a0a3a, 5);
      scene.add(ambientLight);
      const dirLight = new THREE.DirectionalLight(0xb89dff, 2.5);
      dirLight.position.set(0, 12, 6);
      scene.add(dirLight);

      /* Point lights for color effects */
      const pointLightL = new THREE.PointLight(0xff0066, 0, 40);
      pointLightL.position.set(-12, 6, 4);
      scene.add(pointLightL);
      const pointLightR = new THREE.PointLight(0x00ccff, 0, 40);
      pointLightR.position.set(12, 6, 4);
      scene.add(pointLightR);
      const pointLightTop = new THREE.PointLight(0xffcc00, 0, 30);
      pointLightTop.position.set(0, 14, 2);
      scene.add(pointLightTop);

      /* Background particles — starfield */
      const PARTICLE_COUNT = 600;
      const particleGeo = new THREE.BufferGeometry();
      const pPositions = new Float32Array(PARTICLE_COUNT * 3);
      const pSizes = new Float32Array(PARTICLE_COUNT);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        pPositions[i * 3] = (Math.random() - 0.5) * 60;
        pPositions[i * 3 + 1] = (Math.random() - 0.5) * 40;
        pPositions[i * 3 + 2] = -5 - Math.random() * 30;
        pSizes[i] = 0.02 + Math.random() * 0.08;
      }
      particleGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
      particleGeo.setAttribute("size", new THREE.BufferAttribute(pSizes, 1));
      const particleMat = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.08,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      scene.add(particles);

      /* Floor grid — glowing plane */
      const floorGeo = new THREE.PlaneGeometry(40, 20, 1, 1);
      const floorMat = new THREE.MeshBasicMaterial({
        color: 0x6366f1,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.1;
      scene.add(floor);

      /* Bars */
      const spacing = 0.24;
      const totalW = (BAR_COUNT - 1) * spacing;
      const barGeo = new THREE.BoxGeometry(0.15, 1, 0.15);
      const newBars: Array<{ main: any; mirror: any; mat: any; mirrorMat: any }> = [];

      for (let i = 0; i < BAR_COUNT; i++) {
        const mat = new THREE.MeshPhongMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.6,
          shininess: 70,
        });
        const mirrorMat = new THREE.MeshPhongMaterial({
          color: 0xffffff,
          emissive: 0xffffff,
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0.28,
          shininess: 10,
        });

        const main = new THREE.Mesh(barGeo, mat);
        main.position.x = i * spacing - totalW / 2;
        main.scale.y = 0.01;
        main.position.y = 0.005;
        scene.add(main);

        const mirror = new THREE.Mesh(barGeo, mirrorMat);
        mirror.position.x = main.position.x;
        mirror.rotation.x = Math.PI;
        mirror.scale.y = 0.01;
        mirror.position.y = -0.005;
        scene.add(mirror);

        newBars.push({ main, mirror, mat, mirrorMat });
      }
      barsRef.current = newBars;

      /* Resize */
      const ro = new ResizeObserver(() => {
        const { w: nw, h: nh } = getSize();
        if (!nw || !nh) return;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh, false);
      });
      ro.observe(canvas);

      /* Render loop */
      let hidden = false;
      const onVisibilityChange = () => { hidden = document.hidden; };
      document.addEventListener("visibilitychange", onVisibilityChange);

      /* Smoothed energy trackers */
      let smoothSubBass = 0;
      let smoothBass = 0;
      let smoothKick = 0;
      let smoothMid = 0;
      let smoothHigh = 0;
      let cameraShakeX = 0;
      let cameraShakeY = 0;
      let prevSpectrum = new Uint8Array(0);
      const kickFluxHistory: number[] = [];
      const bassFluxHistory: number[] = [];

      function animate(now: number) {
        rafRef.current = requestAnimationFrame(animate);
        if (hidden) return;

        const data = fftDataRef.current;
        const hasAnalyser = !!analyserRef.current;
        if (hasAnalyser) analyserRef.current!.getByteFrequencyData(data);
        const sampleRate = audioCtxRef.current?.sampleRate ?? DEFAULT_SAMPLE_RATE;
        const fftSize = analyserRef.current?.fftSize ?? ANALYSER_FFT_SIZE;

        /* Band energies */
        const rawSubBass = bandEnergyHz(data, sampleRate, fftSize, 20, 60);
        const rawBass = bandEnergyHz(data, sampleRate, fftSize, 20, 130);
        const rawKick = bandEnergyHz(data, sampleRate, fftSize, 45, 130);
        const rawMid = bandEnergyHz(data, sampleRate, fftSize, 130, 350);
        const rawHigh = bandEnergyHz(data, sampleRate, fftSize, 2000, 8000);

        const subBassStartBin = freqToBin(20, sampleRate, fftSize, data.length - 1, "floor");
        const subBassEndBin = freqToBin(60, sampleRate, fftSize, data.length - 1, "ceil");
        const kickStartBin = freqToBin(45, sampleRate, fftSize, data.length - 1, "floor");
        const kickEndBin = freqToBin(130, sampleRate, fftSize, data.length - 1, "ceil");
        const subBassFlux = bandFlux(data, prevSpectrum, subBassStartBin, subBassEndBin);
        const kickFlux = bandFlux(data, prevSpectrum, kickStartBin, kickEndBin);

        /* Smooth with different attack/release for punchiness */
        const subBassAtk = 0.55, subBassRel = 0.1;
        const bassAtk = 0.6, bassRel = 0.12;
        const kickAtk = 0.7, kickRel = 0.15;
        smoothSubBass += (rawSubBass > smoothSubBass ? subBassAtk : subBassRel) * (rawSubBass - smoothSubBass);
        smoothBass += (rawBass > smoothBass ? bassAtk : bassRel) * (rawBass - smoothBass);
        smoothKick += (rawKick > smoothKick ? kickAtk : kickRel) * (rawKick - smoothKick);
        smoothMid += 0.2 * (rawMid - smoothMid);
        smoothHigh += 0.15 * (rawHigh - smoothHigh);

        /* Total energy */
        let totalEnergy = 0;
        for (let k = 0; k < data.length; k++) totalEnergy += data[k];
        const idle = totalEnergy < 150;

        /* Kick detection — threshold + cooldown */
        kickFluxHistory.push(kickFlux);
        bassFluxHistory.push(subBassFlux);
        if (kickFluxHistory.length > 24) kickFluxHistory.shift();
        if (bassFluxHistory.length > 24) bassFluxHistory.shift();

        const kickFluxAvg = kickFluxHistory.reduce((sum, value) => sum + value, 0) / Math.max(1, kickFluxHistory.length);
        const bassFluxAvg = bassFluxHistory.reduce((sum, value) => sum + value, 0) / Math.max(1, bassFluxHistory.length);
        const kickThreshold = Math.max(0.035, kickFluxAvg * 1.6);
        const bassThreshold = Math.max(0.025, bassFluxAvg * 1.45);

        const isKick =
          rawKick > 0.16 &&
          smoothKick > 0.14 &&
          kickFlux > kickThreshold &&
          (now - lastKickRef.current) > 180;
        const isBassPulse =
          rawSubBass > 0.14 &&
          smoothSubBass > 0.12 &&
          subBassFlux > bassThreshold &&
          (now - lastBassPulseRef.current) > 240;
        if (isKick) {
          lastKickRef.current = now;
          kickAccumRef.current = Math.min(kickAccumRef.current + 0.45, 1.0);
        }
        if (isBassPulse) {
          lastBassPulseRef.current = now;
          kickAccumRef.current = Math.min(kickAccumRef.current + 0.2, 1.0);
        }
        kickAccumRef.current *= idle ? 0.82 : 0.88;

        /* Hue rotation — faster on bass hits */
        const hueSpeed = idle ? 0.08 : 0.4 + smoothBass * 3 + (isKick ? 25 : 0);
        hueRef.current = (hueRef.current + hueSpeed) % 360;
        const hue = hueRef.current;

        /* ── COLOR THE BARS ── */
        const bars = barsRef.current;
        for (let i = 0; i < bars.length; i++) {
          const { main, mirror, mat, mirrorMat } = bars[i];
          let targetH: number;
          if (idle) {
            targetH = 0.04 + Math.abs(Math.sin(now * 0.0009 + i * 0.22)) * 0.14;
          } else {
            const binIndex = freqToBin(
              logFrequencyAt(i, BAR_COUNT, VISUALIZER_MIN_FREQ, VISUALIZER_MAX_FREQ),
              sampleRate,
              fftSize,
              data.length - 1,
            );
            const val = data[binIndex] / 255;
            targetH = Math.max(0.04, val * MAX_BAR_H);
          }

          main.scale.y += (targetH - main.scale.y) * 0.28;
          main.position.y = main.scale.y / 2;
          mirror.scale.y = main.scale.y * 0.38;
          mirror.position.y = -(mirror.scale.y / 2);

          /* Per-bar rainbow color based on position + global hue */
          if (!idle) {
            const barHue = (hue + (i / BAR_COUNT) * 180) % 360;
            const binIndex = freqToBin(
              logFrequencyAt(i, BAR_COUNT, VISUALIZER_MIN_FREQ, VISUALIZER_MAX_FREQ),
              sampleRate,
              fftSize,
              data.length - 1,
            );
            const intensity = data[binIndex] / 255;
            const color = new THREE.Color();
            color.setHSL(barHue / 360, 0.85 + intensity * 0.15, 0.45 + intensity * 0.35);
            mat.color.copy(color);
            mat.emissive.copy(color);
            mat.emissiveIntensity = 0.4 + intensity * 2.5;
            mirrorMat.color.copy(color);
            mirrorMat.emissive.copy(color);
            mirrorMat.emissiveIntensity = 0.2 + intensity * 1.2;
          } else {
            const idleColor = new THREE.Color();
            idleColor.setHSL((hue + i * 3) / 360, 0.5, 0.5);
            mat.color.copy(idleColor);
            mat.emissive.copy(idleColor);
            mat.emissiveIntensity = 0.6;
          }
        }

        /* ── DYNAMIC LIGHTS ── */
        if (!idle) {
          const lColor = new THREE.Color();
          lColor.setHSL(hue / 360, 1, 0.5);
          pointLightL.color.copy(lColor);
          pointLightL.intensity = 2 + rawSubBass * 12;

          const rColor = new THREE.Color();
          rColor.setHSL(((hue + 120) % 360) / 360, 1, 0.5);
          pointLightR.color.copy(rColor);
          pointLightR.intensity = 2 + smoothKick * 15;

          const tColor = new THREE.Color();
          tColor.setHSL(((hue + 240) % 360) / 360, 1, 0.5);
          pointLightTop.color.copy(tColor);
          pointLightTop.intensity = 1 + smoothHigh * 8;

          ambientLight.intensity = 3 + rawBass * 6;
          const ambColor = new THREE.Color();
          ambColor.setHSL(((hue + 60) % 360) / 360, 0.6, 0.15);
          ambientLight.color.copy(ambColor);

          dirLight.intensity = 2 + smoothMid * 5;
        } else {
          pointLightL.intensity = 0;
          pointLightR.intensity = 0;
          pointLightTop.intensity = 0;
          ambientLight.intensity = 5;
          ambientLight.color.setHex(0x1a0a3a);
          dirLight.intensity = 2.5;
        }

        /* ── FLOOR PULSE ── */
        if (!idle) {
          const fColor = new THREE.Color();
          fColor.setHSL(hue / 360, 0.9, 0.4);
          floorMat.color.copy(fColor);
          floorMat.opacity = 0.04 + rawSubBass * 0.25 + (isKick ? 0.15 : 0);
        } else {
          floorMat.opacity = 0.05;
          floorMat.color.setHex(0x6366f1);
        }

        /* ── PARTICLES ── */
        const pArr = particleGeo.attributes.position.array as Float32Array;
        const particleSpeed = idle ? 0.003 : 0.01 + rawSubBass * 0.06;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pArr[i * 3 + 2] += particleSpeed;
          if (pArr[i * 3 + 2] > 5) {
            pArr[i * 3 + 2] = -35;
            pArr[i * 3] = (Math.random() - 0.5) * 60;
            pArr[i * 3 + 1] = (Math.random() - 0.5) * 40;
          }
        }
        particleGeo.attributes.position.needsUpdate = true;
        particleMat.opacity = idle ? 0.3 : 0.4 + rawBass * 0.6;
        if (!idle) {
          const pColor = new THREE.Color();
          pColor.setHSL(((hue + 90) % 360) / 360, 0.7, 0.7);
          particleMat.color.copy(pColor);
        }
        particleMat.size = idle ? 0.08 : 0.08 + smoothKick * 0.15;

        /* ── CAMERA SHAKE on bass/kick ── */
        if (!idle) {
          const shakeIntensity = kickAccumRef.current * 0.18 + (isBassPulse ? 0.04 : 0);
          const targetShakeX = (Math.random() - 0.5) * shakeIntensity;
          const targetShakeY = (Math.random() - 0.5) * shakeIntensity * 0.6;
          cameraShakeX += (targetShakeX - cameraShakeX) * 0.4;
          cameraShakeY += (targetShakeY - cameraShakeY) * 0.4;
          camera.position.x = cameraShakeX;
          camera.position.y = 4.5 + cameraShakeY;
        } else {
          cameraShakeX *= 0.9;
          cameraShakeY *= 0.9;
          camera.position.x = cameraShakeX;
          camera.position.y = 4.5 + cameraShakeY;
        }

        /* ── BODY BACKGROUND COLOR ── */
        const bgEl = document.getElementById("player-bg");
        if (bgEl) {
          if (!idle) {
            const bgLightness = 2 + smoothBass * 8;
            const bgSat = 40 + smoothKick * 50;
            bgEl.style.background = `radial-gradient(ellipse at center, ${hsl(hue, bgSat, bgLightness)}, ${hsl(hue + 180, bgSat * 0.5, bgLightness * 0.3)})`;
          } else {
            bgEl.style.background = "#000";
          }
        }

        /* ── CARD SHAKE + SCALE on kick/bass ── */
        const mainCard = document.getElementById("main-player-card");
        if (mainCard) {
          if (!idle) {
            const beatScale = 1 + kickAccumRef.current * 0.08;
            const cardShakeX = kickAccumRef.current > 0.06
              ? (Math.random() - 0.5) * kickAccumRef.current * 6
              : 0;
            const cardShakeY = kickAccumRef.current > 0.06
              ? (Math.random() - 0.5) * kickAccumRef.current * 3
              : 0;
            mainCard.style.transform = `scale(${beatScale}) translate(${cardShakeX}px, ${cardShakeY}px)`;

            /* Glow shadow color synced to hue */
            const shadowColor = hsl(hue, 80, 50);
            const glowSize = 16 + rawBass * 24;
            mainCard.style.boxShadow = `${glowSize}px ${glowSize}px 0 ${shadowColor}`;
          } else {
            mainCard.style.transform = "scale(1)";
            mainCard.style.boxShadow = "16px 16px 0 #a78bfa";
          }
        }

        /* ── CSS SHAKE CLASS for heavy bass hits ── */
        if ((isKick || isBassPulse) && !document.body.classList.contains("shake-active")) {
          document.body.classList.add("shake-active");
          setTimeout(() => document.body.classList.remove("shake-active"), 150);
        }

        /* ── BORDER COLOR on card ── */
        if (mainCard && !idle) {
          const borderColor = hsl((hue + 90) % 360, 90, 55);
          mainCard.style.borderColor = borderColor;
        } else if (mainCard) {
          mainCard.style.borderColor = "#000";
        }

        prevSpectrum = Uint8Array.from(data);

        renderer.render(scene, camera);
      }
      rafRef.current = requestAnimationFrame(animate);

      cleanupFn = () => {
        cancelAnimationFrame(rafRef.current);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        ro.disconnect();
        renderer.dispose();
        barGeo.dispose();
        particleGeo.dispose();
        particleMat.dispose();
        floorGeo.dispose();
        floorMat.dispose();
        for (const b of newBars) { b.mat.dispose(); b.mirrorMat.dispose(); }
      };
    })().catch((err) => console.error("[Three.js] init failed:", err));

    return () => cleanupFn?.();
  }, []);

  /* ─── WaveSurfer: init once on mount ─── */
  useEffect(() => {
    if (!waveformRef.current) return;

    (async () => {
      console.log("[WS] importing wavesurfer.js...");
      const { default: WaveSurfer } = await import("wavesurfer.js");
      console.log("[WS] creating instance, container size:", waveformRef.current?.offsetWidth, waveformRef.current?.offsetHeight);

      const ws = WaveSurfer.create({
        container: waveformRef.current!,
        height: 72,
        waveColor: "rgba(124, 58, 237, 0.35)",
        progressColor: "rgba(167, 139, 250, 0.88)",
        cursorColor: "#f59e0b",
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 4,
        normalize: true,
        interact: true,
        dragToSeek: true,
      });
      console.log("[WS] instance created");

      ws.on("ready", () => {
        console.log("[WS] READY — duration:", ws.getDuration());
        setDuration(ws.getDuration());
        setWaveReady(true);
      });

      ws.on("error", (err: unknown) => {
        console.error("[WS] ERROR:", err);
      });

      ws.on("loading", (pct: number) => {
        console.log("[WS] loading:", pct + "%");
      });

      ws.on("play", () => {
        setIsPlaying(true);
        audioCtxRef.current?.resume();
      });

      ws.on("pause", () => setIsPlaying(false));

      ws.on("timeupdate", (t: number) => setCurrentTime(t));

      ws.on("finish", () => {
        setIsPlaying(false);
        setWaveReady(false);
        setTimeout(() => {
          const q = queueRef.current;
          const nextIdx = activeIdxRef.current + 1;
          if (nextIdx < q.length) {
            setReactedWith(null);
            setActiveIdx(nextIdx);
          }
        }, 1400);
      });

      wsRef.current = ws;
      audioElRef.current = ws.getMediaElement();

      /* If a track was already pending (queue loaded before wavesurfer) */
      if (currentIdRef.current) {
        console.log("[WS] loading pending track:", currentIdRef.current);
        ws.load("/api/audio/" + currentIdRef.current);
        setWaveReady(false);
      } else {
        console.log("[WS] no pending track");
      }
    })().catch((err) => console.error("[WS] init failed:", err));

    return () => {
      wsRef.current?.destroy();
      wsRef.current = null;
      audioElRef.current = null;
    };
  }, []);

      /* ─── Load track when current changes ─── */
  useEffect(() => {
    if (!current) return;
    currentIdRef.current = current.id;
    setCurrentTime(0);
    setDuration(0);
    setWaveReady(false);

    if (!wsRef.current) {
      console.log("[WS] track changed but wsRef not ready yet, track:", current.id);
      return;
    }
    console.log("[WS] loading track via useEffect:", current.id);
    wsRef.current.load("/api/audio/" + current.id);
  }, [current]);

  /* ─── Controls ─── */
  const togglePlay = useCallback(() => {
    if (!wsRef.current) return;

    /* Init Web Audio chain on first user gesture */
    if (!audioCtxRef.current && audioElRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audioElRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      fftDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    }

    audioCtxRef.current?.resume();
    wsRef.current.playPause();
  }, []);

  const goPrev = () => {
    if (activeIdx > 0) {
      setActiveIdx((i) => i - 1);
      setReactedWith(null);
      setWaveReady(false);
    }
  };

  const goNext = () => {
    if (activeIdx < queue.length - 1) {
      setActiveIdx((i) => i + 1);
      setReactedWith(null);
      setWaveReady(false);
    }
  };

  const react = async (type: ReactionType) => {
    if (!current) return;
    if (reactedWith === type) {
      setReactedWith(null);
      return;
    }
    setReactedWith(type);
    try {
      await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: current.id, type }),
      });
    } catch {
      /* silent */
    }
  };

  /* ─── Derived values ─── */
  const avatarSrc = current?.avatarPath
    ? "/api/avatars/" + current.avatarPath.split("/").pop()
    : null;

  const progress = duration > 0 ? currentTime / duration : 0;

  /* ─── Render ─────────────────────────────────────────────── */
  return (
    <>
      {/* CSS for shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          10% { transform: translate(-3px, -2px) rotate(-0.5deg); }
          20% { transform: translate(4px, 1px) rotate(0.5deg); }
          30% { transform: translate(-2px, 3px) rotate(-0.3deg); }
          40% { transform: translate(3px, -1px) rotate(0.4deg); }
          50% { transform: translate(-4px, 2px) rotate(-0.6deg); }
          60% { transform: translate(2px, -3px) rotate(0.3deg); }
          70% { transform: translate(-3px, 1px) rotate(-0.4deg); }
          80% { transform: translate(4px, 2px) rotate(0.5deg); }
          90% { transform: translate(-2px, -2px) rotate(-0.3deg); }
        }
        .shake-active #player-bg {
          animation: shake 0.15s ease-in-out;
        }
        @media (prefers-reduced-motion: no-preference) {
          #main-player-card {
            transition: transform 0.05s ease-out, box-shadow 0.08s ease-out, border-color 0.1s ease-out;
          }
        }
      `}</style>
    <div
      id="player-bg"
      style={{
        width: "100vw",
        height: "100vh",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* ── THREE.JS VISUALIZER BACKGROUND ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 0,
          pointerEvents: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>

      {isLoading && (
        <div
          role="status"
          aria-label="Loading"
          style={{
            position: "absolute",
            zIndex: 1,
            color: "#fff",
            fontSize: 14,
          }}
        >
          Loading queue…
        </div>
      )}

      {/* ── CENTERED STREAM CARD ── */}
      <div
        id="main-player-card"
        style={{
          width: 800,
          maxWidth: "90%",
          background: "#fff",
          border: "4px solid #000",
          boxShadow: "16px 16px 0 #a78bfa",
          display: "flex",
          flexDirection: "column",
          zIndex: 10,
          position: "relative",
          padding: 32,
          gap: 24,
          transition: "transform 0.05s ease-out",
        }}
      >
        {/* ── HEADER B&W ── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            borderBottom: "4px solid #000",
            paddingBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 24,
                fontWeight: 900,
                letterSpacing: "-0.05em",
                color: "#000",
                textTransform: "uppercase",
              }}
            >
              WAVE PLAYER / {queueCount || 0} WAITING
            </span>
          </div>
        </header>

        {/* ── SUBMISSION CARD ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexShrink: 0,
            minHeight: 80,
          }}
        >
          {current ? (
            <>
              {/* Avatar */}
              <div
                aria-hidden="true"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "#000",
                  border: "2px solid #000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  color: "#fff",
                  fontWeight: 900,
                }}
              >
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    width={40}
                    height={40}
                    style={{ display: "block", objectFit: "cover" }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  current.artistName.charAt(0).toUpperCase()
                )}
              </div>

              {/* Name + note */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column-reverse" }}>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#666",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {current.artistNote ? current.artistNote : "Untitled Track"}
                </p>
                <p
                  style={{
                    fontWeight: 900,
                    fontSize: 28,
                    color: "#000",
                    lineHeight: 1.1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {current.artistName}
                </p>
              </div>

              {/* Time display */}
              <div
                aria-label={fmtTime(currentTime) + " of " + fmtTime(duration)}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 20,
                  fontWeight: 900,
                  letterSpacing: "-0.05em",
                  color: "#000",
                  flexShrink: 0,
                }}
              >
                <span>{fmtTime(currentTime)}</span>
                <span style={{ margin: "0 4px", color: "#a78bfa" }}>/</span>
                <span>{fmtTime(duration)}</span>
              </div>

              {/* Progress pill */}
              <div
                aria-hidden="true"
                style={{
                  padding: "4px 16px",
                  background: "#000",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: 14,
                  flexShrink: 0,
                  boxShadow: "4px 4px 0 #a78bfa",
                }}
              >
                {activeIdx + 1} / {queue.length}
              </div>
            </>
          ) : (
            <p style={{ color: "#000", fontSize: 16, fontWeight: 700 }}>
              {isLoading ? "LOADING..." : "NO TRACK SELECTED"}
            </p>
          )}
        </div>

        {/* ── WAVEFORM ── */}
        <div
          style={{
            padding: "16px",
            background: "#fff",
            flexShrink: 0,
            borderTop: "4px solid #000",
            borderBottom: "4px solid #000",
          }}
        >
          <div style={{ position: "relative", height: 72 }}>
            {/* WaveSurfer container — normal flow so it gets real width */}
            <div
              ref={waveformRef}
              aria-label="Waveform — click to seek"
              style={{ height: 72 }}
            />
            {/* Loading overlay — sits on top until waveform is ready */}
            {!(current && waveReady) && (
              <div
                role="status"
                aria-label={current ? "Loading waveform" : "No track"}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#fff",
                  zIndex: 2,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: current
                      ? "linear-gradient(90deg, #000 0%, #a78bfa " +
                        progress * 100 +
                        "%, #000 " +
                        progress * 100 +
                        "%)"
                      : "#000",
                    transition: "background 0.1s linear",
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── CONTROLS ── */}
        <div
          role="toolbar"
          aria-label="Playback controls"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          {/* Transport */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={goPrev}
              disabled={activeIdx === 0}
              aria-label="Previous track"
              style={{
                width: 48,
                height: 48,
                background: "#fff",
                border: "4px solid #000",
                color: "#000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: activeIdx === 0 ? "not-allowed" : "pointer",
                opacity: activeIdx === 0 ? 0.5 : 1,
                boxShadow: activeIdx === 0 ? "none" : "4px 4px 0 #a78bfa",
              }}
            >
              <SkipBack fill="currentColor" size={20} />
            </button>

            <button
              onClick={togglePlay}
              disabled={!current || !waveReady}
              aria-label={isPlaying ? "Pause" : "Play"}
              aria-pressed={isPlaying}
              style={{
                width: 64,
                height: 64,
                background:
                  current && waveReady
                    ? "#000"
                    : "#fff",
                border: "4px solid #000",
                cursor: current && waveReady ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color:
                  current && waveReady
                    ? "#fff"
                    : "#ccc",
                boxShadow:
                  current && waveReady ? "6px 6px 0 #a78bfa" : "none",
                transition: "transform 0.1s ease, box-shadow 0.1s ease",
              }}
              onMouseDown={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = "translate(2px, 2px)";
                  e.currentTarget.style.boxShadow = "4px 4px 0 #a78bfa";
                }
              }}
              onMouseUp={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow = "6px 6px 0 #a78bfa";
                }
              }}
              onMouseLeave={(e) => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow = "6px 6px 0 #a78bfa";
                }
              }}
            >
              {isPlaying ? (
                <Pause size={32} fill="currentColor" />
              ) : (
                <Play size={32} fill="currentColor" />
              )}
            </button>

            <button
              onClick={goNext}
              disabled={activeIdx >= queue.length - 1}
              aria-label="Next track"
              style={{
                width: 48,
                height: 48,
                background: "#fff",
                border: "4px solid #000",
                color: "#000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: activeIdx >= queue.length - 1 ? "not-allowed" : "pointer",
                opacity: activeIdx >= queue.length - 1 ? 0.5 : 1,
                boxShadow: activeIdx >= queue.length - 1 ? "none" : "4px 4px 0 #a78bfa",
              }}
            >
              <SkipForward fill="currentColor" size={20} />
            </button>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Reaction buttons */}
          <div
            role="group"
            aria-label="Rate this track"
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            {(["LIKE", "DISLIKE", "FIRE"] as ReactionType[]).map((type) => {
              const icon =
                type === "LIKE" ? (
                  <ThumbsUp size={24} />
                ) : type === "DISLIKE" ? (
                  <ThumbsDown size={24} />
                ) : (
                  <Flame size={24} />
                );
              const label =
                type === "LIKE"
                  ? "Like"
                  : type === "DISLIKE"
                    ? "Dislike"
                    : "Fire";
              const active = reactedWith === type;
              const muted = !!reactedWith && !active;

              return (
                <button
                  key={type}
                  onClick={() => react(type)}
                  disabled={!current || (!!reactedWith && !active)}
                  aria-label={label}
                  aria-pressed={active}
                  style={{
                    height: 48,
                    minWidth: 64,
                    padding: "0 16px",
                    borderRadius: 0,
                    border: "4px solid #000",
                    background: active
                      ? "#a78bfa"
                      : "#fff",
                    color: "#000",
                    cursor:
                      !current || (!!reactedWith && !active)
                        ? "not-allowed"
                        : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: muted ? 0.35 : 1,
                    transform: active ? "translate(2px, 2px)" : "none",
                    boxShadow:
                      active || muted ? "none" : "4px 4px 0 #a78bfa",
                    transition: "all 0.1s ease",
                  }}
                  onMouseDown={(e) => {
                    if (!e.currentTarget.disabled && !active) {
                      e.currentTarget.style.transform = "translate(2px, 2px)";
                      e.currentTarget.style.boxShadow = "none";
                    }
                  }}
                  onMouseUp={(e) => {
                    if (!e.currentTarget.disabled && !active) {
                      e.currentTarget.style.transform = "";
                      e.currentTarget.style.boxShadow = "4px 4px 0 #a78bfa";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!e.currentTarget.disabled && !active) {
                      e.currentTarget.style.transform = "";
                      e.currentTarget.style.boxShadow = "4px 4px 0 #a78bfa";
                    }
                  }}
                >
                  {icon}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

/* ─── IconBtn ─────────────────────────────────────────────────── */
function IconBtn({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 0,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text)",
        opacity: disabled ? 0.4 : 1,
        boxShadow: disabled ? "none" : "2px 2px 0 var(--color-text)",
        transition: "transform 0.1s ease",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.transform =
            "translate(1px, 1px)";
      }}
      onMouseLeave={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.transform = "";
      }}
      onMouseDown={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.transform =
            "translate(2px, 2px)";
      }}
      onMouseUp={(e) => {
        if (!disabled)
          (e.currentTarget as HTMLButtonElement).style.transform =
            "translate(1px, 1px)";
      }}
    >
      {children}
    </button>
  );
}
