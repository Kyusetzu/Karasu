import { describe, expect, it } from "vitest";

/** The APK carries its own copy of the notices file, and a second copy of a licence file goes stale silently. */

const ROOT = "/THIRD-PARTY-NOTICES.md";
const BUNDLED = "/src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md";

// A `?raw` glob because the tsconfig knows no Node API; options inline, since Vite rewrites them at transform time.
const FILES = {
  ...(import.meta.glob("/THIRD-PARTY-NOTICES.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob(
    "/src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md",
    { query: "?raw", import: "default", eager: true },
  ) as Record<string, string>),
};

describe("third-party notices", () => {
  // Without this the text comparison passes vacuously when a path moves: `undefined === undefined`.
  it("finds both copies", () => {
    expect(Object.keys(FILES).sort()).toEqual([ROOT, BUNDLED].sort());
  });

  it("ships the same text it publishes", () => {
    // Compared whole rather than by hash so a mismatch prints the drifting lines.
    expect(FILES[BUNDLED]).toBe(FILES[ROOT]);
  });
});
