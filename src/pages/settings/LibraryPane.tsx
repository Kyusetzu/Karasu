import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
import { mediaByIds } from "@/api/queries";
import { displayTitle } from "@/api/types";
import * as api from "@/api/anilist";
import * as library from "@/api/library";
export function LibrarySection() {
  const { t } = useTranslation();
  const refreshLibrary = useLibrary((s) => s.refresh);
  const qc = useQueryClient();
  const [path, setPath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [matched, setMatched] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    library.getLibraryPath().then(setPath);
  }, []);

  const choose = async () => {
    setError(null);
    // `setLibraryPath` is a database write and can reject. Outside the try it
    // took `setPath` and the scan down with it and left the pane showing the
    // old folder, so picking a folder looked like it had done nothing at all —
    // with an error line sitting right there, unused.
    try {
      const picked = await library.pickLibraryFolder();
      if (!picked) return;
      await library.setLibraryPath(picked);
      setPath(picked);
    } catch (e) {
      setError(String(e));
      return;
    }
    await scan();
  };

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      const summary = await library.scanLibrary();
      setMatched(summary.matched);
      await refreshLibrary();
      // A scan started here changes what the Library screen shows, and those
      // two caches live only over there. Without this the folder row and the
      // unplaced list keep serving pre-scan answers for a whole staleTime —
      // long enough to offer "Assign" on a group the scan already placed.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["libraryStatus"] }),
        qc.invalidateQueries({ queryKey: ["libraryUnmatched"] }),
      ]);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.library")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.libraryHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={choose}>
          <FolderOpen className="size-4" /> {t("settings.libraryChoose")}
        </Button>
        {path && (
          <Button onClick={scan} disabled={scanning}>
            <RefreshCw className={cn("size-4", scanning && "animate-spin")} />{" "}
            {scanning ? t("settings.libraryScanning") : t("settings.libraryScan")}
          </Button>
        )}
      </div>
      {path && (
        <p className="mt-3 break-all text-xs text-ink-600">{path}</p>
      )}
      {matched !== null && (
        <p className="mt-1 text-sm text-success">
          {t("settings.libraryMatched", { n: matched })}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

/**
 * The confirmed season splits — written by the split modal, applied by every
 * scan, and until this list existed shown nowhere: the only undo was
 * `clearLibraryMatch` taking the whole title with it.
 *
 * Rows are keyed on the *parse* — the release name and season as the files
 * on disk spell them — because that is the key the clear command deletes by.
 * The destination joins a display title once the media resolves and shows
 * the bare `#id` until then rather than blocking on it, the unplaced list's
 * own convention.
 */
export function LibrarySplitsSection() {
  const { t } = useTranslation();
  const refreshLibrary = useLibrary((s) => s.refresh);
  const qc = useQueryClient();
  const [rows, setRows] = useState<library.LibraryRedirectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!api.isTauri) return;
    library.listLibraryRedirects().then(setRows).catch(() => {});
  };
  useEffect(load, []);

  const ids = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.mediaId))],
    [rows],
  );
  const { data: media } = useQuery({
    queryKey: ["librarySplitMedia", [...ids].sort((a, b) => a - b)],
    queryFn: () => mediaByIds(ids),
    enabled: ids.length > 0,
    staleTime: 30 * 60 * 1000,
  });
  const byId = useMemo(() => new Map((media ?? []).map((m) => [m.id, m])), [media]);

  if (!rows || rows.length === 0) return null;

  const remove = async (row: library.LibraryRedirectRow) => {
    setError(null);
    try {
      await library.clearLibraryRedirect(row.title, row.season, row.epFrom);
      load();
      // Removing a split re-homes files, which the Library screen renders
      // from its own caches — same invalidation the scan performs.
      await refreshLibrary();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["libraryStatus"] }),
        qc.invalidateQueries({ queryKey: ["libraryUnmatched"] }),
      ]);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.splits")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.splitsHint")}</p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => {
          const m = byId.get(row.mediaId);
          return (
            <li
              key={`${row.title}-${row.season}-${row.epFrom}`}
              className="flex items-center gap-3 rounded-lg bg-surface-900 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <Link
                  to={`/media/${row.mediaId}`}
                  className="block truncate text-xs text-ink-100 hover:text-accent-400"
                >
                  {m ? displayTitle(m.title) : `#${row.mediaId}`}
                </Link>
                <span className="mt-0.5 block truncate text-2xs text-ink-600">
                  {row.title}
                  {row.season > 0 && ` · S${row.season}`}
                  {" · "}
                  {t("settings.splitsRange", {
                    from: row.epFrom,
                    to: row.epTo,
                    start: row.dstStart,
                  })}
                </span>
              </span>
              <IconButton
                variant="ghost"
                onClick={() => remove(row)}
                aria-label={t("settings.splitsRemove")}
                title={t("settings.splitsRemove")}
              >
                <X className="size-3.5" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
