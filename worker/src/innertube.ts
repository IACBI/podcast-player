/**
 * Direct YouTube access via youtubei.js (plan option A). The ANDROID_VR/IOS
 * clients return direct (uncipherd) stream URLs, but those are bound to the
 * resolver's IP — so the audio itself is streamed through /v1/yt/audio rather
 * than handed to the browser. Search/listing come from the same session.
 */
import { Innertube } from 'youtubei.js';
import { fetchWithTimeout } from './safe-fetch';

let tube: Promise<Innertube> | null = null;

export function innertube(): Promise<Innertube> {
  if (!tube) {
    tube = Innertube.create({
      // Server-generated session: locally-generated visitor data now trips
      // YouTube's "Sign in to confirm you're not a bot" wall on most videos.
      generate_session_locally: false,
      // No player JS: the clients below hand out direct URLs, and running
      // YouTube's cipher code needs a JS evaluator workerd doesn't allow.
      // (Format.decipher without a player passes the direct URL through.)
      retrieve_player: false,
      // workerd rejects unbound fetch ("Illegal invocation") — rebind it
      fetch: (input, init) => globalThis.fetch(input as RequestInfo, init),
    });
    // A failed create must not poison the cache for the isolate's lifetime.
    tube.catch(() => {
      tube = null;
    });
  }
  return tube;
}

/** YouTube often hands out protocol-relative thumbnail URLs. */
function absThumb(u: string): string {
  return u.startsWith('//') ? 'https:' + u : u;
}

export interface YtItem {
  videoId: string;
  title: string;
  /** ISO date string; '' when unknown. */
  published: string;
  durationSec: number;
  thumb: string;
}

export interface YtListing {
  title: string;
  author: string;
  items: YtItem[];
  /**
   * True when more items exist than we could fetch. YouTube answers the first
   * page from a datacenter IP but frequently 403s the continuation requests, so
   * a listing is often a prefix of the channel rather than all of it — and the
   * UI has to say so instead of presenting 60 of 500 as the whole show.
   */
  partial: boolean;
}

/** "11:00" | "1:02:03" → seconds. 0 when unparseable (live, upcoming, …). */
function badgeDuration(text: string): number {
  const parts = text.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Pull the fields we need out of one feed entry.
 *
 * Channel and playlist listings both come back as `LockupView` nodes now, whose
 * useful parts are nested three levels deep and shaped for rendering rather
 * than for data. Written defensively against `unknown` for the same reason
 * `tubeSearch` is: these shapes change without notice, and one renamed field
 * must degrade a single item rather than throw away the listing.
 *
 * Note what is NOT here: an upload date. The browse response carries only
 * relative text ("1 hour ago"), and turning that into an ISO timestamp would be
 * inventing precision YouTube did not give us. Absolute dates are merged in
 * from the Atom feed by the caller, for the items it covers.
 */
function itemFromNode(node: unknown): YtItem | null {
  const n = node as Record<string, any>;
  const videoId = String(n?.content_id ?? n?.video_id ?? n?.id ?? '');
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  if (n?.content_type && n.content_type !== 'VIDEO') return null;

  const title = String(
    n?.metadata?.title?.text ?? n?.title?.text ?? n?.title ?? '',
  );

  let durationSec = Number(n?.duration?.seconds ?? 0) || 0;
  if (!durationSec) {
    const overlays = (n?.content_image?.overlays ?? []) as Array<Record<string, any>>;
    for (const o of overlays) {
      for (const b of (o?.badges ?? []) as Array<Record<string, any>>) {
        const d = badgeDuration(String(b?.text ?? ''));
        if (d) {
          durationSec = d;
          break;
        }
      }
      if (durationSec) break;
    }
  }

  // The lockup thumbnails carry signed resizing params that expire; the plain
  // CDN path is deterministic from the id and never goes stale.
  return {
    videoId,
    title,
    published: '',
    durationSec,
    thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

/** Stop paginating here — a channel can have tens of thousands of uploads. */
const LIST_CAP = 400;
/** Guards against a continuation loop that never reports completion. */
const MAX_PAGES = 12;
/**
 * Two separate budgets, because they buy different things. Measured against the
 * deployed Worker on fresh channels (edge cache misses only):
 *
 *   no budget        248 items avg, median 30 s, max 55 s — the client, which
 *                    gives the whole feed load 25 s, never sees these
 *   9 s shared       96 items avg, median 9.5 s, but only 7/12 channels
 *                    answered at all
 *   split (this)     ~150 items avg, median 14 s, p90 20 s, 7/10 answered
 *
 * A shared budget is what made the 9 s run fail so often: retrying the FIRST
 * page is what turns a 502 into a listing, and a tight overall deadline spends
 * that allowance on pagination instead. So the first page keeps its retries and
 * only the walk through the rest of the channel is time-boxed.
 *
 * Success rate swings between runs (70–92% observed) because YouTube's bot wall
 * treats datacenter IPs inconsistently; two runs cannot separate a config change
 * from its mood. What does not swing: a failure here falls back to YouTube's
 * Atom feed, which is exactly the 15 items every channel used to be limited to,
 * so this is a strict improvement in every outcome.
 */
const PAGE_BUDGET_MS = 8_000;
/** Hard ceiling on first-page retries, so a bad run cannot outlive the
 *  client's own 22 s timeout and waste the whole feed load. */
const ATTEMPT_CEILING_MS = 14_000;

type Page = { videos: unknown[]; has_continuation: boolean; getContinuation(): Promise<unknown> };

async function collect(feed: Page, deadline: number): Promise<{ items: YtItem[]; partial: boolean }> {
  const out: YtItem[] = [];
  const seen = new Set<string>();
  let page: Page | null = feed;
  let partial = false;

  for (let i = 0; i < MAX_PAGES && page && out.length < LIST_CAP; i++) {
    for (const node of page.videos ?? []) {
      const item = itemFromNode(node);
      if (item && !seen.has(item.videoId)) {
        seen.add(item.videoId);
        out.push(item);
      }
    }
    if (!page.has_continuation) break;
    if (out.length >= LIST_CAP || Date.now() > deadline) {
      partial = true;
      break;
    }
    // Measured from production: continuations are 403'd intermittently, and a
    // single immediate retry recovers a large share of them (a channel that
    // stopped at 30 items reaches 150–240 on the retry).
    let next: Page | null = null;
    for (let attempt = 0; attempt < 2 && !next; attempt++) {
      if (attempt && Date.now() > deadline) break;
      try {
        next = (await page.getContinuation()) as Page;
      } catch (e) {
        if (attempt) console.error('tubeList continuation failed:', (e as Error).message);
      }
    }
    if (!next) {
      partial = true;
      break;
    }
    page = next;
  }
  if (page?.has_continuation && out.length >= LIST_CAP) partial = true;
  return { items: out.slice(0, LIST_CAP), partial };
}

/**
 * List a channel's uploads or a playlist's items via Innertube — the same
 * session that resolves audio.
 *
 * This replaces a Piped/Invidious pool that was measured completely dead
 * (0 successes; every instance 502/403 on every listing endpoint), which left
 * every YouTube show in the app capped at the 15 items the Atom feed carries.
 */
async function listOnce(type: 'channel' | 'playlist', id: string): Promise<YtListing | null> {
  const yt = await innertube();
  if (type === 'playlist') {
    const pl = await yt.getPlaylist(id);
    const { items, partial } = await collect(pl as never, Date.now() + PAGE_BUDGET_MS);
    if (!items.length) return null;
    return {
      title: pl.info?.title ?? 'YouTube',
      author: pl.info?.author?.name ?? '',
      items,
      partial,
    };
  }
  const ch = await yt.getChannel(id);
  if (!ch.has_videos) return null;
  const videos = await ch.getVideos();
  // Paging is timed from here, so a slow first page does not eat the budget.
  const { items, partial } = await collect(videos as never, Date.now() + PAGE_BUDGET_MS);
  if (!items.length) return null;
  return {
    title: ch.metadata?.title ?? 'YouTube',
    author: ch.metadata?.title ?? '',
    items,
    partial,
  };
}

/** Attempts for the first page, bounded by the shared deadline. Measured:
 *  7/10 channels answered on the first try, and every one of the three that
 *  did not answered within two more. */
const LIST_ATTEMPTS = 3;

export async function tubeList(
  type: 'channel' | 'playlist',
  id: string,
): Promise<YtListing | null> {
  const giveUpAt = Date.now() + ATTEMPT_CEILING_MS;
  for (let attempt = 1; attempt <= LIST_ATTEMPTS; attempt++) {
    try {
      const listing = await listOnce(type, id);
      if (listing) return listing;
    } catch (e) {
      console.error(`tubeList[${type}] attempt ${attempt}:`, (e as Error).message);
    }
    if (Date.now() > giveUpAt) break;
  }
  return null;
}

export interface YtSearchRow {
  kind: 'video' | 'channel' | 'playlist';
  id: string;
  title: string;
  author: string;
  thumb: string;
  /** videos: duration (s); playlists: item count; channels: 0 */
  extra: number;
}

export async function tubeSearch(q: string): Promise<YtSearchRow[]> {
  const yt = await innertube();
  const res = await yt.search(q);
  const out: YtSearchRow[] = [];
  for (const item of res.results ?? []) {
    const it = item as unknown as Record<string, unknown>;
    const type = String(it.type ?? '');
    try {
      if (type === 'Video' || type === 'CompactVideo') {
        const v = it as {
          video_id?: string;
          title?: { text?: string };
          author?: { name?: string };
          thumbnails?: Array<{ url?: string }>;
          duration?: { seconds?: number };
        };
        if (v.video_id) {
          out.push({
            kind: 'video',
            id: v.video_id,
            title: v.title?.text ?? '',
            author: v.author?.name ?? '',
            thumb: absThumb(v.thumbnails?.[0]?.url ?? ""),
            extra: v.duration?.seconds ?? 0,
          });
        }
      } else if (type === 'Channel') {
        const c = it as {
          id?: string;
          author?: { name?: string; thumbnails?: Array<{ url?: string }> };
        };
        if (c.id) {
          out.push({
            kind: 'channel',
            id: c.id,
            title: c.author?.name ?? '',
            author: '',
            thumb: absThumb(c.author?.thumbnails?.[0]?.url ?? ""),
            extra: 0,
          });
        }
      } else if (type === 'Playlist' || type === 'LockupView') {
        const p = it as {
          id?: string;
          content_id?: string;
          title?: { text?: string };
          author?: { name?: string };
          thumbnails?: Array<{ url?: string }>;
          video_count?: { text?: string };
          metadata?: { title?: { text?: string } };
          content_image?: { primary_thumbnail?: { image?: Array<{ url?: string }> } };
        };
        const id = p.id ?? p.content_id;
        if (id && /^(PL|UU|OL|RD)/.test(id)) {
          out.push({
            kind: 'playlist',
            id,
            title: p.title?.text ?? p.metadata?.title?.text ?? '',
            author: p.author?.name ?? '',
            thumb: absThumb(
              p.thumbnails?.[0]?.url ??
                p.content_image?.primary_thumbnail?.image?.[0]?.url ??
                '',
            ),
            extra: parseInt(p.video_count?.text ?? '0') || 0,
          });
        }
      }
    } catch {
      /* skip malformed rows */
    }
    if (out.length >= 20) break;
  }
  return out;
}

export interface TubeAudio {
  url: string;
  mime: string;
  bitrate: number;
  contentLength: number;
  /** googlevideo expects the UA of the client that minted the URL */
  ua: string;
}

const WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CLIENT_UA: Record<string, string> = {
  ANDROID_VR:
    'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  IOS: 'com.google.ios.youtube/20.20.7 (iPhone16,2; U; CPU iOS 18_1_1 like Mac OS X;)',
};

/**
 * Best audio-only format for a video (URL usable from THIS worker's IP).
 * Clients are tried in order until one yields a direct-URL format that also
 * serves MID-FILE ranges — under PO-token enforcement most clients only get
 * the first ~2 MB, which breaks streaming/seek.
 * ANDROID_VR (Meta Quest) is the one remaining PO-token-exempt client; IOS
 * resolves everywhere but its URLs are usually range-capped, so it's only a
 * fallback for the videos where the cap isn't applied.
 * The TV/embedded/WEB clients were dropped: they now require a JS evaluator
 * to decipher (unavailable in workerd) or fail playability outright.
 */
const STREAM_CLIENTS = ['ANDROID_VR', 'IOS'] as const;

export async function tubeAudio(videoId: string): Promise<TubeAudio | null> {
  const yt = await innertube();
  for (const client of STREAM_CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      if (info.playability_status?.status !== 'OK') {
        // Surface WHY in `wrangler tail` — geo-blocks and bot walls look
        // identical from the client ("no stream") but need different fixes.
        console.error(
          `tubeAudio[${client}]: ${info.playability_status?.status} — ${info.playability_status?.reason ?? ''}`,
        );
        continue;
      }
      // Direct-URL formats only — with no player, ciphered ones can't be used
      const formats = (info.streaming_data?.adaptive_formats ?? []).filter(
        (f) => f.has_audio && !f.has_video && f.url,
      );
      const best = formats.slice().sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (!best) continue;
      // no player → passes the direct URL through; String() guards URL instances
      const url = String((await best.decipher(yt.session.player)) ?? '');
      if (!/^https?:\/\//.test(url)) continue;
      const ua = CLIENT_UA[client] ?? WEB_UA;
      const len = Number(best.content_length ?? 0);

      // Mid-file probe: only accept URLs that stream beyond the first chunk
      if (len > 4096) {
        const mid = Math.floor(len / 2);
        const probe = await fetchWithTimeout(`${url}&range=${mid}-${mid + 1023}`, 8000, {
          headers: { 'user-agent': ua },
        });
        await probe.body?.cancel().catch(() => {});
        if (!probe.ok) {
          console.error(`tubeAudio[${client}]: mid-range probe ${probe.status}`);
          continue;
        }
      }

      return {
        url,
        mime: (best.mime_type ?? 'audio/mp4').split(';')[0] ?? 'audio/mp4',
        bitrate: best.bitrate ?? 0,
        contentLength: len,
        ua,
      };
    } catch (e) {
      console.error(`tubeAudio[${client}]:`, (e as Error).message);
    }
  }
  return null;
}
