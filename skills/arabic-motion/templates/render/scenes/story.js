// Assembly scene: builds the video from the user's own material.
//   plan/beats.json  segments with start/end in the voice file, screen text, images, mood
//   plan/style.json  the approved style card as numbers (layout, motion, transitions, sfx)
//   images/          the user's images
// Edit plan/style.json first; change this file only for what the style options cannot express.

let B; // beats file
let S; // style

const MOOD = {
  neutral: { speed: 1, effect: null, sfx: null },
  energetic: { speed: 0.7, effect: 'pop', sfx: 'emphasis' },
  calm: { speed: 1.4, effect: 'fade', sfx: null },
  serious: { speed: 1.15, effect: 'rise', sfx: null },
};

function shots() {
  // One shot per image; a segment with several images splits its time evenly.
  // A segment runs from its start to the next segment's start, so pauses stay on screen.
  const out = [];
  B.beats.forEach((b, i) => {
    const from = S.leadIn + b.start;
    const to = i + 1 < B.beats.length ? S.leadIn + B.beats[i + 1].start : S.leadIn + b.end + S.tail;
    const files = b.image_files?.length ? b.image_files : [null];
    files.forEach((f, k) => {
      const len = (to - from) / files.length;
      out.push({ beat: i, image: f, start: from + k * len, end: from + (k + 1) * len });
    });
  });
  return out;
}

const scene = {
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 1,
  fonts: [],
  audio: null,

  async load() {
    B = await (await fetch('/plan/beats.json', { cache: 'no-store' })).json();
    S = await (await fetch('/plan/style.json', { cache: 'no-store' })).json();
    Object.assign(scene, S.format);
    scene.fonts = Object.values(S.fonts);
    const last = B.beats[B.beats.length - 1];
    scene.duration = +(S.leadIn + last.end + S.tail).toFixed(3);
    scene.audio = { voice: { file: B.voice, at: S.leadIn, gain: S.voiceGain ?? 0 } };
  },

  cues() {
    const list = [];
    const sfx = S.sfx ?? {};
    const gain = sfx.gain ?? -10;
    shots().forEach((s, i) => {
      if (i > 0 && sfx.transition) list.push({ at: +(s.start - 0.08).toFixed(3), sound: sfx.transition, gain });
    });
    B.beats.forEach((b, i) => {
      const at = +textStart(b, i).toFixed(3);
      const m = MOOD[b.mood] ?? MOOD.neutral;
      if (m.sfx && sfx.emphasis) list.push({ at, sound: sfx.emphasis, gain: gain + 2 });
      else if (sfx.text && i > 0) list.push({ at, sound: sfx.text, gain: gain - 4 });
    });
    return list.filter((c) => c.at >= 0);
  },

  async setup(ctx, api) {
    const { arabic } = api;
    const images = {};
    for (const b of B.beats) {
      for (const f of b.image_files ?? []) {
        if (images[f]) continue;
        const blob = await (await fetch('/images/' + encodeURIComponent(f))).blob();
        images[f] = await createImageBitmap(blob);
      }
    }
    const T = S.text;
    const area = S.image.area;
    const texts = B.beats.map((b) => {
      const words = (b.onscreen ?? '').trim();
      if (!words) return null;
      const noImage = !(b.image_files?.length);
      const size = noImage ? T.size * 1.4 : T.size * (b.mood === 'serious' ? 1.1 : 1);
      const maxWidth = scene.width - 2 * T.margin;
      const l = arabic.layout(ctx, words, { family: S.fonts.body.family, weight: S.fonts.body.weight, size, maxWidth, x: scene.width / 2, y: 0 });
      // Vertical placement inside the safe area.
      const safeTop = 220, safeBottom = scene.height - 360;
      let y;
      if (noImage || T.position === 'center') y = (scene.height - l.height) / 2;
      else if (T.position === 'top') y = safeTop;
      else if (S.image.layout === 'card') y = Math.min(area.y + area.h + 70, safeBottom - l.height);
      else y = safeBottom - l.height;
      return arabic.layout(ctx, words, { family: S.fonts.body.family, weight: S.fonts.body.weight, size, maxWidth, x: scene.width / 2, y });
    });
    return { images, texts, shots: shots() };
  },

  draw(ctx, t, api, st) {
    const { width: W, height: H, ease, progress, lerp, arabic } = api;
    const P = S.palette;
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, W, H);

    // Current shot and, during a transition, the previous one.
    const i = Math.max(0, st.shots.findIndex((s) => t >= s.start && t < s.end));
    const idx = t >= st.shots[st.shots.length - 1].start ? st.shots.length - 1 : i;
    const cur = st.shots[idx];
    const tr = S.transition;
    const tp = idx > 0 && tr.type !== 'cut' ? ease.inOutCubic(progress(t, cur.start, tr.dur)) : 1;
    if (tp < 1) drawShot(ctx, api, st, st.shots[idx - 1], t, 1 - tp, tr.type, 'out');
    drawShot(ctx, api, st, cur, t, tp, tr.type, 'in');

    // Segment text. The outgoing segment's text stays until the transition carries it away,
    // so a segment without an image never leaves an empty frame.
    const prev = idx > 0 ? st.shots[idx - 1] : null;
    // Outgoing text is gone by the middle of the transition, before the new text starts.
    if (tp < 1 && prev && prev.beat !== cur.beat) drawText(ctx, api, st, prev.beat, t, Math.max(0, 1 - tp * 2));
    drawText(ctx, api, st, cur.beat, t, 1);

    // Optional progress bar (right to left).
    if (S.progressBar) {
      ctx.fillStyle = P.accent;
      const p = Math.min(1, t / scene.duration);
      ctx.fillRect(W - W * p, H - 12, W * p, 12);
    }
  },
};

// When a segment's text starts: after the configured delay, and never before the middle of
// the transition into it, so two segments' texts never share the screen. Cues use it too.
function textStart(beat, i) {
  const tr = S.transition;
  const wait = i > 0 && tr.type !== 'cut' ? tr.dur * 0.5 : 0;
  return S.leadIn + beat.start + Math.max(S.text.delay ?? 0.1, wait);
}

function drawText(ctx, api, st, b, t, alpha) {
  const l = st.texts[b];
  if (!l || alpha <= 0) return;
  const { width: W, progress, arabic } = api;
  const beat = B.beats[b];
  const m = MOOD[beat.mood] ?? MOOD.neutral;
  const start = textStart(beat, b);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (S.text.box) {
    ctx.save();
    ctx.globalAlpha *= 0.85 * progress(t, start - 0.1, 0.25);
    ctx.fillStyle = S.palette.surface;
    ctx.beginPath();
    ctx.roundRect(S.text.margin - 30, l.words[0].top - 30, W - 2 * S.text.margin + 60, l.height + 60, 28);
    ctx.fill();
    ctx.restore();
  }
  arabic.drawWords(ctx, l, t, {
    start, stagger: S.text.stagger * m.speed, dur: 0.45 * m.speed,
    effect: m.effect ?? S.text.effect, color: S.palette.text,
  });
  ctx.restore();
}

// 'auto' (default): show the whole image when cropping would lose content, that is an
// infographic/chart by name or an image whose proportions differ clearly from its frame.
const INFOGRAPHIC = /chart|graph|info|diagram|انفو|إنفو|رسم|مخطط|جدول/i;
function fitMode(name, img, a) {
  const f = S.image.fit ?? 'auto';
  if (f !== 'auto') return f;
  if (INFOGRAPHIC.test(name ?? '')) return 'contain';
  const r = img.width / img.height / (a.w / a.h);
  return r > 1.25 || r < 0.8 ? 'contain' : 'cover';
}

function drawShot(ctx, api, st, shot, t, p, type, dir) {
  const { width: W, height: H, lerp, progress, ease } = api;
  const img = shot.image ? st.images[shot.image] : null;
  const P = S.palette;
  ctx.save();
  if (type === 'fade') ctx.globalAlpha *= p;
  else if (type === 'slide') ctx.translate(dir === 'in' ? (1 - p) * W : -(1 - p) * W * 0.3, 0); // new shot enters from the right
  else if (type === 'wipe' && dir === 'in') {
    ctx.beginPath();
    ctx.rect(W - W * p, 0, W * p, H);
    ctx.clip();
  }

  if (img) {
    const k = progress(t, shot.start, shot.end - shot.start);
    const m = S.image.motion;
    const zoom = m === 'push-in' ? lerp(1, 1 + S.image.amount, k) : m === 'pull-out' ? lerp(1 + S.image.amount, 1, k) : 1;
    const panX = m === 'pan' ? lerp(1, -1, ease.inOutQuad(k)) * S.image.amount * 400 : 0;
    const full = S.image.layout === 'full';
    const a = full ? { x: 0, y: 0, w: W, h: H } : S.image.area;
    const contain = fitMode(shot.image, img, a) === 'contain';
    const fit = contain ? Math.min(a.w / img.width, a.h / img.height) : Math.max(a.w / img.width, a.h / img.height);
    const w = img.width * fit * zoom;
    const h = img.height * fit * zoom;
    ctx.save();
    ctx.beginPath();
    full ? ctx.rect(a.x, a.y, a.w, a.h) : ctx.roundRect(a.x, a.y, a.w, a.h, S.image.radius ?? 0);
    if (!full && contain) {
      ctx.fillStyle = P.surface;
      ctx.fill();
    }
    ctx.clip();
    ctx.drawImage(img, a.x + (a.w - w) / 2 + panX, a.y + (a.h - h) / 2, w, h);
    ctx.restore();
    if (full) {
      // Darken the bottom so screen text stays readable over any image.
      const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}

export default scene;
