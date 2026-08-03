import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Code2,
  Mail,
  MessageCircle,
  RefreshCw,
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
  isTauri,
  type DownloadedUpdate,
  type UpdateInfo,
} from "@/api/anilist";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import KarasuMark from "@/components/KarasuMark";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/Kyusetzu/Karasu";
const DISCORD_HANDLE = "Kyusetzu";
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
          {/* 烏 — the name itself, not a transliteration of it. */}
          <p className="mt-2 font-brand-jp text-lg text-accent-400">烏</p>
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
            <span className="text-ink-100">{DISCORD_HANDLE}</span>
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
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState<DownloadedUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (result.isNewer) await startDownload();
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
            <Download className="size-4 animate-bounce" />{" "}
            {t("about.downloading")}
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
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}
