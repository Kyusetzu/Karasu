# Third-party notices

Karasu is MIT-licensed (see [LICENSE](LICENSE)). The installers, the AppImage
and the Android APK carry third-party components whose licences travel with
them, and this file is where they travel. It covers what a **shipped build** contains, not what
a development checkout does.

Two of these are here because their licences require it rather than as a
courtesy: the fonts embedded in the frontend bundle. Everything else is
attribution.

Facts below were read off the dependency graph, not estimated. To reproduce:

```bash
npm ls --all --json
```

```bash
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 --all-features
```

Neither command can see the section on data fetched at runtime, which is why
that section exists: a dataset the app downloads on first run is in no
manifest, so nothing here would have caught its absence.

---

## Fonts

Both are embedded as `woff2` in the frontend bundle, so they are redistributed
with every installer, AppImage and APK, and with every desktop auto-update —
Android has no auto-update, so there they travel only with each new APK. Their full licence texts are
reproduced at the end of this file, which is what OFL-1.1 §2 and Apache-2.0
§4(a) ask for when a font is bundled with software.

| Font | Used for | Licence |
| --- | --- | --- |
| **SN Pro** — `@fontsource/sn-pro`, latin 400 | the whole interface | [OFL-1.1](#sil-open-font-license-11--sn-pro) |
| **Kosugi Maru** — `@fontsource/kosugi-maru`, japanese 400 | `title.native`, wherever a Japanese title is shown | [Apache-2.0](#apache-license-20--kosugi-maru) |

Copyright 2024 The SN Pro Project Authors (https://github.com/supernotes/sn-pro)

Copyright 2010 The Kosugi Maru Project Authors (https://github.com/googlefonts/kosugi-maru)

Neither font is modified. Only the subset Karasu actually renders is shipped —
see the `@font-face` block in `src/app/index.css` and the note above it for why
the subsets are picked by hand.

## SQLite

The local database is SQLite, compiled into the binary through `rusqlite`'s
`bundled` feature. SQLite is **public domain**:

> The author disclaims copyright to this source code. In place of a legal
> notice, here is a blessing: May you do good and not evil.

<https://www.sqlite.org/copyright.html>

## Data fetched at runtime

Not shipped in any build — downloaded on first use and cached beside the
database — but incorporated into what the app does, and so listed here for the
same reason the bundled components are. It is also the one entry the two
commands above structurally cannot report: it appears in no manifest.

| Data | Used for | Licence |
| --- | --- | --- |
| **anime-relations** — [erengy/anime-relations](https://github.com/erengy/anime-relations), `anime-relations.txt` | redirecting an episode number to the AniList entry it really belongs to — a continuously numbered release of a split-cour show, and specials | [CC0-1.0](https://github.com/erengy/anime-relations/blob/master/LICENSE) |

CC0 waives copyright rather than imposing conditions, so nothing is owed. The
row is a courtesy: it is the same dataset Taiga uses, it is what makes episode
25 of a combined release land on the sequel's episode 1, and a user reading
this file should be able to find out where that behaviour comes from. The
fetch itself is in `src-tauri/src/playback/relations.rs`, cached for seven
days.

## Rust crates

605 crates in the resolved graph, `--all-features` across every target — the
superset of what a Windows and a Linux build each link. The licence spread:

| Licence | Crates |
| --- | --- |
| MIT and/or Apache-2.0 (in some spelling) | ~525 |
| Unicode-3.0 (the ICU family, via `url`/`idna`) | 18 |
| Zlib / BSD-2 / BSD-3 / 0BSD / Unlicense / ISC, each dual-licensed with MIT or Apache-2.0 | ~55 |
| MPL-2.0 | 5 |
| CDLA-Permissive-2.0 (`webpki-root-certs`) | 1 |

**No GPL, and no LGPL-only crate.** `r-efi` offers LGPL-2.1-or-later as one of
three options; MIT is taken.

The five MPL-2.0 crates are called out because MPL-2.0 is file-level copyleft
and asks that recipients be told where the source is. None of them is modified
here, and all are published on crates.io:

- `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` — <https://github.com/servo/rust-cssparser>, <https://github.com/servo/stylo>
- `option-ext` — <https://github.com/soc/option-ext>

## npm packages

The frontend bundle is built from the packages in `package.json`. Direct
production dependencies:

| Package | Licence |
| --- | --- |
| react, react-dom, react-router | MIT |
| @tanstack/react-query, @tanstack/react-virtual | MIT |
| zustand, i18next, react-i18next | MIT |
| tailwindcss, @tailwindcss/vite, tailwind-merge, clsx | MIT |
| class-variance-authority | Apache-2.0 |
| d3-array, d3-scale, d3-shape, lucide-react | ISC |
| @tauri-apps/api, @tauri-apps/plugin-opener, @tauri-apps/plugin-deep-link | MIT or Apache-2.0 |
| @fontsource/sn-pro | OFL-1.1 |
| @fontsource/kosugi-maru | Apache-2.0 |

Across the whole installed tree the spread is MIT (117), ISC (15), Apache-2.0
(8), and single-digit counts of MIT-0, BSD-2-Clause, BSD-3-Clause, MPL-2.0,
BlueOak-1.0.0 and CC0-1.0.

The two MPL-2.0 entries are `lightningcss` and its Windows binary, which
Tailwind v4 uses to minify CSS **at build time**. They are not in the shipped
bundle — their output is, and minified CSS is not a derivative of the minifier.

## Licence texts

Most of the above is MIT or Apache-2.0. Each package carries its own copyright
holder in its own `LICENSE`/`package.json`; the two texts themselves follow.

### The MIT License

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### SIL Open Font License 1.1 — SN Pro

```
Copyright 2024 The SN Pro Project Authors (https://github.com/supernotes/sn-pro) SNPro-Italic[wght].ttf: Copyright 2024 The SN Pro Project Authors (https://github.com/supernotes/sn-pro)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Apache License 2.0 — Kosugi Maru

Also the text for every Apache-2.0 crate and package listed above.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2010 The Kosugi Maru Project Authors (https://github.com/googlefonts/kosugi-maru)

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
