// Cria os usuários e dados FICTÍCIOS de demonstração. Senhas ALEATÓRIAS (nunca fixas): são impressas uma vez
// e gravadas em data/demo-credentials.txt (arquivo local, fora do Git). Remova tudo com db/demo/remove_demo.sql.
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { asService, J1, sql } from '../src/server/db';
import { hashPassword } from '../src/server/auth';
import { storeBytes } from '../src/server/files';
import { reportPdf } from '../src/server/report';
import { config } from '../src/server/config';

export const DEMO_USERS: { email: string; name: string; role: string; school?: string }[] = [
  { email: 'master.alana@demo.invalid', name: 'Master Alana (demo)', role: 'master_alana' },
  { email: 'master.cores@demo.invalid', name: 'Master CoReS (demo)', role: 'master_cores' },
  { email: 'supervisionada@demo.invalid', name: 'Supervisionada Demo', role: 'supervisionado' },
  { email: 'escola.a@demo.invalid', name: 'Escola Demo A', role: 'escola', school: 'Escola Demo A' },
  { email: 'escola.b@demo.invalid', name: 'Escola Demo B', role: 'escola', school: 'Escola Demo B' },
  { email: 'familia.a@demo.invalid', name: 'Família Demo A', role: 'familia' },
  { email: 'familia.b@demo.invalid', name: 'Família Demo B', role: 'familia' },
];

export async function seedDemo(passwordFor: (email: string) => string = () => randomBytes(9).toString('base64url') + 'a1'): Promise<Record<string, string>> {
  const passwords: Record<string, string> = {};
  const already = await asService((t) => J1<any>(t, `select 1 as x from public.patients where is_demo limit 1`));
  if (already) throw new Error('Os dados de demonstração já existem. Execute db/demo/remove_demo.sql antes de recriar.');
  for (const u of DEMO_USERS) {
    const pw = passwordFor(u.email); passwords[u.email] = pw;
    const hash = await hashPassword(pw);
    await asService(async (tx) => {
      await tx`insert into public.invitations(email, full_name, role, school_name) values (${u.email}, ${u.name}, ${u.role}, ${u.school ?? null})`;
      await tx`insert into auth.users(email, password_hash, email_confirmed_at) values (${u.email}, ${hash}, now())`;
    });
  }
  await asService((tx) => tx.unsafe(readFileSync(join(import.meta.dir, '../db/demo/demo_data.sql'), 'utf8')));
  // arquivos fictícios referenciados pelos dados de demonstração
  const jpg = new Uint8Array(readFileSync(join(import.meta.dir, '../db/demo/placeholder.jpg')));
  const pdf = await reportPdf({ type: 'demo', title: 'Documento fictício de demonstração', patientName: 'Paciente Demo', identification: [['Nome', 'Paciente Demo (fictício)']], period: 'Sem período', professional: [['Profissional responsável', 'Demonstração']], service: [], sections: [{ heading: 'Conteúdo', blocks: [{ t: 'p', text: 'Este PDF é inteiramente fictício e serve apenas para demonstrar o download protegido.' }] }], generatedAt: '', includesInternal: false });
  const files = await asService((tx) => tx.unsafe(`select name from public.food_diary_entries e cross join lateral (values (e.photo_before_path)) v(name) where name is not null
    union select photo_path from public.school_meal_records where photo_path is not null union select storage_path from public.documents`));
  const { mkdir: mk, writeFile: wf } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  for (const f of files as { name: string }[]) {
    const mime = f.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    const bytes = mime === 'application/pdf' ? pdf : jpg;
    await asService((tx) => tx`insert into storage.objects(bucket_id, name, mime_type, size_bytes) values ('clinical-files', ${f.name}, ${mime}, ${bytes.length}) on conflict do nothing`);
    const full = join(config.dataDir, 'files', f.name); await mk(dirname(full), { recursive: true }); await wf(full, bytes);
  }
  return passwords;
}

if (import.meta.main) {
  const pw = await seedDemo();
  await mkdir(config.dataDir, { recursive: true });
  const text = Object.entries(pw).map(([e, p]) => `${e}  ${p}`).join('\n') + '\n';
  await writeFile(join(config.dataDir, 'demo-credentials.txt'), text, { mode: 0o600 });
  console.log('Dados fictícios criados. Credenciais (geradas agora, só para demonstração):\n' + text + '\nTambém salvas em data/demo-credentials.txt');
  await sql.close();
}
