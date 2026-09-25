// Шторки: операция, категории, долги, выгрузка, синхронизация, резервная копия.
import {
  activeCategories,
  addDays,
  amountToInput,
  buildAIReport,
  buildCSV,
  categoryLabel,
  debtLeft,
  debtPaid,
  EXPORT_PRESETS,
  exportFileName,
  formatDate,
  formatMoney,
  isDebtOverdue,
  isToken,
  live,
  makeSyncKey,
  monthKey,
  monthRange,
  monthTitle,
  newId,
  normalizeRepo,
  parseAmount,
  parseData,
  parseSyncKey,
  plural,
  presetRange,
  serializeData,
  shortDate,
  summarize,
  todayISO,
  validateCategory,
  validateDebt,
  validateRange,
  validateTransaction,
} from './logic.js';
import { connectSync, disconnectSync, put, remove, replaceData, restore, runSync, saveSettings, state } from './state.js';
import { $, $$, closeSheet, confirmDialog, copyText, html, openSheet, pickFile, raw, saveFile, toast, updateSheet } from './ui.js';

const money = (kop, opts) => formatMoney(kop, opts);

export const EMOJI = ['🛒', '🍔', '☕', '🍕', '🥡', '🚇', '🚕', '🚗', '⛽', '🏠', '💡', '📱', '💻', '📺', '🎮', '🎬', '🎉', '💊', '🦷', '💪', '👕', '👟', '💅', '💇', '🎁', '📚', '✈️', '🏖️', '🐶', '👶', '🚬', '🍺', '🧾', '💳', '💼', '💰', '🏦', '📈', '🧑‍💻', '📦'];

// Первый символ (с учётом составных эмодзи вроде 🧑‍💻)
export function firstGrapheme(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(t)][0].segment;
  return Array.from(t)[0];
}

export const showError = (root, text) => {
  const el = $('.form-error', root);
  if (el) el.textContent = text ?? '';
};

const nextOrder = (type) => Math.max(0, ...live(state.data.categories).filter((c) => c.type === type).map((c) => c.order ?? 0)) + 1;

// Сетка категорий для форм. Удалённую категорию выбранной записи тоже показываем,
// чтобы при правке старой операции она не потерялась.
export function catGridHtml(type, selectedId, { add = false } = {}) {
  const cats = activeCategories(state.data.categories, type);
  const current = state.data.categories.find((c) => c.id === selectedId && !c.deleted && c.type === type);
  if (current && !cats.includes(current)) cats.unshift(current);
  return html`
    ${cats.map(
      (c) => html`
      <button type="button" class="cat-btn" data-cat="${c.id}" aria-pressed="${c.id === selectedId}">
        <span class="e" aria-hidden="true">${c.emoji}</span><span class="n">${c.name}</span>
      </button>`,
    )}
    ${add ? html`<button type="button" class="cat-btn add" data-add-cat><span class="e" aria-hidden="true">＋</span><span class="n">Своя категория</span></button>` : ''}`.s;
}

// ---------- Операция ----------

export function openTxSheet({ id = null, type = 'expense', categoryId = null, note = '' } = {}) {
  const existing = id ? state.data.transactions.find((t) => t.id === id && !t.deleted) : null;
  if (id && !existing) return;
  const today = todayISO();
  const f = {
    type: existing?.type ?? type,
    categoryId: existing?.categoryId ?? categoryId,
    addingCat: false,
  };
  const title = existing ? 'Операция' : 'Новая операция';
  const body = openSheet(
    title,
    html`
    <form id="txForm" novalidate autocomplete="off">
      <div class="seg" role="group" aria-label="Тип">
        <button type="button" data-type="expense">Расход</button>
        <button type="button" data-type="income">Доход</button>
      </div>
      <label class="amount-field">
        <input name="amount" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${existing ? amountToInput(existing.amount) : ''}" aria-label="Сумма" ${existing ? '' : raw('autofocus')}>
        <span>₽</span>
      </label>
      <div class="cat-grid" id="catGrid"></div>
      <div id="catInline"></div>
      <div class="date-row">
        <button type="button" class="chip" data-date="${today}">Сегодня</button>
        <button type="button" class="chip" data-date="${addDays(today, -1)}">Вчера</button>
        <input class="input" type="date" name="date" value="${existing?.date ?? today}" aria-label="Дата">
      </div>
      <input class="input" name="note" maxlength="200" placeholder="Комментарий: где, что, зачем" value="${existing?.note ?? note}" aria-label="Комментарий">
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions">
        ${existing ? html`<button type="button" class="btn danger" data-del>Удалить</button>` : ''}
        <button type="submit" class="btn primary">${existing ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>`,
  );
  const form = $('#txForm', body);

  const renderType = () => $$('[data-type]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === f.type)));
  const renderDate = () => $$('[data-date]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.date === form.date.value)));
  const renderGrid = () => {
    $('#catGrid', form).innerHTML = catGridHtml(f.type, f.categoryId, { add: true });
    $('#catInline', form).innerHTML = f.addingCat
      ? html`
        <div class="inline-form">
          <input class="input" name="catEmoji" value="🏷️" aria-label="Эмодзи категории">
          <input class="input" name="catName" maxlength="40" placeholder="Название" aria-label="Название категории" enterkeyhint="done">
          <button type="button" class="btn primary" data-cat-save>ОК</button>
        </div>`.s
      : '';
    if (f.addingCat) form.catName.focus();
  };
  renderType();
  renderDate();
  renderGrid();

  async function addCategory() {
    const emoji = firstGrapheme(form.catEmoji.value);
    const name = form.catName.value.trim();
    const err = validateCategory({ name, emoji });
    if (err) return showError(form, err);
    const cat = await put('categories', { id: newId(), type: f.type, name, emoji, order: nextOrder(f.type), archived: false });
    f.categoryId = cat.id;
    f.addingCat = false;
    showError(form, '');
    renderGrid();
  }

  form.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.type) {
      if (f.type !== t.dataset.type) {
        f.type = t.dataset.type;
        f.categoryId = null;
      }
      renderType();
      renderGrid();
    } else if (t.dataset.cat) {
      f.categoryId = t.dataset.cat;
      form.amount.blur();
      showError(form, '');
      renderGrid();
    } else if ('addCat' in t.dataset) {
      f.addingCat = !f.addingCat;
      renderGrid();
    } else if ('catSave' in t.dataset) {
      await addCategory();
    } else if (t.dataset.date) {
      form.date.value = t.dataset.date;
      renderDate();
    } else if ('del' in t.dataset) {
      const prev = await remove('transactions', existing.id);
      closeSheet();
      if (prev) toast('Операция удалена', { action: 'Вернуть', onAction: () => restore('transactions', prev) });
    }
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'date') renderDate();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.name === 'catName') {
      e.preventDefault();
      addCategory();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseAmount(form.amount.value);
    const rec = {
      ...(existing ?? { id: newId(), createdAt: Date.now() }),
      type: f.type,
      amount,
      categoryId: f.categoryId,
      date: form.date.value,
      note: form.note.value.trim(),
    };
    const err = amount ? validateTransaction(rec) : 'Введи сумму — например 350 или 1 299,90';
    if (err) return showError(form, err);
    // Операция за другой месяц — переключаемся туда (до сохранения, чтобы перерисовка это учла)
    if (monthKey(rec.date) !== state.ui.month) {
      state.ui.month = monthKey(rec.date);
      state.ui.filterCat = null;
    }
    const saved = await put('transactions', rec);
    closeSheet();
    const cat = state.data.categories.find((c) => c.id === saved.categoryId);
    toast(existing ? 'Сохранено' : `${categoryLabel(cat)}: ${saved.type === 'income' ? '+' : '−'}${money(saved.amount)}`);
  });
}

// ---------- Категории ----------

export function openCategoriesSheet(type = 'expense') {
  let current = type;
  let editing = null; // null — список, иначе редактируемая категория ({} — новая)

  function usage() {
    const counts = new Map();
    for (const t of live(state.data.transactions)) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
    return counts;
  }

  function renderList() {
    const cats = activeCategories(state.data.categories, current);
    const counts = usage();
    const body = updateSheet(
      'Категории',
      html`
      <div class="seg" role="group" aria-label="Тип">
        <button type="button" data-type="expense" aria-pressed="${current === 'expense'}">Расходы</button>
        <button type="button" data-type="income" aria-pressed="${current === 'income'}">Доходы</button>
      </div>
      <div class="list" style="margin-top:12px">
        ${cats.map((c) => {
          const n = counts.get(c.id) ?? 0;
          return html`
          <button type="button" class="row" data-edit="${c.id}">
            <span class="emoji" aria-hidden="true">${c.emoji}</span>
            <span class="row-main"><span class="row-title">${c.name}</span><span class="row-sub">${n ? `${n} ${plural(n, ['операция', 'операции', 'операций'])}` : 'пока не использовалась'}</span></span>
            <span class="row-amount muted">›</span>
          </button>`;
        })}
      </div>
      <button type="button" class="btn block" data-new style="margin-top:12px">＋ Новая категория</button>
      <p class="note" style="padding:10px 4px 0">Удалённая категория пропадает из выбора, но старые операции с ней остаются.</p>`,
    );
    body.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.type) {
        current = t.dataset.type;
        renderList();
      } else if (t.dataset.edit) {
        editing = state.data.categories.find((c) => c.id === t.dataset.edit);
        renderEdit();
      } else if ('new' in t.dataset) {
        editing = {};
        renderEdit();
      }
    });
  }

  function renderEdit() {
    const isNew = !editing.id;
    const body = updateSheet(
      isNew ? 'Новая категория' : 'Категория',
      html`
      <form id="catForm" novalidate autocomplete="off">
        <div class="inline-form" style="grid-template-columns:64px 1fr">
          <input class="input" name="emoji" value="${editing.emoji ?? '🏷️'}" aria-label="Эмодзи" style="font-size:24px">
          <input class="input" name="catName" maxlength="40" value="${editing.name ?? ''}" placeholder="Название" aria-label="Название" ${isNew ? raw('autofocus') : ''}>
        </div>
        <div class="emoji-palette">${EMOJI.map((em) => html`<button type="button" data-emoji="${em}" aria-label="${em}">${em}</button>`)}</div>
        <p class="form-error" role="alert"></p>
        <div class="sheet-actions">
          ${isNew ? '' : html`<button type="button" class="btn danger" data-del>Удалить</button>`}
          <button type="submit" class="btn primary">${isNew ? 'Добавить' : 'Сохранить'}</button>
        </div>
        <button type="button" class="btn ghost block" data-back style="margin-top:6px">← Все категории</button>
      </form>`,
    );
    const form = $('#catForm', body);
    form.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.emoji) form.emoji.value = t.dataset.emoji;
      else if ('back' in t.dataset) {
        editing = null;
        renderList();
      } else if ('del' in t.dataset) {
        const cat = editing;
        await put('categories', { ...cat, archived: true });
        toast(`Категория «${cat.name}» удалена`, { action: 'Вернуть', onAction: () => put('categories', { ...cat, archived: false }) });
        editing = null;
        renderList();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emoji = firstGrapheme(form.emoji.value);
      const name = form.catName.value.trim();
      const err = validateCategory({ name, emoji });
      if (err) return showError(form, err);
      const dup = activeCategories(state.data.categories, current).find((c) => c.id !== editing.id && c.name.toLowerCase() === name.toLowerCase());
      if (dup) return showError(form, 'Такая категория уже есть');
      await put('categories', isNew ? { id: newId(), type: current, name, emoji, order: nextOrder(current), archived: false } : { ...editing, name, emoji });
      editing = null;
      renderList();
    });
  }

  renderList();
}

// ---------- Долги ----------

const findDebt = (id) => state.data.debts.find((d) => d.id === id && !d.deleted);

export function openDebtForm({ id = null } = {}) {
  const d = id ? findDebt(id) : null;
  const today = todayISO();
  let direction = d?.direction ?? 'toMe';
  const people = [...new Set(live(state.data.debts).map((x) => x.person))].sort((a, b) => a.localeCompare(b, 'ru'));
  const body = openSheet(
    d ? 'Изменить долг' : 'Новый долг',
    html`
    <form id="debtForm" novalidate autocomplete="off">
      <div class="seg" role="group" aria-label="Кто кому должен">
        <button type="button" data-dir="toMe">Мне должны</button>
        <button type="button" data-dir="fromMe">Я должен</button>
      </div>
      <label class="amount-field">
        <input name="amount" inputmode="decimal" placeholder="0" value="${d ? amountToInput(d.amount) : ''}" aria-label="Сумма" ${d ? '' : raw('autofocus')}>
        <span>₽</span>
      </label>
      <label class="field"><span id="personLabel"></span><input class="input" name="person" list="people" maxlength="80" value="${d?.person ?? ''}" placeholder="Имя"></label>
      <datalist id="people">${people.map((p) => html`<option value="${p}"></option>`)}</datalist>
      <div class="fields-2">
        <label class="field"><span>Когда</span><input class="input" type="date" name="date" value="${d?.date ?? today}"></label>
        <label class="field"><span>Вернуть до</span><input class="input" type="date" name="dueDate" value="${d?.dueDate ?? ''}"></label>
      </div>
      <label class="field"><span>За что (необязательно)</span><input class="input" name="note" maxlength="200" value="${d?.note ?? ''}" placeholder="Например: билеты на концерт"></label>
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions"><button type="submit" class="btn primary">${d ? 'Сохранить' : 'Записать долг'}</button></div>
    </form>`,
  );
  const form = $('#debtForm', body);
  const renderDir = () => {
    $$('[data-dir]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dir === direction)));
    $('#personLabel', form).textContent = direction === 'toMe' ? 'Кто должен' : 'Кому должен';
  };
  renderDir();
  form.addEventListener('click', (e) => {
    const t = e.target.closest('[data-dir]');
    if (!t) return;
    direction = t.dataset.dir;
    renderDir();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rec = {
      ...(d ?? { id: newId(), createdAt: Date.now(), payments: [] }),
      direction,
      person: form.person.value.trim(),
      amount: parseAmount(form.amount.value),
      date: form.date.value,
      dueDate: form.dueDate.value || null,
      note: form.note.value.trim(),
    };
    const err = rec.amount ? validateDebt(rec) : 'Введи сумму больше нуля';
    if (err) return showError(form, err);
    if (d && rec.amount < debtPaid(d)) return showError(form, `Уже вернули ${money(debtPaid(d))} — сумма не может быть меньше`);
    const saved = await put('debts', rec);
    if (d) openDebtSheet(saved.id);
    else {
      closeSheet();
      toast(`Записано: ${saved.person}, ${money(saved.amount)}`);
    }
  });
}

export function openDebtSheet(id) {
  const d = findDebt(id);
  if (!d) return closeSheet();
  const today = todayISO();
  const left = debtLeft(d);
  const paid = debtPaid(d);
  const overdue = isDebtOverdue(d, today);
  const payments = [...d.payments].sort((a, b) => b.date.localeCompare(a.date));
  const body = openSheet(
    d.person,
    html`
    <div class="hero">
      <div class="muted">${d.direction === 'toMe' ? 'Должен тебе' : 'Ты должен'}</div>
      <div class="big num ${d.direction === 'toMe' ? 'pos' : ''}">${left ? money(left) : 'Погашен ✓'}</div>
      <div class="muted small">${left ? (paid ? `осталось из ${money(d.amount)}` : '') : `было ${money(d.amount)}`}</div>
    </div>
    <div class="progress" aria-hidden="true"><i style="width:${((paid / d.amount) * 100).toFixed(1)}%"></i></div>
    <div class="group" style="margin-top:12px">
      <div class="item"><span>Дата</span><span class="hint">${formatDate(d.date)}</span></div>
      ${d.dueDate ? html`<div class="item"><span>Вернуть до</span><span class="hint ${overdue ? 'neg' : ''}">${formatDate(d.dueDate)}${overdue ? ' · просрочен' : ''}</span></div>` : ''}
      ${d.note ? html`<div class="item"><span>За что</span><span class="hint">${d.note}</span></div>` : ''}
    </div>
    ${left
      ? html`
        <h3 class="section-title">Записать возврат</h3>
        <form id="payForm" class="inline-form" style="grid-template-columns:1fr 1fr auto" novalidate>
          <input class="input" name="amount" inputmode="decimal" value="${amountToInput(left)}" aria-label="Сумма возврата">
          <input class="input" type="date" name="date" value="${today}" aria-label="Дата возврата">
          <button type="submit" class="btn primary" aria-label="Записать возврат">＋</button>
        </form>
        <p class="form-error" role="alert"></p>
        <button type="button" class="btn block" data-full>✓ Вернули полностью</button>`
      : ''}
    ${payments.length
      ? html`
        <h3 class="section-title">Возвраты</h3>
        <div class="list">
          ${payments.map(
            (p) => html`
            <div class="row">
              <span class="emoji" aria-hidden="true">↩️</span>
              <span class="row-main"><span class="row-title num">${money(p.amount)}</span><span class="row-sub">${shortDate(p.date, today)}</span></span>
              <button type="button" class="icon-btn" data-del-pay="${p.id}" aria-label="Удалить возврат">✕</button>
            </div>`,
          )}
        </div>`
      : ''}
    <div class="sheet-actions">
      ${d.direction === 'toMe' && left ? html`<button type="button" class="btn" data-remind>Напомнить</button>` : ''}
      <button type="button" class="btn" data-edit>Изменить</button>
      <button type="button" class="btn danger" data-delete>Удалить</button>
    </div>`,
  );

  const addPayment = async (amount, date) => {
    const next = await put('debts', { ...d, payments: [...d.payments, { id: newId(), amount, date, note: '' }] });
    if (!debtLeft(next)) {
      closeSheet();
      toast(`${d.person}: долг закрыт 🎉`);
    } else openDebtSheet(id);
  };

  $('#payForm', body)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const amount = parseAmount(form.amount.value);
    if (!amount) return showError(body, 'Введи сумму возврата');
    if (amount > left) return showError(body, `Больше, чем осталось (${money(left)})`);
    if (!form.date.value) return showError(body, 'Укажи дату');
    await addPayment(amount, form.date.value);
  });

  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('full' in t.dataset) await addPayment(left, today);
    else if (t.dataset.delPay) {
      await put('debts', { ...d, payments: d.payments.filter((p) => p.id !== t.dataset.delPay) });
      openDebtSheet(id);
    } else if ('edit' in t.dataset) openDebtForm({ id });
    else if ('remind' in t.dataset) {
      const text = `Привет! Напоминаю про ${money(left)}${d.note ? ` (${d.note})` : ''}. Сможешь вернуть${d.dueDate ? ` до ${shortDate(d.dueDate)}` : ''}? 🙂`;
      if (navigator.share) {
        navigator.share({ text }).catch(() => {});
      } else if (await copyText(text)) toast('Текст напоминания скопирован');
    } else if ('delete' in t.dataset) {
      const ok = await confirmDialog({ title: 'Удалить долг?', text: `${d.person}, ${money(d.amount)}. Вместе с историей возвратов.`, ok: 'Удалить', danger: true });
      if (!ok) return;
      const prev = await remove('debts', id);
      closeSheet();
      if (prev) toast('Долг удалён', { action: 'Вернуть', onAction: () => restore('debts', prev) });
    }
  });
}

// ---------- Выгрузка ----------

export function openExportSheet({ format = 'ai' } = {}) {
  const today = todayISO();
  const viewed = monthRange(state.ui.month);
  const f = { format, ...viewed, notes: true, income: true, debts: false };
  const touch = matchMedia('(pointer: coarse)').matches;

  const presets = () => {
    const list = EXPORT_PRESETS.map((p) => ({ label: p.label, ...presetRange(p.id, today) }));
    // Если смотрим не текущий месяц — первым предлагаем именно его
    if (state.ui.month !== monthKey(today)) list.unshift({ label: monthTitle(state.ui.month), ...viewed });
    return list;
  };

  const build = () =>
    f.format === 'ai'
      ? buildAIReport(state.data, { from: f.from, to: f.to, notes: f.notes, income: f.income, debts: f.debts }, today)
      : buildCSV(state.data, { from: f.from, to: f.to, notes: f.notes, income: f.income });

  function preview() {
    const err = validateRange(f.from, f.to);
    const s = err ? null : summarize(state.data, f.from, f.to, today);
    const count = s ? s.expenseCount + (f.income ? s.incomeCount : 0) : 0;
    const text = s
      ? html`${formatDate(f.from)} — ${formatDate(f.to)}: <b>${count} ${plural(count, ['операция', 'операции', 'операций'])}</b><br>
          расходы ${money(s.expense)}${f.income ? html`, доходы ${money(s.income)}` : ''}`
      : html`${err}`;
    return { text, ready: Boolean(s && count) };
  }

  // Без перерисовки шторки — иначе на айфоне закроется колесо выбора даты
  function refresh(body) {
    const p = preview();
    $('.preview', body).innerHTML = p.text.s;
    $$('[data-from]', body).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.from === f.from && c.dataset.to === f.to)));
    $$('[data-save], [data-copy]', body).forEach((b) => (b.disabled = !p.ready));
  }

  function render(keepScroll = false) {
    const p = preview();
    const body = updateSheet(
      'Выгрузка',
      html`
      <div class="seg" role="group" aria-label="Формат">
        <button type="button" data-format="ai" aria-pressed="${f.format === 'ai'}">🤖 Для ИИ</button>
        <button type="button" data-format="csv" aria-pressed="${f.format === 'csv'}">📊 Excel / CSV</button>
      </div>
      <h3 class="section-title">Период</h3>
      <div class="chips" style="flex-wrap:wrap;margin:0;padding:0">
        ${presets().map((p) => html`<button type="button" class="chip" data-from="${p.from}" data-to="${p.to}" aria-pressed="${p.from === f.from && p.to === f.to}">${p.label}</button>`)}
      </div>
      <div class="fields-2" style="margin-top:12px">
        <label class="field"><span>С</span><input class="input" type="date" name="from" value="${f.from}"></label>
        <label class="field"><span>По</span><input class="input" type="date" name="to" value="${f.to}"></label>
      </div>
      <div class="preview">${p.text}</div>
      <div class="group" style="padding:0 16px">
        <label class="check"><span>Комментарии к операциям</span><span class="switch"><input type="checkbox" name="notes" ${f.notes ? raw('checked') : ''}><span></span></span></label>
        <label class="check"><span>Доходы</span><span class="switch"><input type="checkbox" name="income" ${f.income ? raw('checked') : ''}><span></span></span></label>
        ${f.format === 'ai' ? html`<label class="check"><span>Открытые долги (без имён)</span><span class="switch"><input type="checkbox" name="debts" ${f.debts ? raw('checked') : ''}><span></span></span></label>` : ''}
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-actions" style="flex-direction:column">
        <button type="button" class="btn primary" data-save ${p.ready ? '' : raw('disabled')}>${touch ? '📤 Сохранить или отправить файл' : '⬇️ Скачать файл'}</button>
        ${f.format === 'ai' ? html`<button type="button" class="btn" data-copy ${p.ready ? '' : raw('disabled')}>📋 Скопировать текстом</button>` : ''}
      </div>
      <p class="note" style="padding:10px 4px 0">
        ${f.format === 'ai'
          ? 'Прикрепи файл в ChatGPT, Claude, DeepSeek или GigaChat и отправь — задание для разбора уже внутри. Можно дописать свой вопрос: «на чём сэкономить 10 000 ₽ в месяц?»'
          : 'Файл откроется в Excel, Numbers и Google Таблицах: разделитель «;», суммы с запятой.'}
      </p>`,
      { keepScroll },
    );

    body.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t || t.disabled) return;
      if (t.dataset.format) {
        f.format = t.dataset.format;
        render(true);
      } else if (t.dataset.from) {
        f.from = t.dataset.from;
        f.to = t.dataset.to;
        render(true);
      } else if ('save' in t.dataset) {
        const text = build();
        const name = exportFileName(f.format, f.from, f.to);
        const res = await saveFile(name, text, f.format === 'ai' ? 'text/plain' : 'text/csv');
        if (res === 'downloaded') toast(`Файл ${name} скачан`);
      } else if ('copy' in t.dataset) {
        if (await copyText(build())) toast('Скопировано — вставь в чат с нейросетью');
        else toast('Не получилось скопировать — сохрани файлом');
      }
    });
    body.addEventListener('change', (e) => {
      const el = e.target;
      if (el.type === 'checkbox') f[el.name] = el.checked;
      else if (el.name === 'from' || el.name === 'to') f[el.name] = el.value;
      refresh(body);
    });
  }
  render();
}

// ---------- Синхронизация ----------

const SYNC_HINTS = {
  auth: 'Создай новый токен и подключись заново.',
  forbidden: 'Проверь у токена: Repository access → твой репозиторий, Permissions → Contents: Read and write.',
  'not-found': 'Проверь название «логин/репозиторий» и что токен выдан именно на этот репозиторий.',
  'bad-file': 'Посмотри файл data.json в репозитории — возможно, его правили руками. Верни прошлую версию через историю коммитов.',
};

export function openSyncSheet() {
  const cfg = state.settings.sync;
  if (cfg) return renderSyncStatus();

  const body = openSheet(
    'Синхронизация',
    html`
    <p style="margin:4px 4px 8px;color:var(--text-2);font-size:15px">Данные будут храниться файлом <b>data.json</b> в твоём <b>приватном</b> репозитории. Так телефон и компьютер видят одно и то же, а история коммитов — бесплатный бэкап.</p>
    <h3 class="section-title">Уже подключено на другом устройстве</h3>
    <div class="group">
      <button type="button" class="item" data-scan><span>📷 Сканировать QR-код</span><span class="hint">›</span></button>
      <button type="button" class="item" data-paste><span>📋 Вставить ключ подключения</span><span class="hint">›</span></button>
    </div>
    <p class="note">Там: Настройки → Синхронизация → «Подключить другое устройство». Токен вводить не нужно.</p>
    <h3 class="section-title">Первое подключение</h3>
    <ol class="steps">
      <li>Создай приватный репозиторий, например <b>trecker-data</b>: <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a> → <b>Private</b>, галочка <b>Add a README file</b>.</li>
      <li>Создай токен: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token</a> → Expiration: <b>Custom</b> на год (или No expiration) → Repository access: <b>Only select repositories</b> → этот репозиторий → Permissions → Repository → <b>Contents: Read and write</b>.</li>
      <li>Вставь репозиторий и токен ниже.</li>
    </ol>
    <form id="syncForm" novalidate autocomplete="off">
      <label class="field"><span>Репозиторий</span><input class="input" name="repo" placeholder="логин/trecker-data" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label class="field"><span>Токен</span><input class="input" name="token" type="password" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <p class="form-error" role="alert"></p>
      <button type="submit" class="btn primary block">Подключить</button>
    </form>
    <p class="note" style="padding:10px 4px 0">Токен хранится только на этом устройстве и даёт доступ к одному репозиторию. Утёк — удали его на GitHub и создай новый.</p>`,
  );
  const form = $('#syncForm', body);

  async function connect({ repo, token }) {
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Подключаю…';
    showError(form, '');
    try {
      await connectSync({ repo, token });
      toast('Синхронизация включена ☁️');
      renderSyncStatus();
    } catch (err) {
      if (state.settings.sync) return renderSyncStatus();
      btn.disabled = false;
      btn.textContent = 'Подключить';
      showError(form, `${err.message} ${SYNC_HINTS[err.code] ?? ''}`);
    }
  }

  // Ключ, вставленный в любое из полей, раскладываем по полям сам
  form.addEventListener('input', (e) => {
    const key = parseSyncKey(e.target.value);
    if (!key) return;
    form.repo.value = key.repo;
    form.token.value = key.token;
    connect(key);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repo = normalizeRepo(form.repo.value);
    const token = form.token.value.trim();
    if (!repo) return showError(form, 'Репозиторий в формате логин/название');
    if (!isToken(token)) return showError(form, 'Вставь токен целиком — он начинается с github_pat_');
    await connect({ repo, token });
  });
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('scan' in t.dataset) renderScanner();
    else if ('paste' in t.dataset) {
      let text = '';
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return showError(form, 'Браузер не дал прочитать буфер обмена — вставь ключ в поле «Репозиторий».');
      }
      const key = parseSyncKey(text);
      if (!key) return showError(form, 'В буфере нет ключа. На подключённом устройстве: Синхронизация → «Подключить другое устройство» → «Скопировать ключ».');
      form.repo.value = key.repo;
      form.token.value = key.token;
      await connect(key);
    }
  });
}

// Сканер QR-кода с экрана другого устройства
function renderScanner() {
  let stop = null;
  let closed = false;
  const halt = () => {
    closed = true;
    stop?.();
  };
  const body = updateSheet(
    'Сканирование',
    html`
    <div class="scanner"><video muted playsinline aria-label="Камера"></video><i class="scan-frame" aria-hidden="true"></i></div>
    <p class="status-line" id="scanStatus" style="justify-content:center;margin:12px 4px">Наведи камеру на QR-код на экране другого устройства</p>
    <p class="form-error" role="alert" style="text-align:center"></p>
    <button type="button" class="btn ghost block" data-back>← Ввести вручную</button>`,
    { onClose: halt },
  );
  const status = $('#scanStatus', body);
  const video = $('video', body);

  async function start() {
    const { startScanner, describeCameraError } = await import('./qr.js');
    try {
      stop = await startScanner(video, onResult);
      if (closed) stop();
    } catch (err) {
      if (!closed) showError(body, describeCameraError(err));
    }
  }

  async function onResult(text) {
    const key = parseSyncKey(text);
    if (!key) {
      showError(body, 'Это не ключ трекера. Открой QR в «Подключить другое устройство».');
      setTimeout(() => !closed && (showError(body, ''), start()), 1500);
      return;
    }
    status.textContent = `Подключаю ${key.repo}…`;
    try {
      await connectSync(key);
      toast('Синхронизация включена ☁️');
      renderSyncStatus();
    } catch (err) {
      if (state.settings.sync) return renderSyncStatus();
      showError(body, `${err.message} ${SYNC_HINTS[err.code] ?? ''}`);
    }
  }

  body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-back]')) return;
    halt();
    openSyncSheet();
  });
  start();
}

// QR-код и ключ для второго устройства
function renderDeviceKey() {
  const key = makeSyncKey(state.settings.sync);
  let hideTimer = null;
  const body = updateSheet(
    'Другое устройство',
    html`
    <ol class="steps">
      <li>На втором устройстве открой трекер (на айфоне — с иконки на экране «Домой»).</li>
      <li>Настройки → Синхронизация через GitHub → <b>📷 Сканировать QR</b>.</li>
      <li>Наведи камеру на код ниже.</li>
    </ol>
    <div class="qr-box" id="qrBox"><button type="button" class="btn primary" data-show>Показать QR-код</button></div>
    <p class="note" style="padding:8px 4px 0">⚠️ В коде — токен доступа к репозиторию с твоими данными. Не показывай его посторонним и не делай скриншот. Код спрячется сам через 2 минуты.</p>
    <div class="sheet-actions" style="flex-direction:column">
      <button type="button" class="btn" data-copy>📋 Скопировать ключ текстом</button>
      <button type="button" class="btn ghost" data-back>← Назад</button>
    </div>`,
    { onClose: () => clearTimeout(hideTimer) },
  );
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('show' in t.dataset) {
      const { qrSvg } = await import('./qr.js');
      $('#qrBox', body).innerHTML = qrSvg(key);
      hideTimer = setTimeout(() => {
        const box = $('#qrBox', body);
        if (box) box.innerHTML = html`<button type="button" class="btn primary" data-show>Показать QR-код</button>`.s;
      }, 120_000);
    } else if ('copy' in t.dataset) {
      if (await copyText(key)) toast('Ключ скопирован. Вставь его на другом устройстве и не пересылай в чаты', { ms: 6000 });
    } else if ('back' in t.dataset) {
      clearTimeout(hideTimer);
      renderSyncStatus();
    }
  });
}

function renderSyncStatus() {
  const cfg = state.settings.sync;
  const { sync, settings } = state;
  const body = updateSheet(
    'Синхронизация',
    html`
    <div class="group">
      <div class="item"><span>Репозиторий</span><a class="hint" href="https://github.com/${cfg.repo}" target="_blank" rel="noopener">${cfg.repo}</a></div>
      <div class="item"><span>Последняя синхронизация</span><span class="hint">${settings.lastSyncAt ? new Date(settings.lastSyncAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
    </div>
    ${sync.status === 'error' ? html`<p class="note neg">${sync.error} ${SYNC_HINTS[sync.code] ?? ''}</p>` : ''}
    <div class="sheet-actions" style="flex-direction:column">
      <button type="button" class="btn primary" data-now>↻ Синхронизировать сейчас</button>
      <button type="button" class="btn" data-device>📱 Подключить другое устройство</button>
      <button type="button" class="btn danger" data-off>Отключить на этом устройстве</button>
    </div>
    <p class="note" style="padding:10px 4px 0">Синхронизация идёт сама: при открытии, через пару секунд после правки и раз в минуту. Без интернета всё работает и догонится позже.</p>`,
  );
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('now' in t.dataset) {
      t.disabled = true;
      t.textContent = 'Синхронизирую…';
      try {
        await runSync({ manual: true });
        toast('Синхронизировано ✓');
      } catch (err) {
        toast(err.message);
      }
      renderSyncStatus();
    } else if ('device' in t.dataset) {
      renderDeviceKey();
    } else if ('off' in t.dataset) {
      const ok = await confirmDialog({ title: 'Отключить синхронизацию?', text: 'Данные на устройстве и в репозитории останутся, но перестанут обмениваться. Токен удалится с этого устройства.', ok: 'Отключить', danger: true });
      if (!ok) return;
      await disconnectSync();
      closeSheet();
      toast('Синхронизация выключена');
    }
  });
}

// ---------- Резервная копия ----------

export async function saveBackup() {
  const name = `rashody_backup_${todayISO()}.json`;
  const res = await saveFile(name, serializeData(state.data), 'application/json');
  if (res === 'cancelled') return;
  await saveSettings({ lastBackupAt: Date.now() });
  toast(res === 'downloaded' ? `Копия ${name} скачана` : 'Копия сохранена');
}

export async function restoreBackup() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data;
  try {
    data = parseData(await file.text());
  } catch (err) {
    toast(err.message);
    return;
  }
  const n = live(data.transactions).length;
  const ok = await confirmDialog({
    title: 'Восстановить из копии?',
    text: `В файле ${n} ${plural(n, ['операция', 'операции', 'операций'])}. Данные на этом устройстве заменятся данными из файла.`,
    ok: 'Восстановить',
    danger: true,
  });
  if (!ok) return;
  await replaceData(data);
  toast('Данные восстановлены');
}
