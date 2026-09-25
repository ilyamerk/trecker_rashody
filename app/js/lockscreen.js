// Экран блокировки, настройка PIN-кода и Face ID.
import {
  biometricAvailable,
  biometricName,
  checkPin,
  createPinRecord,
  describeBiometricError,
  formatWait,
  isWeakPin,
  lockoutMs,
  newBiometricUserId,
  PIN_LENGTH,
  registerBiometric,
  verifyBiometric,
} from './lock.js';
import { saveSettings, state, wipeDevice } from './state.js';
import { kv } from './store.js';
import { $, closeSheet, confirmDialog, html, openSheet, raw, toast } from './ui.js';

const FACE_ICON = raw(
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.5 1 4.5 1 6 0"/></svg>',
);
const BACK_ICON = raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-6 6M11 9l6 6"/></svg>');

const dots = (n) => html`<div class="pin-dots" aria-hidden="true">${Array.from({ length: PIN_LENGTH }, (_, i) => html`<i class="${i < n ? 'on' : ''}"></i>`)}</div>`;

function keypad({ bio = false } = {}) {
  const key = (d) => html`<button type="button" class="key" data-key="${d}">${d}</button>`;
  return html`
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(key)}
      ${bio ? html`<button type="button" class="key flat" data-bio aria-label="Войти по ${biometricName()}">${FACE_ICON}</button>` : html`<span></span>`}
      ${key(0)}
      <button type="button" class="key flat" data-back aria-label="Стереть">${BACK_ICON}</button>
    </div>`;
}

// Ввод PIN с экранной клавиатуры и с обычной (на компьютере)
function pinInput(root, { onComplete, onBio }) {
  let pin = '';
  const setDots = () => root.querySelectorAll('.pin-dots i').forEach((el, i) => el.classList.toggle('on', i < pin.length));
  const press = (k) => {
    if (root.querySelector('[data-key]')?.disabled) return;
    if (k === 'back') pin = pin.slice(0, -1);
    else if (pin.length < PIN_LENGTH) pin += k;
    setDots();
    if (pin.length === PIN_LENGTH) {
      const value = pin;
      pin = '';
      // Даём увидеть четвёртую точку
      setTimeout(() => {
        setDots();
        onComplete(value);
      }, 120);
    }
  };
  const onClick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.key) press(t.dataset.key);
    else if ('back' in t.dataset) press('back');
    else if ('bio' in t.dataset) onBio?.();
  };
  const onKey = (e) => {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
  };
  root.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  return {
    reset() {
      pin = '';
      setDots();
    },
    detach() {
      root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    },
  };
}

function shake(root) {
  const el = root.querySelector('.pin-dots');
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// ---------- Экран блокировки ----------

let locked = false;
export const isLocked = () => locked;

export async function showLock({ onUnlock }) {
  if (locked) return;
  locked = true;
  closeSheet();
  const confirm = $('#confirm');
  if (confirm.open) confirm.close();

  const el = $('#lock');
  const bio = Boolean(state.settings.bio);
  el.innerHTML = html`
    <div class="lock-title" id="lockTitle">Введи PIN-код</div>
    ${dots(0)}
    <div class="lock-msg" role="alert"></div>
    ${keypad({ bio })}
    <button type="button" class="link" data-forgot>Забыли PIN?</button>`.s;
  el.hidden = false;
  document.body.classList.add('locked');
  const msg = el.querySelector('.lock-msg');
  let lockState = (await kv.get('lock')) ?? { failures: 0, until: 0 };
  let countdown = null;

  const setDisabled = (v) => el.querySelectorAll('[data-key], [data-back]').forEach((b) => (b.disabled = v));

  const tick = () => {
    const wait = lockState.until - Date.now();
    if (wait > 0) {
      setDisabled(true);
      msg.textContent = `Слишком много попыток. Подожди ${formatWait(wait)}`;
    } else {
      clearInterval(countdown);
      countdown = null;
      setDisabled(false);
      if (msg.textContent.startsWith('Слишком')) msg.textContent = '';
    }
  };
  const startCountdown = () => {
    tick();
    if (!countdown && lockState.until > Date.now()) countdown = setInterval(tick, 1000);
  };

  const unlock = async () => {
    clearInterval(countdown);
    input.detach();
    lockState = { failures: 0, until: 0 };
    await kv.set('lock', lockState);
    el.hidden = true;
    el.innerHTML = '';
    document.body.classList.remove('locked');
    locked = false;
    onUnlock();
  };

  const tryBio = async () => {
    msg.textContent = '';
    try {
      if (await verifyBiometric(state.settings.bio.credId)) return unlock();
      msg.textContent = 'Не получилось подтвердить — введи PIN';
    } catch (err) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') msg.textContent = `Вход по ${biometricName()}: ${describeBiometricError(err)}`;
    }
  };

  const input = pinInput(el, {
    onBio: tryBio,
    async onComplete(pin) {
      if (lockState.until > Date.now()) return;
      if (await checkPin(pin, state.settings.pin)) return unlock();
      lockState = { failures: lockState.failures + 1, until: Date.now() + lockoutMs(lockState.failures + 1) };
      await kv.set('lock', lockState);
      shake(el);
      const left = Math.max(0, 5 - lockState.failures);
      msg.textContent = left ? `Неверный PIN${left <= 2 ? `, осталось попыток до паузы: ${left}` : ''}` : '';
      startCountdown();
    },
  });

  el.querySelector('[data-forgot]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Сбросить PIN?',
      text: `Обойти PIN можно только удалив все данные на этом устройстве. ${
        state.settings.sync
          ? 'Синхронизация включена — данные останутся в GitHub и вернутся после повторного подключения репозитория.'
          : 'Синхронизации нет — вернуть данные можно только из резервной копии.'
      }`,
      ok: 'Удалить данные',
      danger: true,
    });
    if (ok) await wipeDevice();
  });

  startCountdown();
}

// Блокируем после сворачивания; пока свёрнуто — размываем, чтобы суммы не попали в превью
export function initAutoLock(lock) {
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (state.settings.pin) document.body.classList.add('privacy');
      return;
    }
    document.body.classList.remove('privacy');
    const threshold = Math.max(1000, state.settings.lockAfter * 1000);
    if (state.settings.pin && hiddenAt && Date.now() - hiddenAt >= threshold) lock();
    hiddenAt = null;
  });
}

// ---------- Настройка PIN ----------

export function openPinSetup({ mode = 'set' } = {}) {
  const hasPin = Boolean(state.settings.pin);
  let step = hasPin ? 'current' : 'new';
  let first = '';
  let message = '';
  const titles = {
    current: 'Введи текущий PIN',
    new: 'Придумай PIN из 4 цифр',
    repeat: 'Повтори PIN',
  };
  let input = null;

  function render() {
    input?.detach();
    const body = openSheet(
      mode === 'remove' ? 'Убрать PIN-код' : hasPin ? 'Сменить PIN-код' : 'PIN-код',
      html`
      <div class="pin-box">
        <div class="lock-title">${titles[step]}</div>
        ${dots(0)}
        <div class="lock-msg" role="alert">${message}</div>
        ${keypad()}
      </div>`,
      { onClose: () => input?.detach() },
    );
    input = pinInput(body, { onComplete });
  }

  async function onComplete(pin) {
    message = '';
    if (step === 'current') {
      if (!(await checkPin(pin, state.settings.pin))) {
        message = 'Неверный PIN';
        render();
        return shake(document.querySelector('#sheet'));
      }
      if (mode === 'remove') {
        await saveSettings({ pin: null, bio: null });
        closeSheet();
        return toast('PIN-код выключен');
      }
      step = 'new';
    } else if (step === 'new') {
      if (isWeakPin(pin)) {
        message = 'Слишком простой — такой угадают с первой попытки';
        render();
        return shake(document.querySelector('#sheet'));
      }
      first = pin;
      step = 'repeat';
    } else if (step === 'repeat') {
      if (pin !== first) {
        message = 'PIN не совпал — придумай заново';
        step = 'new';
        render();
        return shake(document.querySelector('#sheet'));
      }
      await saveSettings({ pin: await createPinRecord(pin) });
      closeSheet();
      if (!hasPin && !state.settings.bio && (await biometricAvailable())) {
        toast('PIN-код включён', { action: `Вход по ${biometricName()}`, onAction: () => enableBiometric() });
      } else toast(hasPin ? 'PIN-код изменён' : 'PIN-код включён');
      return;
    }
    render();
  }

  render();
}

// Вызывать прямо из обработчика нажатия: Safari требует жест пользователя
export async function enableBiometric(checkbox = null) {
  const userId = state.settings.bioUserId ?? newBiometricUserId();
  try {
    const credId = await registerBiometric(userId);
    await saveSettings({ bio: { credId }, bioUserId: userId });
    toast(`Вход по ${biometricName()} включён`);
  } catch (err) {
    if (checkbox) checkbox.checked = false;
    toast(`Вход по ${biometricName()} не включился: ${describeBiometricError(err)}`, { ms: 8000 });
  }
}

export async function disableBiometric() {
  await saveSettings({ bio: null });
  toast('Выключено. Ключ входа можно удалить в приложении «Пароли»', { ms: 6000 });
}
