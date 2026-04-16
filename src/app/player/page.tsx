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
  History,
  ArrowLeft,
  RotateCcw,
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
const BAR_COUNT = 80;
const MAX_BAR_H = 5.5;
const ANALYSER_FFT_SIZE = 1024;
const ANALYSER_SMOOTHING = 0.55;
const DEFAULT_SAMPLE_RATE = 44100;
const VISUALIZER_MIN_FREQ = 30;
const VISUALIZER_MAX_FREQ = 16000;
const BEAT_HISTORY_FRAMES = 43;
const EFFECTS_TARGET_RMS = 0.2;
const EFFECTS_MIN_GAIN = 0.85;
const EFFECTS_MAX_GAIN = 3.4;

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
function hsl(h: number, s: number, l: number, a: number = 1): string {
  // Round to 1 decimal place to ensure cross-browser compatibility with CSS hsl()
  const hueStr = (h % 360).toFixed(1);
  return `hsla(${hueStr}, ${s}%, ${l}%, ${a})`;
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
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const [waveLoadPct, setWaveLoadPct] = useState(0);
  const [preloadingNextId, setPreloadingNextId] = useState<string | null>(null);

  /* DOM refs */
  const waveformRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const composerRef = useRef<any>(null);

  /* Audio refs — never recreated */
  const wsRef = useRef<any>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bassAnalyserRef = useRef<AnalyserNode | null>(null);
  const fftDataRef = useRef(new Uint8Array(128));
  const timeDataRef = useRef(new Uint8Array(ANALYSER_FFT_SIZE));
  const bassTimeDataRef = useRef(new Uint8Array(ANALYSER_FFT_SIZE));
  const oscCanvasRef = useRef<HTMLCanvasElement>(null);

  /* Beat detection state */
  const hueRef = useRef(0);
  const lastKickRef = useRef(0);
  const kickAccumRef = useRef(0);

  /* Three.js refs */
  const rendererRef = useRef<any>(null);
  const barsRef = useRef<Array<{ main: any; mirror: any; mat: any; mirrorMat: any }>>([]);
  const rafRef = useRef<number>(0);

  /* Stable refs for stale closure safety */
  const queueRef = useRef<Submission[]>([]);
  queueRef.current = queue;
  const currentIdRef = useRef<string | null>(null);
  const activeIdxRef = useRef(0);
  activeIdxRef.current = activeIdx;
  const autoPlayEnabledRef = useRef(false);
  autoPlayEnabledRef.current = autoPlayEnabled;
  const autoAdvanceRef = useRef(false);
  const preloadedTrackRef = useRef<{ id: string; blob: Blob } | null>(null);
  const preloadAbortRef = useRef<AbortController | null>(null);

  const current = queue[activeIdx] ?? null;

  /* ─── Fetch Queue ─── */
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue");
      const data: Submission[] = await res.json();
      setQueue(data);
      setQueueCount(data.length);
      if (data.length === 0) {
        setActiveIdx(0);
      } else {
        setActiveIdx((idx) => Math.min(idx, data.length - 1));
      }
    } catch {
      setQueue([]);
      setQueueCount(0);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    const saved = window.localStorage.getItem("wave.autoplay");
    if (saved === "1") {
      setAutoPlayEnabled(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("wave.autoplay", autoPlayEnabled ? "1" : "0");
  }, [autoPlayEnabled]);

  /* ─── SSE: live queue count ─── */
  useEffect(() => {
    const es = new EventSource("/api/events/queue-count");
    es.onmessage = () => {
      void fetchQueue();
    };
    return () => es.close();
  }, [fetchQueue]);

  const replayQueue = useCallback(async () => {
    try {
      await fetch("/api/submissions/restore", { method: "POST" });
      await fetchQueue();
    } catch {
      /* silent */
    }
  }, [fetchQueue]);

  const markSubmissionPlayed = useCallback(async (submissionId: string) => {
    try {
      await fetch(`/api/submissions/${submissionId}/played`, {
        method: "PUT",
      });
    } catch {
      /* silent */
    }
  }, []);

  const loadTrackIntoPlayer = useCallback((submission: Submission) => {
    if (!wsRef.current) return;

    const preloaded = preloadedTrackRef.current;
    setWaveReady(false);
    setWaveLoadPct(0);

    if (preloaded?.id === submission.id) {
      console.log("[WS] loading preloaded blob:", submission.id);
      void wsRef.current.loadBlob(preloaded.blob);
      preloadedTrackRef.current = null;
      setPreloadingNextId((value) => (value === submission.id ? null : value));
      return;
    }

    console.log("[WS] loading track via url:", submission.id);
    wsRef.current.load("/api/audio/" + submission.id);
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
      camera.position.set(0, 5, 16);
      camera.lookAt(0, 1.5, 0);

      const { EffectComposer } = await import("three/examples/jsm/postprocessing/EffectComposer.js");
      const { RenderPass } = await import("three/examples/jsm/postprocessing/RenderPass.js");
      const { ShaderPass } = await import("three/examples/jsm/postprocessing/ShaderPass.js");

      const composer = new EffectComposer(renderer);
      composerRef.current = composer;
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      const CustomLensShader = {
        uniforms: {
          tDiffuse: { value: null },
          uAmount: { value: -0.25 }, // Reversed fisheye (distorts slightly outward at edges)
          uChroma: { value: 0.01 }  // Distance of RGB split
        },
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float uAmount;
          uniform float uChroma;
          varying vec2 vUv;
          void main() {
            vec2 pos = vUv - 0.5;
            float r2 = dot(pos, pos);
            // Reverse fisheye projection
            vec2 dUv = vUv + pos * r2 * uAmount;
            
            // Chromatic Aberration
            vec4 cr = texture2D(tDiffuse, dUv * (1.0 + uChroma) - (uChroma * 0.5));
            vec4 cg = texture2D(tDiffuse, dUv);
            vec4 cb = texture2D(tDiffuse, dUv * (1.0 - uChroma) + (uChroma * 0.5));
            
            // Maintain visible alpha for shifted fringes
            float alpha = max(cr.a, max(cg.a, cb.a));
            
            // Subtle Vignette
            float vig = 1.0 - smoothstep(0.4, 0.8, length(pos));
            
            gl_FragColor = vec4(cr.r, cg.g, cb.b, alpha) * mix(0.85, 1.0, vig);
          }
        `
      };
      const lensPass = new ShaderPass(CustomLensShader);
      composer.addPass(lensPass);

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
      const PARTICLE_COUNT = 1200;
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

      /* Floor grid — custom shader for ripples + grid + scroll toward camera */
      const floorGeo = new THREE.PlaneGeometry(60, 60, 30, 30);
      const floorMat = new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: {
          u_time: { value: 0 },
          u_color: { value: new THREE.Color(0x6366f1) },
          u_rippleRadius: { value: 0.0 },
          u_rippleWidth: { value: 1.5 },
          u_rippleAlpha: { value: 0.0 },
          u_baseOpacity: { value: 0.05 },
          u_scroll: { value: 0.0 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vPos;
          uniform float u_time;
          void main() {
            vUv = uv;
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vPos;
          uniform vec3 u_color;
          uniform float u_rippleRadius;
          uniform float u_rippleWidth;
          uniform float u_rippleAlpha;
          uniform float u_baseOpacity;
          uniform float u_scroll;

          void main() {
            float dist = length(vPos.xy); 
            
            // Scrolling UV — grid moves toward camera (positive Y in plane space)
            vec2 scrollUv = vUv;
            scrollUv.y = fract(scrollUv.y + u_scroll);
            
            // Procedural grid lines with scroll
            vec2 grid = abs(fract(scrollUv * 40.0 - 0.5) - 0.5) / fwidth(scrollUv * 40.0);
            float line = min(grid.x, grid.y);
            float gridAlpha = 1.0 - min(line, 1.0);
            
            // Expand ring
            float ripple = smoothstep(u_rippleRadius - u_rippleWidth, u_rippleRadius, dist) 
                         * smoothstep(u_rippleRadius + u_rippleWidth, u_rippleRadius, dist);
            
            float finalAlpha = u_baseOpacity + (gridAlpha * 0.18) + (ripple * u_rippleAlpha * 2.0);
            vec3 finalColor = u_color + (ripple * vec3(1.0) * 0.8);

            // Radial soft fade outward
            float fade = smoothstep(30.0, 2.0, dist);
            
            gl_FragColor = vec4(finalColor, finalAlpha * fade);
          }
        `
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.1;
      scene.add(floor);

      /* Bars — split into left & right towers flanking the player */
      const spacing = 0.22;
      const halfCount = BAR_COUNT / 2;
      const groupW = (halfCount - 1) * spacing;
      const gapHalf = 5.5; // distance from center to inner edge of each tower
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
        // Left tower: bars 0..halfCount-1, Right tower: bars halfCount..BAR_COUNT-1
        if (i < halfCount) {
          // Left group: inner edge at -gapHalf, bars extend leftward
          main.position.x = -gapHalf - (halfCount - 1 - i) * spacing;
        } else {
          // Right group: inner edge at +gapHalf, bars extend rightward
          main.position.x = gapHalf + (i - halfCount) * spacing;
        }
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
        if (composerRef.current) {
          composerRef.current.setSize(nw, nh);
        }
      });
      ro.observe(canvas);

      /* Mouse tracking for UI Levitation */
      let mouseX = 0;
      let mouseY = 0;
      const onMouseMove = (e: MouseEvent) => {
        mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
      };
      window.addEventListener("mousemove", onMouseMove);

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
      let ampFast = 0;
      let ampSlow = 0;
      let bassFast = 0;
      let bassSlow = 0;
      let bassRise = 0;
      let cameraShakeX = 0;
      let cameraShakeY = 0;
      let kickArmed = true;
      let effectsGain = 1;
      let bassEffectsGain = 1;
      let normalizedFreqData = new Uint8Array(fftDataRef.current.length);
      let normalizedTimeData = new Uint8Array(timeDataRef.current.length);
      let normalizedBassTimeData = new Uint8Array(bassTimeDataRef.current.length);

      // Ripple state
      let currentRippleRadius = 0;
      let currentRippleAlpha = 0;

      function calcRms(frame: Uint8Array): number {
        if (frame.length === 0) return 0;
        let sumSq = 0;
        for (let i = 0; i < frame.length; i++) {
          const centered = (frame[i] - 128) / 128;
          sumSq += centered * centered;
        }
        return Math.sqrt(sumSq / frame.length);
      }

      function clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
      }

      function normalizeTimeDomain(source: Uint8Array, target: Uint8Array, gain: number) {
        for (let i = 0; i < source.length; i++) {
          const centered = (source[i] - 128) * gain;
          target[i] = clamp(Math.round(centered + 128), 0, 255);
        }
      }

      function normalizeFrequencyDomain(source: Uint8Array, target: Uint8Array, gain: number) {
        for (let i = 0; i < source.length; i++) {
          target[i] = clamp(Math.round(source[i] * gain), 0, 255);
        }
      }

      function animate(now: number) {
        rafRef.current = requestAnimationFrame(animate);
        if (hidden) return;

        const data = fftDataRef.current;
        const hasAnalyser = !!analyserRef.current;
        const hasBassAnalyser = !!bassAnalyserRef.current;
        if (hasAnalyser) {
          analyserRef.current!.getByteFrequencyData(data);
          if (timeDataRef.current.length !== analyserRef.current!.fftSize) {
            timeDataRef.current = new Uint8Array(analyserRef.current!.fftSize);
          }
          analyserRef.current!.getByteTimeDomainData(timeDataRef.current);
        }
        if (hasBassAnalyser) {
          if (bassTimeDataRef.current.length !== bassAnalyserRef.current!.fftSize) {
            bassTimeDataRef.current = new Uint8Array(bassAnalyserRef.current!.fftSize);
          }
          bassAnalyserRef.current!.getByteTimeDomainData(bassTimeDataRef.current);
        }
        const sampleRate = audioCtxRef.current?.sampleRate ?? DEFAULT_SAMPLE_RATE;
        const fftSize = analyserRef.current?.fftSize ?? ANALYSER_FFT_SIZE;

        if (normalizedFreqData.length !== data.length) {
          normalizedFreqData = new Uint8Array(data.length);
        }
        if (normalizedTimeData.length !== timeDataRef.current.length) {
          normalizedTimeData = new Uint8Array(timeDataRef.current.length);
        }
        if (normalizedBassTimeData.length !== bassTimeDataRef.current.length) {
          normalizedBassTimeData = new Uint8Array(bassTimeDataRef.current.length);
        }

        const rawRms = calcRms(timeDataRef.current);
        const rawBassRms = calcRms(bassTimeDataRef.current);
        const targetEffectsGain = clamp(
          EFFECTS_TARGET_RMS / Math.max(rawRms, 0.06),
          EFFECTS_MIN_GAIN,
          EFFECTS_MAX_GAIN,
        );
        const targetBassEffectsGain = clamp(
          EFFECTS_TARGET_RMS / Math.max(rawBassRms, 0.05),
          EFFECTS_MIN_GAIN,
          EFFECTS_MAX_GAIN,
        );
        effectsGain += (targetEffectsGain - effectsGain) * 0.08;
        bassEffectsGain += (targetBassEffectsGain - bassEffectsGain) * 0.1;

        normalizeFrequencyDomain(data, normalizedFreqData, effectsGain);
        normalizeTimeDomain(timeDataRef.current, normalizedTimeData, effectsGain);
        normalizeTimeDomain(bassTimeDataRef.current, normalizedBassTimeData, bassEffectsGain);

        /* Full-mix RMS envelope for macro motion and particle speed. */
        const rms = calcRms(normalizedTimeData);
        const bassRms = calcRms(normalizedBassTimeData);
        ampFast += 0.28 * (rms - ampFast);
        ampSlow += 0.07 * (rms - ampSlow);
        const prevBassFast = bassFast;
        bassFast += 0.34 * (bassRms - bassFast);
        bassSlow += 0.045 * (bassRms - bassSlow);
        bassRise = Math.max(0, bassFast - prevBassFast);

        /* Band energies */
        const rawSubBass = bandEnergyHz(normalizedFreqData, sampleRate, fftSize, 20, 60);
        const rawBass = bandEnergyHz(normalizedFreqData, sampleRate, fftSize, 20, 130);
        const rawKick = bandEnergyHz(normalizedFreqData, sampleRate, fftSize, 45, 130);
        const rawMid = bandEnergyHz(normalizedFreqData, sampleRate, fftSize, 130, 350);
        const rawHigh = bandEnergyHz(normalizedFreqData, sampleRate, fftSize, 2000, 8000);

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
        for (let k = 0; k < normalizedFreqData.length; k++) totalEnergy += normalizedFreqData[k];
        const idle = totalEnergy < 150;

        /* Kick detection — sidechain-style low-end envelope with hysteresis and cooldown. */
        const triggerLevel = Math.max(0.028, bassSlow * 1.55 + 0.01);
        const releaseLevel = Math.max(0.018, bassSlow * 1.12 + 0.003);
        const isKick =
          !idle &&
          kickArmed &&
          bassFast > triggerLevel &&
          bassRise > 0.0035 &&
          rawKick > 0.08 &&
          ampFast > ampSlow * 1.02 &&
          (now - lastKickRef.current) > 120;
        if (isKick) {
          lastKickRef.current = now;
          kickAccumRef.current = Math.min(kickAccumRef.current + 0.35, 1.0);
          kickArmed = false;
          // Trigger Ripple
          currentRippleRadius = 0;
          currentRippleAlpha = 1.0;
        } else if (!kickArmed && bassFast < releaseLevel) {
          kickArmed = true;
        }
        kickAccumRef.current *= idle ? 0.88 : 0.92;

        /* Hue rotation — smooth medium-speed cycle */
        const hueSpeed = 0.2;
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
              normalizedFreqData.length - 1,
            );
            // Square the value to create artificial dynamic range, preventing clipping
            // on excessively loud/compressed songs.
            const val = Math.pow(normalizedFreqData[binIndex] / 255, 2.0);
            targetH = Math.max(0.04, val * MAX_BAR_H);
          }

          main.scale.y += (targetH - main.scale.y) * 0.28;
          main.position.y = main.scale.y / 2;
          mirror.scale.y = main.scale.y * 0.38;
          mirror.position.y = -(mirror.scale.y / 2);

          /* Unified static color that matches EXACTLY the rest of the UI */
          const color = new THREE.Color();
          color.setHSL(hue / 360, 0.9, 0.6); // 90% saturation, 60% lightness

          if (!idle) {
            const binIndex = freqToBin(
              logFrequencyAt(i, BAR_COUNT, VISUALIZER_MIN_FREQ, VISUALIZER_MAX_FREQ),
              sampleRate,
              fftSize,
              normalizedFreqData.length - 1,
            );
            const intensity = normalizedFreqData[binIndex] / 255;
            
            mat.color.copy(color);
            mat.emissive.copy(color);
            mat.emissiveIntensity = 0.5 + intensity * 2.0; 
            mirrorMat.color.copy(color);
            mirrorMat.emissive.copy(color);
            mirrorMat.emissiveIntensity = 0.2 + intensity * 1.5;

            const centerDist = Math.abs((i / (BAR_COUNT - 1)) - 0.5) * 2.0; 
            main.position.z = Math.pow(centerDist, 2) * -3.0;
            mirror.position.z = main.position.z;
          } else {
            mat.color.copy(color);
            mat.emissive.copy(color);
            mat.emissiveIntensity = 0.5;

            const centerDist = Math.abs((i / (BAR_COUNT - 1)) - 0.5) * 2.0;
            main.position.z += (Math.pow(centerDist, 2) * -3.0 - main.position.z) * 0.1;
            mirror.position.z = main.position.z;
          }
        }

        /* ── DYNAMIC LIGHTS ── */
        const unifiedColor = new THREE.Color();
        unifiedColor.setHSL(hue / 360, 0.9, 0.6);
        
        if (!idle) {
          pointLightL.color.copy(unifiedColor);
          pointLightL.intensity = 3 + rawSubBass * 18;

          pointLightR.color.copy(unifiedColor);
          pointLightR.intensity = 3 + smoothKick * 22;

          pointLightTop.color.copy(unifiedColor);
          pointLightTop.intensity = 2 + smoothHigh * 12;

          ambientLight.intensity = 4 + rawBass * 10;
          const ambColor = new THREE.Color();
          ambColor.setHSL(hue / 360, 0.9, 0.15); // darker ambient version of exact hue
          ambientLight.color.copy(ambColor);

          dirLight.intensity = 2 + smoothMid * 5;
        } else {
          pointLightL.intensity = 0;
          pointLightR.intensity = 0;
          pointLightTop.intensity = 0;
          ambientLight.intensity = 5;
          const idleAmbColor = new THREE.Color();
          idleAmbColor.setHSL(hue / 360, 0.9, 0.1);
          ambientLight.color.copy(idleAmbColor);
          dirLight.intensity = 2.5;
        }

        /* ── FLOOR PULSE & RIPPLE SHADER ── */
        floorMat.uniforms.u_time.value = now * 0.001;
        // Grid scroll toward camera — speed reacts to bass
        const scrollSpeed = idle ? 0.0004 : 0.0008 + smoothBass * 0.003 + kickAccumRef.current * 0.002;
        floorMat.uniforms.u_scroll.value = (floorMat.uniforms.u_scroll.value + scrollSpeed) % 1.0;
        
        // Progress ripple — fast expand, quick fade
        currentRippleRadius += 1.6; 
        currentRippleAlpha *= 0.88;
        floorMat.uniforms.u_rippleRadius.value = currentRippleRadius;
        floorMat.uniforms.u_rippleAlpha.value = currentRippleAlpha * kickAccumRef.current;
        
        {
          const fColor = new THREE.Color();
          fColor.setHSL(hue / 360, 0.9, 0.6); // identical to UI
          floorMat.uniforms.u_color.value.copy(fColor);
          floorMat.uniforms.u_baseOpacity.value = idle ? 0.05 : 0.04 + Math.pow(rawSubBass, 2.0) * 0.15;
        }

        /* ── PARTICLES HYPERDRIVE ── */
        const pArr = particleGeo.attributes.position.array as Float32Array;
        // Normalize particle speed to stop overreacting to loud/squashed tracks
        const particleSpeed = idle
          ? 0.008
          : 0.02 + Math.pow(ampSlow, 1.3) * 0.1 + Math.pow(bassFast, 1.5) * 0.25;
        
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          pArr[i * 3 + 2] += particleSpeed;
          
          // Slight radial drift
          const xDrift = pArr[i * 3] > 0 ? particleSpeed * 0.2 : -particleSpeed * 0.2;
          const yDrift = pArr[i * 3 + 1] > 0 ? particleSpeed * 0.15 : -particleSpeed * 0.15;
          pArr[i * 3] += xDrift;
          pArr[i * 3 + 1] += yDrift;

          if (pArr[i * 3 + 2] > 10) {
            pArr[i * 3 + 2] = -40 - Math.random() * 20;
            pArr[i * 3] = (Math.random() - 0.5) * 60;
            pArr[i * 3 + 1] = (Math.random() - 0.5) * 40;
          }
        }
        particleGeo.attributes.position.needsUpdate = true;
        particleMat.opacity = idle ? 0.3 : 0.4 + Math.min(0.6, ampFast * 1.5);
        if (!idle) {
          const pColor = new THREE.Color();
          pColor.setHSL(hue / 360, 0.7, 0.7); // keep particles cohesive with main hue
          particleMat.color.copy(pColor);
        }
        particleMat.size = idle ? 0.07 : 0.08 + ampFast * 0.5 + kickAccumRef.current * 0.15;

        /* ── CAMERA SHAKE ── */
        if (!idle) {
          const normalizedKick = Math.pow(kickAccumRef.current, 1.2);
          const shakeIntensity = normalizedKick * 0.18 + smoothBass * 0.06;
          const targetShakeX = (Math.random() - 0.5) * shakeIntensity;
          const targetShakeY = (Math.random() - 0.5) * shakeIntensity * 0.7;
          cameraShakeX += (targetShakeX - cameraShakeX) * 0.35;
          cameraShakeY += (targetShakeY - cameraShakeY) * 0.35;
          
          camera.position.x = cameraShakeX;
          camera.position.y = 5 + cameraShakeY + Math.pow(smoothKick, 1.5) * 1.8; 
          camera.position.z = 16 - kickAccumRef.current * 1.5;
          camera.lookAt(cameraShakeX * 0.3, 1.5, 0);
        } else {
          cameraShakeX *= 0.85;
          cameraShakeY *= 0.85;
          camera.position.x = cameraShakeX;
          camera.position.y = 5 + cameraShakeY;
          camera.position.z = 16;
          camera.lookAt(0, 1.5, 0);
        }

        /* ── BODY BACKGROUND COLOR ── */
        const bgEl = document.getElementById("player-bg");
        if (bgEl) {
          if (!idle) {
            bgEl.style.background = `radial-gradient(ellipse at center, ${hsl(hue, 90, 15)}, ${hsl(hue, 90, 5)})`;
          } else {
            bgEl.style.background = `radial-gradient(ellipse at center, ${hsl(hue, 90, 15)}, ${hsl(hue, 90, 5)})`;
          }
          // Set CSS variable for seamless sync with React UI elements
          bgEl.style.setProperty('--theme-color', hsl(hue, 90, 65));
          bgEl.style.setProperty('--theme-color-dim', hsl(hue, 90, 65, 0.4));
        }

        /* ── VIDEO PARTICLE OVERLAY HUE SYNC ── */
        const particleOverlay = document.getElementById("particle-overlay");
        if (particleOverlay) {
          // Source video is red, so offset hue to match current theme
          const hueShift = hue % 360;
          const brightness = idle ? 0.6 : 0.8 + kickAccumRef.current * 0.4;
          particleOverlay.style.filter = `hue-rotate(${hueShift}deg) saturate(1.4) brightness(${brightness})`;
          particleOverlay.style.opacity = String(idle ? 0.25 : 0.35 + ampFast * 0.3);
          // Playback speed reacts to energy — 1x when idle, scales with amplitude
          const vid = particleOverlay.querySelector("video");
          if (vid) {
            const targetRate = idle ? 1 : Math.max(1, 1 + ampFast * 2.5 + kickAccumRef.current * 1.5);
            vid.playbackRate = Math.min(targetRate, 4);
          }
        }

        /* ── DOM LEVITATING CARD SHAKE + SCALE ── */
        const mainWrapEl = document.getElementById("main-card-area");
        if (mainWrapEl) {
          const mainWrap = mainWrapEl as any;
          // Calculate 3D levitation tilt from mouse position
          const targetTiltX = mouseY * 15; // deg
          const targetTiltY = mouseX * 15; // deg
          
          if (!mainWrap._currentTiltX) {
            mainWrap._currentTiltX = 0;
            mainWrap._currentTiltY = 0;
            mainWrap._currentScale = 1;
            mainWrap._currentTx = 0;
            mainWrap._currentTy = 0;
          }
          
          mainWrap._currentTiltX += (targetTiltX - mainWrap._currentTiltX) * 0.1;
          mainWrap._currentTiltY += (targetTiltY - mainWrap._currentTiltY) * 0.1;
          
          if (!idle) {
            const beatScaleTarget = 1 + kickAccumRef.current * 0.08 + smoothBass * 0.06;
            const targetShakeX = kickAccumRef.current > 0.03
              ? (Math.random() - 0.5) * kickAccumRef.current * 8
              : 0;
            const targetShakeY = kickAccumRef.current > 0.03
              ? (Math.random() - 0.5) * kickAccumRef.current * 4
              : 0;
              
            mainWrap._currentScale += (beatScaleTarget - mainWrap._currentScale) * 0.15;
            mainWrap._currentTx += (targetShakeX - mainWrap._currentTx) * 0.2;
            mainWrap._currentTy += (targetShakeY - mainWrap._currentTy) * 0.2;
            
            // Perspective transform + shake + scale
            mainWrap.style.transformStyle = "preserve-3d";
            mainWrap.style.transform = `perspective(1200px) rotateX(${mainWrap._currentTiltX}deg) rotateY(${mainWrap._currentTiltY}deg) scale(${mainWrap._currentScale}) translate(${mainWrap._currentTx}px, ${mainWrap._currentTy}px) translateZ(30px)`;
          } else {
            mainWrap._currentScale += (1 - mainWrap._currentScale) * 0.1;
            mainWrap._currentTx *= 0.8;
            mainWrap._currentTy *= 0.8;
            
            mainWrap.style.transformStyle = "preserve-3d";
            mainWrap.style.transform = `perspective(1200px) rotateX(${mainWrap._currentTiltX}deg) rotateY(${mainWrap._currentTiltY}deg) scale(${mainWrap._currentScale}) translate(${mainWrap._currentTx}px, ${mainWrap._currentTy}px) translateZ(10px)`;
          }
        }

        /* ── SYNC 2D HITBOX to 3D VISUAL CONTROLS ── */
        const ctrlVisual = document.getElementById("controls-visual");
        const ctrlHitbox = document.getElementById("controls-hitbox");
        if (ctrlVisual && ctrlHitbox) {
          const r = ctrlVisual.getBoundingClientRect();
          ctrlHitbox.style.left = r.left + "px";
          ctrlHitbox.style.top = r.top + "px";
          ctrlHitbox.style.width = r.width + "px";
          ctrlHitbox.style.height = r.height + "px";
        }

        /* ── SYNC 2D HITBOX to 3D VISUAL WAVEFORM ── */
        const waveVisual = document.getElementById("waveform-visual");
        const waveHitbox = document.getElementById("waveform-hitbox");
        if (waveVisual && waveHitbox) {
          const r = waveVisual.getBoundingClientRect();
          waveHitbox.style.left = r.left + "px";
          waveHitbox.style.top = r.top + "px";
          waveHitbox.style.width = r.width + "px";
          waveHitbox.style.height = r.height + "px";
        }

        /* ── CSS SHAKE CLASS for heavy bass hits ── */
        if (isKick && bgEl && !bgEl.classList.contains("shake-active")) {
          bgEl.classList.add("shake-active");
          setTimeout(() => bgEl.classList.remove("shake-active"), 120);
        }

        /* ── BORDER COLOR on card ── */
        if (mainWrapEl) {
          mainWrapEl.style.borderColor = "transparent";
        }

        /* ── OSCILLOSCOPE ── */
        if (oscCanvasRef.current && hasAnalyser) {
          const oscCtx = oscCanvasRef.current.getContext("2d");
          if (oscCtx) {
            const w = oscCanvasRef.current.width;
            const h = oscCanvasRef.current.height;
            oscCtx.clearRect(0, 0, w, h);
            oscCtx.lineWidth = 3;
            oscCtx.strokeStyle = hsl(hue, 90, 65);
            oscCtx.beginPath();
            
            const sliceWidth = w * 1.0 / timeDataRef.current.length;
            let x = 0;
            
            for (let i = 0; i < normalizedTimeData.length; i++) {
              const v = normalizedTimeData[i] / 128.0;
              const y = v * h / 2;
              
              if (i === 0) {
                oscCtx.moveTo(x, y);
              } else {
                oscCtx.lineTo(x, y);
              }
              x += sliceWidth;
            }
            oscCtx.stroke();
          }
        }

        /* ── SYNC WAVESURFER COLOR (rarely) ── */
        if ((window as any).__ws) {
          const wsObj = (window as any).__ws;
          if (!wsObj._lastHue || Math.abs(wsObj._lastHue - hue) > 2) {
            wsObj._lastHue = hue;
            wsObj.setOptions({
              waveColor: "rgba(255, 255, 255, 0.12)",
              progressColor: hsl(hue, 100, 72), // Brighter for neon glow
              cursorColor: hsl(hue, 100, 85)
            });
          }
        }

        if (composerRef.current) {
          composerRef.current.render();
        } else {
          renderer.render(scene, camera);
        }
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

  /* Keep viewport locked while player is open so shake transforms never add scrollbars. */
  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverscroll = document.documentElement.style.overscrollBehavior;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscroll;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
    };
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
        height: 250, // Massive waveform
        waveColor: "rgba(255, 255, 255, 0.10)", // Dim base — contrast with glowing progress
        progressColor: "#ffffff", // Overridden instantly in render loop
        cursorColor: "#ffffff",
        cursorWidth: 3,
        barWidth: 4,
        barGap: 3,
        barRadius: 6,
        normalize: true,
        interact: false,
        dragToSeek: false,
      });
      (window as any).__ws = ws;
      console.log("[WS] instance created");

      ws.on("ready", () => {
        console.log("[WS] READY — duration:", ws.getDuration());
        setDuration(ws.getDuration());
        setWaveReady(true);
        setWaveLoadPct(100);
        if (autoAdvanceRef.current) {
          autoAdvanceRef.current = false;
          audioCtxRef.current?.resume();
          try {
            void ws.play();
          } catch {
            /* silent */
          }
        }
      });

      ws.on("error", (err: unknown) => {
        console.error("[WS] ERROR:", err);
        setWaveReady(false);
        setWaveLoadPct(0);
        const q = queueRef.current;
        const nextIdx = activeIdxRef.current + 1;
        if (nextIdx < q.length) {
          setActiveIdx(nextIdx);
          setReactedWith(null);
        } else {
          setIsPlaying(false);
        }
      });

      ws.on("loading", (pct: number) => {
        console.log("[WS] loading:", pct + "%");
        setWaveLoadPct(pct);
      });

      ws.on("play", () => {
        setIsPlaying(true);
        audioCtxRef.current?.resume();
      });

      ws.on("pause", () => setIsPlaying(false));

      ws.on("timeupdate", (t: number) => setCurrentTime(t));

      ws.on("finish", () => {
        setIsPlaying(false);
        if (currentIdRef.current) {
          void markSubmissionPlayed(currentIdRef.current);
        }

        const q = queueRef.current;
        const nextIdx = activeIdxRef.current + 1;
        if (autoPlayEnabledRef.current && nextIdx < q.length) {
          autoAdvanceRef.current = true;
          setWaveReady(false);
          window.setTimeout(() => {
            const upcomingIdx = activeIdxRef.current + 1;
            if (upcomingIdx < queueRef.current.length) {
              setReactedWith(null);
              setActiveIdx(upcomingIdx);
            } else {
              autoAdvanceRef.current = false;
            }
          }, 280);
        }
      });

      wsRef.current = ws;
      audioElRef.current = ws.getMediaElement();

      /* If a track was already pending (queue loaded before wavesurfer) */
      if (currentIdRef.current) {
        console.log("[WS] loading pending track:", currentIdRef.current);
        const pendingTrack = queueRef.current.find((item) => item.id === currentIdRef.current);
        if (pendingTrack) {
          loadTrackIntoPlayer(pendingTrack);
        } else {
          ws.load("/api/audio/" + currentIdRef.current);
          setWaveReady(false);
        }
      } else {
        console.log("[WS] no pending track");
      }
    })().catch((err) => console.error("[WS] init failed:", err));

    return () => {
      preloadAbortRef.current?.abort();
      wsRef.current?.destroy();
      wsRef.current = null;
      audioElRef.current = null;
    };
  }, [loadTrackIntoPlayer]);

      /* ─── Load track when current changes ─── */
  useEffect(() => {
    if (!current) return;
    currentIdRef.current = current.id;
    setCurrentTime(0);
    setDuration(0);
    setWaveReady(false);
    setWaveLoadPct(0);

    if (!wsRef.current) {
      console.log("[WS] track changed but wsRef not ready yet, track:", current.id);
      return;
    }
    loadTrackIntoPlayer(current);
  }, [current, loadTrackIntoPlayer]);

  useEffect(() => {
    const nextTrack = queue[activeIdx + 1] ?? null;

    preloadAbortRef.current?.abort();
    preloadAbortRef.current = null;

    if (!nextTrack) {
      preloadedTrackRef.current = null;
      setPreloadingNextId(null);
      return;
    }

    if (preloadedTrackRef.current?.id === nextTrack.id) {
      setPreloadingNextId(nextTrack.id);
      return;
    }

    const controller = new AbortController();
    preloadAbortRef.current = controller;
    setPreloadingNextId(nextTrack.id);

    void fetch(`/api/audio/${nextTrack.id}`, {
      signal: controller.signal,
      cache: "force-cache",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to preload next track");
        const blob = await res.blob();
        if (!controller.signal.aborted) {
          preloadedTrackRef.current = { id: nextTrack.id, blob };
        }
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") {
          console.error("[WS] preload next failed:", err);
          if (preloadedTrackRef.current?.id === nextTrack.id) {
            preloadedTrackRef.current = null;
          }
          setPreloadingNextId(null);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeIdx, queue]);

  /* ─── Controls ─── */
  const togglePlay = useCallback(() => {
    if (!wsRef.current) return;

    /* Init Web Audio chain on first user gesture */
    if (!audioCtxRef.current && audioElRef.current) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audioElRef.current);
      const analyser = ctx.createAnalyser();
      const bassFilter = ctx.createBiquadFilter();
      const bassAnalyser = ctx.createAnalyser();

      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      bassFilter.type = "lowpass";
      bassFilter.frequency.value = 150;
      bassFilter.Q.value = 0.9;
      bassAnalyser.fftSize = ANALYSER_FFT_SIZE;
      bassAnalyser.smoothingTimeConstant = 0.55;

      source.connect(analyser);
      analyser.connect(ctx.destination);
      source.connect(bassFilter);
      bassFilter.connect(bassAnalyser);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      bassAnalyserRef.current = bassAnalyser;
      fftDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(analyser.fftSize);
      bassTimeDataRef.current = new Uint8Array(bassAnalyser.fftSize);
    }

    audioCtxRef.current?.resume();
    wsRef.current.playPause();
  }, []);

  const goPrev = () => {
    if (activeIdx > 0) {
      autoAdvanceRef.current = isPlaying;
      setActiveIdx((i) => i - 1);
      setReactedWith(null);
      setWaveReady(false);
    }
  };

  const goNext = () => {
    if (activeIdx < queue.length - 1) {
      autoAdvanceRef.current = isPlaying;
      setActiveIdx((i) => i + 1);
      setReactedWith(null);
      setWaveReady(false);
    }
  };

  const toggleAutoPlay = () => {
    setAutoPlayEnabled((value) => !value);
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

  const seekFromClientX = useCallback((clientX: number) => {
    if (!wsRef.current || !current) return;

    const hitbox = document.getElementById("waveform-hitbox");
    if (!hitbox) return;
    const rect = hitbox.getBoundingClientRect();
    if (rect.width <= 0) return;

    const localX = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const ratio = localX / rect.width;
    wsRef.current.seekTo(ratio);
  }, [current]);

  const onWaveSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!current || !waveReady) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const onWaveSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!current || !waveReady) return;
    if (!(e.buttons & 1)) return;
    seekFromClientX(e.clientX);
  };

  const onWaveSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!current || !waveReady) return;
    seekFromClientX(e.clientX);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  /* ─── Derived values ─── */
  const avatarSrc = current?.avatarPath
    ? "/api/avatars/" + current.avatarPath.split("/").pop()
    : null;

  const progress = duration > 0 ? currentTime / duration : 0;
  const nextQueuedTrack = queue[activeIdx + 1] ?? null;

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
        #player-bg.shake-active {
          animation: shake 0.15s ease-in-out;
        }

        /* ── Rain ── */
        @keyframes rain-fall {
          0% { transform: translateY(-100vh) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100vh) translateX(-30px); opacity: 0; }
        }
        .rain-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }
        .rain-drop {
          position: absolute;
          top: -10px;
          width: 1px;
          background: linear-gradient(to bottom, transparent, rgba(180,200,255,0.4), transparent);
          animation: rain-fall linear infinite;
        }

        /* ── Clouds ── */
        @keyframes cloud-drift {
          0% { transform: translateX(-20%); }
          100% { transform: translateX(20%); }
        }
        .cloud-layer {
          position: absolute;
          top: 0;
          left: -20%;
          width: 140%;
          height: 45%;
          pointer-events: none;
          z-index: 0;
          opacity: 0.3;
          background:
            radial-gradient(ellipse 600px 120px at 15% 30%, rgba(100,100,140,0.5), transparent),
            radial-gradient(ellipse 500px 100px at 45% 20%, rgba(80,80,130,0.4), transparent),
            radial-gradient(ellipse 700px 130px at 70% 35%, rgba(90,90,140,0.45), transparent),
            radial-gradient(ellipse 400px 90px at 85% 15%, rgba(100,90,150,0.35), transparent),
            radial-gradient(ellipse 550px 110px at 30% 45%, rgba(70,70,120,0.3), transparent);
          animation: cloud-drift 60s ease-in-out infinite alternate;
        }
        @media (prefers-reduced-motion: no-preference) {
          #main-player-card {
            transition: transform 0.05s ease-out, box-shadow 0.08s ease-out, border-color 0.1s ease-out;
            transform-style: preserve-3d;
          }
          /* 2D hitbox wrapper — always flat, stable cursor */
          .btn-wrap {
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            position: relative;
            outline: none;
          }
          .btn-wrap:disabled {
            cursor: not-allowed;
          }
          /* 3D visual — never receives pointer events */
          .btn-3d {
            pointer-events: none;
            transform: translateZ(8px);
            transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s ease-out, color 0.15s ease-out, filter 0.15s ease-out;
            backface-visibility: hidden;
          }
          .btn-3d.hovered {
            transform: translateZ(28px) rotateX(-6deg) scale(1.12);
            box-shadow: 0 18px 30px rgba(0,0,0,0.5), 0 0 15px var(--theme-color-dim);
            color: var(--theme-color);
            filter: brightness(1.2);
          }
          .btn-3d.pressed {
            transform: translateZ(2px) rotateX(2deg) scale(0.92);
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            transition-duration: 0.06s;
          }
          .avatar-3d {
            transform: translateZ(30px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
          }
          .text-3d {
            transform: translateZ(20px);
            text-shadow: 0 5px 10px rgba(0,0,0,0.1);
          }
          .waveform-3d {
            transform: translateZ(35px);
          }
        }
        
        /* ── WaveSurfer Custom Neon Glow ── */
        .wavesurfer-glow {
          filter: drop-shadow(0 0 6px var(--theme-color-dim));
        }
        .wavesurfer-glow::part(progress) {
          filter:
            brightness(1.3)
            drop-shadow(0 0 6px var(--theme-color))
            drop-shadow(0 0 14px var(--theme-color))
            drop-shadow(0 0 28px var(--theme-color-dim)) !important;
        }
        .wavesurfer-glow::part(cursor) {
          box-shadow:
            0 0 8px 2px var(--theme-color),
            0 0 20px 4px var(--theme-color-dim);
        }
        @keyframes waveform-loader-sweep {
          0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateX(220%) skewX(-18deg); opacity: 0; }
        }
        @keyframes waveform-loader-bars {
          0%, 100% { transform: scaleY(0.35); opacity: 0.35; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    <div
      id="player-bg"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#000",
        boxShadow: "inset 0 0 250px rgba(0,0,0,0.9)", // Add dark fullscreen vignette
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        overscrollBehavior: "none",
        fontFamily: "var(--font-sans)",
        userSelect: "none",
        maxWidth: "100vw",
        maxHeight: "100vh",
      }}
    >
      {/* ── THREE.JS VISUALIZER BACKGROUND ── */}

      {/* Back to home */}
      <a
        href="/"
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 10,
          color: "rgba(255,255,255,0.4)",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
        onMouseLeave={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}
      >
        <ArrowLeft size={18} /> HOME
      </a>

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

      {/* ── CLOUDS ── */}
      <div className="cloud-layer" aria-hidden="true" />

      {/* ── RAIN ── */}
      <div className="rain-layer" aria-hidden="true">
        {Array.from({ length: 80 }, (_, i) => {
          // Deterministic pseudo-random per index to avoid hydration mismatch
          const s = (i * 2654435761 >>> 0) / 4294967296;
          const s2 = ((i * 2654435761 + 1013904223) >>> 0) / 4294967296;
          const s3 = ((i * 1664525 + 1013904223) >>> 0) / 4294967296;
          const s4 = ((i * 1103515245 + 12345) >>> 0) / 4294967296;
          const s5 = ((i * 214013 + 2531011) >>> 0) / 4294967296;
          return (
            <div
              key={i}
              className="rain-drop"
              style={{
                left: `${s * 100}%`,
                height: `${40 + s2 * 80}px`,
                animationDuration: `${0.6 + s3 * 0.8}s`,
                animationDelay: `${s4 * 2}s`,
                opacity: 0.15 + s5 * 0.25,
              }}
            />
          );
        })}
      </div>

      {/* ── VIDEO PARTICLE OVERLAY ── */}
      <div
        id="particle-overlay"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
          pointerEvents: "none",
          mixBlendMode: "screen",
          opacity: 0.45,
          filter: "hue-rotate(0deg) saturate(1.4)",
        }}
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        >
          <source src="/particles.mp4" type="video/mp4" />
        </video>
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
        id="main-player-wrap"
        style={{
          width: "90vw",
          maxWidth: 1400,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          zIndex: 10,
          position: "relative",
          gap: 24,
          perspective: "1200px",
        }}
      >
        {/* Inner div that gets the 3D shake/tilt — controls stay outside */}
        <div
          id="main-card-area"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            width: "100%",
            transformStyle: "preserve-3d",
          }}
        >
        {/* ── HEADER B&W ── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "16px 32px",
            background: "rgba(255, 255, 255, 0.15)",
            backdropFilter: "blur(20px)",
            borderRadius: 100,
            border: "1px solid rgba(255, 255, 255, 0.3)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 900,
                color: "#fff",
                textTransform: "uppercase",
              }}
            >
              WAVE PLAYER / {queueCount || 0} UNPLAYED
            </span>
            <a
              href="/history"
              title="View history"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.6)",
                border: "none",
                textDecoration: "none",
                transition: "all 0.15s",
                marginLeft: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.25)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
            >
              <History size={16} />
            </a>
          </div>
        {/* ── SUBMISSION INFO CONTINUED ── */}
          {current ? (
            <>
              <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.3)" }} />
              {/* Avatar */}
              <div
                className="avatar-3d"
                aria-hidden="true"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  overflow: "hidden",
                  flexShrink: 0,
                  background: "#000",
                  border: "2px solid rgba(255, 255, 255, 0.5)",
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
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <p
                  style={{
                    fontWeight: 900,
                    fontSize: 20,
                    color: "#fff",
                    lineHeight: 1.1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {current.artistName}
                </p>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "rgba(255, 255, 255, 0.6)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {current.artistNote ? current.artistNote : "Untitled Track"}
                </p>
              </div>

              <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.3)" }} />

              {/* Time display */}
              <div
                className="text-3d"
                aria-label={fmtTime(currentTime) + " of " + fmtTime(duration)}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 900,
                  letterSpacing: "-0.05em",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                <span>{fmtTime(currentTime)}</span>
                <span style={{ margin: "0 4px", color: "var(--theme-color)" }}>/</span>
                <span>{fmtTime(duration)}</span>
              </div>

              {/* Progress pill */}
              <div
                className="text-3d"
                aria-hidden="true"
                style={{
                  padding: "4px 12px",
                  background: "rgba(255,255,255,0.2)",
                  color: "#fff",
                  borderRadius: 100,
                  fontWeight: 900,
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {activeIdx + 1} / {queue.length}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <p style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>
                {isLoading ? "LOADING..." : "NO TRACK SELECTED"}
              </p>
              {!isLoading && queueCount === 0 && (
                <button
                  onClick={replayQueue}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  <RotateCcw size={14} /> Replay Queue
                </button>
              )}
            </div>
          )}
        </header>

        {/* ── WAVEFORM ── */}
        <div
          id="main-player-card"
          className="waveform-3d"
          style={{
            width: "100%",
            height: 250,
            padding: "24px",
            background: "rgba(255, 255, 255, 0.15)",
            backdropFilter: "blur(40px)",
            borderRadius: 32,
            border: "1px solid rgba(255, 255, 255, 0.2)",
            boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            position: "relative",
            pointerEvents: "none",
          }}
        >
          <div style={{ position: "relative", width: "100%", height: 250 }}>
            <canvas
              ref={oscCanvasRef}
              width={1400}
              height={250}
              className="absolute inset-0 pointer-events-none z-10"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: 10,
              }}
            />
            {/* WaveSurfer container — normal flow so it gets real width */}
            <div
              id="waveform-visual"
              ref={waveformRef}
              className="wavesurfer-glow"
              aria-label="Waveform — click to seek"
              style={{
                height: 250,
                position: "absolute",
                inset: 0,
                zIndex: 1,
                opacity: 1.0,
                pointerEvents: "none",
              }}
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
                  borderRadius: 16,
                  overflow: "hidden",
                  zIndex: 2,
                  background: "linear-gradient(180deg, rgba(4,10,26,0.78), rgba(5,9,20,0.92))",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.16) 50%, transparent 100%)",
                    animation: "waveform-loader-sweep 1.8s ease-in-out infinite",
                    pointerEvents: "none",
                  }}
                />
                <div style={{
                  position: "relative",
                  zIndex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  width: "100%",
                  padding: "0 28px",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 48 }}>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <span
                        key={index}
                        style={{
                          width: 10,
                          height: 42,
                          borderRadius: 999,
                          background: index % 2 === 0 ? "var(--theme-color)" : "rgba(255,255,255,0.92)",
                          transformOrigin: "center bottom",
                          animation: `waveform-loader-bars ${0.72 + index * 0.08}s ease-in-out infinite`,
                          animationDelay: `${index * 0.08}s`,
                          boxShadow: index % 2 === 0 ? "0 0 18px var(--theme-color-dim)" : "0 0 16px rgba(255,255,255,0.18)",
                        }}
                      />
                    ))}
                  </div>
                  <div style={{
                    width: "min(420px, 100%)",
                    height: 8,
                    borderRadius: 999,
                    overflow: "hidden",
                    background: "rgba(255,255,255,0.08)",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                  }}>
                    <div style={{
                      width: `${Math.max(6, waveLoadPct)}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: "linear-gradient(90deg, rgba(255,255,255,0.85), var(--theme-color))",
                      boxShadow: "0 0 22px var(--theme-color-dim)",
                      transition: "width 0.12s linear",
                    }} />
                  </div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.84)",
                  }}>
                    <span>{current ? `Loading track ${Math.round(waveLoadPct)}%` : "Waiting for track"}</span>
                    {preloadingNextId && nextQueuedTrack && (
                      <span style={{ color: "rgba(255,255,255,0.52)" }}>
                        Next primed: {nextQueuedTrack.artistName}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── CONTROLS (3D visual only — no pointer events) ── */}
        <div
          id="controls-visual"
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 24,
            padding: "16px 32px",
            background: "rgba(255, 255, 255, 0.15)",
            backdropFilter: "blur(20px)",
            borderRadius: 100,
            border: "1px solid rgba(255, 255, 255, 0.3)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
            transformStyle: "preserve-3d" as any,
            perspective: "200px",
            pointerEvents: "none",
          }}
        >
          {/* Dislike */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span data-btn="dislike" className="btn-3d" style={{
              width: 48, height: 48, borderRadius: "50%",
              background: reactedWith === "DISLIKE" ? "var(--theme-color)" : "rgba(0,0,0,0.3)",
              color: reactedWith === "DISLIKE" ? "#000" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><ThumbsDown size={20} /></span>
            <span data-btn="autoplay" className="btn-3d" style={{
              minWidth: 90, height: 48, borderRadius: 24,
              padding: "0 14px",
              background: autoPlayEnabled ? "var(--theme-color)" : "rgba(0,0,0,0.3)",
              color: autoPlayEnabled ? "#000" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 8,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}><PlaySquare size={18} /> Auto</span>
          </div>
          <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.3)" }} />
          {/* Transport */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span data-btn="prev" className="btn-3d" style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "rgba(0,0,0,0.3)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: activeIdx === 0 ? 0.3 : 1,
            }}><SkipBack fill="currentColor" size={20} /></span>
            <span data-btn="play" className="btn-3d" style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "#fff", color: "#000",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: current && waveReady ? 1 : 0.5,
            }}>
              {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
            </span>
            <span data-btn="next" className="btn-3d" style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "rgba(0,0,0,0.3)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: activeIdx >= queue.length - 1 ? 0.3 : 1,
            }}><SkipForward fill="currentColor" size={20} /></span>
          </div>
          <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.3)" }} />
          {/* Reactions */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span data-btn="like" className="btn-3d" style={{
              width: 48, height: 48, borderRadius: "50%",
              background: reactedWith === "LIKE" ? "var(--theme-color)" : "rgba(0,0,0,0.3)",
              color: reactedWith === "LIKE" ? "#000" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><ThumbsUp size={20} /></span>
            <span data-btn="fire" className="btn-3d" style={{
              width: 48, height: 48, borderRadius: "50%",
              background: reactedWith === "FIRE" ? "var(--theme-color)" : "rgba(0,0,0,0.3)",
              color: reactedWith === "FIRE" ? "#000" : "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><Flame size={20} /></span>
          </div>
        </div>
      </div>{/* end main-card-area */}

      </div>{/* end main-player-wrap */}
    </div>{/* end player-bg */}

    {/* ── WAVEFORM 2D HITBOX (tracks 3D visual position, outside all transforms) ── */}
    <div
      id="waveform-hitbox"
      role="slider"
      aria-label="Waveform seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(1, Math.floor(duration || 0))}
      aria-valuenow={Math.floor(currentTime || 0)}
      onPointerDown={onWaveSeekPointerDown}
      onPointerMove={onWaveSeekPointerMove}
      onPointerUp={onWaveSeekPointerUp}
      style={{
        position: "fixed",
        zIndex: 9998,
        cursor: current && waveReady ? "pointer" : "default",
        touchAction: "none",
        pointerEvents: current && waveReady ? "auto" : "none",
      }}
    />

    {/* ── CONTROLS 2D HITBOX (tracks 3D visual position, outside all transforms) ── */}
    <div
      id="controls-hitbox"
      role="toolbar"
      aria-label="Playback controls"
      style={{
        position: "fixed",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: "16px 32px",
        zIndex: 9999,
        borderRadius: 100,
      }}
    >
      {/* Reaction left */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-wrap"
          onClick={() => react("DISLIKE")}
          disabled={!current || (!!reactedWith && reactedWith !== "DISLIKE")}
          aria-label="Dislike" aria-pressed={reactedWith === "DISLIKE"}
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="dislike"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="dislike"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="dislike"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="dislike"]')?.classList.remove("pressed")}
        ><span style={{ width: 48, height: 48, display: "block" }} /></button>
        <button className="btn-wrap"
          onClick={toggleAutoPlay}
          aria-label={autoPlayEnabled ? "Disable autoplay" : "Enable autoplay"}
          aria-pressed={autoPlayEnabled}
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="autoplay"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="autoplay"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="autoplay"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="autoplay"]')?.classList.remove("pressed")}
        ><span style={{ width: 90, height: 48, display: "block" }} /></button>
      </div>
      <div style={{ width: 1, height: 32 }} />
      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button className="btn-wrap"
          onClick={goPrev} disabled={activeIdx === 0}
          aria-label="Previous track"
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="prev"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="prev"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="prev"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="prev"]')?.classList.remove("pressed")}
        ><span style={{ width: 48, height: 48, display: "block" }} /></button>
        <button className="btn-wrap"
          onClick={togglePlay} disabled={!current || !waveReady}
          aria-label={isPlaying ? "Pause" : "Play"} aria-pressed={isPlaying}
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="play"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="play"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="play"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="play"]')?.classList.remove("pressed")}
        ><span style={{ width: 64, height: 64, display: "block" }} /></button>
        <button className="btn-wrap"
          onClick={goNext} disabled={activeIdx >= queue.length - 1}
          aria-label="Next track"
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="next"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="next"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="next"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="next"]')?.classList.remove("pressed")}
        ><span style={{ width: 48, height: 48, display: "block" }} /></button>
      </div>
      <div style={{ width: 1, height: 32 }} />
      {/* Reaction right */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn-wrap"
          onClick={() => react("LIKE")}
          disabled={!current || (!!reactedWith && reactedWith !== "LIKE")}
          aria-label="Like" aria-pressed={reactedWith === "LIKE"}
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="like"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="like"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="like"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="like"]')?.classList.remove("pressed")}
        ><span style={{ width: 48, height: 48, display: "block" }} /></button>
        <button className="btn-wrap"
          onClick={() => react("FIRE")}
          disabled={!current || (!!reactedWith && reactedWith !== "FIRE")}
          aria-label="Fire" aria-pressed={reactedWith === "FIRE"}
          onMouseEnter={() => document.querySelector('#controls-visual [data-btn="fire"]')?.classList.add("hovered")}
          onMouseLeave={() => document.querySelector('#controls-visual [data-btn="fire"]')?.classList.remove("hovered","pressed")}
          onMouseDown={() => document.querySelector('#controls-visual [data-btn="fire"]')?.classList.add("pressed")}
          onMouseUp={() => document.querySelector('#controls-visual [data-btn="fire"]')?.classList.remove("pressed")}
        ><span style={{ width: 48, height: 48, display: "block" }} /></button>
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
