#!/usr/bin/env node
// Frame-accurate renderer: headless Chromium draws each frame of a scene, FFmpeg encodes it.
// Run from the project root:
//   node render/render.mjs --scene render/scenes/demo.js --out exports/demo-preview.mp4 --scale 0.5
//   node render/render.mjs --scene render/scenes/demo.js --sheet qa/sheet.png --times 0,1,2,3,4,5
//   node render/render.mjs --scene render/scenes/demo.js --stills qa/frame --times 0,1.5
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, []),
);
if (!args.scene) {
  console.error('missing --scene <path relative to project root>');
  process.exit(2);
}

const root = process.cwd();
const scale = Number(args.scale ?? 1);
const ffmpeg = args.ffmpeg ?? process.env.AM_FFMPEG ?? 'ffmpeg';
const times = args.times ? args.times.split(',').map(Number) : null;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.AM_CHROMIUM || undefined });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[scene error]', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('[scene]', m.text()));

const stageRel = path.relative(root, path.join(path.dirname(fileURLToPath(import.meta.url)), 'stage.html')).split(path.sep).join('/');
const sceneRel = args.scene.split(path.sep).join('/');
await page.goto(`http://127.0.0.1:${port}/${stageRel}?scene=${encodeURIComponent(sceneRel)}&scale=${scale}`);
const info = await page.evaluate(() => window.__ready);

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
const ensureDir = (f) => fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });

try {
  if (args.sheet) {
    const ts = times ?? Array.from({ length: 6 }, (_, i) => +((info.duration * (i + 0.5)) / 6).toFixed(2));
    ensureDir(args.sheet);
    fs.writeFileSync(args.sheet, decode(await page.evaluate(([t, c]) => window.__sheet(t, c), [ts, Number(args.cols ?? 3)])));
    console.log(`sheet: ${args.sheet} (${ts.join(', ')}s)`);
  } else if (args.stills) {
    for (const t of times ?? [0]) {
      const out = `${args.stills}-${t.toFixed(2)}s.png`;
      ensureDir(out);
      fs.writeFileSync(out, decode(await page.evaluate((x) => window.__frame(x), t)));
      console.log(`still: ${out}`);
    }
  } else {
    const out = args.out ?? 'exports/out.mp4';
    const fps = Number(args.fps ?? info.fps);
    const from = Number(args.from ?? 0);
    const to = Math.min(Number(args.to ?? info.duration), info.duration);
    const frames = Math.round((to - from) * fps);
    const type = args.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    ensureDir(out);

    const enc = spawn(ffmpeg, [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(args.crf ?? 18), '-preset', args.preset ?? 'medium',
      '-r', String(fps), '-movflags', '+faststart', out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const encDone = once(enc, 'close');

    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const buf = decode(await page.evaluate(([t, ty]) => window.__frame(t, ty), [from + i / fps, type]));
      if (!enc.stdin.write(buf)) await once(enc.stdin, 'drain');
      if (i % fps === 0) process.stdout.write(`\rframe ${i + 1}/${frames}`);
    }
    enc.stdin.end();
    const [code] = await encDone;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

    // Sound cues shifted to the rendered range, consumed by scripts/mix_audio.py.
    const cues = info.cues.filter((c) => c.at >= from && c.at < to).map((c) => ({ ...c, at: +(c.at - from).toFixed(3) }));
    const cuesFile = out.replace(/\.[^.]+$/, '') + '.cues.json';
    const voice = info.audio?.voice ? { ...info.audio.voice, at: +(info.audio.voice.at - from).toFixed(3) } : null;
    fs.writeFileSync(cuesFile, JSON.stringify({ fps, duration: +(to - from).toFixed(3), voice, cues }, null, 2));
    console.log(`\rvideo: ${out} (${frames} frames, ${((Date.now() - started) / 1000).toFixed(1)}s)\ncues: ${cuesFile}`);
  }
} finally {
  await browser.close();
  server.close();
}
