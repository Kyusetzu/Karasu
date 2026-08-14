import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Ban, Pencil, UserRound } from "lucide-react";
import {
  followCounts,
  followers,
  following,
  userProfile,
  type UserProfile as UserProfileData,
} from "@/api/social";
import { isTauri } from "@/api/anilist";
import BackButton from "@/components/shell/BackButton";
import { ProfileHeader } from "@/components/social/ProfileHeader";
import { UserList } from "@/components/social/UserList";
import { UserLists } from "@/components/social/UserLists";
import { ActivityFeed } from "@/components/social/ActivityFeed";
import { UserThreads } from "@/components/social/UserThreads";
import { CoverOutline, EmptyState, PerchRule, StruckQuery } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/user-lockup";
import { PresenceIf } from "@/components/ui/presence";
import { FavouritesModal } from "@/components/overlays/FavouritesModal";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { isSelf } from "@/lib/follows";
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
      {/* In flow above the banner rather than floating on it — the no-banner
          profile puts the avatar exactly where a floated button would sit. */}
      <div className="px-8 pt-4">
        <BackButton />
      </div>
      <ProfileHeader user={user} />
      <Tabbed user={user} />
    </div>
  );
}

const TABS = ["overview", "lists", "activity", "followers", "following", "forum"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return TABS.includes((value ?? "") as Tab);
}

/**
 * Tabs in the search param, not in state.
 *
 * `<main key={pathname}>` in `App.tsx` does not remount on a search-param
 * change, so tabs switch in place, deep-link, and survive back and forward —
 * the same reasoning the settings panes already use for `?pane=`.
 *
 * Each panel is **mounted on activation rather than gated with `enabled`**.
 * An unmounted query has no observer, so it cannot join a refetch either, and
 * within `gcTime` switching back is free. It also keeps the two-queries-per-
 * mount cap honest: tab content arrives at a second, user-initiated moment
 * instead of racing the profile's own pair past the rate limiter's pre-flight
 * check.
 */
function Tabbed({ user }: { user: UserProfileData }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "overview";

  const counts = useQuery({
    queryKey: ["social", "followCounts", user.id],
    queryFn: () => followCounts(user.id),
    enabled: isTauri,
    staleTime: 10 * 60 * 1000,
  });

  const tabCount: Record<Tab, number | undefined> = {
    overview: undefined,
    lists: undefined,
    // No count for activity: AniList's total there is a capped 5000.
    activity: undefined,
    followers: counts.data?.followers,
    following: counts.data?.following,
    // Threads are capped at 5000 like everything else paginated here.
    forum: undefined,
  };

  return (
    <div className="mt-7 px-8">
      <div role="tablist" className="flex gap-1 border-b border-surface-800">
        {TABS.map((id) => {
          const active = id === tab;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => {
                // `replace` so a tab flick does not fill the back stack with
                // steps the user has to walk out of.
                const next = new URLSearchParams(params);
                if (id === "overview") next.delete("tab");
                else next.set("tab", id);
                setParams(next, { replace: true });
              }}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-surface",
                active
                  ? "border-accent-500 text-ink-100"
                  : "border-transparent text-ink-600 hover:text-ink-300",
              )}
            >
              {id === "overview"
                ? t("social.tabOverview")
                : id === "lists"
                  ? t("social.tabLists")
                  : id === "activity"
                    ? t("social.tabActivity")
                    : id === "followers"
                      ? t("social.followers")
                      : id === "following"
                        ? t("social.tabFollowing")
                        : t("social.tabForum")}
              {tabCount[id] !== undefined && (
                <span className="ml-1.5 text-xs tabular-nums text-ink-600">
                  {tabCount[id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Keyed on the tab so the panel replays `animate-settle`, exactly as the
          settings panes do. */}
      <div key={tab} className="animate-settle pt-6">
        {tab === "overview" && <Favourites user={user} />}
        {tab === "lists" && <UserLists user={user} />}
        {tab === "activity" && (
          <ActivityFeed
            queryKey={["social", "activities", user.id]}
            source={{ userId: user.id }}
            emptyTitle={t("social.noActivity", { name: user.name })}
          />
        )}
        {tab === "followers" && (
          <UserList
            queryKey={["social", "followers", user.id]}
            fetchPage={(page) => followers(user.id, page)}
            emptyTitle={t("social.noFollowers", { name: user.name })}
          />
        )}
        {tab === "following" && (
          <UserList
            queryKey={["social", "following", user.id]}
            fetchPage={(page) => following(user.id, page)}
            emptyTitle={t("social.noFollowing", { name: user.name })}
          />
        )}
        {tab === "forum" && <UserThreads userId={user.id} name={user.name} />}
      </div>
    </div>
  );
}

function Favourites({ user }: { user: UserProfileData }) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const viewer = useAuth((s) => s.viewer);
  const self = isSelf(viewer?.id, user.id);
  const [editing, setEditing] = useState(false);

  // The filter has to run on other people's content too, and `favourites` takes
  // no `isAdult` argument, so it can only happen here.
  const anime = (user.favourites?.anime?.nodes ?? []).filter((m) => !isBlocked(m, level));
  const manga = (user.favourites?.manga?.nodes ?? []).filter((m) => !isBlocked(m, level));
  const characters = user.favourites?.characters?.nodes ?? [];
  const staff = user.favourites?.staff?.nodes ?? [];
  const studios = user.favourites?.studios?.nodes ?? [];

  const empty =
    !anime.length && !manga.length && !characters.length && !staff.length && !studios.length;

  const editButton = self ? (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        <Pencil className="size-3.5" />
        {t("social.editFavourites")}
      </Button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {editButton}

      {/* This is a whole tab now, so "nothing here" has to say so. Returning
          null was fine when favourites were one section among several; as a tab
          body it renders an empty page that reads as a failure. */}
      {empty && (
        <EmptyState
          visual={<CoverOutline />}
          title={t("social.noFavourites", { name: user.name })}
        />
      )}

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

      {/* People, as the character/staff strips the person pages already draw. */}
      {([
        ["characters", characters, "/character"],
        ["staff", staff, "/staff"],
      ] as const).map(([kind, list, base]) =>
        list.length ? (
          <section key={kind} className="space-y-3">
            <SectionHeader
              icon={UserRound}
              title={kind === "characters" ? t("social.favCharacters") : t("social.favStaff")}
              meta={String(list.length)}
            />
            <div className="flex gap-3 overflow-x-auto pb-2">
              {list.map((p) => (
                <Link key={p.id} to={`${base}/${p.id}`} className="w-20 shrink-0 text-center">
                  <Avatar src={p.image?.medium} name={p.name.full ?? ""} size="2xl" />
                  <p className="mt-1.5 line-clamp-2 text-2xs leading-snug text-ink-500">
                    {p.name.full}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}

      {studios.length > 0 && (
        <section className="space-y-3">
          <SectionHeader
            icon={UserRound}
            title={t("social.favStudios")}
            meta={String(studios.length)}
          />
          <div className="flex flex-wrap gap-1.5">
            {studios.map((s) => (
              <Link
                key={s.id}
                to={`/studio/${s.id}`}
                className="rounded-lg border border-surface-700 px-2.5 py-1.5 text-xs text-ink-300 transition-surface hover:border-surface-600 hover:text-ink-100"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Through `PresenceIf` so the dialog can animate out. */}
      <PresenceIf when={editing}>
        {(leaving) => (
          <FavouritesModal
            userId={user.id}
            onClose={() => setEditing(false)}
            leaving={leaving}
          />
        )}
      </PresenceIf>
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
      {/* The tab bar, so the header does not jump when the real one arrives.
          Widths written out: Tailwind scans source for literal class strings, so
          an interpolated `w-${n}` is a class that never gets emitted. */}
      <div className="mt-7 flex gap-4 border-b border-surface-800 pb-2">
        {["w-16", "w-20", "w-20"].map((w, i) => (
          <Shimmer key={i} className={cn("h-3 rounded", w)} index={i} />
        ))}
      </div>
    </div>
  );
}
