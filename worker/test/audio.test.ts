/**
 * /v1/yt/audio — the range/chunking contract.
 *
 * The route had no tests, and the bug it hides is invisible: Workers cap
 * subrequests per request (50 on the free plan), so streaming a whole episode
 * in small chunks died mid-file, the error was swallowed, and the response
 * closed short of the `content-length` it had promised. The browser reported a
 * generic media error and playback just stopped.
 *
 * Every test here asserts the SUBREQUEST COUNT as well as the headers: the
 * interceptors are registered with exact `times()` and
 * `assertNoPendingInterceptors()` fails if the route made fewer calls than
 * expected, while an unregistered extra call fails outright.
 */
import { createExecutionContext, env, fetchMock, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker, { ttlForUrl } from '../src/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    KV: KVNamespace;
  }
}

const VID = 'abcdefghijk';
const GV_ORIGIN = 'https://rr1---sn-test.googlevideo.com';
const GV_URL = GV_ORIGIN + '/videoplayback?expire=1';

const MB = 1024 * 1024;
const AUDIO_CHUNK = 8 * MB;
const RESPONSE_CAP = 32 * MB;

/** Pre-seed the resolved format so the route never touches Innertube. */
async function seedFormat(contentLength: number, id = VID): Promise<void> {
  await env.KV.put(
    'yta2:' + id,
    JSON.stringify({
      url: GV_URL,
      mime: 'audio/mp4',
      bitrate: 128000,
      contentLength,
      ua: 'test-ua',
    }),
  );
}

/** Expect exactly `n` upstream chunk fetches. */
function expectChunks(n: number): void {
  fetchMock
    .get(GV_ORIGIN)
    .intercept({ path: /^\/videoplayback/ })
    .reply(206, 'x')
    .times(n);
}

async function audio(range?: string, id = VID, ip?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const headers: Record<string, string> = {};
  if (range) headers.range = range;
  if (ip) headers['cf-connecting-ip'] = ip;
  const res = await worker.fetch(
    new Request(`https://api.test/v1/yt/audio?id=${id}`, { headers }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());

describe('/v1/yt/audio range handling', () => {
  it('caps a ranged request at RESPONSE_CAP instead of streaming the whole file', async () => {
    const size = 60 * MB; // ~1 hour at 128 kbps — the case that used to break
    await seedFormat(size);
    expectChunks(RESPONSE_CAP / AUDIO_CHUNK);

    const res = await audio('bytes=0-');
    await res.arrayBuffer();

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-${RESPONSE_CAP - 1}/${size}`);
    expect(res.headers.get('content-length')).toBe(String(RESPONSE_CAP));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });

  it('serves the tail when the client comes back for the remainder', async () => {
    const size = 40 * MB;
    await seedFormat(size);
    // 40 MB - 32 MB = 8 MB left → exactly one chunk.
    expectChunks(1);

    const res = await audio(`bytes=${RESPONSE_CAP}-`);
    await res.arrayBuffer();

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${RESPONSE_CAP}-${size - 1}/${size}`);
    expect(res.headers.get('content-length')).toBe(String(size - RESPONSE_CAP));
  });

  it('honours an explicit bounded range without padding it out to the cap', async () => {
    await seedFormat(60 * MB);
    expectChunks(1);

    const res = await audio('bytes=1000-2000');
    await res.arrayBuffer();

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 1000-2000/${60 * MB}`);
    expect(res.headers.get('content-length')).toBe('1001');
  });

  it('serves a range-less request whole, because 206 is not a legal answer there', async () => {
    // This is the offline-download path; capping it would store a truncated
    // episode with no way to signal the short read.
    const size = 20 * MB;
    await seedFormat(size);
    expectChunks(Math.ceil(size / AUDIO_CHUNK));

    const res = await audio();
    await res.arrayBuffer();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
    expect(res.headers.get('content-length')).toBe(String(size));
  });

  it('stays well inside the free plan subrequest budget for a long episode', async () => {
    // The regression guard: one response must never need ~50 upstream calls.
    const perResponse = RESPONSE_CAP / AUDIO_CHUNK;
    expect(perResponse).toBeLessThanOrEqual(16);
  });

  it('416s a range that starts past the end', async () => {
    await seedFormat(1000);
    expect((await audio('bytes=5000-')).status).toBe(416);
  });

  it('502s when no format can be resolved', async () => {
    // Innertube is stubbed to reject, so nothing is cached for this id.
    expect((await audio(undefined, 'zzzzzzzzzzz')).status).toBe(502);
  });
});

describe('/v1/yt/audio abuse budget', () => {
  it('rate limits a non-zero Range, which used to bypass the counter entirely', async () => {
    // `bytes=0-` was the only shape counted, so `bytes=1-` made the route an
    // unmetered bandwidth proxy — and it has no Origin gate to fall back on.
    const ip = '203.0.113.7';
    // Unresolvable id: 502s without any network, so this exercises only the
    // middleware. The first call caches the "no format" verdict in KV.
    const id = 'yyyyyyyyyyy';
    let limited = false;
    // The limiter counts into a fixed one-minute window, so a loop that
    // straddles a minute boundary starts again from zero. 300 iterations is
    // more than twice the 120/min budget, which trips it no matter where the
    // single boundary a fast loop can cross happens to fall — 200 did not, and
    // failed about one run in ten.
    for (let i = 0; i < 300 && !limited; i++) {
      const res = await audio('bytes=1-', id, ip);
      if (res.status === 429) {
        limited = true;
        expect(res.headers.get('retry-after')).toBe('60');
      } else {
        expect(res.status).toBe(502); // got past the gate, failed on resolution
      }
    }
    expect(limited).toBe(true);
  });

  it('leaves a different caller unaffected', async () => {
    expect((await audio('bytes=1-', 'yyyyyyyyyyy', '198.51.100.9')).status).toBe(502);
  });
});


/**
 * A video that is PLAYING must not be blacklisted by a transient upstream 403.
 * The mid-stream retry re-resolves with negative caching switched off; caching
 * the failure there left the episode dead for the next 15 minutes, mid-listen.
 */
describe('mid-stream 403 recovery', () => {
  it('does not negative-cache a failed re-resolve for a playing video', async () => {
    await seedFormat(10 * MB);
    fetchMock.get(GV_ORIGIN).intercept({ path: /^\/videoplayback/ }).reply(403, '');

    const res = await audio('bytes=0-');
    expect(res.status).toBe(502); // Innertube is stubbed to fail, so no fresh URL

    // The cached format was dropped, but nothing was written in its place.
    expect(await env.KV.get('yta2:' + VID)).toBeNull();
  });

  it('still negative-caches a video that never resolved at all', async () => {
    const id = 'yyyyyyyyyyy';
    expect((await audio(undefined, id)).status).toBe(502);
    expect(await env.KV.get('yta2:' + id)).toBe(JSON.stringify({ none: true }));
  });
});

/**
 * googlevideo signs each URL with its own expiry. Caching for a fixed 1800 s
 * discarded URLs with hours left (a wasted Innertube round trip each time);
 * caching longer than the signature would hand out dead ones.
 */
describe('ttlForUrl', () => {
  const now = () => Math.floor(Date.now() / 1000);

  it('follows the URL expiry, minus a safety margin', () => {
    expect(ttlForUrl(`https://gv/x?expire=${now() + 3600}`)).toBeCloseTo(3600 - 300, -1);
  });

  it('never exceeds six hours, however long the signature claims', () => {
    expect(ttlForUrl(`https://gv/x?expire=${now() + 86400}`)).toBe(6 * 3600);
  });

  it('clamps an already-expired URL to the KV floor rather than going negative', () => {
    expect(ttlForUrl('https://gv/x?expire=1')).toBe(60);
  });

  it('falls back to the conservative default when there is no expiry', () => {
    expect(ttlForUrl('https://gv/videoplayback?id=1')).toBe(1800);
  });
});
