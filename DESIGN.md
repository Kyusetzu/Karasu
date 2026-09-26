# Karasu design language

This file is the brief for how Karasu looks and moves. It holds the principles,
the vocabulary and the decisions. CLAUDE.md keeps the invariants and the
measurements that justify them.

**This file wins.** A design skill, a library's defaults or a mockup may disagree
with it. When that happens, either follow this file or change it first in its own
commit and say why. The app's tokens live in `src/app/index.css` alone. The
website receives them through `site/scripts/sync-tokens.mjs` and never copies or
redefines one; its own `@theme` may add page-only steps the app has no use for
(the fluid type, the device corner, the screenshot shadow, the stage ground).

## Principles

1. **Dark, dense, quiet.** The maintainer's own words, from the design-system
   sync of 2026-09-14:
   > One accent colour, a lot of near-black surface, small uppercase labels,
   > hairline rules. Every screen you build is a screen of that app.
   Everything below serves this sentence.
2. **Evolution, not a redesign.** The 2026 overhaul (decided 2026-09-25) unifies
   what drifted and adds depth and motion. It does not replace the identity.
3. **Three looks, one standard.** Dark, light and high contrast are each designed
   in their own right. High contrast comes in both dark and light. None of them
   may be a filter over another, and none may be the one that is checked last.
4. **One accent, derived, never hand-picked.** The user picks a single hex (or
   takes the OS accent). `accentShades` in `lib/contrast` derives the text
   shade, the fill, the pressed shade, the readable ink on top, and the two
   sheens behind the washes. Never write white on an accent fill: write
   `text-accent-ink`.
5. **Meaning is never colour alone.** A status also carries a label, a position
   or a glyph. A chart keeps its colours under forced colours (`data-keep-colors`,
   `svg[data-chart]`) because there the colour *is* the data.
6. **Motion answers something.** It answers the user's action, or it announces
   an arrival the user should notice. Surface motion is quick and quiet. Springs
   are for arrivals only, never for hover and never for leaving. Ambient motion
   has a budget of three consumers.
7. **Nothing is rebuilt.** Each recurring shape has one primitive. A second
   hand-made copy of a shape is a missing primitive, not a variant.
8. **Width decides the shape, the pointer decides the target.** The phone shell
   is chosen by width (`usePhoneShell`), capabilities by platform (`isAndroid`),
   and touch-sized targets by `pointer: coarse`. A narrow desktop window keeps
   mouse-sized targets. A tablet at desktop width still gets finger-sized ones.

## Platform floor

- **The CSS floor is Tailwind v4's**, which targets Chrome 111, Safari 16.4 and
  Firefox 128. Anything newer is progressive enhancement behind `@supports` or
  feature detection, and the screen must work without it.
- **WebView2** (Windows) is evergreen Chromium.
- **The Android System WebView** updates through the Play Store. `minSdk` 24
  still allows a device whose WebView has stopped updating, so feature-detect
  there too.
- **WebKitGTK** (Linux) is the engine that lags. The AppImage is built on
  ubuntu-22.04. The `.deb`, the `.rpm` and the Flatpak use the host's copy.
  Consequences:
  - Exits stay on `usePresence`, not `transition-behavior: allow-discrete`.
  - Scroll-driven animations and anchor positioning are enhancements, never
    the layout.
  - `@starting-style` may animate an entry, never a required state.

## Vocabulary

Everything here is a token or a utility in `src/app/index.css`. Pure black,
pure white, a hex literal or an arbitrary `[…]` value in a class is drift.

### Surfaces and ink

| Token | Dark | Light | Role |
|---|---|---|---|
| `surface-950` | `#0b0d12` | `#f4f6f8` | the page |
| `surface-900` | `#12141a` | `#ffffff` | a panel |
| `surface-850` | `#181c22` | `#eef0f4` | hover on a panel |
| `surface-800` | `#1f232b` | `#e5e8ed` | a control's fill |
| `surface-700` | `#2a2f39` | `#d5d9e1` | pressed, a control's border |
| `surface-600` | `#353b47` | `#b8beca` | a hovered control's border, scrollbar hover |
| `ink-100` | `#f0f2f5` | `#1a1e26` | primary text |
| `ink-300` | `#c8ccd6` | `#343944` | secondary text |
| `ink-500` | `#9da3af` | `#494e5b` | muted text |
| `ink-600` | `#868c99` | `#616876` | labels, placeholders |

The scale has **only these steps**. The theme does not define `ink-200`,
`ink-400`, `ink-700` or `surface-500`, so Tailwind emits nothing for them and
such a class silently renders the inherited colour.

### Meaning

- `gold`: scores only.
- `danger`: destructive actions and failure states.
- `success`: done and rising, a watched mark or an upward trend. Over cover
  art `on-cover-success` stands in for it.
- `graph-none`: a mark or a node with no status.

Each has a light-theme twin. The first three are darker there, because in light
they are text; `graph-none` is lighter, because its dark grey would read heavy.

The six **status colours** (`status-current` … `status-planning`) are defaults
that the user can override. Read them through `lib/statusColors`. The defaults
are deliberately not the accent, so a status never reads as a selection.

### Accent

`accentShades(hex, context)` returns the whole family:

- `accent-400`: the accent as text and icons, stepped until it reads on the
  page.
- `accent-500`: the fill.
- `accent-600`: pressed.
- `accent-ink`: text on the fill, the better of the two ink ends by measured
  ratio.
- `--w1` and `--w2`: the two sheens rotated off the hue, which the washes use.
- `--hair`: the hairline, neutral since the 2026 overhaul.

The values in `@theme` are first-frame fallbacks, not the colours a user sees.
The default accent is `#4b3fc7`.

### Surfaces that carry the identity

| Utility | What it is |
|---|---|
| `panel-wash` | the light a raised panel catches along its top; none in light |
| `panel-top` | the 1 px catch-light along a raised panel's top edge |
| `border-hair` | the neutral hairline round panels and floating surfaces |
| `section-rule` | the rule after a section heading, fading out so sections do not read as a form |
| `inset-well` | cut into the page, for a card that arrives unprompted |
| `well-edge` | the accent stripe down an inset well's left edge |
| `avatar-wash` | a picture-less avatar that still reads as an object |
| `cover-scrim` | the deterministic backdrop at the foot of arbitrary cover art |
| `ink-halo` | a black ring round light text on artwork |

**The canonical raised panel** is `Card`: `panel-wash panel-top rounded-panel
border border-hair bg-surface-900`. **The canonical floating surface**
(popover, menu) is `rounded-panel border border-hair bg-surface-900
panel-wash shadow-float`.

### Type

- `font-sans` is the system UI face (Segoe UI Variable on Windows).
- `font-brand` is SN Pro, for the wordmark and display.
- `font-brand-jp` is Kosugi Maru, for `title.native`. Its subset cannot be
  trimmed; CLAUDE.md says why.
- Only weight 400 of the two brand faces ships. Headings `h1` to `h3` render
  at 400 by rule, so a weight utility on one does nothing and is not written.

| Step | Use |
|---|---|
| `text-2xs` (10 px) | labels (`uppercase tracking-eyebrow text-ink-600`), badges, counts |
| `text-xs` (12 px) | dense rows, secondary lines, chips |
| `text-ui` (13 px) | the shell's panels, toolbars and dense titles |
| `text-sm` (14 px) | body, controls |
| `text-base` (16 px) | card titles |
| `text-heading` (26 px) | a title's own heading on its detail page |
| `text-hero`, `text-hero-lg` (28 / 36 px) | the first-run greeting |
| `text-title` (30 px) | page titles |

Headings (`h1` to `h3`) and every `uppercase` label are set in SN Pro at its
one weight by element, in unlayered rules in `index.css`, so no weight or
tracking utility can pull one back to the system face. A heading that shows
a Japanese title carries `font-brand-jp` and keeps it. `font-bold` is 650.

`tracking-eyebrow` is the one letter spacing for small uppercase labels.

### Radius

A radius is named by what it rounds, never by its size. A retune then moves
every control, panel or sheet at once, and the style audit refuses the size
names (`rounded`, `rounded-lg` …).

| Role | Size | For |
|---|---|---|
| `rounded-inner` | 4 px | a segment inside a track, icon buttons, small chips, small cover thumbnails |
| `rounded-control` | 6 px | buttons, fields, pills, list rows |
| `rounded-panel` | 10 px | cards, popovers, menus, dialogs |
| `rounded-sheet` | 16 px | the phone's bottom sheets |
| `rounded-cover` | 6 px | cover art |
| `rounded-mark` | 2 px | a data mark: a chart bar's end, a heatmap cell, a legend swatch |
| `rounded-full` | — | avatars, dots, round icon buttons |

### Icons

Icons are lucide at four sizes: `size-3.5` (14 px) beside small text, `size-4`
(16 px) in controls, `size-5` (20 px) in the shell, `size-8` (32 px) in empty
states. The style audit holds every icon to these four.

### Elevation and layers

- Flat content sits on its surface step.
- Raised panels add the catch-light and the wash, not a shadow.
- Floating surfaces take `shadow-float`, and the phone's sheets
  `shadow-sheet`. The style audit refuses the size names (`shadow`,
  `shadow-xl` …).
- The dim behind a dialog or a sheet is `bg-scrim`, near-black at 55 % in
  both themes.
- Chips are outlined on a clear ground, so coloured text keeps the contrast
  it was derived against on any surface. Over cover art they take
  `on-cover` at an alpha tuned to what each one covers; the 86 % plate
  under text is pinned by a test.
- Layers:
  - Tailwind's plain `z-5` (the titlebar over the page), `z-10`, `z-20` (a
    grid card's quick buttons), `z-30` and `z-50` cover sticky headers, the
    detection window, dialogs, a popover's desktop dropdown and the other
    anchored panels.
  - `z-popover` (100) covers menus, tooltips and every sheet (the action
    sheet, a popover's phone form).
  - `z-alert` (110) covers an alert (`Modal`'s `alert`), so a confirm
    stands over any other dialog.
  - `z-skip` (200) covers the skip link.
  - A dialog opened from a popover or a menu replaces that surface as it
    opens (`Popover`'s `closeThen`, the action host's overlay), which is why
    `Modal` can sit below them.

### Motion

**Two registers.**

- *Surface* motion: hover, focus, background and border. It uses
  `transition-surface` on the 140 ms `--ease-karasu`. Never use
  `transition-colors`: animating `color` holds the old value across a theme
  swap.
- *Feature* motion: a dialog arriving, a scrobble landing, a chart drawing. It
  may use `--ease-spring-soft`, `--ease-out-expo` and `--duration-expressive`.
  Reach for the first register unless there is a reason.

**Vocabulary.**

| Token | Motion |
|---|---|
| `settle` | down from above, no bounce; the bird landing |
| `rise-in` | up from the bottom edge on the soft spring: the bulk bar, the detection window, rows added to a feed or a list; sheets rise through `sheet-popup` and the toast through Motion |
| `pop-in` | scale from .97 on the soft spring: menus, popovers |
| `fade-in` | opacity only |
| `spring-in` | dialogs, on the soft spring: a slight overshoot that settles |
| `land` | a success arriving, the scrobble confirmation |
| `tick` | a counter acknowledging +1 |
| `*-out` | each entry's exit, quicker than the entry, on `--ease-exit` |
| `idle-glow`, `idle-float`, `idle-pulse` | ambient; three consumers, the budget is full |
| `shimmer` | a skeleton's sweep, which holds back for `--delay-skeleton` before it fades in, so a quick load never shows one |

**Rules.**

- React unmounts before CSS can animate, so an exit goes through `usePresence`
  for a hand-rolled node, through `MotionPresence` for a Motion-driven one, or
  through Base UI's `data-closed` / `data-ending-style` inside the `ui/`
  wrappers. Never through `transition-behavior: allow-discrete`, which WebKit
  lacks for overlays.
- Motion that CSS cannot see must ask `lib/motion` first: a View Transition,
  a scroll handler, a WAAPI call or a timer.
- Staggers use `staggerDelay`, which collapses the delay too.
- Reduced motion is the OS setting *or* the app's own toggle. Both collapse
  every animation and transition in CSS.

### Interaction

- **Focus.** Everything a keyboard reaches shows one ring: 2 px of
  `accent-500`, 2 px out. It comes from `@layer base`, so a primitive that
  draws its own ring, or a field that marks focus with its border, still
  wins. High contrast makes the ring 3 px. Grid cells draw their ring
  themselves, because the roving cursor is not real focus.
- **Press.** `press` sinks a control to 97 % while it is held.
  `transition-surface` carries the scale, and reduced motion sets it back
  to 100 %. `Button`, `IconButton`, `Pill`, `Segmented`, `Switch` and
  `RemovableChip` carry it.
- **Touch.** `coarse:` is a pointer variant, `(pointer: coarse)`, never a
  width. A narrowed desktop window keeps mouse-sized targets, and a tablet
  at desktop width gets finger-sized ones. `coarse:hit-area` gives a small
  control a 44 px tap area without changing how it looks; the same six
  primitives carry it.

## Contrast obligations

Every pair below must hold in every theme and contrast mode, for every accent
preset and for extreme custom accents:

| Pair | Standard | High contrast |
|---|---|---|
| `ink-100`, `ink-300` on `surface-950` … `800` | 4.5 : 1 | 7 : 1 |
| `ink-500`, `ink-600` on `surface-950`, `900` | 4.5 : 1 | 7 : 1 |
| `accent-400` (text) on the page | 4.5 : 1 | 7 : 1 |
| `accent-ink` on `accent-500` | 4.5 : 1 | 7 : 1 |
| `accent-500` against a panel (non-text) | 3 : 1 | 3 : 1 |
| the focus ring against what it touches | 3 : 1 | 3 : 1 |
| a control's border against its surface | — | 3 : 1 |

Every default status colour reaches 3 : 1 against the page and the panel in
all four themes, which `tokens.test.ts` asserts. A colour the user picks that
falls below it in the theme on screen gets a warning in its row of the
settings, with the ratio, never a refusal.

`src/lib/tokens.test.ts` reads these values out of `index.css` and asserts the
standard rows for text in both themes. It also checks accent text against the
page, for every preset and for the extremes. Two rows fall short today. The
test names the presets that fail them exactly, so a new shortfall fails the
test, and so does a fix that leaves its entry in the list. The contrast phase
empties the list:

- `accent-ink` on the fill reads 3.9 : 1 for the feather-sheen and rose
  presets in light.
- The default accent's fill stands 2.5 : 1 off the dark panel, and pale
  accents stand under 3 : 1 off the light one.

The same file keeps the token blocks in step, so a themed colour or root value
without a light twin fails.

### The contrast setting

Settings › Appearance › Contrast offers three choices:

- **System** (the default) follows the OS's `prefers-contrast: more`.
- **Standard** holds the standard palette.
- **High** holds the high-contrast palette, in dark and in light.

When the result is high, the theme store sets `data-contrast="more"` on
`<html>`, and `index.css` changes these things:

- It swaps in the high-contrast palette from the decision log.
- It makes `surface-600` the border role and redraws `border-surface-700`
  with it.
- It turns off washes, the catch-light, the float shadow's blur and glass.
- It thickens the focus ring.

`accentShades(…, { contrast: "high" })` pushes accent text to 7 : 1 on the
page and the fill away from its ink until the label reads at 7 : 1.
`tokens.test.ts` asserts every one of these, for every preset and the
extreme accents.

Windows' forced colours stay separate: the OS replaces the palette, and
`index.css` only keeps the data colours.

The website stays dark. The token sync rewrites the dark high-contrast
blocks into `@media (prefers-contrast: more)`, so the site answers the OS
request directly — the top-level blocks and the rules nested inside a
utility alike. The site's own light (its washes, the feathers, the hero
stage's glow and the screenshot shadows) goes under the same query.

**Known gap:** grey data fills stand under 3 : 1 in high-contrast light, and
the score histogram's upper bars are one of them. They get the border role
when their area is restyled.

## Primitives

`src/components/ui/` holds the primitives; `EmptyState` and `Skeleton` sit
beside them in `src/components/`. Use them, never a lookalike. When a need has
no row here, add the primitive first.

| Need | Use |
|---|---|
| an action | `Button` (`default`, `secondary`, `outline`, `ghost`, `danger`, `dangerGhost`) |
| an icon-only action | `IconButton`, always with `aria-label` |
| a control's name beside it, where the label cannot show | `Tooltip`, on hover and keyboard focus; visual only, so the control keeps its `aria-label`. A rail of them sits in one `TooltipProvider`, which opens the next at once |
| a key or a key combination | `Kbd`, a cap. The reference sheet lays a combination out one cap per key with `KeyCombo`; a hint in passing, at the end of a field or in the palette's shortcut column, is one `quiet` cap for the whole combination. The keys come from `lib/shortcuts`, which both read |
| one value of several | `Pill` |
| on or off | `Switch`, which is `role="switch"` and never a checkbox |
| a fact about something (genre, tag, category, state) | `Chip` with a tone (`neutral`, `muted`, `accent`, `gold`, `success`, `danger`) and a size (`xs`, `sm`, `md`); a link spells `chipClass` |
| a chip the user can take away | `RemovableChip`, the whole chip one button named by `removeLabel` |
| a count or an unread dot | `Badge`; `floating` over an icon rings it in the page colour |
| one lens of two or three | `Segmented`, a radio group with one tab stop whose thumb slides to the choice |
| a page's sections, or the list's statuses | `StatusTabs`, one row that scrolls rather than wraps |
| a panel | `Card`: `raised` by default (the wash and the catch-light), `flat` for a bordered row or block, `sunken` for a well inside either; `interactive` borders it on hover, and a card that must be a link, a form or an article spells `cardClass`. `CardTitle` heads a raised one |
| a titled page section | a `<section>` headed by `SectionHeader`; it has no chrome of its own |
| an Overview section heading | `SectionHeader` |
| a text field | `Input`; a count is `NumberInput`; several lines are `Textarea`, and a post is `MarkdownTextarea` |
| a labelled control in a form | `Field`: the label above, the control, then a hint or, while there is one, the error; without `htmlFor` it names its children as a group |
| a search | `SearchField`: `sm` in a panel, `md` in a toolbar, `lg` where the search is the page, `inset` as a panel's own top edge; `markFilled` where a query is a filter in force, `busy` while a request is out, `trailing` for a count or a shortcut. Escape empties it and stops there; `blurOnEscape` adds the find bar's second press |
| a native choice | `Select` in a form or a setting; `FilterSelect` and `MultiFilterSelect` in a filter bar |
| a menu of actions, at an element or at the pointer | `Menu` with `MenuPanel`, `MenuItem`, `SubMenu` and `MenuSeparator` |
| a row of a sheet, a panel or a list of choices | `MenuRow`; a link, a radio's label or a Base UI item spells `menuRowClass` with `MenuRowBody`. `menu` size at the pointer and `panel` in a dropdown or a sheet, both 44 px under a coarse pointer, and `touch` for a sheet only a finger opens; `current` for the chosen row, `managed` where the keyboard's place is `data-highlighted`; `MenuGroupLabel` over a group, `MenuRowSeparator` between two |
| an anchored panel, or its phone form | `Popover` (`dropdown` or `sheet`); `panelClassName` for content that draws its own edges, as the bell's rows do |
| a modal sheet from the bottom | `Sheet`, on Base UI's drawer: swipe, dim, Escape and back all close it; `tall` reaches to just under the top whatever it holds, for a list that is read rather than picked from |
| a section that folds open | `Disclosure`; a custom trigger pairs with `DisclosurePanel`; never in a virtual row, whose remount would replay the growth |
| a write receipt | `showToast`; one at a time, held while hovered or focused, longer with an action |
| anything moved by Motion | `m` and `MotionPresence` from `app/motion.tsx`, which with its lazy feature set `app/motionFeatures.ts` is the only place `motion` is imported |
| a dialog | `Modal`: `size` from `sm` to `2xl`, `description` and `icon` in the header, `footer` pinned under a body that scrolls; `alert` for a question that interrupts (`alertdialog`, over other dialogs, answered by its buttons with the harmless one first); `bare` for a full-screen view such as the cover; `dismissable={false}` while something runs that must not be left half done. Escape closes only the dialog holding focus |
| keeping an overlay alive through its exit | `Presence`, `PresenceIf` |
| a wait with no shape | `Loader`; a known shape is `Skeleton`, built from `Shimmer`, which a quick load never shows |
| a busy icon (sync, refresh, install) | `Spinner` with `spinning`, the only place `animate-spin` may appear |
| nothing to show | `EmptyState`, with a drawn `visual` or, where none fits, `icon` for a plain glyph at 32 px |
| a score picker | `ScoreBars` |
| a season picker | `SeasonPicker` |
| a user's name and face | `UserLockup` |

The menu row covers the context menu, the action sheet, the More sheet, the
sort and preset panels, the palette and the match picker. The rows that
carry more than a label keep a shape of their own: the bell's and the sync
panel's feed rows share the bell's tile, and the phone's settings list has
its own rows (both in the decision log). The tri-state filter options and
the season split's cover rows are still their own and move to it when those
areas are next restyled.

The cards cover the Overview's tiles, the composer, the franchise pane,
the feed's and the forum's rows, the offline entry and three wells. Four
shapes move with their areas instead: the borderless code and log wells
on `surface-850`, the tiles nested inside a card on the card's own fill,
the tinted notices, and the frames around the virtual lists.

## Libraries

Each library below is either in the bundle or approved for it. A new one needs
four things before it lands:

- a measured size, and the headroom in `scripts/bundle-budget.json` it spends;
- a reason no token or primitive covers;
- a row here;
- a line in THIRD-PARTY-NOTICES.md.

| Library | Status | For |
|---|---|---|
| `lucide-react` | shipped | icons |
| `class-variance-authority`, `clsx`, `tailwind-merge` | shipped | variant classes, `cn` |
| `d3-array`, `d3-scale`, `d3-shape` | shipped | chart maths only; the renderer is ours |
| `@base-ui/react` 1.8.0, pinned | shipped: `ui/menu` (the context menu), `ui/sheet`, the dropdown of `ui/popover`, `ui/tooltip` | menu and context menu (typeahead, safe submenu, long press), the one swipeable sheet, flip-aware dropdown positioning. Always controlled, so `useBackClose` and `data-overlay` keep working; wrapped under `ui/` only. The menu cost 40 KiB gzipped in the startup script, the drawer 12 more and the popover 2.5, since it shares Floating UI with the menu. Select and ScrollArea insert a `<style>` and stay unused, for the reason the Motion row gives |
| `motion` 13.4.4, pinned (`LazyMotion` + `m`) | shipped: `app/motion.tsx`, first in the toast | velocity after a swipe, sliding indicators, list enter and leave. `MotionConfig reducedMotion` follows the app's switch and the system's. `AnimateView`, `animateView` and `AnimatePresence`'s `popLayout` are banned: they inject a `<style>` without a nonce, which the CSP lets through only while `index.html` carries no inline style for Tauri to hash, a condition `tokens.test.ts` guards and the app must not lean on. That is why `MotionPresence` offers only `sync` and `wait`. 17 KiB gzipped in the startup script, and the full feature set, drag and layout included, is a 27 KiB chunk loaded after the first paint |

Considered and declined on 2026-09-25:

- **Radix.** A second layer stack beside Base UI.
- **React Aria.** Heaviest, and its press model fights the existing triggers.
- **Ark, Headless UI.** No gain over Base UI.
- **The shadcn CLI.** Brings the templated look; kept as a wiring reference
  only.
- **Vaul.** Unmaintained by its author's notice.
- **Sonner.** Karasu shows one toast at a time, and Sonner has live-region
  gaps.
- **cmdk.** The palette is already a correct combobox with our own fuzzy
  scorer.
- **tw-animate-css.** A second motion vocabulary.
- **GSAP.** Licence terms beside an MIT project, and an imperative timeline
  model.
- **React Spring.** Nothing Motion lacks.

## Enforcement

`scripts/style-audit.mjs` runs in `npm run verify` and holds every app file to
the vocabulary above. `scripts/style-baseline.json` froze the drift it found
and has been empty since 2026-09-26, so any new finding fails the gate. A
count may only ever fall, lowered with `--tighten` in the same commit. A reasoned permanent exception goes into
`scripts/style-allowlist.json`. `node scripts/style-audit.mjs --stats` shows
where the drift is.

## Mockups before arrangement changes

Every change to how a screen is *arranged* gets three mockups first; the
maintainer picks. A pure restyle that moves nothing does not. The rules:

- **Rendering.** Mockups use the real components with real data, at 405 px
  (phone) and 1232 px (desktop).
- **Themes.** Dark is always shown. Light and both high-contrast variants are
  shown whenever the change touches colour or elevation.
- **Choosing.** The maintainer may mix axes across the three ("B's radius with
  A's motion").
- **Recording.** The choice lands in the decision log below with its date.

## Decision log

- **2026-09-14:** The design-system sync records the identity: dark, dense,
  quiet; one accent; `rounded-lg` controls, `rounded-xl` panels; springs only
  for arrivals.
- **2026-09-25:** The detail header on the phone floats the cover; the facts
  and the action row sit below it (CLAUDE.md, "The phone's detail header").
- **2026-09-25:** Style overhaul decided:
  - The approach is an evolution.
  - Dark, light and high contrast are designed at equal quality.
  - Contrast is its own setting: System, Standard or High.
  - Base UI and Motion are approved, each behind a measured budget.
  - The website stays dark and follows the tokens and `prefers-contrast`.
  - Directions first, then area by area, with three mockups wherever the
    arrangement changes.
- **2026-09-25:** The direction is chosen from three rendered on the real app,
  "Sharpened", "Depth" and "Line". The maintainer picked a mix of them:
  - **Base: Sharpened.**
    - Neutral hairlines instead of the tinted one.
    - Tighter corners, per role: inner 4, control 6, panel 10, sheet 16,
      cover 6 px.
    - One shadow, only for what floats. Depth comes from tone steps and the
      catch-light, and the panel wash only lights the top edge.
  - **Motion: the soft spring from Depth.** Dialogs, sheets and menus arrive on
    a `linear()` spring with a slight settle, and leaving stays quick.
  - **Type: the brand face from Line.** Page titles, headings and the small
    uppercase labels are set in SN Pro at its one weight. Page titles are
    30 px.
  - **The palette**, even steps in OKLCH:

    | Token | Dark | Light | High contrast dark | High contrast light |
    |---|---|---|---|---|
    | surface-950 | `#0b0d12` | `#f4f6f8` | `#050608` | `#ffffff` |
    | surface-900 | `#12141a` | `#ffffff` | `#090b0f` | `#ffffff` |
    | surface-850 | `#181c22` | `#eef0f4` | `#111419` | `#eff2f7` |
    | surface-800 | `#1f232b` | `#e5e8ed` | `#191c22` | `#e3e6ed` |
    | surface-700 | `#2a2f39` | `#d5d9e1` | `#2a2e36` | `#cdd1da` |
    | surface-600 | `#353b47` | `#b8beca` | `#a0a5af` | `#494d56` |
    | ink-100 | `#f0f2f5` | `#1a1e26` | `#ffffff` | `#050608` |
    | ink-300 | `#c8ccd6` | `#343944` | `#edf0f6` | `#14161b` |
    | ink-500 | `#9da3af` | `#494e5b` | `#dce0e6` | `#23252b` |
    | ink-600 | `#868c99` | `#616876` | `#cdd1d9` | `#30333a` |

    In high contrast, `surface-600` is the border role, at 8 : 1 against the
    panel. The accent text and the fill's ink are pushed to 7 : 1. Washes,
    shadows and glass are off.
  - **The boards** compare today, the three directions and the chosen mix
    across ten screens, in dark, light and both high-contrast themes. They
    were rendered by the screenshot harness from the real app.
- **2026-09-25:** Base UI and Motion were measured before they were added.
  The estimate had been a few kilobytes; the build said otherwise.

  | Added to the startup script, gzipped | KiB |
  |---|---|
  | Base UI menu and context menu | 43 |
  | Base UI popover | 34 |
  | Base UI drawer | 22 |
  | all four together, sharing Floating UI | 49 |
  | Motion's `LazyMotion`, `m` and `AnimatePresence`, features loaded later | 16 |

  Offered three ways (no library, Base UI loaded on first use, both in the
  startup script), the maintainer chose both in the startup script, with the
  budget raised by what each one measures when it lands. Icons and hand-built
  buttons stay with the area passes rather than one sweep.
- **2026-09-25:** One row for every menu, sheet and panel. A hover is the
  app's usual `surface-850` step. The chosen row and a managed highlight take
  `surface-800`, because there the fill is the only sign of where the
  keyboard is. High contrast rings both in the border role. The rows of the
  More sheet and the preset and sort panels were 36 px on the phone and are
  44 px under a finger now, like the action sheet's; the sort direction is a
  `Segmented`, which it always looked like.
- **2026-09-25:** One dialog. The confirm, the match picker and the cover
  viewer stopped copying the modal's scrim, focus, Escape and back code and
  became `Modal` with `alert`, a footer and `bare`. A dialog's buttons sit
  in a footer pinned under a body that scrolls, so a tall form on a short
  window keeps them in reach. An alert's harmless answer takes the focus,
  where the confirm used to focus the destructive one. Escape closes only
  the dialog holding focus, so a menu or a confirm inside a dialog closes
  alone.
- **2026-09-25:** One search field. Nine were built four ways at seven
  heights, with four clear buttons. Eight share `SearchField` now, which is
  the list's own field grown into a primitive: a searchbox with its name,
  a clear button that keeps the caret and hands it back, and Escape that
  empties before it does anything else. The command palette keeps its own
  input, a combobox the palette owns. `Input` lost its clear button, which
  only the searches used.
- **2026-09-25:** Forms share `Field`, `Select` and `Textarea`. The settings
  panes' `SELECT` class, the Wrapped year picker's copy of it and the two
  copies of the notes box became primitives; three settings fields that
  wore the select's class became `Input`s; the forum, review and profile
  dialogs label their fields through `Field`, whose error replaces the
  hint rather than sitting under it.
- **2026-09-25:** `Card` has three variants. A skeleton now wears the frame
  of the card it stands in for, and the franchise pane is raised whether a
  title is picked or not; before, the empty pane was flat and the filled
  one raised without the catch-light.
- **2026-09-25:** A skeleton waits a quarter of a second before it fades
  in, in CSS alone, so a load that answers from the cache in that time goes
  straight from nothing to the content instead of flashing grey bars.
  Reduced motion shows it at once, as it collapses every delay. The empty
  states that show a plain glyph take it through `EmptyState`'s `icon`, at
  the 32 px step, where the blocked profile drew a 20 px one in a disc.
- **2026-09-25:** The bell and the More sheet, chosen from three mockups
  each, and the bell mixed across them. On the desktop the bell is
  compact plus a page: the dropdown shows the latest three and leads to a
  notifications page with a filter for all, Karasu's own and AniList's.
  On the phone it is a tall sheet of its own, grouped into today and
  earlier, which the More sheet gives way to; the panel that lay over the
  open More sheet goes. The More sheet stays a list, one destination per
  row, over a two-column list and a tile grid.
- **2026-09-25:** The collapsed sidebar and the palette's recent list,
  chosen from three mockups each. The collapsed rail stays icons only and
  names each one in a tooltip of its own on hover and focus, over a
  labelled rail that needed to scroll and a rail that widened under the
  pointer. The empty palette shows only what was used recently, commands
  and screens and never a title, beside the main shortcuts; everything
  else answers typing.
- **2026-09-25:** The shell's polish, shown as before and after and kept
  as shown. Every floating panel, the detection window included, takes
  the panel radius; every small uppercase label takes the one eyebrow
  spacing; the sync panel's rows wear the bell's tile and glyph. The
  expired-session banner grows in and collapses away, the playback error
  pops in and out, and the pull indicator fades where it stands. The
  detection window's backdrop fades to the panel colour rather than the
  cover scrim's black, which had left its lower lines unreadable in the
  light theme.
- **2026-09-25:** The lists' polish, shown as before and after and kept as
  shown. The toolbar and the filter selects take the eyebrow and the icon
  scale, the selection bar leaves the way it arrives, and the list view's
  score column reads "Score" where the German "Bewertung" was cut. A cover
  in the grid draws its focus ring on its frame, since the frame's clip had
  cut the ring off the link inside it, and a cover too narrow for both
  quick actions shows the one that fits rather than a clipped second.
- **2026-09-25:** The detail page and its editor, shown as before and after
  and kept as shown. The title takes a heading step of its own on the type
  scale and the native title the body step, the cover floats on the one
  float shadow, and the action row's icons and the links' glyphs take the
  icon scale. The label over the chosen score bar takes a gold-ink token,
  white on the light theme's dark gold where near-black was unreadable,
  and the tag field shows its focus on its border.
- **2026-09-25:** The franchise graph loses its fold. Three places for the
  collapse button were mocked, since under the node it sat on the relation
  line, and the maintainer chose none of them: the button and the folding
  go, and every related title is always drawn.
- **2026-09-25:** The status button and the +1 buttons, chosen from three
  directions (tinted, neutral with a dot, a refined solid). A status or the
  +1 carries its colour as a tint: `tint-fill` mixes `--tint` into the
  panel with a rim at half strength and keeps the page's own ink, the
  status adding its dot; over cover art `tint-fill-on-cover` puts the same
  tint on the cover controls' near-black with a glyph lifted toward white.
  High contrast drops the tint from the fill and draws the rim in ink, since
  a raw status colour fell under the 3:1 border obligation; a chosen tint
  there takes a fill and a doubled rim, and forced colours the system
  highlight, so a choice never shows by colour alone. The hover waits for a
  real pointer, or a tapped +1 stays lit on a phone.
  The status button's progress reads in `ink-300`, since `ink-500` fell to
  4.4:1 on the paused tint under the pointer.
- **2026-09-25:** The main buttons and the chosen chips, chosen from three
  directions (all tinted, two tiers with a solid confirm in dialogs, a
  refined solid), and all tinted won. `Button`'s default, the chosen
  `Pill`, the chosen season year and the not-found link take the accent
  as a tint with the page's ink, as the status and the +1 do. A pill that
  stands for a status takes its `tint`: the status dot on every choice and
  the status tint once chosen, never the accent, so the edit dialog and a
  profile's lists read like the quick editor. On a search or season cover
  too narrow for two circles the quick add stays for a new title and the
  editor for a listed one, the status badge giving way. Checkboxes, switches and count badges stay solid: their fill
  is the statement.
- **2026-09-26:** The overview, chosen in two rounds. Of three arrangements
  (continue first in one column, two columns with a rail, compact on top)
  the maintainer took the compact one and asked for three designs of it
  (panels, a typographic timeline, chips); the panels won, with each figure
  centred in its own unit. Under the banner sits one panel of four
  figures, each a tinted glyph over the number and its label; then one row
  of each continue strip, its count and "Show all" in the header's rule;
  and this week and airing soon side by side as panels with the heading
  inside the frame, a hairline between rows and when as a one-line chip.
  The section header keeps its title whole and lets the meta line give
  way, where the title used to lose to it ("Die…" on a phone).
  A third round asked for the figures to be more compact: the glyph beside
  the number put each unit off centre on the phone, where two columns hold
  labels of different widths, so the maintainer kept the glyph above and
  took the tightest stack that still reads — a smaller glyph circle, the
  number one step down, and closer spacing — on both shells.
- **2026-09-26:** The hero reads the same in every theme. Its frame is the
  cover near-black, since the art's feathered edges faded into the light
  theme's white page as a grey band; the kicker is a neutral near-black
  plate the art shows through a little, with only its text lifted toward
  the accent (`tint-label-on-cover`) — a first, fully tinted plate was
  judged too coloured; and the score over cover art, there and on every
  cover's badge, is one bright gold in every theme (`on-cover-gold`),
  where the light theme's text gold went dark on dark; the 18+ mark, the
  complete glyph and the reveal chip followed the same day
  (`on-cover-danger`, `on-cover-success`, `on-cover-edge`). In high contrast,
  glass over cover art turns solid in that near-black, not the page's
  panel colour, which had left the carousel's white dots on white.
- **2026-09-26:** The calendar's week moved into a bar of its own, chosen
  from three mockups (two rows, a week bar, one compact row) after the
  phone header broke — the Japanese subtitle stood one glyph per line. The
  bar sits beside the lens and view switches on a desktop and takes the
  full width on a phone, where the subtitle is dropped; the export moved
  up beside the title. In the stacked views (tiles, agenda) a run of days
  with nothing airing folds into one muted line ("Monday – Friday ·
  Nothing airs"), today always standing alone; the week grid keeps its
  seven columns, because there the position is the date. The maintainer
  asked for the choice to hold for every view, not only the agenda.
  "This week" sits inside the bar before the next arrow, so neither arrow
  moves under a second press; the phone leaves it out, at the
  maintainer's word, and steps back with the arrow.
- **2026-09-26:** Settings, chosen from three mockups each. Appearance is
  three cards by what a setting changes — colour, size and density,
  language and motion — with the theme as three miniatures of the window
  (the system one split corner to corner) over native radios, and the
  contrast as a segmented switch beneath them. On the phone the pane list
  is one card of rows, each an accent-tinted glyph, the pane's name and a
  line of what it holds. The account and AniList panes became one,
  "Account" ("Konto"): the sign-in first, then "In Karasu" and "Kept on
  AniList" as group headings, so it reads at a glance what another client
  sees too; an old link to the AniList pane lands there.
- **2026-09-26:** Two more settings arrangements, three mockups each. On
  the phone a row whose control is a field, a select or a button stacks:
  the label and its hint across the card, the control beneath at the full
  width, so no hint is squeezed into a column beside a wide select; a
  switch stays on the right, and the desktop keeps label and control side
  by side. The Jellyfin card leads with its connection: signed out, a
  well holding the server search, the address and the sign-in with its
  explanation; signed in, a status line naming the server and the account
  with Test and Sign out beside it. Beneath, the device filter and the
  external address are labelled fields with their explanations as hints,
  and Save stores just those two.
- **2026-09-26:** Three social arrangements on the phone, three mockups
  each; the desktop keeps its own. A profile's header stacks: the avatar
  beside the whole name and its badges, the counts and the AniList link
  under them, then Follow or Edit profile across the width, so no name is
  cut short and the button sits under the thumb. The forum's categories
  become one select, "Category: all", instead of six rows of chips, the
  lenses above it staying chips. The composer's toolbar keeps one row: the
  six marks used most (bold, italic, strike, spoiler, link, image), a
  "More" menu holding the rest, and Preview at the end.
- **2026-09-26:** The website takes the app's vocabulary, shown as before
  and after in both contrasts. Its copied button, card and pill match the
  app's; radii go by role, with a device corner for the phone screenshot;
  one eyebrow, in the accent over a section and muted over a group; chips
  outlined on the inner radius, as the app's are; panel edges on the hair
  line; shadows and the lightbox scrim from tokens; the feathers take
  their colours from the accent. The download button is the app's main
  action, the accent as a tint, rather than a solid fill of its own.
- **2026-09-26:** The Android home-screen widgets take the dark tokens,
  shown as before and after: surface-950 with a surface-800 edge, the
  title in the default accent's text shade, rows in ink-100 and the footer
  in ink-600, which lifts it from 4.0 : 1 to 5.8. The widgets cannot read
  the stylesheet, so `tokens.test.ts` reads their resources and holds them
  to it, as it does the window's background.
- **2026-09-26:** Adding a title from its detail page follows the "Default
  status" setting again. The button splits: its label adds with the default
  at once, the chevron opens the six statuses with the default marked in its
  place (B of three mockups), and on the desktop a resting mouse opens them
  too, without taking focus. The phone, which has no hover, keeps the
  chevron.
- **2026-09-26:** A status colour below 3 : 1 in the theme on screen says so
  in its row of the settings, with the ratio (B of three mockups), for every
  colour and not only a picked one. The two defaults that failed it in the
  light theme moved instead of being warned about: Watching from `#3fb950`
  to `#2f9e47` and Paused from `#d9a13b` to `#b87a14`, the same hues a step
  darker, now at least 3.1 : 1 on every page and panel. A saved palette that
  still holds a retired default follows the move; a colour the user chose
  stays.
