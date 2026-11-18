// Pequeno framework: roteador, contexto, CSRF, mensagens (flash), cabeçalhos de segurança e layout.
import { randomBytes } from 'node:crypto';
import { config } from './config';
import { h, Raw, raw, esc } from './html';
import { readSession, SESSION_COOKIE, SessionInfo, User, isMaster, isStaff, ROLE_LABEL } from './auth';

export type Ctx = {
  req: Request; url: URL; params: Record<string, string>; session: SessionInfo | null; user: User | null;
  ip: string; form: FormData | null; cookies: Record<string, string>; setCookie: string[]; reason?: string;
};
export type Handler = (c: Ctx) => Promise<Response> | Response;

// ---------- cookies ----------
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookieStr(name: string, value: string, o: { maxAge?: number; httpOnly?: boolean } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${o.httpOnly === false ? '' : '; HttpOnly'}` +
    `${config.production ? '; Secure' : ''}${o.maxAge !== undefined ? `; Max-Age=${o.maxAge}` : ''}`;
}

// ---------- respostas ----------
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'private, no-store',
};
export function respond(c: Ctx, body: BodyInit | null, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  const headers = new Headers({ ...SECURITY_HEADERS, ...(init.headers ?? {}) });
  for (const ck of c.setCookie) headers.append('Set-Cookie', ck);
  return new Response(body, { ...init, headers });
}
export function redirect(c: Ctx, to: string, flash?: { ok?: string; err?: string }): Response {
  if (flash?.ok) c.setCookie.push(cookieStr('mta_flash', 'ok:' + flash.ok, { maxAge: 30 }));
  if (flash?.err) c.setCookie.push(cookieStr('mta_flash', 'err:' + flash.err, { maxAge: 30 }));
  return respond(c, null, { status: 303, headers: { Location: to } });
}
export const htmlRes = (c: Ctx, body: Raw | string, status = 200) =>
  respond(c, '<!doctype html>' + body.toString(), { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// ---------- CSRF ----------
export function csrfToken(c: Ctx): string {
  if (c.session) return c.session.csrf;
  let t = c.cookies['mta_pre'];
  if (!t) { t = randomBytes(18).toString('base64url'); c.cookies['mta_pre'] = t; c.setCookie.push(cookieStr('mta_pre', t)); }
  return t;
}
export const csrfField = (c: Ctx) => h`<input type="hidden" name="_csrf" value="${csrfToken(c)}">`;
export function csrfOk(c: Ctx): boolean {
  const sent = String(c.form?.get('_csrf') ?? '');
  const want = c.session ? c.session.csrf : c.cookies['mta_pre'];
  return !!want && sent.length > 10 && sent === want;
}

// ---------- roteador ----------
type Route = { method: string; re: RegExp; keys: string[]; handler: Handler; roles?: string[] };
const routes: Route[] = [];
export function route(method: 'GET' | 'POST', pattern: string, handler: Handler, roles?: string[]) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*/, '(.*)') + '/?$');
  if (pattern.includes('*')) keys.push('rest');
  routes.push({ method, re, keys, handler, roles });
}
export const STAFF = ['master_alana', 'master_cores', 'supervisionado'];
export const MASTER = ['master_alana', 'master_cores'];
export const SCHOOL = ['escola'];
export const FAMILY = ['familia'];

export function homeFor(role: string) {
  return role === 'escola' ? '/escola' : role === 'familia' ? '/familia' : '/app';
}

export async function dispatch(req: Request, ip: string): Promise<Response> {
  const url = new URL(req.url);
  const cookies = parseCookies(req.headers.get('cookie'));
  const c: Ctx = { req, url, params: {}, session: null, user: null, ip, form: null, cookies, setCookie: [] };

  const sr = await readSession(cookies[SESSION_COOKIE]);
  if (sr.session) { c.session = sr.session; c.user = sr.session.user; }
  else if (cookies[SESSION_COOKIE]) {
    c.reason = sr.reason;
    c.setCookie.push(cookieStr(SESSION_COOKIE, '', { maxAge: 0 }));
  }

  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  let matched: Route | null = null; let methodMismatch = false;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.method !== req.method && !(req.method === 'HEAD' && r.method === 'GET')) { methodMismatch = true; continue; }
    r.keys.forEach((k, i) => (c.params[k] = decodeURIComponent(m[i + 1])));
    matched = r; break;
  }
  if (!matched) return methodMismatch ? respond(c, 'Método não permitido', { status: 405 }) : notFound(c);

  if (matched.roles) {
    if (!c.user) {
      const next = req.method === 'GET' ? `&next=${encodeURIComponent(path + url.search)}` : '';
      return redirect(c, `/entrar?motivo=${c.reason === 'expirada' ? 'expirada' : c.reason === 'desativada' ? 'desativada' : 'login'}${next}`);
    }
    if (!matched.roles.includes(c.user.role)) return forbidden(c);
  }
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      try { c.form = await req.formData(); } catch { return respond(c, 'Requisição inválida', { status: 400 }); }
    }
    if (!csrfOk(c)) {
      if (!c.user && matched.roles === undefined) return redirect(c, path + url.search, { err: 'A página expirou. Tente novamente.' });
      return respond(c, 'Requisição recusada (token de segurança inválido). Volte e recarregue a página.', { status: 403 });
    }
  }
  try {
    return await matched.handler(c);
  } catch (e: any) {
    // Sem conteúdo clínico nem senhas nos logs técnicos: só mensagem e código do erro.
    const first = String(e?.message ?? e).split('\n')[0].replace(/\(.*\)/g, '(…)').slice(0, 120); // sem valores de linhas
    console.error(`[erro] ${req.method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')} :: ${e?.errno ?? e?.code ?? ''} ${first}`);
    const code = e?.errno ?? e?.code;
    if (code === '42501') return forbidden(c);
    return htmlRes(c, simplePage(c, 'Algo deu errado', h`<p>Não foi possível concluir a operação. Tente novamente. Se o problema continuar, avise a coordenação.</p><p><a class="btn" href="/">Voltar ao início</a></p>`), 500);
  }
}

export function notFound(c: Ctx) {
  return htmlRes(c, simplePage(c, 'Página não encontrada', h`<p>Não encontramos o que você procurou, ou você não tem acesso a esta página.</p><p><a class="btn" href="/">Voltar ao início</a></p>`), 404);
}
export function forbidden(c: Ctx) {
  return htmlRes(c, simplePage(c, 'Acesso não permitido', h`<p>Seu perfil não tem permissão para acessar esta página.</p><p><a class="btn" href="/">Voltar ao início</a></p>`), 403);
}

// ---------- formulários ----------
export const fv = (c: Ctx, name: string): string => String(c.form?.get(name) ?? '').trim();
export const fvAll = (c: Ctx, name: string): string[] => (c.form?.getAll(name) ?? []).map(String).filter(Boolean);

// ---------- layout ----------
function flashOf(c: Ctx): { kind: 'ok' | 'err'; msg: string } | null {
  const f = c.cookies['mta_flash'];
  if (!f) return null;
  c.setCookie.push(cookieStr('mta_flash', '', { maxAge: 0 }));
  return { kind: f.startsWith('ok:') ? 'ok' : 'err', msg: f.slice(f.indexOf(':') + 1) };
}

const STAFF_NAV: [string, string][] = [
  ['/app', 'Visão geral'], ['/app/pacientes', 'Pacientes'], ['/app/diario', 'Diário alimentar'],
  ['/app/avaliacoes', 'Avaliações e questionários'], ['/app/sessoes', 'Sessões e evolução'],
  ['/app/planejamentos', 'Planejamentos'], ['/app/escola', 'Área escolar'],
  ['/app/relatorios', 'Relatórios e compartilhamentos'],
];
const MASTER_NAV: [string, string][] = [['/app/usuarios', 'Usuários e acessos'], ['/app/configuracoes', 'Configurações']];

export function flashBlock(c: Ctx): Raw {
  const f = flashOf(c);
  return f ? h`<div class="flash ${f.kind}" role="${f.kind === 'err' ? 'alert' : 'status'}">${f.msg}</div>` : h``;
}

export function page(c: Ctx, o: { title: string; body: Raw; active?: string; wide?: boolean }): Raw {
  const u = c.user;
  const flash = flashBlock(c);
  let nav: [string, string][] = [];
  let badge = '';
  if (u && isStaff(u.role)) {
    nav = [...STAFF_NAV, ...(isMaster(u.role) ? MASTER_NAV : [])];
    badge = isMaster(u.role) ? 'PAINEL MASTER' : 'PAINEL DA EQUIPE';
  } else if (u?.role === 'escola') { nav = [['/escola', 'Registrar refeição'], ['/escola/historico', 'Histórico e orientações']]; badge = 'ÁREA DA ESCOLA'; }
  else if (u?.role === 'familia') { nav = [['/familia', 'Meus filhos']]; badge = 'ÁREA DA FAMÍLIA'; }
  const active = o.active ?? c.url.pathname;
  return h`<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title} · Minha Terapia Alimentar</title><link rel="stylesheet" href="/static/style.css"><script src="/static/app.js" defer></script></head>
<body class="${u ? 'shell' : 'plain'}">
<a class="skip" href="#conteudo">Ir para o conteúdo</a>
<header class="top"><a class="brand" href="/">Minha Terapia Alimentar</a>
${u ? h`<span class="badge" data-role="${u.role}">${badge}</span><span class="who">${u.full_name || u.email} · ${ROLE_LABEL[u.role]}</span>
<a class="linkbtn" href="/conta">Minha conta</a>
<form method="post" action="/sair" class="inline">${csrfField(c)}<button class="linkbtn" type="submit">Sair</button></form>` : ''}</header>
<div class="layout">${nav.length ? h`<nav class="side" aria-label="Menu principal"><ul>${nav.map(([href, label]) =>
  h`<li><a href="${href}" class="${active === href || (href !== '/app' && active.startsWith(href + '/')) ? 'on' : ''}">${label}</a></li>`)}</ul></nav>` : ''}
<main id="conteudo" class="${o.wide ? 'wide' : ''}">${flash}${o.body}</main></div>
<footer class="foot">Dados de saúde de crianças: uso restrito e confidencial. Horários em America/Sao_Paulo.</footer>
</body></html>`;
}

/** Página simples centrada (login, erros, convite) */
export function simplePage(c: Ctx, title: string, body: Raw): Raw {
  return h`<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Minha Terapia Alimentar</title><link rel="stylesheet" href="/static/style.css"></head>
<body class="plain"><main class="card narrow" id="conteudo"><p class="brandbig">Minha Terapia Alimentar</p><h1>${title}</h1>${flashBlock(c)}${body}</main></body></html>`;
}
