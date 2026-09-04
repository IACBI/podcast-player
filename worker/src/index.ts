/**
 * Seseri API — Cloudflare Worker backend.
 *
 *   GET /v1/feed?url=      RSS/Atom proxy (text, ≤5 MB, edge-cached 15 min)
 *   GET /v1/itunes?url=    iTunes search/lookup proxy (JSON, edge-cached 1 h)
 *   GET /v1/yt/list        ?type=playlist|channel&id= → YtListing JSON
 *   GET /v1/yt/resolve     ?id=<videoId> → { audioUrl } (our own proxy URL)
 *   GET /v1/yt/audio       ?id=<videoId> → range-proxied audio bytes
 *
 * Cross-cutting: CORS allowlist, per-IP KV rate limit. YouTube listing,
 * search and audio all go through one Innertube session (`innertube.ts`).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { carriesCredential } from './credential-url';
import { edgeCached, fetchWithTimeout, readCapped, safeTarget } from './safe-fetch';
import { rateLimited } from './ratelimit';
import { tubeAudio, tubeList, tubeSearch, type TubeAudio } from './innertube';

/** Which kind of YouTube collection a listing request is for. */
export type YtKind = 'playlist' | 'channel';

// Popular feeds keep their full archive in the feed — The Daily's RSS alone
// is ~18 MB — so the cap is generous; it only guards against abuse.
const FEED_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(['https://iacbi.github.io']);
// Any localhost origin is fine — it only ever means the developer's own machine.
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowOrigin(origin: string): string | null {
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_ORIGIN.test(origin) ? origin : null;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: allowOrigin,
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  }),
);

/**
 * Audio streaming cannot use the normal per-request budget: seeking issues
 * bursts of range requests and would trip it instantly. So only *stream starts*
 * are counted — a request with no Range, or one starting at byte 0. Normal
 * playback produces one or two per episode; using the worker as a general
 * media proxy needs one per file, which is what this bounds.
 */
const AUDIO_STARTS_PER_MIN = 60;

/**
 * Second, range-blind budget. The stream-start counter above is trivially
 * bypassed with `Range: bytes=1-`, and this route deliberately has no Origin
 * check (a media element sends none) — so without this the worker is an
 * unmetered bandwidth proxy for any YouTube video.
 *
 * Deliberately generous: a continuation request arrives roughly every
 * RESPONSE_CAP bytes, so real playback of even a very long episode stays far
 * below it, while a scraper pulling files in a loop does not.
 */
const AUDIO_REQUESTS_PER_MIN = 120;

const RATE_LIMITED = { error: 'rate limited' } as const;

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? '';

  if (c.req.path === '/v1/yt/audio') {
    const range = c.req.header('range') ?? '';
    const isStreamStart = !range || /^bytes=0-/.test(range);
    if (isStreamStart && (await rateLimited(c.env.KV, ip, AUDIO_STARTS_PER_MIN, 'rla'))) {
      return c.json(RATE_LIMITED, 429, { 'retry-after': '60' });
    }
    if (await rateLimited(c.env.KV, ip, AUDIO_REQUESTS_PER_MIN, 'rlab')) {
      return c.json(RATE_LIMITED, 429, { 'retry-after': '60' });
    }
    // <audio> issues a no-cors media request and sends no Origin, so the
    // app-origin check below cannot apply here.
    return next();
  }

  if (c.req.path !== '/' && !allowOrigin(c.req.header('origin') ?? '')) {
    // Without this the proxy endpoints are usable as a general-purpose open
    // proxy, which also lets anyone seed our edge cache. Browsers always send
    // Origin on a cross-origin fetch and the app is never same-origin with the
    // worker, so a missing or foreign Origin means the caller is not the app.
    return c.json({ error: 'forbidden' }, 403);
  }

  if (await rateLimited(c.env.KV, ip)) {
    return c.json(RATE_LIMITED, 429, { 'retry-after': '60' });
  }
  await next();
});

app.get('/', (c) => c.json({ name: 'seseri-api', ok: true }));

// ── RSS/Atom proxy ──────────────────────────────────────────────────
app.get('/v1/feed', async (c) => {
  const target = safeTarget(c.req.query('url'));
  if (!target) return c.json({ error: 'invalid url' }, 400);

  const fetchFeed = async (): Promise<Response> => {
    try {
      const res = await fetchWithTimeout(target.href, 15000, {
        headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      });
      if (!res.ok) return c.json({ error: 'upstream ' + res.status }, 502);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) return c.json({ error: 'not a feed' }, 415);
      const body = await readCapped(res, FEED_MAX_BYTES);
      return new Response(body, {
        headers: { 'content-type': ct || 'application/xml; charset=utf-8' },
      });
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg === 'too large' ? 'feed too large' : 'fetch failed' }, msg === 'too large' ? 413 : 502);
    }
  };

  /**
   * Paid feeds carry the listener's own subscriber token in the URL. The client
   * already refuses to send those to the public proxies and routes them here
   * instead — but here they were being written into Cloudflare's SHARED edge
   * cache under `Cache-Control: public` for 15 minutes, which put one
   * listener's private episodes in a cache entry keyed by a URL they do not
   * exclusively control. Those responses are now never stored.
   */
  if (carriesCredential(target.href)) {
    const res = await fetchFeed();
    res.headers.set('cache-control', 'no-store');
    return res;
  }

  return edgeCached(
    'https://cache.seseri/feed?u=' + encodeURIComponent(target.href),
    15 * 60,
    c.executionCtx,
    fetchFeed,
  );
});

// ── iTunes API proxy (fixes their Origin-blind CDN caching) ─────────
app.get('/v1/itunes', async (c) => {
  const target = safeTarget(c.req.query('url'));
  if (!target || !/(^|\.)itunes\.apple\.com$/.test(target.hostname)) {
    return c.json({ error: 'invalid url' }, 400);
  }
  return edgeCached(
    'https://cache.seseri/itunes?u=' + encodeURIComponent(target.href),
    60 * 60,
    c.executionCtx,
    async () => {
      try {
        const res = await fetchWithTimeout(target.href, 10000);
        if (!res.ok) return c.json({ error: 'upstream ' + res.status }, 502);
        const body = await readCapped(res, FEED_MAX_BYTES);
        return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } });
      } catch {
        return c.json({ error: 'fetch failed' }, 502);
      }
    },
  );
});

// ── YouTube ─────────────────────────────────────────────────────────
/**
 * Absolute upload dates for the newest ~15 items, from YouTube's own Atom feed.
 *
 * Innertube's browse response only carries relative text ("1 hour ago"), and
 * converting that to a timestamp would be inventing precision. The Atom feed
 * has real ISO dates but only the newest handful of entries, so the two are
 * merged: full list from Innertube, exact dates where the feed reaches.
 *
 * Parsed with a regex rather than a DOM: workerd has no DOMParser, and this is
 * YouTube's own fixed-shape feed where both tags are unambiguous.
 */
async function atomDates(type: YtKind, id: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const url =
    'https://www.youtube.com/feeds/videos.xml?' +
    (type === 'playlist' ? 'playlist_id=' : 'channel_id=') +
    encodeURIComponent(id);
  try {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return out;
    const xml = new TextDecoder().decode(await readCapped(res, 2 * 1024 * 1024));
    for (const entry of xml.split('<entry>').slice(1)) {
      const vid = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(entry)?.[1];
      const pub = /<published>([^<]+)<\/published>/.exec(entry)?.[1];
      if (vid && pub) out.set(vid, pub);
    }
  } catch {
    /* dates are a bonus, never a reason to fail the listing */
  }
  return out;
}

app.get('/v1/yt/list', async (c) => {
  const type = c.req.query('type');
  const id = c.req.query('id') ?? '';
  if ((type !== 'playlist' && type !== 'channel') || !/^[\w-]{10,64}$/.test(id)) {
    return c.json({ error: 'invalid params' }, 400);
  }
  const kind = type as YtKind;
  return edgeCached(
    `https://cache.seseri/yt-list?t=${type}&i=${encodeURIComponent(id)}`,
    15 * 60,
    c.executionCtx,
    async () => {
      const [listing, dates] = await Promise.all([tubeList(kind, id), atomDates(kind, id)]);
      if (!listing) return c.json({ error: 'no upstream' }, 502);
      if (dates.size) {
        for (const item of listing.items) {
          item.published = dates.get(item.videoId) ?? '';
        }
      }
      return c.json(listing);
    },
  );
});

app.get('/v1/yt/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2 || q.length > 100) return c.json({ error: 'invalid query' }, 400);
  return edgeCached(
    'https://cache.seseri/yt-search?q=' + encodeURIComponent(q.toLowerCase()),
    15 * 60,
    c.executionCtx,
    async () => {
      try {
        const items = await tubeSearch(q);
        if (items.length) return c.json({ items });
      } catch (e) {
        console.error('tubeSearch failed:', (e as Error).message);
      }
      return c.json({ error: 'no upstream' }, 502);
    },
  );
});

/** KV's floor, and a ceiling well inside how long googlevideo signs a URL for. */
const CACHE_TTL_MIN = 60;
const CACHE_TTL_MAX = 6 * 3600;
/** Stop serving a signed URL this long before it actually expires. */
const EXPIRY_MARGIN_S = 300;

/**
 * How long a resolved format stays usable. googlevideo signs each URL with its
 * own `expire` (a unix timestamp), so read that instead of guessing: the old
 * fixed 1800 s threw away URLs with hours left on them — every discard costs a
 * full Innertube round trip — while a longer fixed TTL would have handed out
 * dead URLs. Falls back to the conservative floor when the param is missing.
 */
export function ttlForUrl(url: string): number {
  const m = /[?&]expire=(\d+)/.exec(url);
  if (!m) return 1800;
  const left = Number(m[1]) - Math.floor(Date.now() / 1000) - EXPIRY_MARGIN_S;
  return Math.max(CACHE_TTL_MIN, Math.min(left, CACHE_TTL_MAX));
}

/**
 * Resolve an audio format for the audio proxy; cached in KV for as long as the
 * signed URL is actually good for.
 *
 * `cacheFailure` exists for the mid-stream retry path. A failure is normally
 * cached ("none") so an unresolvable video fails fast instead of re-probing
 * every client on each request — but when the retry is recovering an episode
 * that was PLAYING a second ago, a transient Innertube error must not blacklist
 * it for the next 15 minutes.
 */
async function audioFor(
  kv: KVNamespace,
  id: string,
  cacheFailure = true,
): Promise<TubeAudio | null> {
  const key = 'yta2:' + id;
  const hit = await kv.get<TubeAudio | { none: true }>(key, 'json').catch(() => null);
  if (hit) return 'none' in hit ? null : hit;
  const fresh = await tubeAudio(id).catch((e: Error) => {
    console.error('tubeAudio failed:', e.message);
    return null;
  });
  if (fresh) {
    await kv
      .put(key, JSON.stringify(fresh), { expirationTtl: ttlForUrl(fresh.url) })
      .catch(() => {});
  } else if (cacheFailure) {
    await kv.put(key, JSON.stringify({ none: true }), { expirationTtl: 900 }).catch(() => {});
  }
  return fresh;
}

/**
 * Innertube only: its stream URLs are IP-bound to this worker, so the client
 * gets our /v1/yt/audio proxy URL rather than the raw googlevideo one.
 *
 * A public-Piped fallback used to sit behind this. It was removed after being
 * measured: across 70 videos it resolved zero, and all 7 instances failed a
 * direct `/streams` probe (scripts/yt-resolve-rate.cjs). A 502 here is now the
 * honest answer, and the client says so instead of dropping to an ad-carrying
 * iframe that cannot play with the screen off.
 */
app.get('/v1/yt/resolve', async (c) => {
  const id = c.req.query('id') ?? '';
  if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'invalid id' }, 400);
  const own = await audioFor(c.env.KV, id);
  if (!own) return c.json({ error: 'no stream' }, 502);
  return c.json({ audioUrl: new URL('/v1/yt/audio?id=' + id, c.req.url).href });
});

/**
 * Stream the audio bytes through the worker (range-aware → seek works).
 * googlevideo rejects range-less and open-ended requests but happily serves
 * bounded ranges — so the requested span is fetched as sequential chunks
 * stitched into one streamed response.
 *
 * SUBREQUEST BUDGET. Workers allow a fixed number of subrequests per *request*
 * (50 on the free plan). The old code answered a `bytes=0-` with the WHOLE
 * file in 1 MB chunks, so a 57 MB episode needed 57 subrequests: the loop
 * died around 50 MB, the `catch` swallowed it, and the response closed early
 * having promised a larger `content-length`. The browser saw a truncated body,
 * fired `error`, and playback stopped mid-episode with nothing in the logs.
 *
 * The fix is to stop trying to serve everything in one response. A server may
 * return less than the requested range; the client then asks for the rest.
 * So each response carries at most RESPONSE_CAP bytes, which pins the
 * subrequest count per request at RESPONSE_CAP / AUDIO_CHUNK (+1 for a format
 * refresh) regardless of how long the episode is.
 */
const AUDIO_CHUNK = 8 * 1024 * 1024;
const RESPONSE_CAP = 32 * 1024 * 1024;

app.get('/v1/yt/audio', async (c) => {
  const id = c.req.query('id') ?? '';
  if (!/^[\w-]{11}$/.test(id)) return c.json({ error: 'invalid id' }, 400);
  const kv = c.env.KV;
  let fmt = await audioFor(kv, id);
  if (!fmt) return c.json({ error: 'no stream' }, 502);
  // youtubei.js only checks the scheme, so confirm the host before streaming.
  if (!safeTarget(fmt.url)) return c.json({ error: 'no stream' }, 502);

  const size = fmt.contentLength || 0;
  const m = /bytes=(\d+)-(\d*)/.exec(c.req.header('range') ?? '');
  const clientRanged = !!m;
  const start = m ? parseInt(m[1] ?? '0') : 0;
  const endWanted =
    m && m[2] ? Math.min(parseInt(m[2]), size ? size - 1 : Infinity) : size ? size - 1 : -1;
  if (endWanted < 0) return c.json({ error: 'no stream' }, 502); // unknown length
  if (start > endWanted) return c.body(null, 416);
  /**
   * A ranged client (every media element) gets at most RESPONSE_CAP and comes
   * back for the rest, each continuation with a fresh subrequest budget.
   *
   * A range-LESS client gets the whole file: that is the offline-download path
   * (`player/offline.ts` fetches with no Range), and capping it would silently
   * store a truncated episode. 206 is not a legal answer to a request that
   * carried no Range, so there is no way to signal a short read there either.
   * Its ceiling is therefore the plain subrequest budget — about 380 MB at
   * AUDIO_CHUNK 8 MB on the free plan, well past any real episode.
   */
  const endServed = clientRanged ? Math.min(endWanted, start + RESPONSE_CAP - 1) : endWanted;

  /**
   * `retriesLeft` rather than a boolean: googlevideo 403s a live URL
   * intermittently, and the first re-resolve can land on the same bad state.
   * Two tries covers that without turning a genuinely dead video into a loop.
   */
  const chunk = async (from: number, to: number, retriesLeft: number): Promise<Response> => {
    // googlevideo's own `range` query param passes where the Range header is
    // rejected for non-zero offsets (PO-token era first-chunk-only behavior)
    const u = fmt!.url + `&range=${from}-${to}`;
    // fetchWithTimeout, not bare fetch: the URL comes from youtubei.js output,
    // so it needs the same manual-redirect re-validation as any other upstream.
    // The timeout covers reaching the response, not draining its body.
    const res = await fetchWithTimeout(u, 20000, { headers: { 'user-agent': fmt!.ua } });
    if ((res.status === 403 || res.status === 410) && retriesLeft > 0) {
      await kv.delete('yta2:' + id).catch(() => {});
      // cacheFailure: false — this video demonstrably plays, so a transient
      // resolve failure here must not poison the next 15 minutes for it.
      fmt = await audioFor(kv, id, false);
      if (fmt) return chunk(from, to, retriesLeft - 1);
    }
    return res;
  };

  // Probe the first chunk before committing to a streamed response
  const firstTo = Math.min(start + AUDIO_CHUNK - 1, endServed);
  const first = await chunk(start, firstTo, 2);
  if (!first.ok && first.status !== 206) {
    return c.json({ error: 'upstream ' + first.status }, 502);
  }

  const total = endServed - start + 1;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let res = first;
        let from = start;
        for (;;) {
          const reader = res.body?.getReader();
          if (!reader) break;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          from += AUDIO_CHUNK;
          if (from > endServed) break;
          res = await chunk(from, Math.min(from + AUDIO_CHUNK - 1, endServed), 2);
          if (!res.ok && res.status !== 206) break;
        }
      } catch {
        /* client went away or upstream died mid-stream */
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  const headers = new Headers({
    'content-type': fmt.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-length': String(total),
  });
  if (clientRanged) {
    headers.set('content-range', `bytes ${start}-${endServed}/${size}`);
    return new Response(stream, { status: 206, headers });
  }
  return new Response(stream, { status: 200, headers });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default { fetch: app.fetch };
