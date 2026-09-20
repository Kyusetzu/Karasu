import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as api from "@/api/anilist";
import { Row, Toggle } from "./shared";
import { commands, unwrap } from "@/api/tauri";
interface DiscordSettings {
  enabled: boolean;
  appId: string;
  hasBuiltinAppId: boolean;
}

export function DiscordSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DiscordSettings | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!api.isTauri) return;
    commands.getDiscordSettings().then((s) => {
      setSettings(s);
      setDraft(s.appId);
    });
  }, []);

  if (!settings) return null;

  const save = async (next: DiscordSettings) => {
    setSettings(next);
    await unwrap(commands.setDiscordSettings(next.enabled, next.appId));
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

        {/* Empty means the built-in id (`effective_app_id` falls back to it), so the placeholder says so. */}
        <Row label={t("settings.discordAppId")} hint={t("settings.discordAppIdHint")}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const next = draft.trim();
              if (next !== settings.appId) save({ ...settings, appId: next });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder={
              settings.hasBuiltinAppId
                ? t("settings.discordAppIdBuiltin")
                : t("settings.discordAppIdNone")
            }
            spellCheck={false}
            className="w-48 font-mono text-xs"
          />
        </Row>
      </div>
    </Card>
  );
}
