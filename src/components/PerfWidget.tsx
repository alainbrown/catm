import type { PerfState } from "../App";

interface PerfWidgetProps {
  perf: PerfState;
}

function Sparkline({
  values,
  color,
  height = 22,
  fillId,
}: {
  values: number[];
  color: string;
  height?: number;
  fillId: string;
}): React.JSX.Element {
  const w = values.length;
  // Replace NaN with 0 for math; we'll plot only the finite tail.
  const finite = values.map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(1, ...finite);
  const path = finite
    .map((v, i) => {
      const x = (i / (w - 1)) * 100;
      const y = height - (v / max) * (height - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const fill = `${path} L100,${height} L0,${height} Z`;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="perf-spark"
    >
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${fillId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

function fmtSamplesPerSec(sps: number): string {
  if (sps <= 0) return "idle";
  if (sps < 1000) return `${sps} S/s`;
  return `${(sps / 1000).toFixed(0)} kS/s`;
}

function fmtMb(mb: number): string {
  if (!Number.isFinite(mb)) return "—";
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function PerfWidget({ perf }: PerfWidgetProps): React.JSX.Element {
  const { device, synthSamplesPerSec, memoryMb, memoryApiAvailable } = perf;
  const latestThroughput = synthSamplesPerSec[synthSamplesPerSec.length - 1] ?? 0;
  const latestMem = [...memoryMb].reverse().find(Number.isFinite) ?? Number.NaN;

  const onWebGpu = device?.device === "webgpu";
  const deviceLabel =
    device?.device === "webgpu"
      ? device.adapterName || "WebGPU"
      : device?.device === "wasm"
        ? "WASM · CPU"
        : "—";

  return (
    <section className="perf-section" aria-label="Performance">
      <div className="perf-lbl">
        <span>Performance</span>
        <span className="perf-tick">live</span>
      </div>

      <div className={onWebGpu ? "perf-device good" : "perf-device wasm"}>
        <span className="dot" />
        <span className="gpu">{deviceLabel}</span>
        {device && device.features.length > 0 ? (
          <span className="feat">
            {device.features.includes("shader-f16") ? <span className="tag">f16</span> : null}
            {device.features.includes("timestamp-query") ? (
              <span className="tag">timing</span>
            ) : null}
          </span>
        ) : null}
      </div>

      <div className="perf-charts">
        <div
          className="perf-chart"
          title={
            memoryApiAvailable
              ? "performance.measureUserAgentSpecificMemory() — total bytes used by this page and its workers"
              : "Memory API unavailable. Needs crossOriginIsolated context (COOP/COEP). Service worker should provide that on next reload."
          }
        >
          <div className="head">
            <span className="k">memory</span>
            <span className="v">{memoryApiAvailable ? fmtMb(latestMem) : "n/a"}</span>
          </div>
          <Sparkline values={memoryMb} color="#5b6cff" fillId="perf-mem-fill" />
          <span className="foot">5 min · agent</span>
        </div>
        <div
          className="perf-chart"
          title="PCM samples emitted per second (worker chunk-encoded events)"
        >
          <div className="head">
            <span className="k">synth</span>
            <span className="v">{fmtSamplesPerSec(latestThroughput)}</span>
          </div>
          <Sparkline values={synthSamplesPerSec} color="#16a06f" fillId="perf-synth-fill" />
          <span className="foot">60 s · worker</span>
        </div>
      </div>
    </section>
  );
}
