import { describe, expect, it } from "vitest";
import { isNotFound, isOffline, NOT_FOUND } from "./apiError";

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

describe("isOffline", () => {
  it("matches what the Rust client renders for a transport failure", () => {
    expect(
      isOffline("Network error: error sending request for url (https://graphql.anilist.co/)"),
    ).toBe(true);
    expect(isOffline(new Error("Network error: timed out"))).toBe(true);
  });

  it("does not claim every failure is the network", () => {
    // The three that have their own handling, and must keep it: a rate limit
    // is a stable code, a rejected token raises the sign-in banner, and a
    // not-found is a real answer about a real thing.
    expect(isOffline("anilist.rateLimited")).toBe(false);
    expect(isOffline(NOT_FOUND)).toBe(false);
    expect(isOffline("Invalid token")).toBe(false);
    expect(isOffline(null)).toBe(false);
    expect(isOffline(undefined)).toBe(false);
  });

  it("anchors on the prefix rather than the transport's wording", () => {
    // reqwest's sentence is a library detail; a message that merely mentions
    // a network is not this.
    expect(isOffline("Something about the network went wrong")).toBe(false);
  });
});
