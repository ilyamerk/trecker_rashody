import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  buildAIReport,
  buildCSV,
  comparisonRange,
  daysInclusive,
  debtLeft,
  debtsSummary,
  elapsedDays,
  emptyData,
  formatMoney,
  generateRecurring,
  groupByDay,
  dueDates,
  isISODate,
  makeSyncKey,
  mergeData,
  monthRange,
  monthlyTotals,
  nextDate,
  normalizeData,
  normalizeRepo,
  parseAmount,
  occurrenceDate,
  parseData,
  parseSyncKey,
  periodLabel,
  plural,
  presetRange,
  recurringSummary,
  serializeData,
  shiftMonth,
  sortDebts,
  sortPresets,
  summarize,
  validatePreset,
  validateRange,
  validateRecurring,
  validateTransaction,
  weekday,
} from '../app/js/logic.js';

const tx = (id, type, amount, date, categoryId = type === 'expense' ? 'exp-food' : 'inc-salary', extra = {}) => ({
  id,
  type,
  amount,
  date,
  categoryId,
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const withTx = (...txs) => normalizeData({ transactions: txs });

test('parseAmount: рубли с копейками, пробелы, запятая', () => {
  assert.equal(parseAmount('1234'), 123400);
  assert.equal(parseAmount('1 234,5'), 123450);
  assert.equal(parseAmount('1\u00a0234.56 ₽'), 123456);
  assert.equal(parseAmount(',5'), 50);
  assert.equal(parseAmount('0.01'), 1);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('1.234'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('1000000001'), null);
});

test('formatMoney: разряды, копейки, знак', () => {
  assert.equal(formatMoney(123456), '1\u00a0234,56\u00a0₽');
  assert.equal(formatMoney(100000), '1\u00a0000\u00a0₽');
  assert.equal(formatMoney(-500, { sign: true }), '−5\u00a0₽');
  assert.equal(formatMoney(500, { sign: true }), '+5\u00a0₽');
  assert.equal(formatMoney(1234567, { currency: false, sep: ' ' }), '12 345,67');
});

test('даты: месяцы, високосный год, дни недели', () => {
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-03', -14), '2025-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysInclusive('2026-09-01', '2026-09-30'), 30);
  assert.equal(weekday('2026-09-21'), 0); // понедельник
  assert.equal(weekday('2026-09-27'), 6); // воскресенье
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-9-1'), false);
  assert.equal(isISODate('2026-09-01'), true);
});

test('plural', () => {
  assert.equal(plural(1, ['день', 'дня', 'дней']), 'день');
  assert.equal(plural(3, ['день', 'дня', 'дней']), 'дня');
  assert.equal(plural(11, ['день', 'дня', 'дней']), 'дней');
  assert.equal(plural(22, ['день', 'дня', 'дней']), 'дня');
});

test('validateTransaction', () => {
  const ok = { type: 'expense', amount: 100, categoryId: 'exp-food', date: '2026-09-01' };
  assert.equal(validateTransaction(ok), null);
  assert.match(validateTransaction({ ...ok, amount: 0 }), /сумму/);
  assert.match(validateTransaction({ ...ok, categoryId: '' }), /категорию/);
  assert.match(validateTransaction({ ...ok, date: '2026-13-01' }), /дату/);
});

test('emptyData: базовые категории на месте', () => {
  const d = emptyData();
  assert.ok(d.categories.some((c) => c.id === 'exp-food' && c.type === 'expense'));
  assert.ok(d.categories.some((c) => c.id === 'inc-salary' && c.type === 'income'));
  assert.equal(d.transactions.length, 0);
});

test('normalizeData: мусор отбрасывается, неизвестные поля сохраняются, дубли id — нет', () => {
  const d = normalizeData({
    transactions: [
      tx('a', 'expense', 100, '2026-09-01', 'exp-food', { future: 'x' }),
      tx('a', 'expense', 999, '2026-09-01'),
      { id: 'b', type: 'expense', amount: -1, date: '2026-09-01' },
      { id: 'c', type: 'bad', amount: 1, date: '2026-09-01' },
      null,
      { id: 'd', deleted: true, updatedAt: 5, junk: 1 },
    ],
  });
  assert.equal(d.transactions.length, 2);
  assert.equal(d.transactions[0].future, 'x');
  assert.equal(d.transactions[0].amount, 100);
  assert.deepEqual(d.transactions[1], { id: 'd', deleted: true, updatedAt: 5 });
});

test('normalizeData: удалённая базовая категория не воскресает', () => {
  const d = normalizeData({ categories: [{ id: 'exp-taxi', deleted: true, updatedAt: 10 }] });
  const taxi = d.categories.filter((c) => c.id === 'exp-taxi');
  assert.equal(taxi.length, 1);
  assert.equal(taxi[0].deleted, true);
});

test('summarize: итоги, категории, среднее по прошедшим дням', () => {
  const data = withTx(
    tx('1', 'expense', 1000, '2026-09-01'),
    tx('2', 'expense', 3000, '2026-09-02', 'exp-taxi'),
    tx('3', 'income', 10000, '2026-09-05'),
    tx('4', 'expense', 500, '2026-08-31'),
    tx('5', 'expense', 700, '2026-09-03', 'exp-food', { deleted: true }),
  );
  const s = summarize(data, '2026-09-01', '2026-09-30', '2026-09-10');
  assert.equal(s.expense, 4000);
  assert.equal(s.income, 10000);
  assert.equal(s.balance, 6000);
  assert.equal(s.expenseCount, 2);
  assert.equal(s.elapsed, 10);
  assert.equal(s.avgPerDay, 400);
  assert.equal(s.byCategory.expense[0].categoryId, 'exp-taxi');
  assert.equal(s.byCategory.expense[0].share, 0.75);
  assert.equal(s.topExpenses[0].id, '2');
});

test('elapsedDays: прошлое — целиком, будущее — целиком, текущее — до сегодня', () => {
  assert.equal(elapsedDays('2026-08-01', '2026-08-31', '2026-09-10'), 31);
  assert.equal(elapsedDays('2026-10-01', '2026-10-31', '2026-09-10'), 31);
  assert.equal(elapsedDays('2026-09-01', '2026-09-30', '2026-09-10'), 10);
});

test('comparisonRange: текущий месяц сравниваем с теми же днями прошлого', () => {
  assert.deepEqual(comparisonRange('2026-09', '2026-09-10'), { from: '2026-08-01', to: '2026-08-10', partial: true });
  assert.deepEqual(comparisonRange('2026-03', '2026-03-31'), { from: '2026-02-01', to: '2026-02-28', partial: true });
  assert.deepEqual(comparisonRange('2026-08', '2026-09-10'), { from: '2026-07-01', to: '2026-07-31', partial: false });
});

test('monthlyTotals: последние N месяцев', () => {
  const data = withTx(tx('1', 'expense', 100, '2026-09-01'), tx('2', 'income', 500, '2026-07-15'), tx('3', 'expense', 1, '2026-01-01'));
  const m = monthlyTotals(data, '2026-09', 3);
  assert.deepEqual(
    m.map((x) => [x.key, x.expense, x.income]),
    [
      ['2026-07', 0, 500],
      ['2026-08', 0, 0],
      ['2026-09', 100, 0],
    ],
  );
});

test('groupByDay: свежие дни сверху, итоги по дням', () => {
  const data = withTx(tx('1', 'expense', 100, '2026-09-01'), tx('2', 'expense', 200, '2026-09-02'), tx('3', 'income', 50, '2026-09-02'));
  const days = groupByDay(summarize(data, '2026-09-01', '2026-09-30').transactions);
  assert.equal(days[0].date, '2026-09-02');
  assert.equal(days[0].expense, 200);
  assert.equal(days[0].income, 50);
  assert.equal(days[1].items.length, 1);
});

test('долги: остаток, сводка, просроченные первыми', () => {
  const debts = normalizeData({
    debts: [
      { id: 'a', direction: 'toMe', person: 'Петя', amount: 5000, date: '2026-09-01', payments: [{ id: 'p', amount: 2000, date: '2026-09-05' }] },
      { id: 'b', direction: 'fromMe', person: 'Банк', amount: 3000, date: '2026-09-01', dueDate: '2026-09-05', payments: [] },
      { id: 'c', direction: 'toMe', person: 'Вася', amount: 1000, date: '2026-08-01', payments: [{ id: 'q', amount: 1000, date: '2026-08-10' }] },
    ],
  }).debts;
  assert.equal(debtLeft(debts[0]), 3000);
  const s = debtsSummary(debts, '2026-09-10');
  assert.deepEqual([s.toMe, s.fromMe, s.net, s.overdue, s.open], [3000, 3000, 0, 1, 2]);
  const { open, closed } = sortDebts(debts, '2026-09-10');
  assert.deepEqual(open.map((d) => d.id), ['b', 'a']);
  assert.deepEqual(closed.map((d) => d.id), ['c']);
});

test('mergeData: побеждает свежая правка, удаление не воскресает, флаги изменений', () => {
  const local = withTx(tx('a', 'expense', 100, '2026-09-01', 'exp-food', { updatedAt: 5 }), tx('b', 'expense', 200, '2026-09-01'));
  const remote = normalizeData({
    transactions: [tx('a', 'expense', 999, '2026-09-01', 'exp-food', { updatedAt: 3 }), { id: 'b', deleted: true, updatedAt: 9 }, tx('c', 'income', 50, '2026-09-02')],
  });
  const { data, localChanged, remoteChanged } = mergeData(local, remote);
  const byId = Object.fromEntries(data.transactions.map((t) => [t.id, t]));
  assert.equal(byId.a.amount, 100);
  assert.equal(byId.b.deleted, true);
  assert.equal(byId.c.amount, 50);
  assert.equal(localChanged, true);
  assert.equal(remoteChanged, true);
});

test('mergeData: одинаковые данные — ничего не меняется; нет файла — надо записать', () => {
  const d = withTx(tx('a', 'expense', 100, '2026-09-01'));
  const same = mergeData(d, parseData(serializeData(d)));
  assert.equal(same.localChanged, false);
  assert.equal(same.remoteChanged, false);
  assert.equal(mergeData(d, null).remoteChanged, true);
});

test('mergeData: при равном времени выбор одинаков с обеих сторон', () => {
  const a = withTx(tx('x', 'expense', 100, '2026-09-01'));
  const b = withTx(tx('x', 'expense', 200, '2026-09-01'));
  const ab = mergeData(a, b).data.transactions[0].amount;
  const ba = mergeData(b, a).data.transactions[0].amount;
  assert.equal(ab, ba);
});

test('serializeData ↔ parseData: круговой обмен без потерь', () => {
  const d = withTx(tx('a', 'expense', 100, '2026-09-01', 'exp-food', { note: 'кофе "с собой"' }));
  const text = serializeData(d);
  assert.equal(serializeData(parseData(text)), text);
  assert.match(text, /^\{\n {2}"app": "trecker_rashody"/);
});

test('parseData: понятные ошибки', () => {
  assert.throws(() => parseData('{oops'), /не JSON/);
  assert.throws(() => parseData('{"a":1}'), /не файл трекера/);
  assert.throws(() => parseData('{"version":99,"transactions":[]}'), /новой версии/);
});

test('normalizeRepo', () => {
  assert.equal(normalizeRepo('https://github.com/ilya/data.git'), 'ilya/data');
  assert.equal(normalizeRepo(' ilya/trecker-data/ '), 'ilya/trecker-data');
  assert.equal(normalizeRepo('ilya'), null);
  assert.equal(normalizeRepo('ilya/data/extra'), null);
});

test('presetRange и validateRange', () => {
  assert.deepEqual(presetRange('month', '2026-09-25'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(presetRange('prev', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(presetRange('3m', '2026-09-25'), { from: '2026-07-01', to: '2026-09-25' });
  assert.deepEqual(presetRange('year', '2026-09-25'), { from: '2026-01-01', to: '2026-09-25' });
  assert.equal(validateRange('2026-09-01', '2026-09-30'), null);
  assert.match(validateRange('2026-09-30', '2026-09-01'), /позже/);
  assert.match(validateRange('', '2026-09-01'), /обе даты/);
});

test('buildAIReport: задание, сводка, категории, CSV всех операций, без имён должников', () => {
  const data = normalizeData({
    transactions: [
      tx('1', 'expense', 150000, '2026-09-01', 'exp-food', { note: 'Пятёрочка, большая закупка' }),
      tx('2', 'expense', 45050, '2026-09-03', 'exp-taxi', { note: 'домой | ночью' }),
      tx('3', 'income', 10000000, '2026-09-05', 'inc-salary'),
      tx('4', 'expense', 99900, '2026-10-01'),
    ],
    debts: [{ id: 'd', direction: 'toMe', person: 'Петя Секретный', amount: 5000, date: '2026-09-01', payments: [] }],
  });
  const md = buildAIReport(data, { from: '2026-09-01', to: '2026-09-30', notes: true, income: true, debts: true }, '2026-09-30');
  assert.match(md, /^# Мои финансы за 01\.09\.2026 — 30\.09\.2026/);
  assert.match(md, /## Задание/);
  assert.match(md, /\| Расходы \| 1 950,50 ₽ \(2 операции\) \|/);
  assert.match(md, /\| Доходы \| 100 000 ₽ \(1 операция\) \|/);
  assert.match(md, /🛒 Продукты \| 1 500 \| 76,9 %/);
  assert.match(md, /2026-09-01,расход,Продукты,1500.00,"Пятёрочка, большая закупка"/);
  assert.match(md, /2026-09-05,доход,Зарплата,100000.00/);
  assert.match(md, /домой \/ ночью/); // «|» не ломает таблицу
  assert.doesNotMatch(md, /2026-10-01/);
  assert.doesNotMatch(md, /Петя/);
  assert.match(md, /Мне должны: 50 ₽/);
});

test('buildAIReport: без комментариев и доходов', () => {
  const data = withTx(tx('1', 'expense', 1000, '2026-09-01', 'exp-food', { note: 'секрет' }), tx('2', 'income', 5000, '2026-09-02'));
  const md = buildAIReport(data, { from: '2026-09-01', to: '2026-09-30', notes: false, income: false }, '2026-09-30');
  assert.doesNotMatch(md, /секрет/);
  assert.doesNotMatch(md, /доход,Зарплата/);
  assert.match(md, /date,type,category,amount\n/);
});

test('buildAIReport: длинный период — по месяцам', () => {
  const data = withTx(tx('1', 'expense', 1000, '2026-01-10'), tx('2', 'expense', 2000, '2026-03-10'));
  const md = buildAIReport(data, { from: '2026-01-01', to: '2026-03-31' }, '2026-09-30');
  assert.match(md, /## По месяцам/);
  assert.match(md, /\| Февраль 2026 \| 0 \| 0 \|/);
});

test('buildCSV: Excel-формат, формулы обезврежены', () => {
  const data = withTx(tx('1', 'expense', 123456, '2026-09-01', 'exp-food', { note: '=HYPERLINK("x")' }), tx('2', 'expense', 100, '2026-09-02', 'exp-food', { note: 'a;b' }));
  const csv = buildCSV(data, { from: '2026-09-01', to: '2026-09-30' });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '\ufeffДата;Тип;Категория;Сумма;Комментарий');
  assert.equal(lines[1], `01.09.2026;Расход;Продукты;1234,56;"'=HYPERLINK(""x"")"`);
  assert.equal(lines[2], '02.09.2026;Расход;Продукты;1,00;"a;b"');
});

// ---------- Регулярные платежи ----------

const rule = (extra = {}) => ({ id: 'r1', type: 'expense', amount: 29900, categoryId: 'exp-subs', name: 'Яндекс Плюс', note: '', period: 'monthly', anchor: '2026-07-31', updatedAt: 5, ...extra });

test('расписание: 31-е в коротком месяце — последний день, 29 февраля раз в год', () => {
  assert.equal(occurrenceDate('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(occurrenceDate('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(occurrenceDate('2026-11-15', 'monthly', 3), '2027-02-15');
  assert.equal(occurrenceDate('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.equal(occurrenceDate('2024-02-29', 'yearly', 4), '2028-02-29');
});

test('dueDates и nextDate: от from по сегодня', () => {
  const r = normalizeData({ recurring: [rule()] }).recurring[0];
  assert.equal(r.from, '2026-07-31'); // по умолчанию — с первого платежа
  assert.deepEqual(dueDates(r, '2026-09-25'), ['2026-07-31', '2026-08-31']);
  assert.equal(nextDate(r, '2026-09-25'), '2026-09-30');
  assert.deepEqual(dueDates({ ...r, from: '2026-08-01' }, '2026-09-30'), ['2026-08-31', '2026-09-30']);
  assert.equal(nextDate({ ...r, paused: true }, '2026-09-25'), null);
  assert.deepEqual(dueDates({ ...r, anchor: '2026-10-01', from: '2026-10-01' }, '2026-09-25'), []);
});

test('generateRecurring: догоняет пропущенные, без дублей, удалённые не воскрешает', () => {
  const data = normalizeData({ recurring: [rule()] });
  const first = generateRecurring(data, '2026-09-25');
  assert.deepEqual(first.map((t) => t.id), ['rec:r1:2026-07', 'rec:r1:2026-08']);
  assert.equal(first[0].note, 'Яндекс Плюс');
  assert.equal(first[0].amount, 29900);
  assert.equal(first[0].recurringId, 'r1');
  // Второй прогон ничего не добавляет
  data.transactions.push(...first);
  assert.equal(generateRecurring(data, '2026-09-25').length, 0);
  // Удалённая пользователем операция не создаётся снова
  data.transactions[0] = { id: 'rec:r1:2026-07', deleted: true, updatedAt: 99 };
  assert.equal(generateRecurring(data, '2026-09-25').length, 0);
  // Наступил новый месяц
  assert.deepEqual(generateRecurring(data, '2026-09-30').map((t) => t.date), ['2026-09-30']);
});

test('generateRecurring: два устройства создают одинаковые записи — слияние без конфликтов', () => {
  const a = normalizeData({ recurring: [rule()] });
  const b = normalizeData({ recurring: [rule()] });
  a.transactions.push(...generateRecurring(a, '2026-09-25'));
  b.transactions.push(...generateRecurring(b, '2026-09-25'));
  const res = mergeData(a, b);
  assert.equal(res.localChanged, false);
  assert.equal(res.remoteChanged, false);
  assert.equal(res.data.transactions.length, 2);
});

test('generateRecurring: смена дня платежа не дублирует уже записанный месяц', () => {
  const data = normalizeData({ recurring: [rule({ anchor: '2026-09-05' })] });
  data.transactions.push(...generateRecurring(data, '2026-09-25'));
  data.recurring[0] = { ...data.recurring[0], anchor: '2026-09-20', from: '2026-09-20' };
  assert.equal(generateRecurring(data, '2026-09-25').length, 0);
});

test('generateRecurring: на паузе и удалённые правила молчат', () => {
  const data = normalizeData({ recurring: [rule({ paused: true }), { id: 'r2', deleted: true, updatedAt: 3 }] });
  assert.equal(generateRecurring(data, '2026-09-25').length, 0);
});

test('regular: подписи, сводка в месяц, валидация', () => {
  assert.equal(periodLabel({ anchor: '2026-09-05', period: 'monthly' }), 'каждый месяц, 5-го');
  assert.equal(periodLabel({ anchor: '2026-01-31', period: 'monthly' }), 'каждый месяц, 31-го (или в последний день)');
  assert.equal(periodLabel({ anchor: '2026-03-12', period: 'yearly' }), 'каждый год, 12 марта');
  const sum = recurringSummary(normalizeData({ recurring: [rule(), rule({ id: 'r2', amount: 120000, period: 'yearly' }), rule({ id: 'r3', paused: true }), rule({ id: 'r4', type: 'income', amount: 5000000, categoryId: 'inc-salary' })] }).recurring);
  assert.deepEqual(sum, { expense: 29900 + 10000, income: 5000000, active: 3 });
  const ok = { type: 'expense', amount: 100, categoryId: 'exp-subs', name: 'Кино', period: 'monthly', anchor: '2026-09-01' };
  assert.equal(validateRecurring(ok), null);
  assert.match(validateRecurring({ ...ok, name: ' ' }), /назвать/);
  assert.match(validateRecurring({ ...ok, period: 'weekly' }), /как часто/);
});

test('normalizeData: мусорные правила и кнопки отбрасываются, суммы кнопок без дублей', () => {
  const d = normalizeData({
    recurring: [rule({ id: 'bad', period: 'daily' }), rule({ id: 'ok' })],
    presets: [
      { id: 'p1', type: 'expense', label: 'Стики', emoji: '🚬', categoryId: 'exp-other', amounts: [23000, 23000, -5, 'x'] },
      { id: 'p2', type: 'expense', label: 'Пусто', emoji: '⚡', categoryId: 'exp-other', amounts: [] },
    ],
  });
  assert.deepEqual(d.recurring.map((r) => r.id), ['ok']);
  assert.deepEqual(d.presets.map((p) => [p.id, p.amounts]), [['p1', [23000]]]);
});

test('быстрые кнопки: сортировка и валидация', () => {
  const list = normalizeData({
    presets: [
      { id: 'b', type: 'expense', label: 'Тройка', emoji: '🚇', categoryId: 'exp-transport', amounts: [20000], order: 2 },
      { id: 'a', type: 'expense', label: 'Кофе', emoji: '☕', categoryId: 'exp-cafe', amounts: [25000], order: 1 },
    ],
  }).presets;
  assert.deepEqual(sortPresets(list).map((p) => p.id), ['a', 'b']);
  const ok = { label: 'Кофе', emoji: '☕', categoryId: 'exp-cafe', amounts: [25000] };
  assert.equal(validatePreset(ok), null);
  assert.match(validatePreset({ ...ok, amounts: [] }), /сумму/);
  assert.match(validatePreset({ ...ok, label: '' }), /подписать/);
});

test('ключ подключения: туда-обратно и защита от мусора', () => {
  const key = makeSyncKey({ repo: 'ilya/trecker-data', token: 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  assert.deepEqual(parseSyncKey(`  ${key}\n`), { repo: 'ilya/trecker-data', token: 'github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
  assert.equal(parseSyncKey('https://example.com'), null);
  assert.equal(parseSyncKey('trecker1|ilya|github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ'), null);
  assert.equal(parseSyncKey('trecker1|ilya/data|short'), null);
  assert.equal(parseSyncKey(`${key}|extra`), null);
});

test('buildAIReport: раздел регулярных платежей', () => {
  const data = normalizeData({ recurring: [rule(), rule({ id: 'r2', name: 'Аренда', amount: 4500000, categoryId: 'exp-home', period: 'monthly', anchor: '2026-09-01' }), rule({ id: 'r3', name: 'Пауза', paused: true })] });
  data.transactions.push(...generateRecurring(data, '2026-09-25'));
  const md = buildAIReport(data, { from: '2026-09-01', to: '2026-09-30' }, '2026-09-25');
  assert.match(md, /## Регулярные платежи/);
  assert.match(md, /В месяц: расходы 45 299 ₽/);
  assert.match(md, /\| Аренда \| 🏠 Дом и ЖКХ \| расход \| 45 000 \| раз в месяц \| 45 000 \|/);
  assert.doesNotMatch(md, /Пауза/);
});
