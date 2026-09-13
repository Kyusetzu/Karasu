import { describe, expect, it } from "vitest";
import { STATUS_ORDER } from "@/api/types";
import {
  DEFAULT_STATUS_COLORS,
  STATUS_COLOR_ORDER,
  isDefaultPalette,
  isStatusHex,
  normalizeStatusColors,
  statusColorVar,
  statusVar,
} from "./statusColors";

describe("the palette covers the union", () => {
  /** A status with no colour paints an invisible ring, so this fails the moment AniList's union grows. */
  it("has a colour for every status the app knows", () => {
    for (const s of STATUS_ORDER) {
      expect(DEFAULT_STATUS_COLORS[s]).toBeDefined();
      expect(isStatusHex(DEFAULT_STATUS_COLORS[s])).toBe(true);
    }
    expect([...STATUS_COLOR_ORDER].sort()).toEqual([...STATUS_ORDER].sort());
  });

  /** Two identical defaults would be a design bug nobody would think to look for. */
  it("ships six distinct defaults", () => {
    const seen = new Set(Object.values(DEFAULT_STATUS_COLORS).map((c) => c.toLowerCase()));
    expect(seen.size).toBe(STATUS_COLOR_ORDER.length);
  });
});

describe("normalizeStatusColors", () => {
  it("passes a valid stored palette through", () => {
    const stored = { ...DEFAULT_STATUS_COLORS, CURRENT: "#123456" };
    expect(normalizeStatusColors(stored).CURRENT).toBe("#123456");
  });

  /** Repair is per key, so one corrupted localStorage entry costs that colour and not the five beside it. */
  it("repairs only what is broken", () => {
    const got = normalizeStatusColors({
      CURRENT: "#abcdef",
      COMPLETED: "not a colour",
      PAUSED: 42,
      DROPPED: null,
    });
    expect(got.CURRENT).toBe("#abcdef");
    expect(got.COMPLETED).toBe(DEFAULT_STATUS_COLORS.COMPLETED);
    expect(got.PAUSED).toBe(DEFAULT_STATUS_COLORS.PAUSED);
    expect(got.DROPPED).toBe(DEFAULT_STATUS_COLORS.DROPPED);
    expect(got.PLANNING).toBe(DEFAULT_STATUS_COLORS.PLANNING);
  });

  it("survives anything at all", () => {
    for (const junk of [null, undefined, "", 0, [], "nonsense"]) {
      expect(normalizeStatusColors(junk)).toEqual(DEFAULT_STATUS_COLORS);
    }
  });

  /** A status AniList retires must not linger, or it is written to CSS and read by nothing. */
  it("drops keys that are not statuses", () => {
    const got = normalizeStatusColors({ ...DEFAULT_STATUS_COLORS, WATCHING: "#ffffff" });
    expect(Object.keys(got).sort()).toEqual([...STATUS_COLOR_ORDER].sort());
  });

  /** `ColorPicker` only emits six digits, so accepting `#abc` here would round-trip to something else. */
  it("rejects shorthand hex", () => {
    expect(isStatusHex("#abc")).toBe(false);
    expect(isStatusHex("#AABBCC")).toBe(true);
  });
});

describe("isDefaultPalette", () => {
  it("recognises the shipped palette regardless of case", () => {
    expect(isDefaultPalette(DEFAULT_STATUS_COLORS)).toBe(true);
    const upper = normalizeStatusColors(
      Object.fromEntries(
        Object.entries(DEFAULT_STATUS_COLORS).map(([k, v]) => [k, v.toUpperCase()]),
      ),
    );
    expect(isDefaultPalette(upper)).toBe(true);
  });

  it("notices a single change", () => {
    expect(isDefaultPalette({ ...DEFAULT_STATUS_COLORS, PAUSED: "#000000" })).toBe(false);
  });
});

describe("statusColorVar", () => {
  it("points at the variable the theme writes", () => {
    expect(statusVar("CURRENT")).toBe("--color-status-current");
    expect(statusColorVar("COMPLETED")).toBe("var(--color-status-completed)");
  });

  /** Not-on-list stays a fixed token so a user picking two similar hues cannot make it look like Planning. */
  it("gives not-on-list its own colour", () => {
    expect(statusColorVar(null)).toBe("var(--color-graph-none)");
    expect(statusColorVar(null)).not.toBe(statusColorVar("PLANNING"));
  });
});
