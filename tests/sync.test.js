import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData, parseData, serializeData } from '../app/js/logic.js';
import { createGitHubClient, fromBase64, syncOnce, toBase64 } from '../app/js/sync.js';

const tx = (id, amount, updatedAt = 1) => ({ id, type: 'expense', amount, date: '2026-09-01', categoryId: 'exp-food', note: '', createdAt: 1, updatedAt });

// Мини-GitHub в памяти: один файл, sha меняется при каждой записи
function fakeGitHub({ isPrivate = true, text = null } = {}) {
  const gh = { text, sha: text ? 'sha0' : null, writes: 0, beforeWrite: null, reads: 0 };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  gh.fetch = async (url, init = {}) => {
    assert.equal(init.headers.Authorization, 'Bearer tkn');
    if (url === 'https://api.github.com/repos/me/data') return json(200, { private: isPrivate });
    if (!url.endsWith('/contents/data.json')) return json(404, { message: 'Not Found' });
    if (!init.method || init.method === 'GET') {
      gh.reads += 1;
      if (!gh.text) return json(404, { message: 'Not Found' });
      if (init.headers.Accept === 'application/vnd.github.raw+json') return new Response(gh.text);
      if (gh.big) return json(200, { sha: gh.sha, encoding: 'none', content: '' });
      return json(200, { sha: gh.sha, encoding: 'base64', content: toBase64(gh.text) });
    }
    const body = JSON.parse(init.body);
    if (gh.beforeWrite) {
      const hook = gh.beforeWrite;
      gh.beforeWrite = null;
      hook();
    }
    if ((body.sha ?? null) !== gh.sha) return json(409, { message: 'sha mismatch' });
    gh.writes += 1;
    gh.text = fromBase64(body.content);
    gh.sha = `sha${gh.writes}`;
    gh.lastMessage = body.message;
    return json(200, { content: { sha: gh.sha } });
  };
  return gh;
}

function localStore(data) {
  let current = data;
  return {
    get: () => current,
    set: async (d) => {
      current = d;
    },
    get data() {
      return current;
    },
  };
}

const client = (gh) => createGitHubClient({ repo: 'me/data', token: 'tkn', fetchImpl: gh.fetch });
const noSleep = async () => {};

test('base64 для кириллицы и эмодзи туда-обратно', () => {
  const s = 'Кофе ☕ «с собой» — 350 ₽';
  assert.equal(fromBase64(toBase64(s)), s);
});

test('первая синхронизация создаёт файл', async () => {
  const gh = fakeGitHub();
  const local = localStore(normalizeData({ transactions: [tx('a', 100)] }));
  const res = await syncOnce({ client: client(gh), local, deviceName: 'iPhone', sleep: noSleep });
  assert.deepEqual(res, { pulled: false, pushed: true });
  assert.equal(gh.lastMessage, 'Синхронизация: iPhone');
  assert.equal(parseData(gh.text).transactions[0].amount, 100);
});

test('забираем чужие изменения и отправляем свои', async () => {
  const gh = fakeGitHub({ text: serializeData(normalizeData({ transactions: [tx('remote', 500)] })) });
  const local = localStore(normalizeData({ transactions: [tx('mine', 100)] }));
  const res = await syncOnce({ client: client(gh), local, sleep: noSleep });
  assert.deepEqual(res, { pulled: true, pushed: true });
  const ids = (d) => d.transactions.map((t) => t.id).sort();
  assert.deepEqual(ids(local.data), ['mine', 'remote']);
  assert.deepEqual(ids(parseData(gh.text)), ['mine', 'remote']);
});

test('нет изменений — ничего не пишем', async () => {
  const data = normalizeData({ transactions: [tx('a', 100)] });
  const gh = fakeGitHub({ text: serializeData(data) });
  const res = await syncOnce({ client: client(gh), local: localStore(data), sleep: noSleep });
  assert.deepEqual(res, { pulled: false, pushed: false });
  assert.equal(gh.writes, 0);
});

test('конфликт: другое устройство записало между чтением и записью — сливаем заново', async () => {
  const gh = fakeGitHub({ text: serializeData(normalizeData({ transactions: [tx('a', 100)] })) });
  gh.beforeWrite = () => {
    gh.text = serializeData(normalizeData({ transactions: [tx('a', 100), tx('other', 777)] }));
    gh.sha = 'sha-other';
  };
  const local = localStore(normalizeData({ transactions: [tx('a', 100), tx('mine', 1)] }));
  const res = await syncOnce({ client: client(gh), local, sleep: noSleep });
  assert.equal(res.pushed, true);
  assert.deepEqual(parseData(gh.text).transactions.map((t) => t.id).sort(), ['a', 'mine', 'other']);
  assert.ok(local.data.transactions.some((t) => t.id === 'other'));
});

test('правка во время сетевого запроса не теряется', async () => {
  const gh = fakeGitHub({ text: serializeData(normalizeData({ transactions: [tx('remote', 5)] })) });
  const local = localStore(normalizeData({ transactions: [] }));
  const origFetch = gh.fetch;
  gh.fetch = async (url, init) => {
    const res = await origFetch(url, init);
    // Пользователь добавил трату, пока ждали ответ GitHub
    if (!init.method) local.set(normalizeData({ transactions: [tx('typed-meanwhile', 9)] }));
    return res;
  };
  await syncOnce({ client: client(gh), local, sleep: noSleep });
  const ids = local.data.transactions.map((t) => t.id).sort();
  assert.deepEqual(ids, ['remote', 'typed-meanwhile']);
});

test('большой файл (>1 МБ) читается «сырым»', async () => {
  const gh = fakeGitHub({ text: serializeData(normalizeData({ transactions: [tx('big', 1)] })) });
  gh.big = true;
  const res = await client(gh).read();
  assert.equal(parseData(res.text).transactions[0].id, 'big');
  assert.equal(res.sha, 'sha0');
});

test('битый файл не перезаписываем', async () => {
  const gh = fakeGitHub({ text: '{broken' });
  await assert.rejects(syncOnce({ client: client(gh), local: localStore(normalizeData({})), sleep: noSleep }), { code: 'bad-file' });
  assert.equal(gh.writes, 0);
});

test('публичный репозиторий не принимаем', async () => {
  await assert.rejects(client(fakeGitHub({ isPrivate: false })).checkRepo(), { code: 'public' });
  await client(fakeGitHub()).checkRepo();
});

test('понятные ошибки по кодам GitHub', async () => {
  const withStatus = (status, message = '') =>
    createGitHubClient({ repo: 'me/data', token: 't', fetchImpl: async () => new Response(JSON.stringify({ message }), { status }) });
  await assert.rejects(withStatus(401).read(), { code: 'auth' });
  await assert.rejects(withStatus(403, 'API rate limit exceeded').read(), { code: 'rate' });
  await assert.rejects(withStatus(403).read(), { code: 'forbidden' });
  await assert.rejects(withStatus(500).read(), { code: 'http' });
  const offline = createGitHubClient({ repo: 'me/data', token: 't', fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.read(), { code: 'network' });
});

test('бесконечный конфликт — сдаёмся после 4 попыток', async () => {
  const gh = fakeGitHub({ text: serializeData(normalizeData({})) });
  const orig = gh.fetch;
  gh.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') gh.sha = `moved-${Math.random()}`;
    return orig(url, init);
  };
  const local = localStore(normalizeData({ transactions: [tx('a', 1)] }));
  await assert.rejects(syncOnce({ client: client(gh), local, sleep: noSleep }), { code: 'conflict' });
});
