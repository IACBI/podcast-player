import { t, currentLang } from '../i18n';

const dateCache = new Map<string, string>();
let dateFormat: Intl.DateTimeFormat | null = null;

// Locale-formatted dates change with the language — drop both on switch.
currentLang.subscribe(() => {
  dateCache.clear();
  dateFormat = null;
});

/**
 * `toLocaleDateString` builds a formatter on every call, which is the real cost
 * when rendering a full archive. Build it once per language instead.
 */
function formatter(): Intl.DateTimeFormat {
  dateFormat ??= new Intl.DateTimeFormat(currentLang(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return dateFormat;
}

/**
 * Cap is generous and overflow clears the whole map. A feed's archive has one
 * distinct pubDate per episode, so the old 500-entry FIFO evicted exactly the
 * entries the same render still needed — a near-100% miss rate on the feeds
 * where caching mattered most.
 */
const DATE_CACHE_MAX = 4000;

export function fmtDate(s: string): string {
  if (!s) return '';
  const hit = dateCache.get(s);
  if (hit !== undefined) return hit;
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const r = formatter().format(d);
    if (dateCache.size >= DATE_CACHE_MAX) dateCache.clear();
    dateCache.set(s, r);
    return r;
  } catch {
    return '';
  }
}

export function fmtDur(ms: number): string {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}${t('dur_h')} ${String(m).padStart(2, '0')}${t('dur_m')}` : `${m}${t('dur_m')}`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB';
  return n + ' B';
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
