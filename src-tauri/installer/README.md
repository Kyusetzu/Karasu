# Installer branding

Two images the NSIS installer draws, referenced from `bundle.windows.nsis` in
`tauri.conf.json`. They are committed rather than generated at build time: the
bundler wants them on disk, and adding a build-time image step for two files
that change roughly never is a toolchain nobody would remember to keep working.

| File | Size | Where it appears |
|---|---|---|
| `header.bmp` | 150 × 57 | The strip at the top of every wizard page |
| `sidebar.bmp` | 164 × 314 | The panel on the Welcome and Finish pages only |

`header.bmp` is set twice — as `headerImage` *and* `uninstallerHeaderImage`.
Setting only the first still enables `MUI_HEADERIMAGE` globally, so the
uninstaller's pages would carry MUI's stock bitmap next to Karasu's own.

**Both are 24-bit BMP, and that is not negotiable.** NSIS rejects PNG outright,
and a 32-bit BMP's alpha channel fringes black against the installer's own
background — which is why the mark is flattened onto a solid colour here rather
than left transparent.

The colour is `#0b0d12`, which is both `--color-surface-950` and the app's
window background, so the installer reads as the same program that is about to
open.

The sidebar image is only ever seen on the Welcome and Finish pages, and passive
mode (`/P`) skips both. It will therefore never appear during an auto-update, by
construction — the in-app updater passes `/P /R /UPDATE`.

## Regenerating

From the repository root, with Pillow installed:

```python
from PIL import Image

BG = (0x0b, 0x0d, 0x12)
src = Image.open("src-tauri/icons/icon.png").convert("RGBA")   # 512x512 RGBA

def compose(w, h, mark, out):
    canvas = Image.new("RGB", (w, h), BG)
    scaled = src.resize((mark, mark), Image.LANCZOS)
    canvas.paste(scaled, ((w - mark) // 2, (h - mark) // 2), scaled)
    canvas.save(out, "BMP")

compose(150, 57, 44, "src-tauri/installer/header.bmp")
compose(164, 314, 120, "src-tauri/installer/sidebar.bmp")
```

The mark is centred both ways in each canvas. Anchoring by a corner is what once
left 52% of the bird outside the Wrapped poster; the same rule applies here.
