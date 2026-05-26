import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrandMark } from "../components/BrandMark";
import { COLORS, FONT } from "../theme";

export function SceneCTA() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markScale = spring({ frame, fps, config: { damping: 14, stiffness: 140 } });

  const urlOpacity = interpolate(frame, [22, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const urlScale = interpolate(frame, [22, 50], [0.94, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const subOpacity = interpolate(frame, [55, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // A slow gradient sweep across the URL.
  const sweep = interpolate(frame, [50, 180], [-100, 200], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT.sans,
          gap: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            transform: `scale(${markScale})`,
          }}
        >
          <BrandMark size={84} />
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              color: COLORS.ink0,
              lineHeight: 1,
            }}
          >
            catm
          </div>
        </div>

        <div
          style={{
            position: "relative",
            padding: "18px 36px",
            borderRadius: 16,
            border: `1px solid ${COLORS.border}`,
            background: COLORS.bgSurface,
            opacity: urlOpacity,
            transform: `scale(${urlScale})`,
            overflow: "hidden",
            fontFamily: FONT.mono,
            fontSize: 42,
            fontWeight: 600,
            color: COLORS.ink0,
            letterSpacing: "-0.02em",
          }}
        >
          {/* Subtle gradient sheen sweeping across */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(120deg, transparent 0%, rgba(91,108,255,0.18) 50%, transparent 100%)`,
              transform: `translateX(${sweep}%)`,
              pointerEvents: "none",
            }}
          />
          <span style={{ position: "relative" }}>catm-app.github.io</span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            alignItems: "center",
            fontSize: 22,
            fontWeight: 500,
            color: COLORS.ink2,
            opacity: subOpacity,
          }}
        >
          <span>Free</span>
          <span style={{ color: COLORS.ink4 }}>·</span>
          <span>open source</span>
          <span style={{ color: COLORS.ink4 }}>·</span>
          <span style={{ color: COLORS.good, fontWeight: 600 }}>MIT</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
