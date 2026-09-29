import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Icon, IconBtn, Avatar, Menu, Kbd } from '../ui';
import { ROLE_LABEL } from '../../lib/format';

const TITLES = {
  dashboard: 'Dashboard', 'my-tasks': 'Minhas tarefas', projects: 'Projetos', kanban: 'Kanban', calendar: 'Calendário',
  timeline: 'Timeline', reports: 'Relatórios', automations: 'Automações', notifications: 'Notificações', activity: 'Atividade',
  team: 'Equipe', settings: 'Configurações', trash: 'Lixeira', admin: 'Admin Center'
};

export function Header() {
  const { route, params, projects, currentWorkspace, user, auth, unreadCount, navigate, setPaletteOpen, openQuickCreate, setHelpOpen, setShortcutsOpen, setSidebarOpen, logout, switchAccount } = useApp();
  const [accounts, setAccounts] = useState([]);

  // The server decides which accounts are switchable; nothing is filtered here.
  useEffect(() => {
    api.auth.switchableAccounts().then(r => setAccounts(r.accounts)).catch(() => setAccounts([]));
  }, [user?.id]);

  const project = route === 'projects' && params.id ? projects.find(p => p.id === params.id) : null;
  const realUserId = auth.impersonatedBy?.id || user?.id;
  const others = accounts.filter(a => a.id !== user?.id);

  return (
    <>
      {auth.impersonatedBy && (
        <div role="status" className="sticky top-0 z-40 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-[12px] px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Icon name="supervisor_account" size={16} />Você está usando a conta de <strong className="text-amber-200">{user.name}</strong> como {auth.impersonatedBy.name}. Ações são auditadas.</span>
          <button type="button" onClick={() => switchAccount(realUserId)} className="h-6 px-2 rounded-md bg-amber-500/20 hover:bg-amber-500/30 font-semibold">Voltar para minha conta</button>
        </div>
      )}
      <header className="sticky top-0 z-30 h-14 bg-background/85 backdrop-blur-md border-b border-border flex items-center justify-between gap-3 px-3 sm:px-6">
        <div className="flex items-center gap-2 min-w-0">
          <IconBtn icon="menu" label="Abrir menu" className="lg:hidden" onClick={() => setSidebarOpen(true)} />
          <nav aria-label="Trilha" className="flex items-center text-[12px] font-medium text-text-secondary gap-1.5 min-w-0">
            <span className="hidden sm:inline truncate max-w-[160px]">{currentWorkspace?.name}</span>
            <span className="hidden sm:inline text-text-muted">/</span>
            {project ? (
              <>
                <button type="button" onClick={() => navigate('/projects')} className="hover:text-text-primary hidden md:inline">Projetos</button>
                <span className="text-text-muted hidden md:inline">/</span>
                <span className="text-text-primary font-semibold truncate">{project.name}</span>
              </>
            ) : <span className="text-text-primary font-semibold truncate">{TITLES[route] || 'Taskly'}</span>}
          </nav>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5">
          <button type="button" onClick={() => setPaletteOpen(true)} className="hidden md:flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-lg border border-border bg-surface-card text-[12px] text-text-muted hover:text-text-primary transition-colors w-56">
            <Icon name="search" size={15} /><span className="flex-1 text-left">Buscar…</span><Kbd>Ctrl K</Kbd>
          </button>
          <IconBtn icon="search" label="Buscar" className="md:hidden" onClick={() => setPaletteOpen(true)} />
          <IconBtn icon="add_box" label="Nova tarefa (N)" onClick={() => openQuickCreate()} />
          <div className="relative">
            <IconBtn icon="notifications" label={`Notificações${unreadCount ? ` (${unreadCount} não lidas)` : ''}`} onClick={() => navigate('/notifications')} />
            {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-background pointer-events-none" />}
          </div>

          <Menu width={260} trigger={props => (
            <button type="button" onClick={props.toggle} aria-expanded={props['aria-expanded']} aria-haspopup="menu" aria-label="Menu do usuário" className="ml-1 rounded-full hover:ring-2 hover:ring-border-focus transition-shadow">
              <Avatar user={user} size={30} />
            </button>
          )} items={[
            { header: `${user.name} · ${user.email}` },
            ...(currentWorkspace ? [{ header: `${ROLE_LABEL[currentWorkspace.myRole]} em ${currentWorkspace.name}${user.isSuperAdmin ? ' · Super Admin' : ''}` }] : []),
            '-',
            { label: 'Perfil', icon: 'person', onClick: () => navigate('/settings/profile') },
            { label: 'Segurança', icon: 'shield', onClick: () => navigate('/settings/security') },
            { label: 'Configurações', icon: 'settings', onClick: () => navigate('/settings') },
            user.isSuperAdmin && !auth.impersonatedBy ? { label: 'Admin Center', icon: 'admin_panel_settings', onClick: () => navigate('/admin') } : null,
            '-',
            { label: 'Central de ajuda', icon: 'help', onClick: () => setHelpOpen(true) },
            { label: 'Atalhos de teclado', icon: 'keyboard', hint: '?', onClick: () => setShortcutsOpen(true) },
            ...(others.length ? ['-', { header: auth.impersonatedBy ? 'Trocar de conta' : 'Acessar como (suporte)' }, ...others.slice(0, 6).map(a => ({ label: a.id === realUserId ? `${a.name} (minha conta)` : a.name, icon: a.id === realUserId ? 'undo' : 'switch_account', onClick: () => switchAccount(a.id) }))] : []),
            '-',
            { label: 'Sair', icon: 'logout', danger: true, onClick: logout }
          ]} />
        </div>
      </header>
    </>
  );
}
