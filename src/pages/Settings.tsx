import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import {
  ChevronRight,
  ExternalLink,
  FolderOpen,
  LogIn,
  LogOut,
  RefreshCw,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useLibrary } from "@/stores/library";
import { ACCENTS, useTheme, type ThemeMode } from "@/stores/theme";
import * as api from "@/api/anilist";
import * as library from "@/api/library";
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
      <LibrarySection />
      <DiscordSection />
      <AppSection />
      <PortableSection />
    </div>
  );
}

interface PortableStatus {
  portable: boolean;
  dir: string;
}

function PortableSection() {
  const { t } = useTranslation();
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
      {restart && (
        <p className="mt-2 text-sm text-amber-300">{t("settings.portableRestart")}</p>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </Card>
  );
}

function LibrarySection() {
  const { t } = useTranslation();
  const refreshLibrary = useLibrary((s) => s.refresh);
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
          <FolderOpen size={16} /> {t("settings.libraryChoose")}
        </Button>
        {path && (
          <Button onClick={scan} disabled={scanning}>
            <RefreshCw size={16} className={scanning ? "animate-spin" : ""} />{" "}
            {scanning ? t("settings.libraryScanning") : t("settings.libraryScan")}
          </Button>
        )}
      </div>
      {path && (
        <p className="mt-3 break-all text-xs text-ink-600">{path}</p>
      )}
      {matched !== null && (
        <p className="mt-1 text-sm text-emerald-400">
          {t("settings.libraryMatched", { n: matched })}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </Card>
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
  const { viewer, mode, connect, logout, enableLocal } = useAuth();
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
        <div className="border-t border-surface-800 pt-3">
          {mode === "local" ? (
            <p className="text-xs text-ink-500">{t("settings.localActive")}</p>
          ) : (
            <>
              <p className="text-xs text-ink-500">{t("settings.localHint")}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => enableLocal()}
              >
                {t("settings.localStart")}
              </Button>
            </>
          )}
        </div>
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
  const [stale, setStale] = useState<api.StaleSettings | null>(null);
  const [sequel, setSequel] = useState<boolean | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    getScrobbleSettings().then(setSettings);
    api.getAiringNotify().then(setAiring);
    api.getStaleSettings().then(setStale);
    api.getSequelNotify().then(setSequel);
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

  const updateSequel = (v: boolean) => {
    setSequel(v);
    api.setSequelNotify(v);
  };

  const updateStale = (patch: Partial<api.StaleSettings>) => {
    if (!stale) return;
    const next = { ...stale, ...patch };
    setStale(next);
    api.setStaleSettings(next.enabled, next.months);
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
        {sequel !== null && (
          <Toggle
            checked={sequel}
            onChange={updateSequel}
            label={t("settings.sequelNotify")}
            hint={t("settings.sequelNotifyHint")}
          />
        )}
        {stale && (
          <>
            <Toggle
              checked={stale.enabled}
              onChange={(v) => updateStale({ enabled: v })}
              label={t("settings.staleNotify")}
              hint={t("settings.staleNotifyHint")}
            />
            {stale.enabled && (
              <label className="flex items-center justify-between gap-4 py-1 text-sm">
                <span>
                  <span className="block text-ink-100">
                    {t("settings.staleMonths")}
                  </span>
                  <span className="block text-xs text-ink-600">
                    {t("settings.staleMonthsHint")}
                  </span>
                </span>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={stale.months}
                  onChange={(e) =>
                    updateStale({
                      months: Math.max(1, Math.min(24, Number(e.target.value))),
                    })
                  }
                  className="w-20"
                />
              </label>
            )}
          </>
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

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

function AppSection() {
  const { t } = useTranslation();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());
  const themeMode = useTheme((s) => s.mode);
  const accent = useTheme((s) => s.accent);
  const setThemeMode = useTheme((s) => s.setMode);
  const setAccent = useTheme((s) => s.setAccent);

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

        <label className="flex items-center justify-between gap-4 py-1 text-sm">
          <span className="block text-ink-100">{t("settings.theme")}</span>
          <select
            value={themeMode}
            onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {THEME_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`settings.theme_${m}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-4 py-1 text-sm">
          <span className="block text-ink-100">{t("settings.accent")}</span>
          <div className="flex gap-2">
            {Object.entries(ACCENTS).map(([key, shades]) => (
              <button
                key={key}
                onClick={() => setAccent(key)}
                className={cn(
                  "h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-900 transition",
                  accent === key && "ring-2 ring-ink-100",
                )}
                style={{ backgroundColor: shades[1] }}
                aria-label={key}
                title={key}
              />
            ))}
          </div>
        </div>

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
