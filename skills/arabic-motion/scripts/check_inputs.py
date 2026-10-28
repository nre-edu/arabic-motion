#!/usr/bin/env python3
"""Check the files the user prepared and turn script.md into plan/script.json.

Expected project layout (created by init_project.py):
  script.md        one numbered line per segment, as sent to the TTS tool
  voice/           the narration file (wav preferred)
  images/          images or infographics, numbered (1.png, 02-chart.jpg ...)
  reference/       the reference video to match
  sfx/             optional: the user's own sound effects

Script line format:
  1. [excited] هل تعرف أن ٩٠٪ من خريجينا توظفوا؟ {صورة 1} {على الشاشة: ٩٠٪ توظفوا}
  [square] or <angle> brackets = voice/emotion tags for the TTS tool (Google AI Studio uses <short pause>,
                     <chuckle> ...): removed from screen text, mapped to a mood. A pause tag at the very
                     start of a line marks a pause before it, so it counts for the previous segment.
  {curly braces}     = our own markers: {صورة 2} / {image 2,3}, {على الشاشة: ...} / {screen: ...}

Usage (from the project folder):  python <skill>/scripts/check_inputs.py
"""
import json
import re
import sys
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

AUDIO = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"}
IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
VIDEO = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}

# Tag words (English or Arabic) -> mood used by the scene for pace and sound.
MOODS = {
    "energetic": ["excited", "enthusiastic", "happy", "cheerful", "energetic", "surprised", "amazed", "laugh", "laughing", "chuckle", "giggle", "shout", "proud",
                  "حماس", "متحمس", "سعيد", "مفاجأة", "فرح", "فخر"],
    "calm": ["calm", "soft", "gentle", "whisper", "whispering", "warm", "relaxed", "sad", "tender",
             "هادئ", "هدوء", "همس", "دافئ", "حزين"],
    "serious": ["serious", "firm", "confident", "authoritative", "dramatic", "emphatic", "stern",
                "جدي", "جاد", "حازم", "واثق", "درامي"],
    "pause": ["pause", "short pause", "long pause", "breath", "silence", "وقفة", "صمت", "توقف"],
}

LINE = re.compile(r"^\s*(\d+)\s*[.)\-:]\s*(.+)$")
SQUARE = re.compile(r"\[([^\]]+)\]|<([^<>]+)>")
CURLY = re.compile(r"\{([^}]+)\}")
IMAGE_KEY = re.compile(r"^(?:صورة|صور|image|img|images)\s*:?\s*(.+)$", re.I)
SCREEN_KEY = re.compile(r"^(?:على الشاشة|الشاشة|نص|screen|on ?screen|text)\s*:\s*(.+)$", re.I)
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def mood_of(tags):
    found = []
    unknown = []
    for tag in tags:
        t = tag.strip().lower()
        hit = next((m for m, words in MOODS.items() if any(w in t for w in words)), None)
        (found if hit else unknown).append(hit or tag.strip())
    mood = next((m for m in ("energetic", "serious", "calm") if m in found), "neutral")
    return mood, "pause" in found, unknown


def number_of(path):
    m = re.search(r"\d+", path.stem.translate(ARABIC_DIGITS))
    return int(m.group()) if m else None


def parse_script(text):
    segments, problems = [], []
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        m = LINE.match(raw)
        if not m:
            problems.append(f"line without a number, skipped: {raw.strip()[:60]}")
            continue
        n, body = int(m.group(1)), m.group(2)
        tags = [a or b for a, b in SQUARE.findall(body)]
        leading = re.match(r"^\s*(?:\[([^\]]+)\]|<([^<>]+)>)", body)
        if leading and segments and mood_of([leading.group(1) or leading.group(2)])[1]:
            segments[-1]["pause_after"] = True  # "<short pause> ..." at line start = pause before this line
        images, screen = [], None
        for marker in CURLY.findall(body):
            im, sc = IMAGE_KEY.match(marker.strip()), SCREEN_KEY.match(marker.strip())
            if im:
                images += [int(x) for x in re.findall(r"\d+", im.group(1).translate(ARABIC_DIGITS))]
            elif sc:
                screen = sc.group(1).strip()
            else:
                problems.append(f"segment {n}: unknown marker {{{marker}}}")
        spoken = re.sub(r"\s+", " ", CURLY.sub("", SQUARE.sub("", body))).strip()
        mood, _, unknown = mood_of(tags)
        # Only a pause tag at the end of the line (before any {markers}) is a pause after this segment.
        trailing = re.search(r"(?:\[([^\]]+)\]|<([^<>]+)>)\s*(?:\{[^}]*\}\s*)*$", body)
        pause_after = bool(trailing and mood_of([trailing.group(1) or trailing.group(2)])[1])
        for u in unknown:
            problems.append(f"segment {n}: tag [{u}] not recognised, ask the user what it means")
        segments.append({"n": n, "spoken": spoken, "onscreen": screen or spoken, "screen_given": bool(screen),
                         "images": images, "tags": tags, "mood": mood, "pause_after": pause_after})
    nums = [s["n"] for s in segments]
    if nums != sorted(nums) or len(set(nums)) != len(nums):
        problems.append("segment numbers are not in increasing order or repeat")
    return segments, problems


def main():
    root = Path.cwd()
    report, problems = {}, []

    script = root / "script.md"
    if not script.is_file():
        problems.append("missing script.md (the same text sent to the voice tool, one numbered line per segment)")
        segments = []
    else:
        segments, p = parse_script(script.read_text(encoding="utf-8"))
        problems += p
    report["segments"] = len(segments)

    voice = sorted(p for p in (root / "voice").glob("*") if p.suffix.lower() in AUDIO) if (root / "voice").is_dir() else []
    report["voice"] = [v.name for v in voice]
    if not voice:
        problems.append("no audio file in voice/")
    elif len(voice) > 1:
        problems.append(f"{len(voice)} files in voice/: keep only the final take, or pass --voice to align_voice.py")

    imgs = sorted(p for p in (root / "images").glob("*") if p.suffix.lower() in IMAGES) if (root / "images").is_dir() else []
    by_num = {}
    for p in imgs:
        k = number_of(p)
        if k is None:
            problems.append(f"image without a number in its name: {p.name}")
        elif k in by_num:
            problems.append(f"two images share number {k}: {by_num[k]} and {p.name}")
        else:
            by_num[k] = p.name
    report["images"] = len(imgs)
    for s in segments:
        missing = [k for k in s["images"] if k not in by_num]
        if missing:
            problems.append(f"segment {s['n']}: image {missing} not found in images/")
        s["image_files"] = [by_num[k] for k in s["images"] if k in by_num]
    unused = sorted(set(by_num) - {k for s in segments for k in s["images"]})
    if segments and unused:
        # Not a problem: link_images.py assigns these to segments without {صورة} markers.
        report["images_for_auto_linking"] = [by_num[k] for k in unused]

    # A reference can be a video, still images (infographic, Pinterest pin, screenshot) or both.
    ref_dir = root / "reference"
    ref_videos = sorted(p for p in ref_dir.glob("*") if p.suffix.lower() in VIDEO) if ref_dir.is_dir() else []
    ref_images = sorted(p for p in ref_dir.glob("*") if p.suffix.lower() in IMAGES) if ref_dir.is_dir() else []
    report["reference"] = [r.name for r in ref_videos + ref_images]
    report["reference_kind"] = ("video+images" if ref_videos and ref_images else "video" if ref_videos
                                else "images" if ref_images else None)
    if not report["reference_kind"]:
        problems.append("no reference in reference/ (a video, or images such as an infographic or a Pinterest pin)")
    elif report["reference_kind"] == "images" and not (ref_dir / "notes.md").is_file():
        problems.append("reference is images only: motion and transitions are not in a still image; "
                        "ask the user for reference/notes.md or propose motion that fits the look")

    # Optional notes the user may add; read them before writing the style card.
    report["notes"] = [n for n in ("request.md", "brand.md", "reference/notes.md", "voice/style-prompt.md", "voice/style-prompt.txt")
                       if (root / n).is_file()]
    brand = root / "brand.md"
    if brand.is_file() and not re.search(r"#[0-9a-fA-F]{6}\b", brand.read_text(encoding="utf-8")):
        report["notes"].remove("brand.md")  # still the empty template: use the reference's colours
    if not (root / "request.md").is_file():
        problems.append("no request.md: format and target duration will follow the reference (ask the user to confirm)")
    report["user_sfx"] = len([p for p in (root / "sfx").glob("*") if p.suffix.lower() in AUDIO]) if (root / "sfx").is_dir() else 0

    if segments:
        (root / "plan").mkdir(exist_ok=True)
        (root / "plan" / "script.json").write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")
        report["written"] = "plan/script.json"
    blocking = [p for p in problems if (p.startswith(("missing", "no ")) and "request.md" not in p) or "not found" in p]
    report["blocking"] = blocking
    report["warnings"] = [p for p in problems if p not in blocking]
    report["ready"] = not blocking and bool(segments)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if report["ready"] else 1)


if __name__ == "__main__":
    main()
