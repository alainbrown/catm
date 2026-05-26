import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { BrandMark } from "../components/BrandMark";
import { COLORS, FONT } from "../theme";

// Word-by-word reveal of the value prop.
function RevealedLine({ words, startFrame }: { words: string[]; startFrame: number }) {
  const frame = useCurrentFrame();
  return (
    <span style={{ display: "inline-block" }}>
      {words.map((w, i) => {
        const t = (frame - startFrame - i * 6) / 14;
        const opacity = Math.max(0, Math.min(1, t));
        const y = (1 - opacity) * 12;
        return (
          <span
            key={`${w}-${i}`}
            style={{
              display: "inline-block",
              opacity,
              transform: `translateY(${y}px)`,
              marginRight: 16,
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
}

export function ScenePromise() {
  const frame = useCurrentFrame();

  // Small brandmark anchored top-left like a watermark.
  const markOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 64,
          display: "flex",
          alignItems: "center",
          gap: 14,
          opacity: markOpacity,
          fontFamily: FONT.sans,
        }}
      >
        <BrandMark size={36} />
        <span
          style={{ fontWeight: 700, fontSize: 22, color: COLORS.ink0, letterSpacing: "-0.02em" }}
        >
          catm
        </span>
      </div>

      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: "0 120px",
          fontFamily: FONT.sans,
        }}
      >
        <h1
          style={{
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: COLORS.ink0,
            lineHeight: 1.1,
            textAlign: "center",
            margin: 0,
          }}
        >
          <RevealedLine words={["Long-form", "text-to-speech,"]} startFrame={6} />
          <br />
          <span style={{ display: "inline-block", marginTop: 18 }}>
            <RevealedLine words={["entirely", "in", "your"]} startFrame={42} />
            <span
              style={{
                background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentEnd})`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                display: "inline-block",
                opacity: Math.max(0, Math.min(1, (frame - 78) / 16)),
                transform: `translateY(${Math.max(0, 12 - (frame - 78))}px)`,
              }}
            >
              browser.
            </span>
          </span>
        </h1>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
