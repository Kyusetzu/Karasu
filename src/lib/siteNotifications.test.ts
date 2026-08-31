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
      media: {
        id: 42,
        title: { romaji: "Sousou no Frieren", english: "Frieren", native: null },
        isAdult: false,
        genres: ["Adventure"],
      },
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
      // Carried through so the bell can apply the content filter: an
      // aired-episode line names a title just as a cover shows one.
      media: { isAdult: false, genres: ["Adventure"] },
    });
  });

  it("targets the activity itself when the row carries one", () => {
    const row = normalizeSiteNotification({
      __typename: "ActivityLikeNotification",
      id: 3,
      createdAt: 5,
      activityId: 4242,
      user: { id: 7, name: "Alice" },
    });
    expect(row?.kind).toBe("ACTIVITY_LIKE");
    expect(row?.title).toBe("Alice");
    // The press goes to the news; the bell renders the name as the
    // profile's own link off `actorName`/`userId`.
    expect(row?.target).toBe("/activity/4242");
    expect(row?.activityId).toBe(4242);
    expect(row?.userId).toBe(7);
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

  it("lands a thread reply on the comment itself when the id is carried", () => {
    const row = normalizeSiteNotification({
      __typename: "ThreadCommentReplyNotification",
      id: 4,
      createdAt: 5,
      commentId: 555,
      user: { id: 7, name: "someone" },
      thread: { id: 99, title: "Weekly chapter talk" },
    });
    expect(row?.target).toBe("/thread/99?comment=555");
  });

  it("a thread like stays thread-level — it has no comment to land on", () => {
    const row = normalizeSiteNotification({
      __typename: "ThreadLikeNotification",
      id: 5,
      createdAt: 5,
      user: { id: 7, name: "someone" },
      thread: { id: 99, title: "Weekly chapter talk" },
    });
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

  // A row about a hidden title must be droppable by the caller, which needs
  // the fields to judge with. The query asked for neither before this, so the
  // bell was the one surface where a filtered title could still be named.
  it("carries the filter fields for a title it is about", () => {
    const row = normalizeSiteNotification({
      __typename: "AiringNotification",
      id: 9,
      createdAt: 1,
      episode: 3,
      media: { id: 7, title: { romaji: "X", english: null, native: null }, isAdult: true, genres: ["Hentai"] },
    });
    expect(row?.media).toEqual({ isAdult: true, genres: ["Hentai"] });
  });

  it("has no media to judge for a row that is not about a title", () => {
    const row = normalizeSiteNotification({
      __typename: "ThreadLikeNotification",
      id: 10,
      createdAt: 1,
      user: { id: 2, name: "Bob" },
      thread: { id: 5, title: "A thread" },
    });
    expect(row?.media).toBeNull();
  });
});
