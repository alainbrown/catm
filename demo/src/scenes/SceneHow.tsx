import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "../components/Backdrop";
import { COLORS, FONT, SHADOW } from "../theme";

const CHIPS = ["Kokoro 82M", "ONNX Runtime Web", "WebGPU / WASM"];

function Chip({ label, delay }: { label: string; delay: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 160 },
  });
  return (
    <div
      style={{
        padding: "14px 22px",
        borderRadius: 999,
        background: COLORS.bgSurface,
        border: `1px solid ${COLORS.border}`,
        boxShadow: SHADOW.sm,
        fontFamily: FONT.mono,
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        color: COLORS.ink0,
        transform: `scale(${s}) translateY(${(1 - s) * 16}px)`,
        opacity: s,
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentEnd})`,
        }}
      />
      {label}
    </div>
  );
}

export function SceneHow() {
  const frame = useCurrentFrame();

  const kickerOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const kickerY = interpolate(frame, [0, 20], [12, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const footnoteOpacity = interpolate(frame, [150, 180], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const footnoteY = interpolate(frame, [150, 180], [10, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT.sans,
          gap: 40,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: COLORS.accent,
            opacity: kickerOpacity,
            transform: `translateY(${kickerY}px)`,
          }}
        >
          Powered by
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: 1500,
          }}
        >
          {CHIPS.map((label, i) => (
            <Chip key={label} label={label} delay={36 + i * 28} />
          ))}
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 24,
            fontWeight: 500,
            color: COLORS.ink2,
            opacity: footnoteOpacity,
            transform: `translateY(${footnoteY}px)`,
            display: "flex",
            gap: 16,
            alignItems: "center",
          }}
        >
          Model downloaded once
          <span style={{ color: COLORS.ink4 }}>·</span>
          <span style={{ fontFamily: FONT.mono, color: COLORS.ink0, fontWeight: 600 }}>
            ~310 MB
          </span>
          <span style={{ color: COLORS.ink4 }}>·</span>
          cached forever.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
