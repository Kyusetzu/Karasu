import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as api from "@/api/anilist";
import { getLogDebug, getLogs, setLogDebug, type LogEntry } from "@/api/diagnostics";
import { planRescale } from "@/lib/rescale";
import { scoreScale } from "@/lib/scoreFormat";
import { useAuth, useScoreFormat } from "@/stores/auth";
import { usePlatform } from "@/stores/platform";
import { showToast } from "@/stores/toast";
import type { ListResult, MediaType } from "@/api/types";
import { cn } from "@/lib/utils";
import { Row, SELECT, Toggle } from "./shared";
interface PortableStatus {
  portable: boolean;
  dir: string;
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

  const entries = useMemo(() => {
    if (!viewer) return [];
    const data = qc.getQueryData<ListResult>(["mediaList", type, viewer.id]);
    const seen = new Set<number>();
    return (data?.lists ?? [])
      .filter((g) => !g.isCustomList)
      .flatMap((g) => g.entries)
      .filter((e) => (seen.has(e.mediaId) ? false : (seen.add(e.mediaId), true)))
      .map((e) => ({ id: e.id, mediaId: e.mediaId, score: e.score }));
  }, [qc, viewer, type, applying]);

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
      showToast({ kind: "error", text: t("settings.rescaleFailed"), detail: String(e) });
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

  const toggle = async () => {
    setError(null);
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke(status.portable ? "disable_portable" : "enable_portable");
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

  return (
    <Card>
      <CardTitle>{t("settings.portable")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.portableHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-300">
          {status.portable ? t("settings.portableOn") : t("settings.portableOff")}
        </span>
        <Button variant="secondary" onClick={toggle}>
          {status.portable
            ? t("settings.portableDisable")
            : t("settings.portableEnable")}
        </Button>
      </div>
      <p className="mt-2 break-all text-xs text-ink-600">
        {t("settings.portableLocation")}: {status.dir}
      </p>
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

interface CloseToTray {
  enabled: boolean;
  tray: boolean;
}

export function AdvancedSection() {
  const { t } = useTranslation();
  const platform = usePlatform((s) => s.info);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [updateAuto, setUpdateAuto] = useState<boolean | null>(null);
  const [closeTray, setCloseTray] = useState<CloseToTray | null>(null);
  const [updateChannel, setUpdateChannelState] =
    useState<api.UpdateChannel>("prerelease");
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
    api.getUpdateCheckAuto().then(setUpdateAuto);
    api.getUpdateChannel().then(setUpdateChannelState);
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

  const toggleUpdateAuto = (enabled: boolean) => {
    setUpdateAuto(enabled);
    api.setUpdateCheckAuto(enabled);
  };

  const changeUpdateChannel = (channel: api.UpdateChannel) => {
    setUpdateChannelState(channel);
    api.setUpdateChannel(channel);
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

        {updateAuto !== null && (
          <Toggle
            checked={updateAuto}
            onChange={toggleUpdateAuto}
            label={t("settings.updateAuto")}
            hint={t("settings.updateAutoHint")}
          />
        )}

        <Row
          label={t("settings.updateChannel")}
          hint={t("settings.updateChannelHint")}
        >
          <select
            value={updateChannel}
            onChange={(e) =>
              changeUpdateChannel(e.target.value as api.UpdateChannel)
            }
            className={SELECT}
          >
            <option value="prerelease">
              {t("settings.updateChannelPrerelease")}
            </option>
            <option value="stable">{t("settings.updateChannelStable")}</option>
          </select>
        </Row>
        {error && <p className="text-sm text-danger">{error}</p>}
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
