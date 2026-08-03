import { describe, expect, it } from "vitest";
import { headline, inverse, type EntrySnapshot } from "./receipt";

const before: EntrySnapshot = {
  status: "CURRENT",
  progress: 13,
  progressVolumes: 1,
  score: 8,
  repeat: 0,
  notes: null,
};

describe("inverse", () => {
  it("mentions only the fields the save actually changed", () => {
    expect(inverse({ mediaId: 1, progress: 14 }, before)).toEqual({
      mediaId: 1,
      progress: 13,
    });
  });

  it("carries several fields when several changed", () => {
    expect(
      inverse({ mediaId: 1, progress: 24, status: "COMPLETED" }, before),
    ).toEqual({ mediaId: 1, progress: 13, status: "CURRENT" });
  });

  it("ignores fields that were sent but did not change", () => {
    // The editor sends every field on every save, so this is the common case.
    const undo = inverse(
      { mediaId: 1, status: "CURRENT", progress: 14, score: 8, repeat: 0 },
      before,
    );
    expect(undo).toEqual({ mediaId: 1, progress: 13 });
  });

  it("is null for a save that changed nothing", () => {
    expect(
      inverse({ mediaId: 1, status: "CURRENT", progress: 13 }, before),
    ).toBeNull();
  });

  it("restores a note that a save cleared", () => {
    expect(
      inverse({ mediaId: 1, notes: "" }, { ...before, notes: "rewatch w/ Ken" }),
    ).toEqual({ mediaId: 1, notes: "rewatch w/ Ken" });
  });

  it("clears a note that had none, rather than skipping it", () => {
    // An entry with no note reads back as `null`, but the mutation only takes
    // a string — so undoing "added a note" has to send the empty string.
    expect(inverse({ mediaId: 1, notes: "oops" }, before)).toEqual({
      mediaId: 1,
      notes: "",
    });
  });

  it("ignores a field the save never mentioned", () => {
    expect(inverse({ mediaId: 1, notes: undefined }, before)).toBeNull();
  });

  it("undoes a change to zero, which is falsy but real", () => {
    expect(inverse({ mediaId: 1, score: 0 }, before)).toEqual({
      mediaId: 1,
      score: 8,
    });
  });

  it("round-trips: applying the inverse restores the original", () => {
    const input = { mediaId: 1, progress: 14, score: 9 };
    const after = { ...before, ...input };
    const undo = inverse(input, before)!;
    expect({ ...after, ...undo }).toMatchObject(before);
  });
});

describe("inverse: volumes", () => {
  it("undoes a volume bump without touching chapters", () => {
    expect(inverse({ mediaId: 1, progressVolumes: 2 }, before)).toEqual({
      mediaId: 1,
      progressVolumes: 1,
    });
  });

  it("keeps the two axes separate when both move", () => {
    expect(
      inverse({ mediaId: 1, progress: 20, progressVolumes: 2 }, before),
    ).toEqual({ mediaId: 1, progress: 13, progressVolumes: 1 });
  });
});

describe("headline", () => {
  it("prefers progress, which is most writes", () => {
    expect(
      headline({ mediaId: 1, progress: 14, score: 9 }, before),
    ).toEqual({ field: "progress", value: 14 });
  });

  it("falls through to status when progress is unchanged", () => {
    expect(
      headline({ mediaId: 1, progress: 13, status: "PAUSED" }, before),
    ).toEqual({ field: "status", value: "PAUSED" });
  });

  it("is null when nothing changed", () => {
    expect(headline({ mediaId: 1, progress: 13 }, before)).toBeNull();
  });
});
