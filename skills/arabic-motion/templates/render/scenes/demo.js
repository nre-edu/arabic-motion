// Demo scene: 6 s vertical title card. Copy it as a starting point for real scenes.
// Timing lives in one object (T) so picture and sound cues always move together.

const T = {
  bgIn: 0.0,
  title: -0.2, titleStagger: 0.14, // starts before 0 so frame 0 (the thumbnail) is not empty
  highlight: 1.25,
  sub: 1.9, subStagger: 0.07,
  chips: 3.0, chipStagger: 0.18,
  out: 4.9,
};
const TITLE = 'فكرتك تستاهل حركة';
const SUB = 'نص عربي سليم يرندره Claude Code مع FFmpeg';
const CHIPS = ['RTL', 'MP4', 'SFX'];
const C = { bg1: '#0f1b2d', bg2: '#1d3557', accent: '#f4b942', text: '#f7f7f2', soft: '#a8b3c7' };

export default {
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 6,
  fonts: [{ family: 'Cairo', src: 'fonts/cairo/Cairo-Variable.ttf' }],

  cues: () => [
    { at: T.bgIn, sound: 'whoosh', gain: -8 },
    ...TITLE.split(' ').map((_, i) => ({ at: T.title + i * T.titleStagger, sound: 'tick', gain: -12 })),
    { at: T.highlight, sound: 'pop', gain: -6 },
    { at: T.sub, sound: 'swish', gain: -12 },
    ...CHIPS.map((_, i) => ({ at: T.chips + i * T.chipStagger, sound: 'click', gain: -10 })),
    { at: T.out, sound: 'whoosh', gain: -10 },
  ],

  setup(ctx, api) {
    const { arabic } = api;
    const title = arabic.layout(ctx, TITLE, { family: 'Cairo', weight: 800, size: 128, maxWidth: 860, x: 540, y: 700 });
    const sub = arabic.layout(ctx, SUB, { family: 'Cairo', weight: 500, size: 54, maxWidth: 820, x: 540, y: 700 + title.height + 90 });
    const chipsY = 700 + title.height + 90 + sub.height + 150;
    return { title, sub, chipsY };
  },

  draw(ctx, t, api, s) {
    const { width: W, height: H, ease, progress, lerp, keys, arabic } = api;

    // Background and a circle that grows in from the right (reading direction).
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg1);
    g.addColorStop(1, C.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = lerp(0, 760, ease.outExpo(progress(t, T.bgIn, 1.1)));
    ctx.fillStyle = 'rgba(244,185,66,0.10)';
    ctx.beginPath();
    ctx.arc(W - 120, 520, r, 0, Math.PI * 2);
    ctx.fill();

    // Everything below slides up and fades out together at the end.
    const outP = ease.inOutCubic(progress(t, T.out, 0.9));
    ctx.save();
    ctx.globalAlpha *= 1 - outP;
    ctx.translate(0, -180 * outP);

    const last = s.title.words[s.title.words.length - 1];
    arabic.wordBox(ctx, s.title, last, { color: C.accent, grow: ease.outCubic(progress(t, T.highlight, 0.45)) });
    arabic.drawWords(ctx, s.title, t, {
      start: T.title, stagger: T.titleStagger, dur: 0.55, effect: 'rise', color: C.text,
      highlight: t >= T.highlight ? { index: last.index, color: C.bg1 } : null,
    });
    arabic.drawWords(ctx, s.sub, t, { start: T.sub, stagger: T.subStagger, dur: 0.5, effect: 'wipe', color: C.soft });

    // Chips (Latin labels) laid out right to left.
    const y = s.chipsY;
    CHIPS.forEach((label, i) => {
      const p = progress(t, T.chips + i * T.chipStagger, 0.5);
      if (p <= 0) return;
      const sc = lerp(0.5, 1, ease.outBack(p));
      const cx = W / 2 + (1 - i) * 230;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, p * 2);
      ctx.translate(cx, y);
      ctx.scale(sc, sc);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(-95, -50, 190, 100, 50);
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.font = '700 46px "Cairo"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.direction = 'ltr';
      ctx.fillText(label, 0, 4);
      ctx.restore();
    });
    ctx.restore();

    // Thin progress bar along the bottom, filling right to left.
    const bar = keys(t, [[0, 0], [6, 1]], ease.linear);
    ctx.fillStyle = C.accent;
    ctx.fillRect(W - W * bar, H - 14, W * bar, 14);
  },
};
