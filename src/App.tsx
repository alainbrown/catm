import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { Rail } from "./components/Rail";
import { encodePcmToCompleteMp4 } from "./hls/encode";
import { BASIC_TIER, formatMb } from "./modelConfig";
import { UpdateBanner } from "./pwa/UpdateBanner";
import { type IngestedDraft, consumeShareTarget, onFileLaunch } from "./pwa/ingest";
import {
  type SegmentEntry,
  type SessionMeta,
  type StorageBreakdown,
  buildSessionExport,
  createSession,
  deleteSession,
  finalizeChunkDurations,
  finalizeDuration,
  listSessions,
  measureStorage,
  renameSession,
  resetSession,
  writeInit,
  writePlaylist,
  writeSegment,
} from "./storage/sessionStore";
import { CHUNK_CHARS, chunkText } from "./textChunk";
import type { AppStatus, DocState } from "./types";
import { OnboardingView } from "./views/OnboardingView";
import { ReaderView } from "./views/ReaderView";
import type { InMsg, OutMsg, VoiceId } from "./worker/kokoro.worker";
import type { DeviceInfo } from "./worker/workerProtocol";

export interface PerfState {
  device: DeviceInfo | null;
  synthSamplesPerSec: number[]; // 60 samples of PCM samples/sec
  // Rolling memory readings (MB) from performance.measureUserAgentSpecificMemory().
  // NaN entries mean "not yet sampled" or "API unavailable" for that slot.
  memoryMb: number[];
  // Set once isolation is known. null means "not yet known"; false means
  // the API is unavailable (no COI / unsupported browser).
  memoryApiAvailable: boolean | null;
  lastSynth: { wallMs: number; audioSec: number } | null;
}

const MEM_SAMPLE_INTERVAL_MS = 5_000;
const MEM_WINDOW = 60; // 60 samples × 5 s = 5 min of history

const PERF_WINDOW = 60;

const VOICE_KEY = "catm:voice";
const DEFAULT_VOICE: VoiceId = "af_heart";

const SPEED_KEY = "catm:speed";
const DEFAULT_SPEED = 1.25;
const SPEED_PRESETS = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

function readSpeed(): number {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    if (v) {
      const n = Number(v);
      if (Number.isFinite(n) && SPEED_PRESETS.includes(n as (typeof SPEED_PRESETS)[number]))
        return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SPEED;
}

function writeSpeed(s: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(s));
  } catch {
    /* ignore */
  }
}

function readVoice(): VoiceId {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v === "af_heart" || v === "af_bella" || v === "am_michael" || v === "am_eric") return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_VOICE;
}

function writeVoice(v: VoiceId): void {
  try {
    localStorage.setItem(VOICE_KEY, v);
  } catch {
    /* ignore */
  }
}

const EMPTY_DOC: DocState = {
  id: null,
  sourceText: "",
  savedText: "",
  hasAudio: false,
  audioVoice: null,
};

const ONBOARDED_KEY = "catm:onboarded";

function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface ActiveSynth {
  sessionId: string;
  segments: SegmentEntry[];
  totalDuration: number;
  firstFragmentSeen: boolean;
  cancelled: boolean;
  chunkDurations: number[];
  resolve: () => void;
  reject: (err: Error) => void;
}

const SYNTH_CANCELLED = "__catm_synth_cancelled__";

export function App(): React.JSX.Element {
  const [onboarded, setOnboarded] = useState<boolean>(() => readOnboarded());
  const [status, setStatus] = useState<AppStatus>({ kind: "loading" });
  const [doc, setDoc] = useState<DocState>(EMPTY_DOC);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [storage, setStorage] = useState<StorageBreakdown | null>(null);
  const [speed, setSpeedState] = useState<number>(() => readSpeed());
  const setSpeed = useCallback((s: number) => {
    writeSpeed(s);
    setSpeedState(s);
  }, []);
  const [pendingNav, setPendingNav] = useState<
    { kind: "open"; id: string } | { kind: "new" } | null
  >(null);
  const [playToken, setPlayToken] = useState(0);
  const [showReadyStamp, setShowReadyStamp] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [voice, setVoice] = useState<VoiceId>(() => readVoice());
  const [liveChunkDurations, setLiveChunkDurations] = useState<number[] | null>(null);
  const [previewVoice, setPreviewVoice] = useState<VoiceId | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const deviceRef = useRef<"webgpu" | "wasm">("wasm");
  const [perf, setPerf] = useState<PerfState>({
    device: null,
    synthSamplesPerSec: new Array(PERF_WINDOW).fill(0),
    memoryMb: new Array(MEM_WINDOW).fill(Number.NaN),
    memoryApiAvailable: null,
    lastSynth: null,
  });
  const synthAccumRef = useRef(0); // samples emitted since last 1 s tick
  const workerRef = useRef<Worker | null>(null);
  const nextTxnIdRef = useRef(1);
  const pendingPreviewRef = useRef(
    new Map<number, (r: { pcm: Float32Array; sampleRate: number }) => void>(),
  );
  const activeSynthsRef = useRef(new Map<number, ActiveSynth>());
  const progressMapRef = useRef<Map<string, { loaded: number; total: number }>>(new Map());

  const modified =
    doc.sourceText !== doc.savedText || (doc.audioVoice !== null && doc.audioVoice !== voice);

  const refreshLibrary = useCallback(async () => {
    setSessions(await listSessions());
  }, []);

  const refreshStorage = useCallback(async () => {
    try {
      setStorage(await measureStorage());
    } catch {
      /* leave as-is */
    }
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessions.length is the fingerprint that re-triggers measurement
  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage, sessions.length]);

  // Best-effort: ask the browser to mark our origin's storage persistent.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => {
      /* not supported, denied, or transient failure */
    });
  }, []);

  // PWA ingestion: share_target query params (on first load) and file_handlers
  // launches (any time, while installed). We only ingest into an empty draft
  // so we never clobber unsaved work — if the user already has text, the
  // launch is dropped silently. A future iteration could prompt to open a
  // new draft instead.
  useEffect(() => {
    const ingest = (draft: IngestedDraft) => {
      if (!draft.text || draft.text.length === 0) return;
      setDoc((d) => {
        if (d.id !== null || d.sourceText.length > 0) return d;
        return { ...d, sourceText: draft.text };
      });
    };
    const initial = consumeShareTarget();
    if (initial) ingest(initial);
    const cleanup = onFileLaunch(ingest);
    return cleanup;
  }, []);

  // 1 Hz throughput rotation.
  useEffect(() => {
    const id = setInterval(() => {
      const samplesThisSecond = synthAccumRef.current;
      synthAccumRef.current = 0;
      setPerf((p) => ({
        ...p,
        synthSamplesPerSec: [...p.synthSamplesPerSec.slice(1), samplesThisSecond],
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Periodic memory measurement via the cross-origin-isolated API. Returns
  // total bytes used by the agent — page + workers + WASM, aggregated. The
  // API is browser-rate-limited (~once every several seconds), so we poll
  // every 5 s. Requires window.crossOriginIsolated; the coi-serviceworker
  // shim arranges that on page load.
  useEffect(() => {
    type Perf = Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
    const p = performance as Perf;
    const isolated = typeof window !== "undefined" && window.crossOriginIsolated === true;
    const available = isolated && typeof p.measureUserAgentSpecificMemory === "function";
    if (!available) {
      setPerf((s) => ({ ...s, memoryApiAvailable: false }));
      return;
    }
    setPerf((s) => ({ ...s, memoryApiAvailable: true }));
    let cancelled = false;
    const sample = async (): Promise<void> => {
      try {
        const r = await p.measureUserAgentSpecificMemory?.();
        if (cancelled || !r) return;
        const mb = r.bytes / (1024 * 1024);
        setPerf((s) => ({ ...s, memoryMb: [...s.memoryMb.slice(1), mb] }));
      } catch {
        /* rate-limit / transient failures: skip this tick */
      }
    };
    void sample();
    const id = setInterval(() => void sample(), MEM_SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const startWorker = useCallback(() => {
    if (workerRef.current) return;
    // Only Basic (Kokoro) ships today; Pro is marked "coming soon" in the UI.
    const w = new Worker(new URL("./worker/kokoro.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;

    w.addEventListener("message", (ev: MessageEvent<OutMsg>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        const wasOnboarding = !readOnboarded();
        deviceRef.current = msg.device;
        document.documentElement.dataset.ttsDevice = msg.device;
        setPerf((p) => ({ ...p, device: msg.info }));
        setStatus({ kind: "ready", device: msg.device });
        if (wasOnboarding) {
          writeOnboarded();
          setOnboarded(true);
          setShowReadyStamp(true);
          // Mark origin storage as persistent so the cached model weights and
          // OPFS sessions aren't evicted under pressure. Browser may decline
          // silently — that's fine, it's a best-effort hint.
          if (navigator.storage?.persist) {
            navigator.storage.persist().catch(() => {});
          }
        }
        return;
      }
      if (msg.type === "progress") {
        if (msg.status === "progress" && msg.file && typeof msg.loaded === "number") {
          const entry = progressMapRef.current.get(msg.file) ?? { loaded: 0, total: 0 };
          entry.loaded = msg.loaded;
          if (typeof msg.total === "number" && msg.total > entry.total) entry.total = msg.total;
          progressMapRef.current.set(msg.file, entry);
        }
        const allLoaded = Array.from(progressMapRef.current.values()).reduce(
          (a, v) => a + v.loaded,
          0,
        );
        const allTotal = Array.from(progressMapRef.current.values()).reduce(
          (a, v) => a + v.total,
          0,
        );
        if (allTotal > 0) {
          setStatus({
            kind: "downloading",
            loadedMb: allLoaded / (1024 * 1024),
            totalMb: allTotal / (1024 * 1024),
            fraction: Math.min(1, allLoaded / allTotal),
          });
        }
        return;
      }
      if (msg.type === "synth-result") {
        const resolve = pendingPreviewRef.current.get(msg.id);
        if (resolve) {
          pendingPreviewRef.current.delete(msg.id);
          resolve({ pcm: msg.pcm, sampleRate: msg.sampleRate });
        }
        return;
      }
      if (msg.type === "fragment-init") {
        const active = activeSynthsRef.current.get(msg.txnId);
        if (active && !active.cancelled) void writeInit(active.sessionId, msg.bytes);
        return;
      }
      if (msg.type === "fragment-media") {
        const active = activeSynthsRef.current.get(msg.txnId);
        if (!active || active.cancelled) return;
        void (async () => {
          await writeSegment(active.sessionId, msg.index, msg.bytes);
          if (active.cancelled) return;
          active.segments.push({ index: msg.index, durationSec: msg.durationSec });
          active.totalDuration += msg.durationSec;
          await writePlaylist(active.sessionId, active.segments, false);
          if (!active.firstFragmentSeen) {
            active.firstFragmentSeen = true;
            setDoc((d) =>
              d.id === active.sessionId ? { ...d, hasAudio: true, audioVoice: voice } : d,
            );
            setPlayToken((t) => t + 1);
          }
        })();
        return;
      }
      if (msg.type === "chunk-encoded") {
        synthAccumRef.current += msg.samples;
        const active = activeSynthsRef.current.get(msg.txnId);
        if (!active || active.cancelled) return;
        active.chunkDurations.push(msg.durationSec);
        setLiveChunkDurations([...active.chunkDurations]);
        return;
      }
      if (msg.type === "synth-end-ok") {
        setPerf((p) => ({ ...p, lastSynth: { wallMs: msg.wallMs, audioSec: msg.audioSec } }));
        document.documentElement.dataset.lastSynthWallMs = msg.wallMs.toFixed(1);
        document.documentElement.dataset.lastSynthAudioSec = msg.audioSec.toFixed(3);
        const active = activeSynthsRef.current.get(msg.txnId);
        if (!active) return;
        activeSynthsRef.current.delete(msg.txnId);
        if (active.cancelled) {
          active.reject(new Error(SYNTH_CANCELLED));
          return;
        }
        void (async () => {
          await writePlaylist(active.sessionId, active.segments, true);
          await finalizeDuration(active.sessionId, active.totalDuration);
          await finalizeChunkDurations(active.sessionId, active.chunkDurations);
          await refreshLibrary();
          setLiveChunkDurations(null);
          active.resolve();
        })();
        return;
      }
      if (msg.type === "synth-cancelled") {
        const active = activeSynthsRef.current.get(msg.txnId);
        if (!active) return;
        activeSynthsRef.current.delete(msg.txnId);
        active.reject(new Error(SYNTH_CANCELLED));
        return;
      }
      if (msg.type === "error") {
        if (msg.id !== undefined) pendingPreviewRef.current.delete(msg.id);
        if (msg.txnId !== undefined) {
          const active = activeSynthsRef.current.get(msg.txnId);
          if (active) {
            activeSynthsRef.current.delete(msg.txnId);
            active.reject(new Error(msg.message));
          }
        }
        setStatus({ kind: "error", message: msg.message });
      }
    });

    const warmup: InMsg = { type: "warmup" };
    w.postMessage(warmup);
  }, [refreshLibrary, voice]);

  useEffect(() => {
    startWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [startWorker]);

  function dismissReadyStamp(): void {
    if (showReadyStamp) setShowReadyStamp(false);
  }

  async function performPreviewSynth(
    text: string,
    voiceOverride: VoiceId,
  ): Promise<{ pcm: Float32Array; sampleRate: number }> {
    const w = workerRef.current;
    if (!w) throw new Error("worker not ready");
    const id = nextTxnIdRef.current++;
    return new Promise((resolve) => {
      pendingPreviewRef.current.set(id, resolve);
      const msg: InMsg = { type: "synth", id, text, voice: voiceOverride };
      w.postMessage(msg);
    });
  }

  async function onPreviewVoice(v: VoiceId): Promise<void> {
    if (status.kind !== "ready" || previewVoice) return;
    setPreviewVoice(v);
    try {
      const result = await performPreviewSynth("Hello, this is the catm voice.", v);
      const encoded = await encodePcmToCompleteMp4(result.pcm, result.sampleRate);
      const url = URL.createObjectURL(new Blob([encoded.bytes as BlobPart], { type: "audio/mp4" }));
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        setPreviewVoice(null);
      });
      await audio.play();
    } catch {
      setPreviewVoice(null);
    }
  }

  function onChangeVoice(v: VoiceId): void {
    if (v === voice) return;
    setVoice(v);
    writeVoice(v);
  }

  async function onRead(): Promise<void> {
    const trimmed = doc.sourceText.trim();
    if (!trimmed || status.kind !== "ready") return;
    const w = workerRef.current;
    if (!w) return;
    dismissReadyStamp();
    setStatus({ kind: "synthesising" });
    setLiveChunkDurations([]);

    let sessionId: string;
    if (doc.id) {
      sessionId = doc.id;
      await resetSession(sessionId, trimmed, voice);
    } else {
      const meta = await createSession({ sourceText: trimmed, voice });
      sessionId = meta.id;
    }
    setDoc({
      id: sessionId,
      sourceText: trimmed,
      savedText: trimmed,
      hasAudio: false,
      audioVoice: voice,
    });

    const txnId = nextTxnIdRef.current++;
    const chunks = chunkText(trimmed, CHUNK_CHARS);
    const completion = new Promise<void>((resolve, reject) => {
      activeSynthsRef.current.set(txnId, {
        sessionId,
        segments: [],
        totalDuration: 0,
        firstFragmentSeen: false,
        cancelled: false,
        chunkDurations: [],
        resolve,
        reject,
      });
    });
    w.postMessage({ type: "synth-start", txnId, voice } as InMsg);
    for (const c of chunks) w.postMessage({ type: "synth-chunk", txnId, text: c } as InMsg);
    w.postMessage({ type: "synth-end", txnId } as InMsg);
    try {
      await completion;
      setStatus({ kind: "ready", device: deviceRef.current });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === SYNTH_CANCELLED) {
        setStatus({ kind: "ready", device: deviceRef.current });
        await deleteSession(sessionId);
        setDoc((d) => (d.id === sessionId ? EMPTY_DOC : d));
        await refreshLibrary();
        return;
      }
      setStatus({ kind: "error", message });
    }
  }

  function onCancelSynth(): void {
    const w = workerRef.current;
    if (!w) return;
    for (const [txnId, active] of activeSynthsRef.current) {
      active.cancelled = true;
      w.postMessage({ type: "synth-cancel", txnId } as InMsg);
    }
  }

  async function loadSession(id: string): Promise<void> {
    dismissReadyStamp();
    const session = (await listSessions()).find((s) => s.id === id);
    const sourceText = session?.sourceText ?? "";
    setDoc({
      id,
      sourceText,
      savedText: sourceText,
      hasAudio: true,
      audioVoice: session?.voice ?? null,
    });
  }

  function startNewDocument(): void {
    setDoc(EMPTY_DOC);
  }

  function onOpenSession(id: string): void {
    if (id === doc.id) return;
    if (modified) {
      setPendingNav({ kind: "open", id });
      return;
    }
    void loadSession(id);
  }

  function onNewDocument(): void {
    if (!modified && doc.sourceText.length === 0 && !doc.id) return;
    if (modified) {
      setPendingNav({ kind: "new" });
      return;
    }
    startNewDocument();
  }

  async function onExportSession(id: string): Promise<void> {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const bundle = await buildSessionExport(session);
    if (!bundle) return;
    const blob = new Blob([bundle.bytes as BlobPart], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = bundle.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onRenameSession(id: string, title: string): Promise<void> {
    await renameSession(id, title);
    await refreshLibrary();
  }

  async function onDeleteSession(id: string): Promise<void> {
    await deleteSession(id);
    if (id === doc.id) {
      setDoc(EMPTY_DOC);
    }
    await refreshLibrary();
  }

  async function onReset(): Promise<void> {
    // 1. Tear down the worker so the cached model can be deleted safely.
    workerRef.current?.terminate();
    workerRef.current = null;
    progressMapRef.current.clear();
    pendingPreviewRef.current.clear();
    activeSynthsRef.current.clear();
    // 2. Delete the model + voice files from the HTTP cache.
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k.includes("kokoro") ||
              k.includes("transformers") ||
              k.includes("hf") ||
              k === "catm-model-v1",
          )
          .map((k) => caches.delete(k)),
      );
    } catch {
      /* ignore */
    }
    // 3. Wipe library (IDB metadata + OPFS audio).
    for (const s of sessions) {
      await deleteSession(s.id);
    }
    // 4. Clear local preferences.
    try {
      localStorage.removeItem(ONBOARDED_KEY);
      localStorage.removeItem(VOICE_KEY);
    } catch {
      /* ignore */
    }
    // 5. Reset UI state and kick off a fresh download.
    setOnboarded(false);
    setVoice(DEFAULT_VOICE);
    setStatus({ kind: "loading" });
    setDoc(EMPTY_DOC);
    setConfirmReset(false);
    await refreshLibrary();
    startWorker();
  }

  function resolveDiscardDialog(action: "cancel" | "discard" | "save"): void {
    const nav = pendingNav;
    if (!nav) return;
    if (action === "cancel") {
      setPendingNav(null);
      return;
    }
    if (action === "discard") {
      if (nav.kind === "new") startNewDocument();
      else void loadSession(nav.id);
      setPendingNav(null);
      return;
    }
    void (async () => {
      await onRead();
      if (nav.kind === "new") startNewDocument();
      else await loadSession(nav.id);
      setPendingNav(null);
    })();
  }

  const isOnboarding = !onboarded && (status.kind === "downloading" || status.kind === "loading");

  const currentTitle = doc.id
    ? (sessions.find((s) => s.id === doc.id)?.title ?? "Untitled")
    : "Untitled draft";
  const targetTitle =
    pendingNav?.kind === "open"
      ? (sessions.find((s) => s.id === pendingNav.id)?.title ?? "another read")
      : "a new document";

  if (isOnboarding) {
    return (
      <>
        <OnboardingView status={status} />
        <UpdateBanner />
      </>
    );
  }

  return (
    <>
      <div className="shell">
        <Rail
          sessions={sessions}
          activeId={doc.id}
          recordingId={status.kind === "synthesising" ? doc.id : null}
          modified={modified}
          storage={storage}
          perf={perf}
          onNewDocument={onNewDocument}
          onOpen={onOpenSession}
          onDelete={(id) => void onDeleteSession(id)}
          onExport={(id) => void onExportSession(id)}
          onReset={() => setConfirmReset(true)}
        />

        <main className="main">
          <ReaderView
            status={status}
            doc={doc}
            modified={modified}
            speed={speed}
            onChangeSpeed={setSpeed}
            sessions={sessions}
            shouldPlayToken={playToken}
            showReadyStamp={showReadyStamp && doc.sourceText.length === 0 && !doc.id}
            voice={voice}
            previewVoice={previewVoice}
            onTextChange={(t) => {
              dismissReadyStamp();
              setDoc((d) => ({ ...d, sourceText: t }));
            }}
            onRead={onRead}
            onCancel={onCancelSynth}
            onRename={(id, t) => void onRenameSession(id, t)}
            liveChunkDurations={liveChunkDurations}
            onChangeVoice={onChangeVoice}
            onPreviewVoice={(v) => void onPreviewVoice(v)}
            onExport={(id) => void onExportSession(id)}
          />
        </main>
      </div>

      {confirmReset ? (
        <ConfirmDialog
          title={
            <>
              Reset <em>catm</em>?
            </>
          }
          body={
            <>
              This will delete the voice model (~{formatMb(BASIC_TIER.sizeMb)}), all{" "}
              <b>{sessions.length}</b> saved {sessions.length === 1 ? "recording" : "recordings"},
              and your preferences. The voice will re-download on next launch. There is no undo.
            </>
          }
          confirmLabel="Reset"
          tone="danger"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => void onReset()}
          testId="confirm-reset"
        />
      ) : null}

      {pendingNav ? (
        <DiscardDialog
          currentTitle={currentTitle}
          targetTitle={targetTitle}
          onCancel={() => resolveDiscardDialog("cancel")}
          onDiscard={() => resolveDiscardDialog("discard")}
          onSaveAndOpen={() => resolveDiscardDialog("save")}
        />
      ) : null}

      <UpdateBanner />
    </>
  );
}
