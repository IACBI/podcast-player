/**
 * Drifting label for text that is wider than the box it sits in.
 *
 * Episode titles routinely run longer than the mini dock or a phone's width,
 * and an ellipsis eats exactly the part that tells one episode from the next
 * ("… 15. Bölüm" vs "… 16. Bölüm"). The label drifts to its end, waits, and
 * drifts back, so the whole title can be read without opening anything.
 *
 * It only moves when the text really does overflow; otherwise the element
 * behaves like the plain truncated line it always was, which is also the
 * reduced-motion fallback.
 */

/** Drift speed: slow enough to read a word at a time. */
const SPEED_PX_PER_S = 26;
/** Rest at each end, so both the start and the end are readable standing still. */
const DWELL_MS = 1800;
/** Under a few pixels the ellipsis is cheaper than the motion. */
const MIN_OVERFLOW_PX = 6;

export interface Marquee {
  /** Replace the text, then re-measure and restart the drift if it overflows. */
  set(text: string): void;
  /** Detach observers — for tests and teardown. */
  destroy(): void;
}

/**
 * Take over `host`'s text content. The caller must write through `set()`
 * afterwards: assigning `host.textContent` directly would remove the track
 * element the animation runs on.
 */
export function initMarquee(host: HTMLElement): Marquee {
  host.classList.add('marquee');
  const track = document.createElement('span');
  track.className = 'marquee-track';
  host.replaceChildren(track);

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
  let anim: Animation | null = null;
  let frame = 0;

  function stop(): void {
    anim?.cancel();
    anim = null;
    // Back to a plain inline run, which is what `text-overflow` needs to
    // draw the ellipsis — and what the measurement below assumes.
    host.classList.remove('marquee-on');
  }

  function measure(): void {
    stop();
    if (reduce?.matches) return;
    const shift = host.scrollWidth - host.clientWidth;
    if (shift < MIN_OVERFLOW_PX) return;

    const travelMs = (shift / SPEED_PX_PER_S) * 1000;
    const total = 2 * travelMs + 2 * DWELL_MS;
    // RTL text overflows towards the start, so the drift reverses with it.
    const sign = getComputedStyle(host).direction === 'rtl' ? 1 : -1;
    const away = `translateX(${sign * shift}px)`;
    host.classList.add('marquee-on');
    anim = track.animate(
      [
        { offset: 0, transform: 'none', easing: 'ease-in-out' },
        { offset: DWELL_MS / total, transform: 'none', easing: 'ease-in-out' },
        { offset: (DWELL_MS + travelMs) / total, transform: away, easing: 'ease-in-out' },
        { offset: (2 * DWELL_MS + travelMs) / total, transform: away, easing: 'ease-in-out' },
        { offset: 1, transform: 'none' },
      ],
      { duration: total, iterations: Infinity },
    );
  }

  /** Coalesce the bursts a resize or a font swap fires. */
  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  }

  const ro = new ResizeObserver(schedule);
  ro.observe(host);
  reduce?.addEventListener('change', schedule);
  // Webfonts land after first paint and change the text width, not the box's.
  void document.fonts?.ready.then(schedule);

  return {
    set(text: string): void {
      if (track.textContent === text) return;
      track.textContent = text;
      // The full string stays reachable on hover even while it is clipped.
      host.title = text;
      schedule();
    },
    destroy(): void {
      stop();
      ro.disconnect();
      reduce?.removeEventListener('change', schedule);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
