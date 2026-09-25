import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePresence } from "@/hooks/usePresence";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useAuth } from "@/stores/auth";

/** One banner above the whole shell for a token AniList stopped accepting; not a modal, the cached list is still useful. */
export default function SessionExpired() {
  const { t } = useTranslation();
  const expired = useAuth((s) => s.sessionExpired);
  const mode = useAuth((s) => s.mode);
  const login = useAniListLogin();

  // Local mode has no token to reject, and signed out already shows the sign-in screen.
  const show = expired && mode === "anilist";

  const { mounted, leaving } = usePresence(show);
  if (!mounted) return null;

  // Grows in and collapses away, so the shell below slides rather than jumping by the banner's height.
  return (
    <div className="disclosure-panel" data-leaving={leaving || undefined} inert={leaving || undefined}>
      <div className="min-h-0 overflow-hidden">
        <div role="status" className="flex items-center gap-3 border-b border-danger/35 bg-danger/10 px-4 py-2">
          <KeyRound aria-hidden className="size-4 shrink-0 text-danger" />
          <p className="min-w-0 flex-1 text-xs text-ink-100">
            <span className="font-medium text-danger">{t("auth.expiredTitle")}</span> {t("auth.expiredBody")}
          </p>
          <Button size="sm" onClick={() => void login.start()} disabled={login.waiting} className="shrink-0">
            {login.waiting ? t("auth.expiredWaiting") : t("auth.expiredAction")}
          </Button>
        </div>
      </div>
    </div>
  );
}
