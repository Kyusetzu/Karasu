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
} from "lucide-react";
import {
  appVersion,
  checkForUpdates,
  isTauri,
  type UpdateInfo,
} from "@/api/anilist";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

const REPO_URL = "https://github.com/Kyusetzu/Karasu";
const DISCORD_HANDLE = "Kyusetzu";
const EMAIL = "contact@kyusetzu.de";

export default function About() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri) appVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <header className="flex items-center gap-4">
        <img src="/favicon.png" alt="" className="h-14 w-14 rounded-xl" />
        <div>
          <div className="flex items-baseline gap-2">
            <h1 className="font-brand text-2xl font-bold">Karasu</h1>
            <span className="font-brand-jp text-sm text-ink-500">
              カラス
            </span>
          </div>
          <p className="text-sm text-ink-500">{t("about.tagline")}</p>
          {version && (
            <p className="mt-0.5 text-xs text-ink-600">
              {t("about.version", { version })}
            </p>
          )}
        </div>
      </header>

      <Card>
        <CardTitle>{t("about.title")}</CardTitle>
        <p className="mt-3 text-sm leading-relaxed text-ink-300">
          {t("about.description")}
        </p>
      </Card>

      <UpdateSection />

      <Card>
        <CardTitle>{t("about.contact")}</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          <Row icon={<MessageCircle size={16} />} label={t("about.discord")}>
            <span className="text-ink-100">{DISCORD_HANDLE}</span>
          </Row>
          <Row icon={<Mail size={16} />} label={t("about.email")}>
            <a
              href={`mailto:${EMAIL}`}
              className="text-accent-400 hover:underline"
            >
              {EMAIL}
            </a>
          </Row>
          <Row icon={<Code2 size={16} />} label={t("about.repo")}>
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
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await checkForUpdates());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>{t("about.updates")}</CardTitle>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={check} disabled={busy || !isTauri}>
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />{" "}
          {busy ? t("about.checking") : t("about.checkUpdates")}
        </Button>
        {info &&
          (info.isNewer && info.url ? (
            <Button variant="secondary" onClick={() => openUrl(info.url!)}>
              <Download size={16} />{" "}
              {t("about.updateAvailable", { version: info.latest })}
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 size={16} />{" "}
              {t("about.upToDate", { version: info.current })}
            </span>
          ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </Card>
  );
}
