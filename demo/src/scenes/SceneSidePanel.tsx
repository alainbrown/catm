// Side-panel playback scene. Article reflowed to a narrower column on the
// left; side panel pinned to the right showing the reader with audio
// playing and the highlight scrolling through chunks. In the back half the
// history drawer slides in to show the recordings library, then closes.
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { MOCK_SESSIONS, SAMPLE_CHUNK_DURATIONS, SAMPLE_CHUNKS, SAMPLE_TEXT } from "../data";
import { CopyOverlay } from "../overlay/CopyOverlay";
import { DemoApp } from "../shells/DemoApp";
import { MockWebpage } from "../shells/MockWebpage";
import { ZoomFrame } from "../shells/ZoomFrame";

const SIDE_PANEL_WIDTH = 420;
const TOTAL_DURATION_SEC = 40;

// Zoom beat (local scene frames). Push into the panel while the highlight
// travels, hold through the captioned CWS still (local ~95), then ease back
// to 1× before the drawer needs the full width.
const ZOOM_IN_START = 38;
const ZOOM_IN_END = 62;
const ZOOM_OUT_START = 132;
const ZOOM_OUT_END = 142;

// Drawer beat, in local scene frames. Kept after the zoom-out so the
// slide-in plays across the full-width frame.
const DRAWER_IN = 144;
const DRAWER_FULL = 158;
const DRAWER_OUT = 212;
const DRAWER_GONE = 226;

interface SceneSidePanelProps {
  overlay: boolean;
}

export function SceneSidePanel({ overlay }: SceneSidePanelProps): React.JSX.Element {
  const frame = useCurrentFrame();
  // Scene runs ~8 s; drive playback through the source text faster than
  // realtime so the highlight travels the whole text within the scene.
  const currentTime = (frame / 30) * (TOTAL_DURATION_SEC / 8);
  const cumulative = SAMPLE_CHUNK_DURATIONS.reduce((acc, d) => {
    acc.push((acc[acc.length - 1] ?? 0) + d);
    return acc;
  }, [] as number[]);
  const total = cumulative[cumulative.length - 1] ?? TOTAL_DURATION_SEC;
  const clampedTime = Math.min(currentTime, total - 0.1);

  const drawerProgress = interpolate(
    frame,
    [DRAWER_IN, DRAWER_FULL, DRAWER_OUT, DRAWER_GONE],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Cross-fade the copy: reading line out as the drawer opens, library line
  // in while it's open.
  const readingOpacity = interpolate(frame, [DRAWER_IN - 25, DRAWER_IN - 5], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const libraryOpacity = interpolate(
    frame,
    [DRAWER_FULL, DRAWER_FULL + 10, DRAWER_OUT - 6, DRAWER_OUT + 6],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ background: "#1a1c20" }}>
      <ZoomFrame
        scale={1.45}
        origin="100% 50%"
        inStart={ZOOM_IN_START}
        inEnd={ZOOM_IN_END}
        outStart={ZOOM_OUT_START}
        outEnd={ZOOM_OUT_END}
        style={{ display: "flex", flexDirection: "row" }}
      >
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MockWebpage selection={null} contextMenu={null} />
        </div>

        <div
          style={{
            width: SIDE_PANEL_WIDTH,
            flexShrink: 0,
            background: "var(--bg-0)",
            borderLeft: "1px solid var(--border)",
          }}
        >
          <DemoApp
            mode="panel"
            sessions={MOCK_SESSIONS}
            activeId={"s-current"}
            title="The deep sea has been hiding from us"
            sourceText={SAMPLE_TEXT}
            voice="af_heart"
            speed={1.25}
            status={{ kind: "ready", device: "webgpu" }}
            currentTime={clampedTime}
            durationSec={TOTAL_DURATION_SEC}
            chunkDurations={SAMPLE_CHUNK_DURATIONS}
            chunkTexts={SAMPLE_CHUNKS}
            playing={true}
            showDock={true}
            drawerProgress={drawerProgress}
          />
        </div>
      </ZoomFrame>

      {overlay ? (
        <>
          <div style={{ opacity: readingOpacity }}>
            <CopyOverlay
              overlay={overlay}
              title={
                <>
                  Whole articles, in a{" "}
                  <em style={{ color: "#5b6cff", fontStyle: "normal" }}>natural voice</em>.
                </>
              }
              subtitle="Synthesised right in your browser. The text highlights as it reads, so you can follow along or skim ahead."
            />
          </div>
          <div style={{ opacity: libraryOpacity }}>
            <CopyOverlay
              overlay={overlay}
              startFrame={DRAWER_IN}
              title={
                <>
                  Your library,{" "}
                  <em style={{ color: "#5b6cff", fontStyle: "normal" }}>always to hand</em>.
                </>
              }
              subtitle="Every reading is saved on your device. Slide out the history and pick up exactly where you left off."
            />
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
}
