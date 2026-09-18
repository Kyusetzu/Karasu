import { describe, expect, it } from "vitest";
import {
  PULL_IDLE,
  PULL_MAX_PX,
  PULL_SLOP_PX,
  PULL_TRIGGER_PX,
  isScrollableStyle,
  pullBegin,
  pullEnd,
  pullMove,
  pullOffset,
  type PullSample,
} from "@/lib/pullToSync";

const at = (over: Partial<PullSample> = {}): PullSample => ({
  y: 0,
  scrollTop: 0,
  touches: 1,
  syncing: false,
  ...over,
});

/** The finger travel that first reaches the trigger, found once so the tests read in gesture terms. */
const TRIGGER_TRAVEL = (() => {
  for (let raw = 0; raw < 2000; raw++) {
    if (pullOffset(raw) >= PULL_TRIGGER_PX) return raw + PULL_SLOP_PX;
  }
  throw new Error("the damping never reaches the trigger");
})();

describe("pullOffset", () => {
  it("is zero at rest and never negative", () => {
    expect(pullOffset(0)).toBe(0);
    expect(pullOffset(-40)).toBe(0);
  });

  it("rises monotonically", () => {
    let last = -1;
    for (let raw = 0; raw <= 400; raw += 7) {
      const next = pullOffset(raw);
      expect(next).toBeGreaterThanOrEqual(last);
      last = next;
    }
  });

  it("never passes the cap however far the finger travels", () => {
    expect(pullOffset(400)).toBeLessThan(PULL_MAX_PX);
    // The curve only reaches the cap in the limit, where a double rounds it to exactly the cap.
    expect(pullOffset(10_000)).toBeLessThanOrEqual(PULL_MAX_PX);
  });

  it("damps, so the finger travels further than the trigger", () => {
    expect(TRIGGER_TRAVEL).toBeGreaterThan(PULL_TRIGGER_PX);
  });
});

describe("isScrollableStyle", () => {
  it("accepts an overflowing auto or scroll container", () => {
    expect(isScrollableStyle("auto", 900, 600)).toBe(true);
    expect(isScrollableStyle("scroll", 900, 600)).toBe(true);
  });

  it("refuses a container that does not overflow", () => {
    expect(isScrollableStyle("auto", 600, 600)).toBe(false);
  });

  it("refuses overflow values that do not scroll", () => {
    expect(isScrollableStyle("hidden", 900, 600)).toBe(false);
    expect(isScrollableStyle("visible", 900, 600)).toBe(false);
  });
});

describe("pullBegin", () => {
  it("tracks from the very top", () => {
    expect(pullBegin(at({ y: 120 }))).toEqual({ phase: "tracking", offset: 0, startY: 120 });
  });

  it("refuses while scrolled, the case a pull must never be mistaken for", () => {
    expect(pullBegin(at({ scrollTop: 1 }))).toEqual(PULL_IDLE);
  });

  it("refuses a second finger and a running sync", () => {
    expect(pullBegin(at({ touches: 2 }))).toEqual(PULL_IDLE);
    expect(pullBegin(at({ syncing: true }))).toEqual(PULL_IDLE);
  });
});

describe("pullMove", () => {
  const start = pullBegin(at({ y: 100 }));

  it("stays tracking below the slop", () => {
    expect(pullMove(start, at({ y: 100 + PULL_SLOP_PX - 1 })).phase).toBe("tracking");
  });

  it("pulls past the slop and arms at the trigger", () => {
    expect(pullMove(start, at({ y: 100 + PULL_SLOP_PX + 4 })).phase).toBe("pulling");
    expect(pullMove(start, at({ y: 100 + TRIGGER_TRAVEL })).phase).toBe("ready");
  });

  it("does not arm on an upward move", () => {
    expect(pullMove(start, at({ y: 40 })).phase).toBe("tracking");
  });

  it("gives the gesture up once the content scrolls under it", () => {
    const armed = pullMove(start, at({ y: 100 + TRIGGER_TRAVEL }));
    expect(pullMove(armed, at({ y: 100 + TRIGGER_TRAVEL, scrollTop: 12 }))).toEqual(PULL_IDLE);
  });

  it("gives the gesture up on a second finger", () => {
    expect(pullMove(start, at({ y: 300, touches: 2 }))).toEqual(PULL_IDLE);
  });

  it("ignores moves that arrive after it went idle", () => {
    expect(pullMove(PULL_IDLE, at({ y: 900 }))).toEqual(PULL_IDLE);
  });
});

describe("pullEnd", () => {
  it("syncs from ready and returns to idle", () => {
    const armed = pullMove(pullBegin(at({ y: 100 })), at({ y: 100 + TRIGGER_TRAVEL }));
    expect(pullEnd(armed)).toEqual({ next: PULL_IDLE, sync: true });
  });

  it("never syncs from a pull that stopped short", () => {
    const short = pullMove(pullBegin(at({ y: 100 })), at({ y: 100 + PULL_SLOP_PX + 4 }));
    expect(pullEnd(short).sync).toBe(false);
    expect(pullEnd(PULL_IDLE).sync).toBe(false);
  });
});
