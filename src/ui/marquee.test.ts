// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initMarquee } from './marquee';

/**
 * jsdom has no layout, no Web Animations and no ResizeObserver, so overflow is
 * declared rather than measured and `animate` is recorded. What is under test
 * is the decision — does this text move at all, which way, and for how long —
 * not the browser's compositing.
 */

let overflowPx = 0;
let reduceMotion = false;
let animate: ReturnType<typeof vi.fn>;

function host(direction: 'ltr' | 'rtl' = 'ltr'): HTMLElement {
  const el = document.createElement('div');
  el.style.direction = direction;
  Object.defineProperty(el, 'clientWidth', { get: () => 100 });
  Object.defineProperty(el, 'scrollWidth', { get: () => 100 + overflowPx });
  document.body.appendChild(el);
  return el;
}

/** initMarquee measures inside a rAF; run every pending frame. */
function flushFrames(): void {
  vi.advanceTimersByTime(32);
}

beforeEach(() => {
  vi.useFakeTimers();
  overflowPx = 0;
  reduceMotion = false;
  animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: animate,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduceMotion;
    },
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('initMarquee', () => {
  it('leaves text that fits alone', () => {
    const el = host();
    initMarquee(el).set('short');
    flushFrames();
    expect(animate).not.toHaveBeenCalled();
    expect(el.className).toBe('marquee');
  });

  it('drifts text that overflows, and keeps the full string on hover', () => {
    overflowPx = 260;
    const el = host();
    initMarquee(el).set('a title far longer than its box');
    flushFrames();

    expect(el.classList.contains('marquee-on')).toBe(true);
    expect(el.title).toBe('a title far longer than its box');
    const [frames, timing] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(frames.at(-1)?.transform).toBe('none');
    expect(frames[2]?.transform).toBe('translateX(-260px)');
    // 260px at 26px/s is 10s each way, plus a 1.8s rest at both ends.
    expect(timing.duration).toBe(2 * 10_000 + 2 * 1800);
    expect(timing.iterations).toBe(Infinity);
  });

  it('drifts the other way when the text runs right-to-left', () => {
    overflowPx = 260;
    initMarquee(host('rtl')).set('عنوان طويل جدا');
    flushFrames();
    const [frames] = animate.mock.calls[0] as [Keyframe[]];
    expect(frames[2]?.transform).toBe('translateX(260px)');
  });

  it('falls back to the ellipsis when motion is reduced', () => {
    overflowPx = 260;
    reduceMotion = true;
    const el = host();
    initMarquee(el).set('a title far longer than its box');
    flushFrames();
    expect(animate).not.toHaveBeenCalled();
    expect(el.classList.contains('marquee-on')).toBe(false);
  });
});
