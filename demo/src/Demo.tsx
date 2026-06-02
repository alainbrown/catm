// Top-level composition. Chains scenes in sequence with cross-fades.
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { AbsoluteFill } from "remotion";
import { SceneCTA } from "./scenes/SceneCTA";
import { SceneFullTab } from "./scenes/SceneFullTab";
import { SceneOnboarding } from "./scenes/SceneOnboarding";
import { ScenePrivacy } from "./scenes/ScenePrivacy";
import { SceneProgressive } from "./scenes/SceneProgressive";
import { SceneSidePanel } from "./scenes/SceneSidePanel";
import { SceneVoices } from "./scenes/SceneVoices";
import { COLORS, SCENES, TRANSITION_FRAMES } from "./theme";

interface DemoProps {
  overlay: boolean;
}

const fadeT = () => ({
  presentation: fade(),
  timing: linearTiming({ durationInFrames: TRANSITION_FRAMES }),
});

export function Demo({ overlay }: DemoProps): React.JSX.Element {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES.onboarding}>
          <SceneOnboarding overlay={overlay} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...fadeT()} />

        <TransitionSeries.Sequence durationInFrames={SCENES.progressive}>
          <SceneProgressive overlay={overlay} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...fadeT()} />

        <TransitionSeries.Sequence durationInFrames={SCENES.sidepanel}>
          <SceneSidePanel overlay={overlay} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...fadeT()} />

        <TransitionSeries.Sequence durationInFrames={SCENES.voices}>
          <SceneVoices overlay={overlay} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...fadeT()} />

        <TransitionSeries.Sequence durationInFrames={SCENES.fulltab}>
          <SceneFullTab overlay={overlay} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...fadeT()} />

        <TransitionSeries.Sequence durationInFrames={SCENES.privacy}>
          <ScenePrivacy overlay={overlay} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition {...fadeT()} />

        <TransitionSeries.Sequence durationInFrames={SCENES.cta}>
          <SceneCTA overlay={overlay} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
}
