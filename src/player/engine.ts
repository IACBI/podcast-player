/**
 * Playback engine — the transport facade over the <audio> element, so
 * keyboard/waveform/Media Session stay agnostic. Emits typed events instead of
 * poking the DOM (UI subscribes).
 *
 * There used to be a second transport here: the `youtube-nocookie` IFrame
 * embed, used whenever no real audio stream could be resolved for a video. It
 * was removed because it could not deliver the two things the app promises for
 * YouTube — no ads, and playback that survives a locked screen. An iframe does
 * neither. Measured against podcast/talk content the audio path resolves ~95%
 * of videos (see scripts/yt-resolve-rate.cjs); the remainder now says so
 * plainly instead of quietly serving ads that stop when the screen turns off.
 */

export type EngineEvent =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'timeupdate'; current: number; duration: number }
  | { type: 'error' };

type Listener = (e: EngineEvent) => void;

const listeners = new Set<Listener>();

export function onEngine(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(e: EngineEvent): void {
  for (const fn of [...listeners]) fn(e);
}

export const audio = new Audio();

export function pbPaused(): boolean {
  return audio.paused;
}
export function pbCurrent(): number {
  return audio.currentTime;
}
export function pbDuration(): number {
  return audio.duration;
}
export function pbPlay(): void {
  audio.play().catch(() => {
    /* autoplay blocked — user will press play */
  });
}
export function pbPause(): void {
  audio.pause();
}

/** Volume as 0–1. Used by the sleep timer's fade-out; there is no volume UI. */
export function pbGetVolume(): number {
  return audio.volume;
}
export function pbSetVolume(v: number): void {
  audio.volume = Math.max(0, Math.min(1, v));
}

export function pbSeekTo(sec: number): void {
  audio.currentTime = sec;
}
export function pbSetRate(r: number): void {
  audio.playbackRate = r;
}

// <audio> events → engine events (throttled timeupdate ~4 fps like legacy)
let lastUi = 0;
audio.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (now - lastUi < 250) return;
  lastUi = now;
  emit({ type: 'timeupdate', current: audio.currentTime, duration: audio.duration });
});
audio.addEventListener('play', () => emit({ type: 'play' }));
audio.addEventListener('pause', () => emit({ type: 'pause' }));
audio.addEventListener('ended', () => emit({ type: 'ended' }));
audio.addEventListener('error', () => emit({ type: 'error' }));
