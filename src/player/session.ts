/**
 * The playing session — what the transport is actually loaded with.
 *
 * Deliberately separate from the *browsing* session (`PlaybackSession` in
 * ui/playback-controller.ts). Those two used to be one object, so opening any
 * feed — from search, Home, Library or a deep link — reset the playing state,
 * cleared the queue and reassigned `audio.src`, which stops playback. Browsing
 * now writes only the browse session; this module is written only when the user
 * actually starts an episode.
 *
 * It also carries its own `episodes` array, so prev/next and auto-next walk the
 * feed that is PLAYING rather than whichever feed happens to be on screen.
 */

import type { Episode, FeedMeta } from '../feeds/types';
import { t } from '../i18n';
import { httpsOnly } from '../lib/safe';
import { signal } from '../state/signals';

export interface PlayingSession {
  /** `<itunesId>` | `rss:<url>` | `yt:<type>:<id>` — see feeds/feed-id.ts. */
  feedId: string;
  meta: FeedMeta;
  /** The playing feed's episodes, in the order prev/next should walk. */
  episodes: Episode[];
  /** Index into `episodes`. */
  index: number;
  trackId: string;
  isYT: boolean;
}

/** null until the user starts an episode. */
export const playing = signal<PlayingSession | null>(null);

export function playingEpisode(): Episode | null {
  const s = playing();
  return s ? (s.episodes[s.index] ?? null) : null;
}

/** True when the given episode is the one loaded in the transport. */
export function isPlayingTrack(feedId: string, trackId: string): boolean {
  const s = playing();
  return !!s && s.feedId === feedId && s.trackId === trackId;
}

export interface NowPlayingLabel {
  title: string;
  feedName: string;
  /** https-only, safe to hand to <img> / MediaMetadata. */
  art: string;
}

/**
 * Display fields for the mini dock, the Now Playing sheet and the OS media
 * session. Derived rather than stored: the previous design kept a parallel
 * `nowPlaying` signal that every play path had to remember to update, and the
 * embed title-fill path updated the two copies separately.
 */
export function nowPlayingLabel(s: PlayingSession | null): NowPlayingLabel | null {
  if (!s) return null;
  const ep = s.episodes[s.index];
  if (!ep) return null;
  return {
    title: ep.trackName || t('ep_fallback', s.index + 1),
    feedName: s.meta.name || '',
    // The episode's own cover wins over the feed cover on every surface.
    art: httpsOnly(ep.art) || httpsOnly(s.meta.art),
  };
}
