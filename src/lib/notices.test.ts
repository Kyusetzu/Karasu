import { describe, expect, it } from "vitest";

/**
 * The bundled Android copy of the notices file must equal the root one.
 *
 * The APK cannot read a file at the repository root, so `assets/` carries a
 * second copy — and a second copy of a licence file is a file that silently
 * goes stale. Editing the root without an Android build left the shipped APK
 * attributing a different set of components than the repository claimed, with
 * nothing anywhere reporting it. CLAUDE.md said "edit both together", which is
 * a rule only as strong as whoever remembers it; this is the same rule with a
 * failing test behind it.
 *
 * Read through Vite's `?raw` glob for the same reason `i18nKeys.test.ts` does:
 * no node type definitions, and the exact bytes.
 */

const ROOT = "/THIRD-PARTY-NOTICES.md";
const BUNDLED = "/src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md";

// The options have to be an inline object literal at each call: the plugin
// rewrites these at transform time and cannot follow a variable.
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
  // Without this the comparison below passes vacuously when a path moves:
  // `undefined === undefined`.
  it("finds both copies", () => {
    expect(Object.keys(FILES).sort()).toEqual([ROOT, BUNDLED].sort());
  });

  it("ships the same text it publishes", () => {
    // Compared whole rather than by length or hash: a mismatch should print
    // the drifting lines, since the point is to make the fix obvious.
    expect(FILES[BUNDLED]).toBe(FILES[ROOT]);
  });
});
