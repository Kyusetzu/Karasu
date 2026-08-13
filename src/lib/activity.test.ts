import { describe, expect, it } from "vitest";
import {
  formatProgress,
  listActivityVerb,
  normalizeActivity,
  parseProgress,
  PROGRESS_VERBS,
  splitSentence,
  toggleLike,
  type ActivityVerb,
} from "./activity";
import { en } from "@/i18n/en";
import { de } from "@/i18n/de";

const USER = { id: 1, name: "kyu", avatar: null, isFollowing: null, isFollower: null };

describe("normalizeActivity", () => {
  it("normalises a list activity", () => {
    const out = normalizeActivity({
      __typename: "ListActivity",
      id: 7,
      status: "watched episode",
      progress: "3 - 5",
      createdAt: 100,
      likeCount: 2,
      isLiked: true,
      replyCount: 1,
      siteUrl: "https://anilist.co/activity/7",
      user: USER,
      media: null,
    });
    expect(out).toMatchObject({
      kind: "list",
      id: 7,
      verb: "watchedEpisode",
      progress: { from: 3, to: 5 },
      isLiked: true,
    });
  });

  it("normalises a text activity", () => {
    const out = normalizeActivity({
      __typename: "TextActivity",
      id: 8,
      text: "back after three months",
      createdAt: 100,
      user: USER,
    });
    expect(out).toMatchObject({ kind: "text", text: "back after three months" });
  });

  it("returns null for a MessageActivity — private mail, never rendered", () => {
    // The property, not the query argument. `type_in` excludes MESSAGE and the
    // query has no fragment for it, but this is the layer that cannot be
    // widened by editing a string, so it is the one worth asserting.
    expect(
      normalizeActivity({
        __typename: "MessageActivity",
        id: 9,
        text: "a private message",
        createdAt: 100,
        user: USER,
      }),
    ).toBeNull();
  });

  it("returns null for anything it does not recognise, rather than throwing", () => {
    expect(normalizeActivity(null)).toBeNull();
    expect(normalizeActivity(undefined)).toBeNull();
    expect(normalizeActivity({})).toBeNull();
    expect(normalizeActivity({ __typename: "SomethingNew", id: 1, user: USER })).toBeNull();
    // No author — nothing to attribute the row to.
    expect(normalizeActivity({ __typename: "TextActivity", id: 1, text: "x" })).toBeNull();
  });

  it("survives a list activity whose media was deleted", () => {
    const out = normalizeActivity({
      __typename: "ListActivity",
      id: 10,
      status: "completed",
      createdAt: 1,
      user: USER,
      media: null,
    });
    expect(out).toMatchObject({ kind: "list", media: null, verb: "completed" });
  });

  it("drops a text activity with no text", () => {
    expect(
      normalizeActivity({ __typename: "TextActivity", id: 11, text: "   ", user: USER }),
    ).toBeNull();
    expect(
      normalizeActivity({ __typename: "TextActivity", id: 12, user: USER }),
    ).toBeNull();
  });

  it("defaults the counts rather than passing null through to the UI", () => {
    const out = normalizeActivity({
      __typename: "ListActivity",
      id: 13,
      status: "dropped",
      user: USER,
      likeCount: null,
      isLiked: null,
      replyCount: null,
      siteUrl: null,
    });
    expect(out).toMatchObject({ likeCount: 0, isLiked: false, replyCount: 0, siteUrl: "" });
  });
});

describe("listActivityVerb", () => {
  it("maps every status string observed on the live feed", () => {
    // Frequencies from 150 real activities, most common first.
    const observed: [string, ActivityVerb][] = [
      ["watched episode", "watchedEpisode"],
      ["read chapter", "readChapter"],
      ["completed", "completed"],
      ["plans to watch", "plansToWatch"],
      ["plans to read", "plansToRead"],
      ["dropped", "dropped"],
    ];
    for (const [status, verb] of observed) {
      expect(listActivityVerb(status), status).toBe(verb);
    }
  });

  it("maps the statuses the sample missed but AniList still has", () => {
    expect(listActivityVerb("paused")).toBe("paused");
    expect(listActivityVerb("rewatched episode")).toBe("rewatchedEpisode");
    expect(listActivityVerb("reread chapter")).toBe("rereadChapter");
    expect(listActivityVerb("re-read chapter")).toBe("rereadChapter");
  });

  it("is insensitive to case and surrounding space", () => {
    expect(listActivityVerb("  Watched Episode ")).toBe("watchedEpisode");
  });

  it("returns null for an unknown verb so the raw words can be shown", () => {
    // Null means "use AniList's own sentence", not "render nothing".
    expect(listActivityVerb("invented a new status")).toBeNull();
    expect(listActivityVerb("")).toBeNull();
    expect(listActivityVerb(null)).toBeNull();
    expect(listActivityVerb(undefined)).toBeNull();
  });

  it("only ever returns members of the closed union", () => {
    const allowed = new Set<ActivityVerb | null>([
      "watchedEpisode", "rewatchedEpisode", "readChapter", "rereadChapter",
      "completed", "plansToWatch", "plansToRead", "dropped", "paused", null,
    ]);
    for (const s of ["watched episode", "nonsense", "", "COMPLETED", "paused"]) {
      expect(allowed.has(listActivityVerb(s))).toBe(true);
    }
  });
});

describe("parseProgress", () => {
  it("parses the two shapes AniList sends", () => {
    expect(parseProgress("12")).toEqual({ from: 12 });
    expect(parseProgress("162 - 170")).toEqual({ from: 162, to: 170 });
    expect(parseProgress(" 3-5 ")).toEqual({ from: 3, to: 5 });
  });

  it("collapses a range that is not one", () => {
    expect(parseProgress("5 - 5")).toEqual({ from: 5 });
    expect(parseProgress("9 - 2")).toEqual({ from: 9 });
  });

  it("returns null rather than NaN for anything else", () => {
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress("")).toBeNull();
    expect(parseProgress("many")).toBeNull();
    expect(parseProgress("1 - 2 - 3")).toBeNull();
    expect(parseProgress("-4")).toBeNull();
  });
});

describe("formatProgress", () => {
  it("renders a single value bare and a range with an en dash", () => {
    expect(formatProgress({ from: 12 })).toBe("12");
    // An en dash, not "von"/"of": AniList's "162 - 170" is a batch read in one
    // sitting, and phrasing it as "162 of 170" would claim a total it never sent.
    expect(formatProgress({ from: 162, to: 170 })).toBe("162–170");
  });
});

describe("splitSentence", () => {
  it("opens the title slot", () => {
    expect(splitSentence("hat Kapitel 5 von %t% gelesen")).toEqual({
      before: "hat Kapitel 5 von ",
      after: " gelesen",
    });
    expect(splitSentence("completed %t%")).toEqual({ before: "completed ", after: "" });
  });

  it("degrades to the verb-first order when the token is missing", () => {
    // A translation that lost %t% must not eat the title — it falls back to
    // sentence-then-title, the pre-template rendering.
    expect(splitSentence("watched episode 5")).toEqual({
      before: "watched episode 5",
      after: "",
    });
  });

  it("splits on the first token only", () => {
    expect(splitSentence("%t% and %t%")).toEqual({ before: "", after: " and %t%" });
  });
});

describe("the sentence templates themselves", () => {
  // The failure mode a translator hits: dropping the title token or the
  // progress slot. Asserted against both files so `de: typeof en` (key parity)
  // and this test (value shape) cover different mistakes.
  const SENT_KEYS = [
    "sentWatchedEpisode",
    "sentRewatchedEpisode",
    "sentReadChapter",
    "sentRereadChapter",
    "sentCompleted",
    "sentPlansToWatch",
    "sentPlansToRead",
    "sentDropped",
    "sentPaused",
  ] as const;

  const PROGRESS_KEYS: Record<string, boolean> = {
    sentWatchedEpisode: true,
    sentRewatchedEpisode: true,
    sentReadChapter: true,
    sentRereadChapter: true,
  };

  it("every template carries exactly one title token in both languages", () => {
    for (const lang of [en, de]) {
      for (const key of SENT_KEYS) {
        const value = lang.social[key];
        expect(value.split("%t%").length, `${key}: ${value}`).toBe(2);
      }
    }
  });

  it("the four progress verbs carry the {{n}} slot, the rest do not", () => {
    for (const lang of [en, de]) {
      for (const key of SENT_KEYS) {
        const value = lang.social[key];
        expect(value.includes("{{n}}"), `${key}: ${value}`).toBe(!!PROGRESS_KEYS[key]);
      }
    }
  });

  it("PROGRESS_VERBS matches the keys that take a number", () => {
    // The set gates the fallback in ListSentence; if it drifts from the
    // templates, a progress verb renders with an empty slot.
    expect([...PROGRESS_VERBS].sort()).toEqual([
      "readChapter",
      "rereadChapter",
      "rewatchedEpisode",
      "watchedEpisode",
    ]);
  });
});

describe("toggleLike", () => {
  it("moves the count both ways", () => {
    expect(toggleLike({ likeCount: 4, isLiked: false })).toEqual({
      likeCount: 5,
      isLiked: true,
    });
    expect(toggleLike({ likeCount: 5, isLiked: true })).toEqual({
      likeCount: 4,
      isLiked: false,
    });
  });

  it("is its own inverse, so undo needs no separate path", () => {
    const start = { likeCount: 3, isLiked: false };
    expect(toggleLike(toggleLike(start))).toEqual(start);
  });

  it("never goes negative when the server and the guess disagree", () => {
    expect(toggleLike({ likeCount: 0, isLiked: true })).toEqual({
      likeCount: 0,
      isLiked: false,
    });
  });

  it("keeps any other fields on the item", () => {
    expect(toggleLike({ likeCount: 1, isLiked: false, id: 42 })).toMatchObject({ id: 42 });
  });
});
