-- Arquivos privados passam a ser guardados no próprio banco (coluna content), protegidos pela mesma RLS.
-- Assim o backup do banco já inclui fotos/PDFs e hospedagens gratuitas (sem disco persistente) funcionam.
alter table storage.objects add column if not exists content bytea;
