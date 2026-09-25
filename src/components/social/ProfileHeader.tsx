import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Heart, Pencil, Shield, Sparkles } from "lucide-react";
import type { UserProfile } from "@/api/social";
import { Avatar } from "@/components/ui/user-lockup";
import { Button } from "@/components/ui/button";
import { PresenceIf } from "@/components/ui/presence";
import { ProfileEditModal } from "@/components/overlays/ProfileEditModal";
import { useAuth } from "@/stores/auth";
import { isSelf } from "@/lib/follows";
import { FollowButton } from "./FollowButton";
import { Markdown } from "./Markdown";
import { followRelation, relationBadgeKey } from "@/lib/follows";
import { donatorLabel } from "@/lib/donator";
import { toDisplayScale } from "@/lib/score";
import { cn } from "@/lib/utils";
import { BannerImage } from "@/components/media/BannerImage";
import { Chip } from "@/components/ui/chip";

/** `meanScore` arrives hundred-point and is shown ten-point on purpose: someone else's mean, on the neutral scale. */
function meanText(score: number | undefined | null): string | null {
  if (!score) return null; // 0 means "no scores", not "scored zero"
  return `★ ${toDisplayScale("POINT_10", score).toFixed(1)}`;
}

export function ProfileHeader({ user }: { user: UserProfile }) {
  const { t } = useTranslation();
  const relation = followRelation(user);
  const badgeKey = relationBadgeKey(relation);
  const donator = donatorLabel(user);
  const viewer = useAuth((s) => s.viewer);
  const self = isSelf(viewer?.id, user.id);
  const [editing, setEditing] = useState(false);
  const anime = user.statistics?.anime;
  const manga = user.statistics?.manga;

  return (
    <header className="relative">
      {/* The banner is the only user image loaded directly; `Markdown` covers the rest with chips. */}
      {user.bannerImage && (
        <div className="absolute inset-x-0 top-0 h-32 overflow-hidden">
          {/* Dimmed as before, since the name sits on it, but contained now rather than cropped to the strip. */}
          <BannerImage src={user.bannerImage} opacity={0.4} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-surface-950" />
        </div>
      )}

      <div className={cn("relative px-8", user.bannerImage ? "pt-16" : "pt-7")}>
        <div className="flex items-end gap-5">
          <Avatar src={user.avatar?.large} name={user.name} size="2xl" />
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-title font-bold text-ink-100">{user.name}</h1>
              {badgeKey && (
                <Chip tone="accent" size="xs">
                  {badgeKey === "social.badgeMutual"
                    ? t("social.badgeMutual")
                    : t("social.badgeFollowsYou")}
                </Chip>
              )}
              {/* `donatorLabel`, not `donatorBadge`: AniList returns the badge string for everyone (lib/donator.ts). */}
              {donator && (
                <Chip tone="gold" size="xs" icon={Heart}>
                  {donator}
                </Chip>
              )}
              {user.moderatorRoles && user.moderatorRoles.length > 0 && (
                <Chip tone="muted" size="xs" icon={Shield}>
                  {t("social.moderator")}
                </Chip>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
              {anime && anime.count > 0 && (
                <span>
                  {t("social.animeCount", { n: anime.count })}
                  {meanText(anime.meanScore) && ` · ${meanText(anime.meanScore)}`}
                </span>
              )}
              {manga && manga.count > 0 && (
                <span>
                  {t("social.mangaCount", { n: manga.count })}
                  {meanText(manga.meanScore) && ` · ${meanText(manga.meanScore)}`}
                </span>
              )}
              <button
                onClick={() => void openUrl(user.siteUrl)}
                className="flex items-center gap-1 text-accent-400 hover:underline"
              >
                {t("social.openOnAniList")} <ExternalLink className="size-2.75" />
              </button>
            </div>

            {/* A profile reached by an old link should say it was renamed rather than look like a different person. */}
            {user.previousNames.length > 0 && (
              <p className="mt-1 flex items-center gap-1 text-2xs text-ink-600">
                <Sparkles className="size-2.5" />
                {t("social.previouslyKnownAs", {
                  names: user.previousNames
                    .map((p) => p.name)
                    .filter(Boolean)
                    .join(", "),
                })}
              </p>
            )}
          </div>

          {self ? (
            <Button variant="secondary" size="control" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> {t("social.editProfile")}
            </Button>
          ) : (
            <FollowButton
              userId={user.id}
              name={user.name}
              flags={user}
              size="control"
            />
          )}
        </div>

        {user.about && (
          <Markdown
            source={user.about}
            siteUrl={user.siteUrl}
            className="mt-5 max-w-prose"
          />
        )}
      </div>

      {/* Through `PresenceIf` so the dialog can animate out; `{open && <Modal/>}` only ever has an entrance. */}
      <PresenceIf when={editing}>
        {(leaving) => (
          <ProfileEditModal
            viewerName={user.name}
            about={user.about}
            profileColor={user.options?.profileColor ?? null}
            onClose={() => setEditing(false)}
            leaving={leaving}
          />
        )}
      </PresenceIf>
    </header>
  );
}
