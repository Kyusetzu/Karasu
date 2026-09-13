import { describe, expect, it } from "vitest";
import { NOTIF_JOB_REFUSED, notifScheduleFailure } from "./notifSchedule";

// Vite's glob rather than `node:fs` (no node types in the frontend tsconfig); the options must stay an inline literal.
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

  /** Only Android sends the code, so a drift from `commands/prefs.rs` would surface as a raw code in a phone toast. */
  it("is spelled the way prefs.rs spells it", () => {
    const [rust] = Object.values(RUST);
    expect(rust).toBeDefined();
    expect(rust).toContain(`const NOTIF_JOB_REFUSED: &str = "${NOTIF_JOB_REFUSED}";`);
  });
});
