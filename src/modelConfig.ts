// Single source of truth for user-facing model metadata. Copy lives here so the
// onboarding card, model popover, and confirm dialogs can't drift apart.

export interface ModelTier {
  id: string;
  family: string;
  paramCount: string;
  sizeMb: number;
  blurb: string;
}

export const LOW_TIER: ModelTier = {
  id: "kokoro-82m-low",
  family: "Kokoro",
  paramCount: "82M",
  // model.onnx (fp32) on HF is 325,532,232 bytes ≈ 310 MiB.
  sizeMb: 310,
  blurb: "clearly synthetic but pleasant",
};

export const MEDIUM_TIER_PLACEHOLDER = {
  approxSizeMb: 500,
  blurb: "closer to a human narrator",
};

export const HIGH_TIER_PLACEHOLDER = {
  approxSizeMb: 700,
  blurb: "near-human, expressive",
};

export function formatMb(mb: number): string {
  return `${Math.round(mb)} mb`;
}
