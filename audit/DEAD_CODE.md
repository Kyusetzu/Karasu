# Dead Code, Dependencies and Documentation Consistency

## Scope

Pre-release audit of Karasu at `/home/user/Karasu`, in two halves.

**Half one — dead and unreachable code.** Rust (`src-tauri/src/`), the frontend
(`src/`), assets, and the direct dependency lists on both sides. Only
high-certainty cases are filed. Three reachability traps were handled explicitly
rather than assumed away, and every negative result below says which method
established it:

- **cfg-gated platform code.** `#[cfg(windows)]`, `#[cfg(target_os = "linux")]`,
  `#[cfg(mobile)]` and `#[cfg(target_os = "android")]` bodies are invisible to a
  Linux `cargo check`, so absence of a compiler warning proves nothing about
  them. They were resolved by reading the call sites in the gated modules, not
  by trusting the build.
- **JNI entry points.** A `pub extern "system" fn Java_…` has no Rust caller by
  construction; its caller is Kotlin, and its survival depends on a proguard
  keep. These were resolved against `src-tauri/gen/android/` rather than by
  reference count.
- **Release-versus-test reachability.** `cargo test` compiles `#[cfg(test)]`, so
  a function whose only non-test caller is platform-gated stays alive in the test
  build and is dead in a release build — the `diagnostics::parse_os_release`
  class CLAUDE.md records. Every `fn` definition was scanned against every
  non-doc-comment reference with `#[cfg(test)]` mod regions excluded.

**Half two — documentation consistency.** README.md, CLAUDE.md, SECURITY.md,
CHANGELOG.md, THIRD-PARTY-NOTICES.md (root and Android copy), module doc
comments, and the build/test configuration they describe. The DOC-CLAIMS TABLE
and the dependency observations are reproduced under **Verified sound**;
divergences are filed as findings.

Read-only throughout: no repository file outside this report was modified, and
no git write was performed. Findings carrying `Source: found during adversarial
verification` were raised by the verification pass over the first-pass report,
not by the first pass.

**Headline: the codebase is exceptionally clean on the dead-code axis.** All 110
registered Tauri commands are invoked, every frontend module is imported, every
npm production dependency and every direct Cargo dependency but one is
referenced, `cargo check --offline` on the Linux target completes with zero
warnings, and there is no live `TODO`/`FIXME`/`HACK`/`XXX` marker in the tree.
Nothing in this report is a runtime defect; nothing rises above P3.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| DC-01 | P3 | DOCUMENTATION ISSUE | src/lib/anilistMarkdown.ts:8-18 | The parser's design justification cites a deleted module in the present tense and asserts the repo has no jsdom, which it has |
| DC-14 | P3 | DOCUMENTATION ISSUE | src/lib/anilistMarkdown.ts:6 | The same doc block opens with "a WebView whose `csp` is `null`"; `tauri.conf.json:26` sets a full production CSP |
| DC-02 | P4 | CODE SMELL | package-lock.json:3,9 | `bump-version.mjs` does not touch the lockfile, so its root `version` trails `package.json` |
| DC-03 | P4 | MISSING TEST | tsconfig.json:27-28 | `npm run typecheck` covers neither `vite.config.ts` (inert project reference) nor `vitest.setup.ts` (in no include list) |
| DC-04 | P4 | DOCUMENTATION ISSUE | THIRD-PARTY-NOTICES.md:84-93 | The direct-production-dependency table lists 21 of 22; `@tauri-apps/plugin-deep-link` is absent |
| DC-05 | P4 | DOCUMENTATION ISSUE | vite.config.ts:37 | "thirty-odd files and four hundred assertions" against a measured 86 files and 935 cases |
| DC-06 | P4 | DOCUMENTATION ISSUE | CLAUDE.md:144,105-108,595 | Four Rust root modules and two root components named nowhere; the mark's path is written without its `src/` prefix |
| DC-07 | P4 | DOCUMENTATION ISSUE | src/components/KarasuMark.tsx:12 | "Source of truth is `design/…`" points at a directory that was never tracked |
| DC-08 | P4 | IMPROVEMENT | src-tauri/Cargo.toml:136-137 | `windows-future` is a direct dependency no source names; the justifying comment no longer states the real reason |
| DC-09 | P4 | IMPROVEMENT | vite.config.ts:15 | `__dirname` in an ESM config; Vite 8.2.2 already warns and the future native loader would throw |
| DC-10 | P4 | DOCUMENTATION ISSUE | README.md:210-222 | The implemented global summon hotkey appears nowhere in the README |
| DC-11 | P4 | CODE SMELL | src/api/social.ts | 33 of 42 exported constants are module-internal, which switches `noUnusedLocals` off for them |
| DC-12 | P4 | DOCUMENTATION ISSUE | THIRD-PARTY-NOTICES.md:57 | "605 crates in the resolved graph" against 618 `[[package]]` entries in `Cargo.lock` |
| DC-13 | P4 | INVESTIGATION | THIRD-PARTY-NOTICES.md:66 | The CDLA-Permissive-2.0 row counts 1; `webpki-roots` may make it 2 |
| DC-15 | P4 | DOCUMENTATION ISSUE | src/lib/recommend.ts:12 | Comment points at `components/RecommendedSection.tsx`; the file is under `components/media/` |
| DC-16 | P4 | DOCUMENTATION ISSUE | CLAUDE.md:78 | "settings/ holds the eight panes" — eight files, but they no longer map to the eight panes |
| DC-17 | P4 | IMPROVEMENT | package.json:11 | Nothing in the gate detects an unused *export*; the pattern is repo-wide, not one file's |
| DC-18 | P4 | IMPROVEMENT | tsconfig.node.json:1-9 | No `"strict"`, so the `tsc -b` route to fixing DC-03 would check `vite.config.ts` more weakly than `src/` |

---

ID: DC-01
Severity: P3
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src/lib/anilistMarkdown.ts
Line: 8-18
Function: module-level doc comment on the `MdInline`/`MdBlock` parser

Problem:
The module's architectural justification rests on two premises that are both
false in the current tree. It describes a deleted module in the present tense as
the live implementation, and it asserts that the repository has no DOM testing
stack, which it has had for some time.

Expected Behavior:
A comment explaining *why a tree instead of a sanitizer* should cite premises
that hold, so a future maintainer weighing the same trade-off reasons from the
real tree.

Actual Behavior:
Two distinct false statements in one paragraph.

(a) `anilistMarkdown.ts:8-11`:

```
 * **Why a tree and not sanitized HTML.** `lib/description.ts` takes the other
 * road for media descriptions, and its own comment records that its previous
 * version was a live path from a description to script execution here. It
 * survives by allowing five tags with no attributes, ...
```

`src/lib/description.ts` does not exist. The sibling module says so explicitly —
`src/lib/anilistHtml.ts:10` reads "`lib/description.ts`, which this module
replaces and which is now deleted". So one comment says the module is deleted
and another says it "takes the other road" and "survives". The module that
handles media descriptions today is `lib/anilistHtml.ts`.

(b) `anilistMarkdown.ts:12-13`: "The deciding argument is testability: this repo
has no jsdom and no `@testing-library`". Both are present:
- `package.json:46` — `"@testing-library/react": "^16.3.2"`
- `package.json:53` — `"jsdom": "^30.0.1"`
- `vite.config.ts` defines a whole `dom` vitest project with
  `environment: "jsdom"` and `setupFiles: ["./vitest.setup.ts"]`
- 18 `*.dom.test.tsx` files exist under `src/`

Reproduction:
```sh
cd /home/user/Karasu
ls src/lib/description.ts            # No such file or directory
sed -n '10p' src/lib/anilistHtml.ts  # "...and which is now deleted"
grep -n "jsdom\|testing-library" package.json
find src -name '*.dom.test.tsx' | wc -l   # 18
```

Impact:
Documentation only — no runtime behaviour depends on it. The cost is that the
*load-bearing* argument for the current design ("the deciding argument is
testability … cannot be asserted without a DOM") is unsound as written. A future
maintainer re-litigating tree-versus-sanitizer would either act on a false
constraint or, on discovering jsdom is present, wrongly conclude the decision has
expired. The tree design is still correct for the other reasons given in
`anilistHtml.ts:17-21` ("a sanitizer has to be right, where a tree has nothing to
be wrong about"); only this justification decayed.

This is the failure class CLAUDE.md records as having cost real time — "A comment
asserting what a dependency cannot do needs rechecking when that dependency is
bumped" (the `windows-future` `join()` lesson). Here the dependency was *added*
rather than bumped, with the same effect.

Root Cause:
`lib/description.ts` was deleted and replaced by `lib/anilistHtml.ts`, and jsdom
plus Testing Library were later added for the `dom` vitest project. Neither change
swept the sibling module's prose, and nothing mechanically checks comment prose
against the tree.

Recommended Fix:
Rewrite `anilistMarkdown.ts:8-18` to (1) name `lib/anilistHtml.ts` as the current
description path and refer to `lib/description.ts` in the past tense, consistently
with `anilistHtml.ts:10`, and (2) drop or restate the "no jsdom" sentence. The
surviving argument — a tree has no `html`/`raw` member for a renderer to pass
through — stands on its own and is already stated in the next sentence. Fix DC-14
in the same edit; it is the third false premise in the same paragraph.

Regression Tests Required:
None enforceable by unit test. A cheap mechanical guard would be a test in the
spirit of `src/lib/i18nKeys.test.ts` that extracts backtick-quoted `lib/*.ts` /
`components/*.tsx` paths from comments and asserts each resolves on disk; that
check would catch this, DC-07 and DC-15 at once.

Confidence: HIGH

---

ID: DC-14
Severity: P3
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src/lib/anilistMarkdown.ts
Line: 6
Function: module-level doc comment on the `MdInline`/`MdBlock` parser

Problem:
The opening premise of the same doc block DC-01 covers states that the content is
"rendered inside a WebView whose `csp` is `null`". The application ships a full
production Content-Security-Policy.

Expected Behavior:
A threat-model sentence that a security-relevant design is justified by should
describe the policy the app actually ships, so the residual risk the parser
carries is stated at its true size.

Actual Behavior:
`src/lib/anilistMarkdown.ts:6`:
```
 * rendered inside a WebView whose `csp` is `null`.
```
`src-tauri/tauri.conf.json:26` sets:
```
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.anilist.co; font-src 'self'; connect-src 'self' ipc: http://ipc.localhost; ...
```
and `:27` sets a separate `devCsp`. Both are non-null. `git log -S'"csp"'` shows
the CSP arriving in commit `c0a95d0` — the premise decayed at that commit and was
not swept.

Reproduction:
```sh
cd /home/user/Karasu
sed -n '6p' src/lib/anilistMarkdown.ts
grep -n '"csp"\|"devCsp"' src-tauri/tauri.conf.json
```

Impact:
Documentation only, but it is the premise with security weight: it overstates the
threat model the parser is justified by. A maintainer reading it would believe
script-src is unrestricted in the shipped app, which is false and could lead them
to either over-engineer here or under-value the CSP elsewhere. It sits in the same
paragraph as DC-01's two false premises, which is what makes the block as a whole
worth a P3 rather than a P4 — three of the four load-bearing statements in one
justification are wrong.

Root Cause:
The CSP was added after the parser's doc block was written, and the block was not
re-read. Same mechanism as DC-01.

Recommended Fix:
Replace the clause with the real policy — the WebView runs under
`script-src 'self'` with Tauri's compile-time nonce injection — and keep the
following sentence's actual argument, which does not need a null CSP to hold: a
tree union with no `html`/`raw` member cannot carry executable content regardless
of policy. Edit it together with DC-01.

Regression Tests Required:
None enforceable. The comment-path linter proposed under DC-01 would not catch
this class; only re-reading the block when `tauri.conf.json` changes would.

Confidence: HIGH
Source: found during adversarial verification

---

ID: DC-02
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/package-lock.json
Line: 3 (and 9, the `packages[""]` mirror)
Function: n/a — lockfile root metadata

Problem:
`package-lock.json` records a project version behind `package.json`, because
`scripts/bump-version.mjs` — the tool CLAUDE.md mandates for every commit — does
not update it.

Expected Behavior:
CLAUDE.md ("The commit loop") states bump-version.mjs "moves the version in all
five places at once — the three manifests, `COMMIT_NUMBER`, and `Cargo.lock`".
`package-lock.json` is a sixth place that also stores the version, and it should
either be kept in step or be knowingly exempt.

Actual Behavior:
```
package.json:4          "version": "0.190.0"
package-lock.json:3     "version": "0.162.0"
package-lock.json:9     "version": "0.162.0"     (packages[""] mirror)
```
`scripts/bump-version.mjs` plans exactly `PACKAGE_JSON`, `TAURI_CONF`,
`CARGO_TOML`, `CARGO_LOCK`, `COMMANDS_RS` (lines 30-44 and 186-190) and never
mentions `package-lock.json`:
```sh
grep -n "package-lock" scripts/bump-version.mjs   # no match
```
Git history confirms the drift is passive: the last commit to touch the lockfile
is `c0a95d0`, whose diff carries `+  "version": "0.162.0",` — i.e. it was last
updated as a side effect of somebody running `npm install`.

Reproduction:
```sh
cd /home/user/Karasu
python3 -c "import json;print(json.load(open('package.json'))['version'],
 json.load(open('package-lock.json'))['version'])"
# 0.190.0 0.162.0
git log --oneline -1 -- package-lock.json    # c0a95d0
```

Impact:
Bounded, and nothing consumes the field:
- **`npm ci` is unaffected** — it validates the dependency tree in `packages`, not
  the root `version`. `npm ci` succeeds here, and `package.json`'s 22
  `dependencies` / 12 `devDependencies` are byte-identical to the lockfile's
  `packages[""]` copies.
- **The release tag guard is unaffected** — `.github/workflows/release.yml` reads
  `(Get-Content package.json -Raw | ConvertFrom-Json).version`, not the lockfile,
  and throws on mismatch.
- What remains: the next contributor running plain `npm install` gets an unrelated
  two-line lockfile diff inside whatever commit they were making. On a repository
  that bumps the version on *every* commit and whose CLAUDE.md already flags
  lockfile conflicts as painful, that is avoidable merge noise. Any SBOM or
  provenance tooling reading the lockfile also reports the wrong version.

Verification: downgraded from P3 — nothing reads the lockfile's root `version`
(`npm ci` validates the `packages` tree, the release guard reads `package.json`),
so the entire residual cost is a two-line diff on a future `npm install`. That is
hygiene, not a P3. (The first pass also described the gap as "28 commits behind";
that is minor-version arithmetic, not a commit count — the repository has 52
commits and `COMMIT_NUMBER` is 498.)

Root Cause:
`package-lock.json` was not in the bump script's target list when it was written,
and nothing in `npm run verify` compares the two version fields.

Recommended Fix:
Either (a) add `package-lock.json` to `bump-version.mjs`'s plan — it is a plain
two-line field edit, and the script already round-trips files by regex to avoid
reformatting; or (b) if the maintainer prefers not to touch a generated file, add
one line to CLAUDE.md's commit-loop section recording that the lockfile version is
deliberately not tracked, so the divergence stops looking like a bug.

Regression Tests Required:
A one-assertion node test (or a check inside `bump-version.mjs --print`) asserting
`package.json.version === package-lock.json.version`. It costs nothing and pins
whichever policy is chosen.

Confidence: HIGH

---

ID: DC-03
Severity: P4
Category: MISSING TEST

File: /home/user/Karasu/tsconfig.json
Line: 27-28 (`"include": ["src"]`, `"references"`)
Function: n/a — `npm run typecheck`

Problem:
`npm run typecheck` — the first and short-circuiting stage of `npm run verify`,
which CLAUDE.md calls "the whole gate and is what CI runs" — typechecks neither
`vite.config.ts` nor `vitest.setup.ts`. The project reference that appears to
cover `vite.config.ts` is inert under the command actually run.

Expected Behavior:
The gate CI runs should cover the build and test configuration, or the gap should
be recorded. `tsconfig.node.json:9` (`"include": ["vite.config.ts"]`) plus
`tsconfig.json:28` (`"references": [{ "path": "./tsconfig.node.json" }]`) read as
if it does.

Actual Behavior:
`package.json:11` defines `"typecheck": "tsc --noEmit"`. Plain `tsc -p` does not
build referenced projects — only `tsc -b` does — so the reference is never
followed. Measured directly:
```sh
cd /home/user/Karasu
npx tsc --noEmit --listFilesOnly | grep -v node_modules | wc -l   # 316
npx tsc --noEmit --listFilesOnly | grep -c vite.config.ts         # 0
npx tsc --noEmit --listFilesOnly | grep -c vitest.setup.ts        # 0
```
316 files, all under `src/`. `vitest.setup.ts` is in *no* tsconfig's `include` —
not `tsconfig.json` (`include: ["src"]`, and the file is at the repo root) and not
`tsconfig.node.json` (`include: ["vite.config.ts"]`).

Independent confirmation that `vite.config.ts` is genuinely unchecked: the tree has
no `@types/node` at all (`npm ls @types/node --depth=0` is empty;
`node_modules/@types/` holds only aria-query, chai, d3-*, deep-eql, estree, react,
react-dom), so `vite.config.ts:4`'s `import path from "node:path"` would raise
TS2307 the moment it entered the compilation. `npm run typecheck` passes, which
proves the file is not in it. The two `// @ts-expect-error process is a nodejs
global` directives at `vite.config.ts:6` and `:30` are likewise never validated —
an unused `@ts-expect-error` is itself TS2578 when a file *is* checked.

Vitest does not close the gap: it transpiles with esbuild and performs no type
checking.

Reproduction:
The three commands above.

Impact:
A type error in the Vite config or the jsdom setup file reaches CI green and fails
only at `vite build` / `tauri build` time (config) or as a confusing runtime
failure inside the `dom` project (setup). `vitest.setup.ts` is load-bearing for all
18 `.dom.test.tsx` files — its own comment records that a missing `ResizeObserver`
stub "surfaces as six unrelated failures and no clue". Both files are currently
type-correct as far as their own contents go.

Verification: downgraded from P3 — both files are *executed* by the gate already
(`npm test` loads `vite.config.ts` to read `test.projects`, and the `dom` project
runs `vitest.setup.ts` for all 18 dom tests), so only type-level errors escape, and
neither file ships to a user. A coverage hole, not a release risk.

Root Cause:
The Vite React template's split tsconfig assumes `tsc -b`; the repo's `typecheck`
script uses plain `tsc --noEmit`. `vitest.setup.ts` was added later and no
`include` was widened for it.

Recommended Fix:
Two options, both small:
- Simplest: add a root-level `"include": ["src", "vite.config.ts",
  "vitest.setup.ts"]` and add `@types/node` to `devDependencies` (needed for
  `node:path` and `process`, and it would let the two `@ts-expect-error` directives
  be removed rather than merely unverified).
- Or keep the split and change the script to `tsc -b --noEmit`, after adding
  `"strict": true` (see DC-18) and `@types/node` to `tsconfig.node.json` and
  putting `vitest.setup.ts` in one of the two `include` lists. `tsconfig.node.json`
  sets `"composite": true`, so `tsc -b` writes `.tsbuildinfo`; add it to
  `.gitignore` if that route is taken.

Do not adopt either without running `npm run typecheck` afterwards: pulling two
previously unchecked files into the compilation is likely to surface real errors,
which is the point.

Regression Tests Required:
Deliberately introduce a type error in `vitest.setup.ts` and in `vite.config.ts`
and confirm `npm run typecheck` now fails on each. Without that, a widened
`include` that silently still misses the file looks identical to a fix.

Confidence: HIGH

---

ID: DC-04
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/THIRD-PARTY-NOTICES.md
Line: 84-93 (the "Direct production dependencies" table)
Function: n/a

Problem:
The table enumerating direct production npm dependencies lists 21 of the 22 in
`package.json`. `@tauri-apps/plugin-deep-link` is absent, and it is a shipped
runtime dependency.

Expected Behavior:
The file's own framing is strict — "Facts below were read off the dependency
graph, not estimated" (line 12) — and the section header is "Direct production
dependencies:" without qualification. A licence-attribution document that
enumerates a set should enumerate all of it.

Actual Behavior:
```sh
cd /home/user/Karasu
for d in $(python3 -c "import json;print(' '.join(json.load(open('package.json'))['dependencies']))"); do
  grep -qF "$d" THIRD-PARTY-NOTICES.md || echo "MISSING: $d"; done
# MISSING: @tauri-apps/plugin-deep-link
```
The package is real, shipped and used from the frontend (`src/app/App.tsx` imports
`onOpenUrl` from it), declared at `package.json:27` and mirrored in
`src-tauri/Cargo.toml` (`tauri-plugin-deep-link`). Its licence is
`MIT OR Apache-2.0` — the same cell the table already has at line 91 for
`@tauri-apps/api, @tauri-apps/plugin-opener`.

Reproduction:
The loop above, or read lines 84-93 and compare against `package.json`'s
`dependencies` block.

Impact:
Attribution completeness only. Both MIT and Apache-2.0 require attribution on
redistribution, and this file is the vehicle Karasu uses for it, so the omission is
a minor gap in the obligation the file exists to discharge. No practical risk: the
same licences are reproduced in full at the end of the file, and the two licences
that require the notice by their own terms (the two fonts, OFL-1.1 §2 and
Apache-2.0 §4(a)) are correctly and completely covered.

Root Cause:
The deep-link plugin was added with the Android work without a sweep of the notices
table, and nothing checks the table against `package.json`.

Recommended Fix:
Add `@tauri-apps/plugin-deep-link` to the `MIT or Apache-2.0` row at
`THIRD-PARTY-NOTICES.md:91`, and mirror the edit into
`src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md` in the same
commit — CLAUDE.md's standing warning that the two drift silently applies, and they
are byte-identical today (verified: `diff` exits 0).

Regression Tests Required:
A node test asserting every key of `package.json.dependencies` appears somewhere in
`THIRD-PARTY-NOTICES.md`, and that the root file and the Android copy are
byte-identical. Both are three-line tests and would prevent this class permanently.

Confidence: HIGH

---

ID: DC-05
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/vite.config.ts
Line: 37
Function: `test.projects` doc comment

Problem:
The comment quantifies the test suite at roughly a third of its actual size, and
CLAUDE.md's own figure for the same suite contradicts it.

Expected Behavior:
A measured figure kept current, or the claim stated without a number. The
repository's policy on decayed numbers is explicit elsewhere — CHANGELOG.md removes
a number precisely because "the number decayed, the policy did not".

Actual Behavior:
`vite.config.ts:37`:
```
 * thirty-odd files and four hundred assertions in about two seconds. Only
```
Measured:
```sh
cd /home/user/Karasu
find src -name '*.test.ts' -o -name '*.test.tsx' | wc -l                     # 86
find src -name '*.test.ts' -o -name '*.test.tsx' | grep -v '\.dom\.' | wc -l # 68
grep -rhoE '^\s*(it|test)(\.[a-z]+)?\(' src --include=*.test.ts --include=*.test.tsx | wc -l  # 935
```
86 test files, 68 in the `node` project the sentence describes, 935 test cases.
CLAUDE.md's "~900 tests in a handful of seconds" matches reality and contradicts
this comment.

Reproduction:
The three commands above.

Impact:
Cosmetic. The comment's *argument* — that the node/jsdom split is what keeps the
suite fast, and that the marker belongs in the filename rather than being inferred
from the extension — is entirely correct and is independently supported by the
measured 2.0 s → 14.1 s regression CLAUDE.md records. Only the illustrative figures
decayed. The mild risk is a maintainer reading "thirty-odd files … about two
seconds", observing a much longer run, and concluding something regressed.

Root Cause:
A measured figure inlined in prose, with no mechanism tying it to the tree.

Recommended Fix:
Either refresh to "sixty-odd files and nine hundred-odd assertions" or drop the
numbers and keep the qualitative claim, matching the CHANGELOG's own precedent.

Regression Tests Required:
None. Not testable, and not worth a test.

Confidence: HIGH

---

ID: DC-06
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/CLAUDE.md
Line: 144 (Rust root modules), 105-108 (cross-cutting components), 595 (mark path)
Function: n/a — the Layout section

Problem:
The Layout section's explicit enumerations are incomplete in two places, and one
file path in the performance-invariants section does not exist as written.

Expected Behavior:
CLAUDE.md is the orientation document for anyone working in this repo, and its
Layout tree is written as an exhaustive map ("**Where things go.** … a command's
file is its subject"). An enumeration that omits substantial modules sends a reader
looking in the wrong place.

Actual Behavior:

(a) `CLAUDE.md:144` closes the `src-tauri/src/` tree with
`discord.rs · library.rs · portable.rs`, presenting those as the leftover root
modules. Four more exist and are named nowhere in the whole file:
```sh
cd /home/user/Karasu
for f in $(ls src-tauri/src/*.rs | xargs -n1 basename); do
  grep -qF "$f" CLAUDE.md || echo "NOT NAMED: $f"; done
# NOT NAMED: background.rs
# NOT NAMED: backups.rs
# NOT NAMED: i18n.rs
# NOT NAMED: sync.rs
```
These are not trivia:
- `backups.rs` — daily local snapshots of `karasu.db`, backing three registered
  commands (`get_backup_settings`, `set_backup_settings`, `open_backup_dir`).
- `background.rs` — the dead-app notification check, holding the JNI entry point
  `Java_dev_kyu_karasu_KarasuNative_backgroundNotifCheck` at line 173.
- `i18n.rs` — the strings Rust composes, the exhaustive-match `Msg` table.
- `sync.rs` — the poison-free mutex helper.

(`keystore.rs` and `widgets.rs` are also absent from the tree diagram but *are*
described in CLAUDE.md's prose elsewhere, so they are not part of this finding.)

(b) `CLAUDE.md:105-108` enumerates the cross-cutting root components as
"EmptyState · Skeleton · KarasuMark · FilteredNotice — cross-cutting, belong to no
group". Two more sit at `src/components/` root and are named nowhere in CLAUDE.md:
`ErrorBoundary.tsx` and `RichText.tsx`, the latter being the renderer for the
markdown/HTML node tree.

(c) `CLAUDE.md:595` states "`assets/karasu-mark.svg` is 2,966 bytes". The byte count
is exactly right (`wc -c` → 2966, and the unset `assetsInlineLimit` default of 4096
confirms the inlining argument). The path is not: the file is at
`src/assets/karasu-mark.svg`, and the repository has a *different*, real `assets/`
directory at the root holding `logo.png` and the screenshots — so the written path
resolves to a directory that exists and does not contain the file.

Reproduction:
The loop in (a); `ls src/components/*.tsx` for (b); `ls assets/ && ls src/assets/`
for (c).

Impact:
Orientation only. The concrete cost is that a reader told "a folder exists only when
it holds more than one file, and a command's file is its subject", handed an
enumeration of three root modules, will not expect a fourth through seventh — and
`backups.rs` in particular owns a user-facing feature with three commands and a
data-integrity role. For (c), searching `assets/` for the mark finds nothing, and
the real root `assets/` makes the miss look like a deletion rather than a typo.

Root Cause:
Modules added after the Layout section was written (`backups.rs`, `background.rs`,
`widgets.rs`, `keystore.rs` all date from the Android work); the enumerations were
not swept.

Recommended Fix:
Extend `CLAUDE.md:144` to `backups.rs · background.rs · discord.rs · i18n.rs ·
library.rs · portable.rs · sync.rs`, ideally with the one-line purpose each already
carries in its own `//!` header. Add `ErrorBoundary` and `RichText` to the line at
105-108. Correct line 595 to `src/assets/karasu-mark.svg`.

Regression Tests Required:
Not unit-testable. The comment-path linter proposed under DC-01 would catch (c);
(a) and (b) would need a doc-coverage check that is probably not worth building for
a hand-maintained map.

Confidence: HIGH

---

ID: DC-07
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src/components/KarasuMark.tsx
Line: 12
Function: `KarasuMark` doc comment

Problem:
The comment names a source-of-truth file in a directory that does not exist and has
never existed in the repository's history.

Expected Behavior:
A "source of truth is X" pointer should resolve, or should say the source lives
outside the repository.

Actual Behavior:
```
12:  * Source of truth is `design/Logo - Karasu Icon no BG.svg`, copied to
13:  * `src/assets/` so the bundle is self-contained.
```
```sh
cd /home/user/Karasu
ls -d design                        # No such file or directory
git ls-files | grep -i '^design/'   # (no output — never tracked)
```
The second half is correct: `src/assets/karasu-mark.svg` exists and is imported at
`KarasuMark.tsx:1`.

Reproduction:
The two commands above.

Impact:
Low. Anyone following the pointer to re-export the mark finds nothing and cannot
tell whether the design file was deleted, was never committed, or lives on the
maintainer's disk only. `git ls-files` shows it was never tracked, so the third is
almost certainly the case — a perfectly reasonable arrangement, just not what the
comment says.

Root Cause:
A comment written from the authoring machine's layout, where `design/` is a local
working folder outside version control.

Recommended Fix:
One clause: "Source of truth is `design/Logo - Karasu Icon no BG.svg`, kept outside
the repository and copied to `src/assets/` …". If the design file should be tracked,
that is a separate decision.

Regression Tests Required:
Covered by the comment-path linter proposed under DC-01, if built.

Confidence: HIGH

---

ID: DC-08
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/Cargo.toml
Line: 136-137 (`[target.'cfg(windows)'.dependencies]` — the `windows-future = "0.3"` entry)
Function: n/a — manifest

Problem:
`windows-future` is a direct dependency that no Rust source names, and the crate it
provides is already pulled in and re-exported by the `windows` crate declared beside
it. The comment justifying the entry states a fact about upstream crate organisation
rather than a reason for the entry.

Expected Behavior:
A direct dependency should be one the crate's own source reaches for, or one
deliberately pinned with the reason recorded — as Karasu correctly does for
`rustls`, `jni` and `tao`, each with a written "must track the version tauri's own
graph resolves to" note.

Actual Behavior:
No source file mentions the crate:
```sh
cd /home/user/Karasu/src-tauri/src
grep -rl "\bwindows_future\b" --include=*.rs . | wc -l   # 0
```
The two uses are inherent-method calls that need no import and no direct dependency
— `playback/detection/media_session/smtc.rs:55`
(`let manager = Manager::RequestAsync()?.join()?;`) and `:63`
(`.and_then(|op| op.join())`). `smtc.rs` has exactly one `use` line
(`use super::MediaSession;`).

The type carrying `join()` already arrives via the `windows` crate. `Cargo.lock`
shows `windows 0.62.2` depending on `windows-collections`, `windows-core`,
**`windows-future 0.3.2`** and `windows-numerics`, and Karasu declares
`windows = { version = "0.62", features = [... "Foundation",
"Foundation_Collections" ...] }`. Because `windows 0.62.2` already resolves
`windows-future 0.3.2` — the same version the direct entry resolves to — the entry
adds no crate and no compilation to the graph.

The manifest comment reads:
```
# The blocking `join()` on WinRT async operations lives here, not in `windows`.
```
That is true of the upstream crate split, but as a justification for a *direct*
dependency it does not say what the entry is for.

Reproduction:
The grep above; `awk '/^name = "windows"$/,/^$/' src-tauri/Cargo.lock`;
`grep -n -B3 windows-future src-tauri/Cargo.toml`.

Impact:
Essentially none at build time — cargo unifies to the same `windows-future 0.3.2`
either way. The cost is manifest clarity: a reader greps for the crate, finds
nothing, and cannot tell whether the entry is dead or subtly load-bearing. Note the
opposite risk if removed carelessly: should a future `windows` bump drop
`Foundation`'s re-export or stop depending on `windows-future`, `smtc.rs` would
break — which is a genuine argument for keeping the entry as a version-pinning
anchor, exactly as `rustls` is kept.

Verification: downgraded from P4/MEDIUM to P4/LOW — the half the conclusion rests on
cannot be established in this environment. Whether `windows`'s `Foundation` feature
enables `windows-future` with the same feature set the direct entry does, and whether
`join()` is itself feature-gated, are unverifiable here: no `windows-*` crate source
is in this container's registry (they are `cfg(windows)`-only) and there is no
network. The entry is free at build time by the finding's own arithmetic and the
recommended action is "keep it and reword the comment", so this is an observation
about manifest clarity rather than a demonstrated defect.

Root Cause:
The dependency was added when `smtc.rs` was rewritten to use the public `join()`
(per CLAUDE.md's `windows-future` lesson), at a point where reaching the type through
`windows`'s re-export may not have been checked.

Recommended Fix:
Do not remove it blind — this is `cfg(windows)` code that compiles neither on a Linux
machine nor in CI's Linux job, so a mistake here surfaces only on a Windows build.
Either:
- keep it and rewrite the comment to the pinning rationale used for `rustls` ("must
  track the version `windows`'s own graph resolves to (Cargo.lock), or the
  re-exported `IAsyncOperation` and this one are different types"), which is the
  conservative option; or
- remove it and confirm with a real Windows `cargo build` (or
  `cargo check --target x86_64-pc-windows-msvc`) that `smtc.rs:55` and `:63` still
  resolve.

Regression Tests Required:
None new. The existing Windows build in CI (`ci.yml`) is the check, and it is the only
one that can be — as CLAUDE.md notes, `npm run verify` on Linux proves nothing about
`cfg(windows)` code.

Confidence: LOW — the grep, the `Cargo.lock` dependency edge and the absence of any
`use` in `smtc.rs` are directly verified; the re-export resolution without the direct
entry is not, and cannot be here.

---

ID: DC-09
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/vite.config.ts
Line: 15
Function: `resolve.alias`

Problem:
The config uses the CommonJS global `__dirname` in an ESM package. Vite 8.2.2 detects
this and warns that it is unsupported by the config loader planned to become the
default in a future major version.

Expected Behavior:
An ESM config (`package.json:5` — `"type": "module"`) should use
`import.meta.dirname`, which works under both the current bundling loader and the
future native one.

Actual Behavior:
`vite.config.ts:15`:
```ts
      "@": path.resolve(__dirname, "src"),
```
Vite 8.2.2 ships the detector and the message. From
`node_modules/vite/dist/node/chunks/node.js`:
```js
case "dirname": return `\`__dirname\` (${loc}). Use \`import.meta.dirname\` instead`;
```
under the header "Your Vite config uses features that are unsupported by
`configLoader: 'native'`, which is planned to become the default in a future major
version of Vite". `createNativeConfigCompatPlugin` is attached to the config-load
bundle and collects globals for any file `isFilePathESM` accepts — which this one is,
so the warning does fire today. The current default remains `configLoader = "bundle"`,
which bundles the config to CJS and therefore defines `__dirname`, so nothing is
broken now. Under `configLoader: 'native'` the config is imported as real ESM, where
`__dirname` is undefined and the alias line would throw a `ReferenceError` at config
load — i.e. every `vite`, `vite build`, `vitest` and `tauri dev`/`tauri build`
invocation at once.

Reproduction:
```sh
cd /home/user/Karasu
grep -n "__dirname" vite.config.ts     # 15
node -e "console.log(require('./node_modules/vite/package.json').version)"  # 8.2.2
```

Impact:
None today; a hard build failure on a future Vite major, affecting every build entry
point simultaneously. P4 because it is a one-line forward-compatibility fix with no
behavioural change, and the warning already names the fix.

Root Cause:
Inherited from the Vite React template, which predates `import.meta.dirname`.

Recommended Fix:
Replace `__dirname` with `import.meta.dirname` at `vite.config.ts:15`. This interacts
with DC-03: `import.meta.dirname` requires Node 20.11+ (satisfied — CI pins
`node-version: 22` in both workflows), and if the file is brought into the typecheck it
will also want `@types/node`. While there, the two `// @ts-expect-error process is a
nodejs global` comments at lines 6 and 30 become removable once `@types/node` is
present; today they are unverified either way.

Regression Tests Required:
None automatable. A manual `configLoader: 'native'` run, or simply confirming
`vite build` still succeeds after the change.

Confidence: HIGH

---

ID: DC-10
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/README.md
Line: 210-222 (the keyboard-shortcuts and desktop-integration bullets)
Function: n/a

Problem:
The system-wide global hotkey — a real, implemented, user-configurable feature with
its own Tauri plugin dependency — is not mentioned anywhere in README.md.

Expected Behavior:
README enumerates desktop integrations in some detail ("An app-appropriate in-app
right-click menu, system tray, single instance, autostart") and keyboard shortcuts in
detail (Ctrl+K, `/`, Ctrl+1-3, arrows, Space, E, C). A show/hide-from-anywhere hotkey
belongs in one of those lists.

Actual Behavior:
```sh
cd /home/user/Karasu
grep -n -i "hotkey\|global shortcut" README.md    # no match
```
The feature exists and is complete:
- `src-tauri/Cargo.toml` — `tauri-plugin-global-shortcut = "2"`
- `src-tauri/src/commands/system.rs:133-158` — `GLOBAL_HOTKEY_KEY`,
  `get_global_hotkey`, `set_global_hotkey`, with the doc comment "The accelerator that
  summons (or hides) the window from anywhere, or unset for off — off by default,
  because a hotkey the user never chose that swallows a system-wide key combination is
  a bug report, not a feature."
- Both commands are registered in `src-tauri/src/lib.rs` and invoked from
  `src/pages/settings/AdvancedPane.tsx:704,751`.

Reproduction:
The grep above, then read `src-tauri/src/commands/system.rs:133-158`.

Impact:
Discoverability only — and it compounds with the feature being off by default and
living in the Advanced pane, which README describes merely as "a marked-dangerous
advanced pane". A user who wants a summon hotkey has no way to learn from the README
that Karasu has one. This is an omission, not a false claim; every README claim checked
is accurate (see Verified sound).

Root Cause:
Feature shipped without a README sweep.

Recommended Fix:
Add the hotkey to the shortcuts bullet (README.md:210-213) or the desktop-integrations
bullet (221-222), noting it is opt-in and configured in Settings → Advanced.

Regression Tests Required:
None.

Confidence: HIGH

---

ID: DC-11
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/src/api/social.ts
Line: module surface — 42 `export const` declarations, 33 of them module-internal
Function: n/a

Problem:
33 of `social.ts`'s 42 exported constants are referenced only inside `social.ts`
itself. This is harmless for the bundle and for encapsulation, but it disables the one
automated detector this repository has for a genuinely dead query constant.

Expected Behavior:
A module-internal constant should be `const`, not `export const`, so that
`noUnusedLocals` can report it when its last use disappears.

Actual Behavior:
```sh
cd /home/user/Karasu
grep -oE '^export const [A-Za-z_0-9]+' src/api/social.ts | awk '{print $3}' \
| while read c; do
    [ -z "$(grep -rlF "$c" src/ --include=*.ts --include=*.tsx | grep -v '^src/api/social.ts$')" ] \
      && echo "$c"; done | wc -l
# 33
```
Each is genuinely used — by the wrapper function defined a few lines below it in the
same file (e.g. `FOLLOW_COUNTS_QUERY` at line 246, consumed at 261). None is dead
today; the one constant a first pass flagged (`THREAD_CATEGORIES`, line 1183) is
legitimately imported by `src/pages/Forum.tsx:5` and
`src/components/overlays/NewThreadModal.tsx:6`. There is no barrel file re-exporting
`social.ts`.

Assessment of the two candidate harms:
- **Bundle size / tree-shaking: not a problem.** Rollup tree-shakes unused named
  exports from an application build, and `social.ts` is not a published package.
- **Encapsulation "leak": not a real problem either.** These are GraphQL query strings,
  not mutable state or invariant-bearing internals.
- **The real cost:** `tsconfig.json:20` sets `"noUnusedLocals": true`, which reports an
  unused *local* `const` and says nothing about an unused *exported* one. So for these
  33 constants that check is switched off. If a screen is deleted and its query becomes
  dead, nothing in `npm run verify` reports it and the query survives as a
  plausible-looking template literal. `src/api/social.ts` is 1,896 lines — exactly the
  file where silent accretion is hard to notice.

Verification: downgraded from P4/HIGH to P4/MEDIUM — the arithmetic reproduces, but the
attribution does not. Re-measured repo-wide (all non-test `.ts`/`.tsx`, counting test
files as legitimate consumers), **47** `export const` bindings across **12** files are
module-internal; a broader scan including other export kinds put it at ~154 across ~60
files. The same pattern lives in `src/api/queries.ts`, `src/hooks/usePanZoom.ts`
(`MIN_ZOOM`/`MAX_ZOOM`), `src/stores/theme.ts` (`DEFAULT_ACCENT`) and others. So this is
a uniform house style rather than a `social.ts`-specific smell, and a recommendation to
strip `export` from these 33 alone would be arbitrary — though `social.ts` is by far the
largest single concentration (33 of the 47). No dead constant was found by either pass.
The repo-scope half is filed separately as DC-17.

Reproduction:
The shell loop above.

Impact:
No runtime, bundle or correctness impact. One lost safety net in the largest API module
— an accepted-risk-level smell rather than a defect.

Root Cause:
Uniform `export const` styling applied to every top-level binding.

Recommended Fix:
Optional and low priority, and only worth doing as part of the repo-wide decision in
DC-17. Dropping `export` from the 33 would restore `noUnusedLocals` coverage over them
at zero runtime cost. If the exports are kept deliberately, the alternative is a lint
rule (see DC-17).

Regression Tests Required:
None. Verified by `npm run typecheck` continuing to pass after any `export` removals.

Confidence: MEDIUM

---

ID: DC-12
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/THIRD-PARTY-NOTICES.md
Line: 57
Function: n/a — the Rust crates section

Problem:
The documented crate count is lower than the number of packages currently in
`Cargo.lock`, in a file that explicitly claims its figures were measured rather than
estimated.

Expected Behavior:
"Facts below were read off the dependency graph, not estimated"
(THIRD-PARTY-NOTICES.md:12), with a stated reproduction command (`cargo metadata
--manifest-path src-tauri/Cargo.toml --format-version 1 --all-features`, line 20). The
number should match that command's output.

Actual Behavior:
`THIRD-PARTY-NOTICES.md:57`:
```
605 crates in the resolved graph, `--all-features` across every target — the
```
Measured against the lockfile:
```sh
grep -c '^\[\[package\]\]' /home/user/Karasu/src-tauri/Cargo.lock   # 618
```
618 versus 605 — 13 more. The direction is consistent with the Android work adding
direct dependencies since the notices were written (`tauri-plugin-deep-link`, `jni`,
`tao`, `rustls`, `webpki-roots`, plus their own subtrees).

The licence-spread claims in the same table were spot-checked and all hold: all five
named MPL-2.0 crates are present at the stated identity (`cssparser 0.36.0`,
`cssparser-macros 0.6.1`, `selectors 0.36.1`, `dtoa-short 0.3.5`, `option-ext 0.2.0`), as
are `webpki-root-certs 1.0.9` and `r-efi` (5.3.0 and 6.0.0).

Reproduction:
The `grep -c` above.

Impact:
Cosmetic. No licence obligation depends on the count — the per-licence breakdown, not
the total, is what discharges attribution, and that breakdown checks out. The value of
the number is as a tripwire for "did the graph grow in a way that changed the licence
mix", and a stale number cannot serve that.

Root Cause:
A measured total inlined in prose, refreshed only when someone re-runs `cargo metadata`.

Recommended Fix:
Re-run the documented `cargo metadata` command on a machine with network access and
update the total, re-checking the per-licence rows at the same time since that is the
part with legal weight.

Regression Tests Required:
None; a CI step re-deriving the table would be over-engineering for a file that changes
a few times a year.

Confidence: MEDIUM — `Cargo.lock`'s 618 `[[package]]` entries is directly counted, and
both `cargo metadata --all-features` (unfiltered) and `Cargo.lock` enumerate the union
across targets including the root `karasu` package, so the comparison is close to
apples-to-apples. **Missing evidence:** `cargo metadata --offline` fails in this
container (`failed to download android_system_properties v0.1.5`) and the audit forbids
network access, so the exact figure could not be produced; a small residual difference
between "lock entries" and "metadata packages" cannot be excluded.

---

ID: DC-13
Severity: P4
Category: INVESTIGATION

File: /home/user/Karasu/THIRD-PARTY-NOTICES.md
Line: 66
Function: n/a — the Rust licence-spread table

Problem:
The table records exactly one CDLA-Permissive-2.0 crate, naming `webpki-root-certs`. A
second crate from the same family — `webpki-roots` — is a direct Android dependency and
is in `Cargo.lock`, which suggests the count should be 2.

Expected Behavior:
The CDLA row should count every CDLA-licensed crate in the graph. CDLA-Permissive-2.0 is
the one non-MIT/Apache/BSD-family licence the table calls out individually, so its
accuracy is the point of the row existing.

Actual Behavior:
`THIRD-PARTY-NOTICES.md:66`:
```
| CDLA-Permissive-2.0 (`webpki-root-certs`) | 1 |
```
Both crates are in the lockfile at the same version:
```sh
cd /home/user/Karasu/src-tauri
grep -A1 '^name = "webpki-roots"$'      Cargo.lock   # version = "1.0.9"
grep -A1 '^name = "webpki-root-certs"$' Cargo.lock   # version = "1.0.9"
```
and `webpki-roots = "1"` is declared directly at `src-tauri/Cargo.toml:111` under
`[target.'cfg(target_os = "android")'.dependencies]`, used by `src-tauri/src/net.rs` for
the Android trust anchors.

Reproduction:
The two greps above, plus reading the Android dependency block in `src-tauri/Cargo.toml`.

Impact:
If confirmed, a one-line correction to an attribution table — CDLA-Permissive-2.0 is a
permissive data licence with no copyleft, so nothing beyond the notice itself is at
stake. Flagged rather than asserted because the licence could not be confirmed here.

Verification: left at P4, confidence LOW — the presence of both crates, the direct
declaration and the table's count of 1 are all directly verified; the one claim the
finding turns on, `webpki-roots`'s own `license` field, is not. The crate is Android-only
so this Linux container never fetched it (`/root/.cargo/registry` holds only
`rustls-webpki-0.103.13.crate`), and there is no network.

Root Cause:
Likely the same staleness as DC-12: `webpki-roots` became a direct dependency with the
Android work, after the notices table was measured.

Recommended Fix:
When re-running `cargo metadata` for DC-12, read the `license` field for
`webpki-roots 1.0.9` and, if it is CDLA-Permissive-2.0, change line 66 to name both
crates and read `| 2 |`.

Regression Tests Required:
None.

Confidence: LOW — exactly what is missing is `webpki-roots`'s `license` field, which
could not be read offline and is not asserted from memory.

---

ID: DC-15
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src/lib/recommend.ts
Line: 12
Function: module doc comment

Problem:
The comment points the reader at `components/RecommendedSection.tsx`; the file lives
under `src/components/media/`.

Expected Behavior:
A backtick-quoted source path in a comment should resolve on disk. This is the same
class as DC-01 and DC-07, and the three are the *only* unresolvable comment paths in the
whole tree.

Actual Behavior:
`src/lib/recommend.ts:10-12`:
```
 * All of this is pure so it can be tested without a network or a renderer;
 * the query lives in `api/queries.ts` and the rendering in
 * `components/RecommendedSection.tsx`.
```
`src/components/RecommendedSection.tsx` does not exist; the file is
`src/components/media/RecommendedSection.tsx`. The sibling reference in the same
sentence, `api/queries.ts`, resolves correctly.

Reproduction:
```sh
cd /home/user/Karasu
sed -n '10,12p' src/lib/recommend.ts
ls src/components/RecommendedSection.tsx        # No such file or directory
ls src/components/media/RecommendedSection.tsx  # exists
```

Impact:
Low, and the same shape as DC-07: a reader following the pointer finds nothing, and
`src/components/` is a real directory, so the miss reads as a deletion rather than a move.
It is filed because a comment-path sweep produced exactly three unresolvable paths and
this is the one the first-pass report mentioned only in prose — meaning a fix pass acting
on the findings alone would skip it.

Root Cause:
`RecommendedSection.tsx` moved into `components/media/` when the component folders were
organised by subject; the comment was not swept.

Recommended Fix:
Change the path to `components/media/RecommendedSection.tsx`.

Regression Tests Required:
Covered by the comment-path linter proposed under DC-01, if built — this is one of the
three paths that linter would have caught.

Confidence: HIGH
Source: found during adversarial verification

---

ID: DC-16
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/CLAUDE.md
Line: 78
Function: n/a — the Layout section

Problem:
"`pages/` one per route; `settings/` holds the eight panes" is true only as a file count.
The eight `*Pane.tsx` files no longer correspond to the eight panes, so the sentence
misdescribes the structure it is there to explain.

Expected Behavior:
Same standard as DC-06: the Layout map should describe the tree as it is. The README's
own enumeration is correct (`README.md:214-218` names account, AniList, appearance,
detection, library, desktop, import & export, advanced), so the drift is CLAUDE.md's
alone.

Actual Behavior:
`src/pages/settings/` holds exactly eight `*Pane.tsx` files — Account, Advanced, AniList,
Appearance, Content, Detection, Integrations, Library — plus `shared.tsx` and
`shared.dom.test.tsx`. The panes are defined elsewhere:
- `src/lib/settingsPanes.ts:17-26` — `PANE_IDS = ["account", "anilist", "appearance",
  "detection", "library", "desktop", "data", "advanced"]`
- `src/pages/Settings.tsx:66-120` renders one entry per id, in that order.
- There is no `DesktopPane.tsx` and no `DataPane.tsx`.
- `ContentPane.tsx` and `IntegrationsPane.tsx` now export a single section each
  (`ContentSection`, `DiscordSection`), consumed by the appearance and desktop panes at
  `Settings.tsx:34-35`; `settingsPanes.ts:35-38` records both as `PANE_ALIASES`
  (`content → appearance`, `integrations → desktop`).

So the count of eight is a coincidence of two panes having gone away as ids while their
files survived as section providers, and two new panes having been assembled from
sections that live in other files.

Reproduction:
```sh
cd /home/user/Karasu
sed -n '78p' CLAUDE.md
ls src/pages/settings/
sed -n '17,38p' src/lib/settingsPanes.ts
grep -n 'id: "' src/pages/Settings.tsx
```

Impact:
Orientation only, and narrower than DC-06 — but with a sharper edge: a reader told
"settings/ holds the eight panes" who then wants to edit the Desktop pane will look for
`DesktopPane.tsx`, not find it, and have no pointer to `Settings.tsx`'s composition table
or to `lib/settingsPanes.ts`. The alias mechanism in `settingsPanes.ts` exists precisely
because pane ids outlive reshuffles; CLAUDE.md does not mention it.

Root Cause:
The Content and Integrations panes were folded into Appearance and Desktop, and the pane
table moved to `Settings.tsx` with the ids extracted to `lib/settingsPanes.ts`; the
one-line Layout description was not swept. Same mechanism as DC-06.

Recommended Fix:
Restate line 78 to describe the actual arrangement — the pane ids and their order live in
`lib/settingsPanes.ts` (with aliases for panes that were merged away), `pages/Settings.tsx`
composes each pane from sections, and `settings/*Pane.tsx` supplies those sections rather
than mapping one-to-one to panes.

Regression Tests Required:
Not unit-testable. A cheap partial guard already exists in spirit: `lib/settingsPanes.ts`
is the testable half by design, so an assertion that `PANE_IDS.length === 8` would at
least pin the number CLAUDE.md quotes.

Confidence: HIGH
Source: found during adversarial verification

---

ID: DC-17
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/package.json
Line: 11 (`"typecheck": "tsc --noEmit"`) / tsconfig.json:20 (`"noUnusedLocals"`)
Function: n/a — the verification gate

Problem:
Nothing in `npm run verify` can detect an unused *export*. `noUnusedLocals` sees only
local bindings, and the repository's uniform `export const` house style puts a large
fraction of its module-level constants outside that check — repo-wide, not in one file.

Expected Behavior:
Either the house style keeps module-internal bindings unexported so `noUnusedLocals`
covers them, or the gate carries a detector that understands exports. Today it is neither,
so a constant whose last consumer is deleted survives silently.

Actual Behavior:
Re-measured across all non-test `.ts`/`.tsx` under `src/`, counting test files as
legitimate consumers, **47** `export const` bindings in **12** files are referenced by no
other module:

```
33  src/api/social.ts
 3  src/api/queries.ts
 2  src/hooks/usePanZoom.ts
 1  src/stores/theme.ts
 1  src/lib/tags.ts
 1  src/lib/syncQueue.ts
 1  src/lib/statusColors.ts
 1  src/lib/scoreFormat.ts
 …
```

Excluding test files as consumers, the same scan reports 69 across 25 files (adding
`src/lib/settingsPanes.ts`, `src/lib/motion.ts`, `src/components/list/columns.ts`,
`src/lib/threadJump.ts`, `src/lib/franchiseLayout.ts` and others); a broader verification
scan covering other export kinds put the figure at ~154 across ~60 files. The repository
runs no `eslint`, no `knip` and no equivalent — `package.json`'s scripts are `dev`, `build`,
`typecheck`, `test`, `verify`, `tauri` and the bump script.

Reproduction:
```sh
cd /home/user/Karasu
src=$(find src -name '*.ts' -o -name '*.tsx')
files=$(find src -name '*.ts' -o -name '*.tsx' | grep -v '\.test\.')
for f in $files; do
  for c in $(grep -oE '^export const [A-Za-z_0-9]+' "$f" | awk '{print $3}'); do
    [ "$(grep -rlF -- "$c" $src | grep -v "^$f$" | wc -l)" -eq 0 ] && echo "$f $c"
  done
done | wc -l    # 47
```

Impact:
No runtime, bundle or correctness impact — Rollup tree-shakes unused named exports out of
the application build. The cost is a missing safety net, and it is repo-wide: if DC-11 is
acted on as written, the "restored" `noUnusedLocals` coverage would apply to one file out
of twelve (or sixty, by the broader count), leaving the same hole everywhere else. This
finding exists so that the decision is taken once, at repo scope, rather than by trimming
the single file the arithmetic happened to surface.

Root Cause:
A uniform `export const` style plus a gate that has no export-aware detector. Neither is a
mistake on its own; together they remove the check.

Recommended Fix:
Pick one policy and apply it uniformly:
- add a dead-export detector to `npm run verify` (`knip` is the smallest thing that does
  this for a Vite/TS app; an eslint config with `unused-imports` is the other route), and
  keep the export style as it is; or
- drop `export` from module-internal bindings across the tree, which restores
  `noUnusedLocals` coverage at zero runtime cost and adds no tooling.
The first is the better fit for a repository whose gate is deliberately "typecheck +
vitest + cargo test" and short-circuits; the second adds nothing to install but has to be
re-applied by hand every time a constant stops being shared.

Regression Tests Required:
Whichever route is taken, prove it: delete the last consumer of one exported constant in a
scratch commit and confirm the gate now fails. A detector added without that check can
silently be scoped to the wrong globs.

Confidence: HIGH
Source: found during adversarial verification

---

ID: DC-18
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/tsconfig.node.json
Line: 1-9
Function: n/a — the referenced project for `vite.config.ts`

Problem:
`tsconfig.node.json` sets no `"strict"`. It is the config that would govern
`vite.config.ts` if DC-03 were fixed by the `tsc -b` route, so that fix would pull the
file into a *non-strict* compilation while looking like a fix.

Expected Behavior:
Both halves of a split tsconfig should apply the same baseline, or the difference should
be deliberate and written down. `tsconfig.json:18-21` sets `strict`, `noUnusedLocals`,
`noUnusedParameters` and `noFallthroughCasesInSwitch` — a strong baseline the sibling
config does not share.

Actual Behavior:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```
No `strict`, so `strictNullChecks`, `noImplicitAny` and the rest default off. Because
plain `tsc --noEmit` never follows the reference (DC-03), this has no effect today — which
is exactly why it is easy to miss when the reference is finally honoured.

Reproduction:
```sh
cd /home/user/Karasu
cat tsconfig.node.json
grep -n '"strict"' tsconfig.json tsconfig.node.json
```

Impact:
None today. It becomes a real weakness the moment DC-03 is fixed by switching the script
to `tsc -b`: the gate would report success over a `vite.config.ts` checked far more weakly
than every file under `src/`, and the two `@ts-expect-error` directives at
`vite.config.ts:6,30` would remain unverifiable for a different reason than before. Filed
so the two changes are made together.

Root Cause:
Inherited from the Vite React template, which ships the node-side config without `strict`
and was never revisited because the reference is inert.

Recommended Fix:
Add `"strict": true` (and, if the `tsc -b` route is taken for DC-03, `@types/node`) to
`tsconfig.node.json` in the same commit that makes the reference live. If instead DC-03 is
fixed by widening the root `include`, delete `tsconfig.node.json` and its `references`
entry outright rather than leaving an unused config that reads as authoritative.

Regression Tests Required:
Same as DC-03: introduce a deliberate strict-mode violation (e.g. an implicitly-`any`
parameter) in `vite.config.ts` and confirm `npm run typecheck` fails.

Confidence: HIGH
Source: found during adversarial verification

---

## Verified sound

Scenarios and claims checked that **are** correct, with the guard or artefact that makes
them so. These are not findings; they are the audit's coverage map — and for the dead-code
half, they are the substance of the result, since almost nothing was found.

### Dead code — Rust

- **All 110 registered commands are invoked from the frontend.** *Method:* extracted the
  `generate_handler!` block (`src-tauri/src/lib.rs:414-525`) → 110 names, no duplicates;
  matched each as a literal string in `src/**/*.ts{,x}`. Zero registered-but-uninvoked,
  zero invoked-but-unregistered. Re-run independently during verification with the same
  result. (One false positive in a first pass, `get_library_episodes`, was a regex failing
  on the nested generic in `invoke<Record<number, number[]>>(...)` at
  `src/api/library.ts:88`; a literal-string match is clean.)
- **No function has only `cfg(test)` callers.** *Method:* whole-tree scan of every `fn`
  definition against every non-doc-comment reference, with `#[cfg(test)]` mod regions
  excluded from the reference side — which is what distinguishes release reachability from
  test reachability. None found. The class CLAUDE.md warns about is instead handled
  properly and pervasively by `#[cfg_attr(<inverse platform>, allow(dead_code))]`, present
  in all twelve places it occurs: `diagnostics.rs:77` (`parse_os_release`, the named
  example, already annotated), `portable.rs:27`, `i18n.rs:54,68`,
  `playback/detection/media_session/mod.rs:41,229`, `widgets.rs:169`, and
  `keystore.rs:31,35,45,57,84`.
- **`cargo check --offline` on the Linux target completes with zero warnings**, which
  independently supports the no-dead-Rust result for everything not behind a Windows or
  Android cfg. The gated code was resolved by reading its call sites, as noted in Scope.
- **The one zero-reference `pub fn` is a live JNI entry point, not dead code.**
  `src-tauri/src/background.rs:173`,
  `pub extern "system" fn Java_dev_kyu_karasu_KarasuNative_backgroundNotifCheck`. *Method:*
  it has no Rust caller by construction; its caller is Kotlin's `NotifJobService`, and it
  survives minification through the proguard keep CLAUDE.md records as load-bearing. Grep
  count alone would have called it dead.
- **Every direct Cargo dependency is used.** `percent_encoding`, `base64`, `getrandom`,
  `regex`, `discord_rich_presence`, `tauri_winrt_notification`, `notify_rust`, `zbus`,
  `chacha20poly1305`, `keyring`, `jni`, `tao`, `rustls`, `webpki_roots`, `reqwest`,
  `tokio`, `rusqlite`, `serde_json` all resolve to at least one Rust file. The single
  exception is `windows-future` (DC-08), and even that is *functionally* used via a
  re-export.

### Dead code — frontend

- **Every frontend module is imported.** *Method:* resolved every relative and `@/` import
  across 316 `.ts`/`.tsx` files. The only modules not imported by another module are
  `src/app/main.tsx` (the entry point, referenced by `index.html`) and
  `src/app/vite-env.d.ts` (ambient). Zero unresolved import specifiers — no broken paths.
- **All 22 hooks are live and all 22 are documented.** `src/hooks/` holds exactly 22
  non-test modules, and CLAUDE.md's parenthetical list names exactly those 22.
- **No genuinely dead exported constant in `src/api/social.ts`.** The one candidate,
  `THREAD_CATEGORIES` (line 1183), is imported by `src/pages/Forum.tsx:5` and
  `src/components/overlays/NewThreadModal.tsx:6`. DC-11 and DC-17 are about the missing
  *detector*, not about a dead constant.
- **No unreferenced assets.** `public/favicon.png` → `index.html:5`; `assets/logo.png` and
  all eleven `assets/screenshots/*.jpg` → `README.md`; `src/assets/karasu-mark.svg` →
  `src/components/KarasuMark.tsx:1`.
- **No live `TODO`, `FIXME`, `HACK` or `XXX` marker** in `src/`, `src-tauri/src/` or
  `scripts/`. The single grep hit is `src-tauri/src/portable.rs:36`, which describes an
  AppImage mount path (`/tmp/.mount_XXXX`) in prose — a false positive of the pattern, not
  a marker.
- **No NUL bytes and no mojibake in any of 364 source files.** Both classes are ones
  CLAUDE.md records as having cost real time. The NUL scan was validated against a
  known-NUL fixture before being trusted; the only `Ã` in the tree is inside CLAUDE.md's
  own sentence documenting the lesson.

### npm dependencies

- **All 22 production dependencies are referenced.** Notably `@fontsource/sn-pro` and
  `@fontsource/kosugi-maru` are **required — for their font files, not their stylesheets**,
  exactly as CLAUDE.md describes. The mechanism is `src/app/index.css:34` and `:43`, whose
  `@font-face { src: url(...) }` point straight at
  `@fontsource/sn-pro/files/sn-pro-latin-400-normal.woff2` and
  `@fontsource/kosugi-maru/files/kosugi-maru-japanese-400-normal.woff2`; Vite resolves those
  through `node_modules` at build time. No fontsource stylesheet is imported anywhere
  (`src/app/main.tsx:13` says so explicitly). Removing either package would break the CSS
  build.
- **CLAUDE.md's font arithmetic is exact.** `kosugi-maru-japanese-400-normal.woff` is
  1,876,732 B to the byte; the woff2 actually used is 1,437,604 B (the "1.44 MB"); `du -sh`
  on `@fontsource/kosugi-maru/files` is 7.9 M, matching the corrected note that the old
  7.9 MB figure was the whole directory.
- **`package-lock.json` is in sync with `package.json`** for the thing that matters:
  `dependencies` (22) and `devDependencies` (12) are byte-identical between the two,
  `lockfileVersion` is 3, and `npm ci` succeeded in this environment. Only the root
  `version` field diverges (DC-02).
- **Duplicate versions are confined to build/test trees.** Just two packages resolve at more
  than one version — `lightningcss` (1.32.0 at the root via `tailwindcss`, 1.33.0 nested
  under `vite`) and `whatwg-url` (17.1.0 root, 16.0.1 nested under `data-urls`, both
  `dev: true` via jsdom). Only `whatwg-url` differs in **major**, and it is dev-only.
  Neither reaches the shipped bundle.
- **Licence spread is permissive and correctly documented.** Installed tree: MIT 115, ISC 15,
  Apache-2.0 8, Apache-2.0 OR MIT 3, MIT OR Apache-2.0 2, BSD-3-Clause 2, MIT-0 2,
  BSD-2-Clause 2, MPL-2.0 2, CC0-1.0 1, BlueOak-1.0.0 1, OFL-1.1 1.
  `THIRD-PARTY-NOTICES.md:95-97` states "MIT (117), ISC (15), Apache-2.0 (8), and
  single-digit counts of MIT-0, BSD-2-Clause, BSD-3-Clause, MPL-2.0, BlueOak-1.0.0 and
  CC0-1.0" — a match, with the MIT delta of 2 explained by platform-specific optional
  binaries differing between a Windows machine and this Linux container. The MPL-2.0 claim
  ("`lightningcss` and its Windows binary … not in the shipped bundle — their output is, and
  minified CSS is not a derivative of the minifier") is correct reasoning and correct
  arithmetic.
- **Vulnerable versions: no CVE is known to affect any pinned dependency in this tree, and
  none is invented here.** The stack is deliberately current (React 19.2.8, Vite 8.2.2,
  TypeScript 7.0.2, vitest 4.1.11, reqwest 0.13, rusqlite 0.40, tauri 2). This is an explicit
  "none known", not a clean bill of health: a real check needs `npm audit` and `cargo audit`
  against a live advisory database, which this audit's no-network rule forbids.

### Documentation — DOC-CLAIMS TABLE

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1 | NSIS `/UPDATE` flag skips the uninstall page; Karasu's updater passes `/P /R /UPDATE` (README.md:247-257) | **VERIFIED** | `tauri.conf.json` `plugins.updater.windows.installMode: "passive"` → tauri-plugin-updater 2.10.1 `config.rs:41` `Passive => &["/P", "/R"]`, chained with `/UPDATE` at `updater.rs:812`. Exact match. |
| 2 | Windows installs for the current user only, into `%LOCALAPPDATA%`, no UAC (README.md:244-245) | **VERIFIED** | `bundle.windows.nsis` sets no `installMode`; `tauri-utils/src/config.rs:828-829` marks `NSISInstallerMode::CurrentUser` as `#[default]`. |
| 3 | Bundle targets are NSIS + AppImage (README.md:318) | **VERIFIED** | `tauri.conf.json` `bundle.targets = ["nsis", "appimage"]`. |
| 4 | MAL XML export and JSON backup | **VERIFIED** | `src/lib/malExport.ts` (`buildMalXml`, `buildJsonExport`), imported at `src/pages/settings/AdvancedPane.tsx:12`; re-import via `src/lib/malImport.ts`, `src/lib/jsonImport.ts`. |
| 5 | iCal export | **VERIFIED** | `src/lib/ical.ts` exports `buildIcs`; consumed at `src/pages/Calendar.tsx:8`. |
| 6 | Command palette on Ctrl+K (README.md:211) | **VERIFIED** | `src/components/shell/CommandPalette.tsx:72` — `(e.ctrlKey \|\| e.metaKey) && e.key.toLowerCase() === "k"`, with the `data-overlay` guard at :80. `/` and Ctrl+1-3 live in `GlobalKeys.tsx:38,46`. |
| 7 | Wrapped: five crops, PNG or JPEG, 1×/2×/3× (README.md:167-169) | **VERIFIED** | `src/pages/Wrapped.tsx:69-74` — exactly five presets (`banner`, `square`, `page`, `compressed`, `detailed`); `:933` offers `["png","jpeg"]`; `:949` offers `[1, 2, 3]`. |
| 8 | Covers per row, typed number 1-40 (README.md:190-191) | **VERIFIED** | `src/stores/theme.ts:44-45` — `COVER_COLS_MIN = 1`, `COVER_COLS_MAX = 40`, clamped at :47 and bound to the input at `AppearancePane.tsx:92-93`. |
| 9 | Settings in eight panes, named individually (README.md:214-218) | **VERIFIED** | README names account, AniList, appearance, detection, library, desktop, import & export, advanced — matching `src/lib/settingsPanes.ts:17-26` and `src/pages/Settings.tsx:66-120` exactly. (CLAUDE.md:78's version of the same claim is **DIVERGENT** — see DC-16.) |
| 10 | Four Android home-screen widgets (README.md:290-292) | **VERIFIED** | Four metadata files — `res/xml/widget_{airing,reading,watching,week}.xml` — plus `res/layout/karasu_widget.xml` and the `widgets.rs:1-5` projection ("Android's four widgets (Airing Today, Continue Watching, Continue Reading, Weekly Calendar)"). |
| 11 | Sharing an anilist.co link from a browser opens it in Karasu (README.md:292-293) | **VERIFIED** | `AndroidManifest.xml:90-94` — a hand-added `SEND` / `text/plain` intent-filter, deliberately placed **outside** the auto-generated deep-link markers exactly as CLAUDE.md requires (comment at :85-89). |
| 12 | Phone shell keyed on width, 767px (README.md:286-287) | **VERIFIED** | `src/hooks/usePhoneShell.ts:22` — `const QUERY = "(max-width: 767px)"`. |
| 13 | Autostart, tray, single instance (README.md:221-222) | **VERIFIED** | `get_autostart`/`set_autostart` at `commands/system.rs:615-621`; the four desktop plugins attached in the `#[cfg(desktop)] fn attach_desktop` cfg'd pair in `lib.rs`. |
| 14 | Global hotkey | **DIVERGENT (omission)** | Implemented (`commands/system.rs:133-158`, invoked at `AdvancedPane.tsx:704,751`) but absent from README — see DC-10. |
| 15 | Root vs bundled `THIRD-PARTY-NOTICES.md` | **VERIFIED — no drift** | `diff THIRD-PARTY-NOTICES.md src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md` → exit 0, zero lines. The pair CLAUDE.md warns "drifts silently" is currently identical. |
| 16 | Font licences and full texts | **VERIFIED** | SN Pro = OFL-1.1 and Kosugi Maru = Apache-2.0 in both `package-lock.json` and each package's own `package.json`; both named at notices lines 34-35 and 92-93 with full licence texts reproduced from line 130. |
| 17 | Direct production npm dependency table | **DIVERGENT** | 21 of 22 listed — see DC-04. |
| 18 | "605 crates in the resolved graph" | **DIVERGENT** | `Cargo.lock` holds 618 `[[package]]` entries — see DC-12. |
| 19 | Five MPL-2.0 crates named individually (notices:71-74) | **VERIFIED** | `cssparser 0.36.0`, `cssparser-macros 0.6.1`, `selectors 0.36.1`, `dtoa-short 0.3.5`, `option-ext 0.2.0` all present in `Cargo.lock`. `r-efi` (5.3.0, 6.0.0) present as claimed at notices:68. |
| 20 | CDLA-Permissive-2.0 count of 1 | **UNRESOLVED** | Both `webpki-roots` and `webpki-root-certs` are in `Cargo.lock` at 1.0.9; the licence of the former could not be read offline — see DC-13. |
| 21 | SECURITY.md per-platform token storage | **VERIFIED** | Desktop keyring → `auth.rs:19-56` under `#[cfg(any(windows, target_os = "linux"))]`; Android Keystore `KRSA1 \|\| iv \|\| ct` → `auth.rs:163-256` + `keystore.rs`; portable DPAPI → `auth.rs:316-388`; portable XChaCha20-Poly1305 `KRSU1` → `auth.rs:465-559`. **The iOS plain-file path is explicitly documented** at SECURITY.md:24-25 ("iOS, which is neither compiled nor shipped, would still use a plain file") and matches `auth.rs:258-276`, the `#[cfg(all(mobile, not(target_os = "android")))]` arm that does a bare `std::fs::write(path, token.as_bytes())`. Nothing here diverges. |
| 22 | CLAUDE.md: schema is at v17 | **VERIFIED** | `db.rs:354-358` — `MIGRATION_V17` with `PRAGMA user_version = 17`, applied at `db.rs:617`. |
| 23 | CLAUDE.md: 95 of 110 commands in `commands/`, 15 in `library.rs` | **VERIFIED exactly** | `#[tauri::command]` counts — auth 9, images 1, list 14, playback 18, prefs 15, system 29, update 9 = **95**; `library.rs` = **15**; total **110**, matching the handler block. |
| 24 | CLAUDE.md: i18n key parity via `de: typeof en` | **VERIFIED** | `de.ts:7` — `export const de: typeof en = {`. Both files are 1,557 lines; a structural key-path walk yields 1,308 paths on each side with an empty symmetric difference. |
| 25 | CLAUDE.md: `karasu-mark.svg` is 2,966 B, under Vite's 4,096 B inline limit | **VERIFIED** (byte count and reasoning; the *path* is wrong — DC-06c) | `wc -c src/assets/karasu-mark.svg` → 2966; `assetsInlineLimit` is unset in `vite.config.ts`, so Vite's 4096 default applies and the file inlines as a `data:` URI — which is what makes the `img-src data:` CSP entry load-bearing. |
| 26 | CLAUDE.md: `settings/` holds the eight panes | **DIVERGENT** | Eight `*Pane.tsx` files, but no `DesktopPane.tsx`/`DataPane.tsx`, and two files now supply single sections to other panes — see DC-16. |
| 27 | CLAUDE.md: root Rust modules are `discord.rs · library.rs · portable.rs` | **DIVERGENT** | Four more root modules exist and are named nowhere — see DC-06a. |
| 28 | `anilistMarkdown.ts`: rendered under a null CSP, no jsdom, `lib/description.ts` is the sanitizer path | **DIVERGENT (three ways)** | A full production `csp` at `tauri.conf.json:26`; jsdom and Testing Library in `package.json`; `lib/description.ts` deleted — see DC-01 and DC-14. |

### CHANGELOG spot-checks (nine Unreleased entries, all VERIFIED)

1. "Queued offline edits can no longer land on a different account" → `MIGRATION_V16` at
   `db.rs:324-329` adds `user_id` to `offline_queue`; the rationale is recorded at
   `db.rs:794`.
2. "Ctrl+K no longer opens the command palette behind an open editor" →
   `CommandPalette.tsx:73-80`, with the `!open` subtlety spelled out so Ctrl+K-to-close
   still works.
3. "An update check that fails no longer burns the once-a-day throttle" →
   `commands/update.rs` writes `last_update_check_ms` *after* the request returns, with the
   comment "The throttle is written here, not before the request".
4. "…and the request has a timeout like every other one in the app" →
   `.timeout(std::time::Duration::from_secs(30))` on the `net::client_builder()` in the same
   function.
5. "The Stable update channel no longer claims you are up to date" → the 404 branch and the
   `channel_empty` field on `UpdateInfo` in `commands/update.rs`, with
   `update_channel_manifest_url` distinguishing the two channels at :100-104.
6. "Turning airing notifications off no longer arms them" → `alerts/airing.rs:154-160` — when
   `airing_notify == "0"` it still advances `airing_last_check` to now, so re-enabling cannot
   replay the gap.
7. "A daily backup that was truncated … is checked and rewritten" → `backups.rs:77-79` uses
   SQLite `quick_check` explicitly to catch "a truncated or half-written snapshot", with :111
   recording that presence used to be the whole test.
8. "A library scan can no longer wipe the index because the drive was offline" →
   `library.rs:449` and the test at :1874 both name the offline-NAS case.
9. "On Linux, an update is only offered to a running AppImage" → `commands/update.rs:512-529`
   plus the `can_install(true, true)` assertion at :343.

### Other documentation checks

- **No stale dependency-capability claims of the `windows-future` kind survive in Rust.**
  `smtc.rs:9-10` has been corrected and now reads "windows-future 0.3 exposes publicly. This
  used to hand-roll a 500 ms poll", with the live `.join()` calls at :55 and :63. A systematic
  grep for "is private" / "cannot be called" / "does not expose" style assertions across
  `src/` and `src-tauri/src/` surfaced no other decayed claim — the only instance of the class
  in the whole tree is the jsdom assertion in DC-01.
- **Comment file-path sweep.** Of every backtick-quoted source path in a comment across
  `src/`, `src-tauri/src/` and `scripts/`, exactly three do not resolve: `lib/description.ts`
  (DC-01), `design/Logo - Karasu Icon no BG.svg` (DC-07) and `components/RecommendedSection.tsx`
  at `src/lib/recommend.ts:12` (DC-15). A fourth candidate, `ui/loader.tsx` at
  `src/app/index.css:416`, is a resolver false positive: the file exists at
  `src/components/ui/loader.tsx`.

### Config

- **The `dom`/`node` vitest split is wired as documented** — `vite.config.ts:47-70`, `node`
  including `src/**/*.test.{ts,tsx}` and excluding `src/**/*.dom.test.tsx`, `dom` including
  only the latter with `setupFiles: ["./vitest.setup.ts"]`. 68 node files, 18 dom files.
- **`tsconfig.json` sets `strict`, `noUnusedLocals`, `noUnusedParameters` and
  `noFallthroughCasesInSwitch`** (lines 18-21) — a strong baseline; the gaps are only in which
  files it is pointed at (DC-03), what it cannot see (DC-17) and what its sibling config omits
  (DC-18).

## Refuted during verification

No finding was refuted. All thirteen first-pass findings survived independent re-derivation;
four had their severity or confidence corrected (DC-02, DC-03, DC-08, DC-11), each carrying a
`Verification:` line in place.

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 2 |
| P4 | 16 |
| Refuted | 0 |
| **Total findings** | **18** |

Five of the eighteen (DC-14 through DC-18) were raised during adversarial verification of the
first-pass report rather than by the first pass itself.
