import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import KarasuMark from "@/components/KarasuMark";
import { useAniListLogin } from "@/hooks/useAniListLogin";
import { useAuth } from "@/stores/auth";
import { isAndroid, usePlatform } from "@/stores/platform";

/**
 * The first thing anyone sees.
 *
 * Two columns rather than a centred card, because the mark at 22rem is the
 * only place in the app the bird is ever this large — and a first run is the
 * one moment where the app is allowed to introduce itself rather than get out
 * of the way. The three steps are there because "it tracks automatically" is
 * a claim; naming what happens is the proof.
 */
export default function FirstRun() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const enableLocal = useAuth((s) => s.enableLocal);
  const login = useAniListLogin();
  // The desktop steps promise player detection a phone has not got — on
  // Android, Jellyfin is the whole of detection, so the story says so
  // instead of describing machinery the Settings pane greys out.
  const android = isAndroid(usePlatform((s) => s.info));
  const steps = android
    ? [t("firstRun.step1"), t("firstRun.step2Android"), t("firstRun.step3Android")]
    : [t("firstRun.step1"), t("firstRun.step2"), t("firstRun.step3")];

  // The button used to be a bare link to /settings — which on the phone shell
  // is the pane *list*, putting the actual OAuth button three taps away from
  // the very first screen. Start the handoff here; only a failed start (no
  // browser, port taken) falls back to the Account pane's manual paste.
  const connect = async () => {
    if (!(await login.start())) navigate("/settings?pane=account");
  };

  return (
    <div className="relative grid h-full place-items-center overflow-hidden">
      {/* Two washes off the derived accent hues — the same pair the panels
          use, thrown wide so the whole screen carries the colour. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(55rem 38rem at 88% -8%, rgba(var(--w1), .13), transparent 68%), " +
            "radial-gradient(48rem 36rem at -6% 108%, rgba(var(--accent-rgb), .10), transparent 66%)",
        }}
      />

      <div className="relative flex w-full max-w-6xl items-center">
        {/* Phone: one centred column with the mark above the words — the
            desktop's 56px left gutter and 480px text column overflowed a
            375px viewport, cutting the title mid-word. */}
        <div className="w-full max-w-120 px-6 py-8 md:w-auto md:shrink-0 md:px-0 md:py-8 md:pl-14 md:pr-8">
          <KarasuMark className="mb-6 w-20 md:hidden" />
          <p className="text-2xs font-semibold uppercase tracking-[.18em] text-accent-400">
            {t("dashboard.welcomeTitle")}
          </p>
          <h1 className="mt-2 font-brand text-[1.75rem] font-bold leading-[1.12] tracking-[-.03em] text-ink-100 md:text-[2.25rem]">
            {t("firstRun.headline")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            {android ? t("dashboard.welcomeTextAndroid") : t("dashboard.welcomeText")}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* Deliberately NOT disabled while waiting: this is the one moment
                where a closed browser tab must be recoverable by pressing
                again (the backend reuses the pending login), and the hook's
                in-flight guard already stops a double-tap opening two tabs.
                "Look around" during a pending login is fine too — a late
                completion still signs in through the auth store's listener. */}
            <Button onClick={() => void connect()}>{t("dashboard.connect")}</Button>
            {/* Switches to the account-free list in place — the store flips
                `mode`, which re-renders straight into the dashboard. */}
            <Button variant="ghost" onClick={() => enableLocal()}>
              {t("firstRun.lookAround")}
            </Button>
          </div>
          {login.waiting && (
            <p className="mt-3 text-xs text-accent-400">{t("settings.loginWaiting")}</p>
          )}
          {login.error && !login.waiting && (
            <p className="mt-3 text-xs text-danger">{login.error}</p>
          )}

          <ol className="mt-8 space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-xs text-ink-500">
                <span className="grid size-6 shrink-0 place-items-center rounded-md border border-surface-700 text-2xs font-semibold tabular-nums text-ink-300">
                  {i + 1}
                </span>
                <span className="pt-1 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <KarasuMark className="ml-auto mr-18 hidden w-88 shrink-0 lg:block" />
      </div>
    </div>
  );
}
