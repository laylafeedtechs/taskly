# Taskly

Gerenciamento de projetos e tarefas com Kanban, calendário, timeline, relatórios, automações e controle de acesso por workspace.

- **Frontend:** React 19 + Vite + Tailwind (`src/`)
- **Backend:** Node.js + Express 5 (`server/`)
- **Banco:** Cloudflare D1 em produção; arquivo JSON transacional em `data/taskly_db.json` no Node (desenvolvimento / auto-hospedagem)
- **Produção:** Cloudflare Workers — frontend em Static Assets, API Express no Worker, D1, R2 e Cron. Veja [docs/cloudflare.md](docs/cloudflare.md).

## Rodando localmente

```bash
npm install
npm run dev:all        # API em :5000 e frontend em http://localhost:3000
```

Conta de demonstração (apenas no seed de desenvolvimento): `lucas@taskly.io` / `taskly123` (Super Admin).
Outras contas do seed usam a mesma senha: `ana.rodrigues@`, `mateus.silva@`, `carla.m@` (e `gabriel.costa@`, bloqueada).

### Produção (porta única)

```bash
npm run build
NODE_ENV=production APP_URL=https://seu-dominio npm start   # serve API + frontend compilado
```

### Cloudflare Workers (produção)

```bash
npm run dev:worker   # build + D1 local + wrangler dev em http://localhost:8787
npm run deploy       # migrations remotas + wrangler deploy
```

Primeira configuração (D1, segredos, R2, importação de dados): [docs/cloudflare.md](docs/cloudflare.md).

### Testes

```bash
npm test             # testes de integração da API no Node (banco temporário)
npm run test:worker  # os mesmos fluxos dentro do workerd com D1 local
```

## Criativos (Instagram)

Planejamento de feed, calendário editorial, biblioteca de criativos, campanhas, aprovações e publicação agendada pela API oficial da Meta. Arquitetura, configuração externa e limitações: [docs/criativos.md](docs/criativos.md).

## Configuração

Copie `.env.example` para `.env`. Tudo é opcional em desenvolvimento.

| Recurso | Variáveis | Sem configuração |
| --- | --- | --- |
| Login com Google (OAuth 2.0 / OIDC, PKCE) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — redirect URI `APP_URL/api/auth/google/callback` | Botão desabilitado com aviso |
| E-mail (convites, redefinição de senha, notificações) | Node: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` · Worker: `RESEND_API_KEY`, `MAIL_FROM` | E-mails gravados em `data/outbox/`; links de convite exibidos na interface |
| URLs públicas, CORS | `APP_URL`, `CORS_ORIGINS` | `http://localhost:3000` |

## Administração pelo console

```bash
npm run admin:grant -- pessoa@empresa.com    # conceder Super Admin (servidor parado)
npm run admin:grant -- pessoa@empresa.com --remote   # no D1 de produção
npm run admin:revoke -- pessoa@empresa.com   # remover Super Admin
npm run backup:restore                       # listar backups cifrados
npm run backup:restore -- <arquivo>          # restaurar (servidor parado)
```

O Admin Center exige que o Super Admin tenha MFA ativo e tenha entrado com o segundo fator.

## Privacidade e LGPD

Documentação em [`docs/lgpd/`](docs/lgpd/README.md) e relatório técnico em
[`docs/seguranca/relatorio-auditoria.md`](docs/seguranca/relatorio-auditoria.md).
Os controles técnicos apoiam a adequação, mas não substituem a revisão jurídica.

## Segurança (resumo)

- Sessões em cookie `HttpOnly` + `SameSite=Lax` (`Secure` em produção), armazenadas com hash, com expiração absoluta e por inatividade.
- Proteção CSRF por cabeçalho obrigatório (`X-Requested-With: taskly`) + CORS com lista de origens.
- RBAC no servidor (`server/lib/rbac.js`): Owner, Manager, Member, Viewer. Todo recurso é carregado pelo ID e validado contra o workspace do usuário; recursos inacessíveis retornam 404 (anti-IDOR/BOLA).
- Troca de conta decidida exclusivamente pelo backend (`/api/auth/switchable-accounts`); Super Admins podem assumir contas para suporte, com auditoria e sessão limitada a 2 h.
- Chaves de API armazenadas apenas como hash SHA-256, com escopos, rotação e revogação.
- Webhooks assinados com HMAC-SHA256 (`X-Taskly-Signature`), novas tentativas com backoff e proteção contra SSRF.
- Uploads validados por extensão, tamanho e conteúdo (magic bytes); servidos com `nosniff` e CSP `sandbox`.
- Rate limiting (login, cadastro, convites, API geral), limite de tamanho de requisição e erros sem stack trace.
- Logs de auditoria, eventos de sistema e erros do frontend visíveis no Admin Center (dados sensíveis são mascarados).

## Estrutura

```
server/
  index.js            app Express, headers de segurança, agendadores
  db.js               banco JSON, migrações e transações
  middleware/auth.js  sessões, API keys, CSRF, rate limit, autorização por recurso
  lib/                rbac, eventos (atividade, notificações, automações, webhooks), saúde, exportadores, storage
  routes/             endpoints REST
  tests/              testes de integração
src/
  context/AppContext.jsx   estado global, roteamento por URL, mutações com rollback/desfazer
  services/api.js          cliente HTTP
  components/ui            design system
  components/views         telas
```
