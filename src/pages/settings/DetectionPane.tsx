import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import * as api from "@/api/anilist";
import {
  getJellyfinSettings,
  getScrobbleSettings,
  getMediaDetection,
  jellyfinSignIn,
  jellyfinSignOut,
  setJellyfinSettings,
  setScrobbleSettings,
  setMediaDetection,
  mediaSessions,
  testJellyfin,
  type JellyfinSession,
  type JellyfinSettings,
  type ScrobbleSettings,
  type MediaSession,
} from "@/stores/nowPlaying";
import { isLinux, usePlatform } from "@/stores/platform";
import { Row, Toggle } from "./shared";
export function ScrobbleSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ScrobbleSettings | null>(null);
  const [airing, setAiring] = useState<boolean | null>(null);
  const [stale, setStale] = useState<api.StaleSettings | null>(null);
  const [sequel, setSequel] = useState<boolean | null>(null);
  const [mediaOn, setMediaOn] = useState<boolean | null>(null);
  const platform = usePlatform((s) => s.info);

  useEffect(() => {
    if (!api.isTauri) return;
    getScrobbleSettings().then(setSettings);
    api.getAiringNotify().then(setAiring);
    api.getStaleSettings().then(setStale);
    api.getSequelNotify().then(setSequel);
    getMediaDetection().then(setMediaOn);
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
        {mediaOn !== null && (
          <Toggle
            checked={mediaOn}
            onChange={(v) => {
              setMediaOn(v);
              setMediaDetection(v);
            }}
            label={t("settings.mediaSessions")}
            hint={
              // Worth saying out loud on Linux: this pass is the only thing
              // that sees a local player there, so switching it off is not
              // the small refinement the generic hint suggests.
              isLinux(platform)
                ? t("settings.mediaSessionsLinuxOnly")
                : t("settings.mediaSessionsHint")
            }
          />
        )}
        <Row label={t("settings.threshold")} hint={t("settings.thresholdHint")}>
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
        </Row>
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
              <Row
                label={t("settings.staleMonths")}
                hint={t("settings.staleMonthsHint")}
              >
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
              </Row>
            )}
          </>
        )}
        <MediaSessionDiagnostic />
      </div>
    </Card>
  );
}

/**
 * Shows what the desktop currently reports for every media session.
 *
 * Players disagree about which field carries the show and which carries the
 * episode, and some publish nothing at all. Without this there is no way to
 * tell "Karasu ignored it" from "the player never told the system" — which is
 * exactly the question when a title isn't picked up.
 */
function MediaSessionDiagnostic() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<MediaSession[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setSessions(await mediaSessions());
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
                {/* MPRIS only. Rendered when present rather than always, so
                    the Windows diagnostic looks exactly as it did. */}
                {s.url && (
                  <>
                    <dt>url</dt>
                    <dd className="break-all text-ink-300">{s.url}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface MpvIpcSettings {
  enabled: boolean;
  path: string;
  defaultPath: string;
}

/**
 * The mpv IPC pipe — the detection source that knows the most, for the user
 * willing to add one line to `mpv.conf`. Opt-in, because probing a pipe
 * nobody configured every five seconds would be waste dressed as a feature.
 * The hint quotes the exact `input-ipc-server=` line for the *effective*
 * path, so the two sides of the pipe cannot quietly disagree.
 */
export function MpvSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MpvIpcSettings | null>(null);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<MpvIpcSettings>("get_mpv_ipc").then(setSettings).catch(() => {});
    });
  }, []);

  if (!settings) return null;

  const apply = async (next: { enabled: boolean; path: string }) => {
    const prev = settings;
    setSettings({ ...settings, ...next });
    setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_mpv_ipc", next);
    } catch (e) {
      setSettings(prev);
      setError(String(e));
    }
  };

  const applyPath = () => {
    const next = (pathDraft ?? settings.path).trim();
    setPathDraft(null);
    if (next === settings.path) return;
    void apply({ enabled: settings.enabled, path: next });
  };

  return (
    <Card>
      <CardTitle>{t("settings.mpv")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">
        {t("settings.mpvHint", { path: settings.path })}
      </p>
      <div className="mt-3 space-y-3">
        <Toggle
          checked={settings.enabled}
          onChange={(enabled) => apply({ enabled, path: settings.path })}
          label={t("settings.mpvEnable")}
          hint={t("settings.mpvEnableHint")}
        />
        <Row label={t("settings.mpvPath")} hint={t("settings.mpvPathHint")}>
          <Input
            value={pathDraft ?? settings.path}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={applyPath}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyPath();
              }
            }}
            disabled={!settings.enabled}
            className="w-72"
          />
        </Row>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

/**
 * Optional Jellyfin server connection.
 *
 * The system media-session pass already covers Jellyfin Media Player with no
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
export function JellyfinSection() {
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
          <p className="text-sm text-success">
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
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
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
              ? "border-success/40 bg-success/10"
              : "border-surface-800 bg-surface-900",
          )}
        >
          <p className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium text-ink-300">
              {s.user || t("settings.jellyfinUnknownUser")}
            </span>
            <span className="text-ink-600">·</span>
            <span className="text-ink-500">
              {s.device || t("settings.jellyfinUnknownDevice")}
            </span>
            {s.client && (
              <span className="text-xs text-ink-600">({s.client})</span>
            )}
            {s.matched && (
              <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs text-success">
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
        <p className="pt-1 text-xs text-gold">
          {t("settings.jellyfinNoMatch")}
        </p>
      )}
    </div>
  );
}
