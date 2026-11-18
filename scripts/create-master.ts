// Ativa com segurança os dois acessos master. Gera um LINK de primeiro acesso de uso único
// (válido por 72 h) — nenhuma senha é criada ou exibida. A pessoa define a própria senha pelo link.
// Uso:  bun scripts/create-master.ts --alana voce@exemplo.com --cores coordenacao@exemplo.com
import { asService, J1, sql } from '../src/server/db';
import { createToken, linkFor } from '../src/server/auth';

const args = process.argv.slice(2);
const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const targets: [string, string | undefined, string][] = [
  ['master_alana', get('--alana'), 'Master Alana'], ['master_cores', get('--cores'), 'Master CoReS'],
];
if (!targets.some((t) => t[1])) { console.error('Informe --alana <e-mail> e/ou --cores <e-mail>.'); process.exit(1); }

for (const [role, email, label] of targets) {
  if (!email) continue;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error(`E-mail inválido para ${label}.`); process.exit(1); }
  await asService(async (tx) => {
    const existing = await J1<any>(tx, `select email from public.profiles where role = $1`, [role]);
    if (existing) { console.log(`${label}: já ativado (${existing.email}). Para trocar a senha use "Esqueci minha senha".`); return; }
    const used = await J1<any>(tx, `select 1 as x from auth.users where lower(email) = $1`, [email.toLowerCase()]);
    if (used) { console.error(`${label}: o e-mail já pertence a outra conta.`); return; }
    await tx`update public.invitations set status = 'cancelado' where role = ${role} and status = 'pendente'`;
    await tx`update public.invitations set status = 'cancelado' where lower(email) = ${email.toLowerCase()} and status = 'pendente'`;
    await tx`insert into public.invitations(email, full_name, role) values (${email}, ${label}, ${role})`;
    const t = await createToken(tx, 'convite', email, null, 72);
    console.log(`\n${label} — link de primeiro acesso (uso único, válido por 72 h):\n${linkFor('convite', t.token)}\n`);
  });
}
await sql.close();
