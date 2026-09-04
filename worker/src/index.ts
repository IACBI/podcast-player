/**
 * Seseri API — Cloudflare Worker backend.
 *
 *   GET /v1/feed?url=      RSS/Atom proxy (text, ≤5 MB, edge-cached 15 min)
 *   GET /v1/itunes?url=    iTunes search/lookup proxy (JSON, edge-cached 1 h)
 *
 * Cross-cutting: CORS allowlist, per-IP KV rate limit.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { carriesCredential } from './credential-url';
import { edgeCached, fetchWithTimeout, readCapped, safeTarget } from './safe-fetch';
import { rateLimited } from './ratelimit';

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

const RATE_LIMITED = { error: 'rate limited' } as const;

app.use('*', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') ?? '';

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

app.notFound((c) => c.json({ error: 'not found' }, 404));

export default { fetch: app.fetch };
