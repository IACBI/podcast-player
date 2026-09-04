/**
 * Screen Wake Lock while audio is playing.
 *
 * This does NOT keep audio alive with the screen off — that is not what the API
 * does, and claiming otherwise is the usual mistake. What it prevents is the
 * cheaper failure: the user leaves the app open, the phone dims and sleeps on
 * its own, and the tab gets throttled hard enough that the next range request
 * never completes. The lock is dropped the moment playback stops or the page is
 * hidden, so it costs nothing when it is not helping.
 */

import { onEngine } from './engine';

type Sentinel = { released: boolean; release(): Promise<void> };

let sentinel: Sentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (sentinel || !wanted || document.hidden) return;
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } })
      .wakeLock;
    if (!wl) return;
    sentinel = await wl.request('screen');
    // The OS drops it on its own (tab hidden, battery saver); forget the stale
    // handle so the next visibility change can ask again.
    sentinel.released = false;
  } catch {
    /* denied, unsupported, or not a secure context */
  }
}

function release(): void {
  const s = sentinel;
  sentinel = null;
  void s?.release().catch(() => {
    /* already gone */
  });
}

export function initKeepAwake(): void {
  onEngine((e) => {
    if (e.type === 'play') {
      wanted = true;
      void acquire();
    } else if (e.type === 'pause' || e.type === 'ended' || e.type === 'error') {
      wanted = false;
      release();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
    else void acquire();
  });
}
