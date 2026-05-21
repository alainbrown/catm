import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SessionMeta,
  createSession,
  deleteSession,
  getAudioBlob,
  listSessions,
} from "./storage/sessionStore";
import { pcmToWavBlob } from "./wav";
import type { InMsg, OutMsg } from "./worker/kokoro.worker";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; device: "webgpu" | "wasm" }
  | { kind: "synthesising" }
  | { kind: "error"; message: string };

export function App(): React.JSX.Element {
  const [text, setText] = useState("Hello world.");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [library, setLibrary] = useState<SessionMeta[]>([]);
  const deviceRef = useRef<"webgpu" | "wasm">("wasm");

  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(1);
  const pendingRef = useRef(
    new Map<number, (r: { pcm: Float32Array; sampleRate: number }) => void>(),
  );

  const refreshLibrary = useCallback(async () => {
    setLibrary(await listSessions());
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    const w = new Worker(new URL("./worker/kokoro.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = w;
    setStatus({ kind: "loading" });

    w.addEventListener("message", (ev: MessageEvent<OutMsg>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        deviceRef.current = msg.device;
        setStatus({ kind: "ready", device: msg.device });
        return;
      }
      if (msg.type === "synth-result") {
        const resolve = pendingRef.current.get(msg.id);
        if (resolve) {
          pendingRef.current.delete(msg.id);
          resolve({ pcm: msg.pcm, sampleRate: msg.sampleRate });
        }
        return;
      }
      if (msg.type === "error") {
        if (msg.id !== undefined) pendingRef.current.delete(msg.id);
        setStatus({ kind: "error", message: msg.message });
      }
    });

    const warmup: InMsg = { type: "warmup" };
    w.postMessage(warmup);

    return () => {
      w.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  function setAudioForBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }

  const canSpeak = status.kind === "ready" || status.kind === "error";

  async function onSpeak(): Promise<void> {
    const w = workerRef.current;
    const trimmed = text.trim();
    if (!w || !trimmed) return;
    setStatus({ kind: "synthesising" });
    const id = nextIdRef.current++;
    const result = await new Promise<{ pcm: Float32Array; sampleRate: number }>((resolve) => {
      pendingRef.current.set(id, resolve);
      const msg: InMsg = { type: "synth", id, text: trimmed };
      w.postMessage(msg);
    });
    const blob = pcmToWavBlob(result.pcm, result.sampleRate);
    setAudioForBlob(blob);
    const durationSec = result.pcm.length / result.sampleRate;
    const meta = await createSession({ sourceText: trimmed, audio: blob, durationSec });
    setActiveSessionId(meta.id);
    await refreshLibrary();
    setStatus({ kind: "ready", device: deviceRef.current });
  }

  async function onPlaySession(id: string): Promise<void> {
    const blob = await getAudioBlob(id);
    setAudioForBlob(blob);
    setActiveSessionId(id);
    const session = library.find((s) => s.id === id);
    if (session) setText(session.sourceText);
  }

  async function onDeleteSession(id: string): Promise<void> {
    await deleteSession(id);
    if (id === activeSessionId) {
      setActiveSessionId(null);
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
    await refreshLibrary();
  }

  return (
    <main className="app">
      <header className="hero">
        <h1 className="hero__title">catm</h1>
        <p className="hero__sub">Long-form text-to-speech, in your browser.</p>
      </header>

      <section className="panel" aria-label="Synthesiser">
        <label className="panel__label" htmlFor="input">
          Text
        </label>
        <textarea
          id="input"
          className="panel__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Type something to read aloud."
          spellCheck={false}
        />
        <div className="panel__row">
          <button
            type="button"
            className="panel__speak"
            onClick={onSpeak}
            disabled={!canSpeak}
            data-testid="speak"
          >
            {status.kind === "synthesising" ? "Synthesising…" : "Speak"}
          </button>
          <StatusLine status={status} />
        </div>
        {/* biome-ignore lint/a11y/useMediaCaption: synthesised speech has no separate transcript channel */}
        <audio
          className="panel__audio"
          src={audioUrl ?? undefined}
          controls
          autoPlay
          data-testid="audio"
        />
      </section>

      <Library
        sessions={library}
        activeId={activeSessionId}
        onPlay={onPlaySession}
        onDelete={onDeleteSession}
      />
    </main>
  );
}

function StatusLine({ status }: { status: Status }): React.JSX.Element {
  switch (status.kind) {
    case "idle":
      return <span className="status">Initialising…</span>;
    case "loading":
      return <span className="status">Loading Kokoro voice…</span>;
    case "ready":
      return <span className="status">Ready · {status.device.toUpperCase()}</span>;
    case "synthesising":
      return <span className="status">Synthesising…</span>;
    case "error":
      return <span className="status status--error">Error: {status.message}</span>;
  }
}

interface LibraryProps {
  sessions: SessionMeta[];
  activeId: string | null;
  onPlay: (id: string) => void;
  onDelete: (id: string) => void;
}

function Library({ sessions, activeId, onPlay, onDelete }: LibraryProps): React.JSX.Element {
  return (
    <section className="library" aria-label="Library">
      <header className="library__header">
        <h2 className="library__title">Library</h2>
        <span className="library__count" data-testid="library-count">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </header>
      {sessions.length === 0 ? (
        <p className="library__empty" data-testid="library-empty">
          Nothing here yet. Synthesise something above and it will appear here.
        </p>
      ) : (
        <ul className="library__list" data-testid="library-list">
          {sessions.map((s) => (
            <li
              key={s.id}
              className={`library__row${s.id === activeId ? " library__row--active" : ""}`}
              data-testid="library-row"
            >
              <button
                type="button"
                className="library__row-body"
                onClick={() => onPlay(s.id)}
                data-testid="library-play"
              >
                <span className="library__row-title">{s.title}</span>
                <span className="library__row-meta">
                  {formatDate(s.createdAt)} · {formatDuration(s.durationSec)}
                </span>
              </button>
              <button
                type="button"
                className="library__row-delete"
                onClick={() => onDelete(s.id)}
                aria-label={`Delete ${s.title}`}
                data-testid="library-delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
