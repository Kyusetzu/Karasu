import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import {
  Bug,
  ClipboardCopy,
  Code2,
  Mail,
  MessageCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCw,
  Users,
} from "lucide-react";
import {
  apkDownload,
  apkInstall,
  apkOpenInstallPermission,
  apkUpdateState,
  appVersion,
  checkForUpdates,
  downloadPendingUpdate,
  installPendingUpdate,
  pendingUpdate,
  isTauri,
  type ApkUpdateState,
  type DownloadedUpdate,
  type UpdateInfo,
} from "@/api/anilist";
import {
  copyDiagnostics,
  diagnosticsReport,
  exportDiagnostics,
  ISSUE_URL,
} from "@/api/diagnostics";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import KarasuMark from "@/components/KarasuMark";
import { isAndroid, isLinux, usePlatform } from "@/stores/platform";
import { Spinner } from "@/components/ui/spinner";

const REPO_URL = "https://github.com/Kyusetzu/Karasu";
const DISCORD_HANDLE = "Kyusetzu";
const DISCORD_PROFILE = "https://discordapp.com/users/174216581222498304";
const DISCORD_INVITE = "https://discord.gg/yeHNSGyM8F";
const DISCORD_SERVER = "Kyu's Cozy Corner";
const EMAIL = "contact@kyusetzu.de";

export default function About() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri) appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="relative overflow-hidden">
      {/* One wash from the top, narrower and stronger than `panel-wash`, so the mark sits in light. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          backgroundImage:
            "radial-gradient(40rem 20rem at 50% -20%, rgba(var(--w1), .16), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-136 px-8 py-12">
        <header className="flex flex-col items-center text-center">
          <KarasuMark className="size-28" />
          <h1 className="mt-4 font-brand text-title uppercase leading-none tracking-wordmark text-ink-100">
            Karasu
          </h1>
          {/* Katakana, not kanji: it is how the name is written everywhere else in the project. */}
          <p className="mt-2 font-brand-jp text-lg text-accent-400">カラス</p>
          <p className="mt-3 text-sm text-ink-500">{t("about.tagline")}</p>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            {t("about.description")}
          </p>
          {version && (
            <p className="mt-4 text-2xs tabular-nums text-ink-600">
              {t("about.version", { version })}
            </p>
          )}
        </header>

      <div className="mt-8 space-y-6">

      <UpdateSection />

      <DiagnosticsSection />

      <Card>
        <CardTitle>{t("about.contact")}</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          <Row icon={<Users className="size-4" />} label={t("about.community")}>
            <button
              onClick={() => openUrl(DISCORD_INVITE)}
              className="text-accent-400 hover:underline"
            >
              {DISCORD_SERVER}
            </button>
          </Row>
          <Row icon={<MessageCircle className="size-4" />} label={t("about.discord")}>
            <button
              onClick={() => openUrl(DISCORD_PROFILE)}
              className="text-accent-400 hover:underline"
            >
              {DISCORD_HANDLE}
            </button>
          </Row>
          <Row icon={<Mail className="size-4" />} label={t("about.email")}>
            <a
              href={`mailto:${EMAIL}`}
              className="text-accent-400 hover:underline"
            >
              {EMAIL}
            </a>
          </Row>
          <Row icon={<Code2 className="size-4" />} label={t("about.repo")}>
            <button
              onClick={() => openUrl(REPO_URL)}
              className="text-accent-400 hover:underline"
            >
              github.com/Kyusetzu/Karasu
            </button>
          </Row>
        </div>
      </Card>
      </div>
      </div>
    </div>
  );
}

/** The diagnostics report and the two places it can go, sitting above the contact card on purpose. */
function DiagnosticsSection() {
  const { t } = useTranslation();
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    diagnosticsReport(true).then(setReport).catch(() => setReport(null));
  }, []);

  if (!isTauri) return null;

  const copy = async () => {
    const ok = await copyDiagnostics();
    setCopied(ok);
    setFailed(!ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  const save = async () => {
    setSaving(true);
    // Redacted like the copy button, since both are headed somewhere public; the log file is the raw path.
    await exportDiagnostics(true).catch(() => false);
    setSaving(false);
  };

  return (
    <Card>
      <CardTitle>{t("about.diagnostics")}</CardTitle>
      <p className="mt-1 text-xs text-ink-600">{t("about.diagnosticsHint")}</p>

      {/* The actual facts, so the user can see what they are about to paste before they paste it. */}
      {report && (
        <pre className="mt-3 max-h-56 overflow-auto rounded-control bg-surface-850 p-2.5 font-mono text-2xs leading-relaxed text-ink-500">
          {report}
        </pre>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={copy}>
          <ClipboardCopy className="size-3.5" />
          {copied ? t("common.copied") : t("about.copyDiagnostics")}
        </Button>
        <Button variant="secondary" onClick={save} disabled={saving}>
          {/* The spinning RefreshCw is the house busy idiom; a busy indicator is not a feature moment. */}
          {saving ? (
            <Spinner className="size-3.5" />
          ) : (
            <Download className="size-3.5" />
          )}
          {t("about.saveReport")}
        </Button>
        <Button variant="secondary" onClick={() => openUrl(ISSUE_URL)}>
          <Bug className="size-3.5" /> {t("about.reportBug")}
        </Button>
      </div>
      {failed && <p className="mt-2 text-sm text-danger">{t("about.copyFailed")}</p>}
      <p className="mt-2 text-2xs text-ink-600">{t("about.reportHint")}</p>
    </Card>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-ink-500">{icon}</span>
      <span className="w-20 shrink-0 text-ink-500">{label}</span>
      {children}
    </div>
  );
}

/** The Android half of the Updates card: the download's state, the installer button, and why it may be waiting. */
function ApkUpdatePanel({ tick }: { tick: number }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ApkUpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    const reload = () => apkUpdateState().then(setState).catch(() => {});
    reload();
    // The installer and the permission screen both leave the app; whatever changed is read on the way back.
    const un = listen<{ received: number; total: number }>("apk-download-progress", (e) =>
      setState((s) => (s ? { ...s, status: "downloading", received: e.payload.received, total: e.payload.total } : s)),
    );
    const onBack = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      un.then((f) => f());
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [tick]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      setState(await apkUpdateState());
    } catch (e) {
      setError(String(e));
    }
  };

  if (!state || !state.available || state.status === "none") return null;
  const mb = (n: number) => (n / 1_048_576).toFixed(1);

  return (
    <div className="mt-3 space-y-2 text-sm">
      {state.status === "downloading" && (
        <div>
          <p className="flex items-center gap-1.5 text-ink-500">
            <Spinner className="size-4" />{" "}
            {t("about.apkDownloading", { version: state.version, received: mb(state.received), total: mb(state.total) })}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-800">
            <div
              className="h-full bg-accent-500 transition-[width]"
              style={{ width: `${state.total > 0 ? Math.round((state.received / state.total) * 100) : 0}%` }}
            />
          </div>
        </div>
      )}
      {state.status === "ready" && state.needsInstallPermission && (
        <>
          <p className="text-ink-300">{t("about.apkNeedsPermission")}</p>
          <Button variant="secondary" onClick={() => run(apkOpenInstallPermission)}>
            {t("about.apkAllowInstall")}
          </Button>
        </>
      )}
      {state.status === "ready" && !state.needsInstallPermission && (
        <>
          <Button onClick={() => run(apkInstall)}>
            <Download className="size-4" /> {t("about.apkInstall", { version: state.version })}
          </Button>
          <p className="text-ink-500">{t("about.apkPlayProtectHint")}</p>
        </>
      )}
      {state.status === "blocked" && state.reason === "metered" && (
        <>
          <p className="text-ink-300">{t("about.apkBlockedMetered", { version: state.version })}</p>
          <Button variant="secondary" onClick={() => run(() => apkDownload(true))}>
            {t("about.apkDownloadAnyway")}
          </Button>
        </>
      )}
      {state.status === "blocked" && state.reason === "space" && (
        <p className="text-gold">{t("about.apkBlockedSpace", { version: state.version })}</p>
      )}
      {state.status === "blocked" && (state.reason === "signature" || state.reason === "stale") && (
        <p className="text-gold">{t("about.apkBlockedSignature")}</p>
      )}
      {state.status === "blocked" && (state.reason === "network" || state.reason === "foreground") && (
        <>
          <p className="text-ink-300">{t("about.apkBlockedNetwork", { version: state.version })}</p>
          <Button variant="secondary" onClick={() => run(() => apkDownload(false))}>
            {t("about.apkRetry")}
          </Button>
        </>
      )}
      {error && <p className="text-danger">{error}</p>}
    </div>
  );
}

function UpdateSection() {
  const { t } = useTranslation();
  const platform = usePlatform((s) => s.info);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<DownloadedUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apkTick, setApkTick] = useState(0);

  // Ask for the backend's stash, or an update downloaded at startup has no Restart button here.
  useEffect(() => {
    if (!isTauri) return;
    pendingUpdate().then(setDownloaded).catch(() => {});
  }, []);

  const startDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const update = await downloadPendingUpdate();
      setDownloaded(update);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await checkForUpdates(true);
      setInfo(result);
      // Android fetches the APK through its own path; the panel below shows where that got to.
      if (result.isNewer && isAndroid(platform)) {
        await apkDownload(false).catch(() => {});
        setApkTick((n) => n + 1);
      } else if (result.isNewer) {
        await startDownload();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      // On success this restarts the app and never returns.
      await installPendingUpdate();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
      // The backend keeps the download on a failed install, but re-read rather than assume it did.
      pendingUpdate().then(setDownloaded).catch(() => {});
    }
  };

  return (
    <Card>
      <CardTitle>{t("about.updates")}</CardTitle>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={check} disabled={busy || downloading || !isTauri}>
          <Spinner spinning={busy} className="size-4" />{" "}
          {busy ? t("about.checking") : t("about.checkUpdates")}
        </Button>

        {downloading && (
          <span className="flex items-center gap-1.5 text-sm text-ink-500">
            <Spinner className="size-4" /> {t("about.downloading")}
          </span>
        )}

        {!downloading && downloaded && (
          <Button
            variant="secondary"
            onClick={confirmInstall}
            disabled={installing}
          >
            <Spinner icon={RotateCw} spinning={installing} className="size-4" />{" "}
            {installing ? t("about.installing") : t("about.restartUpdate")}
          </Button>
        )}

        {!downloading &&
          !downloaded &&
          info &&
          (info.isNewer ? (
            <span className="flex items-center gap-1.5 text-sm text-ink-500">
              {t("about.updateAvailable", { version: info.latest })}
            </span>
          ) : info.channelEmpty ? (
            // Not "up to date": this channel has no release to compare against, and saying so is honest.
            <span className="flex items-center gap-1.5 text-sm text-gold">
              <AlertTriangle className="size-4" /> {t("about.channelEmpty")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" />{" "}
              {t("about.upToDate", { version: info.current })}
            </span>
          ))}

        {info?.url && (
          <button
            onClick={() => openUrl(info.url!)}
            className="flex items-center gap-1 text-sm text-accent-400 hover:underline"
          >
            <ExternalLink className="size-3.5" /> {t("about.viewRelease")}
          </button>
        )}
      </div>
      {downloaded && (
        <p className="mt-3 text-sm text-ink-300">
          {t("about.updateReady", { version: downloaded.version })}
        </p>
      )}
      {/* On Linux the updater can only replace an AppImage; anything else updates the way it was installed. */}
      {isLinux(platform) && !platform?.appImage && (
        <p className="mt-3 text-sm text-ink-500">
          {t("about.updateAppImageOnly")}
        </p>
      )}
      {isAndroid(platform) && <ApkUpdatePanel tick={apkTick} />}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}
