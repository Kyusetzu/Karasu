import { describe, expect, it } from "vitest";
import {
  cycle,
  encode,
  EMPTY,
  isEmpty,
  summarize,
  toQueryArgs,
  triOf,
  type MultiValue,
} from "./multiFilter";

describe("cycle", () => {
  it("advances off → include → exclude → off", () => {
    let v = EMPTY;
    expect(triOf(v, "Action")).toBe("off");
    v = cycle(v, "Action");
    expect(triOf(v, "Action")).toBe("include");
    v = cycle(v, "Action");
    expect(triOf(v, "Action")).toBe("exclude");
    v = cycle(v, "Action");
    expect(triOf(v, "Action")).toBe("off");
    expect(isEmpty(v)).toBe(true);
  });

  /** One control rather than two lists, because cycling makes "required and forbidden" unrepresentable. */
  it("never leaves an option on both sides", () => {
    let v = cycle(cycle(EMPTY, "Action"), "Action"); // now excluded
    expect(v.include).not.toContain("Action");
    expect(v.exclude).toContain("Action");
    v = cycle(v, "Action"); // back to off
    v = cycle(v, "Action"); // included again
    expect(v.exclude).not.toContain("Action");
  });

  it("leaves the other options where they were", () => {
    const v = cycle(cycle(cycle(EMPTY, "Action"), "Drama"), "Drama");
    expect(v.include).toEqual(["Action"]);
    expect(v.exclude).toEqual(["Drama"]);
  });
});

describe("encode", () => {
  /** This string is the query cache key; unsorted, a different pick order mints a second entry for the same request. */
  it("is stable whatever order the user picked in", () => {
    const a = cycle(cycle(EMPTY, "Action"), "Drama");
    const b = cycle(cycle(EMPTY, "Drama"), "Action");
    expect(encode(a)).toBe(encode(b));
  });

  it("distinguishes an inclusion from an exclusion", () => {
    const included = cycle(EMPTY, "Ecchi");
    const excluded = cycle(included, "Ecchi");
    expect(encode(included)).toBe("Ecchi");
    expect(encode(excluded)).toBe("-Ecchi");
    expect(encode(included)).not.toBe(encode(excluded));
  });

  it("is empty for an untouched filter", () => {
    expect(encode(EMPTY)).toBe("");
  });
});

describe("summarize", () => {
  it("says nothing when nothing is chosen", () => {
    expect(summarize(EMPTY)).toBeNull();
  });

  it("names the first choice and counts the rest", () => {
    const v = cycle(cycle(cycle(EMPTY, "Action"), "Drama"), "Comedy");
    expect(summarize(v)).toEqual({ first: "Action", extra: 2 });
  });

  /** An exclusion-only filter still has something to say. */
  it("marks an exclusion so the closed control does not read as an include", () => {
    const v = cycle(cycle(EMPTY, "Ecchi"), "Ecchi");
    expect(summarize(v)).toEqual({ first: "−Ecchi", extra: 0 });
  });
});

describe("toQueryArgs", () => {
  /** `undefined`, never `[]`: an absent GraphQL argument is no filter, an empty list matches nothing. */
  it("omits an empty side rather than sending an empty list", () => {
    expect(toQueryArgs(EMPTY)).toEqual({ in: undefined, notIn: undefined });

    const onlyExcluded: MultiValue = { include: [], exclude: ["Ecchi"] };
    expect(toQueryArgs(onlyExcluded)).toEqual({ in: undefined, notIn: ["Ecchi"] });
  });

  it("passes both sides when both are set", () => {
    const v: MultiValue = { include: ["Action"], exclude: ["Ecchi"] };
    expect(toQueryArgs(v)).toEqual({ in: ["Action"], notIn: ["Ecchi"] });
  });
});
