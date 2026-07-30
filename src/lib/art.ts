/**
 * Artwork rendition upgrades.
 *
 * Feed metadata routinely carries thumbnail-sized artwork — the iTunes API's
 * `artworkUrl100` is 100×100 — which the Now Playing hero then upscales ~6× on
 * a retina screen. Both artwork CDNs we know encode the rendition in the URL
 * path, so a larger one can be derived without a second API call.
 *
 * Deriving it at render time (rather than storing bigger URLs) is deliberate:
 * subscriptions in `pp_favs` and the IndexedDB feed cache keep whatever URL was
 * saved when the user subscribed, and those records are never refreshed. A
 * render-time upgrade fixes them too, with no data migration.
 *
 * Unknown hosts are returned untouched — RSS `<itunes:image>` is typically
 * already 1400–3000px, and guessing at a stranger's URL scheme only breaks it.
 */

import { httpsOnly } from './safe';

const MIN_PX = 32;
const MAX_PX = 1600;

/** Apple's image service (`is1-ssl.mzstatic.com`, …): last path segment is the rendition. */
const MZ_HOST = /(?:^|\.)mzstatic\.com$/i;
const MZ_SEGMENT = /^(\d+)x(\d+)([a-z]{0,3}(?:-\d+)?)\.(jpg|jpeg|png|webp)$/i;

/**
 * YouTube thumbnails come in a fixed ladder. Only mq/hq exist for *every*
 * video — `sddefault` and `maxresdefault` 404 on older uploads (verified
 * against jNQXAC9IVRw), and a 404 inside a srcset renders a broken image.
 */
const YT_HOST = /^i\d*\.ytimg\.com$/i;
const YT_PATH = /^\/vi(?:_webp)?\/([\w-]{11})\/\w+\.(?:jpg|webp)$/;
const YT_LADDER = [
  { name: 'default', width: 120 },
  { name: 'mqdefault', width: 320 },
  { name: 'hqdefault', width: 480 },
] as const;
/** Largest rendition guaranteed to exist for every video. */
const YT_TOP = YT_LADDER[2];

export interface ArtOptions {
  /** Ask for the WebP rendition. Yields '' when the host has no WebP variant. */
  webp?: boolean;
}

interface Rendition {
  url: string;
  /** Actual pixel width served — may differ from the request on fixed ladders. */
  width: number;
}

function resolve(src: string, px: number, webp: boolean): Rendition | null {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return null;
  }
  const want = Math.round(Math.min(Math.max(px, MIN_PX), MAX_PX));

  if (MZ_HOST.test(u.hostname)) {
    const cut = u.pathname.lastIndexOf('/');
    const m = MZ_SEGMENT.exec(u.pathname.slice(cut + 1));
    if (!m) return null;
    // The crop code (`bb`, `wz`, …) decides how a non-square source is fitted,
    // so it is carried over verbatim; only size and container change.
    const crop = m[3] ?? '';
    const ext = webp ? 'webp' : (m[4] ?? 'jpg');
    u.pathname = `${u.pathname.slice(0, cut + 1)}${want}x${want}${crop}.${ext}`;
    return { url: u.href, width: want };
  }

  if (YT_HOST.test(u.hostname)) {
    const m = YT_PATH.exec(u.pathname);
    if (!m) return null;
    const step = YT_LADDER.find((s) => s.width >= want) ?? YT_TOP;
    u.pathname = `/${webp ? 'vi_webp' : 'vi'}/${m[1]}/${step.name}.${webp ? 'webp' : 'jpg'}`;
    return { url: u.href, width: step.width };
  }

  return null;
}

/**
 * Best available URL for an artwork rendition about `px` wide. Falls back to
 * the input URL for hosts we cannot upgrade (and to '' when WebP was required).
 */
export function artAt(url: string | undefined | null, px: number, opts: ArtOptions = {}): string {
  const src = httpsOnly(url);
  if (!src) return '';
  const webp = opts.webp === true;
  const hit = resolve(src, px, webp);
  if (hit) return hit.url;
  return webp ? '' : src;
}

/**
 * `srcset` value covering the given widths, deduplicated by the width actually
 * served. Returns '' when the host cannot be upgraded — callers should then
 * fall back to a plain `src`.
 */
export function artSrcset(
  url: string | undefined | null,
  widths: readonly number[],
  opts: ArtOptions = {},
): string {
  const src = httpsOnly(url);
  if (!src) return '';
  const webp = opts.webp === true;
  const seen = new Set<number>();
  const out: string[] = [];
  for (const w of widths) {
    const hit = resolve(src, w, webp);
    if (!hit || seen.has(hit.width)) continue;
    seen.add(hit.width);
    out.push(`${hit.url} ${hit.width}w`);
  }
  return out.join(', ');
}
