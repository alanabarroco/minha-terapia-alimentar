import type { AgeBand } from './questionnaire/items';

function parts(iso: string) { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return { y, m, d }; }

/** Meses completos entre duas datas ISO (AAAA-MM-DD). */
export function ageInMonths(birthISO: string, onISO: string): number {
  const b = parts(birthISO), o = parts(onISO);
  let months = (o.y - b.y) * 12 + (o.m - b.m);
  if (o.d < b.d) months--;
  return Math.max(months, 0);
}
export function ageInYears(birthISO: string, onISO: string): number { return Math.floor(ageInMonths(birthISO, onISO) / 12); }

export function ageLabel(birthISO: string, onISO: string): string {
  const m = ageInMonths(birthISO, onISO), y = Math.floor(m / 12), r = m % 12;
  if (y === 0) return `${r} ${r === 1 ? 'mês' : 'meses'}`;
  return r ? `${y} ${y === 1 ? 'ano' : 'anos'} e ${r} ${r === 1 ? 'mês' : 'meses'}` : `${y} ${y === 1 ? 'ano' : 'anos'}`;
}

export function ageBandFor(birthISO: string, onISO: string): AgeBand {
  const y = ageInYears(birthISO, onISO);
  if (y < 2) return 'menor_2';
  if (y <= 5) return '2_5';
  if (y <= 9) return '6_9';
  if (y <= 12) return '10_12';
  if (y <= 17) return '13_17';
  return '18_mais';
}

export function toBR(iso: string | null | undefined): string {
  if (!iso) return '';
  const { y, m, d } = parts(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}
export function fromBR(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  const [_, d, mo, y] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +mo - 1 && dt.getUTCDate() === +d ? `${y}-${mo}-${d}` : null;
}
export function todayISO(tz = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function dateTimeBR(ts: string | null | undefined): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts));
}
