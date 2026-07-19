import { describe, expect, it } from "vitest";
import {
  collectTags,
  normalizeTags,
  parseNotes,
  serializeNotes,
  tagsOf,
} from "./tags";

describe("parseNotes", () => {
  it("returns notes verbatim and no tags when there is no block", () => {
    expect(parseNotes("just some prose")).toEqual({
      notes: "just some prose",
      tags: [],
    });
  });

  it("handles null/undefined", () => {
    expect(parseNotes(null)).toEqual({ notes: "", tags: [] });
    expect(parseNotes(undefined)).toEqual({ notes: "", tags: [] });
  });

  it("splits user notes from a well-formed block", () => {
    const raw = "loved it\n\n[[karasu:tags]]shounen, favorite[[/karasu:tags]]";
    expect(parseNotes(raw)).toEqual({
      notes: "loved it",
      tags: ["shounen", "favorite"],
    });
  });

  it("parses a block with no surrounding notes", () => {
    expect(parseNotes("[[karasu:tags]]a, b[[/karasu:tags]]")).toEqual({
      notes: "",
      tags: ["a", "b"],
    });
  });

  it("preserves raw notes when only an opening token is present (malformed)", () => {
    const raw = "note [[karasu:tags]]a, b";
    expect(parseNotes(raw)).toEqual({ notes: raw, tags: [] });
  });

  it("treats an empty block as no tags and preserves the raw string", () => {
    const raw = "keep me\n\n[[karasu:tags]]  ,  [[/karasu:tags]]";
    expect(parseNotes(raw)).toEqual({ notes: raw, tags: [] });
  });

  it("honours only the first block and leaves trailing junk in notes", () => {
    const raw =
      "n\n\n[[karasu:tags]]a[[/karasu:tags]] tail [[karasu:tags]]b[[/karasu:tags]]";
    const out = parseNotes(raw);
    expect(out.tags).toEqual(["a"]);
    expect(out.notes).toContain("tail");
    expect(out.notes).toContain("[[karasu:tags]]b");
  });

  it("trims, dedupes case-insensitively and drops empties", () => {
    expect(tagsOf("[[karasu:tags]] A , a ,, B ,b [[/karasu:tags]]")).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("normalizeTags", () => {
  it("caps the number of tags", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(20);
  });

  it("truncates over-long tags", () => {
    const long = "x".repeat(50);
    expect(normalizeTags([long])[0]).toHaveLength(30);
  });
});

describe("serializeNotes", () => {
  it("appends a single block after the notes", () => {
    expect(serializeNotes("hi", ["a", "b"])).toBe(
      "hi\n\n[[karasu:tags]]a, b[[/karasu:tags]]",
    );
  });

  it("returns block-only when there are no notes", () => {
    expect(serializeNotes("", ["a"])).toBe("[[karasu:tags]]a[[/karasu:tags]]");
  });

  it("returns plain notes when there are no tags", () => {
    expect(serializeNotes("hi", [])).toBe("hi");
    expect(serializeNotes("", [])).toBe("");
  });

  it("never accumulates blocks across round-trips", () => {
    const first = serializeNotes("hi", ["a"]);
    const { notes, tags } = parseNotes(first);
    const second = serializeNotes(notes, [...tags, "b"]);
    expect(second).toBe("hi\n\n[[karasu:tags]]a, b[[/karasu:tags]]");
    // even if the raw (block-bearing) string is fed back in by mistake
    expect(serializeNotes(first, ["c"])).toBe(
      "hi\n\n[[karasu:tags]]c[[/karasu:tags]]",
    );
  });
});

describe("collectTags", () => {
  it("returns the sorted union across entries", () => {
    const notes = [
      "[[karasu:tags]]zeta, alpha[[/karasu:tags]]",
      "prose",
      "[[karasu:tags]]Alpha, beta[[/karasu:tags]]",
      null,
    ];
    expect(collectTags(notes)).toEqual(["alpha", "beta", "zeta"]);
  });
});
