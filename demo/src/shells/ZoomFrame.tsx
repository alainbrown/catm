// Frame-driven zoom wrapper. Scales its children around a configurable
// origin so a small region (the side panel, the context menu, the voice
// popover) reads large, then optionally eases back out. Because the children
// are live DOM — not a bitmap — the browser re-rasterises text at the scaled
// size, so zoomed UI stays crisp instead of blurring like an image upscale.
//
// The CopyOverlay is always rendered as a SIBLING of <ZoomFrame>, never a
// child, so captions stay in screen space at full resolution.
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

interface ZoomFrameProps {
  children: React.ReactNode;
  /** Peak scale at the hold. 1 = no zoom. Default 1.4. */
  scale?: number;
  /** CSS transform-origin — the point that stays put while scaling. */
  origin?: string;
  /** Local scene frame where the zoom-in begins. */
  inStart: number;
  /** Local scene frame where the zoom reaches peak. */
  inEnd: number;
  /** Local scene frame where the zoom-out begins. Omit to hold to the end. */
  outStart?: number;
  /** Local scene frame where the zoom returns to 1×. Omit to hold to the end. */
  outEnd?: number;
  /** Extra styles merged onto the scaling layer (e.g. the flex row). */
  style?: React.CSSProperties;
}

const ease = Easing.inOut(Easing.cubic);

export function ZoomFrame({
  children,
  scale = 1.4,
  origin = "100% 50%",
  inStart,
  inEnd,
  outStart,
  outEnd,
  style,
}: ZoomFrameProps): React.JSX.Element {
  const frame = useCurrentFrame();
  const zoomIn = interpolate(frame, [inStart, inEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const zoomOut =
    outStart != null && outEnd != null
      ? interpolate(frame, [outStart, outEnd], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        })
      : 1;
  const t = Math.min(zoomIn, zoomOut);
  const s = 1 + (scale - 1) * t;

  return (
    <AbsoluteFill style={{ ...style, transform: `scale(${s})`, transformOrigin: origin }}>
      {children}
    </AbsoluteFill>
  );
}
