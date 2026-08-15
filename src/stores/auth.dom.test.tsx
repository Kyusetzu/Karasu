import { useRef } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAdvancedCategories, useAuth } from "./auth";
import type { Viewer } from "@/api/types";

/**
 * The selector-stability test, and it exists because the first version of
 * `useAdvancedCategories` did not have one.
 *
 * zustand 5 passes the selector to React's `useSyncExternalStore`, which
 * re-invokes it after commit and re-renders whenever the result is not
 * *identical* to the previous one. A selector ending in `.filter()` allocates
 * a new array every call, so it never is — and the component re-renders until
 * React throws "Maximum update depth exceeded" (minified #185 in a shipped
 * build). The original hook stabilised only the feature-off branch, which is
 * to say it worked for everyone except the accounts the feature is for.
 *
 * A render *count* rather than an assertion about references: the count is
 * what the user experiences, and it is the thing that cannot be satisfied by
 * accident.
 */

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
    // One render. The broken version reached 55 and then threw.
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

  /**
   * The flag is the gate, never the names. AniList seeds five defaults on
   * accounts that have never switched the feature on, so a non-empty
   * `advancedScoring` says nothing at all.
   */
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
