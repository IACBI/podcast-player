/**
 * The artwork tile shared by every list surface (search rows, continue-listening,
 * subscription grid, library, podcast header).
 *
 * Replaces three near-identical local helpers. Each one had a different subset
 * of the behaviour: search had the dead-CDN fallback but home did not, library
 * was missing lazy loading entirely, and none of them asked for a rendition
 * matching the box they render into.
 */

import { artAt, artSrcset } from '../lib/art';
import { h } from './h';

/** `.row-art` — 44px in controls.css. Search, continue-listening, library rows. */
export const ROW_ART_PX = 44;
/** `.home-sub-art` — a `minmax(96px, 1fr)` grid cell, so it stretches past 96. */
export const SUB_TILE_PX = 128;
/** `.p-art` — 72px, 96px from the 900px breakpoint up (views/podcast.css). */
export const HEADER_ART_PX = 96;
/** `.mini-art` — 40px in signal-line.css. */
export const MINI_ART_PX = 40;

/**
 * Candidate widths for a fixed-size box: 1×, 2× and 3×. The 3× step matters —
 * most phones are dpr 3, and without it a 40px dock tile is served 80px for a
 * 120px box.
 */
export function dprWidths(px: number): number[] {
  return [px, px * 2, px * 3];
}

/**
 * `px` is the CSS box size; the srcset covers 1× and 2× so retina screens get a
 * sharp tile without every surface over-fetching a hero-sized image.
 *
 * Deliberately no WebP here: at these sizes the saving is a couple of KB, and a
 * `<picture>` per row (plus the 404-retry it would need) is not worth it. The
 * Now Playing hero, where the bytes actually matter, does use WebP.
 */
export function artTile(className: string, url: string | undefined | null, px: number): HTMLElement {
  const src = artAt(url, px);
  if (!src) return h('div', { className });

  const img = h('img', {
    className,
    src,
    alt: '',
    attrs: { loading: 'lazy', decoding: 'async' },
  });
  const set = artSrcset(url, dprWidths(px));
  if (set) {
    img.srcset = set;
    img.sizes = `${px}px`;
  }
  // A dead CDN URL should look like missing art, not like a broken image.
  img.addEventListener('error', () => img.replaceWith(h('div', { className })), { once: true });
  return img;
}
