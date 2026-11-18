// Arquivos privados: bytes em DATA_DIR/files (fora da pasta pública); acesso SOMENTE pelo servidor,
// após o banco (RLS em storage.objects) confirmar que o usuário pode ver o objeto.
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { Tx, J1 } from './db';

export const BUCKET = 'clinical-files';
export type FileArea = 'diary' | 'school' | 'documents' | 'reports';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export function sniff(b: Uint8Array): string | null {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (b.length > 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}
export const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(diary|school|documents|reports)\/[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;
const diskPath = (name: string) => join(config.dataDir, 'files', name);

/** Valida o conteúdo real do arquivo (não confia na extensão), registra no banco (RLS) e grava no disco. */
export async function storeUpload(tx: Tx, patientId: string, area: FileArea, file: File, allow: string[] = Object.keys(EXT)):
  Promise<{ path: string; mime: string; size: number }> {
  if (file.size === 0) throw new UserError('Arquivo vazio.');
  if (file.size > config.maxUploadBytes) throw new UserError('Arquivo maior que 10 MB.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(buf);
  if (!mime || !allow.includes(mime)) throw new UserError('Tipo de arquivo não permitido (use JPG, PNG, WEBP ou PDF).');
  return storeBytes(tx, patientId, area, buf, mime);
}
export async function storeBytes(tx: Tx, patientId: string, area: FileArea, buf: Uint8Array, mime: string) {
  const path = `${patientId}/${area}/${randomUUID()}.${EXT[mime]}`;
  // O INSERT passa pelas políticas do banco: se o usuário não puder enviar para esta área/paciente, falha aqui.
  await tx`insert into storage.objects(bucket_id, name, mime_type, size_bytes, content) values (${BUCKET}, ${path}, ${mime}, ${buf.length}, ${buf})`;
  return { path, mime, size: buf.length };
}
/** Só devolve os bytes se o banco (RLS) permitir ao usuário ver o objeto. */
export async function readIfAllowed(tx: Tx, name: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!PATH_RE.test(name)) return null;
  const rows = await tx`select mime_type, content from storage.objects where bucket_id = ${BUCKET} and name = ${name}`;
  if (!rows.length) return null;
  const row = rows[0] as { mime_type: string; content: Uint8Array | null };
  if (row.content) return { bytes: new Uint8Array(row.content), mime: row.mime_type ?? 'application/octet-stream' };
  // compatibilidade: arquivos antigos/demonstração gravados em disco
  try { return { bytes: new Uint8Array(await readFile(diskPath(name))), mime: row.mime_type ?? 'application/octet-stream' }; } catch { return null; }
}
export async function removeFromDisk(name: string) { if (PATH_RE.test(name)) await rm(diskPath(name), { force: true }); }

export class UserError extends Error {}
