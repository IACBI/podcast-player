import type { Subscription } from '../feeds/types';

/**
 * OPML export/import for subscriptions. RSS subs use the standard xmlUrl;
 * iTunes subs are encoded as web links (url attribute) that the importer maps
 * back through their public URL form.
 *
 * YouTube links are deliberately NOT imported: the app dropped YouTube support,
 * so a `yt:` subscription could only ever render as a row that fails to open.
 * A file exported by an older version still imports — its podcast entries are
 * kept and its YouTube ones skipped.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportOpml(subs: Subscription[]): string {
  const outlines = subs
    .map((f) => {
      const id = String(f.id);
      const text = xmlEscape(f.name || id);
      if (id.startsWith('rss:')) {
        return `    <outline type="rss" text="${text}" xmlUrl="${xmlEscape(id.slice(4))}"/>`;
      }
      return `    <outline type="link" text="${text}" url="https://podcasts.apple.com/podcast/id${xmlEscape(id)}"/>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Seseri subscriptions</title></head>
  <body>
${outlines}
  </body>
</opml>
`;
}

export interface OpmlEntry {
  /** Subscription id in legacy format. */
  id: string;
  name: string;
}

/** Parse OPML text into importable entries (unknown outlines are skipped). */
export function parseOpml(xml: string): OpmlEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('invalid opml');
  const out: OpmlEntry[] = [];
  doc.querySelectorAll('outline').forEach((o) => {
    const name = o.getAttribute('text') || o.getAttribute('title') || '';
    const xmlUrl = o.getAttribute('xmlUrl');
    if (xmlUrl && /^https?:\/\//i.test(xmlUrl)) {
      out.push({ id: 'rss:' + xmlUrl, name: name || xmlUrl });
      return;
    }
    const url = o.getAttribute('url') || o.getAttribute('htmlUrl') || '';
    const apple = url.match(/podcasts\.apple\.com\/.*id(\d{4,14})/i) || url.match(/^id?(\d{6,12})$/);
    if (apple?.[1]) {
      out.push({ id: apple[1], name: name || apple[1] });
      return;
    }
  });
  return out;
}
