// Arabic text on Canvas without breaking letter joins.
// Rule of this module: the smallest unit we ever draw is a whole word, so the
// browser shapes every word itself. We never split a word into letters.

import { clamp, ease, progress, lerp } from './motion.js';

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;
export const hasArabic = (s) => ARABIC.test(s);

const WESTERN_TO_ARABIC = { 0: '٠', 1: '١', 2: '٢', 3: '٣', 4: '٤', 5: '٥', 6: '٦', 7: '٧', 8: '٨', 9: '٩' };
export const toArabicDigits = (s) => String(s).replace(/[0-9]/g, (d) => WESTERN_TO_ARABIC[d]);

// Split into words, then merge neighbouring non-Arabic words ("Claude Code",
// "10 x") into one run so they keep their left-to-right order inside an RTL line.
export function tokenize(text) {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    const prev = out[out.length - 1];
    if (prev && !hasArabic(w) && !hasArabic(prev.text)) prev.text += ' ' + w;
    else out.push({ text: w });
  }
  // A Latin run is drawn left to right, so its trailing punctuation would land on its right,
  // next to the Arabic word before it. In an RTL line that punctuation belongs on the left.
  for (const tk of out) {
    const m = !hasArabic(tk.text) && tk.text.match(/^(.*?[^.,:;!?…،؛؟])([.,:;!?…،؛؟]+)$/);
    if (m) tk.text = m[2] + m[1];
  }
  return out;
}

export function font({ size, weight = 700, family = 'Cairo' }) {
  return `${weight} ${size}px "${family}"`;
}

function prepare(ctx, fontStr) {
  ctx.font = fontStr;
  ctx.direction = 'rtl';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; // tracking breaks Arabic joins
  if ('wordSpacing' in ctx) ctx.wordSpacing = '0px';
}

// Vertical extents measured on letters with tall ascenders, dots and deep descenders,
// so masks and boxes built from them never cut off dots or tails.
function verticalMetrics(ctx) {
  const m = ctx.measureText('لأإجيـقـظ');
  return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
}

// Largest size (between min and max) at which `text` fits on `maxLines` lines.
export function fitSize(ctx, text, { family, weight, maxWidth, maxSize = 160, minSize = 28, maxLines = 2 }) {
  for (let size = maxSize; size > minSize; size -= 2) {
    const l = layout(ctx, text, { family, weight, size, maxWidth, x: 0, y: 0 });
    if (l.lines.length <= maxLines) return size;
  }
  return minSize;
}

// Lays out words right to left. Returns word boxes in reading order with their
// right edge x and baseline y. `x` is the anchor: right edge for align "right",
// centre for "center", left edge for "left". `y` is the top of the text block.
export function layout(ctx, text, { family = 'Cairo', weight = 700, size = 96, maxWidth = 900, lineHeight = 1.45, align = 'center', x, y }) {
  const fontStr = font({ size, weight, family });
  ctx.save();
  prepare(ctx, fontStr);
  const space = ctx.measureText(' ').width;
  const tokens = tokenize(text).map((tk) => ({ ...tk, width: ctx.measureText(tk.text).width }));
  const { ascent, descent } = verticalMetrics(ctx);
  ctx.restore();

  const lines = [];
  let cur = [];
  let curW = 0;
  for (const tk of tokens) {
    const add = cur.length ? space + tk.width : tk.width;
    if (cur.length && curW + add > maxWidth) {
      lines.push({ words: cur, width: curW });
      cur = [tk];
      curW = tk.width;
    } else {
      cur.push(tk);
      curW += add;
    }
  }
  if (cur.length) lines.push({ words: cur, width: curW });

  const step = size * lineHeight;
  const words = [];
  lines.forEach((line, li) => {
    const right = align === 'right' ? x : align === 'left' ? x + line.width : x + line.width / 2;
    const baseline = y + ascent + li * step;
    let cursor = right;
    line.baseline = baseline;
    for (const w of line.words) {
      w.right = cursor;
      w.left = cursor - w.width;
      w.baseline = baseline;
      w.top = baseline - ascent;
      w.bottom = baseline + descent;
      w.line = li;
      w.index = words.length;
      words.push(w);
      cursor -= w.width + space;
    }
  });

  return { font: fontStr, size, lines, words, ascent, descent, height: (lines.length - 1) * step + ascent + descent };
}

export function drawWord(ctx, l, w, { color = '#fff' } = {}) {
  prepare(ctx, l.font);
  ctx.direction = hasArabic(w.text) ? 'rtl' : 'ltr';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(w.text, w.right, w.baseline);
}

// Animated word-by-word entrance. Effects only move, scale, fade, blur or mask whole words.
//   effect: 'rise' | 'fade' | 'pop' | 'blur' | 'wipe'
//   stagger: seconds between words (reading order, right to left)
//   times: optional array of start times per word (e.g. from beats.json), overrides stagger
export function drawWords(ctx, l, t, { start = 0, stagger = 0.08, dur = 0.5, effect = 'rise', color = '#fff', times = null, highlight = null } = {}) {
  for (const w of l.words) {
    const t0 = times ? times[w.index] ?? start : start + w.index * stagger;
    const p = progress(t, t0, dur);
    if (p <= 0) continue;
    const e = ease.outCubic(p);
    const fill = highlight && highlight.index === w.index ? highlight.color : color;
    ctx.save();
    if (effect === 'fade') {
      ctx.globalAlpha *= e;
    } else if (effect === 'rise') {
      ctx.globalAlpha *= clamp(p * 1.6);
      ctx.translate(0, lerp(l.size * 0.45, 0, e));
    } else if (effect === 'pop') {
      const s = lerp(0.6, 1, ease.outBack(p));
      const cx = (w.left + w.right) / 2;
      const cy = (w.top + w.bottom) / 2;
      ctx.globalAlpha *= clamp(p * 2);
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    } else if (effect === 'blur') {
      ctx.globalAlpha *= e;
      ctx.filter = `blur(${lerp(14, 0, e).toFixed(2)}px)`;
    } else if (effect === 'wipe') {
      // Mask reveal from the right edge (reading direction). Padding keeps dots and tails inside.
      const padY = l.size * 0.35;
      const padX = l.size * 0.15;
      const width = (w.width + padX * 2) * e;
      ctx.beginPath();
      ctx.rect(w.right + padX - width, w.top - padY, width, w.bottom - w.top + padY * 2);
      ctx.clip();
    }
    drawWord(ctx, l, w, { color: fill });
    ctx.restore();
  }
}

// Rounded box behind one word, for highlights and keyword chips.
export function wordBox(ctx, l, w, { color = '#ffd34d', padX = 0.18, padY = 0.12, radius = 0.18, grow = 1 } = {}) {
  const px = l.size * padX;
  const py = l.size * padY;
  const full = w.width + px * 2;
  const width = full * clamp(grow);
  const x = w.right + px - width;
  const y = w.top - py;
  const h = w.bottom - w.top + py * 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, h, l.size * radius);
  ctx.fill();
  ctx.restore();
}
