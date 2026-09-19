/** Where the floating detection window sits and how wide it is; chrome, so it lives per machine, not per account. */

const KEY = "karasu-detection-layout";

/** Narrower than this and the title, the cover and two buttons no longer share a row. */
export const DETECTION_MIN_WIDTH = 288;
/** A card, not a panel: past this the cover is a stamp in a sea of text. */
export const DETECTION_MAX_WIDTH = 560;
/** The width of the docked card, so undocking changes nothing but the anchor. */
export const DEFAULT_DETECTION_WIDTH = 352;
/** The gap the docked card keeps from the window edge; a dragged card keeps the same one. */
export const DETECTION_MARGIN = 16;
/** Below this a pointer is pressing, not dragging, and the press stays a click. */
export const DRAG_THRESHOLD = 3;

export interface DetectionPosition {
  left: number;
  top: number;
}

export interface DetectionLayout {
  /** Null while the card is docked bottom-right; a value once it has been dragged anywhere. */
  position: DetectionPosition | null;
  width: number;
}

export interface Size {
  width: number;
  height: number;
}

export type ResizeEdge = "left" | "right";

export const DEFAULT_DETECTION_LAYOUT: DetectionLayout = {
  position: null,
  width: DEFAULT_DETECTION_WIDTH,
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function loadDetectionLayout(): DetectionLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DETECTION_LAYOUT;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return DEFAULT_DETECTION_LAYOUT;
    const { left, top, width } = saved as Record<string, unknown>;
    return {
      // Half a position is no position: the card docks rather than landing at a guessed coordinate.
      position: finite(left) && finite(top) ? { left, top } : null,
      width: finite(width) ? clampWidth(width, Infinity) : DEFAULT_DETECTION_WIDTH,
    };
  } catch {
    // Private-mode localStorage throws on read as well as write, and a corrupt JSON string throws on parse.
    return DEFAULT_DETECTION_LAYOUT;
  }
}

export function saveDetectionLayout(layout: DetectionLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...layout.position, width: layout.width }));
  } catch {
    // Not worth surfacing: the card still moved, and failing a drag over a storage quota would be worse.
  }
}

/** Within the card's own bounds and inside the viewport with its margins; the minimum wins over a tiny viewport. */
export function clampWidth(width: number, viewportWidth: number): number {
  const room = viewportWidth - 2 * DETECTION_MARGIN;
  return Math.max(DETECTION_MIN_WIDTH, Math.min(DETECTION_MAX_WIDTH, room, width));
}

/** Keeps the whole card visible; when the viewport is smaller than the card, the top-left margin is what stays. */
export function clampPosition(
  position: DetectionPosition,
  size: Size,
  viewport: Size,
): DetectionPosition {
  const maxLeft = viewport.width - size.width - DETECTION_MARGIN;
  const maxTop = viewport.height - size.height - DETECTION_MARGIN;
  return {
    left: Math.max(DETECTION_MARGIN, Math.min(maxLeft, position.left)),
    top: Math.max(DETECTION_MARGIN, Math.min(maxTop, position.top)),
  };
}

export interface DragOrigin {
  pointer: { x: number; y: number };
  position: DetectionPosition;
}

/** The card follows the pointer by the distance it has travelled since the press, and never leaves the viewport. */
export function dragPosition(
  origin: DragOrigin,
  pointer: { x: number; y: number },
  size: Size,
  viewport: Size,
): DetectionPosition {
  return clampPosition(
    {
      left: origin.position.left + (pointer.x - origin.pointer.x),
      top: origin.position.top + (pointer.y - origin.pointer.y),
    },
    size,
    viewport,
  );
}

export interface ResizeOrigin {
  pointerX: number;
  /** Null while docked, where CSS keeps the right edge on the margin and only the width moves. */
  left: number | null;
  width: number;
}

/** Dragging the right edge keeps the left one still; dragging the left edge keeps the right one still. */
export function resizeWidth(
  origin: ResizeOrigin,
  edge: ResizeEdge,
  pointerX: number,
  viewport: Size,
): { left: number | null; width: number } {
  const delta = pointerX - origin.pointerX;
  const width = clampWidth(edge === "right" ? origin.width + delta : origin.width - delta, viewport.width);
  const left =
    edge === "right" || origin.left === null ? origin.left : origin.left + (origin.width - width);
  return { left, width };
}

export function pastThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}
