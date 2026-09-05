import { describe, expect, it } from "vitest";
import { NOTIF_JOB_REFUSED, notifScheduleFailure } from "./notifSchedule";

// Vite's own glob rather than `node:fs`, the way notices.test.ts reads its
// files: the node types are not part of the frontend tsconfig. The options
// must be an inline literal — the plugin rewrites the call at transform time.
const RUST = import.meta.glob("/src-tauri/src/commands/prefs.rs", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("notifScheduleFailure", () => {
  it("reads the refusal code and keeps the platform's reason as the detail", () => {
    expect(
      notifScheduleFailure(`${NOTIF_JOB_REFUSED}: JobScheduler answered RESULT_FAILURE`),
    ).toEqual({ kind: "refused", detail: "JobScheduler answered RESULT_FAILURE" });
  });

  it("reports a bare code with an empty detail", () => {
    expect(notifScheduleFailure(NOTIF_JOB_REFUSED)).toEqual({ kind: "refused", detail: "" });
  });

  it("treats anything else as the write itself failing", () => {
    expect(notifScheduleFailure("database is locked")).toEqual({
      kind: "failed",
      detail: "database is locked",
    });
  });

  /**
   * The code is spelled twice — here and in `commands/prefs.rs` — and only
   * Android ever sends it, so a drift would surface as a raw code in a toast
   * on a phone and nowhere else. This is the one place both spellings meet.
   */
  it("is spelled the way prefs.rs spells it", () => {
    const [rust] = Object.values(RUST);
    expect(rust).toBeDefined();
    expect(rust).toContain(`const NOTIF_JOB_REFUSED: &str = "${NOTIF_JOB_REFUSED}";`);
  });
});
