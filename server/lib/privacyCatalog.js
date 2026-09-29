// Technical facts used to build the Privacy Center and the privacy-policy
// draft. Legal content (legal bases, controller data, DPO) must be completed
// and reviewed by the controller's legal counsel — see docs/lgpd/.

export const DATA_CATEGORIES = [
  { key: 'identification', label: 'Identificação e contato', fields: 'Nome, e-mail', purpose: 'Criar e manter a conta, autenticar, enviar comunicações operacionais', retention: 'Enquanto a conta existir' },
  { key: 'credentials', label: 'Credenciais', fields: 'Hash da senha (bcrypt), segredo MFA cifrado, códigos de recuperação (hash), vínculo Google (identificador)', purpose: 'Autenticação e segurança da conta', retention: 'Enquanto a conta existir' },
  { key: 'profile', label: 'Perfil', fields: 'Foto de perfil (opcional), preferências de tema, idioma, notificações e dashboard', purpose: 'Personalização da experiência', retention: 'Enquanto a conta existir' },
  { key: 'workspace', label: 'Colaboração', fields: 'Workspaces, papéis, projetos, tarefas atribuídas, comentários, anexos e menções', purpose: 'Prestação do serviço de gestão de projetos', retention: 'Enquanto o workspace existir; itens excluídos ficam na lixeira pelo prazo configurado' },
  { key: 'activity', label: 'Histórico de atividade', fields: 'Ações em tarefas e projetos (quem, o quê, quando)', purpose: 'Histórico do trabalho e rastreabilidade dentro do workspace', retention: 'Enquanto o workspace existir' },
  { key: 'security', label: 'Segurança e auditoria', fields: 'Sessões (IP, navegador), registros de auditoria (IP, navegador, ação), eventos de segurança', purpose: 'Prevenção a fraudes, investigação de incidentes e cumprimento de obrigações', retention: 'Sessões: até expirar; IP/navegador na auditoria: truncados após o prazo configurado; auditoria: prazo configurado' },
  { key: 'notifications', label: 'Notificações', fields: 'Conteúdo das notificações recebidas', purpose: 'Informar o usuário sobre eventos relevantes', retention: 'Prazo configurado (padrão 180 dias)' }
];

export const COOKIES = [
  { name: 'taskly_session', category: 'Estritamente necessário', provider: 'Taskly (primeira parte)', purpose: 'Manter a sessão autenticada (HttpOnly, Secure, SameSite=Lax)', duration: 'Até 7 dias (configurável) ou 3 dias de inatividade' },
  { name: 'taskly_oauth', category: 'Estritamente necessário', provider: 'Taskly (primeira parte)', purpose: 'Proteger o fluxo de login com Google (state, nonce, PKCE)', duration: '10 minutos' }
];

export const LOCAL_STORAGE = [
  { name: 'taskly.workspace', purpose: 'Lembrar o workspace selecionado' },
  { name: 'taskly.filters.*, taskly.reports.*, kanban.*, taskly.projects.*', purpose: 'Lembrar filtros e preferências de visualização' },
  { name: 'taskly.invite (sessionStorage)', purpose: 'Guardar temporariamente um convite até o login; removido após o uso' }
];

// Processors / third parties actually contacted by this installation.
export function processors() {
  return [
    { name: 'Google (OAuth 2.0 / OpenID Connect)', active: Boolean(process.env.GOOGLE_CLIENT_ID), data: 'Somente quando o usuário escolhe "Continuar com Google": identificador Google, nome e e-mail verificado', location: 'Pode envolver transferência internacional (EUA)' },
    { name: 'Provedor de e-mail (SMTP)', active: Boolean(process.env.SMTP_HOST), data: 'E-mail e nome do destinatário e conteúdo da mensagem (convites, redefinição de senha, notificações)', location: 'Depende do provedor configurado' },
    { name: 'Hospedagem / proxy de rede', active: true, data: 'Todo o tráfego da aplicação (IP, requisições)', location: process.env.HOSTING_PROVIDER || 'A definir pelo controlador (ex.: Cloudflare Tunnel no ambiente atual)' },
    { name: 'Destinos de webhooks configurados pelos workspaces', active: true, data: 'Identificadores e status de tarefas/projetos dos eventos escolhidos (sem nomes, e-mails ou comentários)', location: 'Definido por cada workspace' }
  ];
}

export const REQUEST_TYPES = {
  confirmation: 'Confirmação da existência de tratamento',
  access: 'Acesso aos dados',
  correction: 'Correção de dados incompletos, inexatos ou desatualizados',
  anonymization: 'Anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos',
  portability: 'Portabilidade dos dados',
  deletion: 'Eliminação dos dados',
  sharing: 'Informação sobre compartilhamento',
  consent: 'Informação sobre não fornecer consentimento / revogação do consentimento',
  objection: 'Oposição a tratamento',
  review: 'Revisão de decisão automatizada',
  other: 'Outra solicitação'
};
