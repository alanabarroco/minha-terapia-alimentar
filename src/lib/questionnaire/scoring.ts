// Pontuação DESCRITIVA. Sem pontos de corte, percentis, gravidade ou risco diagnóstico.
// Método (documentado também na tela de resultado):
//  - cada resposta vale 0 (Nunca) a 4 (Sempre); "não se aplica/não observado" (null) sai do cálculo;
//  - média da área = soma das respostas ÷ número de itens respondidos (escala 0–4);
//  - todos os itens têm a mesma direção: maior valor = dificuldade relatada com maior frequência;
//  - a área só é calculada com respostas suficientes: no mínimo 3 itens e 60% dos itens da área.
import { AREAS, AreaId, AgeBand, itemsForArea, versionKey } from './items';

export type Answers = Record<string, number | null | undefined>;
export const MIN_ANSWERED_ABS = 3;
export const MIN_ANSWERED_RATIO = 0.6;

export type AreaResult = {
  area: AreaId;
  label: string;
  totalItems: number;
  answered: number;
  notApplicable: number;
  unanswered: number;
  mean: number | null; // 0–4
  sufficient: boolean;
  frequentItems: string[]; // respostas 3 ou 4
  observedSkills: string[]; // respostas 0 ou 1
};

export function requiredAnswers(total: number): number {
  return Math.max(MIN_ANSWERED_ABS, Math.ceil(total * MIN_ANSWERED_RATIO));
}

export function scoreArea(band: AgeBand, area: AreaId, answers: Answers): AreaResult {
  const items = itemsForArea(band, area);
  const label = AREAS.find((a) => a.id === area)!.label;
  let sum = 0, answered = 0, notApplicable = 0, unanswered = 0;
  const frequentItems: string[] = [], observedSkills: string[] = [];
  for (const it of items) {
    const v = answers[it.id];
    if (v === undefined) { unanswered++; continue; }
    if (v === null) { notApplicable++; continue; }
    if (!Number.isInteger(v) || v < 0 || v > 4) throw new Error(`Resposta inválida para ${it.id}`);
    sum += v; answered++;
    if (v >= 3) frequentItems.push(it.id);
    if (v <= 1) observedSkills.push(it.id);
  }
  const sufficient = answered >= requiredAnswers(items.length);
  return {
    area, label, totalItems: items.length, answered, notApplicable, unanswered,
    mean: sufficient ? Math.round((sum / answered) * 100) / 100 : null,
    sufficient, frequentItems, observedSkills,
  };
}

export function scoreQuestionnaire(band: AgeBand, answers: Answers): AreaResult[] {
  return AREAS.map((a) => scoreArea(band, a.id, answers));
}

export type ResponseRow = { id: string; age_band: AgeBand; version: string; answered_on: string; answers: Answers };

// Só compara respostas da MESMA faixa e versão (itens diferentes não são equivalentes).
export function comparableSeries(rows: ResponseRow[], band: AgeBand): {
  version: string; points: { id: string; date: string; areas: AreaResult[] }[];
} {
  const key = versionKey(band);
  const pts = rows
    .filter((r) => r.age_band === band && r.version === key)
    .sort((a, b) => a.answered_on.localeCompare(b.answered_on))
    .map((r) => ({ id: r.id, date: r.answered_on, areas: scoreQuestionnaire(band, r.answers) }));
  return { version: key, points: pts };
}

export function groupByComparability(rows: ResponseRow[]): Record<string, ResponseRow[]> {
  const g: Record<string, ResponseRow[]> = {};
  for (const r of rows) (g[`${r.age_band}|${r.version}`] ||= []).push(r);
  return g;
}

// Mudança entre duas aplicações comparáveis, por área; null se alguma não tiver respostas suficientes
export function changeBetween(prev: AreaResult[], next: AreaResult[]) {
  return next.map((n, i) => {
    const p = prev[i];
    return { area: n.area, label: n.label, delta: p.mean !== null && n.mean !== null ? Math.round((n.mean - p.mean) * 100) / 100 : null };
  });
}
