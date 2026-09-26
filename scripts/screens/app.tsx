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
/** A named alternative state for one mocked command, such as `jellyfin-out` for a server not yet signed in to. */
const mock = params.get("mock") ?? "";
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
      // Finished titles carry a date this year, so the year in review has something to count.
      completedAt: status === "COMPLETED" ? { year: 2026, month: 1 + (i % 9), day: 1 + (i % 27) } : null,
      media: m,
    };
  });
  // The first real title leaves the list, so its detail page offers the add flow.
  const listed = mock === "off-list" ? entries.filter((e) => e.mediaId !== REAL[0].id) : entries;
  return {
    fromCache: false,
    pending: 0,
    fetchedAt: now,
    lists: STATUSES.map((status) => ({ name: status, status, isCustomList: false, entries: listed.filter((e) => e.status === status) })),
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

// The social surface: three people the viewer follows, a feed of both activity kinds, a thread with nested replies.
const person = (id: number, name: string, i: number) => ({ id, name, avatar: { medium: cover(i) }, isFollowing: id !== 1, isFollower: id === 11 });
const PEOPLE = [person(11, "Mikan", 5), person(12, "Hoshi", 6), person(13, "TsubameNoYume", 7), { ...person(1, "Kyusetzu", 4), isFollowing: false }];
const socialMedia = (i: number) => {
  const m = media(i, false);
  return { id: m.id, type: "ANIME", title: m.title, coverImage: { large: m.coverImage.large }, format: "TV", isAdult: false, genres: [] };
};
const activity = (id: number, user: number, ago: number, likes: number, replies: number, rest: Record<string, unknown>) => ({
  id,
  createdAt: now - ago,
  likeCount: likes,
  isLiked: likes % 2 === 1,
  isPinned: false,
  replyCount: replies,
  siteUrl: `https://anilist.co/activity/${id}`,
  user: PEOPLE[user],
  ...rest,
});
const ACTIVITIES = [
  activity(5001, 0, 600, 4, 2, { __typename: "ListActivity", status: "watched episode", progress: "7", media: socialMedia(0) }),
  activity(5002, 1, 1_500, 9, 3, { __typename: "TextActivity", text: "Folge 7 war __unfassbar__ schön, und wer schaut diese Saison mit? ~!Das Ende!~ hat mich erwischt." }),
  activity(5003, 2, 7_200, 12, 0, { __typename: "ListActivity", status: "completed", progress: null, media: socialMedia(1) }),
  activity(5004, 3, 20_000, 1, 0, { __typename: "ListActivity", status: "plans to watch", progress: null, media: socialMedia(2) }),
  activity(5005, 0, 90_000, 3, 1, { __typename: "ListActivity", status: "watched episode", progress: "1 - 3", media: socialMedia(3) }),
  activity(5006, 3, 170_000, 6, 4, { __typename: "TextActivity", text: "Neue Saison, neue Liste. Was sind eure Geheimtipps?" }),
];
const REPLIES = [
  { id: 7001, text: "Ich! Die Musik und die Szene am Fluss …", createdAt: now - 500, likeCount: 2, isLiked: false, user: PEOPLE[1] },
  { id: 7002, text: "Hab es gestern nachgeholt, @Mikan hatte recht.", createdAt: now - 300, likeCount: 0, isLiked: false, user: PEOPLE[3] },
];
const thread = (id: number, title: string, user: number, replies: number, ago: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  replyCount: replies,
  viewCount: replies * 37,
  likeCount: Math.round(replies / 3),
  isLiked: false,
  isSticky: false,
  isLocked: false,
  repliedAt: now - ago,
  createdAt: now - ago * 20,
  siteUrl: `https://anilist.co/forum/thread/${id}`,
  user: PEOPLE[user],
  replyUser: { id: PEOPLE[(user + 1) % 3].id, name: PEOPLE[(user + 1) % 3].name },
  categories: [{ id: 1, name: "Anime" }],
  ...extra,
});
const THREADS = [
  thread(40, "Forenregeln und Hinweise", 2, 3, 900_000, { isSticky: true, isLocked: true, categories: [{ id: 5, name: "Site Feedback" }] }),
  thread(44, "Frühjahr 2026: eure Favoriten", 0, 128, 900),
  thread(45, "Frieren Staffel 2 — Folge 7 Diskussion", 1, 342, 4_000, { categories: [{ id: 16, name: "Episode Discussion" }] }),
  thread(46, "Welche Manga sind gut für den Einstieg?", 2, 57, 26_000, { categories: [{ id: 2, name: "Manga" }] }),
  thread(47, "Kalender-Apps und Tracker — was nutzt ihr?", 1, 19, 80_000, { categories: [{ id: 7, name: "Apps" }] }),
];
const comment = (id: number, user: number, ago: number, text: string, children: unknown[] = []) => ({
  id,
  comment: text,
  likeCount: id % 5,
  isLiked: false,
  createdAt: now - ago,
  siteUrl: `https://anilist.co/forum/thread/44/comment/${id}`,
  user: PEOPLE[user],
  thread: { id: 44, title: THREADS[1].title },
  childComments: children,
});
const COMMENTS = [
  comment(801, 1, 80_000, "Für mich klar **Frieren**. Die Ruhe zwischen den Kämpfen trägt die ganze Staffel.", [
    comment(811, 0, 70_000, "Stimmt, und der Soundtrack hilft enorm.", [comment(821, 3, 60_000, "Den höre ich seit Wochen beim Arbeiten.")]),
    comment(812, 2, 50_000, "Die Kämpfe waren diesmal sogar besser und klarer als in Staffel 1."),
  ]),
  comment(802, 2, 40_000, "Dungeon Meshi hat mich überrascht — Kochen ist dort Worldbuilding."),
  comment(803, 3, 9_000, "Noch nicht angefangen, aber eure Liste ist jetzt meine Liste. ~!Hoffentlich kein Cliffhanger!~"),
];

// The statistics screen's one request: a plausible spread of genres, tags, people, formats, years and activity.
function userStats() {
  const row = (count: number, i: number) => ({ count, meanScore: 84 - i * 2, minutesWatched: count * 290, chaptersRead: count * 38 });
  const names = (list: string[], at: (name: string, i: number) => Record<string, unknown>) =>
    list.map((name, i) => ({ ...at(name, i), ...row(Math.max(1, 14 - i * 2), i) }));
  const person = (name: string, i: number) => ({ id: 500 + i, name: { full: name }, image: { medium: cover(i) } });
  const block = (manga: boolean) => ({
    count: 36,
    meanScore: manga ? 80 : 78,
    standardDeviation: 11.4,
    minutesWatched: 42_000,
    episodesWatched: 1_700,
    chaptersRead: 3_100,
    volumesRead: 210,
    genres: names(["Action", "Fantasy", "Adventure", "Drama", "Comedy", "Romance", "Sci-Fi", "Slice of Life"], (genre) => ({ genre })),
    tags: names(["Magic", "Male Protagonist", "Isekai", "Ensemble Cast", "Found Family", "Travel"], (name, i) => ({ tag: { id: 90 + i, name } })),
    voiceActors: names(["Kana Hanazawa", "Yuuki Kaji", "Saori Hayami", "Takahiro Sakurai"], (name, i) => ({ voiceActor: person(name, i) })),
    studios: names(["MADHOUSE", "Studio Bind", "Trigger", "WIT STUDIO", "CloverWorks"], (name, i) => ({ studio: { id: 30 + i, name } })),
    staff: names(["Keiichirou Saitou", "Evan Call", "Yoshinobu Yamakawa"], (name, i) => ({ staff: person(name, i + 4) })),
    formats: [["TV", 24], ["MOVIE", 4], ["OVA", 3], ["ONA", 3], ["SPECIAL", 2]].map(([format, count], i) => ({ format, count, meanScore: 80 - i })),
    statuses: [["CURRENT", 6], ["COMPLETED", 20], ["PLANNING", 5], ["PAUSED", 2], ["DROPPED", 1], ["REPEATING", 2]].map(([status, count], i) => ({ status, count, meanScore: 78 - i })),
    scores: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((score, i) => ({ score, count: [0, 0, 1, 1, 2, 4, 8, 11, 6, 3][i] })),
    releaseYears: Array.from({ length: 12 }, (_, i) => ({ releaseYear: 2026 - i, count: [6, 7, 5, 4, 3, 3, 2, 2, 1, 1, 1, 1][i] })),
    startYears: Array.from({ length: 6 }, (_, i) => ({ startYear: 2021 + i, count: [3, 5, 6, 7, 8, 7][i], meanScore: 74 + i })),
    lengths: [["1", 4], ["2-6", 3], ["7-16", 14], ["17-28", 11], ["29-55", 3], ["56-100", 1]].map(([length, count], i) => ({ length, count, meanScore: 76 + i })),
    countries: [["JP", 31], ["CN", 3], ["KR", 2]].map(([country, count]) => ({ country, count })),
  });
  const day = 86_400;
  const today = Math.floor(now / day) * day;
  const activityHistory = Array.from({ length: 180 }, (_, i) => ({ date: today - i * day, amount: (i * 7) % 5 === 0 ? 0 : ((i * 13) % 9) + 1 }));
  return { User: { id: viewer.id, name: viewer.name, stats: { activityHistory }, statistics: { anime: block(false), manga: block(true) } } };
}

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
    mediaListEntry: mock === "off-list" && index === 0 ? null : { id: 5000 + index, status: "CURRENT", progress: 8, score: 8, repeat: 0, notes: null },
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
  if (/followers:\s*Page/.test(q))
    return { followers: { pageInfo: { total: 12 }, followers: [] }, following: { pageInfo: { total: 30 }, following: [] } };
  const pageOf = (rows: Record<string, unknown>) => ({ Page: { pageInfo: { hasNextPage: true, total: 5000, currentPage: 1, lastPage: 200 }, ...rows } });
  if (/activityReplies\s*\(/.test(q)) return pageOf({ activityReplies: REPLIES });
  if (/\bActivity\s*\(\s*id/.test(q)) return { Activity: ACTIVITIES.find((a) => a.id === Number(variables?.id)) ?? ACTIVITIES[1] };
  if (/activities\s*\(/.test(q)) {
    const own = variables?.userId != null ? ACTIVITIES.filter((a) => a.user.id === Number(variables.userId)) : ACTIVITIES;
    return pageOf({ activities: own });
  }
  if (/\bThreadComment\s*\(\s*id/.test(q)) return { ThreadComment: [COMMENTS[0]] };
  if (/threadComments\s*\(/.test(q)) return pageOf({ threadComments: COMMENTS });
  if (/\bThread\s*\(\s*id/.test(q)) {
    const summary = THREADS.find((t) => t.id === Number(variables?.id)) ?? THREADS[1];
    const body = "Welche Serien haben euch diese Saison am meisten gepackt?\n\nIch fange an: **Frieren** und *Dungeon Meshi*. Spoiler bitte mit ~!so!~ markieren.";
    return { Thread: { ...summary, body, isSubscribed: true, replyCommentId: 821, replyUser: PEOPLE[3], mediaCategories: [socialMedia(0), socialMedia(1)] } };
  }
  if (/threads\s*\(/.test(q)) return pageOf({ threads: THREADS });
  if (/\bPage\b/.test(q)) {
    const page = { media: Array.from({ length: 8 }, (_, i) => media(i, false)), recommendations: [], users: PEOPLE, followers: PEOPLE, following: PEOPLE, activities: [], threads: [], notifications: [], airingSchedules: [], characters: [], staff: [] };
    return { Page: { pageInfo: { hasNextPage: false, total: 8, currentPage: 1, lastPage: 1 }, ...page } };
  }
  if (/\bViewer\b/.test(q)) return { Viewer: { ...viewer, unreadNotificationCount: 3 } };
  // The signed-in account's own profile, so the AniList cards in Settings draw their fields rather than a skeleton.
  if (/activityHistory/.test(q)) return userStats();
  // A character and a voice actor with their shows, so the person pages draw full rather than not-found.
  const fav = { favourites: 12_480, isFavourite: false, isFavouriteBlocked: false };
  if (/\bCharacter\s*\(\s*id/.test(q))
    return {
      Character: {
        id: Number(variables?.id ?? 41),
        name: { full: "Roxy Migurdia", native: "ロキシー・ミグルディア", alternative: ["Roxy"] },
        image: { large: cover(3) },
        description: "Eine Magierin der Migurd und __Rudeus' erste Lehrerin__. ~!Später Professorin in Ranoa.!~",
        gender: "Female",
        age: "44",
        bloodType: null,
        dateOfBirth: { year: null, month: 5, day: 10 },
        siteUrl: "https://anilist.co/character/41",
        ...fav,
        media: { edges: [0, 1, 2, 3].map((i) => ({ characterRole: i === 0 ? "MAIN" : "SUPPORTING", voiceActors: [{ id: 500, name: { full: "Konomi Kohara" }, image: { medium: cover(5) } }], node: socialMedia(i) })) },
      },
    };
  if (/\bStaff\s*\(\s*id/.test(q))
    return {
      Staff: {
        id: Number(variables?.id ?? 500),
        name: { full: "Konomi Kohara", native: "小原好美" },
        image: { large: cover(5) },
        description: "Sprecherin aus Kanagawa, bekannt für __ruhige, trockene__ Rollen.",
        primaryOccupations: ["Voice Actor"],
        gender: "Female",
        age: 30,
        homeTown: "Kanagawa, Japan",
        yearsActive: [2014],
        languageV2: "Japanese",
        dateOfBirth: { year: 1995, month: 7, day: 23 },
        dateOfDeath: null,
        siteUrl: "https://anilist.co/staff/500",
        ...fav,
        staffMedia: { edges: [0, 1, 2, 3, 4, 5].map((i) => ({ staffRole: i % 2 ? "Main" : "Supporting", node: socialMedia(i) })) },
        characters: { nodes: [{ id: 41, name: { full: "Roxy Migurdia" }, image: { medium: cover(3) } }, { id: 42, name: { full: "Kobeni Higashiyama" }, image: { medium: cover(6) } }] },
      },
    };
  if (/\bUser\s*\(/.test(q)) {
    const list = { customLists: ["Rewatch"], splitCompletedSectionByFormat: false };
    // Someone else's profile by name draws the full header: banner, bio, favourites and a follow button.
    const other = PEOPLE.find((u) => u.id !== 1 && u.name === variables?.name);
    const favourites = { nodes: other ? [0, 1, 2, 3].map(socialMedia) : [] };
    return {
      User: {
        ...viewer,
        ...(other ? { ...other, siteUrl: `https://anilist.co/user/${other.name}`, avatar: { large: other.avatar.medium } } : {}),
        about: other ? "Schaut zu viel und liest zu wenig. **Frieren** ist Pflicht, ~!das Finale!~ auch." : "",
        bannerImage: other ? asset(REAL[0].id, "banner") ?? banner(0) : null,
        donatorBadge: "",
        moderatorRoles: null,
        createdAt: now - 3 * 365 * 86_400,
        updatedAt: now - 86_400,
        isFollowing: false,
        isFollower: false,
        isBlocked: false,
        previousNames: [],
        options: { titleLanguage: "ROMAJI", displayAdultContent: false, airingNotifications: true, profileColor: "purple", timezone: "+02:00", activityMergeTime: 30, staffNameLanguage: "ROMAJI_WESTERN", restrictMessagesToFollowing: false, disabledListActivity: [] },
        mediaListOptions: { scoreFormat: "POINT_10", rowOrder: "score", animeList: list, mangaList: list },
        statistics: { anime: { count: 36, meanScore: 78, minutesWatched: 42_000, episodesWatched: 1_700 }, manga: { count: 36, meanScore: 80, chaptersRead: 3_100, volumesRead: 210 } },
        favourites: { anime: favourites, manga: { nodes: [] }, characters: { nodes: [] }, staff: { nodes: [] }, studios: { nodes: [] } },
      },
    };
  }
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
    case "anilist_auth_info":
      return { hasBuiltinClientId: true, customClientId: null, callbackUrl: "http://127.0.0.1:53682/callback" };
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
          { id: 2, kind: "delete", subject: REAL[1].id, fields: [], queuedAt: now - 3600 },
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
    // The rest of Settings, filled in so each pane draws its populated state rather than its empty one.
    case "get_scrobble_settings":
      return { enabled: true, confirm: true, delayMin: 0, gapAuto: false };
    case "get_airing_notify":
    case "get_sequel_notify":
    case "get_media_detection":
      return true;
    case "get_close_to_tray":
      return { enabled: true, tray: true };
    case "get_stale_settings":
      return { enabled: true, months: 3 };
    case "get_jellyfin_settings":
      return {
        url: mock === "jellyfin-out" ? "" : "http://192.168.1.20:8096",
        connected: mock !== "jellyfin-out",
        userName: "kyu",
        serverName: "Wohnzimmer",
        device: mock === "jellyfin-out" ? "" : "KYU-PC",
        localDevice: "KYU-PC",
        externalUrl: "",
        externalVerified: null,
        externalPlainHttp: false,
      };
    case "get_jellyfin_background":
      return { enabled: android, supported: android, batteryExempt: android ? false : null };
    case "list_detection_overrides":
      return [{ title: "Sousou no Frieren", season: 2, mediaType: "ANIME", mediaId: REAL[0].id, displayTitle: REAL[0].title, episodeOffset: 0 }];
    case "get_mpv_ipc":
      return { enabled: false, path: "\\\\.\\pipe\\mpvsocket", defaultPath: "\\\\.\\pipe\\mpvsocket", launchPath: "" };
    case "get_autostart":
    case "get_apk_download_metered":
    case "get_log_debug":
      return false;
    case "get_notif_schedule":
      return 30;
    case "get_global_hotkey":
      return "Ctrl+Shift+K";
    case "get_update_channel":
      return "stable";
    case "get_discord_settings":
      return { enabled: true, appId: "", hasBuiltinAppId: true };
    case "get_backup_settings":
      return { enabled: true, keep: 7, dir: "C:\\Users\\kyu\\AppData\\Roaming\\dev.kyu.karasu\\backups" };
    // A scanned folder: a dozen matched titles, one close match, one manual, one with a next season inside, two unplaced.
    case "get_library_index":
      return LISTS.ANIME.lists.flatMap((l) => l.entries).slice(0, 12).map((e, i) => {
        const count = Math.min(e.media.episodes ?? 12, 4 + (i % 8));
        const files = Array.from({ length: count }, (_, n) => ({ episode: n + 1, path: `D:\\Anime\\${e.media.title.romaji}\\${String(n + 1).padStart(2, "0")}.mkv` }));
        return {
          mediaId: e.mediaId,
          episodes: files.map((f) => f.episode),
          files,
          score: i === 3 ? 0.82 : 1,
          sources: [{ title: e.media.title.romaji, season: -1 }],
          manual: i === 5,
          overflow: i === 7 ? { knownEpisodes: count - 2, extraFiles: 2, firstExtra: count - 1, hint: null } : null,
        };
      });
    case "get_library_status":
      return { path: "D:\\Anime", filesSeen: 131, matched: 12 };
    case "get_library_unmatched":
      return [
        { title: "Kowloon Generic Romance", season: -1, files: [{ episode: 1, path: "D:\\Anime\\Kowloon\\01.mkv" }], suggestion: null },
        { title: "Dan Da Dan", season: 2, files: [{ episode: 3, path: "D:\\Anime\\DDD S2\\03.mkv" }], suggestion: null },
      ];
    case "pending_update":
      return null;
    case "diagnostics_report":
      return "Karasu screens\nOS: Windows 11";
    case "apk_update_state":
      return { available: false, status: "none", version: null, reason: null, needsInstallPermission: false, received: 0, total: 0 };
    case "get_library_path":
      return "D:\\Anime";
    case "list_library_redirects":
      return [{ title: "Sousou no Frieren", season: -1, epFrom: 29, epTo: 38, mediaId: REAL[0].id, dstStart: 1 }];
    case "get_portable_status":
      return { portable: false, dir: "C:\\Users\\kyu\\AppData\\Roaming\\dev.kyu.karasu", other: null };
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
// A status colour picked too dark to tell from the panel, for the settings' contrast warning.
if (mock === "status-low") localStorage.setItem("karasu-status-colors", JSON.stringify({ PAUSED: "#3b3f4a" }));
location.hash = route;

await import("@/app/index.css");
if (style) await import(/* @vite-ignore */ `/scripts/screens/.out/styles/${style}.css`);
await import("./app-main");
