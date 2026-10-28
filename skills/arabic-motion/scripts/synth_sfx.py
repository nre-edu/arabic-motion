#!/usr/bin/env python3
"""Generate simple UI/motion sound effects offline with no dependencies.
Seeded, so the same command always produces the same files. The output is yours to use freely.

Usage (from the project folder):
  python <skill>/scripts/synth_sfx.py                 # all sounds into sfx
  python <skill>/scripts/synth_sfx.py tick pop --out sfx
"""
import argparse
import sys
import math
import random
import struct
import wave
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SR = 48000


def env(i, n, attack=0.005, curve=4.0):
    t = i / SR
    a = min(1.0, t / attack) if attack > 0 else 1.0
    return a * (1 - i / n) ** curve


def lowpass(samples, amount):
    out, y = [], 0.0
    for s in samples:
        y += amount * (s - y)
        out.append(y)
    return out


def tick(rnd):
    n = int(SR * 0.04)
    return [(math.sin(2 * math.pi * 2600 * i / SR) * 0.6 + (rnd.random() * 2 - 1) * 0.4) * env(i, n, 0.0005, 8) for i in range(n)]


def click(rnd):
    n = int(SR * 0.07)
    return [(math.sin(2 * math.pi * 1500 * i / SR) * 0.7 + (rnd.random() * 2 - 1) * 0.3) * env(i, n, 0.0008, 6) for i in range(n)]


def pop(rnd):
    n = int(SR * 0.16)
    out, phase = [], 0.0
    for i in range(n):
        f = 900 * (1 - i / n) ** 2 + 180
        phase += 2 * math.pi * f / SR
        out.append(math.sin(phase) * env(i, n, 0.002, 3))
    return out


def whoosh(rnd, secs=0.7):
    n = int(SR * secs)
    noise = [rnd.random() * 2 - 1 for _ in range(n)]
    out = []
    y = 0.0
    for i, s in enumerate(noise):
        p = i / n
        cutoff = 0.02 + 0.25 * math.sin(math.pi * p)  # filter opens then closes
        y += cutoff * (s - y)
        out.append(y * math.sin(math.pi * p) ** 1.5 * 2.2)
    return out


def swish(rnd):
    return whoosh(rnd, 0.35)


def riser(rnd):
    n = int(SR * 1.2)
    out, phase = [], 0.0
    for i in range(n):
        p = i / n
        phase += 2 * math.pi * (200 + 900 * p * p) / SR
        out.append((math.sin(phase) * 0.5 + (rnd.random() * 2 - 1) * 0.25 * p) * p ** 2)
    return out


def impact(rnd):
    n = int(SR * 0.6)
    body, phase = [], 0.0
    for i in range(n):
        phase += 2 * math.pi * (55 + 90 * (1 - i / n) ** 6) / SR
        body.append(math.sin(phase) * env(i, n, 0.001, 2.5))
    hit = lowpass([(rnd.random() * 2 - 1) * env(i, n, 0.0005, 18) for i in range(n)], 0.3)
    return [b * 0.9 + h * 0.6 for b, h in zip(body, hit)]


def ding(rnd):
    n = int(SR * 0.9)
    return [(math.sin(2 * math.pi * 1320 * i / SR) * 0.6 + math.sin(2 * math.pi * 2640 * i / SR) * 0.2) * env(i, n, 0.002, 3) for i in range(n)]


SOUNDS = {"tick": tick, "click": click, "pop": pop, "whoosh": whoosh, "swish": swish, "riser": riser, "impact": impact, "ding": ding}


def write_wav(path, samples, peak_db=-3.0):
    peak = max(1e-9, max(abs(s) for s in samples))
    gain = 10 ** (peak_db / 20) / peak
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s * gain)) * 32767)) for s in samples))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help=f"any of: {', '.join(SOUNDS)}")
    ap.add_argument("--out", default="sfx")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for name in a.names or list(SOUNDS):
        if name not in SOUNDS:
            raise SystemExit(f"unknown sound '{name}'")
        target = out / f"{name}.wav"
        if target.exists() and not a.force:
            print(f"kept existing {target}")
            continue
        write_wav(target, SOUNDS[name](random.Random(a.seed)))
        print(f"generated {target}")


if __name__ == "__main__":
    main()
