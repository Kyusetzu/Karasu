import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine, icsTimestamp } from "./ical";

describe("icsTimestamp", () => {
  it("renders unix seconds as compact UTC", () => {
    expect(icsTimestamp(0)).toBe("19700101T000000Z");
    // 2026-08-14 17:30:00 UTC.
    expect(icsTimestamp(1786728600)).toBe("20260814T173000Z");
  });
});

describe("escapeIcsText", () => {
  it("escapes the four structural characters", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("leaves ordinary titles alone", () => {
    expect(escapeIcsText("Sousou no Frieren — Ep 8")).toBe("Sousou no Frieren — Ep 8");
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds long lines at 75 octets with a leading space", () => {
    const long = "SUMMARY:" + "x".repeat(200);
    const folded = foldIcsLine(long);
    for (const [i, part] of folded.split("\r\n").entries()) {
      expect(part.length).toBeLessThanOrEqual(74);
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
    }
    // Unfolding restores the original.
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
});

describe("buildIcs", () => {
  const event = {
    uid: "karasu-1-ep8@karasu",
    start: 1786728600,
    durationMin: 25,
    summary: "Frieren — Ep 8",
  };

  it("wraps events in a valid calendar with CRLF endings", () => {
    const ics = buildIcs([event], 1786700000);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:karasu-1-ep8@karasu");
    expect(ics).toContain("DTSTART:20260814T173000Z");
    expect(ics).toContain("DURATION:PT25M");
    expect(ics).not.toContain("\n\n"); // every line CRLF-delimited
  });

  it("is a pure function of its inputs — same bytes for same args", () => {
    expect(buildIcs([event], 1)).toBe(buildIcs([event], 1));
  });

  it("floors the duration at one minute", () => {
    expect(buildIcs([{ ...event, durationMin: 0 }], 1)).toContain("DURATION:PT1M");
  });
});
