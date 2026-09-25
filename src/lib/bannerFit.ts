/** Where a banner shown whole sits in its frame, and what has to fill the rest without drawing a hard edge. */

/** AniList's banner shape; nearly every banner is exactly 1900 × 400, and CLAUDE.md has the count. */
export const BANNER_RATIO = 1900 / 400;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = "top" | "right" | "bottom" | "left";

export interface BannerFit {
  /** The picture's box inside the frame, as `object-fit: contain` places it. */
  image: Rect;
  /** The uncovered margin on each side; 0 where the picture reaches the frame's edge. */
  gaps: Record<Side, number>;
}

/** A sub-pixel sliver is rounding, not a gap worth a fill. */
const gap = (n: number) => (n < 1 ? 0 : n);

/** `contain` done by hand, so the fill and the feathered edges land exactly where the picture ends. */
export function fitBanner(
  frame: { width: number; height: number },
  ratio: number,
  anchor: "center" | "top" = "center",
): BannerFit | null {
  if (!(frame.width > 0) || !(frame.height > 0) || !(ratio > 0)) return null;
  const width = Math.min(frame.width, frame.height * ratio);
  const height = width / ratio;
  const left = (frame.width - width) / 2;
  const top = anchor === "top" ? 0 : (frame.height - height) / 2;
  return {
    image: { left, top, width, height },
    gaps: {
      top: gap(top),
      right: gap(frame.width - left - width),
      bottom: gap(frame.height - top - height),
      left: gap(left),
    },
  };
}

/** One strip of fill per open side, reaching `lap` px under the picture so the blur's soft edge hides beneath it. */
export function edgeBands(fit: BannerFit, lap: number): { side: Side; rect: Rect }[] {
  const { image, gaps } = fit;
  const bottom = image.top + image.height;
  const right = image.left + image.width;
  const bands: { side: Side; rect: Rect }[] = [];
  if (gaps.top) bands.push({ side: "top", rect: { left: image.left, top: 0, width: image.width, height: gaps.top + lap } });
  if (gaps.bottom)
    bands.push({ side: "bottom", rect: { left: image.left, top: bottom - lap, width: image.width, height: gaps.bottom + lap } });
  if (gaps.left) bands.push({ side: "left", rect: { left: 0, top: image.top, width: gaps.left + lap, height: image.height } });
  if (gaps.right)
    bands.push({ side: "right", rect: { left: right - lap, top: image.top, width: gaps.right + lap, height: image.height } });
  return bands;
}

/** A mask fading the picture's own edges where a fill takes over, over the frame's box; null when nothing is open. */
export function featherMask(fit: BannerFit, px: number): string | null {
  const { image, gaps } = fit;
  const axis = (from: number, size: number, openStart: boolean, openEnd: boolean, dir: string) => {
    const end = from + size;
    const head = openStart ? `transparent ${from}px, #000 ${from + px}px` : "#000 0px";
    const tail = openEnd ? `#000 ${end - px}px, transparent ${end}px` : "#000 100%";
    return `linear-gradient(${dir}, ${head}, ${tail})`;
  };
  if (gaps.top || gaps.bottom) return axis(image.top, image.height, !!gaps.top, !!gaps.bottom, "to bottom");
  if (gaps.left || gaps.right) return axis(image.left, image.width, !!gaps.left, !!gaps.right, "to right");
  return null;
}
