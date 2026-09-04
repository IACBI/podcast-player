/**
 * Podcast detail view — feed header (art, title, subscribe/share), status
 * strip, sort/filter bar, episode list. Playback state lives in the
 * playback-controller; this view renders playback.session reactively.
 * Ported from `git show ed59840:src/ui/screens/player.ts` (list/header half),
 * re-skinned onto the "Sinyal" design system.
 * Element IDs kept for the smoke-test contract: backBtn, pThumb, pTitle,
 * pAuthor, pEpCount, favBtn, shareBtn, dot, statusText, sortToggle, sortInfo,
 * filterInput, epList.
 */

import type { PlaybackController, PlaybackSession } from '../playback-controller';
import { registerView, viewEl, type View } from '../views';
import { h, icon } from '../h';
import { stateBox } from '../states';
import { fmtDate, fmtDur } from '../../lib/format';
import { artAt, artSrcset } from '../../lib/art';
import { dprWidths, HEADER_ART_PX } from '../art-tile';
import { t } from '../../i18n';
import { getProgress } from '../../storage/progress';
import { queue, queuePositions } from '../../state/queue';
import { settings, type Settings } from '../../state/settings';
import { isSubscribed, toggleSubscription } from '../../storage/subscriptions';
import { confirmDialog } from '../confirm';
import { toast } from '../toast';

export interface PodcastViewDeps {
  playback: PlaybackController;
  /** Back button: in-app history back, or home when we deep-linked in. */
  onBack(): void;
  /** Open the full-screen Now Playing sheet (mobile flow). */
  openNowPlaying(): void;
}

export interface PodcastView extends View {
  /** Land keyboard focus on the feed title (accessible landing point). */
  focusTitle(): void;
}

export function initPodcastView(deps: PodcastViewDeps): PodcastView {
  const { playback } = deps;
  const el = viewEl('podcast');
  el.innerHTML = `
    <div class="view-inner p-inner">
      <div class="p-header">
        <button class="icon-btn p-back" id="backBtn" data-i18n-aria="btn_back" aria-label="Geri"><svg class="icon icon-flip" aria-hidden="true"><use href="#ic-back"/></svg></button>
        <img class="p-art" id="pThumb" alt="" loading="lazy" decoding="async" />
        <div class="p-meta">
          <h1 class="p-title" id="pTitle" tabindex="-1">—</h1>
          <div class="p-author" id="pAuthor"></div>
          <div class="p-count"><span id="pEpCount">0</span> <span data-i18n="ep_count_unit">bölüm</span></div>
        </div>
        <div class="p-header-actions">
          <button class="icon-btn p-fav" id="favBtn" data-i18n-aria="fav_btn" aria-label="Abonelik ekle/çıkar"><svg class="icon icon-fill" aria-hidden="true"><use href="#ic-star"/></svg></button>
          <button class="icon-btn p-share" id="shareBtn" data-i18n-aria="share_btn" aria-label="Linki paylaş"><svg class="icon" aria-hidden="true"><use href="#ic-share"/></svg></button>
        </div>
      </div>
      <div class="p-status" aria-live="polite">
        <span class="dot" id="dot" aria-hidden="true"></span>
        <span class="p-status-text" id="statusText"></span>
      </div>
      <div class="p-listbar">
        <button class="p-sort" id="sortToggle" data-i18n-aria="btn_sort" aria-label="Sıra">
          <svg class="icon" aria-hidden="true"><use href="#ic-sort"/></svg>
          <span data-i18n="btn_sort">Sıra</span>
        </button>
        <span class="p-sort-info" id="sortInfo"></span>
        <input class="text-input p-filter" id="filterInput" type="text" placeholder="Bölüm ara..." data-i18n-ph="filter_placeholder" />
      </div>
      <div class="ep-list" id="epList" role="list"></div>
    </div>`;

  const q = <T extends HTMLElement = HTMLElement>(id: string): T =>
    el.querySelector<T>('#' + id) as T;

  const titleEl = q('pTitle');
  const authorEl = q('pAuthor');
  const thumbEl = q<HTMLImageElement>('pThumb');
  const countEl = q('pEpCount');
  const favBtn = q<HTMLButtonElement>('favBtn');
  const shareBtn = q<HTMLButtonElement>('shareBtn');
  const dotEl = q('dot');
  const statusTextEl = q('statusText');
  const sortToggle = q<HTMLButtonElement>('sortToggle');
  const sortInfoEl = q('sortInfo');
  const filterInput = q<HTMLInputElement>('filterInput');
  const epList = q('epList');

  // ── episode list rendering ───────────────────────────────────────
  function skeleton(rows = 8): HTMLElement {
    const list = h('div', { className: 'skeleton-list' });
    for (let i = 0; i < rows; i++) {
      list.append(
        h(
          'div',
          { className: 'skeleton-row' },
          h('span', { className: 'sk sk-num' }),
          h(
            'div',
            { className: 'ep-info' },
            h('div', { className: 'sk sk-line1' }),
            h('div', { className: 'sk sk-line2' }),
          ),
        ),
      );
    }
    return list;
  }

  type Episode = PlaybackSession['filtered'][number];

  /**
   * Everything about a row that can change without the list itself changing.
   * Compared per row so an unrelated session update touches no DOM at all.
   */
  function rowSignature(
    ep: Episode,
    i: number,
    s: PlaybackSession,
    S: Settings,
    qPos: Map<string, number>,
  ): string {
    const id = String(ep.trackId);
    const savedSec = getProgress(id);
    const durSec = ep.trackTimeMillis ? ep.trackTimeMillis / 1000 : 0;
    const pct = durSec && savedSec > 5 ? Math.min(100, (savedSec / durSec) * 100) : 0;
    return [
      i === s.currentIndex ? 1 : 0,
      qPos.get(id) ?? 0,
      s.downloadedIds.has(id) ? 1 : 0,
      pct.toFixed(1),
      S.resumePos ? 1 : 0,
      S.showDl ? 1 : 0,
      ep.trackName,
    ].join('');
  }

  function episodeRow(
    ep: Episode,
    i: number,
    s: PlaybackSession,
    S: Settings,
    qPos: Map<string, number>,
  ): HTMLElement {
    const id = String(ep.trackId);
    const savedSec = getProgress(id);
    const hasSaved = S.resumePos && savedSec > 5;
    const durSec = ep.trackTimeMillis ? ep.trackTimeMillis / 1000 : 0;
    const pct = durSec && savedSec > 5 ? Math.min(100, (savedSec / durSec) * 100) : 0;
    const listened = pct >= 96;
    const active = i === s.currentIndex;

    const num = h('span', { className: 'ep-num' });
    if (active) {
      const eq = h('span', { className: 'ep-eq', attrs: { 'aria-hidden': 'true' } });
      eq.append(h('i'), h('i'), h('i'));
      num.append(eq);
    } else {
      num.textContent = String(i + 1);
    }

    const dateDur = h(
      'div',
      { className: 'ep-date-dur' },
      fmtDate(ep.releaseDate),
      ep.trackTimeMillis ? ' · ' + fmtDur(ep.trackTimeMillis) : '',
    );
    if (listened) {
      dateDur.append(' ', h('span', { className: 'ep-done-badge badge badge-done' }, '✓'));
    } else if (hasSaved) {
      dateDur.append(' ', h('span', { className: 'ep-saved-badge badge' }, t('ep_saved_badge')));
    }

    const row = h(
      'div',
      {
        className: 'ep-item' + (active ? ' active' : '') + (listened ? ' listened' : ''),
        role: 'listitem',
        tabIndex: 0,
        dataset: { idx: String(i) },
        ...(active ? { attrs: { 'aria-current': 'true' } } : {}),
      },
      num,
      h(
        'div',
        { className: 'ep-info' },
        h('div', { className: 'ep-name' }, ep.trackName || t('ep_fallback', i + 1)),
        dateDur,
      ),
    );

    const actions = h('div', { className: 'ep-actions' });
    const pos = qPos.get(id) ?? 0;
    actions.append(
      h(
        'button',
        {
          className: 'ep-act ep-q-btn icon-btn' + (pos ? ' queued' : ''),
          dataset: { idx: String(i), act: 'queue' },
          attrs: { 'aria-label': t('btn_queue'), title: t('btn_queue') },
        },
        pos ? h('span', { className: 'ep-q-pos' }, String(pos)) : icon('ic-queue'),
      ),
    );
    if (S.showDl) {
      const done = s.downloadedIds.has(id);
      actions.append(
        h(
          'button',
          {
            className: 'ep-act ep-dl-btn icon-btn' + (done ? ' done' : ''),
            dataset: { idx: String(i), act: 'dl' },
            attrs: { 'aria-label': t('dl_label'), title: t('dl_label') },
          },
          done ? '✓' : icon('ic-download'),
        ),
      );
    }
    row.append(actions);

    if (pct > 0 && !listened) {
      row.append(
        h(
          'div',
          { className: 'ep-progress', attrs: { 'aria-hidden': 'true' } },
          h('i', { style: `inline-size:${pct.toFixed(1)}%` }),
        ),
      );
    }
    return row;
  }

  /**
   * `render` runs on every session change, and most of those affect one row or
   * none: a settings edit, a queue toggle, a background title arriving, a
   * status transition. Rebuilding a full archive each time (feeds routinely
   * carry thousands of items and there is no virtualization) was the app's
   * biggest source of jank. So the list is keyed by trackId and only rows whose
   * signature actually changed are replaced.
   */
  let renderedIds: string[] = [];
  const rowEls = new Map<string, HTMLElement>();
  const rowSigs = new Map<string, string>();
  let lastScrolledTrackId: string | null = null;

  function resetRowCache(): void {
    renderedIds = [];
    rowEls.clear();
    rowSigs.clear();
  }

  function renderList(s: PlaybackSession): void {
    const loading = s.status.kind === 'loading';
    if (!s.filtered.length) {
      resetRowCache();
      if (loading) {
        epList.replaceChildren(skeleton());
        epList.setAttribute('aria-busy', 'true');
        return;
      }
      epList.setAttribute('aria-busy', 'false');
      if (s.status.kind === 'error') {
        epList.replaceChildren(
          stateBox('error', s.status.message || t('ep_not_found'), { onRetry: () => playback.retry() }),
        );
      } else {
        epList.replaceChildren(stateBox('empty', t('ep_not_found')));
      }
      return;
    }

    const S = settings();
    // Built once per render: a per-row queuePosition() lookup would make this
    // O(episodes × queue) on every session change. Scoped to this feed — the
    // queue spans feeds now.
    const qPos = queuePositions(s.meta?.id ?? '');
    const ids = s.filtered.map((ep) => String(ep.trackId));
    const sameList = ids.length === renderedIds.length && ids.every((id, i) => renderedIds[i] === id);

    if (!sameList) {
      // Order, filter or feed changed — rebuild once.
      resetRowCache();
      const frag = document.createDocumentFragment();
      s.filtered.forEach((ep, i) => {
        const id = ids[i] as string;
        const row = episodeRow(ep, i, s, S, qPos);
        rowEls.set(id, row);
        rowSigs.set(id, rowSignature(ep, i, s, S, qPos));
        frag.append(row);
      });
      renderedIds = ids;
      epList.replaceChildren(frag);
    } else {
      s.filtered.forEach((ep, i) => {
        const id = ids[i] as string;
        const sig = rowSignature(ep, i, s, S, qPos);
        if (rowSigs.get(id) === sig) return;
        const next = episodeRow(ep, i, s, S, qPos);
        rowEls.get(id)?.replaceWith(next);
        rowEls.set(id, next);
        rowSigs.set(id, sig);
      });
    }
    epList.setAttribute('aria-busy', 'false');

    // Only follow the playing episode when it actually changes. Doing it on
    // every render yanked the list out from under anyone browsing it.
    if (s.currentIndex >= 0 && s.currentTrackId !== lastScrolledTrackId) {
      lastScrolledTrackId = s.currentTrackId ?? null;
      rowEls.get(String(s.currentTrackId))?.scrollIntoView({ block: 'nearest' });
    } else if (s.currentIndex < 0) {
      lastScrolledTrackId = null;
    }
  }

  // ── reactive header + status render ──────────────────────────────
  function render(s: PlaybackSession): void {
    const meta = s.meta;
    titleEl.textContent = meta?.name || '—';
    authorEl.textContent = meta?.artist || '';
    const art = artAt(meta?.art, HEADER_ART_PX);
    if (art) {
      thumbEl.src = art;
      const set = artSrcset(meta?.art, dprWidths(HEADER_ART_PX));
      if (set) {
        thumbEl.srcset = set;
        thumbEl.sizes = `${HEADER_ART_PX}px`;
      } else {
        thumbEl.removeAttribute('srcset');
      }
    } else {
      thumbEl.removeAttribute('srcset');
      thumbEl.removeAttribute('src');
    }
    thumbEl.classList.toggle('has-art', !!art);
    countEl.textContent = String(s.episodes.length);
    favBtn.classList.toggle('faved', !!(meta && isSubscribed(meta.id)));

    dotEl.className = 'dot ' + s.status.kind;
    statusTextEl.textContent = s.status.message;

    sortInfoEl.textContent = s.sortAsc ? t('sort_asc_label') : t('sort_desc_label');

    // Sticky filter — sync the input unless the user is mid-edit.
    if (document.activeElement !== filterInput && filterInput.value !== s.filter) {
      filterInput.value = s.filter;
    }

    if (!el.hidden && meta) document.title = `${meta.name} – Seseri`;

    renderList(s);
  }

  // ── event wiring ─────────────────────────────────────────────────
  q<HTMLButtonElement>('backBtn').addEventListener('click', () => deps.onBack());

  sortToggle.addEventListener('click', () => playback.toggleSort());

  let filterTimer: ReturnType<typeof setTimeout> | null = null;
  filterInput.addEventListener('input', () => {
    if (filterTimer) clearTimeout(filterTimer);
    const value = filterInput.value;
    filterTimer = setTimeout(() => playback.setFilter(value), 200);
  });

  favBtn.addEventListener('click', () => {
    const meta = playback.session().meta;
    if (!meta) return;
    if (isSubscribed(meta.id)) {
      // Unsubscribing loses the star + list placement — confirm first.
      void confirmDialog('confirm_unsubscribe').then((ok) => {
        const m = playback.session().meta;
        if (ok && m) {
          toggleSubscription(m);
          favBtn.classList.toggle('faved', isSubscribed(m.id));
        }
      });
    } else {
      toggleSubscription(meta);
      favBtn.classList.toggle('faved', isSubscribed(meta.id));
    }
  });

  shareBtn.addEventListener('click', () => {
    const meta = playback.session().meta;
    if (!meta) return;
    const id = String(meta.id);
    const url =
      location.origin +
      location.pathname +
      (id.startsWith('rss:')
        ? '?rss=' + encodeURIComponent(id.slice(4))
        : '?podcast=' + encodeURIComponent(id));
    if (navigator.share) {
      navigator.share({ title: meta.name || 'Podcast', url }).catch(() => {
        /* user cancelled */
      });
      return;
    }
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast(t('link_copied')))
      .catch(() => {
        /* clipboard unavailable */
      });
  });

  // Episode list — event delegation (no per-row listeners).
  epList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const actBtn = target.closest<HTMLButtonElement>('.ep-act');
    if (actBtn) {
      e.stopPropagation();
      const idx = parseInt(actBtn.dataset.idx ?? '-1', 10);
      if (actBtn.dataset.act === 'queue') {
        playback.toggleQueued(idx);
      } else {
        actBtn.textContent = '⏳';
        actBtn.disabled = true;
        void playback.downloadToggle(idx);
      }
      return;
    }
    const row = target.closest<HTMLElement>('.ep-item[data-idx]');
    if (row) activateRow(parseInt(row.dataset.idx ?? '-1', 10));
  });
  epList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    if (target.closest('.ep-act')) return; // let the button handle its own keys
    const row = target.closest<HTMLElement>('.ep-item[data-idx]');
    if (row) {
      e.preventDefault();
      activateRow(parseInt(row.dataset.idx ?? '-1', 10));
    }
  });

  /** Clicking the already-active row opens the full player; else load+play. */
  function activateRow(idx: number): void {
    if (idx < 0) return;
    if (idx === playback.session().currentIndex) deps.openNowPlaying();
    else playback.playEpisode(idx, true);
  }

  // ── reactivity ───────────────────────────────────────────────────
  playback.session.subscribe(render);
  // The queue is no longer feed-scoped, so a mutation from anywhere (the queue
  // view, auto-next consuming an entry) must refresh this list's badges.
  queue.subscribe(() => render(playback.session()));
  render(playback.session());

  const view: PodcastView = {
    name: 'podcast',
    el,
    focusTarget: () => titleEl,
    focusTitle: () => titleEl.focus({ preventScroll: false }),
    onShow() {
      render(playback.session());
    },
  };
  registerView(view);
  return view;
}
