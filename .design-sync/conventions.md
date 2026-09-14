# Building with Karasu

Karasu is a desktop and Android anime/manga tracker for AniList. Dark, dense, quiet: one accent colour, a lot of near-black surface, small uppercase labels, hairline rules. Every screen you build is a screen of that app.

## Wrap everything in `KarasuTheme`

```tsx
import { KarasuTheme, Button, Card, CardTitle, Pill, SectionHeader } from "karasu";

<KarasuTheme theme="dark">            {/* theme: "dark" | "light"; accent?: "#4b3fc7"; density?: "compact" | "comfortable" | "spacious"; lang?: "en" | "de" */}
  <div className="p-8 space-y-6">…</div>
</KarasuTheme>
```

Without it nothing is styled: the theme attribute, the derived accent ramp (`--color-accent-400/500/600`, `--color-accent-ink`, the panel washes) and the page surface all come from it. One per design, at the root. The default accent is `#4b3fc7`; any hex works and the readable ink on top is derived, so never hard-code white on an accent fill.

## Style with the app's Tailwind vocabulary — nothing else

The stylesheet is the app's compiled CSS, so only classes the app already uses exist. Use these families; do not invent shades, do not use raw colours, do not use arbitrary values unless you see them in a component's `.prompt.md`.

| Role | Classes |
|---|---|
| Page and panels | `bg-surface-950` (page) · `bg-surface-900` (panel) · `bg-surface-850` (hover) · `bg-surface-800` (control) · `bg-surface-700` (pressed) |
| Text | `text-ink-100` (primary) · `text-ink-300` (secondary) · `text-ink-500` (muted) · `text-ink-600` (labels, placeholders) |
| Accent | `bg-accent-500` (fill) · `bg-accent-600` (pressed) · `text-accent-400` (links, icons) · `text-accent-ink` (text ON an accent fill) |
| Meaning | `text-danger` · `text-success` · `text-gold` (scores) and their `bg-`/`border-` twins |
| Borders | `border-surface-800` (panel) · `border-surface-700` (control) · `border-hair` (the accent-tinted hairline) |
| Raised panel | `panel-wash panel-top rounded-xl border border-surface-800 bg-surface-900 p-5` — exactly what `Card` renders |
| Type | `text-2xs uppercase tracking-wide text-ink-600` for labels · `text-sm` body · `text-base font-semibold` titles · `font-brand` for the wordmark, `font-brand-jp` for Japanese titles |
| Radius | `rounded-lg` controls · `rounded-xl` panels · `rounded-full` avatars |
| Motion | `transition-surface` on hover/focus; `animate-fade-in` / `animate-spring-in` for something arriving. Springs only for arrivals — never on hover |
| Section heading | `SectionHeader` (icon, title, meta) — its `section-rule` draws the hairline to the right edge |

Sizes: `text-sm` is the body size; the toolbar control height is `h-8.5` (Button `size="control"`, `IconButton`, `FilterSelect` all share it).

## Where the truth lives

Read `styles.css` and `_ds_bundle.css` before styling — every token and utility that exists is in there. Each component's `.prompt.md` carries its props and a real example. `tokens/` holds the raw `--color-*`, `--ease-*` and `--duration-*` values.

## One idiomatic screen fragment

```tsx
<KarasuTheme>
  <main className="p-8 space-y-6 bg-surface-950 text-ink-100">
    <SectionHeader icon={CalendarDays} title="Airing this week" meta="8 episodes" />
    <div className="grid grid-cols-2 gap-3">
      <Card><CardTitle>523</CardTitle><div className="text-2xs uppercase tracking-wide text-ink-600">Anime</div></Card>
    </div>
    <div className="flex gap-2">
      <Pill active>Watching</Pill><Pill>Planning</Pill>
      <Button size="sm">Open calendar</Button>
      <Button size="sm" variant="ghost">Dismiss</Button>
    </div>
  </main>
</KarasuTheme>
```
