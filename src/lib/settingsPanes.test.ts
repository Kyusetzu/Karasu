import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANE,
  PANE_ALIASES,
  PANE_IDS,
  resolvePane,
} from "./settingsPanes";

describe("resolvePane", () => {
  it("takes every live id at face value", () => {
    for (const id of PANE_IDS) expect(resolvePane(id)).toBe(id);
  });

  it("falls back to Account when nothing is asked for", () => {
    expect(resolvePane(null)).toBe(DEFAULT_PANE);
    expect(resolvePane("")).toBe(DEFAULT_PANE);
    expect(resolvePane("no-such-pane")).toBe(DEFAULT_PANE);
  });

  /**
   * The reason the aliases exist. These two ids shipped, so they are in links
   * the app itself hands out and in whatever anyone bookmarked; without this
   * they would land on Account, which reads as a broken link rather than a
   * moved one.
   */
  it("sends a retired pane where its contents went", () => {
    expect(resolvePane("content")).toBe("appearance");
    expect(resolvePane("integrations")).toBe("desktop");
  });

  /** An alias pointing at a pane that no longer exists is worse than none. */
  it("keeps every alias aimed at a real pane", () => {
    for (const target of Object.values(PANE_ALIASES)) {
      expect(PANE_IDS).toContain(target);
    }
  });

  /** And no alias may shadow a live id, which would make it unreachable. */
  it("never aliases an id that is still in use", () => {
    for (const from of Object.keys(PANE_ALIASES)) {
      expect(PANE_IDS).not.toContain(from);
    }
  });
});
