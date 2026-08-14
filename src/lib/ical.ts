/**
 * Minimal RFC 5545 assembly for the airing-week export.
 *
 * Only what a VEVENT needs: UTC timestamps, text escaping, and the 75-octet
 * line fold. `now` is a parameter rather than `Date.now()` so the output is
 * a pure function of its inputs and the tests can pin exact bytes.
 */

export interface IcsEvent {
  /** Stable per airing, so re-imports update instead of duplicating. */
  uid: string;
  /** Unix seconds. */
  start: number;
  durationMin: number;
  summary: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `20260814T173000Z` — the UTC form, so calendar apps do the zone math. */
export function icsTimestamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Backslash, semicolon, comma and newlines are structural in ICS text. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: content lines fold at 75 octets, continuation lines start
 * with one space. Folded at characters rather than octets — a multi-byte
 * title folds a little early, which the spec permits; folding late would
 * not be.
 */
export function foldIcsLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) {
    parts.push(" " + line.slice(i, i + 73));
  }
  return parts.join("\r\n");
}

export function buildIcs(events: IcsEvent[], now: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Karasu//Airing//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${icsTimestamp(now)}`,
      `DTSTART:${icsTimestamp(e.start)}`,
      `DURATION:PT${Math.max(1, Math.round(e.durationMin))}M`,
      foldIcsLine(`SUMMARY:${escapeIcsText(e.summary)}`),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  // CRLF line endings are part of the format, not a Windows nicety.
  return lines.join("\r\n") + "\r\n";
}
