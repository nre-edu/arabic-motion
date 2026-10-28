#!/usr/bin/env python3
"""Download an open-licence font family from the official google/fonts repository on GitHub,
together with its licence file. Only that repository is contacted.

Usage (from the project folder):
  python <skill>/scripts/get_font.py cairo
  python <skill>/scripts/get_font.py "IBM Plex Sans Arabic" --out fonts
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://api.github.com/repos/google/fonts/contents/{licence}/{family}"
UA = {"User-Agent": "arabic-motion-skill"}


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def safe_name(name):
    # "Cairo[slnt,wght].ttf" -> "Cairo-Variable.ttf"
    return re.sub(r"\[[^\]]+\]", "-Variable", name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("family", help="family name, e.g. cairo, tajawal, 'Noto Kufi Arabic'")
    ap.add_argument("--out", default="fonts")
    a = ap.parse_args()

    slug = re.sub(r"[^a-z0-9]", "", a.family.lower())
    listing = None
    for licence in ("ofl", "apache", "ufl"):
        try:
            listing = json.loads(fetch(API.format(licence=licence, family=slug)))
            break
        except Exception:
            continue
    if not isinstance(listing, list):
        sys.exit(f"family '{a.family}' not found in google/fonts (tried ofl, apache, ufl as '{slug}')")

    dest = Path(a.out) / slug
    dest.mkdir(parents=True, exist_ok=True)
    saved = []
    for item in listing:
        name = item.get("name", "")
        if item.get("type") != "file" or not (name.lower().endswith((".ttf", ".otf")) or name.upper().startswith(("OFL", "LICENSE"))):
            continue
        url = item.get("download_url", "")
        if not url.startswith("https://raw.githubusercontent.com/google/fonts/"):
            continue
        (dest / safe_name(name)).write_bytes(fetch(url))
        saved.append(safe_name(name))
    if not any(s.lower().endswith((".ttf", ".otf")) for s in saved):
        sys.exit("no font files found")
    (dest / "SOURCE.txt").write_text(
        f"Family: {a.family}\nSource: https://github.com/google/fonts/tree/main/{listing[0]['path'].rsplit('/', 1)[0]}\n"
        "Licence: see the OFL/LICENSE file in this folder. Keep it with the fonts.\n",
        encoding="utf-8",
    )
    print(f"saved to {dest}:")
    for s in saved:
        print("  " + s)
    print(f'scene font src example: "{(dest / [s for s in saved if s.lower().endswith((".ttf", ".otf"))][0]).as_posix()}"')


if __name__ == "__main__":
    main()
