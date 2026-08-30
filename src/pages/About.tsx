import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bug,
  ClipboardCopy,
  Code2,
  Mail,
  MessageCircle,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  RotateCw,
  Users,
} from "lucide-react";
import {
  appVersion,
  checkForUpdates,
  downloadPendingUpdate,
  installPendingUpdate,
  pendingUpdate,
  isTauri,
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
import { cn } from "@/lib/utils";
import { isAndroid, isLinux, usePlatform } from "@/stores/platform";

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
      {/* A single wash falling from the top, so the mark sits in light rather
          than on a flat panel. Narrower and stronger than `panel-wash`: this
          page has one subject and can afford to point at it. */}
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
          <h1 className="mt-4 font-brand text-[2rem] font-bold uppercase leading-none tracking-[.22em] text-ink-100">
            Karasu
          </h1>
          {/* カラス, not 烏. The app's Japanese flair is the katakana — it is
              how the name is written everywhere else in the project, and the
              handoff's kanji would make About the one place that disagrees. */}
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

/**
 * The report, and the two places it can go.
 *
 * Directly above the contact card on purpose: copy, then click through to the
 * form that wants it pasted. Bugs belong on GitHub — that is where they get
 * tracked — and the button says so rather than leaving a reporter to find the
 * repo link one card down and guess.
 */
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
    // Redacted, matching the copy button: both are headed somewhere public.
    // The unredacted path is the log file itself, which the user attaches
    // deliberately.
    await exportDiagnostics(true).catch(() => false);
    setSaving(false);
  };

  return (
    <Card>
      <CardTitle>{t("about.diagnostics")}</CardTitle>
      <p className="mt-1 text-xs text-ink-600">{t("about.diagnosticsHint")}</p>

      {/* The actual facts, not just a button that promises them — so the user
          can see what they are about to paste before they paste it. */}
      {report && (
        <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-surface-850 p-2.5 font-mono text-2xs leading-relaxed text-ink-500">
          {report}
        </pre>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={copy}>
          <ClipboardCopy className="size-3.5" />
          {copied ? t("common.copied") : t("about.copyDiagnostics")}
        </Button>
        <Button variant="secondary" onClick={save} disabled={saving}>
          {/* The spinning RefreshCw is the house busy idiom. (`index.css`
              does allow overshoot for feature motion these days — but a
              busy indicator is not a feature moment, and Tailwind's
              `animate-bounce` is not one of the app's registers.) */}
          {saving ? (
            <RefreshCw className="size-3.5 animate-spin" />
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

function UpdateSection() {
  const { t } = useTranslation();
  const platform = usePlatform((s) => s.info);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<DownloadedUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An update downloaded in the background at startup is already sitting in
  // the backend's stash. Without asking, this page only knew about downloads
  // it had started itself, so that one was unreachable: no Restart button
  // here, and the toast telling the user to restart would have discarded it.
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
      // Android checks and never downloads — the notice plus the release
      // link below are the whole feature there, per the no-updater rule.
      if (result.isNewer && !isAndroid(platform)) await startDownload();
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
      // The backend keeps the download on a failed install, so the button
      // stays — but re-read rather than assume, so what is on screen is what
      // is actually there.
      pendingUpdate().then(setDownloaded).catch(() => {});
    }
  };

  return (
    <Card>
      <CardTitle>{t("about.updates")}</CardTitle>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={check} disabled={busy || downloading || !isTauri}>
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />{" "}
          {busy ? t("about.checking") : t("about.checkUpdates")}
        </Button>

        {downloading && (
          <span className="flex items-center gap-1.5 text-sm text-ink-500">
            <RefreshCw className="size-4 animate-spin" /> {t("about.downloading")}
          </span>
        )}

        {!downloading && downloaded && (
          <Button
            variant="secondary"
            onClick={confirmInstall}
            disabled={installing}
          >
            <RotateCw className={cn("size-4", installing && "animate-spin")} />{" "}
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
            // Not a tick and not "up to date". This channel has no release to
            // compare against, and answering a check the user asked for with
            // "you are on the latest version" is a claim about a thing that
            // does not exist.
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
      {/* On Linux the updater can only replace an AppImage in place. A distro
          package or a build run from source has to be updated the way it was
          installed, and saying so beats a download that cannot apply. */}
      {isLinux(platform) && !platform?.appImage && (
        <p className="mt-3 text-sm text-ink-500">
          {t("about.updateAppImageOnly")}
        </p>
      )}
      {/* Android's twin of the AppImage note: nothing installs from here —
          a new version is a fresh APK from the release page. */}
      {isAndroid(platform) && (
        <p className="mt-3 text-sm text-ink-500">{t("about.updateAndroidHint")}</p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}
