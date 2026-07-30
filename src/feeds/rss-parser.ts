import type { Episode, FeedMeta } from './types';

/** Namespace-agnostic direct-child text (itunes:duration vs duration etc.). */
function childText(parent: Element, tag: string): string {
  for (const el of parent.children) {
    if (el.localName === tag) return el.textContent?.trim() ?? '';
  }
  return '';
}

/** "1:02:03" | "62:03" | "3723" → milliseconds. */
export function parseDuration(s: string): number {
  if (!s) return 0;
  const p = s.split(':').map(Number);
  if (p.some(isNaN)) return 0;
  const sec =
    p.length === 3
      ? (p[0] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[2] ?? 0)
      : p.length === 2
        ? (p[0] ?? 0) * 60 + (p[1] ?? 0)
        : (p[0] ?? 0);
  return sec * 1000;
}

export interface ParsedRss {
  title: string;
  author: string;
  art: string;
  episodes: Episode[];
}

/**
 * Pure RSS→episodes parsing (no network, no globals) — shared by the app and
 * unit tests. Only https enclosures survive (CSP allows https media only).
 */
export function parseRss(xmlText: string): ParsedRss {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const channel = doc.querySelector('channel');
  if (doc.querySelector('parsererror') || !channel) throw new Error('invalid rss');

  const title = childText(channel, 'title') || 'Podcast';
  const author = childText(channel, 'author');
  let art = '';
  for (const el of channel.children) {
    if (el.localName === 'image') art = el.getAttribute('href') || childText(el, 'url') || art;
  }

  const episodes: Episode[] = [];
  for (const item of channel.querySelectorAll('item')) {
    // One pass over the children: feeds routinely carry thousands of items, so
    // this loop is the hot path of a full-archive parse.
    let encUrl = '';
    let durMs = 0;
    let epArt = '';
    let notes = '';
    let summary = '';
    for (const el of item.children) {
      switch (el.localName) {
        case 'enclosure':
          encUrl = el.getAttribute('url') || '';
          break;
        case 'duration':
          durMs = parseDuration(el.textContent?.trim() ?? '');
          break;
        case 'image':
          epArt = el.getAttribute('href') || childText(el, 'url') || epArt;
          break;
        // `content:encoded` is the richest when present; description and
        // itunes:summary are the common fallbacks.
        case 'encoded':
          notes = el.textContent?.trim() ?? notes;
          break;
        case 'description':
          summary = summary || (el.textContent?.trim() ?? '');
          break;
        case 'summary':
          summary = summary || (el.textContent?.trim() ?? '');
          break;
      }
    }
    const description = notes || summary;
    if (!/^https:\/\//i.test(encUrl)) continue;
    episodes.push({
      trackId: childText(item, 'guid') || encUrl,
      trackName: childText(item, 'title'),
      releaseDate: childText(item, 'pubDate'),
      episodeUrl: encUrl,
      trackTimeMillis: durMs,
      ...(epArt ? { art: epArt } : {}),
      ...(description ? { description } : {}),
    });
  }

  return { title, author, art, episodes };
}

export function rssMeta(parsed: ParsedRss, feedId: string): FeedMeta {
  return { id: feedId, name: parsed.title, artist: parsed.author, art: parsed.art };
}
