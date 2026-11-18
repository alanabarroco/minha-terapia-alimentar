// Download de arquivos privados. O servidor só entrega os bytes se o banco (RLS em storage.objects)
// permitir ao usuário logado ver o objeto. Qualquer negativa responde 404 igual (não revela existência).
import { route, respond, notFound } from '../web';
import { asUser } from '../db';
import { readIfAllowed } from '../files';

route('GET', '/arquivos/*', async (c) => {
  const name = c.params.rest;
  const f = await asUser(c.user!.id, (tx) => readIfAllowed(tx, name));
  if (!f) return notFound(c);
  const isPdf = f.mime === 'application/pdf';
  return respond(c, f.bytes, { headers: {
    'Content-Type': f.mime, 'Content-Disposition': `${isPdf ? 'attachment' : 'inline'}; filename="arquivo.${f.mime.split('/')[1]}"`,
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'Cache-Control': 'private, no-store',
  } });
}, ['master_alana', 'master_cores', 'supervisionado', 'escola', 'familia']);
