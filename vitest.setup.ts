import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Setup for the `dom` test project only — see `vite.config.ts`. The `node`
 * project never loads this, which is why importing Testing Library here is safe.
 */

// Unmount between tests. Without it, `getByRole` starts matching leftovers from
// a previous test and the failure looks like a component bug.
afterEach(cleanup);

/**
 * i18next renders the key when a translation is missing, so a component test
 * asserting on visible text would otherwise be asserting on English copy and
 * would break every time the wording changed.
 *
 * Stubbing `t` to return the key instead makes the assertions about *which*
 * string a component chose, not what that string currently says — which is the
 * thing worth pinning. `lib/i18nKeys.test.ts` already proves every key resolves.
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: "en" },
  }),
  // `ErrorBoundary` is the one class component and uses the HOC form.
  withTranslation: () => (C: unknown) => C,
  Trans: ({ children }: { children?: unknown }) => children,
}));

/**
 * Tauri's plugins reach for `__TAURI_INTERNALS__` and throw without it. Every
 * social component either guards on `isTauri` or calls `openUrl` from a click
 * handler, so the mock only has to exist rather than behave.
 */
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

/**
 * jsdom implements no layout, so it ships no `ResizeObserver` — and
 * `useColumnCount` constructs one in an effect. Without this, *any* test that
 * renders a card grid dies in `commitPassiveMountEffects` with an uncaught
 * `ReferenceError`, which surfaces as six unrelated failures and no clue.
 *
 * A stub rather than a measuring shim: nothing here has a layout to observe, so
 * the callback would only ever report zeroes. `useColumnCount` already treats a
 * non-laid-out element as one column, which is exactly the jsdom case.
 */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
