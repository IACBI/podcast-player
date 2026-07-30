/**
 * Show notes from a feed, reduced to plain text plus safe links.
 *
 * Feed descriptions are attacker-controlled HTML. Rather than render that —
 * which would mean adding a sanitizer and betting the app's zero-XSS posture on
 * it staying correct — the markup is parsed, the text is extracted, and links
 * are kept only as `{text, href}` pairs with an https-only href. The UI then
 * builds real nodes with `h()`, so no HTML string ever reaches the DOM and the
 * app keeps its single runtime dependency.
 */

import { httpsOnly } from '../lib/safe';

export interface NoteLink {
  text: string;
  href: string;
}

export interface ShowNotes {
  /** Paragraphs of plain text; empty when the feed has no usable description. */
  paragraphs: string[];
  links: NoteLink[];
}

/** Tags whose content is not prose and must not leak into the text. */
const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE']);
/** Tags that end the current paragraph. */
const BREAK = new Set([
  'P',
  'BR',
  'DIV',
  'LI',
  'UL',
  'OL',
  'TR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'SECTION',
  'ARTICLE',
]);

const MAX_LINKS = 40;
const MAX_CHARS = 8000;

/**
 * Parse a description into paragraphs and links.
 *
 * Uses `text/html` in a detached document: `DOMParser` does not execute
 * scripts, load subresources or resolve external entities, and the result is
 * never attached anywhere.
 */
export function parseShowNotes(raw: string | undefined | null): ShowNotes {
  const source = (raw ?? '').trim();
  if (!source) return { paragraphs: [], links: [] };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, 'text/html');
  } catch {
    return { paragraphs: [], links: [] };
  }
  const body = doc.body;
  if (!body) return { paragraphs: [], links: [] };

  const paragraphs: string[] = [];
  const links: NoteLink[] = [];
  const seenHref = new Set<string>();
  let buffer = '';
  let total = 0;

  const flush = (): void => {
    const text = buffer.replace(/\s+/g, ' ').trim();
    buffer = '';
    if (text) paragraphs.push(text);
  };

  const walk = (node: Node): void => {
    if (total >= MAX_CHARS) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue ?? '';
      buffer += t;
      total += t.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) return;

    if (tag === 'A') {
      const href = httpsOnly(el.getAttribute('href'));
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (href && !seenHref.has(href) && links.length < MAX_LINKS) {
        seenHref.add(href);
        links.push({ text: text || href, href });
      }
      // Keep the anchor's words in the prose too.
      buffer += text;
      total += text.length;
      return;
    }

    if (BREAK.has(tag)) flush();
    for (const child of Array.from(el.childNodes)) walk(child);
    if (BREAK.has(tag)) flush();
  };

  for (const child of Array.from(body.childNodes)) walk(child);
  flush();

  return { paragraphs, links };
}

/** True when there is anything worth showing. */
export function hasShowNotes(n: ShowNotes): boolean {
  return n.paragraphs.length > 0 || n.links.length > 0;
}
