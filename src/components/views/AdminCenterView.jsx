import React from 'react';
import { useApp } from '../../context/AppContext';
import { Btn, EmptyState, PageHeader, Tabs } from '../ui';
import { AdminDashboard, AdminReports } from '../admin/AdminDashboard';
import { AdminUsers } from '../admin/AdminUsers';
import { AdminProjects, AdminWorkspaces } from '../admin/AdminEntities';
import { AuditLogs, SystemEvents } from '../admin/AdminLogs';
import { AdminFlags, AdminSystemSettings } from '../admin/AdminConfig';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'monitoring', Component: AdminDashboard },
  { id: 'users', label: 'Usuários', icon: 'group', Component: AdminUsers },
  { id: 'workspaces', label: 'Workspaces', icon: 'business', Component: AdminWorkspaces },
  { id: 'projects', label: 'Projetos', icon: 'folder', Component: AdminProjects },
  { id: 'reports', label: 'Relatórios', icon: 'analytics', Component: AdminReports },
  { id: 'events', label: 'Atividade do sistema', icon: 'monitor_heart', Component: SystemEvents },
  { id: 'audit', label: 'Logs de auditoria', icon: 'policy', Component: AuditLogs },
  { id: 'flags', label: 'Feature flags', icon: 'flag', Component: AdminFlags },
  { id: 'system', label: 'Configurações do sistema', icon: 'tune', Component: AdminSystemSettings }
];

export function AdminCenterView() {
  const { user, params, navigate } = useApp();

  if (!user?.isSuperAdmin) {
    return (
      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
        <EmptyState icon="lock" title="Acesso restrito" description="O Admin Center está disponível apenas para Super Admins da plataforma."
          action={<Btn icon="arrow_back" onClick={() => navigate('/dashboard')}>Voltar ao dashboard</Btn>} />
      </div>
    );
  }

  const active = SECTIONS.find(s => s.id === params.id) || SECTIONS[0];
  const { Component } = active;

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader icon="admin_panel_settings" title="Admin Center" description="Administração da plataforma. Todas as ações são registradas nos logs de auditoria." />
      <Tabs className="mb-5 pb-1 border-b border-border" tabs={SECTIONS} value={active.id} onChange={id => navigate(`/admin/${id}`)} />
      <section aria-label={active.label}>
        <Component key={active.id} />
      </section>
    </div>
  );
}
