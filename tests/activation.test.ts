// Ativação REAL dos dois acessos master: script gera links de uso único; cada pessoa define a própria senha.
import { test, expect } from 'bun:test';
import { handle } from '../src/server/index';
import { sql } from '../src/server/db';

const html = async (path: string, init: RequestInit = {}, cookie = '') => {
  const r = await handle(new Request('http://localhost:3199' + path, { ...init, headers: { cookie, ...(init.headers ?? {}) } }), '10.1.1.1');
  return { r, text: await r.text(), cookies: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
};
async function accept(link: string, name: string, pw: string) {
  const path = new URL(link).pathname;
  const g = await html(path); const csrf = /name="_csrf" value="([^"]+)"/.exec(g.text)![1];
  const fd = new FormData(); fd.set('_csrf', csrf); fd.set('full_name', name); fd.set('password', pw); fd.set('password2', pw);
  return html(path, { method: 'POST', body: fd }, g.cookies);
}
async function login(email: string, pw: string) {
  const g = await html('/entrar'); const csrf = /name="_csrf" value="([^"]+)"/.exec(g.text)![1];
  const fd = new FormData(); fd.set('_csrf', csrf); fd.set('email', email); fd.set('password', pw);
  const r = await html('/entrar', { method: 'POST', body: fd }, g.cookies);
  const app = await html(r.r.headers.get('location') ?? '/', {}, r.cookies);
  return { status: r.r.status, location: r.r.headers.get('location'), text: app.text };
}
const run = async (...args: string[]) => {
  const p = Bun.spawn(['bun', 'scripts/create-master.ts', ...args], { env: process.env, stdout: 'pipe', stderr: 'pipe' });
  return (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
};

test('script gera links de ativação; masters Alana e CoReS entram no PAINEL MASTER; segundo uso é bloqueado', async () => {
  const out = await run('--alana', 'alana.teste@exemplo.invalid', '--cores', 'cores.teste@exemplo.invalid');
  const links = [...out.matchAll(/(http\S+\/convite\/\S+)/g)].map((m) => m[1]); expect(links.length).toBe(2);
  expect(out).not.toMatch(/senha:/i);
  const senhaA = 'AlanaTeste' + Math.random().toString(36).slice(2, 8) + '7', senhaC = 'CoresTeste' + Math.random().toString(36).slice(2, 8) + '7';
  expect((await accept(links[0], 'Alana (teste)', senhaA)).r.status).toBe(303);
  expect((await accept(links[1], 'CoReS (teste)', senhaC)).r.status).toBe(303);
  expect((await html(new URL(links[0]).pathname)).r.status).toBe(410);  // link de uso único: não abre de novo
  const a = await login('alana.teste@exemplo.invalid', senhaA); expect(a.status).toBe(303); expect(a.location).toBe('/app'); expect(a.text).toContain('PAINEL MASTER');
  const c = await login('cores.teste@exemplo.invalid', senhaC); expect(c.text).toContain('PAINEL MASTER');
  const roles = await sql`select role, email from public.profiles order by role`; expect(roles.map((r: any) => r.role)).toEqual(['master_alana', 'master_cores']);
  const again = await run('--alana', 'outro@exemplo.invalid'); expect(again).toContain('já ativado');
  expect((await login('alana.teste@exemplo.invalid', 'senhaerrada123')).status).toBe(401);
});
