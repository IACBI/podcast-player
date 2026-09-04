import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Episode, FeedMeta, ResolvedFeed } from '../feeds/types';

/**
 * IndexedDB layer. Scope note: settings/progress/subscriptions intentionally
 * stay in localStorage (tiny, sync access, legacy-compatible) — idb holds the
 * bulky data: cached feeds and offline-download metadata. Audio bytes live in
 * the Cache API bucket `seseri-audio` (see player/downloads.ts).
 */

export interface CachedFeed {
  /** FeedMeta id — `<itunesId>` | `rss:<url>` | `yt:<type>:<id>` */
  id: string;
  feed: ResolvedFeed;
  fetchedAt: number;
}

export interface DownloadRecord {
  /** Episode trackId. */
  id: string;
  feedId: string;
  title: string;
  bytes: number;
  addedAt: number;
  /**
   * True for a copy the app cached on its own to survive a backgrounded
   * network, false/absent for one the user asked for. Only ephemeral copies are
   * ever evicted, and the Downloads list hides them — deleting something the
   * user deliberately saved to reclaim space would be a betrayal.
   */
  ephemeral?: boolean;
}

/**
 * Just enough about one episode for the Home "continue listening" rail.
 *
 * Home used to reach this through `getCachedFeed`, which structured-clones a
 * feed's *entire* archive out of IndexedDB — for every subscription, on every
 * visit home — to read a single title and duration. This projection is one
 * small record per feed instead.
 */
export interface ResumeEntry {
  /** FeedMeta id, same key space as the `feeds` store. */
  id: string;
  meta: FeedMeta;
  episode: Episode;
  updatedAt: number;
}

interface SeseriDB extends DBSchema {
  feeds: { key: string; value: CachedFeed };
  downloads: { key: string; value: DownloadRecord };
  resume: { key: string; value: ResumeEntry };
}

const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<SeseriDB>> | null = null;

export function db(): Promise<IDBPDatabase<SeseriDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SeseriDB>('seseri', DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore('feeds', { keyPath: 'id' });
          d.createObjectStore('downloads', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          d.createObjectStore('resume', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ── feed cache (stale-while-revalidate source) ─────────────────────
export async function getCachedFeed(id: string): Promise<CachedFeed | undefined> {
  try {
    return await (await db()).get('feeds', id);
  } catch {
    return undefined;
  }
}

export async function putCachedFeed(feed: ResolvedFeed): Promise<void> {
  try {
    await (await db()).put('feeds', { id: feed.meta.id, feed, fetchedAt: Date.now() });
  } catch {
    /* cache is best-effort */
  }
}

export async function clearFeedCache(): Promise<void> {
  try {
    const d = await db();
    await d.clear('feeds');
    await d.clear('resume');
  } catch {
    /* ignore */
  }
}

// ── resume projection (Home's continue-listening rail) ─────────────
export async function getResume(feedId: string): Promise<ResumeEntry | undefined> {
  try {
    return await (await db()).get('resume', feedId);
  } catch {
    return undefined;
  }
}

export async function putResume(entry: ResumeEntry): Promise<void> {
  try {
    await (await db()).put('resume', entry);
  } catch {
    /* best-effort: Home falls back to the full feed cache */
  }
}

// ── download records ───────────────────────────────────────────────
export async function getDownload(id: string): Promise<DownloadRecord | undefined> {
  try {
    return await (await db()).get('downloads', id);
  } catch {
    return undefined;
  }
}

export async function putDownload(rec: DownloadRecord): Promise<void> {
  await (await db()).put('downloads', rec);
}

export async function deleteDownload(id: string): Promise<void> {
  try {
    await (await db()).delete('downloads', id);
  } catch {
    /* ignore */
  }
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  try {
    return await (await db()).getAll('downloads');
  } catch {
    return [];
  }
}
