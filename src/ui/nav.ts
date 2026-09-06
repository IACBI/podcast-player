/**
 * Navigation controller — one DOM for both the mobile tab bar and the desktop
 * sidebar (CSS switches the layout). Highlights the active destination and
 * forwards taps to the app's navigation intents.
 */

import { currentLang, t } from '../i18n';
import type { LangKey } from '../i18n/types';
import { setSetting, settings } from '../state/settings';
import { must } from './shell';
import { onViewChange, type ViewName } from './views';

export type NavDestination = 'home' | 'search' | 'library' | 'settings';

/** Destination → the label key the collapsed rail needs as a tooltip. */
const LABEL_KEY: Record<NavDestination, LangKey> = {
  home: 'nav_home',
  search: 'nav_search',
  library: 'nav_library',
  settings: 'nav_settings',
};

export function initNav(deps: { go(dest: NavDestination): void }): void {
  const items: Record<NavDestination, HTMLButtonElement> = {
    home: must<HTMLButtonElement>('navHome'),
    search: must<HTMLButtonElement>('navSearch'),
    library: must<HTMLButtonElement>('navLibrary'),
    settings: must<HTMLButtonElement>('navSettings'),
  };
  const collapseBtn = must<HTMLButtonElement>('navCollapse');

  for (const [dest, btn] of Object.entries(items) as Array<[NavDestination, HTMLButtonElement]>) {
    btn.addEventListener('click', () => deps.go(dest));
  }

  function setActive(view: ViewName): void {
    // The podcast view belongs to no tab; keep the last highlight off.
    for (const [dest, btn] of Object.entries(items) as Array<[NavDestination, HTMLButtonElement]>) {
      const active = view === dest;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }

  /**
   * Collapse the desktop sidebar to an icon rail. `--nav-w` is redefined on
   * <body> rather than toggled per-rule, so the rail, the mini dock's inset and
   * anything else measuring from the sidebar all move together.
   */
  function applyCollapsed(collapsed: boolean): void {
    document.body.classList.toggle('nav-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    // Pointing towards the edge the rail would move to.
    collapseBtn
      .querySelector('use')
      ?.setAttribute('href', collapsed ? '#ic-chevron-right' : '#ic-back');
    relabel(collapsed);
  }

  /** The rail hides its labels, so the icons carry them as tooltips instead. */
  function relabel(collapsed: boolean): void {
    for (const [dest, btn] of Object.entries(items) as Array<[NavDestination, HTMLButtonElement]>) {
      if (collapsed) btn.title = t(LABEL_KEY[dest]);
      else btn.removeAttribute('title');
    }
    const key: LangKey = collapsed ? 'nav_expand' : 'nav_collapse';
    collapseBtn.title = t(key);
    collapseBtn.setAttribute('aria-label', t(key));
  }

  collapseBtn.addEventListener('click', () => {
    setSetting('navCollapsed', !settings().navCollapsed);
  });
  settings.subscribe((s) => applyCollapsed(s.navCollapsed));
  currentLang.subscribe(() => relabel(settings().navCollapsed));
  applyCollapsed(settings().navCollapsed);

  onViewChange(setActive);
}
