import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTextProxied, fetchWithTimeout } from './proxy-chain';

function res(body: string, ok = true, status = 200): Response {
  return new Response(body, { status: ok ? status : 500 });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchTextProxied', () => {
  it('returns the first proxy that answers with a body', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('allorigins')) return res(''); // empty → rejected
      if (u.includes('codetabs')) return res('<rss>ok</rss>');
      return new Response('', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTextProxied('https://example.com/feed')).resolves.toBe('<rss>ok</rss>');
  });

  it('fails with a single error when every proxy is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(fetchTextProxied('https://example.com/feed')).rejects.toThrow('fetch failed');
  });

  it('refuses to hand a credential-bearing feed to the public proxies', async () => {
    const fetchMock = vi.fn(async () => res('<rss>leaked</rss>'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchTextProxied('https://www.patreon.com/rss/x?auth=Ab3xK9zQ11mNpQrStUvWxYz'),
    ).rejects.toThrow('private-feed');
    // The point of the guard: no request may leave at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still proxies an ordinary public feed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res('<rss>ok</rss>')));
    await expect(fetchTextProxied('https://feeds.example.com/pod.xml')).resolves.toBe(
      '<rss>ok</rss>',
    );
  });

  it('skips the guard for app-built URLs (YouTube channel ids look opaque)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res('<feed>yt</feed>')));
    const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCuAXFkgsw1L7xaCfnd5JJOw';
    await expect(fetchTextProxied(url, undefined, undefined, false)).resolves.toBe('<feed>yt</feed>');
    // ...and would be refused with the guard on, which is why atom.ts opts out.
    await expect(fetchTextProxied(url)).rejects.toThrow('private-feed');
  });

  it('propagates an abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const ctrl = new AbortController();
    const p = fetchTextProxied('https://example.com/feed', ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('fetchWithTimeout', () => {
  it('aborts a hanging request after the per-attempt timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    await expect(fetchWithTimeout('https://slow.example', undefined, 30)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
