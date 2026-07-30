import type { Episode, FeedMeta, SearchResult } from './types';
import { itunesFetch } from './proxy-chain';
import { settings } from '../state/settings';
import type { LangCode } from '../i18n/types';

/**
 * Apple's catalogue is per-storefront: results, titles and availability all
 * differ. `country=tr` used to be hardcoded, so a German or Japanese user
 * searched the Turkish store and simply could not find shows listed elsewhere.
 * Derived from the UI language, which is the only region signal the app has
 * (it asks for no location and stores no account).
 */
const LANG_STOREFRONT: Record<LangCode, string> = {
  tr: 'tr',
  en: 'us',
  de: 'de',
  fr: 'fr',
  es: 'es',
  ar: 'sa',
  ja: 'jp',
  ru: 'ru',
};

function storefront(): string {
  return LANG_STOREFRONT[settings().lang] ?? 'us';
}

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
  /** Episode show notes. Present on podcastEpisode rows; HTML, untrusted. */
  description?: string;
  shortDescription?: string;
}

interface ItunesResponse {
  results?: ItunesLookupRow[];
}

export async function searchPodcasts(term: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const data = await itunesFetch<ItunesResponse>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&limit=8&country=${storefront()}`,
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
  /** True when Apple reports more episodes than it handed back. */
  limited: boolean;
  /** Apple's own episode count for the show (0 when absent). */
  total: number;
}

/**
 * Ceiling we ask for. It is NOT what actually bounds the result: Apple returns
 * its own, much smaller slice regardless — measured 2026-07-30, The Daily
 * reports `trackCount` 2676 and returns 41 episodes; Radiolab reports 859 and
 * returns 200. So truncation is detected by comparing against `trackCount`
 * rather than against this number.
 *
 * The full archive lives at the collection row's `feedUrl`. Switching to it
 * would re-key every episode (Apple `trackId` → RSS `guid`) and orphan every
 * saved resume position, and would pull a multi-megabyte feed on open, so it
 * is a deliberate open question rather than a silent change.
 */
const LOOKUP_LIMIT = 300;

export async function lookupPodcast(id: string, signal?: AbortSignal): Promise<ItunesFeed> {
  const data = await itunesFetch<ItunesResponse>(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcastEpisode&limit=${LOOKUP_LIMIT}&country=${storefront()}`,
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
    .map((r) => {
      // The lookup response carries notes; nothing read them, so the Now
      // Playing sheet's "episode notes" was permanently empty for every
      // podcast opened through Apple rather than a direct RSS URL.
      const description = r.description || r.shortDescription || '';
      return {
        trackId: String(r.trackId ?? r.episodeUrl ?? ''),
        trackName: r.trackName ?? '',
        releaseDate: r.releaseDate ?? '',
        episodeUrl: r.episodeUrl || r.previewUrl || '',
        trackTimeMillis: r.trackTimeMillis ?? 0,
        ...(description ? { description } : {}),
      };
    });

  // `trackCount` is the show's real episode count, and it is routinely far
  // larger than the list Apple returns with it.
  const total = metaRow?.trackCount ?? 0;
  return { meta, episodes, limited: total > episodes.length, total };
}
