import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { seal, unseal } from './lib/secrets.js';
import { hashAuditEntry } from './lib/auditHash.js';
import { IS_WORKER } from './lib/runtime.js';

// Persistence backends:
//  - Node (development / self-hosting): a JSON file in DATA_DIR.
//  - Cloudflare Worker: D1. Each request runs inside a context (see
//    server/lib/d1store.js) that holds the state loaded from D1; changes are
//    written back in one atomic batch. The file is never used in the Worker.
function defaultDataDir() {
  try { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data'); } catch { return '/tmp/taskly-data'; }
}
export const DATA_DIR = process.env.TASKLY_DATA_DIR ? path.resolve(process.env.TASKLY_DATA_DIR) : defaultDataDir();
const DB_FILE = path.join(DATA_DIR, 'taskly_db.json');

export const requestStore = new AsyncLocalStorage();

// Initial default seed dataset
const defaultData = {
  users: [
    {
      id: 'usr-1',
      name: 'Lucas Rocha',
      email: 'lucas@taskly.io',
      passwordHash: '$2a$10$e8wF5qO8qj5jY7R4hQ8h0uXQ7V6wR.qH9yQ2cK4mK9z8k3h2b1m2.', // 'taskly123'
      role: 'Owner',
      isSuperAdmin: true,
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCYD7KWf3dFibaTJhTmq76oh0XFizDPHvliSXBbZeD14bvyuFc3IyGUXQWqFgYp6SPGl2wiaOscmBV72VOw1qnk7X6gJK3BuD3E6diHIF_GKzjpjVUcFKg_6ErcF_Ub8cQ6BbU2N-qVytVKzLjm1t8N-X2EChyEyoI4uANDaN0_LlaCAy_cTUs0ijkxJDxQwY60wiSpezbyVEVJIRWAFUl3eS-xcpajrzpnkq7Ue4cmLuQNYRCg5rUU8A',
      status: 'ACTIVE',
      dashboardLayout: ['metrics', 'today', 'upcoming', 'projects', 'activity', 'charts'],
      notificationPreferences: { inApp: true, email: true, taskAssignments: true, mentions: true, deadlines: true, security: true },
      createdAt: '2026-09-01T10:00:00.000Z'
    },
    {
      id: 'usr-2',
      name: 'Ana Rodrigues',
      email: 'ana.rodrigues@taskly.io',
      passwordHash: '$2a$10$e8wF5qO8qj5jY7R4hQ8h0uXQ7V6wR.qH9yQ2cK4mK9z8k3h2b1m2.',
      role: 'Manager',
      isSuperAdmin: false,
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      status: 'ACTIVE',
      dashboardLayout: ['metrics', 'today', 'projects', 'activity'],
      notificationPreferences: { inApp: true, email: true, taskAssignments: true, mentions: true, deadlines: true, security: true },
      createdAt: '2026-09-05T11:00:00.000Z'
    },
    {
      id: 'usr-3',
      name: 'Mateus Silva',
      email: 'mateus.silva@taskly.io',
      passwordHash: '$2a$10$e8wF5qO8qj5jY7R4hQ8h0uXQ7V6wR.qH9yQ2cK4mK9z8k3h2b1m2.',
      role: 'Member',
      isSuperAdmin: false,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      status: 'ACTIVE',
      dashboardLayout: ['metrics', 'today', 'activity'],
      notificationPreferences: { inApp: true, email: false, taskAssignments: true, mentions: true, deadlines: true, security: true },
      createdAt: '2026-09-10T14:00:00.000Z'
    },
    {
      id: 'usr-4',
      name: 'Carla Mendes',
      email: 'carla.m@taskly.io',
      passwordHash: '$2a$10$e8wF5qO8qj5jY7R4hQ8h0uXQ7V6wR.qH9yQ2cK4mK9z8k3h2b1m2.',
      role: 'Member',
      isSuperAdmin: false,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      status: 'ACTIVE',
      dashboardLayout: ['metrics', 'today', 'projects'],
      notificationPreferences: { inApp: true, email: true, taskAssignments: true, mentions: true, deadlines: true, security: true },
      createdAt: '2026-09-12T09:00:00.000Z'
    },
    {
      id: 'usr-5',
      name: 'Gabriel Costa',
      email: 'gabriel.costa@taskly.io',
      passwordHash: '$2a$10$e8wF5qO8qj5jY7R4hQ8h0uXQ7V6wR.qH9yQ2cK4mK9z8k3h2b1m2.',
      role: 'Viewer',
      isSuperAdmin: false,
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
      status: 'BLOCKED',
      dashboardLayout: ['metrics', 'today'],
      notificationPreferences: { inApp: true, email: false, taskAssignments: false, mentions: false, deadlines: false, security: true },
      createdAt: '2026-09-15T16:00:00.000Z'
    }
  ],
  workspaces: [
    {
      id: 'ws-1',
      name: 'Minha Empresa',
      slug: 'minha-empresa',
      color: '#FFFFFF',
      icon: 'business',
      ownerId: 'usr-1',
      members: [
        { userId: 'usr-1', role: 'Owner', joinedAt: '2026-09-01' },
        { userId: 'usr-2', role: 'Manager', joinedAt: '2026-09-05' },
        { userId: 'usr-3', role: 'Member', joinedAt: '2026-09-10' },
        { userId: 'usr-4', role: 'Member', joinedAt: '2026-09-12' }
      ],
      createdAt: '2026-09-01T10:00:00.000Z'
    },
    {
      id: 'ws-2',
      name: 'Website & Brand',
      slug: 'website',
      color: '#ADC6FF',
      icon: 'language',
      ownerId: 'usr-1',
      members: [
        { userId: 'usr-1', role: 'Owner', joinedAt: '2026-09-01' },
        { userId: 'usr-4', role: 'Member', joinedAt: '2026-09-12' }
      ],
      createdAt: '2026-09-02T10:00:00.000Z'
    },
    {
      id: 'ws-3',
      name: 'Desenvolvimento',
      slug: 'dev',
      color: '#4EDEA3',
      icon: 'terminal',
      ownerId: 'usr-1',
      members: [
        { userId: 'usr-1', role: 'Owner', joinedAt: '2026-09-01' },
        { userId: 'usr-3', role: 'Manager', joinedAt: '2026-09-10' }
      ],
      createdAt: '2026-09-03T10:00:00.000Z'
    },
    {
      id: 'ws-4',
      name: 'Marketing & Growth',
      slug: 'marketing',
      color: '#F59E0B',
      icon: 'campaign',
      ownerId: 'usr-2',
      members: [
        { userId: 'usr-2', role: 'Owner', joinedAt: '2026-09-05' },
        { userId: 'usr-1', role: 'Manager', joinedAt: '2026-09-06' }
      ],
      createdAt: '2026-09-05T10:00:00.000Z'
    },
    {
      id: 'ws-5',
      name: 'Client Projects',
      slug: 'clients',
      color: '#93C5FD',
      icon: 'handshake',
      ownerId: 'usr-1',
      members: [
        { userId: 'usr-1', role: 'Owner', joinedAt: '2026-09-01' },
        { userId: 'usr-5', role: 'Viewer', joinedAt: '2026-09-15' }
      ],
      createdAt: '2026-09-06T10:00:00.000Z'
    }
  ],
  projects: [
    {
      id: 'proj-1',
      name: 'Website Platform 2.0',
      slug: 'website-platform',
      workspaceId: 'ws-1',
      description: 'Desenvolvimento e arquitetura da nova plataforma web institucional e portal do cliente.',
      status: 'ACTIVE',
      progress: 82,
      members: ['usr-1', 'usr-2', 'usr-4'],
      dueDate: '2026-09-30',
      color: '#3B82F6',
      icon: 'web',
      isFavorite: true,
      health: 'Healthy', // Healthy, At Risk, Critical
      createdAt: '2026-09-05T10:00:00.000Z'
    },
    {
      id: 'proj-2',
      name: 'Core Mobile App v3',
      slug: 'mobile-app',
      workspaceId: 'ws-1',
      description: 'Aplicativo iOS e Android com sincronização offline e notificações push inteligentes.',
      status: 'ACTIVE',
      progress: 64,
      members: ['usr-1', 'usr-3'],
      dueDate: '2026-10-15',
      color: '#10B981',
      icon: 'smartphone',
      isFavorite: true,
      health: 'Healthy',
      createdAt: '2026-09-08T10:00:00.000Z'
    },
    {
      id: 'proj-3',
      name: 'Design System & UI Kit',
      slug: 'design-system',
      workspaceId: 'ws-1',
      description: 'Padronização de tokens de design Obsidian Dark, componentes acessíveis e documentação.',
      status: 'ACTIVE',
      progress: 95,
      members: ['usr-2', 'usr-4'],
      dueDate: '2026-10-05',
      color: '#F59E0B',
      icon: 'palette',
      isFavorite: false,
      health: 'Healthy',
      createdAt: '2026-09-10T10:00:00.000Z'
    },
    {
      id: 'proj-4',
      name: 'API Gateway & Microsserviços',
      slug: 'api-gateway',
      workspaceId: 'ws-1',
      description: 'Migração para arquitetura distribuída de alta vazão com rate limiting e telemetria.',
      status: 'ACTIVE',
      progress: 45,
      members: ['usr-1', 'usr-3'],
      dueDate: '2026-11-01',
      color: '#EF4444',
      icon: 'hub',
      isFavorite: false,
      health: 'At Risk',
      createdAt: '2026-09-12T10:00:00.000Z'
    }
  ],
  columns: [
    { id: 'col-backlog', projectId: 'proj-1', name: 'Backlog', statusKey: 'Backlog', wipLimit: 15, color: '#666666', order: 0 },
    { id: 'col-todo', projectId: 'proj-1', name: 'A Fazer', statusKey: 'To Do', wipLimit: 10, color: '#A0A0A0', order: 1 },
    { id: 'col-in-progress', projectId: 'proj-1', name: 'Em Andamento', statusKey: 'In Progress', wipLimit: 6, color: '#3B82F6', order: 2 },
    { id: 'col-review', projectId: 'proj-1', name: 'Em Revisão', statusKey: 'Review', wipLimit: 4, color: '#F59E0B', order: 3 },
    { id: 'col-testing', projectId: 'proj-1', name: 'Testes & QA', statusKey: 'Testing', wipLimit: 5, color: '#EC4899', order: 4 },
    { id: 'col-done', projectId: 'proj-1', name: 'Concluído', statusKey: 'Done', wipLimit: 50, color: '#10B981', order: 5 }
  ],
  tasks: [
    {
      id: 'TSK-1048',
      title: 'Refatorar arquitetura de autenticação OAuth2 e RBAC',
      description: 'Implementar novo fluxo OAuth2 com refresh token rotation, validação de tokens JWT no middleware e suporte a autenticação multifator (MFA).',
      status: 'Review',
      priority: 'High',
      type: 'Improvement',
      tags: ['Backend', 'Security', 'OAuth2'],
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      assigneeId: 'usr-1',
      dueDate: '2026-09-30',
      startDate: '2026-09-20',
      blockedBy: [],
      blocks: ['TSK-1051'],
      isRecurring: false,
      recurringInterval: null, // daily, weekly, monthly
      checklist: [
        { id: 'c1', text: 'Schema de banco de dados para credenciais OAuth', completed: true },
        { id: 'c2', text: 'Serviço de geração e rotação de tokens', completed: true },
        { id: 'c3', text: 'Middleware de verificação com cache Redis', completed: true },
        { id: 'c4', text: 'Provider OAuth Google e GitHub', completed: false },
        { id: 'c5', text: 'Testes de integração automatizados', completed: false }
      ],
      comments: [
        {
          id: 'cm-1',
          userId: 'usr-2',
          userName: 'Ana Rodrigues',
          userAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
          timestamp: '15 minutos atrás',
          text: 'Os testes de carga no token rotation apresentaram tempo de resposta médio de 12ms. Excelente resultado!'
        }
      ],
      attachments: [
        { id: 'att-1', name: 'oauth2-sequence-diagram.png', size: '1.4 MB', type: 'image', uploadedBy: 'Lucas Rocha', date: '2026-09-22' },
        { id: 'att-2', name: 'security_audit_spec.pdf', size: '420 KB', type: 'pdf', uploadedBy: 'Ana Rodrigues', date: '2026-09-24' }
      ],
      activities: [
        { id: 'act-1', actor: 'Lucas Rocha', action: 'moveu a tarefa para Em Revisão', time: '12 minutos atrás' },
        { id: 'act-2', actor: 'Ana Rodrigues', action: 'anexou security_audit_spec.pdf', time: '24 minutos atrás' }
      ],
      createdAt: '2026-09-20T10:00:00.000Z',
      deletedAt: null
    },
    {
      id: 'TSK-1049',
      title: 'Otimizar renderização do Kanban com virtualização e drag & drop nativo',
      description: 'Garantir rolagem horizontal ultra-fluida mantendo largura fixa de 300px nas colunas e 60 FPS com mais de 500 cartões.',
      status: 'In Progress',
      priority: 'Urgent',
      type: 'Feature',
      tags: ['Frontend', 'Performance', 'Kanban'],
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      assigneeId: 'usr-1',
      dueDate: '2026-09-28',
      startDate: '2026-09-22',
      blockedBy: [],
      blocks: [],
      isRecurring: false,
      checklist: [
        { id: 'c1', text: 'Estrutura horizontal sem compressão de colunas', completed: true },
        { id: 'c2', text: 'Cartões com 100% de largura da coluna', completed: true },
        { id: 'c3', text: 'Manipuladores de drag and drop acessíveis', completed: true }
      ],
      comments: [],
      attachments: [],
      activities: [],
      createdAt: '2026-09-22T08:30:00.000Z',
      deletedAt: null
    },
    {
      id: 'TSK-1050',
      title: 'Implementar Central de Relatórios e Exportação CSV/PDF',
      description: 'Desenvolver dashboards com métricas de produtividade, velocidade de sprint e exportação customizada.',
      status: 'In Progress',
      priority: 'High',
      type: 'Feature',
      tags: ['Analytics', 'BI', 'Export'],
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      assigneeId: 'usr-2',
      dueDate: '2026-10-02',
      startDate: '2026-09-25',
      blockedBy: [],
      blocks: [],
      isRecurring: false,
      checklist: [
        { id: 'c1', text: 'Cálculo dinâmico de taxa de entrega', completed: true },
        { id: 'c2', text: 'Gráficos interativos de status e prioridade', completed: true }
      ],
      comments: [],
      attachments: [],
      activities: [],
      createdAt: '2026-09-25T11:00:00.000Z',
      deletedAt: null
    },
    {
      id: 'TSK-1051',
      title: 'Criar motor de Automações WHEN → IF → THEN',
      description: 'Interface interativa de regras de automação para disparo de notificações e movimentação de status.',
      status: 'To Do',
      priority: 'Normal',
      type: 'Feature',
      tags: ['Automation', 'Workflows'],
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      assigneeId: 'usr-3',
      dueDate: '2026-10-08',
      startDate: '2026-09-28',
      blockedBy: ['TSK-1048'], // Blocked by TSK-1048
      blocks: [],
      isRecurring: false,
      checklist: [],
      comments: [],
      attachments: [],
      activities: [],
      createdAt: '2026-09-28T09:00:00.000Z',
      deletedAt: null
    },
    {
      id: 'TSK-1052',
      title: 'Correção de vazamento de memória no WebSocket de notificações',
      description: 'Desconectar listeners antigos ao trocar de workspace e tratar reconexões com backoff exponencial.',
      status: 'Testing',
      priority: 'Urgent',
      type: 'Bug',
      tags: ['WebSocket', 'Bugfix'],
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      assigneeId: 'usr-1',
      dueDate: '2026-09-28',
      startDate: '2026-09-26',
      blockedBy: [],
      blocks: [],
      isRecurring: false,
      checklist: [
        { id: 'c1', text: 'Cleanup em useEffect / componentWillUnmount', completed: true },
        { id: 'c2', text: 'Teste de estresse com 100 conexões simuladas', completed: true }
      ],
      comments: [],
      attachments: [],
      activities: [],
      createdAt: '2026-09-26T14:00:00.000Z',
      deletedAt: null
    },
    {
      id: 'TSK-1053',
      title: 'Sincronização Diária de Métricas e Health Check',
      description: 'Rotina periódica de cálculo de taxa de entrega e verificação de integridade dos microsserviços.',
      status: 'Done',
      priority: 'Normal',
      type: 'Task',
      tags: ['Cron', 'Maintenance'],
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      assigneeId: 'usr-1',
      dueDate: '2026-09-28',
      startDate: '2026-09-28',
      blockedBy: [],
      blocks: [],
      isRecurring: true,
      recurringInterval: 'daily',
      checklist: [
        { id: 'c1', text: 'Executar snapshot de métricas', completed: true }
      ],
      comments: [],
      attachments: [],
      activities: [],
      createdAt: '2026-09-28T04:00:00.000Z',
      deletedAt: null
    }
  ],
  milestones: [
    {
      id: 'ms-1',
      projectId: 'proj-1',
      name: 'Milestone Alpha: Core Architecture & OAuth2',
      description: 'Fechamento dos serviços de autenticação, RBAC e fundação de microsserviços.',
      dueDate: '2026-09-30',
      status: 'IN_PROGRESS',
      progress: 85
    },
    {
      id: 'ms-2',
      projectId: 'proj-1',
      name: 'Milestone Beta: Kanban Pro & Analytics BI',
      description: 'Lançamento do quadro Kanban virtualizado e dashboards de relatórios com exportação.',
      dueDate: '2026-10-15',
      status: 'PLANNED',
      progress: 40
    }
  ],
  projectTemplates: [
    {
      id: 'tpl-software',
      name: 'Software Development (Agile / Scrum)',
      description: 'Fluxo ágil com Backlog, Sprint To Do, Em Andamento, Code Review, QA e Produção.',
      columns: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'QA Testing', 'Done'],
      defaultTags: ['Frontend', 'Backend', 'Bug', 'DevOps', 'Security'],
      icon: 'code'
    },
    {
      id: 'tpl-marketing',
      name: 'Marketing & Campaign Launch',
      description: 'Gestão de campanhas, criativos, aprovações, tráfego pago e métricas de conversão.',
      columns: ['Ideação', 'Planejamento', 'Copywriting & Design', 'Aprovação', 'No Ar', 'Concluído'],
      defaultTags: ['Redes Sociais', 'Tráfego Pago', 'Design', 'Conteúdo', 'SEO'],
      icon: 'campaign'
    },
    {
      id: 'tpl-product',
      name: 'Product Launch & Discovery',
      description: 'Descoberta contínua, entrevistas com usuários, prototipagem, MVP e GTM.',
      columns: ['Discovery', 'Pesquisa UX', 'Prototipagem', 'Desenvolvimento MVP', 'Lançamento', 'Retrospectiva'],
      defaultTags: ['Discovery', 'Figma', 'Feedback', 'GTM', 'Roadmap'],
      icon: 'rocket_launch'
    },
    {
      id: 'tpl-client',
      name: 'Client Project & Deliverables',
      description: 'Controle de escopo, marcos contratuais, entregas para cliente e faturamento.',
      columns: ['Kickoff', 'Briefing', 'Execução', 'Validação Cliente', 'Entregue', 'Faturado'],
      defaultTags: ['Cliente', 'Aprovação', 'Contrato', 'Escopo'],
      icon: 'handshake'
    },
    {
      id: 'tpl-blank',
      name: 'Blank Project (Personalizado)',
      description: 'Projeto limpo sem tarefas pré-definidas para configuração personalizada do zero.',
      columns: ['Backlog', 'A Fazer', 'Em Andamento', 'Concluído'],
      defaultTags: ['Geral'],
      icon: 'add_circle'
    }
  ],
  automations: [
    {
      id: 'aut-1',
      workspaceId: 'ws-1',
      title: 'Notificar Tech Lead em tarefas Críticas / Urgentes',
      category: 'Task Automations',
      trigger: 'WHEN: Prioridade for alterada para "Urgent"',
      condition: 'IF: Projeto for "Website Platform 2.0" ou "API Gateway"',
      action: 'THEN: Enviar notificação prioritária para Lucas Rocha',
      enabled: true,
      executionsCount: 142,
      lastTriggered: 'Hoje às 09:12'
    },
    {
      id: 'aut-2',
      workspaceId: 'ws-1',
      title: 'Mover automaticamente para "Em Revisão" ao abrir Pull Request',
      category: 'Workflow Automations',
      trigger: 'WHEN: Pull Request vinculado for aberto no GitHub',
      condition: 'IF: Status da tarefa for "Em Andamento"',
      action: 'THEN: Atualizar status para "Review" e adicionar tag [PR-Open]',
      enabled: true,
      executionsCount: 89,
      lastTriggered: 'Ontem às 17:45'
    },
    {
      id: 'aut-3',
      workspaceId: 'ws-1',
      title: 'Alerta de prazo vencendo em 24 horas',
      category: 'Notification Automations',
      trigger: 'WHEN: Prazo de entrega estiver a 24 horas do vencimento',
      condition: 'IF: Status for diferente de "Concluído"',
      action: 'THEN: Enviar lembrete via Slack e notificação in-app para o responsável',
      enabled: true,
      executionsCount: 230,
      lastTriggered: 'Hoje às 08:00'
    }
  ],
  automationLogs: [
    {
      id: 'autlog-1',
      workspaceId: 'ws-1',
      automationId: 'aut-1',
      automationTitle: 'Notificar Tech Lead em tarefas Críticas / Urgentes',
      trigger: 'Task Priority Changed -> Urgent',
      condition: 'Project in (Website Platform, API Gateway)',
      action: 'Send Priority Notification to Lucas Rocha',
      status: 'SUCCESS',
      result: 'Dispatched to in-app & WebSocket',
      timestamp: '2026-09-28T09:12:00.000Z'
    },
    {
      id: 'autlog-2',
      workspaceId: 'ws-1',
      automationId: 'aut-2',
      automationTitle: 'Mover automaticamente para "Em Revisão"',
      trigger: 'GitHub Webhook PR #42 Open',
      condition: 'Status == In Progress',
      action: 'Move to Review',
      status: 'SUCCESS',
      result: 'Task TSK-1048 updated',
      timestamp: '2026-09-27T17:45:00.000Z'
    }
  ],
  notifications: [
    {
      id: 'notif-1',
      userId: 'usr-1',
      title: 'Mencionado por Ana Rodrigues',
      description: 'Lucas, os testes de carga no token rotation apresentaram 12ms. Pode revisar o PR?',
      category: 'Mentions',
      unread: true,
      timestamp: '15 min atrás',
      taskId: 'TSK-1048',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      createdAt: '2026-09-28T10:15:00.000Z'
    },
    {
      id: 'notif-2',
      userId: 'usr-1',
      title: 'Atribuição de Tarefa',
      description: 'Você foi atribuído como responsável técnico em TSK-1052: Vazamento de memória no WebSocket.',
      category: 'Assignments',
      unread: true,
      timestamp: '1 hora atrás',
      taskId: 'TSK-1052',
      avatar: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCYD7KWf3dFibaTJhTmq76oh0XFizDPHvliSXBbZeD14bvyuFc3IyGUXQWqFgYp6SPGl2wiaOscmBV72VOw1qnk7X6gJK3BuD3E6diHIF_GKzjpjVUcFKg_6ErcF_Ub8cQ6BbU2N-qVytVKzLjm1t8N-X2EChyEyoI4uANDaN0_LlaCAy_cTUs0ijkxJDxQwY60wiSpezbyVEVJIRWAFUl3eS-xcpajrzpnkq7Ue4cmLuQNYRCg5rUU8A',
      createdAt: '2026-09-28T09:30:00.000Z'
    }
  ],
  auditLogs: [
    {
      id: 'aud-101',
      actor: 'Lucas Rocha (Super Admin)',
      action: 'POLICY_UPDATE',
      entity: 'Workspace: Minha Empresa / RBAC Permissions',
      timestamp: '2026-09-28T10:14:22.000Z',
      result: 'SUCCESS',
      ip: '189.40.12.88',
      device: 'Chrome 128 / Windows 11'
    },
    {
      id: 'aud-102',
      actor: 'Ana Rodrigues (Manager)',
      action: 'MEMBER_INVITE',
      entity: 'User: dev.lead@taskly.io',
      timestamp: '2026-09-28T09:30:11.000Z',
      result: 'SUCCESS',
      ip: '177.18.90.41',
      device: 'Safari 17 / macOS Sonoma'
    }
  ],
  apiKeys: [
    {
      id: 'key-1',
      workspaceId: 'ws-1',
      name: 'CI/CD GitHub Actions Deployer',
      keyPrefix: 'tsk_live_8f9a',
      keyHash: crypto.createHash('sha256').update('tsk_live_secret_1').digest('hex'),
      scopes: ['tasks:read', 'tasks:write', 'projects:read'],
      createdAt: '2026-09-15T12:00:00.000Z',
      lastUsedAt: '2026-09-28T08:00:00.000Z'
    }
  ],
  webhooks: [
    {
      id: 'wh-1',
      workspaceId: 'ws-1',
      name: 'Webhook de exemplo',
      url: 'https://example.com/webhooks/taskly',
      events: ['task.created', 'task.completed', 'task.priority_urgent'],
      secret: 'whsec_984f7b2a1e0c',
      active: true,
      createdAt: '2026-09-10T14:00:00.000Z'
    }
  ],
  featureFlags: [
    { id: 'flag-advanced-analytics', name: 'Advanced BI & Cohort Reports', enabled: true, description: 'Gráficos de dispersão e tempo médio de conclusão preditivo' },
    { id: 'flag-ai-task-summary', name: 'AI Auto-Summarization & Subtasks', enabled: true, description: 'Geração automática de checklists a partir da descrição técnica' },
    { id: 'flag-beta-calendar', name: 'Interactive Gantt Drag & Drop', enabled: true, description: 'Redimensionamento de prazos e dependências visuais' },
    { id: 'flag-saml-sso', name: 'Enterprise SAML / Okta SSO', enabled: false, description: 'Login corporativo federado com SCIM provisioning' }
  ],
  savedReports: [
    {
      id: 'rep-1',
      workspaceId: 'ws-1',
      name: 'Backend Team — Velocidade & Gargalos Mensais',
      filters: { projectId: 'proj-1', priority: 'High', dateRange: 'This Month' },
      createdAt: '2026-09-20T10:00:00.000Z'
    }
  ],
  files: [
    {
      id: 'file-1',
      projectId: 'proj-1',
      name: 'oauth2-sequence-diagram.png',
      size: 1468006,
      formattedSize: '1.4 MB',
      mimeType: 'image/png',
      uploadedBy: 'Lucas Rocha',
      uploadedById: 'usr-1',
      createdAt: '2026-09-22T14:30:00.000Z'
    },
    {
      id: 'file-2',
      projectId: 'proj-1',
      name: 'security_audit_spec.pdf',
      size: 430080,
      formattedSize: '420 KB',
      mimeType: 'application/pdf',
      uploadedBy: 'Ana Rodrigues',
      uploadedById: 'usr-2',
      createdAt: '2026-09-24T11:20:00.000Z'
    }
  ],
  invitations: [
    {
      token: 'inv_sec_88492019aebf',
      workspaceId: 'ws-1',
      email: 'dev.lead@taskly.io',
      role: 'Manager',
      invitedBy: 'usr-1',
      expiresAt: '2026-10-05T00:00:00.000Z',
      used: false
    }
  ]
};

const SCHEMA_VERSION = 3;
const DEMO_PASSWORD = 'taskly123';
const DEFAULT_COLUMNS = [
  { name: 'Backlog', statusKey: 'Backlog', color: '#666666', wipLimit: null },
  { name: 'A Fazer', statusKey: 'To Do', color: '#A0A0A0', wipLimit: null },
  { name: 'Em Andamento', statusKey: 'In Progress', color: '#3B82F6', wipLimit: 6 },
  { name: 'Em Revisão', statusKey: 'Review', color: '#F59E0B', wipLimit: 4 },
  { name: 'Testes & QA', statusKey: 'Testing', color: '#EC4899', wipLimit: 5 },
  { name: 'Concluído', statusKey: 'Done', color: '#10B981', wipLimit: null }
];

export function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

// Earlier seeds shipped this placeholder, which matches no password at all
// (login only worked through a hardcoded bypass that has been removed).
const BROKEN_SEED_HASH = '$2a$10$e8wF5qO8qj5jY7R4hQ8h0uXQ7V6wR.qH9yQ2cK4mK9z8k3h2b1m2.';

function isValidBcrypt(hash) {
  if (hash === BROKEN_SEED_HASH) return false;
  if (typeof hash !== 'string' || !/^\$2[aby]\$\d{2}\$.{53}$/.test(hash)) return false;
  try {
    return bcrypt.getRounds(hash) > 0;
  } catch {
    return false;
  }
}

// Upgrades databases created by earlier versions of Taskly in place.
function migrate(data) {
  const now = new Date().toISOString();
  const collections = [
    'users', 'workspaces', 'projects', 'columns', 'tasks', 'milestones', 'projectTemplates',
    'automations', 'automationLogs', 'notifications', 'auditLogs', 'apiKeys', 'webhooks',
    'webhookDeliveries', 'featureFlags', 'savedReports', 'files', 'invitations', 'sessions',
    'passwordResets', 'activity', 'systemEvents', 'securityIncidents', 'privacyRequests', 'mfaChallenges', 'emailVerifications'
  ];
  collections.forEach(c => { if (!Array.isArray(data[c])) data[c] = []; });
  data.meta = data.meta || {};
  data.systemSettings = data.systemSettings || { allowSignup: true, maintenanceBanner: '', sessionDays: 7 };
  const fromVersion = data.meta.schemaVersion || 1;
  if (fromVersion >= SCHEMA_VERSION) return false;
  if (fromVersion < 2) {

  const demoHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  data.users.forEach(u => {
    if (u.passwordHash !== 'OAUTH2_FEDERATED' && !isValidBcrypt(u.passwordHash)) u.passwordHash = demoHash;
    if (u.passwordHash === 'OAUTH2_FEDERATED') u.passwordHash = null;
    u.favoriteProjects = u.favoriteProjects || data.projects
      .filter(p => p.isFavorite && (p.members || []).includes(u.id)).map(p => p.id);
    u.onboardingCompleted = u.onboardingCompleted ?? true;
    u.preferences = u.preferences || { theme: 'dark', language: 'pt-BR' };
    const np = u.notificationPreferences || {};
    u.notificationPreferences = {
      inApp: np.inApp ?? true,
      email: np.email ?? true,
      events: {
        assignment: { inApp: np.taskAssignments ?? true, email: np.email ?? true },
        mention: { inApp: np.mentions ?? true, email: np.email ?? true },
        comment: { inApp: true, email: false },
        deadline: { inApp: np.deadlines ?? true, email: np.email ?? true },
        automation: { inApp: true, email: false },
        invitation: { inApp: true, email: true },
        security: { inApp: true, email: true }
      }
    };
    u.dashboardLayout = Array.isArray(u.dashboardLayout)
      ? u.dashboardLayout.map(w => ({ metrics: 'metrics', today: 'my-tasks', upcoming: 'upcoming', projects: 'projects', activity: 'activity', charts: 'reports' }[w] || w))
      : undefined;
  });

  data.workspaces.forEach(w => {
    w.archivedAt = w.archivedAt ?? null;
    w.settings = w.settings || { defaultTaskType: 'Task', weekStartsOn: 1 };
  });

  data.projects.forEach(p => {
    delete p.isFavorite;
    delete p.health;
    p.archivedAt = p.archivedAt ?? null;
    p.deletedAt = p.deletedAt ?? null;
    p.startDate = p.startDate || (p.createdAt || now).slice(0, 10);
    if (!data.columns.some(c => c.projectId === p.id)) {
      DEFAULT_COLUMNS.forEach((col, order) => data.columns.push({ id: newId('col'), projectId: p.id, ...col, order }));
    }
  });

  let maxSeq = 1000;
  data.tasks.forEach(t => {
    const n = parseInt(String(t.id).replace(/\D/g, ''), 10);
    if (n > maxSeq) maxSeq = n;
    (t.activities || []).forEach((a, i) => {
      data.activity.push({
        id: newId('act'), workspaceId: t.workspaceId, projectId: t.projectId, taskId: t.id,
        actorId: null, actor: a.actor, type: 'task.updated', message: a.action,
        createdAt: new Date(Date.parse(t.createdAt || now) + (10 - i) * 60000).toISOString()
      });
    });
    delete t.activities;
    delete t.blocks;
    t.blockedBy = Array.isArray(t.blockedBy) ? t.blockedBy : [];
    t.archivedAt = t.archivedAt ?? null;
    t.deletedAt = t.deletedAt ?? null;
    t.completedAt = t.completedAt ?? (t.status === 'Done' ? (t.updatedAt || t.createdAt || now) : null);
    t.recurrence = t.recurrence || (t.isRecurring ? { interval: t.recurringInterval || 'weekly', every: 1, time: null } : null);
    t.subtaskOf = t.subtaskOf ?? null;
    t.checklist = Array.isArray(t.checklist) ? t.checklist : [];
    t.comments = (t.comments || []).map(c => ({ ...c, createdAt: c.createdAt || t.createdAt || now }));
    (t.attachments || []).forEach(a => {
      if (!data.files.some(f => f.name === a.name && f.projectId === t.projectId)) return;
      const f = data.files.find(f => f.name === a.name && f.projectId === t.projectId);
      f.taskId = t.id;
    });
    delete t.attachments;
  });
  data.meta.taskSeq = Math.max(data.meta.taskSeq || 0, maxSeq);

  data.files.forEach(f => {
    const project = data.projects.find(p => p.id === f.projectId);
    f.workspaceId = f.workspaceId || project?.workspaceId || null;
    f.storageKey = f.storageKey ?? null;
    f.deletedAt = f.deletedAt ?? null;
    f.taskId = f.taskId ?? null;
  });

  data.notifications.forEach(n => {
    n.archived = n.archived ?? false;
    n.createdAt = n.createdAt || now;
    delete n.timestamp;
  });

  data.automations = data.automations.map(a => {
    if (a.definition) return a;
    const definition = a.id === 'aut-1'
      ? { trigger: { type: 'task.priority_changed', value: 'Urgent' }, conditions: [], actions: [{ type: 'notify', target: 'project_managers' }] }
      : a.id === 'aut-2'
        ? { trigger: { type: 'task.status_changed', value: 'Review' }, conditions: [{ field: 'priority', op: 'eq', value: 'High' }], actions: [{ type: 'notify', target: 'project_managers' }] }
        : { trigger: { type: 'task.created', value: null }, conditions: [{ field: 'priority', op: 'eq', value: 'Urgent' }], actions: [{ type: 'notify', target: 'assignee' }] };
    const title = a.id === 'aut-2' ? 'Avisar gestores quando tarefa de alta prioridade entrar em Revisão' : a.title;
    return {
      id: a.id, workspaceId: a.workspaceId, title, description: '', projectId: null, enabled: a.enabled !== false,
      definition, executionsCount: a.executionsCount || 0, lastTriggeredAt: null,
      createdBy: null, createdAt: a.createdAt || now
    };
  });

  data.automationLogs.forEach(l => { l.error = l.error ?? null; });

  data.webhooks.forEach(w => {
    w.retryPolicy = w.retryPolicy || { maxAttempts: 3, backoffSeconds: 5 };
    w.lastDeliveryAt = w.lastDeliveryAt ?? null;
    w.lastStatus = w.lastStatus ?? null;
  });

  data.apiKeys.forEach(k => {
    k.revokedAt = k.revokedAt ?? null;
    k.createdBy = k.createdBy || data.workspaces.find(w => w.id === k.workspaceId)?.ownerId || null;
  });

  data.invitations = data.invitations.map(i => {
    if (i.tokenHash) return i;
    const { token, ...rest } = i;
    return {
      id: newId('inv'), ...rest,
      tokenHash: crypto.createHash('sha256').update(token || crypto.randomBytes(16).toString('hex')).digest('hex'),
      usedAt: i.used ? now : null, revokedAt: null, createdAt: i.createdAt || now
    };
  });
  data.invitations.forEach(i => { delete i.used; });

  data.featureFlags.forEach(f => {
    f.key = f.key || f.id.replace(/^flag-/, '');
    f.updatedAt = f.updatedAt || now;
  });

  data.projectTemplates.forEach(t => {
    t.workspaceId = t.workspaceId ?? null; // null = built-in template
    t.taskTypes = t.taskTypes || ['Task', 'Bug', 'Feature', 'Improvement', 'Research', 'Meeting'];
    t.milestones = t.milestones || [];
    t.tasks = t.tasks || [];
    t.automations = t.automations || [];
  });
  if (!data.projectTemplates.some(t => t.id === 'tpl-study')) {
    data.projectTemplates.push(
      { id: 'tpl-study', name: 'Study Project', description: 'Organize matérias, leituras, exercícios e revisões.', columns: ['Para Estudar', 'Estudando', 'Revisão', 'Dominado'], defaultTags: ['Leitura', 'Exercício', 'Prova'], icon: 'school', workspaceId: null, taskTypes: ['Task', 'Research'], milestones: [{ name: 'Primeira avaliação', offsetDays: 30 }], tasks: [{ title: 'Montar cronograma de estudos', type: 'Task', priority: 'High' }], automations: [] },
      { id: 'tpl-website', name: 'Website', description: 'Do briefing ao lançamento: conteúdo, design, desenvolvimento e SEO.', columns: ['Briefing', 'Conteúdo', 'Design', 'Desenvolvimento', 'Revisão', 'Publicado'], defaultTags: ['Conteúdo', 'Design', 'SEO', 'Frontend'], icon: 'language', workspaceId: null, taskTypes: ['Task', 'Bug', 'Feature'], milestones: [{ name: 'Layout aprovado', offsetDays: 14 }, { name: 'Go-live', offsetDays: 45 }], tasks: [{ title: 'Levantar requisitos e mapa do site', type: 'Research', priority: 'High' }, { title: 'Definir identidade visual', type: 'Task', priority: 'Normal' }], automations: [] }
    );
  }

  }
  if (fromVersion < 3) migrateV3(data);
  data.meta.schemaVersion = SCHEMA_VERSION;
  return true;
}

// v3 — privacy & security hardening (LGPD review).
function migrateV3(data) {
  const now = new Date().toISOString();
  const EXTERNAL_AVATAR = /^https?:\/\/(lh3\.googleusercontent\.com|images\.unsplash\.com)\//;
  data.users.forEach(u => {
    // Existing accounts predate e-mail verification and are grandfathered in.
    u.emailVerified = u.emailVerified ?? true;
    // Third-party avatar URLs leak every viewer's IP to that host; use initials instead.
    if (u.avatar && EXTERNAL_AVATAR.test(u.avatar)) u.avatar = null;
    u.mfa = u.mfa || { enabled: false };
    u.failedLogins = u.failedLogins || { count: 0, lockedUntil: null };
    u.knownDevices = u.knownDevices || [];
    delete u.role; // global role was never used for authorization; workspace roles are.
  });
  data.tasks.forEach(t => (t.comments || []).forEach(c => { if (c.userAvatar && EXTERNAL_AVATAR.test(c.userAvatar)) c.userAvatar = null; }));
  data.notifications.forEach(n => { if (n.avatar && EXTERNAL_AVATAR.test(n.avatar)) n.avatar = null; });
  data.webhooks.forEach(w => { w.secret = seal(unseal(w.secret)); });
  data.systemSettings.requireMfaForAdmins = data.systemSettings.requireMfaForAdmins ?? true;
  data.systemSettings.privacy = data.systemSettings.privacy || {
    controllerName: '', controllerDocument: '', controllerAddress: '', contactEmail: '',
    dpoName: '', dpoEmail: '', policyVersion: '0.1-rascunho', policyUpdatedAt: now.slice(0, 10), reviewedByLegal: false
  };
  // Remove e-mails from audit actor labels and seal the existing log into a hash chain.
  let prev = 'genesis';
  data.auditLogs.forEach(e => {
    if (typeof e.actor === 'string') e.actor = e.actor.replace(/\s*<[^>]+>/, '');
    delete e.hash; delete e.prevHash;
    e.prevHash = prev;
    e.hash = hashAuditEntry(e, prev);
    prev = e.hash;
  });
  data.meta.auditChainHead = prev === 'genesis' ? undefined : prev;
}

// Demo accounts (with a publicly known password) are only seeded outside
// production. A production database starts with no users; the first Super
// Admin is granted from the console (npm run admin:grant).
export function initialData() {
  const seed = JSON.parse(JSON.stringify(defaultData));
  if (process.env.NODE_ENV !== 'production' && process.env.TASKLY_DEMO_SEED !== 'false') return seed;
  return { projectTemplates: seed.projectTemplates, featureFlags: seed.featureFlags };
}

// Brings any dataset (fresh, file or D1) to the current schema.
export function prepareData(data) {
  return migrate(data);
}

class Database {
  constructor() {
    this._data = null;
    this._inTransaction = false;
  }

  // Inside a Worker request the state belongs to that request; otherwise
  // (Node) it is the file-backed dataset, loaded on first use.
  get data() {
    const store = requestStore.getStore();
    if (store) return store.data;
    // There is no filesystem dataset on Workers: every access must run inside
    // a D1 store (request middleware, withD1Store or detached()).
    if (IS_WORKER) throw new Error('Acesso ao banco fora de um contexto D1');
    if (!this._data) this.init();
    return this._data;
  }

  set data(value) {
    const store = requestStore.getStore();
    if (store) store.data = value;
    else this._data = value;
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      this.data = initialData();
    } else {
      try {
        this.data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      } catch (err) {
        // Never silently overwrite a corrupted database: keep a copy for recovery.
        const backup = `${DB_FILE}.corrupt-${Date.now()}`;
        fs.copyFileSync(DB_FILE, backup);
        console.error(`[db] Failed to parse database, backup saved to ${backup}. Starting from seed.`);
        this.data = JSON.parse(JSON.stringify(defaultData));
      }
    }
    if (migrate(this.data) || !fs.existsSync(DB_FILE)) this.save();
  }

  save() {
    const store = requestStore.getStore();
    if (store) { store.dirty = true; return; } // flushed to D1 at the end of the request
    if (this._inTransaction) return;
    const tempPath = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_FILE);
  }

  // Runs fn atomically: either every change is persisted, or none are.
  // `fn` is synchronous, so concurrent Worker requests cannot interleave inside it.
  transaction(fn) {
    const snapshot = JSON.stringify(this.data);
    this._inTransaction = true;
    try {
      const result = fn();
      this._inTransaction = false;
      this.save();
      return result;
    } catch (err) {
      this._inTransaction = false;
      this.data = JSON.parse(snapshot);
      throw err;
    }
  }

  nextTaskId() {
    this.data.meta.taskSeq = (this.data.meta.taskSeq || 1000) + 1;
    return `TSK-${this.data.meta.taskSeq}`;
  }

  // Generic collection helpers
  get(collection) {
    if (!this.data[collection]) this.data[collection] = [];
    return this.data[collection];
  }

  find(collection, predicate) {
    return this.get(collection).find(predicate);
  }

  filter(collection, predicate) {
    return this.get(collection).filter(predicate);
  }

  insert(collection, item) {
    if (!this.data[collection]) this.data[collection] = [];
    this.data[collection].push(item);
    this.save();
    return item;
  }

  update(collection, predicate, updates) {
    const list = this.get(collection);
    const idx = list.findIndex(predicate);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
      this.save();
      return list[idx];
    }
    return null;
  }

  remove(collection, predicate) {
    const list = this.get(collection);
    const initialLen = list.length;
    this.data[collection] = list.filter(item => !predicate(item));
    this.save();
    return this.data[collection].length < initialLen;
  }
}

export const db = new Database();
