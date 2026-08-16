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
    // A bulk edit refused because a drain already holds the queue lock. It
    // cannot be queued itself, so the refusal has to say why.
    expect(backendErrorText("queue.busy", t)).toBe("T:receipt.syncBusy");
  });

  /**
   * Transport detail carries its diagnosis in the part no dictionary covers,
   * and a code that lost its translation has to degrade to the sentence that
   * shipped before rather than to an empty box.
   */
  it("passes anything else through unchanged", () => {
    const raw = "Could not reach the server: dns error";
    expect(backendErrorText(raw, t)).toBe(raw);
    expect(backendErrorText(new Error("Sign-in failed: HTTP 502"), t)).toBe(
      "Sign-in failed: HTTP 502",
    );
    expect(backendErrorText("jellyfin.somethingNew", t)).toBe("jellyfin.somethingNew");
  });
});
