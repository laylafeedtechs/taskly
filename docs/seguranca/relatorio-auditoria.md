# Relatório de auditoria de segurança e privacidade — Taskly

**Data:** 30/09/2026 · **Escopo:** código em `server/` e `src/`, configuração de execução e o ambiente
público de demonstração (Cloudflare Tunnel).

> Este relatório descreve controles técnicos. **Não atesta conformidade com a LGPD** e não afirma
> que o sistema é "100% seguro". Itens jurídicos e organizacionais estão em
> [../lgpd/pendencias-do-controlador.md](../lgpd/pendencias-do-controlador.md).

## 1. Dados pessoais identificados
Nome, e-mail, hash de senha, vínculo Google, segredo MFA, foto (opcional), preferências,
participação e papel em workspaces, conteúdo de trabalho (tarefas, comentários, anexos, menções),
histórico de atividade, sessões (IP, navegador), último acesso, auditoria (IP, navegador),
notificações, solicitações de titulares. Detalhe: [../lgpd/inventario-de-dados.md](../lgpd/inventario-de-dados.md).

## 2. Fluxos de dados
Navegador → HTTPS (Cloudflare) → Express → arquivo JSON local; uploads em `data/uploads/`;
backups cifrados em `~/taskly-backups`; e-mails via SMTP (inativo → `data/outbox/`); OAuth Google
(inativo); webhooks para destinos escolhidos pelos workspaces (payload mínimo).

## 3. Autenticação
Senha com bcrypt (custo 12) · sessão em cookie `HttpOnly`/`Secure`/`SameSite=Lax`, token aleatório
de 256 bits guardado só como hash, expiração absoluta (7 dias) e por inatividade (3 dias) ·
MFA TOTP (biblioteca `otpauth`) com 10 códigos de recuperação de uso único · Google OAuth com
PKCE, `state`, `nonce` e validação de `aud`/`iss`/`exp`/e-mail verificado · verificação de e-mail
no cadastro e na troca · redefinição de senha com token de 1 h e uso único · bloqueio progressivo
por conta (5 falhas) + rate limit por IP · alerta de novo dispositivo · encerramento de todas as
outras sessões.

## 4. Modelo de autorização
RBAC no servidor (`server/lib/rbac.js`, fonte única da matriz): Owner, Manager, Member, Viewer.
Toda rota de recurso carrega o objeto pelo ID e autoriza contra o workspace dono. Super Admin:
flag só alterável pelo console (`npm run admin:grant/revoke`), Admin Center exige sessão com MFA,
toda requisição administrativa (inclusive leitura) é auditada.

## 5. Isolamento entre tenants
Acesso a tenant depende **apenas** de participação no workspace — inclusive para Super Admins.
Suporte só por impersonação com motivo obrigatório, notificação ao titular, 2 h de duração, sem
direitos administrativos e com registro de início e fim. Recursos de outros workspaces respondem
404. Testado em 22 tipos de endpoint.

## 6. Criptografia
TLS no tráfego (Cloudflare; HSTS em produção) · AES-256-GCM (`crypto` do Node) para segredos MFA,
segredos de webhook e backups · chave fora do diretório de dados (`TASKLY_ENCRYPTION_KEY` ou
`~/.taskly/encryption.key`) · bcrypt para senhas, SHA-256 para tokens, chaves de API e códigos de
recuperação. **O banco principal não é cifrado em repouso** (depende de criptografia de disco).

## 7. Segredos
`.env` e `data/` fora do git; nenhum segredo no histórico (verificado); chaves de API e segredos
de webhook exibidos uma única vez; mascaramento automático em logs; CI com gitleaks e verificação
de segredos no bundle do frontend.

## 8. Segurança da API
Validação de entrada (tipo, tamanho, formato, listas permitidas) · DTOs explícitos de usuário ·
limite de 1 MB por requisição (uploads com limite próprio) · rate limit geral por sessão e
específico em login, cadastro, redefinição, verificação, MFA, convites, troca de conta,
exportações, backups e retenção · CSRF por cabeçalho obrigatório + verificação de `Origin` ·
CORS com lista de origens · erros sem stack trace (ID de requisição para correlação) · CSP estrita
(sem scripts, fontes ou imagens de terceiros), `X-Frame-Options: DENY`, COOP, CORP, nosniff.

## 9. Arquivos
Extensão em lista permitida, tamanho máximo (25 MB; avatar 2 MB), validação por conteúdo (magic
bytes), nome aleatório no disco, nome original sanitizado, download apenas autorizado pelo
workspace, `Content-Disposition` seguro e CSP `sandbox` nas pré-visualizações.

## 10. Logs
Logs estruturados sem query string; campos sensíveis mascarados (`[REDACTED]`); eventos de sistema
com retenção de 90 dias; erros do frontend coletados sem dados pessoais.

## 11. Trilha de auditoria
Autenticação e falhas, MFA, papéis e permissões, ações de Super Admin (inclusive leituras),
workspaces, exclusões, exportações, chaves de API, webhooks, impersonação, configurações de
segurança e privacidade. Cada registro: ator (ID + nome), ação, entidade, resultado, data, ID de
sessão e de requisição, IP e navegador. **Encadeada por hash SHA-256** (verificação no Admin
Center). IP truncado e navegador removido após 90 dias.

## 12. Backups
Diários, cifrados, em diretório separado, com teste de restauração automático após cada cópia,
rotação configurável (14), restauração apenas pelo console. **Ainda no mesmo computador** — ver
riscos.

## 13. Retenção e eliminação
Rotina diária configurável ([../lgpd/retencao.md](../lgpd/retencao.md)); lixeira expira em 30 dias;
exclusão de conta pelo titular com desidentificação do conteúdo compartilhado.

## 14. Direitos do titular
Central de Privacidade: resumo dos dados, exportação em JSON (acesso/portabilidade), solicitações
LGPD (11 tipos, prazo de referência de 15 dias), correção via perfil, exclusão de conta. Painel de
atendimento no Admin Center. Política pública em `/privacy` com placeholders para o conteúdo
jurídico.

## 15. Operadores e integrações
Cloudflare (ativo), Google OAuth (inativo), SMTP (inativo), destinos de webhook, GitHub.
Removidos: Google Fonts e avatares Unsplash/Google.

## 16. Transferências internacionais
Cloudflare (tráfego global, inclui EUA) está ativa no ambiente de demonstração **sem contrato**.
Google e o provedor SMTP envolveriam transferência se ativados. Mecanismo jurídico: a definir.

## 17. Resposta a incidentes
Detecção automática (8 regras), registro de incidentes com evidências, avaliação humana
(dados pessoais? risco relevante? comunicação necessária?), prazo de referência de 3 dias úteis,
alerta aos Super Admins. Procedimento: [../lgpd/resposta-a-incidentes.md](../lgpd/resposta-a-incidentes.md).

## 18. Testes executados
- **31 testes de integração automatizados** (`npm test`), todos passando: credenciais forjadas,
  cookie HttpOnly, CSRF (cabeçalho e Origin), conta bloqueada, IDOR/BOLA em 22 endpoints, RBAC,
  MFA obrigatório no Admin Center, login com MFA e códigos de uso único, troca de conta decidida
  pelo servidor, Super Admin sem acesso implícito, privilégio não concedível pela API, SSRF (13
  variações, incluindo IPv6 mapeado e IP decimal), assinatura e minimização de webhooks, cabeçalhos
  de segurança, XSS armazenado, verificação de e-mail, exportação só com dados do titular,
  exclusão de conta, integridade da auditoria, bloqueio por força bruta, uploads maliciosos,
  exportação de relatórios, redefinição de senha, lixeira.
- **Navegador (Chrome headless):** todas as telas em 390, 1024, 1280, 1440, 1920 e 2560 px sem
  erros de console, de rede ou violações de CSP, e **sem nenhuma requisição a terceiros**; fluxo
  completo de ativação de MFA e seções de governança do Admin Center.
- **Automáticos:** `npm audit` (0 vulnerabilidades), busca de segredos no histórico do git, busca
  de `dangerouslySetInnerHTML`/`eval`.

## 19. Vulnerabilidades encontradas
| # | Achado | Severidade |
|---|---|---|
| 1 | Super Admin com acesso implícito a todos os workspaces | HIGH |
| 2 | Privilégio de Super Admin concedível pela API/Admin Center | HIGH |
| 3 | Ausência de MFA; Admin Center protegido só por senha | HIGH |
| 4 | Pré-sequestro de conta via vínculo Google a conta com e-mail não verificado | HIGH |
| 5 | Sem mecanismos de direitos do titular (exportação, exclusão, solicitações) | HIGH |
| 6 | Sem backup; cópias manuais em texto puro ao lado do banco | HIGH |
| 7 | SSRF via endereço IPv6 mapeado em hexadecimal (`[::ffff:7f00:1]`) — **achado pelos testes** | HIGH |
| 8 | Google Fonts e avatares externos vazando IP de todos os usuários a terceiros | MEDIUM |
| 9 | Sem Content-Security-Policy | MEDIUM |
| 10 | Segredos de webhook em texto puro | MEDIUM |
| 11 | Sem política de retenção | MEDIUM |
| 12 | Sem verificação de e-mail | MEDIUM |
| 13 | Sem bloqueio por conta, alerta de dispositivo novo ou registro de incidentes | MEDIUM |
| 14 | SSRF por DNS rebinding em webhooks (checagem ≠ conexão) | MEDIUM |
| 15 | Payload de webhook com a tarefa inteira (comentários, descrição) | MEDIUM |
| 16 | Auditoria sem proteção contra adulteração; e-mail no campo "ator" | MEDIUM |
| 17 | Último acesso dos membros visível a todos os papéis; lista de usuários do admin com campos internos | LOW |
| 18 | Impersonação sem motivo nem aviso ao titular; impersonação encadeada possível | LOW |
| 19 | Sem CI de segurança; exportações e rotas administrativas sem rate limit específico | LOW |
| 20 | Fontes pequenas embutidas como `data:` (seriam bloqueadas pela nova CSP) — **achado pela CSP** | LOW |

## 20. Vulnerabilidades corrigidas
Todas as 20 acima, com teste automatizado correspondente sempre que aplicável.

## 21. Riscos remanescentes
| Risco | Severidade | Recomendação |
|---|---|---|
| Ambiente público roda em um computador pessoal via túnel rápido da Cloudflare, sem contrato, com dados reais de pessoas cadastradas | HIGH | Migrar para hospedagem contratada, com contrato de operador e ambientes separados |
| Banco principal sem criptografia em repouso; chave de criptografia no mesmo computador que os backups | MEDIUM | Ativar BitLocker; `TASKLY_ENCRYPTION_KEY` em gerenciador de segredos; backups em outro disco/serviço |
| Banco em arquivo JSON único (sem controle de acesso por credencial de banco, escala limitada) | MEDIUM | Migrar para PostgreSQL com usuário de privilégio mínimo e conexões cifradas |
| Cópias em texto puro criadas antes desta revisão em `data/taskly_db.backup-*.json` | MEDIUM | Apagar após confirmar que o backup cifrado funciona |
| Rate limit e bloqueios em memória (reiniciar o servidor zera contadores) | LOW | Armazenamento compartilhado (ex.: Redis) ao escalar |
| MFA não é obrigatório para Owners de workspace (apenas recomendado) | LOW | Avaliar exigir para workspaces com dados sensíveis |
| E-mail de cadastro já existente retorna mensagem distinta (enumeração limitada por rate limit) | LOW | Aceito por usabilidade |
| Conteúdo jurídico (bases legais, controlador, DPO, termos) ausente | — | Ver pendências do controlador |
