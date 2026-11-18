// Áreas restritas: ESCOLA (somente área escolar das crianças vinculadas) e FAMÍLIA (somente leitura do que foi liberado).
// Nenhuma tabela clínica é consultada aqui: apenas a visão mínima linked_patients, school_meal_records e publications.
import { h, Raw } from '../html';
import { Ctx, htmlRes, page, redirect, csrfField, fv, route, SCHOOL, FAMILY, notFound } from '../web';
import { asUser, J, J1, Tx, insertRow, updateRow, isUuid } from '../db';
import { empty, table, kv, formShell, friendlyDbError } from '../ui';
import { renderGroups, readFields, flatFields, colsOf, renderField, fmtNum, Group } from '../forms';
import { SCHOOL_FIELDS } from '../entities';
import { storeUpload } from '../files';
import { renderContent, KIND_LABEL } from '../content';
import { toBR, dateTimeBR, todayISO, ageLabel } from '../../lib/age';

type Child = { id: string; full_name: string; preferred_name: string | null; birth_date: string; class_name: string | null; school_photo_authorized: boolean };
const children = (tx: Tx) => J<Child>(tx, `select * from public.linked_patients order by full_name`);

function wrapRoute(method: 'GET' | 'POST', pattern: string, roles: string[], fn: (c: Ctx, tx: Tx) => Promise<Response>) {
  route(method, pattern, async (c) => {
    try { return await asUser(c.user!.id, (tx) => fn(c, tx)); }
    catch (e: any) {
      const m = friendlyDbError(e); if (!m) throw e;
      return redirect(c, c.url.pathname + c.url.search, { err: m });
    }
  }, roles);
}

// ===================== ESCOLA =====================
const photoNote = (ch: Child) => (ch.school_photo_authorized ? 'Foto permitida para esta criança.' : 'Foto NÃO autorizada para esta criança.');
function schoolForm(c: Ctx, ch: Child, rec: any | null, errors: string[] = []) {
  const groups: Group[] = [{ title: 'Refeição na escola', fields: SCHOOL_FIELDS }];
  return page(c, { title: 'Registrar refeição', body: h`<h1>${rec ? 'Editar registro' : 'Registrar refeição'}</h1>
<p><strong>${ch.preferred_name || ch.full_name}</strong> ${ch.class_name ? '· ' + ch.class_name : ''}</p>${errors.length ? h`<div class="flash err" role="alert">${errors.join(' ')}</div>` : ''}
${formShell(c, rec ? `/escola/registro/${rec.id}` : '/escola/registrar', h`<input type="hidden" name="crianca" value="${ch.id}">${renderGroups(groups, rec ?? { record_date: todayISO() })}
<fieldset class="card"><legend>Foto (opcional)</legend><p class="hint">${photoNote(ch)}</p>${ch.school_photo_authorized ? h`<label>Foto da refeição<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>` : ''}</fieldset>`,
  h`<button class="btn primary">Salvar registro</button><a class="btn" href="/escola?crianca=${ch.id}">Cancelar</a>`, true)}` });
}
wrapRoute('GET', '/escola', SCHOOL, async (c, tx) => {
  const kids = await children(tx);
  if (!kids.length) return htmlRes(c, page(c, { title: 'Escola', body: h`<h1>Registrar refeição</h1>${empty('Nenhuma criança está vinculada a esta conta. Fale com a coordenação.')}` }));
  const sel = c.url.searchParams.get('crianca');
  const ch = kids.find((k) => k.id === sel) ?? (kids.length === 1 ? kids[0] : null);
  if (!ch) return htmlRes(c, page(c, { title: 'Escolha a criança', body: h`<h1>Escolha a criança</h1><div class="grid">${kids.map((k) => h`<a class="stat" href="/escola?crianca=${k.id}"><b style="font-size:1.2rem">${k.preferred_name || k.full_name}</b><span>${k.class_name ?? ''}</span></a>`)}</div>` }));
  return htmlRes(c, schoolForm(c, ch, null));
});
async function saveSchool(c: Ctx, tx: Tx, rid?: string) {
  const kids = await children(tx);
  const ch = kids.find((k) => k.id === fv(c, 'crianca'));
  if (!ch) return notFound(c);
  const r = readFields(c, SCHOOL_FIELDS);
  if (r.values.qty_consumed != null && !r.values.qty_unit) r.errors.push('Informe a unidade da quantidade.');
  if (r.errors.length) return htmlRes(c, schoolForm(c, ch, { id: rid, ...r.values }, r.errors), 400);
  const cols: any[] = colsOf(SCHOOL_FIELDS); const vals: any = { ...r.values };
  const ph = c.form?.get('photo');
  if (ph instanceof File && ph.size > 0) {
    vals.photo_path = (await storeUpload(tx, ch.id, 'school', ph, ['image/jpeg', 'image/png', 'image/webp'])).path; cols.push({ name: 'photo_path', type: 'text' });
  }
  if (rid) { const n = await updateRow(tx, 'school_meal_records', rid, cols, vals); if (!n) return notFound(c); }
  else await insertRow(tx, 'school_meal_records', [{ name: 'patient_id', type: 'uuid' }, ...cols], { patient_id: ch.id, ...vals });
  return redirect(c, `/escola/historico?crianca=${ch.id}`, { ok: 'Registro salvo. Obrigado!' });
}
wrapRoute('POST', '/escola/registrar', SCHOOL, (c, tx) => saveSchool(c, tx));
wrapRoute('GET', '/escola/registro/:id', SCHOOL, async (c, tx) => {
  if (!isUuid(c.params.id)) return notFound(c);
  const rec = await J1<any>(tx, `select * from public.school_meal_records where id = $1`, [c.params.id]); // RLS: só crianças vinculadas
  if (!rec || rec.reviewed_at) return redirect(c, '/escola/historico', { err: 'Este registro não pode mais ser editado.' });
  const ch = (await children(tx)).find((k) => k.id === rec.patient_id);
  return ch ? htmlRes(c, schoolForm(c, ch, rec)) : notFound(c);
});
wrapRoute('POST', '/escola/registro/:id', SCHOOL, (c, tx) => saveSchool(c, tx, c.params.id));
wrapRoute('GET', '/escola/historico', SCHOOL, async (c, tx) => {
  const kids = await children(tx);
  const sel = c.url.searchParams.get('crianca');
  const ch = kids.find((k) => k.id === sel) ?? kids[0];
  if (!ch) return htmlRes(c, page(c, { title: 'Histórico', body: h`<h1>Histórico</h1>${empty('Nenhuma criança vinculada.')}` }));
  const recs = await J<any>(tx, `select * from public.school_meal_records where patient_id = $1 order by record_date desc, created_at desc`, [ch.id]);
  const pubs = await J<any>(tx, `select id, kind, title, content, file_path, version, published_at from public.publications where patient_id = $1 and audience = 'escola' order by published_at desc`, [ch.id]);
  return htmlRes(c, page(c, { title: 'Histórico e orientações', body: h`<h1>Histórico e orientações</h1>
${kids.length > 1 ? h`<form method="get" class="row" style="align-items:end"><label>Criança<select name="crianca">${kids.map((k) => h`<option value="${k.id}" ${k.id === ch.id ? 'selected' : ''}>${k.preferred_name || k.full_name}</option>`)}</select></label><div class="actions"><button class="btn">Ver</button></div></form>` : ''}
<p><strong>${ch.full_name}</strong> ${ch.class_name ? '· ' + ch.class_name : ''} <a class="btn small" href="/escola?crianca=${ch.id}">Registrar refeição</a></p>
<h2>Orientações para a escola</h2>
${pubs.length ? pubs.map((b) => h`<article class="card"><h3>${b.title} <span class="small muted">${KIND_LABEL[b.kind] ?? ''} · ${dateTimeBR(b.published_at)}</span></h3>${renderContent(b.content, b.kind)}${b.file_path ? h`<a class="btn small" href="/arquivos/${b.file_path}">Baixar documento</a>` : ''}</article>`) : empty('Nenhuma orientação liberada para a escola.')}
<h2>Registros desta escola</h2>
${recs.length ? recs.map((r) => h`<article class="card"><h3>${toBR(r.record_date)} ${r.record_time ? String(r.record_time).slice(0, 5) : ''} — ${r.meal ?? 'Refeição'} ${r.reviewed_at ? h`<span class="tag">revisado pela equipe</span>` : h`<span class="tag warn">aguardando revisão</span>`}</h3>
${kv([['Oferecido', r.foods_offered], ['Consumido', r.foods_consumed], ['Quantidade', r.qty_offered || r.qty_consumed ? `oferecida ${fmtNum(r.qty_offered) || '—'} / consumida ${fmtNum(r.qty_consumed) || '—'} ${r.qty_unit ?? ''}` : ''], ['Ambiente', r.environment], ['Companhia', r.companions], ['Duração', r.duration_min ? r.duration_min + ' min' : ''], ['Ajuda', r.help_needed], ['Comportamento', r.behavior], ['Desconfortos', r.discomfort], ['Observações', r.notes]])}
${r.photo_path ? h`<img class="photo" src="/arquivos/${r.photo_path}" alt="Foto da refeição">` : ''}${!r.reviewed_at ? h`<a class="btn small" href="/escola/registro/${r.id}">Editar</a>` : ''}</article>`) : empty('Nenhum registro enviado ainda.')}` }));
});

// ===================== FAMÍLIA =====================
wrapRoute('GET', '/familia', FAMILY, async (c, tx) => {
  const kids = await children(tx);
  const today = todayISO();
  return htmlRes(c, page(c, { title: 'Meus filhos', body: h`<h1>Olá! Aqui estão as informações liberadas pela equipe</h1>
${kids.length ? h`<div class="grid">${kids.map((k) => h`<a class="stat" href="/familia/${k.id}"><b style="font-size:1.25rem">${k.preferred_name || k.full_name}</b><span>${ageLabel(k.birth_date, today)} · ver orientações, evoluções e documentos</span></a>`)}</div>` : empty('Nenhuma criança está vinculada a esta conta. Fale com a equipe.')}
<p class="small muted">Esta área é somente para consulta. Apenas o que a equipe liberou aparece aqui.</p>` }));
});
wrapRoute('GET', '/familia/:pid', FAMILY, async (c, tx) => {
  if (!isUuid(c.params.pid)) return notFound(c);
  const ch = (await children(tx)).find((k) => k.id === c.params.pid);
  if (!ch) return notFound(c); // outra criança → igual a "não existe"
  const pubs = await J<any>(tx, `select id, kind, title, content, file_path, version, published_at from public.publications where patient_id = $1 and audience = 'familia' order by published_at desc`, [ch.id]);
  const order = ['orientacao', 'evolucao', 'planejamento', 'crescimento', 'documento'];
  return htmlRes(c, page(c, { title: ch.preferred_name || ch.full_name, active: '/familia', body: h`<p class="small"><a href="/familia">← Meus filhos</a></p><h1>${ch.full_name}</h1>
${pubs.length ? order.map((k) => { const xs = pubs.filter((b) => b.kind === k); return xs.length ? h`<h2>${{ orientacao: 'Orientações', evolucao: 'Evoluções', planejamento: 'Planejamentos', crescimento: 'Crescimento', documento: 'Relatórios e documentos' }[k]}</h2>
${xs.map((b) => h`<article class="card"><h3>${b.title} <span class="small muted">${dateTimeBR(b.published_at)}</span></h3>${renderContent(b.content, b.kind)}${b.file_path ? h`<a class="btn" href="/arquivos/${b.file_path}">Baixar documento</a>` : ''}</article>`)}` : ''; })
 : empty('Ainda não há conteúdo liberado para esta criança.')}` }));
});
