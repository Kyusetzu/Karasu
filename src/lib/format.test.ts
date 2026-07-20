import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { formatLabel } from "./format";

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
