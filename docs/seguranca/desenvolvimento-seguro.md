# Regra de desenvolvimento: nenhuma funcionalidade contorna o modelo de segurança

Toda nova funcionalidade do Taskly deve responder, **antes de ser implementada**:

1. Que dados ela acessa?
2. Algum é pessoal? Qual a finalidade? Dá para funcionar sem ele?
3. Qual workspace é dono desses dados?
4. Quais papéis podem acessá-los? (atualize `server/lib/rbac.js`, a fonte única de permissões)
5. Qual endpoint está envolvido?
6. Que validação é necessária (tipo, tamanho, formato, valores permitidos, propriedade)?
7. O que deve ir para a auditoria?
8. Por quanto tempo o dado deve existir? (atualize `server/lib/retention.js` e `docs/lgpd/retencao.md`)
9. A resposta pode expor dados demais ao frontend? (use DTO explícito)
10. Envolve terceiro/operador? (atualize `server/lib/privacyCatalog.js` e `docs/lgpd/terceiros-e-transferencias.md`)

## Padrões obrigatórios no backend

- Rotas de recursos: `resource('<coleção>', '<permissão>')` ou `workspaceAccess('<permissão>')`
  (`server/middleware/auth.js`). Nunca use um `workspaceId` vindo do cliente sem autorizá-lo.
- Recursos inacessíveis respondem **404**, não 403 (não revela existência).
- Entrada: helpers `v.*` de `server/lib/http.js`. Uploads: `decodeUpload` (valida extensão,
  tamanho e conteúdo).
- Saída: nunca retornar o objeto do banco inteiro de usuário; use `publicUser` ou um DTO.
- Segredos: `seal/unseal` (`server/lib/secrets.js`) para o que precisa ser recuperado; hash para o
  resto. Nada de segredo em logs, URLs ou no bundle do frontend.
- Ações sensíveis: `audit(req, {...})`.
- Chamadas a URLs externas: somente via `assertSafeWebhookUrl` + conexão com `safeLookup`.
- Testes: todo endpoint novo ganha um teste de isolamento entre workspaces em
  `server/tests/api.test.js`.

## Frontend

- Autorização no frontend é só conveniência de interface; o backend decide.
- Nunca usar `dangerouslySetInnerHTML` com conteúdo de usuário.
- Nada de scripts/fontes/imagens de terceiros (a CSP bloqueia).
- Nada sensível em `localStorage`.
