#!/usr/bin/env python3
"""Measure a reference so its style can be matched.

The reference in reference/ can be:
  - a video: shot cuts and pace, motion intensity, colours, contact sheets
  - still images (infographic, Pinterest pin, screenshots): colours, aspect and a sheet
    to read layout and typography from; a still has no motion, so pace stays empty
  - both: the video gives motion and pace, the images add the look

Usage (from the project folder):
  python <skill>/scripts/analyze_ref.py [--threshold 0.3]

Writes plan/reference/analysis.json and, as available, shots.jpg (one frame per shot),
opening.jpg (first 3 s every 0.5 s), timeline.jpg (the whole video every 0.5 s: builds inside
shots, camera paths and transitions only show here) and images.jpg (the still references).
Audio is measured, not just detected: a track can exist and still be silent.
Numbers are measurements; the style itself is judged by looking at the sheets.
"""
import argparse
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
from collections import Counter
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VIDEO = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
STILL = {".png", ".jpg", ".jpeg", ".webp"}


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", **kw)


def probe(ffprobe, path):
    out = run([ffprobe, "-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", str(path)])
    data = json.loads(out.stdout)
    v = next(s for s in data["streams"] if s["codec_type"] == "video")
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    return {"width": v["width"], "height": v["height"], "fps": round(num / den, 2), "duration": float(data["format"]["duration"]),
            "has_audio": any(s["codec_type"] == "audio" for s in data["streams"])}


def scene_scores(ffmpeg, path):
    err = run([ffmpeg, "-hide_banner", "-i", str(path), "-vf", "scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
               "-an", "-f", "null", "-"]).stderr
    times = [float(x) for x in re.findall(r"pts_time:([\d.]+)", err)]
    scores = [float(x) for x in re.findall(r"lavfi\.scene_score=([\d.]+)", err)]
    return list(zip(times, scores))


def grab(ffmpeg, path, t, out, width=360):
    run([ffmpeg, "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:-2", "-q:v", "3", str(out)])


def sheet(ffmpeg, frames_glob_dir, prefix, count, out, cols=6):
    rows = math.ceil(count / cols)
    run([ffmpeg, "-y", "-loglevel", "error", "-i", str(frames_glob_dir / f"{prefix}-%02d.jpg"),
         "-vf", f"tile={cols}x{rows}:padding=6:color=0x111111", "-frames:v", "1", "-q:v", "3", str(out)])


def palette(ffmpeg, sources, top=6):
    """sources: list of (path, seconds), seconds None for a still image."""
    counts = Counter()
    sums = {}
    for path, t in sources:
        seek = ["-ss", f"{t:.3f}"] if t is not None else []
        raw = subprocess.run([ffmpeg, "-loglevel", "error", *seek, "-i", str(path), "-frames:v", "1",
                              "-vf", "scale=48:48", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        for i in range(0, len(raw) - 2, 3):
            px = (raw[i], raw[i + 1], raw[i + 2])
            key = (px[0] >> 4, px[1] >> 4, px[2] >> 4)
            counts[key] += 1
            s = sums.setdefault(key, [0, 0, 0])
            for k in range(3):
                s[k] += px[k]
    total = sum(counts.values()) or 1
    out = []
    for key, c in counts.most_common(40):
        rgb = tuple(round(v / c) for v in sums[key])  # the real average colour of the bin, not its centre
        if all(sum((x - y) ** 2 for x, y in zip(rgb, o["rgb"])) > 2500 for o in out):
            out.append({"hex": "#%02x%02x%02x" % rgb, "rgb": rgb, "share": round(c / total, 3)})
        if len(out) == top:
            break
    return [{"hex": o["hex"], "share": o["share"]} for o in out]


def image_size(ffprobe, path):
    out = run([ffprobe, "-v", "error", "-show_entries", "stream=width,height", "-of", "json", str(path)])
    st = json.loads(out.stdout)["streams"][0]
    return st["width"], st["height"]


def aspect(w, h):
    return "vertical" if h > w * 1.05 else "horizontal" if w > h * 1.05 else "square"


def analyze_video(ffmpeg, ffprobe, video, frames, out, threshold):
    info = probe(ffprobe, video)
    scores = scene_scores(ffmpeg, video)
    cuts = [t for t, s in scores if s >= threshold and t > 0.2]
    bounds = [0.0] + cuts + [info["duration"]]
    shots = [round(b - a, 2) for a, b in zip(bounds, bounds[1:]) if b - a > 0.05]
    motion = [s for _, s in scores if s < threshold]

    mids = [(x + y) / 2 for x, y in zip(bounds, bounds[1:])]
    if len(mids) > 24:
        mids = [mids[round(i * (len(mids) - 1) / 23)] for i in range(24)]
    for i, t in enumerate(mids, 1):
        grab(ffmpeg, video, t, frames / f"shot-{i:02d}.jpg")
    sheet(ffmpeg, frames, "shot", len(mids), out / "shots.jpg", cols=min(6, len(mids)))
    opening = [t / 2 for t in range(0, 7) if t / 2 < info["duration"]]
    for i, t in enumerate(opening, 1):
        grab(ffmpeg, video, t, frames / f"open-{i:02d}.jpg")
    sheet(ffmpeg, frames, "open", len(opening), out / "opening.jpg", cols=len(opening))

    # Whole video every 0.5 s (every 1 s past 24 s), so nothing between shot midpoints is missed.
    step = 0.5 if info["duration"] <= 24 else 1.0
    run([ffmpeg, "-y", "-loglevel", "error", "-i", str(video), "-vf",
         f"fps={1 / step},scale=240:-2,tile=8x{math.ceil(info['duration'] / step / 8)}:padding=4:color=0x111111",
         "-frames:v", "1", "-q:v", "3", str(out / "timeline.jpg")])

    audio = None
    if info["has_audio"]:
        err = run([ffmpeg, "-hide_banner", "-i", str(video), "-af", "ebur128", "-f", "null", "-"]).stderr
        m = re.findall(r"I:\s+(-?[\d.]+) LUFS", err[err.rfind("Summary:"):])
        lufs = float(m[0]) if m else None
        audio = {"loudness_lufs": lufs, "silent": lufs is None or lufs < -50}

    result = {
        "video": {"file": video.name, **info, "aspect": aspect(info["width"], info["height"])},
        "cuts": [round(c, 2) for c in cuts],
        "shots": len(shots),
        "shot_length": {"mean": round(statistics.mean(shots), 2), "median": round(statistics.median(shots), 2),
                        "min": min(shots), "max": max(shots)} if shots else None,
        "cuts_per_10s": round(len(cuts) / info["duration"] * 10, 1),
        "motion_inside_shots": round(statistics.mean(motion), 4) if motion else 0,
        "shot_times": [round(t, 2) for t in mids],
        "audio": audio,
    }
    sheets = {"shots": (out / "shots.jpg").as_posix(), "opening": (out / "opening.jpg").as_posix(),
              "timeline": (out / "timeline.jpg").as_posix()}
    return result, [(video, t) for t in mids[:12]], sheets


def analyze_stills(ffmpeg, ffprobe, stills, frames, out):
    items = []
    for i, p in enumerate(stills[:24], 1):
        w, h = image_size(ffprobe, p)
        items.append({"file": p.name, "width": w, "height": h, "aspect": aspect(w, h)})
        # Same cell size for every image so the sheet can tile them; each image keeps its proportions.
        run([ffmpeg, "-y", "-loglevel", "error", "-i", str(p), "-frames:v", "1",
             "-vf", "scale=360:540:force_original_aspect_ratio=decrease,pad=360:540:(ow-iw)/2:(oh-ih)/2:color=0x111111",
             "-q:v", "3", str(frames / f"still-{i:02d}.jpg")])
    sheet(ffmpeg, frames, "still", len(items), out / "images.jpg", cols=min(4, len(items)))
    return items, [(p, None) for p in stills[:12]], {"images": (out / "images.jpg").as_posix()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.3, help="scene-change score that counts as a cut")
    ap.add_argument("--out", default="plan/reference")
    a = ap.parse_args()

    ffmpeg = os.environ.get("AM_FFMPEG", "ffmpeg")
    ffprobe = os.environ.get("AM_FFPROBE", "ffprobe")
    ref = Path("reference")
    videos = sorted(p for p in ref.glob("*") if p.suffix.lower() in VIDEO) if ref.is_dir() else []
    stills = sorted(p for p in ref.glob("*") if p.suffix.lower() in STILL) if ref.is_dir() else []
    if not videos and not stills:
        sys.exit("nothing in reference/: add a video, or images such as an infographic or a Pinterest pin")

    out = Path(a.out)
    frames = out / "frames"
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)

    kind = "video+images" if videos and stills else "video" if videos else "images"
    analysis = {"kind": kind, "shot_length": None, "sheets": {}}
    sources = []
    if videos:
        if len(videos) > 1:
            print(f"several videos in reference/; measuring {videos[0].name} (name the main one so it sorts first)")
        result, src, sheets = analyze_video(ffmpeg, ffprobe, videos[0], frames, out, a.threshold)
        analysis.update(result)
        sources += src
        analysis["sheets"].update(sheets)
    if stills:
        items, src, sheets = analyze_stills(ffmpeg, ffprobe, stills, frames, out)
        analysis["images"] = items
        sources += src
        analysis["sheets"].update(sheets)
    analysis["aspect"] = analysis["video"]["aspect"] if videos else analysis["images"][0]["aspect"]
    analysis["palette"] = palette(ffmpeg, sources)
    (out / "analysis.json").write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"reference kind: {kind}, aspect: {analysis['aspect']}")
    if videos:
        vi, sl = analysis["video"], analysis["shot_length"] or {}
        print(f"{vi['file']}: {vi['width']}x{vi['height']} {vi['fps']}fps {vi['duration']:.1f}s, audio: {vi['has_audio']}")
        print(f"shots: {analysis['shots']}, median {sl.get('median', '-')}s, {analysis['cuts_per_10s']} cuts per 10s")
        print(f"motion inside shots: {analysis['motion_inside_shots']} (relative: compare with the sheets, higher = more movement)")
        au = analysis["audio"]
        print("audio: none" if not au else f"audio: {au['loudness_lufs']} LUFS" + (" (silent track)" if au["silent"] else " (has sound: listen for music and effects)"))
    if stills:
        print(f"still references: {len(analysis['images'])} ({', '.join(i['file'] for i in analysis['images'][:6])})")
        if not videos:
            print("no motion in a still reference: take motion from reference/notes.md, or propose motion that fits the look")
    print("palette: " + "  ".join(f"{p['hex']} {p['share']:.0%}" for p in analysis["palette"]))
    print("look at: " + " and ".join(analysis["sheets"].values()))


if __name__ == "__main__":
    main()
