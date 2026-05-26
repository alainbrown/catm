import { useEffect, useRef, useState } from "react";
import type { AppStatus } from "../types";
import type { VoiceId } from "../worker/kokoro.worker";

interface VoiceOption {
  id: VoiceId;
  name: string;
  desc: string;
  gender: "f" | "m";
}

const VOICES: VoiceOption[] = [
  { id: "af_heart", name: "Heart", desc: "af_heart · feminine · warm", gender: "f" },
  { id: "af_bella", name: "Bella", desc: "af_bella · feminine · bright", gender: "f" },
  { id: "am_michael", name: "Michael", desc: "am_michael · masculine · low", gender: "m" },
  { id: "am_eric", name: "Eric", desc: "am_eric · masculine · mid", gender: "m" },
];

interface VoiceChipProps {
  voice: VoiceId;
  previewVoice: VoiceId | null;
  status: AppStatus;
  onChangeVoice: (v: VoiceId) => void;
  onPreviewVoice: (v: VoiceId) => void;
  disabled?: boolean;
}

export function VoiceChip({
  voice,
  previewVoice,
  status,
  onChangeVoice,
  onPreviewVoice,
  disabled,
}: VoiceChipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const canPreview = status.kind === "ready" && previewVoice === null;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="chip-wrap" ref={wrapRef}>
      <button
        type="button"
        className="pill"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        data-testid="voice-chip"
      >
        <span className="k">Voice</span>
        <span className="v">{voice}</span>
        <span className="caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <div className="pop voice" role="dialog" aria-label="Choose voice">
          <h5>Voice · English</h5>
          <div className="pop-list">
            {VOICES.map((v) => {
              const selected = v.id === voice;
              const playing = previewVoice === v.id;
              return (
                <div
                  key={v.id}
                  className={selected ? "pop-row on" : "pop-row"}
                  data-testid={`voice-${v.id}`}
                >
                  <button
                    type="button"
                    className="select"
                    onClick={() => {
                      onChangeVoice(v.id);
                      setOpen(false);
                    }}
                    aria-label={`Select ${v.id}`}
                  >
                    <span className={`swatch ${v.gender}`} aria-hidden="true">
                      {v.name[0]}
                    </span>
                    <span className="name">
                      <b>{v.name}</b>
                      <span>{v.desc}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="prev"
                    aria-label={`Preview ${v.id}`}
                    title="Preview"
                    disabled={!canPreview && !playing}
                    onClick={() => onPreviewVoice(v.id)}
                    data-testid={`preview-${v.id}`}
                  >
                    {playing ? "❚❚" : "▶"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="pop-foot">▶ previews are synthesised on the spot · ~1 s</div>
        </div>
      ) : null}
    </span>
  );
}
