/**
 * Ambient colour sampled from the current artwork, painted behind the Now
 * Playing hero.
 *
 * Two constraints shape this:
 *
 * 1. Reading pixels needs a CORS-clean image. `is1-ssl.mzstatic.com` and
 *    Apple's image CDN sends `Access-Control-Allow-Origin: *`, but an arbitrary
 *    podcast CDN may not — and setting `crossOrigin` on an image whose host
 *    omits the header makes it fail to load *entirely*. So sampling uses a
 *    separate, off-document Image; the visible <img> never gets `crossOrigin`.
 *    If sampling fails, the page simply keeps the user's accent.
 * 2. The user's accent choice is theirs. This writes its own `--np-ambient-*`
 *    tokens and never touches the `--accent` family.
 */

import { artAt } from '../lib/art';

/** Small enough that decoding and scanning are trivial. */
const SAMPLE_PX = 32;

let canvas: HTMLCanvasElement | null = null;
let token = 0;

function ctx2d(): CanvasRenderingContext2D | null {
  canvas ??= document.createElement('canvas');
  canvas.width = SAMPLE_PX;
  canvas.height = SAMPLE_PX;
  // willReadFrequently: we only ever read back.
  return canvas.getContext('2d', { willReadFrequently: true });
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Dominant colour by coarse bucket vote, biased away from near-black, near-white
 * and washed-out pixels so a cover with a white border does not read as grey.
 */
function dominant(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    if (a < 128) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255) || 1);
    if (lum < 24 || lum > 236) continue; // near-black / near-white
    if (sat < 0.12 && (lum < 60 || lum > 200)) continue; // washed-out extremes

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const hit = buckets.get(key);
    if (hit) {
      hit.n++;
      hit.r += r;
      hit.g += g;
      hit.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  if (!best) return null;
  return {
    r: Math.round(best.r / best.n),
    g: Math.round(best.g / best.n),
    b: Math.round(best.b / best.n),
  };
}

function clearAmbient(): void {
  const root = document.documentElement;
  root.style.removeProperty('--np-ambient');
  root.style.removeProperty('--np-ambient-soft');
  document.body.classList.remove('has-ambient');
}

function applyAmbient(c: Rgb): void {
  const root = document.documentElement;
  root.style.setProperty('--np-ambient', `rgb(${c.r} ${c.g} ${c.b})`);
  root.style.setProperty('--np-ambient-soft', `rgba(${c.r},${c.g},${c.b},0.30)`);
  document.body.classList.add('has-ambient');
}

/**
 * Sample `url` and paint the ambient tokens. Safe to call on every track change;
 * later calls win. Pass '' to clear.
 */
export function updateAmbient(url: string | undefined | null): void {
  const mine = ++token;
  const src = artAt(url, SAMPLE_PX * 4);
  if (!src) {
    clearAmbient();
    return;
  }

  const probe = new Image();
  // Only on this off-document probe — never on the visible artwork.
  probe.crossOrigin = 'anonymous';
  probe.decoding = 'async';
  probe.referrerPolicy = 'no-referrer';
  probe.addEventListener('load', () => {
    if (mine !== token) return; // a newer track won
    const g = ctx2d();
    if (!g) return clearAmbient();
    try {
      g.drawImage(probe, 0, 0, SAMPLE_PX, SAMPLE_PX);
      const { data } = g.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX);
      const c = dominant(data);
      if (c) applyAmbient(c);
      else clearAmbient();
    } catch {
      // Tainted canvas: the host served no CORS header after all.
      clearAmbient();
    }
  });
  probe.addEventListener('error', () => {
    // Host refuses anonymous requests — keep the accent, show nothing new.
    if (mine === token) clearAmbient();
  });
  probe.src = src;
}
