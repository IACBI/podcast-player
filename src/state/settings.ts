import type { LangCode } from '../i18n/types';
import { isLangCode, detectLang } from '../i18n';
import { local } from '../storage/local';
import { signal } from './signals';

export type ThemeName = 'auto' | 'dark' | 'light' | 'oled';
export type SortDir = 'asc' | 'desc';
export type PrefetchMode = 'always' | 'wifi' | 'never';

/** User settings — persisted under the legacy `pp_settings` key (same shape). */
export interface Settings {
  defaultSpeed: number;
  skipBack: number;
  skipForward: number;
  autoNext: boolean;
  resumePos: boolean;
  fontSize: string;
  rowHeight: string;
  theme: ThemeName;
  defaultSort: SortDir;
  showDl: boolean;
  accentColor: string;
  lang: LangCode;
  /** Tint the Now Playing background with a colour sampled from the artwork. */
  ambientArt: boolean;
  /**
   * Allow feed fetches to fall back to third-party CORS proxies when the app's
   * own Worker cannot be reached. Off by default: those operators see the URL
   * of every feed opened, and — because the app races three of them and takes
   * the first answer — any one of them can return altered XML, including
   * enclosure URLs pointing somewhere else.
   */
  allowPublicProxies: boolean;
  /**
   * Cache the playing episode in the background so playback stops depending on
   * the network once the copy lands — the difference between surviving a locked
   * screen and not. `wifi` is the default: it only backs off when the browser
   * positively reports a cellular connection, which iOS never does.
   */
  prefetchYouTube: PrefetchMode;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultSpeed: 1,
  skipBack: 15,
  skipForward: 30,
  autoNext: true,
  resumePos: true,
  fontSize: '13px',
  rowHeight: '54px',
  theme: 'auto',
  defaultSort: 'asc',
  showDl: true,
  accentColor: '#f2a33c',
  lang: 'tr',
  ambientArt: true,
  allowPublicProxies: false,
  prefetchYouTube: 'wifi',
};

/**
 * Allowed values for the settings that are not free-form. `fontSize`,
 * `rowHeight` and `accentColor` are written straight into CSS custom
 * properties, so a stored value must be one the UI can actually produce rather
 * than merely "a string".
 */
const ALLOWED: Partial<Record<keyof Settings, ReadonlySet<unknown>>> = {
  defaultSpeed: new Set([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]),
  skipBack: new Set([5, 10, 15, 30, 60]),
  skipForward: new Set([10, 15, 30, 45, 60, 90]),
  fontSize: new Set(['11px', '13px', '15px', '17px']),
  rowHeight: new Set(['42px', '54px', '66px']),
  theme: new Set(['auto', 'dark', 'light', 'oled']),
  defaultSort: new Set(['asc', 'desc']),
  prefetchYouTube: new Set(['always', 'wifi', 'never']),
};

/** Hex colours only — the accent feeds several `rgb()`/gradient tokens. */
const HEX = /^#[0-9a-f]{6}$/i;

function acceptable<K extends keyof Settings>(key: K, value: unknown): boolean {
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return false;
  if (key === 'accentColor') return typeof value === 'string' && HEX.test(value);
  const allowed = ALLOWED[key];
  return allowed ? allowed.has(value) : true;
}

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

export function loadSettings(): void {
  const raw = local.get<unknown>('pp_settings', null);
  // Anything that is not a plain object is treated as absent. `"junk"` is
  // truthy and not an object, and the language check below used `in` on it,
  // which threw a TypeError and took the whole boot down.
  const saved: Partial<Settings> | null =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<Settings>) : null;
  const next = { ...DEFAULT_SETTINGS };
  let rejected = false;
  if (saved) {
    for (const k of Object.keys(next) as Array<keyof Settings>) {
      const v = saved[k];
      if (v === undefined) continue;
      // A matching `typeof` used to be the only check, so any string reached
      // `style.setProperty` and any number reached `audio.playbackRate`.
      if (acceptable(k, v)) (next as Record<string, unknown>)[k] = v;
      else rejected = true;
    }
  }
  if (!saved || !('lang' in saved) || !isLangCode(String(next.lang))) {
    next.lang = detectLang();
  }
  settings.set(next);
  // Write the sanitised set back, so a rejected value does not sit in storage
  // being re-rejected on every load.
  if (rejected) local.set('pp_settings', next);
}

export function saveSettings(): void {
  local.set('pp_settings', settings());
}

/** Update one field, persist, notify subscribers. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings.update((s) => ({ ...s, [key]: value }));
  saveSettings();
}
