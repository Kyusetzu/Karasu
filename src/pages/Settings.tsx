import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/stores/auth";
import * as api from "@/api/anilist";

export default function Settings() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">Einstellungen</h1>
      <AccountSection />
    </div>
  );
}

function AccountSection() {
  const { viewer, connect, logout } = useAuth();
  const [clientId, setClientIdState] = useState("");
  const [clientIdSaved, setClientIdSaved] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api.isTauri) return;
    api.getClientId().then((id) => {
      if (id) {
        setClientIdState(id);
        setClientIdSaved(true);
      }
    });
  }, []);

  if (viewer) {
    return (
      <Card>
        <CardTitle>AniList-Account</CardTitle>
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
              Profil auf AniList <ExternalLink size={12} />
            </button>
          </div>
          <Button variant="danger" onClick={() => logout()}>
            <LogOut size={16} /> Abmelden
          </Button>
        </div>
      </Card>
    );
  }

  const saveClientId = async () => {
    setError(null);
    try {
      await api.setClientId(clientId);
      setClientIdSaved(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const openLogin = async () => {
    setError(null);
    try {
      await openUrl(await api.loginUrl());
    } catch (e) {
      setError(String(e));
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
      <CardTitle>Mit AniList verbinden</CardTitle>
      <ol className="mt-4 space-y-5 text-sm text-ink-300">
        <li className="space-y-2">
          <p>
            <span className="font-semibold text-ink-100">1.</span> Erstelle
            einmalig einen API-Client in deinen AniList-Einstellungen. Trage
            als Redirect-URL{" "}
            <code className="select-text rounded bg-surface-800 px-1.5 py-0.5 text-xs">
              https://anilist.co/api/v2/oauth/pin
            </code>{" "}
            ein.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openUrl("https://anilist.co/settings/developer")}
          >
            Developer-Einstellungen öffnen <ExternalLink size={14} />
          </Button>
        </li>
        <li className="space-y-2">
          <p>
            <span className="font-semibold text-ink-100">2.</span> Trage die
            Client-ID des erstellten Clients hier ein.
          </p>
          <div className="flex gap-2">
            <Input
              value={clientId}
              onChange={(e) => {
                setClientIdState(e.target.value);
                setClientIdSaved(false);
              }}
              placeholder="z. B. 12345"
              className="max-w-40"
              inputMode="numeric"
            />
            <Button variant="secondary" onClick={saveClientId}>
              {clientIdSaved ? "Gespeichert ✓" : "Speichern"}
            </Button>
          </div>
        </li>
        <li className="space-y-2">
          <p>
            <span className="font-semibold text-ink-100">3.</span> Melde dich
            im Browser an und kopiere den angezeigten Token hierher.
          </p>
          <Button onClick={openLogin} disabled={!clientIdSaved}>
            Login-Seite öffnen <ExternalLink size={14} />
          </Button>
          <div className="flex gap-2 pt-1">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Access-Token einfügen"
            />
            <Button onClick={submitToken} disabled={busy || !token.trim()}>
              {busy ? "Prüfe …" : "Verbinden"}
            </Button>
          </div>
        </li>
      </ol>
      {error && (
        <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </Card>
  );
}
