// Full-tab popout scene. The wide desktop layout: rail with library +
// storage on the left, main column with composer + dock on the right.
import { AbsoluteFill } from "remotion";
import { MOCK_SESSIONS, SAMPLE_CHUNK_DURATIONS, SAMPLE_CHUNKS, SAMPLE_TEXT } from "../data";
import { CopyOverlay } from "../overlay/CopyOverlay";
import { DemoApp } from "../shells/DemoApp";

interface SceneFullTabProps {
  overlay: boolean;
}

export function SceneFullTab({ overlay }: SceneFullTabProps): React.JSX.Element {
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

      <CopyOverlay
        overlay={overlay}
        title={
          <>
            Pop out to the <em style={{ color: "#5b6cff", fontStyle: "normal" }}>full reader</em>.
          </>
        }
        subtitle="Library, composer, and playback side by side — articles, chapters, and whole RFCs in one tab."
      />
    </AbsoluteFill>
  );
}
