// Opening scene. A web article is in the browser viewport; user selects a
// sentence, right-click context menu appears with the catm action
// highlighted, then the side panel opens — reflowing the article to make
// room, the way Chrome's actual side panel does.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ARTICLE_LEAD, MOCK_SESSIONS, SAMPLE_CHUNK_DURATIONS, SAMPLE_CHUNKS } from "../data";
import { CopyOverlay } from "../overlay/CopyOverlay";
import { DemoApp } from "../shells/DemoApp";
import { MockWebpage } from "../shells/MockWebpage";
import { ZoomFrame } from "../shells/ZoomFrame";

const SELECTION_START_FRAME = 10;
const MENU_FRAME = 32;
const PANEL_FRAME = 58;
const SIDE_PANEL_TARGET_WIDTH = 420;

// Zoom into the right-click menu while it's open (the captioned CWS still
// sits at local ~48), then release as the side panel opens so the article
// reflow plays across the full-width frame.
const ZOOM_IN_START = 24;
const ZOOM_IN_END = 44;
const ZOOM_OUT_START = 54;
const ZOOM_OUT_END = 72;

interface SceneOnboardingProps {
  overlay: boolean;
}

export function SceneOnboarding({ overlay }: SceneOnboardingProps): React.JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Selection sweep across the first sentence.
  const selectionLen = interpolate(
    frame,
    [SELECTION_START_FRAME, SELECTION_START_FRAME + 18],
    [0, ARTICLE_LEAD.indexOf(".") + 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const selection = selectionLen > 0 ? { start: 0, end: Math.round(selectionLen) } : null;

  // Context menu visible after selection settles, until the panel takes over.
  const menuOpen = frame >= MENU_FRAME && frame < PANEL_FRAME + 4;

  // Side panel grows in from 0 → 420 px wide. The article reflows because
  // we use flexbox — exactly how Chrome's side panel behaves.
  const panelProgress = spring({
    frame: frame - PANEL_FRAME,
    fps,
    config: { damping: 200, stiffness: 90, mass: 0.6 },
  });
  const panelWidth = panelProgress * SIDE_PANEL_TARGET_WIDTH;

  return (
    <AbsoluteFill style={{ background: "#1a1c20" }}>
      <ZoomFrame
        scale={1.35}
        origin="44% 46%"
        inStart={ZOOM_IN_START}
        inEnd={ZOOM_IN_END}
        outStart={ZOOM_OUT_START}
        outEnd={ZOOM_OUT_END}
        style={{ display: "flex", flexDirection: "row" }}
      >
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MockWebpage selection={selection} contextMenu={menuOpen ? { x: 460, y: 320 } : null} />
        </div>

        <div
          style={{
            width: panelWidth,
            flexShrink: 0,
            background: "var(--bg-0)",
            borderLeft: "1px solid var(--border)",
            // Mild shadow only while opening — matches Chrome's panel reveal.
            boxShadow:
              panelProgress > 0 && panelProgress < 1
                ? "-1px 0 0 rgba(13,14,18,0.06), -12px 0 24px rgba(13,14,18,0.08)"
                : "-1px 0 0 rgba(13,14,18,0.06)",
            overflow: "hidden",
          }}
        >
          <div style={{ width: SIDE_PANEL_TARGET_WIDTH, height: "100%" }}>
            <DemoApp
              mode="panel"
              sessions={MOCK_SESSIONS.slice(0, 1)}
              activeId={"s-current"}
              title="The deep sea has been hiding from us"
              sourceText={ARTICLE_LEAD}
              voice="af_heart"
              speed={1.25}
              status={{ kind: "ready", device: "webgpu" }}
              currentTime={0}
              durationSec={40}
              chunkDurations={SAMPLE_CHUNK_DURATIONS}
              chunkTexts={SAMPLE_CHUNKS}
              playing={false}
              showDock={false}
            />
          </div>
        </div>
      </ZoomFrame>

      <CopyOverlay
        overlay={overlay}
        // Fade in during the selection sweep so the headline is already
        // present when the right-click menu opens. This gives a window in
        // which menu + copy co-exist — needed for the CWS still.
        startFrame={16}
        title={
          <>
            Select it. <em style={{ color: "#5b6cff", fontStyle: "normal" }}>Hear it.</em>
          </>
        }
        subtitle="Right-click any text on any page — the side panel opens with your selection cued up and ready to play."
      />
    </AbsoluteFill>
  );
}
