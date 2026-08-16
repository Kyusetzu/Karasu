import { describe, expect, it } from "vitest";
import { isNotFound, NOT_FOUND } from "./apiError";

describe("isNotFound", () => {
  it("recognises the sentinel the query functions throw", () => {
    expect(isNotFound(new Error(NOT_FOUND))).toBe(true);
    expect(isNotFound(NOT_FOUND)).toBe(true);
  });

  /** A 404 from AniList reaches the frontend as its own message, not ours. */
  it("recognises AniList's own wording", () => {
    expect(isNotFound(new Error("Not Found."))).toBe(true);
    expect(isNotFound(new Error("not found"))).toBe(true);
    expect(isNotFound("AniList error: Not Found.")).toBe(true);
  });

  /**
   * The whole point. Each of these used to render "No such user" — a definite
   * claim about someone else's account, made because the network was down.
   */
  it("does not mistake a failure to ask for an answer", () => {
    expect(isNotFound(new Error("Network error: connection refused"))).toBe(false);
    expect(isNotFound(new Error("Too Many Requests"))).toBe(false);
    expect(isNotFound(new Error("Token invalid or expired"))).toBe(false);
    expect(isNotFound(new Error("Update check failed: timed out"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});
