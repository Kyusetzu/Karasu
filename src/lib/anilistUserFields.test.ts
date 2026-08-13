import { describe, expect, it } from "vitest";
import {
  formToUpdateUserVars,
  hasChanges,
  LOCAL_OVERRIDES,
  mergeNotificationOptions,
  NOTIFICATION_TYPES,
} from "./anilistUserFields";

describe("formToUpdateUserVars", () => {
  it("never emits animeListOptions or mangaListOptions", () => {
    // THE guard. `MediaListOptionsInput.customLists` is a full replacement with
    // no undo on AniList's side, so sending the object with a stale or absent
    // list deletes custom lists the user built by hand. It is also entirely
    // unnecessary: `scoreFormat` and `rowOrder` are top-level UpdateUser
    // arguments, while that input object holds only sectionOrder,
    // splitCompletedSectionByFormat, customLists, advancedScoring,
    // advancedScoringEnabled and theme. This test is what stops a later
    // "let's finish the pane" from quietly reintroducing it.
    const everything = {
      about: "hi",
      titleLanguage: "ENGLISH",
      staffNameLanguage: "ROMAJI",
      scoreFormat: "POINT_10",
      rowOrder: "title",
      profileColor: "blue",
      timezone: "+01:00",
      activityMergeTime: 30,
      displayAdultContent: true,
      airingNotifications: false,
      restrictMessagesToFollowing: true,
      notificationOptions: mergeNotificationOptions(null, {}),
    };
    const vars = formToUpdateUserVars(everything);
    expect(vars).not.toHaveProperty("animeListOptions");
    expect(vars).not.toHaveProperty("mangaListOptions");
    // Belt and braces: nothing resembling those names, however spelled.
    for (const key of Object.keys(vars)) {
      expect(key.toLowerCase()).not.toContain("listoptions");
    }
    expect(JSON.stringify(vars).toLowerCase()).not.toContain("customlists");
  });

  it("omits anything the user did not touch", () => {
    // Absent means "don't change" — the same convention list writes use. Sending
    // every field would let a stale value overwrite a change made elsewhere.
    expect(formToUpdateUserVars({ about: "only this" })).toEqual({ about: "only this" });
    expect(formToUpdateUserVars({})).toEqual({});
  });

  it("keeps a false and a zero, which are values rather than absences", () => {
    expect(formToUpdateUserVars({ displayAdultContent: false })).toEqual({
      displayAdultContent: false,
    });
    expect(formToUpdateUserVars({ activityMergeTime: 0 })).toEqual({
      activityMergeTime: 0,
    });
    expect(formToUpdateUserVars({ about: "" })).toEqual({ about: "" });
  });

  it("passes through every editable field when all are set", () => {
    const vars = formToUpdateUserVars({
      about: "a",
      titleLanguage: "ROMAJI",
      scoreFormat: "POINT_5",
      profileColor: "#aabbcc",
    });
    expect(Object.keys(vars).sort()).toEqual([
      "about",
      "profileColor",
      "scoreFormat",
      "titleLanguage",
    ]);
  });
});

describe("hasChanges", () => {
  it("is false for an untouched form and true once anything is set", () => {
    expect(hasChanges({})).toBe(false);
    expect(hasChanges({ about: "" })).toBe(true);
    expect(hasChanges({ airingNotifications: false })).toBe(true);
  });
});

describe("NOTIFICATION_TYPES", () => {
  it("holds exactly the twenty types AniList's enum has", () => {
    // The drift guard. If AniList adds a twenty-first type, this is where it is
    // discovered — rather than a user finding out by silently not being
    // notified, because a partial `notificationOptions` array disables anything
    // it omits.
    expect(NOTIFICATION_TYPES).toHaveLength(20);
    expect(new Set(NOTIFICATION_TYPES).size).toBe(20);
    // The exact set, read off the live schema.
    expect([...NOTIFICATION_TYPES].sort()).toEqual(
      [
        "ACTIVITY_LIKE", "ACTIVITY_MENTION", "ACTIVITY_MESSAGE", "ACTIVITY_REPLY",
        "ACTIVITY_REPLY_LIKE", "ACTIVITY_REPLY_SUBSCRIBED", "AIRING",
        "CHARACTER_SUBMISSION_UPDATE", "FOLLOWING", "MEDIA_DATA_CHANGE",
        "MEDIA_DELETION", "MEDIA_MERGE", "MEDIA_SUBMISSION_UPDATE",
        "RELATED_MEDIA_ADDITION", "STAFF_SUBMISSION_UPDATE", "THREAD_COMMENT_LIKE",
        "THREAD_COMMENT_MENTION", "THREAD_COMMENT_REPLY", "THREAD_LIKE",
        "THREAD_SUBSCRIBED",
      ].sort(),
    );
  });
});

describe("mergeNotificationOptions", () => {
  const allFrom = (list: { type: string; enabled: boolean }[]) =>
    new Map(list.map((o) => [o.type, o.enabled]));

  it("always returns all twenty, whatever it was given", () => {
    expect(mergeNotificationOptions(null, {})).toHaveLength(20);
    expect(mergeNotificationOptions([], {})).toHaveLength(20);
    expect(mergeNotificationOptions([{ type: "AIRING", enabled: false }], {})).toHaveLength(20);
  });

  it("preserves the seventeen the user did not touch", () => {
    // The whole hazard in one assertion: a three-field patch must not disable
    // the other seventeen.
    const current = NOTIFICATION_TYPES.map((type) => ({ type, enabled: false }));
    const merged = mergeNotificationOptions(current, {
      AIRING: true,
      FOLLOWING: true,
      THREAD_LIKE: true,
    });
    const map = allFrom(merged);
    expect(merged).toHaveLength(20);
    expect(map.get("AIRING")).toBe(true);
    expect(map.get("FOLLOWING")).toBe(true);
    expect(map.get("THREAD_LIKE")).toBe(true);
    const untouched = NOTIFICATION_TYPES.filter(
      (t) => !["AIRING", "FOLLOWING", "THREAD_LIKE"].includes(t),
    );
    expect(untouched).toHaveLength(17);
    for (const type of untouched) expect(map.get(type), type).toBe(false);
  });

  it("defaults a type the server never reported to enabled", () => {
    // AniList's own default for a type it has not stored.
    const map = allFrom(mergeNotificationOptions([{ type: "AIRING", enabled: false }], {}));
    expect(map.get("AIRING")).toBe(false);
    expect(map.get("FOLLOWING")).toBe(true);
  });

  it("lets a change override what the server said", () => {
    const map = allFrom(
      mergeNotificationOptions([{ type: "AIRING", enabled: true }], { AIRING: false }),
    );
    expect(map.get("AIRING")).toBe(false);
  });

  it("ignores junk in the server's array rather than throwing", () => {
    const merged = mergeNotificationOptions(
      [{ type: null, enabled: true }, { type: "AIRING", enabled: null }],
      {},
    );
    expect(merged).toHaveLength(20);
    // `enabled: null` reads as enabled, matching the `!== false` test.
    expect(allFrom(merged).get("AIRING")).toBe(true);
  });
});

describe("LOCAL_OVERRIDES", () => {
  it("names exactly the four settings Karasu ignores", () => {
    expect(Object.keys(LOCAL_OVERRIDES).sort()).toEqual([
      "airingNotifications",
      "displayAdultContent",
      "scoreFormat",
      "titleLanguage",
    ]);
  });

  it("gives each a literal hint key, so i18nKeys can resolve it", () => {
    for (const [field, o] of Object.entries(LOCAL_OVERRIDES)) {
      expect(o.hintKey, field).toMatch(/^settings\.alOverride[A-Za-z]+$/);
    }
  });

  it("points only at panes that exist", () => {
    const panes = new Set([
      "account", "anilist", "appearance", "detection", "library", "content",
      "integrations", "advanced",
    ]);
    for (const [field, o] of Object.entries(LOCAL_OVERRIDES)) {
      if (o.pane !== null) expect(panes.has(o.pane), `${field} → ${o.pane}`).toBe(true);
    }
  });
});
