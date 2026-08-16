import { describe, expect, it } from "vitest";
import type { QueuedEdit, SyncStatus } from "@/api/types";
import { isQueueField, queuedMediaId, syncPhase } from "./syncQueue";

const quiet = {
  remaining: 28,
  limit: 30,
  observedAgoMs: 1_200,
  throttledForMs: null,
  throttleKind: null,
};

const edit = (over: Partial<QueuedEdit> = {}): QueuedEdit => ({
  id: 1,
  kind: "save",
  subject: 5,
  fields: ["progress"],
  queuedAt: 1_700_000_000,
  ...over,
});

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  connected: true,
  draining: false,
  queued: [],
  rate: quiet,
  ...over,
});

describe("syncPhase", () => {
  it("reports an idle signed-in account as idle", () => {
    expect(syncPhase(status())).toBe("idle");
  });

  /**
   * The distinction the panel exists for. Local mode issues no request ever, so
   * an empty queue there is not "everything is synced" — it is "nothing syncs".
   */
  it("never calls a local list empty", () => {
    expect(syncPhase(status({ connected: false }))).toBe("offline");
    // Even with the exact shape an idle account would have.
    expect(syncPhase(status({ connected: false, queued: [], draining: false }))).toBe(
      "offline",
    );
  });

  it("puts a running drain above everything else", () => {
    expect(
      syncPhase(
        status({
          draining: true,
          queued: [edit()],
          rate: { ...quiet, throttledForMs: 118_000, throttleKind: "retryAfter" },
        }),
      ),
    ).toBe("draining");
  });

  /**
   * A queue parked on a 429 and a queue merely waiting its turn are different
   * answers to "why has this not sent yet", so the throttle wins.
   */
  it("prefers the reason over the backlog", () => {
    expect(
      syncPhase(
        status({ queued: [edit()], rate: { ...quiet, throttledForMs: 5_000 } }),
      ),
    ).toBe("throttled");
    expect(syncPhase(status({ queued: [edit()] }))).toBe("waiting");
  });

  /**
   * A throttle with nothing queued is still worth saying — a scrobble or an
   * alert pass may be the thing waiting.
   */
  it("reports a throttle with an empty queue", () => {
    expect(syncPhase(status({ rate: { ...quiet, throttledForMs: 900 } }))).toBe(
      "throttled",
    );
  });
});

describe("queuedMediaId", () => {
  // The trap, built on purpose: entry A's *list-entry* id is entry B's *media*
  // id. A lookup that tried both fields would resolve either row to whichever
  // it checked first, and label it with the wrong title.
  const entries = [
    { id: 500, mediaId: 1 },
    { id: 7, mediaId: 500 },
  ];

  it("reads a save's subject as a media id and nothing else", () => {
    expect(queuedMediaId({ kind: "save", subject: 500 }, entries)).toBe(500);
    // Not entry A, whose list-entry id is also 500.
    expect(queuedMediaId({ kind: "save", subject: 999 }, entries)).toBe(999);
  });

  it("reads a delete's subject as a list-entry id and nothing else", () => {
    expect(queuedMediaId({ kind: "delete", subject: 500 }, entries)).toBe(1);
    expect(queuedMediaId({ kind: "delete", subject: 7 }, entries)).toBe(500);
  });

  it("says nothing rather than guessing", () => {
    // A delete for an entry the loaded list no longer holds.
    expect(queuedMediaId({ kind: "delete", subject: 404 }, entries)).toBeNull();
    // A payload the backend could not parse.
    expect(queuedMediaId({ kind: "save", subject: null }, entries)).toBeNull();
    expect(queuedMediaId({ kind: "delete", subject: 500 }, [])).toBeNull();
  });
});

describe("isQueueField", () => {
  it("recognises the schema's own argument names", () => {
    expect(isQueueField("progress")).toBe(true);
    expect(isQueueField("scoreRaw")).toBe(true);
  });

  /** `scoreFormat` is stripped by the backend; anything else is new to us. */
  it("rejects what it has no label for", () => {
    expect(isQueueField("scoreFormat")).toBe(false);
    expect(isQueueField("somethingAniListAddedLater")).toBe(false);
  });
});
