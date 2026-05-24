import { BrandMark } from "../components/BrandMark";
import type { AppStatus } from "../types";

interface OnboardingViewProps {
  status: AppStatus;
}

export function OnboardingView({ status }: OnboardingViewProps): React.JSX.Element {
  const fraction = status.kind === "downloading" ? status.fraction : 0;
  const pct = Math.round(fraction * 100);

  return (
    <div className="onboard-shell">
      <div className="onboard-brand">
        <BrandMark size={36} />
        <span className="name">
          catm <span>· come and talk to me</span>
        </span>
      </div>

      <section className="onboard-progress" aria-label="Voice loading progress">
        <div className="pct" data-testid="loading-pct">
          {pct}
          <span className="sym">%</span>
        </div>
        <div className="bar">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
      </section>
    </div>
  );
}
