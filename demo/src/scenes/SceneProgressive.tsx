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

const NUM_CHUNKS = 12;
const CHUNK_INTERVAL = 24; // frames between chunks — sized so the timeline fills most of the 12s scene
const CHUNK_START = 30;
const PLAYHEAD_START = CHUNK_START + 3 * CHUNK_INTERVAL; // when audio begins (~3 chunks in)
const TIMELINE_X = 160;
const TIMELINE_Y = 540;
const TIMELINE_WIDTH = 1600;
const CHUNK_WIDTH = TIMELINE_WIDTH / NUM_CHUNKS;
const CHUNK_HEIGHT = 84;

export function SceneProgressive() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Headline + subline fade in.
  const headlineOpacity = interpolate(frame, [0, 24], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const headlineY = interpolate(frame, [0, 24], [16, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const sublineOpacity = interpolate(frame, [16, 40], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Playhead moves left → right starting at PLAYHEAD_START. It races slightly
  // ahead of the chunk-fill so you can see "playing while still synthesising".
  const playheadProgress = interpolate(
    frame,
    [PLAYHEAD_START, PLAYHEAD_START + (NUM_CHUNKS - 2) * CHUNK_INTERVAL],
    [0, NUM_CHUNKS - 2],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const playheadX = TIMELINE_X + playheadProgress * CHUNK_WIDTH;
  const playheadVisible = frame >= PLAYHEAD_START - 4;
  const playheadAppear = interpolate(frame, [PLAYHEAD_START - 4, PLAYHEAD_START + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // "▶ playing" badge slams down right at PLAYHEAD_START.
  const badgeSpring = spring({
    frame: frame - PLAYHEAD_START,
    fps,
    config: { damping: 12, stiffness: 160 },
  });
  const badgeVisible = frame >= PLAYHEAD_START - 2;

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ fontFamily: FONT.sans }}>
        {/* Headline */}
        <div
          style={{
            position: "absolute",
            top: 110,
            left: 0,
            right: 0,
            textAlign: "center",
            padding: "0 80px",
          }}
        >
          <h1
            style={{
              fontSize: 86,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: COLORS.ink0,
              margin: 0,
              lineHeight: 1.1,
              opacity: headlineOpacity,
              transform: `translateY(${headlineY}px)`,
            }}
          >
            Start listening in seconds.
          </h1>
          <div
            style={{
              marginTop: 18,
              fontSize: 26,
              fontWeight: 500,
              color: COLORS.ink2,
              opacity: sublineOpacity,
            }}
          >
            First audio in ~3s
            <span style={{ color: COLORS.ink4, margin: "0 12px" }}>·</span>
            the rest streams as you read.
          </div>
        </div>

        {/* Timeline of chunks (sentence-by-sentence appearance) */}
        <div
          style={{
            position: "absolute",
            left: TIMELINE_X,
            top: TIMELINE_Y,
            width: TIMELINE_WIDTH,
            height: CHUNK_HEIGHT,
            display: "flex",
            gap: 6,
          }}
        >
          {Array.from({ length: NUM_CHUNKS }).map((_, i) => {
            const appearAt = CHUNK_START + i * CHUNK_INTERVAL;
            const t = interpolate(frame, [appearAt, appearAt + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const isPlayed = i < playheadProgress;
            const bg = isPlayed ? COLORS.accent : t > 0.99 ? COLORS.accentSoft : COLORS.bgSoft;
            const border = isPlayed ? COLORS.accent : t > 0.99 ? COLORS.accent : COLORS.border;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: "100%",
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  opacity: Math.max(0.0, t),
                  transform: `translateY(${(1 - t) * 16}px) scaleY(${0.85 + 0.15 * t})`,
                  transformOrigin: "bottom",
                  boxShadow: t > 0.99 && !isPlayed ? `0 0 0 4px ${COLORS.accentSoft}` : "none",
                }}
              />
            );
          })}
        </div>

        {/* Label under the timeline */}
        <div
          style={{
            position: "absolute",
            left: TIMELINE_X,
            top: TIMELINE_Y + CHUNK_HEIGHT + 18,
            fontFamily: FONT.mono,
            fontSize: 14,
            color: COLORS.ink3,
            letterSpacing: "-0.01em",
          }}
        >
          sentences synthesised → fragmented MP4 → live HLS
        </div>

        {/* Waveform — pulses underneath, only while playhead is active */}
        <div
          style={{
            position: "absolute",
            left: TIMELINE_X,
            top: TIMELINE_Y + CHUNK_HEIGHT + 68,
            width: TIMELINE_WIDTH,
            height: 90,
            display: "flex",
            alignItems: "center",
            gap: 4,
            opacity: playheadAppear,
          }}
        >
          {Array.from({ length: 80 }).map((_, i) => {
            // Pseudo-random but stable per bar.
            const seed = ((i * 9301 + 49297) % 233280) / 233280;
            // Bars only "active" when the playhead has reached them.
            const barX = TIMELINE_X + (i / 80) * TIMELINE_WIDTH;
            const passed = barX < playheadX;
            const pulse = passed ? 0.4 + 0.6 * Math.abs(Math.sin((frame + i * 7) / 6)) : 0.18;
            const h = (12 + seed * 60) * pulse;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: h,
                  background: passed ? COLORS.accent : COLORS.ink4,
                  borderRadius: 2,
                  opacity: passed ? 0.85 : 0.35,
                }}
              />
            );
          })}
        </div>

        {/* Playhead vertical line */}
        {playheadVisible ? (
          <div
            style={{
              position: "absolute",
              left: playheadX - 1,
              top: TIMELINE_Y - 20,
              width: 2,
              height: CHUNK_HEIGHT + 140,
              background: COLORS.accent,
              opacity: playheadAppear,
              boxShadow: `0 0 12px ${COLORS.accent}`,
            }}
          />
        ) : null}

        {/* "▶ playing" badge above the playhead */}
        {badgeVisible ? (
          <div
            style={{
              position: "absolute",
              left: playheadX,
              top: TIMELINE_Y - 90,
              transform: `translate(-50%, 0) scale(${badgeSpring})`,
              padding: "8px 16px 8px 12px",
              background: COLORS.accent,
              color: "#fff",
              borderRadius: 999,
              fontFamily: FONT.sans,
              fontSize: 18,
              fontWeight: 600,
              boxShadow: SHADOW.brand,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: 14 }}>▶</span> playing
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
