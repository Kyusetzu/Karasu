/**
 * Every external address, in one place. Nothing else in the site carries a
 * URL literal, so a moved repository or a renamed template is one edit here
 * and `verify-dist.mjs` can check the rendered page against this list.
 */
export const SITE_URL = "https://kyusetzu.github.io/Karasu/";

export const REPO = "https://github.com/Kyusetzu/Karasu";

export const LINKS = {
  repo: REPO,
  releases: `${REPO}/releases`,
  /** GitHub's alias for the newest non-prerelease — the Stable channel. */
  latest: `${REPO}/releases/latest`,
  /** The rolling per-commit build — the Nightly channel. */
  nightly: `${REPO}/releases/tag/latest`,
  issues: `${REPO}/issues`,
  bugReport: `${REPO}/issues/new?template=bug_report.yml`,
  featureRequest: `${REPO}/issues/new?template=feature_request.yml`,
  contributing: `${REPO}/blob/main/CONTRIBUTING.md`,
  security: `${REPO}/blob/main/SECURITY.md`,
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
  license: `${REPO}/blob/main/LICENSE`,
  readme: `${REPO}#readme`,
  discord: "https://discord.gg/yeHNSGyM8F",
  anilist: "https://anilist.co",
  anilistApi: "https://docs.anilist.co",
  taiga: "https://github.com/erengy/taiga",
} as const;

export const NAV = [
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How it works" },
  { id: "screenshots", label: "Screenshots" },
  { id: "platforms", label: "Platforms" },
  { id: "faq", label: "FAQ" },
] as const;

export const META = {
  title: "Karasu — A modern anime & manga tracker for AniList",
  description:
    "Karasu is a free, open-source anime and manga tracker built exclusively for AniList. It notices what you play — and, on Windows, what you read — and keeps your AniList progress in sync. Windows, Linux and Android.",
  themeColor: "#0b0d12",
} as const;
