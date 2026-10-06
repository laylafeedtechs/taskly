# Taskly na Cloudflare (Workers + D1)

O Taskly roda em produção como **um único Worker**:

| Parte | Onde roda |
|---|---|
| Frontend (Vite → `dist/`) | Cloudflare Static Assets (SPA, cabeçalhos em `public/_headers`) |
| API `/api/*` | O mesmo app Express de `server/app.js`, dentro do Worker via `httpServerHandler` (`cloudflare:node`) |
| Banco | Cloudflare D1 (`DB`) |
| Arquivos enviados e avatares | Cloudflare R2 (`FILES`, opcional) |
| Tarefas periódicas | Cron Trigger (`* * * * *`): agendador de publicações a cada minuto; manutenção na hora cheia |
| E-mail | API HTTP do Resend (`RESEND_API_KEY`) |

O servidor Node (`npm start`) continua funcionando para desenvolvimento e auto-hospedagem: as rotas, a autenticação, o MFA, o CSRF e o rate limiting são o **mesmo código** nos dois ambientes.

## Por que havia HTTP 405 no login

O projeto não tinha `wrangler.json(c)`. Assim, `npx wrangler deploy` publicava **só os arquivos estáticos** de `dist/`, sem nenhum backend:

- `GET /api/health` devolvia o `index.html` da SPA (Content-Type `text/html`);
- `POST /api/auth/login` chegava ao servidor de arquivos estáticos, que só aceita GET/HEAD. Por isso respondia **405 Method Not Allowed**, com corpo vazio.

Agora o `wrangler.jsonc` define `main: worker/index.js` e `assets.run_worker_first: ["/api/*"]`. Toda requisição `/api/*`, de qualquer método, passa primeiro pelo Worker, que a entrega ao Express. Os demais caminhos continuam sendo arquivos estáticos ou a SPA.

## Como o Worker recebe as requisições

```
requisição ─► Cloudflare
              ├─ /api/*  ─► worker/index.js ─► httpServerHandler ─► Express (server/app.js)
              │                                   └─ d1Middleware: carrega o D1 → rota → grava no D1 → resposta
              └─ demais  ─► Static Assets (dist/) ─► arquivo ou index.html (SPA)
Cron (de hora em hora) ─► scheduled() ─► server/jobs.js (sessões expiradas, prazos; retenção às 03:00 UTC)
```

## Persistência no D1

Cada coleção do antigo `taskly_db.json` virou uma tabela `(id TEXT PRIMARY KEY, pos REAL, data TEXT JSON)`. O registro inteiro fica em `data`, validado por `CHECK (json_valid(data))`, e `pos` preserva a ordem. Objetos únicos (`meta`, `systemSettings`) e o contador `version` ficam em `app_state`.

| Coleção (código) | Tabela D1 |
|---|---|
| users | users |
| workspaces | workspaces |
| projects | projects |
| columns | task_columns |
| tasks | tasks |
| milestones | milestones |
| projectTemplates | project_templates |
| automations | automations |
| automationLogs | automation_logs |
| notifications | notifications |
| auditLogs | audit_logs |
| apiKeys | api_keys |
| webhooks | webhooks |
| webhookDeliveries | webhook_deliveries |
| featureFlags | feature_flags |
| savedReports | saved_reports |
| files | files |
| invitations | invitations |
| sessions | sessions |
| passwordResets | password_resets |
| activity | activity |
| systemEvents | system_events |
| securityIncidents | security_incidents |
| privacyRequests | privacy_requests |
| mfaChallenges | mfa_challenges |
| emailVerifications | email_verifications |
| oauthStates | oauth_states |
| socialAccounts | social_accounts |
| socialCredentials | social_credentials |
| socialMedia | social_media |
| creatives | creatives |
| campaigns | campaigns |
| publications | publications |
| publicationApprovals | publication_approvals |
| publicationAttempts | publication_attempts |

Criativos (Instagram): veja [criativos.md](criativos.md).

Índices (`migrations/0002_indexes.sql`) cobrem os campos de busca e de relacionamento. Os índices **únicos** garantem no próprio banco que não haja e-mail duplicado, conta Google duplicada, token de sessão duplicado, hash de API key duplicado, token de convite duplicado nem chave de feature flag duplicada.

### Ciclo de uma requisição (`server/lib/d1store.js`)

1. A requisição entra na fila do isolate, para que requisições simultâneas no mesmo isolate não leiam o mesmo snapshot.
2. O store lê `version` (1 query). Se for a mesma do cache do isolate, os dados vêm da memória; se não, vêm do D1 em um `batch()` de cerca de 8 queries (tabelas agrupadas de 5 em 5, o máximo de termos de `UNION` aceito pelo D1).
3. A rota roda normalmente, com uma cópia privada dos dados (AsyncLocalStorage).
4. Antes de liberar a resposta, só as linhas inseridas, alteradas ou removidas são gravadas em **um `batch()`**, que o D1 executa como transação. A primeira instrução é uma trava de versão: se outro isolate gravou nesse meio-tempo, a transação inteira é desfeita e a API responde **409 `DB_CONFLICT`**.
5. O frontend (`src/services/api.js`) repete automaticamente, até 3 vezes, as requisições que receberam `DB_CONFLICT`. Isso é seguro porque a tentativa anterior não gravou nada.

Uma resposta 2xx significa, portanto, que os dados **já estão gravados**. Se a gravação falhar, a resposta vira 500 `DB_WRITE_FAILED` e nenhum cookie de sessão é entregue.

## Migrations

| Arquivo | Conteúdo |
|---|---|
| `migrations/0001_initial.sql` | `app_state` e as 27 tabelas |
| `migrations/0002_indexes.sql` | índices de busca, relacionamento e unicidade |
| `migrations/0003_creatives.sql` | Criativos: contas sociais, credenciais, biblioteca, campanhas, publicações, aprovações e tentativas |

```bash
npm run d1:migrate:local    # banco do wrangler dev
npm run d1:migrate:remote   # banco de produção
```

## Primeira configuração (uma única vez)

```bash
npx wrangler login
npx wrangler d1 create taskly
```

Copie o `database_id` impresso para `wrangler.jsonc`, no lugar de `REPLACE_WITH_D1_DATABASE_ID`. O ID não é um segredo. Depois:

```bash
npx wrangler d1 migrations apply taskly --remote

# chave de criptografia (MFA, segredos de webhook) — nunca vai para o Git
npx wrangler secret put TASKLY_ENCRYPTION_KEY
```

### Opcionais

- **Login com Google**:
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_ID
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  ```
  Redirect URI autorizada: `https://taskly.layla-figueiredo.workers.dev/api/auth/google/callback`.
- **E-mail (convites, redefinição de senha, verificação)**:
  ```bash
  npx wrangler secret put RESEND_API_KEY
  ```
  Configure também `MAIL_FROM` em `vars`, com um domínio verificado no Resend.
- **Anexos e avatares (R2)**: ative o R2 no painel, rode o comando abaixo e descomente o bloco `r2_buckets` em `wrangler.jsonc`. Sem R2, os uploads respondem 503 `STORAGE_NOT_CONFIGURED` e o restante funciona normalmente.
  ```bash
  npx wrangler r2 bucket create taskly-files
  ```

### Trazer os dados atuais (`data/taskly_db.json`)

```bash
npm run d1:export                       # gera data/d1-import.sql (fora do Git)
npx wrangler d1 execute taskly --remote --file data/d1-import.sql
```

Depois de importar, apague `data/d1-import.sql`: ele contém dados pessoais e hashes de senha. Use `npm run d1:export -- --replace` para limpar as tabelas antes de importar.

Os segredos de MFA e de webhooks estão cifrados com a chave desta máquina. Para que continuem válidos, o Worker precisa da **mesma** chave. Sem `TASKLY_ENCRYPTION_KEY` no `.env`, ela está em `~/.taskly/encryption.key` e pode ser enviada sem aparecer no terminal:

```bash
npx wrangler secret put TASKLY_ENCRYPTION_KEY < ~/.taskly/encryption.key
```

### Super Admin

O privilégio só é concedido pelo console, nunca pela API:

```bash
npm run admin:grant -- pessoa@empresa.com --remote
```

O comando usa o mesmo código do app: encerra as sessões da pessoa, registra a ação na trilha de auditoria encadeada e invalida o cache dos isolates.

## Deploy

| Configuração na Cloudflare | Valor |
|---|---|
| Build command | `npm run build` (sem mudança) |
| Deploy command | `npm run deploy` (recomendado; antes era `npx wrangler deploy`) |
| Root directory | `/` |
| Branch | `main` |

`npm run deploy` roda `wrangler d1 migrations apply taskly --remote && wrangler deploy`. Assim, migrations novas são aplicadas antes de o código que depende delas entrar no ar. Se preferir manter `npx wrangler deploy`, ele também funciona, mas cada migration nova precisa ser aplicada à mão (`npm run d1:migrate:remote`) antes do push.

## Variáveis e segredos

| Nome | Tipo | Onde |
|---|---|---|
| `NODE_ENV` | variável | `wrangler.jsonc` → `vars` |
| `APP_URL` | variável | `wrangler.jsonc` → `vars` |
| `HOSTING_PROVIDER` | variável | `wrangler.jsonc` → `vars` |
| `MAIL_FROM` | variável (opcional) | `wrangler.jsonc` → `vars` |
| `CORS_ORIGINS` | variável (opcional) | `wrangler.jsonc` → `vars` |
| `TASKLY_ENCRYPTION_KEY` | **segredo** (obrigatório) | `wrangler secret put` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **segredo** (opcional) | `wrangler secret put` |
| `RESEND_API_KEY` | **segredo** (opcional) | `wrangler secret put` |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | **segredo** (Criativos) | `wrangler secret put` |

Para desenvolvimento local, os segredos ficam em `.dev.vars`, que está no `.gitignore`.

## Dependências Node no Worker

| Dependência / recurso | Situação | Tratamento |
|---|---|---|
| express, cors, cookie-parser | compatível | `httpServerHandler` + `nodejs_compat` |
| otpauth, `node:crypto` (AES-GCM, SHA-256, HMAC) | compatível | sem mudança |
| qrcode | adaptado | no Worker, gera SVG (a versão de navegador exige canvas) |
| bcryptjs | adaptado | só verifica hashes antigos; senhas novas usam PBKDF2-SHA256 (WebCrypto), e o login re-hasheia automaticamente |
| `fs` (banco JSON) | incompatível → substituído | D1 |
| `fs` (uploads) | incompatível → substituído | R2 |
| nodemailer (SMTP/TCP) | incompatível → substituído | API HTTP do Resend; nodemailer continua no Node |
| `http.request` com DNS próprio (webhooks) | incompatível → substituído | `fetch` com bloqueio de hosts e IPs privados |
| `setInterval` / `setTimeout` longos | incompatível → substituído | Cron Trigger + `waitUntil` |
| backups em arquivo | incompatível → substituído | D1 Time Travel (restauração a qualquer minuto dos últimos 7 dias no Free, 30 no Paid) |
| arquivo de chave em disco | incompatível → substituído | segredo `TASKLY_ENCRYPTION_KEY` |

## Limitações conhecidas

- **CPU no plano Workers Free (10 ms/requisição).** A primeira verificação de um hash bcrypt migrado pode passar desse limite. Depois do primeiro login, a senha fica em PBKDF2. No plano Paid não há problema. No Free, quem não conseguir entrar pode usar "Esqueci a senha" (exige e-mail configurado).
- **PBKDF2 com 100.000 iterações.** É o máximo que o WebCrypto do Workers aceita, abaixo da recomendação atual da OWASP para PBKDF2-SHA256. O bloqueio de conta e o rate limit compensam parte disso.
- **Rate limit por isolate.** Os contadores ficam na memória de cada isolate. Para um limite global, use as regras de Rate Limiting da Cloudflare ou Durable Objects.
- **Conflitos entre isolates.** Escritas simultâneas em isolates diferentes resultam em 409 + nova tentativa automática, nunca em perda silenciosa.
- **Limite de queries.** O plano Free permite 50 queries por invocação. Uma carga completa usa cerca de 30, e cada gravação é um único `batch()`.
- **Webhooks.** As novas tentativas ficam limitadas a cerca de 30 s após a resposta (vida útil do `waitUntil`).
- **Backups.** A tela de backups mostra que a cópia é gerenciada pelo D1 (Time Travel): `npx wrangler d1 time-travel restore taskly --timestamp <ISO>`.

## Testes

```bash
npm test             # API no Node (32 testes)
npm run test:worker  # API dentro do workerd + D1 local (16 testes)
```

Teste rápido de produção (deve responder 401 em JSON, nunca 405):

```bash
curl -i -X POST https://taskly.layla-figueiredo.workers.dev/api/auth/login \
  -H "Content-Type: application/json" -H "X-Requested-With: taskly" \
  -d '{"email":"teste@exemplo.com","password":"senha-invalida"}'
```
