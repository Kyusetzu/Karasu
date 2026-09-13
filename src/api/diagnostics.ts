import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./anilist";

/** The diagnostics and log surface, kept apart from `anilist.ts` because none of it talks to AniList. */

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogEntry {
  ms: number;
  level: LogLevel;
  target: string;
  message: string;
}

export interface LinuxInfo {
  distro: string | null;
  desktop: string | null;
  session: string | null;
}

export interface Diagnostics {
  version: string;
  os: string;
  appImage: boolean;
  portable: boolean;
  dataDir: string;
  tray: boolean;
  schema: number;
  updateChannel: string;
  queued: number;
  signedIn: boolean;
  profileMode: string;
  libraryConfigured: boolean;
  libraryFiles: number;
  libraryMatched: number;
  mediaSessions: boolean;
  jellyfin: boolean;
  /** Which Jellyfin address answered last — "local" or "external"; null without a sign-in. */
  jellyfinBase: string | null;
  /** The mpv IPC pipe — the source that outranks every other one. */
  mpv: boolean;
  logDebug: boolean;
  linux: LinuxInfo | null;
}

export const diagnostics = () => invoke<Diagnostics>("diagnostics");

/** The markdown block for an issue. Redacted unless asked otherwise. */
export const diagnosticsReport = (redact = true) =>
  invoke<string>("diagnostics_report", { redact });

export const getLogs = (limit = 200) =>
  invoke<LogEntry[]>("get_logs", { limit });


export const getLogDebug = () => invoke<boolean>("get_log_debug");
export const setLogDebug = (enabled: boolean) =>
  invoke<void>("set_log_debug", { enabled });

/** Writes the report plus the log to a file the user picks. */
export const exportDiagnostics = (redact: boolean) =>
  invoke<boolean>("export_diagnostics", { redact });

/** Sends a frontend crash to the backend log, swallowing its own failure: a throw here is a crash inside the crash handler. */
export async function reportError(error: unknown, stack?: string) {
  const message = error instanceof Error ? error.message : String(error);
  const detail = stack ?? (error instanceof Error ? error.stack : undefined);
  if (!isTauri) {
    console.error("[karasu]", message, detail);
    return;
  }
  try {
    await invoke<void>("log_frontend_error", { message, stack: detail });
  } catch {
    console.error("[karasu] could not record the error", message);
  }
}

/** Puts the redacted report on the clipboard and reports whether it worked, so a failed copy is never silent. */
export async function copyDiagnostics(): Promise<boolean> {
  try {
    const text = await diagnosticsReport(true);
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The bug form, pre-selected. Where a report is meant to go. */
export const ISSUE_URL =
  "https://github.com/Kyusetzu/Karasu/issues/new?template=bug_report.yml";
