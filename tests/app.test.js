import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../app/', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('офлайн-кэш (sw.js) знает о каждом файле приложения', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  const files = walk(APP)
    .map((p) => relative(APP, p).split('\\').join('/'))
    .filter((p) => p !== 'sw.js');
  for (const f of files) assert.ok(listed.has(f), `добавь './${f}' в ASSETS в sw.js`);
  for (const f of listed) if (f && f !== 'index.html') assert.ok(files.includes(f), `в sw.js лишний файл './${f}'`);
});

test('все модули браузера синтаксически корректны', () => {
  for (const file of walk(join(APP, 'js'))) {
    const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(res.status, 0, `${relative(APP, file)}: ${res.stderr}`);
  }
});

test('index.html подключает только существующие файлы', () => {
  const index = readFileSync(join(APP, 'index.html'), 'utf8');
  for (const [, ref] of index.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
    assert.ok(statSync(join(APP, ref), { throwIfNoEntry: false }), `нет файла ${ref}`);
  }
});
