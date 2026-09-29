# Resposta a incidentes de segurança

> Procedimento técnico de apoio. A decisão de comunicar a ANPD e os titulares é do controlador,
> com o encarregado e a assessoria jurídica. Consulte sempre o texto vigente da Resolução
> CD/ANPD nº 15/2024 (Regulamento de Comunicação de Incidente de Segurança).

## 1. Detecção (automática)

O Taskly abre um **incidente suspeito** em Admin Center → Incidentes e alerta os Super Admins quando:

| Regra | Limite (1 hora) | Severidade |
|---|---|---|
| Falhas de login na mesma conta | 10 | Alta |
| Falhas de login do mesmo IP | 30 | Alta |
| Acessos negados / tentativas de escalonamento de privilégio (mesmo ator) | 15 | Alta |
| Trocas de conta negadas | 3 | Alta |
| Falhas de MFA | 5 | Alta |
| Exportações de dados | 10 | Média |
| Exclusões em massa / definitivas | 20 | Média |
| Acesso de suporte (impersonação) iniciado | 1 | Baixa (registro) |

Também são registrados: login de dispositivo novo (o titular é avisado), bloqueio de CSRF, acesso
administrativo sem MFA, falhas de webhook e de backup.

## 2. Triagem e avaliação

1. Abrir o incidente, revisar a **evidência** (registros de auditoria vinculados) e mudar o status
   para *Em investigação*.
2. Responder no formulário de avaliação:
   - Envolve dados pessoais?
   - Pode causar risco ou dano relevante aos titulares?
   - A comunicação é necessária?
3. Quando as duas primeiras respostas são "sim", o sistema registra a data de confirmação e mostra o
   **prazo de referência de 3 dias úteis** para a comunicação (feriados não considerados — confirmar
   com o encarregado).
4. Registrar notas, medidas tomadas e, se houver, a data da comunicação.

Uma vulnerabilidade ou tentativa bloqueada **não é automaticamente** um incidente com dados
pessoais que exija comunicação.

## 3. Contenção (ações disponíveis)

- Bloquear usuário (Admin Center → Usuários) — encerra todas as sessões.
- Redefinir MFA de um usuário (com motivo registrado).
- Revogar chaves de API e desativar webhooks do workspace afetado.
- Encerrar sessões: o titular em Configurações → Segurança; em massa, reiniciando a chave de sessão
  (remover `sessions` do banco com o servidor parado).
- Segredo vazado: revogar → rotacionar → investigar o uso → remover do histórico do git, se for o
  caso → registrar no incidente.

## 4. Preservação de evidências

- A trilha de auditoria é encadeada por hash (Admin Center → Logs de auditoria → *Verificar
  integridade*).
- Backups cifrados diários permitem reconstruir o estado anterior (`npm run backup:restore`).
- Não apague registros relacionados a um incidente aberto; ajuste a retenção se necessário.
