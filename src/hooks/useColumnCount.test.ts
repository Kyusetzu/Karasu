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
    // A display:none or detached element computes to the specified value, which has two space-separated parts.
    expect(parseColumnCount("repeat(auto-fill, minmax(9.375rem, 1fr))")).toBe(1);
    expect(parseColumnCount("none")).toBe(1);
    expect(parseColumnCount("")).toBe(1);
  });

  /** An unset `--cover-cols` computes the property to `none`, which must read as one column rather than throw. */
  it("survives the unset-token case that would collapse the grid", () => {
    expect(parseColumnCount("none")).toBe(1);
    expect(parseColumnCount("repeat(auto-fill, )")).toBe(1);
  });

  /** The covers-per-row setting resolves to that many equal used tracks. */
  it("counts the tracks the column setting actually produces", () => {
    expect(parseColumnCount("171.5px 171.5px")).toBe(2);
    expect(parseColumnCount("109px 109px 109px")).toBe(3);
    expect(parseColumnCount("120px 120px 120px 120px 120px 120px 120px 120px")).toBe(8);
  });

  it("falls back rather than guessing at units it cannot resolve", () => {
    expect(parseColumnCount("1fr 1fr")).toBe(1);
    expect(parseColumnCount("min-content max-content")).toBe(1);
  });
});
