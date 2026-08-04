import { beforeAll, describe, expect, it } from "vitest";

/**
 * Every `t("…")` in the source has to resolve.
 *
 * A missing key does not throw and does not fall back — i18next renders the
 * key itself, so the screen shows `entry.scoreHint` to the user and nothing
 * anywhere reports a problem. `de: typeof en` already guards the other
 * direction (an English key with no German counterpart); this guards the one
 * that actually shipped.
 *
 * The sources are pulled in through Vite's own glob rather than `node:fs`, so
 * the suite needs no node type definitions and reads exactly the files the
 * bundle does.
 */

const FILES = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Interpolated keys — `t(`status.${type}.${s}`)` — can't be checked without
// running the app, so the literal ones are what this covers.
const CALL = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;

// `src/i18n/index.ts` initialises i18next on import, which reads the browser's
// language preference and the saved override. The suite runs in node, so both
// have to exist before the module is pulled in — hence the dynamic import.
let en: unknown;
beforeAll(async () => {
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { language: "en" },
    configurable: true,
  });
  ({ en } = await import("@/i18n"));
});

function resolve(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      en,
    );
}

describe("i18n keys", () => {
  const found = new Map<string, string>();
  for (const [path, text] of Object.entries(FILES)) {
    if (path.endsWith(".test.ts")) continue;
    for (const match of text.matchAll(CALL)) {
      if (!found.has(match[1])) found.set(match[1], path);
    }
  }

  it("finds the calls at all", () => {
    // A glob or a regex that silently matched nothing would make the
    // assertion below pass while checking exactly nothing.
    expect(found.size).toBeGreaterThan(100);
  });

  it("resolves every literal key to a string", () => {
    const missing = [...found]
      .filter(([key]) => typeof resolve(key) !== "string")
      .map(([key, path]) => `${key} (${path})`);
    expect(missing).toEqual([]);
  });
});
