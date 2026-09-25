import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { displayTitle, type ListResult, type MediaType } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { searchTitles } from "@/lib/search";
import {
  fuzzyScore,
  prepareDoc,
  prepareQuery,
  type FuzzyDoc,
} from "@/lib/fuzzy";
import { MenuGroupLabel, MenuRowBody, MenuRowNote, menuRowClass } from "@/components/ui/menu-row";
import { cn } from "@/lib/utils";
import { isAndroid, usePlatform } from "@/stores/platform";
import { ANDROID_HIDDEN_ROUTES } from "@/components/shell/Sidebar";
import { usePresence } from "@/hooks/usePresence";
import { useBackClose } from "@/hooks/useBackClose";
import { resolveActions } from "@/lib/actions";
import { useActionLabel } from "@/components/shell/actionLabels";
import { useActionRunner } from "@/hooks/useActionRunner";
import { useManualSync } from "@/hooks/useManualSync";
import { useScoreFormat } from "@/stores/auth";
import { isTauri } from "@/api/anilist";

interface Item {
  id: string;
  label: string;
  sub?: string;
  /** Empty for a verb; `run` is what happens instead, so a command and a destination share one row. */
  path: string;
  run?: () => void;
  cover?: string | null;
  native?: string | null;
}

interface Group {
  key: string;
  items: Item[];
}

const NAV: { path: string; key: string }[] = [
  { path: "/", key: "nav.dashboard" },
  { path: "/list", key: "nav.list" },
  { path: "/manga", key: "nav.manga" },
  { path: "/search", key: "nav.search" },
  { path: "/seasonal", key: "nav.seasonal" },
  { path: "/calendar", key: "nav.calendar" },
  { path: "/social", key: "nav.social" },
  { path: "/forum", key: "nav.forum" },
  { path: "/stats", key: "nav.stats" },
  { path: "/wrapped", key: "nav.wrapped" },
  { path: "/library", key: "nav.library" },
  { path: "/about", key: "nav.about" },
  { path: "/settings", key: "nav.settings" },
];

const MAX_RESULTS = 30;

/** Global Ctrl/Cmd+K palette: fuzzy jump to a page or a list entry. */
export default function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const scoreFormat = useScoreFormat();
  const label = useActionLabel();
  const runAction = useActionRunner();
  const { available: syncAvailable } = useManualSync();
  const level = useContentFilter((s) => s.level);
  const android = isAndroid(usePlatform((s) => s.info));
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  useBackClose(open, () => setOpen(false));
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        // Stands down over another overlay unless it is this one, or Ctrl+K could never close the palette.
        if (!open && document.querySelector("[data-overlay]")) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // Also openable from the in-app context menu.
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
    // `open` is read by the overlay guard, so it is a dependency; re-registering two listeners costs nothing.
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Cached list entries, read past MediaList, so the content filter has to be applied here.
  const entries = useMemo(() => {
    if (!open || !viewer) return [];
    const out: { item: Item; doc: FuzzyDoc }[] = [];
    const seen = new Set<number>();
    for (const type of ["ANIME", "MANGA"] as MediaType[]) {
      const data = qc.getQueryData<ListResult>(["mediaList", type, viewer.id]);
      for (const group of data?.lists ?? []) {
        if (group.isCustomList) continue;
        for (const e of group.entries) {
          if (seen.has(e.mediaId)) continue;
          if (isBlocked(e.media, level)) continue;
          seen.add(e.mediaId);
          const ti = e.media.title;
          out.push({
            item: {
              id: `m-${e.mediaId}`,
              label: displayTitle(ti),
              sub: type === "ANIME" ? t("nav.list") : t("nav.manga"),
              path: `/media/${e.media.id}`,
              cover: e.media.coverImage.large,
              native: ti.native && ti.native !== displayTitle(ti) ? ti.native : null,
            },
            doc: prepareDoc(searchTitles(e.media)),
          });
        }
      }
    }
    return out;
  }, [open, viewer, qc, t, level]);

  // The verbs come from `lib/actions`, so the palette is a third presentation rather than a third list of commands.
  const commands = useMemo<Item[]>(() => {
    if (!open) return [];
    return resolveActions(
      { kind: "page" },
      {
        signedIn: viewer !== null || mode === "local",
        scoreFormat,
        scrobble: { phase: "idle", forceable: false, hasCurrent: false, overridden: false },
        tauri: isTauri,
        share: false,
        hasSelection: false,
        canSync: syncAvailable,
      },
    )
      .filter((a) => a.group === "command")
      .map((action) => ({
        id: `command:${action.id}`,
        label: label(action, "ANIME"),
        path: "",
        run: () => runAction({ action, target: { kind: "page" }, selection: "", entry: null }),
      }));
  }, [open, viewer, mode, scoreFormat, syncAvailable, label, runAction]);

  // Grouped: a page and a title are different kinds of hit, and one ranked list hides which is which.
  const groups = useMemo<Group[]>(() => {
    const q = query.trim();
    // The same hidden set the sidebar consults, so Ctrl+K is not a back door to the library on Android.
    const navItems: Item[] = NAV.filter(
      (n) => !(android && ANDROID_HIDDEN_ROUTES.has(n.path)),
    ).map((n) => ({
      id: n.path,
      label: t(n.key),
      path: n.path,
    }));
    if (!q) {
      return [
        { key: "palette.groupActions", items: commands },
        { key: "palette.groupGoTo", items: navItems },
      ].filter((g) => g.items.length > 0);
    }
    const pq = prepareQuery(q);
    // Ranked within each group; the stable sort keeps equal scores in cache-insertion order.
    const nav = navItems
      .map((item) => ({ item, score: fuzzyScore(prepareDoc([item.label]), pq) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    const media = entries
      .map((e) => ({ item: e.item, score: fuzzyScore(e.doc, pq) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((x) => x.item);
    const verbs = commands
      .map((item) => ({ item, score: fuzzyScore(prepareDoc([item.label]), pq) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    return [
      { key: "palette.groupList", items: media },
      { key: "palette.groupActions", items: verbs },
      { key: "palette.groupGoTo", items: nav },
    ].filter((g) => g.items.length > 0);
  }, [query, entries, t, android, commands]);

  // One flat order for the keyboard, so ↑↓ crosses group boundaries the way the eye does.
  const results = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setSel(0), [query]);

  // Keep `data-overlay` on the leaving panel, so the list behind cannot act on a keypress meant for it.
  if (!presence.mounted) return null;

  // Keeps the highlighted row in view; `block: "nearest"` so the list moves only when it has to.
  const rowRef = (i: number) => (el: HTMLLIElement | null) => {
    if (el && i === sel) el.scrollIntoView({ block: "nearest" });
  };

  const go = (item: Item | undefined) => {
    if (!item) return;
    if (item.run) item.run();
    else navigate(item.path);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[sel]);
    }
  };

  return (
    <div
      data-overlay
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pb-4 pt-22",
        presence.leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={() => setOpen(false)}
    >
      <div
        className={cn(
          "w-full max-w-136 overflow-hidden rounded-panel border border-hair bg-surface-900 shadow-float panel-wash",
          presence.leaving ? "animate-settle-out" : "animate-spring-in",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-3.5">
          <Search className="size-4 shrink-0 text-ink-600" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            // The caret stays on the input, so a screen reader is told which row is highlighted.
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={
              results.length > 0 ? `palette-item-${sel}` : undefined
            }
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none"
          />
          <kbd className="shrink-0 rounded-inner border border-surface-700 bg-surface-850 px-1.5 py-0.5 font-brand text-2xs font-semibold text-ink-600">
            ESC
          </kbd>
        </div>

        <div id="palette-results" role="listbox" className="max-h-96 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div role="option" aria-selected={false} aria-disabled className="px-2.5 py-3 text-sm text-ink-600">
              {t("palette.empty")}
            </div>
          ) : (
            // A listbox may hold groups and options only, so each group is named by a roleless label, not a heading.
            groups.map((group) => (
              <div key={group.key} role="group" aria-labelledby={`palette-group-${group.key}`}>
                <MenuGroupLabel id={`palette-group-${group.key}`} role="none">
                  {t(group.key)}
                </MenuGroupLabel>
                <ul role="none">
                  {group.items.map((item) => {
                    const i = results.indexOf(item);
                    return (
                      <li key={item.id} ref={rowRef(i)} role="none">
                        <button
                          id={`palette-item-${i}`}
                          role="option"
                          aria-selected={i === sel}
                          // Out of the tab order, so the caret never leaves the field and the drawn cursor is the only one.
                          tabIndex={-1}
                          data-highlighted={i === sel || undefined}
                          onMouseEnter={() => setSel(i)}
                          onClick={() => go(item)}
                          className={menuRowClass({ managed: true })}
                        >
                          <MenuRowBody
                            lead={
                              item.cover !== undefined && (
                                <span className="h-8 w-5.5 shrink-0 overflow-hidden rounded-inner bg-surface-800">
                                  {item.cover && <img src={item.cover} alt="" className="size-full object-cover" />}
                                </span>
                              )
                            }
                            trailing={item.sub && <MenuRowNote>{item.sub}</MenuRowNote>}
                          >
                            <span className="block truncate">{item.label}</span>
                            {item.native && (
                              <span className="block truncate font-brand-jp text-2xs text-ink-600">
                                {item.native}
                              </span>
                            )}
                          </MenuRowBody>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* The strip is the whole tutorial: nobody reads documentation for a palette, they read the bottom of it. */}
        <div className="flex items-center gap-3 border-t border-hair px-3.5 py-1.5 text-2xs text-ink-600">
          <span>{t("palette.hintMove")}</span>
          <span>{t("palette.hintRun")}</span>
          <span className="ml-auto">{t("palette.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}
