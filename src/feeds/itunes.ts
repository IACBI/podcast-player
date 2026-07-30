import type { Episode, FeedMeta, SearchResult } from './types';
import { itunesFetch } from './proxy-chain';

interface ItunesLookupRow {
  wrapperType?: string;
  kind?: string;
  collectionId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  /** Also returned for podcasts, and a safer base than the 100px thumbnail. */
  artworkUrl600?: string;
  trackCount?: number;
  trackId?: number;
  releaseDate?: string;
  episodeUrl?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
}

interface ItunesResponse {
  results?: ItunesLookupRow[];
}

export async function searchPodcasts(term: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const data = await itunesFetch<ItunesResponse>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&limit=8&country=tr`,
    signal,
  );
  if (!data.results) return [];
  return data.results.map((p) => ({
    collectionId: p.collectionId ?? 0,
    collectionName: p.collectionName ?? '—',
    artistName: p.artistName ?? '',
    artworkUrl100: p.artworkUrl100 ?? '',
    ...(p.trackCount !== undefined ? { trackCount: p.trackCount } : {}),
  }));
}

export interface ItunesFeed {
  meta: FeedMeta;
  episodes: Episode[];
}

export async function lookupPodcast(id: string, signal?: AbortSignal): Promise<ItunesFeed> {
  const data = await itunesFetch<ItunesResponse>(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcastEpisode&limit=300&country=tr`,
    signal,
  );
  if (!data.results || !Array.isArray(data.results)) throw new Error('invalid api response');

  const metaRow = data.results.find((r) => r.wrapperType === 'collection' || r.kind === 'podcast');
  const meta: FeedMeta = {
    id: String(id),
    name: metaRow?.collectionName || metaRow?.trackName || '',
    artist: metaRow?.artistName || '',
    // Prefer the 600px rendition: `artAt()` upgrades either one at render time,
    // but starting from 600 keeps the artwork usable if Apple ever changes the
    // URL scheme the rewrite depends on.
    art: metaRow?.artworkUrl600 || metaRow?.artworkUrl100 || '',
  };

  const episodes: Episode[] = data.results
    .filter((r) => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode')
    .map((r) => ({
      trackId: String(r.trackId ?? r.episodeUrl ?? ''),
      trackName: r.trackName ?? '',
      releaseDate: r.releaseDate ?? '',
      episodeUrl: r.episodeUrl || r.previewUrl || '',
      trackTimeMillis: r.trackTimeMillis ?? 0,
    }));

  return { meta, episodes };
}
