import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import * as api from "@/api/anilist";
import { getLogDebug, getLogs, setLogDebug, type LogEntry } from "@/api/diagnostics";
import { usePlatform } from "@/stores/platform";
import { cn } from "@/lib/utils";
import { Row, SELECT, Toggle } from "./shared";
interface PortableStatus {
  portable: boolean;
  dir: string;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<boolean>("get_autostart").then(setAutostart);
      invoke<CloseToTray>("get_close_to_tray").then(setCloseTray);
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
