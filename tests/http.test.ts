// Testes de ponta a ponta: requisições HTTP reais ao aplicativo (em processo) contra PostgreSQL com as migrações reais.
// Cobrem autenticação, perfis, RLS via API, arquivos, liberação/retirada, desativação, PDF e persistência.
import { describe, test, expect, beforeAll } from 'bun:test';
import { handle } from '../src/server/index';
import { asService, J1, J, sql } from '../src/server/db';
import { seedDemo } from '../scripts/seed-demo';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

type Res = { status: number; text: string; headers: Headers; location: string | null; flash: string | null; bytes: Uint8Array };
class Client {
  jar: Record<string, string> = {}; ip = '10.0.0.1';
  async req(method: string, path: string, form?: Record<string, any>, raw = false): Promise<Res> {
    const init: any = { method, headers: { cookie: Object.entries(this.jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') } };
    if (form) { const fd = new FormData(); for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x as any); init.body = fd; }
    const r = await handle(new Request('http://localhost:3199' + path, init), this.ip);
    let flash: string | null = null;
    for (const sc of r.headers.getSetCookie()) {
      const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = decodeURIComponent(kv.slice(i + 1));
      if (/Max-Age=0/i.test(sc)) delete this.jar[k]; else this.jar[k] = v;
      if (k === 'mta_flash' && !/Max-Age=0/i.test(sc)) flash = v;
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, text: raw ? '' : new TextDecoder().decode(bytes), headers: r.headers, location: r.headers.get('location'), flash, bytes };
  }
  get = (p: string) => this.req('GET', p);
  async csrf(): Promise<string> { const r = await this.get(this.jar['mta_session'] ? '/conta' : '/entrar'); return /name="_csrf" value="([^"]+)"/.exec(r.text)?.[1] ?? ''; }
  async post(p: string, form: Record<string, any> = {}) { return this.req('POST', p, { _csrf: await this.csrf(), ...form }); }
  async login(email: string, password: string) { return this.post('/entrar', { email, password }); }
}
const pw = (e: string) => 'Tst' + randomBytes(6).toString('hex') + '9';
const PW: Record<string, string> = {};
const A = (e: string) => e + '@demo.invalid';
let P: Record<string, string> = {};   // ids dos pacientes
let master: Client, master2: Client, sup: Client, escA: Client, escB: Client, famA: Client, famB: Client;

async function loggedIn(email: string) { const c = new Client(); const r = await c.login(A(email), PW[A(email)]); expect(r.status).toBe(303); return c; }

beforeAll(async () => {
  Object.assign(PW, await seedDemo((e) => (PW[e] = pw(e))));
  const ps = await sql`select id, full_name from public.patients`;
  for (const p of ps) P[String(p.full_name).split(' ')[0]] = p.id;
  master = await loggedIn('master.alana'); master2 = await loggedIn('master.cores'); sup = await loggedIn('supervisionada');
  escA = await loggedIn('escola.a'); escB = await loggedIn('escola.b'); famA = await loggedIn('familia.a'); famB = await loggedIn('familia.b');
});

describe('15. Login, recuperação de senha e saída', () => {
  test('tela inicial: marca, formulário de login, sem cadastro público', async () => {
    const r = await new Client().get('/');
    expect(r.status).toBe(200); expect(r.text).toContain('Minha Terapia Alimentar'); expect(r.text).toContain('name="password"');
    expect(r.text.toLowerCase()).not.toContain('criar conta'); expect(r.text.toLowerCase()).not.toContain('cadastre-se');
    const c = new Client(); await c.get('/entrar');
    expect((await c.post('/cadastro', { email: 'x@y.com', password: 'abcdefghij12' })).status).toBe(404);
  });
  test('cabeçalhos de segurança (CSP, nosniff, sem cache)', async () => {
    const r = await new Client().get('/entrar');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'"); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('cache-control')).toContain('no-store');
  });
  test('credenciais inválidas: mensagem clara, igual para e-mail inexistente', async () => {
    const c = new Client(); const r1 = await c.login(A('master.alana'), 'senhaerrada123'); const r2 = await c.login('naoexiste@demo.invalid', 'senhaerrada123');
    expect(r1.status).toBe(401); expect(r1.text).toContain('E-mail ou senha incorretos.'); expect(r2.text).toContain('E-mail ou senha incorretos.');
  });
  test('rota protegida sem login redireciona ao login', async () => {
    for (const p of ['/app', '/app/pacientes', '/escola', '/familia', '/arquivos/x', '/conta']) { const r = await new Client().get(p); expect(r.status).toBe(303); expect(r.location).toContain('/entrar'); }
  });
  test('POST sem token CSRF é recusado', async () => {
    expect((await master.req('POST', '/sair', {})).status).toBe(403);
  });
  test('sessão expirada: mensagem clara e redirecionamento', async () => {
    const c = await loggedIn('master.cores');
    await asService((tx) => tx`update auth.sessions set expires_at = now() - interval '1 minute' where token_hash is not null and user_id = (select id from auth.users where email = ${A('master.cores')})`);
    const r = await c.get('/app'); expect(r.status).toBe(303); expect(r.location).toContain('motivo=expirada');
    const l = await c.get(r.location!); expect(l.text).toContain('Sua sessão expirou');
    master2 = await loggedIn('master.cores');
  });
  test('saída encerra a sessão no servidor', async () => {
    const c = await loggedIn('supervisionada'); const old = c.jar['mta_session'];
    expect((await c.get('/app')).status).toBe(200);
    const r = await c.post('/sair'); expect(r.status).toBe(303);
    const again = new Client(); again.jar['mta_session'] = old; expect((await again.get('/app')).status).toBe(303);
  });
  test('limite de tentativas bloqueia força bruta', async () => {
    const c = new Client(); c.ip = '10.9.9.9'; let last!: Res;
    for (let i = 0; i < 10; i++) last = await c.login('forca@demo.invalid', 'errada12345');
    expect(last.text).toContain('Muitas tentativas');
  });
  test('recuperação de senha: link de uso único, nova senha funciona, antiga não', async () => {
    const c = new Client(); await c.get('/entrar');
    const pre = await c.post('/esqueci-senha', { email: A('familia.b') }); expect(pre.status).toBe(200);
    const unknown = await c.post('/esqueci-senha', { email: 'ninguem@demo.invalid' }); expect(unknown.text).toContain('Se o e-mail informado estiver cadastrado');
    const o = await asService((tx) => J1<any>(tx, `select link from auth.outbox where to_email = $1 and kind = 'recuperacao' order by created_at desc limit 1`, [A('familia.b')]));
    expect(o.link).toContain('/redefinir/'); const path = new URL(o.link).pathname;
    expect((await c.get(path)).status).toBe(200);
    expect((await c.post(path, { password: 'curta1', password2: 'curta1' })).status).toBe(400);
    const novo = 'NovaSenha' + randomBytes(4).toString('hex') + '7';
    const ok = await c.post(path, { password: novo, password2: novo }); expect(ok.status).toBe(303);
    expect((await c.get(path)).status).toBe(410);                             // uso único
    expect((await new Client().login(A('familia.b'), PW[A('familia.b')])).status).toBe(401); // senha antiga
    const n = new Client(); expect((await n.login(A('familia.b'), novo)).status).toBe(303);
    PW[A('familia.b')] = novo; famB = n;
  });
});

describe('Convites e usuários (master)', () => {
  let link = '';
  test('master convida supervisionado; link de uso único cria a conta com o papel certo', async () => {
    const r = await master.post('/app/usuarios/convidar', { tipo: 'supervisionado', nome: 'Nova Supervisionada', email: 'nova.sup@demo.invalid' });
    expect(r.status).toBe(303); link = /(http\S+\/convite\/\S+)/.exec(r.flash ?? '')?.[1] ?? ''; expect(link).toContain('/convite/');
    const path = new URL(link).pathname; const c = new Client(); expect((await c.get(path)).status).toBe(200);
    const senha = 'Convite' + randomBytes(4).toString('hex') + '5';
    const ok = await c.post(path, { full_name: 'Nova Supervisionada', password: senha, password2: senha }); expect(ok.status).toBe(303);
    expect((await c.get(path)).status).toBe(410);
    const l = await c.login('nova.sup@demo.invalid', senha); expect(l.status).toBe(303);
    const p = await asService((tx) => J1<any>(tx, `select role, can_publish, active from public.profiles where email = 'nova.sup@demo.invalid'`));
    expect(p).toMatchObject({ role: 'supervisionado', can_publish: false, active: true });
    const inv = await asService((tx) => J1<any>(tx, `select status, send_count from public.invitations where email = 'nova.sup@demo.invalid'`));
    expect(inv).toMatchObject({ status: 'aceito', send_count: 1 });
  });
  test('convite de família vincula a criança e reenvio invalida o link anterior', async () => {
    const r = await master.post('/app/usuarios/convidar', { tipo: 'familia', nome: 'Família Nova', email: 'fam.nova@demo.invalid', pacientes: [P['Marina']] });
    const l1 = /(http\S+\/convite\/\S+)/.exec(r.flash ?? '')![1];
    const inv = await asService((tx) => J1<any>(tx, `select id from public.invitations where email = 'fam.nova@demo.invalid' and status = 'pendente'`));
    const re = await master.post(`/app/usuarios/convites/${inv.id}/reenviar`); const l2 = /(http\S+\/convite\/\S+)/.exec(re.flash ?? '')![1];
    expect((await new Client().get(new URL(l1).pathname)).status).toBe(410); expect((await new Client().get(new URL(l2).pathname)).status).toBe(200);
    const c = new Client(); const s = 'FamNova' + randomBytes(4).toString('hex') + '3';
    await c.post(new URL(l2).pathname, { full_name: 'Família Nova', password: s, password2: s }); await c.login('fam.nova@demo.invalid', s);
    const page = await c.get('/familia'); expect(page.text).toContain('Mari'); expect(page.text).not.toContain('Lucas');
  });
  test('convite de escola vincula só as crianças escolhidas', async () => {
    const r = await master.post('/app/usuarios/convidar', { tipo: 'escola', nome: 'Escola Nova', email: 'esc.nova@demo.invalid', escola: 'Escola Nova', pacientes: [P['Pedro']] });
    const l = /(http\S+\/convite\/\S+)/.exec(r.flash ?? '')![1]; const c = new Client(); const s = 'EscNova' + randomBytes(4).toString('hex') + '3';
    await c.post(new URL(l).pathname, { full_name: 'Escola Nova', password: s, password2: s }); await c.login('esc.nova@demo.invalid', s);
    const page = await c.get('/escola'); expect(page.text).toContain('Pedro'); expect(page.text).not.toContain('Lucas');
  });
  test('e-mail já cadastrado não recebe novo convite; e-mail inválido é recusado', async () => {
    expect((await master.post('/app/usuarios/convidar', { tipo: 'supervisionado', nome: 'X', email: A('supervisionada') })).flash).toContain('Já existe');
    expect((await master.post('/app/usuarios/convidar', { tipo: 'supervisionado', nome: 'X', email: 'invalido' })).flash).toContain('inválido');
  });
  test('recuperação iniciada pelo master não exibe senha, só link', async () => {
    const u = await asService((tx) => J1<any>(tx, `select id from public.profiles where email = $1`, [A('escola.b')]));
    const r = await master.post(`/app/usuarios/${u.id}/recuperacao`); expect(r.flash).toContain('/redefinir/'); expect(r.flash).not.toContain(PW[A('escola.b')]);
  });
});

describe('1–3. Masters e supervisionado', () => {
  test('1. ambos os masters acessam todos os pacientes (incluindo arquivados)', async () => {
    for (const m of [master, master2]) {
      const r = await m.get('/app/pacientes?st=todos'); expect(r.status).toBe(200);
      for (const n of ['Lucas', 'Marina', 'Pedro', 'Sofia', 'Arquivado']) expect(r.text).toContain(n);
      expect(r.text).toContain('Novo paciente');
      expect((await m.get('/app')).text).toContain('PAINEL MASTER');
    }
  });
  test('2. supervisionado acessa todos os pacientes e registra evolução (persistente)', async () => {
    const r = await sup.get('/app/pacientes'); for (const n of ['Lucas', 'Marina', 'Pedro', 'Sofia']) expect(r.text).toContain(n);
    expect(r.text).not.toContain('Novo paciente');
    const post = await sup.post(`/app/pacientes/${P['Pedro']}/sessoes`, { session_date: '10/11/2026', location: 'online', objectives: 'Objetivo HTTP-TESTE', outcomes: 'Resultado HTTP-TESTE', _acao: 'finalizada' });
    expect(post.status).toBe(303);
    const again = await loggedIn('supervisionada'); const list = await again.get(`/app/pacientes/${P['Pedro']}/sessoes`);
    expect(list.text).toContain('10/11/2026'); expect(list.text).toContain('Objetivo HTTP-TESTE');
    const draft = await sup.post(`/app/pacientes/${P['Pedro']}/sessoes`, { session_date: '11/11/2026', objectives: 'Rascunho HTTP', _acao: 'rascunho' });
    expect((await sup.get(draft.location!)).text).toContain('Último salvamento');
  });
  test('3. supervisionado não gerencia usuários/permissões nem cria pacientes', async () => {
    for (const p of ['/app/usuarios', '/app/configuracoes', '/app/auditoria', '/app/pacientes/novo']) expect((await sup.get(p)).status).toBe(403);
    const u = await asService((tx) => J1<any>(tx, `select id from public.profiles where email = $1`, [A('supervisionada')]));
    expect((await sup.post(`/app/usuarios/${u.id}/publicar`, { valor: '1' })).status).toBe(403);
    expect((await sup.post('/app/usuarios/convidar', { tipo: 'supervisionado', nome: 'X', email: 'y@demo.invalid' })).status).toBe(403);
    // tentativa de auto-promoção por "Minha conta": campos extras são ignorados
    await sup.post('/conta', { full_name: 'Supervisionada Demo', role: 'master_alana' });
    expect((await asService((tx) => J1<any>(tx, `select role from public.profiles where id = $1`, [u.id]))).role).toBe('supervisionado');
    expect((await sup.post(`/app/pacientes/${P['Lucas']}/arquivar`)).status).toBe(403);
  });
  test('3b. supervisionado sem autorização não libera conteúdo; com autorização do master, libera', async () => {
    const g = await asService((tx) => J1<any>(tx, `select id from public.guidances where patient_id = $1 and audience = 'familia'`, [P['Lucas']]));
    const url = `/app/pacientes/${P['Lucas']}/liberar?t=guidances&id=${g.id}&para=familia`;
    expect((await sup.get(url)).flash).toContain('não está autorizado');
    const r = await sup.post(`/app/pacientes/${P['Lucas']}/liberar`, { t: 'guidances', id: g.id, para: 'familia' }); expect(r.flash).toContain('permissão');
    const u = await asService((tx) => J1<any>(tx, `select id from public.profiles where email = $1`, [A('supervisionada')]));
    await master.post(`/app/usuarios/${u.id}/publicar`, { valor: '1' });
    expect((await sup.get(url)).status).toBe(200);
    await master.post(`/app/usuarios/${u.id}/publicar`, { valor: '0' });
    expect((await sup.get(url)).status).toBe(303);
  });
});

describe('4–6. Escola', () => {
  test('4. escola A vê somente a criança vinculada e nenhuma área da equipe', async () => {
    const r = await escA.get('/escola'); expect(r.status).toBe(200); expect(r.text).toContain('Lucas'); for (const n of ['Marina', 'Pedro', 'Sofia']) expect(r.text).not.toContain(n);
    for (const p of ['/app', '/app/pacientes', `/app/pacientes/${P['Lucas']}`, `/app/pacientes/${P['Lucas']}/anamnese`, '/app/usuarios', '/familia']) expect((await escA.get(p)).status).toBe(403);
  });
  test('5. escola preenche somente a área escolar (e só para criança vinculada)', async () => {
    const ok = await escA.post('/escola/registrar', { crianca: P['Lucas'], record_date: '12/11/2026', meal: 'Almoço', foods_offered: 'Arroz HTTP-ESC', foods_consumed: 'Metade' }); expect(ok.status).toBe(303);
    expect((await escA.get('/escola/historico?crianca=' + P['Lucas'])).text).toContain('Arroz HTTP-ESC');
    expect((await escA.post('/escola/registrar', { crianca: P['Marina'], record_date: '12/11/2026', foods_offered: 'Invasão HTTP' })).status).toBe(404);
    expect((await sql`select count(*)::int as n from public.school_meal_records where foods_offered = 'Invasão HTTP'`)[0].n).toBe(0);
    expect((await escA.post(`/app/pacientes/${P['Lucas']}/sessoes`, { session_date: '12/11/2026' })).status).toBe(403);
    expect((await escA.post(`/app/pacientes/${P['Lucas']}/diario`, { entry_date: '12/11/2026' })).status).toBe(403);
  });
  test('6. escola não vê prontuário privado em nenhuma página que acessa', async () => {
    for (const p of ['/escola', '/escola/historico?crianca=' + P['Lucas']]) { const t = (await escA.get(p)).text; for (const bad of ['SEGREDO', 'Seletividade', 'diagnóstic', 'anamnese', 'Notas internas']) expect(t).not.toContain(bad); }
    const h = (await escA.get('/escola/historico?crianca=' + P['Lucas'])).text; expect(h).toContain('Ofereça o lanche sem pressa');
  });
  test('escola B não vê registros da escola A; troca de id não revela outro paciente', async () => {
    const h = await escB.get('/escola/historico?crianca=' + P['Lucas']); expect(h.text).not.toContain('Arroz HTTP-ESC'); expect(h.text).not.toContain('Lucas');
    const rec = await asService((tx) => J1<any>(tx, `select id from public.school_meal_records where patient_id = $1 limit 1`, [P['Lucas']]));
    expect((await escB.get(`/escola/registro/${rec.id}`)).status).toBe(303);
    expect((await escB.get('/familia/' + P['Lucas'])).status).toBe(403);
  });
  test('foto escolar só quando autorizada (escola B não pode)', async () => {
    const jpg = new File([readFileSync(__dirname + '/../db/demo/placeholder.jpg')], 'f.jpg', { type: 'image/jpeg' });
    const r = await escB.req('POST', '/escola/registrar', { _csrf: await escB.csrf(), crianca: P['Marina'], record_date: '12/11/2026', foods_offered: 'x', photo: jpg });
    expect(r.status).toBe(303); expect(r.flash).toContain('não'); // bloqueado pelo banco
    expect((await sql`select count(*)::int as n from public.school_meal_records where patient_id = ${P['Marina']} and photo_path is not null`)[0].n).toBe(0);
    const ok = await escA.req('POST', '/escola/registrar', { _csrf: await escA.csrf(), crianca: P['Lucas'], record_date: '13/11/2026', foods_offered: 'Com foto', photo: jpg });
    expect(ok.status).toBe(303); expect((await sql`select count(*)::int as n from public.school_meal_records where patient_id = ${P['Lucas']} and foods_offered = 'Com foto' and photo_path is not null`)[0].n).toBe(1);
  });
});

describe('7–9. Família', () => {
  test('7. família A acessa somente as crianças vinculadas', async () => {
    const r = await famA.get('/familia'); expect(r.text).toContain('Lucas'); expect(r.text).toContain('Sofia'); expect(r.text).not.toContain('Marina'); expect(r.text).not.toContain('Pedro');
    expect((await famA.get('/familia/' + P['Marina'])).status).toBe(404); expect((await famA.get('/familia/' + P['Pedro'])).status).toBe(404);
    expect((await famA.get('/familia/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    for (const p of ['/app', '/app/pacientes', `/app/pacientes/${P['Lucas']}`, '/escola']) expect((await famA.get(p)).status).toBe(403);
  });
  test('8. família vê apenas versões liberadas e nunca notas internas ou rascunhos', async () => {
    const t = (await famA.get('/familia/' + P['Lucas'])).text;
    expect(t).toContain('Plano de exploração'); expect(t).toContain('Tocar em 3 novos alimentos'); expect(t).toContain('Relatório de acompanhamento (demo)');
    expect(t).not.toContain('Rascunho interno'); expect(t).not.toContain('Rotina da refeição (demo)'); // orientação retirada
    for (const bad of ['SEGREDO', 'Notas internas', 'Seletividade']) expect(t).not.toContain(bad);
    expect(t).not.toContain('Ofereça o lanche sem pressa'); // orientação da escola
  });
  test('8b. edição posterior do rascunho não aparece sem nova liberação', async () => {
    await master.post(`/app/pacientes/${P['Lucas']}/planejamento/` + (await asService((tx) => J1<any>(tx, `select id from public.therapeutic_plans where patient_id = $1`, [P['Lucas']]))).id,
      { title: 'Plano de exploração — Lucas (demo)', status: 'ativo', family_guidance: 'TEXTO-NOVO-NAO-LIBERADO', internal_notes: 'SEGREDO-2' });
    const t = (await famA.get('/familia/' + P['Lucas'])).text; expect(t).not.toContain('TEXTO-NOVO-NAO-LIBERADO');
    const id = (await asService((tx) => J1<any>(tx, `select id from public.therapeutic_plans where patient_id = $1`, [P['Lucas']]))).id;
    const pre = await master.get(`/app/pacientes/${P['Lucas']}/liberar?t=therapeutic_plans&id=${id}&para=familia`); expect(pre.text).toContain('TEXTO-NOVO-NAO-LIBERADO'); expect(pre.text).not.toContain('SEGREDO');
    expect((await famA.get('/familia/' + P['Lucas'])).text).not.toContain('TEXTO-NOVO-NAO-LIBERADO'); // prévia não publicou
    await master.post(`/app/pacientes/${P['Lucas']}/liberar`, { t: 'therapeutic_plans', id, para: 'familia' });
    const after = (await famA.get('/familia/' + P['Lucas'])).text; expect(after).toContain('TEXTO-NOVO-NAO-LIBERADO'); expect(after).not.toContain('SEGREDO');
  });
  test('9. família não edita nada (rotas e métodos de escrita bloqueados)', async () => {
    for (const [m, p] of [['POST', `/app/pacientes/${P['Lucas']}/diario`], ['POST', `/app/pacientes/${P['Lucas']}/sessoes`], ['POST', `/app/pacientes/${P['Lucas']}/editar`], ['POST', '/escola/registrar'], ['POST', `/app/pacientes/${P['Lucas']}/liberar`], ['POST', '/app/usuarios/convidar']] as const)
      expect((await famA.req(m, p, { _csrf: await famA.csrf(), entry_date: '01/01/2026' })).status).toBe(403);
    const before = (await sql`select count(*)::int as n from public.food_diary_entries`)[0].n; expect(before).toBeGreaterThan(0);
  });
});

describe('10–12. IDs trocados, arquivos e retirada', () => {
  const fam = (name: string) => asService((tx) => J1<any>(tx, `select file_path from public.publications where title like $1 and status = 'ativo' limit 1`, [name]));
  test('10/11. trocar o id da URL ou do arquivo não revela outro paciente', async () => {
    const own = await fam('Relatório de acompanhamento%'); expect(own.file_path).toContain(P['Lucas']);
    const r = await famA.req('GET', '/arquivos/' + own.file_path, undefined, true); expect(r.status).toBe(200); expect(String.fromCharCode(...r.bytes.slice(0, 5))).toBe('%PDF-');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    const other = await fam('Relatório Marina%');
    expect((await famA.get('/arquivos/' + other.file_path)).status).toBe(404);                  // família A × arquivo da família B
    expect((await famB.req('GET', '/arquivos/' + other.file_path, undefined, true)).status).toBe(200);
    expect((await famA.get(`/arquivos/${P['Lucas']}/reports/priv.pdf`)).status).toBe(404);     // existe, mas não liberado
    expect((await famA.get(`/arquivos/${P['Lucas']}/diary/foto-antes-1.jpg`)).status).toBe(404); // foto clínica
    expect((await famA.get(`/arquivos/${P['Lucas']}/school/s1.jpg`)).status).toBe(404);        // foto escolar
    expect((await famA.get(`/arquivos/../../etc/passwd`)).status).toBe(404);
    expect((await famA.get(`/arquivos/${P['Lucas']}/reports/..%2F..%2Fx`)).status).toBe(404);
    expect((await new Client().get('/arquivos/' + own.file_path)).status).toBe(303);          // anônimo
  });
  test('11b. escola só vê foto escolar da criança vinculada; equipe vê tudo', async () => {
    expect((await escA.req('GET', `/arquivos/${P['Lucas']}/school/s1.jpg`, undefined, true)).status).toBe(200);
    expect((await escB.get(`/arquivos/${P['Lucas']}/school/s1.jpg`)).status).toBe(404);
    expect((await escA.get(`/arquivos/${P['Lucas']}/diary/foto-antes-1.jpg`)).status).toBe(404);
    expect((await escA.get(`/arquivos/${P['Lucas']}/reports/rel1.pdf`)).status).toBe(404);
    for (const c of [sup, master, master2]) expect((await c.req('GET', `/arquivos/${P['Lucas']}/diary/foto-antes-1.jpg`, undefined, true)).status).toBe(200);
  });
  test('upload: tipo falso é recusado; foto válida fica privada', async () => {
    const fake = new File(['isto não é imagem'], 'x.jpg', { type: 'image/jpeg' });
    const bad = await sup.req('POST', `/app/pacientes/${P['Pedro']}/diario`, { _csrf: await sup.csrf(), entry_date: '10/11/2026', photo_before: fake, _acao: 'rascunho' });
    expect(bad.flash ?? bad.text).toContain('Tipo de arquivo não permitido');
    const good = new File([readFileSync(__dirname + '/../db/demo/placeholder.jpg')], 'f.jpg', { type: 'image/jpeg' });
    const ok = await sup.req('POST', `/app/pacientes/${P['Pedro']}/diario`, { _csrf: await sup.csrf(), entry_date: '10/11/2026', meal: 'Jantar', foods_served: 'Teste foto', photo_before: good, _acao: 'final' });
    expect(ok.status).toBe(303);
    const row = await sql`select photo_before_path from public.food_diary_entries where foods_served = 'Teste foto'`; const path = row[0].photo_before_path as string; expect(path).toStartWith(P['Pedro'] + '/diary/');
    expect((await sup.req('GET', '/arquivos/' + path, undefined, true)).status).toBe(200);
    for (const c of [famA, famB, escA, escB]) expect((await c.get('/arquivos/' + path)).status).toBe(404);
  });
  test('12. retirar a liberação impede novos acessos; nova liberação restaura (nova versão)', async () => {
    const pub = await asService((tx) => J1<any>(tx, `select id, file_path, source_id from public.publications where title like 'Relatório de acompanhamento%' and status = 'ativo'`));
    expect((await famA.req('GET', '/arquivos/' + pub.file_path, undefined, true)).status).toBe(200);
    const r = await master.post(`/app/pacientes/${P['Lucas']}/retirar/${pub.id}`); expect(r.flash).toContain('retirada');
    expect((await famA.get('/arquivos/' + pub.file_path)).status).toBe(404);
    expect((await famA.get('/familia/' + P['Lucas'])).text).not.toContain('Relatório de acompanhamento (demo)');
    await master.post(`/app/pacientes/${P['Lucas']}/liberar`, { t: 'documents', id: pub.source_id, para: 'familia' });
    expect((await famA.req('GET', '/arquivos/' + pub.file_path, undefined, true)).status).toBe(200);
    const v = await asService((tx) => J<any>(tx, `select version, status from public.publications where file_path = $1 order by version`, [pub.file_path]));
    expect(v.map((x) => `${x.version}:${x.status}`)).toEqual(['1:retirado', '2:ativo']);
  });
});

describe('13/14. Desativação e persistência', () => {
  test('14. dados permanecem após novo login (recarregar)', async () => {
    const fresh = await loggedIn('master.cores'); expect((await fresh.get(`/app/pacientes/${P['Pedro']}/diario`)).text).toContain('Jantar');
    expect((await fresh.get('/app')).text).toMatch(/Pacientes ativos/);
  });
  test('13. desativar usuário bloqueia o acesso protegido imediatamente (sessão aberta e novo login)', async () => {
    const u = await asService((tx) => J1<any>(tx, `select id from public.profiles where email = $1`, [A('escola.b')]));
    expect((await escB.get('/escola')).status).toBe(200);
    const r = await master.post(`/app/usuarios/${u.id}/ativo`, { ativo: '0' }); expect(r.flash).toContain('desativado');
    const after = await escB.get('/escola'); expect(after.status).toBe(303); expect(after.location).toContain('/entrar?motivo=');
    expect((await escB.get(`/arquivos/${P['Marina']}/school/s2.jpg`)).status).toBe(303);
    const l = await new Client().login(A('escola.b'), PW[A('escola.b')]); expect(l.status).toBe(401); expect(l.text).toContain('desativado');
    await master.post(`/app/usuarios/${u.id}/ativo`, { ativo: '1' });
    expect((await new Client().login(A('escola.b'), PW[A('escola.b')])).status).toBe(303);
  });
  test('masters não podem ser desativados pelo aplicativo', async () => {
    const u = await asService((tx) => J1<any>(tx, `select id from public.profiles where email = $1`, [A('master.cores')]));
    const r = await master.post(`/app/usuarios/${u.id}/ativo`, { ativo: '0' }); expect(r.flash).toBeTruthy();
    expect((await asService((tx) => J1<any>(tx, `select active from public.profiles where id = $1`, [u.id]))).active).toBe(true);
  });
  test('arquivar paciente corta o acesso de família e escola; reativar restaura', async () => {
    await master.post(`/app/pacientes/${P['Sofia']}/arquivar`);
    expect((await famA.get('/familia/' + P['Sofia'])).status).toBe(404);
    await master.post(`/app/pacientes/${P['Sofia']}/reativar`);
    expect((await famA.get('/familia/' + P['Sofia'])).status).toBe(200);
  });
});

describe('Cadastro, questionário, relatórios e demais funções', () => {
  test('master cadastra paciente (persistente) e supervisionado não consegue', async () => {
    const r = await master.post('/app/pacientes', { full_name: 'Teste Cadastro HTTP', birth_date: '15/03/2020', sex_growth: 'F', school_name: 'Escola Demo A', g_nome_0: 'Resp. Fictício', school_photo_authorized: 'on' });
    expect(r.status).toBe(303); expect((await master.get(r.location!)).text).toContain('Teste Cadastro HTTP');
    expect((await sup.post('/app/pacientes', { full_name: 'Não deve', birth_date: '15/03/2020' })).status).toBe(403);
    expect((await master.post('/app/pacientes', { full_name: 'Data ruim', birth_date: '31/02/2020' })).status).toBe(400);
  });
  test('anamnese, crescimento, diário, mapa e planejamento persistem', async () => {
    const id = P['Pedro'];
    expect((await sup.post(`/app/pacientes/${id}/anamnese`, { a_historia_alimentar: 'História HTTP', _acao: 'finalizada' })).status).toBe(303);
    expect((await sup.get(`/app/pacientes/${id}/anamnese`)).text).toContain('História HTTP');
    expect((await sup.post(`/app/pacientes/${id}/crescimento`, { measured_on: '01/11/2026', weight_kg: '48,5', height_cm: '160' })).flash).toContain('Medida salva');
    const g = (await sup.get(`/app/pacientes/${id}/crescimento`)).text; expect(g).toContain('48,5'); expect(g).toContain('Referência de crescimento pendente'); expect(g).toContain('<svg');
    const fut = await sup.post(`/app/pacientes/${id}/crescimento`, { measured_on: '01/01/2999', weight_kg: '10' }); expect(fut.flash ?? '').toContain('não pode ser futura');
    const noUnit = await sup.post(`/app/pacientes/${id}/diario`, { entry_date: '09/11/2026', qty_consumed: '50', _acao: 'final' }); expect(noUnit.status).toBe(400); expect(noUnit.text).toContain('Informe a unidade');
    expect((await sup.post(`/app/pacientes/${id}/mapa`, { food_name: 'Maçã HTTP', acceptance: 'aceito', food_group: 'Frutas' })).status).toBe(303);
    expect((await sup.get(`/app/pacientes/${id}/mapa`)).text).toContain('Maçã HTTP');
    const pl = await sup.post(`/app/pacientes/${id}/planejamento`, { title: 'Plano HTTP', status: 'rascunho', g_desc_0: 'Meta HTTP', g_term_0: 'curto', g_prog_0: 'em_andamento' });
    expect((await sup.get(pl.location!)).text).toContain('Meta HTTP');
  });
  test('questionário: salva, calcula só com respostas suficientes, mostra método e não inventa classificação', async () => {
    const id = P['Lucas'];
    const form: Record<string, string> = { age_band: '2_5', answered_on: '10/11/2026', interviewee: 'mãe', _acao: 'finalizado' };
    for (const a of ['A', 'B']) for (let i = 1; i <= 4; i++) form[`q_2_5.${a}.${i}`] = String(i % 5);
    form['q_2_5.A.5'] = 'na'; form['q_2_5.C.1'] = '2'; // C com 1 resposta: insuficiente
    const r = await sup.post(`/app/pacientes/${id}/questionarios`, form); expect(r.status).toBe(303);
    const t = (await sup.get(r.location!)).text;
    expect(t).toContain('respostas insuficientes'); expect(t).toContain('Como o cálculo é feito'); expect(t).toContain('sem validação diagnóstica');
    for (const bad of ['percentil', 'gravidade moderada', 'risco alto', 'diagnóstico de']) expect(t.toLowerCase()).not.toContain(bad);
    const m = (await sup.get(`/app/pacientes/${id}/mapa`)).text; expect(m).toContain('Mapa de respostas sensoriais'); expect(m).toContain('Mapa de variedade alimentar');
  });
  test('relatório PDF: exige seleção, não inclui notas internas por padrão e é salvo no prontuário', async () => {
    const s = await asService((tx) => J1<any>(tx, `select id from public.sessions where patient_id = $1 and status = 'finalizada'`, [P['Lucas']]));
    expect((await master.post('/app/relatorios/previa', { paciente: P['Lucas'], tipo: 'sessoes' })).flash).toContain('Selecione');
    const prev = await master.post('/app/relatorios/previa', { paciente: P['Lucas'], tipo: 'sessoes', sel: [`sessions:${s.id}`] }); expect(prev.text).toContain('Prévia do relatório'); expect(prev.text).not.toContain('SEGREDO');
    const pdf = await master.req('POST', '/app/relatorios/gerar', { _csrf: await master.csrf(), paciente: P['Lucas'], tipo: 'sessoes', sel: [`sessions:${s.id}`] }, true);
    expect(pdf.status).toBe(200); expect(pdf.headers.get('content-type')).toBe('application/pdf'); expect(String.fromCharCode(...pdf.bytes.slice(0, 5))).toBe('%PDF-');
    const txt = await pdfText(pdf.bytes); expect(txt).toContain('Relatório'); expect(txt).toContain('Brócolis'); expect(txt).not.toContain('SEGREDO'); expect(txt).toContain('não informado');
    const pdf2 = await master.req('POST', '/app/relatorios/gerar', { _csrf: await master.csrf(), paciente: P['Lucas'], tipo: 'sessoes', sel: [`sessions:${s.id}`], internas: 'on' }, true);
    expect(await pdfText(pdf2.bytes)).toContain('SEGREDO-INTERNO');
    expect((await sql`select count(*)::int as n from public.documents where kind = 'relatorio' and title like 'Relatório — Sessões%'`)[0].n).toBe(2);
  });
  test('auditoria registra autoria sem conteúdo clínico; master consulta, supervisionado não', async () => {
    const t = (await master.get('/app/auditoria')).text; expect(t).toContain('sessions'); expect(t).not.toContain('SEGREDO');
    expect((await sup.get('/app/auditoria')).status).toBe(403);
  });
  test('exclusão definitiva: exige arquivar e confirmar o nome', async () => {
    const id = (await asService((tx) => J1<any>(tx, `select id from public.patients where full_name = 'Teste Cadastro HTTP'`))).id;
    expect((await master.post(`/app/pacientes/${id}/excluir`, { confirma: 'Teste Cadastro HTTP' })).flash).toContain('Arquive');
    await master.post(`/app/pacientes/${id}/arquivar`);
    expect((await master.post(`/app/pacientes/${id}/excluir`, { confirma: 'nome errado' })).flash).toContain('não confere');
    expect((await sup.post(`/app/pacientes/${id}/excluir`, { confirma: 'Teste Cadastro HTTP' })).status).toBe(403);
    expect((await master.post(`/app/pacientes/${id}/excluir`, { confirma: 'Teste Cadastro HTTP' })).flash).toContain('excluído');
    expect((await sql`select count(*)::int as n from public.deletion_log`)[0].n).toBe(1);
  });
  test('todas as páginas do painel respondem sem erro para o master', async () => {
    const paths = ['/app', '/app/pacientes', '/app/diario', '/app/avaliacoes', '/app/sessoes', '/app/planejamentos', '/app/escola', '/app/relatorios', '/app/usuarios', '/app/configuracoes', '/app/auditoria', '/conta',
      ...['', '/anamnese', '/crescimento', '/diario', '/questionarios', '/mapa', '/sessoes', '/planejamento', '/escola', '/documentos'].map((t) => `/app/pacientes/${P['Lucas']}${t}`),
      `/app/relatorios/novo?paciente=${P['Lucas']}&tipo=acompanhamento`, `/app/pacientes/${P['Lucas']}/editar`, `/app/pacientes/${P['Lucas']}/diario/novo`, `/app/pacientes/${P['Lucas']}/sessoes/novo`, `/app/pacientes/${P['Lucas']}/planejamento/novo`, `/app/pacientes/${P['Lucas']}/questionarios/novo?faixa=2_5`];
    for (const p of paths) { const r = await master.get(p); expect([p, r.status]).toEqual([p, 200]); }
  });
});

async function pdfText(bytes: Uint8Array): Promise<string> {
  const p = Bun.spawn(['python3', '-I', '-c', 'import sys,io;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print("\\n".join(pg.extract_text() or "" for pg in r.pages))'], { stdin: new Blob([bytes]), stdout: 'pipe' });
  return await new Response(p.stdout).text();
}
