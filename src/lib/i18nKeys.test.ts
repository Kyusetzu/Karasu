import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// `src/i18n.ts` initialises i18next on import, which reads the browser's
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

/**
 * Every `t("…")` in the source has to resolve.
 *
 * A missing key does not throw and does not fall back — i18next renders the
 * key itself, so the screen shows `entry.scoreHint` to the user and nothing
 * anywhere reports a problem. `de: typeof en` already guards the other
 * direction (an English key with no German counterpart); this guards the one
 * that actually shipped.
 */

const SRC = join(process.cwd(), "src");
// Interpolated keys — `t(`status.${type}.${s}`)` — can't be checked without
// running the app, so the literal ones are what this covers.
const CALL = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [full] : [];
  });
}

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
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(CALL)) {
      if (!found.has(match[1])) found.set(match[1], file);
    }
  }

  it("finds the calls at all", () => {
    // A regex that silently matches nothing would make every assertion below
    // pass while checking exactly nothing.
    expect(found.size).toBeGreaterThan(100);
  });

  it("resolves every literal key to a string", () => {
    const missing = [...found]
      .filter(([key]) => typeof resolve(key) !== "string")
      .map(([key, file]) => `${key} (${file.replace(SRC, "src")})`);
    expect(missing).toEqual([]);
  });
});
