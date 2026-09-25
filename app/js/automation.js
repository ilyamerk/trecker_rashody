// Регулярные платежи и быстрые кнопки.
import {
  addDays,
  amountToInput,
  categoryMap,
  dueDates,
  formatMoney,
  live,
  MAX_PRESET_AMOUNTS,
  monthKey,
  newId,
  nextDate,
  parseAmount,
  periodLabel,
  plural,
  recurringSummary,
  shortDate,
  sortPresets,
  sortRecurring,
  todayISO,
  validatePreset,
  validateRecurring,
} from './logic.js';
import { catGridHtml, EMOJI, firstGrapheme, openTxSheet, showError } from './sheets.js';
import { put, remove, restore, runRecurring, state } from './state.js';
import { $, $$, closeSheet, confirmDialog, html, openSheet, raw, toast } from './ui.js';

const money = (kop) => formatMoney(kop);
const sign = (type) => (type === 'income' ? '+' : '−');

// ---------- Регулярные платежи ----------

function ruleRow(r, cats, today) {
  const cat = cats.get(r.categoryId);
  const next = nextDate(r, today);
  const sub = r.paused ? '⏸ на паузе' : periodLabel(r);
  const small = [r.period === 'yearly' ? 'в год' : '', next ? `след. ${shortDate(next, today)}` : ''].filter(Boolean).join(' · ');
  return html`
    <button type="button" class="row" data-rule="${r.id}">
      <span class="emoji" aria-hidden="true">${cat?.emoji ?? '🔁'}</span>
      <span class="row-main"><span class="row-title">${r.name}</span><span class="row-sub">${sub}</span></span>
      <span class="row-amount num ${r.type === 'income' ? 'pos' : ''} ${r.paused ? 'muted' : ''}">
        ${sign(r.type)}${money(r.amount)}${small ? html`<small>${small}</small>` : ''}
      </span>
    </button>`;
}

export function openRecurringSheet() {
  const today = todayISO();
  const rules = sortRecurring(state.data.recurring, today);
  const sum = recurringSummary(state.data.recurring);
  const cats = categoryMap(state.data.categories);
  const body = openSheet(
    'Регулярные платежи',
    html`
    ${rules.length
      ? html`
        <div class="card" style="margin-top:4px">
          <div class="kpis two">
            <div class="kpi"><div class="kpi-label">Расходы в месяц</div><div class="kpi-value num">${money(sum.expense)}</div></div>
            <div class="kpi"><div class="kpi-label">Доходы в месяц</div><div class="kpi-value num pos">${money(sum.income)}</div></div>
          </div>
        </div>
        <div class="list">${rules.map((r) => ruleRow(r, cats, today))}</div>`
      : html`<div class="empty" style="padding:24px 12px"><div class="big">🔁</div>Подписки, аренда, связь, зарплата — запиши один раз, и операции будут появляться сами в нужный день.</div>`}
    <button type="button" class="btn primary block" data-new style="margin-top:12px">＋ Новый регулярный платёж</button>
    <p class="note" style="padding:10px 4px 0">Операции записываются, когда открываешь приложение. Не заходил несколько дней — пропущенные платежи запишутся разом, без дублей. Удалённая операция не вернётся.</p>`,
  );
  body.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('new' in t.dataset) openRecurringForm();
    else if (t.dataset.rule) openRecurringForm({ id: t.dataset.rule });
  });
}

export function openRecurringForm({ id = null } = {}) {
  const existing = id ? state.data.recurring.find((r) => r.id === id && !r.deleted) : null;
  if (id && !existing) return openRecurringSheet();
  const today = todayISO();
  const f = { type: existing?.type ?? 'expense', categoryId: existing?.categoryId ?? null, period: existing?.period ?? 'monthly' };
  const body = openSheet(
    existing ? 'Регулярный платёж' : 'Новый регулярный платёж',
    html`
    <form id="recForm" novalidate autocomplete="off">
      <div class="seg" role="group" aria-label="Тип">
        <button type="button" data-type="expense">Расход</button>
        <button type="button" data-type="income">Доход</button>
      </div>
      <label class="amount-field">
        <input name="amount" inputmode="decimal" placeholder="0" value="${existing ? amountToInput(existing.amount) : ''}" aria-label="Сумма" ${existing ? '' : raw('autofocus')}>
        <span>₽</span>
      </label>
      <label class="field"><span>Название</span><input class="input" name="ruleName" maxlength="60" value="${existing?.name ?? ''}" placeholder="Например: Яндекс Плюс, аренда, зарплата"></label>
      <div class="cat-grid" id="catGrid"></div>
      <div class="seg" role="group" aria-label="Как часто" style="margin-top:14px">
        <button type="button" data-period="monthly">Раз в месяц</button>
        <button type="button" data-period="yearly">Раз в год</button>
      </div>
      <label class="field"><span>Дата первого платежа</span><input class="input" type="date" name="anchor" value="${existing?.anchor ?? today}"></label>
      <p class="note" id="recHint" style="padding:0 4px"></p>
      <label class="field"><span>Комментарий (необязательно)</span><input class="input" name="note" maxlength="200" value="${existing?.note ?? ''}"></label>
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions">
        ${existing
          ? html`
            <button type="button" class="btn" data-pause>${existing.paused ? '▶︎ Возобновить' : '⏸ Пауза'}</button>
            <button type="button" class="btn danger" data-del>Удалить</button>`
          : ''}
        <button type="submit" class="btn primary">${existing ? 'Сохранить' : 'Добавить'}</button>
      </div>
      <button type="button" class="btn ghost block" data-back style="margin-top:6px">← Все регулярные</button>
    </form>`,
  );
  const form = $('#recForm', body);

  // С какой даты создавать операции: новое правило — с первого платежа;
  // сменили дату — с новой (прошлые месяцы догонятся, записанные не задвоятся);
  // сменили период — с завтрашнего дня
  const fromFor = (anchor) => {
    if (!existing) return anchor;
    if (existing.period !== f.period) return anchor > addDays(today, 1) ? anchor : addDays(today, 1);
    if (existing.anchor !== anchor) return anchor;
    return existing.from;
  };

  const renderHint = () => {
    const anchor = form.anchor.value;
    const hint = $('#recHint', form);
    if (!anchor) return (hint.textContent = '');
    const draft = { anchor, period: f.period, from: fromFor(anchor), paused: existing?.paused ?? false };
    const due = existing ? 0 : dueDates(draft, today).length;
    const next = nextDate(draft, today);
    hint.textContent = [
      due ? `Сразу запишется ${due} ${plural(due, ['платёж', 'платежа', 'платежей'])} — с ${shortDate(anchor, today)} по сегодня.` : '',
      next ? `Следующий — ${shortDate(next, today)}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  const render = () => {
    $$('[data-type]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === f.type)));
    $$('[data-period]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === f.period)));
    $('#catGrid', form).innerHTML = catGridHtml(f.type, f.categoryId);
    renderHint();
  };
  render();

  form.addEventListener('change', (e) => {
    if (e.target.name === 'anchor') renderHint();
  });
  form.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.type) {
      if (f.type !== t.dataset.type) f.categoryId = null;
      f.type = t.dataset.type;
      render();
    } else if (t.dataset.period) {
      f.period = t.dataset.period;
      render();
    } else if (t.dataset.cat) {
      f.categoryId = t.dataset.cat;
      form.amount.blur();
      render();
    } else if ('back' in t.dataset) {
      openRecurringSheet();
    } else if ('pause' in t.dataset) {
      // После паузы пропущенное не догоняем — продолжаем с сегодняшнего дня
      await put('recurring', { ...existing, paused: !existing.paused, from: existing.paused ? today : existing.from });
      const n = await runRecurring();
      toast(existing.paused ? `Возобновлено${n ? `, записано: ${n}` : ''}` : 'Поставлено на паузу');
      openRecurringSheet();
    } else if ('del' in t.dataset) {
      const ok = await confirmDialog({ title: 'Удалить регулярный платёж?', text: 'Новые операции перестанут появляться. Уже записанные останутся.', ok: 'Удалить', danger: true });
      if (!ok) return;
      const prev = await remove('recurring', existing.id);
      openRecurringSheet();
      if (prev) toast(`«${prev.name}» удалён`, { action: 'Вернуть', onAction: () => restore('recurring', prev) });
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const anchor = form.anchor.value;
    const rec = {
      ...(existing ?? { id: newId(), createdAt: Date.now(), paused: false }),
      type: f.type,
      amount: parseAmount(form.amount.value),
      categoryId: f.categoryId,
      name: form.ruleName.value.trim(),
      note: form.note.value.trim(),
      period: f.period,
      anchor,
      from: fromFor(anchor),
    };
    const err = validateRecurring(rec);
    if (err) return showError(form, err);
    await put('recurring', rec);
    const n = await runRecurring();
    toast(n ? `Сохранено. Записано операций: ${n}` : 'Сохранено');
    openRecurringSheet();
  });
}

// ---------- Быстрые кнопки ----------

let lastQuick = { id: null, at: 0 };

async function addFromPreset(p, amount) {
  const today = todayISO();
  if (state.ui.month !== monthKey(today)) state.ui.month = monthKey(today);
  const tx = await put('transactions', { id: newId(), type: p.type, amount, categoryId: p.categoryId, date: today, note: p.note || p.label, createdAt: Date.now(), presetId: p.id });
  toast(`${p.emoji} ${p.label}: ${sign(p.type)}${money(amount)}`, { action: 'Отменить', onAction: () => remove('transactions', tx.id) });
}

export async function quickAdd(id) {
  const p = state.data.presets.find((x) => x.id === id && !x.deleted);
  if (!p) return;
  if (p.amounts.length > 1) return openQuickAmounts(p);
  // Случайный двойной тап не должен записать трату дважды
  if (lastQuick.id === id && Date.now() - lastQuick.at < 1500) return;
  lastQuick = { id, at: Date.now() };
  await addFromPreset(p, p.amounts[0]);
}

function openQuickAmounts(p) {
  const body = openSheet(
    `${p.emoji} ${p.label}`,
    html`
    <div class="amount-grid">
      ${p.amounts.map((a) => html`<button type="button" class="btn" data-amount="${a}">${money(a)}</button>`)}
    </div>
    <button type="button" class="btn ghost block" data-other style="margin-top:8px">Другая сумма…</button>`,
  );
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.amount) {
      closeSheet();
      await addFromPreset(p, Number(t.dataset.amount));
    } else if ('other' in t.dataset) {
      openTxSheet({ type: p.type, categoryId: p.categoryId, note: p.note || p.label });
    }
  });
}

export function openPresetsSheet() {
  const presets = sortPresets(state.data.presets);
  const body = openSheet(
    'Быстрые кнопки',
    html`
    ${presets.length
      ? html`
        <div class="list">
          ${presets.map(
            (p) => html`
            <button type="button" class="row" data-preset="${p.id}">
              <span class="emoji" aria-hidden="true">${p.emoji}</span>
              <span class="row-main"><span class="row-title">${p.label}</span><span class="row-sub">${p.amounts.map(money).join(' · ')}</span></span>
              <span class="row-amount muted">›</span>
            </button>`,
          )}
        </div>`
      : html`<div class="empty" style="padding:24px 12px"><div class="big">⚡</div>Частые траты в одно касание: кофе, проезд, обед.</div>`}
    <button type="button" class="btn primary block" data-new style="margin-top:12px">＋ Новая кнопка</button>
    <p class="note" style="padding:10px 4px 0">Кнопки стоят на экране «Операции» над списком. Одна сумма — трата записывается сразу (с кнопкой «Отменить»). Несколько сумм — сначала выбираешь сумму.</p>`,
  );
  body.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('new' in t.dataset) openPresetForm();
    else if (t.dataset.preset) openPresetForm({ id: t.dataset.preset });
  });
}

export function openPresetForm({ id = null } = {}) {
  const existing = id ? state.data.presets.find((p) => p.id === id && !p.deleted) : null;
  const f = { type: existing?.type ?? 'expense', categoryId: existing?.categoryId ?? null, amounts: [...(existing?.amounts ?? [])] };
  const body = openSheet(
    existing ? 'Быстрая кнопка' : 'Новая быстрая кнопка',
    html`
    <form id="presetForm" novalidate autocomplete="off">
      <div class="seg" role="group" aria-label="Тип">
        <button type="button" data-type="expense">Расход</button>
        <button type="button" data-type="income">Доход</button>
      </div>
      <div class="inline-form" style="grid-template-columns:64px 1fr;margin-top:12px">
        <input class="input" name="btnEmoji" value="${existing?.emoji ?? '☕'}" aria-label="Эмодзи" style="font-size:24px">
        <input class="input" name="btnLabel" maxlength="30" value="${existing?.label ?? ''}" placeholder="Подпись, например: Кофе" aria-label="Подпись" ${existing ? '' : raw('autofocus')}>
      </div>
      <div class="emoji-palette">${EMOJI.map((em) => html`<button type="button" data-emoji="${em}" aria-label="${em}">${em}</button>`)}</div>
      <h3 class="section-title">Суммы</h3>
      <div class="chips" id="amountChips" style="flex-wrap:wrap;margin:0;padding:0"></div>
      <div class="inline-form" style="grid-template-columns:1fr auto;margin-top:8px">
        <input class="input" name="newAmount" inputmode="decimal" enterkeyhint="done" placeholder="Сумма, например 250" aria-label="Новая сумма">
        <button type="button" class="btn" data-add-amount>＋ Добавить</button>
      </div>
      <p class="note" style="padding:0 4px">Одна сумма — запись в одно касание. Несколько (например, проезд 60 / 120 / 240) — выбор суммы при нажатии.</p>
      <div class="cat-grid" id="catGrid"></div>
      <label class="field"><span>Комментарий к операции (необязательно)</span><input class="input" name="note" maxlength="200" value="${existing?.note ?? ''}" placeholder="По умолчанию — подпись кнопки"></label>
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions">
        ${existing ? html`<button type="button" class="btn danger" data-del>Удалить</button>` : ''}
        <button type="submit" class="btn primary">${existing ? 'Сохранить' : 'Добавить кнопку'}</button>
      </div>
      <button type="button" class="btn ghost block" data-back style="margin-top:6px">← Все кнопки</button>
    </form>`,
  );
  const form = $('#presetForm', body);

  const render = () => {
    $$('[data-type]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === f.type)));
    $('#catGrid', form).innerHTML = catGridHtml(f.type, f.categoryId);
    $('#amountChips', form).innerHTML = f.amounts.length
      ? html`${f.amounts.map((a, i) => html`<button type="button" class="chip" data-remove="${i}" aria-label="Убрать ${money(a)}">${money(a)} ✕</button>`)}`.s
      : html`<span class="muted small" style="padding:4px">Пока ни одной суммы</span>`.s;
  };
  render();

  // true — поле пустое или сумма добавлена
  const addAmount = () => {
    const text = form.newAmount.value.trim();
    if (!text) return true;
    const a = parseAmount(text);
    if (!a) return showError(form, 'Сумма не распознана — например 250 или 99,90'), false;
    if (f.amounts.length >= MAX_PRESET_AMOUNTS) return showError(form, `Не больше ${MAX_PRESET_AMOUNTS} сумм`), false;
    if (!f.amounts.includes(a)) f.amounts.push(a);
    f.amounts.sort((x, y) => x - y);
    form.newAmount.value = '';
    showError(form, '');
    render();
    return true;
  };

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.name === 'newAmount') {
      e.preventDefault();
      addAmount();
    }
  });
  form.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.type) {
      if (f.type !== t.dataset.type) f.categoryId = null;
      f.type = t.dataset.type;
      render();
    } else if (t.dataset.emoji) form.btnEmoji.value = t.dataset.emoji;
    else if (t.dataset.cat) {
      f.categoryId = t.dataset.cat;
      render();
    } else if ('addAmount' in t.dataset) addAmount();
    else if (t.dataset.remove) {
      f.amounts.splice(Number(t.dataset.remove), 1);
      render();
    } else if ('back' in t.dataset) openPresetsSheet();
    else if ('del' in t.dataset) {
      const prev = await remove('presets', existing.id);
      openPresetsSheet();
      if (prev) toast(`Кнопка «${prev.label}» удалена`, { action: 'Вернуть', onAction: () => restore('presets', prev) });
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!addAmount()) return; // сумма, введённая, но не добавленная кнопкой, тоже считается
    const rec = {
      ...(existing ?? { id: newId(), order: Math.max(0, ...live(state.data.presets).map((p) => p.order)) + 1 }),
      type: f.type,
      label: form.btnLabel.value.trim(),
      emoji: firstGrapheme(form.btnEmoji.value),
      categoryId: f.categoryId,
      amounts: f.amounts,
      note: form.note.value.trim(),
    };
    const err = validatePreset(rec);
    if (err) return showError(form, err);
    await put('presets', rec);
    toast(existing ? 'Кнопка сохранена' : `Кнопка «${rec.emoji} ${rec.label}» добавлена на экран «Операции»`);
    openPresetsSheet();
  });
}
