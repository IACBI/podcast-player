import type { YouTubeRef } from '../feeds/types';
import { API_BASE, fetchWithTimeout } from '../feeds/proxy-chain';

/**
 * YouTube data, all of it through the app's own Worker.
 *
 * This module used to race seven public Piped instances and five Invidious
 * ones for listings, search and audio. Every one of those paths was measured
 * dead on 2026-07-30: 0 stream resolutions across 70 videos, and 7/7 instances
 * returning 502/403/HTML on `/streams`, `/channel` and `/playlists` alike.
 * Invidious answered `/api/v1/stats` but 401/403'd every channel listing, so
 * "the instance is up" was never the same question as "listing works".
 *
 * Keeping them cost twelve CSP origins, a third party told which channel the
 * user was opening, and a fallback chain that could only ever add latency
 * before failing. The Worker resolves listings, search and audio from one
 * Innertube session; when it is unreachable, YouTube's own Atom feed
 * (`atom.ts`) is the remaining fallback, and it carries the latest ~15 items.
 */

export interface YtItem {
  videoId: string;
  /** ISO date string; '' unknown. */
  published: string;
  title: string;
  durationSec: number;
  thumb: string;
}

export interface YtListing {
  title: string;
  author: string;
  items: YtItem[];
  /**
   * True when the Worker could not page through the whole channel. YouTube
   * answers the first page from a datacenter IP but intermittently 403s the
   * continuations, so a listing is often a prefix rather than the full archive.
   */
  partial?: boolean;
}

export interface YtSearchItem {
  kind: 'video' | 'channel' | 'playlist';
  id: string;
  title: string;
  author: string;
  thumb: string;
  /** videos: duration (s); playlists: item count; channels: 0 */
  extra: number;
}

/** Full episode list for a playlist/channel. null when the Worker cannot serve it. */
export async function ytServiceList(
  info: YouTubeRef,
  signal?: AbortSignal,
): Promise<YtListing | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/v1/yt/list?type=${info.type}&id=${encodeURIComponent(info.id)}`,
      signal,
      // The Worker pages through the channel for up to ~12 s before giving
      // up and flagging the listing partial; `openFeed` abandons the whole
      // feed load at 25 s, so this has to sit between the two.
      22000,
    );
    if (res.ok) {
      const j = (await res.json()) as YtListing;
      if (Array.isArray(j.items) && j.items.length) return j;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return null;
}

/** Search YouTube by name. [] when the Worker cannot answer. */
export async function ytServiceSearch(q: string, signal?: AbortSignal): Promise<YtSearchItem[]> {
  if (!API_BASE) return [];
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/v1/yt/search?q=${encodeURIComponent(q)}`,
      signal,
      12000,
    );
    if (res.ok) {
      const j = (await res.json()) as { items?: YtSearchItem[] };
      if (Array.isArray(j.items)) return j.items;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return [];
}

/**
 * Resolve a browser-playable audio stream URL. The Worker is the only source:
 * it holds an Innertube session and proxies the byte range, so the URL it hands
 * back is ad-free and works with the screen off.
 */
export async function ytServiceAudioUrl(
  videoId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  return (await ytResolveAudio(videoId, signal)).url;
}

export interface YtResolveResult {
  url: string | null;
  /**
   * The Worker's status, 0 when it could not be reached. Callers that show the
   * user something need it: 429 (the abuse budget) and 502 (no stream exists)
   * are different problems, and telling someone their video is unplayable when
   * they simply need to wait a minute is wrong.
   */
  status: number;
}

/** As `ytServiceAudioUrl`, but says why it failed. */
export async function ytResolveAudio(
  videoId: string,
  signal?: AbortSignal,
): Promise<YtResolveResult> {
  if (!API_BASE) return { url: null, status: 0 };
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/v1/yt/resolve?id=${encodeURIComponent(videoId)}`,
      signal,
      12000,
    );
    if (res.ok) {
      const j = (await res.json()) as { audioUrl?: string };
      if (j.audioUrl) return { url: j.audioUrl, status: res.status };
    }
    return { url: null, status: res.status };
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return { url: null, status: 0 };
}
