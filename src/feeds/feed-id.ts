import type { FeedRequest } from './types';

/**
 * The feed id ⇄ feed request mapping, in one place.
 *
 * The id scheme is frozen by persisted data (`pp_favs`, `pp_last_<feedId>`, the
 * IndexedDB `feeds`/`resume` stores): `<itunesId>` | `rss:<url>` |
 * `yt:<type>:<id>`. Both directions used to be reimplemented per call site,
 * which is how they drifted apart.
 */

export function feedIdOf(req: FeedRequest): string {
  switch (req.kind) {
    case 'itunes':
      return req.id;
    case 'rss':
      return 'rss:' + req.url;
    case 'yt':
      return 'yt:' + req.info.type + ':' + req.info.id;
  }
}

/** Inverse of `feedIdOf`. Returns null for an id that cannot be loaded. */
export function requestFromFeedId(feedId: string): FeedRequest | null {
  const s = String(feedId);
  if (!s) return null;
  if (s.startsWith('rss:')) {
    const url = s.slice(4);
    return url ? { kind: 'rss', url } : null;
  }
  if (s.startsWith('yt:')) {
    const parts = s.split(':'); // yt:<type>:<id> — ids never contain ':'
    const type = parts[1];
    const id = parts.slice(2).join(':');
    if ((type === 'playlist' || type === 'channel' || type === 'video') && id) {
      return { kind: 'yt', info: { type, id } };
    }
    return null;
  }
  return { kind: 'itunes', id: s };
}
