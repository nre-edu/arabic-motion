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

const lastEnd = () => S.leadIn + B.beats[B.beats.length - 1].end + S.tail;

function shots() {
  // One shot per image; a segment with several images splits its time evenly.
  // A segment runs from its start to the next segment's start, so pauses stay on screen.
  const out = [];
  B.beats.forEach((b, i) => {
    const from = S.leadIn + b.start;
    const to = i + 1 < B.beats.length ? S.leadIn + B.beats[i + 1].start : lastEnd();
    const files = b.image_files?.length ? b.image_files : [null];
    files.forEach((f, k) => {
      const len = (to - from) / files.length;
      out.push({ beat: i, image: f, start: from + k * len, end: from + (k + 1) * len });
    });
  });
  if (S.endCard) out.push({ beat: -1, endCard: true, start: lastEnd(), end: lastEnd() + S.endCard.dur });
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
    scene.duration = +(lastEnd() + (S.endCard?.dur ?? 0)).toFixed(3);
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
    const W = scene.width, H = scene.height;
    const images = {};
    for (const b of B.beats) {
      for (const f of b.image_files ?? []) {
        if (images[f]) continue;
        const blob = await (await fetch('/images/' + encodeURIComponent(f))).blob();
        images[f] = await createImageBitmap(blob);
      }
    }

    // Screen text per segment, as one block or as timed caption chunks.
    const T = S.text;
    const font = S.fonts.body;
    const maxWidth = W - 2 * T.margin;
    const place = (words, size, noImage) => {
      const probe = arabic.layout(ctx, words, { family: font.family, weight: font.weight, size, maxWidth, x: W / 2, y: 0 });
      const vertical = W > H; // wide frames keep text in a bottom band
      const safeTop = vertical ? 60 : 220;
      const safeBottom = H - (vertical ? 50 : 360);
      let y;
      if (noImage || T.position === 'center') y = (H - probe.height) / 2;
      else if (T.position === 'top') y = safeTop;
      else if (S.image.layout === 'card' && !vertical) y = Math.min(S.image.area.y + S.image.area.h + 70, safeBottom - probe.height);
      else y = safeBottom - probe.height;
      return arabic.layout(ctx, words, { family: font.family, weight: font.weight, size, maxWidth, x: W / 2, y });
    };
    const texts = B.beats.map((b, i) => {
      const words = (b.onscreen ?? '').trim();
      if (!words) return null;
      const noImage = !(b.image_files?.length);
      const size = noImage ? T.size * 1.4 : T.size * (b.mood === 'serious' ? 1.1 : 1);
      const start = textStart(b, i);
      const end = i + 1 < B.beats.length ? S.leadIn + B.beats[i + 1].start : lastEnd();
      if (T.mode !== 'captions') return [{ l: place(words, size, noImage), start, end }];
      // Captions: short chunks, each shown for a share of the spoken time proportional to its length.
      // An estimate without word timings: the voice and the chunk may drift by a fraction of a second.
      const chunks = captionChunks(words, T.maxWords ?? 8);
      const speechEnd = S.leadIn + b.end;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      let t0 = start;
      return chunks.map((c, k) => {
        const len = ((speechEnd - start) * c.length) / total;
        const piece = { l: place(c, size, noImage), start: t0, end: k === chunks.length - 1 ? end : t0 + len };
        t0 += len;
        return piece;
      });
    });

    // End card text.
    let end = null;
    if (S.endCard) {
      const E = S.endCard;
      const title = arabic.layout(ctx, E.title, { family: font.family, weight: 800, size: E.titleSize ?? Math.round(W * 0.045), maxWidth: W * 0.8, x: W / 2, y: H * 0.36 });
      const sub = E.subtitle
        ? arabic.layout(ctx, E.subtitle, { family: font.family, weight: 500, size: E.subtitleSize ?? Math.round(W * 0.024), maxWidth: W * 0.8, x: W / 2, y: H * 0.36 + title.height + H * 0.06 })
        : null;
      end = { title, sub };
    }
    return { images, texts, shots: shots(), end };
  },

  draw(ctx, t, api, st) {
    const { width: W, height: H, ease, progress } = api;
    drawBackground(ctx, api, t);

    // Current shot and, during a transition, the previous one.
    const i = Math.max(0, st.shots.findIndex((s) => t >= s.start && t < s.end));
    const idx = t >= st.shots[st.shots.length - 1].start ? st.shots.length - 1 : i;
    const cur = st.shots[idx];
    const tr = S.transition;
    const tp = idx > 0 && tr.type !== 'cut' ? ease.inOutCubic(progress(t, cur.start, tr.dur)) : 1;
    if (tp < 1) drawShot(ctx, api, st, st.shots[idx - 1], t, 1 - tp, tr.type, 'out');
    drawShot(ctx, api, st, cur, t, tp, tr.type, 'in');

    // Segment text. The outgoing segment's text is gone by the middle of the transition,
    // before the new text starts, so two segments never share the screen.
    const prev = idx > 0 ? st.shots[idx - 1] : null;
    if (tp < 1 && prev && prev.beat !== cur.beat && prev.beat >= 0) drawText(ctx, api, st, prev.beat, t, Math.max(0, 1 - tp * 2));
    if (cur.beat >= 0) drawText(ctx, api, st, cur.beat, t, 1);

    // Optional progress bar (right to left).
    if (S.progressBar) {
      ctx.fillStyle = S.palette.accent;
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

// Split screen text into caption chunks of at most `max` words, preferring to break after
// punctuation. Whole words only, so Arabic letters keep their joins.
function captionChunks(text, max) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = [];
  const ends = /[.،,؛;:؟?!…]$/;
  words.forEach((w, i) => {
    cur.push(w);
    const left = words.length - i - 1;
    const natural = ends.test(w) && cur.length >= Math.ceil(max / 2);
    if ((cur.length >= max || natural) && left > 0 && !(left < 3 && !natural)) {
      out.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) out.push(cur.join(' '));
  return out;
}

function drawText(ctx, api, st, b, t, alpha) {
  const pieces = st.texts[b];
  if (!pieces || alpha <= 0) return;
  const { width: W, progress, arabic } = api;
  const m = MOOD[B.beats[b].mood] ?? MOOD.neutral;
  for (const { l, start, end } of pieces) {
    if (t < start || t > end + 0.2) continue;
    const words = l.words.length;
    // Keep the word-by-word entrance short enough to finish inside the chunk.
    const stagger = Math.min(S.text.stagger * m.speed, ((end - start) * 0.4) / Math.max(1, words));
    const out = pieces.length > 1 ? 1 - progress(t, end, 0.15) : 1;
    ctx.save();
    ctx.globalAlpha *= alpha * out;
    if (S.text.box) {
      ctx.save();
      ctx.globalAlpha *= 0.85 * progress(t, start - 0.1, 0.2);
      ctx.fillStyle = S.palette.surface;
      ctx.beginPath();
      ctx.roundRect(S.text.margin - 30, l.words[0].top - 24, W - 2 * S.text.margin + 60, l.height + 48, 24);
      ctx.fill();
      ctx.restore();
    }
    arabic.drawWords(ctx, l, t, { start, stagger, dur: 0.4 * m.speed, effect: m.effect ?? S.text.effect, color: S.palette.text });
    ctx.restore();
  }
}

// Background: flat colour, or a gradient with slowly drifting soft glows (deterministic in t).
function drawBackground(ctx, api, t) {
  const { width: W, height: H } = api;
  const bg = S.background;
  if (!bg || bg.type !== 'gradient') {
    ctx.fillStyle = S.palette.bg;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, W, H);
  bg.colors.forEach((c, i) => g.addColorStop(i / Math.max(1, bg.colors.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const [i, glow] of (bg.glows ?? []).entries()) {
    const drift = bg.drift ?? 0.04;
    const x = (glow.x + Math.sin(t * 0.25 + i * 1.7) * drift) * W;
    const y = (glow.y + Math.cos(t * 0.21 + i * 2.3) * drift) * H;
    const r = glow.r * Math.max(W, H);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, glow.color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
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
  ctx.save();
  if (type === 'fade') ctx.globalAlpha *= p;
  else if (type === 'slide') ctx.translate(dir === 'in' ? (1 - p) * W : -(1 - p) * W * 0.3, 0); // new shot enters from the right
  else if (type === 'whip') {
    // Fast swipe with motion blur, strongest mid-move: new shot from the right, old one out to the left.
    ctx.translate(dir === 'in' ? (1 - p) * W : -(1 - p) * W, 0);
    const blur = (S.transition.blur ?? 28) * Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
    if (blur > 0.5) ctx.filter = `blur(${blur.toFixed(1)}px)`;
  } else if (type === 'wipe' && dir === 'in') {
    ctx.beginPath();
    ctx.rect(W - W * p, 0, W * p, H);
    ctx.clip();
  }

  if (shot.endCard) {
    drawEndCard(ctx, api, st, t, shot);
    ctx.restore();
    return;
  }

  const img = shot.image ? st.images[shot.image] : null;
  if (img) {
    const k = progress(t, shot.start, shot.end - shot.start);
    const m = S.image.motion;
    const amount = S.image.amount ?? 0.06;
    const zoom = m === 'push-in' ? lerp(1, 1 + amount, k) : m === 'pull-out' ? lerp(1 + amount, 1, k) : 1;
    const panX = m === 'pan' ? lerp(1, -1, ease.inOutQuad(k)) * amount * 400 : 0;
    const layout = S.image.layout;
    if (layout === 'float') {
      // The image is a floating panel: its frame fits the whole image, and the camera push
      // grows the panel itself, so nothing inside it is ever cropped.
      const a = S.image.area;
      const base = Math.min(a.w / img.width, a.h / img.height) / (m === 'push-in' || m === 'pull-out' ? 1 + amount : 1);
      const w = img.width * base * zoom;
      const h = img.height * base * zoom;
      const x = a.x + (a.w - w) / 2 + panX;
      const y = a.y + (a.h - h) / 2;
      const r = S.image.radius ?? 0;
      ctx.save();
      ctx.shadowColor = S.image.glow ?? 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = S.image.glowSize ?? 50;
      ctx.fillStyle = S.palette.surface;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    } else {
      const full = layout === 'full';
      const a = full ? { x: 0, y: 0, w: W, h: H } : S.image.area;
      const contain = fitMode(shot.image, img, a) === 'contain';
      const fit = contain ? Math.min(a.w / img.width, a.h / img.height) : Math.max(a.w / img.width, a.h / img.height);
      const w = img.width * fit * zoom;
      const h = img.height * fit * zoom;
      ctx.save();
      ctx.beginPath();
      full ? ctx.rect(a.x, a.y, a.w, a.h) : ctx.roundRect(a.x, a.y, a.w, a.h, S.image.radius ?? 0);
      if (!full && contain) {
        ctx.fillStyle = S.palette.surface;
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
  }
  ctx.restore();
}

function drawEndCard(ctx, api, st, t, shot) {
  const { width: W, height: H, arabic } = api;
  const E = S.endCard;
  ctx.fillStyle = E.bg ?? S.palette.bg;
  ctx.fillRect(0, 0, W, H);
  if (E.accent) {
    ctx.fillStyle = E.accent;
    const bar = Math.min(1, Math.max(0, (t - shot.start - 0.2) / 0.6));
    ctx.fillRect(W / 2 - (W * 0.08 * bar), st.end.title.words[0].top - H * 0.06, W * 0.16 * bar, 6);
  }
  arabic.drawWords(ctx, st.end.title, t, { start: shot.start + 0.3, stagger: 0.08, dur: 0.5, effect: 'rise', color: E.titleColor ?? S.palette.text });
  if (st.end.sub) arabic.drawWords(ctx, st.end.sub, t, { start: shot.start + 0.9, stagger: 0.06, dur: 0.5, effect: 'fade', color: E.subtitleColor ?? S.palette.muted });
}

export default scene;
