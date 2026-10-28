// Time helpers for deterministic animation. Every function here is pure:
// the same inputs always give the same output, so any frame can be rendered alone.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, p) => a + (b - a) * p;
export const mapRange = (v, inLo, inHi, outLo, outHi) =>
  lerp(outLo, outHi, clamp((v - inLo) / (inHi - inLo)));

// 0 before `start`, 1 after `start + dur`, linear in between.
export const progress = (t, start, dur) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / dur));

export const ease = {
  linear: (p) => p,
  inQuad: (p) => p * p,
  outQuad: (p) => 1 - (1 - p) * (1 - p),
  inOutQuad: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
  inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outQuart: (p) => 1 - Math.pow(1 - p, 4),
  outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  inOutExpo: (p) =>
    p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
  outBack: (p, s = 1.6) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2),
};

// Closed-form damped spring from 0 to 1. `secs` is time since the spring started.
// No integration and no state, so it is safe for frame-by-frame rendering.
export function spring(secs, { freq = 2.2, damping = 0.45 } = {}) {
  if (secs <= 0) return 0;
  const w = 2 * Math.PI * freq;
  const z = clamp(damping, 0.01, 0.99);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * secs) * (Math.cos(wd * secs) + ((z * w) / wd) * Math.sin(wd * secs));
}

// Piecewise keyframes: [[time, value], ...] sorted by time.
export function keys(t, frames, easing = ease.inOutCubic) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    const [t0, v0] = frames[i - 1];
    if (t <= t1) return lerp(v0, v1, easing((t - t0) / (t1 - t0)));
  }
  return frames[frames.length - 1][1];
}

// Seeded PRNG (mulberry32). Create it once in setup(), never per frame with a changing seed.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
