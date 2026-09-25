// Состояние приложения, сохранение на устройство и фоновая синхронизация.
import { COLLECTIONS, emptyData, generateRecurring, monthKey, normalizeData, todayISO } from './logic.js';
import { kv, requestPersistence } from './store.js';
import { createGitHubClient, deviceName, syncOnce } from './sync.js';
import { toast } from './ui.js';

const DEFAULT_SETTINGS = {
  pin: null, // { salt, hash, iterations }
  bio: null, // { credId } — ключ входа по Face ID
  bioUserId: null,
  lockAfter: 60, // секунд в фоне до блокировки
  sync: null, // { repo, token }
  lastSyncAt: null,
  lastBackupAt: null,
};

export const state = {
  data: emptyData(),
  settings: { ...DEFAULT_SETTINGS },
  ui: {
    tab: 'list',
    month: monthKey(todayISO()),
    filterType: 'all',
    filterCat: null,
    statsType: 'expense',
  },
  sync: { status: 'off', error: null, code: null },
};

// ---------- Подписка на изменения ----------

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((fn) => fn());

// Вкладки одного браузера узнают об изменениях друг друга
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('trecker-rashody') : null;
if (channel) {
  channel.onmessage = async ({ data: what }) => {
    if (what === 'data') state.data = normalizeData(await kv.get('data'));
    if (what === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...(await kv.get('settings')) };
    emit();
  };
}

export async function loadState() {
  const [data, settings] = await Promise.all([kv.get('data'), kv.get('settings')]);
  state.data = data ? normalizeData(data) : emptyData();
  state.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  state.sync.status = state.settings.sync ? 'idle' : 'off';
}

async function saveData() {
  try {
    await kv.set('data', state.data);
    channel?.postMessage('data');
  } catch (err) {
    toast(`Не удалось сохранить: ${err.message}`);
    throw err;
  }
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await kv.set('settings', state.settings);
  channel?.postMessage('settings');
  emit();
}

// ---------- Изменения данных ----------
// Время правки всегда больше предыдущего — даже если часы устройства отстают

const stamp = (prev) => Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);

async function commit() {
  emit();
  await saveData();
  scheduleSync(1500);
  requestPersistence();
}

export async function put(collection, record) {
  const list = state.data[collection];
  const i = list.findIndex((r) => r.id === record.id);
  const next = { ...record, updatedAt: stamp(list[i]) };
  if (i >= 0) list[i] = next;
  else list.push(next);
  await commit();
  return next;
}

// Удаление — «надгробие», чтобы запись не воскресла с другого устройства.
// Возвращает удалённую запись — для кнопки «Отменить».
export async function remove(collection, id) {
  const list = state.data[collection];
  const i = list.findIndex((r) => r.id === id);
  if (i < 0 || list[i].deleted) return null;
  const prev = list[i];
  list[i] = { id, deleted: true, updatedAt: stamp(prev) };
  await commit();
  return prev;
}

export async function restore(collection, record) {
  return put(collection, record);
}

export async function replaceData(data) {
  state.data = normalizeData(data);
  // Восстановленные записи должны победить при синхронизации
  const now = Date.now();
  for (const name of COLLECTIONS) {
    state.data[name] = state.data[name].map((r) => ({ ...r, updatedAt: Math.max(r.updatedAt, now) }));
  }
  await commit();
}

// Регулярные платежи: записываем наступившие. Записи не штампуем временем правки —
// они одинаковые на всех устройствах (см. generateRecurring). Возвращает, сколько записано.
export async function runRecurring() {
  const records = generateRecurring(state.data, todayISO());
  if (!records.length) return 0;
  state.data.transactions.push(...records);
  await commit();
  return records.length;
}

export async function wipeDevice() {
  await kv.clear();
  channel?.postMessage('data');
  location.reload();
}

// ---------- Синхронизация ----------

let timer = null;
let running = null;
let again = false;

export function scheduleSync(delay = 0) {
  if (!state.settings.sync) return;
  clearTimeout(timer);
  timer = setTimeout(() => runSync().catch(() => {}), delay);
}

// manual — по кнопке: ошибка пробрасывается, чтобы показать её пользователю
export async function runSync({ manual = false } = {}) {
  if (!state.settings.sync) return null;
  if (running) {
    again = true;
    return running;
  }
  if (!navigator.onLine && !manual) {
    state.sync.status = 'offline';
    emit();
    return null;
  }
  state.sync.status = 'syncing';
  emit();
  running = (async () => {
    try {
      const client = createGitHubClient(state.settings.sync);
      const res = await syncOnce({
        client,
        deviceName: deviceName(),
        local: {
          get: () => state.data,
          set: async (d) => {
            state.data = d;
            emit();
            await saveData();
          },
        },
      });
      state.sync = { status: 'ok', error: null, code: null };
      await saveSettings({ lastSyncAt: Date.now() });
      // С другого устройства могли прийти новые регулярные платежи
      if (res.pulled) await runRecurring();
      return res;
    } catch (err) {
      state.sync = { status: 'error', error: err.message, code: err.code ?? null };
      if (manual) throw err;
      return null;
    } finally {
      running = null;
      emit();
      if (again) {
        again = false;
        scheduleSync(500);
      }
    }
  })();
  return running;
}

export async function connectSync({ repo, token }) {
  const client = createGitHubClient({ repo, token });
  await client.checkRepo();
  await saveSettings({ sync: { repo, token } });
  return runSync({ manual: true });
}

export async function disconnectSync() {
  clearTimeout(timer);
  state.sync = { status: 'off', error: null, code: null };
  await saveSettings({ sync: null, lastSyncAt: null });
}

export function startSyncLoop() {
  scheduleSync(300);
  setInterval(() => {
    if (document.visibilityState === 'visible') scheduleSync(0);
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300);
  });
  addEventListener('online', () => scheduleSync(0));
}
