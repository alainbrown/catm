// Design tokens mirroring src/app.css. Used by overlay copy and scenes
// that need design values outside of CSS (e.g. SVGs, gradient strings).
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

const { fontFamily: INTER_FAMILY } = loadInter();
const { fontFamily: JBM_FAMILY } = loadJetBrainsMono();

export const FPS = 30;

// Scene durations in frames. Each scene's zoom/copy apex is where render.sh
// extracts the captioned CWS still — keep those still frames in sync with
// these durations and the per-scene zoom keyframes.
export const SCENES = {
  onboarding: 110, // 3.7s — opens the side panel onboarding
  progressive: 240, //  8s — streaming/instant-start explainer (no UI still)
  sidepanel: 240, //  8s — reading with highlight
  voices: 120, //  4s — voice picker open
  fulltab: 150, //  5s — popout + library + composer
  privacy: 120, //  4s — storage breakdown
  cta: 90, //  3s — Add to Chrome
} as const;

export const TRANSITION_FRAMES = 12;

const SEQ_TOTAL = Object.values(SCENES).reduce((a, b) => a + b, 0);
const NUM_TRANSITIONS = Object.keys(SCENES).length - 1;
export const TOTAL_FRAMES = SEQ_TOTAL - NUM_TRANSITIONS * TRANSITION_FRAMES;

export const COLORS = {
  bg: "#fafbfc",
  bgSurface: "#ffffff",
  bgSoft: "#f4f5f7",
  border: "#e6e8ec",
  borderStrong: "#d4d7de",
  ink0: "#0d0e12",
  ink1: "#2a2d35",
  ink2: "#585d6b",
  ink3: "#8c92a3",
  ink4: "#b4b8c4",
  accent: "#5b6cff",
  accentEnd: "#8a98ff",
  accentSoft: "#eef0ff",
  accentInk: "#3b48cc",
  good: "#16a06f",
  goodSoft: "rgba(22, 160, 111, 0.10)",
  warn: "#b6552b",
  danger: "#c44a4a",
} as const;

export const GRADIENT = `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentEnd})`;

export const FONT = {
  sans: `${INTER_FAMILY}, "Inter Variable", ui-sans-serif, system-ui, -apple-system, sans-serif`,
  mono: `${JBM_FAMILY}, "JetBrains Mono Variable", ui-monospace, monospace`,
} as const;

export const SHADOW = {
  sm: "0 1px 2px rgba(13, 14, 18, 0.06)",
  md: "0 1px 2px rgba(13, 14, 18, 0.04), 0 8px 28px rgba(13, 14, 18, 0.06)",
  lg: "0 1px 2px rgba(13, 14, 18, 0.04), 0 24px 60px rgba(13, 14, 18, 0.10)",
  brand: "0 6px 24px rgba(91, 108, 255, 0.35)",
} as const;
