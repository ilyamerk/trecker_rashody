// Мелкие помощники для DOM: безопасные шаблоны, шторка, подтверждение, тост, файлы.

// ---------- Шаблоны с экранированием ----------
// html`<b>${userText}</b>` экранирует подстановки; raw() — для уже готовой разметки

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const raw = (s) => new Raw(String(s));
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v == null || v === false ? '' : esc(v));
export const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ''), ''));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const CLOSE_ICON = raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');

// ---------- Нижняя шторка ----------

const sheet = () => $('#sheet');
let onSheetClose = null;

export function openSheet(title, body, { onClose, keepScroll = false } = {}) {
  const d = sheet();
  const scroll = keepScroll ? (d.querySelector('.sheet-body')?.scrollTop ?? 0) : 0;
  d.innerHTML = html`
    <div class="sheet-head">
      <h2 id="sheetTitle">${title}</h2>
      <button type="button" class="icon-btn" data-sheet-close aria-label="Закрыть">${CLOSE_ICON}</button>
    </div>
    <div class="sheet-body">${body}</div>`.s;
  onSheetClose = onClose ?? null;
  if (!d.open) d.showModal();
  d.querySelector('.sheet-body').scrollTop = scroll;
  return d.querySelector('.sheet-body');
}

// Заменить содержимое открытой шторки (переход между шагами)
export const updateSheet = (title, body, opts) => openSheet(title, body, opts);

// Уборка сразу, а не в событии close: оно приходит асинхронно и могло бы
// стереть шторку, открытую следом
function cleanupSheet() {
  const cb = onSheetClose;
  onSheetClose = null;
  sheet().innerHTML = '';
  cb?.();
}

export function closeSheet() {
  const d = sheet();
  if (!d.open) return;
  d.close();
  cleanupSheet();
}

export function initSheet() {
  const d = sheet();
  d.addEventListener('click', (e) => {
    // Тап по затемнению вокруг шторки закрывает её
    if (e.target === d || e.target.closest('[data-sheet-close]')) closeSheet();
  });
  // Закрытие клавишей Esc проходит мимо closeSheet()
  d.addEventListener('close', () => {
    if (!d.open && d.innerHTML) cleanupSheet();
  });
}

export const sheetIsOpen = () => sheet().open;

// ---------- Подтверждение ----------

export function confirmDialog({ title, text = '', ok = 'Да', cancel = 'Отмена', danger = false }) {
  const d = $('#confirm');
  d.innerHTML = html`
    <h2 id="confirmTitle">${title}</h2>
    ${text ? html`<p>${text}</p>` : ''}
    <div class="btn-row">
      <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-answer="yes">${ok}</button>
      <button type="button" class="btn ghost" data-answer="no">${cancel}</button>
    </div>`.s;
  d.showModal();
  return new Promise((resolve) => {
    const done = (answer) => {
      d.removeEventListener('click', onClick);
      d.removeEventListener('close', onClose);
      if (d.open) d.close();
      resolve(answer);
    };
    const onClick = (e) => {
      const btn = e.target.closest('[data-answer]');
      if (btn) done(btn.dataset.answer === 'yes');
      else if (e.target === d) done(false);
    };
    const onClose = () => done(false);
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
  });
}

// ---------- Тост ----------

let toastTimer = null;

export function toast(message, { action, onAction, ms = 4000 } = {}) {
  const t = $('#toast');
  clearTimeout(toastTimer);
  t.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action;
    btn.addEventListener('click', () => {
      t.hidden = true;
      onAction?.();
    }, { once: true });
    t.append(btn);
  }
  t.hidden = false;
  toastTimer = setTimeout(() => (t.hidden = true), action ? Math.max(ms, 5000) : ms);
}

// ---------- Подсказки на графиках ----------
// Элементы с data-tip="заголовок|значение" показывают подсказку по наведению или тапу

export function initTooltips() {
  const tip = $('#tip');
  let active = null;
  const hide = () => {
    tip.hidden = true;
    active?.classList.remove('is-active');
    active = null;
  };
  const show = (el, x, y) => {
    const [title, value] = el.dataset.tip.split('|');
    tip.replaceChildren();
    const b = document.createElement('b');
    b.textContent = value ?? '';
    tip.append(b, document.createTextNode(title));
    tip.hidden = false;
    active?.classList.remove('is-active');
    active = el.nextElementSibling ?? el;
    active.classList.add('is-active');
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.min(Math.max(8, x - w / 2), innerWidth - w - 8)}px`;
    tip.style.top = `${Math.max(8, y - h - 14)}px`;
  };
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && e.pointerType === 'mouse') show(el, e.clientX, e.clientY);
  });
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && e.pointerType === 'mouse') show(el, e.clientX, e.clientY);
    else if (!el && e.pointerType === 'mouse' && active) hide();
  });
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY);
    else hide();
  });
  addEventListener('scroll', hide, { passive: true });
}

// ---------- Файлы и буфер обмена ----------

const isTouch = () => matchMedia('(pointer: coarse)').matches;

// На телефоне — меню «Поделиться» (сохранить в Файлы, отправить в ChatGPT и т.п.),
// на компьютере — обычное скачивание. Вызывать из обработчика нажатия без await до share.
export async function saveFile(name, text, mime = 'text/plain') {
  const file = new File([text], name, { type: `${mime};charset=utf-8` });
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      // Не вышло поделиться — скачаем обычным способом
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Старый способ — для браузеров без Clipboard API
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}
