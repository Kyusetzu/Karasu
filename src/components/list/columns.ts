/** Fixed tracks, never a width at a call site: VirtualGrid makes every row its own grid and subgrid is unavailable. */

/** Rough advance width of one `text-xs`/`text-sm` tabular digit, in px. */
const DIGIT_PX = 7.2;
/** What a native `<select>` reserves for its arrow inside the content box. */
const SELECT_ARROW_PX = 20;
/** Horizontal padding inside a cell control (`px-2` both sides). */
const CELL_PADDING_PX = 16;
/** Keep this headroom; a cell sized to exactly the glyph estimate clips in practice, and a select shows no ellipsis. */
const SAFETY_PX = 6;

/** The narrowest the flexible title track is allowed to become. */
export const TITLE_MIN_PX = 180;

/** Width for `chars` tabular characters; `control` adds the native select's arrow, rounded up to the spacing scale. */
export function cellWidth(chars: number, control = false): number {
  const content =
    chars * DIGIT_PX +
    CELL_PADDING_PX +
    SAFETY_PX +
    (control ? SELECT_ARROW_PX : 0);
  return Math.ceil(content / 4) * 4;
}

/** The widest string each numeric column must hold; kept here so the test and the widths cannot drift apart. */
export const WORST_CASE = {
  /** No star in the closed display (`SCORE_SHOWS_STAR`); POINT_10_DECIMAL renders the widest score of any format. */
  score: "10.0",
  progress: "1100 / 1100",
  volumes: "108 / 108",
  repeat: "×12",
} as const;

/** The closed score control shows the number alone; the star prefix cost more width than the digit it decorated. */
export const SCORE_SHOWS_STAR = false;

export const COLUMN_PX = {
  cover: 60,
  status: 128,
  score: cellWidth(WORST_CASE.score.length, true),
  progress: cellWidth(WORST_CASE.progress.length, true),
  volumes: cellWidth(WORST_CASE.volumes.length, true),
  repeat: cellWidth(WORST_CASE.repeat.length),
  dates: 116,
  tags: 128,
  /** Four icon buttons at `size-xs` plus their gaps — the widest it gets. */
  actions: 132,
} as const;

/** Every optional column, in the order a narrowing row gives them up. */
export type Optional = "tags" | "dates" | "repeat" | "status" | "volumes";

/** How much of the table fits: `mid` drops the rarely edited columns, `compact` also drops status and volumes. */
export type Tier = "compact" | "mid" | "full";

/** Which optional columns each tier keeps. */
const KEPT: Record<Tier, ReadonlySet<Optional>> = {
  full: new Set<Optional>(["tags", "dates", "repeat", "status", "volumes"]),
  mid: new Set<Optional>(["status", "volumes"]),
  compact: new Set<Optional>([]),
};

export function shows(tier: Tier, column: Optional): boolean {
  return KEPT[tier].has(column);
}

export interface RowShape {
  tier: Tier;
  selectMode: boolean;
  /** Manga tracks volumes as a second axis; anime has no such column. */
  manga: boolean;
}

/** The width of every fixed track for a shape — what has to fit. */
export function fixedWidth(shape: RowShape): number {
  const c = COLUMN_PX;
  const on = (col: Optional, px: number) =>
    shows(shape.tier, col) && (col !== "volumes" || shape.manga) ? px : 0;
  return (
    (shape.selectMode ? 24 : 0) +
    c.cover +
    c.score +
    c.progress +
    c.actions +
    on("status", c.status) +
    on("volumes", c.volumes) +
    on("repeat", c.repeat) +
    on("dates", c.dates) +
    on("tags", c.tags)
  );
}

/** The narrowest a row of this shape can be before its tracks overflow. */
export function minRowWidth(shape: RowShape): number {
  return fixedWidth(shape) + TITLE_MIN_PX;
}

/** Title is `minmax(0, 1fr)` so it truncates; dropped columns become `0px` tracks so the track count never changes. */
export function templateColumns(shape: RowShape): string {
  const c = COLUMN_PX;
  const on = (col: Optional, px: number) =>
    shows(shape.tier, col) && (col !== "volumes" || shape.manga) ? px : 0;
  return [
    shape.selectMode ? 24 : 0,
    c.cover,
    null, // the title, flexible
    on("status", c.status),
    c.score,
    c.progress,
    on("volumes", c.volumes),
    on("repeat", c.repeat),
    on("dates", c.dates),
    on("tags", c.tags),
    c.actions,
  ]
    .map((px) => (px === null ? "minmax(0, 1fr)" : `${px}px`))
    .join(" ");
}

/** The widest tier whose tracks fit in `available` px, measured rather than taken from a viewport breakpoint. */
export function tierForWidth(available: number, manga: boolean): Tier {
  for (const tier of ["full", "mid"] as const) {
    if (available >= minRowWidth({ tier, selectMode: true, manga })) return tier;
  }
  return "compact";
}

/** Row height: the cover at 2:3 plus the vertical padding. */
export const ROW_HEIGHT_PX = Math.round(COLUMN_PX.cover * 1.5) + 16;
