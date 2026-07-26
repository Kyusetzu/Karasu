import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  ExternalLink,
  FolderOpen,
  LogIn,
  LogOut,
  Palette,
  RefreshCw,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/contrast";
import { useAuth } from "@/stores/auth";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { CONTENT_FILTER_LEVELS } from "@/lib/contentFilter";
import { ACCENT_PRESETS, useTheme, type ThemeMode } from "@/stores/theme";
import * as api from "@/api/anilist";
import * as library from "@/api/library";
import {
  getJellyfinSettings,
  getScrobbleSettings,
  getSmtcEnabled,
  jellyfinSignIn,
  jellyfinSignOut,
  setJellyfinSettings,
  setScrobbleSettings,
  setSmtcEnabled,
  smtcSessions,
  testJellyfin,
  type JellyfinSession,
  type JellyfinSettings,
  type ScrobbleSettings,
  type SmtcSession,
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
    <div className="mx-auto max-w-2xl p-8 2xl:max-w-none">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      {/* Every section is self-contained, so they can sit side by side once
          there's room. A grid rather than CSS `columns` because that would
          reorder them, and Account belongs first. `items-start` keeps each
          card its natural height instead of stretching to the tallest. */}
      <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(26rem,1fr))] items-start gap-6">
        <AccountSection />
        <ScrobbleSection />
        <JellyfinSection />
        <LibrarySection />
        <ContentSection />
        <DiscordSection />
        <AppSection />
        <PortableSection />
      </div>
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

/**
 * Content filter. A three-stop slider rather than a toggle: "hide everything
 * 18+" and "hide suggestive material too" are genuinely different asks, and
 * AniList only flags the former (`isAdult`) — Ecchi is an ordinary genre.
 */
function ContentSection() {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const ready = useContentFilter((s) => s.ready);
  const setLevel = useContentFilter((s) => s.setLevel);
  const index = CONTENT_FILTER_LEVELS.indexOf(level);

  return (
    <Card>
      <CardTitle>{t("settings.content")}</CardTitle>
      {ready && (
        <div className="mt-4 space-y-3">
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={index < 0 ? 2 : index}
            onChange={(e) =>
              setLevel(CONTENT_FILTER_LEVELS[Number(e.target.value)])
            }
            aria-label={t("settings.contentFilter")}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-700 accent-accent-500"
          />
          <div className="flex justify-between text-xs">
            {CONTENT_FILTER_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={cn(
                  "transition-colors",
                  l === level
                    ? "font-semibold text-accent-400"
                    : "text-ink-600 hover:text-ink-300",
                )}
              >
                {t(`settings.contentLevel_${l}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            {t(`settings.contentHint_${level}`)}
          </p>
          <p className="text-xs text-ink-600">{t("settings.contentNote")}</p>
        </div>
      )}
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

/** Inline saturation/value + hue picker — replaces the native `<input type="color">`,
 * which spawns an OS-level colour dialog that can misbehave inside the Tauri window. */
function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const validValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#6c7fff";
  const [hsv, setHsvState] = useState<Hsv>(() => hexToHsv(validValue));
  const hsvRef = useRef(hsv);
  const [hexInput, setHexInput] = useState(validValue);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Stay in sync if the accent changes from outside (e.g. a preset click).
  useEffect(() => {
    const next = hexToHsv(validValue);
    hsvRef.current = next;
    setHsvState(next);
    setHexInput(validValue);
  }, [validValue]);

  const commit = (next: Hsv) => {
    hsvRef.current = next;
    setHsvState(next);
    const hex = hsvToHex(next);
    setHexInput(hex);
    onChange(hex);
  };

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const beginDrag = (
    el: HTMLDivElement,
    e: React.PointerEvent,
    compute: (x: number, y: number, rect: DOMRect) => Hsv,
  ) => {
    el.setPointerCapture(e.pointerId);
    const apply = (x: number, y: number) =>
      commit(compute(x, y, el.getBoundingClientRect()));
    apply(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  return (
    <div className="space-y-2 rounded-lg border border-surface-700 bg-surface-900 p-3">
      <div
        ref={svRef}
        onPointerDown={(e) =>
          svRef.current &&
          beginDrag(svRef.current, e, (x, y, rect) => ({
            h: hsvRef.current.h,
            s: clamp01((x - rect.left) / rect.width) * 100,
            v: 100 - clamp01((y - rect.top) / rect.height) * 100,
          }))
        }
        className="relative h-28 w-full touch-none rounded-md"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
        }}
      >
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={(e) =>
          hueRef.current &&
          beginDrag(hueRef.current, e, (x, _y, rect) => ({
            h: clamp01((x - rect.left) / rect.width) * 360,
            s: hsvRef.current.s,
            v: hsvRef.current.v,
          }))
        }
        className="relative h-3 w-full touch-none rounded-full"
        style={{
          background:
            "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)",
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>

      <input
        type="text"
        value={hexInput}
        onChange={(e) => setHexInput(e.target.value)}
        onBlur={() => {
          if (/^#[0-9a-f]{6}$/i.test(hexInput)) commit(hexToHsv(hexInput));
          else setHexInput(hsvToHex(hsv));
        }}
        spellCheck={false}
        maxLength={7}
        className="w-full rounded-md border border-surface-700 bg-surface-850 px-2 py-1 font-mono text-xs uppercase focus:border-accent-500 focus:outline-none"
      />
    </div>
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
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useAniListLogin();

  useEffect(() => {
    if (!api.isTauri) return;
    api.authInfo().then((i) => {
      setInfo(i);
      if (i.customClientId) {
        setClientIdState(i.customClientId);
        setClientIdSaved(true);
      }
    });
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
              {t("settings.profileLink")} <ExternalLink className="size-3" />
            </button>
          </div>
          <Button variant="danger" onClick={() => logout()}>
            <LogOut className="size-4" /> {t("settings.logout")}
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

  // If the one-click handoff can't even start, reveal the manual token paste.
  const openLogin = async () => {
    setError(null);
    if (!(await login.start())) setShowManual(true);
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
              {t("settings.openDeveloper")} <ExternalLink className="size-3.5" />
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
          <LogIn className="size-4" /> {t("settings.loginButton")}
        </Button>
        {login.waiting && (
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
              className={cn("size-3 transition-transform", showManual && "rotate-90")}
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
      {(error ?? login.error) && (
        <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error ?? login.error}
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
  const [smtc, setSmtc] = useState<boolean | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    getScrobbleSettings().then(setSettings);
    api.getAiringNotify().then(setAiring);
    api.getStaleSettings().then(setStale);
    api.getSequelNotify().then(setSequel);
    getSmtcEnabled().then(setSmtc);
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
        {smtc !== null && (
          <Toggle
            checked={smtc}
            onChange={(v) => {
              setSmtc(v);
              setSmtcEnabled(v);
            }}
            label={t("settings.smtc")}
            hint={t("settings.smtcHint")}
          />
        )}
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
        <SmtcDiagnostic />
      </div>
    </Card>
  );
}

/**
 * Shows what Windows currently reports for every media session.
 *
 * Players disagree about which field carries the show and which carries the
 * episode, and some publish nothing at all. Without this there is no way to
 * tell "Karasu ignored it" from "the player never told Windows" — which is
 * exactly the question when a title isn't picked up.
 */
function SmtcDiagnostic() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SmtcSession[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setSessions(await smtcSessions());
    } catch {
      setSessions([]);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && sessions === null) refresh();
  };

  return (
    <div className="border-t border-surface-800 pt-3">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {t("settings.detectionDebug")}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-ink-600">
            {t("settings.detectionDebugHint")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={busy}
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />{" "}
            {t("settings.refreshDebug")}
          </Button>
          {sessions?.length === 0 && (
            <p className="text-xs text-ink-600">
              {t("settings.detectionDebugEmpty")}
            </p>
          )}
          {sessions?.map((s, i) => (
            <div
              key={`${s.appId}-${i}`}
              className="rounded-lg bg-surface-850 p-2 text-xs"
            >
              <p className="break-all font-medium text-ink-100">{s.appId}</p>
              <dl className="mt-1 grid grid-cols-[5rem_1fr] gap-x-2 gap-y-0.5 text-ink-500">
                <dt>title</dt>
                <dd className="break-all text-ink-300">{s.title || "—"}</dd>
                <dt>artist</dt>
                <dd className="break-all text-ink-300">{s.artist || "—"}</dd>
                <dt>album</dt>
                <dd className="break-all text-ink-300">{s.album || "—"}</dd>
                <dt>type</dt>
                <dd className="text-ink-300">{s.playbackType}</dd>
                <dt>status</dt>
                <dd className="text-ink-300">{s.status}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Optional Jellyfin server connection.
 *
 * The Windows media-session pass already covers Jellyfin Media Player with no
 * setup. This is for when that isn't enough: the server reports the series,
 * season and episode as separate fields, so nothing has to be parsed.
 *
 * Signing in as a user rather than with an admin API key is deliberate and
 * load-bearing — Jellyfin scopes `/Sessions` to the calling account, but only
 * when the caller isn't an API key. It also means an ordinary account is
 * enough. The password is submitted once and never stored; only the returned
 * token reaches the credential store.
 *
 * Test connection still lists non-matching sessions, because a device name one
 * character off is otherwise indistinguishable from "nothing is playing".
 */
function JellyfinSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<JellyfinSettings | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [sessions, setSessions] = useState<JellyfinSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    getJellyfinSettings().then((s) => {
      setSettings(s);
      setUrl(s.url);
      setDevice(s.device);
    });
  }, []);

  if (!settings) return null;

  const signIn = async () => {
    setSigningIn(true);
    setError(null);
    setSessions(null);
    try {
      const next = await jellyfinSignIn(url, username, password);
      // Drop the password the moment it has been exchanged for a token.
      setPassword("");
      setUsername("");
      setSettings(next);
      // The device field is saved separately; persist whatever is in it now so
      // signing in doesn't quietly discard an edit.
      await setJellyfinSettings(url, device);
    } catch (e) {
      setError(String(e));
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    setError(null);
    setSessions(null);
    try {
      setSettings(await jellyfinSignOut());
    } catch (e) {
      setError(String(e));
    }
  };

  const save = async () => {
    setError(null);
    setSessions(null);
    try {
      await setJellyfinSettings(url, device);
      setSettings(await getJellyfinSettings());
    } catch (e) {
      setError(String(e));
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setSessions(null);
    try {
      setSessions(await testJellyfin());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.jellyfin")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.jellyfinHint")}</p>
      <div className="mt-3 space-y-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("settings.jellyfinUrlPlaceholder")}
          disabled={settings.connected}
        />

        {settings.connected ? (
          <p className="text-sm text-emerald-400">
            {t("settings.jellyfinSignedIn", {
              name: settings.userName || "?",
            })}
          </p>
        ) : (
          <>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("settings.jellyfinUsernamePlaceholder")}
              autoComplete="off"
            />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("settings.jellyfinPasswordPlaceholder")}
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !signingIn) void signIn();
              }}
            />
          </>
        )}

        <Input
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          placeholder={settings.localDevice || t("settings.jellyfinDeviceAny")}
        />

        <div className="flex flex-wrap gap-2">
          {settings.connected ? (
            <>
              <Button variant="secondary" onClick={save}>
                {t("common.save")}
              </Button>
              <Button onClick={test} disabled={busy}>
                <RefreshCw className={cn("size-4", busy && "animate-spin")} />{" "}
                {t("settings.jellyfinTest")}
              </Button>
              <Button variant="secondary" onClick={signOut}>
                {t("settings.jellyfinSignOut")}
              </Button>
            </>
          ) : (
            <Button onClick={signIn} disabled={signingIn || url.trim() === ""}>
              {signingIn
                ? t("settings.jellyfinSigningIn")
                : t("settings.jellyfinSignIn")}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-600">
        {t("settings.jellyfinAccountHelp")}
      </p>
      <p className="mt-1 text-xs text-ink-600">
        {t("settings.jellyfinDeviceHelp")}
      </p>
      {sessions && <SessionList sessions={sessions} />}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </Card>
  );
}

/** The Test-connection result: what the server sees, and what we accept. */
function SessionList({ sessions }: { sessions: JellyfinSession[] }) {
  const { t } = useTranslation();

  if (sessions.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-500">
        {t("settings.jellyfinNoSessions")}
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      {sessions.map((s, i) => (
        <div
          key={`${s.device}-${s.user}-${i}`}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            s.matched
              ? "border-emerald-700/60 bg-emerald-950/30"
              : "border-surface-800 bg-surface-900",
          )}
        >
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium text-ink-200">
              {s.user || t("settings.jellyfinUnknownUser")}
            </span>
            <span className="text-ink-600">·</span>
            <span className="text-ink-400">
              {s.device || t("settings.jellyfinUnknownDevice")}
            </span>
            {s.client && (
              <span className="text-xs text-ink-600">({s.client})</span>
            )}
            {s.matched && (
              <span className="rounded-full bg-emerald-700/40 px-2 py-0.5 text-xs text-emerald-200">
                {t("settings.jellyfinMatched")}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {s.playing ?? t("settings.jellyfinIdle")}
          </p>
        </div>
      ))}
      {!sessions.some((s) => s.matched) && (
        <p className="pt-1 text-xs text-amber-300">
          {t("settings.jellyfinNoMatch")}
        </p>
      )}
    </div>
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

const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

function AppSection() {
  const { t } = useTranslation();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [lang, setLang] = useState<LanguageSetting>(getLanguageSetting());
  const [updateAuto, setUpdateAuto] = useState<boolean | null>(null);
  const [updateChannel, setUpdateChannelState] =
    useState<api.UpdateChannel>("prerelease");
  const [showCustomAccent, setShowCustomAccent] = useState(false);
  const themeMode = useTheme((s) => s.mode);
  const accent = useTheme((s) => s.accent);
  const setThemeMode = useTheme((s) => s.setMode);
  const setAccent = useTheme((s) => s.setAccent);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke<boolean>("get_autostart").then(setAutostart),
    );
    api.getUpdateCheckAuto().then(setUpdateAuto);
    api.getUpdateChannel().then(setUpdateChannelState);
  }, []);

  const toggleAutostart = async (enabled: boolean) => {
    setAutostart(enabled);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_autostart", { enabled });
  };

  const toggleUpdateAuto = (enabled: boolean) => {
    setUpdateAuto(enabled);
    api.setUpdateCheckAuto(enabled);
  };

  const changeUpdateChannel = (channel: api.UpdateChannel) => {
    setUpdateChannelState(channel);
    api.setUpdateChannel(channel);
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

        <div className="space-y-3 py-1">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="block text-ink-100">{t("settings.accent")}</span>
            <div className="flex items-center gap-2">
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setAccent(hex)}
                  className={cn(
                    "h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-900 transition",
                    accent.toLowerCase() === hex.toLowerCase() && "ring-2 ring-ink-100",
                  )}
                  style={{ backgroundColor: hex }}
                  aria-label={hex}
                  title={hex}
                />
              ))}
              <button
                type="button"
                onClick={() => setShowCustomAccent((v) => !v)}
                aria-expanded={showCustomAccent}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full border border-surface-600 transition",
                  showCustomAccent && "border-accent-500 text-accent-400",
                )}
                title={t("settings.accentCustom")}
                aria-label={t("settings.accentCustom")}
              >
                <Palette className="size-3.25 text-current" />
              </button>
            </div>
          </div>
          {showCustomAccent && (
            <ColorPicker value={accent} onChange={setAccent} />
          )}
        </div>

        {autostart !== null && (
          <Toggle
            checked={autostart}
            onChange={toggleAutostart}
            label={t("settings.autostart")}
            hint={t("settings.autostartHint")}
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
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
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
