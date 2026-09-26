import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import type { FranchiseGraph } from "@/api/franchise";
import { useContentFilter } from "@/stores/contentFilter";
import { renderWithProviders, signIn, signOut } from "@/test/render";

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

const graph: FranchiseGraph = {
  rootId: 900,
  nodes: [
    {
      id: 900,
      type: "ANIME",
      title: { romaji: "Root", english: null, native: null },
      coverImage: { large: null },
      format: "TV",
      listStatus: "COMPLETED",
      progress: 12,
      total: 12,
    },
    {
      id: 901,
      type: "ANIME",
      title: { romaji: "Sequel", english: null, native: null },
      coverImage: { large: null },
      format: "TV",
      listStatus: null,
      progress: null,
      total: 12,
    },
  ],
  edges: [{ from: 900, to: 901, relation: "SEQUEL" }],
  truncated: false,
};

vi.mock("@/api/franchise", async (orig) => ({
  ...(await orig<typeof import("@/api/franchise")>()),
  loadFranchise: () => Promise.resolve(graph),
}));

import Franchise from "./Franchise";

const store = new Map<string, string>();

/** jsdom implements no pointer capture, and the canvas's release handler asks about it on every pointerup. */
Object.assign(HTMLElement.prototype, {
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
});

function mount() {
  return renderWithProviders(
    <Routes>
      <Route path="/franchise/:id" element={<Franchise />} />
    </Routes>,
    { route: "/franchise/900" },
  );
}

beforeEach(() => {
  store.clear();
  // The dom project shares one jsdom per file; a Map keeps each test's remembered choice its own.
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((k) => store.get(k) ?? null);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((k, v) => void store.set(k, v));
  useContentFilter.setState({ level: "off", ready: true, error: null });
  signIn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  signOut();
  useContentFilter.setState({ level: "strict", ready: false, error: null });
});

describe("Franchise legend", () => {
  /** The header used to carry the key in one row that could not wrap, and on a phone it pushed the page sideways. */
  it("keeps the key out of the header and starts it folded", async () => {
    mount();
    const toggle = await screen.findByRole("button", { name: "franchise.legend" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByRole("banner")).queryByText("franchise.notOnList")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("opens to every status the palette colours, plus the untracked ring, and remembers that", async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole("button", { name: "franchise.legend" }));
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "status.ANIME.CURRENT",
      "status.ANIME.REPEATING",
      "status.ANIME.COMPLETED",
      "status.ANIME.PAUSED",
      "status.ANIME.DROPPED",
      "status.ANIME.PLANNING",
      "franchise.notOnList",
    ]);
    cleanup();

    mount();
    expect(await screen.findByRole("button", { name: "franchise.legend" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "franchise.legend" }));
    expect(screen.queryByRole("list")).toBeNull();
    expect(store.get("karasu-franchise-legend")).toBe("closed");
  });
});
