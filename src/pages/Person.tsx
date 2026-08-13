import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Heart, Users } from "lucide-react";
import {
  character,
  staff,
  studio,
  type CharacterDetail,
  type StaffDetail,
  type StudioDetail,
} from "@/api/social";
import { isTauri } from "@/api/anilist";
import BackButton from "@/components/shell/BackButton";
import { Avatar } from "@/components/ui/user-lockup";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState, StruckQuery } from "@/components/EmptyState";
import { Shimmer } from "@/components/Skeleton";
import { Markdown } from "@/components/social/Markdown";
import { MediaStrip } from "@/components/media/MediaStrip";
import { FavouriteButton } from "@/components/media/FavouriteButton";
import { cn } from "@/lib/utils";

/**
 * Characters, staff and studios — one component for three routes.
 *
 * They are the same page with different words: a portrait, some facts, a
 * description, and a row of titles with a role caption. Three files would be
 * three chances for the layout to drift, and the differences are small enough to
 * carry as data.
 *
 * These exist because the statistics screen already lists voice actors and staff
 * with portraits, and the detail page already lists studios — all of them dead
 * ends until now. Reached from those, and by id.
 *
 * One request per page. `description` here is **markdown, not HTML** — measured
 * across 24 staff and character samples, none carried a raw tag, while media
 * descriptions have `<br>` in every one. So it renders through `Markdown`, the
 * same path as a bio: no innerHTML, and spoilers stay behind a click.
 */
type Kind = "character" | "staff" | "studio";

/**
 * The three shapes, as a union.
 *
 * Declared rather than inferred because inference plus `as` casts collapsed the
 * shared fields to `{}`: TypeScript will happily read a property present on every
 * member of a union, but only if it can still see the union.
 */
type PersonData = CharacterDetail | StaffDetail | StudioDetail;

/**
 * Narrowing helpers, so nothing below needs a cast.
 *
 * The value is unused on purpose: `kind` is the discriminant and the data carries
 * no field that distinguishes the three, so these assert what the route already
 * knows rather than inspecting anything.
 */
const isCharacter = (_d: PersonData, k: Kind): _d is CharacterDetail => k === "character";
const isStaff = (_d: PersonData, k: Kind): _d is StaffDetail => k === "staff";
const isStudio = (_d: PersonData, k: Kind): _d is StudioDetail => k === "studio";

function useFuzzyDate() {
  const { i18n } = useTranslation();
  return (d: { year: number | null; month: number | null; day: number | null } | null) => {
    if (!d?.year && !d?.month) return null;
    // Month-and-day with no year is normal for a character's birthday, so the
    // year is genuinely optional rather than missing data.
    const parts = [d.day, d.month, d.year].filter((n): n is number => n != null);
    if (!parts.length) return null;
    if (d.year && d.month && d.day) {
      return new Date(d.year, d.month - 1, d.day).toLocaleDateString(i18n.language);
    }
    return parts.join(".");
  };
}

/** A label/value pair, only rendered when there is a value. */
function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className="text-sm text-ink-300">{value}</dd>
    </div>
  );
}

export default function Person({ kind }: { kind: Kind }) {
  const { id = "" } = useParams();
  const numericId = Number(id);
  const { t } = useTranslation();
  const fuzzy = useFuzzyDate();

  const q = useQuery<PersonData>({
    queryKey: ["person", kind, numericId],
    queryFn: () =>
      kind === "character"
        ? character(numericId)
        : kind === "staff"
          ? staff(numericId)
          : studio(numericId),
    enabled: isTauri && Number.isFinite(numericId) && numericId > 0,
    // People and studios barely change; their media list changes with the season.
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  if (!Number.isFinite(numericId) || numericId <= 0) {
    return (
      <div className="px-8 pt-7">
        <EmptyState visual={<StruckQuery query={id} />} title={t("person.notFound")} />
      </div>
    );
  }

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-8 pt-7" aria-hidden="true">
        <div className="flex gap-5">
          <Shimmer className="h-48 w-32 rounded-xl" />
          <div className="flex-1 space-y-2 pt-2">
            <Shimmer className="h-7 w-56 rounded" index={1} />
            <Shimmer className="h-3 w-40 rounded" index={2} />
            <Shimmer className="mt-4 h-3 w-full rounded" index={3} />
            <Shimmer className="h-3 w-4/5 rounded" index={4} />
          </div>
        </div>
      </div>
    );
  }

  // A *disabled* query is not a missing entry. TanStack reports `pending` with
  // `fetchStatus: "idle"` when `enabled` is false, and `isLoading` is false along
  // with it — so without this the not-found state below would claim the id does
  // not exist whenever the query simply never ran.
  if (q.fetchStatus === "idle" && !q.data && !q.error) return null;

  if (q.error || !q.data) {
    return (
      <div className="px-8 pt-7">
        <EmptyState
          visual={<StruckQuery query={id} />}
          title={t("person.notFound")}
          hint={t("person.notFoundHint")}
        />
      </div>
    );
  }

  // `id`, `favourites`, `siteUrl` and `isFavourite` exist on all three, so they
  // are read straight off the union; everything else goes through a guard.
  const data: PersonData = q.data;
  const ch = isCharacter(data, kind) ? data : null;
  const st = isStaff(data, kind) ? data : null;
  const su = isStudio(data, kind) ? data : null;

  const name = su ? (su.name ?? "") : ((ch ?? st)?.name.full ?? "");
  const native = ch?.name.native ?? st?.name.native ?? null;
  const image = (ch ?? st)?.image?.large ?? null;
  const description = (ch ?? st)?.description ?? null;
  const edges = (ch?.media ?? st?.staffMedia ?? su?.media)?.edges ?? [];

  return (
    <div className="mx-auto max-w-4xl px-8 pb-12 pt-7">
      <BackButton className="mb-4" />
      <header className="flex flex-wrap gap-5">
        {!su && (
          <div className="w-32 shrink-0 overflow-hidden rounded-xl bg-surface-850">
            {image ? (
              <img src={image} alt="" className="aspect-2/3 w-full object-cover" />
            ) : (
              <div className="grid aspect-2/3 w-full place-items-center">
                <Users className="size-8 text-ink-600" />
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-ink-100">{name}</h1>
          {native && (
            <p className="font-brand-jp text-sm tracking-[.04em] text-ink-600">{native}</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
            {su?.isAnimationStudio && <span>{t("person.animationStudio")}</span>}
            {st?.primaryOccupations?.length ? (
              <span>{st.primaryOccupations.join(" · ")}</span>
            ) : null}
            {data.favourites != null && data.favourites > 0 && (
              <span className="flex items-center gap-1">
                <Heart className="size-2.75" /> {data.favourites}
              </span>
            )}
            {data.siteUrl && (
              <button
                onClick={() => void openUrl(data.siteUrl!)}
                className="flex items-center gap-1 text-accent-400 hover:underline"
              >
                {t("person.openOnAniList")} <ExternalLink className="size-2.75" />
              </button>
            )}
          </div>

          <div className="mt-3">
            <FavouriteButton
              kind={kind}
              id={data.id}
              isFavourite={data.isFavourite}
              blocked={ch?.isFavouriteBlocked ?? st?.isFavouriteBlocked ?? false}
            />
          </div>

          {(ch || st) && (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
              <Fact label={t("person.gender")} value={ch?.gender ?? st?.gender} />
              <Fact label={t("person.age")} value={ch?.age ?? st?.age} />
              <Fact
                label={t("person.birthday")}
                value={fuzzy(ch?.dateOfBirth ?? st?.dateOfBirth ?? null)}
              />
              <Fact label={t("person.bloodType")} value={ch?.bloodType} />
              <Fact label={t("person.homeTown")} value={st?.homeTown} />
              <Fact label={t("person.language")} value={st?.languageV2} />
              <Fact
                label={t("person.yearsActive")}
                value={st?.yearsActive?.length ? st.yearsActive.join("–") : null}
              />
              <Fact
                label={t("person.died")}
                value={fuzzy(st?.dateOfDeath ?? null)}
              />
            </dl>
          )}

          {ch?.name.alternative?.length ? (
            <p className="mt-3 text-2xs text-ink-600">
              {t("person.alsoKnownAs", { names: ch.name.alternative.join(", ") })}
            </p>
          ) : null}
        </div>
      </header>

      {description && (
        <div className="mt-6 max-w-prose">
          <Markdown
            source={description}
            siteUrl={data.siteUrl ?? undefined}
            className="text-[.8125rem] leading-[1.75] text-pretty"
          />
        </div>
      )}

      {edges.length > 0 && (
        <section className={cn("mt-8 space-y-3")}>
          <SectionHeader
            icon={Users}
            title={su ? t("person.productions") : t("person.appearsIn")}
            meta={String(edges.length)}
          />
          <MediaStrip edges={edges} />
        </section>
      )}

      {/* A voice actor's most-favourited roles, which is the one thing a staff
          page has that the others do not. */}
      {st?.characters?.nodes?.length ? (
        <section className="mt-8 space-y-3">
          <SectionHeader icon={Users} title={t("person.characters")} />
          <div className="flex gap-3 overflow-x-auto pb-2">
            {st.characters.nodes.map((c) => (
              <Link key={c.id} to={`/character/${c.id}`} className="w-20 shrink-0 text-center">
                <Avatar src={c.image?.medium} name={c.name.full ?? ""} size="2xl" />
                <p className="mt-1.5 line-clamp-2 text-2xs leading-snug text-ink-500">
                  {c.name.full}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* A character's Japanese cast, deduplicated: the same actor across five
          seasons is one person, not five. */}
      {ch?.media?.edges?.length ? <VoiceActors edges={ch.media.edges} /> : null}
    </div>
  );
}

function VoiceActors({ edges }: { edges: NonNullable<CharacterDetail["media"]>["edges"] }) {
  const { t } = useTranslation();
  const seen = new Map<number, { id: number; name: string; image: string | null }>();
  for (const e of edges) {
    for (const va of e.voiceActors ?? []) {
      if (!seen.has(va.id)) {
        seen.set(va.id, { id: va.id, name: va.name.full ?? "", image: va.image?.medium ?? null });
      }
    }
  }
  const list = [...seen.values()];
  if (!list.length) return null;

  return (
    <section className="mt-8 space-y-3">
      <SectionHeader icon={Users} title={t("person.voicedBy")} />
      <div className="flex gap-3 overflow-x-auto pb-2">
        {list.map((va) => (
          <Link key={va.id} to={`/staff/${va.id}`} className="w-20 shrink-0 text-center">
            <Avatar src={va.image} name={va.name} size="2xl" />
            <p className="mt-1.5 line-clamp-2 text-2xs leading-snug text-ink-500">{va.name}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Thin wrappers so `App.tsx` reads as three routes rather than one with a prop. */
export function CharacterPage() {
  return <Person kind="character" />;
}
export function StaffPage() {
  return <Person kind="staff" />;
}
export function StudioPage() {
  return <Person kind="studio" />;
}
