// Точка входа: загрузка, вкладки, обработка нажатий.
import { openPresetForm, openPresetsSheet, openRecurringSheet, quickAdd } from './automation.js';
import { debtsSummary, monthKey, monthTitle, shiftMonth, todayISO } from './logic.js';
import { disableBiometric, enableBiometric, initAutoLock, isLocked, openPinSetup, showLock } from './lockscreen.js';
import {
  openCategoriesSheet,
  openDebtForm,
  openDebtSheet,
  openExportSheet,
  openSyncSheet,
  openTxSheet,
  restoreBackup,
  saveBackup,
} from './sheets.js';
import { loadState, onChange, runRecurring, runSync, saveSettings, startSyncLoop, state, wipeDevice } from './state.js';
import { $, $$, confirmDialog, initSheet, initTooltips, toast } from './ui.js';
import { renderDebts, renderList, renderSettings, renderStats } from './views.js';

// При деплое заменяется на хэш коммита (см. .github/workflows/pages.yml)
const BUILD = '__BUILD__';

const TITLES = { list: 'Операции', stats: 'Аналитика', debts: 'Долги', settings: 'Настройки' };
const VIEWS = { list: renderList, stats: renderStats, debts: renderDebts, settings: () => renderSettings(BUILD.startsWith('__') ? 'dev' : BUILD) };

// ---------- Отрисовка ----------

let frame = 0;
const render = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(renderNow);
};

function renderNow() {
  if (isLocked()) return;
  const { tab, month } = state.ui;
  const today = todayISO();
  $('#title').textContent = TITLES[tab];
  const monthSwitch = $('#monthSwitch');
  monthSwitch.hidden = !(tab === 'list' || tab === 'stats');
  const label = $('#monthLabel');
  label.textContent = monthTitle(month);
  label.classList.toggle('is-past', month !== monthKey(today));
  $('#fab').hidden = tab === 'settings';
  $('#fab').setAttribute('aria-label', tab === 'debts' ? 'Записать долг' : 'Добавить операцию');
  for (const b of $$('.tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  for (const [name, view] of Object.entries(VIEWS)) {
    const el = $(`#view-${name}`);
    el.hidden = name !== tab;
    if (name === tab) el.innerHTML = view().s;
  }
  $('#debtDot').hidden = debtsSummary(state.data.debts, today).overdue === 0;
  $('#syncDot').hidden = state.sync.status !== 'error';
}

function clearViews() {
  for (const name of Object.keys(VIEWS)) $(`#view-${name}`).innerHTML = '';
}

function lock() {
  clearViews();
  showLock({ onUnlock: renderNow });
}

// ---------- Действия по нажатию ----------

const actions = {
  tab(el) {
    state.ui.tab = el.dataset.tab;
    scrollTo(0, 0);
    render();
  },
  month(el) {
    state.ui.month = shiftMonth(state.ui.month, Number(el.dataset.delta));
    render();
  },
  'month-now'() {
    state.ui.month = monthKey(todayISO());
    render();
  },
  add() {
    if (state.ui.tab === 'debts') openDebtForm();
    else openTxSheet({ type: state.ui.filterType === 'income' ? 'income' : 'expense', categoryId: state.ui.filterCat });
  },
  'edit-tx'(el) {
    openTxSheet({ id: el.dataset.id });
  },
  'filter-type'(el) {
    state.ui.filterType = el.dataset.value;
    render();
  },
  'clear-cat'() {
    state.ui.filterCat = null;
    render();
  },
  'stats-type'(el) {
    state.ui.statsType = el.dataset.value;
    render();
  },
  'show-cat'(el) {
    state.ui.filterCat = el.dataset.id;
    state.ui.filterType = el.dataset.type;
    state.ui.tab = 'list';
    scrollTo(0, 0);
    render();
  },
  quick(el) {
    quickAdd(el.dataset.id);
  },
  'preset-new'() {
    openPresetForm();
  },
  presets() {
    openPresetsSheet();
  },
  recurring() {
    openRecurringSheet();
  },
  'open-debt'(el) {
    openDebtSheet(el.dataset.id);
  },
  export(el) {
    openExportSheet({ format: el.dataset.format });
  },
  categories(el) {
    openCategoriesSheet(el.dataset.type);
  },
  'pin-setup'() {
    openPinSetup();
  },
  'pin-remove'() {
    openPinSetup({ mode: 'remove' });
  },
  'sync-setup'() {
    openSyncSheet();
  },
  async 'sync-now'() {
    try {
      await runSync({ manual: true });
      toast('Синхронизировано ✓');
    } catch (err) {
      toast(err.message);
    }
  },
  backup() {
    saveBackup();
  },
  restore() {
    restoreBackup();
  },
  async wipe() {
    const ok = await confirmDialog({
      title: 'Удалить все данные?',
      text: 'Операции, категории, долги и настройки удалятся с этого устройства. Данные в GitHub-репозитории останутся.',
      ok: 'Удалить',
      danger: true,
    });
    if (ok) await wipeDevice();
  },
};

const changeActions = {
  'bio-toggle'(el) {
    if (el.checked) enableBiometric(el);
    else disableBiometric();
  },
  'lock-after'(el) {
    saveSettings({ lockAfter: Number(el.value) });
  },
};

function initEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.closest('#sheet, #confirm, #lock')) return;
    actions[el.dataset.action]?.(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) changeActions[el.dataset.action]?.(el, e);
  });
  // «Погашенные» долги остаются раскрытыми после перерисовки
  document.addEventListener(
    'toggle',
    (e) => {
      if (e.target.matches?.('details.closed-debts')) state.ui.showClosed = e.target.open;
    },
    true,
  );
}

// Клавиатура на айфоне перекрывает низ экрана — поднимаем шторку над ней
function initViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  const update = () => {
    root.setProperty('--vvh', `${vv.height}px`);
    root.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || ['localhost', '127.0.0.1'].includes(location.hostname)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function recordRecurring() {
  const n = await runRecurring();
  if (n && !isLocked()) toast(`🔁 Записаны регулярные платежи: ${n}`);
}

async function boot() {
  initSheet();
  initTooltips();
  initViewport();
  initEvents();
  try {
    await loadState();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:24px">Не удалось открыть хранилище: ${err.message}. Закрой другие вкладки с трекером и обнови страницу.</p>`;
    return;
  }
  onChange(render);
  initAutoLock(lock);
  if (state.settings.pin) lock();
  else renderNow();
  await recordRecurring();
  // Новый день мог наступить, пока приложение было открыто или свёрнуто
  setInterval(recordRecurring, 60_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recordRecurring());
  startSyncLoop();
  registerServiceWorker();
}

boot();
