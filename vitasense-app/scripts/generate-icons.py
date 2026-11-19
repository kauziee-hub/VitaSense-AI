"""Builds every app icon from the VitaSense mark via headless Chrome renders.

Usage (from vitasense-app/): python scripts/generate-icons.py assets
Needs Google Chrome installed; edit CHROME in render-html.mjs for another path.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

here = Path(tempfile.mkdtemp(prefix="vitasense-icons-"))
assets = Path(sys.argv[1])
render = Path(__file__).parent / "render-html.mjs"

# The VitaSense mark: two leaves (sky and mint) that meet in a "V", with a white "sense" dot above,
# on a near-black tile. Same geometry as src/shell/Logo.tsx (64-unit grid).
LEAF_LEFT = "M12.5 20.5 C12 34 21 44.5 32 49.5 C32.5 36 24 24.5 12.5 20.5 Z"
LEAF_RIGHT = "M51.5 20.5 C52 34 43 44.5 32 49.5 C31.5 36 40 24.5 51.5 20.5 Z"
SKY, MINT, TILE = "#B7DFEC", "#C9EBC6", "#111111"

TILE_DEFS = ""
GLYPH_DEFS = ""


def glyph(mono: bool = False) -> str:
    left = "#FFFFFF" if mono else SKY
    right = "#FFFFFF" if mono else MINT
    # A hairline stroke in the same colour softens the leaf tips.
    return (
        f'<path d="{LEAF_LEFT}" fill="{left}" stroke="{left}" stroke-width="1.1" stroke-linejoin="round"/>'
        f'<path d="{LEAF_RIGHT}" fill="{right}" stroke="{right}" stroke-width="1.1" stroke-linejoin="round"/>'
        '<circle cx="32" cy="22" r="4.6" fill="#FFFFFF"/>'
    )


def svg(content: str, *, view: str = "0 0 64 64", defs: str = "") -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="100%" height="100%"><defs>{defs}</defs>{content}</svg>'


def page(name: str, body: str, size: int, transparent: bool = True) -> None:
    html = here / f"{name}.html"
    html.write_text(
        f'<!doctype html><html><head><style>html,body{{margin:0;width:{size}px;height:{size}px;overflow:hidden;background:transparent}}</style></head><body>{body}</body></html>',
        encoding="utf-8",
    )
    out = assets / "images" / f"{name}.png"
    subprocess.run(["node", str(render), str(html), str(out), str(size), str(size), "transparent" if transparent else "opaque"], check=True)


square_tile = f'<rect width="64" height="64" fill="{TILE}"/>'
rounded_tile = f'<rect width="64" height="64" rx="18" fill="{TILE}"/>'

# iOS / store icon: full bleed square, the OS rounds the corners.
page("icon", svg(square_tile + glyph(), defs=TILE_DEFS + GLYPH_DEFS), 1024, transparent=False)
# Android adaptive: background is the tile, foreground keeps the glyph inside the 66% safe zone.
page("android-icon-background", svg(square_tile, defs=TILE_DEFS), 512, transparent=False)
page("android-icon-foreground", svg(f'<g transform="translate(32 32) scale(0.7) translate(-32 -34)">{glyph()}</g>', defs=GLYPH_DEFS), 512)
page("android-icon-monochrome", svg(f'<g transform="translate(32 32) scale(0.7) translate(-32 -34)">{glyph(mono=True)}</g>'), 432)
# Splash: the tile mark on the light splash background from app.json.
page("splash-icon", svg(rounded_tile + glyph()), 400)
page("favicon", svg(rounded_tile + glyph(), defs=TILE_DEFS + GLYPH_DEFS), 48)
page("logo-mark", svg(rounded_tile + glyph(), defs=TILE_DEFS + GLYPH_DEFS), 512)

# iOS 26 icon package: one glyph layer on a near-black fill.
icon_dir = assets / "expo.icon"
(icon_dir / "Assets" / "vitasense-glyph.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 14 48 40" width="768" height="640">'
    f"<defs>{GLYPH_DEFS}</defs>{glyph()}</svg>",
    encoding="utf-8",
)
for old in ("expo-symbol 2.svg", "grid.png"):
    path = icon_dir / "Assets" / old
    if path.exists():
        path.unlink()
spec = {
    "fill": {"automatic-gradient": "extended-srgb:0.06667,0.06667,0.06667,1.00000"},
    "groups": [
        {
            "layers": [{"image-name": "vitasense-glyph.svg", "name": "vitasense-glyph", "position": {"scale": 1, "translation-in-points": [0, 0]}}],
            "shadow": {"kind": "neutral", "opacity": 0.5},
            "translucency": {"enabled": True, "value": 0.4},
        }
    ],
    "supported-platforms": {"circles": ["watchOS"], "squares": "shared"},
}
(icon_dir / "icon.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
print("icons done")
