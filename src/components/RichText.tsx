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
 * `tauri.conf.json` sets `"csp": null`, so loading a remote image from a
 * stranger's bio is an unconditional request to a URL they chose, from a desktop
 * app holding an OAuth token — an IP beacon plus a "someone opened my profile"
 * signal. It also solves the layout problem for free, since bios routinely embed
 * 2000px-wide GIFs.
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
