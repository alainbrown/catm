// Closing CTA. catm wordmark, single-line value prop, "Add to Chrome" button.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BrandMark } from "../../../src/components/BrandMark";
import { COLORS, FONT, GRADIENT, SHADOW } from "../theme";

interface SceneCTAProps {
  overlay: boolean;
}

export function SceneCTA({ overlay }: SceneCTAProps): React.JSX.Element {
  void overlay; // CTA scene always shows copy — it's the whole point.
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bounce = spring({
    frame: frame - 12,
    fps,
    config: { damping: 12, stiffness: 90, mass: 0.7 },
  });
  const scale = interpolate(bounce, [0, 1], [0.85, 1]);
  const titleOpacity = interpolate(frame, [4, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaOpacity = interpolate(frame, [24, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaLift = interpolate(frame, [24, 40], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        backgroundImage:
          "radial-gradient(circle at 10% 10%, rgba(91, 108, 255, 0.16), transparent 45%), radial-gradient(circle at 90% 90%, rgba(255, 170, 140, 0.10), transparent 50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 40,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          transform: `scale(${scale})`,
        }}
      >
        <BrandMark size={86} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span
            style={{
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.035em",
              color: COLORS.ink0,
            }}
          >
            catm
          </span>
          <span
            style={{
              fontSize: 18,
              color: COLORS.ink3,
              marginTop: 8,
              letterSpacing: "0.01em",
            }}
          >
            come and talk to me
          </span>
        </div>
      </div>

      <div
        style={{
          fontSize: 28,
          color: COLORS.ink1,
          opacity: titleOpacity,
          maxWidth: 760,
          textAlign: "center",
          lineHeight: 1.35,
          letterSpacing: "-0.015em",
        }}
      >
        Long-form text-to-speech. In your browser. Free.
      </div>

      <div
        style={{
          opacity: ctaOpacity,
          transform: `translateY(${ctaLift}px)`,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 22px",
            background: GRADIENT,
            color: "white",
            borderRadius: 12,
            fontSize: 18,
            fontWeight: 700,
            boxShadow: SHADOW.brand,
            letterSpacing: "-0.01em",
          }}
        >
          <ChromeMark />
          Add to Chrome — Free
        </div>
        <span style={{ color: COLORS.ink3, fontSize: 14 }}>chromewebstore.google.com</span>
      </div>
    </AbsoluteFill>
  );
}

function ChromeMark(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="white" />
      <circle cx="24" cy="24" r="9" fill="#5b6cff" />
      <circle cx="24" cy="24" r="6" fill="white" />
      <path
        d="M24 2a22 22 0 0 1 19 11H26a9 9 0 0 0-8 5z"
        fill="#ff6b6b"
        opacity="0.85"
      />
      <path
        d="M3 35a22 22 0 0 0 21 11l-9-15a9 9 0 0 1-12-1z"
        fill="#4caf50"
        opacity="0.85"
      />
      <path
        d="M43 13a22 22 0 0 1 1 22l-12-6a9 9 0 0 0-3-13z"
        fill="#ffb547"
        opacity="0.85"
      />
    </svg>
  );
}
