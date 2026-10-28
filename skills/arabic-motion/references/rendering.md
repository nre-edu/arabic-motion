# الرندر الحتمي

## الفكرة
كل إطار دالة في الزمن فقط: `draw(ctx, t)`. لا ساعة متصفح، ولا `requestAnimationFrame`، ولا حالة تتراكم من إطار لآخر. لذلك يمكن رندر أي إطار منفردًا، وإعادة الرندر تعطي نفس البكسلات.

المسار: `render.mjs` يشغّل Chromium بلا واجهة عبر Playwright، ويخدم ملفات المشروع من خادم محلي على `127.0.0.1`، ويطلب كل إطار من الصفحة كصورة، ويمررها إلى FFmpeg مباشرة.

## مشهد التركيب: `render/scenes/story.js`
المشهد الأساسي للمهارة. لا يحتاج تعديلًا في أغلب المشاريع؛ يقرأ:
- `plan/beats.json`: المقاطع بتوقيتها في الصوت، والنص، والصور، والطابع.
- `plan/style.json`: الأسلوب كأرقام (القالب في `templates/style.example.json`، والحقول مشروحة في [تحليل المرجع](reference-analysis.md)).
- `images/`: صور المستخدم.

ما يفعله:
- يضع الصوت بعد `leadIn` ثانية، وينهي الفيديو بعد آخر مقطع بـ `tail` ثانية.
- كل صورة لقطة؛ المقطع ذو الصورتين يقسم وقته بينهما. المقطع بلا صورة يعرض نصه في الوسط بحجم أكبر.
- المقطع يبقى حتى بداية المقطع التالي، فالوقفات لا تترك فراغًا.
- طابع المقطع يغيّر سرعة ظهور النص ونوعه: حماس أسرع بـ `pop`، هدوء أبطأ بـ `fade`، جدية بنص أكبر.
- الإشارات الصوتية تُبنى من نفس الأوقات، فأي تعديل في `beats.json` يحرك الصورة والمؤثرات معًا.

**متى تعدّل `story.js` في المشروع:** افتتاح خاص من المرجع، عنصر ثابت (شعار في الزاوية، عنوان قسم)، ختام بشعار، أو انتقال غير موجود في الخيارات. أضف الكود في `draw` واقرأ الأوقات من `B.beats` لا من أرقام ثابتة. لا تعدّل نسخة القالب في مجلد المهارة.

## واجهة أي مشهد
```js
export default {
  width: 1080, height: 1920, fps: 30, duration: 8,
  fonts: [{ family: 'Cairo', src: 'fonts/cairo/Cairo-Variable.ttf' }],
  async load() { /* اختياري: يقرأ ملفات الخطة ويضبط المقاس والمدة والخطوط */ },
  cues: () => [{ at: 0.4, sound: 'whoosh', gain: -8 }],
  audio: { voice: { file: 'voice/take.wav', at: 0.4, gain: 0 } },   // اختياري
  setup(ctx, api) { return { /* تخطيطات وصور محمّلة مرة واحدة */ }; },
  draw(ctx, t, api, state) { /* ارسم الإطار عند الثانية t */ },
};
```
- الإحداثيات بمقاس المشهد الكامل حتى في المعاينة بنصف الدقة؛ التحجيم تلقائي.
- `api` يحوي: `width`، `height`، `ease`، `progress`، `lerp`، `clamp`، `mapRange`، `keys`، `spring`، `rng`، و`arabic` (دوال `lib/arabic.js`).
- المسارات نسبية لجذر المشروع.
- `render/scenes/demo.js` مشهد صغير مستقل لاختبار البيئة فقط.

## قواعد الحتمية
1. العشوائية من `rng(seed)` فقط، وتُنشأ في `setup()`. لا `Math.random()`.
2. الجسيمات والفيزياء: احسبها مسبقًا في `setup()` بخطوة ثابتة، ثم اقرأ منها حسب `t`.
3. الحركة من `progress(t, start, dur)` مع دالة تسهيل. `spring()` صيغة مغلقة بلا حالة.
4. الصور تُحمَّل في `setup()` وتُعاد ضمن `state`.
5. داخل `ctx.save()` استعمل `ctx.globalAlpha *= ...` لا `=`، حتى يبقى تلاشي المجموعة الأم فعّالًا.

## الأوامر
من جذر المشروع:

```bash
node render/render.mjs --scene render/scenes/story.js --sheet qa/sheet-v1.png --times 0,1,2.5,4,6,8
```
```bash
node render/render.mjs --scene render/scenes/story.js --stills qa/frame --times 0,1.5
```
```bash
node render/render.mjs --scene render/scenes/story.js --out exports/video-preview-v1.mp4 --scale 0.5 --format jpeg
```
```bash
node render/render.mjs --scene render/scenes/story.js --out exports/video-final.mp4
```

خيارات أخرى: `--from` و`--to` لرندر جزء، `--fps`، `--crf` (الجودة، الافتراضي 18)، `--preset`، `--ffmpeg <path>`. متغيرا البيئة `AM_FFMPEG` و`AM_CHROMIUM` يحددان المسارات إن لم تكن في PATH.

بلا `--times`، ورقة اللقطات تأخذ 6 أوقات موزعة على الفيديو. لورقة تقابل المرجع، استعمل بدايات المقاطع زائد نصف ثانية من `beats.json`.

كل رندر فيديو يكتب بجانبه `<name>.cues.json` (المؤثرات وموضع التعليق)، وهو مدخل `scripts/mix_audio.py`.

## الأداء
- PNG أدق، وJPEG (`--format jpeg`) أسرع؛ استعمل JPEG للمعاينات.
- `ctx.filter = 'blur(...)'` و`shadowBlur` مكلفان؛ استعملهما على عناصر قليلة.
- زمن الرندر على الأجهزة المختلفة: غير مُتحقَّق بقياس منهجي. سجّل زمن أول رندر في `PROJECT.md` لتقدير الباقي.
