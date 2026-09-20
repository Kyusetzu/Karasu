import { describe, expect, it } from "vitest";
import { ACTION_GROUP_ORDER, STATUSES, resolveActions, type ActionContext, type ActionTarget } from "@/lib/actions";
import { CTX, ctx, entryTarget as entry, ids } from "@/test/actions";

/** What `resolveActions` offers for each target and context; the helpers it composes have `actions.test.ts`. */

describe("resolveActions, entry", () => {
  it("offers the writes for a title on the list", () => {
    expect(ids(entry())).toEqual([
      "open",
      "plusOne",
      "complete",
      "edit",
      "setStatus",
      "setScore",
      "removeFromList",
      "openAniList",
      "search",
      "back",
      "forward",
      "reload",
      "palette",
      "settings",
    ]);
  });

  it("drops the increment at the last episode", () => {
    expect(ids(entry({ progress: 12 }))).not.toContain("plusOne");
  });

  it("drops completing a completed entry", () => {
    expect(ids(entry({ status: "COMPLETED" }))).not.toContain("complete");
  });

  it("offers the volume axis for manga only", () => {
    expect(ids(entry({}, "MANGA"))).toContain("plusVolume");
    expect(ids(entry({}, "ANIME"))).not.toContain("plusVolume");
  });

  it("drops the volume axis once the last volume is read", () => {
    expect(ids(entry({ progressVolumes: 5 }, "MANGA"))).not.toContain("plusVolume");
  });

  it("has no score submenu on a continuous scale", () => {
    expect(ids(entry(), ctx({ scoreFormat: "POINT_100" }))).not.toContain("setScore");
  });

  it("leaves the current status out of its own submenu", () => {
    const menu = resolveActions(entry({ status: "PAUSED" }), CTX);
    const leaves = menu.find((a) => a.id === "setStatus" && a.items)?.items ?? [];
    expect(leaves).toHaveLength(STATUSES.length - 1);
    expect(leaves.map((l) => l.arg)).not.toContainEqual({ kind: "status", status: "PAUSED" });
  });

  it("marks removal, and only removal, as dangerous", () => {
    const dangerous = resolveActions(entry(), CTX).filter((a) => a.danger);
    expect(dangerous.map((a) => a.id)).toEqual(["removeFromList"]);
  });
});

describe("resolveActions, without an account", () => {
  it("offers nothing that writes to a list", () => {
    const menu = ids(entry(), ctx({ signedIn: false }));
    expect(menu).toEqual([
      "open",
      "openAniList",
      "search",
      "back",
      "forward",
      "reload",
      "palette",
      "settings",
    ]);
  });
});

describe("resolveActions, a title that is not an entry", () => {
  const media = (listed: "no" | "unknown", canAdd = true): ActionTarget => ({
    kind: "media",
    mediaId: 7,
    mediaType: "ANIME",
    listed,
    canAdd,
  });

  it("offers to add a title the list answered for and does not hold", () => {
    expect(ids(media("no"))).toContain("addToList");
  });

  it("offers nothing to add when no list cache could answer", () => {
    expect(ids(media("unknown"))).not.toContain("addToList");
  });

  it("offers nothing to add where a first add has no media blob to carry", () => {
    expect(ids(media("no", false))).not.toContain("addToList");
  });

  it("never offers a write that needs an entry", () => {
    for (const listed of ["no", "unknown"] as const) {
      const menu = ids(media(listed));
      expect(menu).not.toContain("removeFromList");
      expect(menu).not.toContain("plusOne");
      expect(menu).not.toContain("setStatus");
    }
  });
});

describe("resolveActions, detection", () => {
  const detecting = (over: Partial<ActionContext["scrobble"]> = {}) =>
    ctx({ scrobble: { phase: "watching", forceable: true, hasCurrent: true, overridden: false, ...over } });

  it("is absent entirely while nothing is playing", () => {
    expect(ids({ kind: "detection", mediaId: 4 })).not.toContain("fixMatch");
  });

  it("always offers a correction while something plays", () => {
    expect(ids({ kind: "detection", mediaId: 4 }, detecting())).toContain("fixMatch");
  });

  it("opens the entry only once one is matched", () => {
    expect(ids({ kind: "detection", mediaId: 4 }, detecting())).toContain("open");
    expect(ids({ kind: "detection", mediaId: null }, detecting())).not.toContain("open");
  });

  it("offers to forget a correction only where one was made", () => {
    expect(ids({ kind: "detection", mediaId: 4 }, detecting())).not.toContain("clearOverride");
    expect(ids({ kind: "detection", mediaId: 4 }, detecting({ overridden: true }))).toContain(
      "clearOverride",
    );
  });
});

describe("resolveActions, shape", () => {
  it("copies only where something is selected", () => {
    expect(ids({ kind: "page" })).not.toContain("copySelection");
    expect(ids({ kind: "page" }, ctx({ hasSelection: true }))).toContain("copySelection");
  });

  it("shares a title only where a share sheet exists, and never the page", () => {
    expect(ids(entry())).not.toContain("share");
    expect(ids(entry(), ctx({ share: true }))).toContain("share");
    expect(ids({ kind: "media", mediaId: 1, mediaType: "ANIME", listed: "no", canAdd: true }, ctx({ share: true }))).toContain("share");
    expect(ids({ kind: "page" }, ctx({ share: true }))).not.toContain("share");
    expect(ids(entry(), ctx({ share: true, tauri: false }))).not.toContain("share");
  });

  it("leaves out what a browser cannot do", () => {
    const menu = ids(entry(), ctx({ tauri: false }));
    expect(menu).not.toContain("openAniList");
    expect(menu).not.toContain("reload");
  });

  it("never interleaves groups, which is what lets a renderer count its separators", () => {
    for (const target of [entry(), { kind: "page" } as ActionTarget]) {
      const seen = resolveActions(target, ctx({ hasSelection: true })).map((a) =>
        ACTION_GROUP_ORDER.indexOf(a.group),
      );
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    }
  });

  it("offers a sync only where there is something to sync", () => {
    expect(ids({ kind: "page" })).not.toContain("sync");
    expect(ids({ kind: "page" }, ctx({ canSync: true }))).toContain("sync");
  });

  it("answers the same twice, so no module state leaked in", () => {
    expect(resolveActions(entry(), CTX)).toEqual(resolveActions(entry(), CTX));
  });
});
