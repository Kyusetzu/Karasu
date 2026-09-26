import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { parseAniListMarkdown, type MdNode } from "@/lib/anilistMarkdown";
import { ExternalAnchor, RichText, Spoiler } from "@/components/RichText";

/** Block AniList markdown from the parser's tree, never `dangerouslySetInnerHTML`; the site's renderer is the oracle. */

const HEADING_SIZE = [
  "text-lg",
  "text-base",
  "text-sm",
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
                className="overflow-x-auto rounded-control bg-surface-850 p-3 font-mono text-xs text-ink-300"
              >
                {n.text}
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-hair" />;
          case "center":
            // `text-align`, not flex; a flex row swallows `<br>` and glues image chips onto the text line above.
            return (
              <div key={i} className="space-y-2 text-center leading-loose">
                <Blocks nodes={n.children} />
              </div>
            );
          case "spoiler":
            // One button for the whole run and nothing of it in the DOM until pressed, as the inline `Spoiler` does.
            return (
              <Spoiler key={i} block>
                <Blocks nodes={n.children} />
              </Spoiler>
            );
        }
      })}
    </>
  );
}

/** Raw AniList markdown; `limit` truncates before parsing, bounding the work and not just the output. */
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
