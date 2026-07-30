import type { Episode, ResolvedFeed, YouTubeRef } from '../feeds/types';
import { ytToToken } from '../feeds/input-parse';
import { fetchYtFeed } from './atom';
import { ytServiceList, type YtItem } from './service';

function thumbOf(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function epFromItem(it: YtItem): Episode {
  return {
    trackId: it.videoId,
    trackName: it.title,
    releaseDate: it.published,
    episodeUrl: '',
    trackTimeMillis: (it.durationSec || 0) * 1000,
    ytId: it.videoId,
    // The official CDN is deterministic from the id; Piped/Invidious thumbs
    // are proxied through instances that frequently go dark.
    art: thumbOf(it.videoId),
  };
}

/**
 * Resolve a YouTube playlist/channel/video into a feed.
 * Preferred: full list via Worker/Piped/Invidious. Fallback: the keyless Atom
 * feed, which only carries the latest ~15 items (`limited: true`).
 * `placeholderTitle` fills the single-video pseudo-feed name (localized).
 *
 * A playlist could also be enumerated in full through the YouTube IFrame
 * player, but that arrived with the embed fallback and went out with it — an
 * iframe that plays ads and dies on a locked screen is not worth keeping
 * loaded just to read a playlist's ids.
 */
export async function resolveYouTube(
  info: YouTubeRef,
  signal: AbortSignal | undefined,
  opts: { placeholderTitle: string },
): Promise<ResolvedFeed> {
  let eps: Episode[] = [];
  let title = 'YouTube';
  let author = '';
  let limited = false;

  if (info.type === 'video') {
    title = opts.placeholderTitle;
    eps = [
      {
        trackId: info.id,
        trackName: '', // filled from player data / noembed later
        releaseDate: '',
        episodeUrl: '',
        trackTimeMillis: 0,
        ytId: info.id,
        art: thumbOf(info.id),
      },
    ];
  } else {
    let svc = null;
    try {
      svc = await ytServiceList(info, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      svc = null;
    }

    if (svc && svc.items.length) {
      title = svc.title || 'YouTube';
      author = svc.author || '';
      eps = svc.items.map(epFromItem);
      // The Worker says when it could not reach the end of the channel.
      limited = svc.partial === true;
    } else {
      const feedUrl =
        'https://www.youtube.com/feeds/videos.xml?' +
        (info.type === 'playlist' ? 'playlist_id=' : 'channel_id=') +
        encodeURIComponent(info.id);
      const parsed = await fetchYtFeed(feedUrl, signal);
      title = parsed.title || 'YouTube';
      author = parsed.author || '';
      limited = true; // the Atom feed only ever carries the latest ~15
      eps = parsed.items.map((it) => ({
        trackId: it.videoId,
        trackName: it.title,
        releaseDate: it.published,
        episodeUrl: '',
        trackTimeMillis: 0,
        ytId: it.videoId,
        art: thumbOf(it.videoId),
      }));
    }
  }

  if (!eps.length) throw new Error('no episodes');

  const art = eps[0]?.art ?? '';
  return {
    meta: {
      id: 'yt:' + info.type + ':' + info.id,
      name: title,
      artist: author,
      art,
      kind: 'yt',
      yt: ytToToken(info),
    },
    episodes: eps,
    limited,
  };
}
