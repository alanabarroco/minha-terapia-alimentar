// Acesso ao PostgreSQL. REGRA: todo dado clínico é lido/escrito por asUser(), que assume o papel
// "authenticated" com a identidade do usuário — assim as políticas RLS do banco valem sempre.
// asService() (papel service_role) existe só para autenticação/convites no servidor.
import { SQL } from 'bun';
import { config } from './config';

export const sql: SQL = config.pgSocket
  ? new SQL({ path: config.pgSocket, username: config.pgUser, database: config.pgDatabase, max: 10 })
  : new SQL({ url: config.databaseUrl, max: 10 });

export type Tx = any; // transação do Bun.sql

export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx: Tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    await tx.unsafe('set local role authenticated');
    await tx.unsafe("set local timezone = 'America/Sao_Paulo'");
    return fn(tx);
  }) as Promise<T>;
}

export async function asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx: Tx) => {
    await tx.unsafe('set local role service_role');
    return fn(tx);
  }) as Promise<T>;
}

/** Consulta parametrizada devolvendo objetos JSON (datas ISO, números numéricos). */
export async function J<T = any>(tx: Tx, query: string, params: any[] = []): Promise<T[]> {
  const rows = await tx.unsafe(`select to_jsonb(x) as j from (${query}) x`, params);
  return rows.map((r: any) => (typeof r.j === 'string' ? JSON.parse(r.j) : r.j));
}
export async function J1<T = any>(tx: Tx, query: string, params: any[] = []): Promise<T | null> {
  return (await J<T>(tx, query, params))[0] ?? null;
}

export type ColType = 'text' | 'date' | 'time' | 'number' | 'int' | 'bool' | 'jsonb' | 'multi' | 'uuid' | 'uuids';
const CAST: Record<ColType, string> = {
  text: '', date: '::date', time: '::time', number: '::numeric', int: '::int', bool: '::boolean',
  jsonb: '::text::jsonb', multi: '::text[]', uuid: '::uuid', uuids: '::uuid[]',
};
function encode(v: any, t: ColType): any {
  if (v === undefined || v === null || v === '') return null;
  if (t === 'jsonb') return typeof v === 'string' ? v : JSON.stringify(v);
  if (t === 'multi' || t === 'uuids') return '{' + (v as string[]).map((s) => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"').join(',') + '}';
  if (t === 'bool') return v === true || v === 'on' || v === 'true' || v === '1';
  return v;
}
type Col = { name: string; type: ColType };

/** INSERT parametrizado a partir de colunas conhecidas (nomes vêm do código, nunca do usuário). */
export async function insertRow(tx: Tx, table: string, cols: Col[], values: Record<string, any>): Promise<string> {
  const names = cols.map((c) => `"${c.name}"`).join(',');
  const ph = cols.map((c, i) => `$${i + 1}${CAST[c.type]}`).join(',');
  const rows = await tx.unsafe(`insert into public.${table} (${names}) values (${ph}) returning id`, cols.map((c) => encode(values[c.name], c.type)));
  return rows[0].id;
}
export async function updateRow(tx: Tx, table: string, id: string, cols: Col[], values: Record<string, any>): Promise<number> {
  const sets = cols.map((c, i) => `"${c.name}" = $${i + 1}${CAST[c.type]}`).join(',');
  const res = await tx.unsafe(`update public.${table} set ${sets} where id = $${cols.length + 1}::uuid returning id`,
    [...cols.map((c) => encode(values[c.name], c.type)), id]);
  return res.length;
}
export const isUuid = (s: string | undefined | null): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
