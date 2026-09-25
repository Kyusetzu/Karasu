# Karasu design language

This file is the brief for how Karasu looks and moves. It holds the principles,
the vocabulary and the decisions. CLAUDE.md keeps the invariants and the
measurements that justify them.

**This file wins.** A design skill, a library's defaults or a mockup may disagree
with it. When that happens, either follow this file or change it first in its own
commit and say why. Tokens live in `src/app/index.css` and nowhere else. The
website receives them through `site/scripts/sync-tokens.mjs` and never copies
them.

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
| `surface-950` | `#0b0d12` | `#f4f6f9` | the page |
| `surface-900` | `#11141b` | `#ffffff` | a panel |
| `surface-850` | `#161a23` | `#eef1f5` | hover on a panel |
| `surface-800` | `#1c212c` | `#e4e8ee` | a control, a panel's border |
| `surface-700` | `#262c3a` | `#d2d8e2` | pressed, a control's border |
| `surface-600` | `#333b4d` | `#b6bece` | a hovered control's border, scrollbar hover |
| `ink-100` | `#eef1f6` | `#1a1e27` | primary text |
| `ink-300` | `#c3cbd9` | `#333b48` | secondary text |
| `ink-500` | `#98a1b2` | `#464e5d` | muted text |
| `ink-600` | `#7f8899` | `#5f6879` | labels, placeholders |

The scale has **only these steps**. The theme does not define `ink-200`,
`ink-400`, `ink-700` or `surface-500`, so Tailwind emits nothing for them and
such a class silently renders the inherited colour.

### Meaning

- `gold`: scores only.
- `danger`: destructive actions and failure states.
- `success`: the complete glyph over cover art.
- `graph-completed` and `graph-none`: franchise node outlines.

Each has a light-theme twin that is darker, because in light these are text.

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
- `--hair`: the tinted hairline.

The values in `@theme` are first-frame fallbacks, not the colours a user sees.
The default accent is `#4b3fc7`.

### Surfaces that carry the identity

| Utility | What it is |
|---|---|
| `panel-wash` | the iridescent wash on a raised panel; two sheens off the accent |
| `panel-top` | the 1 px catch-light along a raised panel's top edge |
| `border-hair` | the accent-tinted hairline on floating surfaces |
| `section-rule` | the rule after a section heading, fading out so sections do not read as a form |
| `inset-well` | cut into the page, for a card that arrives unprompted |
| `well-edge` | the accent stripe down an inset well's left edge |
| `rail-wash` | the sidebar's steeper, single-hue wash |
| `avatar-wash` | a picture-less avatar that still reads as an object |
| `cover-scrim` | the deterministic backdrop at the foot of arbitrary cover art |
| `ink-halo` | a black ring round light text on artwork |

**The canonical raised panel** is `Card`: `panel-wash panel-top rounded-xl border
border-surface-800 bg-surface-900`. **The canonical floating surface**
(popover, menu, sheet) is `rounded-xl border border-hair bg-surface-900
panel-wash` plus the overlay shadow.

### Type

- `font-sans` is the system UI face (Segoe UI Variable on Windows).
- `font-brand` is SN Pro, for the wordmark and display.
- `font-brand-jp` is Kosugi Maru, for `title.native`. Its subset cannot be
  trimmed; CLAUDE.md says why.
- Only weight 400 of the two brand faces ships, so a bold brand heading is
  synthesised by the engine.

| Step | Use |
|---|---|
| `text-2xs` (10 px) | labels (`uppercase tracking-wide text-ink-600`), badges, counts |
| `text-xs` (12 px) | dense rows, secondary lines, chips |
| `text-sm` (14 px) | body, controls |
| `text-base` (16 px) | card titles |
| `text-2xl font-bold` | page titles |

The 13 px step that 28 call sites spell `text-[.8125rem]` is a missing token.
It is named in the foundation phase and until then is not added anywhere new.

### Radius

| Radius | Role |
|---|---|
| `rounded-lg` | controls: buttons, fields, pills |
| `rounded-md` | the inner segment of a segmented track, icon buttons |
| `rounded-xl` | panels and floating surfaces |
| `rounded-full` | avatars, dots, round icon buttons |

Cover art currently uses five radii. It gets one role token in the foundation
phase.

### Icons

Icons are lucide at four sizes: `size-3.5` (14 px) beside small text, `size-4`
(16 px) in controls, `size-5` (20 px) in the shell, `size-8` (32 px) in empty
states. Eight other sizes are in use today, and they converge on these four.

### Elevation and layers

- Flat content sits on its surface step.
- Raised panels add the catch-light and the wash, not a shadow.
- Floating surfaces take `shadow-2xl`.
- The modal scrim is near-black at 55 % (`rgba(4,5,8,.55)`) in both themes.
  It is currently written as a literal in eight files; the foundation phase
  names it.
- z-index has no scale yet. The foundation phase adds one:
  sticky < popover < overlay < modal < toast < palette < system.

### Motion

**Two registers.**

- *Surface* motion: hover, focus, background and border. It uses
  `transition-surface` on the 140 ms `--ease-karasu`. Never use
  `transition-colors`: animating `color` holds the old value across a theme
  swap.
- *Feature* motion: a dialog arriving, a scrobble landing, a chart drawing. It
  may use `--ease-spring`, `--ease-out-expo` and `--duration-expressive`.
  Reach for the first register unless there is a reason.

**Vocabulary.**

| Token | Motion |
|---|---|
| `settle` | down from above, no bounce; the bird landing |
| `rise-in` | up from the bottom edge: toasts, the bulk bar |
| `pop-in` | scale from .97: menus, popovers |
| `fade-in` | opacity only |
| `spring-in` | dialogs, which overshoot and settle |
| `land` | a success arriving, the scrobble confirmation |
| `tick` | a counter acknowledging +1 |
| `*-out` | each entry's exit, quicker than the entry, on `--ease-exit` |
| `idle-glow`, `idle-float`, `idle-pulse` | ambient; three consumers, the budget is full |

**Rules.**

- Exits go through `usePresence`, because React unmounts before CSS can animate.
- Motion that CSS cannot see must ask `lib/motion` first: a View Transition,
  a scroll handler, a WAAPI call or a timer.
- Staggers use `staggerDelay`, which collapses the delay too.
- Reduced motion is the OS setting *or* the app's own toggle. Both collapse
  every animation and transition in CSS.

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

A status colour the user picks below 3 : 1 against the panel gets a warning,
never a refusal.

## Primitives

`src/components/ui/` holds the primitives; `EmptyState` and `Skeleton` sit
beside them in `src/components/`. Use them, never a lookalike. When a need has
no row here, add the primitive first.

| Need | Use |
|---|---|
| an action | `Button` (`default`, `secondary`, `outline`, `ghost`, `danger`, `dangerGhost`) |
| an icon-only action | `IconButton`, always with `aria-label` |
| one value of several | `Pill` |
| one lens of two or three | `Segmented` |
| the list's status strip | `StatusTabs` |
| a raised panel | `Card`, `CardTitle` |
| an Overview section heading | `SectionHeader` |
| a text field | `Input`; a count is `NumberInput` |
| a native choice | `FilterSelect`, `MultiFilterSelect` |
| an anchored panel or phone sheet | `Popover` (`dropdown` or `sheet`) |
| a dialog | `Modal` |
| keeping an overlay alive through its exit | `Presence`, `PresenceIf` |
| a wait with no shape | `Loader`; a known shape is `Skeleton` |
| nothing to show | `EmptyState` |
| a score picker | `ScoreBars` |
| a season picker | `SeasonPicker` |
| a user's name and face | `UserLockup` |

`ui/tabs.tsx` is legacy: no selected state for assistive technology, and
`transition-colors`. `Segmented` replaces it in the foundation phase.

The foundation phase adds, each replacing the hand-built copies it lists in
the plan:

- `spinner`, `switch`, `chip` and `badge`, `disclosure`, `menu-item`;
- `sheet` (one sheet with swipe to dismiss);
- `field` and `search-field`, and card variants.

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
| `@base-ui/react` | approved, not yet added | menu and context menu (typeahead, safe submenu, long press), the one swipeable sheet, flip-aware dropdown positioning. Always controlled, so `useBackClose` and `data-overlay` keep working; wrapped under `ui/` only |
| `motion` (`LazyMotion` + `m`) | approved, not yet added | velocity after a swipe, sliding indicators, list enter and leave. `MotionConfig reducedMotion` fed from `lib/motion`. `AnimateView` and `animateView` are banned: they inject a `<style>` without a nonce |

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
the vocabulary above. Today's drift is frozen in `scripts/style-baseline.json`.
A count may fall, and must be lowered with `--tighten` in the same commit, but
it never rises. A reasoned permanent exception goes into
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
