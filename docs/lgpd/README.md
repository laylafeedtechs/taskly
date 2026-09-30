# Privacidade e LGPD — Taskly

Os controles técnicos do Taskly apoiam a adequação à LGPD, mas **não a garantem**: governança,
transparência, bases legais e contratos dependem do controlador.

As medidas estão organizadas em três camadas:

| Camada | O que cobre | Onde está |
|---|---|---|
| **Infraestrutura** | TLS, segredos, criptografia, backups, monitoramento | [../seguranca/relatorio-auditoria.md](../seguranca/relatorio-auditoria.md), `.env.example` |
| **Aplicação** | Autenticação, MFA, RBAC, isolamento entre workspaces, validação, uploads, troca de conta | `server/`, [../seguranca/desenvolvimento-seguro.md](../seguranca/desenvolvimento-seguro.md) |
| **Privacidade** | Minimização, finalidade, retenção, direitos dos titulares, transparência, incidentes | Documentos abaixo |

- [Inventário de dados pessoais](inventario-de-dados.md)
- [Terceiros e transferências internacionais](terceiros-e-transferencias.md)
- [Retenção e eliminação](retencao.md)
- [Resposta a incidentes](resposta-a-incidentes.md)
- [Pendências jurídicas e organizacionais](pendencias-do-controlador.md)

Na aplicação: política pública em `/privacy`; Central de Privacidade em
Configurações → Central de Privacidade; administração em Admin Center → Privacidade,
Solicitações LGPD, Incidentes e Backups.
