#!/usr/bin/env python3
"""Cut named regions (cards, panels, steps) out of one infographic into numbered images,
so each region can be its own shot. The original is kept untouched.

Find the boxes by looking at the image, then write them to a JSON file:
  {"source": "source/infographic.png",
   "regions": [{"name": "full"},                          # the whole image
               {"name": "01-voice", "box": [1120, 158, 532, 374]},   # x, y, width, height in source pixels
               ...]}

Usage (from the project folder):
  python <skill>/scripts/crop_regions.py plan/regions.json [--start 1] [--pad 12] [--scale 2]

Writes images/<NN>-<name>.png in the listed order, starting at --start.
--pad adds breathing room around each box; --scale upsamples small crops (Lanczos) so they
stay sharp when shown large. Needs Pillow, or FFmpeg as a fallback.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def crop_pillow(src, box, out, scale):
    from PIL import Image
    im = Image.open(src).convert("RGB")
    x, y, w, h = box
    part = im.crop((x, y, x + w, y + h))
    if scale != 1:
        part = part.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    part.save(out)


def crop_ffmpeg(src, box, out, scale):
    x, y, w, h = box
    vf = f"crop={w}:{h}:{x}:{y}" + (f",scale={round(w * scale)}:{round(h * scale)}:flags=lanczos" if scale != 1 else "")
    subprocess.run([os.environ.get("AM_FFMPEG", "ffmpeg"), "-y", "-loglevel", "error", "-i", str(src), "-vf", vf, "-frames:v", "1", str(out)],
                   check=True)


def size_of(src):
    try:
        from PIL import Image
        return Image.open(src).size
    except ImportError:
        out = subprocess.run([os.environ.get("AM_FFPROBE", "ffprobe"), "-v", "error", "-show_entries", "stream=width,height",
                              "-of", "csv=p=0", str(src)], capture_output=True, text=True).stdout.strip()
        w, h = out.split(",")[:2]
        return int(w), int(h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("regions")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--pad", type=int, default=12)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--out", default="images")
    a = ap.parse_args()

    spec = json.loads(Path(a.regions).read_text(encoding="utf-8"))
    src = Path(spec["source"])
    if not src.exists():
        sys.exit(f"source image not found: {src}")
    W, H = size_of(src)
    try:
        import PIL  # noqa: F401
        crop = crop_pillow
    except ImportError:
        crop = crop_ffmpeg

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for i, r in enumerate(spec["regions"], a.start):
        if "box" in r:
            x, y, w, h = r["box"]
            x0, y0 = max(0, x - a.pad), max(0, y - a.pad)
            x1, y1 = min(W, x + w + a.pad), min(H, y + h + a.pad)
            box = (x0, y0, x1 - x0, y1 - y0)
        else:
            box = (0, 0, W, H)
        target = out / f"{i:02d}-{r['name']}.png"
        if target.exists():
            print(f"kept existing {target} (delete it to re-crop)")
            continue
        crop(src, box, target, a.scale if "box" in r else 1.0)
        print(f"{target}  box {box}")


if __name__ == "__main__":
    main()
