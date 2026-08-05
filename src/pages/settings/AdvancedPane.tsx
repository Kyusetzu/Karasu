import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import * as api from "@/api/anilist";
import { usePlatform } from "@/stores/platform";
import { SELECT, Toggle } from "./shared";
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
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(status.portable ? "disable_portable" : "enable_portable");
      setRestart(true);
    } catch (e) {
      setError(String(e));
    }
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

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<boolean>("get_autostart").then(setAutostart);
      invoke<CloseToTray>("get_close_to_tray").then(setCloseTray);
    });
    api.getUpdateCheckAuto().then(setUpdateAuto);
    api.getUpdateChannel().then(setUpdateChannelState);
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    setAutostart(enabled);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_autostart", { enabled });
  };

  const toggleCloseTray = async (enabled: boolean) => {
    setCloseTray((prev) => (prev ? { ...prev, enabled } : prev));
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_close_to_tray", { enabled });
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

        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span>
            <span className="block text-ink-100">
              {t("settings.updateChannel")}
            </span>
            <span className="block text-xs text-ink-600">
              {t("settings.updateChannelHint")}
            </span>
          </span>
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
        </label>
      </div>
    </Card>
  );
}
