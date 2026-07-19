import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { ChevronRight, ExternalLink, LogIn, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/stores/auth";
import * as api from "@/api/anilist";
import {
  getScrobbleSettings,
  setScrobbleSettings,
  type ScrobbleSettings,
} from "@/stores/nowPlaying";
import {
  getLanguageSetting,
  setLanguageSetting,
  SUPPORTED_LANGUAGES,
  type LanguageSetting,
} from "@/i18n";

/** Redirect URL that must be registered on the AniList API client. */
const CALLBACK_URL = "http://localhost:46231/callback";

export default function Settings() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <AccountSection />
      <ScrobbleSection />
      <DiscordSection />
      <AppSection />
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-600">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent-600" : "bg-surface-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? "left-4.5" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function AccountSection() {
  const { t } = useTranslation();
  const { viewer, connect, logout } = useAuth();
  const [info, setInfo] = useState<api.AuthInfo | null>(null);
  const [clientId, setClientIdState] = useState("");
  const [clientIdSaved, setClientIdSaved] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    api.authInfo().then((i) => {
      setInfo(i);
      if (i.customClientId) {
        setClientIdState(i.customClientId);
        setClientIdSaved(true);
      }
    });
    // Surface failures from the one-click login (invalid token etc.)
    let unlisten: (() => void) | undefined;
    listen<string>("anilist-auth-error", (e) => {
      setWaiting(false);
      setError(e.payload);
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  if (viewer) {
    return (
      <Card>
        <CardTitle>{t("settings.account")}</CardTitle>
        <div className="mt-4 flex items-center gap-4">
          {viewer.avatar?.large ? (
            <img
              src={viewer.avatar.large}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-full bg-surface-800">
              <User className="text-ink-500" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{viewer.name}</p>
            <button
              onClick={() => openUrl(viewer.siteUrl)}
              className="flex items-center gap-1 text-xs text-accent-400 hover:underline"
            >
              {t("settings.profileLink")} <ExternalLink size={12} />
            </button>
          </div>
          <Button variant="danger" onClick={() => logout()}>
            <LogOut size={16} /> {t("settings.logout")}
          </Button>
        </div>
      </Card>
    );
  }

  // Logging in is possible as soon as a client ID exists (built-in or custom)
  const canLogin =
    (info?.hasBuiltinClientId ?? false) || clientIdSaved;

  const saveClientId = async () => {
    setError(null);
    try {
      await api.setClientId(clientId);
      setClientIdSaved(true);
    } catch (e) {
      setError(String(e));
    }
  };

  // One-click flow: start the callback server, then hand off to the browser.
  // The backend finishes the login and pushes the viewer via "anilist-auth".
  const openLogin = async () => {
    setError(null);
    try {
      const url = await api.startLogin();
      await openUrl(url);
      setWaiting(true);
    } catch (e) {
      setError(String(e));
      setShowManual(true);
    }
  };

  const submitToken = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect(token);
      setToken("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.connectTitle")}</CardTitle>
      <div className="mt-4 space-y-4 text-sm text-ink-300">
        {!canLogin && (
          <div className="space-y-2 rounded-lg bg-surface-850 p-3">
            <p>{t("settings.stepClientId", { url: CALLBACK_URL })}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openUrl("https://anilist.co/settings/developer")}
            >
              {t("settings.openDeveloper")} <ExternalLink size={14} />
            </Button>
            <div className="flex gap-2">
              <Input
                value={clientId}
                onChange={(e) => {
                  setClientIdState(e.target.value);
                  setClientIdSaved(false);
                }}
                placeholder={t("settings.clientIdPlaceholder")}
                className="max-w-40"
                inputMode="numeric"
              />
              <Button variant="secondary" onClick={saveClientId}>
                {clientIdSaved ? t("common.saved") : t("common.save")}
              </Button>
            </div>
          </div>
        )}
        <p>{t("settings.stepLogin")}</p>
        <Button onClick={openLogin} disabled={!canLogin}>
          <LogIn size={16} /> {t("settings.loginButton")}
        </Button>
        {waiting && (
          <p className="text-xs text-accent-400">{t("settings.loginWaiting")}</p>
        )}
        <div>
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300"
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${showManual ? "rotate-90" : ""}`}
            />
            {t("settings.manualFallback")}
          </button>
          {showManual && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-ink-500">{t("settings.manualHint")}</p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("settings.tokenPlaceholder")}
                />
                <Button onClick={submitToken} disabled={busy || !token.trim()}>
                  {busy ? t("settings.checking") : t("settings.connect")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </Card>
  );
}

function ScrobbleSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ScrobbleSettings | null>(null);
  const [airing, setAiring] = useState<boolean | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    getScrobbleSettings().then(setSettings);
    api.getAiringNotify().then(setAiring);
  }, []);

  if (!settings) return null;

  const update = (patch: Partial<ScrobbleSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setScrobbleSettings(next);
  };

  const updateAiring = (v: boolean) => {
    setAiring(v);
    api.setAiringNotify(v);
  };

  return (
    <Card>
      <CardTitle>{t("settings.tracking")}</CardTitle>
      <div className="mt-3 space-y-3">
        <Toggle
          checked={settings.enabled}
          onChange={(v) => update({ enabled: v })}
          label={t("settings.trackingEnable")}
          hint={t("settings.trackingEnableHint")}
        />
        <Toggle
          checked={settings.confirm}
          onChange={(v) => update({ confirm: v })}
          label={t("settings.trackingConfirm")}
          hint={t("settings.trackingConfirmHint")}
        />
        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span>
            <span className="block text-ink-100">{t("settings.threshold")}</span>
            <span className="block text-xs text-ink-600">
              {t("settings.thresholdHint")}
            </span>
          </span>
          <Input
            type="number"
            min={0}
            max={120}
            value={settings.delayMin}
            onChange={(e) =>
              update({
                delayMin: Math.max(0, Math.min(120, Number(e.target.value))),
              })
            }
            className="w-20"
          />
        </label>
        {airing !== null && (
          <Toggle
            checked={airing}
            onChange={updateAiring}
            label={t("settings.airingNotify")}
            hint={t("settings.airingNotifyHint")}
          />
        )}
      </div>
    </Card>
  );
}

interface DiscordSettings {
  enabled: boolean;
  appId: string;
  hasBuiltinAppId: boolean;
}

function DiscordSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DiscordSettings | null>(null);
  const [saved, setSaved] = useState(false);

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
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Card>
      <CardTitle>{t("settings.discord")}</CardTitle>
      <div className="mt-3 space-y-3">
        <Toggle
          checked={settings.enabled}
          onChange={(v) => save({ ...settings, enabled: v })}
          label={t("settings.discordEnable")}
          hint={settings.hasBuiltinAppId ? t("settings.discordEnableHint") : undefined}
        />
        <p className="text-xs leading-relaxed text-ink-600">
          {t("settings.discordCustomId")}
        </p>
        <div className="flex gap-2">
          <Input
            value={settings.appId}
            onChange={(e) =>
              setSettings({ ...settings, appId: e.target.value })
            }
            placeholder={t("settings.discordAppIdPlaceholder")}
            className="max-w-60"
            inputMode="numeric"
          />
          <Button variant="secondary" onClick={() => save(settings)}>
            {saved ? t("common.saved") : t("common.save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AppSection() {
  const { t } = useTranslation();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<boolean>("get_autostart").then(setAutostart),
    );
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    setAutostart(enabled);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_autostart", { enabled });
  };

  const changeLanguage = (setting: LanguageSetting) => {
    setLang(setting);
    setLanguageSetting(setting);
  };

  return (
    <Card>
      <CardTitle>{t("settings.app")}</CardTitle>
      <div className="mt-3 space-y-3">
        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span>
            <span className="block text-ink-100">{t("settings.language")}</span>
            <span className="block text-xs text-ink-600">
              {t("settings.languageHint")}
            </span>
          </span>
          <select
            value={lang}
            onChange={(e) => changeLanguage(e.target.value as LanguageSetting)}
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {autostart !== null && (
          <Toggle
            checked={autostart}
            onChange={toggleAutostart}
            label={t("settings.autostart")}
            hint={t("settings.autostartHint")}
          />
        )}
      </div>
    </Card>
  );
}
