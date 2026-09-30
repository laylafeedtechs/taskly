import React from 'react';
import { useApp } from '../../context/AppContext';
import { Btn, EmptyState, PageHeader, Tabs } from '../ui';
import { AdminDashboard, AdminReports } from '../admin/AdminDashboard';
import { AdminUsers } from '../admin/AdminUsers';
import { AdminProjects, AdminWorkspaces } from '../admin/AdminEntities';
import { AuditLogs, SystemEvents } from '../admin/AdminLogs';
import { AdminFlags, AdminSystemSettings } from '../admin/AdminConfig';
import { AdminBackups, AdminIncidents, AdminPrivacy, AdminPrivacyRequests } from '../admin/AdminGovernance';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'monitoring', Component: AdminDashboard },
  { id: 'users', label: 'Usuários', icon: 'group', Component: AdminUsers },
  { id: 'workspaces', label: 'Workspaces', icon: 'business', Component: AdminWorkspaces },
  { id: 'projects', label: 'Projetos', icon: 'folder', Component: AdminProjects },
  { id: 'reports', label: 'Relatórios', icon: 'analytics', Component: AdminReports },
  { id: 'incidents', label: 'Incidentes', icon: 'gpp_maybe', Component: AdminIncidents },
  { id: 'requests', label: 'Solicitações LGPD', icon: 'assignment_ind', Component: AdminPrivacyRequests },
  { id: 'privacy', label: 'Privacidade', icon: 'shield_person', Component: AdminPrivacy },
  { id: 'events', label: 'Atividade do sistema', icon: 'monitor_heart', Component: SystemEvents },
  { id: 'audit', label: 'Logs de auditoria', icon: 'policy', Component: AuditLogs },
  { id: 'backups', label: 'Backups', icon: 'backup', Component: AdminBackups },
  { id: 'flags', label: 'Feature flags', icon: 'flag', Component: AdminFlags },
  { id: 'system', label: 'Configurações do sistema', icon: 'tune', Component: AdminSystemSettings }
];

function Gate({ icon, title, description, action }) {
  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <EmptyState icon={icon} title={title} description={description} action={action} />
    </div>
  );
}

export function AdminCenterView() {
  const { user, auth, params, navigate } = useApp();

  if (!user?.isSuperAdmin) {
    return <Gate icon="lock" title="Acesso restrito" description="O Admin Center está disponível apenas para Super Admins da plataforma."
      action={<Btn icon="arrow_back" onClick={() => navigate('/dashboard')}>Voltar ao dashboard</Btn>} />;
  }
  // The server enforces this too (403 MFA_REQUIRED); here we avoid firing requests that would fail.
  if (auth.requireMfaForAdmins && (!user.mfaEnabled || !auth.sessionMfa)) {
    return <Gate icon="phonelink_lock" title="Ative a verificação em duas etapas para acessar o Admin Center"
      description={user.mfaEnabled ? 'Esta sessão foi aberta sem MFA. Saia e entre novamente usando o código do aplicativo autenticador.' : 'Contas de Super Admin precisam de MFA. Depois de ativar, esta sessão passa a ser verificada automaticamente.'}
      action={<Btn variant="primary" icon="verified_user" onClick={() => navigate('/settings/security')}>Configurar segurança</Btn>} />;
  }

  const active = SECTIONS.find(s => s.id === params.id) || SECTIONS[0];
  const { Component } = active;

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader icon="admin_panel_settings" title="Admin Center" description="Administração da plataforma. Todas as ações, inclusive visualizações, são registradas na auditoria." />
      <Tabs className="mb-5 pb-1 border-b border-border" tabs={SECTIONS} value={active.id} onChange={id => navigate(`/admin/${id}`)} />
      <section aria-label={active.label}>
        <Component key={active.id} />
      </section>
    </div>
  );
}
