import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Image, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchBioImage, isTauri } from "@/api/anilist";
import { cn } from "@/lib/utils";
import type { ChipWidth, MdInline } from "@/lib/anilistMarkdown";

/**
 * Whether the nodes being rendered are already inside a link.
 *
 * A linked image — `[img33(pic)](target)` — puts the chip *inside* the link's
 * children, which `anilistMarkdown.test.ts` pins as the real shape bios use. So
 * both the anchor and the image's own button called `openUrl`, and one click
 * opened two tabs: the picture and the link's target. `Chip` and `Spoiler` sit
 * in the same position and double-fired identically.
 *
 * Context rather than a prop because `RichText` recurses into its own children:
 * a prop would have to be threaded through every branch of the switch, and the
 * one branch that forgot would be the bug all over again.
 */
const InLink = createContext(false);

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
 * An image, fetched by Rust and inlined — or the chip below if that fails.
 *
 * **The measurement this replaces, and what it did and did not say.** Across 89
 * real bios containing 350 images, only 6 (2%) were on `*.anilist.co`; the rest
 * were imgur (147), tumblr (57), pinimg, postimg, catbox and discord. That
 * killed the idea of *widening `img-src`*, and it still does: an allowlist over
 * that tail hands an unbounded set of third parties the user's IP and which
 * profile they opened, and every render would repeat the request from the page
 * itself.
 *
 * Proxying is a different trade, and the maintainer took it. **The CSP does not
 * move.** `img-src 'self' data:` already permits the result, so the WebView
 * still never talks to imgur — what crosses the network is one bounded request
 * made in Rust, with a size cap, a content-type allowlist, a timeout, no cookies
 * and no `Referer`, and with local and private hosts refused so a crafted bio
 * cannot make the app probe the LAN. See `commands/images.rs`.
 *
 * The host still learns the user's IP. That is unavoidable in any design that
 * shows the image at all, and it is the honest residue rather than the part that
 * was solved.
 *
 * Anything that fails — refused host, wrong type, too large, unreachable, or not
 * running under Tauri at all — falls back to the chip, which is exactly what
 * shipped before. About one profile in twelve is images and nothing else, so
 * that fallback is still the entire visible content of those.
 */
function InlineImage({
  host,
  href,
  width,
}: {
  host: string;
  href: string;
  width?: ChipWidth;
}) {
  const inLink = useContext(InLink);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isTauri) return setFailed(true);
    let live = true;
    fetchBioImage(href)
      .then((uri) => live && setSrc(uri))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [href]);

  if (failed) return <Chip kind="image" host={host} href={href} />;
  // Nothing while it is in flight: a chip that turns into an image would reflow
  // the paragraph around it, and a bio is mostly one paragraph.
  if (!src) return null;

  // The author's declared width, applied as an inline style rather than a
  // class: Tailwind's scanner only ever sees literal source, so a computed
  // `w-[33px]` would emit no rule at all and silently do nothing.
  const style = width ? { width: `${width.value}${width.unit}` } : undefined;

  // Inside a link the surrounding anchor is already the click target, so this
  // renders as a plain image. See `InLink`.
  if (inLink) {
    return (
      <span
        style={style}
        className="my-1 inline-block max-w-full overflow-hidden rounded-lg border border-surface-800 align-middle"
      >
        <img src={src} alt="" loading="lazy" className="max-h-80 w-full object-contain" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openUrl(href)}
      title={href}
      style={style}
      // **Inline-level, not `block`.** `~~~centered~~~` renders as
      // `text-align: center` (see the `center` case in `Markdown.tsx`, whose
      // comment says exactly this), and `text-align` does nothing to a block
      // box — so a `block` image sat hard left inside a centred bio while the
      // text around it centred correctly. The chip this replaced was
      // `inline-flex` and inherited the alignment for free; this has to be
      // inline-level for the same reason.
      className="my-1 inline-block max-w-full overflow-hidden rounded-lg border border-surface-800 align-middle"
    >
      {/* Bios embed 2000px GIFs, which is why the chip never had a layout
          problem and this does. Capped rather than scaled to the column so a
          small image is not blown up into a blurry one. */}
      <img
        src={src}
        alt=""
        loading="lazy"
        // `w-full` rather than `max-w-full` so a declared width on the wrapper
        // is what decides the size; without a declared width the wrapper is
        // shrink-to-fit and the two are the same thing.
        className="max-h-80 w-full object-contain"
      />
    </button>
  );
}

/**
 * The fallback, and the only rendering for a video embed.
 *
 * Video is never inlined: it would be a media element pointed at a third party,
 * which is the exposure the proxy exists to avoid, and `media-src` does not
 * permit it anyway.
 */
function Chip({ kind, host, href }: { kind: "image" | "video"; host: string; href: string }) {
  const { t } = useTranslation();
  const inLink = useContext(InLink);
  const Icon = kind === "image" ? Image : Play;
  const className =
    "inline-flex max-w-full items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-850 px-2 py-1 align-middle text-xs text-ink-300 transition-surface hover:border-surface-600 hover:text-ink-100";
  const body = (
    <>
      <Icon className="size-3.25 shrink-0 text-ink-500" />
      <span className="truncate">
        {kind === "image" ? t("social.mdImage") : t("social.mdVideo")}
      </span>
      {host && <span className="shrink-0 truncate text-ink-600">· {host}</span>}
      <ExternalLink className="size-2.75 shrink-0 text-ink-600" />
    </>
  );
  // Inside a link the anchor is already the click target — see `InLink`.
  if (inLink) {
    return (
      <span title={href} className={className}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void openUrl(href)}
      title={href}
      className={className}
    >
      {body}
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
      onClick={(e) => {
        // Revealing a spoiler inside a link must not also follow the link —
        // `ExternalAnchor` listens on the bubble. See `InLink`.
        e.stopPropagation();
        setShown(true);
      }}
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
                <InLink.Provider value={true}>
                  <RichText nodes={n.children} />
                </InLink.Provider>
              </Link>
            ) : (
              <ExternalAnchor key={i} href={n.href}>
                <InLink.Provider value={true}>
                  <RichText nodes={n.children} />
                </InLink.Provider>
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
            // Keyed by href as well as position. `InlineImage` holds `failed`
            // in state, and an index-only key makes React reuse the instance
            // when the *document* changes under it — so the undebounced live
            // preview in `ProfileEditModal` latched one 404 and every image
            // typed after it rendered as a failure.
            //
            // Images are attempted inline; video is always a chip, and so is an
            // image past `MAX_INLINE_IMAGES`.
            return n.kind === "image" && !n.capped ? (
              <InlineImage
                key={`${i}:${n.href}`}
                host={n.host}
                href={n.href}
                width={n.width}
              />
            ) : (
              <Chip key={`${i}:${n.href}`} kind={n.kind} host={n.host} href={n.href} />
            );
        }
      })}
    </>
  );
}
