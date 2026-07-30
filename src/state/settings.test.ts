// @vitest-environment jsdom
/**
 * Stored settings are attacker-shaped input in one specific sense: three of
 * them (`fontSize`, `rowHeight`, `accentColor`) are written straight into CSS
 * custom properties and one (`defaultSpeed`) into `audio.playbackRate`. The
 * loader used to accept anything whose `typeof` matched, so "a string" was the
 * only requirement for reaching `style.setProperty`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, settings } from './settings';

function store(value: unknown): void {
  localStorage.setItem('pp_settings', JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  settings.set({ ...DEFAULT_SETTINGS });
});

describe('loadSettings validation', () => {
  it('keeps values the UI can actually produce', () => {
    store({ defaultSpeed: 1.5, skipBack: 30, fontSize: '15px', rowHeight: '66px', theme: 'oled' });
    loadSettings();
    expect(settings()).toMatchObject({
      defaultSpeed: 1.5,
      skipBack: 30,
      fontSize: '15px',
      rowHeight: '66px',
      theme: 'oled',
    });
  });

  it.each([
    ['fontSize', 'url(https://evil.example/x)'],
    ['fontSize', '13px; background: red'],
    ['rowHeight', '9999px'],
    ['accentColor', 'javascript:alert(1)'],
    ['accentColor', 'red'],
    ['accentColor', '#ff'],
    ['defaultSpeed', 99],
    ['defaultSpeed', -1],
    ['skipBack', 100000],
    ['theme', 'neon'],
    ['defaultSort', 'sideways'],
  ] as const)('falls back to the default for %s = %o', (key, value) => {
    store({ [key]: value });
    loadSettings();
    expect(settings()[key]).toBe(DEFAULT_SETTINGS[key]);
  });

  it('rejects a value of the wrong type', () => {
    store({ autoNext: 'yes', showDl: 1, defaultSpeed: '2' });
    loadSettings();
    expect(settings().autoNext).toBe(DEFAULT_SETTINGS.autoNext);
    expect(settings().showDl).toBe(DEFAULT_SETTINGS.showDl);
    expect(settings().defaultSpeed).toBe(DEFAULT_SETTINGS.defaultSpeed);
  });

  it('writes the sanitised set back, so a bad value is not re-read forever', () => {
    store({ defaultSpeed: 99, fontSize: '15px' });
    loadSettings();
    const written = JSON.parse(localStorage.getItem('pp_settings') ?? '{}');
    expect(written.defaultSpeed).toBe(DEFAULT_SETTINGS.defaultSpeed);
    expect(written.fontSize).toBe('15px'); // the acceptable one survives
  });

  it('leaves storage untouched when everything was acceptable', () => {
    store({ fontSize: '15px' });
    loadSettings();
    expect(JSON.parse(localStorage.getItem('pp_settings') ?? '{}')).toEqual({ fontSize: '15px' });
  });

  it('survives junk in place of the settings object', () => {
    localStorage.setItem('pp_settings', '"not an object"');
    expect(() => loadSettings()).not.toThrow();
    expect(settings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  it('defaults the third-party proxy fallback to off', () => {
    loadSettings();
    expect(settings().allowPublicProxies).toBe(false);
  });
});
