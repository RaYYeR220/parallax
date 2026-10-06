"""Web-sized copies of Foxit's 300 dpi renders: a page view and a thumbnail."""

from pathlib import Path
from PIL import Image

SRC = Path("site/data/renders")
OUT = Path("site/img")
OUT.mkdir(parents=True, exist_ok=True)

for render in sorted(SRC.glob("*.jpg")):
    image = Image.open(render).convert("RGB")
    for suffix, width, quality in (("", 1275, 84), ("-t", 480, 80)):
        height = round(image.height * width / image.width)
        image.resize((width, height), Image.LANCZOS).save(OUT / f"{render.stem}{suffix}.jpg", quality=quality, optimize=True)
    print(render.stem)
