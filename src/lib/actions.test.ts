import { describe, expect, it } from "vitest";
import {
  ACTION_GROUP_ORDER,
  ACTION_LABEL_KEY,
  STATUSES,
  canIncrementFacts,
  canIncrementVolumes,
  canScrobbleCancel,
  canScrobbleNow,
  resolveActions,
  scoreLeaves,
  statusLeaves,
  type ActionContext,
  type ActionId,
  type ActionTarget,
  type EntryFacts,
} from "@/lib/actions";
import { en } from "@/i18n/en";
import type { ScrobblePhase } from "@/stores/nowPlaying";

const FACTS: EntryFacts = {
  status: "CURRENT",
  progress: 3,
  progressVolumes: 1,
  score: 8,
  max: 12,
  maxVolumes: 5,
};

const CTX: ActionContext = {
  signedIn: true,
  scoreFormat: "POINT_10",
  scrobble: { phase: "idle", forceable: false, hasCurrent: false, overridden: false },
  tauri: true,
  hasSelection: false,
};

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ ...CTX, ...over });

const entry = (over: Partial<EntryFacts> = {}, mediaType: "ANIME" | "MANGA" = "ANIME"): ActionTarget => ({
  kind: "entry",
  mediaId: 1,
  mediaType,
  entry: { ...FACTS, ...over },
});

const ids = (target: ActionTarget, c: ActionContext = CTX): ActionId[] =>
  resolveActions(target, c).map((a) => a.id);

/** Resolves a dotted key against the English bundle, the same walk `i18nKeys.test.ts` does. */
function resolveKey(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      en,
    );
}

const PHASES: ScrobblePhase[] = [
  "idle",
  "watching",
  "yielding",
  "pending",
  "updating",
  "updated",
  "queued",
  "blocked",
  "cancelled",
];

describe("labels", () => {
  it("names a real string for every action", () => {
    const broken = Object.entries(ACTION_LABEL_KEY).filter(
      ([, key]) => typeof resolveKey(key) !== "string",
    );
    expect(broken).toEqual([]);
  });
});

describe("statusLeaves", () => {
  it("offers every status but the one already set", () => {
    expect(statusLeaves("CURRENT")).toHaveLength(STATUSES.length - 1);
    expect(statusLeaves("CURRENT")).not.toContain("CURRENT");
  });

  it("offers all six when nothing is set", () => {
    expect(statusLeaves(null)).toHaveLength(STATUSES.length);
  });
});

describe("scoreLeaves", () => {
  it("keeps every rung of a discrete scale", () => {
    expect(scoreLeaves("POINT_10")).toHaveLength(10);
    expect(scoreLeaves("POINT_5")).toHaveLength(5);
    expect(scoreLeaves("POINT_3")).toHaveLength(3);
  });

  it("has nothing to offer for the continuous formats, which belong in the editor", () => {
    expect(scoreLeaves("POINT_100")).toBeNull();
    expect(scoreLeaves("POINT_10_DECIMAL")).toBeNull();
  });
});

describe("increment guards", () => {
  it("stops at the last episode and runs on when the length is unknown", () => {
    expect(canIncrementFacts({ ...FACTS, progress: 12 })).toBe(false);
    expect(canIncrementFacts({ ...FACTS, progress: 999, max: null })).toBe(true);
  });

  it("gates volumes on their own maximum", () => {
    expect(canIncrementVolumes({ ...FACTS, progressVolumes: 5 })).toBe(false);
    expect(canIncrementVolumes({ ...FACTS, progressVolumes: 4 })).toBe(true);
  });
});

/** The predicate the now-playing card used to hold inline; this table is what pins its behaviour. */
describe("scrobble phases", () => {
  it.each(PHASES)("offers an update in %s only where the card always did", (phase) => {
    const forceable = canScrobbleNow(phase, true);
    const expected =
      phase === "pending" ||
      phase === "watching" ||
      phase === "yielding" ||
      phase === "cancelled" ||
      phase === "blocked";
    expect(forceable).toBe(expected);
  });

  it("never offers an update for a block Rust would refuse anyway", () => {
    expect(canScrobbleNow("blocked", false)).toBe(false);
    expect(canScrobbleNow("blocked", true)).toBe(true);
  });

  it("offers a skip only while a write is still coming", () => {
    expect(canScrobbleCancel("watching", true)).toBe(true);
    expect(canScrobbleCancel("pending", true)).toBe(true);
    expect(canScrobbleCancel("cancelled", true)).toBe(false);
    expect(canScrobbleCancel("blocked", true)).toBe(false);
    expect(canScrobbleCancel("updated", true)).toBe(false);
  });
});

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
    expect(menu).toEqual(["open", "openAniList", "back", "forward", "reload", "palette", "settings"]);
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

  it("answers the same twice, so no module state leaked in", () => {
    expect(resolveActions(entry(), CTX)).toEqual(resolveActions(entry(), CTX));
  });
});
