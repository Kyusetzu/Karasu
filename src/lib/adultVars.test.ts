import { describe, expect, it } from "vitest";
import { adultQueryArg, adultVars } from "@/lib/contentFilter";

/**
 * Regression guard for the bug that emptied Seasonal and Search whenever the
 * content filter was set to Off.
 *
 * AniList matches `isAdult: null` against media whose `isAdult` is null, and
 * the field is never null — so a null argument returns **zero results** rather
 * than meaning "no constraint". Verified live: `{season: SUMMER, year: 2026}`
 * returns 50 with the key omitted and 0 with `isAdult: null`.
 *
 * The key must therefore be *absent*, which `"isAdult" in vars` is what pins
 * here — `toEqual({})` alone would also pass for `{ isAdult: undefined }`,
 * and that serializes to null in the request body.
 */
describe("adultVars", () => {
  it("omits the key entirely when unfiltered", () => {
    const vars = adultVars(undefined);
    expect("isAdult" in vars).toBe(false);
    expect(JSON.stringify(vars)).toBe("{}");
  });

  it("passes the constraint through when filtering", () => {
    expect(adultVars(false)).toEqual({ isAdult: false });
    expect(adultVars(true)).toEqual({ isAdult: true });
  });

  it("survives a JSON round-trip without reintroducing null", () => {
    // The failure mode was structural, not logical: `isAdult: undefined`
    // looks absent in a debugger but becomes null on the wire.
    const body = JSON.stringify({ season: "SUMMER", ...adultVars(undefined) });
    expect(body).not.toContain("isAdult");
  });

  it("keeps every content-filter level sending a usable argument", () => {
    for (const level of ["off", "moderate", "strict"] as const) {
      const vars = adultVars(adultQueryArg(level));
      expect(vars.isAdult).not.toBeNull();
      if (level === "off") expect("isAdult" in vars).toBe(false);
      else expect(vars.isAdult).toBe(false);
    }
  });
});
