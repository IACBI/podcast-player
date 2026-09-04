import { describe, expect, it } from 'vitest';
import { extractItunesId, parseDirectInput } from './input-parse';

describe('extractItunesId', () => {
  it('finds id in an Apple Podcasts URL', () => {
    expect(extractItunesId('https://podcasts.apple.com/tr/podcast/x/id1550551126')).toBe(
      '1550551126',
    );
  });
  it('accepts a bare numeric id', () => {
    expect(extractItunesId('1550551126')).toBe('1550551126');
  });
  it('rejects free text', () => {
    expect(extractItunesId('radyo tiyatrosu')).toBeNull();
  });
});

describe('parseDirectInput', () => {
  it('classifies rss urls', () => {
    expect(parseDirectInput('https://feeds.example.com/pod')).toEqual({
      kind: 'rss',
      url: 'https://feeds.example.com/pod',
    });
  });
  it('returns null for search terms', () => {
    expect(parseDirectInput('teknoloji')).toBeNull();
  });
  it('refuses plaintext and script schemes', () => {
    expect(parseDirectInput('http://feeds.example.com/pod')).toBeNull();
    expect(parseDirectInput('javascript:alert(1)')).toBeNull();
    expect(parseDirectInput('data:text/xml,<rss/>')).toBeNull();
    expect(parseDirectInput('file:///etc/passwd')).toBeNull();
  });
});
