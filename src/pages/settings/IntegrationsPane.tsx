import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/card";
import * as api from "@/api/anilist";
import { Toggle } from "./shared";
interface DiscordSettings {
  enabled: boolean;
  appId: string;
  hasBuiltinAppId: boolean;
}

export function DiscordSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DiscordSettings | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<DiscordSettings>("get_discord_settings").then(setSettings),
    );
  }, []);

  if (!settings) return null;

  const save = async (next: DiscordSettings) => {
    setSettings(next);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_discord_settings", {
      enabled: next.enabled,
      appId: next.appId,
    });
  };

  return (
    <Card>
      <CardTitle>{t("settings.discord")}</CardTitle>
      <div className="mt-3 space-y-3">
        <Toggle
          checked={settings.enabled}
          onChange={(v) => save({ ...settings, enabled: v })}
          label={t("settings.discordEnable")}
          hint={t("settings.discordEnableHint")}
        />
      </div>
    </Card>
  );
}
