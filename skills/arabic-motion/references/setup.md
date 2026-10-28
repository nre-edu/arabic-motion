# التجهيز والمتطلبات

## ما تحتاجه
| الأداة | الحاجة | الغرض |
|---|---|---|
| وكيل بصلاحية ملفات وأوامر (مثل Claude Code) | ضروري للرندر | تشغيل السكربتات على جهاز المستخدم |
| Python 3.9+ | ضروري | سكربتات الفحص والخطوط والصوت (مكتبة قياسية فقط) |
| Node.js 18+ | ضروري | تشغيل `render.mjs` |
| FFmpeg | ضروري | ترميز الفيديو وخلط الصوت |
| Playwright + Chromium | ضروري | رسم الإطارات (يُثبَّت داخل مجلد `render/` في المشروع) |
| اتصال إنترنت | اختياري | تنزيل الخطوط ومؤثرات Openverse |

في واجهات المحادثة بلا وصول للملفات، تعمل المهارة للتخطيط فقط: الموجز، والخطة، وكود المشهد. الرندر يحتاج جهاز المستخدم.

## الفحص أولًا
```bash
python <skill>/scripts/check_env.py
```
يطبع ما هو موجود وما هو ناقص (`missing`)، ولا يثبّت شيئًا. اشرح الناقص للمستخدم بجملة لكل عنصر.

## التثبيت (بإذن المستخدم، عنصرًا عنصرًا)
اطلب الموافقة قبل كل أمر تثبيت، واذكر ما سيُنزَّل وحجمه التقريبي.

**FFmpeg**
- Windows: `winget install --id Gyan.FFmpeg -e` (ثم افتح طرفية جديدة ليظهر في PATH).
- macOS: `brew install ffmpeg`.
- Linux (Debian/Ubuntu): `sudo apt install ffmpeg`.

**Node.js**
- Windows: `winget install --id OpenJS.NodeJS.LTS -e`.
- macOS: `brew install node`.

**Playwright وChromium** (من جذر المشروع، بعد `init_project.py`):
```bash
npm install --prefix render
```
```bash
npx --prefix render playwright install chromium
```
Chromium نحو 150 إلى 200 ميغابايت، ويُحفظ في ذاكرة Playwright المشتركة فيُستعمل لكل المشاريع.

إن كان FFmpeg أو Chromium في مسار غير قياسي: عيّن `AM_FFMPEG` أو `AM_CHROMIUM`.

## مشروع جديد
```bash
python "<skill>/scripts/init_project.py" "<project-folder>" --title "<title>"
```
بعدها يجهّز المستخدم ملفاته وفق [تجهيز الملفات](inputs.md).

## اختبار البيئة (اختياري، قبل أول مشروع)
من داخل مجلد المشروع، بلا ملفات المستخدم:
```bash
python "<skill>/scripts/get_font.py" cairo
```
```bash
python "<skill>/scripts/synth_sfx.py"
```
```bash
node render/render.mjs --scene render/scenes/demo.js --out qa/env-test.mp4 --scale 0.5
```
```bash
python "<skill>/scripts/mix_audio.py" qa/env-test.mp4 --out qa/env-test-mix.mp4
```
إن نجحت فالبيئة جاهزة. `demo.js` مشهد اختبار فقط؛ الفيديو الحقيقي يُبنى بـ `story.js`.

## تحديد `<skill>`
`<skill>` هو المجلد الذي فيه `SKILL.md` هذا (في Claude Code غالبًا `~/.claude/skills/arabic-motion`). لا تفترض أنه مجلد العمل الحالي. ضع المسارات بين علامتي تنصيص لأن أسماء المجلدات العربية والمسافات شائعة.

## ملاحظات Windows
- المسارات العربية تعمل، لكن ضعها دائمًا بين علامتي تنصيص.
- إن ظهرت رسالة `ffmpeg is not recognized` بعد التثبيت، أعد فتح الطرفية أو عيّن `AM_FFMPEG` إلى المسار الكامل لـ `ffmpeg.exe`.
- في PowerShell 5 استعمل `;` بدل `&&` للربط بين الأوامر.
