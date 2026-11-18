// Remove TODOS os dados e usuários fictícios (@demo.invalid), inclusive as contas master de demonstração,
// para liberar a ativação dos masters reais. Uso: bun scripts/remove-demo.ts
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { asService, sql } from '../src/server/db';
import { config } from '../src/server/config';

const files = await asService(async (tx) => {
  const f = await tx.unsafe(`select o.name from storage.objects o join public.patients p on p.id::text = split_part(o.name, '/', 1) where p.is_demo`);
  await tx`delete from storage.objects where name in (select o.name from storage.objects o join public.patients p on p.id::text = split_part(o.name, '/', 1) where p.is_demo)`;
  await tx`delete from public.patients where is_demo`;                       // cascata: registros clínicos
  await tx`delete from public.invitations where email like '%@demo.invalid'`;
  await tx`delete from auth.users where email like '%@demo.invalid'`;       // cascata: perfis, vínculos, sessões
  await tx`delete from auth.tokens where email like '%@demo.invalid'`;
  return f as { name: string }[];
});
for (const f of files) await rm(join(config.dataDir, 'files', f.name), { force: true });
await rm(join(config.dataDir, 'demo-credentials.txt'), { force: true });
console.log(`Dados fictícios removidos (${files.length} arquivos).`);
await sql.close();
