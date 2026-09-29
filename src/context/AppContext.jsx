import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';

const AppContext = createContext(null);

// ---------------------------------------------------------------- routing

// URL-based routing so every screen survives a refresh and can be linked.
function parseLocation() {
  const segs = window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(window.location.search));
  return { route: segs[0] || 'dashboard', params: { id: segs[1], tab: segs[2] }, segs, query };
}

const WS_KEY = 'taskly.workspace';
const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* ignore */ } };

export function AppProvider({ children }) {
  const [location, setLocation] = useState(parseLocation);

  const navigate = useCallback((path, { replace = false, keepQuery = false } = {}) => {
    const url = keepQuery ? `${path}${window.location.search}` : path;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
    setLocation(parseLocation());
    window.scrollTo?.(0, 0);
  }, []);

  const setQuery = useCallback((patch) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([k, v]) => (v === null || v === undefined ? params.delete(k) : params.set(k, v)));
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    setLocation(parseLocation());
  }, []);

  useEffect(() => {
    const onPop = () => setLocation(parseLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ------------------------------------------------------------ feedback

  const [toasts, setToasts] = useState([]);
  const removeToast = useCallback(id => setToasts(prev => prev.filter(t => t.id !== id)), []);
  const toast = useCallback((message, type = 'info', action = null) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-3), { id, message, type, action }]);
    setTimeout(() => removeToast(id), action ? 7000 : type === 'error' ? 6000 : 3500);
  }, [removeToast]);

  const [confirmState, setConfirmState] = useState(null);
  // Promise-based confirmation dialog: `if (await confirm({...})) ...`
  const confirm = useCallback(options => new Promise(resolve => setConfirmState({ ...options, resolve })), []);
  const closeConfirm = useCallback(result => { setConfirmState(s => { s?.resolve(result); return null; }); }, []);

  const showError = useCallback((err, fallback = 'Algo deu errado') => {
    toast(err instanceof ApiError || err?.message ? err.message : fallback, 'error');
  }, [toast]);

  // ------------------------------------------------------------------ auth

  const [auth, setAuth] = useState({ status: 'loading', user: null, impersonatedBy: null });
  const [flags, setFlags] = useState({});
  const [maintenanceBanner, setMaintenanceBanner] = useState('');

  const loadSession = useCallback(async () => {
    try {
      const res = await api.auth.me();
      setAuth({ status: 'authed', user: res.user, impersonatedBy: res.session?.impersonatedBy || null, sessionMfa: Boolean(res.session?.mfa), requireMfaForAdmins: res.requireMfaForAdmins !== false });
      api.system.flags().then(r => setFlags(r.flags || {})).catch(() => {});
      return res.user;
    } catch (err) {
      setAuth({ status: err.status === 0 ? 'offline' : 'anon', user: null, impersonatedBy: null });
      return null;
    }
  }, []);

  useEffect(() => { loadSession(); api.system.status().then(r => setMaintenanceBanner(r.maintenanceBanner)).catch(() => {}); }, [loadSession]);

  // E-mail verification links (?verify=) work on any screen, signed in or not.
  useEffect(() => {
    const token = location.query.verify;
    if (!token) return;
    setQuery({ verify: null });
    api.auth.verifyEmail(token)
      .then(() => { toast('E-mail confirmado', 'success'); loadSession(); })
      .catch(err => toast(err.message, 'error'));
  }, [location.query.verify]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onUnauthorized = () => setAuth(a => (a.status === 'authed' ? { status: 'anon', user: null, impersonatedBy: null, expired: true } : a));
    window.addEventListener('taskly:unauthorized', onUnauthorized);
    return () => window.removeEventListener('taskly:unauthorized', onUnauthorized);
  }, []);

  const user = auth.user;
  const setUser = useCallback(u => setAuth(a => ({ ...a, user: u })), []);

  // Theme preference (persisted server-side with the profile).
  useEffect(() => {
    const pref = user?.preferences?.theme || 'dark';
    const apply = () => {
      const theme = pref === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : pref;
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    };
    apply();
    if (pref !== 'system') return undefined;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [user?.preferences?.theme]);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* session may already be gone */ }
    writeStored(WS_KEY, null);
    window.location.href = '/';
  }, []);

  const switchAccount = useCallback(async (userId, reason) => {
    try {
      await api.auth.switchAccount(userId, reason);
      writeStored(WS_KEY, null);
      window.location.href = '/dashboard';
    } catch (err) { showError(err); }
  }, [showError]);

  // ------------------------------------------------------------ workspaces

  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => readStored(WS_KEY));
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);

  const reloadWorkspaces = useCallback(async () => {
    const res = await api.workspaces.list();
    setWorkspaces(res.workspaces);
    setCurrentWorkspaceId(cur => {
      const next = res.workspaces.some(w => w.id === cur) ? cur : res.workspaces[0]?.id || null;
      writeStored(WS_KEY, next);
      return next;
    });
    setWorkspacesLoaded(true);
    return res.workspaces;
  }, []);

  useEffect(() => { if (auth.status === 'authed') reloadWorkspaces().catch(err => { setWorkspacesLoaded(true); showError(err); }); }, [auth.status, reloadWorkspaces, showError]);

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId) || null;
  const permissions = useMemo(() => new Set(currentWorkspace?.permissions || []), [currentWorkspace]);
  // UI hint only: the server enforces every permission independently.
  const can = useCallback(perm => permissions.has(perm), [permissions]);

  // A project page belongs to one workspace, so switching leaves it unless
  // the caller is about to navigate to a project of the new workspace.
  const switchWorkspace = useCallback((id, { keepPath = false } = {}) => {
    setCurrentWorkspaceId(id);
    writeStored(WS_KEY, id);
    const loc = parseLocation();
    if (!keepPath && loc.route === 'projects' && loc.params.id) {
      window.history.pushState({}, '', '/projects');
      setLocation(parseLocation());
    }
  }, []);

  const createWorkspace = useCallback(async data => {
    const res = await api.workspaces.create(data);
    setWorkspaces(prev => [...prev, res.workspace]);
    switchWorkspace(res.workspace.id);
    toast(`Workspace "${res.workspace.name}" criado`, 'success');
    return res.workspace;
  }, [switchWorkspace, toast]);

  // -------------------------------------------------- workspace-scoped data

  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectsState, setProjectsState] = useState({ loading: true, error: null });
  const [tasks, setTasks] = useState([]);
  const [tasksState, setTasksState] = useState({ loading: true, error: null });
  const [columnsByProject, setColumnsByProject] = useState({});
  const [favorites, setFavorites] = useState([]);
  const wsRef = useRef(currentWorkspaceId);
  wsRef.current = currentWorkspaceId;

  const reloadProjects = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws) return;
    setProjectsState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.projects.list(ws);
      if (ws !== wsRef.current) return;
      setProjects(res.projects);
      setProjectsState({ loading: false, error: null });
    } catch (error) { setProjectsState({ loading: false, error }); }
  }, []);

  const reloadTasks = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws) return;
    setTasksState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.tasks.list(ws);
      if (ws !== wsRef.current) return;
      setTasks(res.tasks);
      setTasksState({ loading: false, error: null });
    } catch (error) { setTasksState({ loading: false, error }); }
  }, []);

  const reloadMembers = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      const res = await api.team.members(ws);
      if (ws === wsRef.current) setMembers(res.members);
    } catch { /* members are non-critical for rendering */ }
  }, []);

  const reloadFavorites = useCallback(async () => {
    try { setFavorites((await api.projects.favorites()).projects); } catch { /* ignore */ }
  }, []);

  const loadColumns = useCallback(async (projectId, force = false) => {
    if (!projectId) return [];
    if (!force && columnsByProject[projectId]) return columnsByProject[projectId];
    const res = await api.columns.list(projectId);
    setColumnsByProject(prev => ({ ...prev, [projectId]: res.columns }));
    return res.columns;
  }, [columnsByProject]);

  const setProjectColumns = useCallback((projectId, cols) => setColumnsByProject(prev => ({ ...prev, [projectId]: typeof cols === 'function' ? cols(prev[projectId] || []) : cols })), []);

  useEffect(() => {
    if (auth.status !== 'authed' || !currentWorkspaceId) return;
    setTasks([]); setProjects([]); setMembers([]); setColumnsByProject({});
    reloadProjects(); reloadTasks(); reloadMembers();
  }, [auth.status, currentWorkspaceId, reloadProjects, reloadTasks, reloadMembers]);

  useEffect(() => { if (auth.status === 'authed') reloadFavorites(); }, [auth.status, reloadFavorites]);

  // Load columns for every project once projects are known (Kanban, badges, reports).
  useEffect(() => {
    projects.forEach(p => {
      if (!columnsByProject[p.id]) api.columns.list(p.id).then(r => setColumnsByProject(prev => ({ ...prev, [p.id]: r.columns }))).catch(() => {});
    });
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------- notifications

  const [unreadCount, setUnreadCount] = useState(0);
  const refreshUnread = useCallback(async () => {
    try { setUnreadCount((await api.notifications.list({ limit: 1 })).unreadCount); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (auth.status !== 'authed') return undefined;
    refreshUnread();
    const t = setInterval(refreshUnread, 60000);
    const onFocus = () => refreshUnread();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [auth.status, refreshUnread]);

  // ------------------------------------------------------ task mutations

  // The list only holds active tasks, so archived/deleted ones are dropped.
  const upsertTask = useCallback(task => setTasks(prev => {
    if (task.archivedAt || task.deletedAt) return prev.filter(t => t.id !== task.id);
    return prev.some(t => t.id === task.id) ? prev.map(t => (t.id === task.id ? task : t)) : [task, ...prev];
  }), []);
  const removeTasksLocal = useCallback(ids => setTasks(prev => prev.filter(t => !ids.includes(t.id))), []);

  const createTask = useCallback(async data => {
    const res = await api.tasks.create(wsRef.current, data);
    upsertTask(res.task);
    toast(`Tarefa ${res.task.id} criada`, 'success');
    return res.task;
  }, [upsertTask, toast]);

  // Optimistic update with a reliable rollback; dependency conflicts ask
  // the user whether to override instead of silently failing.
  const updateTask = useCallback(async (id, patch, { silent = false, forceOverride = false } = {}) => {
    let previous;
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      previous = t;
      return { ...t, ...patch };
    }));
    try {
      const res = await api.tasks.update(id, forceOverride ? { ...patch, forceOverride: true } : patch);
      upsertTask(res.task);
      if (res.spawnedTask) {
        upsertTask(res.spawnedTask);
        toast(`Próxima ocorrência criada: ${res.spawnedTask.id} (${res.spawnedTask.dueDate})`, 'info');
      }
      if (!silent && forceOverride) toast('Dependências ignoradas — registrado no histórico', 'warning');
      return res.task;
    } catch (err) {
      if (previous) upsertTask(previous);
      if (err.status === 409 && err.details?.blockedByTasks && !forceOverride) {
        const ok = await confirm({
          title: 'Tarefa bloqueada por dependências',
          message: `${err.message}\n\nDeseja ignorar as dependências e continuar mesmo assim? A decisão ficará registrada no histórico.`,
          confirmLabel: 'Ignorar e continuar',
          danger: true
        });
        if (ok) return updateTask(id, patch, { silent, forceOverride: true });
        return null;
      }
      showError(err);
      return null;
    }
  }, [upsertTask, toast, showError, confirm]);

  const moveTask = useCallback(async (id, status) => {
    const before = tasks.find(t => t.id === id);
    if (!before || before.status === status) return;
    const updated = await updateTask(id, { status }, { silent: true });
    if (updated) {
      toast(`${id} movida`, 'info', { label: 'Desfazer', onClick: () => updateTask(id, { status: before.status }, { forceOverride: true, silent: true }) });
    }
  }, [tasks, updateTask, toast]);

  const deleteTask = useCallback(async id => {
    const task = tasks.find(t => t.id === id);
    try {
      const res = await api.tasks.remove(id);
      removeTasksLocal(res.deletedIds);
      if (drawerTaskIdRef.current === id) setQuery({ task: null });
      toast(`${id} movida para a lixeira`, 'warning', {
        label: 'Desfazer',
        onClick: async () => {
          try { await api.trash.restore('task', id); if (task) upsertTask(task); reloadTasks(); toast('Tarefa restaurada', 'success'); } catch (err) { showError(err); }
        }
      });
      return true;
    } catch (err) { showError(err); return false; }
  }, [tasks, removeTasksLocal, toast, upsertTask, reloadTasks, showError, setQuery]);

  const archiveTask = useCallback(async (id, archived = true) => {
    try {
      const res = await api.tasks.archive(id, archived);
      if (archived) removeTasksLocal([id]); else upsertTask(res.task);
      toast(archived ? `${id} arquivada` : `${id} desarquivada`, 'info', archived ? { label: 'Desfazer', onClick: () => archiveTask(id, false) } : null);
    } catch (err) { showError(err); }
  }, [removeTasksLocal, upsertTask, toast, showError]);

  const BULK_LABEL = { STATUS: 'Status alterado', PRIORITY: 'Prioridade alterada', ASSIGNEE: 'Responsável alterado', DUE_DATE: 'Prazo alterado', ADD_TAG: 'Tag adicionada', REMOVE_TAG: 'Tag removida', DELETE: 'Movidas para a lixeira', ARCHIVE: 'Arquivadas', MOVE_PROJECT: 'Movidas de projeto' };

  const bulkAction = useCallback(async (taskIds, action, value) => {
    if (!taskIds.length) return false;
    if (action === 'DELETE' || action === 'ARCHIVE') {
      const ok = await confirm({
        title: action === 'DELETE' ? `Excluir ${taskIds.length} tarefa(s)?` : `Arquivar ${taskIds.length} tarefa(s)?`,
        message: action === 'DELETE' ? 'As tarefas irão para a lixeira e poderão ser restauradas.' : 'Tarefas arquivadas saem do quadro, mas continuam nos relatórios.',
        confirmLabel: action === 'DELETE' ? 'Mover para a lixeira' : 'Arquivar',
        danger: action === 'DELETE'
      });
      if (!ok) return false;
    }
    try {
      const res = await api.tasks.bulk(taskIds, action, value, { confirm: action === 'DELETE' });
      if (action === 'DELETE' || action === 'ARCHIVE') removeTasksLocal(taskIds);
      else res.tasks.forEach(upsertTask);
      toast(`${BULK_LABEL[action]} em ${res.count} tarefa(s)`, 'success', {
        label: 'Desfazer',
        onClick: async () => {
          try { await api.tasks.bulkUndo(res.undo); await reloadTasks(); toast('Ação desfeita', 'success'); } catch (err) { showError(err); }
        }
      });
      return true;
    } catch (err) {
      if (err.status === 409) toast(`${err.message} Use a opção de ignorar dependências na tarefa individual.`, 'error');
      else showError(err);
      return false;
    }
  }, [confirm, removeTasksLocal, upsertTask, toast, reloadTasks, showError]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------- project mutations

  const upsertProject = useCallback(p => setProjects(prev => (prev.some(x => x.id === p.id) ? prev.map(x => (x.id === p.id ? p : x)) : [...prev, p])), []);

  const toggleFavorite = useCallback(async project => {
    const next = !project.isFavorite;
    upsertProject({ ...project, isFavorite: next });
    try {
      await api.projects.favorite(project.id, next);
      reloadFavorites();
    } catch (err) { upsertProject(project); showError(err); }
  }, [upsertProject, reloadFavorites, showError]);

  const deleteProject = useCallback(async project => {
    const ok = await confirm({ title: `Excluir "${project.name}"?`, message: 'O projeto e suas tarefas irão para a lixeira. Você poderá restaurá-lo depois.', confirmLabel: 'Mover para a lixeira', danger: true });
    if (!ok) return false;
    try {
      await api.projects.remove(project.id);
      setProjects(prev => prev.filter(p => p.id !== project.id));
      setTasks(prev => prev.filter(t => t.projectId !== project.id));
      reloadFavorites();
      toast(`Projeto "${project.name}" movido para a lixeira`, 'warning', {
        label: 'Desfazer',
        onClick: async () => { try { await api.trash.restore('project', project.id); reloadProjects(); reloadTasks(); reloadFavorites(); } catch (err) { showError(err); } }
      });
      return true;
    } catch (err) { showError(err); return false; }
  }, [confirm, reloadFavorites, reloadProjects, reloadTasks, toast, showError]);

  // ------------------------------------------------------------ UI state

  const drawerTaskId = location.query.task || null;
  const drawerTaskIdRef = useRef(drawerTaskId);
  drawerTaskIdRef.current = drawerTaskId;
  const openTask = useCallback(id => setQuery({ task: id }), [setQuery]);
  const closeTask = useCallback(() => setQuery({ task: null }), [setQuery]);

  const [quickCreate, setQuickCreate] = useState({ open: false, defaults: {} });
  const openQuickCreate = useCallback((defaults = {}) => setQuickCreate({ open: true, defaults }), []);
  const closeQuickCreate = useCallback(() => setQuickCreate({ open: false, defaults: {} }), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [workspaceModal, setWorkspaceModal] = useState(null); // null | { workspace? }
  const [projectModal, setProjectModal] = useState(null); // null | { project?, templateId? }
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (auth.status === 'authed' && user && !user.onboardingCompleted && !sessionStorage.getItem('taskly.onboarding.later')) setOnboardingOpen(true);
  }, [auth.status, user]);

  // --------------------------------------------------- keyboard shortcuts

  const lastKey = useRef({ key: null, at: 0 });
  useEffect(() => {
    if (auth.status !== 'authed') return undefined;
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
        return;
      }
      const el = document.activeElement;
      const typing = el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[aria-modal="true"]')) return; // dialogs own the keyboard

      const key = e.key.toLowerCase();
      const now = Date.now();
      const chord = lastKey.current.key === 'g' && now - lastKey.current.at < 1200;
      lastKey.current = { key, at: now };
      if (chord) {
        const target = { d: '/dashboard', t: '/my-tasks', p: '/projects', k: '/kanban', c: '/calendar', r: '/reports', n: '/notifications', a: '/automations', s: '/settings' }[key];
        if (target) { e.preventDefault(); navigate(target); lastKey.current = { key: null, at: 0 }; }
        return;
      }
      if (key === 'n') { e.preventDefault(); openQuickCreate(); }
      else if (key === 'p') navigate('/projects');
      else if (key === 'c') navigate('/calendar');
      else if (key === 'r') navigate('/reports');
      else if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); }
      else if (key === '/') { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [auth.status, navigate, openQuickCreate]);

  // ----------------------------------------------------------- observability

  useEffect(() => {
    let sent = 0;
    const report = (message, stack) => { if (sent++ < 10) api.system.reportError({ message, stack, url: window.location.pathname }); };
    const onError = e => report(e.message, e.error?.stack);
    const onRejection = e => { if (!(e.reason instanceof ApiError)) report(String(e.reason?.message || e.reason), e.reason?.stack); };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  const value = {
    // routing
    location, route: location.route, params: location.params, query: location.query, navigate, setQuery,
    // feedback
    toasts, toast, removeToast, showError, confirm, confirmState, closeConfirm,
    // auth
    auth, user, setUser, loadSession, logout, switchAccount, flags, maintenanceBanner,
    // workspaces
    workspaces, workspacesLoaded, currentWorkspace, currentWorkspaceId, switchWorkspace, createWorkspace, reloadWorkspaces, setWorkspaces, can,
    // data
    members, reloadMembers, projects, projectsState, reloadProjects, upsertProject, setProjects, favorites, reloadFavorites, toggleFavorite, deleteProject,
    tasks, tasksState, reloadTasks, upsertTask, removeTasksLocal, createTask, updateTask, moveTask, deleteTask, archiveTask, bulkAction,
    columnsByProject, loadColumns, setProjectColumns,
    unreadCount, setUnreadCount, refreshUnread,
    // ui
    drawerTaskId, openTask, closeTask,
    quickCreate, openQuickCreate, closeQuickCreate,
    paletteOpen, setPaletteOpen, shortcutsOpen, setShortcutsOpen, helpOpen, setHelpOpen,
    workspaceModal, setWorkspaceModal, projectModal, setProjectModal, onboardingOpen, setOnboardingOpen,
    sidebarOpen, setSidebarOpen
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
