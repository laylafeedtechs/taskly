import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useDebounce } from '../../lib/hooks';
import { Icon, Kbd, Spinner, Avatar } from '../ui';

const GROUP_LABEL = { actions: 'Ações', tasks: 'Tarefas', projects: 'Projetos', campaigns: 'Campanhas', publications: 'Publicações', creatives: 'Criativos', socialAccounts: 'Contas sociais', members: 'Membros', workspaces: 'Workspaces', comments: 'Comentários', files: 'Arquivos' };
const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function SearchPalette() {
  const ctx = useApp();
  const { paletteOpen, setPaletteOpen, navigate, openTask, openQuickCreate, setProjectModal, workspaces, currentWorkspaceId, switchWorkspace, user, setUser, setShortcutsOpen, setHelpOpen, setWorkspaceModal, refreshUnread, toast, showError, logout, can } = ctx;
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const debounced = useDebounce(q.trim(), 250);

  useEffect(() => {
    if (paletteOpen) { setQ(''); setResults(null); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [paletteOpen]);

  // Server-side search only returns data from workspaces the user belongs to.
  useEffect(() => {
    if (!paletteOpen || debounced.length < 2) { setResults(null); return undefined; }
    const controller = new AbortController();
    setLoading(true);
    api.search.global(debounced, { signal: controller.signal })
      .then(r => { setResults(r); setLoading(false); })
      .catch(err => { if (err.name !== 'AbortError') { setLoading(false); setResults(null); } });
    return () => controller.abort();
  }, [debounced, paletteOpen]);

  const close = () => setPaletteOpen(false);
  const go = path => { close(); navigate(path); };

  const actions = useMemo(() => {
    const theme = user?.preferences?.theme === 'light' ? 'dark' : 'light';
    return [
      can('task.create') && { id: 'new-task', icon: 'add_task', label: 'Criar tarefa', hint: 'N', run: () => { close(); openQuickCreate(); } },
      can('project.create') && { id: 'new-project', icon: 'create_new_folder', label: 'Criar projeto', run: () => { close(); setProjectModal({}); } },
      { id: 'dash', icon: 'grid_view', label: 'Ir para o Dashboard', hint: 'G D', run: () => go('/dashboard') },
      { id: 'mine', icon: 'task_alt', label: 'Minhas tarefas', hint: 'G T', run: () => go('/my-tasks') },
      { id: 'projects', icon: 'folder_open', label: 'Abrir projetos', hint: 'P', run: () => go('/projects') },
      { id: 'kanban', icon: 'view_kanban', label: 'Abrir Kanban', hint: 'G K', run: () => go('/kanban') },
      { id: 'calendar', icon: 'calendar_month', label: 'Abrir calendário', hint: 'C', run: () => go('/calendar') },
      { id: 'timeline', icon: 'view_timeline', label: 'Abrir timeline', run: () => go('/timeline') },
      { id: 'reports', icon: 'bar_chart', label: 'Abrir relatórios', hint: 'R', run: () => go('/reports') },
      { id: 'notifications', icon: 'notifications', label: 'Abrir notificações', hint: 'G N', run: () => go('/notifications') },
      { id: 'read-all', icon: 'mark_email_read', label: 'Marcar todas as notificações como lidas', run: async () => { close(); try { await api.notifications.bulkRead(); refreshUnread(); toast('Notificações marcadas como lidas', 'success'); } catch (err) { showError(err); } } },
      { id: 'theme', icon: theme === 'light' ? 'light_mode' : 'dark_mode', label: `Mudar para tema ${theme === 'light' ? 'claro' : 'escuro'}`, run: async () => { close(); try { setUser((await api.auth.updateProfile({ preferences: { ...user.preferences, theme } })).user); } catch (err) { showError(err); } } },
      { id: 'settings', icon: 'settings', label: 'Abrir configurações', hint: 'G S', run: () => go('/settings') },
      { id: 'automations', icon: 'bolt', label: 'Abrir automações', run: () => go('/automations') },
      can('creatives.view') && { id: 'creatives', icon: 'photo_library', label: 'Abrir Criativos', run: () => go('/creatives') },
      { id: 'team', icon: 'group', label: 'Gerenciar equipe', run: () => go('/team') },
      { id: 'new-ws', icon: 'add_business', label: 'Criar workspace', run: () => { close(); setWorkspaceModal({}); } },
      ...workspaces.filter(w => w.id !== currentWorkspaceId).map(w => ({ id: `ws-${w.id}`, icon: 'swap_horiz', label: `Trocar para workspace: ${w.name}`, run: () => { close(); switchWorkspace(w.id); } })),
      { id: 'shortcuts', icon: 'keyboard', label: 'Ver atalhos de teclado', hint: '?', run: () => { close(); setShortcutsOpen(true); } },
      { id: 'help', icon: 'help', label: 'Central de ajuda', run: () => { close(); setHelpOpen(true); } },
      user?.isSuperAdmin && { id: 'admin', icon: 'admin_panel_settings', label: 'Abrir Admin Center', run: () => go('/admin') },
      { id: 'logout', icon: 'logout', label: 'Sair da conta', run: () => { close(); logout(); } }
    ].filter(Boolean);
  }, [user, workspaces, currentWorkspaceId, can]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const nq = normalize(q.trim());
    const matchedActions = nq ? actions.filter(a => normalize(a.label).includes(nq)) : actions;
    const list = matchedActions.slice(0, nq ? 6 : 12).map(a => ({ ...a, group: 'actions' }));
    if (!results) return list;
    const openWs = (wsId, fn) => () => { close(); if (wsId && wsId !== currentWorkspaceId) switchWorkspace(wsId, { keepPath: true }); fn(); };
    results.tasks.forEach(t => list.push({ id: `t-${t.id}`, group: 'tasks', icon: 'check_box', label: t.title, sub: `${t.id} · ${t.workspaceName}`, run: openWs(t.workspaceId, () => openTask(t.id)) }));
    results.projects.forEach(p => list.push({ id: `p-${p.id}`, group: 'projects', icon: 'folder', color: p.color, label: p.name, sub: p.workspaceName, run: openWs(p.workspaceId, () => navigate(`/projects/${p.id}/board`)) }));
    results.members.forEach(m => list.push({ id: `m-${m.id}`, group: 'members', user: m, label: m.name, sub: m.email, run: () => go('/team') }));
    results.workspaces.forEach(w => list.push({ id: `w-${w.id}`, group: 'workspaces', icon: 'business', color: w.color, label: w.name, run: () => { close(); switchWorkspace(w.id); } }));
    results.comments.forEach(c => list.push({ id: `c-${c.id}`, group: 'comments', icon: 'chat_bubble', label: c.text, sub: `${c.userName} em ${c.taskId}`, run: openWs(c.workspaceId, () => openTask(c.taskId)) }));
    results.files.forEach(f => list.push({ id: `f-${f.id}`, group: 'files', icon: 'attach_file', label: f.name, sub: f.formattedSize, run: openWs(f.workspaceId, () => navigate(`/projects/${f.projectId}/files`)) }));
    (results.campaigns || []).forEach(c => list.push({ id: `cmp-${c.id}`, group: 'campaigns', icon: 'campaign', color: c.color, label: c.name, sub: c.workspaceName, run: openWs(c.workspaceId, () => navigate(c.socialAccountId ? `/creatives/${c.socialAccountId}/campaigns` : '/creatives/campaigns')) }));
    (results.publications || []).forEach(p => list.push({ id: `pub-${p.id}`, group: 'publications', icon: 'photo_library', label: p.title, sub: `${p.username ? `@${p.username} · ` : ''}${p.status}`, run: openWs(p.workspaceId, () => navigate(`/creatives/${p.socialAccountId}/publications?pub=${encodeURIComponent(p.id)}`)) }));
    (results.creatives || []).forEach(c => list.push({ id: `crv-${c.id}`, group: 'creatives', icon: c.kind === 'video' ? 'movie' : 'image', label: c.name, sub: 'Biblioteca de criativos', run: openWs(c.workspaceId, () => navigate('/creatives/library')) }));
    (results.socialAccounts || []).forEach(a => list.push({ id: `sac-${a.id}`, group: 'socialAccounts', icon: 'account_circle', label: `@${a.username}`, sub: a.name, run: openWs(a.workspaceId, () => navigate(`/creatives/${a.id}/feed`)) }));
    return list;
  }, [q, results, actions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setActive(0); }, [items.length, q]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  if (!paletteOpen) return null;

  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  let lastGroup = null;
  const empty = debounced.length >= 2 && !loading && results && items.every(i => i.group === 'actions') && !items.length;

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[10vh] px-3">
      <div className="fixed inset-0 bg-black/60" onClick={close} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Paleta de comandos" className="relative w-full max-w-xl bg-surface border border-border rounded-2xl shadow-modal overflow-hidden animate-scaleIn">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border">
          <Icon name="search" size={18} className="text-text-muted" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            placeholder="Buscar tarefas, projetos, pessoas… ou digite um comando" className="flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none" aria-label="Buscar" />
          {loading && <Spinner size={14} />}
          <Kbd>Esc</Kbd>
        </div>
        <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[60vh] overflow-y-auto p-1.5">
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? GROUP_LABEL[item.group] : null;
            lastGroup = item.group;
            return (
              <React.Fragment key={item.id}>
                {header && <li role="presentation" className="px-2.5 pt-2.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">{header}</li>}
                <li id={`palette-${item.id}`} role="option" aria-selected={i === active} data-index={i}
                  onMouseMove={() => setActive(i)} onClick={() => item.run()}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer ${i === active ? 'bg-surface-elevated' : ''}`}>
                  {item.user ? <Avatar user={item.user} size={20} /> : (
                    <span className="w-5 flex justify-center">{item.color ? <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} /> : <Icon name={item.icon} size={17} className="text-text-muted" />}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-text-primary truncate">{item.label}</div>
                    {item.sub && <div className="text-[11px] text-text-muted truncate">{item.sub}</div>}
                  </div>
                  {item.hint && <span className="text-[10px] font-mono text-text-muted">{item.hint}</span>}
                  {i === active && <Icon name="keyboard_return" size={14} className="text-text-muted" />}
                </li>
              </React.Fragment>
            );
          })}
          {empty && <li className="px-4 py-8 text-center text-[13px] text-text-secondary">Nenhum resultado para “{debounced}”.</li>}
          {!items.length && !empty && <li className="px-4 py-8 text-center text-[13px] text-text-secondary">{loading ? 'Buscando…' : 'Nenhum comando encontrado.'}</li>}
        </ul>
        <div className="flex items-center gap-3 px-4 h-9 border-t border-border text-[11px] text-text-muted">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> abrir</span>
          <span className="ml-auto">A busca respeita suas permissões</span>
        </div>
      </div>
    </div>
  );
}
