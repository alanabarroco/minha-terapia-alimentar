# Testes — o que foi executado

Executados neste ambiente, contra PostgreSQL 16 real (sem dados reais):

| Suíte | Comando | Resultado |
|---|---|---|
| Lógica (idade, questionário, escores, crescimento) | `bun test tests/logic.test.ts` | 14 passaram |
| Banco / RLS / funções (família, escola, supervisionado, master, publicação, arquivos, convites, medidas) | `bash db-tests/run.sh` | 89 passaram, 0 falhas |
| HTTP/API contra o banco (login, CSRF, acessos por perfil, liberação/retirada, PDF, arquivos privados, auditoria) | `bash scripts/test-http.sh` | 42 passaram |
| Ativação dos dois masters (banco vazio, link de uso único) | idem | 1 passou |
| Layout em navegador (mobile e desktop, sem rolagem lateral) | `python3 tests/layout.py` | 44 verificações, 0 falhas |

## NÃO testado / depende de configuração externa
- Docker/docker-compose (arquivos de exemplo, nunca executados).
- Envio real de e-mail (Resend): sem chave, os links aparecem na tela para o master copiar.
- HTTPS e cookies `Secure` em produção; publicação em hospedagem real.
- Importação de tabelas oficiais de crescimento (OMS/MS): o recurso existe, mas sem importar o CSV oficial só há histórico de medidas, sem curvas ou escores z.
- Supabase (não usado); restauração de backup em ambiente real.
- Revisão jurídica/LGPD e dados profissionais (CRN) — responsabilidade da equipe.
