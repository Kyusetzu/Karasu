import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Image, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { fetchBioImage, isTauri } from "@/api/anilist";
import { cn } from "@/lib/utils";
import type { ChipWidth, MdInline } from "@/lib/anilistMarkdown";
import { internalRoute } from "@/lib/anilistUrl";
import { createPromiseCache } from "@/lib/promiseCache";

/** One fetch per URL per session, refusals included, so a re-render or a second open never asks Rust again. */
const bioImages = createPromiseCache((href: string) => fetchBioImage(href));

/** Whether the nodes are already inside a link, so a nested chip or spoiler does not fire the anchor's click too. */
const InLink = createContext(false);

/** Opens outside the app; Tauri has no browser chrome, so a bare `<a>` would replace the whole window. */
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

/** An image proxied through `commands/images.rs`, or the chip if that fails; the proxy stays, `img-src` never widens. */
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
    bioImages
      .get(href)
      .then((uri) => live && setSrc(uri))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [href]);

  if (failed) return <Chip kind="image" host={host} href={href} />;
  // Nothing while in flight: a chip that turns into an image would reflow the paragraph around it.
  if (!src) return null;

  // The declared width as an inline style: Tailwind only sees literal source, so a computed class emits no rule.
  const style = width ? { width: `${width.value}${width.unit}` } : undefined;

  // Inside a link the anchor is already the click target, so this renders as a plain image; see `InLink`.
  if (inLink) {
    return (
      <span
        style={style}
        className="my-1 inline-block max-w-full overflow-hidden rounded-control border border-hair align-middle"
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
      // Keep this inline-level: `~~~centered~~~` is `text-align: center`, which does nothing to a block box.
      className="my-1 inline-block max-w-full overflow-hidden rounded-control border border-hair align-middle"
    >
      {/* Bios embed huge GIFs; capped rather than scaled to the column so a small image is not blown up blurry. */}
      <img
        src={src}
        alt=""
        loading="lazy"
        // `w-full` rather than `max-w-full` so a declared width on the wrapper decides the size.
        className="max-h-80 w-full object-contain"
      />
    </button>
  );
}

/** The fallback, and the only rendering for video, which is never inlined; `media-src` forbids it anyway. */
function Chip({ kind, host, href }: { kind: "image" | "video"; host: string; href: string }) {
  const { t } = useTranslation();
  const inLink = useContext(InLink);
  const Icon = kind === "image" ? Image : Play;
  const className =
    "inline-flex max-w-full items-center gap-1.5 rounded-control border border-surface-700 bg-surface-850 px-2 py-1 align-middle text-xs text-ink-300 transition-surface hover:border-surface-600 hover:text-ink-100";
  const body = (
    <>
      <Icon className="size-3.5 shrink-0 text-ink-500" />
      <span className="truncate">
        {kind === "image" ? t("social.mdImage") : t("social.mdVideo")}
      </span>
      {host && <span className="shrink-0 truncate text-ink-600">· {host}</span>}
      <ExternalLink className="size-3.5 shrink-0 text-ink-600" />
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

/** Hidden until clicked, by absence rather than CSS, since invisible text is still selectable and still read aloud. */
export function Spoiler({ children, block = false }: { children: ReactNode; block?: boolean }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  if (shown) {
    return block ? (
      <div className="space-y-2 rounded-control border border-hair bg-surface-900/60 p-2">{children}</div>
    ) : (
      <span className="rounded-inner bg-surface-800 px-1">{children}</span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        // Revealing a spoiler inside a link must not also follow the link; `ExternalAnchor` listens on the bubble.
        e.stopPropagation();
        setShown(true);
      }}
      className={
        block
          ? "flex w-full items-center gap-1.5 rounded-control border border-surface-700 bg-surface-800 px-2.5 py-1.5 text-left text-xs text-ink-500 transition-surface hover:text-ink-300"
          : "rounded-inner bg-surface-700 px-1.5 text-xs text-ink-500 transition-surface hover:text-ink-300"
      }
    >
      {t("social.mdSpoiler")}
    </button>
  );
}

/** The one renderer for user-written text in the app, and there is no `dangerouslySetInnerHTML` in it. */
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
                className="rounded-inner bg-surface-850 px-1 py-0.5 font-mono text-[.8125em]"
              >
                {n.text}
              </code>
            );
          case "link": {
            // A leading slash is ours; `internalRoute` routes the anilist.co URLs the app can draw inward, else null.
            const to = n.href.startsWith("/") ? n.href : internalRoute(n.href);
            return to !== null ? (
              <Link key={i} to={to} className="text-accent-400 hover:underline">
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
          }
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
          case "centered":
            // `~~~x~~~` inside a line: a block-level span, so it takes its own line and centres it.
            return (
              <span key={i} className="block text-center">
                <RichText nodes={n.children} />
              </span>
            );
          case "accent":
            // A bare `<a>`, which anilist.co colours like a link; colour only, since it goes nowhere.
            return (
              <span key={i} className="text-accent-400">
                <RichText nodes={n.children} />
              </span>
            );
          case "chip":
            // Keyed by href too: `InlineImage` holds `failed` in state, so an index-only key latches a failure across edits.
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
