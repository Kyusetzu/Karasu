import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useAuth } from "@/stores/auth";

/**
 * One banner for a token AniList has stopped accepting.
 *
 * The bug it replaces: `anilist_query` attaches the bearer to **every** request,
 * including the public ones behind search, seasonal, the forum and every detail
 * page. So one dead token failed all of them at once, each screen rendered its
 * own "Failed to load: Invalid token", and the app looked like it was breaking
 * at random rather than like a session that had expired. Nothing anywhere said
 * what to do about it — and `anilist_session` validates nothing, so the sidebar
 * went on showing the account as signed in.
 *
 * Above the content rather than inside a page, because the condition is not a
 * property of any one screen. Not a modal: reading a cached list is still
 * useful, and trapping the app behind a dialog would take that away.
 */
export default function SessionExpired() {
  const { t } = useTranslation();
  const expired = useAuth((s) => s.sessionExpired);
  const mode = useAuth((s) => s.mode);
  const login = useAniListLogin();

  // Local mode has no token to reject, and signed out already shows the
  // sign-in screen — a banner there would be asking for what is on offer.
  if (!expired || mode !== "anilist") return null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-danger/35 bg-danger/10 px-4 py-2"
    >
      <KeyRound aria-hidden className="size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-xs text-ink-200">
        <span className="font-medium text-danger">{t("auth.expiredTitle")}</span>{" "}
        {t("auth.expiredBody")}
      </p>
      <Button
        size="sm"
        onClick={() => void login.start()}
        disabled={login.waiting}
        className="shrink-0"
      >
        {login.waiting ? t("auth.expiredWaiting") : t("auth.expiredAction")}
      </Button>
    </div>
  );
}
