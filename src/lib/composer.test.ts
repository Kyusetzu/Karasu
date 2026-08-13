import { describe, expect, it } from "vitest";
import { charsLeft, POST_MAX, validatePost } from "./composer";

describe("validatePost", () => {
  it("accepts ordinary text and hands back the trimmed form", () => {
    expect(validatePost("  back after three months  ")).toEqual({
      ok: true,
      text: "back after three months",
    });
  });

  it("rejects anything with no content", () => {
    for (const raw of ["", "   ", "\n\n", "\t \n "]) {
      expect(validatePost(raw), JSON.stringify(raw)).toMatchObject({
        ok: false,
        reason: "empty",
      });
    }
  });

  it("collapses runs of blank lines, since a newline is a visible break", () => {
    // AniList renders single newlines as `<br>`, so five blank lines is five
    // blank lines in the feed.
    expect(validatePost("one\n\n\n\n\ntwo").text).toBe("one\n\ntwo");
    // Two is deliberate and preserved — that is a paragraph break.
    expect(validatePost("one\n\ntwo").text).toBe("one\n\ntwo");
    expect(validatePost("one\ntwo").text).toBe("one\ntwo");
  });

  it("rejects past the maximum", () => {
    expect(validatePost("x".repeat(POST_MAX))).toMatchObject({ ok: true });
    expect(validatePost("x".repeat(POST_MAX + 1))).toMatchObject({
      ok: false,
      reason: "tooLong",
    });
  });

  it("measures the trimmed text, so trailing space cannot tip it over", () => {
    expect(validatePost(`${"x".repeat(POST_MAX)}     `)).toMatchObject({ ok: true });
  });

  it("returns only reasons from the closed union", () => {
    const allowed = new Set(["empty", "tooLong", undefined]);
    for (const raw of ["", "ok", "y".repeat(POST_MAX + 5)]) {
      expect(allowed.has(validatePost(raw).reason)).toBe(true);
    }
  });
});

describe("charsLeft", () => {
  it("counts down from the maximum", () => {
    expect(charsLeft("")).toBe(POST_MAX);
    expect(charsLeft("abc")).toBe(POST_MAX - 3);
  });

  it("goes negative past the limit, so the caller need not compare twice", () => {
    expect(charsLeft("x".repeat(POST_MAX + 10))).toBe(-10);
  });

  it("ignores surrounding whitespace, matching validatePost", () => {
    expect(charsLeft("  abc  ")).toBe(POST_MAX - 3);
  });
});
