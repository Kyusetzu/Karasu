import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  countdown,
  formatLabel,
  fuzzyDate,
  mediaStatusLabel,
  sourceLabel,
} from "./format";

// Echoing stub: returns the i18n key so we can assert the lookup path.
const t = ((key: string) => key) as unknown as TFunction;

describe("formatLabel", () => {
  it("looks up known formats by i18n key", () => {
    expect(formatLabel("TV_SHORT", t)).toBe("format.TV_SHORT");
    expect(formatLabel("MOVIE", t)).toBe("format.MOVIE");
  });

  it("title-cases unknown formats as a fallback", () => {
    expect(formatLabel("SOME_NEW_FORMAT", t)).toBe("Some New Format");
  });

  it("returns empty for null/undefined/empty", () => {
    expect(formatLabel(null, t)).toBe("");
    expect(formatLabel(undefined, t)).toBe("");
    expect(formatLabel("", t)).toBe("");
  });
});

describe("mediaStatusLabel", () => {
  it("looks up known media statuses by i18n key", () => {
    expect(mediaStatusLabel("RELEASING", t)).toBe("mediaStatus.RELEASING");
    expect(mediaStatusLabel("NOT_YET_RELEASED", t)).toBe(
      "mediaStatus.NOT_YET_RELEASED",
    );
  });

  it("title-cases unknown statuses", () => {
    expect(mediaStatusLabel("SOMETHING_ELSE", t)).toBe("Something Else");
  });

  it("returns empty for null", () => {
    expect(mediaStatusLabel(null, t)).toBe("");
  });
});

describe("sourceLabel", () => {
  it("looks up known sources by i18n key", () => {
    expect(sourceLabel("LIGHT_NOVEL", t)).toBe("source.LIGHT_NOVEL");
  });

  it("title-cases unknown sources", () => {
    expect(sourceLabel("BRAND_NEW_SOURCE", t)).toBe("Brand New Source");
  });
});

describe("fuzzyDate", () => {
  it("renders a full date", () => {
    expect(fuzzyDate({ year: 2026, month: 4, day: 4 }, "en-US")).toBe(
      "Apr 4, 2026",
    );
  });

  it("omits the day when it is unknown", () => {
    expect(fuzzyDate({ year: 2026, month: 4, day: null }, "en-US")).toBe(
      "Apr 2026",
    );
  });

  it("falls back to the year alone, and to empty without one", () => {
    expect(fuzzyDate({ year: 2026, month: null, day: null }, "en-US")).toBe(
      "2026",
    );
    expect(fuzzyDate({ year: null, month: null, day: null }, "en-US")).toBe("");
    expect(fuzzyDate(null, "en-US")).toBe("");
  });
});

describe("countdown", () => {
  it("uses at most two units, largest first", () => {
    expect(countdown(2 * 86400 + 4 * 3600, t)).toBe("detail.countdownDh");
    expect(countdown(4 * 3600 + 30 * 60, t)).toBe("detail.countdownHm");
    expect(countdown(35 * 60, t)).toBe("detail.countdownM");
  });

  it("returns empty once the episode has aired", () => {
    expect(countdown(0, t)).toBe("");
    expect(countdown(-60, t)).toBe("");
  });
});
