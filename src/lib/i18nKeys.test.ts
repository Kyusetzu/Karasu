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

// `t("a")` — the anchored form, and the overwhelming majority.
const CALL = /\bt\(\s*"([a-zA-Z0-9_.]+)"/g;

// `t(cond ? "a" : "b")`, which the anchored form could not see either branch of
// — 26 keys across 21 call sites were invisible, and each one is a chance to
// render a raw key on screen with the suite green.
//
// Matched as the whole ternary rather than "any literal inside `t(`": the loose
// form picks up comparison operands too, so `t(view === "mine" ? … )` asserted
// that a key called `mine` exists. A pattern that reports things which are not
// keys makes the failure list unreadable, which is how a real one gets skimmed
// past.
const TERNARY =
  /\bt\(\s*[^)]*?\?\s*"([a-zA-Z0-9_.]+)"\s*:\s*"([a-zA-Z0-9_.]+)"/g;

// For the dead-key direction only: a key mentioned *anywhere* as a literal.
//
// Several namespaces are reached from a const table — `NAV` holds `{ key:
// "nav.dashboard" }` and the component renders `t(item.key)` — so the string is
// in the source but never adjacent to a `t(`. That is a perfectly good caller;
// it is only invisible to a scan that insists on the call shape.
const ANY_LITERAL = /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;

/**
 * Namespaces reached only through a template literal — `` t(`status.${type}.${s}`) ``.
 *
 * They cannot be enumerated by reading the source, so they are exempt from the
 * dead-key direction below and listed here by hand. The cost of that is real
 * and worth naming: a member missing from one of these families is invisible to
 * *both* directions and ships as a raw key. `i18nFamilies.test.ts` covers the
 * ones with a fixed membership.
 */
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
  "settings.pane_",
  "settings.theme_",
  "settings.coverSize_",
  "settings.contentLevel_",
  "settings.contentHint_",
  // `t(`search.${chip.key}`)` over a const table of chips.
  "search.chip",
];

/**
 * Dynamic keys whose membership *is* closed, listed exactly.
 *
 * Better than a prefix: a prefix only exempts, while these are also asserted to
 * exist, so dropping a member of the union that produces them fails here rather
 * than rendering `stats.people` on a tab. Each group names its union.
 */
const DYNAMIC_KEYS = [
  // `Category` in `components/stats/shared.tsx`, via `t(`stats.${c}`)`.
  "stats.overview",
  "stats.ratings",
  "stats.years",
  "stats.genresTags",
  "stats.people",
];

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
  const mentioned = new Set<string>();
  for (const [path, text] of Object.entries(FILES)) {
    // Both extensions: the glob above takes .ts *and* .tsx, and the repo now
    // has a .tsx test, which this skip used to walk straight past.
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

  /**
   * The direction nothing guarded: a key in `en.ts` that nothing reaches.
   *
   * `de: typeof en` checks en→de and the test above checks use→en. Neither
   * notices a string that no longer has a caller, so a rename left the old key
   * behind in *both* files, and the next person to read them could not tell
   * which of two similar strings was live.
   */
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

  /**
   * Every exempt prefix has to still name something.
   *
   * The exemptions above are the one place this file stops checking, so a
   * renamed namespace would silently widen that hole rather than failing —
   * `status.` surviving as a prefix after the keys beneath it moved would
   * exempt nothing and hide nothing, but nobody would know.
   */
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
