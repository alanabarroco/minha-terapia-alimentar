# Antes de colocar dados reais

Este sistema aplica acesso mínimo, RLS no banco, arquivos privados e auditoria, mas **isso não garante conformidade legal** (LGPD, normas do conselho profissional). Itens operacionais:

- [ ] Publicar com **HTTPS** (a cookie de sessão é `Secure` em produção). Nunca usar HTTP.
- [ ] Banco com usuário **não superusuário** (`mta_app`) e senha forte; acesso ao banco restrito por rede.
- [ ] Backup do banco **e** da pasta de arquivos configurados e **restauração testada** (docs/BACKUP-RESTAURACAO.md).
- [ ] Remover os dados fictícios: `bun run demo:remover` (remove também os masters de demonstração).
- [ ] Ativar os masters reais: `bun run master:ativar -- --alana EMAIL --cores EMAIL`.
- [ ] Configurar envio de e-mail (RESEND_API_KEY/MAIL_FROM) ou combinar o canal seguro para enviar links.
- [ ] Preencher CRN/título em "Minha conta" e nome do serviço em Configurações (nada é inventado pelo sistema).
- [ ] Obter e importar tabelas **oficiais** de crescimento (OMS/MS) em Configurações — sem isso, só há histórico de medidas.
- [ ] Revisar com a assessoria jurídica: base legal, termo de consentimento/ciência de famílias e escolas, política de retenção e de resposta a incidentes, contrato com a hospedagem (operador).
- [ ] Definir quem pode ser supervisionado e quem pode liberar conteúdo (autorização por master).
- [ ] Manter dependências e o servidor atualizados.
