# Criativos — Social Media Hub

Módulo do Taskly para planejar, aprovar, agendar e publicar conteúdo no Instagram de cada cliente, integrado a workspaces, projetos, tarefas, notificações, automações, auditoria e busca.

Este documento descreve o que existe no código. As capacidades que dependem da Meta (aprovação do app, permissões) estão marcadas como tal.

## Visão geral

```
Workspace ─► Conta social ─► Campanha ─► Publicação ─► Criativos (mídias)
                                             │
                     aprovação ─► agendamento ─► worker ─► API oficial ─► Instagram
```

| Camada | Arquivos |
|---|---|
| Regras de formato | `server/lib/social/rules.js` |
| Contrato de provedor | `server/lib/social/provider.js` (`SocialPublishingProvider`, `ProviderError`) |
| Instagram (API oficial) | `server/lib/social/instagram.js` (`InstagramProvider`) |
| Contas, tokens e sincronização | `server/lib/social/accounts.js` |
| Ciclo de vida da publicação | `server/lib/social/publications.js` |
| Agendador / worker | `server/lib/social/scheduler.js` |
| URLs públicas assinadas | `server/lib/social/mediaUrl.js` |
| Inspeção de mídia (bytes) | `server/lib/media.js` |
| Rotas | `server/routes/social.js`, `creatives.js`, `campaigns.js`, `publications.js` |
| Frontend | `src/components/creatives/*` |

## Banco de dados

Migration: `migrations/0003_creatives.sql` (D1). No Node, as mesmas coleções ficam no arquivo JSON, no esquema v4.

| Entidade (especificação) | Coleção / tabela | Observação |
|---|---|---|
| SocialAccount | `socialAccounts` / `social_accounts` | status, capabilities, metadados retornados pela API |
| SocialIntegration (credencial) | `socialCredentials` / `social_credentials` | token OAuth cifrado (AES-256-GCM); nunca enviado ao navegador |
| Mídia já publicada | `socialMedia` / `social_media` | últimos 30 posts sincronizados, com prévia armazenada no Taskly |
| Creative + CreativeTag | `creatives` / `creatives` | tags no próprio registro |
| Campaign | `campaigns` / `campaigns` | |
| Publication + PublicationMedia + PublicationSchedule | `publications` / `publications` | mídias ordenadas, `scheduledAt` e o estado do worker (`publishing`) no registro |
| PublicationApproval | `publicationApprovals` / `publication_approvals` | histórico completo (pedido, aprovação, rejeição com motivo, retirada, reset) |
| PublicationAttempt | `publicationAttempts` / `publication_attempts` | uma linha por tentativa, com chave de idempotência única |
| SocialCapability | `socialAccounts.capabilities` | derivada das permissões concedidas |
| CreativeAuditEvent | `auditLogs` (existente) | categoria `creatives`, sem duplicar entidade |

Os índices cobrem `workspaceId`, `socialAccountId`, `campaignId`, `projectId`, `taskId`, `status`, `scheduledAt` e `createdAt`. Há também três índices únicos:

- uma conexão ativa por conta de rede em cada workspace;
- uma credencial por conta;
- uma chave de idempotência por tentativa.

No Worker, as tabelas são lidas em blocos de 5 por consulta, porque o D1 limita `UNION` a 5 termos. Com isso, uma carga completa custa cerca de 9 consultas.

## Estados

**Publicação:**

```
DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED
```

- **Rejeitar:** volta para `DRAFT`, com motivo obrigatório.
- **Falha:** `PUBLISHING → FAILED → retry → SCHEDULED`.
- **Cancelar:** de `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SCHEDULED` ou `FAILED` para `CANCELLED`; dali é possível reabrir como `DRAFT`.
- **Regra fixa:** `PUBLISHED` só é gravado depois de a API confirmar.

**Conta:** `CONNECTED`, `REAUTH_REQUIRED`, `EXPIRED`, `DISCONNECTED`, `ERROR`.

**Regras de edição:**

- Conteúdo publicado nunca muda.
- Alterar o conteúdo de algo aprovado ou agendado remove a aprovação, depois de confirmação.
- Reagendar algo já agendado exige confirmação e a permissão `creatives.publish`.
- Com a regra "Exigir aprovação" ativa (padrão), só conteúdo aprovado pode ser agendado.

## Agendamento e worker (backend)

O agendador roda a cada minuto, independentemente de navegador aberto:

- na Cloudflare, pelo Cron Trigger `* * * * *`;
- no Node, por um timer.

A cada execução, ele:

1. Reivindica, numa transação, até 5 publicações vencidas. Cada uma passa para `PUBLISHING` com um *lease* de 4 minutos.
2. Fala com a API fora da transação:
   - `POST /<IG_ID>/media` cria o container (os filhos primeiro, no caso de carrossel);
   - `GET /<container>?fields=status_code` consulta o processamento;
   - `POST /<IG_ID>/media_publish` publica.
3. Grava cada passo numa transação curta que confere o *lease*.

**Idempotência.** O container da Meta funciona como chave de idempotência:

- ele é gravado antes da publicação;
- `publishRequestedAt` é gravado antes de chamar `media_publish`;
- se a resposta se perder (timeout, 5xx, queda do servidor), a execução seguinte consulta o status do container em vez de publicar de novo:
  - `PUBLISHED`: marca como publicado e procura o ID do post;
  - `FINISHED`: publica, porque um container só pode ser publicado uma vez.

**Retry controlado:**

- Erros temporários e de limite geram até 3 novas tentativas automáticas (2, 4 e 8 minutos; 30 minutos em caso de limite).
- Mídia inválida, permissão ausente e autorização expirada falham na hora, com a próxima ação indicada:
  - Reconectar;
  - Editar;
  - Verificar permissões;
  - Aguardar.

**Verificações:**

- O limite de 100 publicações em 24 horas é consultado antes de criar o container (`content_publishing_limit`).
- Containers de vídeo são reconsultados a cada minuto, até cerca de 10 vezes, seguindo a recomendação da Meta.

**Lembretes.** O agendador avisa o responsável quando falta 1 hora para a publicação. Diariamente às 03:00 UTC, ele renova tokens que vencem em até 15 dias e sincroniza perfil e posts recentes.

## Integração com a Meta

- **Login.** Usa o *Instagram API with Instagram Login* (OAuth oficial). O Taskly nunca vê a senha do Instagram.
- **Tokens.** O token de curta duração é trocado por um de longa duração (60 dias), renovado automaticamente.
- **Permissões necessárias:** `instagram_business_basic` e `instagram_business_content_publish`.
- **Mídia por URL pública.** A Meta baixa as mídias por URL. O Taskly gera links assinados (HMAC) que expiram em 2 horas e apontam para um único arquivo (`/api/social/media/<token>`); o armazenamento continua privado.

**Formatos implementados e validados conforme a documentação da Meta (v25.0):**

| Formato | Regras |
|---|---|
| Post | JPEG, até 8 MB, proporção 4:5 a 1,91:1 |
| Carrossel | 2 a 10 itens, imagem ou vídeo |
| Reel | MP4/MOV, 3 s a 15 min, capa JPEG opcional, opção "mostrar no feed" |
| Story | JPEG, ou vídeo de até 60 s |

Em todos os formatos: legenda de até 2.200 caracteres, 30 hashtags e 20 menções.

Para trocar ou adicionar uma rede social, basta implementar `SocialPublishingProvider` e registrá-lo. Rotas, agendador e interface não mudam.

Webhooks da Meta não são usados: a publicação é confirmada consultando a API.

## Configuração externa necessária

| O quê | Onde |
|---|---|
| App do tipo **Business** no Meta for Developers, produto *Instagram API with Instagram Login* | developers.facebook.com |
| URI de redirecionamento: `https://taskly.layla-figueiredo.workers.dev/api/social/instagram/callback` | Configurações do app na Meta |
| `INSTAGRAM_APP_ID` | `wrangler secret put INSTAGRAM_APP_ID` (ou `vars`) |
| `INSTAGRAM_APP_SECRET` | `wrangler secret put INSTAGRAM_APP_SECRET` |
| App Review + Advanced Access para as duas permissões (necessário para contas fora da equipe do app) | Meta |
| R2 habilitado + bucket `taskly-files` + bloco `r2_buckets` no `wrangler.jsonc` (uploads, prévias e avatares) | Painel da Cloudflare |
| Migration `0003_creatives.sql` aplicada no D1 remoto | `npm run d1:migrate:remote` |

Sem as credenciais da Meta, o módulo funciona para planejamento (biblioteca, campanhas, rascunhos, aprovações, calendário). A interface mostra "Instagram não conectado" e explica o que falta. Nada é simulado.

## Permissões (RBAC)

| Permissão | Owner | Manager | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| `creatives.view` | ✓ | ✓ | ✓ | ✓ |
| `creatives.create` / `creatives.edit` | ✓ | ✓ | ✓ | |
| `creatives.delete` | ✓ | ✓ | | |
| `creatives.approve` | ✓ | ✓ | | |
| `creatives.publish` | ✓ | ✓ | | |
| `creatives.manage_accounts` | ✓ | ✓ | | |
| `creatives.manage_campaigns` | ✓ | ✓ | | |
| `creatives.manage_integrations` | ✓ | ✓ | | |

Membros podem excluir os próprios rascunhos e criativos que não estejam em uso. Toda autorização acontece no servidor. Recursos de outro workspace respondem 404 (anti-IDOR/BOLA), e o corpo das requisições passa por uma lista de campos permitidos, o que impede mass assignment.

## API

| Método e rota | Uso |
|---|---|
| `GET /api/social/workspace/:ws/accounts` | Contas e status das integrações |
| `POST /api/social/workspace/:ws/accounts/connect` | Inicia o OAuth |
| `GET /api/social/:provider/callback` | Retorno do OAuth |
| `POST /api/social/accounts/:id/sync` | Sincroniza perfil e posts |
| `DELETE /api/social/accounts/:id` | Desconecta (apaga o token) |
| `GET /api/social/accounts/:id/avatar` | Avatar |
| `GET /api/social/accounts/:id/media` | Posts já publicados |
| `GET /api/social/media-preview/:id` | Prévia de um post já publicado |
| `GET /api/social/media/:token` | URL assinada usada pela Meta |
| `GET /api/creatives/meta` | Regras e limites para o editor |
| `GET`/`PATCH /api/creatives/workspace/:ws/settings` | Regras do workspace |
| `GET /api/creatives/workspace/:ws` | Lista da biblioteca |
| `POST /api/creatives/workspace/:ws/upload` | Upload binário |
| `POST /api/creatives/:id/thumbnail` | Miniatura |
| `GET /api/creatives/:id` · `/file` · `/thumb` | Detalhe e arquivos (com Range) |
| `PATCH` / `DELETE /api/creatives/:id` · `POST /api/creatives/:id/duplicate` | Editar, excluir, duplicar |
| `GET`/`POST /api/campaigns/workspace/:ws` · `PATCH`/`DELETE /api/campaigns/:id` · `POST /api/campaigns/:id/duplicate` | Campanhas |
| `GET`/`POST /api/publications/workspace/:ws` | Listar (filtros e ordenação) e criar |
| `GET /api/publications/workspace/:ws/overview` | Painel |
| `GET /api/publications/workspace/:ws/feed` · `PUT …/feed-order` · `POST …/feed-apply-dates` | Feed Planner |
| `POST /api/publications/workspace/:ws/bulk` | Ações em lote |
| `GET`/`PATCH`/`DELETE /api/publications/:id` · `GET …/history` · `GET …/attempts` | Detalhe, edição, histórico |
| `POST /api/publications/:id/{submit,withdraw,approve,reject,schedule,unschedule,publish,cancel,reopen,retry,duplicate}` | Transições |
| `GET /api/publications/by-task/:taskId` | Publicações de uma tarefa |

## Integrações internas

- **Notificações.** Nova categoria "Criativos" (com preferência própria) e link direto para a publicação. São notificados:
  - pedido de aprovação, aprovação e rejeição;
  - publicação a menos de 1 hora;
  - publicação feita;
  - falha;
  - conta desconectada ou token expirado.
- **Automações.** Gatilhos:
  - `publication.created`;
  - `publication.approved`, `publication.rejected`;
  - `publication.scheduled`, `publication.publishing`;
  - `publication.published`, `publication.failed`.

  Ações:
  - notificar;
  - criar tarefa (e vinculá-la à publicação);
  - mover a tarefa vinculada;
  - comentar na tarefa vinculada;
  - enviar para aprovação;
  - alterar status da campanha.

  Regras de publicação rodam só no primeiro nível do evento, o que impede loops.
- **Auditoria.**
  - Contas: conexão iniciada, conectada, desconectada.
  - Criativos: criado, alterado, duplicado, excluído.
  - Campanhas: criada, alterada, duplicada, excluída.
  - Publicações: todas as transições.

  Nada disso registra tokens.
- **Busca global (Ctrl/Cmd+K):** contas, campanhas, publicações e criativos, só nos workspaces em que a pessoa tem `creatives.view`.
- **Tarefas e projetos:** a publicação pode ser ligada a projeto, tarefa e campanha. O detalhe da tarefa lista as publicações vinculadas.
- **LGPD:**
  - A exportação de dados inclui criativos, publicações, aprovações e contas conectadas pelo titular.
  - A exclusão de conta pseudonimiza a autoria.
  - Excluir um workspace apaga tudo, inclusive os arquivos.
  - Ao desconectar uma conta, o token e os posts sincronizados são apagados na hora.
  - As tentativas de publicação são retidas por 365 dias.
  - O catálogo de privacidade lista a Meta como terceiro quando a integração está ativa.

  Essas medidas técnicas, sozinhas, não garantem conformidade legal.

## Testes

- `npm run test:creatives`: 28 testes contra um servidor que reproduz o contrato da API da Meta. Ele baixa de verdade as URLs assinadas e cobre:
  - OAuth, isolamento, RBAC, uploads inválidos;
  - aprovação e rejeição;
  - agendamento, publicação, idempotência com resposta perdida, carrossel;
  - token expirado e reconexão;
  - Feed Planner, campanhas, lote, automações, busca;
  - cancelamento, desconexão e auditoria.
- `npm run test:worker`: inclui os casos do Criativos no workerd com D1.

## Limitações conhecidas

- **Tamanho de upload.** Vídeos de até 50 MB, porque o Worker mantém o corpo da requisição em memória. Reels de até 300 MB, como a Meta aceita, exigiriam upload direto ao R2 (URL pré-assinada S3).
- **Conversão de imagem.** É feita no navegador (PNG/WebP → JPEG, opcional).
- **Miniaturas.** Geradas no navegador; não há redimensionamento no servidor.
- **Localização.** O ID da localização é o ID numérico de uma página do Facebook. Não há busca de locais pela API do Instagram Login.
- **Arrastar e soltar.** Usa HTML5 nativo, que não funciona no toque. No celular, as datas são alteradas pelo editor.
- **Métricas.** Só os números devolvidos pela API (seguidores, total de posts). Nenhuma métrica é estimada.

## Production readiness

Go-live realizado em 06/10/2026. Commit `c015c81`, versão do Worker `226a9b7f`, migration `0003_creatives.sql` aplicada no D1 `taskly` (`6e305d31-b5ec-41f3-af6a-afe9083d2d46`).

### IMPLEMENTADO (no ar)

- **Módulo:**
  - hub, Feed Planner, calendário (mês/semana/dia), publicações;
  - aprovações, rascunhos, publicados, campanhas e biblioteca;
  - editor com prévia.
- **Testes:**
  - 60/60 no Node (32 gerais + 28 do Criativos, contra um servidor que imita a API da Meta);
  - 19/19 no Worker com D1.
- **Agendador:** Cron Trigger `* * * * *` ativo. Execuções verificadas em produção: CPU de 1 a 9 ms por execução e nenhuma exceção.
- **Permissões e isolamento:** RBAC `creatives.*`. Isolamento entre workspaces verificado em produção: IDs de outro workspace respondem 404 em todas as rotas do módulo.
- **Trilhas:** aprovação com motivo obrigatório; auditoria, notificações, automações e busca global.
- **Integração:** com tarefas e projetos.

### PENDENTE DE CONFIGURAÇÃO EXTERNA

Até isso ser feito, **a publicação no Instagram não está em produção**. O planejamento (campanhas, aprovações, calendário) funciona; a interface mostra "Instagram não conectado" e não simula nenhuma conexão.

| Item | Situação em 06/10/2026 |
|---|---|
| App da Meta (tipo Business, produto *Instagram API with Instagram Login*) | não criado / não informado |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | ausentes (o único segredo em produção é `TASKLY_ENCRYPTION_KEY`) |
| URI de redirecionamento a cadastrar na Meta | `https://taskly.layla-figueiredo.workers.dev/api/social/instagram/callback` |
| App Review / Advanced Access | necessário para contas fora da equipe do app |
| Cloudflare R2 | não habilitado na conta (API: código 10042). Uploads respondem 503 `STORAGE_NOT_CONFIGURED`. Depois de habilitar: `npx wrangler r2 bucket create taskly-files`, descomentar `r2_buckets` no `wrangler.jsonc` e fazer push |

Enquanto não houver uma conta conectada, não é possível criar publicações (toda publicação pertence a uma conta). Também não há criativos enquanto o R2 não existir.

### Operação

- **Restauração:** o ponto do Time Travel anterior à migration 0003 é o bookmark `0000008a-00000000-000050fc-4da268865364f63ae045d791f0c71778`, de 2026-10-06T14:53:45Z. Para restaurar: `npx wrangler d1 time-travel restore taskly --bookmark=<bookmark>`.
- **Propagação do Cron:** mudanças no Cron levam alguns minutos para valer. A primeira execução por minuto foi observada cerca de 5 minutos após o deploy.
- **Ordem do deploy:** migrations novas devem ser aplicadas (`npm run d1:migrate:remote`) **antes** do push. O comando de deploy do painel continua `npx wrangler deploy`.
