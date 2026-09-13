import { describe, expect, it } from "vitest";
import { backendErrorText } from "./backendError";

/** Stands in for i18next: returns the key so the mapping is what is asserted. */
const t = (k: string) => `T:${k}`;

describe("backendErrorText", () => {
  it("translates every code the backend can return", () => {
    expect(backendErrorText("jellyfin.signedOut", t)).toBe("T:settings.jfErrSignedOut");
    expect(backendErrorText("jellyfin.noToken", t)).toBe("T:settings.jfErrNoToken");
    expect(backendErrorText("jellyfin.noUserId", t)).toBe("T:settings.jfErrNoUserId");
    expect(backendErrorText(new Error("jellyfin.badCredentials"), t)).toBe(
      "T:settings.jfErrBadCredentials",
    );
    expect(backendErrorText("jellyfin.badUrl", t)).toBe("T:settings.jfErrBadUrl");
    // The address answered, but with a web page or another service.
    expect(backendErrorText("jellyfin.notJellyfin", t)).toBe("T:settings.jfErrNotJellyfin");
    // The external address: a different server behind it, or one whose identity the app has not learned.
    expect(backendErrorText("jellyfin.externalOtherServer", t)).toBe(
      "T:settings.jfErrExternalOtherServer",
    );
    expect(backendErrorText("jellyfin.externalUnknownServer", t)).toBe(
      "T:settings.jfErrExternalUnknownServer",
    );
    // A bulk edit refused because a drain holds the queue lock cannot be queued itself, so it says why.
    expect(backendErrorText("queue.busy", t)).toBe("T:receipt.syncBusy");
    // AniList's own wording is "Invalid token": English and not actionable, so it gets a translation.
    expect(backendErrorText("anilist.tokenRejected", t)).toBe("T:auth.tokenRejected");
  });

  /** Proves transport detail and an untranslated code degrade to the raw sentence, never an empty box. */
  it("passes anything else through unchanged", () => {
    const raw = "Could not reach the server: dns error";
    expect(backendErrorText(raw, t)).toBe(raw);
    expect(backendErrorText(new Error("Sign-in failed: HTTP 502"), t)).toBe(
      "Sign-in failed: HTTP 502",
    );
    expect(backendErrorText("jellyfin.somethingNew", t)).toBe("jellyfin.somethingNew");
  });
});
