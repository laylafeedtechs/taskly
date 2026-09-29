# Pendências jurídicas e organizacionais

Os controles técnicos do Taskly **apoiam** a adequação à LGPD, mas não a garantem. Os itens abaixo
dependem do controlador (a organização que decide sobre o tratamento) e não podem ser resolvidos só
com código.

## Governança
- [ ] Definir formalmente o **controlador** e, se aplicável, os **operadores**.
- [ ] Indicar o **encarregado (DPO)** e publicar o canal de contato (Admin Center → Privacidade).
- [ ] Elaborar o **Registro das Operações de Tratamento** (art. 37), usando o
      [inventário](inventario-de-dados.md) como base. A ANPD disponibiliza modelo para agentes de
      pequeno porte.
- [ ] Avaliar a necessidade de **Relatório de Impacto (RIPD)**.
- [ ] Definir e documentar a **base legal** de cada finalidade (a página de política mostra
      "[A DEFINIR]" até isso ser feito).

## Transparência
- [ ] Revisar e completar a **Política de Privacidade** (`/privacy`) com a assessoria jurídica e
      marcar "Conteúdo revisado pela assessoria jurídica" no Admin Center.
- [ ] Redigir **Termos de Uso**.
- [ ] Validar os **prazos de retenção** ([retencao.md](retencao.md)).

## Terceiros
- [ ] Contratos/termos de tratamento com operadores (hospedagem, e-mail, Google).
- [ ] Definir o mecanismo de **transferência internacional** aplicável a cada serviço
      ([terceiros-e-transferencias.md](terceiros-e-transferencias.md)).
- [ ] Substituir o túnel rápido da Cloudflare por hospedagem contratada antes de uso real.

## Direitos dos titulares e incidentes
- [ ] Definir responsáveis e prazos internos para responder às solicitações (Admin Center →
      Solicitações LGPD). O sistema usa 15 dias como prazo de referência.
- [ ] Aprovar o plano de [resposta a incidentes](resposta-a-incidentes.md) e os responsáveis pela
      comunicação à ANPD e aos titulares.

## Infraestrutura
- [ ] Definir `TASKLY_ENCRYPTION_KEY` pelo gerenciador de segredos do provedor e guardar uma cópia
      segura da chave (sem ela os backups não podem ser restaurados).
- [ ] Apontar `TASKLY_BACKUP_DIR` para outro disco ou serviço e testar restaurações periodicamente.
- [ ] Ativar criptografia de disco (ex.: BitLocker) no servidor — o banco principal é um arquivo em
      disco.
- [ ] Separar ambientes (desenvolvimento, teste, produção) com credenciais próprias.
- [ ] Treinar quem administra a plataforma (Super Admins) sobre acesso de suporte e incidentes.
