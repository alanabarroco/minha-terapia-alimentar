// Componentes de interface compartilhados pelas rotas.
import { h, Raw, join } from './html';
import { Ctx, route, redirect, respond, forbidden, notFound, STAFF, MASTER, csrfField, page, htmlRes } from './web';
import { asUser, J, J1, Tx, isUuid } from './db';
import { ageLabel, dateTimeBR, toBR, todayISO } from '../lib/age';
import { UserError } from './files';
import { STATUS_LABEL } from './entities';
import { isMaster } from './auth';

export const TABS: [string, string][] = [
  ['', 'Resumo'], ['anamnese', 'Anamnese'], ['crescimento', 'Crescimento'], ['diario', 'Diário alimentar'],
  ['questionarios', 'Questionários'], ['mapa', 'Mapa alimentar'], ['sessoes', 'Sessões'], ['planejamento', 'Planejamento'],
  ['escola', 'Escola'], ['documentos', 'Documentos e compartilhamentos'],
];

export type Patient = Record<string, any> & { id: string; full_name: string; birth_date: string; status: string };

export async function loadPatient(tx: Tx, pid: string): Promise<Patient | null> {
  if (!isUuid(pid)) return null;
  return J1<Patient>(tx, `select * from public.patients where id = $1`, [pid]); // RLS decide se o usuário enxerga
}

export function friendlyDbError(e: any): string | null {
  if (e instanceof UserError) return e.message;
  const code = String(e?.errno ?? e?.code ?? '');
  const msg = String(e?.message ?? '');
  if (code === '23514') {
    if (msg.includes('food_diary_entries_check') || msg.includes('qty')) return 'Informe a unidade (g, ml...) quando houver quantidade consumida.';
    if (msg.includes('growth_measurements_check')) return 'Informe pelo menos peso ou altura.';
    if (msg.includes('measured_on')) return 'A data da medida não pode ser futura.';
    if (msg.includes('birth_date')) return 'A data de nascimento não pode ser futura.';
    return 'Algum valor está fora do permitido. Revise os campos.';
  }
  if (code === '23505') return 'Já existe um registro igual.';
  if (code === '42501') return 'Você não tem permissão para esta ação.';
  if (code === 'P0001') return msg.replace(/^.*?:\s*/, '').slice(0, 200) || 'Operação não permitida.';
  return null;
}

type StaffFn = (c: Ctx, tx: Tx) => Promise<Response>;
/** Rota de equipe: abre transação com a identidade do usuário (RLS) e traduz erros em mensagens. */
export function staffRoute(method: 'GET' | 'POST', pattern: string, fn: StaffFn, roles: string[] = STAFF) {
  route(method, pattern, async (c) => {
    try {
      return await asUser(c.user!.id, (tx) => fn(c, tx));
    } catch (e: any) {
      const m = friendlyDbError(e);
      if (!m) throw e;
      if (String(e?.errno ?? e?.code) === '42501' && c.req.method === 'GET') return forbidden(c);
      const back = c.req.headers.get('referer');
      const to = back && new URL(back).origin === c.url.origin ? new URL(back).pathname + new URL(back).search : '/app';
      return redirect(c, to, { err: m });
    }
  }, roles);
}
export const masterRoute = (method: 'GET' | 'POST', pattern: string, fn: StaffFn) => staffRoute(method, pattern, fn, MASTER);

export function patientShell(c: Ctx, p: Patient, tab: string, body: Raw): Response {
  const today = todayISO();
  return htmlRes(c, page(c, { title: p.full_name, active: '/app/pacientes', body: h`
<p class="small"><a href="/app/pacientes">← Pacientes</a></p>
<h1>${p.full_name}${p.preferred_name ? h` <span class="muted" style="font-weight:400">(${p.preferred_name})</span>` : ''}</h1>
<p>${ageLabel(p.birth_date, today)} · nascimento ${toBR(p.birth_date)}
${p.status === 'arquivado' ? h`<span class="tag warn">Arquivado</span>` : h`<span class="tag">Ativo</span>`}
${p.is_demo ? h`<span class="tag lilac">Dados fictícios</span>` : ''}</p>
<nav class="tabs" aria-label="Abas do prontuário">${TABS.map(([k, l]) => h`<a href="/app/pacientes/${p.id}${k ? '/' + k : ''}" class="${k === tab ? 'on' : ''}">${l}</a>`)}</nav>
${body}` }), c.req.method === 'POST' && body.toString().includes('class="flash err" role="alert"') ? 400 : 200);
}

export const empty = (msg: string, action?: Raw) => h`<div class="empty"><p>${msg}</p>${action ?? ''}</div>`;
export const statusTag = (s: string) => h`<span class="tag ${s === 'rascunho' ? 'warn' : s === 'agendada' ? 'blue' : ''}">${STATUS_LABEL[s] ?? s}</span>`;
export const savedAt = (ts: string | null, by?: string | null) => ts ? h`<p class="small muted" role="status">Último salvamento: ${dateTimeBR(ts)}${by ? ' · por ' + by : ''}</p>` : h`<p class="small muted">Ainda não salvo.</p>`;

export function table(head: string[], rows: Raw[][], emptyMsg: string): Raw {
  if (!rows.length) return empty(emptyMsg);
  return h`<div class="tablewrap"><table><thead><tr>${head.map((x) => h`<th scope="col">${x}</th>`)}</tr></thead><tbody>${rows.map((r) => h`<tr>${r.map((cell) => h`<td>${cell}</td>`)}</tr>`)}</tbody></table></div>`;
}
export function kv(pairs: [string, any][]): Raw {
  const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return h`<p class="muted">Nada informado.</p>`;
  return h`<dl class="kv">${rows.map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}
export const nameMap = async (tx: Tx): Promise<Record<string, string>> => {
  const rows = await J<{ id: string; full_name: string; email: string }>(tx, `select id, full_name, email from public.profiles`);
  return Object.fromEntries(rows.map((r) => [r.id, r.full_name || r.email]));
};
export const staffOptions = async (tx: Tx): Promise<[string, string][]> => {
  const rows = await J<{ id: string; full_name: string; email: string }>(tx, `select id, full_name, email from public.profiles where role in ('master_alana','master_cores','supervisionado') and active order by full_name`);
  return rows.map((r) => [r.id, r.full_name || r.email]);
};
export const canPublish = (c: Ctx) => !!c.user && (isMaster(c.user.role) || (c.user.role === 'supervisionado' && c.user.can_publish));
export function formShell(c: Ctx, action: string, body: Raw, buttons: Raw, multipart = false): Raw {
  return h`<form method="post" action="${action}" class="stack" ${multipart ? 'enctype="multipart/form-data"' : ''}>${csrfField(c)}${body}<div class="actions sticky-actions">${buttons}</div></form>`;
}
export function errList(errors: string[]) { return errors.join(' '); }
export { J, J1, join, h };
