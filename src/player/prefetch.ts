/**
 * Background prefetch — the structural answer to backgrounded playback.
 *
 * Recovery (`recovery.ts`) makes a dropped range request survivable. This makes
 * it not happen: while the episode plays, its bytes are pulled into the same
 * offline cache a user download uses, and when the copy is complete the element
 * is switched over to it. From that moment playback needs no network at all, so
 * a dozing radio, an expiring signed URL or a Worker rate limit cannot end it.
 *
 * The swap is deliberately narrow: same track, same position, same rate, no
 * change to the session or the Media Session notification. If anything about
 * the situation has moved on by the time the download lands, it is dropped.
 */

import type { Episode } from '../feeds/types';
import { settings } from '../state/settings';
import { downloadOffline, isDownloaded, offlineAudioUrl } from './offline';

export interface PrefetchHooks {
  /** Hand the element a local copy, continuing from `positionSec`. */
  handoff: (url: string, positionSec: number) => void;
  /** Position to resume at, and the track it belongs to, read at swap time. */
  currentTrackId: () => string | null;
  currentPosition: () => number;
}

let hooks: PrefetchHooks | null = null;
/** Track ids already attempted this session — one shot each, success or not. */
const attempted = new Set<string>();

export function initPrefetch(h: PrefetchHooks): void {
  hooks = h;
}

type Conn = { saveData?: boolean; effectiveType?: string; type?: string };

/** Cheap, best-effort read of the radio; absent on iOS, where we assume wifi. */
function connection(): Conn | undefined {
  return (navigator as Navigator & { connection?: Conn }).connection;
}

function allowedNow(): boolean {
  const mode = settings().prefetchAudio;
  if (mode === 'never') return false;
  const c = connection();
  if (c?.saveData) return false;
  // A slow radio would spend the user's data racing playback it cannot beat.
  if (c?.effectiveType === '2g' || c?.effectiveType === 'slow-2g') return false;
  if (mode === 'always') return true;
  // 'wifi': only skip when the browser positively says it is on cellular.
  return c?.type !== 'cellular';
}

/**
 * Start caching `ep` in the background. Safe to call on every play — it is
 * idempotent per track and silently does nothing when it should not run.
 */
export function prefetchEpisode(ep: Episode, feedId: string): void {
  const id = String(ep.trackId);
  if (!hooks || !id || attempted.has(id) || !allowedNow()) return;
  attempted.add(id);

  void (async () => {
    try {
      if (await isDownloaded(id)) return; // already local, nothing to do
      const outcome = await downloadOffline(ep, feedId, { ephemeral: true });
      if (outcome !== 'ok') return;
      // Everything below re-reads live state: the download may have taken
      // minutes, and the user may be three episodes further on by now.
      if (hooks?.currentTrackId() !== id) return;
      const url = await offlineAudioUrl(id);
      if (!url) return;
      if (hooks?.currentTrackId() !== id) {
        URL.revokeObjectURL(url);
        return;
      }
      hooks.handoff(url, hooks.currentPosition());
    } catch {
      /* prefetch is an optimisation; the streaming path still works */
    }
  })();
}

/** Test seam. */
export function __resetPrefetchForTests(): void {
  hooks = null;
  attempted.clear();
}
