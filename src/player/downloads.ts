import type { Episode } from '../feeds/types';
import { httpsOnly } from '../lib/safe';

/**
 * `'opened'` — the URL was handed to the browser, which is all we can observe.
 * There is deliberately no `'ok'`: this runs only after the Cache API path
 * failed on CORS, so the target is always cross-origin, and a cross-origin
 * `download` attribute is ignored by every browser. The old code set one
 * anyway and reported `'ok'` unconditionally, so the user was told "saved" for
 * a file that had merely been opened in a tab.
 */
export type DownloadOutcome = 'opened' | 'no-url';

/**
 * Last-resort handoff for an episode whose CDN refuses CORS: open the audio URL
 * so the user can save it with the browser's own controls.
 */
export function downloadEpisode(ep: Episode): DownloadOutcome {
  const src = httpsOnly(ep.episodeUrl || '');
  if (!src) return 'no-url';

  const w = window.open(src, '_blank', 'noopener,noreferrer');
  if (!w) return 'no-url'; // popup blocked — nothing reached the user
  return 'opened';
}
