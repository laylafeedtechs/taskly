# Retenção e eliminação de dados

Os prazos são configuráveis em **Admin Center → Privacidade** (`systemSettings.retention`). A rotina
de retenção roda diariamente e na inicialização do servidor, e pode ser executada manualmente.
`0` significa "manter indefinidamente". **Os valores padrão são sugestões técnicas — o controlador
deve validá-los considerando obrigações legais e regulatórias.**

| Dado | Padrão | O que acontece ao vencer | Justificativa técnica |
|---|---|---|---|
| Sessões | 7 dias (absoluto) / 3 dias sem uso | Removidas | Minimizar sessões ativas |
| Links de redefinição / verificação / desafios MFA | 1 h / 24 h / 5 min | Removidos | Uso único e curto |
| Convites (usados, revogados ou expirados) | 30 dias | Removidos | Rastreabilidade de convites recentes |
| Notificações | 180 dias | Removidas | Valor informativo temporário |
| Itens na lixeira | 30 dias | Excluídos definitivamente (tarefas, projetos, arquivos) | Janela de recuperação |
| Logs de automação | 90 dias | Removidos | Depuração de regras |
| Entregas de webhook | 30 dias | Removidas | Depuração de integrações |
| Eventos de sistema | 90 dias | Removidos | Observabilidade |
| IP e navegador na auditoria | 90 dias | IP truncado (ex.: `189.40.12.x`), navegador removido | Minimização mantendo a trilha |
| Registros de auditoria | 730 dias | Removidos; a âncora da cadeia de hashes é preservada | Segurança e prestação de contas |
| Incidentes fechados | 1825 dias | Removidos | Evidência de resposta a incidentes |
| Solicitações de titulares concluídas | 1825 dias | Removidas | Comprovar o atendimento |
| Backups | 14 cópias | As mais antigas são apagadas | Recuperação de desastre |

## Exclusão de conta (titular)

Feita pela Central de Privacidade (exige e-mail, senha e MFA, se ativo):

- **Excluídos:** conta, sessões, notificações, convites pendentes, foto, workspaces em que a pessoa
  era a única integrante (com tudo dentro).
- **Desidentificados** (mantidos para os demais membros): comentários, histórico de atividade e
  arquivos enviados passam a mostrar "Usuário removido"; tarefas ficam sem responsável.
- **Revogados:** chaves de API criadas pela pessoa.
- **Mantidos:** registros de auditoria (segurança/prestação de contas, pelo prazo acima) e
  solicitações de titulares (comprovação), com o nome substituído.
- **Bloqueios:** quem é proprietário de workspace com outros membros precisa transferir a
  propriedade antes; o último Super Admin não pode excluir a própria conta.

Os backups existentes continuam contendo a conta até serem rotacionados (padrão 14 dias). Se o
controlador precisar de outro tratamento para backups, isso deve ser definido e documentado.
