# Minha Terapia Alimentar

Aplicação web (português do Brasil, datas DD/MM/AAAA, kg/cm, America/Sao_Paulo) para prontuário e acompanhamento alimentar, com acesso **somente por convite**. Perfis: Master Alana, Master CoReS, supervisionados, escolas e famílias.

## Tecnologia (e por que não Next.js/Supabase)
Bun + TypeScript (servidor com HTML renderizado no servidor), PostgreSQL 16 com **segurança por linha (RLS)**, autenticação própria (senha argon2id, sessões e tokens de uso único no banco) e arquivos privados em disco. O ambiente de desenvolvimento não tinha acesso ao npm, então Next.js/Tailwind/Supabase não puderam ser instalados nem testados; escolhi o que pôde ser **executado e testado de verdade**. Todos os requisitos de segurança foram mantidos: o controle está no banco (RLS, gatilhos, funções) e no servidor.

## Estrutura
`db/migrations` (0000 base de identidade, 0001 tabelas, 0002 funções/gatilhos/auditoria, 0003 políticas RLS, 0004 armazenamento) · `db/demo` (dados fictícios) · `src/server` (aplicação) · `src/lib` (questionário, escores, crescimento) · `scripts` (migrar, ativar masters, demo) · `tests` e `db-tests` · `docs`.

## Publicação (passo a passo)
1. **Hospedagem**: qualquer serviço que rode Bun/Docker + PostgreSQL + volume persistente (Railway, Render, Fly.io, VPS). O `Dockerfile` e o `docker-compose.yml` são exemplos (não testados aqui). Não use um projeto Supabase existente (conflita com o esquema `auth`); use um PostgreSQL comum.
2. **Banco**: crie o banco `mta` e um usuário `mta_app` (login, sem superusuário). Como administrador, rode uma vez: `GRANT authenticated, service_role TO mta_app;` depois de aplicar as migrações (que criam esses papéis).
3. **Variáveis**: copie `.env.example` para `.env` e preencha (`APP_URL`, `DATABASE_URL`, `DATA_DIR`...). Nunca coloque segredos no código.
4. **Migrar**: `bun install && bun run migrate`. (A primeira execução deve usar um usuário com permissão para criar papéis/esquemas.)
5. **Iniciar**: `bun run start` (atrás de HTTPS).
6. **Ativar os masters** (seus e-mails ficam só no seu comando): `bun run master:ativar -- --alana SEU_EMAIL --cores EMAIL_COORDENACAO`. O comando imprime dois **links de uso único (72 h)**; cada pessoa abre o seu e **cria a própria senha**. Nenhuma senha é criada ou exibida.
7. Entre em `/` com o e-mail e a senha criada → abre o **PAINEL MASTER**.

## Uso rápido
- **Cadastrar a primeira criança**: PAINEL MASTER › Pacientes › Novo paciente.
- **Convidar supervisionado, escola ou família**: Usuários e acessos › escolha o tipo, informe nome/e-mail e marque as crianças. Sem e-mail configurado, o link aparece na tela para você copiar e enviar; com Resend configurado, vai por e-mail. Dá para reenviar, cancelar, desativar acesso, alterar vínculos e iniciar recuperação de senha.
- **Liberar para a família**: paciente › Documentos e compartilhamentos › "Pré-visualizar e liberar" → confira o conteúdo exato → Confirmar. Para retirar: "Retirar liberação" (efeito imediato). Alterações posteriores só aparecem após nova liberação (versão nova).
- **Relatórios**: Relatórios e compartilhamentos › escolha paciente, tipo e período › marque registros › prévia › PDF (salvo no prontuário).

## Demonstração (dados fictícios)
`bun run demo:seed` cria 7 usuários `@demo.invalid` com **senhas aleatórias** (impressas e salvas em `data/demo-credentials.txt`), 5 pacientes e registros privados/liberados. Remova antes de usar dados reais: `bun run demo:remover`. Os masters demo e os reais não coexistem (existe só um Master Alana e um Master CoReS).

## Testes
`bun run test` executa: lógica (14), políticas do banco (89), HTTP/ativação (43) e, separadamente, `python3 tests/layout.py` (navegador, 44 verificações; requer servidor rodando e Playwright). Resultados: docs/TESTES.md.

## O que funciona × o que depende de configuração externa
Veja a lista em docs/TESTES.md (seção final) e docs/CHECKLIST-DADOS-REAIS.md.
