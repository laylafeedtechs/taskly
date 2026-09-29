# Inventário de dados pessoais — Taskly

> Documento técnico interno, gerado a partir do código (setembro/2026). Serve de insumo para o
> Registro das Operações de Tratamento (ROPA) do controlador. **Não é um parecer jurídico.**
> Bases legais, controlador e encarregado precisam ser definidos pela organização (ver
> [pendencias-do-controlador.md](pendencias-do-controlador.md)).

Armazenamento principal: `data/taskly_db.json` (servidor). Arquivos enviados: `data/uploads/`.
Backups: `TASKLY_BACKUP_DIR` (cifrados, fora de `data/`). E-mails sem SMTP: `data/outbox/`.

## 1. Dados por categoria

| Dado | Onde é coletado | Onde fica | Finalidade | Quem acessa | Retenção |
|---|---|---|---|---|---|
| Nome | Cadastro, perfil, convite aceito, login Google | `users.name`; cópias em `comments.userName`, `activity.actor`, `files.uploadedBy`, `auditLogs.actor` | Identificar a pessoa na colaboração | Membros dos workspaces em comum; Super Admin (Admin Center) | Enquanto a conta existir; na exclusão da conta as cópias viram "Usuário removido" (exceto auditoria) |
| E-mail | Cadastro, convite, login Google | `users.email`, `invitations.email`, `privacyRequests.userEmail` | Login, convites, e-mails transacionais | Membros dos workspaces em comum; Super Admin | Enquanto a conta existir; convites: prazo configurado |
| Senha | Cadastro, redefinição | `users.passwordHash` (bcrypt, custo 12) | Autenticação | Ninguém (nunca serializado) | Enquanto a conta existir |
| Vínculo Google | Login Google | `users.googleSub` (identificador), e-mail e nome | Autenticação federada | Ninguém (nunca serializado) | Enquanto a conta existir |
| Segredo MFA e códigos de recuperação | Ativação do MFA | `users.mfa.secret` (AES-256-GCM), `users.mfa.recoveryHashes` (SHA-256) | Segundo fator | Ninguém | Até desativar o MFA |
| Foto de perfil (opcional) | Upload em Configurações | `data/uploads/avatars/` (nome aleatório) | Identificação visual | Membros dos workspaces em comum | Até remover a foto ou excluir a conta |
| Preferências | Configurações | `users.preferences`, `notificationPreferences`, `dashboardLayout`, `favoriteProjects` | Personalização | Somente o titular | Enquanto a conta existir |
| Participação em workspaces | Convites, criação | `workspaces.members` (papel, data de entrada) | Controle de acesso (RBAC) | Membros do workspace | Enquanto a participação existir |
| Conteúdo de trabalho | Uso do produto | `tasks` (títulos, descrições, comentários, responsáveis), `projects`, `files` | Prestação do serviço | Membros do workspace conforme papel | Enquanto o workspace existir; lixeira: prazo configurado |
| Menções e atribuições | Comentários, tarefas | `notifications`, `tasks.assigneeId` | Avisar a pessoa | Titular (notificações); membros (atribuições) | Notificações: prazo configurado |
| Histórico de atividade | Automático | `activity` (ator, ação, data) | Histórico do trabalho | Membros do workspace | Enquanto o workspace existir |
| Sessões | Login | `sessions` (hash do token, IP, navegador, datas, se houve MFA) | Manter o login, detectar acessos | Titular (Configurações → Segurança) | Até expirar (7 dias / 3 dias de inatividade) |
| Dispositivos conhecidos | Login | `users.knownDevices` (hash truncado do user-agent) | Alertar acesso de novo dispositivo | Ninguém | Últimos 10 |
| Último acesso | Login | `users.lastLoginAt` | Administração de equipe | Owner/Manager do workspace; Super Admin | Enquanto a conta existir |
| Auditoria | Automático | `auditLogs` (ator, ação, entidade, resultado, IP, navegador, sessão) | Segurança, investigação de incidentes, prestação de contas | Super Admin; o titular recebe os seus na exportação | Prazo configurado (padrão 730 dias); IP truncado e navegador removido após 90 dias |
| Eventos de sistema | Automático | `systemEvents` (sem senhas/tokens, com mascaramento) | Observabilidade | Super Admin | Padrão 90 dias |
| Incidentes | Detecção automática | `securityIncidents` (referências a registros de auditoria) | Resposta a incidentes | Super Admin | Fechados: padrão 5 anos |
| Solicitações de titulares | Central de Privacidade | `privacyRequests` (nome, e-mail, tipo, texto) | Atender direitos do titular e comprovar o atendimento | Titular; Super Admin | Concluídas: padrão 5 anos |
| Chaves de API | Configurações | `apiKeys` (hash SHA-256, prefixo, escopos, criador, uso) | Integrações | Owner/Manager | Até revogar |
| Segredos de webhook | Configurações | `webhooks.secret` (AES-256-GCM) | Assinar entregas | Ninguém após a criação | Até excluir o webhook |
| Links de redefinição / verificação / convite | Automático | `passwordResets`, `emailVerifications`, `invitations` (somente hash do token) | Fluxos de conta | Ninguém | 1 h / 24 h / 7 dias; removidos ao usar |

## 2. Fluxos (coleta → processamento → saída)

- **Exibido:** nome, e-mail e foto de membros aparecem para quem compartilha um workspace. O último acesso só para quem gerencia membros. Dados de outros workspaces nunca são retornados pela API (testado).
- **Transmitido a terceiros:** ver [terceiros-e-transferencias.md](terceiros-e-transferencias.md). Webhooks enviam apenas IDs, título, status, prioridade e datas — nunca nomes, e-mails, descrições ou comentários.
- **Registrado em logs:** logs do servidor recebem método, caminho (sem query string), status e tempo. Campos com nomes como senha/token/segredo/chave/cookie são mascarados (`[REDACTED]`) antes de gravar.
- **Exportado:** relatórios (CSV/Excel/PDF) contêm nomes de responsáveis do próprio workspace; toda exportação é auditada e limitada (30/h). A exportação de dados pessoais do titular (JSON) contém apenas os dados do próprio titular.
- **Em cache:** o service worker guarda apenas o shell do app e ícones; respostas da API nunca são armazenadas. O navegador guarda preferências de visualização no `localStorage` (sem dados pessoais) e o convite pendente no `sessionStorage` até o login.
- **Backups:** cópia integral do banco, cifrada com AES-256-GCM, diária, em diretório separado; quantidade mantida configurável (padrão 14).
- **Excluído:** exclusão de conta (titular), lixeira (manual e automática após o prazo), retenção automática diária.

## 3. Dados que **não** são coletados

Telefone, endereço, documento, data de nascimento, geolocalização, dados sensíveis (art. 5º, II),
dados de crianças. Não há cookies de publicidade ou analytics, nem uso dos dados para perfilamento,
marketing ou treinamento de modelos.

## 4. Minimização aplicada nesta revisão

- Removido o papel global (`users.role`), que não era usado para autorização.
- A foto do Google não é mais armazenada; avatares de terceiros (Google, Unsplash) foram removidos do banco — cada visualização vazava o IP do usuário para esses hosts.
- Fontes passaram a ser servidas pelo próprio Taskly (antes, todo acesso chamava o Google Fonts).
- Auditoria deixou de guardar o e-mail no campo "ator".
- Webhooks passaram a enviar um payload mínimo.
- Último acesso restrito a quem gerencia membros; listagem administrativa com campos explícitos.
