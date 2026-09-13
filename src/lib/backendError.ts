/** Maps a backend error code to a literal `t()` per branch so `i18nKeys.test.ts` sees it; unknown text falls through. */
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
    case "jellyfin.badUrl":
      return t("settings.jfErrBadUrl");
    case "jellyfin.notJellyfin":
      return t("settings.jfErrNotJellyfin");
    case "jellyfin.externalOtherServer":
      return t("settings.jfErrExternalOtherServer");
    case "jellyfin.externalUnknownServer":
      return t("settings.jfErrExternalUnknownServer");
    case "queue.busy":
      return t("receipt.syncBusy");
    case "anilist.rateLimited":
      return t("receipt.rateLimited");
    // `shell/SessionExpired` is the real answer, but the code still reaches toasts and inline errors it does not cover.
    case "anilist.tokenRejected":
      return t("auth.tokenRejected");
    default:
      return text;
  }
}
