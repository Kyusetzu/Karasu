export interface Faq {
  q: string;
  a: string;
}

/** Every answer rests on a row in CONTENT-AUDIT.md. */
export const FAQ: Faq[] = [
  {
    q: "What is Karasu?",
    a: "A desktop and Android app that keeps your AniList anime and manga list. It notices what you are playing or reading and updates your progress on AniList by itself, and it gives that list a fast local interface with statistics, notifications and the social pages.",
  },
  {
    q: "Is it free?",
    a: "Yes. Karasu is free of cost and released under the MIT licence. There is no paid tier and nothing to unlock.",
  },
  {
    q: "Is it open source?",
    a: "Yes. The complete source is on GitHub, and every release is built there from a tagged commit.",
  },
  {
    q: "What is AniList?",
    a: "A free anime and manga database and tracking site at anilist.co. Your list lives there; Karasu reads it and writes to it through AniList's public API.",
  },
  {
    q: "Does Karasu replace AniList?",
    a: "No. It is a client for it. Your list stays on AniList and every change Karasu makes is visible on the website a moment later. You can also use Karasu without any account, with a local list only.",
  },
  {
    q: "Which platforms are supported?",
    a: "Windows and Android are Stable, Linux is an experimental AppImage, and there is no macOS build. Windows has every feature. Android has the list, statistics, notifications, widgets and the social pages, but no local library, no tray and no in-app updater. Detection differs: Windows reads media sessions, player and browser windows, mpv and Jellyfin; Linux reads media sessions, mpv and Jellyfin, with no window titles; Android reads Jellyfin.",
  },
  {
    q: "Does Karasu store my AniList credentials?",
    a: "It never sees your password. Signing in happens on anilist.co in your browser, which hands Karasu a token. That token is kept in your operating system's credential store on the desktop, in an encrypted file next to the app in portable mode, and in a Keystore-sealed file on Android — and it is never handed back to the app's web view.",
  },
  {
    q: "Can Karasu work offline?",
    a: "Your list is cached locally, so it opens without a network, a title on it shows its cached page with a working +1, and edits are queued and sent when the connection returns. Browsing titles that are not on your list, search and the social pages need the network.",
  },
  {
    q: "Does it update my AniList progress automatically?",
    a: "Yes, once an episode has played for two thirds of its length by default — or for the minutes you set, or after you confirm a toast, if you prefer to be asked. Progress only ever moves forward, and Karasu re-reads your list right before it writes.",
  },
  {
    q: "Is Karasu affiliated with AniList?",
    a: "No. It is an independent project using AniList's public API, with a registered client id and no special access.",
  },
  {
    q: "Why does Windows warn when I install it?",
    a: "The installer is not code-signed, so SmartScreen has never seen it before and says so. Every release ships a SHA256SUMS.txt you can check the download against.",
  },
  {
    q: "What does Karasu talk to?",
    a: "AniList's API and image servers; GitHub, for the update check and the download; the community's episode-relations data on GitHub, at most once a week; your own Jellyfin server if you set one up; Discord's local socket for Rich Presence if you enable it. Images in AniList user bios are fetched through Karasu's own bounded proxy, so those hosts learn your IP address when you open a profile. Nothing else, and no analytics.",
  },
];
