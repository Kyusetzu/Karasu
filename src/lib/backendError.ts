/**
 * Turns a backend error into a sentence in the reader's language.
 *
 * A Tauri command's `Err(String)` reaches the frontend as text and is rendered
 * verbatim — there is no mapping layer anywhere — so every sentence composed in
 * Rust arrived in a German UI in English. The Rust side returns stable codes for
 * the failures a user actually meets; this maps them.
 *
 * The same shape as `blockedText` in `NowPlayingCard`: **a literal `t()` per
 * branch**, because `i18nKeys.test.ts` only sees those, and a key assembled
 * from the code would be invisible to every check in the suite.
 *
 * Anything unrecognised falls through unchanged. That is deliberate: transport
 * detail ("Could not reach the server: …") carries its diagnosis in the part no
 * dictionary covers, and a code whose translation went missing degrades to the
 * English sentence that shipped before rather than to an empty box.
 */
export function backendErrorText(
  error: unknown,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const text = error instanceof Error ? error.message : String(error);
  switch (text.trim()) {
    case "jellyfin.signedOut":
      return t("settings.jfErrSignedOut");
    case "jellyfin.noToken":
      return t("settings.jfErrNoToken");
    case "jellyfin.noUserId":
      return t("settings.jfErrNoUserId");
    case "jellyfin.badCredentials":
      return t("settings.jfErrBadCredentials");
    case "queue.busy":
      return t("receipt.syncBusy");
    case "anilist.rateLimited":
      return t("receipt.rateLimited");
    // The banner in `shell/SessionExpired` is the real answer to this one, but
    // the code still reaches a toast or an inline error on paths the banner
    // does not cover — and rendering the raw code would be worse than the
    // English sentence it replaced.
    case "anilist.tokenRejected":
      return t("auth.tokenRejected");
    default:
      return text;
  }
}
