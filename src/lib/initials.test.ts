import { describe, expect, it } from "vitest";
import { initialFor } from "./initials";

describe("initialFor", () => {
  it("takes the first letter, uppercased", () => {
    expect(initialFor("kyu")).toBe("K");
    expect(initialFor("Chrona")).toBe("C");
  });

  it("ignores leading whitespace rather than rendering a blank disc", () => {
    expect(initialFor("  kyu")).toBe("K");
    expect(initialFor("\tkyu\n")).toBe("K");
  });

  it("falls back for a name with nothing in it", () => {
    expect(initialFor("")).toBe("?");
    expect(initialFor("   ")).toBe("?");
  });

  it("keeps a non-ASCII first character whole — AniList allows these names", () => {
    // Real accounts. Hiragana has no uppercase, so it passes through as-is.
    expect(initialFor("あいん")).toBe("あ");
    expect(initialFor("あおきり")).toBe("あ");
    expect(initialFor("Ωmega")).toBe("Ω");
  });

  it("returns one whole code point for an astral first character", () => {
    // The bug this function exists to not have: `"𝐊yu".slice(0, 1)` is a lone
    // high surrogate, which renders as a replacement glyph. Asserting the
    // length is the real check — a broken half is also a 1-unit string, so
    // comparing only the character would pass on the broken implementation.
    expect(initialFor("𝐊yu")).toBe("𝐊");
    expect([...initialFor("𝐊yu")]).toHaveLength(1);
    expect(initialFor("🍕place")).toBe("🍕");
    expect([...initialFor("🍕place")]).toHaveLength(1);
  });

  it("never returns a lone surrogate for any single-character input", () => {
    for (const cp of [0x41, 0x3a9, 0x3042, 0x1d40a, 0x1f355, 0x2f800]) {
      const out = initialFor(String.fromCodePoint(cp));
      expect(out.codePointAt(0)).not.toBeUndefined();
      // A lone surrogate lands in D800–DFFF; a real code point never does.
      expect(out.codePointAt(0)! >= 0xd800 && out.codePointAt(0)! <= 0xdfff).toBe(false);
    }
  });
});
