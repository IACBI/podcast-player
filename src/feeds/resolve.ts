import type { FeedRequest, ResolvedFeed } from './types';
import { lookupPodcast } from './itunes';
import { fetchTextProxied } from './proxy-chain';
import { parseRss } from './rss-parser';

export interface ResolveOptions {
  signal?: AbortSignal;
}

/** One entry point for every feed source. */
export async function resolveFeed(req: FeedRequest, opts: ResolveOptions): Promise<ResolvedFeed> {
  switch (req.kind) {
    case 'itunes': {
      const { meta, episodes, limited, total } = await lookupPodcast(req.id, opts.signal);
      return { meta, episodes, limited, ...(total ? { total } : {}) };
    }
    case 'rss': {
      const feedId = 'rss:' + req.url;
      const xml = await fetchTextProxied(req.url, opts.signal);
      const parsed = parseRss(xml);
      return {
        meta: { id: feedId, name: parsed.title, artist: parsed.author, art: parsed.art },
        episodes: parsed.episodes,
        limited: false,
      };
    }
  }
}
