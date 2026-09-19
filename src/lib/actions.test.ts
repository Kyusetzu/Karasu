import { describe, expect, it } from "vitest";
import {
  ACTION_LABEL_KEY,
  STATUSES,
  canAdvance,
  canIncrementFacts,
  canIncrementVolumes,
  completePatch,
  canScrobbleCancel,
  canScrobbleNow,
  scoreLeaves,
  statusLeaves,
} from "@/lib/actions";
import { en } from "@/i18n/en";
import type { ScrobblePhase } from "@/stores/nowPlaying";
import { FACTS } from "@/test/actions";

/** The pure pieces under `resolveActions`: labels, leaves, the increment guards and the scrobble phase table. */

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

describe("completePatch", () => {
  /** The row button and the menu used to disagree here, which showed as a different receipt for the same action. */
  it("sets the final episode where the run length is known", () => {
    expect(completePatch(12)).toEqual({ status: "COMPLETED", progress: 12 });
  });

  it("writes no progress at all where it is unknown, rather than rewriting the current number", () => {
    expect(completePatch(null)).toEqual({ status: "COMPLETED" });
    expect("progress" in completePatch(null)).toBe(false);
  });
});

describe("increment guards", () => {
  it("is one rule, whichever axis or shape asks it", () => {
    expect(canAdvance(3, 12)).toBe(true);
    expect(canAdvance(12, 12)).toBe(false);
    expect(canAdvance(999, null)).toBe(true);
  });

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
