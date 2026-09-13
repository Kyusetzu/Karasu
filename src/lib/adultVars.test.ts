import { describe, expect, it } from "vitest";
import { adultQueryArg, adultVars } from "@/lib/contentFilter";

/** AniList matches `isAdult: null` against nothing, so the key must be absent, not undefined, or the page is empty. */
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
    // `isAdult: undefined` looks absent in a debugger but becomes null on the wire.
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
