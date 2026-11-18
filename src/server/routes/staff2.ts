import { h, join, Raw } from '../html';
import { Ctx, htmlRes, page, redirect, csrfField, fv, fvAll, notFound } from '../web';
import { asUser, J, J1, Tx, insertRow, updateRow, isUuid } from '../db';
import { staffRoute, patientShell, loadPatient, empty, statusTag, savedAt, table, kv, nameMap, staffOptions, formShell, canPublish } from '../ui';
import { renderGroups, readFields, flatFields, colsOf, renderField, fmtNum } from '../forms';
import { SESSION_GROUPS, PLAN_FIELDS, GUIDANCE_FIELDS, REPERTOIRE_FIELDS, EXPLORATION_STEPS, LOCATIONS, locLabel, PROGRESS, TERMS, REFERRALS, FOOD_GROUPS, STATUS_LABEL } from '../entities';
import { storeUpload } from '../files';
import { areaBars, evolutionChart, AREA_COLOR } from '../charts';
import { renderContent, KIND_LABEL } from '../content';
import { AGE_BANDS, AREAS, OPTIONS, ITEMS, itemsFor, itemsForArea, versionKey, QUESTIONNAIRE_NAME, QUESTIONNAIRE_NOTE, QUESTIONNAIRE_VERSION, AgeBand } from '../../lib/questionnaire/items';
import { scoreQuestionnaire, changeBetween, MIN_ANSWERED_ABS, MIN_ANSWERED_RATIO } from '../../lib/questionnaire/scoring';
import { ageBandFor, toBR, todayISO, dateTimeBR } from '../../lib/age';

const nf = (c: Ctx) => notFound(c);
const bandLabel = (b: string) => AGE_BANDS.find((x) => x.id === b)?.label ?? b;
const optLabel = (v: number | null | undefined) => (v === undefined ? 'Sem resposta' : OPTIONS.find((o) => o.value === v)?.label ?? '');

// ===================== QUESTIONÁRIOS =====================
staffRoute('GET', '/app/pacientes/:pid/questionarios', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const rows = await J<any>(tx, `select id, age_band, version, answered_on, status, interviewee, updated_at from public.questionnaire_responses where patient_id = $1 order by answered_on desc, created_at desc`, [p.id]);
  const suggested = ageBandFor(p.birth_date, todayISO());
  // evolução: só respostas finalizadas da MESMA faixa e versão
  const fin = await J<any>(tx, `select * from public.questionnaire_responses where patient_id = $1 and status = 'finalizado' order by answered_on, created_at`, [p.id]);
  const groups: Record<string, any[]> = {};
  for (const r of fin) (groups[`${r.age_band}|${r.version}`] ||= []).push(r);
  const evo = Object.entries(groups).filter(([, v]) => v.length >= 2).map(([k, v]) => {
    const [band] = k.split('|');
    const scored = v.map((r) => scoreQuestionnaire(r.age_band, r.answers));
    return h`<section class="card"><h3>${bandLabel(band)} — versão ${v[0].version}</h3>
${evolutionChart(v.map((r) => toBR(r.answered_on)), AREAS.map((a, i) => ({ name: a.label, color: AREA_COLOR[a.id], values: scored.map((s) => s[i].mean) })))}
<p class="small muted">Médias de 0 (Nunca) a 4 (Sempre); quanto maior, mais frequente a dificuldade relatada. Áreas com respostas insuficientes ficam sem ponto. Só são comparadas aplicações da mesma faixa e versão.</p></section>`;
  });
  return patientShell(c, p, 'questionarios', h`
<div class="notice"><strong>${QUESTIONNAIRE_NAME}</strong> — ${QUESTIONNAIRE_NOTE}</div>
<form method="get" action="/app/pacientes/${p.id}/questionarios/novo" class="row" style="align-items:end"><label>Faixa etária do questionário<select name="faixa">${AGE_BANDS.map((b) => h`<option value="${b.id}" ${b.id === suggested ? 'selected' : ''}>${b.label}${b.id === suggested ? ' (idade atual)' : ''}</option>`)}</select></label>
<div class="actions"><button class="btn primary">Novo questionário</button></div></form>
${table(['Data', 'Faixa', 'Respondente', 'Situação', ''], rows.map((r) => [h`${toBR(r.answered_on)}`, h`${bandLabel(r.age_band)}`, h`${r.interviewee ?? ''}`, statusTag(r.status),
  h`<a class="btn small" href="/app/pacientes/${p.id}/questionarios/${r.id}/resultado">Resultado</a> <a class="btn small" href="/app/pacientes/${p.id}/questionarios/${r.id}">Editar</a>`]), 'Nenhum questionário aplicado.')}
${evo.length ? h`<h2>Mudanças ao longo do acompanhamento</h2>${evo}` : rows.length ? h`<p class="small muted">A evolução aparece quando houver duas ou mais aplicações finalizadas da mesma faixa etária.</p>` : ''}`);
});

function qForm(c: Ctx, p: any, band: AgeBand, q: any | null) {
  const ans = q?.answers ?? {};
  const v = (id: string): string => (id in ans ? (ans[id] === null ? 'na' : String(ans[id])) : '');
  return patientShell(c, p, 'questionarios', h`<h2>${QUESTIONNAIRE_NAME}</h2><p class="muted">${bandLabel(band)} · ${QUESTIONNAIRE_NOTE}</p>
<p class="small">Preencha a partir da entrevista com responsáveis ou paciente. Escala: Nunca (0) a Sempre (4); "Não se aplica / não foi observado" não entra no cálculo. Todos os itens descrevem uma situação a observar: respostas mais frequentes indicam dificuldade relatada com mais frequência.</p>
${q ? savedAt(q.updated_at) : ''}
${formShell(c, q ? `/app/pacientes/${p.id}/questionarios/${q.id}` : `/app/pacientes/${p.id}/questionarios`, h`<input type="hidden" name="age_band" value="${band}">
<div class="row"><label>Data da aplicação *<input name="answered_on" value="${toBR(q?.answered_on ?? todayISO())}" required pattern="\\d{2}/\\d{2}/\\d{4}" data-mask="date" inputmode="numeric" maxlength="10"></label>
<label>Respondente<input name="interviewee" value="${q?.interviewee ?? ''}" placeholder="Ex.: mãe, pai, próprio paciente"></label></div>
${AREAS.map((a) => h`<fieldset class="card"><legend>${a.id}. ${a.label}</legend><p class="hint">${a.hint}</p>
${itemsForArea(band, a.id).map((it) => h`<div class="item" role="group" aria-labelledby="l_${it.id}"><p id="l_${it.id}">${it.text}</p><div class="scale">
${OPTIONS.map((o) => { const val = o.value === null ? 'na' : String(o.value); return h`<label class="check"><input type="radio" name="q_${it.id}" value="${val}" ${v(it.id) === val ? 'checked' : ''}> ${o.label}</label>`; })}</div></div>`)}</fieldset>`)}
<fieldset class="card"><legend>Raciocínio clínico e encaminhamentos</legend><p class="hint">A decisão de encaminhar é do profissional; o sistema não sugere encaminhamento por pontuação.</p>
<label>Raciocínio clínico<textarea name="clinical_reasoning">${q?.clinical_reasoning ?? ''}</textarea></label>
<div class="scale">${REFERRALS.map(([k, l]) => h`<label class="check"><input type="checkbox" name="referral_areas" value="${k}" ${(q?.referral_areas ?? []).includes(k) ? 'checked' : ''}> Avaliar necessidade de ${l.toLowerCase()}</label>`)}</div>
<label>Notas internas<textarea name="internal_notes">${q?.internal_notes ?? ''}</textarea></label></fieldset>`,
  h`<button class="btn" name="_acao" value="rascunho">Salvar rascunho</button><button class="btn primary" name="_acao" value="finalizado">Salvar e finalizar</button><a class="btn" href="/app/pacientes/${p.id}/questionarios">Voltar</a>`)}`);
}
staffRoute('GET', '/app/pacientes/:pid/questionarios/novo', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const band = c.url.searchParams.get('faixa') as AgeBand;
  if (!AGE_BANDS.some((b) => b.id === band)) return redirect(c, `/app/pacientes/${p.id}/questionarios`, { err: 'Escolha uma faixa etária.' });
  return qForm(c, p, band, null);
});
staffRoute('GET', '/app/pacientes/:pid/questionarios/:qid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.qid)) return nf(c);
  const q = await J1<any>(tx, `select * from public.questionnaire_responses where id = $1 and patient_id = $2`, [c.params.qid, p.id]);
  return q ? qForm(c, p, q.age_band, q) : nf(c);
});
async function saveQ(c: Ctx, tx: Tx, qid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  let band = fv(c, 'age_band') as AgeBand;
  if (qid) { const old = await J1<any>(tx, `select age_band from public.questionnaire_responses where id = $1 and patient_id = $2`, [qid, p.id]); if (!old) return nf(c); band = old.age_band; }
  if (!AGE_BANDS.some((b) => b.id === band)) return nf(c);
  const date = readFields(c, [{ name: 'answered_on', label: 'Data da aplicação', type: 'date', required: true }]);
  if (date.errors.length) return redirect(c, c.req.headers.get('referer') ?? '/app', { err: date.errors.join(' ') });
  const answers: Record<string, number | null> = {};
  for (const it of itemsFor(band)) {
    const v = fv(c, 'q_' + it.id);
    if (v === 'na') answers[it.id] = null; else if (/^[0-4]$/.test(v)) answers[it.id] = Number(v);
  }
  const refs = fvAll(c, 'referral_areas').filter((x) => REFERRALS.some((r) => r[0] === x));
  const cols: any[] = [{ name: 'age_band', type: 'text' }, { name: 'version', type: 'text' }, { name: 'answered_on', type: 'date' }, { name: 'interviewee', type: 'text' }, { name: 'answers', type: 'jsonb' },
    { name: 'clinical_reasoning', type: 'text' }, { name: 'referral_areas', type: 'multi' }, { name: 'status', type: 'text' }, { name: 'internal_notes', type: 'text' }];
  const vals = { age_band: band, version: versionKey(band), answered_on: date.values.answered_on, interviewee: fv(c, 'interviewee'), answers, clinical_reasoning: fv(c, 'clinical_reasoning'),
    referral_areas: refs, status: fv(c, '_acao') === 'finalizado' ? 'finalizado' : 'rascunho', internal_notes: fv(c, 'internal_notes') };
  if (qid) await updateRow(tx, 'questionnaire_responses', qid, cols, vals);
  else qid = await insertRow(tx, 'questionnaire_responses', [{ name: 'patient_id', type: 'uuid' }, ...cols], { patient_id: p.id, ...vals });
  return redirect(c, vals.status === 'finalizado' ? `/app/pacientes/${p.id}/questionarios/${qid}/resultado` : `/app/pacientes/${p.id}/questionarios/${qid}`, { ok: vals.status === 'finalizado' ? 'Questionário finalizado.' : 'Rascunho salvo.' });
}
staffRoute('POST', '/app/pacientes/:pid/questionarios', (c, tx) => saveQ(c, tx));
staffRoute('POST', '/app/pacientes/:pid/questionarios/:qid', (c, tx) => saveQ(c, tx, c.params.qid));

staffRoute('GET', '/app/pacientes/:pid/questionarios/:qid/resultado', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.qid)) return nf(c);
  const q = await J1<any>(tx, `select * from public.questionnaire_responses where id = $1 and patient_id = $2`, [c.params.qid, p.id]);
  if (!q) return nf(c);
  const res = scoreQuestionnaire(q.age_band, q.answers);
  const prev = await J1<any>(tx, `select * from public.questionnaire_responses where patient_id = $1 and age_band = $2 and version = $3 and status = 'finalizado' and id <> $4 and (answered_on, created_at) < ($5::date, $6::timestamptz) order by answered_on desc, created_at desc limit 1`,
    [p.id, q.age_band, q.version, q.id, q.answered_on, q.created_at]);
  const delta = prev ? changeBetween(scoreQuestionnaire(prev.age_band, prev.answers), res) : null;
  const ranked = res.filter((r) => r.mean !== null).sort((a, b) => b.mean! - a.mean!);
  const text = (id: string) => ITEMS.find((i) => i.id === id)?.text ?? id;
  return patientShell(c, p, 'questionarios', h`<h2>Resultado — ${bandLabel(q.age_band)} · ${toBR(q.answered_on)} ${statusTag(q.status)}</h2>
<div class="notice">${QUESTIONNAIRE_NOTE} Os valores abaixo são um <strong>resumo descritivo</strong> das respostas; não há pontos de corte, percentis, classificação de gravidade nem risco diagnóstico.</div>
${areaBars(res)}
<details open><summary>Como o cálculo é feito</summary><p class="small">Cada resposta vale de 0 (Nunca) a 4 (Sempre). A média da área é a soma das respostas dividida pelo número de itens respondidos; "não se aplica / não foi observado" fica fora do cálculo. Todos os itens têm a mesma direção: valores maiores significam dificuldade relatada com maior frequência. A média só é calculada com pelo menos ${MIN_ANSWERED_ABS} itens respondidos e ${MIN_ANSWERED_RATIO * 100}% da área. Versões de faixas etárias diferentes não são equivalentes e não são comparadas.</p></details>
${table(['Área', 'Itens respondidos', 'Não se aplica', 'Sem resposta', 'Média (0–4)'], res.map((r) => [h`${r.label}`, h`${r.answered} de ${r.totalItems}`, h`${r.notApplicable}`, h`${r.unanswered}`, r.mean !== null ? h`<b>${String(r.mean).replace('.', ',')}</b>` : h`<span class="muted">respostas insuficientes</span>`]), '')}
${ranked.length ? h`<p><strong>Áreas com dificuldades relatadas com maior frequência nesta aplicação (ordem das médias):</strong> ${ranked.map((r) => `${r.label} (${String(r.mean).replace('.', ',')})`).join('; ')}.</p>` : h`<p class="muted">Não há respostas suficientes para resumir as áreas.</p>`}
<div class="split"><section class="card"><h3>Pontos para avaliação profissional</h3><p class="hint">Itens respondidos como "Frequentemente" ou "Sempre". Servem para investigar, não para diagnosticar.</p>
${res.map((r) => (r.frequentItems.length ? h`<p><strong>${r.label}</strong></p><ul>${r.frequentItems.map((id) => h`<li>${text(id)} <span class="tag">${optLabel(q.answers[id])}</span></li>`)}</ul>` : '')) || ''}
${res.every((r) => !r.frequentItems.length) ? h`<p class="muted">Nenhum item marcado como frequente ou sempre.</p>` : ''}</section>
<section class="card"><h3>Habilidades observadas</h3><p class="hint">Itens respondidos como "Nunca" ou "Raramente" (a dificuldade descrita quase não aparece).</p>
${res.map((r) => (r.observedSkills.length ? h`<p><strong>${r.label}</strong></p><ul>${r.observedSkills.map((id) => h`<li>${text(id)} <span class="tag">${optLabel(q.answers[id])}</span></li>`)}</ul>` : ''))}
${res.every((r) => !r.observedSkills.length) ? h`<p class="muted">Nenhum item nesta condição.</p>` : ''}</section></div>
<section class="card"><h3>Raciocínio clínico e encaminhamentos</h3>${kv([['Raciocínio clínico', q.clinical_reasoning], ['Avaliação a considerar', (q.referral_areas ?? []).map((k: string) => REFERRALS.find((r) => r[0] === k)?.[1]).join(', ')], ['Respondente', q.interviewee]])}
<p class="small muted">A decisão de encaminhamento pertence ao profissional.</p></section>
${delta ? h`<section class="card"><h3>Mudança desde ${toBR(prev.answered_on)} (mesma faixa e versão)</h3>${table(['Área', 'Variação da média'], delta.map((d) => [h`${d.label}`, d.delta === null ? h`<span class="muted">não calculável</span>` : h`${d.delta > 0 ? '+' : ''}${String(d.delta).replace('.', ',')}`]), '')}<p class="small muted">Valor negativo = dificuldade relatada com menor frequência que na aplicação anterior.</p></section>` : h`<p class="small muted">Sem aplicação anterior comparável (mesma faixa e versão) para mostrar mudança.</p>`}
<div class="actions"><a class="btn" href="/app/pacientes/${p.id}/questionarios/${q.id}">Editar respostas</a><a class="btn" href="/app/pacientes/${p.id}/questionarios">Voltar</a></div>`);
});

staffRoute('GET', '/app/avaliacoes', async (c, tx) => {
  const qs = await J<any>(tx, `select q.id, q.patient_id, q.age_band, q.answered_on, q.status, p.full_name from public.questionnaire_responses q join public.patients p on p.id = q.patient_id order by (q.status = 'rascunho') desc, q.answered_on desc limit 60`);
  const an = await J<any>(tx, `select a.id, a.patient_id, a.status, a.recorded_on, p.full_name from public.anamneses a join public.patients p on p.id = a.patient_id order by (a.status = 'rascunho') desc, a.recorded_on desc limit 60`);
  return htmlRes(c, page(c, { title: 'Avaliações e questionários', body: h`<h1>Avaliações e questionários</h1><p class="muted">Rascunhos aparecem primeiro (avaliações pendentes).</p>
<h2>Questionários de observação</h2>${table(['Data', 'Paciente', 'Faixa', 'Situação'], qs.map((q) => [h`${toBR(q.answered_on)}`, h`<a href="/app/pacientes/${q.patient_id}/questionarios/${q.id}/resultado">${q.full_name}</a>`, h`${bandLabel(q.age_band)}`, statusTag(q.status)]), 'Nenhum questionário aplicado.')}
<h2>Anamneses</h2>${table(['Data', 'Paciente', 'Situação'], an.map((a) => [h`${toBR(a.recorded_on)}`, h`<a href="/app/pacientes/${a.patient_id}/anamnese">${a.full_name}</a>`, statusTag(a.status)]), 'Nenhuma anamnese registrada.')}` }));
});

// ===================== MAPA ALIMENTAR =====================
staffRoute('GET', '/app/pacientes/:pid/mapa', async (c, tx) => repertoireView(c, tx, null));
staffRoute('GET', '/app/pacientes/:pid/mapa/:rid', async (c, tx) => {
  if (!isUuid(c.params.rid)) return nf(c);
  const r = await J1<any>(tx, `select * from public.food_repertoire where id = $1 and patient_id = $2`, [c.params.rid, c.params.pid]);
  return r ? repertoireView(c, tx, r) : nf(c);
});
async function repertoireView(c: Ctx, tx: Tx, editing: any | null, errors: string[] = []) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const foods = await J<any>(tx, `select * from public.food_repertoire where patient_id = $1 order by food_group nulls last, food_name`, [p.id]);
  const q = await J1<any>(tx, `select * from public.questionnaire_responses where patient_id = $1 and status = 'finalizado' order by answered_on desc, created_at desc limit 1`, [p.id]);
  const count = (a: string) => foods.filter((f) => f.acceptance === a).length;
  const groups = [...new Set(foods.map((f) => f.food_group ?? 'Sem grupo informado'))];
  const uniq = (k: string) => [...new Set(foods.flatMap((f) => String(f[k] ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)))];
  const sens = q ? itemsForArea(q.age_band, 'B').map((it) => ({ it, v: q.answers[it.id] })).filter((x) => x.v !== undefined) : [];
  return patientShell(c, p, 'mapa', h`
${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}
<div class="notice warn">Estes mapas descrevem o que foi registrado. <strong>Não indicam deficiência nutricional</strong> e não estimam ingestão, calorias ou nutrientes; a ausência de um grupo ou de fotos não permite conclusões.</div>
<h2>1. Mapa de variedade alimentar (repertório)</h2>
<div class="grid"><div class="stat"><b>${count('aceito')}</b><span>aceitos</span></div><div class="stat"><b>${count('em_exploracao')}</b><span>em exploração</span></div><div class="stat"><b>${count('recusado')}</b><span>recusados</span></div></div>
${foods.length ? table(['Grupo alimentar', 'Aceitos', 'Em exploração', 'Recusados'], groups.map((g) => {
  const of = (a: string) => foods.filter((f) => (f.food_group ?? 'Sem grupo informado') === g && f.acceptance === a);
  const cell = (a: string) => h`${of(a).map((f) => h`<a class="tag ${a === 'recusado' ? 'warn' : a === 'em_exploracao' ? 'lilac' : ''}" href="/app/pacientes/${p.id}/mapa/${f.id}">${f.food_name}</a>`)}`;
  return [h`${g}`, cell('aceito'), cell('em_exploracao'), cell('recusado')];
}), '') : empty('Nenhum alimento registrado no repertório.')}
${foods.length ? kv([['Texturas', uniq('textures').join(', ')], ['Temperaturas', uniq('temperatures').join(', ')], ['Marcas', uniq('brands').join(', ')], ['Preparações', uniq('preparations').join(', ')],
  ['Contextos em que a aceitação muda', foods.filter((f) => f.context_notes).map((f) => `${f.food_name}: ${f.context_notes}`).join('\n')]]) : ''}
<section class="card"><h3>${editing ? 'Editar alimento' : 'Registrar alimento'}</h3>
${formShell(c, editing ? `/app/pacientes/${p.id}/mapa/${editing.id}` : `/app/pacientes/${p.id}/mapa`, h`<div class="row">${REPERTOIRE_FIELDS.map((f) => renderField(f, editing ?? {}))}</div>`,
  h`<button class="btn primary">Salvar alimento</button>${editing ? h`<a class="btn" href="/app/pacientes/${p.id}/mapa">Cancelar</a>` : ''}`)}</section>
<h2>2. Mapa de respostas sensoriais (separado da variedade alimentar)</h2>
${sens.length ? h`<p class="small muted">Baseado na área "Respostas sensoriais" do questionário de ${toBR(q.answered_on)} (${bandLabel(q.age_band)}).</p>
${table(['Observação', 'Frequência relatada'], [...sens].sort((a, b) => (b.v ?? -1) - (a.v ?? -1)).map((x) => [h`${x.it.text}`, h`${optLabel(x.v)}`]), '')}`
 : empty('Sem questionário finalizado: o mapa de respostas sensoriais depende da área B do questionário.')}
${q ? h`<section class="card"><h3>Raciocínio clínico (último questionário)</h3>${kv([['Raciocínio', q.clinical_reasoning], ['Avaliação a considerar', (q.referral_areas ?? []).map((k: string) => REFERRALS.find((r) => r[0] === k)?.[1]).join(', ')]])}</section>` : ''}`);
}
async function saveFood(c: Ctx, tx: Tx, rid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const r = readFields(c, REPERTOIRE_FIELDS);
  if (r.errors.length) return repertoireView(c, tx, { id: rid, ...r.values }, r.errors);
  if (rid) await updateRow(tx, 'food_repertoire', rid, colsOf(REPERTOIRE_FIELDS), r.values);
  else await insertRow(tx, 'food_repertoire', [{ name: 'patient_id', type: 'uuid' }, ...colsOf(REPERTOIRE_FIELDS)], { patient_id: p.id, ...r.values });
  return redirect(c, `/app/pacientes/${p.id}/mapa`, { ok: 'Alimento salvo.' });
}
staffRoute('POST', '/app/pacientes/:pid/mapa', (c, tx) => saveFood(c, tx));
staffRoute('POST', '/app/pacientes/:pid/mapa/:rid', (c, tx) => saveFood(c, tx, c.params.rid));

// ===================== SESSÕES =====================
staffRoute('GET', '/app/pacientes/:pid/sessoes', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const rows = await J<any>(tx, `select id, session_date, start_time, location, status, objectives, updated_at from public.sessions where patient_id = $1 order by session_date desc`, [p.id]);
  const staff = await staffOptions(tx);
  return patientShell(c, p, 'sessoes', h`<div class="actions"><a class="btn primary" href="/app/pacientes/${p.id}/sessoes/novo">Registrar sessão</a></div>
<details class="card"><summary>Agendar sessão futura</summary>${formShell(c, `/app/pacientes/${p.id}/sessoes/agendar`, h`<div class="row">
${renderField({ name: 'session_date', label: 'Data', type: 'date', required: true }, {})}${renderField({ name: 'start_time', label: 'Horário', type: 'time' }, {})}
${renderField({ name: 'location', label: 'Local', type: 'select', options: LOCATIONS }, {})}${renderField({ name: 'professional_id', label: 'Profissional', type: 'select', options: staff }, { professional_id: c.user!.id })}
${renderField({ name: 'objectives', label: 'Objetivo previsto', type: 'text' }, {})}</div>`, h`<button class="btn primary">Agendar</button>`)}</details>
${table(['Data', 'Local', 'Objetivos', 'Situação', ''], rows.map((s) => [h`${toBR(s.session_date)} ${s.start_time ? String(s.start_time).slice(0, 5) : ''}`, h`${locLabel(s.location)}`, h`${(s.objectives ?? '').slice(0, 90)}`, statusTag(s.status),
  h`<a class="btn small" href="/app/pacientes/${p.id}/sessoes/${s.id}">Abrir</a>`]), 'Nenhuma sessão registrada.')}`);
});
staffRoute('POST', '/app/pacientes/:pid/sessoes/agendar', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const f = [{ name: 'session_date', label: 'Data', type: 'date' as const, required: true }, { name: 'start_time', label: 'Horário', type: 'time' as const },
    { name: 'location', label: 'Local', type: 'select' as const, options: LOCATIONS }, { name: 'professional_id', label: 'Profissional', type: 'text' as const }, { name: 'objectives', label: 'Objetivo', type: 'text' as const }];
  const r = readFields(c, f);
  if (r.errors.length) return redirect(c, `/app/pacientes/${p.id}/sessoes`, { err: r.errors.join(' ') });
  const id = await insertRow(tx, 'sessions', [{ name: 'patient_id', type: 'uuid' }, ...colsOf(f).map((x) => (x.name === 'professional_id' ? { ...x, type: 'uuid' as const } : x)), { name: 'status', type: 'text' }], { patient_id: p.id, ...r.values, status: 'agendada' });
  return redirect(c, `/app/pacientes/${p.id}/sessoes`, { ok: 'Sessão agendada.' });
});

const EX_ROWS = 4;
async function sessionForm(c: Ctx, tx: Tx, p: any, s: any | null, errors: string[] = []) {
  const staff = await staffOptions(tx);
  const names = await nameMap(tx);
  const groups = SESSION_GROUPS(staff);
  const ex: any[] = Array.isArray(s?.exploration) ? s.exploration : [];
  const rows = [...ex, ...Array.from({ length: Math.max(EX_ROWS - ex.length, 1) }, () => ({ alimento: '', etapas: [] }))];
  const exRow = (r: any, i: string | number) => h`<div data-row-of="exrow" class="card"><label>Alimento / preparação<input name="ex_n_${i}" value="${r.alimento ?? ''}"></label>
<div class="scale">${EXPLORATION_STEPS.map(([k, l]) => h`<label class="check"><input type="checkbox" name="ex_s_${i}" value="${k}" ${(r.etapas ?? []).includes(k) ? 'checked' : ''}> ${l}</label>`)}</div></div>`;
  const atts = s?.id ? await J<any>(tx, `select id, title, storage_path from public.documents where session_id = $1 order by created_at`, [s.id]) : [];
  return patientShell(c, p, 'sessoes', h`<h2>${s?.id ? 'Sessão' : 'Registrar sessão'}</h2>
${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}${s?.id ? h`<p>${statusTag(s.status)}</p>${savedAt(s.updated_at, names[s.updated_by])}` : ''}
${formShell(c, s?.id ? `/app/pacientes/${p.id}/sessoes/${s.id}` : `/app/pacientes/${p.id}/sessoes`, h`${renderGroups(groups, s ?? { session_date: todayISO(), professional_id: c.user!.id })}
<fieldset class="card"><legend>Exploração alimentar</legend><p class="hint">Marque o que foi observado. As etapas não seguem ordem obrigatória e não substituem a descrição clínica.</p>
${rows.map((r, i) => exRow(r, i))}<template id="exrow">${exRow({}, '__N__')}</template><button type="button" class="btn small" data-add-row="exrow">+ Adicionar alimento</button></fieldset>
<fieldset class="card"><legend>Anexos</legend>${atts.length ? h`<ul>${atts.map((a) => h`<li><a href="/arquivos/${a.storage_path}" target="_blank" rel="noopener">${a.title}</a></li>`)}</ul>` : h`<p class="muted">Nenhum anexo.</p>`}
${s?.id ? h`<label>Adicionar anexo (JPG, PNG, WEBP ou PDF, até 10 MB)<input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"></label>` : h`<p class="hint">Salve a sessão para anexar arquivos.</p>`}</fieldset>`,
  h`<button class="btn" name="_acao" value="rascunho">Salvar rascunho</button><button class="btn primary" name="_acao" value="finalizada">Salvar e finalizar</button><a class="btn" href="/app/pacientes/${p.id}/sessoes">Voltar</a>`, true)}`);
}
staffRoute('GET', '/app/pacientes/:pid/sessoes/novo', async (c, tx) => { const p = await loadPatient(tx, c.params.pid); return p ? sessionForm(c, tx, p, null) : nf(c); });
staffRoute('GET', '/app/pacientes/:pid/sessoes/:sid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.sid)) return nf(c);
  const s = await J1<any>(tx, `select * from public.sessions where id = $1 and patient_id = $2`, [c.params.sid, p.id]);
  return s ? sessionForm(c, tx, p, s) : nf(c);
});
async function saveSession(c: Ctx, tx: Tx, sid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const staff = await staffOptions(tx);
  const fields = flatFields(SESSION_GROUPS(staff));
  const r = readFields(c, fields.map((f) => (f.name === 'professional_id' ? { ...f, type: 'text' as const } : f)));
  if (r.values.professional_id && !staff.some(([id]) => id === r.values.professional_id)) r.errors.push('Profissional inválido.');
  const exploration: any[] = [];
  for (let i = 0; i < 60; i++) {
    const n = fv(c, 'ex_n_' + i); const st = fvAll(c, 'ex_s_' + i).filter((x) => EXPLORATION_STEPS.some((e) => e[0] === x));
    if (n || st.length) exploration.push({ alimento: n, etapas: st });
  }
  if (r.errors.length) return sessionForm(c, tx, p, { id: sid, ...r.values, exploration }, r.errors);
  const cols: any[] = [...colsOf(fields).map((x) => (x.name === 'professional_id' ? { ...x, type: 'uuid' } : x)), { name: 'exploration', type: 'jsonb' }, { name: 'status', type: 'text' }];
  const vals = { ...r.values, exploration, status: fv(c, '_acao') === 'finalizada' ? 'finalizada' : 'rascunho' };
  if (sid) await updateRow(tx, 'sessions', sid, cols, vals);
  else sid = await insertRow(tx, 'sessions', [{ name: 'patient_id', type: 'uuid' }, ...cols], { patient_id: p.id, ...vals });
  const att = c.form?.get('attachment');
  if (att instanceof File && att.size > 0) {
    const f = await storeUpload(tx, p.id, 'documents', att);
    await insertRow(tx, 'documents', [{ name: 'patient_id', type: 'uuid' }, { name: 'title', type: 'text' }, { name: 'kind', type: 'text' }, { name: 'storage_path', type: 'text' }, { name: 'mime_type', type: 'text' }, { name: 'size_bytes', type: 'int' }, { name: 'session_id', type: 'uuid' }],
      { patient_id: p.id, title: att.name.slice(0, 120) || 'Anexo', kind: 'anexo', storage_path: f.path, mime_type: f.mime, size_bytes: f.size, session_id: sid });
  }
  return redirect(c, `/app/pacientes/${p.id}/sessoes/${sid}`, { ok: vals.status === 'finalizada' ? 'Sessão finalizada e salva.' : 'Rascunho salvo.' });
}
staffRoute('POST', '/app/pacientes/:pid/sessoes', (c, tx) => saveSession(c, tx));
staffRoute('POST', '/app/pacientes/:pid/sessoes/:sid', (c, tx) => saveSession(c, tx, c.params.sid));

staffRoute('GET', '/app/sessoes', async (c, tx) => {
  const rows = await J<any>(tx, `select s.id, s.session_date, s.start_time, s.status, s.location, s.patient_id, p.full_name from public.sessions s join public.patients p on p.id = s.patient_id order by s.session_date desc limit 80`);
  return htmlRes(c, page(c, { title: 'Sessões e evolução', body: h`<h1>Sessões e evolução</h1><p class="muted">Sessões de todos os pacientes. Para registrar, abra o paciente e a aba "Sessões".</p>
${table(['Data', 'Paciente', 'Local', 'Situação'], rows.map((s) => [h`${toBR(s.session_date)} ${s.start_time ? String(s.start_time).slice(0, 5) : ''}`, h`<a href="/app/pacientes/${s.patient_id}/sessoes/${s.id}">${s.full_name}</a>`, h`${locLabel(s.location)}`, statusTag(s.status)]), 'Nenhuma sessão cadastrada.')}` }));
});

// ===================== PLANEJAMENTO + ORIENTAÇÕES =====================
staffRoute('GET', '/app/pacientes/:pid/planejamento', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const plans = await J<any>(tx, `select id, title, status, review_date, updated_at from public.therapeutic_plans where patient_id = $1 order by created_at desc`, [p.id]);
  const gs = await J<any>(tx, `select id, title, audience from public.guidances where patient_id = $1 order by created_at desc`, [p.id]);
  const others = await J<any>(tx, `select t.id, t.title, pt.full_name from public.therapeutic_plans t join public.patients pt on pt.id = t.patient_id order by t.created_at desc limit 80`);
  return patientShell(c, p, 'planejamento', h`<div class="actions"><a class="btn primary" href="/app/pacientes/${p.id}/planejamento/novo">Novo planejamento</a></div>
<h2>Planejamentos</h2>${table(['Título', 'Situação', 'Revisão', ''], plans.map((x) => [h`${x.title}`, statusTag(x.status), h`${toBR(x.review_date)}`, h`<a class="btn small" href="/app/pacientes/${p.id}/planejamento/${x.id}">Abrir</a>`]), 'Nenhum planejamento.')}
<details class="card"><summary>Reaproveitar um planejamento anterior (exige revisão profissional)</summary>${formShell(c, `/app/pacientes/${p.id}/planejamento/reaproveitar`, h`
<label>Planejamento de origem<select name="origem" required><option value="">— selecione —</option>${others.map((o) => h`<option value="${o.id}">${o.title} — ${o.full_name}</option>`)}</select></label>
<p class="hint">A cópia nasce como rascunho, sem notas internas e com metas reiniciadas. Revise e individualize antes de ativar.</p>`, h`<button class="btn primary">Criar cópia para revisão</button>`)}</details>
<h2>Orientações (família e escola)</h2><div class="actions"><a class="btn" href="/app/pacientes/${p.id}/orientacoes/novo">Nova orientação</a></div>
${table(['Título', 'Destinatário', ''], gs.map((g) => [h`${g.title}`, h`${g.audience === 'familia' ? 'Família' : 'Escola'}`, h`<a class="btn small" href="/app/pacientes/${p.id}/orientacoes/${g.id}">Abrir</a>`]), 'Nenhuma orientação cadastrada.')}
<p class="small muted">O sistema não gera prescrição automática nem estratégias coercitivas; todo conteúdo é redigido e revisado pelo profissional.</p>`);
});
const GOALS = 3;
async function planForm(c: Ctx, tx: Tx, p: any, pl: any | null, errors: string[] = [], goals: any[] = []) {
  if (pl?.id && !goals.length) goals = await J<any>(tx, `select * from public.plan_goals where plan_id = $1 order by sort_order, created_at`, [pl.id]);
  const names = await nameMap(tx);
  const gRow = (g: any, i: string | number) => h`<div data-row-of="grow" class="card"><input type="hidden" name="g_id_${i}" value="${g.id ?? ''}">
<div class="row"><label>Prazo<select name="g_term_${i}">${TERMS.map(([k, l]) => h`<option value="${k}" ${g.term === k ? 'selected' : ''}>${l}</option>`)}</select></label>
<label>Andamento<select name="g_prog_${i}">${PROGRESS.map(([k, l]) => h`<option value="${k}" ${(g.progress ?? 'nao_iniciada') === k ? 'selected' : ''}>${l}</option>`)}</select></label></div>
<label>Meta observável e individualizada<textarea name="g_desc_${i}" rows="2">${g.description ?? ''}</textarea></label>
<label>Evolução da meta<textarea name="g_notes_${i}" rows="2">${g.progress_notes ?? ''}</textarea></label></div>`;
  const rows = [...goals, ...Array.from({ length: GOALS }, () => ({}))];
  return patientShell(c, p, 'planejamento', h`<h2>${pl?.id ? 'Planejamento terapêutico' : 'Novo planejamento'}</h2>
${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}${pl?.id ? savedAt(pl.updated_at, names[pl.updated_by]) : ''}
${formShell(c, pl?.id ? `/app/pacientes/${p.id}/planejamento/${pl.id}` : `/app/pacientes/${p.id}/planejamento`, h`<fieldset class="card"><legend>Planejamento</legend><div class="row">${PLAN_FIELDS.map((f) => renderField(f, pl ?? { status: 'rascunho' }))}</div></fieldset>
<fieldset class="card"><legend>Metas (curto, médio e longo prazo)</legend><p class="hint">Metas não são excluídas: use "Suspensa" para encerrar uma meta. Linhas vazias são ignoradas.</p>
${rows.map((g, i) => gRow(g, i))}<template id="grow">${gRow({}, '__N__')}</template><button type="button" class="btn small" data-add-row="grow">+ Adicionar meta</button></fieldset>`,
  h`<button class="btn primary">Salvar planejamento</button><a class="btn" href="/app/pacientes/${p.id}/planejamento">Voltar</a>`)}`);
}
staffRoute('GET', '/app/pacientes/:pid/planejamento/novo', async (c, tx) => { const p = await loadPatient(tx, c.params.pid); return p ? planForm(c, tx, p, null) : nf(c); });
staffRoute('GET', '/app/pacientes/:pid/planejamento/:plid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.plid)) return nf(c);
  const pl = await J1<any>(tx, `select * from public.therapeutic_plans where id = $1 and patient_id = $2`, [c.params.plid, p.id]);
  return pl ? planForm(c, tx, p, pl) : nf(c);
});
async function savePlan(c: Ctx, tx: Tx, plid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const r = readFields(c, PLAN_FIELDS);
  const goals: any[] = [];
  for (let i = 0; i < 60; i++) {
    const d = fv(c, 'g_desc_' + i); const id = fv(c, 'g_id_' + i);
    if (!d && !id) continue;
    goals.push({ id: isUuid(id) ? id : null, term: fv(c, 'g_term_' + i) || 'curto', progress: fv(c, 'g_prog_' + i) || 'nao_iniciada', description: d, progress_notes: fv(c, 'g_notes_' + i), sort_order: i });
  }
  if (r.errors.length) return planForm(c, tx, p, { id: plid, ...r.values }, r.errors, goals);
  if (plid) await updateRow(tx, 'therapeutic_plans', plid, colsOf(PLAN_FIELDS), r.values);
  else plid = await insertRow(tx, 'therapeutic_plans', [{ name: 'patient_id', type: 'uuid' }, ...colsOf(PLAN_FIELDS)], { patient_id: p.id, ...r.values });
  const gcols = [{ name: 'term', type: 'text' as const }, { name: 'progress', type: 'text' as const }, { name: 'description', type: 'text' as const }, { name: 'progress_notes', type: 'text' as const }, { name: 'sort_order', type: 'int' as const }];
  for (const g of goals) {
    if (!g.description) continue;
    if (g.id) await updateRow(tx, 'plan_goals', g.id, gcols, g);
    else await insertRow(tx, 'plan_goals', [{ name: 'plan_id', type: 'uuid' }, ...gcols], { plan_id: plid, ...g });
  }
  return redirect(c, `/app/pacientes/${p.id}/planejamento/${plid}`, { ok: 'Planejamento salvo.' });
}
staffRoute('POST', '/app/pacientes/:pid/planejamento', (c, tx) => savePlan(c, tx));
staffRoute('POST', '/app/pacientes/:pid/planejamento/reaproveitar', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const src = fv(c, 'origem');
  const o = isUuid(src) ? await J1<any>(tx, `select * from public.therapeutic_plans where id = $1`, [src]) : null;
  if (!o) return redirect(c, `/app/pacientes/${p.id}/planejamento`, { err: 'Selecione o planejamento de origem.' });
  const cols = [{ name: 'patient_id', type: 'uuid' as const }, { name: 'title', type: 'text' as const }, { name: 'status', type: 'text' as const }, { name: 'activities', type: 'text' as const }, { name: 'foods', type: 'text' as const },
    { name: 'materials', type: 'text' as const }, { name: 'family_guidance', type: 'text' as const }, { name: 'school_guidance', type: 'text' as const }, { name: 'based_on_id', type: 'uuid' as const }];
  const id = await insertRow(tx, 'therapeutic_plans', cols, { patient_id: p.id, title: `Cópia — ${o.title}`, status: 'rascunho', activities: o.activities, foods: o.foods, materials: o.materials,
    family_guidance: o.family_guidance, school_guidance: o.school_guidance, based_on_id: o.id });
  const gs = await J<any>(tx, `select * from public.plan_goals where plan_id = $1 order by sort_order`, [o.id]);
  for (const g of gs) await insertRow(tx, 'plan_goals', [{ name: 'plan_id', type: 'uuid' }, { name: 'term', type: 'text' }, { name: 'description', type: 'text' }, { name: 'progress', type: 'text' }, { name: 'sort_order', type: 'int' }],
    { plan_id: id, term: g.term, description: g.description, progress: 'nao_iniciada', sort_order: g.sort_order });
  return redirect(c, `/app/pacientes/${p.id}/planejamento/${id}`, { ok: 'Cópia criada como rascunho. Revise e individualize antes de ativar.' });
});
staffRoute('POST', '/app/pacientes/:pid/planejamento/:plid', (c, tx) => savePlan(c, tx, c.params.plid));

async function guidanceForm(c: Ctx, tx: Tx, p: any, g: any | null, errors: string[] = []) {
  return patientShell(c, p, 'planejamento', h`<h2>${g?.id ? 'Orientação' : 'Nova orientação'}</h2>${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}${g?.id ? savedAt(g.updated_at) : ''}
${formShell(c, g?.id ? `/app/pacientes/${p.id}/orientacoes/${g.id}` : `/app/pacientes/${p.id}/orientacoes`, h`<div class="stack">${GUIDANCE_FIELDS.map((f) => renderField(f, g ?? {}))}</div>
<p class="hint">Salvar não compartilha. A liberação é feita na aba "Documentos e compartilhamentos", com pré-visualização.</p>`, h`<button class="btn primary">Salvar orientação</button><a class="btn" href="/app/pacientes/${p.id}/planejamento">Voltar</a>`)}`);
}
staffRoute('GET', '/app/pacientes/:pid/orientacoes/novo', async (c, tx) => { const p = await loadPatient(tx, c.params.pid); return p ? guidanceForm(c, tx, p, null) : nf(c); });
staffRoute('GET', '/app/pacientes/:pid/orientacoes/:gid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.gid)) return nf(c);
  const g = await J1<any>(tx, `select * from public.guidances where id = $1 and patient_id = $2`, [c.params.gid, p.id]);
  return g ? guidanceForm(c, tx, p, g) : nf(c);
});
async function saveGuidance(c: Ctx, tx: Tx, gid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const r = readFields(c, GUIDANCE_FIELDS);
  if (r.errors.length) return guidanceForm(c, tx, p, { id: gid, ...r.values }, r.errors);
  if (gid) await updateRow(tx, 'guidances', gid, colsOf(GUIDANCE_FIELDS), r.values);
  else await insertRow(tx, 'guidances', [{ name: 'patient_id', type: 'uuid' }, ...colsOf(GUIDANCE_FIELDS)], { patient_id: p.id, ...r.values });
  return redirect(c, `/app/pacientes/${p.id}/planejamento`, { ok: 'Orientação salva (privada até ser liberada).' });
}
staffRoute('POST', '/app/pacientes/:pid/orientacoes', (c, tx) => saveGuidance(c, tx));
staffRoute('POST', '/app/pacientes/:pid/orientacoes/:gid', (c, tx) => saveGuidance(c, tx, c.params.gid));

staffRoute('GET', '/app/planejamentos', async (c, tx) => {
  const rows = await J<any>(tx, `select t.id, t.title, t.status, t.review_date, t.patient_id, p.full_name from public.therapeutic_plans t join public.patients p on p.id = t.patient_id order by t.created_at desc limit 80`);
  return htmlRes(c, page(c, { title: 'Planejamentos', body: h`<h1>Planejamentos</h1>
${table(['Título', 'Paciente', 'Situação', 'Revisão'], rows.map((t) => [h`<a href="/app/pacientes/${t.patient_id}/planejamento/${t.id}">${t.title}</a>`, h`${t.full_name}`, statusTag(t.status), h`${toBR(t.review_date)}`]), 'Nenhum planejamento cadastrado.')}` }));
});

// ===================== DOCUMENTOS E COMPARTILHAMENTOS =====================
const SHAREABLE: Record<string, { label: string; audiences: ('familia' | 'escola')[] }> = {
  guidances: { label: 'Orientação', audiences: ['familia', 'escola'] }, sessions: { label: 'Evolução da sessão', audiences: ['familia'] },
  therapeutic_plans: { label: 'Planejamento', audiences: ['familia', 'escola'] }, growth_measurements: { label: 'Medidas de crescimento', audiences: ['familia'] },
  documents: { label: 'Documento', audiences: ['familia', 'escola'] },
};
staffRoute('GET', '/app/pacientes/:pid/documentos', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const docs = await J<any>(tx, `select id, title, kind, storage_path, mime_type, created_at from public.documents where patient_id = $1 order by created_at desc`, [p.id]);
  const pubs = await J<any>(tx, `select * from public.publications where patient_id = $1 order by published_at desc`, [p.id]);
  const names = await nameMap(tx);
  const [g, s, pl] = await Promise.all([
    J<any>(tx, `select id, title, audience from public.guidances where patient_id = $1 order by created_at desc`, [p.id]),
    J<any>(tx, `select id, session_date from public.sessions where patient_id = $1 and status = 'finalizada' order by session_date desc`, [p.id]),
    J<any>(tx, `select id, title from public.therapeutic_plans where patient_id = $1 order by created_at desc`, [p.id])]);
  const pub = canPublish(c);
  const share = (t: string, id: string, label: string, auds: string[]) => [h`${SHAREABLE[t].label}`, h`${label}`, pub
    ? h`${auds.map((a) => h`<a class="btn small" href="/app/pacientes/${p.id}/liberar?t=${t}&id=${id}&para=${a}">Pré-visualizar e liberar p/ ${a === 'familia' ? 'família' : 'escola'}</a> `)}` : h`<span class="muted small">Sem autorização para liberar</span>`];
  const items: Raw[][] = [
    ...g.map((x) => share('guidances', x.id, x.title, [x.audience])), ...s.map((x) => share('sessions', x.id, 'Sessão de ' + toBR(x.session_date), ['familia'])),
    ...pl.map((x) => share('therapeutic_plans', x.id, x.title, ['familia', 'escola'])), ...docs.map((x) => share('documents', x.id, x.title, ['familia'])),
    share('growth_measurements', '', 'Todas as medidas atuais', ['familia'])];
  return patientShell(c, p, 'documentos', h`
<section class="card"><h2>Enviar documento</h2>${formShell(c, `/app/pacientes/${p.id}/documentos`, h`<div class="row"><label>Título *<input name="title" required maxlength="120"></label>
<label>Tipo<select name="kind"><option value="documento">Documento</option><option value="anexo">Anexo interno</option></select></label>
<label>Arquivo (PDF, JPG, PNG, WEBP; até 10 MB) *<input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp"></label></div>`, h`<button class="btn primary">Enviar arquivo</button>`, true)}</section>
<h2>Documentos</h2>${table(['Título', 'Tipo', 'Data', ''], docs.map((d) => [h`${d.title}`, h`${d.kind}`, h`${dateTimeBR(d.created_at)}`, h`<a class="btn small" href="/arquivos/${d.storage_path}" target="_blank" rel="noopener">Abrir</a>`]), 'Nenhum documento.')}
<h2>Liberar para família ou escola</h2>
<p class="small muted">Todo registro nasce privado. Ao liberar, uma <strong>versão publicada</strong> é criada: edições posteriores só aparecem após nova liberação. Notas internas nunca são incluídas.${pub ? '' : ' Seu perfil não está autorizado a liberar conteúdo; peça a um master.'}</p>
${table(['Tipo', 'Registro', 'Ação'], items, 'Nada para liberar ainda.')}
<h2>Histórico de liberações</h2>
${table(['Conteúdo', 'Destinatário', 'Versão', 'Situação', 'Liberado por', 'Retirado por', ''], pubs.map((x) => [h`${KIND_LABEL[x.kind] ?? x.kind}: ${x.title}`, h`${x.audience === 'familia' ? 'Família' : 'Escola'}`, h`v${x.version}`,
  x.status === 'ativo' ? h`<span class="tag">ativa</span>` : h`<span class="tag warn">retirada</span>`, h`${names[x.published_by] ?? ''}<br><span class="small muted">${dateTimeBR(x.published_at)}</span>`,
  h`${x.withdrawn_by ? h`${names[x.withdrawn_by] ?? ''}<br><span class="small muted">${dateTimeBR(x.withdrawn_at)}</span>` : ''}`,
  x.status === 'ativo' && pub ? h`<form method="post" action="/app/pacientes/${p.id}/retirar/${x.id}">${csrfField(c)}<button class="btn small danger" data-confirm="Retirar a liberação? O conteúdo deixa de ser acessível imediatamente.">Retirar liberação</button></form>` : '']), 'Nada foi liberado para família ou escola.')}`);
});
staffRoute('POST', '/app/pacientes/:pid/documentos', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const f = c.form?.get('file');
  if (!(f instanceof File) || !f.size) return redirect(c, `/app/pacientes/${p.id}/documentos`, { err: 'Escolha um arquivo.' });
  const st = await storeUpload(tx, p.id, 'documents', f);
  await insertRow(tx, 'documents', [{ name: 'patient_id', type: 'uuid' }, { name: 'title', type: 'text' }, { name: 'kind', type: 'text' }, { name: 'storage_path', type: 'text' }, { name: 'mime_type', type: 'text' }, { name: 'size_bytes', type: 'int' }],
    { patient_id: p.id, title: fv(c, 'title') || f.name, kind: fv(c, 'kind') === 'anexo' ? 'anexo' : 'documento', storage_path: st.path, mime_type: st.mime, size_bytes: st.size });
  return redirect(c, `/app/pacientes/${p.id}/documentos`, { ok: 'Arquivo enviado (privado até ser liberado).' });
});

class Rollback extends Error { constructor(public data: any) { super('rollback'); } }
staffRoute('GET', '/app/pacientes/:pid/liberar', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return nf(c);
  const t = c.url.searchParams.get('t') ?? ''; const para = c.url.searchParams.get('para') ?? ''; const id = c.url.searchParams.get('id') ?? '';
  if (!SHAREABLE[t] || !SHAREABLE[t].audiences.includes(para as any)) return nf(c);
  if (!canPublish(c)) return redirect(c, `/app/pacientes/${p.id}/documentos`, { err: 'Seu perfil não está autorizado a liberar conteúdo.' });
  // Pré-visualização EXATA: o banco monta o instantâneo e a transação é desfeita (nada é publicado).
  let preview: any = null;
  try {
    await asUser(c.user!.id, async (t2) => {
      const r = await t2.unsafe(`select public.publish_record($1::uuid, $2, $3::uuid, $4) as id`, [p.id, t, id || null, para]);
      preview = await J1<any>(t2, `select kind, title, content, file_path, version from public.publications where id = $1`, [r[0].id]);
      throw new Rollback(preview);
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  const links = isMasterRole(c) ? await J<any>(tx, `select pr.full_name, pr.email, pr.role from public.access_links l join public.profiles pr on pr.id = l.user_id where l.patient_id = $1 and l.active and pr.active and pr.role = $2`, [p.id, para === 'familia' ? 'familia' : 'escola']) : null;
  return patientShell(c, p, 'documentos', h`<h2>Pré-visualização da liberação</h2>
<p>Destinatário: <strong>${para === 'familia' ? 'Família' : 'Escola'}</strong>${links ? h` — contas vinculadas que passarão a ver: ${links.length ? links.map((l) => h`<span class="tag">${l.full_name} (${l.email})</span>`) : h`<em>nenhuma conta vinculada ainda</em>`}` : ''}</p>
<div class="preview"><h3>${KIND_LABEL[preview.kind] ?? preview.kind}: ${preview.title} <span class="tag lilac">versão ${preview.version}</span></h3>${preview.file_path ? h`<p>Arquivo anexo: disponível para download pelo destinatário.</p>` : ''}${renderContent(preview.content, preview.kind)}</div>
<p class="small muted">Notas internas não fazem parte deste conteúdo. Somente o que aparece acima ficará visível.</p>
<form method="post" action="/app/pacientes/${p.id}/liberar" class="actions">${csrfField(c)}<input type="hidden" name="t" value="${t}"><input type="hidden" name="id" value="${id}"><input type="hidden" name="para" value="${para}">
<button class="btn primary">Confirmar liberação</button><a class="btn" href="/app/pacientes/${p.id}/documentos">Cancelar</a></form>`);
});
const isMasterRole = (c: Ctx) => c.user!.role === 'master_alana' || c.user!.role === 'master_cores';
staffRoute('POST', '/app/pacientes/:pid/liberar', async (c, tx) => {
  const t = fv(c, 't'); const para = fv(c, 'para'); const id = fv(c, 'id');
  if (!SHAREABLE[t]) return nf(c);
  await tx.unsafe(`select public.publish_record($1::uuid, $2, $3::uuid, $4)`, [c.params.pid, t, id || null, para]);
  return redirect(c, `/app/pacientes/${c.params.pid}/documentos`, { ok: 'Conteúdo liberado. Foi criada uma versão publicada.' });
});
staffRoute('POST', '/app/pacientes/:pid/retirar/:pubid', async (c, tx) => {
  if (!isUuid(c.params.pubid)) return nf(c);
  await tx`select public.withdraw_publication(${c.params.pubid}::uuid)`;
  return redirect(c, `/app/pacientes/${c.params.pid}/documentos`, { ok: 'Liberação retirada. O acesso foi encerrado.' });
});
