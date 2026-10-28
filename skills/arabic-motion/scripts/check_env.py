#!/usr/bin/env python3
"""Read-only check of the tools arabic-motion needs. Installs nothing, downloads nothing.

Usage (from the project folder):  python <skill>/scripts/check_env.py
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def version(cmd, args=("--version",)):
    exe = shutil.which(cmd)
    if not exe:
        return None
    try:
        out = subprocess.run([exe, *args], capture_output=True, text=True, timeout=20)
        line = (out.stdout or out.stderr).strip().splitlines()
        return line[0] if line else "found"
    except (OSError, subprocess.SubprocessError):
        return "found (version unknown)"


def chromium_present():
    candidates = [
        os.environ.get("PLAYWRIGHT_BROWSERS_PATH"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "ms-playwright"),
        str(Path.home() / ".cache" / "ms-playwright"),
        str(Path.home() / "Library" / "Caches" / "ms-playwright"),
    ]
    for c in filter(None, candidates):
        p = Path(c)
        if p.is_dir() and any(d.name.startswith(("chromium", "chromium_headless_shell")) for d in p.iterdir()):
            return True
    return bool(os.environ.get("AM_CHROMIUM"))


def main():
    project = Path.cwd()
    ffmpeg = os.environ.get("AM_FFMPEG", "ffmpeg")
    report = {
        "python": sys.version.split()[0],
        "node": version("node"),
        "npm": version("npm"),
        "ffmpeg": version(ffmpeg, ("-version",)),
        "ffprobe": version("ffprobe", ("-version",)),
        "project": project.name,
        "render_template_copied": (project / "render" / "render.mjs").is_file(),
        "playwright_installed": (project / "render" / "node_modules" / "playwright").is_dir(),
        "chromium_downloaded": chromium_present(),
        "fonts": sorted(p.name for p in (project / "fonts").rglob("*.[ot]tf")) if (project / "fonts").is_dir() else [],
        "sfx_files": len([p for p in (project / "sfx").glob("*") if p.suffix.lower() in {".wav", ".mp3", ".ogg", ".flac"}]) if (project / "sfx").is_dir() else 0,
    }
    missing = [k for k in ("node", "ffmpeg", "ffprobe") if not report[k]]
    missing += [k for k in ("render_template_copied", "playwright_installed", "chromium_downloaded") if not report[k]]
    report["missing"] = missing
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
