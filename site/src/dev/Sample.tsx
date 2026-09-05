import KarasuMark from "@/components/KarasuMark";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";

/**
 * Dev-only: `#sample` on the dev server. The design tokens and the copied
 * primitives, side by side, so the typography and palette can be judged
 * before any section is built. Never part of the production bundle — the
 * client entry only reaches for it under `import.meta.env.DEV`.
 */

// Literal class names, because Tailwind only emits what it can read.
const SURFACES: [string, string][] = [
  ["surface-950", "bg-surface-950"],
  ["surface-900", "bg-surface-900"],
  ["surface-850", "bg-surface-850"],
  ["surface-800", "bg-surface-800"],
  ["surface-700", "bg-surface-700"],
  ["surface-600", "bg-surface-600"],
];
const INKS: [string, string][] = [
  ["ink-100", "bg-ink-100"],
  ["ink-300", "bg-ink-300"],
  ["ink-500", "bg-ink-500"],
  ["ink-600", "bg-ink-600"],
];

function Swatch({ cls, label, value }: { cls: string; label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-14 rounded-lg border border-surface-800 ${cls}`} />
      <span className="text-2xs text-ink-500">{label}</span>
      {value && <span className="text-2xs tabular-nums text-ink-600">{value}</span>}
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <p className="font-brand text-2xs font-semibold uppercase tracking-[.18em] text-accent-400">
      {children}
    </p>
  );
}

export function Sample() {
  return (
    <main className="mx-auto max-w-5xl space-y-16 px-6 py-16">
      <header className="flex items-center gap-4">
        <KarasuMark className="size-12" />
        <div>
          <p className="font-brand text-xs font-semibold tracking-[.2em] text-ink-300">KARASU</p>
          <p className="text-sm text-ink-500">Token and type sample — dev only</p>
        </div>
      </header>

      <section className="space-y-4">
        <Eyebrow>Surfaces</Eyebrow>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {SURFACES.map(([label, cls]) => (
            <Swatch key={label} cls={cls} label={label} />
          ))}
        </div>
        <Eyebrow>Ink</Eyebrow>
        <div className="grid grid-cols-4 gap-3">
          {INKS.map(([label, cls]) => (
            <Swatch key={label} cls={cls} label={label} />
          ))}
        </div>
        <Eyebrow>Accent and semantic</Eyebrow>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Swatch cls="bg-accent-400" label="accent-400 (text)" />
          <Swatch cls="bg-accent-500" label="accent-500 (fill)" />
          <Swatch cls="bg-accent-600" label="accent-600 (pressed)" />
          <Swatch cls="bg-success" label="success" />
          <Swatch cls="bg-gold" label="gold" />
          <Swatch cls="bg-danger" label="danger" />
        </div>
      </section>

      <section className="space-y-6">
        <Eyebrow>Typography — brand face (SN Pro)</Eyebrow>
        <p className="font-brand text-[3.25rem] font-bold leading-[1.05] tracking-[-.03em] text-ink-100">
          A modern anime &amp; manga tracker, built exclusively for AniList.
        </p>
        <p className="font-brand text-2xl font-bold tracking-[-.02em] text-ink-100">
          Section heading — Karasu watches what you watch
        </p>
        <p className="font-brand text-base font-semibold text-ink-100">
          Card title — Local library
        </p>
        <p className="font-brand text-[2rem] font-bold uppercase leading-none tracking-[.22em] text-ink-100">
          Karasu
        </p>
        <p className="font-brand-jp text-lg text-accent-400">カラス</p>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-2xs uppercase tracking-[.09em] text-ink-600">Body A — SN Pro 400</p>
            <p className="font-brand text-base leading-relaxed text-ink-300">
              Play an episode in your video player, read a chapter in your browser, and Karasu
              recognises it and updates your AniList progress on its own. A scrobble can only ever
              move progress forward, and it re-checks your list a moment before it writes.
            </p>
            <p className="font-brand text-sm leading-relaxed text-ink-500">
              Small print at 14 px in ink-500 — the muted step, 5.45:1 on the page.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-2xs uppercase tracking-[.09em] text-ink-600">Body B — system stack</p>
            <p className="text-base leading-relaxed text-ink-300">
              Play an episode in your video player, read a chapter in your browser, and Karasu
              recognises it and updates your AniList progress on its own. A scrobble can only ever
              move progress forward, and it re-checks your list a moment before it writes.
            </p>
            <p className="text-sm leading-relaxed text-ink-500">
              Small print at 14 px in ink-500 — the muted step, 5.45:1 on the page.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <Eyebrow>Controls</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Download Karasu</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">View on GitHub</Button>
          <Button variant="ghost">Ghost</Button>
          <Button size="lg">Large call to action</Button>
          <Button size="sm">Small</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill active>Desktop</Pill>
          <Pill>Phone</Pill>
          <Pill>Windows</Pill>
          <Pill>Linux</Pill>
          <Pill>Android</Pill>
        </div>
      </section>

      <section className="space-y-4">
        <Eyebrow>Surfaces in use</Eyebrow>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardTitle>Card with panel-wash</CardTitle>
            <p className="mt-2 text-sm text-ink-500">
              The iridescent wash and the 1px catch-light along the top edge.
            </p>
          </Card>
          <div className="inset-well well-edge rounded-[.875rem] px-4.5 py-4">
            <p className="text-2xs uppercase tracking-[.09em] text-ink-600">Watching in mpv</p>
            <p className="mt-1 text-[1.0625rem] font-semibold text-ink-100">
              Anime Title <span className="text-ink-500">— Episode 01</span>
            </p>
            <p className="mt-1 text-xs text-ink-500">Updates in a moment</p>
            <div className="mt-3 h-1 rounded-full bg-surface-800">
              <div className="h-1 w-2/3 rounded-full bg-accent-500" />
            </div>
          </div>
          <div className="flex flex-col justify-between rounded-xl border border-hair bg-surface-900 p-5">
            <div className="flex items-center gap-2">
              <span className="size-1.5 animate-blip rounded-full bg-accent-500" />
              <span className="text-2xs font-medium tracking-[.03em] text-ink-500">
                mpv · Anime Title · Episode 1
              </span>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <span className="text-2xs uppercase tracking-[.09em] text-ink-600">Section</span>
              <span className="section-rule" />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <Eyebrow>Motion</Eyebrow>
        <div className="flex flex-wrap gap-4">
          <div className="animate-settle rounded-lg bg-surface-850 px-4 py-2 text-sm">settle</div>
          <div className="animate-land rounded-lg bg-surface-850 px-4 py-2 text-sm">land</div>
          <div className="animate-spring-in rounded-lg bg-surface-850 px-4 py-2 text-sm">spring-in</div>
          <div className="animate-idle-float rounded-lg bg-surface-850 px-4 py-2 text-sm">idle-float</div>
        </div>
      </section>
    </main>
  );
}
