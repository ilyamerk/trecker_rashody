// Ключ-значение поверх IndexedDB (встроенная база браузера). Данные живут на устройстве:
//   data     — операции, категории, долги (то, что синхронизируется)
//   settings — настройки этого устройства: PIN, Face ID, синхронизация
//   lock     — счётчик неверных PIN (чтобы перезапуск не сбрасывал паузу)
const DB_NAME = 'trecker-rashody';
const STORE = 'kv';

let dbPromise = null;

function openDB() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      // Новая версия приложения в другой вкладке обновляет базу — уступаем
      db.onversionchange = () => {
        db.close();
        location.reload();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Хранилище занято другой вкладкой — закрой её'));
  });
  return dbPromise;
}

async function run(mode, work) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = work(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Запись в хранилище прервана'));
  });
}

export const kv = {
  get: (key) => run('readonly', (s) => s.get(key)),
  set: (key, value) => run('readwrite', (s) => void s.put(value, key)),
  delete: (key) => run('readwrite', (s) => void s.delete(key)),
  clear: () => run('readwrite', (s) => void s.clear()),
};

// Просим браузер не вычищать данные при нехватке места (Safari может отказать — не страшно)
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* не поддерживается */
  }
}
