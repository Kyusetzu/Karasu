import { beforeAll, describe, expect, it } from "vitest";

/** Every `t("…")` in the source has to resolve, because i18next renders a missing key instead of throwing. */

const FILES = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// `t("a")` — the anchored form, and the overwhelming majority.
const CALL = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;

// `t(cond ? "a" : "b")`, matched as the whole ternary so a comparison operand like `"mine"` is not reported as a key.
const TERNARY =
  /\bt\(\s*[^)]*?\?\s*"([a-zA-Z0-9_.]+)"\s*:\s*"([a-zA-Z0-9_.]+)"/g;

// For the dead-key direction only: a key reached through a const table is a literal never adjacent to a `t(`.
const ANY_LITERAL = /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;

/** Template-literal namespaces, exempt from the dead-key check; a missing member is invisible to both directions. */
const DYNAMIC_PREFIXES = [
  "status.",
  "season.",
  "relation.",
  "format.",
  "source.",
  "mediaStatus.",
  "country.",
  "sort.",
  "merge.strategy.",
  "settings.theme_",
  "settings.contrast_",
  "settings.density_",
  "settings.contentLevel_",
  "settings.contentHint_",
  // `t(`search.${chip.key}`)` over a const table of chips.
  "search.chip",
];

/** Dynamic keys with a closed membership, listed exactly so they are asserted to exist rather than merely exempted. */
const DYNAMIC_KEYS = [
  // `Category` in `components/stats/shared.tsx`, via `t(`stats.${c}`)`.
  "stats.overview",
  "stats.ratings",
  "stats.years",
  "stats.genresTags",
  "stats.people",
  // `PANES` in `pages/Settings.tsx`, via `t(`settings.pane_${p.id}`)`; listed so a missing pane label fails here.
  "settings.pane_account",
  "settings.pane_anilist",
  "settings.pane_appearance",
  "settings.pane_detection",
  "settings.pane_library",
  "settings.pane_desktop",
  "settings.pane_data",
  "settings.pane_advanced",
];

// `@/i18n` reads `navigator` and `localStorage` on import, so both are shimmed before the dynamic import.
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
  const mentioned = new Set<string>();
  for (const [path, text] of Object.entries(FILES)) {
    // Both extensions, or a .tsx test walks straight past this skip.
    if (/\.test\.tsx?$/.test(path)) continue;
    for (const match of text.matchAll(CALL)) {
      if (!found.has(match[1])) found.set(match[1], path);
    }
    for (const match of text.matchAll(TERNARY)) {
      for (const key of [match[1], match[2]]) {
        if (!found.has(key)) found.set(key, path);
      }
    }
    for (const match of text.matchAll(ANY_LITERAL)) mentioned.add(match[1]);
  }

  it("finds the calls at all", () => {
    // A glob or regex that silently matched nothing would make the resolve check pass while checking nothing.
    expect(found.size).toBeGreaterThan(100);
  });

  it("resolves every literal key to a string", () => {
    const missing = [...found]
      .filter(([key]) => typeof resolve(key) !== "string")
      .map(([key, path]) => `${key} (${path})`);
    expect(missing).toEqual([]);
  });

  /** A key in `en.ts` that nothing reaches; `de: typeof en` and the resolve check cover only the other two directions. */
  it("has no key nothing reaches", () => {
    const leaves: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") return void leaves.push(path);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(en, "");

    const dead = leaves.filter(
      (key) =>
        !mentioned.has(key) &&
        !DYNAMIC_KEYS.includes(key) &&
        !DYNAMIC_PREFIXES.some((p) => key.startsWith(p)),
    );
    expect(dead).toEqual([]);
  });

  /** Every exempt prefix has to still name something, or a renamed namespace silently widens the hole. */
  it("keeps every dynamic prefix pointing at real keys", () => {
    const leaves: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (typeof node === "string") return void leaves.push(path);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(en, "");

    const empty = DYNAMIC_PREFIXES.filter(
      (p) => !leaves.some((key) => key.startsWith(p)),
    );
    expect(empty).toEqual([]);
  });

  /** And every exactly-listed dynamic key has to still be there. */
  it("keeps every closed dynamic union complete", () => {
    const missing = DYNAMIC_KEYS.filter((k) => typeof resolve(k) !== "string");
    expect(missing).toEqual([]);
  });
});
