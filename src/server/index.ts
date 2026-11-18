import { join, normalize } from 'node:path';
import { dispatch, SECURITY_HEADERS } from './web';
import { config } from './config';
import './routes/public';
import './routes/staff';
import './routes/staff2';
import './routes/admin';
import './routes/external';
import './routes/files';

const PUBLIC = join(import.meta.dir, '../../public');

export async function handle(req: Request, ip: string): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/static/')) {
    const rel = normalize(url.pathname.slice('/static/'.length));
    if (rel.includes('..')) return new Response('Not found', { status: 404 });
    const f = Bun.file(join(PUBLIC, rel));
    if (!(await f.exists())) return new Response('Not found', { status: 404 });
    return new Response(f, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (url.pathname === '/saude') return new Response('ok', { headers: SECURITY_HEADERS }); // verificação de funcionamento (sem dados)
  return dispatch(req, ip);
}

if (import.meta.main) {
  const server = Bun.serve({
    port: config.port,
    maxRequestBodySize: 40 * 1024 * 1024,
    fetch: (req, srv) => {
      const fwd = config.trustProxy ? req.headers.get('x-forwarded-for')?.split(',')[0].trim() : '';
      return handle(req, fwd || srv.requestIP(req)?.address || 'desconhecido');
    },
  });
  console.log(`Minha Terapia Alimentar em ${config.appUrl} (porta ${server.port})`);
}
