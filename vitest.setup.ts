import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/** Setup for the `dom` project only; `node` never loads it, which is why importing Testing Library here is safe. */

// Unmount between tests, or `getByRole` matches leftovers from the previous test and looks like a component bug.
afterEach(cleanup);

/** `t` returns the key so assertions pin which string a component chose, not the English copy it currently says. */
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

/** Tauri plugins throw without `__TAURI_INTERNALS__`; callers guard on `isTauri` or a click, so the mock only has to exist. */
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

/** jsdom has no `ResizeObserver`; without this stub every test rendering a card grid dies with a bare ReferenceError. */
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
