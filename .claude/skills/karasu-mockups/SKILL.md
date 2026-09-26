---
name: karasu-mockups
description: How Karasu mockups are made and shown to the maintainer. Use before any change that moves, adds or removes something on a screen (an arrangement change), before restyling an area, and whenever the maintainer asks for mockups, variants, boards or a before/after of Karasu's UI.
---

# Karasu mockups

The maintainer's standing rule: **every change to how a screen is arranged gets three mockups to choose between before any code**. A restyle that moves nothing gets a before/after board instead. DESIGN.md is the brief and outranks any other design guidance, including this skill's defaults.

## The harness

`scripts/screens.mjs` renders the real `App` — titlebar, sidebar or bottom bar, overlays — over a mocked backend (`scripts/screens/app.tsx`), in Chromium at `/opt/pw-browsers/chromium`. Real banners and covers for three titles are fetched from AniList into `scripts/screens/.cache/` on first use and are never committed; everything it writes goes to `scripts/screens/.out/`.

```sh
node scripts/screens.mjs shoot --only d3-detail,p3-editor --styles ,a,b,c --themes dark,light,hc-dark,hc-light
node scripts/screens.mjs board scripts/screens/.out/boards/<spec>.json
node scripts/screens.mjs clip --styles ,a,b,c
node scripts/screens.mjs hash --out scripts/screens/.out/before.json && node scripts/screens.mjs hash --compare scripts/screens/.out/before.json
```

- Viewports: desktop 1232 × 800, phone 405 × 860 with `android=1`, both at 2× pixel ratio.
- A variant is a stylesheet at `scripts/screens/.out/styles/<name>.css`, loaded after `index.css` under `html[data-dir="<name>"]`; the empty name is today's app. Scope every rule to that attribute.
- A variant that needs changed markup rather than changed CSS is a local, uncommitted edit to the component, shot, then reverted.
- Screens are the `SCREENS` table in `scripts/screens.mjs`; add a row for a screen a task needs rather than a one-off script.
- `hash` takes still frames at a fixed clock with motion off; two runs agree, so an unchanged hash is the proof a mechanical refactor changed no pixel.
- Check `report.json` beside the shots: page errors and unmocked commands mean the picture may be lying.

## The boards

- German labels throughout: column heads like "Heute", "A · …", captions for what differs, a subtitle that says in one or two sentences what each variant is.
- Dark always. Light and both high-contrast themes whenever colour, borders or elevation change; a contrast line in the notes for any palette change (DESIGN.md's obligations).
- Desktop boards as 2 × 2 grids at ~880 px per cell; phone boards as one row per screen at ~330 px per cell.
- Look at every board yourself before sending it: a mockup that fails to show the difference, or shows a rendering bug, costs the maintainer a round.

## The hand-off

1. Send the boards (and the clip, for motion) with `SendUserFile`.
2. Immediately ask with `AskUserQuestion`: the three variants as options, the recommended one first and marked, each description saying what the maintainer gets and gives up. Axes may be mixed; say so in the question.
3. Record the choice with its date in DESIGN.md's decision log before building it.
