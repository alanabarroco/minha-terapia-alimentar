import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, AGE_BANDS, AREAS, itemsForArea, OPTIONS } from '../src/lib/questionnaire/items';
import { scoreArea, scoreQuestionnaire, comparableSeries, requiredAnswers, changeBetween } from '../src/lib/questionnaire/scoring';
import { ageInMonths, ageBandFor, ageLabel, fromBR, toBR, ageInYears } from '../src/lib/age';
import { lmsZ, lmsZExtended, lmsValueAtZ, interpolateLMS, bmi } from '../src/lib/growth/zscore';

test('cada faixa tem de 4 a 6 itens por área, ids únicos e textos não vazios', () => {
  const ids = new Set<string>();
  for (const b of AGE_BANDS) for (const a of AREAS) {
    const n = itemsForArea(b.id, a.id).length;
    assert.ok(n >= 4 && n <= 6, `${b.id}.${a.id} tem ${n} itens`);
  }
  for (const i of ITEMS) { assert.ok(i.text.trim().length > 10); assert.ok(!ids.has(i.id)); ids.add(i.id); }
  assert.equal(AGE_BANDS.length, 6);
  assert.equal(OPTIONS.length, 6);
});

test('itens não se repetem dentro de uma faixa', () => {
  for (const b of AGE_BANDS) {
    const t = ITEMS.filter((i) => i.band === b.id).map((i) => i.text);
    assert.equal(new Set(t).size, t.length);
  }
});

test('média exclui "não se aplica" do denominador', () => {
  const r = scoreArea('2_5', 'A', { '2_5.A.1': 4, '2_5.A.2': 2, '2_5.A.3': 0, '2_5.A.4': null, '2_5.A.5': null });
  assert.equal(r.answered, 3); assert.equal(r.notApplicable, 2);
  assert.equal(r.mean, 2); // (4+2+0)/3
  assert.deepEqual(r.frequentItems, ['2_5.A.1']);
  assert.deepEqual(r.observedSkills, ['2_5.A.3']);
});

test('sem respostas suficientes não há resultado', () => {
  const r = scoreArea('2_5', 'B', { '2_5.B.1': 4, '2_5.B.2': 4, '2_5.B.3': null, '2_5.B.4': null });
  assert.equal(r.answered, 2); assert.equal(r.sufficient, false); assert.equal(r.mean, null);
  assert.equal(scoreArea('menor_2', 'A', {}).mean, null);
});

test('mínimo exigido: 3 itens e 60% da área', () => {
  assert.equal(requiredAnswers(4), 3); assert.equal(requiredAnswers(5), 3); assert.equal(requiredAnswers(6), 4);
  const r = scoreArea('menor_2', 'A', { 'menor_2.A.1': 1, 'menor_2.A.2': 1, 'menor_2.A.3': 1 });
  assert.equal(r.sufficient, true); assert.equal(r.mean, 1); assert.equal(r.unanswered, 1);
});

test('arredondamento a duas casas e valor inválido é rejeitado', () => {
  const r = scoreArea('menor_2', 'A', { 'menor_2.A.1': 1, 'menor_2.A.2': 1, 'menor_2.A.3': 2 });
  assert.equal(r.mean, 1.33);
  assert.throws(() => scoreArea('menor_2', 'A', { 'menor_2.A.1': 7 as any }));
});

test('resultado tem quatro áreas e não traz classificação nem risco', () => {
  const res = scoreQuestionnaire('6_9', {});
  assert.equal(res.length, 4);
  for (const r of res) for (const k of Object.keys(r)) assert.ok(!/risco|gravidade|percentil|corte|classific/i.test(k));
});

test('série comparável só junta mesma faixa e versão', () => {
  const rows = [
    { id: '1', age_band: '2_5' as const, version: '2_5-v1', answered_on: '2026-02-01', answers: { '2_5.A.1': 4, '2_5.A.2': 4, '2_5.A.3': 4 } },
    { id: '2', age_band: '2_5' as const, version: '2_5-v1', answered_on: '2026-01-01', answers: { '2_5.A.1': 0, '2_5.A.2': 0, '2_5.A.3': 0 } },
    { id: '3', age_band: '6_9' as const, version: '6_9-v1', answered_on: '2026-03-01', answers: {} },
    { id: '4', age_band: '2_5' as const, version: '2_5-v0', answered_on: '2026-04-01', answers: {} },
  ];
  const s = comparableSeries(rows, '2_5');
  assert.deepEqual(s.points.map((p) => p.id), ['2', '1']);
  const ch = changeBetween(s.points[0].areas, s.points[1].areas);
  assert.equal(ch[0].delta, 4); assert.equal(ch[1].delta, null);
});

test('idade em meses/anos e faixa etária', () => {
  assert.equal(ageInMonths('2020-03-15', '2026-03-14'), 71);
  assert.equal(ageInMonths('2020-03-15', '2026-03-15'), 72);
  assert.equal(ageInYears('2020-03-15', '2026-03-15'), 6);
  assert.equal(ageLabel('2025-01-10', '2026-03-10'), '1 ano e 2 meses');
  assert.equal(ageLabel('2026-01-10', '2026-03-10'), '2 meses');
  const on = '2026-06-01';
  const cases: [string, string][] = [['2025-01-01', 'menor_2'], ['2024-05-31', '2_5'], ['2020-06-01', '6_9'], ['2016-06-01', '10_12'], ['2013-06-01', '13_17'], ['2008-06-01', '18_mais']];
  for (const [b, band] of cases) assert.equal(ageBandFor(b, on), band, `${b}`);
  assert.equal(ageBandFor('2024-06-02', on), 'menor_2'); // 1 ano e 11 meses
  assert.equal(ageBandFor('2024-06-01', on), '2_5');     // 2 anos exatos
  assert.equal(ageBandFor('2020-06-02', on), '2_5');     // 5 anos e 11 meses
  assert.equal(ageBandFor('2008-06-02', on), '13_17');   // 17 anos e 11 meses
});

test('datas DD/MM/AAAA', () => {
  assert.equal(toBR('2026-11-05'), '05/11/2026');
  assert.equal(fromBR('05/11/2026'), '2026-11-05');
  assert.equal(fromBR('31/02/2026'), null);
  assert.equal(fromBR('2026-11-05'), null);
});

// ---- Crescimento: método LMS verificado com parâmetros SINTÉTICOS (não são curva de referência) ----
test('LMS: casos analíticos', () => {
  assert.ok(Math.abs(lmsZ(12, { l: 1, m: 10, s: 0.1 }) - 2) < 1e-12);
  assert.ok(Math.abs(lmsZ(10, { l: -0.5, m: 10, s: 0.1 })) < 1e-12);
  assert.ok(Math.abs(lmsZ(Math.exp(0.1) * 10, { l: 0, m: 10, s: 0.1 }) - 1) < 1e-12);
  for (const z of [-3, -1.5, 0, 2, 3]) {
    const lms = { l: -0.3, m: 14, s: 0.08 };
    assert.ok(Math.abs(lmsZ(lmsValueAtZ(z, lms), lms) - z) < 1e-9);
  }
});

test('LMS: ajuste de |z|>3 é contínuo e não altera valores dentro de ±3', () => {
  const lms = { l: 1, m: 10, s: 0.1 };
  assert.equal(lmsZExtended(12, lms), lmsZ(12, lms));
  const at3 = lmsValueAtZ(3, lms);
  assert.ok(Math.abs(lmsZExtended(at3, lms) - 3) < 1e-9);
  assert.ok(lmsZExtended(at3 + 1, lms) > 3);
  assert.ok(lmsZExtended(lmsValueAtZ(-3, lms) - 1, lms) < -3);
});

test('LMS: interpolação e limites', () => {
  const rows = [{ x: 0, l: 1, m: 10, s: 0.1 }, { x: 10, l: 0, m: 20, s: 0.2 }];
  assert.deepEqual(interpolateLMS(rows, 5), { l: 0.5, m: 15, s: 0.15000000000000002 });
  assert.equal(interpolateLMS(rows, 11), null);
  assert.equal(interpolateLMS([], 1), null);
  assert.throws(() => lmsZ(-1, { l: 1, m: 10, s: 0.1 }));
});

test('IMC', () => { assert.equal(bmi(12, 90), 14.81); assert.equal(bmi(70, 175), 22.86); });
