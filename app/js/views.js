// Отрисовка экранов: состояние → HTML. Действия — через data-action (см. app.js).
import { barChart } from './charts.js';
import {
  addDays,
  categoryLabel,
  categoryMap,
  comparisonRange,
  dayTitle,
  debtLeft,
  debtsSummary,
  formatMoney,
  formatPercent,
  groupByDay,
  isDebtOverdue,
  MONTHS_SHORT,
  monthKey,
  monthlyTotals,
  monthRange,
  monthTitle,
  percentChange,
  plural,
  recurringSummary,
  shortDate,
  sortDebts,
  sortPresets,
  summarize,
  todayISO,
  weekday,
} from './logic.js';
import { biometricName, webauthnSupported } from './lock.js';
import { state } from './state.js';
import { html, raw } from './ui.js';

const money = (kop, opts) => formatMoney(kop, opts);
// В сводках копейки только мешают — округляем до рубля
const rub = (kop, opts) => formatMoney(Math.round(kop / 100) * 100, opts);
const signed = (t) => (t.type === 'income' ? money(t.amount, { sign: true }) : money(-t.amount));

function txRow(t, cats, today, { showDate = false } = {}) {
  const cat = cats.get(t.categoryId);
  // 🔁 — операция записана регулярным платежом
  const note = t.recurringId ? `🔁 ${t.note}` : t.note;
  const sub = [showDate ? shortDate(t.date, today) : '', note].filter(Boolean).join(' · ');
  return html`
    <button type="button" class="row" data-action="edit-tx" data-id="${t.id}">
      <span class="emoji" aria-hidden="true">${cat?.emoji ?? '❓'}</span>
      <span class="row-main">
        <span class="row-title">${cat?.name ?? 'Без категории'}</span>
        ${sub ? html`<span class="row-sub">${sub}</span>` : ''}
      </span>
      <span class="row-amount num ${t.type === 'income' ? 'pos' : ''}">${signed(t)}</span>
    </button>`;
}

// ---------- Операции ----------

export function renderList() {
  const { data, ui, settings } = state;
  const today = todayISO();
  const { from, to } = monthRange(ui.month);
  const cats = categoryMap(data.categories);
  const s = summarize(data, from, to, today);
  let txs = s.transactions;
  if (ui.filterType !== 'all') txs = txs.filter((t) => t.type === ui.filterType);
  if (ui.filterCat) txs = txs.filter((t) => t.categoryId === ui.filterCat);

  const liveCount = data.transactions.filter((t) => !t.deleted).length;
  const backupDue = !settings.sync && liveCount >= 15 && (!settings.lastBackupAt || Date.now() - settings.lastBackupAt > 30 * 86_400_000);

  const typeChip = (value, label) => html`<button type="button" class="chip" data-action="filter-type" data-value="${value}" aria-pressed="${ui.filterType === value}">${label}</button>`;
  const filterCat = ui.filterCat ? cats.get(ui.filterCat) : null;
  const presets = sortPresets(data.presets);

  return html`
    <div class="card">
      <div class="kpis">
        <div class="kpi"><div class="kpi-label">Расходы</div><div class="kpi-value num">${rub(s.expense)}</div></div>
        <div class="kpi"><div class="kpi-label">Доходы</div><div class="kpi-value num pos">${rub(s.income)}</div></div>
        <div class="kpi"><div class="kpi-label">Остаток</div><div class="kpi-value num ${s.balance < 0 ? 'neg' : ''}">${rub(s.balance, { sign: true })}</div></div>
      </div>
    </div>
    ${backupDue ? html`
      <div class="banner">
        <span>Данные живут только на этом устройстве. Сохрани копию или включи синхронизацию.</span>
        <button type="button" class="btn" data-action="tab" data-tab="settings">Настроить</button>
      </div>` : ''}
    ${presets.length
      ? html`
        <div class="chips quick" role="group" aria-label="Быстрые кнопки">
          ${presets.map(
            (p) => html`<button type="button" class="chip quick-btn" data-action="quick" data-id="${p.id}">${p.emoji} ${p.label} <span class="quick-sum">${p.amounts.length === 1 ? money(p.amounts[0]) : `${formatMoney(p.amounts[0], { currency: false })}–${money(p.amounts.at(-1))}`}</span></button>`,
          )}
        </div>`
      : ''}
    <div class="chips" role="group" aria-label="Фильтр">
      ${typeChip('all', 'Все')}${typeChip('expense', 'Расходы')}${typeChip('income', 'Доходы')}
      ${filterCat || ui.filterCat ? html`<button type="button" class="chip" aria-pressed="true" data-action="clear-cat">${categoryLabel(filterCat)} ✕</button>` : ''}
    </div>
    ${txs.length
      ? groupByDay(txs).map(
          (day) => html`
          <div class="day">
            <div class="day-head">
              <span>${dayTitle(day.date, today)}</span>
              <span class="num">${day.expense ? money(-day.expense) : ''}${day.expense && day.income ? ' · ' : ''}${day.income ? money(day.income, { sign: true }) : ''}</span>
            </div>
            <div class="list">${day.items.map((t) => txRow(t, cats, today))}</div>
          </div>`,
        )
      : html`
        <div class="empty">
          <div class="big">🧾</div>
          ${s.transactions.length ? 'Под фильтр ничего не попало.' : html`За ${monthTitle(ui.month).toLowerCase()} пока пусто.<br>Нажми «+», чтобы добавить трату или доход.`}
        </div>`}
  `;
}

// ---------- Аналитика ----------

function deltaText(cur, prev, cmp) {
  const vs = cmp.partial ? `${Number(cmp.from.slice(8))}–${shortDate(cmp.to)}` : 'прошлому месяцу';
  const p = percentChange(cur, prev);
  if (p === null) return '';
  if (Math.abs(p) < 0.005) return 'как в прошлом периоде';
  return `${p > 0 ? '▲' : '▼'} ${formatPercent(Math.abs(p))} к ${vs}`;
}

export function renderStats() {
  const { data, ui } = state;
  const today = todayISO();
  const { from, to } = monthRange(ui.month);
  const s = summarize(data, from, to, today);
  const cmp = comparisonRange(ui.month, today);
  const p = summarize(data, cmp.from, cmp.to, today);
  const type = ui.statsType;
  const groups = s.byCategory[type];
  const maxCat = groups[0]?.total ?? 0;
  const isCurrent = ui.month === monthKey(today);

  // По дням месяца — только расходы (одна величина, один цвет)
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = s.byDay.get(d)?.expense ?? 0;
    const dayNum = Number(d.slice(8));
    days.push({
      label: String(dayNum),
      showLabel: dayNum === 1 || dayNum % 5 === 0,
      strong: d === today,
      tip: `${shortDate(d)}, ${['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][weekday(d)]}|${money(v)}`,
      values: [{ v, cls: 'b-exp' }],
    });
  }

  const months = monthlyTotals(data, ui.month, 6);
  const monthGroups = months.map((m) => ({
    label: MONTHS_SHORT[Number(m.key.slice(5)) - 1],
    showLabel: true,
    strong: m.key === ui.month,
    tip: `${monthTitle(m.key)}|−${money(m.expense)} / +${money(m.income)}`,
    values: [
      { v: m.expense, cls: 'b-exp' },
      { v: m.income, cls: 'b-inc' },
    ],
  }));

  const top = s.topExpenses.slice(0, 5);
  const cats = categoryMap(data.categories);

  return html`
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn primary" data-action="export" data-format="ai">🤖 Выгрузить для ИИ</button>
      <button type="button" class="btn" data-action="export" data-format="csv" style="flex:0 0 auto">CSV</button>
    </div>

    <div class="kpis two" style="margin-top:12px">
      <div class="kpi tile">
        <div class="kpi-label">Расходы</div>
        <div class="kpi-value num">${rub(s.expense)}</div>
        <div class="delta">${deltaText(s.expense, p.expense, cmp)}</div>
      </div>
      <div class="kpi tile">
        <div class="kpi-label">Доходы</div>
        <div class="kpi-value num pos">${rub(s.income)}</div>
        <div class="delta">${deltaText(s.income, p.income, cmp)}</div>
      </div>
      <div class="kpi tile">
        <div class="kpi-label">Остаток</div>
        <div class="kpi-value num ${s.balance < 0 ? 'neg' : ''}">${rub(s.balance, { sign: true })}</div>
        <div class="delta">${s.income > 0 ? `потрачено ${formatPercent(Math.min(s.expense / s.income, 9.99))} дохода` : 'доходов нет'}</div>
      </div>
      <div class="kpi tile">
        <div class="kpi-label">В среднем в день</div>
        <div class="kpi-value num">${rub(s.avgPerDay)}</div>
        <div class="delta">${isCurrent ? `за ${s.elapsed} ${plural(s.elapsed, ['день', 'дня', 'дней'])}` : `${s.expenseCount} ${plural(s.expenseCount, ['трата', 'траты', 'трат'])}`}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Категории</h2>
        <div class="seg" role="group" aria-label="Тип">
          <button type="button" data-action="stats-type" data-value="expense" aria-pressed="${type === 'expense'}">Расходы</button>
          <button type="button" data-action="stats-type" data-value="income" aria-pressed="${type === 'income'}">Доходы</button>
        </div>
      </div>
      ${groups.length
        ? html`<div class="cat-bars">
            ${groups.map(
              (g) => html`
              <button type="button" class="cat-bar" data-action="show-cat" data-id="${g.categoryId}" data-type="${type}">
                <span class="e" aria-hidden="true">${g.category?.emoji ?? '❓'}</span>
                <span class="n">${g.category?.name ?? 'Без категории'} <span class="muted small">· ${g.count}</span></span>
                <span class="v num">${money(g.total)}<small>${formatPercent(g.share)}</small></span>
                <span class="track ${type === 'income' ? 'inc' : ''}"><i style="width:${((g.total / maxCat) * 100).toFixed(1)}%"></i></span>
              </button>`,
            )}
          </div>
          <p class="note" style="padding:8px 2px 0">Нажми на категорию, чтобы увидеть её операции.</p>`
        : html`<p class="muted">${type === 'expense' ? 'Расходов' : 'Доходов'} за месяц нет.</p>`}
    </div>

    <div class="card">
      <h2>Расходы по дням</h2>
      ${raw(barChart({ groups: days, height: 150, ariaLabel: 'Расходы по дням месяца' }))}
      <p class="note" style="padding:6px 2px 0">Нажми на столбик — покажу сумму за день.</p>
    </div>

    <div class="card">
      <h2>Последние 6 месяцев</h2>
      ${raw(barChart({ groups: monthGroups, height: 160, ariaLabel: 'Расходы и доходы по месяцам' }))}
      <div class="legend"><span style="--c:var(--series-exp)">Расходы</span><span style="--c:var(--series-inc)">Доходы</span></div>
      <table class="mini-table num">
        <thead><tr><th>Месяц</th><th>Расходы</th><th>Доходы</th></tr></thead>
        <tbody>
          ${[...months].reverse().map((m) => html`<tr><td>${monthTitle(m.key)}</td><td>${money(m.expense)}</td><td>${money(m.income)}</td></tr>`)}
        </tbody>
      </table>
    </div>

    ${top.length
      ? html`
        <h3 class="section-title">Самые крупные траты</h3>
        <div class="list">${top.map((t) => txRow(t, cats, today, { showDate: true }))}</div>`
      : ''}
  `;
}

// ---------- Долги ----------

function debtRow(d, today) {
  const left = debtLeft(d);
  const overdue = isDebtOverdue(d, today);
  const who = d.direction === 'toMe' ? 'должен мне' : 'я должен';
  const due = d.dueDate ? `до ${shortDate(d.dueDate, today)}` : '';
  const sub = [who, due, d.note].filter(Boolean).join(' · ');
  return html`
    <button type="button" class="row ${overdue ? 'overdue' : ''}" data-action="open-debt" data-id="${d.id}">
      <span class="emoji" aria-hidden="true">${d.direction === 'toMe' ? '🫴' : '🤝'}</span>
      <span class="row-main">
        <span class="row-title">${d.person} ${overdue ? html`<span class="badge">просрочен</span>` : ''}</span>
        <span class="row-sub">${sub}</span>
      </span>
      <span class="row-amount num ${d.direction === 'toMe' ? 'pos' : ''}">
        ${left ? money(left) : '✓'}
        ${left && left !== d.amount ? html`<small>из ${money(d.amount)}</small>` : left ? '' : html`<small>${money(d.amount)}</small>`}
      </span>
    </button>`;
}

export function renderDebts() {
  const today = todayISO();
  const sum = debtsSummary(state.data.debts, today);
  const { open, closed } = sortDebts(state.data.debts, today);
  return html`
    <div class="card">
      <div class="kpis">
        <div class="kpi"><div class="kpi-label">Мне должны</div><div class="kpi-value num pos">${rub(sum.toMe)}</div></div>
        <div class="kpi"><div class="kpi-label">Я должен</div><div class="kpi-value num">${rub(sum.fromMe)}</div></div>
        <div class="kpi"><div class="kpi-label">Итог</div><div class="kpi-value num ${sum.net < 0 ? 'neg' : ''}">${rub(sum.net, { sign: true })}</div></div>
      </div>
    </div>
    ${open.length
      ? html`<h3 class="section-title">Открытые · ${open.length}</h3><div class="list">${open.map((d) => debtRow(d, today))}</div>`
      : html`<div class="empty"><div class="big">🤝</div>Открытых долгов нет.<br>Нажми «+», чтобы записать, кто кому должен.</div>`}
    ${closed.length
      ? html`
        <details class="closed-debts" ${state.ui.showClosed ? raw('open') : ''}>
          <summary class="section-title">Погашенные · ${closed.length}</summary>
          <div class="list">${closed.map((d) => debtRow(d, today))}</div>
        </details>`
      : ''}
    <p class="note">Долги не попадают в расходы и доходы — это отдельный учёт.</p>
  `;
}

// ---------- Настройки ----------

function syncStatus() {
  const { sync, settings } = state;
  if (!settings.sync) return html`<span class="hint">выключена</span>`;
  if (sync.status === 'syncing') return html`<span class="hint">синхронизация…</span>`;
  if (sync.status === 'error') return html`<span class="hint neg">ошибка</span>`;
  if (sync.status === 'offline') return html`<span class="hint">нет сети</span>`;
  if (settings.lastSyncAt) {
    const d = new Date(settings.lastSyncAt);
    return html`<span class="hint">✓ ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>`;
  }
  return html`<span class="hint">включена</span>`;
}

export function renderSettings(build) {
  const { settings, sync } = state;
  const bioSupported = webauthnSupported();
  const recurring = recurringSummary(state.data.recurring);
  const presetCount = state.data.presets.filter((p) => !p.deleted).length;
  const lockOpts = [
    [0, 'сразу'],
    [60, 'через 1 мин'],
    [300, 'через 5 мин'],
    [900, 'через 15 мин'],
  ];
  return html`
    <h3 class="section-title">Категории</h3>
    <div class="group">
      <button type="button" class="item" data-action="categories" data-type="expense"><span>🛒 Категории расходов</span><span class="hint">›</span></button>
      <button type="button" class="item" data-action="categories" data-type="income"><span>💼 Категории доходов</span><span class="hint">›</span></button>
    </div>

    <h3 class="section-title">Автоматизация</h3>
    <div class="group">
      <button type="button" class="item" data-action="recurring"><span>🔁 Регулярные платежи</span><span class="hint">${recurring.active ? `${rub(recurring.expense)}/мес` : 'нет'} ›</span></button>
      <button type="button" class="item" data-action="presets"><span>⚡ Быстрые кнопки</span><span class="hint">${presetCount || 'нет'} ›</span></button>
    </div>

    <h3 class="section-title">Выгрузка</h3>
    <div class="group">
      <button type="button" class="item" data-action="export" data-format="ai"><span>🤖 Выгрузить для ИИ</span><span class="hint">.md ›</span></button>
      <button type="button" class="item" data-action="export" data-format="csv"><span>📊 Таблица для Excel</span><span class="hint">.csv ›</span></button>
    </div>
    <p class="note">Файл за выбранные даты: закинь его в ChatGPT, Claude, DeepSeek или другую нейросеть — задание для разбора уже внутри.</p>

    <h3 class="section-title">Защита</h3>
    <div class="group">
      <button type="button" class="item" data-action="pin-setup"><span>🔒 ${settings.pin ? 'Сменить PIN-код' : 'Поставить PIN-код'}</span><span class="hint">${settings.pin ? 'включён' : 'выключен'} ›</span></button>
      ${settings.pin && bioSupported
        ? html`
          <div class="item">
            <span>Вход по ${biometricName()}</span>
            <label class="switch"><input type="checkbox" data-action="bio-toggle" ${settings.bio ? raw('checked') : ''} aria-label="Вход по ${biometricName()}"><span></span></label>
          </div>`
        : ''}
      ${settings.pin
        ? html`
          <label class="item">
            <span>Блокировать после сворачивания</span>
            <select data-action="lock-after">
              ${lockOpts.map(([v, l]) => html`<option value="${v}" ${settings.lockAfter === v ? raw('selected') : ''}>${l}</option>`)}
            </select>
          </label>
          <button type="button" class="item danger" data-action="pin-remove"><span>Убрать PIN-код</span></button>`
        : ''}
    </div>
    <p class="note">${settings.pin
      ? 'PIN у каждого устройства свой. Это защита от человека с твоим разблокированным телефоном, а не шифрование.'
      : bioSupported
        ? `Сначала поставь PIN — после этого можно включить вход по ${biometricName()}.`
        : 'PIN спрашивается при запуске и после сворачивания.'}</p>

    <h3 class="section-title">Синхронизация через GitHub</h3>
    <div class="group">
      <button type="button" class="item" data-action="sync-setup"><span>☁️ ${settings.sync ? settings.sync.repo : 'Подключить приватный репозиторий'}</span>${syncStatus()}</button>
      ${settings.sync ? html`<button type="button" class="item" data-action="sync-now"><span>Синхронизировать сейчас</span><span class="hint">↻</span></button>` : ''}
    </div>
    ${sync.status === 'error' ? html`<p class="note neg">${sync.error}</p>` : ''}
    <p class="note">Данные хранятся файлом в твоём приватном репозитории — это и «база», и бэкап, и общий доступ с телефона и компьютера.</p>

    <h3 class="section-title">Резервная копия</h3>
    <div class="group">
      <button type="button" class="item" data-action="backup"><span>💾 Сохранить копию</span><span class="hint">${settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleDateString('ru-RU') : 'ни разу'}</span></button>
      <button type="button" class="item" data-action="restore"><span>📂 Восстановить из копии</span><span class="hint">›</span></button>
    </div>

    <h3 class="section-title">Опасная зона</h3>
    <div class="group">
      <button type="button" class="item danger" data-action="wipe"><span>Удалить все данные с этого устройства</span></button>
    </div>
    <p class="note">Данные в GitHub-репозитории при этом останутся.</p>

    <p class="version">Трекер расходов · версия ${build}</p>
  `;
}
