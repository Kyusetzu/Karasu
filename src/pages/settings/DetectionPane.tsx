import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import * as api from "@/api/anilist";
import {
  clearDetectionOverride,
  getJellyfinSettings,
  getScrobbleSettings,
  getMediaDetection,
  jellyfinSignIn,
  jellyfinSignOut,
  listDetectionOverrides,
  setJellyfinSettings,
  setScrobbleSettings,
  setMediaDetection,
  mediaSessions,
  testJellyfin,
  type DetectionOverride,
  type JellyfinSession,
  type JellyfinSettings,
  type ScrobbleSettings,
  type MediaSession,
} from "@/stores/nowPlaying";
import { isLinux, usePlatform } from "@/stores/platform";
import { useAuth } from "@/stores/auth";
import { ExternalNote, Row, Toggle } from "./shared";
import { anilistCoversAiring } from "@/lib/airingCoverage";
import { backendErrorText } from "@/lib/backendError";
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

  /**
   * Paint, persist, and put the control back if persisting failed.
   *
   * Every write on this pane was fire-and-forget, so a rejected `kv_set` left
   * the switch showing one thing while the watcher that reads the key kept
   * doing another — and nothing on screen said so. Same shape as
   * `AdvancedPane`'s rollback, which is the house pattern for this.
   */
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
      {/* Detection recognises a title by matching it against the AniList list,
          and scrobbling writes to AniList. Without an account it will still
          show what you are playing and nothing more — worth saying here rather
          than leaving someone to conclude the feature is broken. */}
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
        {mediaOn !== null && (
          <Toggle
            checked={mediaOn}
            onChange={(v) => {
              setMediaOn(v);
              persist(setMediaDetection(v), () => setMediaOn(!v));
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
          <>
            <Toggle
              checked={airing}
              onChange={updateAiring}
              label={t("settings.airingNotify")}
              hint={t("settings.airingNotifyHint")}
            />
            {/* Says what the watcher will actually do, from the same cached
                viewer blob the watcher itself reads — so a blob that has gone
                stale against anilist.co is visibly wrong here rather than
                silently wrong in the background. Costs nothing: the blob is
                already in the auth store. */}
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

/**
 * Shows what the desktop currently reports for every media session.
 *
 * Players disagree about which field carries the show and which carries the
 * episode, and some publish nothing at all. Without this there is no way to
 * tell "Karasu ignored it" from "the player never told the system" — which is
 * exactly the question when a title isn't picked up.
 *
 * Its own card rather than a footnote under the scrobble settings, which is
 * where it used to live. On Linux the media-session pass *is* local detection —
 * there is no window enumerator and Wayland forbids one — so this is the first
 * screen to look at when nothing is picked up, not the last line of another
 * one. Still collapsed by default and still fetched on first expand: it is a
 * thing you go looking for, not a round trip every visit to Settings costs.
 */
export function MediaSessionSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<MediaSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setSessions(await mediaSessions());
      setError(null);
    } catch (e) {
      // Not `setSessions([])`. An empty list is "no player is reporting
      // anything", which is a normal state and a completely different answer
      // from "the session service could not be reached" — and on Linux this
      // pass is the whole of local detection, so the second one means the
      // feature is down rather than idle.
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
        className="mt-3 flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300"
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
    </Card>
  );
}

/**
 * The corrections made from the now-playing card, so they can be reviewed and
 * taken back somewhere other than the moment they were made.
 *
 * Absent entirely until there is one — an empty card explaining a feature
 * nobody has used is noise on a pane that already has plenty. Each row names
 * what detection *saw* and what it was told that means; removing one gives the
 * matcher its guess back.
 */
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
        // Back to the `null` the command expects; `-1` is the storage
        // sentinel, not something the API should have to know about.
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
            className="flex items-center gap-3 rounded-lg bg-surface-900 px-3 py-2"
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
  const [launchDraft, setLaunchDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke<MpvIpcSettings>("get_mpv_ipc").then(setSettings).catch(() => {});
    });
  }, []);

  if (!settings) return null;

  const apply = async (next: { enabled: boolean; path: string; launchPath: string }) => {
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
    setError(null);
    setSessions(null);
    try {
      await setJellyfinSettings(url, device);
      setSettings(await getJellyfinSettings());
    } catch (e) {
      setError(backendErrorText(e, t));
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

        {/* The placeholder states what an empty field *does*, and no longer
            offers this machine's name — the backend used to prefill that as
            the field's value, so a Save pinned the filter to this PC and
            silently stopped detecting a browser or phone session. */}
        <Input
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          placeholder={t("settings.jellyfinDeviceAny")}
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
