import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Ban, UserRound } from "lucide-react";
import { followCounts, userProfile } from "@/api/social";
import { isTauri } from "@/api/anilist";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { EmptyState, PerchRule, StruckQuery } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { displayTitle } from "@/api/types";
import { cn } from "@/lib/utils";

/**
 * Someone's AniList profile — the viewer's own included.
 *
 * Keyed on **name**, not id, because that is what AniList's own URLs carry,
 * what an `@mention` resolves to and what a pasted link contains. The id comes
 * back in the response and is what everything downstream keys on.
 *
 * Costs two requests cold: the profile, and the follower/following totals. The
 * totals need an id, which is only known once the profile resolves, so they
 * cannot share a document. Two is also the cap — the rate limiter in
 * `client.rs` reads its budget and releases the lock before any response header
 * lands, so it cannot see a burst it has not sent yet. Tab content therefore
 * mounts on tab activation, which is a second, user-initiated moment.
 */
export default function UserProfile() {
  const { name = "" } = useParams();
  const { t } = useTranslation();
  const loading = useAuth((s) => s.loading);
  const mode = useAuth((s) => s.mode);

  const profile = useQuery({
    queryKey: ["social", "user", name],
    queryFn: () => userProfile({ name }),
    enabled: isTauri && !!name && mode === "anilist",
    staleTime: 10 * 60 * 1000,
    // An unknown name is HTTP 404 from AniList, and the default `retry: 1` would
    // spend a second request confirming a typo.
    retry: false,
  });

  if (loading) return null;

  // The social graph belongs to an account. In local mode there is no viewer to
  // be following anyone, so this says so rather than rendering an empty profile.
  if (mode !== "anilist") {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={<PerchRule />}
          title={t("social.needsAccount")}
          hint={t("social.needsAccountHint")}
          actions={
            <Link to="/settings">
              <Button variant="secondary" size="sm">
                {t("social.goToSettings")}
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (profile.isLoading) return <ProfileSkeleton />;

  if (profile.error || !profile.data) {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={<StruckQuery query={name} />}
          title={t("social.notFound")}
          hint={t("social.notFoundHint")}
        />
      </div>
    );
  }

  const user = profile.data;

  // A blocked profile returns a real user object with empty everything. Saying
  // so beats rendering a profile that looks like an abandoned account.
  if (user.isBlocked) {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={
            <span className="grid size-12 place-items-center rounded-full bg-surface-800">
              <Ban className="size-5 text-ink-600" />
            </span>
          }
          title={t("social.blocked", { name: user.name })}
          hint={t("social.blockedHint")}
        />
      </div>
    );
  }

  return (
    <div className="pb-12">
      <ProfileHeader user={user} />
      <div className="mt-8 space-y-8 px-8">
        <FollowSummary userId={user.id} name={user.name} />
        <Favourites user={user} />
      </div>
    </div>
  );
}

/** The follower and following totals, in one request. */
function FollowSummary({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  const counts = useQuery({
    queryKey: ["social", "followCounts", userId],
    queryFn: () => followCounts(userId),
    enabled: isTauri,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <div className="flex gap-3">
      {(
        [
          ["followers", counts.data?.followers],
          ["following", counts.data?.following],
        ] as const
      ).map(([kind, total]) => (
        <div
          key={kind}
          className="panel-wash panel-top flex-1 rounded-xl border border-surface-800 bg-surface-900 p-4"
        >
          <p className="text-2xs uppercase tracking-wide text-ink-600">
            {kind === "followers" ? t("social.followers") : t("social.following")}
          </p>
          {total === undefined ? (
            <Shimmer className="mt-1.5 h-6 w-12 rounded" />
          ) : (
            <p className="mt-1 text-xl font-semibold tabular-nums text-ink-100">{total}</p>
          )}
          {/* The lists themselves arrive with the next commit; until then the
              counts are honest on their own and cost nothing extra. */}
          <p className="sr-only">{name}</p>
        </div>
      ))}
    </div>
  );
}

function Favourites({ user }: { user: Parameters<typeof ProfileHeader>[0]["user"] }) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);

  // The filter has to run on other people's content too, and `favourites` takes
  // no `isAdult` argument, so it can only happen here.
  const anime = (user.favourites?.anime?.nodes ?? []).filter((m) => !isBlocked(m, level));
  const manga = (user.favourites?.manga?.nodes ?? []).filter((m) => !isBlocked(m, level));
  if (!anime.length && !manga.length) return null;

  return (
    <div className="space-y-6">
      {([
        ["anime", anime],
        ["manga", manga],
      ] as const).map(([kind, list]) =>
        list.length ? (
          <section key={kind} className="space-y-3">
            <SectionHeader
              icon={UserRound}
              title={kind === "anime" ? t("social.favAnime") : t("social.favManga")}
              meta={String(list.length)}
            />
            <div className="flex gap-3 overflow-x-auto pb-1">
              {list.map((m) => (
                <Link
                  key={m.id}
                  to={`/media/${m.id}`}
                  title={displayTitle(m.title)}
                  className="group w-24 shrink-0"
                >
                  <div className="aspect-2/3 overflow-hidden rounded-lg bg-surface-850">
                    {m.coverImage?.large && (
                      <img
                        src={m.coverImage.large}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover transition-transform group-hover:scale-[1.03]"
                      />
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-2xs leading-snug text-ink-500 group-hover:text-ink-300">
                    {displayTitle(m.title)}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="px-8 pt-7" aria-hidden="true">
      <div className="flex items-end gap-5">
        <Shimmer className="size-20 rounded-full" />
        <div className="flex-1 space-y-2 pb-1">
          <Shimmer className="h-7 w-48 rounded" index={1} />
          <Shimmer className="h-3 w-64 rounded" index={2} />
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {[0, 1, 2].map((i) => (
          <Shimmer key={i} className={cn("h-3 rounded", i === 2 ? "w-1/2" : "w-full")} index={i + 3} />
        ))}
      </div>
      <div className="mt-8 flex gap-3">
        <Shimmer className="h-20 flex-1 rounded-xl" index={1} />
        <Shimmer className="h-20 flex-1 rounded-xl" index={2} />
      </div>
    </div>
  );
}
