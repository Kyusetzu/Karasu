import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

// The real App, shell included, over a mocked backend; `scripts/screens.mjs` drives it and names the parameters.
mockWindows("main");

const params = new URLSearchParams(location.search);
const theme = params.get("theme") ?? "dark";
const contrast = params.get("contrast") === "more";
const android = params.get("android") === "1";
// Signed out, so the overview shows the first-run screen instead of the lists.
const signedOut = params.get("out") === "1";
// A player running the first real title, so the detection window has something to show.
const playing = params.get("playing") === "1";
const route = params.get("route") ?? "/";
const style = params.get("style") ?? "";
const now = Math.floor(Date.now() / 1000);

/** Real banners and covers when `screens.mjs` has cached them, else generated gradients of the same shape. */
const cached = (await fetch("/scripts/screens/.cache/assets.json")
  .then((r) => (r.ok ? r.json() : {}))
  .catch(() => ({}))) as Record<string, { banner?: string; cover?: string }>;
const asset = (id: number, kind: "banner" | "cover") => {
  const file = cached[id]?.[kind];
  return file ? `/scripts/screens/.cache/${file}` : null;
};

const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
const PAIRS = [
  ["#ff7a59", "#7b2ff7"],
  ["#1fb5a8", "#0b3d5c"],
  ["#f6c85f", "#d1495b"],
  ["#5b8def", "#1b2a49"],
  ["#c86dd7", "#3023ae"],
  ["#59c173", "#1a4d2e"],
  ["#ff4e8a", "#4a0e4e"],
  ["#fbab7e", "#f7ce68"],
  ["#43cea2", "#185a9d"],
  ["#ee9ca7", "#5f2c82"],
];
const cover = (i: number) => {
  const [a, b] = PAIRS[i % PAIRS.length];
  return svg(
    460,
    650,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="460" height="650" fill="url(#g)"/><circle cx="${120 + ((i * 53) % 220)}" cy="${180 + ((i * 37) % 240)}" r="${90 + (i % 3) * 30}" fill="#fff" fill-opacity=".14"/>`,
  );
};
const banner = (i: number) => {
  const [a, b] = PAIRS[i % PAIRS.length];
  return svg(1900, 400, `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1900" height="400" fill="url(#g)"/>`);
};

const TITLES = ["Frieren: Beyond Journey's End", "The Apothecary Diaries", "Dungeon Meshi", "Oshi no Ko", "Kaiju No. 8", "Bocchi the Rock!", "Mob Psycho 100 III", "Vinland Saga Season 2", "Spy x Family", "Blue Lock", "Chainsaw Man", "Jujutsu Kaisen"];
/** The three titles `screens.mjs` fetches art for, first in every list so the grid opens on real covers. */
const REAL = [
  { id: 178789, title: "Mushoku Tensei: Jobless Reincarnation Season 3", native: "無職転生Ⅲ ～異世界行ったら本気だす～", episodes: 14, next: 9, score: 85, studio: "Studio Bind", genres: ["Adventure", "Drama", "Fantasy"] },
  { id: 135865, title: "Saga of Tanya the Evil Season 2", native: "幼女戦記Ⅱ", episodes: 12, next: 4, score: 80, studio: "NUT", genres: ["Action", "Fantasy"] },
  { id: 103303, title: "Sparks of Tomorrow", native: "二十世紀電氣目録", episodes: 13, next: 6, score: 76, studio: "Kyoto Animation", genres: ["Adventure", "Comedy", "Romance"] },
];
const STATUSES = ["CURRENT", "REPEATING", "COMPLETED", "PAUSED", "DROPPED", "PLANNING"] as const;

function media(i: number, manga: boolean) {
  const real = !manga && i < REAL.length ? REAL[i] : null;
  const art = real ? asset(real.id, "cover") : null;
  return {
    id: real?.id ?? (manga ? 2000 : 1000) + i,
    idMal: null,
    type: manga ? "MANGA" : "ANIME",
    title: real ? { romaji: real.title, english: real.title, native: real.native } : { romaji: TITLES[i % TITLES.length], english: null, native: null },
    coverImage: { large: art ?? cover(i), extraLarge: art ?? cover(i), color: null },
    bannerImage: real ? (asset(real.id, "banner") ?? banner(i)) : null,
    episodes: manga ? null : (real?.episodes ?? [12, 24, 13, 11, 25, 12][i % 6]),
    chapters: manga ? [120, 57, 300, 98][i % 4] : null,
    volumes: manga ? [12, 6, 30, 10][i % 4] : null,
    duration: 24,
    format: manga ? "MANGA" : ["TV", "TV", "MOVIE", "TV", "ONA"][i % 5],
    countryOfOrigin: "JP",
    status: real ? "RELEASING" : i % 5 === 0 ? "RELEASING" : "FINISHED",
    season: "SUMMER",
    seasonYear: 2026,
    nextAiringEpisode: real ? { episode: real.next, airingAt: now + 3600 * (5 + i * 20), timeUntilAiring: 3600 * (5 + i * 20) } : null,
    averageScore: real?.score ?? 68 + ((i * 7) % 25),
    genres: real?.genres ?? ["Action", "Drama"],
    isAdult: false,
    synonyms: [],
  };
}

function list(manga: boolean) {
  const entries = Array.from({ length: 36 }, (_, i) => {
    const m = media(i, manga);
    const status = i < 12 ? "CURRENT" : STATUSES[i % STATUSES.length];
    return {
      id: (manga ? 9000 : 5000) + i,
      mediaId: m.id,
      status,
      score: i % 3 === 0 ? 0 : 5 + (i % 5),
      progress: status === "COMPLETED" ? (m.episodes ?? 12) : i % 9,
      progressVolumes: manga ? i % 4 : 0,
      repeat: 0,
      notes: null,
      updatedAt: now - i * 3600,
      private: false,
      hiddenFromStatusLists: false,
      customLists: {},
      advancedScores: {},
      startedAt: { year: 2026, month: 3, day: 1 },
      completedAt: null,
      media: m,
    };
  });
  return {
    fromCache: false,
    pending: 0,
    fetchedAt: now,
    lists: STATUSES.map((status) => ({ name: status, status, isCustomList: false, entries: entries.filter((e) => e.status === status) })),
  };
}

const LISTS = { ANIME: list(false), MANGA: list(true) };
const viewer = {
  id: 1,
  name: "Kyusetzu",
  siteUrl: "https://anilist.co/user/Kyusetzu",
  avatar: { large: cover(4) },
  donatorTier: 0,
  mediaListOptions: { scoreFormat: "POINT_10" },
  options: { airingNotifications: true, notificationOptions: [] },
};

function detail(id: number) {
  const index = Math.max(0, REAL.findIndex((r) => r.id === id));
  const r = REAL[index];
  return {
    ...media(index, false),
    description: "Rudeus and his companions set out once more; a new chapter in a long journey, and a family scattered across a continent.",
    meanScore: r.score,
    popularity: 120000,
    favourites: 4000,
    isFavourite: false,
    isFavouriteBlocked: false,
    hashtag: null,
    source: "LIGHT_NOVEL",
    startDate: { year: 2026, month: 7, day: 5 },
    endDate: null,
    trailer: null,
    rankings: [],
    stats: { scoreDistribution: [36, 27, 56, 100, 189, 294, 684, 926, 944, 522].map((amount, k) => ({ score: (k + 1) * 10, amount })), statusDistribution: null },
    studios: { edges: [{ isMain: true, node: { id: 1, name: r.studio } }] },
    tags: [],
    externalLinks: [
      { id: 1, site: "Crunchyroll", url: "https://www.crunchyroll.com", type: "STREAMING", color: "#F88A36" },
      { id: 2, site: "Official Site", url: "https://example.org", type: "INFO", color: null },
      { id: 3, site: "Twitter", url: "https://x.com", type: "SOCIAL", color: "#1D9BF0" },
    ],
    mediaListEntry: { id: 5000 + index, status: "CURRENT", progress: 8, score: 8, repeat: 0, notes: null },
    relations: { edges: [] },
    characters: { edges: [] },
    staff: { edges: [] },
    recommendations: { nodes: [] },
  };
}

/** A small franchise around the first title: two earlier seasons, a side story and the source, some on the list. */
function franchise() {
  const node = (id: number, i: number, title: string, format: string, status: string | null, progress = 0) => ({
    id,
    type: format === "NOVEL" ? "MANGA" : "ANIME",
    title: { romaji: title, english: title, native: null },
    coverImage: { large: id === REAL[0].id ? media(0, false).coverImage.large : cover(i) },
    format,
    episodes: format === "NOVEL" ? null : 12,
    chapters: null,
    isAdult: false,
    genres: [],
    mediaListEntry: status ? { status, progress } : null,
  });
  const root = node(REAL[0].id, 0, REAL[0].title, "TV", "CURRENT", 8);
  const s2 = node(1101, 5, "Mushoku Tensei: Jobless Reincarnation Season 2", "TV", "COMPLETED", 12);
  const s1 = node(1102, 6, "Mushoku Tensei: Jobless Reincarnation", "TV", "COMPLETED", 12);
  const ova = node(1103, 7, "Mushoku Tensei: Eris the Goblin Slayer", "OVA", "PLANNING");
  const novel = node(1104, 8, "Mushoku Tensei (Light Novel)", "NOVEL", null);
  const edge = (relationType: string, n: ReturnType<typeof node>) => ({ relationType, node: n });
  const withRelations = (n: ReturnType<typeof node>, edges: ReturnType<typeof edge>[]) => ({ ...n, relations: { edges } });
  return [
    withRelations(root, [edge("PREQUEL", s2), edge("SOURCE", novel)]),
    withRelations(s2, [edge("PREQUEL", s1), edge("SEQUEL", root), edge("SIDE_STORY", ova)]),
    withRelations(s1, [edge("SEQUEL", s2)]),
    withRelations(ova, [edge("PARENT", s2)]),
    withRelations(novel, [edge("ADAPTATION", root)]),
  ];
}

/** Answers a passthrough query by the root field it asks for; anything else gets an empty but well-formed page. */
function answerQuery(query: string, variables: Record<string, unknown> | null) {
  const q = query.replace(/\s+/g, " ");
  if (/\bMedia\s*\(\s*id/.test(q)) return { Media: detail(Number(variables?.id ?? REAL[0].id)) };
  if (/airingSchedules/.test(q)) {
    const airing = REAL.map((r, i) => ({ id: 70 + i, episode: r.next, airingAt: now + 3600 * (5 + i * 20), timeUntilAiring: 3600 * (5 + i * 20), mediaId: r.id, media: media(i, false) }));
    return { Page: { pageInfo: { hasNextPage: false, total: 3 }, airingSchedules: airing } };
  }
  // The bell's AniList half: a run of likes that groups, a follow, an episode from yesterday and an older thread reply.
  if (/resetNotificationCount/.test(q)) {
    const user = (id: number, name: string) => ({ id, name });
    const notifications = [
      { __typename: "ActivityLikeNotification", id: 901, createdAt: now - 600, activityId: 5001, user: user(11, "Mikan") },
      { __typename: "ActivityLikeNotification", id: 902, createdAt: now - 1500, activityId: 5002, user: user(11, "Mikan") },
      { __typename: "FollowingNotification", id: 903, createdAt: now - 7200, user: user(12, "Hoshi") },
      { __typename: "AiringNotification", id: 904, createdAt: now - 100_000, episode: REAL[1].next - 1, media: { id: REAL[1].id, title: { romaji: REAL[1].title, english: REAL[1].title, native: null }, isAdult: false, genres: [] } },
      { __typename: "ThreadCommentReplyNotification", id: 905, createdAt: now - 260_000, commentId: 1, user: user(13, "Tsubame"), thread: { id: 44, title: "Frühjahr 2026: eure Favoriten" } },
    ];
    return { Page: { pageInfo: { hasNextPage: true, total: 5, currentPage: 1, lastPage: 2 }, notifications } };
  }
  if (/relations \{ edges \{ relationType node/.test(q) && /id_in/.test(q)) {
    const ids = new Set((variables?.ids as number[]) ?? []);
    return { Page: { media: franchise().filter((m) => ids.has(m.id)) } };
  }
  if (/\bPage\b/.test(q)) {
    const page = { media: Array.from({ length: 8 }, (_, i) => media(i, false)), recommendations: [], users: [], activities: [], threads: [], notifications: [], airingSchedules: [], characters: [], staff: [] };
    return { Page: { pageInfo: { hasNextPage: false, total: 8, currentPage: 1, lastPage: 1 }, ...page } };
  }
  if (/\bViewer\b/.test(q)) return { Viewer: { ...viewer, unreadNotificationCount: 3 } };
  return {};
}

const unknown = new Set<string>();
mockIPC((cmd, args) => {
  const a = (args ?? {}) as Record<string, unknown>;
  const type = (a.mediaType as "ANIME" | "MANGA") ?? "ANIME";
  switch (cmd) {
    case "plugin:event|listen":
      return 1;
    case "anilist_session":
      return signedOut ? null : viewer;
    case "get_profile_mode":
      return signedOut ? "none" : "anilist";
    case "platform_info":
      return { os: android ? "android" : "windows", appImage: false };
    case "fetch_media_list":
    case "local_fetch_list":
    case "cached_media_list":
      return LISTS[type];
    case "anilist_query":
      return answerQuery(String(a.query ?? ""), (a.variables as Record<string, unknown>) ?? null);
    case "get_notifications":
      return [
        { id: 1, kind: "airing", title: REAL[0].title, body: "Folge 9 ist erschienen", createdMs: Date.now() - 3_600_000, mediaId: REAL[0].id, read: false },
        { id: 2, kind: "sequel", title: REAL[2].title, body: "Eine Fortsetzung ist angekündigt", createdMs: Date.now() - 86_400_000, mediaId: REAL[2].id, read: true },
      ];
    case "app_version":
      return "screens";
    case "get_library_episodes":
      return {};
    case "get_text_scale":
      return 1;
    case "get_ui_zoom":
      return 100;
    case "get_now_playing":
      return playing
        ? { process: "mpv.exe", streaming: false, mediaType: "ANIME", rawTitle: `[Grp] ${REAL[0].title} - 0${REAL[0].next}.mkv`, parsedTitle: REAL[0].title, season: 3, episode: REAL[0].next, sourceEpisode: REAL[0].next, mediaId: REAL[0].id, matchedTitle: REAL[0].title, overridden: false, progress: REAL[0].next - 1, totalEpisodes: REAL[0].episodes, episodeTitle: null }
        : null;
    // Two edits waiting and a quiet budget, so the sync panel draws its queue rows and its header.
    case "sync_status":
      return {
        connected: true,
        draining: false,
        queued: [
          { id: 1, kind: "save", subject: REAL[0].id, fields: ["progress"], queuedAt: now - 120 },
          { id: 2, kind: "delete", subject: null, fields: [], queuedAt: now - 3600 },
        ],
        rate: { remaining: 27, limit: 30, observedAgoMs: 4000, throttledForMs: null, throttleKind: null },
        recent: [],
        traffic: { sources: [{ source: "list", total: 2 }, { source: "airing", total: 1 }], throttled: 0 },
      };
    case "get_update_check_auto":
    case "get_blur_adult":
      return false;
    case "local_all_entries":
      return [];
    case "get_content_filter":
      return "off";
    case "save_list_entry":
    case "local_save_entry":
      return { queued: false, entry: null };
    default:
      // Unanswered commands are listed for `screens.mjs`, which reports them beside page errors.
      if (!cmd.startsWith("plugin:") && !cmd.startsWith("set_")) unknown.add(cmd);
      (window as unknown as { __unknown: string[] }).__unknown = [...unknown];
      return null;
  }
});

const html = document.documentElement;
html.setAttribute("data-theme", theme);
if (style) html.setAttribute("data-dir", style);
localStorage.setItem("karasu-theme", theme);
localStorage.setItem("karasu-contrast", contrast ? "high" : "standard");
localStorage.setItem("karasu-reduce-motion", params.get("still") === "1" ? "true" : "false");
localStorage.setItem("karasu-cover-cols", android ? "4" : "8");
location.hash = route;

await import("@/app/index.css");
if (style) await import(/* @vite-ignore */ `/scripts/screens/.out/styles/${style}.css`);
await import("./app-main");
