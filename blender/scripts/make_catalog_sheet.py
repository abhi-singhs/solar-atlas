"""Make a visual inspection sheet from the rendered body catalog."""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "renders/catalog/render_manifest.json").read_text())
catalog = json.loads((ROOT / "data/catalog.json").read_text())
names = {body["id"]: body["name"] for body in catalog["bodies"]}
columns = 6
cell_width, cell_height = 320, 226
header = 90
rows = math.ceil(len(manifest) / columns)
sheet = Image.new("RGB", (columns * cell_width, header + rows * cell_height + 30), "#080b0f")
draw = ImageDraw.Draw(sheet)
title = ImageFont.load_default(size=28)
font = ImageFont.load_default(size=15)
draw.text((20, 16), "Solar System / body catalog", fill="#e2e9ef", font=title)
draw.text((20, 54), "Individual camera views, not a size comparison. Every scene uses the same physical length scale.",
          fill="#95a5b6", font=font)
for index, record in enumerate(manifest):
    x = index % columns * cell_width
    y = header + index // columns * cell_height
    with Image.open(ROOT / record["path"]) as image:
        image.thumbnail((cell_width, 200), Image.Resampling.LANCZOS)
        sheet.paste(image.convert("RGB"), (x, y))
    draw.text((x + 12, y + 202), names[record["target"]], fill="#b4c8d5", font=font)
sheet.save(ROOT / "renders/body-catalog.png")
print("CATALOG_SHEET_COMPLETE", len(manifest))
