import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { DisclosurePanel } from "@/components/ui/disclosure";
import { cn } from "@/lib/utils";
import * as api from "@/api/anilist";
import {
  clearDetectionOverride,
  discoverJellyfinServers,
  getJellyfinBackground,
  getJellyfinSettings,
  getScrobbleSettings,
  getMediaDetection,
  jellyfinSignIn,
  jellyfinSignOut,
  listDetectionOverrides,
  requestBatteryExemption,
  setJellyfinBackground,
  setJellyfinSettings,
  setScrobbleSettings,
  setMediaDetection,
  mediaSessions,
  testJellyfin,
  type DetectionOverride,
  type DiscoveredServer,
  type JellyfinBackground,
  type JellyfinSession,
  type JellyfinSettings,
  type JellyfinTest,
  type ScrobbleSettings,
  type MediaSession,
} from "@/stores/nowPlaying";
import { isAndroid, isLinux, usePlatform } from "@/stores/platform";
import { useAuth } from "@/stores/auth";
import { ExternalNote, Row, Toggle } from "./shared";
import { anilistCoversAiring } from "@/lib/airingCoverage";
import { backendErrorText } from "@/lib/backendError";
import { commands, unwrap } from "@/api/tauri";
import { Spinner } from "@/components/ui/spinner";
import { Chip } from "@/components/ui/chip";
export function ScrobbleSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ScrobbleSettings | null>(null);
  const [airing, setAiring] = useState<boolean | null>(null);
  const [stale, setStale] = useState<api.StaleSettings | null>(null);
  const [sequel, setSequel] = useState<boolean | null>(null);
  const [mediaOn, setMediaOn] = useState<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const platform = usePlatform((s) => s.info);
  const viewer = useAuth((s) => s.viewer);

  useEffect(() => {
    if (!api.isTauri) return;
    getScrobbleSettings().then(setSettings);
    api.getAiringNotify().then(setAiring);
    api.getStaleSettings().then(setStale);
    api.getSequelNotify().then(setSequel);
    getMediaDetection().then(setMediaOn);
  }, []);

  if (!settings) return null;

  /** Paint, persist, and roll the control back if persisting failed, so the switch cannot lie about the key. */
  const persist = (save: Promise<unknown>, revert: () => void) => {
    setSaveError(null);
    save.catch((e) => {
      revert();
      setSaveError(String(e));
    });
  };

  const update = (patch: Partial<ScrobbleSettings>) => {
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    persist(setScrobbleSettings(next), () => setSettings(previous));
  };

  const updateAiring = (v: boolean) => {
    setAiring(v);
    persist(api.setAiringNotify(v), () => setAiring(!v));
  };

  const updateSequel = (v: boolean) => {
    setSequel(v);
    persist(api.setSequelNotify(v), () => setSequel(!v));
  };

  const updateStale = (patch: Partial<api.StaleSettings>) => {
    if (!stale) return;
    const previous = stale;
    const next = { ...stale, ...patch };
    setStale(next);
    persist(api.setStaleSettings(next.enabled, next.months), () =>
      setStale(previous),
    );
  };

  return (
    <Card>
      <CardTitle>{t("settings.tracking")}</CardTitle>
      {/* Without an account detection only shows what is playing; say so, or the feature looks broken. */}
      {!viewer && (
        <p className="mt-2 text-sm text-gold">{t("settings.trackingNeedsAccount")}</p>
      )}
      {saveError && (
        <p className="mt-2 text-sm text-danger">
          {t("settings.trackingSaveFailed", { message: saveError })}
        </p>
      )}
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
        <Toggle
          checked={settings.gapAuto}
          onChange={(v) => update({ gapAuto: v })}
          label={t("settings.trackingGapAuto")}
          hint={t("settings.trackingGapAutoHint")}
        />
        {/* The one desktop-only row here: a phone has no SMTC, so the row hides itself rather than greying the card. */}
        {mediaOn !== null && !isAndroid(platform) && (
          <Toggle
            checked={mediaOn}
            onChange={(v) => {
              setMediaOn(v);
              persist(setMediaDetection(v), () => setMediaOn(!v));
            }}
            label={t("settings.mediaSessions")}
            hint={
              // On Linux this pass is the only thing that sees a local player, so the hint must say so.
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
          <>
            <Toggle
              checked={airing}
              onChange={updateAiring}
              label={t("settings.airingNotify")}
              hint={t("settings.airingNotifyHint")}
            />
            {/* Same cached viewer the watcher reads, so a stale blob is visibly wrong here rather than silently wrong. */}
            {airing && anilistCoversAiring(viewer) && (
              <ExternalNote>{t("settings.airingNotifyAniList")}</ExternalNote>
            )}
          </>
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
      </div>
    </Card>
  );
}

/** What every media session reports, fetched on first expand; on Linux this pass is all of local detection. */
export function MediaSessionSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const [sessions, setSessions] = useState<MediaSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setSessions(await mediaSessions());
      setError(null);
    } catch (e) {
      // Keep null, not []: an empty list means idle, while unreachable means the feature is down.
      setSessions(null);
      setError(String(e));
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
    <Card>
      <CardTitle>{t("settings.mediaSessionsTitle")}</CardTitle>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="mt-3 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {t("settings.detectionDebug")}
      </button>
      <DisclosurePanel open={open} id={panelId} className="mt-2 space-y-2">
        <p className="text-xs text-ink-600">
          {t("settings.detectionDebugHint")}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={busy}
        >
          <Spinner spinning={busy} className="size-3.5" />{" "}
          {t("settings.refreshDebug")}
        </Button>
        {error && (
          <p className="text-xs text-danger">
            {t("settings.detectionDebugFailed", { message: error })}
          </p>
        )}
        {!error && sessions?.length === 0 && (
          <p className="text-xs text-ink-600">
            {t("settings.detectionDebugEmpty")}
          </p>
        )}
        {sessions?.map((s, i) => (
          <div
            key={`${s.appId}-${i}`}
            className="rounded-control bg-surface-850 p-2 text-xs"
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
              {/* MPRIS only; rendered when present so the Windows diagnostic looks exactly as it did. */}
              {s.url && (
                <>
                  <dt>url</dt>
                  <dd className="break-all text-ink-300">{s.url}</dd>
                </>
              )}
            </dl>
          </div>
        ))}
      </DisclosurePanel>
    </Card>
  );
}

/** The now-playing card's corrections, reviewable and revocable here; absent until there is one. */
export function DetectionCorrectionsSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<DetectionOverride[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!api.isTauri) return;
    listDetectionOverrides().then(setRows).catch(() => {});
  };
  useEffect(load, []);

  if (!rows || rows.length === 0) return null;

  const remove = async (row: DetectionOverride) => {
    setError(null);
    try {
      await clearDetectionOverride({
        title: row.title,
        // Back to the `null` the command expects; `-1` is the storage sentinel, not the API's business.
        season: row.season < 0 ? null : row.season,
        mediaType: row.mediaType,
      });
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Card>
      <CardTitle>{t("settings.corrections")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.correctionsHint")}</p>
      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <li
            key={`${row.mediaType}-${row.season}-${row.title}`}
            className="flex items-center gap-3 rounded-control bg-surface-900 px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <Link
                to={`/media/${row.mediaId}`}
                className="block truncate text-xs text-ink-100 hover:text-accent-400"
              >
                {row.displayTitle}
              </Link>
              <span className="mt-0.5 block truncate text-2xs text-ink-600">
                {t("settings.correctionsFrom", { title: row.title })}
                {row.season > 0 && ` · S${row.season}`}
                {row.episodeOffset !== 0 &&
                  ` · ${t("settings.correctionsOffset", {
                    offset: row.episodeOffset > 0 ? `+${row.episodeOffset}` : row.episodeOffset,
                  })}`}
              </span>
            </span>
            <IconButton
              variant="ghost"
              onClick={() => remove(row)}
              aria-label={t("library.clearMatch")}
              title={t("library.clearMatch")}
            >
              <X className="size-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

interface MpvIpcSettings {
  enabled: boolean;
  path: string;
  defaultPath: string;
  launchPath: string;
}

/** The opt-in mpv IPC pipe; the hint quotes the effective path so the two sides of it cannot disagree. */
export function MpvSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MpvIpcSettings | null>(null);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [launchDraft, setLaunchDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    commands.getMpvIpc().then(setSettings).catch(() => {});
  }, []);

  if (!settings) return null;

  const apply = async (next: { enabled: boolean; path: string; launchPath: string }) => {
    const prev = settings;
    setSettings({ ...settings, ...next });
    setError(null);
    try {
      await unwrap(commands.setMpvIpc(next.enabled, next.path, next.launchPath));
    } catch (e) {
      setSettings(prev);
      setError(String(e));
    }
  };

  const current = () => ({
    enabled: settings.enabled,
    path: settings.path,
    launchPath: settings.launchPath,
  });

  const applyPath = () => {
    const next = (pathDraft ?? settings.path).trim();
    setPathDraft(null);
    if (next === settings.path) return;
    void apply({ ...current(), path: next });
  };

  const applyLaunch = () => {
    const next = (launchDraft ?? settings.launchPath).trim();
    setLaunchDraft(null);
    if (next === settings.launchPath) return;
    void apply({ ...current(), launchPath: next });
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
          onChange={(enabled) => apply({ ...current(), enabled })}
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
        <Row label={t("settings.mpvLaunch")} hint={t("settings.mpvLaunchHint")}>
          <Input
            value={launchDraft ?? settings.launchPath}
            onChange={(e) => setLaunchDraft(e.target.value)}
            onBlur={applyLaunch}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLaunch();
              }
            }}
            placeholder={t("settings.mpvLaunchPlaceholder")}
            className="w-72"
          />
        </Row>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}

/** Optional Jellyfin connection; signing in as a user, never an API key, is what scopes /Sessions to the account. */
export function JellyfinSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<JellyfinSettings | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [sessions, setSessions] = useState<JellyfinTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<DiscoveredServer[] | null>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!api.isTauri) return;
    getJellyfinSettings().then((s) => {
      setSettings(s);
      setUrl(s.url);
      setDevice(s.device);
      setExternalUrl(s.externalUrl);
    });
  }, []);

  if (!settings) return null;

  const find = async () => {
    setFinding(true);
    setError(null);
    setFound(null);
    try {
      setFound(await discoverJellyfinServers());
    } catch (e) {
      setError(t("settings.jellyfinFindFailed", { message: backendErrorText(e, t) }));
    } finally {
      setFinding(false);
    }
  };

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
      // Device and external URL are saved separately; persist them now so signing in cannot discard an edit.
      await setJellyfinSettings(url, device, externalUrl);
      setSettings(await getJellyfinSettings());
    } catch (e) {
      setError(backendErrorText(e, t));
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
      setError(backendErrorText(e, t));
    }
  };

  const save = async () => {
    setSaveError(null);
    setSessions(null);
    try {
      await setJellyfinSettings(url, device, externalUrl);
      setSettings(await getJellyfinSettings());
    } catch (e) {
      setSaveError(backendErrorText(e, t));
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setSessions(null);
    try {
      setSessions(await testJellyfin());
    } catch (e) {
      setError(backendErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const externalCurrent = settings.externalUrl !== "" && settings.externalUrl === externalUrl.trim();

  return (
    <Card>
      <CardTitle>{t("settings.jellyfin")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.jellyfinHint")}</p>

      {/* The connection leads: the sign-in while there is none, then one status line with the two things it can do. */}
      <div className="mt-4 rounded-control border border-hair bg-surface-950 p-3">
        {settings.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-ink-100">
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
                {t("settings.jellyfinConnectedTo", { server: settings.serverName || settings.url })}
              </p>
              <p className="mt-0.5 truncate text-xs text-ink-500">
                {t("settings.jellyfinSignedIn", { name: settings.userName || "?" })}
                {settings.serverName && ` · ${settings.url}`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={test} disabled={busy}>
                <Spinner spinning={busy} className="size-3.5" /> {t("settings.jellyfinTest")}
              </Button>
              <Button size="sm" variant="secondary" onClick={signOut}>
                {t("settings.jellyfinSignOut")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Jellyfin's own discovery: the servers on this network, one click each, so no address is typed. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button variant="secondary" size="sm" onClick={find} disabled={finding}>
                <Search className={cn("size-4", finding && "animate-pulse")} />{" "}
                {finding ? t("settings.jellyfinFinding") : t("settings.jellyfinFind")}
              </Button>
              <span className="text-xs text-ink-600">{t("settings.jellyfinFindHint")}</span>
            </div>
            {found &&
              (found.length === 0 ? (
                <p className="text-sm text-ink-500">{t("settings.jellyfinFoundNone")}</p>
              ) : (
                <div className="space-y-1.5">
                  {found.map((s) => (
                    <button
                      key={s.address}
                      type="button"
                      onClick={() => {
                        setUrl(s.address);
                        setFound(null);
                      }}
                      className="flex w-full flex-wrap items-center justify-between gap-x-3 rounded-control border border-hair bg-surface-900 px-3 py-2 text-left text-sm transition-surface hover:border-surface-600"
                    >
                      <span className="font-medium text-ink-300">{s.name || s.address}</span>
                      <span className="text-xs text-ink-500">
                        {s.address}
                        {s.version ? ` · v${s.version}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            <Field label={t("settings.jellyfinUrl")} htmlFor={`${fieldId}-url`}>
              <Input
                id={`${fieldId}-url`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("settings.jellyfinUrlPlaceholder")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.jellyfinUsername")} htmlFor={`${fieldId}-user`}>
                <Input
                  id={`${fieldId}-user`}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label={t("settings.jellyfinPassword")} htmlFor={`${fieldId}-password`}>
                <Input
                  id={`${fieldId}-password`}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !signingIn) void signIn();
                  }}
                />
              </Field>
            </div>
            <Button onClick={signIn} disabled={signingIn || url.trim() === ""}>
              {signingIn ? t("settings.jellyfinSigningIn") : t("settings.jellyfinSignIn")}
            </Button>
            <p className="text-xs text-ink-600">{t("settings.jellyfinAccountHelp")}</p>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
      {sessions && (
        <SessionList
          sessions={sessions.sessions}
          via={sessions.base === "external" ? sessions.url : null}
        />
      )}

      <div className="mt-4 space-y-4">
        {/* Placeholder only, never this machine's name as the value: that pins the filter to this PC. */}
        <Field
          label={t("settings.jellyfinDevice")}
          htmlFor={`${fieldId}-device`}
          hint={<span className="text-xs">{t("settings.jellyfinDeviceHelp")}</span>}
        >
          <Input
            id={`${fieldId}-device`}
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            placeholder={t("settings.jellyfinDeviceAny")}
          />
        </Field>
        {/* The fallback address, editable while signed in; the status and the plain-http warning are the backend's word. */}
        <Field
          label={t("settings.jellyfinExternalUrl")}
          htmlFor={`${fieldId}-external`}
          hint={
            <span className="block space-y-1 text-xs">
              <span className="block">{t("settings.jellyfinExternalHint")}</span>
              {externalCurrent && (
                <span className={cn("block", settings.externalVerified ? "text-success" : "text-ink-500")}>
                  {settings.externalVerified
                    ? t("settings.jellyfinExternalVerified")
                    : t("settings.jellyfinExternalUnverified")}
                </span>
              )}
              {settings.externalPlainHttp && externalCurrent && (
                <span className="block text-gold">{t("settings.jellyfinExternalPlainHttp")}</span>
              )}
            </span>
          }
        >
          <Input
            id={`${fieldId}-external`}
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder={t("settings.jellyfinExternalPlaceholder")}
          />
        </Field>
        {/* Signing in stores both fields itself, so saving them separately only matters once there is a connection. */}
        {settings.connected && (
          <Button variant="secondary" onClick={save}>
            {t("common.save")}
          </Button>
        )}
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
      {settings.connected && <JellyfinBackgroundRows />}
    </Card>
  );
}

/** Android only: the tracking service and battery exemption, both opt-in, offered only when the backend says so. */
function JellyfinBackgroundRows() {
  const { t } = useTranslation();
  const [state, setState] = useState<JellyfinBackground | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    const load = () => {
      getJellyfinBackground()
        .then(setState)
        .catch(() => {});
    };
    load();
    // The exemption dialog answers nothing; the state is re-read when the window comes back from it.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  if (!state?.supported) return null;

  const toggle = (v: boolean) => {
    const previous = state;
    setState({ ...state, enabled: v });
    setError(null);
    setJellyfinBackground(v).catch((e) => {
      setState(previous);
      setError(String(e));
    });
  };

  const ask = async () => {
    setError(null);
    try {
      await requestBatteryExemption();
    } catch (e) {
      setError(t("settings.jellyfinBatteryFailed", { message: String(e) }));
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-hair pt-3">
      <Toggle
        checked={state.enabled}
        onChange={toggle}
        label={t("settings.jellyfinBackground")}
        hint={t("settings.jellyfinBackgroundHint")}
      />
      <Row label={t("settings.jellyfinBattery")} hint={t("settings.jellyfinBatteryHint")}>
        {state.batteryExempt ? (
          <span className="shrink-0 text-sm text-success">{t("settings.jellyfinBatteryAllowed")}</span>
        ) : (
          <Button variant="secondary" size="sm" className="shrink-0" onClick={ask}>
            {t("settings.jellyfinBatteryAllow")}
          </Button>
        )}
      </Row>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** The Test-connection result: what the server sees, and what we accept. */
function SessionList({
  sessions,
  via,
}: {
  sessions: JellyfinSession[];
  /** The external address when that is what answered, which means the first was out of reach just now. */
  via: string | null;
}) {
  const { t } = useTranslation();
  const viaLine = via && (
    <p className="text-xs text-ink-500">{t("settings.jellyfinViaExternal", { url: via })}</p>
  );

  if (sessions.length === 0) {
    return (
      <div className="mt-3 space-y-1">
        {viaLine}
        <p className="text-sm text-ink-500">{t("settings.jellyfinNoSessions")}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-1.5">
      {viaLine}
      {sessions.map((s, i) => (
        <div
          key={`${s.device}-${s.user}-${i}`}
          className={cn(
            "rounded-control border px-3 py-2 text-sm",
            s.matched
              ? "border-success/40 bg-success/10"
              : "border-hair bg-surface-900",
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
            {/* The other Karasus on this account and their age, the numbers the write-order rule judges by. */}
            {s.karasu === "desktop" && (
              <Chip tone="accent">{t("settings.jellyfinKarasuDesktop")}</Chip>
            )}
            {s.karasu === "mobile" && (
              <Chip tone="accent">{t("settings.jellyfinKarasuMobile")}</Chip>
            )}
            {s.matched && (
              <Chip tone="success">{t("settings.jellyfinMatched")}</Chip>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {s.playing ?? t("settings.jellyfinIdle")}
            {s.activeAgoSec !== null && (
              <span className="text-ink-600">
                {" "}
                · {t("settings.jellyfinActiveAgo", { s: s.activeAgoSec })}
              </span>
            )}
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
