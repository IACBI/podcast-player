import { artAt } from '../lib/art';
import { pbPause, pbPlay } from './engine';

export interface MediaSessionActions {
  /** `offset` is the platform's own suggestion; fall back to the setting. */
  seekBack(offset?: number): void;
  seekForward(offset?: number): void;
  prevTrack(): void;
  nextTrack(): void;
  /** Absolute seek, in seconds — the lock-screen scrubber. */
  seekTo(seconds: number): void;
  stop(): void;
}

/**
 * Lock-screen / headset media controls.
 *
 * Every handler is registered separately: an action name the platform does not
 * know throws, and a single try/catch around the whole block meant one
 * unsupported action silently dropped every handler registered after it.
 */
export function initMediaSession(actions: MediaSessionActions): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const on = (name: MediaSessionAction, fn: MediaSessionActionHandler): void => {
    try {
      ms.setActionHandler(name, fn);
    } catch {
      /* action unsupported on this platform */
    }
  };

  on('play', () => pbPlay());
  on('pause', () => pbPause());
  on('stop', () => actions.stop());
  on('seekbackward', (d) => actions.seekBack(d.seekOffset));
  on('seekforward', (d) => actions.seekForward(d.seekOffset));
  on('previoustrack', () => actions.prevTrack());
  on('nexttrack', () => actions.nextTrack());
  // Without this the notification's progress bar is drawn (setPositionState
  // advertises it) but dragging it does nothing.
  on('seekto', (d) => {
    if (typeof d.seekTime === 'number') actions.seekTo(d.seekTime);
  });
}

/**
 * Keep the OS play/pause glyph honest. Chrome infers this from the <audio>
 * element, but the YouTube embed path has no element to infer from, so the
 * lock screen showed a stale icon there.
 */
export function setPlaybackState(state: MediaSessionPlaybackState): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    /* progressive enhancement */
  }
}

/**
 * Renditions offered to the OS. Android's notification uses a small icon while
 * a car display or macOS Now Playing wants something much larger, so the
 * platform is given the choice instead of one arbitrary size.
 */
const OS_ART_SIZES = [96, 256, 512];

export function setMediaMetadata(meta: {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
}): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: artworkSet(meta.artworkUrl),
    });
  } catch {
    /* metadata is progressive enhancement */
  }
}

function artworkSet(url: string): MediaImage[] {
  if (!url) return [];
  const out: MediaImage[] = [];
  const seen = new Set<string>();
  for (const px of OS_ART_SIZES) {
    const src = artAt(url, px);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({ src, sizes: `${px}x${px}` });
  }
  return out.length ? out : [{ src: url }];
}

/**
 * Lets the lock screen draw a real progress bar and scrub. Rate must be > 0 and
 * position must not exceed duration or the call throws.
 */
export function setMediaPosition(current: number, duration: number, rate: number): void {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.max(0, Math.min(current, duration)),
      playbackRate: rate > 0 ? rate : 1,
    });
  } catch {
    /* position state is progressive enhancement */
  }
}
