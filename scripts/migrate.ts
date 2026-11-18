// Aplica as migrações em db/migrations (em ordem) e registra as já aplicadas. Uso: bun scripts/migrate.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../src/server/db';

await sql`create schema if not exists ops`;
await sql`create table if not exists ops.schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const dir = join(import.meta.dir, '../db/migrations');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const done = await sql`select 1 from ops.schema_migrations where name = ${f}`;
  if (done.length) { console.log(`✓ ${f} (já aplicada)`); continue; }
  await sql.begin(async (tx) => { await tx.unsafe(readFileSync(join(dir, f), 'utf8')); await tx`insert into ops.schema_migrations(name) values (${f})`; });
  console.log(`▶ ${f} aplicada`);
}
// Em bancos gerenciados o dono do banco precisa poder assumir os papéis usados pelo aplicativo.
for (const r of ['authenticated', 'service_role']) {
  try { await sql.unsafe(`grant ${r} to current_user with set true`); }
  catch { try { await sql.unsafe(`grant ${r} to current_user`); } catch (e: any) { console.log(`(aviso) não foi possível conceder ${r}: ${e.message}`); } }
}
await sql.close();
