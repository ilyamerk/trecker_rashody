// Простые SVG-графики без библиотек. Тонкие столбики со скруглённым верхом,
// бледная сетка, подписи приглушённым цветом; значения — в подсказке по тапу.
import { esc } from './ui.js';

const W = 340; // ширина viewBox; SVG растягивается на всю карточку

const trim1 = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

// Копейки → «12,5 тыс» для осей
export function compactRub(kop) {
  const r = kop / 100;
  if (r >= 1e6) return `${trim1(r / 1e6)} млн`;
  if (r >= 1e3) return `${trim1(r / 1e3)} тыс`;
  return String(Math.round(r));
}

function niceStep(max, ticks) {
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

// Столбик со скруглением только сверху — низ стоит на базовой линии
function barPath(x, y, w, h, r = 3) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * groups: [{ label, showLabel, tip: 'заголовок|значение', values: [{ v, cls }], strong }]
 * Одна группа — один день или месяц; в группе один или несколько столбиков.
 */
export function barChart({ groups, height = 150, ariaLabel = '' }) {
  const left = 38;
  const right = 4;
  const top = 8;
  const bottom = 20;
  const plotW = W - left - right;
  const plotH = height - top - bottom;
  const n = Math.max(groups.length, 1);
  const step = plotW / n;
  const perGroup = Math.max(1, ...groups.map((g) => g.values.length));
  const groupGap = perGroup > 1 ? Math.min(12, step * 0.3) : Math.min(2, step * 0.25);
  const barGap = 2;
  const barW = Math.max(1.5, (step - groupGap - barGap * (perGroup - 1)) / perGroup);
  const max = Math.max(0, ...groups.flatMap((g) => g.values.map((v) => v.v)));
  const tickStep = max > 0 ? niceStep(max, 3) : 100_00;
  const topValue = Math.max(tickStep, Math.ceil(max / tickStep) * tickStep);
  const y = (v) => top + plotH * (1 - v / topValue);

  const parts = [];
  for (let v = 0; v <= topValue + 1e-9; v += tickStep) {
    const yy = y(v).toFixed(1);
    if (v > 0) parts.push(`<line class="grid" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/>`);
    parts.push(`<text x="${left - 6}" y="${yy}" dy="3.5" text-anchor="end">${esc(compactRub(v))}</text>`);
  }
  groups.forEach((g, i) => {
    const gx = left + i * step;
    parts.push(`<rect class="hit" x="${gx.toFixed(1)}" y="${top}" width="${step.toFixed(1)}" height="${plotH}" data-tip="${esc(g.tip)}"/>`);
    const bars = g.values
      .map((val, j) => {
        if (val.v <= 0) return '';
        const bx = gx + groupGap / 2 + j * (barW + barGap);
        const by = y(val.v);
        return `<path class="${val.cls}" d="${barPath(+bx.toFixed(1), +by.toFixed(1), +barW.toFixed(1), +(top + plotH - by).toFixed(1))}"/>`;
      })
      .join('');
    parts.push(`<g>${bars}</g>`);
    if (g.showLabel) {
      parts.push(`<text x="${(gx + step / 2).toFixed(1)}" y="${height - 5}" text-anchor="middle"${g.strong ? ' class="today"' : ''}>${esc(g.label)}</text>`);
    }
  });
  parts.push(`<line class="base" x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}"/>`);
  return `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(ariaLabel)}">${parts.join('')}</svg>`;
}
