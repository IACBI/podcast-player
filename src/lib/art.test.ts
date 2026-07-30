import { describe, expect, it } from 'vitest';
import { artAt, artSrcset } from './art';

const MZ =
  'https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/ab/64/66/abc/mza_150848.jpg/100x100bb.jpg';
const YT = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
const RSS = 'https://megaphone.imgix.net/podcasts/abc/image/Tile.jpg';

describe('artAt — mzstatic', () => {
  it('rewrites the rendition segment', () => {
    expect(artAt(MZ, 600)).toBe(MZ.replace('100x100bb.jpg', '600x600bb.jpg'));
  });

  it('serves webp on request', () => {
    expect(artAt(MZ, 1024, { webp: true })).toBe(MZ.replace('100x100bb.jpg', '1024x1024bb.webp'));
  });

  it('preserves the crop code, which controls framing', () => {
    const wz = MZ.replace('100x100bb.jpg', '1200x630wz.png');
    expect(artAt(wz, 600)).toContain('600x600wz.png');
  });

  it('clamps absurd sizes', () => {
    expect(artAt(MZ, 99999)).toContain('1600x1600bb.jpg');
    expect(artAt(MZ, 1)).toContain('32x32bb.jpg');
  });

  it('leaves a non-rendition path alone', () => {
    const odd = 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/source';
    expect(artAt(odd, 600)).toBe(odd);
  });
});

describe('artAt — i.ytimg.com', () => {
  it('snaps up the fixed ladder', () => {
    expect(artAt(YT, 88)).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg');
    expect(artAt(YT, 300)).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(artAt(YT, 480)).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('downgrades an oversized stored URL for small rows', () => {
    // Feeds store hqdefault; a 44px row should not pull 480px of thumbnail.
    expect(artSrcset(YT, [44, 88])).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg 120w');
  });

  it('never climbs past hqdefault — sd/maxres 404 on older uploads', () => {
    expect(artAt(YT, 1024)).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('uses the vi_webp path for webp', () => {
    expect(artAt(YT, 480, { webp: true })).toBe(
      'https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/hqdefault.webp',
    );
  });
});

describe('artAt — unknown hosts', () => {
  it('returns RSS artwork untouched (already high-res)', () => {
    expect(artAt(RSS, 1024)).toBe(RSS);
  });

  it('returns "" when webp is required but unavailable', () => {
    expect(artAt(RSS, 1024, { webp: true })).toBe('');
  });

  it('rejects non-https and empty input via httpsOnly', () => {
    expect(artAt('http://img.example.com/a.jpg', 600)).toBe('');
    expect(artAt('javascript:alert(1)', 600)).toBe('');
    expect(artAt('', 600)).toBe('');
    expect(artAt(undefined, 600)).toBe('');
    expect(artAt(null, 600)).toBe('');
  });

  it('rejects lookalike hosts', () => {
    const evil = 'https://mzstatic.com.evil.test/image/thumb/x/100x100bb.jpg';
    expect(artAt(evil, 600)).toBe(evil);
    expect(artAt(evil, 600, { webp: true })).toBe('');
  });
});

describe('artSrcset', () => {
  it('describes each candidate by the width actually served', () => {
    expect(artSrcset(MZ, [320, 640])).toBe(
      `${MZ.replace('100x100bb.jpg', '320x320bb.jpg')} 320w, ` +
        `${MZ.replace('100x100bb.jpg', '640x640bb.jpg')} 640w`,
    );
  });

  it('deduplicates widths that collapse onto one ladder step', () => {
    // 480 and 1024 both resolve to hqdefault; it must appear once.
    expect(artSrcset(YT, [480, 1024])).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg 480w');
  });

  it('returns "" for hosts that cannot be upgraded', () => {
    expect(artSrcset(RSS, [320, 640])).toBe('');
    expect(artSrcset('', [320])).toBe('');
  });
});
