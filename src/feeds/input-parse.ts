import type { FeedRequest } from './types';

/** Apple podcast id from a pasted URL ("...id123456789") or a bare number. */
export function extractItunesId(s: string): string | null {
  const m = s.match(/id(\d{6,12})/);
  if (m?.[1]) return m[1];
  if (/^\d{6,12}$/.test(s.trim())) return s.trim();
  return null;
}

/** Classify free-form search-box input into a directly-loadable request. */
export function parseDirectInput(raw: string): FeedRequest | null {
  const id = extractItunesId(raw);
  if (id) return { kind: 'itunes', id };
  // https only, matching the enclosure rule in rss-parser and the CSP.
  if (/^https:\/\//i.test(raw)) return { kind: 'rss', url: raw };
  return null;
}
