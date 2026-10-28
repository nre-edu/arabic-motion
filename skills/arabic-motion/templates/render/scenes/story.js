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
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function shots() {
  // One shot per image; a segment with several images splits its time evenly.
  // A segment runs from its start to the next segment's start, so pauses stay on screen.
  // With image.split, a long single-image segment gets a second "detail" shot: the camera
  // moves closer to a point of the same image, keeping the reference's shot pace.
  const out = [];
  const split = S.image.split;
  B.beats.forEach((b, i) => {
    const from = S.leadIn + b.start;
    const to = i + 1 < B.beats.length ? S.leadIn + B.beats[i + 1].start : lastEnd();
    const files = b.image_files?.length ? b.image_files : [null];
    files.forEach((f, k) => {
      const len = (to - from) / files.length;
      const s0 = from + k * len;
      if (split && f && files.length === 1 && len >= (split.minSegment ?? 6)) {
        const focus = split.details?.[f] ?? [0.5, 0.5, split.defaultZoom ?? 1.35];
        const mid = s0 + len * (split.at ?? 0.5);
        out.push({ beat: i, image: f, start: s0, end: mid });
        out.push({ beat: i, image: f, start: mid, end: s0 + len, detail: true, focus });
      } else {
        out.push({ beat: i, image: f, start: s0, end: s0 + len });
      }
    });
  });
  if (S.endCard) out.push({ beat: -1, endCard: true, start: lastEnd(), end: lastEnd() + S.endCard.dur });
  return out;
}

// The transition that brings a shot in: detail shots move the camera instead of cutting,
// and the end card may have its own transition.
function transitionFor(shot) {
  if (shot.detail) return { type: 'camera', dur: S.image.split?.moveDur ?? 0.9 };
  if (shot.endCard && S.endCard.transition) return S.endCard.transition;
  return S.transition;
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
      const tr = transitionFor(s);
      if (i > 0 && sfx.transition && tr.type !== 'camera' && tr.type !== 'cut') list.push({ at: +(s.start - 0.08).toFixed(3), sound: sfx.transition, gain });
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
      const wide = W > H; // wide frames keep text in a bottom band
      const safeTop = wide ? 60 : 220;
      const safeBottom = H - (wide ? 50 : 360);
      let y;
      if (noImage || T.position === 'center') y = (H - probe.height) / 2;
      else if (T.position === 'top') y = safeTop;
      else if (S.image.layout === 'card' && !wide) y = Math.min(S.image.area.y + S.image.area.h + 70, safeBottom - probe.height);
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

    // Short floating labels per segment (text.labels: {"<segment n>": "label"}), revealed by a mask.
    const L = T.labels ?? {};
    const lf = S.fonts.label ?? font;
    const labels = B.beats.map((b) =>
      L[b.n] ? arabic.layout(ctx, L[b.n], { family: lf.family, weight: lf.weight ?? 700, size: T.labelSize ?? 46, maxWidth: W * 0.8, x: W / 2, y: T.labelY ?? 30 }) : null);

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
    return { images, texts, labels, shots: shots(), end };
  },

  draw(ctx, t, api, st) {
    const { width: W, height: H, ease, progress } = api;
    drawBackground(ctx, api, t);

    // Current shot and, during a transition, the previous one.
    const i = Math.max(0, st.shots.findIndex((s) => t >= s.start && t < s.end));
    const idx = t >= st.shots[st.shots.length - 1].start ? st.shots.length - 1 : i;
    const cur = st.shots[idx];
    const prevShot = idx > 0 ? st.shots[idx - 1] : null;
    const tr = transitionFor(cur);
    const tp = prevShot && tr.type !== 'cut' && tr.type !== 'camera' ? ease.inOutCubic(progress(t, cur.start, tr.dur)) : 1;

    if (tr.type === 'panel' && tp < 1) {
      // A solid panel sweeps across from the right, then uncovers the new shot to the left.
      drawShot(ctx, api, st, tp < 0.5 ? prevShot : cur, t, 1, 'cut', 'in');
      ctx.fillStyle = tr.color ?? S.palette.accent;
      if (tp < 0.5) ctx.fillRect(W * (1 - tp * 2), 0, W * tp * 2, H);
      else ctx.fillRect(0, 0, W * (1 - (tp - 0.5) * 2), H);
    } else {
      if (tp < 1) drawShot(ctx, api, st, prevShot, t, 1 - tp, tr.type, 'out');
      drawShot(ctx, api, st, cur, t, tp, tr.type, 'in');
    }

    // Segment text and label. The outgoing segment's text is gone by the middle of the
    // transition, before the new text starts, so two segments never share the screen.
    if (tp < 1 && prevShot && prevShot.beat !== cur.beat && prevShot.beat >= 0) {
      const fade = Math.max(0, 1 - tp * 2);
      drawLabel(ctx, api, st, prevShot.beat, t, fade);
      drawText(ctx, api, st, prevShot.beat, t, fade);
    }
    if (cur.beat >= 0) {
      drawLabel(ctx, api, st, cur.beat, t, 1);
      drawText(ctx, api, st, cur.beat, t, 1);
    }

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

function drawLabel(ctx, api, st, b, t, alpha) {
  const l = st.labels?.[b];
  if (!l || alpha <= 0) return;
  const { arabic, progress, width: W } = api;
  const start = textStart(B.beats[b], b) - 0.05;
  ctx.save();
  ctx.globalAlpha *= alpha;
  arabic.drawWords(ctx, l, t, { start, stagger: 0.12, dur: 0.7, effect: 'wipe', color: S.text.labelColor ?? S.palette.text });
  // A thin accent line grows under the label in its reading direction.
  const p = progress(t, start + 0.2, 0.6);
  if (p > 0) {
    const right = Math.max(...l.words.map((w) => w.right));
    const left = Math.min(...l.words.map((w) => w.left));
    const width = (right - left) * p;
    ctx.fillStyle = S.palette.accent;
    ctx.fillRect(arabic.hasArabic(l.words[0].text) ? right - width : left, l.words[0].bottom + 10, width, 3);
  }
  ctx.restore();
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
    const blur = (S.transition.blur ?? 28) * Math.sin(Math.PI * clamp01(p));
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
    const m = S.image.motion;
    const amount = S.image.amount ?? 0.06;
    // A detail shot continues the previous shot's push, so the camera never jumps back.
    const span = shot.detail ? st.shots.filter((s) => s.beat === shot.beat && s.image === shot.image) : [shot];
    const k = progress(t, span[0].start, span[span.length - 1].end - span[0].start);
    const zoom = m === 'push-in' ? lerp(1, 1 + amount, k) : m === 'pull-out' ? lerp(1 + amount, 1, k) : 1;
    const panX = m === 'pan' ? lerp(1, -1, ease.inOutQuad(k)) * amount * 400 : 0;
    const layout = S.image.layout;
    if (layout === 'float') {
      drawFloat(ctx, api, st, shot, img, t, zoom, panX, k);
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

// Floating panel: the frame fits the whole image, the camera push grows the panel itself,
// a slow sideways drift adds depth, a detail shot moves closer to a point inside the image,
// and a new image "builds" in with a scale-up and a light sweep.
function drawFloat(ctx, api, st, shot, img, t, zoom, panX, k) {
  const { width: W, lerp, progress, ease } = api;
  const I = S.image;
  const a = I.area;
  const amount = I.amount ?? 0.06;
  const pushes = I.motion === 'push-in' || I.motion === 'pull-out';
  const base = Math.min(a.w / img.width, a.h / img.height) / (pushes ? 1 + amount : 1);
  const build = I.build && !shot.detail ? ease.outCubic(progress(t, shot.start, I.build.dur ?? 0.8)) : 1;
  const grow = lerp(I.build?.from ?? 0.92, 1, build);
  const w = img.width * base * zoom * grow;
  const h = img.height * base * zoom * grow;
  const drift = lerp(1, -1, k) * (I.drift ?? 0) * W;
  const x = a.x + (a.w - w) / 2 + panX + drift;
  const y = a.y + (a.h - h) / 2;
  const r = I.radius ?? 0;

  ctx.save();
  ctx.globalAlpha *= I.build && !shot.detail ? clamp01(build * 1.4) : 1;
  ctx.shadowColor = I.glow ?? 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = I.glowSize ?? 50;
  ctx.fillStyle = S.palette.surface;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();

  // Camera inside the panel: 1 for normal shots; for a detail shot it moves to focus[2]
  // around the focus point, without leaving any part of the panel empty.
  let z = 1, fx = 0.5, fy = 0.5;
  if (shot.detail) {
    [fx, fy] = shot.focus;
    z = lerp(1, shot.focus[2], ease.inOutCubic(progress(t, shot.start, transitionFor(shot).dur)));
  }
  const iw = w * z, ih = h * z;
  const ix = Math.min(x, Math.max(x + w - iw, x + w / 2 - fx * iw));
  const iy = Math.min(y, Math.max(y + h - ih, y + h / 2 - fy * ih));
  ctx.drawImage(img, ix, iy, iw, ih);

  // Light sweep across the panel as it builds in (right to left, like reading).
  if (I.build?.sweep && !shot.detail) {
    const sp = progress(t, shot.start + 0.15, I.build.sweepDur ?? 1.0);
    if (sp > 0 && sp < 1) {
      const cx = x + w * lerp(1.3, -0.3, ease.inOutQuad(sp));
      const g = ctx.createLinearGradient(cx - w * 0.18, y, cx + w * 0.18, y + h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
  }
  ctx.restore();
}

function drawEndCard(ctx, api, st, t, shot) {
  const { width: W, height: H, arabic } = api;
  const E = S.endCard;
  ctx.fillStyle = E.bg ?? S.palette.bg;
  ctx.fillRect(0, 0, W, H);
  if (E.glow) {
    const g = ctx.createRadialGradient(W / 2, H * 1.1, 0, W / 2, H * 1.1, W * 0.6);
    g.addColorStop(0, E.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (E.halftone) {
    // Dot pattern fading out from the top-right corner (the reading start in Arabic).
    ctx.fillStyle = E.halftone;
    const step = Math.round(W * 0.012), reach = W * 0.2;
    for (let yy = step / 2; yy < reach; yy += step) {
      for (let xx = W - step / 2; xx > W - reach; xx -= step) {
        const d = Math.hypot(W - xx, yy) / reach;
        const rr = step * 0.36 * (1 - d);
        if (rr > 0.4) {
          ctx.beginPath();
          ctx.arc(xx, yy, rr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  if (E.accent) {
    ctx.fillStyle = E.accent;
    const bar = clamp01((t - shot.start - 0.2) / 0.6);
    ctx.fillRect(W / 2 - W * 0.08 * bar, st.end.title.words[0].top - H * 0.06, W * 0.16 * bar, 6);
  }
  arabic.drawWords(ctx, st.end.title, t, { start: shot.start + 0.3, stagger: 0.08, dur: 0.5, effect: 'rise', color: E.titleColor ?? S.palette.text });
  if (st.end.sub) arabic.drawWords(ctx, st.end.sub, t, { start: shot.start + 0.9, stagger: 0.06, dur: 0.5, effect: 'fade', color: E.subtitleColor ?? S.palette.muted });
}

export default scene;
