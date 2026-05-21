import { useEffect, useRef } from "react";
import { LibrarySidebar } from "../components/LibrarySidebar";
import { attachHlsToAudio } from "../hls/playback";
import type { SessionMeta } from "../storage/sessionStore";
import type { AppStatus, DocState } from "../types";

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0] as const;
const WORDS_PER_MIN = 150;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateMinutes(words: number, speed: number): number {
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / (WORDS_PER_MIN * speed)));
}

interface ReaderViewProps {
  status: AppStatus;
  doc: DocState;
  modified: boolean;
  speed: number;
  sessions: SessionMeta[];
  shouldPlayToken: number;
  showReadyStamp: boolean;
  onTextChange: (text: string) => void;
  onSpeedChange: (s: number) => void;
  onRead: () => void;
  onNewDocument: () => void;
  onRevert: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
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
    onNewDocument,
    onRevert,
    onOpenSession,
    onDeleteSession,
  } = props;

  const words = countWords(doc.sourceText);
  const estMin = estimateMinutes(words, speed);
  const isSynth = status.kind === "synthesising";
  const isReady = status.kind === "ready";
  const canRead = isReady && words > 0;
  const hasDoc = doc.id !== null || doc.sourceText.length > 0;
  const isStale = doc.hasAudio && modified;
  const sessionId = doc.hasAudio ? doc.id : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Initialise to the current token so a remount (e.g. coming back from
  // Settings) doesn't treat the existing token as a fresh play trigger.
  const lastPlayTokenRef = useRef(shouldPlayToken);

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

  return (
    <section className="slab">
      <div className="stage">
        <section className="editor-shell" aria-label="Editor" style={{ position: "relative" }}>
          {showReadyStamp ? (
            <span className="ready-stamp" data-testid="ready-stamp">
              Ready ★
            </span>
          ) : null}
          <div className="editor-head">
            <div className="doc-title">
              {doc.id || doc.sourceText.length > 0 ? (
                <span className="name">
                  {doc.id
                    ? (sessions.find((s) => s.id === doc.id)?.title ?? "Untitled")
                    : "Untitled draft"}
                </span>
              ) : (
                <span className="untitled">Untitled — start typing</span>
              )}
              {modified ? (
                <span className="mod" title="Unsaved changes">
                  ●
                </span>
              ) : null}
            </div>
            <div className="head-controls">
              <button
                type="button"
                className="icon-btn"
                title="New document"
                onClick={onNewDocument}
                disabled={!hasDoc || isSynth}
                data-testid="new-document"
              >
                +
              </button>
            </div>
          </div>

          <div className="editor-body">
            <label htmlFor="text-input" style={{ position: "absolute", left: "-9999px" }}>
              Text
            </label>
            <textarea
              id="text-input"
              aria-label="Text"
              className="editor-textarea"
              value={doc.sourceText}
              onChange={(e) => onTextChange(e.target.value)}
              rows={10}
              placeholder="Paste a chapter, an article, or anything you'd rather hear than skim."
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 240,
                fontFamily: "'Archivo', sans-serif",
                fontSize: 16.5,
                lineHeight: 1.75,
                color: "var(--ink)",
                background: "transparent",
                border: "none",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>

          <div className="editor-foot">
            <span className="stats">
              {words > 0 ? (
                <>
                  <b>{words.toLocaleString()} words</b> · approx. <b>{estMin} min</b> at {speed}×
                  {modified ? " · unsaved" : doc.id ? " · saved" : ""}
                </>
              ) : (
                <>waiting for something to read</>
              )}
            </span>
            <div className="btn-row">
              <fieldset
                className="speed-pills"
                aria-label="Playback speed"
                style={{ border: 0, padding: 0, margin: 0 }}
              >
                {SPEEDS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={s === speed ? "on" : ""}
                    onClick={() => onSpeedChange(s)}
                    aria-pressed={s === speed}
                  >
                    {s
                      .toFixed(s === 1 ? 1 : 2)
                      .replace(/0+$/, "")
                      .replace(/\.$/, ".0")}
                  </button>
                ))}
              </fieldset>
              {modified && doc.id ? (
                <button type="button" className="btn" onClick={onRevert} disabled={isSynth}>
                  Revert
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={onNewDocument}
                  disabled={!hasDoc || isSynth}
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className={modified && doc.id ? "btn read save" : "btn read"}
                onClick={() => onRead()}
                disabled={!canRead}
                data-testid="speak"
              >
                <svg
                  width="13"
                  height="14"
                  viewBox="0 0 14 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <polygon points="2,1 13,8 2,15" />
                </svg>
                {isSynth
                  ? "Reading…"
                  : modified && doc.id
                    ? "Save & read"
                    : doc.id
                      ? "Read again"
                      : "Read"}
              </button>
            </div>
          </div>

          {doc.hasAudio ? (
            <div className={isStale ? "audio-shell stale" : "audio-shell"}>
              <span className={isStale ? "stamp warn" : "stamp"}>
                {isStale ? "audio · stale" : "audio"}
              </span>
              {/* biome-ignore lint/a11y/useMediaCaption: synthesised speech has no separate transcript */}
              <audio
                ref={audioRef}
                controls
                data-testid="audio"
                style={{ flex: 1, width: "100%", minWidth: 0 }}
              />
            </div>
          ) : null}
        </section>

        <aside className="right-col">
          {isSynth ? <SummaryCard words={words} estMin={estMin} /> : null}
          <LibrarySidebar
            sessions={sessions}
            activeId={doc.id}
            modified={modified}
            onOpen={onOpenSession}
            onDelete={onDeleteSession}
          />
        </aside>
      </div>
    </section>
  );
}

function SummaryCard({ words, estMin }: { words: number; estMin: number }): React.JSX.Element {
  return (
    <section className="sidebar-card summary-card" aria-label="Synthesis summary">
      <h4>
        Reading
        <span className="sub">in progress</span>
      </h4>
      <div className="big">
        {estMin}
        <span className="unit">min</span>
      </div>
      <div className="meta">
        <span>
          <b>{words.toLocaleString()}</b> words
        </span>
        <span>kokoro · af_heart</span>
      </div>
    </section>
  );
}
