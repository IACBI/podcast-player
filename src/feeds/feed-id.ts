import type { FeedRequest } from './types';

/**
 * The feed id ⇄ feed request mapping, in one place.
 *
 * The id scheme is frozen by persisted data (`pp_favs`, `pp_last_<feedId>`, the
 * IndexedDB `feeds`/`resume` stores): `<itunesId>` | `rss:<url>`. Both
 * directions used to be reimplemented per call site, which is how they drifted
 * apart.
 *
 * `yt:` ids are still recognised, only to be REJECTED: YouTube support was
 * removed, and a stored subscription from that era must resolve to null so the
 * library can drop the row instead of trying to load a feed that cannot exist.
 */

export function feedIdOf(req: FeedRequest): string {
  switch (req.kind) {
    case 'itunes':
      return req.id;
    case 'rss':
      return 'rss:' + req.url;
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
  if (s.startsWith('yt:')) return null; // retired source; see the note above
  return { kind: 'itunes', id: s };
}
