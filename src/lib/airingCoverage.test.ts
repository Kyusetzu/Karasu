import { describe, expect, it } from "vitest";
import type { Viewer } from "@/api/types";
import { anilistCoversAiring } from "./airingCoverage";

/** The fields this function reads; the rest of `Viewer` is irrelevant to it. */
const viewer = (options: Viewer["options"]): Viewer =>
  ({ id: 6421433, name: "Kyusetzu", siteUrl: "", avatar: null, options }) as Viewer;

describe("anilistCoversAiring", () => {
  it("takes both switches on as coverage", () => {
    expect(
      anilistCoversAiring(
        viewer({
          airingNotifications: true,
          notificationOptions: [
            { type: "FOLLOWING", enabled: true },
            { type: "AIRING", enabled: true },
          ],
        }),
      ),
    ).toBe(true);
  });

  // AniList's own default for a type it never stored, the same one `mergeNotificationOptions` applies.
  it("reads an unlisted AIRING entry as on", () => {
    expect(
      anilistCoversAiring(
        viewer({
          airingNotifications: true,
          notificationOptions: [{ type: "FOLLOWING", enabled: true }],
        }),
      ),
    ).toBe(true);
    expect(
      anilistCoversAiring(viewer({ airingNotifications: true, notificationOptions: null })),
    ).toBe(true);
  });

  // Two settings on separate AniList pages, and which one the server consults is undocumented.
  it("puts the row back when either switch is off", () => {
    expect(
      anilistCoversAiring(
        viewer({
          airingNotifications: false,
          notificationOptions: [{ type: "AIRING", enabled: true }],
        }),
      ),
    ).toBe(false);
    expect(
      anilistCoversAiring(
        viewer({
          airingNotifications: true,
          notificationOptions: [{ type: "AIRING", enabled: false }],
        }),
      ),
    ).toBe(false);
  });

  // A wrong "covered" is a notice the user never sees; a wrong "not covered" is only a duplicate row.
  it("keeps Karasu's own row for anything unknown", () => {
    expect(anilistCoversAiring(null)).toBe(false);
    expect(anilistCoversAiring(undefined)).toBe(false);
    expect(anilistCoversAiring(viewer(undefined)), "a blob cached before the field").toBe(false);
    expect(anilistCoversAiring(viewer(null))).toBe(false);
    expect(
      anilistCoversAiring(viewer({ airingNotifications: null, notificationOptions: [] })),
      "the flag absent",
    ).toBe(false);
  });
});
