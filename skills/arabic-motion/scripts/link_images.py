#!/usr/bin/env python3
"""Link images to script segments, following the reference video's pace.

Order of authority for each segment:
  1. {صورة N} markers in script.md            (source: script)
  2. plan/mapping.json approved by the user     (source: approved)   e.g. {"3": [4, 5], "6": []}
  3. automatic proposal for the rest            (source: auto)

The automatic proposal keeps the images' numeric order (it follows the script order),
and gives each segment about one image per reference shot length: a 6 s segment with
a 2.5 s reference shot gets 2 images, a 1.5 s segment gets 1 or none. Every free image is
used when there are segments to hold it.

Run after analyze_ref.py and align_voice.py (it needs shot length and segment durations).
Updates plan/beats.json and writes plan/mapping.proposed.json.

Usage (from the project folder):  python <skill>/scripts/link_images.py [--shot 2.5]
"""
import argparse
import json
import re
import sys
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
DEFAULT_SHOT = 2.5


def number_of(path):
    m = re.search(r"\d+", path.stem.translate(ARABIC_DIGITS))
    return int(m.group()) if m else None


def allocate(free, slots, shot):
    """Return {segment n: [image numbers]} for segments that have no images yet."""
    if not free or not slots:
        return {}
    dur = {s["n"]: max(0.1, s["end"] - s["start"]) for s in slots}
    want = {n: max(1, round(d / shot)) for n, d in dur.items()}
    count = {n: 0 for n in dur}
    units = len(free)
    # First, one image each, longest segments first (short ones can stay text-only).
    for n in sorted(dur, key=lambda k: -dur[k]):
        if units == 0:
            break
        count[n] = 1
        units -= 1
    # Then extra images where the reference pace asks for them, then wherever time per image is longest.
    while units > 0:
        n = max(dur, key=lambda k: (count[k] < want[k], dur[k] / (count[k] + 1)))
        count[n] += 1
        units -= 1
    out, it = {}, iter(free)
    for s in slots:  # script order, so images keep their numeric order
        out[s["n"]] = [next(it) for _ in range(count[s["n"]])]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--beats", default="plan/beats.json")
    ap.add_argument("--analysis", default="plan/reference/analysis.json")
    ap.add_argument("--mapping", default="plan/mapping.json")
    ap.add_argument("--shot", type=float, help="seconds per image; default: the reference's median shot length")
    a = ap.parse_args()

    beats_path = Path(a.beats)
    if not beats_path.exists():
        sys.exit("plan/beats.json not found: run align_voice.py first")
    data = json.loads(beats_path.read_text(encoding="utf-8"))
    beats = data["beats"]

    shot, shot_from = a.shot, "--shot"
    fallback = "default (no reference analysis found)"
    if shot is None and Path(a.analysis).exists():
        analysis = json.loads(Path(a.analysis).read_text(encoding="utf-8"))
        shot, shot_from = (analysis.get("shot_length") or {}).get("median"), "reference median shot"
        if analysis.get("kind") == "images":
            fallback = "default (still-image reference has no pace; pass --shot from reference/notes.md if given)"
    if not shot:
        shot, shot_from = DEFAULT_SHOT, fallback

    by_num = {}
    for p in sorted(Path("images").glob("*")):
        k = number_of(p)
        if p.suffix.lower() in IMAGES and k is not None and k not in by_num:
            by_num[k] = p.name

    approved = {}
    if Path(a.mapping).exists():
        approved = {int(k): [int(x) for x in v] for k, v in json.loads(Path(a.mapping).read_text(encoding="utf-8")).items()}

    for b in beats:
        if b.get("images"):
            b["image_source"] = "script"
            b["linked_images"] = list(b["images"])
        elif b["n"] in approved:
            b["image_source"] = "approved"
            b["linked_images"] = approved[b["n"]]
        else:
            b["image_source"] = None
            b["linked_images"] = []

    used = {k for b in beats for k in b["linked_images"]}
    free = [k for k in sorted(by_num) if k not in used]
    slots = [b for b in beats if b["image_source"] is None]
    proposal = allocate(free, slots, shot)
    for b in slots:
        b["linked_images"] = proposal.get(b["n"], [])
        b["image_source"] = "auto" if b["linked_images"] else "none"

    missing = sorted({k for b in beats for k in b["linked_images"] if k not in by_num})
    for b in beats:
        b["image_files"] = [by_num[k] for k in b["linked_images"] if k in by_num]
    beats_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    Path("plan/mapping.proposed.json").write_text(
        json.dumps({str(b["n"]): b["linked_images"] for b in beats}, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"seconds per image: {shot} ({shot_from})")
    for b in beats:
        d = b["end"] - b["start"]
        imgs = ", ".join(b["image_files"]) or "-"
        print(f"{b['n']:>3}  {d:4.1f}s  {b['image_source']:<8}  {imgs:<30}  {b['spoken'][:40]}")
    left = [by_num[k] for k in sorted(by_num) if k not in {x for b in beats for x in b["linked_images"]}]
    if left:
        print("not used: " + ", ".join(left) + " (every segment already has its images from the script or mapping)")
    if missing:
        print(f"mapping refers to missing images: {missing}")
        sys.exit(1)
    print("updated plan/beats.json; proposal saved to plan/mapping.proposed.json")


if __name__ == "__main__":
    main()
