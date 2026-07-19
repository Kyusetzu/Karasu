import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { displayTitle, type ListResult, type MediaType } from "@/api/types";
import { useAuth } from "@/stores/auth";

interface Item {
  id: string;
  label: string;
  sub?: string;
  path: string;
}

const NAV: { path: string; key: string }[] = [
  { path: "/", key: "nav.dashboard" },
  { path: "/list", key: "nav.list" },
  { path: "/manga", key: "nav.manga" },
  { path: "/search", key: "nav.search" },
  { path: "/seasonal", key: "nav.seasonal" },
  { path: "/stats", key: "nav.stats" },
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Entries from the cached lists (searchable across all title variants).
  const entries = useMemo(() => {
    if (!open || !viewer) return [];
    const out: { item: Item; haystack: string }[] = [];
    const seen = new Set<number>();
    for (const type of ["ANIME", "MANGA"] as MediaType[]) {
      const data = qc.getQueryData<ListResult>(["mediaList", type, viewer.id]);
      for (const group of data?.lists ?? []) {
        if (group.isCustomList) continue;
        for (const e of group.entries) {
          if (seen.has(e.mediaId)) continue;
          seen.add(e.mediaId);
          const ti = e.media.title;
          out.push({
            item: {
              id: `m-${e.mediaId}`,
              label: displayTitle(ti),
              sub: type === "ANIME" ? t("nav.list") : t("nav.manga"),
              path: `/media/${e.media.id}`,
            },
            haystack: [ti.romaji, ti.english, ti.native, ...e.media.synonyms]
              .filter(Boolean)
              .join(" ")
              .toLowerCase(),
          });
        }
      }
    }
    return out;
  }, [open, viewer, qc, t]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navItems: Item[] = NAV.map((n) => ({
      id: n.path,
      label: t(n.key),
      sub: t("palette.page"),
      path: n.path,
    }));
    if (!q) return navItems;
    const nav = navItems.filter((i) => i.label.toLowerCase().includes(q));
    const media = entries
      .filter((e) => e.haystack.includes(q))
      .map((e) => e.item);
    return [...nav, ...media].slice(0, MAX_RESULTS);
  }, [query, entries, t]);

  useEffect(() => setSel(0), [query]);

  if (!open) return null;

  const go = (item: Item | undefined) => {
    if (!item) return;
    navigate(item.path);
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-surface-800 px-3">
          <Search size={16} className="text-ink-600" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("palette.placeholder")}
            className="h-12 flex-1 bg-transparent text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-ink-600">
              {t("palette.empty")}
            </li>
          ) : (
            results.map((item, i) => (
              <li key={item.id}>
                <button
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                    i === sel ? "bg-surface-800 text-ink-100" : "text-ink-300"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.sub && (
                    <span className="shrink-0 text-xs text-ink-600">
                      {item.sub}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
