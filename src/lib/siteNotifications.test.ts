import { describe, expect, it } from "vitest";
import {
  normalizeSiteNotification,
  type RawSiteNotification,
} from "./siteNotifications";

describe("normalizeSiteNotification", () => {
  it("flattens an airing notification to the media and its episode", () => {
    const row = normalizeSiteNotification({
      __typename: "AiringNotification",
      id: 1,
      createdAt: 1700000000,
      episode: 12,
      media: { id: 42, title: { romaji: "Sousou no Frieren", english: "Frieren", native: null } },
    });
    expect(row).toEqual({
      id: 1,
      kind: "AIRING",
      createdAt: 1700000000,
      title: "Frieren",
      actorName: null,
      episode: 12,
      detail: null,
      target: "/media/42",
      userId: null,
      mediaId: 42,
      activityId: null,
    });
  });

  it("leads a follow with the follower and targets their profile", () => {
    const row = normalizeSiteNotification({
      __typename: "FollowingNotification",
      id: 2,
      createdAt: 5,
      user: { id: 7, name: "Kyusetzu" },
    });
    expect(row?.kind).toBe("FOLLOWING");
    expect(row?.title).toBe("Kyusetzu");
    expect(row?.target).toBe("/user/Kyusetzu");
  });

  it("leads a thread row with the thread, keeps the actor, and the thread wins the click", () => {
    const row = normalizeSiteNotification({
      __typename: "ThreadCommentReplyNotification",
      id: 3,
      createdAt: 5,
      user: { id: 7, name: "someone" },
      thread: { id: 99, title: "Weekly chapter talk" },
    });
    expect(row?.kind).toBe("THREAD_COMMENT_REPLY");
    expect(row?.title).toBe("Weekly chapter talk");
    expect(row?.actorName).toBe("someone");
    // Both a thread and a user are present; the thread is the news.
    expect(row?.target).toBe("/thread/99");
  });

  it("normalises private mail to null — ActivityMessageNotification is never rendered", () => {
    expect(
      normalizeSiteNotification({
        __typename: "ActivityMessageNotification",
        id: 4,
        createdAt: 5,
        user: { id: 7, name: "someone" },
      }),
    ).toBeNull();
  });

  it("normalises the unforeseen to null rather than guessing", () => {
    expect(normalizeSiteNotification(null)).toBeNull();
    expect(normalizeSiteNotification({})).toBeNull();
    expect(
      normalizeSiteNotification({ __typename: "SomeFutureNotification", id: 9, createdAt: 1 }),
    ).toBeNull();
    // A recognised shape without an id cannot be a React key or a read marker.
    expect(
      normalizeSiteNotification({ __typename: "AiringNotification", createdAt: 1 }),
    ).toBeNull();
  });

  it("a deletion keeps the dead title as the lead and goes nowhere", () => {
    const row = normalizeSiteNotification({
      __typename: "MediaDeletionNotification",
      id: 5,
      createdAt: 5,
      deletedMediaTitle: "Some Cancelled OVA",
      reason: "Duplicate of another entry",
    });
    expect(row?.title).toBe("Some Cancelled OVA");
    expect(row?.detail).toBe("Duplicate of another entry");
    expect(row?.target).toBeNull();
  });

  it("a merge joins the absorbed titles into the detail line, however they arrive", () => {
    const asList: RawSiteNotification = {
      __typename: "MediaMergeNotification",
      id: 6,
      createdAt: 5,
      deletedMediaTitles: ["Old Name", null, "Older Name", ""],
      media: { id: 10, title: { romaji: "Kept Name", english: null, native: null } },
    };
    expect(normalizeSiteNotification(asList)?.detail).toBe("Old Name, Older Name");
    // The schema says [String]; a defensive path for a bare string costs one line.
    expect(
      normalizeSiteNotification({ ...asList, deletedMediaTitles: "Old Name" })?.detail,
    ).toBe("Old Name");
  });

  it("submission updates target the staff or character page they concern", () => {
    expect(
      normalizeSiteNotification({
        __typename: "StaffSubmissionUpdateNotification",
        id: 7,
        createdAt: 5,
        status: "Accepted",
        staff: { id: 55, name: { full: "Kana Ichinose" } },
      }),
    ).toMatchObject({ title: "Kana Ichinose", detail: "Accepted", target: "/staff/55" });
    expect(
      normalizeSiteNotification({
        __typename: "CharacterSubmissionUpdateNotification",
        id: 8,
        createdAt: 5,
        character: { id: 66, name: { full: "Ichigo" } },
      }),
    ).toMatchObject({ title: "Ichigo", target: "/character/66" });
  });
});
