#!/usr/bin/env python3
"""Find where each script segment starts and ends in the narration file.

Uses FFmpeg's silence detection, then picks the pauses that best match the
expected segment boundaries (estimated from each segment's text length).
Reads plan/script.json (from check_inputs.py), writes plan/beats.json.

Usage (from the project folder):
  python <skill>/scripts/align_voice.py [--voice voice/take.wav] [--noise -35] [--min-silence 0.25]

The result is an estimate: always check it in the first preview. To fix a
boundary by hand, edit start/end in plan/beats.json; the scene reads it directly.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

AUDIO = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def duration(ffprobe, path):
    out = run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)])
    return float(out.stdout.strip())


def silences(ffmpeg, path, noise, min_sil):
    err = run([ffmpeg, "-hide_banner", "-i", str(path), "-af", f"silencedetect=noise={noise}dB:d={min_sil}", "-f", "null", "-"]).stderr
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    return list(zip(starts, ends + [None] * (len(starts) - len(ends))))


def choose(cands, expected, avg, pause_after):
    """Pick len(expected) candidates in time order minimising distance to the expected
    boundaries, preferring longer pauses. Dynamic programming over (boundary, candidate)."""
    k_n, m = len(expected), len(cands)
    INF = float("inf")
    cost = [[INF] * m for _ in range(k_n)]
    back = [[-1] * m for _ in range(k_n)]

    def c(k, j):
        s, e = cands[j]
        mid = (s + e) / 2
        bonus = 2.0 * min(e - s, 1.5) + (1.0 if pause_after[k] else 0.0) * min(e - s, 1.5)
        return ((mid - expected[k]) / avg) ** 2 - bonus

    for j in range(m):
        cost[0][j] = c(0, j)
    for k in range(1, k_n):
        best, best_j = INF, -1
        for j in range(m):
            if j - 1 >= 0 and cost[k - 1][j - 1] < best:
                best, best_j = cost[k - 1][j - 1], j - 1
            if best_j >= 0:
                cost[k][j] = best + c(k, j)
                back[k][j] = best_j
    j = min(range(m), key=lambda x: cost[k_n - 1][x])
    picked = [j]
    for k in range(k_n - 1, 0, -1):
        j = back[k][j]
        picked.append(j)
    return [cands[x] for x in reversed(picked)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice")
    ap.add_argument("--script", default="plan/script.json")
    ap.add_argument("--out", default="plan/beats.json")
    ap.add_argument("--noise", type=float, default=-35)
    ap.add_argument("--min-silence", type=float, default=0.25)
    a = ap.parse_args()

    ffmpeg = os.environ.get("AM_FFMPEG", "ffmpeg")
    ffprobe = os.environ.get("AM_FFPROBE", "ffprobe")
    segs = json.loads(Path(a.script).read_text(encoding="utf-8"))
    voice = Path(a.voice) if a.voice else next((p for p in sorted(Path("voice").glob("*")) if p.suffix.lower() in AUDIO), None)
    if not voice or not voice.exists():
        sys.exit("no voice file (put it in voice/ or pass --voice)")

    total = duration(ffprobe, voice)
    sil = [(s, e if e is not None else total) for s, e in silences(ffmpeg, voice, a.noise, a.min_silence)]
    speech_start = sil[0][1] if sil and sil[0][0] <= 0.05 else 0.0
    speech_end = sil[-1][0] if sil and sil[-1][1] >= total - 0.05 else total
    cands = [(s, e) for s, e in sil if s > speech_start + 0.1 and e < speech_end - 0.1]

    n = len(segs)
    if n == 1:
        bounds = []
    elif len(cands) < n - 1:
        sys.exit(f"found {len(cands)} pauses but need {n - 1} for {n} segments. Try --min-silence 0.15 or --noise -30, "
                 "or ask the user for a take with a short pause between segments.")
    else:
        weights = [max(8, len(s["spoken"])) for s in segs]
        span = speech_end - speech_start
        expected, acc = [], 0
        for w in weights[:-1]:
            acc += w
            expected.append(speech_start + span * acc / sum(weights))
        bounds = choose(cands, expected, span / n, [s.get("pause_after", False) for s in segs[:-1]])

    starts = [speech_start] + [e for _, e in bounds]
    ends = [s for s, _ in bounds] + [speech_end]
    beats = []
    print(f"voice: {voice.name}  length {total:.2f}s  speech {speech_start:.2f}-{speech_end:.2f}s  pauses found {len(cands)}")
    for seg, st, en in zip(segs, starts, ends):
        beats.append({**seg, "start": round(st, 3), "end": round(en, 3)})
        print(f"{seg['n']:>3}  {st:6.2f} - {en:6.2f}  ({en - st:4.1f}s)  {seg['mood']:<9} {seg['spoken'][:45]}")
    # Compare with the target duration in request.md (the checklist asks the script to fit it).
    req = Path("request.md")
    if req.exists():
        m = re.search(r"المدة[^:\n]*:\s*([\d٠-٩.]+)", req.read_text(encoding="utf-8"))
        if m:
            target = float(m.group(1).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")))
            if target > 0 and abs(total - target) / target > 0.15:
                print(f"note: voice is {total:.1f}s but request.md asks for about {target:.0f}s; tell the user before building")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps({"voice": voice.as_posix(), "voice_length": round(total, 3), "beats": beats},
                                      ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"written {a.out} (estimate: check boundaries in the first preview)")


if __name__ == "__main__":
    main()
