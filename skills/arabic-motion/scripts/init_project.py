#!/usr/bin/env python3
"""Create a video project folder with a place for each input the user prepares.
Never overwrites existing files.

Usage:  python <skill>/scripts/init_project.py <project-folder> [--title "..."]
"""
import argparse
import sys
import datetime
import shutil
from pathlib import Path

# Arabic text must print even on consoles with a legacy code page (e.g. cp1256).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SKILL = Path(__file__).resolve().parent.parent
FOLDERS = ["voice", "images", "reference", "sfx", "fonts", "plan", "qa", "exports"]

SCRIPT_MD = """# السكربت: نفس النص الذي حوّلته إلى صوت، سطر لكل مقطع بترقيم
# [أقواس مربعة] = تاجات الصوت كما أرسلتها لأداة الصوت (تُحذف من الشاشة وتحدد طابع الحركة)
# {أقواس معقوفة} = علاماتك: {صورة 1} أو {صورة 2,3} ، و {على الشاشة: نص مختصر}
# الأسطر التي تبدأ بـ # تُتجاهل. احذف المثالين واكتب سكربتك.

1. [excited] هل تعرف أن ٩٠٪ من خريجينا توظفوا خلال سنة؟ {صورة 1} {على الشاشة: ٩٠٪ توظفوا خلال سنة}
2. [calm] لأن برامجنا مبنية مع جهات التوظيف نفسها. {صورة 2}
"""

REQUEST_MD = """# طلب التنفيذ
- المقاس: عمودي
- المدة المستهدفة بالثواني: 30
- الجودة: 1080p
- ألوان: من brand.md إن وُجد، وإلا من المرجع
- ملاحظات المشاهد:
  - 
"""

BRAND_MD = """# الهوية (اختياري: احذف الملف إن لم تكن لديك هوية محددة)
- الخلفية: #
- النص: #
- اللون البارز: #
- خط العناوين: 
- خط النص: 
- الشعار: images/logo.png (اختياري)
"""

PROJECT_MD = """# {title}

- Created: {date}
- Status: waiting for inputs

## Inputs
- [ ] script.md
- [ ] voice/
- [ ] images/
- [ ] reference/
- [ ] request.md (format, duration, quality)
- [ ] brand.md (optional)
- [ ] reference/notes.md (optional)
- [ ] voice/style-prompt.md (optional)
- [ ] sfx/ (optional)

## Decisions
-

## Rounds
| # | Date | What changed | User feedback |
|---|------|--------------|---------------|
"""


def copy_tree(src: Path, dst: Path, root: Path, created: list):
    for f in src.rglob("*"):
        if f.is_dir() or "node_modules" in f.parts:
            continue
        target = dst / f.relative_to(src)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
        created.append(str(target.relative_to(root)))


def write_new(path: Path, text: str, root: Path, created: list):
    if not path.exists():
        path.write_text(text, encoding="utf-8")
        created.append(str(path.relative_to(root)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--title", default=None)
    a = ap.parse_args()

    root = Path(a.project).resolve()
    root.mkdir(parents=True, exist_ok=True)
    created = []
    for d in FOLDERS:
        (root / d).mkdir(parents=True, exist_ok=True)
    copy_tree(SKILL / "templates" / "render", root / "render", root, created)
    write_new(root / "script.md", SCRIPT_MD, root, created)
    write_new(root / "request.md", REQUEST_MD, root, created)
    write_new(root / "brand.md", BRAND_MD, root, created)
    write_new(root / "PROJECT.md", PROJECT_MD.format(title=a.title or root.name, date=datetime.date.today().isoformat()), root, created)
    print(f"project: {root}")
    print("created:" if created else "nothing new (existing files kept)")
    for c in created:
        print("  " + c)
    print("next: the user fills script.md, request.md, voice/, images/, reference/ (optionally brand.md, reference/notes.md, sfx/), then run check_inputs.py")


if __name__ == "__main__":
    main()
