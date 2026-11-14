"""Prepare private, EXIF-oriented inputs from the checked-in selection manifest.

Usage: python scripts/prepare-white-sheet-inputs.py PHOTO_DIR SELECTIONS_JSON OUTPUT_DIR
Requires Pillow. Source hashes and dimensions are checked before making crops.
Only test annotations contain photo-specific selections; runtime detection does not.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageOps

source_dir, manifest, root = map(Path, sys.argv[1:4])
selections = json.loads(manifest.read_text())
for folder in ["inputs", "frames"]:
    (root / folder).mkdir(parents=True, exist_ok=True)
jobs = []
for index in sorted({c["index"] for c in selections}):
    rows = [c for c in selections if c["index"] == index]
    source = source_dir / rows[0]["sourceFile"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != rows[0]["sourceSha256"]:
        raise ValueError(f"Source hash changed: {source.name}")
    image = ImageOps.exif_transpose(Image.open(source)).convert("RGBA")
    if list(image.size) != rows[0]["naturalSize"]:
        raise ValueError(f"Source dimensions changed: {source.name}")
    frames = {}
    for limit in [1600, 2400, "full"]:
        scale = min(1, math.sqrt(6000000 / (image.width * image.height)), 4096 / image.width, 4096 / image.height) if limit == "full" else min(1, limit / image.width, limit / image.height)
        size = (math.floor(image.width * scale), math.floor(image.height * scale)) if limit == "full" else (round(image.width * scale), round(image.height * scale))
        frame = image.resize(size, Image.Resampling.BILINEAR)
        path = root / "frames" / f"{index:02d}-{limit}.rgba"
        path.write_bytes(frame.tobytes())
        frames[str(limit)] = {"path": str(path.resolve()), "width": frame.width, "height": frame.height}
    for row in rows:
        l, t, r, b = row["roi"]
        bounds = [math.floor(l * image.width), math.floor(t * image.height), math.ceil(r * image.width), math.ceil(b * image.height)]
        crop = image.crop(bounds)
        scale = min(1, 1024 / max(crop.size))
        crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), Image.Resampling.BILINEAR)
        path = root / "inputs" / (row["name"] + "-original.rgba")
        path.write_bytes(crop.tobytes())
        crop.save(path.with_suffix(".png"))
        working = min(1, 800 / image.width, 600 / image.height)
        jobs.append({**row, "name": row["name"] + "-original", "path": str(path.resolve()),
                     "width": crop.width, "height": crop.height, "sourceCrop": bounds, "frames": frames,
                     "workingSize": [round(image.width * working), round(image.height * working)],
                     "tolerancePx": 1.2 * crop.width / (bounds[2] - bounds[0]) / working})
(root / "original-cases.json").write_text(json.dumps(jobs, indent=2))
print(f"Prepared {len(jobs)} original selections from {len(set(c['index'] for c in jobs))} photos")
