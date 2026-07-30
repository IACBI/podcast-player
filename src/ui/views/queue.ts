/**
 * Queue view — the visible face of the up-next queue: ordered rows with
 * keyboard-friendly move/remove controls. Ported from the retired dropdown
 * panel (`ed59840:src/ui/queue-panel.ts`) into a full page view.
 *
 * Rows render from the queue entries themselves (title + feed name captured at
 * enqueue time) rather than looking titles up in the loaded feed: the queue
 * spans feeds now, so most entries do not belong to whatever is on screen.
 */

import { clearQueue, moveInQueue, queue, removeFromQueue, type QueueItem } from '../../state/queue';
import { effect } from '../../state/signals';
import { t, currentLang } from '../../i18n';
import { registerView, viewEl, type View } from '../views';
import { h, icon } from '../h';

export function initQueueView(): View {
  const el = viewEl('queue');
  el.innerHTML = `
    <div class="view-inner queue-inner">
      <h1 class="view-title" data-i18n="queue_title">Çalma kuyruğu</h1>
    </div>`;
  const inner = el.querySelector<HTMLElement>('.queue-inner')!;

  const listEl = h('div', { className: 'queue-list', attrs: { role: 'list' } });
  const emptyEl = h('div', { className: 'empty-state' });
  const clearBtn = h('button', {
    className: 's-btn danger queue-clear',
    on: { click: () => clearQueue() },
  });
  inner.append(emptyEl, listEl, h('div', { className: 'queue-foot' }, clearBtn));

  function iconBtn(label: string, name: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { className: 'icon-btn', title: label, on: { click: onClick } }, icon(name));
    b.setAttribute('aria-label', label);
    return b;
  }

  function row(item: QueueItem, i: number): HTMLElement {
    const title = item.title || t('ep_fallback', i + 1);
    return h(
      'div',
      { className: 'queue-row', attrs: { role: 'listitem' } },
      h('span', { className: 'queue-pos' }, String(i + 1)),
      h(
        'div',
        { className: 'queue-info' },
        h('span', { className: 'queue-name', title }, title),
        item.feedName ? h('span', { className: 'queue-feed' }, item.feedName) : null,
      ),
      iconBtn(t('queue_move_up'), 'ic-up', () => moveInQueue(item, -1)),
      iconBtn(t('queue_move_down'), 'ic-down', () => moveInQueue(item, 1)),
      iconBtn(t('queue_remove'), 'ic-x', () => removeFromQueue(item)),
    );
  }

  function render(): void {
    const q = queue();
    clearBtn.textContent = t('queue_clear');
    clearBtn.hidden = q.length === 0;
    emptyEl.textContent = t('queue_empty');
    emptyEl.hidden = q.length !== 0;
    listEl.replaceChildren(...q.map(row));
  }

  // Reactive: re-render on queue mutation and on language change.
  effect(() => {
    void queue();
    void currentLang();
    render();
  });

  const view: View = { name: 'queue', el };
  registerView(view);
  return view;
}
