import { describe, expect, it } from "vitest";
import {
  charsLeft,
  POST_MAX,
  REVIEW_BODY_MIN,
  REVIEW_SUMMARY_MIN,
  TITLE_MAX,
  validatePost,
  validateReview,
  validateThread,
} from "./composer";

describe("validateReview", () => {
  const summary = "A perfectly serviceable twenty-plus character summary.";
  const body = "x".repeat(REVIEW_BODY_MIN);

  it("accepts a review meeting AniList's own bounds", () => {
    expect(validateReview(summary, body, 85)).toMatchObject({ ok: true });
  });

  it("rejects a summary below AniList's floor", () => {
    expect(validateReview("Too short.", body, 85)).toMatchObject({
      ok: false,
      reason: "summaryTooShort",
    });
    expect("Too short.".length).toBeLessThan(REVIEW_SUMMARY_MIN);
  });

  it("rejects a body below the 2200-character floor", () => {
    expect(validateReview(summary, "brilliant show", 85)).toMatchObject({
      ok: false,
      reason: "bodyTooShort",
    });
  });

  it("rejects a score outside 0-100 or fractional", () => {
    for (const score of [-1, 101, 8.5]) {
      expect(validateReview(summary, body, score)).toMatchObject({
        ok: false,
        reason: "scoreOut",
      });
    }
  });

  it("normalizes whitespace before measuring", () => {
    const padded = `  ${summary}  `;
    expect(validateReview(padded, body, 50).summary).toBe(summary);
  });
});

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

describe("validateThread", () => {
  it("accepts a titled, bodied, categorised thread", () => {
    expect(validateThread("  Weekly chapter talk ", "Body text", [7])).toEqual({
      ok: true,
      title: "Weekly chapter talk",
      body: "Body text",
    });
  });

  it("rejects each missing piece with its own reason", () => {
    expect(validateThread("", "body", [7])).toMatchObject({ ok: false, reason: "titleEmpty" });
    expect(validateThread("   ", "body", [7])).toMatchObject({ ok: false, reason: "titleEmpty" });
    expect(validateThread("title", "", [7])).toMatchObject({ ok: false, reason: "empty" });
    expect(validateThread("title", "body", [])).toMatchObject({ ok: false, reason: "noCategory" });
  });

  it("bounds the title the way POST_MAX bounds the body", () => {
    expect(validateThread("x".repeat(TITLE_MAX), "body", [7])).toMatchObject({ ok: true });
    expect(validateThread("x".repeat(TITLE_MAX + 1), "body", [7])).toMatchObject({
      ok: false,
      reason: "titleTooLong",
    });
  });

  it("flattens whitespace inside a title, since the forum renders it on one line", () => {
    expect(validateThread("a\n  b\t c", "body", [7]).title).toBe("a b c");
  });

  it("reuses the body rules, blank-line collapse included", () => {
    expect(validateThread("t", "one\n\n\n\n\ntwo", [7]).body).toBe("one\n\ntwo");
    expect(validateThread("t", "x".repeat(POST_MAX + 1), [7])).toMatchObject({
      ok: false,
      reason: "tooLong",
    });
  });

  it("checks in the order a user fills the form: title, body, category", () => {
    // All three wrong → the first thing to fix is reported, not an arbitrary one.
    expect(validateThread("", "", []).reason).toBe("titleEmpty");
    expect(validateThread("t", "", []).reason).toBe("empty");
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
