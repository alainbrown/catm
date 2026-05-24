import { useMemo, useState } from "react";
import type { PerfState } from "../App";
import type { SessionMeta, StorageBreakdown } from "../storage/sessionStore";
import { BrandMark } from "./BrandMark";
import { PerfWidget } from "./PerfWidget";

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} gb`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} mb`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kb`;
  return `${bytes} b`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface RailProps {
  sessions: SessionMeta[];
  activeId: string | null;
  recordingId: string | null;
  modified: boolean;
  storage: StorageBreakdown | null;
  perf: PerfState;
  onNewDocument: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onReset: () => void;
}

export function Rail({
  sessions,
  activeId,
  recordingId,
  modified,
  storage,
  perf,
  onNewDocument,
  onOpen,
  onDelete,
  onExport,
  onReset,
}: RailProps): React.JSX.Element {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.toLowerCase();
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.sourceText.toLowerCase().includes(q),
    );
  }, [sessions, query]);

  const storageTotal = storage
    ? storage.voiceBytes + storage.sessionsBytes + storage.headroomBytes
    : 1;
  const voicePct = storage ? (storage.voiceBytes / storageTotal) * 100 : 0;
  const sessionsPct = storage ? (storage.sessionsBytes / storageTotal) * 100 : 0;

  return (
    <aside className="rail" aria-label="Sidebar">
      <div className="brand">
        <BrandMark size={28} />
        <span className="name" title="come and talk to me">
          <b>catm</b>
          <span>come and talk to me</span>
        </span>
      </div>

      <button
        type="button"
        className="newdoc"
        onClick={onNewDocument}
        data-testid="new-document"
        title="New reading"
      >
        <span className="k" aria-hidden="true">
          +
        </span>
        New reading
      </button>

      <div className="lbl">
        Recent <b>{sessions.length}</b>
      </div>

      {sessions.length === 0 ? (
        <div className="hist-empty" data-testid="library-empty">
          Past recordings will live here.
        </div>
      ) : (
        <ul className="hist" style={{ listStyle: "none" }}>
          {filtered.length === 0 ? (
            <li className="hist-empty">No readings match "{query}".</li>
          ) : (
            filtered.map((s) => {
              const isActive = s.id === activeId;
              const isRecording = s.id === recordingId;
              return (
                <li
                  key={s.id}
                  className={isActive ? "row-wrap active" : "row-wrap"}
                  data-testid="library-row"
                >
                  <button
                    type="button"
                    className="row"
                    onClick={() => onOpen(s.id)}
                    data-testid="library-play"
                  >
                    <span className="t">{s.title}</span>
                    <span className="m">
                      <span>{formatDuration(s.durationSec)}</span>
                      <span className="voice-tag">{s.voice}</span>
                      {isActive && modified ? <span className="unsaved">● unsaved</span> : null}
                    </span>
                  </button>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => onExport(s.id)}
                      disabled={isRecording}
                      aria-label={`Export ${s.title}`}
                      title={isRecording ? "Export disabled while recording" : "Export (.zip)"}
                      data-testid="library-export"
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
                        <title>Download</title>
                        <path d="M12 3v12" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="5" y1="21" x2="19" y2="21" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="del"
                      onClick={() => onDelete(s.id)}
                      aria-label={`Delete ${s.title}`}
                      data-testid="library-delete"
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
                        <title>Delete</title>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}

      {sessions.length > 0 ? (
        <input
          type="search"
          className="rail-search"
          placeholder="Search readings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search readings"
        />
      ) : null}

      <PerfWidget perf={perf} />

      <section className="foot-section" aria-label="Storage">
        <h5 className="foot-lbl">
          Storage
          <span>{storage ? fmtBytes(storage.voiceBytes + storage.sessionsBytes) : "—"}</span>
        </h5>
        <div className="foot-bar" aria-hidden="true">
          <span className="seg-v" style={{ width: `${voicePct}%` }} />
          <span className="seg-s" style={{ width: `${sessionsPct}%` }} />
        </div>
        <div className="foot-line">
          <span>
            <i className="dot-v" /> Voice
          </span>
          <b>{storage ? fmtBytes(storage.voiceBytes) : "—"}</b>
        </div>
        <div className="foot-line">
          <span>
            <i className="dot-s" /> Recordings · {sessions.length}
          </span>
          <b>{storage ? fmtBytes(storage.sessionsBytes) : "—"}</b>
        </div>
        <div className="foot-line">
          <span>
            <i className="dot-f" /> Free
          </span>
          <b>{storage ? fmtBytes(storage.headroomBytes) : "—"}</b>
        </div>
        {storage?.persisted ? <span className="foot-badge">persistent</span> : null}
        <button type="button" className="ghost-danger" onClick={onReset} data-testid="reset">
          Reset
        </button>
      </section>

    </aside>
  );
}
