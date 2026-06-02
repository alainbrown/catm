// Voice picker scene. Same flex layout as SceneSidePanel; the chip popover
// opens naturally via VoiceChip's forceOpen prop, anchored above the chip.
// A preview ▶ cycles through Bella → Michael → Eric.
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { MOCK_SESSIONS, SAMPLE_CHUNK_DURATIONS, SAMPLE_CHUNKS, SAMPLE_TEXT } from "../data";
import { CopyOverlay } from "../overlay/CopyOverlay";
import { DemoApp } from "../shells/DemoApp";
import { MockWebpage } from "../shells/MockWebpage";
import { ZoomFrame } from "../shells/ZoomFrame";
import type { VoiceId } from "../../../src/worker/kokoro.worker";

const SIDE_PANEL_WIDTH = 420;
const PREVIEW_SEQ: VoiceId[] = ["af_bella", "am_michael", "am_eric"];

interface SceneVoicesProps {
  overlay: boolean;
}

export function SceneVoices({ overlay }: SceneVoicesProps): React.JSX.Element {
  const frame = useCurrentFrame();
  const idx = Math.min(PREVIEW_SEQ.length - 1, Math.floor((frame - 30) / 40));
  const previewing: VoiceId | null = frame > 30 ? PREVIEW_SEQ[idx] ?? null : null;

  return (
    <AbsoluteFill style={{ background: "#1a1c20" }}>
      <ZoomFrame
        scale={1.3}
        origin="100% 58%"
        inStart={26}
        inEnd={56}
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
            // Voice popover opens upward from the chip — allow it to render
            // outside the panel's vertical bounds if its top edge would clip.
            overflow: "visible",
            position: "relative",
          }}
        >
          <DemoApp
            mode="panel"
            sessions={MOCK_SESSIONS.slice(0, 1)}
            activeId={"s-current"}
            title="The deep sea has been hiding from us"
            sourceText={SAMPLE_TEXT}
            voice="af_heart"
            speed={1.25}
            status={{ kind: "ready", device: "webgpu" }}
            currentTime={0}
            durationSec={40}
            chunkDurations={SAMPLE_CHUNK_DURATIONS}
            chunkTexts={SAMPLE_CHUNKS}
            playing={false}
            showDock={false}
            voiceOpen={true}
            voicePreviewing={previewing}
          />
        </div>
      </ZoomFrame>

      <CopyOverlay
        overlay={overlay}
        title={
          <>
            Find your voice.{" "}
            <em style={{ color: "#5b6cff", fontStyle: "normal" }}>Preview before you pick.</em>
          </>
        }
        subtitle="Tap ▶ for an instant sample, synthesised on the spot — no upload, no wait."
      />
    </AbsoluteFill>
  );
}
