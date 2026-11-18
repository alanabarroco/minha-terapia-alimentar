// Gráficos SVG gerados no servidor (sem bibliotecas). Sempre acompanhados de tabela/texto na página.
import { h, Raw, esc } from './html';
import type { AreaResult } from '../lib/questionnaire/scoring';

const COLORS = { A: '#3b6a50', B: '#365f8a', C: '#66559a', D: '#9a6a1f' } as const;
const svgWrap = (w: number, hgt: number, label: string, inner: string) =>
  new Raw(`<svg class="chart" viewBox="0 0 ${w} ${hgt}" width="${w}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Arial,sans-serif">${inner}</svg>`);

/** Barras horizontais 0–4 por área (média descritiva). Áreas sem respostas suficientes não recebem barra. */
export function areaBars(results: AreaResult[]): Raw {
  const W = 680, L = 250, R = 30, rowH = 54, top = 28, H = top + results.length * rowH + 28;
  const bw = W - L - R;
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const x = L + (bw * i) / 4;
    s += `<line x1="${x}" y1="${top - 8}" x2="${x}" y2="${H - 24}" stroke="#d9e2dc"/><text x="${x}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#56655d">${i}</text>`;
  }
  results.forEach((r, i) => {
    const y = top + i * rowH;
    s += `<text x="${L - 10}" y="${y + 22}" font-size="13" text-anchor="end" fill="#1c2b24" font-weight="600">${esc(r.label.length > 34 ? r.label.slice(0, 33) + '…' : r.label)}</text>`;
    if (r.mean === null) {
      s += `<text x="${L + 8}" y="${y + 22}" font-size="13" fill="#56655d">Respostas insuficientes (${r.answered} de ${r.totalItems})</text>`;
    } else {
      s += `<rect x="${L}" y="${y + 6}" width="${(bw * r.mean) / 4}" height="26" rx="5" fill="${COLORS[r.area]}"/>` +
        `<text x="${L + (bw * r.mean) / 4 + 8}" y="${y + 24}" font-size="13" fill="#1c2b24">${String(r.mean).replace('.', ',')}</text>`;
    }
  });
  return svgWrap(W, H, 'Médias descritivas por área, escala de 0 a 4', s);
}

export type Pt = { x: number; y: number };
export type Series = { name: string; color: string; points: Pt[] };

/** Linhas com eixo X numérico (ex.: idade em meses). Sem curvas de referência embutidas. */
export function lineChart(o: { title: string; series: Series[]; xLabel: string; yLabel: string; xFmt?: (x: number) => string }): Raw {
  const W = 680, H = 320, L = 56, R = 20, T = 20, B = 52;
  const pts = o.series.flatMap((s) => s.points);
  if (!pts.length) return new Raw('');
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const padY = (y1 - y0 || 1) * 0.15; y0 = Math.max(0, y0 - padY); y1 += padY;
  const X = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const Y = (y: number) => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);
  const xf = o.xFmt ?? ((x) => String(Math.round(x * 10) / 10).replace('.', ','));
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4, y = Y(yv);
    s += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#e3ebe6"/><text x="${L - 8}" y="${y + 4}" font-size="12" text-anchor="end" fill="#56655d">${(Math.round(yv * 10) / 10).toString().replace('.', ',')}</text>`;
    const xv = x0 + ((x1 - x0) * i) / 4;
    s += `<text x="${X(xv)}" y="${H - B + 18}" font-size="12" text-anchor="middle" fill="#56655d">${esc(xf(xv))}</text>`;
  }
  s += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#9fb0a6"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" stroke="#9fb0a6"/>`;
  s += `<text x="${(L + W - R) / 2}" y="${H - 10}" font-size="12" text-anchor="middle" fill="#1c2b24">${esc(o.xLabel)}</text>`;
  s += `<text x="14" y="${(T + H - B) / 2}" font-size="12" text-anchor="middle" fill="#1c2b24" transform="rotate(-90 14 ${(T + H - B) / 2})">${esc(o.yLabel)}</text>`;
  for (const se of o.series) {
    const sorted = [...se.points].sort((a, b) => a.x - b.x);
    if (sorted.length > 1) s += `<polyline fill="none" stroke="${se.color}" stroke-width="2.5" points="${sorted.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}"/>`;
    for (const p of sorted) s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${se.color}"><title>${esc(se.name)}: ${p.y}</title></circle>`;
  }
  if (o.series.length > 1) o.series.forEach((se, i) => { s += `<rect x="${L + i * 150}" y="${2}" width="12" height="12" fill="${se.color}"/><text x="${L + i * 150 + 18}" y="13" font-size="12" fill="#1c2b24">${esc(se.name)}</text>`; });
  return svgWrap(W, H, o.title, s);
}

/** Evolução por aplicação (eixo categórico) para respostas comparáveis do questionário. */
export function evolutionChart(labels: string[], series: { name: string; color: string; values: (number | null)[] }[]): Raw {
  const W = 680, H = 300, L = 48, R = 20, T = 28, B = 46;
  const n = labels.length;
  const X = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const Y = (v: number) => H - B - (v / 4) * (H - T - B);
  let s = '';
  for (let v = 0; v <= 4; v++) s += `<line x1="${L}" y1="${Y(v)}" x2="${W - R}" y2="${Y(v)}" stroke="#e3ebe6"/><text x="${L - 8}" y="${Y(v) + 4}" font-size="12" text-anchor="end" fill="#56655d">${v}</text>`;
  labels.forEach((l, i) => { s += `<text x="${X(i)}" y="${H - B + 18}" font-size="12" text-anchor="middle" fill="#56655d">${esc(l)}</text>`; });
  series.forEach((se, k) => {
    const pts = se.values.map((v, i) => (v === null ? null : [X(i), Y(v)] as const));
    const segs = pts.filter(Boolean) as (readonly [number, number])[];
    if (segs.length > 1) s += `<polyline fill="none" stroke="${se.color}" stroke-width="2.5" points="${segs.map((p) => p.join(',')).join(' ')}"/>`;
    segs.forEach((p) => { s += `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="${se.color}"/>`; });
    s += `<rect x="${L + k * 165}" y="4" width="12" height="12" fill="${se.color}"/><text x="${L + k * 165 + 17}" y="15" font-size="11" fill="#1c2b24">${esc(se.name.length > 22 ? se.name.slice(0, 21) + '…' : se.name)}</text>`;
  });
  return svgWrap(W, H, 'Evolução das médias por área nas aplicações comparáveis', s);
}
export const AREA_COLOR = COLORS;
