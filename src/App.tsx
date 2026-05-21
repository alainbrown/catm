import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DiscardDialog } from "./components/DiscardDialog";
import { Colophon, Masthead } from "./components/Masthead";
import { encodePcmToCompleteMp4 } from "./hls/encode";
import { chunkText } from "./textChunk";
import {
  type SegmentEntry,
  type SessionMeta,
  createSession,
  deleteSession,
  finalizeDuration,
  listSessions,
  resetSession,
  writeInit,
  writePlaylist,
  writeSegment,
} from "./storage/sessionStore";
import type { AppStatus, DocState, View } from "./types";
import { OnboardingView } from "./views/OnboardingView";
import { ReaderView } from "./views/ReaderView";
import { SettingsView } from "./views/SettingsView";
import type { InMsg, OutMsg, VoiceId } from "./worker/kokoro.worker";

const VOICE_KEY = "catm:voice";
const DEFAULT_VOICE: VoiceId = "af_heart";
const CHUNK_CHARS = 300;

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
  resolve: () => void;
  reject: (err: Error) => void;
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("reader");
  const [onboarded, setOnboarded] = useState<boolean>(() => readOnboarded());
  const [status, setStatus] = useState<AppStatus>(() =>
    readOnboarded() ? { kind: "loading" } : { kind: "first-launch" },
  );
  const [doc, setDoc] = useState<DocState>(EMPTY_DOC);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [speed, setSpeed] = useState<number>(1.25);
  const [pendingNav, setPendingNav] = useState<
    { kind: "open"; id: string } | { kind: "new" } | null
  >(null);
  const [playToken, setPlayToken] = useState(0);
  const [showReadyStamp, setShowReadyStamp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [voice, setVoice] = useState<VoiceId>(() => readVoice());
  const [previewVoice, setPreviewVoice] = useState<VoiceId | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const deviceRef = useRef<"webgpu" | "wasm">("wasm");
  const workerRef = useRef<Worker | null>(null);
  const nextTxnIdRef = useRef(1);
  const pendingPreviewRef = useRef(
    new Map<number, (r: { pcm: Float32Array; sampleRate: number }) => void>(),
  );
  const activeSynthsRef = useRef(new Map<number, ActiveSynth>());
  // Aggregated download progress across all files reported by kokoro-js.
  const progressMapRef = useRef<Map<string, { loaded: number; total: number }>>(new Map());

  const modified =
    doc.sourceText !== doc.savedText || (doc.audioVoice !== null && doc.audioVoice !== voice);

  const refreshLibrary = useCallback(async () => {
    setSessions(await listSessions());
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const startWorker = useCallback(() => {
    if (workerRef.current) return;
    const w = new Worker(new URL("./worker/kokoro.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;

    w.addEventListener("message", (ev: MessageEvent<OutMsg>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        const wasOnboarding = !readOnboarded();
        deviceRef.current = msg.device;
        setStatus({ kind: "ready", device: msg.device });
        if (wasOnboarding) {
          writeOnboarded();
          setOnboarded(true);
          setShowReadyStamp(true);
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
        if (active) void writeInit(active.sessionId, msg.bytes);
        return;
      }
      if (msg.type === "fragment-media") {
        const active = activeSynthsRef.current.get(msg.txnId);
        if (!active) return;
        void (async () => {
          await writeSegment(active.sessionId, msg.index, msg.bytes);
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
      if (msg.type === "synth-end-ok") {
        const active = activeSynthsRef.current.get(msg.txnId);
        if (!active) return;
        activeSynthsRef.current.delete(msg.txnId);
        void (async () => {
          await writePlaylist(active.sessionId, active.segments, true);
          await finalizeDuration(active.sessionId, active.totalDuration);
          await refreshLibrary();
          active.resolve();
        })();
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

  // If the user is already onboarded, the worker boots on mount.
  // Otherwise we defer worker start until they click "Download voice".
  useEffect(() => {
    if (!onboarded) return;
    startWorker();
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [onboarded, startWorker]);

  function dismissReadyStamp(): void {
    if (showReadyStamp) setShowReadyStamp(false);
  }

  function onStartDownload(): void {
    if (workerRef.current) return;
    setStatus({ kind: "loading" });
    startWorker();
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
      setStatus({ kind: "error", message });
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
    setView("reader");
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

  function onRevert(): void {
    setDoc((prev) => ({ ...prev, sourceText: prev.savedText }));
  }

  async function onDeleteSession(id: string): Promise<void> {
    await deleteSession(id);
    if (id === doc.id) {
      setDoc(EMPTY_DOC);
    }
    await refreshLibrary();
  }

  async function onDeleteModel(): Promise<void> {
    workerRef.current?.terminate();
    workerRef.current = null;
    progressMapRef.current.clear();
    pendingPreviewRef.current.clear();
    activeSynthsRef.current.clear();
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.includes("kokoro") || k.includes("transformers") || k.includes("hf"))
          .map((k) => caches.delete(k)),
      );
    } catch {
      /* ignore cache errors */
    }
    try {
      localStorage.removeItem(ONBOARDED_KEY);
    } catch {
      /* ignore */
    }
    setOnboarded(false);
    setStatus({ kind: "first-launch" });
    setDoc(EMPTY_DOC);
    setView("reader");
    setConfirmDelete(false);
  }

  async function onClearAllSessions(): Promise<void> {
    for (const s of sessions) {
      await deleteSession(s.id);
    }
    setDoc(EMPTY_DOC);
    await refreshLibrary();
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

  const isOnboarding =
    !onboarded &&
    (status.kind === "first-launch" || status.kind === "downloading" || status.kind === "loading");

  const straplineRight =
    status.kind === "first-launch" ? (
      <>
        <b>First time</b> · voice not yet on this device
      </>
    ) : status.kind === "downloading" ? (
      <>
        <b>Downloading</b> · {Math.round(status.fraction * 100)}% · {status.loadedMb.toFixed(1)} /{" "}
        {status.totalMb.toFixed(0)} mb
      </>
    ) : status.kind === "loading" ? (
      <>
        <b>Loading</b> · Kokoro voice
      </>
    ) : status.kind === "error" ? (
      <>
        <b>Error</b> · {status.message}
      </>
    ) : view === "settings" ? (
      <>
        <b>Settings</b> · voice · storage · about
      </>
    ) : doc.sourceText.length > 0 ? (
      <>
        <b>{doc.sourceText.trim().split(/\s+/).filter(Boolean).length.toLocaleString()}</b> words ·
        {modified ? " modified" : doc.id ? " saved" : " new"}
      </>
    ) : (
      <>
        <b>Ready</b> · paste something to read
      </>
    );

  const currentTitle = doc.id
    ? (sessions.find((s) => s.id === doc.id)?.title ?? "Untitled")
    : "Untitled draft";
  const targetTitle =
    pendingNav?.kind === "open"
      ? (sessions.find((s) => s.id === pendingNav.id)?.title ?? "another read")
      : "a new document";

  return (
    <div className="page">
      <Masthead
        view={view}
        status={status}
        straplineRight={straplineRight}
        onOpenSettings={() => setView("settings")}
        onCloseSettings={() => setView("reader")}
      />

      {isOnboarding ? (
        <OnboardingView status={status} onStartDownload={onStartDownload} />
      ) : view === "reader" ? (
        <ReaderView
          status={status}
          doc={doc}
          modified={modified}
          speed={speed}
          sessions={sessions}
          shouldPlayToken={playToken}
          showReadyStamp={showReadyStamp && doc.sourceText.length === 0 && !doc.id}
          onTextChange={(t) => {
            dismissReadyStamp();
            setDoc((d) => ({ ...d, sourceText: t }));
          }}
          onSpeedChange={setSpeed}
          onRead={onRead}
          onNewDocument={onNewDocument}
          onRevert={onRevert}
          onOpenSession={onOpenSession}
          onDeleteSession={onDeleteSession}
        />
      ) : (
        <SettingsView
          library={sessions}
          voice={voice}
          previewVoice={previewVoice}
          status={status}
          onChangeVoice={onChangeVoice}
          onPreviewVoice={(v) => void onPreviewVoice(v)}
          onClearSessions={onClearAllSessions}
          onDeleteModel={() => setConfirmDelete(true)}
          onBack={() => setView("reader")}
        />
      )}

      {confirmDelete ? (
        <ConfirmDialog
          title={
            <>
              Delete <em>Kokoro</em>?
            </>
          }
          body={
            <>
              The voice will be removed from this device. You'll have to download it again before
              your next read — about 80 mb. Your saved sessions stay where they are.
            </>
          }
          confirmLabel="Delete model"
          tone="danger"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void onDeleteModel()}
          testId="confirm-delete-model"
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

      <Colophon />
    </div>
  );
}
