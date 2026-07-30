import { artAt } from '../lib/art';
import { pbPause, pbPlay } from './engine';

export interface MediaSessionActions {
  seekBack(): void;
  seekForward(): void;
  prevTrack(): void;
  nextTrack(): void;
}

/** Lock-screen / headset media controls. */
export function initMediaSession(actions: MediaSessionActions): void {
  if (!('mediaSession' in navigator)) return;
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => pbPlay());
    ms.setActionHandler('pause', () => pbPause());
    ms.setActionHandler('seekbackward', () => actions.seekBack());
    ms.setActionHandler('seekforward', () => actions.seekForward());
    ms.setActionHandler('previoustrack', () => actions.prevTrack());
    ms.setActionHandler('nexttrack', () => actions.nextTrack());
  } catch {
    /* partial support — fine */
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
