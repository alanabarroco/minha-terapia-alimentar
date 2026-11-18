// Escore-z pelo método LMS (Cole). Só calcula com uma tabela de referência OFICIAL importada
// (OMS/MS) — tabela, fonte e versão ficam no banco (growth_reference_lms). Sem tabela: sem escore.
// Não há curva embutida neste código.
export type LMS = { l: number; m: number; s: number };
export type RefRow = LMS & { x: number };

export function lmsZ(value: number, { l, m, s }: LMS): number {
  if (!(value > 0) || !(m > 0) || !(s > 0)) throw new Error('Valores inválidos para o cálculo LMS');
  return l === 0 ? Math.log(value / m) / s : (Math.pow(value / m, l) - 1) / (l * s);
}
export function lmsValueAtZ(z: number, { l, m, s }: LMS): number {
  return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l);
}

/** Ajuste da OMS para |z| > 3 (indicadores de peso e IMC; não se aplica a comprimento/altura por idade). */
export function lmsZExtended(value: number, lms: LMS): number {
  const z = lmsZ(value, lms);
  if (z > 3) {
    const sd3 = lmsValueAtZ(3, lms), sd2 = lmsValueAtZ(2, lms);
    return 3 + (value - sd3) / (sd3 - sd2);
  }
  if (z < -3) {
    const sd3 = lmsValueAtZ(-3, lms), sd2 = lmsValueAtZ(-2, lms);
    return -3 + (value - sd3) / (sd2 - sd3);
  }
  return z;
}

/** Interpolação linear de L, M, S entre os dois pontos vizinhos da tabela. Fora do intervalo: null. */
export function interpolateLMS(rows: RefRow[], x: number): LMS | null {
  if (!rows.length) return null;
  const r = [...rows].sort((a, b) => a.x - b.x);
  if (x < r[0].x || x > r[r.length - 1].x) return null;
  let lo = r[0], hi = r[r.length - 1];
  for (let i = 0; i < r.length - 1; i++) if (x >= r[i].x && x <= r[i + 1].x) { lo = r[i]; hi = r[i + 1]; break; }
  if (hi.x === lo.x) return { l: lo.l, m: lo.m, s: lo.s };
  const t = (x - lo.x) / (hi.x - lo.x);
  return { l: lo.l + t * (hi.l - lo.l), m: lo.m + t * (hi.m - lo.m), s: lo.s + t * (hi.s - lo.s) };
}

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 100) / 100;
}

export const GROWTH_PENDING_MESSAGE =
  'Referência de crescimento pendente: nenhuma tabela oficial (OMS/Ministério da Saúde) foi importada. ' +
  'São exibidos apenas o histórico de medidas e o IMC calculado. Nenhuma curva, percentil ou escore é estimado.';
