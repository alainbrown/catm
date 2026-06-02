// Conceptual streaming explainer (no UI screenshot). A row of sentence tiles
// fills left→right as the worker synthesises; a playhead drops in only ~3
// tiles in — mirroring the real PLAYBACK_BUFFER_SEGMENTS gate — then rides
// just behind the fill front, so the gap between "synthesised" and "playing"
// is the streaming story made visible. End labels (first audio ~2s vs the
// long total) sell that it starts instantly even on a whole book.
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, SHADOW } from "../theme";

const NUM_CHUNKS = 18;
const CHUNK_START = 24;
const CHUNK_INTERVAL = 10; // frames between sentence tiles appearing
const PLAYHEAD_START = CHUNK_START + 3 * CHUNK_INTERVAL; // audio begins ~3 tiles in
const PLAYHEAD_SPAN = (NUM_CHUNKS - 2) * CHUNK_INTERVAL;

const TRACK_X = 110;
const TRACK_WIDTH = 1060;
const TRACK_Y = 430;
const TILE_HEIGHT = 96;

interface SceneProgressiveProps {
  overlay: boolean;
}

function Backdrop(): React.JSX.Element {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        backgroundImage: [
          "radial-gradient(circle at 0% 0%, rgba(91, 108, 255, 0.10), transparent 50%)",
          "radial-gradient(circle at 100% 100%, rgba(255, 170, 140, 0.09), transparent 55%)",
          `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><circle cx='1' cy='1' r='1' fill='%23999' opacity='.16'/></svg>")`,
        ].join(", "),
      }}
    />
  );
}

export function SceneProgressive({ overlay }: SceneProgressiveProps): React.JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineOpacity = interpolate(frame, [0, 24], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const headlineY = interpolate(frame, [0, 24], [16, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const sublineOpacity = interpolate(frame, [16, 44], [0, 1], { extrapolateRight: "clamp" });

  // Playhead crosses tiles 0 → NUM_CHUNKS-2, riding just behind the fill front.
  const playheadProgress = interpolate(
    frame,
    [PLAYHEAD_START, PLAYHEAD_START + PLAYHEAD_SPAN],
    [0, NUM_CHUNKS - 2],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const playheadX = TRACK_X + (playheadProgress / NUM_CHUNKS) * TRACK_WIDTH;
  const playheadVisible = frame >= PLAYHEAD_START - 4;
  const playheadAppear = interpolate(frame, [PLAYHEAD_START - 4, PLAYHEAD_START + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const badgeSpring = spring({
    frame: frame - PLAYHEAD_START,
    fps,
    config: { damping: 12, stiffness: 160 },
  });

  return (
    <AbsoluteFill style={{ fontFamily: FONT.sans }}>
      <Backdrop />

      {overlay ? (
        <div style={{ position: "absolute", top: 96, left: 0, right: 0, textAlign: "center" }}>
          <h1
            style={{
              fontSize: 60,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: COLORS.ink0,
              margin: 0,
              lineHeight: 1.08,
              opacity: headlineOpacity,
              transform: `translateY(${headlineY}px)`,
            }}
          >
            Hear it almost <span style={{ color: COLORS.accent }}>instantly</span>.
          </h1>
          <div
            style={{
              marginTop: 16,
              fontSize: 23,
              fontWeight: 500,
              color: COLORS.ink2,
              opacity: sublineOpacity,
            }}
          >
            Audio starts in a couple of seconds — even for a whole book.
            <span style={{ color: COLORS.ink4, margin: "0 10px" }}>·</span>
            The rest streams as you listen.
          </div>
        </div>
      ) : null}

      {/* End labels framing the track: instant start vs the long total. */}
      <div
        style={{
          position: "absolute",
          left: TRACK_X,
          top: TRACK_Y - 36,
          fontFamily: FONT.mono,
          fontSize: 14,
          color: COLORS.accent,
          fontWeight: 600,
          opacity: playheadAppear,
        }}
      >
        first audio · ~2s
      </div>
      <div
        style={{
          position: "absolute",
          left: TRACK_X,
          top: TRACK_Y - 36,
          width: TRACK_WIDTH,
          textAlign: "right",
          fontFamily: FONT.mono,
          fontSize: 14,
          color: COLORS.ink4,
          fontWeight: 600,
        }}
      >
        full length · 31 min
      </div>

      {/* Sentence tiles — fill left→right as the worker emits them. */}
      <div
        style={{
          position: "absolute",
          left: TRACK_X,
          top: TRACK_Y,
          width: TRACK_WIDTH,
          height: TILE_HEIGHT,
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
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static row
              key={i}
              style={{
                flex: 1,
                height: "100%",
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: 8,
                opacity: t,
                transform: `translateY(${(1 - t) * 16}px) scaleY(${0.85 + 0.15 * t})`,
                transformOrigin: "bottom",
                boxShadow: t > 0.99 && !isPlayed ? `0 0 0 4px ${COLORS.accentSoft}` : "none",
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: TRACK_X,
          top: TRACK_Y + TILE_HEIGHT + 18,
          fontFamily: FONT.mono,
          fontSize: 14,
          color: COLORS.ink3,
          letterSpacing: "-0.01em",
        }}
      >
        each sentence → AAC → live HLS · played while the rest still synthesises
      </div>

      {/* Waveform — pulses only behind the playhead. */}
      <div
        style={{
          position: "absolute",
          left: TRACK_X,
          top: TRACK_Y + TILE_HEIGHT + 64,
          width: TRACK_WIDTH,
          height: 84,
          display: "flex",
          alignItems: "center",
          gap: 4,
          opacity: playheadAppear,
        }}
      >
        {Array.from({ length: 72 }).map((_, i) => {
          const seed = ((i * 9301 + 49297) % 233280) / 233280;
          const barX = TRACK_X + (i / 72) * TRACK_WIDTH;
          const passed = barX < playheadX;
          const pulse = passed ? 0.4 + 0.6 * Math.abs(Math.sin((frame + i * 7) / 6)) : 0.18;
          const h = (12 + seed * 56) * pulse;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static row
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

      {playheadVisible ? (
        <div
          style={{
            position: "absolute",
            left: playheadX - 1,
            top: TRACK_Y - 16,
            width: 2,
            height: TILE_HEIGHT + 132,
            background: COLORS.accent,
            opacity: playheadAppear,
            boxShadow: `0 0 12px ${COLORS.accent}`,
          }}
        />
      ) : null}

      {playheadVisible ? (
        <div
          style={{
            position: "absolute",
            left: playheadX,
            top: TRACK_Y - 78,
            transform: `translate(-50%, 0) scale(${badgeSpring})`,
            padding: "8px 16px 8px 12px",
            background: COLORS.accent,
            color: "#fff",
            borderRadius: 999,
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
  );
}
