import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Image, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  parseAniListMarkdown,
  type MdInline,
  type MdNode,
} from "@/lib/anilistMarkdown";

/**
 * Renders AniList markdown as React elements.
 *
 * There is no `dangerouslySetInnerHTML` here and there must never be one: the
 * parser's whole reason for producing a tree instead of an HTML string is that
 * this file cannot inject markup even by accident. Every branch below emits a
 * component, and the node union has no member carrying markup to emit.
 *
 * Lives in `social/` rather than `ui/` for one reason: it resolves `@name` to an
 * internal route, which is app knowledge. The parser, which is not, is in `lib/`.
 */

/** Opens outside the app. Tauri has no browser chrome, so a bare `<a>` would
 *  replace the whole window with someone else's page. */
function ExternalAnchor({
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
 * Not squeamishness: `tauri.conf.json` sets `"csp": null`, so loading a remote
 * image from a stranger's bio is an unconditional request to a URL they chose,
 * from a desktop app holding an OAuth token — an IP beacon plus a "someone
 * opened my profile" signal. It also solves the layout problem for free, since
 * bios routinely embed 2000px-wide GIFs.
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

/** Hidden until clicked, which is the only reason the parser keeps spoilers as
 *  their own node instead of flattening them into text. */
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

function Inline({ nodes }: { nodes: MdInline[] }) {
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
                <Inline nodes={n.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inline nodes={n.children} />
              </em>
            );
          case "strike":
            return (
              <s key={i} className="text-ink-600">
                <Inline nodes={n.children} />
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
            // The parser guarantees http/https or a leading slash, so an
            // internal path is safe to hand to the router.
            return n.href.startsWith("/") ? (
              <Link key={i} to={n.href} className="text-accent-400 hover:underline">
                <Inline nodes={n.children} />
              </Link>
            ) : (
              <ExternalAnchor key={i} href={n.href}>
                <Inline nodes={n.children} />
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
                <Inline nodes={n.children} />
              </Spoiler>
            );
          case "chip":
            return <Chip key={i} kind={n.kind} host={n.host} href={n.href} />;
        }
      })}
    </>
  );
}

const HEADING_SIZE = [
  "text-lg font-semibold",
  "text-base font-semibold",
  "text-sm font-semibold",
  "text-sm font-medium",
  "text-xs font-medium",
  "text-xs font-medium",
];

function Blocks({ nodes }: { nodes: MdNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "p":
            return (
              <p key={i}>
                <Inline nodes={n.children} />
              </p>
            );
          case "h": {
            const Tag = `h${n.level}` as "h1";
            return (
              <Tag key={i} className={cn("mt-3 text-ink-100", HEADING_SIZE[n.level - 1])}>
                <Inline nodes={n.children} />
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-surface-700 pl-3 text-ink-500"
              >
                <Inline nodes={n.children} />
              </blockquote>
            );
          case "list": {
            const Tag = n.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={cn(
                  "ml-4 space-y-0.5",
                  n.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {n.items.map((item, j) => (
                  <li key={j}>
                    <Inline nodes={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "codeBlock":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-lg bg-surface-850 p-3 font-mono text-xs text-ink-300"
              >
                {n.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-surface-800" />;
          case "center":
            // `flex-wrap` rather than `text-align`: the commonest centred block
            // is a row of image chips, and those are inline-flex buttons.
            return (
              <div
                key={i}
                className="flex flex-col items-center gap-1.5 text-center [&_p]:flex [&_p]:flex-wrap [&_p]:justify-center [&_p]:gap-1.5"
              >
                <Blocks nodes={n.children} />
              </div>
            );
        }
      })}
    </>
  );
}

/**
 * `source` is raw AniList markdown. `limit` is passed through to the parser,
 * which truncates *before* parsing — that is what bounds the work, not just the
 * output.
 */
export function Markdown({
  source,
  className,
  limit,
  siteUrl,
}: {
  source: string | null | undefined;
  className?: string;
  limit?: number;
  /** Where "read the rest" goes when the source was truncated. */
  siteUrl?: string;
}) {
  const { t } = useTranslation();
  const { nodes, truncated } = parseAniListMarkdown(source ?? "", limit ? { limit } : {});
  if (!nodes.length) return null;

  return (
    <div className={cn("space-y-2 text-sm leading-relaxed text-ink-300", className)}>
      <Blocks nodes={nodes} />
      {truncated && (
        <p className="text-xs text-ink-600">
          {siteUrl ? (
            <ExternalAnchor href={siteUrl}>{t("social.mdTruncated")}</ExternalAnchor>
          ) : (
            t("social.mdTruncated")
          )}
        </p>
      )}
    </div>
  );
}
