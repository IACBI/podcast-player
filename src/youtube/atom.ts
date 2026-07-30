import { fetchTextProxied } from '../feeds/proxy-chain';
import { type YtListing } from './service';

/** Recursively collect descendant elements by local (namespace-stripped) name. */
function ytFindAll(root: Element, localName: string): Element[] {
  const out: Element[] = [];
  (function walk(n: Element) {
    for (const c of n.children) {
      if (c.localName === localName) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

function childText(parent: Element, tag: string): string {
  for (const el of parent.children) {
    if (el.localName === tag) return el.textContent?.trim() ?? '';
  }
  return '';
}

/**
 * Fetch + normalize a YouTube Atom feed (latest ~15) from the raw XML.
 *
 * `api.rss2json.com` used to be the PRIMARY source here, ahead of our own
 * Worker. That handed a third party the channel or playlist the user was
 * opening, on an unauthenticated endpoint with a small shared rate limit, to
 * do something the proxy chain below already does.
 */
export async function fetchYtFeed(
  feedUrl: string,
  signal?: AbortSignal,
): Promise<YtListing> {
  // No credential guard: this URL is built by us from a public channel or
  // playlist id. A 24-char channel id looks exactly like an opaque token, so
  // the guard would refuse every YouTube channel.
  const xml = await fetchTextProxied(feedUrl, signal, undefined, false);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const feed = doc.querySelector('feed');
  if (doc.querySelector('parsererror') || !feed) throw new Error('invalid yt feed');
  const authorEl = ytFindAll(feed, 'author')[0];
  const items: YtListing['items'] = [];
  for (const entry of feed.querySelectorAll('entry')) {
    const vid = ytFindAll(entry, 'videoId')[0]?.textContent?.trim() ?? '';
    if (!vid) continue;
    const thEl = ytFindAll(entry, 'thumbnail')[0];
    items.push({
      videoId: vid,
      title: childText(entry, 'title'),
      published: childText(entry, 'published'),
      durationSec: 0,
      thumb: thEl?.getAttribute('url') ?? '',
    });
  }
  return {
    title: childText(feed, 'title') || 'YouTube',
    author: authorEl ? childText(authorEl, 'name') : '',
    items,
  };
}
