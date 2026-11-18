import { h, join } from '../html';
import { Ctx, htmlRes, page, redirect, csrfField, fv, fvAll, notFound, respond, MASTER, STAFF } from '../web';
import { asUser, asService, J, J1, Tx, insertRow, isUuid } from '../db';
import { staffRoute, masterRoute, table, statusTag, empty, nameMap, formShell, loadPatient, canPublish } from '../ui';
import { ROLE_LABEL, createToken, linkFor, deliverLink, destroyUserSessions, isMaster } from '../auth';
import { buildReport, reportHtml, reportPdf, REPORT_TYPES } from '../report';
import { storeBytes } from '../files';
import { fromBR, toBR, dateTimeBR, todayISO } from '../../lib/age';
import { AGE_BANDS } from '../../lib/questionnaire/items';
import { KIND_LABEL } from '../content';
import { fmtNum } from '../forms';

// ===================== USUÁRIOS E ACESSOS =====================
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITABLE = ['supervisionado', 'escola', 'familia'];

masterRoute('GET', '/app/usuarios', async (c, tx) => {
  const users = await J<any>(tx, `select p.id, p.full_name, p.email, p.role, p.active, p.can_publish, p.school_name,
     (select count(*) from public.access_links l where l.user_id = p.id and l.active)::int as vinculos from public.profiles p order by p.role, p.full_name`);
  const invs = await J<any>(tx, `select * from public.invitations where role in ('supervisionado','escola','familia') order by created_at desc limit 60`);
  const patients = await J<any>(tx, `select id, full_name, school_name from public.patients where status = 'ativo' order by full_name`);
  const outbox = await asService((t) => J<any>(t, `select o.to_email, o.kind, o.link, o.created_at from auth.outbox o join auth.tokens k on k.id = o.token_id
     where o.sent_at is null and k.used_at is null and k.expires_at > now() order by o.created_at desc limit 30`));
  const pChecks = h`<fieldset><legend>Crianças vinculadas</legend><div class="scale">${patients.length ? patients.map((p) => h`<label class="check"><input type="checkbox" name="pacientes" value="${p.id}"> ${p.full_name}${p.school_name ? ' (' + p.school_name + ')' : ''}</label>`) : h`<span class="muted">Cadastre pacientes primeiro.</span>`}</div></fieldset>`;
  const invForm = (tipo: string, title: string, extra: any) => h`<details class="card"><summary><strong>${title}</strong></summary>${formShell(c, '/app/usuarios/convidar', h`<input type="hidden" name="tipo" value="${tipo}">
<div class="row"><label>Nome<input name="nome" required maxlength="120"></label><label>E-mail<input type="email" name="email" required></label></div>${extra}`, h`<button class="btn primary">Criar convite</button>`)}</details>`;
  return htmlRes(c, page(c, { title: 'Usuários e acessos', body: h`<h1>Usuários e acessos</h1>
<p class="muted">Não há cadastro público. Cada pessoa entra por convite individual, com link de uso único (válido por 7 dias).</p>
${invForm('supervisionado', 'Convidar supervisionado(a)', h`<label class="check"><input type="checkbox" name="can_publish" value="on"> Autorizar a liberar conteúdo para famílias e escolas (autorização explícita de master)</label>`)}
${invForm('familia', 'Convidar família e vincular à criança', pChecks)}
${invForm('escola', 'Convidar escola e vincular crianças', h`<label>Nome da escola<input name="escola" maxlength="120"></label>${pChecks}`)}
${outbox.length ? h`<section class="card"><h2>Links aguardando entrega manual</h2><p class="small muted">O envio automático de e-mail não está configurado (ou falhou). Copie o link e envie à pessoa por um canal seguro. Cada link só funciona uma vez.</p>
${table(['Para', 'Tipo', 'Link', 'Gerado em'], outbox.map((o) => [h`${o.to_email}`, h`${o.kind === 'convite' ? 'Convite' : 'Recuperação de senha'}`, h`<input readonly value="${o.link}" style="min-width:260px">`, h`${dateTimeBR(o.created_at)}`]), '')}</section>` : ''}
<h2>Convites</h2>${table(['E-mail', 'Perfil', 'Situação', 'Enviado', ''], invs.map((i) => [h`${i.email}<br><span class="small muted">${i.full_name ?? ''}</span>`, h`${ROLE_LABEL[i.role as keyof typeof ROLE_LABEL]}`,
  h`<span class="tag ${i.status === 'pendente' ? 'warn' : i.status === 'aceito' ? '' : 'err'}">${i.status}</span>`, h`${i.send_count}× ${i.last_sent_at ? '· ' + dateTimeBR(i.last_sent_at) : ''}`,
  i.status === 'pendente' ? h`<form method="post" action="/app/usuarios/convites/${i.id}/reenviar" class="inline">${csrfField(c)}<button class="btn small">Reenviar</button></form>
   <form method="post" action="/app/usuarios/convites/${i.id}/cancelar" class="inline">${csrfField(c)}<button class="btn small danger" data-confirm="Cancelar este convite?">Cancelar</button></form>` : '']), 'Nenhum convite criado.')}
<h2>Pessoas com acesso</h2>${table(['Nome', 'Perfil', 'Situação', 'Ações'], users.map((u) => {
  const m = u.role === 'master_alana' || u.role === 'master_cores';
  return [h`<strong>${u.full_name}</strong><br><span class="small muted">${u.email}</span>`, h`${ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}${u.role === 'supervisionado' ? (u.can_publish ? ' · pode liberar' : '') : ''}${u.role === 'escola' ? ' · ' + (u.school_name ?? '') : ''}`,
    u.active ? h`<span class="tag">ativo</span>` : h`<span class="tag err">desativado</span>`,
    h`${!m ? h`<form method="post" action="/app/usuarios/${u.id}/ativo" class="inline">${csrfField(c)}<input type="hidden" name="ativo" value="${u.active ? '0' : '1'}"><button class="btn small ${u.active ? 'danger' : ''}" ${u.active ? 'data-confirm="Desativar este acesso? A pessoa será desconectada imediatamente."' : ''}>${u.active ? 'Desativar acesso' : 'Reativar acesso'}</button></form>` : ''}
    ${u.role === 'supervisionado' ? h`<form method="post" action="/app/usuarios/${u.id}/publicar" class="inline">${csrfField(c)}<input type="hidden" name="valor" value="${u.can_publish ? '0' : '1'}"><button class="btn small">${u.can_publish ? 'Retirar autorização de liberar' : 'Autorizar a liberar'}</button></form>` : ''}
    ${u.role === 'escola' || u.role === 'familia' ? h`<a class="btn small" href="/app/usuarios/${u.id}/vinculos">Vínculos (${u.vinculos})</a>` : ''}
    <form method="post" action="/app/usuarios/${u.id}/recuperacao" class="inline">${csrfField(c)}<button class="btn small">Iniciar recuperação de senha</button></form>`];
}), 'Nenhum usuário.')}
<p class="small muted">Contas master não podem ser desativadas pelo aplicativo. Senhas nunca são exibidas: a recuperação gera um link para a própria pessoa criar uma nova senha.</p>` }));
});

async function issue(c: Ctx, kind: 'convite' | 'recuperacao', email: string, subject: string, text: string, hours: number) {
  return asService(async (t) => {
    const tk = await createToken(t, kind, email, c.user!.id, hours);
    const link = linkFor(kind, tk.token);
    const how = await deliverLink(t, { kind, email, tokenId: tk.id, link, subject, text });
    return { how, link };
  });
}
const sent = (how: string, link: string) => (how === 'enviado' ? 'Enviado por e-mail.' : `E-mail automático não configurado. Link de uso único (copie e envie): ${link}`);

masterRoute('POST', '/app/usuarios/convidar', async (c, tx) => {
  const tipo = fv(c, 'tipo'); const email = fv(c, 'email').toLowerCase(); const nome = fv(c, 'nome');
  if (!INVITABLE.includes(tipo)) return notFound(c);
  if (!EMAIL_RE.test(email)) return redirect(c, '/app/usuarios', { err: 'E-mail inválido.' });
  const pids = fvAll(c, 'pacientes').filter(isUuid);
  if (tipo !== 'supervisionado' && !pids.length) return redirect(c, '/app/usuarios', { err: 'Selecione ao menos uma criança para vincular.' });
  const exists = await asService((t) => J1<any>(t, `select 1 as x from auth.users where lower(email) = $1`, [email]));
  if (exists) return redirect(c, '/app/usuarios', { err: 'Já existe uma conta com este e-mail.' });
  await tx`update public.invitations set status = 'cancelado' where lower(email) = ${email} and status = 'pendente'`;
  const id = await insertRow(tx, 'invitations', [{ name: 'email', type: 'text' }, { name: 'full_name', type: 'text' }, { name: 'role', type: 'text' }, { name: 'patient_ids', type: 'uuids' }, { name: 'school_name', type: 'text' }, { name: 'can_publish', type: 'bool' }, { name: 'invited_by', type: 'uuid' }],
    { email, full_name: nome, role: tipo, patient_ids: pids, school_name: tipo === 'escola' ? fv(c, 'escola') : null, can_publish: tipo === 'supervisionado' && fv(c, 'can_publish') === 'on', invited_by: c.user!.id });
  const r = await issue(c, 'convite', email, 'Convite — Minha Terapia Alimentar', 'Você foi convidado(a) para acessar o Minha Terapia Alimentar. Use o link (válido por 7 dias, uso único) para criar sua senha.', 24 * 7);
  await tx`update public.invitations set last_sent_at = now(), send_count = send_count + 1 where id = ${id}::uuid`;
  return redirect(c, '/app/usuarios', { ok: `Convite criado. ${sent(r.how, r.link)}` });
});
masterRoute('POST', '/app/usuarios/convites/:id/reenviar', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const inv = await J1<any>(tx, `select * from public.invitations where id = $1 and status = 'pendente'`, [c.params.id]);
  if (!inv) return redirect(c, '/app/usuarios', { err: 'Convite não está pendente.' });
  const r = await issue(c, 'convite', inv.email, 'Convite — Minha Terapia Alimentar', 'Novo link para criar sua senha no Minha Terapia Alimentar (válido por 7 dias, uso único).', 24 * 7);
  await tx`update public.invitations set last_sent_at = now(), send_count = send_count + 1 where id = ${inv.id}::uuid`;
  return redirect(c, '/app/usuarios', { ok: `Convite reenviado (o link anterior deixou de funcionar). ${sent(r.how, r.link)}` });
});
masterRoute('POST', '/app/usuarios/convites/:id/cancelar', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const inv = await J1<any>(tx, `update public.invitations set status = 'cancelado' where id = $1 and status = 'pendente' returning email`, [c.params.id]);
  if (inv) await asService((t) => t`update auth.tokens set used_at = now() where lower(email) = ${inv.email.toLowerCase()} and kind = 'convite' and used_at is null`);
  return redirect(c, '/app/usuarios', { ok: 'Convite cancelado.' });
});
masterRoute('POST', '/app/usuarios/:id/ativo', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const active = fv(c, 'ativo') === '1';
  const r = await tx`update public.profiles set active = ${active} where id = ${c.params.id}::uuid returning id`;
  if (!r.length) return notFound(c);
  if (!active) await destroyUserSessions(c.params.id); // efeito imediato: encerra sessões abertas
  return redirect(c, '/app/usuarios', { ok: active ? 'Acesso reativado.' : 'Acesso desativado e sessões encerradas.' });
});
masterRoute('POST', '/app/usuarios/:id/publicar', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  await tx`update public.profiles set can_publish = ${fv(c, 'valor') === '1'} where id = ${c.params.id}::uuid and role = 'supervisionado'`;
  return redirect(c, '/app/usuarios', { ok: 'Permissão de liberar conteúdo atualizada.' });
});
masterRoute('POST', '/app/usuarios/:id/recuperacao', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const u = await J1<any>(tx, `select email from public.profiles where id = $1 and active`, [c.params.id]);
  if (!u) return redirect(c, '/app/usuarios', { err: 'Usuário inexistente ou desativado.' });
  const r = await issue(c, 'recuperacao', u.email, 'Minha Terapia Alimentar — redefinir senha', 'Use o link abaixo (válido por 2 horas) para criar uma nova senha.', 2);
  return redirect(c, '/app/usuarios', { ok: `Recuperação iniciada. ${sent(r.how, r.link)}` });
});
masterRoute('GET', '/app/usuarios/:id/vinculos', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const u = await J1<any>(tx, `select id, full_name, email, role from public.profiles where id = $1 and role in ('escola','familia')`, [c.params.id]);
  if (!u) return notFound(c);
  const pts = await J<any>(tx, `select p.id, p.full_name, p.school_name, p.status, coalesce(l.active, false) as linked from public.patients p left join public.access_links l on l.patient_id = p.id and l.user_id = $1 order by p.full_name`, [u.id]);
  return htmlRes(c, page(c, { title: 'Vínculos', active: '/app/usuarios', body: h`<h1>Vínculos de ${u.full_name}</h1><p class="muted">${u.email} · ${ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}. Marque as crianças que esta conta pode acessar.</p>
${formShell(c, `/app/usuarios/${u.id}/vinculos`, h`<div class="stack">${pts.map((p) => h`<label class="check"><input type="checkbox" name="pacientes" value="${p.id}" ${p.linked ? 'checked' : ''}> ${p.full_name} ${p.status === 'arquivado' ? '(arquivado)' : ''} <span class="muted small">${p.school_name ?? ''}</span></label>`)}</div>`,
  h`<button class="btn primary">Salvar vínculos</button><a class="btn" href="/app/usuarios">Voltar</a>`)}` }));
});
masterRoute('POST', '/app/usuarios/:id/vinculos', async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const want = new Set(fvAll(c, 'pacientes').filter(isUuid));
  const pts = await J<{ id: string }>(tx, `select id from public.patients`);
  for (const p of pts) {
    if (want.has(p.id)) await tx`insert into public.access_links(user_id, patient_id, active) values (${c.params.id}::uuid, ${p.id}::uuid, true) on conflict (user_id, patient_id) do update set active = true`;
    else await tx`update public.access_links set active = false where user_id = ${c.params.id}::uuid and patient_id = ${p.id}::uuid and active`;
  }
  return redirect(c, '/app/usuarios', { ok: 'Vínculos atualizados.' });
});

// ===================== RELATÓRIOS E COMPARTILHAMENTOS =====================
staffRoute('GET', '/app/relatorios', async (c, tx) => {
  const pts = await J<any>(tx, `select id, full_name from public.patients where status = 'ativo' order by full_name`);
  const reps = await J<any>(tx, `select d.id, d.title, d.storage_path, d.created_at, d.patient_id, p.full_name from public.documents d join public.patients p on p.id = d.patient_id where d.kind = 'relatorio' order by d.created_at desc limit 30`);
  const pubs = await J<any>(tx, `select b.*, p.full_name from public.publications b join public.patients p on p.id = b.patient_id where b.status = 'ativo' order by b.published_at desc limit 40`);
  const names = await nameMap(tx);
  return htmlRes(c, page(c, { title: 'Relatórios e compartilhamentos', body: h`<h1>Relatórios e compartilhamentos</h1>
<section class="card"><h2>Novo relatório em PDF</h2><p class="muted">Você escolhe exatamente quais registros entram e vê uma prévia antes de gerar. Notas internas não entram, a menos que você marque.</p>
<form method="get" action="/app/relatorios/novo" class="stack"><div class="row"><label>Paciente *<select name="paciente" required><option value="">— selecione —</option>${pts.map((p) => h`<option value="${p.id}">${p.full_name}</option>`)}</select></label>
<label>Tipo de relatório *<select name="tipo" required>${Object.entries(REPORT_TYPES).map(([k, l]) => h`<option value="${k}">${l}</option>`)}</select></label>
<label>Período: de<input name="de" placeholder="DD/MM/AAAA" data-mask="date" maxlength="10" inputmode="numeric"></label><label>até<input name="ate" placeholder="DD/MM/AAAA" data-mask="date" maxlength="10" inputmode="numeric"></label></div>
<div class="actions"><button class="btn primary">Escolher registros</button></div></form></section>
<h2>Relatórios gerados</h2>${table(['Relatório', 'Paciente', 'Gerado em', ''], reps.map((r) => [h`${r.title}`, h`<a href="/app/pacientes/${r.patient_id}/documentos">${r.full_name}</a>`, h`${dateTimeBR(r.created_at)}`, h`<a class="btn small" href="/arquivos/${r.storage_path}">Baixar</a>`]), 'Nenhum relatório gerado.')}
<h2>Conteúdos liberados no momento</h2><p class="small muted">Para liberar ou retirar, abra o paciente › "Documentos e compartilhamentos".</p>
${table(['Paciente', 'Conteúdo', 'Destinatário', 'Liberado por', ''], pubs.map((b) => [h`${b.full_name}`, h`${KIND_LABEL[b.kind] ?? b.kind}: ${b.title} (v${b.version})`, h`${b.audience === 'familia' ? 'Família' : 'Escola'}`, h`${names[b.published_by] ?? ''}<br><span class="small muted">${dateTimeBR(b.published_at)}</span>`,
  h`<a class="btn small" href="/app/pacientes/${b.patient_id}/documentos">Gerenciar</a>`]), 'Nada liberado no momento.')}` }));
});

async function candidates(tx: Tx, pid: string, type: string, from: string | null, to: string | null) {
  const rng = (col: string) => `(${col} >= coalesce($2::date, '0001-01-01') and ${col} <= coalesce($3::date, '9999-12-31'))`;
  const a = [pid, from, to];
  const out: { tok: string; label: string; group: string }[] = [];
  const add = (group: string, rows: any[], tok: (r: any) => string, label: (r: any) => string) => rows.forEach((r) => out.push({ group, tok: tok(r), label: label(r) }));
  if (['avaliacao_inicial'].includes(type)) add('Anamnese', await J<any>(tx, `select id, recorded_on, status from public.anamneses where patient_id = $1 order by recorded_on desc`, [pid]), (r) => 'anamneses:' + r.id, (r) => `Anamnese de ${toBR(r.recorded_on)} (${r.status})`);
  if (['avaliacao_inicial', 'acompanhamento'].includes(type)) {
    add('Questionários finalizados', await J<any>(tx, `select id, answered_on, age_band from public.questionnaire_responses where patient_id = $1 and status = 'finalizado' and ${rng('answered_on')} order by answered_on desc`, a), (r) => 'questionnaires:' + r.id, (r) => `${toBR(r.answered_on)} — ${AGE_BANDS.find((b) => b.id === r.age_band)?.label}`);
    out.push({ group: 'Crescimento e repertório', tok: 'growth:all', label: 'Histórico de medidas (peso/altura) no período' }, { group: 'Crescimento e repertório', tok: 'repertoire:all', label: 'Repertório alimentar registrado' });
  }
  if (['acompanhamento', 'orientacoes_familia'].includes(type)) add('Planejamentos', await J<any>(tx, `select id, title, status from public.therapeutic_plans where patient_id = $1 order by created_at desc`, [pid]), (r) => 'plans:' + r.id, (r) => `${r.title} (${r.status})`);
  if (['acompanhamento', 'sessoes'].includes(type)) add('Sessões finalizadas', await J<any>(tx, `select id, session_date, location from public.sessions where patient_id = $1 and status = 'finalizada' and ${rng('session_date')} order by session_date desc`, a), (r) => 'sessions:' + r.id, (r) => `Sessão de ${toBR(r.session_date)}`);
  if (type === 'diario') add('Registros finais do diário', await J<any>(tx, `select id, entry_date, meal from public.food_diary_entries where patient_id = $1 and status = 'final' and ${rng('entry_date')} order by entry_date desc`, a), (r) => 'diary:' + r.id, (r) => `${toBR(r.entry_date)} — ${r.meal ?? 'refeição'}`);
  if (type === 'escola') add('Registros escolares', await J<any>(tx, `select id, record_date, meal from public.school_meal_records where patient_id = $1 and ${rng('record_date')} order by record_date desc`, a), (r) => 'school:' + r.id, (r) => `${toBR(r.record_date)} — ${r.meal ?? 'refeição'}`);
  if (type === 'orientacoes_familia') add('Orientações para a família', await J<any>(tx, `select id, title from public.guidances where patient_id = $1 and audience = 'familia' order by created_at desc`, [pid]), (r) => 'guidances:' + r.id, (r) => r.title);
  return out;
}
const readRange = (c: Ctx, src: 'q' | 'f') => {
  const g = (k: string) => (src === 'q' ? c.url.searchParams.get(k) ?? '' : fv(c, k)).trim();
  const de = g('de'), ate = g('ate');
  return { de, ate, from: de ? fromBR(de) : null, to: ate ? fromBR(ate) : null, bad: (de && !fromBR(de)) || (ate && !fromBR(ate)) };
};
staffRoute('GET', '/app/relatorios/novo', async (c, tx) => {
  const pid = c.url.searchParams.get('paciente') ?? ''; const tipo = c.url.searchParams.get('tipo') ?? '';
  const p = await loadPatient(tx, pid); if (!p || !REPORT_TYPES[tipo]) return notFound(c);
  const r = readRange(c, 'q');
  if (r.bad) return redirect(c, '/app/relatorios', { err: 'Período inválido (use DD/MM/AAAA).' });
  const cand = await candidates(tx, p.id, tipo, r.from, r.to);
  const groups = [...new Set(cand.map((x) => x.group))];
  return htmlRes(c, page(c, { title: 'Escolher registros', active: '/app/relatorios', body: h`<h1>${REPORT_TYPES[tipo]} — ${p.full_name}</h1><p class="muted">Período: ${r.de || 'início'} a ${r.ate || 'hoje'}. Marque os registros que devem constar no relatório.</p>
${cand.length ? formShell(c, '/app/relatorios/previa', h`<input type="hidden" name="paciente" value="${p.id}"><input type="hidden" name="tipo" value="${tipo}"><input type="hidden" name="de" value="${r.de}"><input type="hidden" name="ate" value="${r.ate}">
${groups.map((g) => h`<fieldset class="card"><legend>${g}</legend><div class="stack">${cand.filter((x) => x.group === g).map((x) => h`<label class="check"><input type="checkbox" name="sel" value="${x.tok}"> ${x.label}</label>`)}</div></fieldset>`)}
<fieldset class="card"><legend>Notas internas</legend><label class="check"><input type="checkbox" name="internas" value="on"> Incluir notas internas (uso restrito à equipe — não compartilhar com família ou escola)</label></fieldset>`,
  h`<button class="btn primary">Pré-visualizar</button><a class="btn" href="/app/relatorios">Cancelar</a>`) : empty('Não há registros elegíveis para este tipo e período.', h`<a class="btn" href="/app/relatorios">Voltar</a>`)}` }));
});
async function reportFromForm(c: Ctx, tx: Tx) {
  const r = readRange(c, 'f');
  if (r.bad) return { err: 'Período inválido (use DD/MM/AAAA).' };
  const sel = fvAll(c, 'sel');
  if (!sel.length) return { err: 'Selecione ao menos um registro para o relatório.' };
  const doc = await buildReport(tx, c.user!, { patientId: fv(c, 'paciente'), type: fv(c, 'tipo'), from: r.from, to: r.to, selected: sel, internal: fv(c, 'internas') === 'on' });
  return doc ? { doc, sel, r } : { err: 'Paciente ou tipo inválido.' };
}
staffRoute('POST', '/app/relatorios/previa', async (c, tx) => {
  const x = await reportFromForm(c, tx);
  if ('err' in x) return redirect(c, '/app/relatorios', { err: x.err });
  return htmlRes(c, page(c, { title: 'Prévia do relatório', active: '/app/relatorios', body: h`<h1>Prévia do relatório</h1><p class="muted">Confira o conteúdo. O PDF terá exatamente estas informações.</p>${reportHtml(x.doc)}
${formShell(c, '/app/relatorios/gerar', h`<input type="hidden" name="paciente" value="${fv(c, 'paciente')}"><input type="hidden" name="tipo" value="${fv(c, 'tipo')}"><input type="hidden" name="de" value="${x.r.de}"><input type="hidden" name="ate" value="${x.r.ate}">
${x.sel.map((s) => h`<input type="hidden" name="sel" value="${s}">`)}${x.doc.includesInternal ? h`<input type="hidden" name="internas" value="on">` : ''}`,
  h`<button class="btn primary">Gerar PDF e salvar no prontuário</button><a class="btn" href="/app/relatorios/novo?paciente=${fv(c, 'paciente')}&tipo=${fv(c, 'tipo')}&de=${x.r.de}&ate=${x.r.ate}">Voltar e alterar seleção</a>`)}` }));
});
staffRoute('POST', '/app/relatorios/gerar', async (c, tx) => {
  const x = await reportFromForm(c, tx);
  if ('err' in x) return redirect(c, '/app/relatorios', { err: x.err });
  const bytes = await reportPdf(x.doc);
  const st = await storeBytes(tx, fv(c, 'paciente'), 'reports', bytes, 'application/pdf');
  const title = `${x.doc.title} — ${toBR(todayISO())}${x.doc.includesInternal ? ' (com notas internas)' : ''}`;
  await insertRow(tx, 'documents', [{ name: 'patient_id', type: 'uuid' }, { name: 'title', type: 'text' }, { name: 'kind', type: 'text' }, { name: 'storage_path', type: 'text' }, { name: 'mime_type', type: 'text' }, { name: 'size_bytes', type: 'int' }],
    { patient_id: fv(c, 'paciente'), title, kind: 'relatorio', storage_path: st.path, mime_type: 'application/pdf', size_bytes: st.size });
  return respond(c, bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="relatorio-${todayISO()}.pdf"` } });
});

// ===================== CONFIGURAÇÕES + AUDITORIA =====================
masterRoute('GET', '/app/configuracoes', async (c, tx) => {
  const cfg = (await J1<any>(tx, `select value from public.app_settings where key = 'profissional'`))?.value ?? {};
  const refs = await J<any>(tx, `select source, version, indicator, sex, count(*)::int as n, min(x_value) as xmin, max(x_value) as xmax from public.growth_reference_lms group by 1,2,3,4 order by 1,2,3,4`);
  return htmlRes(c, page(c, { title: 'Configurações', body: h`<h1>Configurações</h1>
<section class="card"><h2>Dados do serviço nos relatórios</h2><p class="muted">O CRN e o título de cada profissional ficam em "Minha conta" de cada pessoa. Nada é preenchido automaticamente.</p>
${formShell(c, '/app/configuracoes', h`<div class="row"><label>Nome do serviço<input name="servico_nome" value="${cfg.servico_nome ?? ''}" maxlength="120" placeholder="Ex.: Espaço CoReS"></label>
<label>Contato (telefone, e-mail, endereço)<input name="contato" value="${cfg.contato ?? ''}" maxlength="200"></label></div>`, h`<button class="btn primary">Salvar</button>`)}</section>
<section class="card"><h2>Referência de crescimento (OMS / Ministério da Saúde)</h2>
${refs.length ? table(['Fonte', 'Versão', 'Indicador', 'Sexo', 'Linhas', 'Idade (meses)'], refs.map((r) => [h`${r.source}`, h`${r.version}`, h`${r.indicator}`, h`${r.sex}`, h`${r.n}`, h`${fmtNum(r.xmin)}–${fmtNum(r.xmax)}`]), '') : h`<div class="notice warn">Nenhuma tabela importada: a funcionalidade de escores está <strong>pendente</strong>. O sistema mostra apenas o histórico de medidas.</div>`}
<p class="small">Importe uma tabela LMS <strong>oficial</strong> baixada da fonte (OMS: "Child Growth Standards" / "Growth reference 5–19 years"; Ministério da Saúde: Caderneta da Criança). CSV com cabeçalho: <code>fonte,versao,indicador,sexo,x,l,m,s</code>, onde indicador ∈ <code>peso_idade</code>, <code>estatura_idade</code>, <code>imc_idade</code>; sexo F ou M; x = idade em meses. O sistema não traz curvas embutidas.</p>
${formShell(c, '/app/configuracoes/referencia', h`<label>Arquivo CSV<input type="file" name="csv" accept=".csv,text/csv" required></label>`, h`<button class="btn">Importar tabela</button>`, true)}</section>
<section class="card"><h2>Registros e segurança</h2><ul><li><a href="/app/auditoria">Histórico de alterações (auditoria)</a></li><li>Cópias de segurança e restauração: veja <code>docs/BACKUP-RESTAURACAO.md</code>.</li><li>Antes de usar dados reais: <code>docs/CHECKLIST-DADOS-REAIS.md</code>.</li></ul></section>` }));
});
masterRoute('POST', '/app/configuracoes', async (c, tx) => {
  const v = JSON.stringify({ servico_nome: fv(c, 'servico_nome'), contato: fv(c, 'contato') });
  await tx`insert into public.app_settings(key, value) values ('profissional', ${v}::text::jsonb) on conflict (key) do update set value = excluded.value`;
  return redirect(c, '/app/configuracoes', { ok: 'Configurações salvas.' });
});
masterRoute('POST', '/app/configuracoes/referencia', async (c, tx) => {
  const f = c.form?.get('csv');
  if (!(f instanceof File) || !f.size || f.size > 5_000_000) return redirect(c, '/app/configuracoes', { err: 'Envie um CSV de até 5 MB.' });
  const lines = (await f.text()).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const delim = lines[0]?.includes(';') ? ';' : ',';
  const head = lines.shift()!.toLowerCase().split(delim).map((s) => s.trim());
  const want = ['fonte', 'versao', 'indicador', 'sexo', 'x', 'l', 'm', 's'];
  if (want.some((w, i) => head[i] !== w)) return redirect(c, '/app/configuracoes', { err: 'Cabeçalho inválido. Use: fonte,versao,indicador,sexo,x,l,m,s' });
  const rows: any[][] = [];
  for (const ln of lines) {
    const p = ln.split(delim);
    const [src, ver, ind, sex, x, l, m, s] = p.map((z) => z.trim());
    const nums = [x, l, m, s].map((z) => Number(z.replace(',', '.')));
    if (p.length !== 8 || !src || !ver || !['peso_idade', 'estatura_idade', 'imc_idade'].includes(ind) || !['F', 'M'].includes(sex) || nums.some((n) => !Number.isFinite(n))) return redirect(c, '/app/configuracoes', { err: `Linha inválida: "${ln.slice(0, 60)}"` });
    rows.push([src, ver, ind, sex, ...nums]);
  }
  if (!rows.length) return redirect(c, '/app/configuracoes', { err: 'O arquivo não tem linhas de dados.' });
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await tx.unsafe(`insert into public.growth_reference_lms(source, version, indicator, sex, x_value, l, m, s) values ${chunk.map((_, k) => `($${k * 8 + 1},$${k * 8 + 2},$${k * 8 + 3},$${k * 8 + 4},$${k * 8 + 5},$${k * 8 + 6},$${k * 8 + 7},$${k * 8 + 8})`).join(',')} on conflict (source, version, indicator, sex, x_value) do nothing`, chunk.flat());
  }
  return redirect(c, '/app/configuracoes', { ok: `${rows.length} linhas importadas.` });
});
masterRoute('GET', '/app/auditoria', async (c, tx) => {
  const rows = await J<any>(tx, `select a.*, p.full_name as paciente from public.audit_log a left join public.patients p on p.id = a.patient_id order by a.at desc limit 200`);
  const del = await J<any>(tx, `select * from public.deletion_log order by deleted_at desc limit 20`);
  const names = await nameMap(tx);
  return htmlRes(c, page(c, { title: 'Histórico de alterações', active: '/app/configuracoes', body: h`<h1>Histórico de alterações</h1><p class="muted">Registra quem alterou o quê e quando. Para dados clínicos guarda apenas os <em>nomes</em> dos campos alterados (nunca o conteúdo). Permissões e publicações guardam valores antigos e novos.</p>
${table(['Quando', 'Quem', 'Ação', 'Tabela', 'Paciente', 'Campos'], rows.map((a) => [h`${dateTimeBR(a.at)}`, h`${names[a.actor] ?? (a.actor ? '—' : 'sistema')}`, h`${a.action}`, h`${a.table_name}`, h`${a.paciente ?? ''}`, h`${(a.changed_fields ?? []).join(', ')}`]), 'Sem registros.')}
<h2>Exclusões definitivas</h2>${table(['Quando', 'Quem', 'Paciente (id)'], del.map((d) => [h`${dateTimeBR(d.deleted_at)}`, h`${names[d.deleted_by] ?? ''}`, h`${d.patient_id}`]), 'Nenhuma exclusão registrada.')}` }));
});
