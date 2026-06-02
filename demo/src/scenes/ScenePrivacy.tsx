// Privacy scene. Full-tab layout with the storage breakdown panel pulled
// out / zoomed so the "320 MB voice · 18 MB readings · 1.2 GB free" line
// reads at a glance. Overlay copy reinforces "stays on your device".
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { MOCK_SESSIONS, SAMPLE_CHUNK_DURATIONS, SAMPLE_CHUNKS, SAMPLE_TEXT } from "../data";
import { CopyOverlay } from "../overlay/CopyOverlay";
import { DemoApp } from "../shells/DemoApp";
import { COLORS, FONT } from "../theme";

interface ScenePrivacyProps {
  overlay: boolean;
}

export function ScenePrivacy({ overlay }: ScenePrivacyProps): React.JSX.Element {
  const frame = useCurrentFrame();
  const dim = interpolate(frame, [0, 18], [0, 0.55], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cardLift = interpolate(frame, [12, 36], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cardOpacity = interpolate(frame, [12, 36], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "var(--bg-0)" }}>
      <DemoApp
        mode="tab"
        sessions={MOCK_SESSIONS}
        activeId={"s-current"}
        title="The deep sea has been hiding from us"
        sourceText={SAMPLE_TEXT}
        voice="af_heart"
        speed={1.25}
        status={{ kind: "ready", device: "webgpu" }}
        currentTime={18}
        durationSec={40}
        chunkDurations={SAMPLE_CHUNK_DURATIONS}
        chunkTexts={SAMPLE_CHUNKS}
        playing={true}
        showDock={true}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(13,14,18,${dim})`,
          pointerEvents: "none",
        }}
      />

      {/* Storage card pulled out and floated. Sits above the overlay scrim. */}
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 120,
          width: 380,
          zIndex: 20,
          padding: 22,
          background: COLORS.bgSurface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          boxShadow:
            "0 1px 2px rgba(13, 14, 18, 0.04), 0 24px 60px rgba(13, 14, 18, 0.18)",
          fontFamily: FONT.sans,
          color: COLORS.ink1,
          transform: `translateY(${cardLift}px)`,
          opacity: cardOpacity,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
            fontSize: 12,
            fontWeight: 700,
            color: COLORS.ink2,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <span>Storage</span>
          <span style={{ color: COLORS.ink0, fontSize: 13 }}>338 mb</span>
        </div>
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            height: 8,
            borderRadius: 6,
            overflow: "hidden",
            background: COLORS.bgSoft,
            marginBottom: 12,
          }}
        >
          <span style={{ background: COLORS.accent, width: "60%" }} />
          <span style={{ background: COLORS.good, width: "4%" }} />
        </div>
        <Row label="Voice" value="320 mb" dot={COLORS.accent} />
        <Row label="Recordings · 4" value="18 mb" dot={COLORS.good} />
        <Row label="Free" value="1.2 gb" dot={COLORS.ink4} />
        <div
          style={{
            display: "inline-block",
            marginTop: 12,
            padding: "4px 10px",
            borderRadius: 999,
            background: COLORS.goodSoft,
            color: COLORS.good,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          persistent · stays local
        </div>
      </div>

      <CopyOverlay
        overlay={overlay}
        startFrame={12}
        title={
          <>
            Nothing ever leaves{" "}
            <em style={{ color: "#5b6cff", fontStyle: "normal" }}>your device</em>.
          </>
        }
        subtitle="No accounts, no servers, no telemetry — the voice model and every recording stay in your browser."
      />
    </AbsoluteFill>
  );
}

function Row({
  label,
  value,
  dot,
}: {
  label: string;
  value: string;
  dot: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "5px 0",
        fontSize: 13,
        color: COLORS.ink1,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 3,
            background: dot,
            display: "inline-block",
          }}
        />
        {label}
      </span>
      <b style={{ color: COLORS.ink0 }}>{value}</b>
    </div>
  );
}
