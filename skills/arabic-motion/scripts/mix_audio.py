#!/usr/bin/env python3
"""Place sound cues (from the renderer's .cues.json) on a silent video, optionally add a
voice and music bed, normalise loudness, and write the final MP4. Needs FFmpeg.

Usage (from the project folder):
  python <skill>/scripts/mix_audio.py exports/video-preview-v1.mp4 --out exports/video-preview-v1-mix.mp4
  python <skill>/scripts/mix_audio.py exports/video.mp4 --music music/bed.mp3 --out exports/video-final.mp4

The voice comes from the cues file (the story scene records it there with its offset);
--voice overrides it.

Cue format: {"at": seconds, "sound": "whoosh", "gain": -8}. The sound name is matched to a
file stem in --sfx (whoosh.wav, whoosh.mp3, ...).
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

EXTS = (".wav", ".flac", ".mp3", ".ogg", ".m4a")


def find_sound(sfx_dir, name):
    for ext in EXTS:
        p = sfx_dir / f"{name}{ext}"
        if p.exists():
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--cues", help="defaults to <video>.cues.json")
    ap.add_argument("--sfx", default="sfx")
    ap.add_argument("--voice")
    ap.add_argument("--voice-at", type=float, default=None)
    ap.add_argument("--voice-gain", type=float, default=None)
    ap.add_argument("--music")
    ap.add_argument("--music-gain", type=float, default=-20.0)
    ap.add_argument("--lufs", type=float, default=-14.0)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    ffmpeg = os.environ.get("AM_FFMPEG", "ffmpeg")
    ffprobe = os.environ.get("AM_FFPROBE", "ffprobe")
    video = Path(a.video)
    cues_path = Path(a.cues) if a.cues else video.parent / f"{video.stem}.cues.json"
    data = json.loads(cues_path.read_text(encoding="utf-8")) if cues_path.exists() else {}
    cues = data.get("cues", [])
    rec = data.get("voice") or {}
    voice_file = a.voice or rec.get("file")
    voice_at = a.voice_at if a.voice_at is not None else rec.get("at", 0.0)
    voice_gain = a.voice_gain if a.voice_gain is not None else rec.get("gain", 0.0)
    if voice_file and not Path(voice_file).exists():
        sys.exit(f"voice file not found: {voice_file}")

    sfx_dir = Path(a.sfx)
    missing = sorted({c["sound"] for c in cues if not find_sound(sfx_dir, c["sound"])})
    if missing:
        sys.exit(f"missing sound files in {sfx_dir}: {', '.join(missing)} (fetch with fetch_sfx.py or generate with synth_sfx.py)")

    inputs = ["-i", str(video)]
    chains, labels = [], []
    for i, c in enumerate(cues):
        inputs += ["-i", str(find_sound(sfx_dir, c["sound"]))]
        ms = max(0, int(round(c["at"] * 1000)))
        chains.append(f"[{i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume={c.get('gain', 0)}dB,adelay={ms}|{ms}[c{i}]")
        labels.append(f"[c{i}]")
    idx = len(cues) + 1

    voice_label = None
    if voice_file:
        inputs += ["-i", voice_file]
        # Positive offset delays the voice; negative (partial renders) trims its start.
        place = f"adelay={int(round(voice_at * 1000))}:all=1" if voice_at >= 0 else f"atrim=start={-voice_at},asetpts=PTS-STARTPTS"
        chains.append(f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume={voice_gain}dB,{place},asplit=2[v][vkey]")
        voice_label = "[v]"
        idx += 1
    if a.music:
        inputs += ["-stream_loop", "-1", "-i", a.music]
        chains.append(f"[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume={a.music_gain}dB[m0]")
        if voice_label:
            # Duck the music under the voice.
            chains.append("[m0][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[m]")
        else:
            chains.append("[m0]anull[m]")
        labels.append("[m]")
        idx += 1
    elif voice_label:
        chains.append("[vkey]anullsink")
    if voice_label:
        labels.append(voice_label)

    if not labels:
        sys.exit("nothing to mix: no cues, voice or music")

    chains.append(f"{''.join(labels)}amix=inputs={len(labels)}:duration=longest:normalize=0,apad[pre]")
    graph = ";".join(chains)
    length = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(video)],
                            capture_output=True, text=True).stdout.strip()

    # Two-pass loudness normalisation: measure first, then apply linearly, so the true peak
    # stays under the ceiling (single-pass loudnorm can overshoot it). TP target leaves room for AAC.
    target = f"I={a.lufs}:TP=-2.0:LRA=11"
    probe = subprocess.run([ffmpeg, "-hide_banner", *inputs, "-filter_complex", f"{graph};[pre]loudnorm={target}:print_format=json[m]",
                            "-map", "[m]", "-t", length, "-f", "null", "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    stats = json.loads(probe.stderr[probe.stderr.rfind("{"):probe.stderr.rfind("}") + 1])
    measured = (f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:measured_LRA={stats['input_lra']}:"
                f"measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true")

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    cmd = [ffmpeg, "-y", "-loglevel", "error", *inputs, "-filter_complex", f"{graph};[pre]loudnorm={target}:{measured},aresample=48000[mix]",
           "-map", "0:v", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", length, a.out]
    subprocess.run(cmd, check=True)

    meas = subprocess.run([ffmpeg, "-hide_banner", "-i", a.out, "-af", "ebur128=peak=true", "-f", "null", "-"],
                          capture_output=True, text=True)
    summary = meas.stderr[meas.stderr.rfind("Summary:"):]
    lufs = re.search(r"I:\s+(-?[\d.]+) LUFS", summary)
    peak = re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary)
    print(f"final: {a.out}  cues: {len(cues)}  loudness: {lufs.group(1) if lufs else '?'} LUFS  true peak: {peak.group(1) if peak else '?'} dBFS")


if __name__ == "__main__":
    main()
