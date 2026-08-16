import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as api from "@/api/anilist";
import { getLogDebug, getLogs, setLogDebug, type LogEntry } from "@/api/diagnostics";
import { backendErrorText } from "@/lib/backendError";
import { planRescale } from "@/lib/rescale";
import { buildJsonExport, buildMalXml } from "@/lib/malExport";
import { parseMalXml } from "@/lib/malImport";
import { parseJsonExport } from "@/lib/jsonImport";
import { resolveMalChunk } from "@/api/queries";
import { scoreScale } from "@/lib/scoreFormat";
import { useAuth, useScoreFormat } from "@/stores/auth";
import { usePlatform } from "@/stores/platform";
import { showToast } from "@/stores/toast";
import type { ListResult, Media, MediaType } from "@/api/types";
import { cn } from "@/lib/utils";
import { NeedsAccount, Row, SELECT, Toggle } from "./shared";
interface DatabaseInfo {
  path: string;
  bytes: number;
  modifiedMs: number;
}

interface PortableStatus {
  portable: boolean;
  dir: string;
  /** A database in the folder this switch would move away from using. */
  other: DatabaseInfo | null;
}

/**
 * The one-shot score rescale: every scored entry inside a source range maps
 * linearly onto a target range. Planning is pure (`lib/rescale`) and shown
 * before anything is written — including the request count, because
 * AniList's bulk mutation takes one value per call, so the apply is one
 * request per distinct target score. Signed-in only: a local list can be
 * rescaled the day someone asks, but the tool exists for the account case.
 */
export function RescaleSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const format = useScoreFormat();
  const scale = scoreScale(format);
  const [type, setType] = useState<MediaType>("ANIME");
  const [fromMin, setFromMin] = useState(1);
  const [fromMax, setFromMax] = useState(scale.max);
  const [toMin, setToMin] = useState(1);
  const [toMax, setToMax] = useState(scale.max);
  const [applying, setApplying] = useState(false);

  // A `useQuery` on the same key the list screens use, not `getQueryData`.
  //
  // `getQueryData` is a point-in-time read: opening Settings before the list
  // had landed left this section permanently claiming there was no list, and
  // when there *was* one it planned — and then wrote — from whatever snapshot
  // happened to be in the cache when the component mounted. This section
  // rewrites real scores across a whole list, so it has to be looking at the
  // list as it is now. Sharing the key means an already-fetched list costs
  // nothing and a stale one refreshes itself.
  const { data } = useQuery<ListResult>({
    queryKey: ["mediaList", type, viewer?.id ?? 0],
    queryFn: () => api.fetchMediaList(viewer!.id, type),
    enabled: mode === "anilist" && !!viewer,
  });

  const entries = useMemo(() => {
    const seen = new Set<number>();
    return (data?.lists ?? [])
      .filter((g) => !g.isCustomList)
      .flatMap((g) => g.entries)
      .filter((e) => (seen.has(e.mediaId) ? false : (seen.add(e.mediaId), true)))
      .map((e) => ({ id: e.id, mediaId: e.mediaId, score: e.score }));
  }, [data]);

  if (mode !== "anilist" || !viewer) return null;

  const plan = planRescale(
    entries,
    { min: fromMin, max: fromMax },
    { min: toMin, max: toMax },
    format,
  );
  const listLoaded = entries.length > 0;

  const apply = async () => {
    setApplying(true);
    try {
      for (const group of plan.groups) {
        await api.bulkSaveEntries(group.entries, { score: group.score });
      }
      showToast({
        kind: "success",
        text: t("settings.rescaleDone", { n: plan.affected }),
      });
      await qc.invalidateQueries({ queryKey: ["mediaList", type] });
    } catch (e) {
      // Through the mapper, not `String(e)`: the backend answers with stable
      // codes now, and a German UI showed them raw.
      showToast({
        kind: "error",
        text: t("settings.rescaleFailed"),
        detail: backendErrorText(e, t),
      });
    } finally {
      setApplying(false);
    }
  };

  const range = (
    value: number,
    set: (n: number) => void,
  ) => (
    <Input
      type="number"
      min={0}
      max={scale.max}
      step={scale.step}
      value={value}
      onChange={(e) => set(Number(e.target.value))}
      className="w-20"
    />
  );

  return (
    <Card>
      <CardTitle>{t("settings.rescale")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.rescaleHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as MediaType)}
          className={SELECT}
        >
          <option value="ANIME">{t("common.anime")}</option>
          <option value="MANGA">{t("common.manga")}</option>
        </select>
        <span className="flex items-center gap-1.5 text-sm text-ink-300">
          {range(fromMin, setFromMin)}–{range(fromMax, setFromMax)}
          <span className="mx-1 text-ink-600">→</span>
          {range(toMin, setToMin)}–{range(toMax, setToMax)}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-600">
        {listLoaded
          ? t("settings.rescalePreview", {
              affected: plan.affected,
              untouched: plan.untouched,
              requests: plan.requests,
            })
          : t("settings.rescaleNoList")}
      </p>
      <Button
        className="mt-3"
        variant="secondary"
        disabled={!listLoaded || plan.affected === 0 || applying}
        onClick={apply}
      >
        {applying ? (
          <RefreshCw className="size-3.5 animate-spin" />
        ) : null}
        {t("settings.rescaleApply")}
      </Button>
    </Card>
  );
}

export function PortableSection() {
  const { t } = useTranslation();
  const platform = usePlatform((s) => s.info);
  const [status, setStatus] = useState<PortableStatus | null>(null);
  const [restart, setRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<PortableStatus>("get_portable_status").then(setStatus),
    );
  }, []);

  if (!status) return null;

  /**
   * `replace` is only read when enabling, and only matters when a database is
   * already beside the exe: true takes the current one along, false adopts the
   * one that is there. The backend refuses when neither was said, so the two
   * buttons below are the only way in.
   */
  const toggle = async (replace?: boolean) => {
    setError(null);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      if (status.portable) await invoke("disable_portable");
      else await invoke("enable_portable", { replace: replace ?? null });
      setRestart(true);
    } catch (e) {
      setError(String(e));
    }
    // Either way, re-read where the data actually lives rather than assuming
    // the switch failed cleanly. The backend leaves portable mode off when
    // enabling fails, but this pane should be showing what is true, not what
    // it expected.
    await invoke<PortableStatus>("get_portable_status").then(setStatus);
  };

  const other = status.other;
  const otherWhen = other
    ? new Date(other.modifiedMs).toLocaleDateString()
    : "";

  return (
    <Card>
      <CardTitle>{t("settings.portable")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.portableHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-300">
          {status.portable ? t("settings.portableOn") : t("settings.portableOff")}
        </span>
        {/* With a database already waiting, there is no single "enable" that
            is safe to guess at — one of the two copies is about to be set
            aside, and only the user knows which. */}
        {!status.portable && other ? (
          <>
            <Button variant="secondary" onClick={() => toggle(false)}>
              {t("settings.portableKeepExisting")}
            </Button>
            <Button variant="secondary" onClick={() => toggle(true)}>
              {t("settings.portableReplaceExisting")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => toggle()}>
            {status.portable
              ? t("settings.portableDisable")
              : t("settings.portableEnable")}
          </Button>
        )}
      </div>
      <p className="mt-2 break-all text-xs text-ink-600">
        {t("settings.portableLocation")}: {status.dir}
      </p>
      {other && (
        <p className="mt-2 break-all text-xs text-gold">
          {status.portable
            ? t("settings.portableOtherOnDisable", {
                path: other.path,
                date: otherWhen,
              })
            : t("settings.portableOtherOnEnable", {
                path: other.path,
                date: otherWhen,
              })}
        </p>
      )}
      {platform?.appImage && (
        <p className="mt-1 text-xs text-ink-600">
          {t("settings.portableAppImage")}
        </p>
      )}
      {restart && (
        <p className="mt-2 text-sm text-gold">{t("settings.portableRestart")}</p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

/**
 * Export the lists as files: MAL XML per medium (the migration lingua
 * franca), or everything as Karasu's own JSON. Composition is pure
 * (`lib/malExport`, tested); this section only fetches, composes and hands
 * the result to the same save dialog the other exports use.
 *
 * Works in both modes — a local list needs a way out at least as much as an
 * account does. The list reads go through the query cache, so on a warm
 * session they cost nothing; cold, they are the same two fetches the list
 * pages would spend anyway, and the click is the user-initiated moment.
 */
export function ExportSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const format = useScoreFormat();
  const [busy, setBusy] = useState(false);

  if (mode === "none") return null;
  const userId = viewer?.id ?? 0;

  const flat = (r: ListResult) => {
    const seen = new Set<number>();
    return r.lists
      .filter((g) => !g.isCustomList)
      .flatMap((g) => g.entries)
      .filter((e) => (seen.has(e.mediaId) ? false : (seen.add(e.mediaId), true)));
  };

  const load = (type: MediaType) =>
    qc
      .fetchQuery({
        queryKey: ["mediaList", type, userId],
        queryFn: () => api.fetchMediaList(userId, type),
      })
      .then(flat);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showToast({ kind: "error", text: t("settings.exportFailed"), detail: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const exportMal = (type: MediaType) =>
    run(async () => {
      const entries = await load(type);
      const { xml, count, skipped, omitted } = buildMalXml(entries, type, format);
      if (count === 0) {
        showToast({ kind: "error", text: t("settings.exportEmpty") });
        return;
      }
      const name = type === "ANIME" ? "karasu-anime.xml" : "karasu-manga.xml";
      if (await api.saveText(xml, name, "MyAnimeList XML", "xml")) {
        showToast({
          kind: "success",
          text:
            skipped > 0
              ? t("settings.exportDoneSkipped", { n: count, skipped })
              : t("settings.exportDone", { n: count }),
          // Two different absences, so two different lines: no MAL id is a
          // limit of the format, private is a choice the user made.
          detail:
            omitted > 0 ? t("settings.exportOmittedPrivate", { n: omitted }) : undefined,
        });
      }
    });

  const exportJson = () =>
    run(async () => {
      const [anime, manga] = await Promise.all([load("ANIME"), load("MANGA")]);
      if (anime.length === 0 && manga.length === 0) {
        showToast({ kind: "error", text: t("settings.exportEmpty") });
        return;
      }
      const json = buildJsonExport(anime, manga, format, Date.now());
      if (await api.saveText(json, "karasu-export.json", "JSON", "json")) {
        showToast({
          kind: "success",
          text: t("settings.exportDone", { n: anime.length + manga.length }),
        });
      }
    });

  return (
    <Card>
      <CardTitle>{t("settings.export")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.exportHint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => exportMal("ANIME")}>
          {t("settings.exportAnime")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => exportMal("MANGA")}>
          {t("settings.exportManga")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={exportJson}>
          {t("settings.exportJson")}
        </Button>
      </div>
    </Card>
  );
}

/**
 * MAL XML into the local list — deliberately local mode only, per the plan:
 * an account import would be one mutation per entry against the shared
 * ~30/min budget, a seventeen-minute job wearing a button's clothes. The
 * local list is a SQLite file; writing it is free.
 *
 * The costed part is *matching*, and it is paced and visible: fifty MAL ids
 * per request, one request per chunk, progress on screen between them. What
 * cannot be matched or parsed is counted into the final toast — an import
 * that silently drops rows is how two trackers drift apart unnoticed.
 * Imported per row: status, progress (both axes), score, rewatch count.
 */
export function ImportSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Signed in, this section is genuinely unavailable rather than irrelevant, so
  // it says which and why. Vanishing left the reasoning stranded in the comment
  // above, where a user looking for an import button will not find it.
  if (mode !== "local") {
    return (
      <NeedsAccount title={t("settings.import")}>
        {t("settings.importAniListHint")}
      </NeedsAccount>
    );
  }

  const importMal = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const xml = await invoke<string | null>("open_text", {
        filterLabel: "MyAnimeList XML",
        extension: "xml",
      });
      if (xml == null) return;
      const parsed = parseMalXml(xml);
      if (parsed.rows.length === 0) {
        showToast({ kind: "error", text: t("settings.importNothing") });
        return;
      }

      const ids = [...new Set(parsed.rows.map((r) => r.idMal))];
      const byMal = new Map<number, Media>();
      for (let i = 0; i < ids.length; i += 50) {
        setProgress(
          t("settings.importResolving", {
            done: Math.min(i + 50, ids.length),
            total: ids.length,
          }),
        );
        const media = await resolveMalChunk(ids.slice(i, i + 50), parsed.type);
        for (const m of media) {
          if (m.idMal != null) byMal.set(m.idMal, m);
        }
      }

      setProgress(t("settings.importWriting"));
      let imported = 0;
      let unmatched = parsed.skipped;
      for (const row of parsed.rows) {
        const media = byMal.get(row.idMal);
        if (!media) {
          unmatched += 1;
          continue;
        }
        // Local scores are ten-point, which is MAL's own scale — no
        // conversion, by construction rather than luck.
        await api.saveListEntry(
          {
            mediaId: media.id,
            status: row.status,
            progress: row.progress,
            progressVolumes: row.progressVolumes,
            score: row.score,
            repeat: row.repeat,
          },
          media,
        );
        imported += 1;
      }

      await qc.invalidateQueries({ queryKey: ["mediaList"] });
      showToast({
        kind: "success",
        text:
          unmatched > 0
            ? t("settings.importDoneUnmatched", { n: imported, unmatched })
            : t("settings.importDone", { n: imported }),
      });
    } catch (e) {
      showToast({ kind: "error", text: t("settings.importFailed"), detail: String(e) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /**
   * Karasu's own JSON, which the app could write and not read — which makes it
   * an export rather than a backup.
   *
   * Costs no requests at all, unlike the MAL path above: the file already
   * carries the AniList media id and a format-independent `scoreRaw`, so there
   * is nothing to resolve and nothing to guess. It also carries what a MAL
   * round-trip cannot — notes, both progress axes, the private flag, and the
   * dates as fuzzy dates rather than as MAL's all-or-nothing `0000-00-00`.
   */
  const importJson = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const text = await invoke<string | null>("open_text", {
        filterLabel: "Karasu JSON",
        extension: "json",
      });
      if (text == null) return;
      const parsed = parseJsonExport(text);
      if (parsed.rows.length === 0) {
        showToast({ kind: "error", text: t("settings.importNothing") });
        return;
      }

      setProgress(t("settings.importWriting"));
      for (const row of parsed.rows) {
        await api.saveListEntry(
          {
            mediaId: row.mediaId,
            status: row.status,
            // Local scores are ten-point; the raw scale is the one place every
            // format converges, so this is the only conversion needed.
            score: row.scoreRaw / 10,
            progress: row.progress,
            progressVolumes: row.progressVolumes,
            repeat: row.repeat,
            notes: row.notes ?? undefined,
            private: row.private,
            startedAt: row.startedAt ?? undefined,
            completedAt: row.completedAt ?? undefined,
          },
          // Second argument, exactly as the MAL path passes it: local mode
          // stores this beside the row so the list renders offline. Without it
          // an imported entry is a title-less card waiting on a fetch that
          // local mode never makes.
          row.media,
        );
      }

      await qc.invalidateQueries({ queryKey: ["mediaList"] });
      showToast({
        kind: "success",
        text:
          parsed.skipped > 0
            ? t("settings.importDoneUnmatched", {
                n: parsed.rows.length,
                unmatched: parsed.skipped,
              })
            : t("settings.importDone", { n: parsed.rows.length }),
      });
    } catch (e) {
      showToast({ kind: "error", text: t("settings.importFailed"), detail: String(e) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.import")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.importHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={importMal}>
          {t("settings.importMal")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={importJson}>
          {t("settings.importJson")}
        </Button>
        {progress && <span className="text-xs text-ink-500">{progress}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-600">{t("settings.importJsonHint")}</p>
    </Card>
  );
}

interface BackupSettings {
  enabled: boolean;
  keep: number;
  dir: string;
}

/**
 * Daily local database snapshots — on by default, because the first time
 * anyone thinks about backups is the moment they need one. The Rust side
 * owns the schedule and the retention; this card owns the two knobs and
 * shows where the files land, so "where did my backup go" answers itself.
 */
export function BackupSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [keepDraft, setKeepDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<BackupSettings>("get_backup_settings").then(setSettings).catch(() => {});
    });
  }, []);

  if (!settings) return null;

  // The toggles-above rollback idiom: paint first, await, un-paint on failure.
  const apply = async (next: { enabled: boolean; keep: number }) => {
    const prev = settings;
    setSettings({ ...settings, ...next });
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_backup_settings", next);
    } catch (e) {
      setSettings(prev);
      setError(String(e));
    }
  };

  const applyKeep = () => {
    const parsed = Math.round(Number(keepDraft ?? ""));
    setKeepDraft(null);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60 || parsed === settings.keep) {
      return;
    }
    void apply({ enabled: settings.enabled, keep: parsed });
  };

  return (
    <Card>
      <CardTitle>{t("settings.backup")}</CardTitle>
      <div className="mt-3 space-y-3">
        <Toggle
          checked={settings.enabled}
          onChange={(enabled) => apply({ enabled, keep: settings.keep })}
          label={t("settings.backupEnabled")}
          hint={t("settings.backupEnabledHint", { dir: settings.dir })}
        />
        <Row label={t("settings.backupOpen")} hint={t("settings.backupRestoreHint")}>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("open_backup_dir").catch((e) => setError(String(e)));
            }}
          >
            <FolderOpen className="size-3.5" /> {t("settings.backupOpenButton")}
          </Button>
        </Row>
        <Row label={t("settings.backupKeep")} hint={t("settings.backupKeepHint")}>
          <Input
            type="number"
            min={1}
            max={60}
            value={keepDraft ?? String(settings.keep)}
            onChange={(e) => setKeepDraft(e.target.value)}
            onBlur={applyKeep}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyKeep();
              }
            }}
            disabled={!settings.enabled}
            className="w-20"
          />
        </Row>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

interface CloseToTray {
  enabled: boolean;
  tray: boolean;
}

/**
 * How Karasu behaves as a program on this desktop.
 *
 * Split from the update settings it used to share a card with: "start with the
 * system" and "install pre-releases" are unrelated decisions, and the second is
 * the one people go looking for.
 */
export function SystemSection() {
  const { t } = useTranslation();
  const platform = usePlatform((s) => s.info);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [closeTray, setCloseTray] = useState<CloseToTray | null>(null);
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<boolean>("get_autostart").then(setAutostart);
      invoke<CloseToTray>("get_close_to_tray").then(setCloseTray);
      invoke<string | null>("get_global_hotkey").then((v) => {
        setHotkey(v ?? "");
        setHotkeyDraft(v ?? "");
      });
    });
  }, []);

  // Both of these paint the switch first and then await a command that can
  // genuinely fail — `set_autostart` cannot write its .desktop entry on a
  // locked-down Linux session, `set_close_to_tray` is a database write. Without
  // the rollback the switch kept reading "on" for the rest of the session while
  // nothing had been configured, and the rejection went nowhere; reopening
  // Settings then quietly showed "off" again with no explanation.
  const toggleAutostart = async (enabled: boolean) => {
    setAutostart(enabled);
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_autostart", { enabled });
    } catch (e) {
      setAutostart(!enabled);
      setError(String(e));
    }
  };

  const toggleCloseTray = async (enabled: boolean) => {
    setCloseTray((prev) => (prev ? { ...prev, enabled } : prev));
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_close_to_tray", { enabled });
    } catch (e) {
      setCloseTray((prev) => (prev ? { ...prev, enabled: !enabled } : prev));
      setError(String(e));
    }
  };

  // Same rollback idiom as the toggles above, because this one genuinely
  // fails: the OS refuses an accelerator another app holds, and a typo is not
  // an accelerator at all. Registration happens before the store on the Rust
  // side, so a rejected string never comes back at the next startup.
  const applyHotkey = async () => {
    const next = hotkeyDraft.trim();
    if (hotkey === null || next === hotkey) return;
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_global_hotkey", { accelerator: next || null });
      setHotkey(next);
      setHotkeyDraft(next);
    } catch (e) {
      setHotkeyDraft(hotkey);
      setError(String(e));
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.app")}</CardTitle>
      <div className="mt-3 space-y-3">
        {/* Hidden inside an AppImage: the plugin writes the autostart entry
            from `current_exe()`, which there is a /tmp mount that is gone by
            the next login. The toggle would report success and never work. */}
        {autostart !== null && !platform?.appImage && (
          <Toggle
            checked={autostart}
            onChange={toggleAutostart}
            label={t("settings.autostart")}
            hint={t("settings.autostartHint")}
          />
        )}

        {/* Locked off where there is no tray: hiding into one that does not
            exist is how the window becomes unreachable. */}
        {closeTray !== null && (
          <Toggle
            checked={closeTray.enabled}
            onChange={toggleCloseTray}
            disabled={!closeTray.tray}
            label={t("settings.closeToTray")}
            hint={
              closeTray.tray
                ? t("settings.closeToTrayHint")
                : t("settings.closeToTrayNoTray")
            }
          />
        )}

        {hotkey !== null && (
          <Row label={t("settings.hotkey")} hint={t("settings.hotkeyHint")}>
            <Input
              value={hotkeyDraft}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              onBlur={applyHotkey}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyHotkey();
                }
              }}
              placeholder={t("settings.hotkeyPlaceholder")}
              className="w-48"
            />
          </Row>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Card>
  );
}

/** Whether Karasu looks for a new version, and which kind it accepts. */
export function UpdatesSection() {
  const { t } = useTranslation();
  const [auto, setAuto] = useState<boolean | null>(null);
  // Null until the stored value lands. It used to default to `"prerelease"`,
  // so a stable-channel install rendered the wrong answer for one frame — and
  // a settings row that flashes something the account is not set to is worse
  // than one that arrives a moment late.
  const [channel, setChannel] = useState<api.UpdateChannel | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    api.getUpdateCheckAuto().then(setAuto);
    api.getUpdateChannel().then(setChannel);
  }, []);

  return (
    <Card>
      <CardTitle>{t("settings.updates")}</CardTitle>
      <div className="mt-3 space-y-3">
        {auto !== null && (
          <Toggle
            checked={auto}
            onChange={(enabled) => {
              setAuto(enabled);
              api.setUpdateCheckAuto(enabled);
            }}
            label={t("settings.updateAuto")}
            hint={t("settings.updateAutoHint")}
          />
        )}

        {channel !== null && (
          <Row
            label={t("settings.updateChannel")}
            hint={t("settings.updateChannelHint")}
          >
            <select
              value={channel}
              onChange={(e) => {
                const next = e.target.value as api.UpdateChannel;
                setChannel(next);
                api.setUpdateChannel(next);
              }}
              className={SELECT}
            >
              <option value="prerelease">
                {t("settings.updateChannelPrerelease")}
              </option>
              <option value="stable">{t("settings.updateChannelStable")}</option>
            </select>
          </Row>
        )}
      </div>
    </Card>
  );
}

/**
 * The log, in the app.
 *
 * Collapsed by default and fetched on first expand, matching the media-session
 * diagnostic in DetectionPane — this is a thing you go looking for, not a thing
 * that should cost a round trip on every visit to Settings.
 *
 * Where it differs from that precedent: a failed fetch renders an error instead
 * of an empty list. "Nothing to show" and "could not read it" looking identical
 * is exactly the class of problem this whole feature exists to end.
 */
export function LogSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [debug, setDebug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    getLogDebug().then(setDebug).catch(() => {});
  }, []);

  if (!api.isTauri) return null;

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      setEntries(await getLogs(200));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleDebug = async (enabled: boolean) => {
    const previous = debug;
    setDebug(enabled);
    try {
      await setLogDebug(enabled);
    } catch (e) {
      setDebug(previous);
      setError(String(e));
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.log")}</CardTitle>
      <p className="mt-1 text-2xs text-ink-600">{t("settings.logHint")}</p>

      <div className="mt-3 space-y-3">
        <Toggle
          checked={debug}
          onChange={toggleDebug}
          label={t("settings.logDebug")}
          hint={t("settings.logDebugHint")}
        />

        <div className="border-t border-surface-800 pt-3">
          <button
            onClick={() => {
              const next = !open;
              setOpen(next);
              if (next && entries === null) refresh();
            }}
            className="flex w-full items-center gap-1.5 text-left text-sm text-ink-300"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", open && "rotate-90")}
            />
            {t("settings.logShow")}
          </button>

          {open && (
            <>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={refresh}
                  disabled={busy}
                >
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
                  {t("settings.refreshDebug")}
                </Button>
              </div>

              {error && <p className="mt-2 text-sm text-danger">{error}</p>}

              {!error && entries !== null && entries.length === 0 && (
                <p className="mt-2 text-xs text-ink-600">{t("settings.logEmpty")}</p>
              )}

              {!error && entries !== null && entries.length > 0 && (
                <div className="mt-2 max-h-96 space-y-0.5 overflow-y-auto rounded-lg bg-surface-850 p-2 font-mono text-2xs">
                  {entries.map((e, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 text-ink-600">
                        {new Date(e.ms).toLocaleTimeString()}
                      </span>
                      <span
                        className={cn(
                          "w-10 shrink-0 uppercase",
                          e.level === "error" && "text-danger",
                          e.level === "warn" && "text-gold",
                          e.level === "info" && "text-ink-500",
                          e.level === "debug" && "text-ink-600",
                        )}
                      >
                        {e.level}
                      </span>
                      <span className="shrink-0 text-accent-400">{e.target}</span>
                      <span className="min-w-0 break-all text-ink-300">
                        {e.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
