import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "../components/AudioPlayer";
import { VoiceChip } from "../components/VoiceChip";
import { attachHlsToAudio } from "../hls/playback";
import type { SessionMeta } from "../storage/sessionStore";
import { CHUNK_CHARS, chunkText, locateChunks } from "../textChunk";
import type { AppStatus, DocState } from "../types";
import type { VoiceId } from "../worker/kokoro.worker";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;
const WORDS_PER_MIN = 150;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateMinutes(words: number, speed: number): number {
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / (WORDS_PER_MIN * speed)));
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ReaderViewProps {
  status: AppStatus;
  doc: DocState;
  modified: boolean;
  speed: number;
  sessions: SessionMeta[];
  shouldPlayToken: number;
  showReadyStamp: boolean;
  voice: VoiceId;
  previewVoice: VoiceId | null;
  onTextChange: (text: string) => void;
  onSpeedChange: (s: number) => void;
  onRead: () => void;
  onCancel: () => void;
  onRename: (id: string, title: string) => void;
  onChangeVoice: (v: VoiceId) => void;
  liveChunkDurations: number[] | null;
  onPreviewVoice: (v: VoiceId) => void;
}

export function ReaderView(props: ReaderViewProps): React.JSX.Element {
  const {
    status,
    doc,
    modified,
    speed,
    sessions,
    shouldPlayToken,
    showReadyStamp,
    onTextChange,
    onSpeedChange,
    onRead,
    onCancel,
    onRename,
    liveChunkDurations,
    voice,
    previewVoice,
    onChangeVoice,
    onPreviewVoice,
  } = props;

  const words = countWords(doc.sourceText);
  const estMin = estimateMinutes(words, speed);
  const isSynth = status.kind === "synthesising";
  const isReady = status.kind === "ready";
  const canRead = isReady && words > 0;
  const isStale = doc.hasAudio && modified;
  const sessionId = doc.hasAudio ? doc.id : null;
  const session = doc.id ? sessions.find((s) => s.id === doc.id) : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayTokenRef = useRef(shouldPlayToken);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isEditing = editingTitle !== null;

  useEffect(() => {
    if (isEditing) titleInputRef.current?.select();
  }, [isEditing]);

  function commitTitle(): void {
    if (editingTitle === null || !doc.id) {
      setEditingTitle(null);
      return;
    }
    const next = editingTitle.trim();
    if (next !== (session?.title ?? "")) onRename(doc.id, next);
    setEditingTitle(null);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !sessionId) return;
    const handle = attachHlsToAudio(audio, sessionId);
    return () => handle.destroy();
  }, [sessionId]);

  useEffect(() => {
    if (shouldPlayToken === lastPlayTokenRef.current) return;
    lastPlayTokenRef.current = shouldPlayToken;
    if (audioRef.current && sessionId) {
      void audioRef.current.play().catch(() => {
        /* user-gesture restrictions are fine; player still appears */
      });
    }
  }, [shouldPlayToken, sessionId]);

  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !sessionId) return;
    const onTime = (): void => setCurrentTime(a.currentTime);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("seeked", onTime);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("seeked", onTime);
    };
  }, [sessionId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change
  useEffect(() => {
    setCurrentTime(0);
  }, [doc.id]);

  const durations = liveChunkDurations ?? session?.chunkDurations ?? null;
  const activeRange = useMemo(() => {
    if (!durations?.length || !doc.sourceText) return null;
    const chunks = chunkText(doc.sourceText, CHUNK_CHARS);
    if (chunks.length === 0) return null;
    const ranges = locateChunks(doc.sourceText, chunks);
    const cumulative: number[] = [];
    let sum = 0;
    for (const d of durations) {
      sum += d;
      cumulative.push(sum);
    }
    let idx = cumulative.findIndex((t) => currentTime < t);
    if (idx === -1) idx = cumulative.length - 1;
    return ranges[idx] ?? null;
  }, [doc.sourceText, durations, currentTime]);

  const recordLabel = isSynth
    ? "Cancel"
    : modified && doc.id
      ? "Save & read"
      : doc.id
        ? "Record again"
        : "Record";

  const title = session?.title ?? (doc.sourceText.length > 0 ? "Untitled draft" : null);
  const kicker = doc.id
    ? modified
      ? "DRAFT · MODIFIED"
      : "SAVED · READING"
    : doc.sourceText.length > 0
      ? "DRAFT · UNSAVED"
      : "NEW · READY";

  // Sub-line: empty state must contain "Ready · paste" (used by e2e tests).
  let sub: React.ReactNode;
  if (doc.sourceText.length === 0) {
    sub = "Ready · paste something to read aloud.";
  } else if (doc.id) {
    sub = (
      <>
        <b>{words.toLocaleString()}</b> words<span className="dot">·</span>about <b>{estMin} min</b>{" "}
        at {speed}×<span className="dot">·</span>voice <b>{voice}</b>
        {session ? (
          <>
            <span className="dot">·</span>saved {formatDate(session.createdAt)}
          </>
        ) : null}
        {modified ? (
          <>
            <span className="dot">·</span>
            <span style={{ color: "var(--warn)", fontWeight: 600 }}>unsaved edits</span>
          </>
        ) : null}
      </>
    );
  } else {
    sub = (
      <>
        <b>{words.toLocaleString()}</b> words<span className="dot">·</span>about <b>{estMin} min</b>{" "}
        at {speed}×<span className="dot">·</span>voice <b>{voice}</b>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          Library <span className="sep">/</span> <b>{title ?? "New reading"}</b>
        </div>
        <div className="right">
          {status.kind === "error" ? (
            <span className="chip-sm warn" title={status.message}>
              error
            </span>
          ) : null}
          {isSynth ? <span className="chip-sm synth">Recording…</span> : null}
          {!isSynth && status.kind === "ready" ? (
            doc.hasAudio && !isStale ? (
              <span className="chip-sm good">Ready</span>
            ) : null
          ) : null}
          {isStale ? <span className="chip-sm warn">audio stale</span> : null}
        </div>
      </header>

      <div className="stage">
        <div className="doc-head">
          <div className="kicker">{kicker}</div>
          <h1>
            {title ? (
              editingTitle !== null && doc.id ? (
                <input
                  ref={titleInputRef}
                  className="title-edit"
                  value={editingTitle}
                  maxLength={120}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTitle();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingTitle(null);
                    }
                  }}
                  aria-label="Rename reading"
                  data-testid="title-edit"
                />
              ) : (
                <>
                  {doc.id ? (
                    <button
                      type="button"
                      className="title-btn"
                      onClick={() => setEditingTitle(session?.title ?? title)}
                      title="Rename"
                      data-testid="title-button"
                    >
                      {title}
                    </button>
                  ) : (
                    <span>{title}</span>
                  )}
                  {modified ? (
                    <span className="mod" title="Unsaved changes">
                      ●
                    </span>
                  ) : null}
                </>
              )
            ) : (
              <span className="untitled">Untitled — start typing</span>
            )}
          </h1>
          <p className="sub">{sub}</p>
          {showReadyStamp ? (
            <span className="ready-stamp" data-testid="ready-stamp">
              Voice ready
            </span>
          ) : null}
        </div>

        <div className="composer">
          <EditableText
            value={doc.sourceText}
            onChange={onTextChange}
            activeRange={activeRange}
            placeholder="Paste a chapter, an article, a long email — anything you'd rather hear than skim."
          />

          <div className="toolbar">
            <VoiceChip
              voice={voice}
              previewVoice={previewVoice}
              status={status}
              onChangeVoice={onChangeVoice}
              onPreviewVoice={onPreviewVoice}
              disabled={isSynth}
            />
            <fieldset
              className="seg"
              aria-label="Playback speed"
              style={{ border: 0, padding: 0, margin: 0, display: "inline-flex" }}
            >
              {SPEEDS.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={s === speed ? "on" : undefined}
                  onClick={() => onSpeedChange(s)}
                  aria-pressed={s === speed}
                >
                  {s === 1 ? "1.0" : s === 2 ? "2.0" : s.toString().replace(/^0/, "")}×
                </button>
              ))}
            </fieldset>
            <span className="spacer" />
            <span className="stats">
              <b>{words.toLocaleString()}</b> words · <b>{estMin || 0} min</b>
            </span>
            <button
              type="button"
              className={isSynth ? "send cancel" : modified && doc.id ? "send save" : "send"}
              onClick={() => (isSynth ? onCancel() : onRead())}
              disabled={!isSynth && !canRead}
              data-testid="speak"
              aria-label={isSynth ? "Cancel recording" : undefined}
            >
              {isSynth ? (
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="10" rx="1.5" />
                </svg>
              ) : (
                <svg width="12" height="13" viewBox="0 0 14 16" aria-hidden="true">
                  <polygon points="2,1 13,8 2,15" />
                </svg>
              )}
              {recordLabel}
            </button>
          </div>
        </div>

        {doc.hasAudio ? (
          <div className={isStale ? "dock stale" : "dock"}>
            <span className="stamp">{isStale ? "stale" : "ready"}</span>
            {/* biome-ignore lint/a11y/useMediaCaption: synthesised speech has no separate transcript */}
            <audio
              ref={audioRef}
              data-testid="audio"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: "none",
              }}
            />
            <AudioPlayer audioRef={audioRef} />
          </div>
        ) : null}

        {status.kind === "error" ? (
          <div className="error-banner" role="alert">
            <b>Something went wrong.</b> {status.message}
          </div>
        ) : null}
      </div>
    </>
  );
}

interface EditableTextProps {
  value: string;
  onChange: (next: string) => void;
  activeRange: { start: number; end: number } | null;
  placeholder: string;
}

const HIGHLIGHT_NAME = "catm-active-chunk";

function EditableText({
  value,
  onChange,
  activeRange,
  placeholder,
}: EditableTextProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  // Sync external value changes (loading a session, etc.) into the DOM
  // without disturbing the caret during local typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  // Drive the CSS Custom Highlight API. The browser paints the range itself —
  // no <span> wrapping, no DOM mutation, so the user can keep typing.
  useEffect(() => {
    const el = ref.current;
    const HL = (globalThis as { Highlight?: typeof Highlight }).Highlight;
    const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    if (!el || !HL || !highlights) return;
    if (!activeRange) {
      highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    const textNode = el.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      highlights.delete(HIGHLIGHT_NAME);
      return;
    }
    const len = (textNode as Text).length;
    const start = Math.max(0, Math.min(activeRange.start, len));
    const end = Math.max(start, Math.min(activeRange.end, len));
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    highlights.set(HIGHLIGHT_NAME, new HL(range));
  }, [activeRange]);

  // Scroll the highlight into view as it moves.
  useEffect(() => {
    const el = ref.current;
    if (!el || !activeRange) return;
    const textNode = el.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
    const len = (textNode as Text).length;
    const start = Math.max(0, Math.min(activeRange.start, len));
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start);
    const rect = range.getBoundingClientRect();
    const parentRect = el.getBoundingClientRect();
    const targetTop = rect.top - parentRect.top - el.clientHeight / 2 + rect.height / 2;
    el.scrollBy({ top: targetTop, behavior: "smooth" });
  }, [activeRange]);

  return (
    <div
      ref={ref}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-multiline="true"
      aria-label="Text"
      spellCheck={false}
      data-placeholder={placeholder}
      data-testid="text-input"
      className="editable-text"
      onInput={(e) => onChange((e.currentTarget as HTMLDivElement).textContent ?? "")}
    />
  );
}
