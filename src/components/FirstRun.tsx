import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import KarasuMark from "@/components/KarasuMark";
import { useAuth } from "@/stores/auth";

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
  const enableLocal = useAuth((s) => s.enableLocal);
  const steps = [t("firstRun.step1"), t("firstRun.step2"), t("firstRun.step3")];

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
        <div className="max-w-120 shrink-0 py-8 pl-14 pr-8">
          <p className="text-2xs font-semibold uppercase tracking-[.18em] text-accent-400">
            {t("dashboard.welcomeTitle")}
          </p>
          <h1 className="mt-2 font-brand text-[2.25rem] font-bold leading-[1.1] tracking-[-.03em] text-ink-100">
            {t("firstRun.headline")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            {t("dashboard.welcomeText")}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/settings">
              <Button>{t("dashboard.connect")}</Button>
            </Link>
            {/* Switches to the account-free list in place — the store flips
                `mode`, which re-renders straight into the dashboard. */}
            <Button variant="ghost" onClick={() => enableLocal()}>
              {t("firstRun.lookAround")}
            </Button>
          </div>

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
