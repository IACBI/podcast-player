// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hasShowNotes, parseShowNotes } from './show-notes';

describe('parseShowNotes — text extraction', () => {
  it('splits block elements into paragraphs', () => {
    const n = parseShowNotes('<p>First para.</p><p>Second para.</p>');
    expect(n.paragraphs).toEqual(['First para.', 'Second para.']);
  });

  it('collapses whitespace and keeps inline text together', () => {
    const n = parseShowNotes('<p>Hello   <em>there</em>\n  world</p>');
    expect(n.paragraphs).toEqual(['Hello there world']);
  });

  it('returns nothing for empty or absent input', () => {
    expect(hasShowNotes(parseShowNotes(''))).toBe(false);
    expect(hasShowNotes(parseShowNotes(undefined))).toBe(false);
    expect(hasShowNotes(parseShowNotes('   '))).toBe(false);
  });

  it('handles plain text with no markup', () => {
    expect(parseShowNotes('Just a sentence.').paragraphs).toEqual(['Just a sentence.']);
  });
});

describe('parseShowNotes — hostile input', () => {
  it('drops script and style content entirely', () => {
    const n = parseShowNotes(
      '<p>Safe</p><script>alert(1)</script><style>body{display:none}</style>',
    );
    expect(n.paragraphs.join(' ')).toBe('Safe');
    expect(n.paragraphs.join(' ')).not.toContain('alert');
  });

  it('never yields a javascript: or data: link', () => {
    const n = parseShowNotes(
      '<a href="javascript:alert(1)">x</a>' +
        '<a href="data:text/html,<script>">y</a>' +
        '<a href="http://insecure.example.com">z</a>',
    );
    expect(n.links).toEqual([]);
  });

  it('keeps https links with their text', () => {
    const n = parseShowNotes('<a href="https://example.com/a">Show page</a>');
    expect(n.links).toEqual([{ text: 'Show page', href: 'https://example.com/a' }]);
  });

  it('deduplicates repeated links', () => {
    const n = parseShowNotes(
      '<a href="https://example.com/a">one</a><a href="https://example.com/a">two</a>',
    );
    expect(n.links).toHaveLength(1);
  });

  it('does not execute or fetch anything (no element is attached)', () => {
    // An <img onerror> would fire only if the markup were inserted into the
    // live document; parsing alone must be inert.
    const n = parseShowNotes('<img src="x" onerror="window.__pwned = 1"><p>ok</p>');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(n.paragraphs).toEqual(['ok']);
  });

  it('caps runaway link counts', () => {
    const many = Array.from(
      { length: 200 },
      (_, i) => `<a href="https://example.com/${i}">l${i}</a>`,
    ).join('');
    expect(parseShowNotes(many).links.length).toBeLessThanOrEqual(40);
  });
});
