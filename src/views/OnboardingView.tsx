import { BrandMark } from "../components/BrandMark";
import { LOW_TIER, formatMb } from "../modelConfig";
import type { AppStatus } from "../types";

interface OnboardingViewProps {
  status: AppStatus;
  onStartDownload: () => void;
}

export function OnboardingView({
  status,
  onStartDownload,
}: OnboardingViewProps): React.JSX.Element {
  return (
    <div className="onboard-shell">
      <div className="onboard-brand">
        <BrandMark size={36} />
        <span className="name">
          catm <span>· come and talk to me</span>
        </span>
      </div>

      {status.kind === "downloading" || status.kind === "loading" ? (
        <DownloadingCard status={status} />
      ) : (
        <FirstLaunchCard onStartDownload={onStartDownload} />
      )}
    </div>
  );
}

function FirstLaunchCard({ onStartDownload }: { onStartDownload: () => void }): React.JSX.Element {
  return (
    <>
      <section className="onboard-card" aria-label="First launch">
        <div className="kicker">▸ first time here</div>
        <h1>
          Read <em>anything.</em>
          <br />
          Out loud.
        </h1>
        <p className="copy">
          catm reads articles, chapters, notes — anything you'd rather hear than skim — out loud,
          right in your browser. The voice runs on your device, not a server — it's a{" "}
          {formatMb(LOW_TIER.sizeMb)} download the first time, then cached for offline use forever.
        </p>
        <button
          type="button"
          className="cta"
          onClick={onStartDownload}
          data-testid="start-download"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            aria-hidden="true"
          >
            <title>Download</title>
            <path d="M12 3v12" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="5" y1="21" x2="19" y2="21" />
          </svg>
          Download voice
          <span className="size">{formatMb(LOW_TIER.sizeMb)}</span>
        </button>
      </section>

      <div className="onboard-facts">
        <div className="fact">
          <div className="k">Disk</div>
          <div className="v">
            {formatMb(LOW_TIER.sizeMb)}
            <small>one-time</small>
          </div>
        </div>
        <div className="fact">
          <div className="k">Privacy</div>
          <div className="v">
            On-device
            <small>no server, ever</small>
          </div>
        </div>
        <div className="fact">
          <div className="k">Voices</div>
          <div className="v">
            English × 4<small>Kokoro · Apache-2.0</small>
          </div>
        </div>
      </div>
    </>
  );
}

function DownloadingCard({
  status,
}: {
  status: Extract<AppStatus, { kind: "downloading" } | { kind: "loading" }>;
}): React.JSX.Element {
  const fraction = status.kind === "downloading" ? status.fraction : 0;
  const pct = Math.round(fraction * 100);
  const loadedMb = status.kind === "downloading" ? status.loadedMb : 0;
  const totalMb = status.kind === "downloading" ? status.totalMb : LOW_TIER.sizeMb;

  return (
    <section className="onboard-progress" aria-label="Voice download progress">
      <div className="kicker">downloading Kokoro</div>
      <div className="pct" data-testid="download-pct">
        {pct}
        <span className="sym">%</span>
      </div>
      <div className="meta">
        {loadedMb.toFixed(1)} / {totalMb.toFixed(0)} mb
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="note">
        Don't close this tab. The voice is being saved to your browser's private storage — next
        time, it'll already be here.
      </p>
    </section>
  );
}
