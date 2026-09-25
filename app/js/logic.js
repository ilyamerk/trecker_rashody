// Чистая логика без DOM и хранилища — её покрывают тесты (npm test).
// Деньги — целые копейки, даты — строки 'YYYY-MM-DD' (локальный день),
// месяцы — 'YYYY-MM'.

export const DATA_VERSION = 1;
export const COLLECTIONS = ['transactions', 'categories', 'debts', 'recurring', 'presets'];
export const TYPES = ['expense', 'income'];
export const DEBT_DIRECTIONS = ['toMe', 'fromMe']; // toMe — мне должны, fromMe — я должен
export const PERIODS = ['monthly', 'yearly'];
export const MAX_PRESET_AMOUNTS = 8;

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

// ---------- Даты ----------

export const pad2 = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayISO = (now = new Date()) => toISODate(now);
export const monthKey = (iso) => iso.slice(0, 7);

// Арифметика дат в UTC, чтобы переход на летнее время не съедал дни
const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUTC = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(utc(s)) === s;
}

export function addDays(iso, n) {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

export const daysInclusive = (from, to) => Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
export const weekday = (iso) => (utc(iso).getUTCDay() + 6) % 7; // 0 — понедельник
export const weekStart = (iso) => addDays(iso, -weekday(iso));

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${pad2(last)}` };
}

export function monthTitle(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export const formatDate = (iso) => iso.split('-').reverse().join('.');

export function shortDate(iso, today) {
  const [y, m, d] = iso.split('-').map(Number);
  const year = today && monthKey(today).slice(0, 4) !== String(y) ? ` ${y}` : '';
  return `${d} ${MONTHS_GEN[m - 1]}${year}`;
}

export function dayTitle(iso, today) {
  if (iso === today) return 'Сегодня';
  if (iso === addDays(today, -1)) return 'Вчера';
  return `${shortDate(iso, today)}, ${WEEKDAYS_SHORT[weekday(iso)]}`;
}

// ---------- Деньги ----------

export const MAX_AMOUNT = 100_000_000_000; // копейки = 1 млрд ₽

// '1 234,56 ₽' → 123456. Мусор, ноль, минус и больше двух знаков после запятой → null
export function parseAmount(input) {
  const s = String(input ?? '').replace(/[\s\u00a0\u202f₽]/g, '').replace(',', '.');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
  const [rub, kop = ''] = s.split('.');
  const value = Number(rub || 0) * 100 + Number(`${kop}00`.slice(0, 2));
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT ? value : null;
}

export const amountToInput = (kop) => (kop % 100 ? (kop / 100).toFixed(2).replace('.', ',') : String(kop / 100));

// 123456 → '1 234,56 ₽' (неразрывные пробелы); копейки показываем, только если они есть
export function formatMoney(kop, { sign = false, currency = true, sep = '\u00a0', minus = '−' } = {}) {
  const abs = Math.abs(Math.round(kop));
  const rub = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const cents = abs % 100 ? `,${pad2(abs % 100)}` : '';
  const prefix = kop < 0 ? minus : sign && kop > 0 ? '+' : '';
  return `${prefix}${rub}${cents}${currency ? `${sep}₽` : ''}`;
}

// Для файлов: обычные пробелы и обычный минус — так проще и людям, и нейросетям
const money = (kop) => formatMoney(kop, { currency: false, sep: ' ', minus: '-' });

export function formatPercent(fraction, digits = 0) {
  const v = (fraction * 100).toFixed(digits).replace('.', ',');
  return `${v}\u00a0%`;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// ---------- ID ----------

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Категории ----------

const DEFAULTS = [
  ['exp-food', 'expense', 'Продукты', '🛒'],
  ['exp-cafe', 'expense', 'Кафе и доставка', '🍔'],
  ['exp-transport', 'expense', 'Транспорт', '🚇'],
  ['exp-taxi', 'expense', 'Такси', '🚕'],
  ['exp-home', 'expense', 'Дом и ЖКХ', '🏠'],
  ['exp-phone', 'expense', 'Связь и интернет', '📱'],
  ['exp-subs', 'expense', 'Подписки', '📺'],
  ['exp-health', 'expense', 'Здоровье', '💊'],
  ['exp-clothes', 'expense', 'Одежда и обувь', '👕'],
  ['exp-fun', 'expense', 'Развлечения', '🎉'],
  ['exp-beauty', 'expense', 'Красота и уход', '💅'],
  ['exp-gifts', 'expense', 'Подарки', '🎁'],
  ['exp-edu', 'expense', 'Обучение', '📚'],
  ['exp-travel', 'expense', 'Путешествия', '✈️'],
  ['exp-other', 'expense', 'Прочее', '📦'],
  ['inc-salary', 'income', 'Зарплата', '💼'],
  ['inc-side', 'income', 'Подработка', '🧑‍💻'],
  ['inc-cashback', 'income', 'Кэшбэк и проценты', '💳'],
  ['inc-gifts', 'income', 'Подарки', '🎁'],
  ['inc-other', 'income', 'Прочее', '💰'],
];

// updatedAt: 0 — любая правка пользователя на любом устройстве окажется новее
export const defaultCategories = () =>
  DEFAULTS.map(([id, type, name, emoji], order) => ({ id, type, name, emoji, order, archived: false, updatedAt: 0 }));

export const live = (list) => list.filter((r) => !r.deleted);

export function categoryMap(categories) {
  return new Map(live(categories).map((c) => [c.id, c]));
}

export const categoryLabel = (cat) => (cat ? `${cat.emoji} ${cat.name}` : '❓ Без категории');

export function activeCategories(categories, type) {
  return live(categories)
    .filter((c) => c.type === type && !c.archived)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
}

export function validateCategory({ name, emoji }) {
  if (!String(name ?? '').trim()) return 'Введи название категории';
  if (String(name).trim().length > 40) return 'Название длиннее 40 символов';
  if (!String(emoji ?? '').trim()) return 'Выбери эмодзи';
  return null;
}

// ---------- Нормализация данных ----------

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const kopecks = (v) => {
  const n = Math.round(Number(v));
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT ? n : null;
};

// Неизвестные поля сохраняем (...r), чтобы старая версия приложения не стирала
// то, что записала новая
function fixTransaction(r) {
  const amount = kopecks(r.amount);
  if (!TYPES.includes(r.type) || !isISODate(r.date) || !amount) return null;
  return { ...r, type: r.type, amount, categoryId: str(r.categoryId, 100), date: r.date, note: str(r.note), createdAt: num(r.createdAt), updatedAt: num(r.updatedAt) };
}

function fixCategory(r) {
  if (!TYPES.includes(r.type)) return null;
  return {
    ...r,
    type: r.type,
    name: str(r.name, 40) || 'Без названия',
    emoji: str(r.emoji, 16) || '🏷️',
    order: num(r.order),
    archived: Boolean(r.archived),
    updatedAt: num(r.updatedAt),
  };
}

function fixDebt(r) {
  const amount = kopecks(r.amount);
  if (!DEBT_DIRECTIONS.includes(r.direction) || !amount || !isISODate(r.date)) return null;
  const payments = (Array.isArray(r.payments) ? r.payments : [])
    .filter((p) => p && typeof p.id === 'string' && kopecks(p.amount) && isISODate(p.date))
    .map((p) => ({ id: p.id, amount: kopecks(p.amount), date: p.date, note: str(p.note) }));
  return {
    ...r,
    direction: r.direction,
    person: str(r.person, 80) || 'Без имени',
    amount,
    date: r.date,
    dueDate: isISODate(r.dueDate) ? r.dueDate : null,
    note: str(r.note),
    payments,
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  };
}

function fixRecurring(r) {
  const amount = kopecks(r.amount);
  if (!TYPES.includes(r.type) || !amount || !PERIODS.includes(r.period) || !isISODate(r.anchor)) return null;
  return {
    ...r,
    type: r.type,
    amount,
    categoryId: str(r.categoryId, 100),
    name: str(r.name, 60) || 'Платёж',
    note: str(r.note),
    period: r.period,
    anchor: r.anchor, // дата первого платежа — от неё считается расписание
    from: isISODate(r.from) ? r.from : r.anchor, // раньше этой даты операции не создаются
    paused: Boolean(r.paused),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  };
}

function fixPreset(r) {
  const amounts = [...new Set((Array.isArray(r.amounts) ? r.amounts : []).map(kopecks).filter(Boolean))].slice(0, MAX_PRESET_AMOUNTS);
  if (!TYPES.includes(r.type) || !amounts.length) return null;
  return {
    ...r,
    type: r.type,
    label: str(r.label, 30) || 'Кнопка',
    emoji: str(r.emoji, 16) || '⚡',
    categoryId: str(r.categoryId, 100),
    amounts,
    note: str(r.note),
    order: num(r.order),
    updatedAt: num(r.updatedAt),
  };
}

const FIXERS = { transactions: fixTransaction, categories: fixCategory, debts: fixDebt, recurring: fixRecurring, presets: fixPreset };

export function normalizeData(raw = {}) {
  const data = { version: DATA_VERSION };
  for (const name of COLLECTIONS) {
    const seen = new Set();
    data[name] = [];
    for (const r of Array.isArray(raw?.[name]) ? raw[name] : []) {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
      const fixed = r.deleted ? { id: r.id, deleted: true, updatedAt: num(r.updatedAt) } : FIXERS[name](r);
      if (fixed) {
        seen.add(r.id);
        data[name].push(fixed);
      }
    }
  }
  // Базовые категории есть всегда; удалённая пользователем лежит «надгробием» и не вернётся
  const have = new Set(data.categories.map((c) => c.id));
  for (const c of defaultCategories()) if (!have.has(c.id)) data.categories.push(c);
  return data;
}

export const emptyData = () => normalizeData({});

// ---------- Операции ----------

export function validateTransaction({ type, amount, categoryId, date }) {
  if (!TYPES.includes(type)) return 'Выбери: расход или доход';
  if (!kopecks(amount)) return 'Введи сумму больше нуля';
  if (!categoryId) return 'Выбери категорию';
  if (!isISODate(date)) return 'Проверь дату';
  return null;
}

export function transactionsInRange(data, from, to, type = null) {
  return live(data.transactions)
    .filter((t) => t.date >= from && t.date <= to && (!type || t.type === type))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

// Группы по дням для списка: [{ date, items, income, expense }]
export function groupByDay(txs) {
  const days = new Map();
  for (const t of txs) {
    const g = days.get(t.date) ?? { date: t.date, items: [], income: 0, expense: 0 };
    g.items.push(t);
    g[t.type] += t.amount;
    days.set(t.date, g);
  }
  return [...days.values()];
}

// ---------- Сводка ----------

// Сколько дней делить для «в среднем в день»: в текущем периоде — только прошедшие
export function elapsedDays(from, to, today) {
  if (today < from) return daysInclusive(from, to);
  return daysInclusive(from, today < to ? today : to);
}

export function summarize(data, from, to, today = to) {
  const cats = categoryMap(data.categories);
  const txs = transactionsInRange(data, from, to);
  const res = { from, to, days: daysInclusive(from, to), elapsed: elapsedDays(from, to, today), income: 0, expense: 0, incomeCount: 0, expenseCount: 0, transactions: txs };
  const groups = { expense: new Map(), income: new Map() };
  const byDay = new Map();
  for (const t of txs) {
    res[t.type] += t.amount;
    res[`${t.type}Count`] += 1;
    const g = groups[t.type].get(t.categoryId) ?? { categoryId: t.categoryId, category: cats.get(t.categoryId) ?? null, total: 0, count: 0 };
    g.total += t.amount;
    g.count += 1;
    groups[t.type].set(t.categoryId, g);
    const d = byDay.get(t.date) ?? { income: 0, expense: 0 };
    d[t.type] += t.amount;
    byDay.set(t.date, d);
  }
  res.balance = res.income - res.expense;
  res.avgPerDay = Math.round(res.expense / res.elapsed);
  res.byCategory = {};
  for (const type of TYPES) {
    res.byCategory[type] = [...groups[type].values()]
      .sort((a, b) => b.total - a.total)
      .map((g) => ({ ...g, share: res[type] ? g.total / res[type] : 0 }));
  }
  res.byDay = byDay;
  res.topExpenses = txs.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date)).slice(0, 10);
  return res;
}

// С чем сравнивать месяц: текущий — с теми же днями прошлого, прошедший — целиком
export function comparisonRange(key, today) {
  const prev = monthRange(shiftMonth(key, -1));
  const { from } = monthRange(key);
  if (monthKey(today) !== key) return { ...prev, partial: false };
  const span = daysInclusive(from, today);
  const to = addDays(prev.from, span - 1);
  return { from: prev.from, to: to < prev.to ? to : prev.to, partial: true };
}

export const percentChange = (cur, prev) => (prev > 0 ? (cur - prev) / prev : null);

export function monthlyTotals(data, endKey, count = 6) {
  const keys = Array.from({ length: count }, (_, i) => shiftMonth(endKey, i - count + 1));
  const totals = new Map(keys.map((k) => [k, { key: k, income: 0, expense: 0 }]));
  for (const t of live(data.transactions)) {
    const m = totals.get(monthKey(t.date));
    if (m) m[t.type] += t.amount;
  }
  return [...totals.values()];
}

// ---------- Долги ----------

export const debtPaid = (d) => d.payments.reduce((s, p) => s + p.amount, 0);
export const debtLeft = (d) => Math.max(0, d.amount - debtPaid(d));
export const isDebtClosed = (d) => debtLeft(d) === 0;
export const isDebtOverdue = (d, today) => !isDebtClosed(d) && Boolean(d.dueDate) && d.dueDate < today;

export function validateDebt({ direction, person, amount, date, dueDate }) {
  if (!DEBT_DIRECTIONS.includes(direction)) return 'Выбери, кто кому должен';
  if (!String(person ?? '').trim()) return 'Кто? Введи имя';
  if (!kopecks(amount)) return 'Введи сумму больше нуля';
  if (!isISODate(date)) return 'Проверь дату';
  if (dueDate && (!isISODate(dueDate) || dueDate < date)) return 'Срок возврата раньше даты долга';
  return null;
}

export function debtsSummary(debts, today) {
  const res = { toMe: 0, fromMe: 0, overdue: 0, open: 0 };
  for (const d of live(debts)) {
    if (isDebtClosed(d)) continue;
    res[d.direction] += debtLeft(d);
    res.open += 1;
    if (isDebtOverdue(d, today)) res.overdue += 1;
  }
  res.net = res.toMe - res.fromMe;
  return res;
}

// Открытые: просроченные сверху, дальше по сроку (без срока — в конце); закрытые — свежие сверху
export function sortDebts(debts, today) {
  const all = live(debts);
  const open = all
    .filter((d) => !isDebtClosed(d))
    .sort(
      (a, b) =>
        isDebtOverdue(b, today) - isDebtOverdue(a, today) ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        b.date.localeCompare(a.date),
    );
  const lastPayment = (d) => d.payments.reduce((m, p) => (p.date > m ? p.date : m), d.date);
  const closed = all.filter(isDebtClosed).sort((a, b) => lastPayment(b).localeCompare(lastPayment(a)));
  return { open, closed };
}

// ---------- Регулярные платежи ----------
// Операции создаются сами, когда приложение открыто; пропущенные дни догоняются.
// Id операции — функция правила и периода (месяца или года), и сама запись тоже:
// два устройства создадут одно и то же, а удалённая операция не появится снова.

// k-й платёж по расписанию; 31-е в коротком месяце → последний день месяца
export function occurrenceDate(anchor, period, k) {
  const [y, m, d] = anchor.split('-').map(Number);
  const idx = period === 'yearly' ? (y + k) * 12 + (m - 1) : y * 12 + (m - 1) + k;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${pad2(mm)}-${pad2(Math.min(d, last))}`;
}

export const periodKey = (date, period) => (period === 'yearly' ? date.slice(0, 4) : date.slice(0, 7));
export const recurringTxId = (rule, date) => `rec:${rule.id}:${periodKey(date, rule.period)}`;

// Даты платежей от rule.from по today включительно
export function dueDates(rule, today, limit = 1200) {
  const out = [];
  for (let k = 0; k < limit; k++) {
    const date = occurrenceDate(rule.anchor, rule.period, k);
    if (date > today) break;
    if (date >= rule.from) out.push(date);
  }
  return out;
}

export function nextDate(rule, today, limit = 1200) {
  if (rule.paused) return null;
  for (let k = 0; k < limit; k++) {
    const date = occurrenceDate(rule.anchor, rule.period, k);
    if (date > today && date >= rule.from) return date;
  }
  return null;
}

export function generateRecurring(data, today) {
  const existing = new Set(data.transactions.map((t) => t.id));
  const out = [];
  for (const rule of live(data.recurring)) {
    if (rule.paused) continue;
    for (const date of dueDates(rule, today)) {
      const id = recurringTxId(rule, date);
      if (existing.has(id)) continue; // уже есть или удалена пользователем («надгробие»)
      existing.add(id);
      out.push({
        id,
        type: rule.type,
        amount: rule.amount,
        categoryId: rule.categoryId,
        date,
        note: rule.note ? `${rule.name} · ${rule.note}` : rule.name,
        recurringId: rule.id,
        // Одинаковые на всех устройствах; любая правка пользователя окажется новее
        createdAt: 0,
        updatedAt: 1,
      });
    }
  }
  return out;
}

export const monthlyAmount = (rule) => (rule.period === 'yearly' ? Math.round(rule.amount / 12) : rule.amount);

export function periodLabel(rule) {
  const [, m, d] = rule.anchor.split('-').map(Number);
  if (rule.period === 'yearly') return `каждый год, ${d} ${MONTHS_GEN[m - 1]}`;
  return d >= 29 ? `каждый месяц, ${d}-го (или в последний день)` : `каждый месяц, ${d}-го`;
}

export function recurringSummary(recurring) {
  const res = { expense: 0, income: 0, active: 0 };
  for (const r of live(recurring)) {
    if (r.paused) continue;
    res[r.type] += monthlyAmount(r);
    res.active += 1;
  }
  return res;
}

export function sortRecurring(recurring, today) {
  return live(recurring).sort((a, b) => a.paused - b.paused || (nextDate(a, today) ?? '9999').localeCompare(nextDate(b, today) ?? '9999') || a.name.localeCompare(b.name, 'ru'));
}

export function validateRecurring({ type, amount, categoryId, name, period, anchor }) {
  if (!TYPES.includes(type)) return 'Выбери: расход или доход';
  if (!String(name ?? '').trim()) return 'Как назвать платёж? Например: Яндекс Плюс';
  if (!kopecks(amount)) return 'Введи сумму больше нуля';
  if (!categoryId) return 'Выбери категорию';
  if (!PERIODS.includes(period)) return 'Выбери, как часто';
  if (!isISODate(anchor)) return 'Укажи дату платежа';
  return null;
}

// ---------- Быстрые кнопки ----------

export const sortPresets = (presets) => live(presets).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'));

export function validatePreset({ label, emoji, categoryId, amounts }) {
  if (!String(label ?? '').trim()) return 'Как подписать кнопку? Например: Кофе';
  if (!String(emoji ?? '').trim()) return 'Выбери эмодзи';
  if (!categoryId) return 'Выбери категорию';
  if (!Array.isArray(amounts) || !amounts.length) return 'Добавь хотя бы одну сумму';
  if (amounts.length > MAX_PRESET_AMOUNTS) return `Не больше ${MAX_PRESET_AMOUNTS} сумм`;
  return null;
}

// ---------- Синхронизация: слияние версий ----------

export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// Побеждает более свежая правка; при равном времени — детерминированно,
// чтобы все устройства выбрали одно и то же
export function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

const same = (a, b) => a === b || (a && b && stableStringify(a) === stableStringify(b));

// → { data, localChanged, remoteChanged }. remote = null — файла ещё нет
export function mergeData(local, remote) {
  const data = { version: DATA_VERSION };
  let localChanged = false;
  let remoteChanged = !remote;
  for (const name of COLLECTIONS) {
    const mine = new Map(local[name].map((r) => [r.id, r]));
    const theirs = new Map((remote?.[name] ?? []).map((r) => [r.id, r]));
    data[name] = [];
    for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
      const l = mine.get(id);
      const r = theirs.get(id);
      const win = newer(l, r);
      data[name].push(win);
      if (!same(win, l)) localChanged = true;
      if (!same(win, r)) remoteChanged = true;
    }
  }
  return { data, localChanged, remoteChanged };
}

// Файл в репозитории: по записи на строку — диффы в истории GitHub читаются глазами
export function serializeData(data) {
  const sortKey = (r) => `${r.date ?? ''}|${r.id}`;
  const parts = COLLECTIONS.map((name) => {
    const rows = [...data[name]].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)).map((r) => `    ${stableStringify(r)}`);
    return `  "${name}": [${rows.length ? `\n${rows.join(',\n')}\n  ` : ''}]`;
  });
  return `{\n  "app": "trecker_rashody",\n  "version": ${DATA_VERSION},\n${parts.join(',\n')}\n}\n`;
}

export function parseData(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Файл повреждён: это не JSON');
  }
  if (!raw || typeof raw !== 'object' || !COLLECTIONS.some((n) => Array.isArray(raw[n]))) {
    throw new Error('Это не файл трекера расходов');
  }
  if (num(raw.version) > DATA_VERSION) throw new Error('Файл от более новой версии приложения — обнови приложение');
  return normalizeData(raw);
}

export const isRepo = (s) => typeof s === 'string' && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(s);
export const isToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_]{20,255}$/.test(s);

// Ключ подключения второго устройства (он же — содержимое QR-кода)
const KEY_PREFIX = 'trecker1';
export const makeSyncKey = ({ repo, token }) => `${KEY_PREFIX}|${repo}|${token}`;

export function parseSyncKey(text) {
  const [prefix, repo, token, ...rest] = String(text ?? '').trim().split('|');
  if (prefix !== KEY_PREFIX || rest.length || !isRepo(repo) || !isToken(token)) return null;
  return { repo, token };
}

// 'https://github.com/user/repo.git' → 'user/repo'
export function normalizeRepo(input) {
  const s = String(input ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return isRepo(s) ? s : null;
}

// ---------- Выгрузка ----------

export const EXPORT_PRESETS = [
  { id: 'month', label: 'Этот месяц' },
  { id: 'prev', label: 'Прошлый месяц' },
  { id: '3m', label: '3 месяца' },
  { id: 'year', label: 'С начала года' },
];

export function presetRange(id, today) {
  const key = monthKey(today);
  if (id === 'prev') return monthRange(shiftMonth(key, -1));
  if (id === '3m') return { from: monthRange(shiftMonth(key, -2)).from, to: today };
  if (id === 'year') return { from: `${key.slice(0, 4)}-01-01`, to: today };
  return monthRange(key);
}

export function validateRange(from, to) {
  if (!isISODate(from) || !isISODate(to)) return 'Укажи обе даты';
  if (from > to) return 'Дата «с» позже даты «по»';
  if (daysInclusive(from, to) > 3700) return 'Период больше 10 лет — сократи его';
  return null;
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const mdCell = (s) => oneLine(s).replace(/\|/g, '/');

function csvCell(value, sep) {
  const s = String(value ?? '');
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const plainAmount = (kop) => (kop / 100).toFixed(2);

export function exportFileName(kind, from, to) {
  const ext = kind === 'ai' ? 'md' : kind === 'csv' ? 'csv' : 'json';
  const suffix = kind === 'ai' ? '_dlya-ii' : '';
  return `rashody_${from}_${to}${suffix}.${ext}`;
}

export const AI_PROMPT = `Ты — внимательный финансовый аналитик. Ниже выгрузка моих личных расходов и доходов из трекера. Разбери её и ответь по-русски, конкретно и без морализаторства:
1. Куда уходит больше всего денег: главные категории, их доли и конкретные крупные траты.
2. Повторяющиеся траты (подписки, частые мелкие покупки, такси, доставка): сколько они стоят за период и в пересчёте на месяц.
3. Всплески и необычные траты: дни, недели, дни недели, где тратится заметно больше обычного.
4. Где реально сэкономить: 3–5 конкретных шагов, у каждого — оценка экономии в рублях в месяц.
5. Если есть доходы — какая доля уходит на расходы и сколько остаётся.
Опирайся только на эти данные. Если для вывода чего-то не хватает — так и скажи, а не додумывай.`;

function table(head, rows, align) {
  const sepRow = align.map((a) => (a === 'r' ? '---:' : '---'));
  return [head, sepRow, ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
}

// Markdown-файл для любой нейросети: задание + сводка + все операции в CSV
export function buildAIReport(data, { from, to, notes = true, income = true, debts = false }, today) {
  const s = summarize(data, from, to, today);
  const cats = categoryMap(data.categories);
  const out = [];
  const expenses = s.transactions.filter((t) => t.type === 'expense');

  out.push(`# Мои финансы за ${formatDate(from)} — ${formatDate(to)}`, '');
  out.push('Выгрузка из личного трекера расходов. Все суммы в рублях. Долги в расходы и доходы не входят.', '');
  out.push('## Задание', '', AI_PROMPT, '');

  out.push('## Сводка', '');
  const rows = [['Период', `${formatDate(from)} — ${formatDate(to)} (${s.days} ${plural(s.days, ['день', 'дня', 'дней'])})`]];
  if (s.elapsed !== s.days) rows.push(['Прошло дней периода', String(s.elapsed)]);
  rows.push(['Расходы', `${money(s.expense)} ₽ (${s.expenseCount} ${plural(s.expenseCount, ['операция', 'операции', 'операций'])})`]);
  if (income) {
    rows.push(['Доходы', `${money(s.income)} ₽ (${s.incomeCount} ${plural(s.incomeCount, ['операция', 'операции', 'операций'])})`]);
    rows.push(['Доходы минус расходы', `${s.balance > 0 ? '+' : ''}${money(s.balance)} ₽`]);
    if (s.income > 0) rows.push(['Доля дохода, ушедшая на расходы', formatPercent(s.expense / s.income, 1).replace('\u00a0', ' ')]);
  }
  rows.push(['Средний расход в день', `${money(s.avgPerDay)} ₽`]);
  if (s.expenseCount) rows.push(['Средняя трата', `${money(Math.round(s.expense / s.expenseCount))} ₽`]);
  out.push(table(['Показатель', 'Значение'], rows, ['l', 'l']), '');

  const catTable = (type) =>
    table(
      ['Категория', 'Сумма, ₽', 'Доля', 'Операций', 'Средний чек, ₽'],
      s.byCategory[type].map((g) => [mdCell(categoryLabel(g.category)), money(g.total), formatPercent(g.share, 1).replace('\u00a0', ' '), String(g.count), money(Math.round(g.total / g.count))]),
      ['l', 'r', 'r', 'r', 'r'],
    );

  out.push('## Расходы по категориям', '', expenses.length ? catTable('expense') : 'Расходов за период нет.', '');
  if (income && s.incomeCount) out.push('## Доходы по категориям', '', catTable('income'), '');

  if (expenses.length) {
    // Будущие дни текущего месяца не считаем — они занизили бы средние
    const end = addDays(from, s.elapsed - 1);
    // Динамика: до двух месяцев — по неделям, дольше — по месяцам
    if (s.days <= 62) {
      const weeks = new Map();
      for (const t of expenses) {
        const w = weekStart(t.date);
        weeks.set(w, (weeks.get(w) ?? 0) + t.amount);
      }
      const wRows = [];
      for (let w = weekStart(from); w <= end; w = addDays(w, 7)) {
        const a = w < from ? from : w;
        const b = addDays(w, 6) > end ? end : addDays(w, 6);
        wRows.push([`${formatDate(a).slice(0, 5)}–${formatDate(b).slice(0, 5)}`, money(weeks.get(w) ?? 0)]);
      }
      out.push('## Расходы по неделям', '', table(['Неделя', 'Расходы, ₽'], wRows, ['l', 'r']), '');
    } else {
      const months = new Map();
      for (const t of s.transactions) {
        const m = months.get(monthKey(t.date)) ?? { income: 0, expense: 0 };
        m[t.type] += t.amount;
        months.set(monthKey(t.date), m);
      }
      const mRows = [];
      for (let k = monthKey(from); k <= monthKey(to); k = shiftMonth(k, 1)) {
        const m = months.get(k) ?? { income: 0, expense: 0 };
        mRows.push(income ? [monthTitle(k), money(m.expense), money(m.income)] : [monthTitle(k), money(m.expense)]);
      }
      out.push('## По месяцам', '', table(income ? ['Месяц', 'Расходы, ₽', 'Доходы, ₽'] : ['Месяц', 'Расходы, ₽'], mRows, income ? ['l', 'r', 'r'] : ['l', 'r']), '');
    }

    const byWd = Array.from({ length: 7 }, () => 0);
    const wdCount = Array.from({ length: 7 }, () => 0);
    for (const t of expenses) byWd[weekday(t.date)] += t.amount;
    for (let d = from; d <= end; d = addDays(d, 1)) wdCount[weekday(d)] += 1;
    out.push(
      '## Расходы по дням недели',
      '',
      table(['День', 'Всего, ₽', 'В среднем за такой день, ₽'], WEEKDAYS.map((name, i) => [name, money(byWd[i]), money(wdCount[i] ? Math.round(byWd[i] / wdCount[i]) : 0)]), ['l', 'r', 'r']),
      '',
    );

    const topHead = notes ? ['Дата', 'Категория', 'Сумма, ₽', 'Комментарий'] : ['Дата', 'Категория', 'Сумма, ₽'];
    const topRows = s.topExpenses.map((t) => {
      const row = [formatDate(t.date), mdCell(categoryLabel(cats.get(t.categoryId))), money(t.amount)];
      if (notes) row.push(mdCell(t.note) || '—');
      return row;
    });
    out.push(`## Самые крупные траты (топ-${s.topExpenses.length})`, '', table(topHead, topRows, notes ? ['l', 'l', 'r', 'l'] : ['l', 'l', 'r']), '');
  }

  const rules = live(data.recurring).filter((r) => !r.paused && (income || r.type === 'expense'));
  if (rules.length) {
    const sum = recurringSummary(rules);
    out.push('## Регулярные платежи (подписки, аренда, зарплата и т.п.)', '');
    out.push(`Действуют сейчас. В месяц: расходы ${money(sum.expense)} ₽${income ? `, доходы ${money(sum.income)} ₽` : ''}. Их операции уже есть в списке ниже.`, '');
    out.push(
      table(
        ['Название', 'Категория', 'Тип', 'Сумма, ₽', 'Как часто', 'В пересчёте на месяц, ₽'],
        rules
          .sort((a, b) => monthlyAmount(b) - monthlyAmount(a))
          .map((r) => [mdCell(r.name), mdCell(categoryLabel(cats.get(r.categoryId))), r.type === 'expense' ? 'расход' : 'доход', money(r.amount), r.period === 'yearly' ? 'раз в год' : 'раз в месяц', money(monthlyAmount(r))]),
        ['l', 'l', 'l', 'r', 'l', 'r'],
      ),
      '',
    );
  }

  const list = s.transactions.filter((t) => income || t.type === 'expense').sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  out.push('## Все операции', '');
  out.push(`Колонки: date — дата, type — расход или доход, category — категория, amount — сумма в рублях (дробная часть через точку)${notes ? ', note — комментарий' : ''}.`, '');
  out.push('```csv');
  out.push(notes ? 'date,type,category,amount,note' : 'date,type,category,amount');
  for (const t of list) {
    const cat = cats.get(t.categoryId);
    const row = [t.date, t.type === 'expense' ? 'расход' : 'доход', cat ? cat.name : 'Без категории', plainAmount(t.amount)];
    if (notes) row.push(oneLine(t.note));
    out.push(row.map((v) => csvCell(v, ',')).join(','));
  }
  out.push('```', '');

  if (debts) {
    const { open } = sortDebts(data.debts, today);
    const sum = debtsSummary(data.debts, today);
    out.push('## Долги (открытые на сегодня)', '');
    out.push(`Мне должны: ${money(sum.toMe)} ₽. Я должен: ${money(sum.fromMe)} ₽.`, '');
    if (open.length) {
      out.push(
        table(
          ['Кто кому', 'Сумма, ₽', 'Осталось, ₽', 'С', 'Срок'],
          open.map((d, i) => [d.direction === 'toMe' ? `Мне должен человек ${i + 1}` : `Я должен человеку ${i + 1}`, money(d.amount), money(debtLeft(d)), formatDate(d.date), d.dueDate ? formatDate(d.dueDate) : '—']),
          ['l', 'r', 'r', 'l', 'l'],
        ),
        '',
      );
    }
  }

  out.push(`_Выгружено ${formatDate(today)}._`, '');
  return out.join('\n');
}

// CSV для Excel/Numbers в русской локали: разделитель «;», запятая в дробях, BOM для кириллицы
export function buildCSV(data, { from, to, notes = true, income = true }) {
  const cats = categoryMap(data.categories);
  // Формулы из комментария Excel не должен исполнять
  const safe = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
  const head = ['Дата', 'Тип', 'Категория', 'Сумма', ...(notes ? ['Комментарий'] : [])];
  const rows = transactionsInRange(data, from, to)
    .filter((t) => income || t.type === 'expense')
    .reverse()
    .map((t) => {
      const cat = cats.get(t.categoryId);
      const row = [formatDate(t.date), t.type === 'expense' ? 'Расход' : 'Доход', safe(cat ? cat.name : 'Без категории'), plainAmount(t.amount).replace('.', ',')];
      if (notes) row.push(safe(oneLine(t.note)));
      return row.map((v) => csvCell(v, ';')).join(';');
    });
  return `\ufeff${[head.join(';'), ...rows].join('\r\n')}\r\n`;
}
