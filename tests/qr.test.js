import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSyncKey, parseSyncKey } from '../app/js/logic.js';
import { qrMatrix, qrSvg } from '../app/js/qr.js';

// jsQR — UMD-скрипт; в браузере он кладёт себя в window.jsQR, здесь — в module.exports
const mod = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../app/vendor/jsQR.js', import.meta.url), 'utf8'))(mod, mod.exports);
const jsQR = mod.exports;

// Рисуем матрицу в пиксели (как камера увидела бы экран) и распознаём сканером
function decode(text, scale = 6, quiet = 4) {
  const { size, dark } = qrMatrix(text);
  const w = (size + quiet * 2) * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(px, w, w)?.data ?? null;
}

test('QR с ключом подключения читается сканером обратно', () => {
  const key = makeSyncKey({ repo: 'ilyamerk/trecker-data', token: `github_pat_${'A1b2C3d4E5'.repeat(8)}xy` });
  const read = decode(key);
  assert.equal(read, key);
  assert.deepEqual(parseSyncKey(read), { repo: 'ilyamerk/trecker-data', token: `github_pat_${'A1b2C3d4E5'.repeat(8)}xy` });
});

test('qrSvg: белый фон и квадратные модули', () => {
  const svg = qrSvg('trecker1|a/b|github_pat_x');
  assert.match(svg, /^<svg class="qr" viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/);
  assert.match(svg, /<path d="M\d+ \d+h1v1h-1z/);
});
