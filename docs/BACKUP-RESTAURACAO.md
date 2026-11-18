# Cópias de segurança e restauração

O sistema guarda dados em **dois lugares** — os dois precisam de backup:
1. **Banco PostgreSQL** (prontuários, usuários, auditoria).
2. **Pasta de arquivos privados** (`DATA_DIR/files`: fotos e PDFs).

## Backup diário (exemplo)
```
pg_dump --format=custom --file=mta-$(date +%F).dump "$DATABASE_URL"
tar czf arquivos-$(date +%F).tgz -C "$DATA_DIR" files
```
Guarde as cópias **criptografadas** (ex.: `gpg -c`) e fora do servidor. Mantenha pelo menos 30 dias. Provedores gerenciados (Railway, Render, Neon etc.) oferecem backup automático do banco: ative-o e confirme a retenção. Os arquivos precisam de rotina própria.

## Restauração
```
createdb mta_restaurado
pg_restore --no-owner -d mta_restaurado mta-AAAA-MM-DD.dump
tar xzf arquivos-AAAA-MM-DD.tgz -C "$DATA_DIR"
```
Aponte `DATABASE_URL` para o banco restaurado e inicie o aplicativo. **Teste a restauração ao menos uma vez antes de usar dados reais** e depois periodicamente.
