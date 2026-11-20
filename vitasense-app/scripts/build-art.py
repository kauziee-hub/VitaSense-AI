"""Turns the generated source art (art-source/, made with Higgsfield GPT Image 2.6) into
compact app assets in assets/art/: transparent margins trimmed, resized, saved as WebP.

Usage (from vitasense-app/): python scripts/build-art.py
"""
from pathlib import Path

from PIL import Image

SRC = Path("art-source")
OUT = Path("assets/art")
OUT.mkdir(parents=True, exist_ok=True)

# name -> longest side in px (2x the largest on-screen size)
ORGANS = {"heart": 440, "lungs": 440, "brain": 440, "gut": 440, "kidneys": 440, "immune": 440, "sleep": 440, "mosquito": 440, "band": 440}
BODY = {"body-female": 1200, "body-male": 1200}


def build(name: str, size: int, pad: float = 0.04) -> None:
    im = Image.open(SRC / f"{name}.png").convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(box)
    w, h = im.size
    p = int(max(w, h) * pad)
    canvas = Image.new("RGBA", (w + 2 * p, h + 2 * p), (0, 0, 0, 0))
    canvas.alpha_composite(im, (p, p))
    canvas.thumbnail((size, size), Image.LANCZOS)
    path = OUT / f"{name}.webp"
    canvas.save(path, "WEBP", quality=88, method=6)
    print(f"{path}  {canvas.size}  {path.stat().st_size // 1024} KB")


for name, size in {**ORGANS, **BODY}.items():
    build(name, size, pad=0.0 if name.startswith("body") else 0.04)
