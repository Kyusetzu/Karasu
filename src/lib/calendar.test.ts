import { describe, expect, it } from "vitest";
import {
  addDays,
  bucketByLocalDay,
  fromList,
  localMidnight,
  weekDays,
  weekStartOf,
} from "./calendar";
import type { MediaListEntry } from "@/api/types";

/**
 * Everything here builds its expectations through the same local `Date` the
 * implementation uses, so the suite holds in any timezone the machine runs in
 * — including ones with DST, which is the whole reason the module goes
 * through `Date` instead of adding 86 400s.
 */

/** Local wall-clock constructor, in seconds. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

describe("weekStartOf", () => {
  it("lands on a local Monday at midnight", () => {
    // 2026-08-13 is a Thursday.
    const start = weekStartOf(new Date(2026, 7, 13, 15, 30).getTime());
    const d = new Date(start * 1000);
    expect(d.getDay()).toBe(1);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    expect(d.getDate()).toBe(10);
  });

  it("a Monday is its own week start, a Sunday belongs to the week before", () => {
    const monday = weekStartOf(new Date(2026, 7, 10, 0, 0).getTime());
    expect(new Date(monday * 1000).getDate()).toBe(10);
    const sunday = weekStartOf(new Date(2026, 7, 16, 23, 59).getTime());
    expect(new Date(sunday * 1000).getDate()).toBe(10);
  });
});

describe("weekDays / addDays", () => {
  it("yields seven consecutive local midnights", () => {
    const days = weekDays(weekStartOf(new Date(2026, 7, 13).getTime()));
    expect(days).toHaveLength(7);
    for (const [i, sec] of days.entries()) {
      const d = new Date(sec * 1000);
      expect(d.getHours(), `day ${i}`).toBe(0);
      // Consecutive calendar dates, whatever their length in hours.
      if (i > 0) {
        const prev = new Date(days[i - 1] * 1000);
        prev.setDate(prev.getDate() + 1);
        expect(d.getTime()).toBe(prev.getTime());
      }
    }
  });

  it("addDays stays at midnight across a DST-length week", () => {
    // Late March, where European zones change clocks. In a zone without DST
    // this is simply seven ordinary days — the assertion holds either way.
    const days = weekDays(weekStartOf(new Date(2026, 2, 26).getTime()));
    for (const sec of days) {
      expect(new Date(sec * 1000).getHours()).toBe(0);
    }
    expect(addDays(days[0], 7)).toBe(
      weekStartOf(new Date(days[0] * 1000).getTime() + 8 * 86400 * 1000),
    );
  });
});

describe("bucketByLocalDay", () => {
  const days = weekDays(weekStartOf(new Date(2026, 7, 13).getTime()));

  it("sorts each day's bucket by time and keeps days apart", () => {
    const items = [
      { airingAt: at(2026, 8, 12, 22, 0), id: "wed-late" },
      { airingAt: at(2026, 8, 10, 9, 0), id: "mon" },
      { airingAt: at(2026, 8, 12, 8, 0), id: "wed-early" },
    ];
    const buckets = bucketByLocalDay(items, days);
    expect(buckets[0].map((x) => x.id)).toEqual(["mon"]);
    expect(buckets[2].map((x) => x.id)).toEqual(["wed-early", "wed-late"]);
    expect(buckets[1]).toEqual([]);
  });

  it("an episode a minute before local midnight stays on its own day", () => {
    const buckets = bucketByLocalDay([{ airingAt: at(2026, 8, 10, 23, 59) }], days);
    expect(buckets[0]).toHaveLength(1);
    expect(buckets[1]).toHaveLength(0);
  });

  it("drops what lands outside the given days rather than clamping", () => {
    const outside = [
      { airingAt: at(2026, 8, 9, 12, 0) },
      { airingAt: at(2026, 8, 17, 0, 1) },
    ];
    expect(bucketByLocalDay(outside, days).flat()).toHaveLength(0);
  });

  it("localMidnight agrees with the buckets it keys", () => {
    expect(localMidnight(at(2026, 8, 12, 22, 0))).toBe(days[2]);
  });
});

describe("fromList", () => {
  const entry = (
    id: number,
    status: MediaListEntry["status"],
    airingAt: number | null,
    episode = 5,
  ) =>
    ({
      id,
      mediaId: id,
      status,
      media: {
        id,
        nextAiringEpisode: airingAt === null ? null : { episode, airingAt },
      },
    }) as unknown as MediaListEntry;

  const gt = 1000;
  const lt = 2000;

  it("keeps watching shows airing inside the window, soonest first", () => {
    const out = fromList(
      [
        entry(1, "CURRENT", 1800),
        entry(2, "REPEATING", 1200),
        entry(3, "CURRENT", 2500), // beyond the window
        entry(4, "CURRENT", null), // finished or unscheduled
      ],
      gt,
      lt,
    );
    expect(out.map((x) => x.mediaId)).toEqual([2, 1]);
    expect(out[0].episode).toBe(5);
  });

  it("excludes PLANNING by default and includes it when asked", () => {
    const list = [entry(1, "PLANNING", 1500)];
    expect(fromList(list, gt, lt)).toHaveLength(0);
    expect(
      fromList(list, gt, lt, ["CURRENT", "REPEATING", "PLANNING"]),
    ).toHaveLength(1);
  });

  it("the window is half-open: past the start, up to and including the end", () => {
    expect(fromList([entry(1, "CURRENT", 1000)], gt, lt)).toHaveLength(0);
    expect(fromList([entry(1, "CURRENT", 2000)], gt, lt)).toHaveLength(1);
  });
});
