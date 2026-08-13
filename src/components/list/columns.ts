/**
 * The list view's column widths, in one place.
 *
 * `VirtualGrid` gives every visual row its own grid container, so `subgrid` is
 * unavailable and a `1fr`/`auto` track would resolve to a different width in
 * each row — the columns would not line up down the page, which is the whole
 * point of a table. The tracks therefore have to be **fixed**, and a fixed width
 * is only safe if someone has checked it against the widest thing that can land
 * in it. That check is `columns.test.ts`, and it is why this is a module rather
 * than a `grid-cols-[…]` string inlined at two call sites.
 *
 * The failure this replaces: the row was a flex box of `w-*` children, and
 * `w-13` on the score cell left about 22px of usable box after padding and the
 * native select's arrow. `★ 10` needs about 26px, so every double-digit score
 * was clipped — and `w-18` on progress had the same fault, unreported, for
 * anything like `500 / 500`.
 *
 * A fixed track also does not shrink: it overflows. The full column set is
 * ~1100px wide and the window can be 940px, so the set itself has to change with
 * the available width — hence `Tier`. Anything a narrower tier drops is not lost,
 * it moves into the secondary line under the title, which is prose and wraps.
 */

/** Rough advance width of one `text-xs`/`text-sm` tabular digit, in px. */
const DIGIT_PX = 7.2;
/** What a native `<select>` reserves for its arrow inside the content box. */
const SELECT_ARROW_PX = 20;
/** Horizontal padding inside a cell control (`px-2` both sides). */
const CELL_PADDING_PX = 16;
/**
 * Deliberate headroom, and not optional.
 *
 * `DIGIT_PX` is an estimate of one glyph's advance, and the real figure depends
 * on the font WebView2 resolves, the user's Windows text-scale setting and
 * whichever locale-specific separator ends up in the string. Sizing a cell to
 * *exactly* the estimate is how the old score cell came to be 52px — a width
 * that was arithmetically fine and clipped in practice. A cell a few pixels
 * wider than needed costs nothing; a cell a few pixels short truncates a number,
 * and there is no ellipsis inside a `<select>` to even hint at it.
 */
const SAFETY_PX = 6;

/** The narrowest the flexible title track is allowed to become. */
export const TITLE_MIN_PX = 180;

/**
 * Width for a cell that holds `chars` characters of tabular text.
 *
 * `control` adds the room a native select loses to its arrow. Rounded up to the
 * nearest 4px so the values stay on the spacing scale.
 */
export function cellWidth(chars: number, control = false): number {
  const content =
    chars * DIGIT_PX +
    CELL_PADDING_PX +
    SAFETY_PX +
    (control ? SELECT_ARROW_PX : 0);
  return Math.ceil(content / 4) * 4;
}

/**
 * The widest string each numeric column must hold without clipping.
 *
 * These are the real worst cases, not guesses: a ten is the only two-digit
 * score, and `1100 / 1100` is One Piece — the series that made the old progress
 * cell clip. Kept here so the test and the widths cannot drift apart.
 */
export const WORST_CASE = {
  /** No star in the closed display — see `SCORE_SHOWS_STAR`. The widest any
      format renders: `10.0` (POINT_10_DECIMAL) beats `100` by a character. */
  score: "10.0",
  progress: "1100 / 1100",
  volumes: "108 / 108",
  repeat: "×12",
} as const;

/**
 * The closed score control shows the number alone.
 *
 * The `★ ` prefix cost more width than the digit it decorated — dropping it from
 * the *selected* display buys back more than widening the cell would, and the
 * options still carry the star, where there is room for it.
 */
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

/**
 * How much of the table fits.
 *
 * `full` is the detail view as designed. `mid` gives up the three columns that
 * are read far more often than they are edited. `compact` additionally gives up
 * status and volumes, which is the point at which this stops being a table and
 * becomes a list with two editable numbers — still more than the old row showed.
 */
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

/**
 * `grid-template-columns` for one row, and for the header above it.
 *
 * The title track is the only flexible one: it takes the slack, and
 * `minmax(0, 1fr)` rather than `1fr` so a long title truncates instead of
 * pushing every column to the right (a `1fr` track's minimum is `auto`, which is
 * the content — the classic overflow this avoids).
 *
 * Dropped columns become `0px` tracks rather than disappearing, so the track
 * *count* never changes: the header and the rows stay aligned through a tier
 * change, and entering select mode does not shift every column sideways.
 */
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

/**
 * The widest tier whose tracks fit in `available` px.
 *
 * Measured rather than guessed from a viewport breakpoint, because the space a
 * row actually gets depends on the sidebar and the page padding as well as the
 * window. Falls back to `compact`, which overflows only below ~580px — narrower
 * than the window is allowed to be.
 */
export function tierForWidth(available: number, manga: boolean): Tier {
  for (const tier of ["full", "mid"] as const) {
    if (available >= minRowWidth({ tier, selectMode: true, manga })) return tier;
  }
  return "compact";
}

/** Row height: the cover at 2:3 plus the vertical padding. */
export const ROW_HEIGHT_PX = Math.round(COLUMN_PX.cover * 1.5) + 16;
