/** Which shape the calendar draws the week in, remembered in localStorage because it is chrome, not account data. */

export type CalendarView = "week" | "tiles" | "agenda";

const KEY = "karasu-calendar-view";

/** The week grid, the shape the calendar always had; the other two are the choices. */
export const DEFAULT_CALENDAR_VIEW: CalendarView = "week";

/** Seven columns of the compact card need this many CSS pixels; narrower, the grid would scroll sideways. */
export const WEEK_MIN_WIDTH = 980;

export function isCalendarView(value: unknown): value is CalendarView {
  return value === "week" || value === "tiles" || value === "agenda";
}

export function loadCalendarView(): CalendarView {
  try {
    const raw = localStorage.getItem(KEY);
    return isCalendarView(raw) ? raw : DEFAULT_CALENDAR_VIEW;
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return DEFAULT_CALENDAR_VIEW;
  }
}

export function saveCalendarView(view: CalendarView): void {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // The view still switched for this session; failing over a storage quota would be worse.
  }
}

/** The week grid is offered only where it fits; on a phone or a narrow container the choice is tiles or agenda. */
export function weekFits(containerWidth: number, phone: boolean): boolean {
  return !phone && containerWidth >= WEEK_MIN_WIDTH;
}

/** The view actually drawn: a chosen week grid that does not fit falls back to the agenda, the nearest in density. */
export function effectiveView(chosen: CalendarView, containerWidth: number, phone: boolean): CalendarView {
  if (chosen === "week" && !weekFits(containerWidth, phone)) return "agenda";
  return chosen;
}
