import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLibrary } from "@/stores/library";
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
    const picked = await library.pickLibraryFolder();
    if (!picked) return;
    await library.setLibraryPath(picked);
    setPath(picked);
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
