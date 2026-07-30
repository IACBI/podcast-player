import type { Subscription } from '../feeds/types';
import { local } from './local';
import { signal } from '../state/signals';

/** Subscriptions ("favorites") — legacy key `pp_favs`, same entry shape. */
export const subscriptions = signal<Subscription[]>([]);

export function loadSubscriptions(): void {
  const favs = local.get<Subscription[]>('pp_favs', []);
  subscriptions.set(Array.isArray(favs) ? favs : []);
}

function persist(list: Subscription[]): void {
  subscriptions.set(list);
  local.set('pp_favs', list);
}

export function isSubscribed(id: string): boolean {
  return subscriptions().some((f) => String(f.id) === String(id));
}

export function toggleSubscription(meta: Subscription): void {
  const list = subscriptions();
  persist(
    isSubscribed(meta.id) ? list.filter((f) => String(f.id) !== String(meta.id)) : [...list, meta],
  );
}

export function removeSubscription(id: string): void {
  persist(subscriptions().filter((f) => String(f.id) !== String(id)));
}

/**
 * Fill in artwork/author for a subscription that was stored without them.
 * OPML carries only a title and a URL, so an imported subscription sat in the
 * Library as a nameless grey tile until the user opened it — and even then
 * nothing wrote the metadata back.
 */
export function refreshSubscription(meta: Subscription): void {
  const list = subscriptions();
  const i = list.findIndex((f) => String(f.id) === String(meta.id));
  const cur = list[i];
  if (!cur) return;
  const next: Subscription = {
    ...cur,
    name: cur.name || meta.name,
    artist: cur.artist || meta.artist,
    art: cur.art || meta.art,
  };
  if (next.name === cur.name && next.artist === cur.artist && next.art === cur.art) return;
  const updated = list.slice();
  updated[i] = next;
  persist(updated);
}
