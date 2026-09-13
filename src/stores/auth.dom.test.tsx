import { useRef } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/api/anilist";
import { useAdvancedCategories, useAuth } from "./auth";
import type { Viewer } from "@/api/types";

// Only the three IPC calls are replaced; the identity-changed handler stays real so the test drives the actual seam.
vi.mock("@/api/anilist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/anilist")>();
  return {
    ...actual,
    isTauri: true,
    connect: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    enableLocalMode: vi.fn(async () => {}),
  };
});

/** Proves `useAdvancedCategories` returns a stable reference, or `useSyncExternalStore` re-renders until React throws. */

function Probe({ renders }: { renders: { current: number } }) {
  const categories = useAdvancedCategories("ANIME");
  renders.current += 1;
  const seen = useRef<string[] | null>(null);
  const stable = seen.current === null || seen.current === categories;
  seen.current = categories;
  return <span data-testid="out">{`${categories.join(",")}|${stable}`}</span>;
}

const viewer = (animeList: {
  advancedScoring: string[] | null;
  advancedScoringEnabled: boolean | null;
}): Viewer =>
  ({
    id: 1,
    name: "x",
    siteUrl: "",
    avatar: null,
    mediaListOptions: { scoreFormat: "POINT_10", animeList, mangaList: null },
  }) as unknown as Viewer;

describe("useAdvancedCategories", () => {
  beforeEach(() => {
    useAuth.setState({ viewer: null });
  });

  it("settles in one render with advanced scoring ON", () => {
    useAuth.setState({
      viewer: viewer({
        advancedScoring: ["Story", "Characters", "Visuals"],
        advancedScoringEnabled: true,
      }),
    });
    const renders = { current: 0 };
    const { getByTestId } = render(<Probe renders={renders} />);
    expect(getByTestId("out").textContent).toBe("Story,Characters,Visuals|true");
    // One render; the count is what the user experiences and cannot be satisfied by accident.
    expect(renders.current).toBe(1);
  });

  it("settles in one render with it OFF", () => {
    useAuth.setState({
      viewer: viewer({
        advancedScoring: ["Story", "Characters"],
        advancedScoringEnabled: false,
      }),
    });
    const renders = { current: 0 };
    const { getByTestId } = render(<Probe renders={renders} />);
    expect(getByTestId("out").textContent).toBe("|true");
    expect(renders.current).toBe(1);
  });

  /** The flag is the gate, never the names: AniList seeds default categories on accounts that never enabled the feature. */
  it("ignores seeded category names when the feature is off", () => {
    useAuth.setState({
      viewer: viewer({
        advancedScoring: ["Story", "Characters", "Visuals", "Audio", "Enjoyment"],
        advancedScoringEnabled: false,
      }),
    });
    const renders = { current: 0 };
    const { getByTestId } = render(<Probe renders={renders} />);
    expect(getByTestId("out").textContent).toBe("|true");
  });

  it("has nothing to say with no account at all", () => {
    const renders = { current: 0 };
    const { getByTestId } = render(<Probe renders={renders} />);
    expect(getByTestId("out").textContent).toBe("|true");
    expect(renders.current).toBe(1);
  });
});

/** Proves every identity change fires the cache-drop handler `main.tsx` registers, or `mediaListEntry` leaks across users. */
describe("identity changes drop the query cache", () => {
  const fired: string[] = [];

  beforeEach(() => {
    fired.length = 0;
    api.setIdentityChangedHandler(() => fired.push("cleared"));
    useAuth.setState({ viewer: null, mode: "none", sessionExpired: false });
  });

  it("fires on sign-in", async () => {
    await useAuth.getState().connect("token");
    expect(fired).toEqual(["cleared"]);
  });

  it("fires on sign-out", async () => {
    await useAuth.getState().logout();
    expect(fired).toEqual(["cleared"]);
  });

  it("fires when the account-free list is chosen", async () => {
    await useAuth.getState().enableLocal();
    expect(fired).toEqual(["cleared"]);
  });
});
