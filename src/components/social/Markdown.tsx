import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { parseAniListMarkdown, type MdNode } from "@/lib/anilistMarkdown";
import { ExternalAnchor, RichText } from "@/components/RichText";

/**
 * Block-level AniList markdown: paragraphs, headings, quotes, lists, fences and
 * centred blocks. Inline content is `RichText`, which media descriptions share.
 *
 * There is no `dangerouslySetInnerHTML` here or there, and there must never be
 * one: the parser produces a tree instead of an HTML string precisely so this
 * file cannot inject markup even by accident.
 */

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
                <RichText nodes={n.children} />
              </p>
            );
          case "h": {
            const Tag = `h${n.level}` as "h1";
            return (
              <Tag key={i} className={cn("mt-3 text-ink-100", HEADING_SIZE[n.level - 1])}>
                <RichText nodes={n.children} />
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-2 border-surface-700 pl-3 text-ink-500"
              >
                <RichText nodes={n.children} />
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
                    <RichText nodes={item} />
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
            // `text-align`, not flex: a centred paragraph is still *lines*,
            // and a flex row swallows `<br>` — a break is not a flex item, so
            // image chips ended up glued onto the text line above them. Chips
            // are inline-flex, which is inline-level, so plain text-align
            // centres a row of them exactly as it centres words; the small
            // leading keeps a chip line from touching the text line above.
            return (
              <div key={i} className="space-y-2 text-center leading-loose">
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
