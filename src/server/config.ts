// Configuração lida do ambiente. Nenhum segredo fica no código.
import { resolve } from 'node:path';

const env = process.env;
export const config = {
  port: Number(env.PORT ?? 3000),
  production: env.NODE_ENV === 'production',
  appUrl: (env.APP_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL ?? '',
  pgSocket: env.MTA_PG_SOCKET ?? '', // apenas desenvolvimento/testes (socket Unix)
  pgUser: env.MTA_PG_USER ?? 'postgres',
  pgDatabase: env.MTA_PG_DATABASE ?? 'mta_dev',
  dataDir: resolve(env.DATA_DIR ?? './data'), // arquivos privados (fora de /public)
  sessionHours: Number(env.SESSION_HOURS ?? 12), // duração máxima
  idleMinutes: Number(env.SESSION_IDLE_MINUTES ?? 120), // inatividade
  trustProxy: env.TRUST_PROXY === '1', // 1 quando houver proxy reverso confiável (Railway, Render, Nginx...)
  inviteDays: Number(env.INVITE_DAYS ?? 7),
  resendApiKey: env.RESEND_API_KEY ?? '', // opcional: envio de e-mail
  mailFrom: env.MAIL_FROM ?? '',
  maxUploadBytes: 10 * 1024 * 1024,
};
export const TZ = 'America/Sao_Paulo';
