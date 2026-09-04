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
  /** Data ran out mid-playback, or the element is waiting on the network. */
  | { type: 'stalled' }
  /** `code` is a `MediaError` constant: 2 is NETWORK, 3 DECODE, 4 SRC_NOT_SUPPORTED. */
  | { type: 'error'; code: number };

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
// iOS refuses to play a media element it considers "fullscreen-capable" while
// the tab is backgrounded; `playsinline` is what opts out of that. `auto`
// preload lets the element keep reading ahead once the screen is off, which is
// exactly the window in which a network hiccup would otherwise end playback.
audio.setAttribute('playsinline', '');
audio.preload = 'auto';

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
  // `play()` predates its own promise; a browser that returns undefined here
  // would otherwise throw on `.catch` instead of merely failing to start.
  audio.play()?.catch(() => {
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

/** End of the buffered range covering `at`, or `at` itself when nothing is buffered. */
export function pbBufferedEnd(at: number = audio.currentTime): number {
  const b = audio.buffered;
  for (let i = 0; i < b.length; i++) {
    if (at >= b.start(i) - 0.5 && at <= b.end(i) + 0.5) return b.end(i);
  }
  return at;
}

export function pbReadyState(): number {
  return audio.readyState;
}

export function pbSrc(): string {
  return audio.src;
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
audio.addEventListener('error', () => emit({ type: 'error', code: audio.error?.code ?? 0 }));
// `stalled` and `waiting` are the only warning the element gives before a
// backgrounded range request dies quietly; `suspend` is deliberately NOT
// mapped here — it also fires on a healthy "buffer is full" pause.
audio.addEventListener('stalled', () => emit({ type: 'stalled' }));
audio.addEventListener('waiting', () => emit({ type: 'stalled' }));
