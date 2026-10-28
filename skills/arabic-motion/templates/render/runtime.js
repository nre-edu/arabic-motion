// Runs inside the headless browser. Loads one scene module and exposes
// window.__frame(t) and window.__sheet(times) to render.mjs.
import * as motion from './lib/motion.js';
import * as arabic from './lib/arabic.js';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') || 1);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

window.__ready = (async () => {
  const scene = (await import('/' + params.get('scene'))).default;
  if (scene.load) await scene.load(); // data-driven scenes read their plan files here
  const W = scene.width ?? 1080;
  const H = scene.height ?? 1920;

  for (const f of scene.fonts ?? []) {
    const face = new FontFace(f.family, `url(/${f.src})`, { weight: String(f.weight ?? '100 900') });
    document.fonts.add(await face.load());
  }
  await document.fonts.ready;

  const canvas = document.getElementById('c');
  canvas.width = even(W * scale);
  canvas.height = even(H * scale);
  const ctx = canvas.getContext('2d');
  const api = { width: W, height: H, ...motion, arabic };
  const state = scene.setup ? await scene.setup(ctx, api) : undefined;

  const draw = (t) => {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    scene.draw(ctx, t, api, state);
    ctx.restore();
  };

  window.__frame = (t, type = 'image/png') => {
    draw(t);
    return canvas.toDataURL(type, 0.92);
  };

  // Contact sheet of several times in one image, for internal review.
  window.__sheet = (times, cols = 3, thumbW = 360) => {
    const thumbH = Math.round((thumbW * H) / W);
    const rows = Math.ceil(times.length / cols);
    const sheet = document.createElement('canvas');
    sheet.width = cols * thumbW;
    sheet.height = rows * (thumbH + 28);
    const s = sheet.getContext('2d');
    s.fillStyle = '#111';
    s.fillRect(0, 0, sheet.width, sheet.height);
    times.forEach((t, i) => {
      draw(t);
      const x = (cols - 1 - (i % cols)) * thumbW; // right to left, like reading
      const y = Math.floor(i / cols) * (thumbH + 28);
      s.drawImage(canvas, x, y, thumbW, thumbH);
      s.fillStyle = '#ccc';
      s.font = '16px monospace';
      s.fillText(`${t.toFixed(2)}s`, x + 8, y + thumbH + 20);
    });
    return sheet.toDataURL('image/png');
  };

  const cues = typeof scene.cues === 'function' ? scene.cues(api) : scene.cues ?? [];
  return { width: W, height: H, fps: scene.fps ?? 30, duration: scene.duration, cues, audio: scene.audio ?? null };
})();
