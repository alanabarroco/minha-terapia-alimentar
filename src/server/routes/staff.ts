import { h, join } from '../html';
import { Ctx, htmlRes, page, redirect, csrfField, fv, route, STAFF } from '../web';
import { asUser, J, J1, Tx, insertRow, updateRow, isUuid } from '../db';
import { staffRoute, masterRoute, patientShell, loadPatient, empty, statusTag, savedAt, table, kv, nameMap, formShell, canPublish } from '../ui';
import { renderGroups, readFields, flatFields, colsOf, renderField, Field, fmtNum } from '../forms';
import { PATIENT_GROUPS, ANAMNESE, DIARY_GROUPS, GROWTH_FIELDS, SCHOOL_FIELDS, locLabel } from '../entities';
import { storeUpload, UserError } from '../files';
import { areaBars, lineChart } from '../charts';
import { ageInMonths, ageLabel, dateTimeBR, toBR, todayISO } from '../../lib/age';
import { interpolateLMS, lmsZExtended, lmsZ, GROWTH_PENDING_MESSAGE } from '../../lib/growth/zscore';
import { isMaster } from '../auth';

const IMG = ['image/jpeg', 'image/png', 'image/webp'];

// ===================== VISÃO GERAL =====================
staffRoute('GET', '/app', async (c, tx) => {
  const today = todayISO();
  const [cnt] = await J<any>(tx, `select
    (select count(*) from public.patients where status = 'ativo') as ativos,
    (select count(*) from public.sessions where session_date >= $1 and status <> 'finalizada') as proximas,
    (select count(*) from public.questionnaire_responses where status = 'rascunho') + (select count(*) from public.anamneses where status = 'rascunho') as pendentes,
    (select count(*) from public.school_meal_records where reviewed_at is null) as escolares,
    (select count(*) from public.sessions s where s.status = 'finalizada' and not exists (select 1 from public.publications p where p.source_id = s.id and p.status = 'ativo'))
      + (select count(*) from public.guidances g where not exists (select 1 from public.publications p where p.source_id = g.id and p.status = 'ativo')) as aguardando`, [today]);
  const next = await J<any>(tx, `select s.id, s.session_date, s.start_time, s.location, s.status, s.patient_id, p.full_name from public.sessions s
      join public.patients p on p.id = s.patient_id where s.session_date >= $1 and s.status <> 'finalizada' order by s.session_date, s.start_time limit 6`, [today]);
  const isM = isMaster(c.user!.role);
  return htmlRes(c, page(c, { title: 'Visão geral', body: h`
<h1>${isM ? 'PAINEL MASTER' : 'Painel da equipe'} — Visão geral</h1>
<p class="muted">Informações reais do banco de dados. Quando não há dados, aparece um estado vazio.</p>
<div class="grid">
  <a class="stat" href="/app/pacientes"><b>${cnt.ativos}</b><span>Pacientes ativos</span></a>
  <a class="stat" href="/app/sessoes"><b>${cnt.proximas}</b><span>Próximas sessões cadastradas</span></a>
  <a class="stat" href="/app/avaliacoes"><b>${cnt.pendentes}</b><span>Avaliações pendentes (rascunhos)</span></a>
  <a class="stat" href="/app/escola"><b>${cnt.escolares}</b><span>Novos registros escolares</span></a>
  <a class="stat" href="/app/relatorios"><b>${cnt.aguardando}</b><span>Registros aguardando liberação</span></a>
</div>
<h2>Próximas sessões</h2>
${table(['Data', 'Paciente', 'Local', 'Situação'], next.map((s) => [h`${toBR(s.session_date)} ${s.start_time ? String(s.start_time).slice(0, 5) : ''}`,
  h`<a href="/app/pacientes/${s.patient_id}/sessoes/${s.id}">${s.full_name}</a>`, h`${locLabel(s.location)}`, statusTag(s.status)]), 'Nenhuma sessão cadastrada para os próximos dias.')}
<h2>Atalhos</h2>
<div class="actions">${isM ? h`<a class="btn primary" href="/app/pacientes/novo">Cadastrar paciente</a><a class="btn" href="/app/usuarios">Convidar usuário</a>` : ''}
<a class="btn" href="/app/pacientes">Ver pacientes</a><a class="btn" href="/app/relatorios">Relatórios e compartilhamentos</a></div>` }));
});

// ===================== PACIENTES =====================
staffRoute('GET', '/app/pacientes', async (c, tx) => {
  const q = c.url.searchParams.get('q')?.trim() ?? '';
  const st = c.url.searchParams.get('st') ?? 'ativo';
  const rows = await J<any>(tx, `select id, full_name, preferred_name, birth_date, school_name, status, is_demo from public.patients
    where ($1 = '' or full_name ilike '%' || $1 || '%' or preferred_name ilike '%' || $1 || '%')
      and ($2 = 'todos' or status = $2) order by full_name`, [q, ['ativo', 'arquivado', 'todos'].includes(st) ? st : 'ativo']);
  const today = todayISO();
  return htmlRes(c, page(c, { title: 'Pacientes', body: h`<h1>Pacientes</h1>
<form method="get" class="row" style="align-items:end"><label>Buscar por nome<input name="q" value="${q}" placeholder="Nome ou nome preferido"></label>
<label>Situação<select name="st"><option value="ativo" ${st === 'ativo' ? 'selected' : ''}>Ativos</option><option value="arquivado" ${st === 'arquivado' ? 'selected' : ''}>Arquivados</option><option value="todos" ${st === 'todos' ? 'selected' : ''}>Todos</option></select></label>
<div class="actions"><button class="btn">Filtrar</button>${isMaster(c.user!.role) ? h`<a class="btn primary" href="/app/pacientes/novo">Novo paciente</a>` : ''}</div></form>
${table(['Nome', 'Idade', 'Escola', 'Situação'], rows.map((p) => [h`<a href="/app/pacientes/${p.id}">${p.full_name}</a> ${p.is_demo ? h`<span class="tag lilac">fictício</span>` : ''}`,
  h`${ageLabel(p.birth_date, today)}`, h`${p.school_name ?? ''}`, statusTag(p.status)]), 'Nenhum paciente encontrado. Use "Novo paciente" para cadastrar o primeiro.')}` }));
});

function guardianRows(values: any[]) {
  return join([0, 1, 2].map((i) => {
    const g = values[i] ?? {};
    return h`<div class="row"><label>Responsável ${i + 1}: nome<input name="g_nome_${i}" value="${g.nome ?? ''}"></label>
<label>Parentesco<input name="g_parentesco_${i}" value="${g.parentesco ?? ''}"></label><label>Telefone<input name="g_telefone_${i}" value="${g.telefone ?? ''}" inputmode="tel"></label>
<label>E-mail<input type="email" name="g_email_${i}" value="${g.email ?? ''}"></label></div>`;
  }));
}
function readGuardians(c: Ctx) {
  return [0, 1, 2].map((i) => ({ nome: fv(c, `g_nome_${i}`), parentesco: fv(c, `g_parentesco_${i}`), telefone: fv(c, `g_telefone_${i}`), email: fv(c, `g_email_${i}`) }))
    .filter((g) => g.nome || g.email || g.telefone);
}
function patientForm(c: Ctx, p: any | null, errors: string[] = [], values?: any) {
  const m = isMaster(c.user!.role);
  const v = values ?? p ?? {};
  const action = p ? `/app/pacientes/${p.id}/editar` : '/app/pacientes';
  return htmlRes(c, page(c, { title: p ? 'Editar paciente' : 'Novo paciente', active: '/app/pacientes', body: h`<h1>${p ? 'Editar cadastro' : 'Novo paciente'}</h1>
${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}
${formShell(c, action, h`${renderGroups(PATIENT_GROUPS(m), v)}
<fieldset class="card"><legend>Responsáveis e contatos</legend>${guardianRows(v.guardians ?? [])}</fieldset>`,
  h`<button class="btn primary" type="submit">Salvar cadastro</button><a class="btn" href="${p ? '/app/pacientes/' + p.id : '/app/pacientes'}">Cancelar</a>`)}` }), errors.length ? 400 : 200);
}
masterRoute('GET', '/app/pacientes/novo', async (c) => patientForm(c, null));
masterRoute('POST', '/app/pacientes', async (c, tx) => {
  const fields = flatFields(PATIENT_GROUPS(true));
  const r = readFields(c, fields);
  if (r.errors.length) return patientForm(c, null, r.errors, { ...r.values, guardians: readGuardians(c) });
  const id = await insertRow(tx, 'patients', [...colsOf(fields), { name: 'guardians', type: 'jsonb' }], { ...r.values, guardians: readGuardians(c) });
  return redirect(c, `/app/pacientes/${id}`, { ok: 'Paciente cadastrado.' });
});
staffRoute('GET', '/app/pacientes/:pid/editar', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid);
  return p ? patientForm(c, p) : notFoundRes(c);
});
staffRoute('POST', '/app/pacientes/:pid/editar', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid);
  if (!p) return notFoundRes(c);
  const fields = flatFields(PATIENT_GROUPS(isMaster(c.user!.role)));
  const r = readFields(c, fields);
  if (r.errors.length) return patientForm(c, p, r.errors, { ...r.values, guardians: readGuardians(c) });
  await updateRow(tx, 'patients', p.id, [...colsOf(fields), { name: 'guardians', type: 'jsonb' }], { ...r.values, guardians: readGuardians(c) });
  return redirect(c, `/app/pacientes/${p.id}`, { ok: 'Cadastro salvo.' });
});
import { notFound } from '../web';
const notFoundRes = (c: Ctx) => notFound(c);

masterRoute('POST', '/app/pacientes/:pid/arquivar', async (c, tx) => {
  await tx`update public.patients set status = 'arquivado' where id = ${c.params.pid}::uuid`;
  return redirect(c, `/app/pacientes/${c.params.pid}`, { ok: 'Paciente arquivado. Famílias e escolas vinculadas perderam o acesso enquanto estiver arquivado.' });
});
masterRoute('POST', '/app/pacientes/:pid/reativar', async (c, tx) => {
  await tx`update public.patients set status = 'ativo' where id = ${c.params.pid}::uuid`;
  return redirect(c, `/app/pacientes/${c.params.pid}`, { ok: 'Paciente reativado.' });
});
masterRoute('POST', '/app/pacientes/:pid/excluir', async (c, tx) => {
  const files = await J<{ name: string }>(tx, `select name from storage.objects where name like $1`, [c.params.pid + '/%']);
  await tx`select public.delete_patient_permanently(${c.params.pid}::uuid, ${fv(c, 'confirma')})`;
  const { removeFromDisk } = await import('../files');
  for (const f of files) await removeFromDisk(f.name);
  return redirect(c, '/app/pacientes', { ok: 'Paciente excluído definitivamente (registrado no log de exclusões).' });
});

// ===================== RESUMO =====================
staffRoute('GET', '/app/pacientes/:pid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid);
  if (!p) return notFoundRes(c);
  const today = todayISO();
  const [n] = await J<any>(tx, `select (select count(*) from public.food_diary_entries where patient_id = $1) as diario,
     (select count(*) from public.sessions where patient_id = $1) as sessoes, (select count(*) from public.questionnaire_responses where patient_id = $1) as quest,
     (select count(*) from public.school_meal_records where patient_id = $1) as escola`, [p.id]);
  const last = await J1<any>(tx, `select measured_on, weight_kg, height_cm, bmi from public.growth_measurements where patient_id = $1 order by measured_on desc limit 1`, [p.id]);
  const links = isMaster(c.user!.role) ? await J<any>(tx, `select l.id, l.active, pr.full_name, pr.email, pr.role from public.access_links l join public.profiles pr on pr.id = l.user_id where l.patient_id = $1 order by pr.role, pr.full_name`, [p.id]) : [];
  const g: any[] = Array.isArray(p.guardians) ? p.guardians : [];
  return patientShell(c, p, '', h`
<div class="grid"><div class="stat"><b>${n.diario}</b><span>registros no diário</span></div><div class="stat"><b>${n.sessoes}</b><span>sessões</span></div>
<div class="stat"><b>${n.quest}</b><span>questionários</span></div><div class="stat"><b>${n.escola}</b><span>registros escolares</span></div></div>
<section class="card"><h2>Identificação e saúde</h2>${kv([['Escola / turma', [p.school_name, p.class_name].filter(Boolean).join(' · ')], ['Sexo (referência de crescimento)', p.sex_growth === 'F' ? 'Feminino' : p.sex_growth === 'M' ? 'Masculino' : ''],
  ['Motivo da procura', p.reason], ['Diagnósticos informados', p.diagnoses], ['Alergias', p.allergies], ['Restrições', p.restrictions], ['Medicamentos', p.medications],
  ['Suplementos', p.supplements], ['Profissionais envolvidos', p.professionals], ['Observações clínicas (internas)', p.clinical_notes],
  ['Foto na escola', p.school_photo_authorized ? 'Autorizada' : 'Não autorizada']])}
<h3>Responsáveis</h3>${g.length ? table(['Nome', 'Parentesco', 'Telefone', 'E-mail'], g.map((x) => [h`${x.nome}`, h`${x.parentesco}`, h`${x.telefone}`, h`${x.email}`]), '') : h`<p class="muted">Nenhum responsável informado.</p>`}
<h3>Última medida</h3>${last ? h`<p>${toBR(last.measured_on)}: ${last.weight_kg ? fmtNum(last.weight_kg) + ' kg' : '—'} · ${last.height_cm ? fmtNum(last.height_cm) + ' cm' : '—'}${last.bmi ? ' · IMC ' + fmtNum(last.bmi) : ''}</p>` : h`<p class="muted">Nenhuma medida registrada.</p>`}
<div class="actions"><a class="btn" href="/app/pacientes/${p.id}/editar">Editar cadastro</a></div></section>
${isMaster(c.user!.role) ? h`<section class="card"><h2>Acessos vinculados (famílias e escolas)</h2>
${table(['Nome', 'E-mail', 'Perfil', 'Vínculo'], links.map((l) => [h`${l.full_name}`, h`${l.email}`, h`${l.role}`, l.active ? h`<span class="tag">ativo</span>` : h`<span class="tag err">inativo</span>`]), 'Nenhuma família ou escola vinculada. Convide em "Usuários e acessos".')}
<h3>Situação do cadastro</h3><div class="actions">
${p.status === 'ativo' ? h`<form method="post" action="/app/pacientes/${p.id}/arquivar">${csrfField(c)}<button class="btn" data-confirm="Arquivar este paciente? Escola e família deixam de acessá-lo.">Arquivar paciente</button></form>`
 : h`<form method="post" action="/app/pacientes/${p.id}/reativar">${csrfField(c)}<button class="btn">Reativar paciente</button></form>`}</div>
${p.status === 'arquivado' ? h`<details><summary>Exclusão definitiva (irreversível)</summary><form method="post" action="/app/pacientes/${p.id}/excluir" class="stack">${csrfField(c)}
<p class="hint">Digite exatamente o nome completo do paciente (${p.full_name}) para confirmar. A exclusão apaga todos os registros e arquivos e fica registrada em log (sem conteúdo clínico).</p>
<label>Nome completo para confirmar<input name="confirma" required autocomplete="off"></label><button class="btn danger" data-confirm="Excluir DEFINITIVAMENTE? Não há como desfazer.">Excluir definitivamente</button></form></details>` : ''}</section>` : ''}`);
});

// ===================== ANAMNESE =====================
async function anamneseView(c: Ctx, tx: Tx, p: any, errors: string[] = []) {
  const a = await J1<any>(tx, `select * from public.anamneses where patient_id = $1 order by created_at desc limit 1`, [p.id]);
  const names = await nameMap(tx);
  const ans = a?.answers ?? {};
  return patientShell(c, p, 'anamnese', h`
${a ? savedAt(a.updated_at, names[a.updated_by]) : h`<div class="notice">Nenhuma anamnese registrada ainda.</div>`}
${a ? h`<p>${statusTag(a.status)} <span class="small muted">Data do registro: ${toBR(a.recorded_on)}</span></p>` : ''}
${formShell(c, `/app/pacientes/${p.id}/anamnese`, h`
<fieldset class="card"><legend>Anamnese alimentar</legend>
${ANAMNESE.map((q) => h`<label>${q.label}<textarea name="a_${q.key}" rows="3">${ans[q.key] ?? ''}</textarea>${q.hint ? h`<span class="hint">${q.hint}</span>` : ''}</label>`)}
</fieldset><fieldset class="card"><legend>Notas internas</legend><label>Notas internas (nunca compartilhadas)<textarea name="internal_notes">${a?.internal_notes ?? ''}</textarea></label></fieldset>`,
  h`<button class="btn" name="_acao" value="rascunho">Salvar rascunho</button><button class="btn primary" name="_acao" value="finalizada">Salvar e finalizar</button>`)}`);
}
staffRoute('GET', '/app/pacientes/:pid/anamnese', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid);
  return p ? anamneseView(c, tx, p) : notFoundRes(c);
});
staffRoute('POST', '/app/pacientes/:pid/anamnese', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid);
  if (!p) return notFoundRes(c);
  const answers: Record<string, string> = {};
  for (const q of ANAMNESE) { const v = fv(c, 'a_' + q.key); if (v) answers[q.key] = v; }
  const status = fv(c, '_acao') === 'finalizada' ? 'finalizada' : 'rascunho';
  const cols = [{ name: 'answers', type: 'jsonb' as const }, { name: 'status', type: 'text' as const }, { name: 'internal_notes', type: 'text' as const }];
  const vals = { answers, status, internal_notes: fv(c, 'internal_notes') };
  const a = await J1<any>(tx, `select id from public.anamneses where patient_id = $1 order by created_at desc limit 1`, [p.id]);
  if (a) await updateRow(tx, 'anamneses', a.id, cols, vals);
  else await insertRow(tx, 'anamneses', [{ name: 'patient_id', type: 'uuid' }, ...cols], { patient_id: p.id, ...vals });
  return redirect(c, `/app/pacientes/${p.id}/anamnese`, { ok: status === 'finalizada' ? 'Anamnese salva e finalizada.' : 'Rascunho salvo.' });
});

// ===================== CRESCIMENTO =====================
const IND = { peso: 'peso_idade', altura: 'estatura_idade', imc: 'imc_idade' } as const;
async function growthView(c: Ctx, tx: Tx, p: any, editing: any | null = null, errors: string[] = []) {
  const ms = await J<any>(tx, `select * from public.growth_measurements where patient_id = $1 order by measured_on`, [p.id]);
  const refCount = (await J<any>(tx, `select count(*)::int as n from public.growth_reference_lms`))[0].n;
  let refs: any[] = [];
  if (refCount && p.sex_growth) refs = await J<any>(tx, `select * from public.growth_reference_lms where sex = $1`, [p.sex_growth]);
  const zFor = (ind: string, months: number, value: number | null) => {
    if (value === null || !refs.length) return null;
    const rows = refs.filter((r) => r.indicator === ind);
    if (!rows.length) return null;
    const best = rows.sort((a, b) => String(b.version).localeCompare(String(a.version)))[0];
    const sameSet = rows.filter((r) => r.source === best.source && r.version === best.version).map((r) => ({ x: Number(r.x_value), l: Number(r.l), m: Number(r.m), s: Number(r.s) }));
    const lms = interpolateLMS(sameSet, months);
    if (!lms) return null;
    const z = ind === IND.altura ? lmsZ(value, lms) : lmsZExtended(value, lms);
    return { z: Math.round(z * 100) / 100, src: `${best.source} ${best.version}` };
  };
  const age = (d: string) => ageInMonths(p.birth_date, d);
  const rows = ms.map((m) => {
    const mo = age(m.measured_on);
    const zs = [['Peso/idade', zFor(IND.peso, mo, m.weight_kg)], ['Estatura/idade', zFor(IND.altura, mo, m.height_cm)], ['IMC/idade', zFor(IND.imc, mo, m.bmi)]] as const;
    return [h`${toBR(m.measured_on)}`, h`${ageLabel(p.birth_date, m.measured_on)}`, h`${m.weight_kg ? fmtNum(m.weight_kg) : '—'}`, h`${m.height_cm ? fmtNum(m.height_cm) : '—'} ${m.measure_type ? '(' + m.measure_type + ')' : ''}`,
      h`${m.bmi && mo >= 24 ? fmtNum(m.bmi) : m.bmi ? fmtNum(m.bmi) + ' *' : '—'}`,
      refs.length ? h`${zs.map(([n, z]) => (z ? h`${n}: <b>${String(z.z).replace('.', ',')}</b> <span class="small muted">(${z.src})</span><br>` : ''))}` : h`<span class="muted">referência pendente</span>`,
      h`${m.notes ?? ''}`, h`<a class="btn small" href="/app/pacientes/${p.id}/crescimento/${m.id}">Editar</a>`];
  });
  const wpts = ms.filter((m) => m.weight_kg).map((m) => ({ x: age(m.measured_on), y: Number(m.weight_kg) }));
  const hpts = ms.filter((m) => m.height_cm).map((m) => ({ x: age(m.measured_on), y: Number(m.height_cm) }));
  const fmtAge = (x: number) => (x < 24 ? `${Math.round(x)} m` : `${Math.floor(x / 12)}a${Math.round(x % 12) ? Math.round(x % 12) + 'm' : ''}`);
  return patientShell(c, p, 'crescimento', h`
${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}
${!refCount || !p.sex_growth ? h`<div class="notice warn"><strong>Referência de crescimento pendente.</strong> ${!refCount ? GROWTH_PENDING_MESSAGE : 'Informe o sexo usado na referência de crescimento no cadastro para calcular escores.'}</div>`
  : h`<div class="notice">Escores-z calculados pelo método LMS com a tabela de referência importada (fonte e versão indicadas em cada linha).</div>`}
<section class="card"><h2>${editing ? 'Editar medida' : 'Nova medida'}</h2>
${formShell(c, editing ? `/app/pacientes/${p.id}/crescimento/${editing.id}` : `/app/pacientes/${p.id}/crescimento`, h`<div class="row">${GROWTH_FIELDS.map((f) => renderField(f, editing ?? { measured_on: todayISO() }))}</div>`,
  h`<button class="btn primary">Salvar medida</button>${editing ? h`<a class="btn" href="/app/pacientes/${p.id}/crescimento">Cancelar</a>` : ''}`)}</section>
<h2>Histórico de medidas</h2>
${table(['Data', 'Idade', 'Peso (kg)', 'Comprimento/altura (cm)', 'IMC (kg/m²)', 'Escores', 'Observações', ''], rows, 'Nenhuma medida registrada.')}
<p class="small muted">* O IMC é exibido como cálculo simples (kg/m²) e só deve ser interpretado com referência pediátrica oficial por idade e sexo. Nenhuma classificação adulta é aplicada.</p>
${wpts.length ? h`<h2>Peso ao longo da idade</h2>${lineChart({ title: 'Peso (kg) por idade', series: [{ name: 'Peso (kg)', color: '#3b6a50', points: wpts }], xLabel: 'Idade (m = meses, a = anos)', yLabel: 'kg', xFmt: fmtAge })}` : ''}
${hpts.length ? h`<h2>Comprimento/altura ao longo da idade</h2>${lineChart({ title: 'Comprimento/altura (cm) por idade', series: [{ name: 'cm', color: '#365f8a', points: hpts }], xLabel: 'Idade (m = meses, a = anos)', yLabel: 'cm', xFmt: fmtAge })}` : ''}
<p class="small muted">Os gráficos mostram somente as medidas registradas; não há curvas, percentis ou escores inventados.</p>`);
}
staffRoute('GET', '/app/pacientes/:pid/crescimento', async (c, tx) => { const p = await loadPatient(tx, c.params.pid); return p ? growthView(c, tx, p) : notFoundRes(c); });
staffRoute('GET', '/app/pacientes/:pid/crescimento/:mid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.mid)) return notFoundRes(c);
  const m = await J1<any>(tx, `select * from public.growth_measurements where id = $1 and patient_id = $2`, [c.params.mid, p.id]);
  return m ? growthView(c, tx, p, m) : notFoundRes(c);
});
async function saveGrowth(c: Ctx, tx: Tx, mid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return notFoundRes(c);
  const r = readFields(c, GROWTH_FIELDS);
  if (!r.values.weight_kg && !r.values.height_cm) r.errors.push('Informe peso e/ou altura.');
  if (r.errors.length) return growthView(c, tx, p, { id: mid, ...r.values }, r.errors);
  if (mid) await updateRow(tx, 'growth_measurements', mid, colsOf(GROWTH_FIELDS), r.values);
  else await insertRow(tx, 'growth_measurements', [{ name: 'patient_id', type: 'uuid' }, ...colsOf(GROWTH_FIELDS)], { patient_id: p.id, ...r.values });
  return redirect(c, `/app/pacientes/${p.id}/crescimento`, { ok: 'Medida salva.' });
}
staffRoute('POST', '/app/pacientes/:pid/crescimento', (c, tx) => saveGrowth(c, tx));
staffRoute('POST', '/app/pacientes/:pid/crescimento/:mid', (c, tx) => saveGrowth(c, tx, c.params.mid));

// ===================== DIÁRIO ALIMENTAR =====================
staffRoute('GET', '/app/pacientes/:pid/diario', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return notFoundRes(c);
  const rows = await J<any>(tx, `select id, entry_date, entry_time, meal, foods_served, foods_accepted, qty_offered, qty_consumed, qty_unit, status, photo_before_path, photo_after_path, updated_at from public.food_diary_entries where patient_id = $1 order by entry_date desc, entry_time desc nulls last`, [p.id]);
  return patientShell(c, p, 'diario', h`<div class="actions"><a class="btn primary" href="/app/pacientes/${p.id}/diario/novo">Novo registro</a></div>
${table(['Data', 'Refeição', 'Oferecido', 'Consumido', 'Fotos', 'Situação', ''], rows.map((r) => [h`${toBR(r.entry_date)} ${r.entry_time ? String(r.entry_time).slice(0, 5) : ''}`, h`${r.meal ?? ''}`,
  h`${r.foods_served ?? ''} ${r.qty_offered ? h`<br><span class="small muted">${fmtNum(r.qty_offered)} ${r.qty_unit ?? ''}</span>` : ''}`,
  h`${r.foods_accepted ?? ''} ${r.qty_consumed ? h`<br><span class="small muted">${fmtNum(r.qty_consumed)} ${r.qty_unit ?? ''}</span>` : ''}`,
  h`${r.photo_before_path ? h`<a href="/arquivos/${r.photo_before_path}" target="_blank" rel="noopener">antes</a> ` : ''}${r.photo_after_path ? h`<a href="/arquivos/${r.photo_after_path}" target="_blank" rel="noopener">depois</a>` : ''}`,
  statusTag(r.status), h`<a class="btn small" href="/app/pacientes/${p.id}/diario/${r.id}">Abrir</a>`]), 'Nenhum registro no diário. Use "Novo registro".')}
<p class="small muted">Este diário registra o que foi observado. O sistema não estima ingestão a partir de fotos e não calcula calorias ou nutrientes.</p>`);
});
async function diaryForm(c: Ctx, tx: Tx, p: any, e: any | null, errors: string[] = []) {
  const names = await nameMap(tx);
  return patientShell(c, p, 'diario', h`<h2>${e?.id ? 'Registro do diário' : 'Novo registro do diário'}</h2>
${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}${e?.id ? savedAt(e.updated_at, names[e.updated_by]) : ''}
${formShell(c, e?.id ? `/app/pacientes/${p.id}/diario/${e.id}` : `/app/pacientes/${p.id}/diario`, h`${renderGroups(DIARY_GROUPS, e ?? { entry_date: todayISO() })}
<fieldset class="card"><legend>Fotos (armazenamento privado)</legend><p class="hint">JPG, PNG ou WEBP até 10 MB. Visíveis somente à equipe.</p>
<div class="row"><label>Foto ANTES${e?.photo_before_path ? h` <a href="/arquivos/${e.photo_before_path}" target="_blank" rel="noopener">(ver atual)</a>` : ''}<input type="file" name="photo_before" accept="image/jpeg,image/png,image/webp"></label>
<label>Foto DEPOIS${e?.photo_after_path ? h` <a href="/arquivos/${e.photo_after_path}" target="_blank" rel="noopener">(ver atual)</a>` : ''}<input type="file" name="photo_after" accept="image/jpeg,image/png,image/webp"></label></div></fieldset>`,
  h`<button class="btn" name="_acao" value="rascunho">Salvar rascunho</button><button class="btn primary" name="_acao" value="final">Salvar registro final</button><a class="btn" href="/app/pacientes/${p.id}/diario">Voltar</a>`, true)}`);
}
staffRoute('GET', '/app/pacientes/:pid/diario/novo', async (c, tx) => { const p = await loadPatient(tx, c.params.pid); return p ? diaryForm(c, tx, p, null) : notFoundRes(c); });
staffRoute('GET', '/app/pacientes/:pid/diario/:eid', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p || !isUuid(c.params.eid)) return notFoundRes(c);
  const e = await J1<any>(tx, `select * from public.food_diary_entries where id = $1 and patient_id = $2`, [c.params.eid, p.id]);
  return e ? diaryForm(c, tx, p, e) : notFoundRes(c);
});
async function saveDiary(c: Ctx, tx: Tx, eid?: string) {
  const p = await loadPatient(tx, c.params.pid); if (!p) return notFoundRes(c);
  const fields = flatFields(DIARY_GROUPS);
  const r = readFields(c, fields);
  if (r.values.qty_consumed != null && !r.values.qty_unit) r.errors.push('Informe a unidade da quantidade.');
  if (r.errors.length) return diaryForm(c, tx, p, { id: eid, ...r.values }, r.errors);
  const cols: any[] = [...colsOf(fields), { name: 'status', type: 'text' }];
  const vals: any = { ...r.values, status: fv(c, '_acao') === 'final' ? 'final' : 'rascunho' };
  for (const [field, col] of [['photo_before', 'photo_before_path'], ['photo_after', 'photo_after_path']] as const) {
    const f = c.form?.get(field);
    if (f instanceof File && f.size > 0) { vals[col] = (await storeUpload(tx, p.id, 'diary', f, IMG)).path; cols.push({ name: col, type: 'text' }); }
  }
  if (eid) await updateRow(tx, 'food_diary_entries', eid, cols, vals);
  else { eid = await insertRow(tx, 'food_diary_entries', [{ name: 'patient_id', type: 'uuid' }, ...cols], { patient_id: p.id, ...vals }); }
  return redirect(c, `/app/pacientes/${p.id}/diario/${eid}`, { ok: vals.status === 'final' ? 'Registro salvo como final.' : 'Rascunho salvo.' });
}
staffRoute('POST', '/app/pacientes/:pid/diario', (c, tx) => saveDiary(c, tx));
staffRoute('POST', '/app/pacientes/:pid/diario/:eid', (c, tx) => saveDiary(c, tx, c.params.eid));

staffRoute('GET', '/app/diario', async (c, tx) => {
  const rows = await J<any>(tx, `select e.id, e.entry_date, e.meal, e.status, e.patient_id, p.full_name from public.food_diary_entries e join public.patients p on p.id = e.patient_id order by e.entry_date desc, e.created_at desc limit 60`);
  return htmlRes(c, page(c, { title: 'Diário alimentar', body: h`<h1>Diário alimentar</h1><p class="muted">Registros mais recentes de todos os pacientes. Para criar, abra o paciente e a aba "Diário alimentar".</p>
${table(['Data', 'Paciente', 'Refeição', 'Situação'], rows.map((r) => [h`${toBR(r.entry_date)}`, h`<a href="/app/pacientes/${r.patient_id}/diario/${r.id}">${r.full_name}</a>`, h`${r.meal ?? ''}`, statusTag(r.status)]), 'Nenhum registro de diário ainda.')}` }));
});

// ===================== ESCOLA (visão da equipe) =====================
staffRoute('GET', '/app/pacientes/:pid/escola', async (c, tx) => {
  const p = await loadPatient(tx, c.params.pid); if (!p) return notFoundRes(c);
  const rows = await J<any>(tx, `select * from public.school_meal_records where patient_id = $1 order by record_date desc, created_at desc`, [p.id]);
  const gs = await J<any>(tx, `select id, title, audience from public.guidances where patient_id = $1 and audience = 'escola'`, [p.id]);
  const names = await nameMap(tx);
  return patientShell(c, p, 'escola', h`<div class="notice">Escola: <strong>${p.school_name ?? 'não informada'}</strong> · fotos ${p.school_photo_authorized ? 'autorizadas' : 'não autorizadas'}. Orientações para a escola são liberadas na aba "Documentos e compartilhamentos" (${gs.length} cadastrada(s)).</div>
${rows.length ? rows.map((r) => h`<article class="card"><h3>${toBR(r.record_date)} ${r.record_time ? String(r.record_time).slice(0, 5) : ''} — ${r.meal ?? 'Refeição'}
${r.reviewed_at ? h`<span class="tag">revisado em ${toBR(String(r.reviewed_at).slice(0, 10))}</span>` : h`<span class="tag warn">novo</span>`}</h3>
${kv([['Oferecido', r.foods_offered], ['Consumido', r.foods_consumed], ['Quantidade', r.qty_offered || r.qty_consumed ? `oferecida ${fmtNum(r.qty_offered) || '—'} / consumida ${fmtNum(r.qty_consumed) || '—'} ${r.qty_unit ?? ''}` : ''],
  ['Ambiente', r.environment], ['Companhia', r.companions], ['Duração', r.duration_min ? r.duration_min + ' min' : ''], ['Ajuda', r.help_needed], ['Comportamento', r.behavior], ['Desconfortos', r.discomfort], ['Observações', r.notes], ['Registrado por', names[r.created_by]]])}
${r.photo_path ? h`<a href="/arquivos/${r.photo_path}" target="_blank" rel="noopener"><img class="photo" src="/arquivos/${r.photo_path}" alt="Foto da refeição registrada pela escola"></a>` : ''}
${!r.reviewed_at ? h`<form method="post" action="/app/pacientes/${p.id}/escola/${r.id}/revisar">${csrfField(c)}<button class="btn small">Marcar como revisado</button></form>` : ''}</article>`)
  : empty('A escola ainda não enviou registros para este paciente.')}`);
});
staffRoute('POST', '/app/pacientes/:pid/escola/:rid/revisar', async (c, tx) => {
  if (!isUuid(c.params.rid)) return notFoundRes(c);
  await tx`update public.school_meal_records set reviewed_by = ${c.user!.id}::uuid, reviewed_at = now() where id = ${c.params.rid}::uuid and patient_id = ${c.params.pid}::uuid`;
  return redirect(c, `/app/pacientes/${c.params.pid}/escola`, { ok: 'Registro marcado como revisado.' });
});
staffRoute('GET', '/app/escola', async (c, tx) => {
  const rows = await J<any>(tx, `select r.id, r.record_date, r.meal, r.reviewed_at, r.patient_id, p.full_name, p.school_name from public.school_meal_records r join public.patients p on p.id = r.patient_id order by (r.reviewed_at is null) desc, r.record_date desc limit 80`);
  return htmlRes(c, page(c, { title: 'Área escolar', body: h`<h1>Área escolar</h1><p class="muted">Registros enviados pelas escolas (não revisados primeiro).</p>
${table(['Data', 'Paciente', 'Escola', 'Refeição', 'Situação'], rows.map((r) => [h`${toBR(r.record_date)}`, h`<a href="/app/pacientes/${r.patient_id}/escola">${r.full_name}</a>`, h`${r.school_name ?? ''}`, h`${r.meal ?? ''}`,
  r.reviewed_at ? h`<span class="tag">revisado</span>` : h`<span class="tag warn">novo</span>`]), 'Nenhum registro escolar recebido ainda.')}` }));
});
