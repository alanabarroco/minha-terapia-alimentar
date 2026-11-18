// Autenticação própria: senhas com argon2id (Bun.password), sessões com token aleatório (só o hash fica no banco),
// tokens de uso único para convite e recuperação, limite de tentativas.
import { createHash, randomBytes } from 'node:crypto';
import { asService, J1, sql, Tx } from './db';
import { config } from './config';

export type Role = 'master_alana' | 'master_cores' | 'supervisionado' | 'escola' | 'familia';
export type User = {
  id: string; email: string; full_name: string; role: Role; active: boolean; can_publish: boolean;
  crn: string | null; professional_title: string | null; school_name: string | null;
};
export type SessionInfo = { id: string; csrf: string; user: User };

export const isMaster = (r: Role) => r === 'master_alana' || r === 'master_cores';
export const isStaff = (r: Role) => isMaster(r) || r === 'supervisionado';
export const ROLE_LABEL: Record<Role, string> = {
  master_alana: 'Master Alana', master_cores: 'Master CoReS', supervisionado: 'Supervisionado(a)',
  escola: 'Escola', familia: 'Família',
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

// ---------- senha ----------
export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use letras e números na senha.';
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4)
    return 'A senha não pode conter o seu e-mail.';
  if (pw.length > 200) return 'Senha longa demais.';
  return null;
}
export const hashPassword = (pw: string) => Bun.password.hash(pw, { algorithm: 'argon2id' });

// ---------- limite de tentativas (memória do processo) ----------
const attempts = new Map<string, { n: number; first: number }>();
const WINDOW = 15 * 60_000;
export function throttled(key: string, max = key.startsWith('ip|') || key.startsWith('rec|') ? 40 : 8): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.n >= max;
}
export function noteFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
}
export const clearFailures = (key: string) => attempts.delete(key);

// ---------- sessões ----------
export const SESSION_COOKIE = 'mta_session';

export async function createSession(userId: string): Promise<{ token: string; maxAge: number }> {
  const token = newToken();
  await asService(async (tx) => {
    await tx`insert into auth.sessions(token_hash, user_id, csrf, expires_at)
             values (${sha(token)}, ${userId}, ${newToken()}, now() + make_interval(hours => ${config.sessionHours}))`;
    await tx`update auth.users set last_sign_in_at = now() where id = ${userId}`;
  });
  return { token, maxAge: config.sessionHours * 3600 };
}

export async function destroySession(token: string | undefined) {
  if (token) await asService((tx) => tx`delete from auth.sessions where token_hash = ${sha(token)}`);
}
export async function destroyUserSessions(userId: string, tx?: Tx) {
  if (tx) await tx`delete from auth.sessions where user_id = ${userId}`;
  else await asService((t) => t`delete from auth.sessions where user_id = ${userId}`);
}

export type SessionResult = { session: SessionInfo } | { session: null; reason: 'sem_sessao' | 'expirada' | 'desativada' };

/** Valida o cookie a CADA requisição: sessão válida, não ociosa e perfil ainda ativo. */
export async function readSession(token: string | undefined): Promise<SessionResult> {
  if (!token) return { session: null, reason: 'sem_sessao' };
  return asService(async (tx) => {
    const s = await J1<any>(tx, `
      select s.id, s.csrf, s.user_id, s.expires_at, s.last_seen_at, (s.expires_at < now()) as expired,
             (s.last_seen_at < now() - make_interval(mins => $2)) as idle,
             u.banned_until, p.id as pid, p.email, p.full_name, p.role, p.active, p.can_publish, p.crn,
             p.professional_title, p.school_name
        from auth.sessions s join auth.users u on u.id = s.user_id left join public.profiles p on p.id = s.user_id
       where s.token_hash = $1`, [sha(token), config.idleMinutes]);
    if (!s) return { session: null, reason: 'expirada' } as SessionResult;
    if (s.expired || s.idle) { await tx`delete from auth.sessions where id = ${s.id}`; return { session: null, reason: 'expirada' } as SessionResult; }
    if (!s.pid || !s.active || (s.banned_until && new Date(s.banned_until) > new Date())) {
      await tx`delete from auth.sessions where id = ${s.id}`;
      return { session: null, reason: 'desativada' } as SessionResult;
    }
    await tx`update auth.sessions set last_seen_at = now() where id = ${s.id}`;
    const user: User = { id: s.pid, email: s.email, full_name: s.full_name, role: s.role, active: s.active,
      can_publish: s.can_publish, crn: s.crn, professional_title: s.professional_title, school_name: s.school_name };
    return { session: { id: s.id, csrf: s.csrf, user } } as SessionResult;
  });
}

// ---------- login ----------
export type LoginResult = { ok: true; token: string; maxAge: number; user: User } | { ok: false; error: string };
export async function login(email: string, password: string, ip: string): Promise<LoginResult> {
  const e = email.trim().toLowerCase();
  const key = `${e}|${ip}`;
  if (throttled(key) || throttled(`ip|${ip}`)) return { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };
  const row = await asService((tx) => J1<any>(tx, `
    select u.id, u.password_hash, u.banned_until, p.active, p.role, p.id as pid
      from auth.users u left join public.profiles p on p.id = u.id where lower(u.email) = $1`, [e]));
  // Compara sempre (mesmo sem usuário) para não revelar se o e-mail existe pelo tempo de resposta
  const hash = row?.password_hash ?? '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Uk1JZ3dKMlZ6VlZ6a2xqT3VJb2V3d0p0cVdWZ2tMZw';
  let good = false;
  try { good = await Bun.password.verify(password, hash); } catch { good = false; }
  if (!row || !row.password_hash || !good) {
    noteFailure(key); noteFailure(`ip|${ip}`);
    return { ok: false, error: 'E-mail ou senha incorretos.' };
  }
  if (!row.pid || !row.active || (row.banned_until && new Date(row.banned_until) > new Date()))
    return { ok: false, error: 'Este acesso está desativado. Fale com a coordenação.' };
  clearFailures(key);
  const s = await createSession(row.id);
  const r = await readSession(s.token);
  if (!r.session) return { ok: false, error: 'Não foi possível iniciar a sessão.' };
  return { ok: true, token: s.token, maxAge: s.maxAge, user: r.session.user };
}

// ---------- tokens de convite/recuperação ----------
export async function createToken(tx: Tx, kind: 'convite' | 'recuperacao', email: string, createdBy: string | null, hours: number) {
  const token = newToken();
  // invalida tokens anteriores do mesmo tipo/e-mail (reenvio)
  await tx`update auth.tokens set used_at = now() where lower(email) = ${email.toLowerCase()} and kind = ${kind} and used_at is null`;
  const r = await tx`insert into auth.tokens(token_hash, kind, email, expires_at, created_by)
     values (${sha(token)}, ${kind}, ${email.toLowerCase()}, now() + make_interval(hours => ${hours}), ${createdBy}) returning id`;
  return { token, id: r[0].id as string };
}
export async function peekToken(kind: 'convite' | 'recuperacao', token: string) {
  return asService((tx) => J1<{ id: string; email: string }>(tx, `
    select id, email from auth.tokens where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()`, [sha(token), kind]));
}
export const linkFor = (kind: 'convite' | 'recuperacao', token: string) =>
  `${config.appUrl}/${kind === 'convite' ? 'convite' : 'redefinir'}/${token}`;

/** Primeiro acesso: cria a conta SOMENTE se houver convite pendente (o gatilho do banco também exige). */
export async function acceptInvite(token: string, fullName: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await peekToken('convite', token);
  if (!t) return { ok: false, error: 'Convite inválido, já utilizado ou expirado. Peça um novo convite à coordenação.' };
  const problem = passwordProblem(password, t.email);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(password);
  try {
    await asService(async (tx) => {
      const users = await tx`insert into auth.users(email, password_hash, email_confirmed_at)
         values (${t.email}, ${hash}, now()) returning id`;
      const uid = users[0].id;
      if (fullName.trim()) await tx`update public.profiles set full_name = ${fullName.trim()} where id = ${uid}`;
      await tx`update auth.tokens set used_at = now() where id = ${t.id}`;
    });
  } catch (e: any) {
    if (String(e?.message ?? e).includes('auth_users_email_uq')) return { ok: false, error: 'Já existe uma conta com este e-mail. Use "Esqueci minha senha".' };
    if (String(e?.message ?? e).includes('somente por convite')) return { ok: false, error: 'Não há convite pendente para este e-mail.' };
    throw e;
  }
  return { ok: true };
}

export async function resetPassword(token: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await peekToken('recuperacao', token);
  if (!t) return { ok: false, error: 'Link inválido, já utilizado ou expirado. Solicite uma nova recuperação.' };
  const problem = passwordProblem(password, t.email);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(password);
  await asService(async (tx) => {
    const u = await tx`update auth.users set password_hash = ${hash} where lower(email) = ${t.email} returning id`;
    if (!u.length) throw new Error('usuário inexistente');
    await tx`update auth.tokens set used_at = now() where id = ${t.id}`;
    await tx`delete from auth.sessions where user_id = ${u[0].id}`; // encerra todas as sessões
  });
  return { ok: true };
}

export async function changeOwnPassword(userId: string, email: string, current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await asService((tx) => J1<any>(tx, `select password_hash from auth.users where id = $1`, [userId]));
  if (!row || !(await Bun.password.verify(current, row.password_hash))) return { ok: false, error: 'Senha atual incorreta.' };
  const problem = passwordProblem(next, email);
  if (problem) return { ok: false, error: problem };
  const hash = await hashPassword(next);
  await asService(async (tx) => {
    await tx`update auth.users set password_hash = ${hash} where id = ${userId}`;
  });
  return { ok: true };
}

// ---------- e-mail ----------
/** Envia por Resend (se configurado) ou guarda na caixa de saída para o master entregar o link. */
export async function deliverLink(tx: Tx, p: { kind: 'convite' | 'recuperacao'; email: string; tokenId: string; link: string; subject: string; text: string }): Promise<'enviado' | 'manual'> {
  let sent = false;
  if (config.resendApiKey && config.mailFrom) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.mailFrom, to: [p.email], subject: p.subject, text: `${p.text}\n\n${p.link}\n` }),
      });
      sent = r.ok;
    } catch { sent = false; }
  }
  await tx`insert into auth.outbox(to_email, kind, subject, link, token_id, sent_at)
           values (${p.email}, ${p.kind}, ${p.subject}, ${sent ? '(enviado por e-mail)' : p.link}, ${p.tokenId}, ${sent ? new Date() : null})`;
  return sent ? 'enviado' : 'manual';
}
