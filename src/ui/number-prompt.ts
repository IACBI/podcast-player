/**
 * Numeric prompt in the same styled-dialog idiom as confirm.ts — used for the
 * sleep timer's custom duration. Native <dialog> gives the focus trap, Esc and
 * backdrop handling; here Enter confirms, since nothing destructive happens.
 */

import { h } from './h';
import { t } from '../i18n';
import type { LangKey } from '../i18n/types';

interface Opts {
  titleKey: LangKey;
  labelKey: LangKey;
  min: number;
  max: number;
  initial: number;
}

let dialog: HTMLDialogElement | null = null;
let titleEl: HTMLHeadingElement;
let labelEl: HTMLLabelElement;
let input: HTMLInputElement;
let okBtn: HTMLButtonElement;
let cancelBtn: HTMLButtonElement;
let resolveOpen: ((value: number | null) => void) | null = null;
let bounds = { min: 1, max: 600 };

function settle(value: number | null): void {
  if (!dialog?.open) return;
  const resolve = resolveOpen;
  resolveOpen = null;
  dialog.classList.remove('open');
  setTimeout(() => dialog?.close(), 180);
  resolve?.(value);
}

function accept(): void {
  const n = Math.round(Number(input.value));
  if (!Number.isFinite(n)) return settle(null);
  settle(Math.max(bounds.min, Math.min(bounds.max, n)));
}

function build(): HTMLDialogElement {
  titleEl = h('h2', { className: 'confirm-title', id: 'numPromptTitle' });
  input = h('input', {
    className: 'text-input num-prompt-input',
    type: 'number',
    id: 'numPromptInput',
  });
  labelEl = h('label', { className: 'num-prompt-label', attrs: { for: 'numPromptInput' } });
  okBtn = h('button', { className: 's-btn primary', on: { click: accept } });
  cancelBtn = h('button', { className: 's-btn', on: { click: () => settle(null) } });

  const d = h(
    'dialog',
    { className: 'confirm-dialog num-prompt', attrs: { 'aria-labelledby': 'numPromptTitle' } },
    titleEl,
    labelEl,
    input,
    h('div', { className: 'confirm-actions' }, cancelBtn, okBtn),
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      accept();
    }
  });
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    settle(null);
  });
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      settle(null);
    }
  });
  document.body.appendChild(d);
  return d;
}

/** Resolves the clamped number, or null when dismissed. */
export function numberPrompt(opts: Opts): Promise<number | null> {
  dialog ??= build();
  if (dialog.open) settle(null);
  bounds = { min: opts.min, max: opts.max };
  titleEl.textContent = t(opts.titleKey);
  labelEl.textContent = t(opts.labelKey);
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.value = String(opts.initial);
  okBtn.textContent = t('confirm_ok');
  cancelBtn.textContent = t('confirm_cancel');
  dialog.showModal();
  requestAnimationFrame(() => dialog?.classList.add('open'));
  input.focus();
  input.select();
  return new Promise((resolve) => {
    resolveOpen = resolve;
  });
}
