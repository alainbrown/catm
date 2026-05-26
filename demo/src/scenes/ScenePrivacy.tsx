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

// A small browser-window card with rounded corners and traffic-light dots.
function BrowserCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 380,
        background: COLORS.bgSurface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 18,
        boxShadow: SHADOW.md,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.bgSoft,
        }}
      >
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e" }} />
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840" }} />
        <span
          style={{
            marginLeft: "auto",
            fontFamily: FONT.mono,
            fontSize: 12,
            color: COLORS.ink3,
          }}
        >
          catm-app.github.io
        </span>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  );
}

function TextBlob() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {[100, 92, 96, 78].map((w, i) => (
        <div
          key={i}
          style={{
            height: 8,
            width: `${w}%`,
            background: i === 3 ? COLORS.accentSoft : COLORS.bgSoft,
            borderRadius: 4,
          }}
        />
      ))}
    </div>
  );
}

function CloudIcon({ stroke }: { stroke: string }) {
  return (
    <svg width={92} height={64} viewBox="0 0 64 44">
      <path
        d="M16 36 Q4 36 4 24 Q4 14 14 13 Q16 6 24 5 Q34 4 38 12 Q46 12 50 18 Q60 18 60 28 Q60 36 50 36 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScenePrivacy() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Sequenced timeline (frames at 30fps):
  //   0   headline begins fading in
  //  20   "browser" card lands
  //  50   arrow shoots toward cloud
  //  80   strike-through across the arrow + cloud
  // 110   subline reveals
  // 160   "local." stamp slams down

  const headlineOpacity = interpolate(frame, [0, 24], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const headlineY = interpolate(frame, [0, 24], [16, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const cardSpring = spring({
    frame: frame - 20,
    fps,
    config: { damping: 18, stiffness: 140 },
  });

  const arrowGrow = interpolate(frame, [50, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const strikeGrow = interpolate(frame, [80, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const cloudFade = interpolate(frame, [78, 110], [1, 0.35], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const sublineOpacity = interpolate(frame, [110, 140], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const stampScale = spring({
    frame: frame - 160,
    fps,
    config: { damping: 9, stiffness: 180 },
  });
  const stampRotate = interpolate(stampScale, [0, 1], [-12, -6]);
  const stampVisible = frame >= 160;

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "120px 120px 0",
          fontFamily: FONT.sans,
        }}
      >
        <h1
          style={{
            fontSize: 76,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            color: COLORS.ink0,
            margin: 0,
            textAlign: "center",
            opacity: headlineOpacity,
            transform: `translateY(${headlineY}px)`,
            lineHeight: 1.1,
          }}
        >
          Your text never leaves the browser.
        </h1>

        <div
          style={{
            marginTop: 80,
            display: "flex",
            alignItems: "center",
            gap: 80,
            position: "relative",
          }}
        >
          {/* Browser card with the text inside */}
          <div
            style={{
              transform: `scale(${cardSpring}) translateY(${(1 - cardSpring) * 12}px)`,
              opacity: cardSpring,
            }}
          >
            <BrowserCard>
              <TextBlob />
            </BrowserCard>
          </div>

          {/* Arrow + strike toward the cloud */}
          <div
            style={{
              position: "relative",
              width: 200,
              height: 80,
              display: "flex",
              alignItems: "center",
            }}
          >
            <svg width={200} height={80} viewBox="0 0 200 80">
              {/* arrow shaft */}
              <line
                x1={4}
                y1={40}
                x2={4 + 180 * arrowGrow}
                y2={40}
                stroke={COLORS.ink3}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray="2 10"
              />
              {/* arrow head — only visible once the shaft has fully drawn */}
              {arrowGrow > 0.95 ? (
                <polygon points={`${184},${30} ${196},${40} ${184},${50}`} fill={COLORS.ink3} />
              ) : null}
              {/* red strike */}
              <line
                x1={20}
                y1={68}
                x2={20 + 160 * strikeGrow}
                y2={68 - 56 * strikeGrow}
                stroke={COLORS.danger}
                strokeWidth={6}
                strokeLinecap="round"
              />
            </svg>
          </div>

          {/* Cloud — fades / desaturates as the strike completes */}
          <div
            style={{
              opacity: cloudFade,
              transform: `scale(${cardSpring})`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <CloudIcon stroke={COLORS.ink3} />
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 13,
                color: COLORS.ink3,
                letterSpacing: "-0.01em",
              }}
            >
              server / cloud
            </span>
          </div>

          {/* "local." stamp */}
          {stampVisible ? (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: `translate(-50%, -50%) scale(${stampScale}) rotate(${stampRotate}deg)`,
                padding: "10px 24px",
                border: `4px solid ${COLORS.good}`,
                color: COLORS.good,
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: 36,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                background: "rgba(255,255,255,0.7)",
                borderRadius: 8,
                boxShadow: SHADOW.sm,
              }}
            >
              local only
            </div>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 64,
            display: "flex",
            gap: 28,
            opacity: sublineOpacity,
            fontSize: 26,
            fontWeight: 500,
            color: COLORS.ink2,
            fontFamily: FONT.sans,
          }}
        >
          <span>No server.</span>
          <span style={{ color: COLORS.ink4 }}>·</span>
          <span>No upload.</span>
          <span style={{ color: COLORS.ink4 }}>·</span>
          <span>No account.</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
