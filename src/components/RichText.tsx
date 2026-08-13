import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Image, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MdInline } from "@/lib/anilistMarkdown";

/**
 * Renders inline nodes as React elements. The only renderer for user-written
 * text in the app, and there is no `dangerouslySetInnerHTML` in it.
 *
 * Cross-cutting rather than in a folder, like `EmptyState` and `Skeleton`: two
 * unrelated things feed it. `lib/anilistMarkdown` parses bios, comments and
 * activity text; `lib/anilistHtml` parses media descriptions, which are HTML.
 * Both produce the same node union, so one renderer draws both — and the safety
 * argument only has to be made once.
 */

/** Opens outside the app. Tauri has no browser chrome, so a bare `<a>` would
 *  replace the whole window with someone else's page. */
export function ExternalAnchor({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
      className={cn("text-accent-400 hover:underline", className)}
    >
      {children}
    </a>
  );
}

/**
 * An image or embed, as a link rather than the thing itself.
 *
 * **Measured, after the CSP landed and made inlining look possible.** Across 89
 * real bios containing 350 images, **6 — two per cent — were on `*.anilist.co`**.
 * The rest were imgur (147), tumblr (57), pinimg, postimg, catbox, discord and a
 * dozen one-offs. So `img-src` cannot be widened to cover them without
 * allowlisting an unbounded set of third parties, each of which then learns the
 * user's IP and that they opened a particular profile — from a desktop app
 * holding an OAuth token. Inlining the 2% that *are* permitted would change
 * almost nothing on screen.
 *
 * The chip is therefore the answer, and the reason is stronger than the one this
 * comment used to give. It was "there is no CSP"; there is one now, and the point
 * stands anyway. Note what the policy *does* permit and what already renders
 * because of it: avatars, banners and cover art are all AniList-hosted and go
 * through plain `<img>`, so the images that carry meaning are inline and only
 * decorative bio art is a chip.
 *
 * A pleasant side effect either way: bios routinely embed 2000px-wide GIFs, and a
 * chip has no layout problem to solve.
 *
 * About one profile in twelve is images and nothing else, so this chip is the
 * entire visible content of those. It has to look deliberate.
 */
function Chip({ kind, host, href }: { kind: "image" | "video"; host: string; href: string }) {
  const { t } = useTranslation();
  const Icon = kind === "image" ? Image : Play;
  return (
    <button
      type="button"
      onClick={() => void openUrl(href)}
      title={href}
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-850 px-2 py-1 align-middle text-xs text-ink-300 transition-surface hover:border-surface-600 hover:text-ink-100"
    >
      <Icon className="size-3.25 shrink-0 text-ink-500" />
      <span className="truncate">
        {kind === "image" ? t("social.mdImage") : t("social.mdVideo")}
      </span>
      {host && <span className="shrink-0 truncate text-ink-600">· {host}</span>}
      <ExternalLink className="size-2.75 shrink-0 text-ink-600" />
    </button>
  );
}

/**
 * Hidden until clicked, and hidden by *absence* rather than by CSS — text that
 * is merely invisible is still selectable and still in the accessibility tree,
 * which is not what anyone means by a spoiler.
 */
function Spoiler({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  if (shown) return <span className="rounded bg-surface-800 px-1">{children}</span>;
  return (
    <button
      type="button"
      onClick={() => setShown(true)}
      className="rounded bg-surface-700 px-1.5 text-xs text-ink-500 transition-surface hover:text-ink-300"
    >
      {t("social.mdSpoiler")}
    </button>
  );
}

export function RichText({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return <span key={i}>{n.text}</span>;
          case "br":
            return <br key={i} />;
          case "strong":
            return (
              <strong key={i} className="font-semibold text-ink-100">
                <RichText nodes={n.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <RichText nodes={n.children} />
              </em>
            );
          case "strike":
            return (
              <s key={i} className="text-ink-600">
                <RichText nodes={n.children} />
              </s>
            );
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-surface-850 px-1 py-0.5 font-mono text-[.8125em]"
              >
                {n.text}
              </code>
            );
          case "link":
            // The parsers guarantee http/https or a leading slash, so an
            // internal path is safe to hand to the router.
            return n.href.startsWith("/") ? (
              <Link key={i} to={n.href} className="text-accent-400 hover:underline">
                <RichText nodes={n.children} />
              </Link>
            ) : (
              <ExternalAnchor key={i} href={n.href}>
                <RichText nodes={n.children} />
              </ExternalAnchor>
            );
          case "mention":
            return (
              <Link
                key={i}
                to={`/user/${encodeURIComponent(n.name)}`}
                className="text-accent-400 hover:underline"
              >
                @{n.name}
              </Link>
            );
          case "spoiler":
            return (
              <Spoiler key={i}>
                <RichText nodes={n.children} />
              </Spoiler>
            );
          case "chip":
            return <Chip key={i} kind={n.kind} host={n.host} href={n.href} />;
        }
      })}
    </>
  );
}
