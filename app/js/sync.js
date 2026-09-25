// «База данных» во втором, приватном репозитории: один JSON-файл, который
// каждое устройство читает, сливает со своими данными и записывает обратно.
// GitHub сам проверяет sha файла — если другое устройство успело записать
// раньше, запись отклоняется, и мы перечитываем и сливаем заново.
import { mergeData, parseData, serializeData } from './logic.js';

export const SYNC_FILE = 'data.json';
const API = 'https://api.github.com';

export class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function createGitHubClient({ repo, token, path = SYNC_FILE, api = API, fetchImpl = (...a) => fetch(...a) }) {
  const fileUrl = `${api}/repos/${repo}/contents/${path}`;

  async function call(url, { headers, ...init } = {}) {
    try {
      return await fetchImpl(url, {
        cache: 'no-store',
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...headers },
      });
    } catch {
      throw new SyncError('network', 'Нет связи с GitHub');
    }
  }

  async function fail(res) {
    let message = '';
    try {
      message = (await res.json()).message ?? '';
    } catch {
      /* тело не JSON */
    }
    if (res.status === 401) throw new SyncError('auth', 'Токен не подходит: истёк или отозван. Создай новый.');
    if (res.status === 403 && /rate limit/i.test(message)) throw new SyncError('rate', 'GitHub временно ограничил запросы — повторю позже.');
    if (res.status === 403) throw new SyncError('forbidden', 'У токена нет права записи: нужно Contents → Read and write.');
    if (res.status === 404) throw new SyncError('not-found', 'Репозиторий не найден или токен к нему не допущен.');
    if (res.status === 409 || res.status === 422) throw new SyncError('conflict', 'Файл одновременно изменили с другого устройства.');
    throw new SyncError('http', `GitHub ответил ${res.status}${message ? `: ${message}` : ''}`);
  }

  return {
    repo,

    // Подключаемся только к приватному репозиторию: в публичном расходы увидят все
    async checkRepo() {
      const res = await call(`${api}/repos/${repo}`);
      if (!res.ok) await fail(res);
      const info = await res.json();
      if (!info.private) {
        throw new SyncError('public', 'Репозиторий публичный — твои траты увидят все. Сделай его приватным (Settings → General → Danger Zone → Change visibility) или создай новый приватный.');
      }
      return info;
    },

    // → { sha, text }; файла ещё нет → { sha: null, text: null }
    async read() {
      const res = await call(fileUrl);
      if (res.status === 404) return { sha: null, text: null };
      if (!res.ok) await fail(res);
      const body = await res.json();
      if (body.encoding === 'base64' && body.content) return { sha: body.sha, text: fromBase64(body.content) };
      // Файлы больше 1 МБ API отдаёт без содержимого — забираем «сырым»
      const raw = await call(fileUrl, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!raw.ok) await fail(raw);
      return { sha: body.sha, text: await raw.text() };
    },

    async write(text, sha, message) {
      const res = await call(fileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: toBase64(text), ...(sha ? { sha } : {}) }),
      });
      if (!res.ok) await fail(res);
      return (await res.json()).content.sha;
    },
  };
}

/**
 * Один цикл синхронизации.
 * local.get() → текущие данные (синхронно), local.set(data) — заменить их.
 * Между get и set нет await, поэтому правка, сделанная во время сетевого
 * запроса, не потеряется: она уже будет в get() и попадёт в слияние.
 */
export async function syncOnce({ client, local, deviceName = 'устройство', sleep }) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let pulled = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await wait(500 * 2 ** attempt);
    const remote = await client.read();
    let remoteData = null;
    if (remote.text) {
      try {
        remoteData = parseData(remote.text);
      } catch (err) {
        // Битый файл не перезаписываем молча — вдруг его правили руками
        throw new SyncError('bad-file', `Файл ${SYNC_FILE} в репозитории не читается: ${err.message}`);
      }
    }
    const { data, localChanged, remoteChanged } = mergeData(local.get(), remoteData);
    if (localChanged) {
      await local.set(data);
      pulled = true;
    }
    if (!remoteChanged) return { pulled, pushed: false };
    try {
      await client.write(serializeData(data), remote.sha, `Синхронизация: ${deviceName}`);
      return { pulled, pushed: true };
    } catch (err) {
      if (err.code !== 'conflict') throw err;
      // Другое устройство успело записать — перечитываем и сливаем заново
    }
  }
  throw new SyncError('conflict', 'Не получилось договориться с другим устройством — повторю позже.');
}

export function deviceName(ua = navigator.userAgent) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'устройство';
}
