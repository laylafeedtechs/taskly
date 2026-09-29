import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Icon, Kbd, Avatar } from '../ui';
import { ROLE_LABEL } from '../../lib/format';
import { InstallAppButton } from '../common/InstallAppButton';

const NAV = [
  { section: 'Trabalho', items: [
    { path: '/dashboard', route: 'dashboard', label: 'Dashboard', icon: 'grid_view' },
    { path: '/my-tasks', route: 'my-tasks', label: 'Minhas tarefas', icon: 'task_alt' },
    { path: '/projects', route: 'projects', label: 'Projetos', icon: 'folder_open' }
  ] },
  { section: 'Planejamento', items: [
    { path: '/kanban', route: 'kanban', label: 'Kanban', icon: 'view_kanban' },
    { path: '/calendar', route: 'calendar', label: 'Calendário', icon: 'calendar_month' },
    { path: '/timeline', route: 'timeline', label: 'Timeline', icon: 'view_timeline' }
  ] },
  { section: 'Análise', items: [
    { path: '/reports', route: 'reports', label: 'Relatórios', icon: 'bar_chart' },
    { path: '/activity', route: 'activity', label: 'Atividade', icon: 'history' }
  ] },
  { section: 'Colaboração', items: [
    { path: '/notifications', route: 'notifications', label: 'Notificações', icon: 'notifications', badge: 'unread' },
    { path: '/automations', route: 'automations', label: 'Automações', icon: 'bolt' },
    { path: '/team', route: 'team', label: 'Equipe', icon: 'group' }
  ] },
  { section: 'Sistema', items: [
    { path: '/settings', route: 'settings', label: 'Configurações', icon: 'settings' },
    { path: '/trash', route: 'trash', label: 'Lixeira', icon: 'delete' }
  ] }
];

function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, switchWorkspace, setWorkspaceModal, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 p-2 rounded-xl bg-surface-card border border-border hover:border-border-focus transition-colors text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border border-border" style={{ backgroundColor: `${currentWorkspace?.color || '#3B82F6'}22` }}>
            <Icon name={currentWorkspace?.icon || 'business'} size={17} className="text-text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-text-primary truncate leading-tight">{currentWorkspace?.name || 'Sem workspace'}</div>
            <div className="text-[11px] text-text-muted truncate">{currentWorkspace ? ROLE_LABEL[currentWorkspace.myRole] : '—'}</div>
          </div>
        </div>
        <Icon name="unfold_more" size={16} className="text-text-muted" />
      </button>
      {open && (
        <div role="listbox" aria-label="Workspaces" className="absolute top-full left-0 right-0 mt-1.5 p-1.5 rounded-xl bg-surface border border-border shadow-modal z-50 animate-scaleIn">
          <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">Seus workspaces</div>
          <div className="max-h-64 overflow-y-auto">
            {workspaces.map(ws => (
              <button key={ws.id} role="option" aria-selected={ws.id === currentWorkspace?.id} type="button"
                onClick={() => { switchWorkspace(ws.id); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[12px] text-left transition-colors ${ws.id === currentWorkspace?.id ? 'bg-surface-elevated text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}>
                <span className="flex items-center gap-2 min-w-0"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ws.color }} /><span className="truncate">{ws.name}</span></span>
                <span className="text-[10px] text-text-muted flex-shrink-0">{ROLE_LABEL[ws.myRole]}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-border mt-1 pt-1 flex flex-col">
            <button type="button" onClick={() => { setOpen(false); setWorkspaceModal({}); }} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">
              <Icon name="add" size={15} />Novo workspace
            </button>
            <button type="button" onClick={() => { setOpen(false); navigate('/settings/workspace'); }} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">
              <Icon name="tune" size={15} />Configurar workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { route, navigate, unreadCount, user, favorites, currentWorkspaceId, switchWorkspace, openQuickCreate, setPaletteOpen, sidebarOpen, setSidebarOpen, params } = useApp();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setSidebarOpen(false); }, [route, params.id, setSidebarOpen]);

  const go = path => navigate(path);
  const openFavorite = fav => {
    if (fav.workspaceId !== currentWorkspaceId) switchWorkspace(fav.workspaceId, { keepPath: true });
    navigate(`/projects/${fav.id}/board`);
  };

  const content = (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-3 pt-3.5 pb-3 flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <button type="button" onClick={() => go('/dashboard')} className="flex items-center gap-2" aria-label="Taskly — ir para o dashboard">
            <img src="/logo.svg" alt="" className="w-6 h-6" />
            <span className="text-[15px] font-semibold tracking-tight text-text-primary">Taskly</span>
          </button>
          <button type="button" className="lg:hidden text-text-muted hover:text-text-primary" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><Icon name="close" size={20} /></button>
        </div>

        <WorkspaceSwitcher />

        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => openQuickCreate()} className="w-full flex items-center justify-between bg-inverse text-inverse-text font-semibold text-[13px] h-8 px-3 rounded-lg hover:opacity-90 transition-opacity">
            <span className="flex items-center gap-2"><Icon name="add" size={16} />Nova tarefa</span>
            <kbd className="text-[10px] font-mono px-1 rounded border border-current/30 opacity-60">N</kbd>
          </button>
          <button type="button" onClick={() => setPaletteOpen(true)} className="w-full flex items-center justify-between bg-surface-card text-text-secondary hover:text-text-primary text-[12px] h-8 px-3 rounded-lg border border-border transition-colors">
            <span className="flex items-center gap-2"><Icon name="search" size={15} />Buscar ou executar…</span>
            <span className="flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </button>
        </div>

        {favorites.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="px-2 py-0.5 font-mono text-[10px] tracking-wider text-text-muted uppercase">Favoritos</div>
            {favorites.map(f => {
              const active = route === 'projects' && params.id === f.id;
              return (
                <button key={f.id} type="button" onClick={() => openFavorite(f)} aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] text-left transition-colors ${active ? 'bg-surface-elevated text-text-primary font-semibold' : 'text-text-secondary hover:text-text-primary hover:bg-surface-card'}`}>
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: f.color }} />
                  <span className="truncate">{f.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <nav aria-label="Navegação principal" className="flex flex-col gap-3.5">
          {[...NAV, ...(user?.isSuperAdmin ? [{ section: 'Plataforma', items: [{ path: '/admin', route: 'admin', label: 'Admin Center', icon: 'admin_panel_settings' }] }] : [])].map(section => (
            <div key={section.section} className="flex flex-col gap-0.5">
              <div className="px-2 py-0.5 font-mono text-[10px] tracking-wider text-text-muted uppercase">{section.section}</div>
              {section.items.map(item => {
                const active = route === item.route;
                return (
                  <button key={item.path} type="button" onClick={() => go(item.path)} aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${active ? 'bg-surface-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-card'}`}>
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon name={item.icon} size={17} className={active ? 'text-text-primary' : 'text-text-muted'} filled={active} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.badge === 'unread' && unreadCount > 0 && (
                      <span className="font-mono text-[10px] min-w-[18px] h-[18px] px-1 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-semibold" aria-label={`${unreadCount} não lidas`}>{unreadCount > 99 ? '99+' : unreadCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </div>

      <div className="p-2.5 border-t border-border flex flex-col gap-2">
        <InstallAppButton />
        <button type="button" onClick={() => go('/settings/profile')} className="w-full flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-surface-card transition-colors text-left">
          <Avatar user={user} size={28} />
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-text-primary truncate">{user?.name}</div>
            <div className="text-[11px] text-text-muted truncate">{user?.email}</div>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block fixed left-0 top-0 h-screen w-64 bg-background-secondary border-r border-border z-40">{content}</aside>
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-[100]">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
          <aside className="absolute left-0 top-0 h-full w-[280px] max-w-[85vw] bg-background-secondary border-r border-border animate-slideInLeft" role="dialog" aria-label="Menu">{content}</aside>
        </div>
      )}
    </>
  );
}
