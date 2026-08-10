import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Heart, Shield, Sparkles } from "lucide-react";
import type { UserProfile } from "@/api/social";
import { Avatar } from "@/components/ui/user-lockup";
import { FollowButton } from "./FollowButton";
import { Markdown } from "./Markdown";
import { followRelation, relationBadgeKey } from "@/lib/follows";
import { donatorLabel } from "@/lib/donator";
import { toTenPoint } from "@/lib/score";
import { cn } from "@/lib/utils";

/** A quiet outlined chip — donator, moderator, "follows you". */
function Badge({
  icon,
  children,
  tone = "muted",
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  tone?: "muted" | "accent" | "gold";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium",
        tone === "accent" && "border-accent-600 text-accent-400",
        tone === "gold" && "border-gold/40 text-gold",
        tone === "muted" && "border-surface-700 text-ink-500",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** `meanScore` arrives hundred-point while everything downstream is ten-point —
 *  the normalisation trap CLAUDE.md records for the statistics screen. */
function meanText(score: number | undefined | null): string | null {
  if (!score) return null; // 0 means "no scores", not "scored zero"
  return `★ ${toTenPoint(score).toFixed(1)}`;
}

export function ProfileHeader({ user }: { user: UserProfile }) {
  const { t } = useTranslation();
  const relation = followRelation(user);
  const badgeKey = relationBadgeKey(relation);
  const donator = donatorLabel(user);
  const anime = user.statistics?.anime;
  const manga = user.statistics?.manga;

  return (
    <header className="relative">
      {/* The banner is the only place a user's own image is loaded, and it is
          their own doing on their own profile. Chips cover the rest — see
          `Markdown`. */}
      {user.bannerImage && (
        <div className="absolute inset-x-0 top-0 h-32 overflow-hidden">
          <img
            src={user.bannerImage}
            alt=""
            className="size-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface-950" />
        </div>
      )}

      <div className={cn("relative px-8", user.bannerImage ? "pt-16" : "pt-7")}>
        <div className="flex items-end gap-5">
          <Avatar src={user.avatar?.large} name={user.name} size="2xl" />
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold text-ink-100">{user.name}</h1>
              {badgeKey && (
                <Badge tone="accent">
                  {badgeKey === "social.badgeMutual"
                    ? t("social.badgeMutual")
                    : t("social.badgeFollowsYou")}
                </Badge>
              )}
              {/* `donatorLabel`, not `donatorBadge` — the badge string is the
                  label and AniList returns it for everyone. See lib/donator.ts. */}
              {donator && (
                <Badge tone="gold" icon={<Heart className="size-2.5" />}>
                  {donator}
                </Badge>
              )}
              {user.moderatorRoles && user.moderatorRoles.length > 0 && (
                <Badge icon={<Shield className="size-2.5" />}>{t("social.moderator")}</Badge>
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

            {/* Renaming is a real AniList feature, and a profile reached by an
                old link should say so rather than look like a different person. */}
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

          <FollowButton
            userId={user.id}
            name={user.name}
            flags={user}
            size="control"
          />
        </div>

        {user.about && (
          <Markdown
            source={user.about}
            siteUrl={user.siteUrl}
            className="mt-5 max-w-prose"
          />
        )}
      </div>
    </header>
  );
}
