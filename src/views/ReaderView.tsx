import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPlayer } from "../components/AudioPlayer";
import { VoiceChip } from "../components/VoiceChip";
import { attachHlsToAudio } from "../hls/playback";
import type { SessionMeta } from "../storage/sessionStore";
import { locateChunks } from "../textChunk";
import type { AppStatus, DocState } from "../types";
import type { VoiceId } from "../worker/kokoro.worker";

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
  onChangeSpeed: (s: number) => void;
  sessions: SessionMeta[];
  shouldPlayToken: number;
  showReadyStamp: boolean;
  voice: VoiceId;
  previewVoice: VoiceId | null;
  onTextChange: (text: string) => void;
  onRead: () => void;
  onCancel: () => void;
  onRename: (id: string, title: string) => void;
  onChangeVoice: (v: VoiceId) => void;
  liveChunkDurations: number[] | null;
  liveChunkTexts: string[] | null;
  onPreviewVoice: (v: VoiceId) => void;
  onExport: (id: string) => void;
}

export function ReaderView(props: ReaderViewProps): React.JSX.Element {
  const {
    status,
    doc,
    modified,
    speed,
    onChangeSpeed,
    sessions,
    shouldPlayToken,
    showReadyStamp,
    onTextChange,
    onRead,
    onCancel,
    onRename,
    liveChunkDurations,
    liveChunkTexts,
    voice,
    previewVoice,
    onChangeVoice,
    onPreviewVoice,
    onExport,
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
  const texts = liveChunkTexts ?? session?.chunkTexts ?? null;
  const activeRange = useMemo(() => {
    if (!durations?.length || !texts?.length || !doc.sourceText) return null;
    const ranges = locateChunks(doc.sourceText, texts);
    if (ranges.length === 0) return null;
    const cumulative: number[] = [];
    let sum = 0;
    for (const d of durations) {
      sum += d;
      cumulative.push(sum);
    }
    let idx = cumulative.findIndex((t) => currentTime < t);
    if (idx === -1) idx = cumulative.length - 1;
    return ranges[idx] ?? null;
  }, [doc.sourceText, durations, texts, currentTime]);

  const recordVerb = isSynth
    ? "Cancel"
    : modified && doc.id
      ? "Save & generate"
      : doc.id
        ? "Generate again"
        : "Generate";
  const recordLabel =
    !isSynth && estMin > 0 ? `${recordVerb} · ${estMin} min` : recordVerb;

  const title = session?.title ?? (doc.sourceText.length > 0 ? "Untitled draft" : null);

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
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
            ) : doc.id ? (
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
              <b>{title}</b>
            )
          ) : (
            <span className="untitled">New reading</span>
          )}
          {modified ? (
            <span className="mod" title="Unsaved changes">
              ●
            </span>
          ) : null}
          {session && !modified ? (
            <span className="topbar-meta">saved {formatDate(session.createdAt)}</span>
          ) : null}
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
          {doc.id && doc.hasAudio && !isSynth ? (
            <button
              type="button"
              className="topbar-btn"
              onClick={() => onExport(doc.id as string)}
              title="Export this reading as a .zip"
              data-testid="editor-export"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <title>Export</title>
                <path d="M12 3v12" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="5" y1="21" x2="19" y2="21" />
              </svg>
              Export
            </button>
          ) : null}
        </div>
      </header>

      <div className="stage">
        {showReadyStamp ? (
          <span className="ready-stamp" data-testid="ready-stamp">
            Voice ready
          </span>
        ) : null}

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
            <span className="spacer" />
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
                /* Waveform / equalizer bars — communicates "produce audio"
                   rather than "play existing audio". */
                <svg
                  width="14"
                  height="12"
                  viewBox="0 0 16 14"
                  aria-hidden="true"
                  fill="currentColor"
                >
                  <rect x="1" y="5" width="2" height="4" rx="1" />
                  <rect x="5" y="2" width="2" height="10" rx="1" />
                  <rect x="9" y="4" width="2" height="6" rx="1" />
                  <rect x="13" y="6" width="2" height="2" rx="1" />
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
            <AudioPlayer audioRef={audioRef} speed={speed} onChangeSpeed={onChangeSpeed} />
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
