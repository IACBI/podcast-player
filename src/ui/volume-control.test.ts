// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The control writes settings and reads them back; app.ts is what pushes them
 * into the element. So these cases are about the decisions — what a drag
 * means, what the speaker button means at zero, and what happens on a platform
 * that will not let a page set the level at all.
 */

const platform = vi.hoisted(() => ({ volumeSettable: true }));
vi.mock('../player/engine', () => ({
  pbVolumeSettable: () => platform.volumeSettable,
}));

import { initVolumeControl } from './volume-control';
import { DEFAULT_SETTINGS, settings } from '../state/settings';

interface Mounted {
  root: HTMLElement;
  button: HTMLButtonElement;
  slider: HTMLInputElement;
  iconHref(): string | null;
}

/** The two surfaces' markup, reduced to what the module actually touches. */
const FIXTURE =
  '<button type="button"><svg><use href="#ic-volume"/></svg></button><input type="range" min="0" max="100" step="1" value="100">';

function mount(): Mounted {
  const root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  const button = root.querySelector('button')!;
  const slider = root.querySelector('input')!;
  initVolumeControl({ root, button, slider });
  return { root, button, slider, iconHref: () => root.querySelector('use')!.getAttribute('href') };
}

function drag(slider: HTMLInputElement, pct: number): void {
  slider.value = String(pct);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  platform.volumeSettable = true;
  settings.set({ ...DEFAULT_SETTINGS });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('volume control', () => {
  it('hides itself where the platform ignores the level', () => {
    platform.volumeSettable = false;
    const { root, slider } = mount();
    expect(root.hidden).toBe(true);
    // and stays inert: no listener was attached
    drag(slider, 20);
    expect(settings().volume).toBe(1);
  });

  it('writes the dragged level through to settings', () => {
    const { slider } = mount();
    drag(slider, 35);
    expect(settings().volume).toBeCloseTo(0.35);
    expect(slider.style.getPropertyValue('--range-pct')).toBe('35%');
  });

  it('reflects a level set from elsewhere, so two instances agree', () => {
    const a = mount();
    const b = mount();
    drag(a.slider, 20);
    expect(b.slider.value).toBe('20');
    expect(b.slider.style.getPropertyValue('--range-pct')).toBe('20%');
  });

  it('mutes without losing the chosen level', () => {
    const { button } = mount();
    settings.set({ ...settings(), volume: 0.75 });
    button.click();
    expect(settings().muted).toBe(true);
    expect(settings().volume).toBe(0.75);
    button.click();
    expect(settings().muted).toBe(false);
    expect(settings().volume).toBe(0.75);
  });

  it('raises the level when unmuting from zero, so the button is never a no-op', () => {
    const { button, slider } = mount();
    drag(slider, 0);
    expect(settings().muted).toBe(false); // zero is not the same state as muted
    button.click();
    expect(settings().volume).toBeGreaterThan(0);
    expect(settings().muted).toBe(false);
  });

  it('treats dragging away from silence as an unmute', () => {
    const { button, slider } = mount();
    button.click();
    expect(settings().muted).toBe(true);
    drag(slider, 40);
    expect(settings().muted).toBe(false);
  });

  it('shows how loud it is, silence included', () => {
    const { slider, iconHref, root } = mount();
    drag(slider, 80);
    expect(iconHref()).toBe('#ic-volume');
    drag(slider, 20);
    expect(iconHref()).toBe('#ic-volume-low');
    drag(slider, 0);
    expect(iconHref()).toBe('#ic-volume-off');
    expect(root.classList.contains('is-muted')).toBe(true);
  });
});
