import { signal } from './signals';

/**
 * Sleep timer state, shared by the Now Playing sheet and the mini dock.
 *
 * Both surfaces used to own a `<select>` and keep the other in sync by reaching
 * across the DOM with `getElementById`. They now render from this signal, so
 * there is one source of truth and adding a third surface costs nothing.
 */

export type SleepMode = 'off' | 'minutes' | 'episode';

export interface SleepState {
  mode: SleepMode;
  /** Minutes originally chosen — drives the select value and "extend". */
  minutes: number;
  /** Milliseconds left; only meaningful for `minutes` mode. */
  remainingMs: number;
  /** True while the countdown is held because playback is paused. */
  held: boolean;
}

export const SLEEP_OFF: SleepState = { mode: 'off', minutes: 0, remainingMs: 0, held: false };

export const sleepState = signal<SleepState>({ ...SLEEP_OFF });

/** Preset minute options offered in both surfaces (0 = off). */
export const SLEEP_PRESETS = [0, 5, 10, 15, 30, 45, 60, 90] as const;

/** How much "+5" adds. */
export const SLEEP_EXTEND_MS = 5 * 60_000;

export function sleepActive(): boolean {
  return sleepState().mode !== 'off';
}
