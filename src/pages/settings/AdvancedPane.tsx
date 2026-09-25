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
import { useManualSync } from "@/hooks/useManualSync";
import { isAndroid, usePlatform } from "@/stores/platform";
import { showToast } from "@/stores/toast";
import type { ListResult, Media, MediaType } from "@/api/types";
import { cn } from "@/lib/utils";
import { NeedsAccount, Row, SELECT, Toggle } from "./shared";
import { Trash2 } from "lucide-react";
import { displayTitle, type QueuedEdit, type SyncStatus } from "@/api/types";
import { isQueueField, queuedMediaId } from "@/lib/syncQueue";
import { fieldLabel } from "@/components/shell/SyncPanel";
import { IconButton } from "@/components/ui/icon-button";
import { Presence } from "@/components/ui/presence";
import ConfirmDialog from "@/components/overlays/ConfirmDialog";
import { commands, unwrap } from "@/api/tauri";
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

/** The one-shot score rescale, planned purely in `lib/rescale` and previewed with its request count first. */
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

  // A `useQuery` on the list screens' key, not `getQueryData`, or the rescale writes from a stale snapshot.
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
      // Through the mapper, not `String(e)`, or a German UI shows the backend's stable codes raw.
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
    commands.getPortableStatus().then(setStatus);
  }, []);

  if (!status) return null;

  /** Enabling beside an existing database needs `replace`: true takes ours along, false adopts it, unset is refused. */
  const toggle = async (replace?: boolean) => {
    setError(null);
    try {
      // Neither call returns on success: the backend relaunches, as `Db` is opened once and never reopened.
      if (status.portable) await unwrap(commands.disablePortable());
      else await unwrap(commands.enablePortable(replace ?? null));
      setRestart(true);
    } catch (e) {
      setError(String(e));
    }
    // Either way, re-read where the data actually lives rather than assuming the switch failed cleanly.
    await commands.getPortableStatus().then(setStatus);
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
        {/* With a database already waiting, only the user knows which of the two copies to set aside. */}
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

/** Exports the lists as MAL XML per medium or Karasu's JSON, in both modes; `lib/malExport` composes the files. */
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
          // Two different absences, two lines: no MAL id is a limit of the format, private is the user's choice.
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

/** MAL XML into the local list only, since an account import is one mutation per entry against the shared budget. */
export function ImportSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Signed in, the section is unavailable rather than irrelevant, so it says so instead of vanishing.
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
      const xml = await unwrap(commands.openText("MyAnimeList XML", "xml"));
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
        // Local scores are ten-point, which is MAL's own scale, so no conversion by construction.
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

  /** Karasu's own JSON back in; no requests, as the file carries the media id and a format-independent `scoreRaw`. */
  const importJson = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await unwrap(commands.openText("Karasu JSON", "json"));
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
            // Local scores are ten-point; the raw scale is where every format converges, so one conversion suffices.
            score: row.scoreRaw / 10,
            progress: row.progress,
            progressVolumes: row.progressVolumes,
            repeat: row.repeat,
            notes: row.notes ?? undefined,
            private: row.private,
            startedAt: row.startedAt ?? undefined,
            completedAt: row.completedAt ?? undefined,
          },
          // Keep the media argument, as the MAL path does; without it local mode shows a title-less card forever.
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

/** Daily local database snapshots, on by default; Rust owns the schedule, this card owns the two knobs. */
export function BackupSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [keepDraft, setKeepDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    commands.getBackupSettings().then(setSettings).catch(() => {});
  }, []);

  if (!settings) return null;

  // The toggles-above rollback idiom: paint first, await, un-paint on failure.
  const apply = async (next: { enabled: boolean; keep: number }) => {
    const prev = settings;
    setSettings({ ...settings, ...next });
    setError(null);
    try {
      await unwrap(commands.setBackupSettings(next.enabled, next.keep));
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
              await unwrap(commands.openBackupDir()).catch((e) => setError(String(e)));
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

/** How Karasu behaves as a program on this desktop, kept apart from the unrelated update settings. */
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
    commands.getAutostart().then(setAutostart);
    commands.getCloseToTray().then(setCloseTray);
    commands.getGlobalHotkey().then((v) => {
      setHotkey(v ?? "");
      setHotkeyDraft(v ?? "");
    });
  }, []);

  // Paint first, await, roll back on failure, or a refused write reads "on" for the rest of the session.
  const toggleAutostart = async (enabled: boolean) => {
    setAutostart(enabled);
    setError(null);
    try {
      await unwrap(commands.setAutostart(enabled));
    } catch (e) {
      setAutostart(!enabled);
      setError(String(e));
    }
  };

  const toggleCloseTray = async (enabled: boolean) => {
    setCloseTray((prev) => (prev ? { ...prev, enabled } : prev));
    setError(null);
    try {
      await unwrap(commands.setCloseToTray(enabled));
    } catch (e) {
      setCloseTray((prev) => (prev ? { ...prev, enabled: !enabled } : prev));
      setError(String(e));
    }
  };

  // Same rollback idiom: the OS can refuse an accelerator, and Rust registers before it stores one.
  const applyHotkey = async () => {
    const next = hotkeyDraft.trim();
    if (hotkey === null || next === hotkey) return;
    setError(null);
    try {
      await unwrap(commands.setGlobalHotkey(next || null));
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
        {/* Hidden inside an AppImage: the autostart entry would point at a /tmp mount gone by the next login. */}
        {autostart !== null && !platform?.appImage && (
          <Toggle
            checked={autostart}
            onChange={toggleAutostart}
            label={t("settings.autostart")}
            hint={t("settings.autostartHint")}
          />
        )}

        {/* Locked off without a tray; hiding into one that does not exist makes the window unreachable. */}
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
  // Null until the stored value lands, or a stable-channel install flashes the wrong answer for a frame.
  const [channel, setChannel] = useState<api.UpdateChannel | null>(null);
  const android = isAndroid(usePlatform((s) => s.info));
  const [metered, setMetered] = useState<boolean | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    api.getUpdateCheckAuto().then(setAuto);
    api.getUpdateChannel().then(setChannel);
    api.getApkDownloadMetered().then(setMetered);
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
              <option value="stable">{t("settings.updateChannelStable")}</option>
              <option value="prerelease">
                {t("settings.updateChannelPrerelease")}
              </option>
            </select>
          </Row>
        )}

        {/* Android only: the APK is 23 MB and the nightly channel rebuilds daily, so mobile data is opt-in. */}
        {android && metered !== null && (
          <Toggle
            checked={metered}
            onChange={(enabled) => {
              setMetered(enabled);
              api.setApkDownloadMetered(enabled);
            }}
            label={t("settings.apkMetered")}
            hint={t("settings.apkMeteredHint")}
          />
        )}
      </div>
    </Card>
  );
}

/** The log in the app, fetched on first expand; a failed read shows an error, never an empty list. */
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

        <div className="border-t border-hair pt-3">
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
                <div className="mt-2 max-h-96 space-y-0.5 overflow-y-auto rounded-control bg-surface-850 p-2 font-mono text-2xs">
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


/** The offline queue as rows; discard is behind a confirm, since a queued edit is the only copy of its write. */
export function QueueSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  const viewer = useAuth((s) => s.viewer);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [confirming, setConfirming] = useState<QueuedEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The whole-app sync, not a bare queue flush: on the phone this pane is the only sync surface at all.
  const manual = useManualSync();

  const load = () => {
    if (!api.isTauri) return;
    api.syncStatus().then(setStatus).catch(() => {});
  };
  useEffect(load, []);

  if (mode !== "anilist" || !viewer) {
    return (
      <NeedsAccount title={t("settings.queueTitle")}>
        {t("settings.queueNeedsAccount")}
      </NeedsAccount>
    );
  }

  const entries = qc
    .getQueriesData<ListResult>({ queryKey: ["mediaList"] })
    .flatMap(([, data]) => data?.lists.flatMap((g) => g.entries) ?? []);

  const rows = status?.queued ?? [];

  const runSync = async () => {
    setError(null);
    await manual.sync();
    load();
  };

  const discard = async (edit: QueuedEdit) => {
    setConfirming(null);
    setError(null);
    try {
      await api.discardQueuedEdit(edit.id);
      load();
    } catch (e) {
      setError(backendErrorText(e, t));
    }
  };

  const label = (edit: QueuedEdit) => {
    const mediaId = queuedMediaId(edit, entries);
    const entry = entries.find((e) => e.mediaId === mediaId);
    return entry ? displayTitle(entry.media.title) : `#${edit.subject ?? "?"}`;
  };

  return (
    <Card>
      <CardTitle>{t("settings.queueTitle")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.queueHint")}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-600">{t("settings.queueEmpty")}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
            {rows.map((edit) => (
              <li
                key={edit.id}
                className="flex items-center gap-3 rounded-control bg-surface-900 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink-100">
                    {label(edit)}
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-ink-600">
                    {edit.kind === "delete"
                      ? t("settings.queueKindDelete")
                      : edit.fields
                          .filter(isQueueField)
                          .map((f) => fieldLabel(f, t))
                          .join(", ")}
                  </span>
                </span>
                <IconButton
                  variant="ghost"
                  onClick={() => setConfirming(edit)}
                  aria-label={t("settings.queueDiscard")}
                  title={t("settings.queueDiscard")}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </li>
            ))}
        </ul>
      )}
      <div className="mt-3">
        <Button onClick={() => void runSync()} disabled={manual.syncing || !manual.available}>
          <RefreshCw className={cn("size-4", manual.syncing && "animate-spin")} />{" "}
          {manual.syncing ? t("settings.queueFlushing") : t("settings.queueFlush")}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <Presence value={confirming}>
        {(edit, leaving) => (
          <ConfirmDialog
            leaving={leaving}
            title={t("settings.queueDiscardTitle")}
            names={[label(edit)]}
            note={t("settings.queueDiscardNote")}
            confirmLabel={t("settings.queueDiscard")}
            onConfirm={() => void discard(edit)}
            onCancel={() => setConfirming(null)}
          />
        )}
      </Presence>
    </Card>
  );
}
