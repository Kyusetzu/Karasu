import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { ActivityFeed } from "@/components/social/ActivityFeed";
import { ActivityComposer } from "@/components/social/ActivityComposer";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/stores/auth";

/** The following feed as a stable sidebar page; the viewer comes from the store, so opening it costs one request. */
export default function Social() {
  const { t } = useTranslation();
  const loading = useAuth((s) => s.loading);
  const mode = useAuth((s) => s.mode);
  const viewer = useAuth((s) => s.viewer);

  if (loading) return null;

  if (mode !== "anilist" || !viewer) {
    return (
      <div className="px-8 pt-7">
        <h1 className="sr-only">{t("nav.social")}</h1>
        <EmptyState
          visual={<PerchRule />}
          title={t("social.needsAccount")}
          hint={t("social.needsAccountHint")}
          actions={
            <Link to="/settings?pane=account">
              <Button variant="secondary" size="sm">
                {t("social.goToSettings")}
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 pb-12 pt-7">
      <header className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-title font-bold">{t("nav.social")}</h1>
            {/* The Japanese sub-lockup every other screen header carries. */}
            <span className="font-brand-jp text-ui tracking-[.04em] text-ink-600">
              みんな
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-600">{t("social.feedSubtitle")}</p>
        </div>
        <Link to={`/user/${encodeURIComponent(viewer.name)}`}>
          <Button variant="secondary" size="sm">
            <Users className="size-3.5" /> {t("social.myProfile")}
          </Button>
        </Link>
      </header>

      <div className="mt-6 space-y-4">
        <ActivityComposer />
        <ActivityFeed
          queryKey={["social", "feed", viewer.id]}
          source={{ isFollowing: true }}
          emptyTitle={t("social.feedEmpty")}
          emptyHint={t("social.feedEmptyHint")}
        />
      </div>
    </div>
  );
}
