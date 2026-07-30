/**
 * Settings view — playback, appearance (theme + dynamic accent swatches from
 * theme.ts ACCENT_SWATCHES), list, language, data sections. Ported from the
 * retired <dialog> panel: markup `ed59840:src/ui/shell.ts` (SETTINGS_PANEL) +
 * logic `ed59840:src/ui/screens/settings.ts`, now a plain page view.
 *
 * Keeps the legacy element IDs and data-i18n keys, keeps writing the
 * --player-font-size / --list-row-height side-effect tokens on documentElement.
 */

import { t } from '../../i18n';
import { createLangMenu } from '../lang-menu';
import { clearAllDownloads, storageInfo } from '../../player/offline';
import { clearFeedCache } from '../../storage/db';
import { clearProgress, saveProgressNow } from '../../storage/progress';
import { local } from '../../storage/local';
import { exportOpml, parseOpml } from '../../storage/opml';
import { subscriptions, toggleSubscription, isSubscribed } from '../../storage/subscriptions';
import { pbSetRate } from '../../player/engine';
import { settings, setSetting, type Settings, type SortDir, type ThemeName } from '../../state/settings';
import { fmtBytes } from '../../lib/format';
import { toast } from '../toast';
import { confirmDialog } from '../confirm';
import { ACCENT_SWATCHES, normalizeAccent, applyAccent, applyTheme } from '../theme';
import { registerView, viewEl, type View } from '../views';
import { h } from '../h';

export interface SettingsViewDeps {
  onDataCleared(): void;
}

const MARKUP = `
<div class="view-inner settings-inner">
  <h1 class="view-title" data-i18n="settings_heading">Ayarlar</h1>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_playback">Oynatma</div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_default_speed">Varsayılan Hız</div>
        <div class="s-sublabel" data-i18n="s_speed_sub">Bölümler arası korunur</div>
      </div>
      <select class="s-select" id="s_defaultSpeed">
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1" selected>1×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="1.75">1.75×</option>
        <option value="2">2×</option>
        <option value="2.5">2.5×</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_skip_back">Geri Atla (saniye)</div></div>
      <select class="s-select" id="s_skipBack">
        <option value="5">5s</option>
        <option value="10">10s</option>
        <option value="15" selected>15s</option>
        <option value="30">30s</option>
        <option value="60">60s</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_skip_fwd">İleri Atla (saniye)</div></div>
      <select class="s-select" id="s_skipForward">
        <option value="10">10s</option>
        <option value="15">15s</option>
        <option value="30" selected>30s</option>
        <option value="45">45s</option>
        <option value="60">60s</option>
        <option value="90">90s</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_auto_next">Otomatik Sonraki Bölüm</div></div>
      <label class="s-toggle">
        <input type="checkbox" id="s_autoNext" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_resume">Kaldığım Yerden Devam</div></div>
      <label class="s-toggle">
        <input type="checkbox" id="s_resumePos" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_appearance">Görünüm</div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_accent">Vurgu Rengi</div></div>
    </div>
    <div class="s-color-row" id="colorSwatches"></div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_font_size">Yazı Boyutu</div></div>
      <select class="s-select" id="s_fontSize">
        <option value="11px" data-i18n="size_small">Küçük</option>
        <option value="13px" selected data-i18n="size_normal">Normal</option>
        <option value="15px" data-i18n="size_large">Büyük</option>
        <option value="17px" data-i18n="size_xlarge">Çok Büyük</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_row_height">Liste Satır Yüksekliği</div></div>
      <select class="s-select" id="s_rowHeight">
        <option value="42px" data-i18n="row_compact">Sıkı</option>
        <option value="54px" selected data-i18n="size_normal">Normal</option>
        <option value="66px" data-i18n="row_spacious">Geniş</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_theme_label">Karanlık / Açık Tema</div></div>
      <select class="s-select" id="s_theme">
        <option value="auto" selected data-i18n="theme_auto">Otomatik (sistem)</option>
        <option value="dark" data-i18n="theme_dark">Karanlık</option>
        <option value="light" data-i18n="theme_light">Açık</option>
        <option value="oled" data-i18n="theme_oled">OLED Siyah</option>
      </select>
    </div>

    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_ambient">Kapaktan renk</div>
        <div class="s-sublabel" data-i18n="s_ambient_hint">Şimdi çalıyor arka planını kapak görselinden renklendir</div>
      </div>
      <label class="s-toggle">
        <input type="checkbox" id="s_ambientArt" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_list">Liste</div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_default_sort">Varsayılan Sıralama</div></div>
      <select class="s-select" id="s_defaultSort">
        <option value="asc" selected data-i18n="sort_asc">Eskiden → Yeniye</option>
        <option value="desc" data-i18n="sort_desc">Yeniden → Eskiye</option>
      </select>
    </div>

    <div class="s-row">
      <div><div class="s-label" data-i18n="s_show_dl">İndirme Butonu Göster</div></div>
      <label class="s-toggle">
        <input type="checkbox" id="s_showDl" checked>
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_privacy">Gizlilik</div>
    <div class="s-row">
      <div>
        <div class="s-label" data-i18n="s_allow_proxies">Üçüncü taraf vekillerine izin ver</div>
        <div class="s-sublabel" data-i18n="s_allow_proxies_sub">Seseri sunucusuna ulaşılamadığında yedek yol.</div>
      </div>
      <label class="s-toggle">
        <input type="checkbox" id="s_allowPublicProxies">
        <span class="s-toggle-track"></span>
      </label>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_lang_title">Dil / Language</div>
    <div class="s-row">
      <div><div class="s-label" data-i18n="s_lang_label">Arayüz Dili</div></div>
      <div id="s_lang"></div>
    </div>
  </section>

  <section class="s-section">
    <div class="s-section-title" data-i18n="s_data">Veri</div>
    <div class="s-row">
      <div><div class="s-label" data-i18n="s_storage">Depolama</div></div>
      <span class="s-sublabel" id="storageUsage">—</span>
    </div>
    <div class="s-data-btns">
      <button class="s-btn" id="btnOpmlExport" data-i18n="btn_opml_export">OPML Dışa Aktar</button>
      <button class="s-btn" id="btnOpmlImport" data-i18n="btn_opml_import">OPML İçe Aktar</button>
      <button class="s-btn" id="btnJsonExport" data-i18n="btn_json_export">JSON Yedeği İndir</button>
      <button class="s-btn" id="btnJsonImport" data-i18n="btn_json_import">JSON Yedeğini Geri Yükle</button>
      <button class="s-btn danger" id="btnClearDownloads" data-i18n="btn_clear_downloads">🗑 İndirilenleri Sil</button>
      <button class="s-btn danger" id="btnClearProgress" data-i18n="btn_clear_progress">🗑 Tüm İlerlemeyi Sıfırla</button>
      <button class="s-btn danger" id="btnClearAll" data-i18n="btn_clear_all">🗑 Tüm Verileri Temizle</button>
      <input type="file" id="opmlFile" accept=".opml,.xml,text/xml,application/xml" hidden>
      <input type="file" id="jsonFile" accept=".json,application/json" hidden>
    </div>
  </section>
</div>`;

export function initSettingsView(deps: SettingsViewDeps): View {
  const el = viewEl('settings');
  el.innerHTML = MARKUP;

  const pick = <T extends HTMLElement>(id: string): T => {
    const node = el.querySelector<T>('#' + id);
    if (!node) throw new Error(`#${id} missing from settings view`);
    return node;
  };

  const sSpeed = pick<HTMLSelectElement>('s_defaultSpeed');
  const sSkipBack = pick<HTMLSelectElement>('s_skipBack');
  const sSkipFwd = pick<HTMLSelectElement>('s_skipForward');
  const sAutoNext = pick<HTMLInputElement>('s_autoNext');
  const sResume = pick<HTMLInputElement>('s_resumePos');
  const sFontSize = pick<HTMLSelectElement>('s_fontSize');
  const sRowHeight = pick<HTMLSelectElement>('s_rowHeight');
  const sTheme = pick<HTMLSelectElement>('s_theme');
  const sAmbient = pick<HTMLInputElement>('s_ambientArt');
  const sSort = pick<HTMLSelectElement>('s_defaultSort');
  const sShowDl = pick<HTMLInputElement>('s_showDl');
  const sProxies = pick<HTMLInputElement>('s_allowPublicProxies');
  // Language: the shared flag listbox (native <option> can't render flags)
  pick<HTMLDivElement>('s_lang').append(createLangMenu());
  const swatchWrap = pick<HTMLDivElement>('colorSwatches');
  const storageUsageEl = pick<HTMLSpanElement>('storageUsage');

  // ── accent swatches (now dynamic from ACCENT_SWATCHES) ───────────
  const swatches = ACCENT_SWATCHES.map(({ hex, name }) => {
    const sw = h('div', {
      className: 's-color-swatch',
      style: `background:${hex}`,
      attrs: { role: 'button', tabindex: '0', 'aria-label': name },
      dataset: { color: hex },
    });
    const choose = (): void => {
      setSetting('accentColor', hex);
      applyAccent(hex);
      updateSwatchActive();
    };
    sw.addEventListener('click', choose);
    sw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose();
      }
    });
    return sw;
  });
  swatchWrap.append(...swatches);

  function updateSwatchActive(): void {
    const active = normalizeAccent(settings().accentColor);
    for (const sw of swatches) {
      sw.classList.toggle('active', sw.dataset.color === active);
      sw.setAttribute('aria-pressed', String(sw.dataset.color === active));
    }
  }

  // ── input <-> settings sync ──────────────────────────────────────
  function syncInputs(S: Settings): void {
    sSpeed.value = String(S.defaultSpeed);
    sSkipBack.value = String(S.skipBack);
    sSkipFwd.value = String(S.skipForward);
    sAutoNext.checked = S.autoNext;
    sResume.checked = S.resumePos;
    sAmbient.checked = S.ambientArt;
    sFontSize.value = S.fontSize;
    sRowHeight.value = S.rowHeight;
    sTheme.value = S.theme;
    sSort.value = S.defaultSort;
    sShowDl.checked = S.showDl;
    sProxies.checked = S.allowPublicProxies;
    updateSwatchActive();
  }

  function applySide(S: Settings): void {
    document.documentElement.style.setProperty('--player-font-size', S.fontSize);
    document.documentElement.style.setProperty('--list-row-height', S.rowHeight);
  }

  async function refreshStorageUsage(): Promise<void> {
    const info = await storageInfo();
    storageUsageEl.textContent =
      t('storage_usage', fmtBytes(info.usageBytes), fmtBytes(info.quotaBytes)) +
      (info.downloadCount ? ` · ${info.downloadCount} ⤓ ${fmtBytes(info.downloadBytes)}` : '');
  }

  // ── wiring ───────────────────────────────────────────────────────
  sSpeed.addEventListener('change', () => {
    const v = parseFloat(sSpeed.value) || 1;
    setSetting('defaultSpeed', v);
    pbSetRate(v);
  });
  sSkipBack.addEventListener('change', () => setSetting('skipBack', parseInt(sSkipBack.value) || 15));
  sSkipFwd.addEventListener('change', () => setSetting('skipForward', parseInt(sSkipFwd.value) || 30));
  sAutoNext.addEventListener('change', () => setSetting('autoNext', sAutoNext.checked));
  sResume.addEventListener('change', () => setSetting('resumePos', sResume.checked));
  sAmbient.addEventListener('change', () => setSetting('ambientArt', sAmbient.checked));
  sFontSize.addEventListener('change', () => {
    setSetting('fontSize', sFontSize.value);
    applySide(settings());
  });
  sRowHeight.addEventListener('change', () => {
    setSetting('rowHeight', sRowHeight.value);
    applySide(settings());
  });
  sTheme.addEventListener('change', () => {
    setSetting('theme', sTheme.value as ThemeName);
    applyTheme(settings().theme);
  });
  sSort.addEventListener('change', () => setSetting('defaultSort', sSort.value as SortDir));
  sShowDl.addEventListener('change', () => setSetting('showDl', sShowDl.checked));
  sProxies.addEventListener('change', () =>
    setSetting('allowPublicProxies', sProxies.checked),
  );

  // ── data section ─────────────────────────────────────────────────
  function saveFile(name: string, mime: string, content: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  pick('btnOpmlExport').addEventListener('click', () => {
    saveFile('seseri-subscriptions.opml', 'text/x-opml', exportOpml(subscriptions()));
    toast(t('toast_opml_exported'));
  });

  const opmlFile = pick<HTMLInputElement>('opmlFile');
  pick('btnOpmlImport').addEventListener('click', () => opmlFile.click());
  opmlFile.addEventListener('change', () => {
    const f = opmlFile.files?.[0];
    opmlFile.value = '';
    if (!f) return;
    void f.text().then((xml) => {
      try {
        const entries = parseOpml(xml);
        let added = 0;
        for (const e of entries) {
          if (!isSubscribed(e.id)) {
            toggleSubscription({ id: e.id, name: e.name, artist: '', art: '' });
            added++;
          }
        }
        toast(t('opml_imported', added));
      } catch {
        toast(t('opml_invalid'), 'error');
      }
    });
  });

  /** Keys the backup round-trips. The queue joined them when it gained its own store. */
  const BACKUP_KEYS = ['pp_settings', 'pp_favs', 'pp_prog', 'pp_queue'] as const;

  pick('btnJsonExport').addEventListener('click', () => {
    const dump: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const key of BACKUP_KEYS) dump[key] = local.get(key, null);
    saveFile('seseri-backup.json', 'application/json', JSON.stringify(dump, null, 2));
    toast(t('toast_json_exported'));
  });

  /**
   * Restore a backup. There was an export button and no import, which makes the
   * export not a backup at all — nothing could ever be recovered from it.
   *
   * Written straight to the same localStorage keys and then reloaded: every
   * loader (`loadSettings`, `loadSubscriptions`, `loadProgress`, `loadQueue`)
   * already validates its own shape on the way in, so a hand-edited file is
   * rejected field by field rather than trusted here.
   */
  function restoreBackup(text: string): boolean {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return false;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const dump = data as Record<string, unknown>;
    // A file with none of the keys is somebody else's JSON, not a backup.
    if (!BACKUP_KEYS.some((k) => dump[k] !== undefined && dump[k] !== null)) return false;
    for (const key of BACKUP_KEYS) {
      const value = dump[key];
      if (value === undefined || value === null) continue;
      local.set(key, value);
    }
    return true;
  }

  const jsonFile = pick<HTMLInputElement>('jsonFile');
  pick('btnJsonImport').addEventListener('click', () => jsonFile.click());
  jsonFile.addEventListener('change', () => {
    const f = jsonFile.files?.[0];
    jsonFile.value = '';
    if (!f) return;
    void f.text().then((text) => {
      if (!restoreBackup(text)) {
        toast(t('json_invalid'), 'error');
        return;
      }
      toast(t('json_imported'));
      // Reload rather than re-deriving every signal by hand: the loaders run
      // once at boot and are the only place the stored shapes are validated.
      location.reload();
    });
  });

  pick('btnClearDownloads').addEventListener('click', () => {
    void confirmDialog('confirm_clear_downloads').then((ok) => {
      if (!ok) return;
      void clearAllDownloads().then(() => {
        toast(t('dl_removed'));
        void refreshStorageUsage();
      });
    });
  });

  pick('btnClearProgress').addEventListener('click', () => {
    void confirmDialog('confirm_clear_progress').then((ok) => {
      if (!ok) return;
      clearProgress();
      deps.onDataCleared();
    });
  });

  pick('btnClearAll').addEventListener('click', () => {
    void confirmDialog('confirm_clear_all').then(async (ok) => {
      if (!ok) return;
      saveProgressNow();
      // localStorage alone left the bulk of the data in place: the IndexedDB
      // feed/resume/download stores and, worst of all, the `seseri-audio`
      // Cache API bucket holding every downloaded episode — potentially
      // gigabytes that "clear all data" silently kept.
      await clearAllDownloads();
      await clearFeedCache();
      local.clear();
      location.reload();
    });
  });

  // ── init ─────────────────────────────────────────────────────────
  syncInputs(settings());
  applySide(settings());
  settings.subscribe((S) => syncInputs(S));

  const view: View = {
    name: 'settings',
    el,
    onShow() {
      void refreshStorageUsage();
    },
  };
  registerView(view);
  return view;
}
