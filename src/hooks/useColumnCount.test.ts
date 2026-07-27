import { describe, expect, it } from "vitest";
import { parseColumnCount } from "./useColumnCount";

describe("parseColumnCount", () => {
  it("counts a resolved pixel track list", () => {
    expect(parseColumnCount("150px")).toBe(1);
    expect(parseColumnCount("150px 150px 150px")).toBe(3);
    expect(parseColumnCount("187.5px 187.5px")).toBe(2);
  });

  it("tolerates the whitespace a computed value may carry", () => {
    expect(parseColumnCount("  150px   150px  ")).toBe(2);
  });

  it("falls back to one column when the grid is not laid out", () => {
    // What getComputedStyle returns for a display:none or detached element:
    // the specified value, which happens to contain two space-separated parts.
    expect(parseColumnCount("repeat(auto-fill, minmax(9.375rem, 1fr))")).toBe(1);
    expect(parseColumnCount("none")).toBe(1);
    expect(parseColumnCount("")).toBe(1);
  });

  it("falls back rather than guessing at units it cannot resolve", () => {
    expect(parseColumnCount("1fr 1fr")).toBe(1);
    expect(parseColumnCount("min-content max-content")).toBe(1);
  });
});
