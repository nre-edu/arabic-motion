#!/usr/bin/env python3
"""Search and download openly licensed sound effects from the Openverse API,
recording source, author and licence for every file.

Usage (from the project folder):
  python <skill>/scripts/fetch_sfx.py search "whoosh" [--licence cc0,pdm] [--max-sec 3]
  python <skill>/scripts/fetch_sfx.py get <openverse-id> --name whoosh [--out sfx]

Default licences are CC0 and Public Domain Mark (no credit needed). Add "by" to allow
CC BY, which requires a credit line in the video caption or end card.
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

API = "https://api.openverse.org/v1/audio/"
UA = {"User-Agent": "arabic-motion-skill", "Accept": "application/json"}
ALLOWED = {"cc0", "pdm", "by"}


def get_json(url, attempts=3):
    # Openverse sometimes stalls on uncached queries; short timeouts with retries beat one long wait.
    for i in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return json.loads(r.read())
        except (TimeoutError, OSError) as e:
            last = e
            time.sleep(2 * (i + 1))
    sys.exit(f"Openverse did not respond ({last}). Try again later, use a smaller --limit, "
             "or generate sounds offline with synth_sfx.py.")


def licences(arg):
    chosen = {x.strip().lower() for x in arg.split(",") if x.strip()}
    bad = chosen - ALLOWED
    if bad:
        sys.exit(f"licence not allowed here: {', '.join(sorted(bad))} (allowed: cc0, pdm, by)")
    return chosen


def cmd_search(a):
    # Plain commas (not %2C) match the form most clients send, so Openverse can answer from its cache.
    q = urllib.parse.urlencode({"q": a.query, "license": ",".join(sorted(licences(a.licence))), "page_size": a.limit}, safe=",")
    data = get_json(f"{API}?{q}")
    rows = []
    for r in data.get("results", []):
        secs = (r.get("duration") or 0) / 1000
        if a.max_sec and secs > a.max_sec:
            continue
        rows.append(r)
        print(f"{r['id']}  {secs:5.1f}s  {r.get('license', '?'):4}  {r.get('filetype') or '?':4}  {r.get('title', '')[:50]}  by {r.get('creator') or 'unknown'}")
    if not rows:
        print("no results; try another word in English (e.g. swoosh, click, pop, impact, riser)")


def cmd_get(a):
    r = get_json(f"{API}{urllib.parse.quote(a.id)}/")
    lic = (r.get("license") or "").lower()
    if lic not in ALLOWED:
        sys.exit(f"refused: licence '{lic}' is not cc0, pdm or by")
    url = r.get("url")
    if not url:
        sys.exit("no downloadable file for this id")
    ext = (r.get("filetype") or Path(urllib.parse.urlparse(url).path).suffix.lstrip(".") or "mp3").lower()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"{a.name}.{ext}"
    if target.exists() and not a.force:
        sys.exit(f"{target} exists (use --force to replace)")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as resp:
        target.write_bytes(resp.read())

    entry = {
        "file": target.name,
        "openverse_id": r["id"],
        "title": r.get("title"),
        "creator": r.get("creator"),
        "licence": lic,
        "licence_version": r.get("license_version"),
        "licence_url": r.get("license_url"),
        "source_page": r.get("foreign_landing_url"),
        "provider": r.get("provider"),
    }
    manifest = out / "sources.json"
    items = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    items = [i for i in items if i.get("file") != target.name] + [entry]
    manifest.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    if lic == "by":
        credit = f"- \"{entry['title']}\" by {entry['creator']}, CC BY {entry['licence_version'] or ''} ({entry['source_page']})\n"
        with (out / "CREDITS.md").open("a", encoding="utf-8") as f:
            f.write(credit)
        print("CC BY: credit line added to CREDITS.md; include it in the post caption or end card.")
    print(f"saved {target} ({lic})")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--licence", default="cc0,pdm")
    s.add_argument("--max-sec", type=float, default=0)
    s.add_argument("--limit", type=int, default=8)
    g = sub.add_parser("get")
    g.add_argument("id")
    g.add_argument("--name", required=True, help="cue name used in scenes, e.g. whoosh")
    g.add_argument("--out", default="sfx")
    g.add_argument("--force", action="store_true")
    a = ap.parse_args()
    cmd_search(a) if a.cmd == "search" else cmd_get(a)


if __name__ == "__main__":
    main()
