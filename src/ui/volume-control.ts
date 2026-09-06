/**
 * The volume control, shared by the Now Playing sheet and the mini dock —
 * the same arrangement sleep-control.ts uses, so the two surfaces render from
 * one source instead of mirroring each other.
 *
 * Settings hold the truth (`volume`, `muted`); app.ts is what pushes them into
 * the engine. This module only reflects them and writes them back, so both
 * instances stay in step without knowing about each other.
 *
 * A native `<input type="range">` is deliberate: it brings pointer, touch and
 * keyboard handling — arrows, Home/End, Page Up/Down — plus screen-reader
 * semantics that a div slider would have to reimplement.
 */

import { currentLang, t } from '../i18n';
import { pbVolumeSettable } from '../player/engine';
import { setSetting, settings, type Settings } from '../state/settings';

/** Unmuting at zero would be a button that visibly does nothing. */
const UNMUTE_FLOOR = 0.5;

export interface VolumeControlEls {
  /** Wrapper, hidden whole where the platform ignores `audio.volume`. */
  root: HTMLElement;
  /** Speaker button — reflects the level, toggles mute. */
  button: HTMLButtonElement;
  slider: HTMLInputElement;
}

export function initVolumeControl(els: VolumeControlEls): void {
  const { root, button, slider } = els;

  // iOS leaves `volume` read-only: the hardware buttons are the only control
  // there, so a slider would be a dead widget rather than a missing feature.
  if (!pbVolumeSettable()) {
    root.hidden = true;
    return;
  }

  function apply(s: Settings): void {
    const pct = Math.round(s.volume * 100);
    const silent = s.muted || pct === 0;
    slider.value = String(pct);
    slider.setAttribute('aria-valuetext', `${pct}%`);
    // The filled part of the track: a native range cannot style its own
    // progress the same way in every engine, so the track reads this.
    slider.style.setProperty('--range-pct', pct + '%');
    root.classList.toggle('is-muted', silent);

    const use = silent ? '#ic-volume-off' : pct < 50 ? '#ic-volume-low' : '#ic-volume';
    button.querySelector('use')?.setAttribute('href', use);
    const label = t(silent ? 'unmute' : 'mute');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(silent));
    button.title = label;
  }

  slider.addEventListener('input', () => {
    const v = (parseInt(slider.value, 10) || 0) / 100;
    setSetting('volume', v);
    // Dragging away from silence is an unmute in every sense that matters.
    if (v > 0 && settings().muted) setSetting('muted', false);
  });

  button.addEventListener('click', () => {
    const s = settings();
    const silent = s.muted || s.volume === 0;
    if (silent && s.volume === 0) setSetting('volume', UNMUTE_FLOOR);
    setSetting('muted', !silent);
  });

  settings.subscribe(apply);
  currentLang.subscribe(() => apply(settings()));
  apply(settings());
}
