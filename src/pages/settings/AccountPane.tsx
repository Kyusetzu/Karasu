import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronRight, ExternalLink, LogIn, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { UserLockup } from "@/components/ui/user-lockup";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { Row, SELECT } from "./shared";
import { STATUS_ORDER, type MediaListStatus } from "@/api/types";
import {
  loadDefaultAddStatus,
  saveDefaultAddStatus,
} from "@/lib/defaultAddStatus";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import * as api from "@/api/anilist";
const CALLBACK_URL = "http://localhost:46231/callback";

/**
 * How the list gets written from this machine — beside the account section
 * because "you and your list" is one subject, and this pane is the only one
 * every platform and both profile modes can see.
 */
export function DefaultsSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MediaListStatus>(() =>
    loadDefaultAddStatus(),
  );
  const change = (s: MediaListStatus) => {
    setStatus(s);
    saveDefaultAddStatus(s);
  };
  return (
    <Card>
      <CardTitle>{t("settings.listDefaults")}</CardTitle>
      <div className="mt-3">
        <Row
          label={t("settings.defaultAddStatus")}
          hint={t("settings.defaultAddStatusHint")}
        >
          <select
            value={status}
            onChange={(e) => change(e.target.value as MediaListStatus)}
            className={SELECT}
          >
            {STATUS_ORDER.map((s) => {
              const anime = t(`status.ANIME.${s}`);
              const manga = t(`status.MANGA.${s}`);
              return (
                <option key={s} value={s}>
                  {/* One stored value serves both media types, so the two
                      vocabularies share the label where they differ. */}
                  {anime === manga ? anime : `${anime} / ${manga}`}
                </option>
              );
            })}
          </select>
        </Row>
      </div>
    </Card>
  );
}

export function AccountSection() {
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
          <UserLockup
            name={viewer.name}
            src={viewer.avatar?.large}
            size="xl"
            fallback={<User className="text-ink-500" />}
            sub={
              <button
                onClick={() => openUrl(viewer.siteUrl)}
                className="flex items-center gap-1 text-xs text-accent-400 hover:underline"
              >
                {t("settings.profileLink")} <ExternalLink className="size-3" />
              </button>
            }
          />
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
        <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error ?? login.error}
        </p>
      )}
    </Card>
  );
}
