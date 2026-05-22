import { useEffect } from "react";
import { HIGH_TIER_PLACEHOLDER, LOW_TIER, MEDIUM_TIER_PLACEHOLDER, formatMb } from "../modelConfig";

interface ModelPopoverProps {
  onClose: () => void;
  onRemoveModel: () => void;
  synthInProgress?: boolean;
}

export function ModelPopover({
  onClose,
  onRemoveModel,
  synthInProgress,
}: ModelPopoverProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="scrim" onClick={onClose} aria-label="Close model panel" />
      <aside
        className="pop pop-model"
        aria-label="Voice model"
        style={{ left: 16, bottom: 64, width: 312 }}
      >
        <div className="pop-head">
          <h4>Voice model</h4>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tier on">
          <span className="radio" aria-hidden="true" />
          <span className="body">
            <span className="name">
              Low · Kokoro <span className="badge">selected</span>
            </span>
            <span className="meta">
              {LOW_TIER.paramCount} · {formatMb(LOW_TIER.sizeMb)} · {LOW_TIER.blurb}
            </span>
          </span>
          <button
            type="button"
            className="tier-x"
            onClick={onRemoveModel}
            disabled={synthInProgress}
            aria-label="Remove Low tier from device"
            title="Remove from device"
            data-testid="tier-remove-low"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <title>Remove</title>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>

        <div className="tier soon">
          <span className="radio" aria-hidden="true" />
          <span className="body">
            <span className="name">
              Medium <span className="badge soon">soon</span>
            </span>
            <span className="meta">
              ~{formatMb(MEDIUM_TIER_PLACEHOLDER.approxSizeMb)} · {MEDIUM_TIER_PLACEHOLDER.blurb}
            </span>
          </span>
        </div>
        <div className="tier soon">
          <span className="radio" aria-hidden="true" />
          <span className="body">
            <span className="name">
              High <span className="badge soon">soon</span>
            </span>
            <span className="meta">
              ~{formatMb(HIGH_TIER_PLACEHOLDER.approxSizeMb)} · {HIGH_TIER_PLACEHOLDER.blurb}
            </span>
          </span>
        </div>

        <p className="help">
          Voice models run entirely on this device. Changing tier downloads a new model once, then
          keeps it cached for offline use.
        </p>
      </aside>
    </>
  );
}
