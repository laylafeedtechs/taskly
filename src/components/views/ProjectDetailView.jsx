import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatDate, PROJECT_STATUS_LABEL } from '../../lib/format';
import { Btn, IconBtn, Icon, Menu, Tabs, Pill, Alert, Skeleton, EmptyState, ErrorState } from '../ui';
import { HealthBadge } from '../common/Badge';
import { ActivityFeed } from '../common/ActivityFeed';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskListTable } from '../tasks/TaskList';
import { CalendarView } from './CalendarView';
import { TimelineView } from './TimelineView';
import { ReportsView } from './ReportsView';
import { ProjectIcon, MemberStack, FavoriteButton, PROJECT_STATUS_STYLE } from '../projects/ProjectBits';
import { ProjectOverview } from '../projects/ProjectOverview';
import { FilesPanel } from '../projects/FilesPanel';
import { useProjectActions } from '../projects/useProjectActions';

const TABS = [
  { id: 'overview', label: 'Visão geral', icon: 'dashboard' },
  { id: 'board', label: 'Quadro', icon: 'view_kanban' },
  { id: 'list', label: 'Lista', icon: 'view_list' },
  { id: 'calendar', label: 'Calendário', icon: 'calendar_month' },
  { id: 'timeline', label: 'Timeline', icon: 'view_timeline' },
  { id: 'reports', label: 'Relatórios', icon: 'monitoring' },
  { id: 'files', label: 'Arquivos', icon: 'folder' },
  { id: 'activity', label: 'Atividade', icon: 'history' }
];

function HeaderSkeleton() {
  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto" aria-busy="true" aria-label="Carregando projeto">
      <Skeleton className="h-4 w-24 mb-4" />
      <div className="flex items-center gap-3 mb-3"><Skeleton className="w-11 h-11 rounded-xl" /><Skeleton className="h-7 w-64" /></div>
      <Skeleton className="h-4 w-full max-w-xl mb-6" />
      <Skeleton className="h-9 w-full max-w-3xl mb-5" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
    </div>
  );
}

export function ProjectDetailView() {
  const { params, navigate, projects, upsertProject, tasks, members, can, toast, toggleFavorite, setProjectModal, openQuickCreate, currentWorkspaceId, workspaces, switchWorkspace } = useApp();
  const id = params.id;
  const tab = TABS.some(t => t.id === params.tab) ? params.tab : 'overview';
  const [state, setState] = useState({ project: null, loading: true, error: null });
  const live = projects.find(p => p.id === id);
  const liveRef = useRef(live);
  liveRef.current = live;

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await api.projects.get(id);
      setState({ project: res.project, loading: false, error: null });
      // Refresh the shared copy so lists and sidebar show current stats.
      if (liveRef.current && !res.project.archivedAt) upsertProject(res.project);
    } catch (error) {
      if (!silent) setState({ project: null, loading: false, error });
    }
  }, [id, upsertProject]);

  useEffect(() => { load(); }, [load]);

  // Stats change as tasks move on other tabs; refresh them when returning.
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    if (tab === 'overview') load({ silent: true });
  }, [tab, load]);

  useEffect(() => {
    if (params.tab !== tab) navigate(`/projects/${id}/${tab}`, { replace: true, keepQuery: true });
  }, [params.tab, tab, id, navigate]);

  const project = useMemo(() => (state.project ? { ...state.project, isFavorite: live?.isFavorite ?? state.project.isFavorite } : null), [state.project, live?.isFavorite]);
  const setProject = useCallback(p => setState(s => ({ ...s, project: p ? { ...s.project, ...p } : s.project })), []);
  const projectTasks = useMemo(() => tasks.filter(t => t.projectId === id), [tasks, id]);

  const { menuItems, dialogs } = useProjectActions({ onChange: setProject, onDeleted: () => navigate('/projects') });

  if (state.loading && !state.project) return <HeaderSkeleton />;
  if (state.error) {
    const notFound = state.error.status === 404;
    const forbidden = state.error.status === 403;
    return (
      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
        {notFound || forbidden ? (
          <EmptyState
            icon={notFound ? 'folder_off' : 'lock'}
            title={notFound ? 'Projeto não encontrado' : 'Sem acesso a este projeto'}
            description={notFound ? 'Ele pode ter sido excluído ou o link está incorreto.' : 'Peça a um gestor do workspace para liberar seu acesso.'}
            action={<Btn icon="arrow_back" onClick={() => navigate('/projects')}>Voltar para projetos</Btn>}
          />
        ) : <ErrorState error={state.error} onRetry={load} />}
      </div>
    );
  }

  const archived = Boolean(project.archivedAt);
  const otherWorkspace = project.workspaceId !== currentWorkspaceId ? workspaces.find(w => w.id === project.workspaceId) : null;
  const canEdit = can('project.edit') && !archived;

  const share = async () => {
    const url = `${window.location.origin}/projects/${project.id}/${tab}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link do projeto copiado', 'success');
    } catch {
      toast('Não foi possível copiar o link automaticamente', 'error');
    }
  };

  const openSettings = () => setProjectModal({ project, onSaved: setProject });

  const switchToProjectWorkspace = () => switchWorkspace(project.workspaceId, { keepPath: true });

  const body = {
    overview: <ProjectOverview project={project} tasks={projectTasks} canEdit={canEdit} onMilestonesChange={milestones => {
      setProject({ milestones });
      if (live) upsertProject({ ...live, milestones });
    }} onViewActivity={() => navigate(`/projects/${id}/activity`)} />,
    board: <KanbanBoard projectId={id} />,
    list: <TaskListTable tasks={projectTasks} showProject={false} />,
    calendar: <CalendarView projectId={id} />,
    timeline: <TimelineView projectId={id} />,
    reports: <ReportsView projectId={id} />,
    files: <FilesPanel projectId={id} />,
    activity: <div className="max-w-3xl"><ActivityFeed workspaceId={project.workspaceId} projectId={id} /></div>
  }[tab];

  return (
    <div className={`p-4 sm:p-6 mx-auto animate-fadeIn ${tab === 'board' ? 'max-w-none' : 'max-w-[1600px]'}`}>
      <nav aria-label="Navegação estrutural" className="mb-3">
        <a href="/projects" onClick={e => { e.preventDefault(); navigate('/projects'); }} className="inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary">
          <Icon name="arrow_back" size={14} />Projetos
        </a>
      </nav>

      <header className="flex flex-col xl:flex-row xl:items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <ProjectIcon project={project} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-title-lg text-text-primary break-words min-w-0">{project.name}</h1>
              {live && <FavoriteButton project={project} onToggle={() => toggleFavorite(live)} />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <Pill className={PROJECT_STATUS_STYLE[project.status]}>{PROJECT_STATUS_LABEL[project.status] || project.status}</Pill>
              <HealthBadge health={project.health} reasons={project.healthReasons} />
              {archived && <Pill><Icon name="archive" size={12} />Arquivado</Pill>}
              <span className="text-[11px] text-text-muted inline-flex items-center gap-1 ml-1">
                <Icon name="event" size={13} />{formatDate(project.startDate)} – {formatDate(project.dueDate, { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
            {project.description && <p className="text-[13px] text-text-secondary mt-2 max-w-3xl line-clamp-3">{project.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:flex-shrink-0">
          <MemberStack ids={project.members} members={members} max={5} size={26} />
          <span className="w-px h-6 bg-border mx-1 hidden sm:block" aria-hidden="true" />
          <IconBtn icon="link" label="Copiar link do projeto" onClick={share} />
          {canEdit && <IconBtn icon="settings" label="Configurações do projeto" onClick={openSettings} />}
          <Menu items={menuItems(project, { includeOpen: false })} trigger={({ toggle, ...aria }) => <IconBtn icon="more_horiz" label="Mais ações do projeto" onClick={toggle} {...aria} />} />
          {can('task.create') && !archived && !otherWorkspace && (
            <Btn variant="primary" icon="add" onClick={() => openQuickCreate({ projectId: project.id })}>Nova tarefa</Btn>
          )}
        </div>
      </header>

      {archived && (
        <div className="mb-4"><Alert tone="warning">Este projeto está arquivado e não aparece nas listas do workspace. Desarquive-o pelo menu de ações para voltar a editá-lo.</Alert></div>
      )}
      {otherWorkspace && (
        <div className="mb-4">
          <Alert tone="info">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Este projeto pertence ao workspace <strong>{otherWorkspace.name}</strong>. Troque de workspace para ver tarefas e membros.</span>
              <Btn size="xs" onClick={switchToProjectWorkspace}>Trocar para {otherWorkspace.name}</Btn>
            </div>
          </Alert>
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={next => navigate(`/projects/${id}/${next}`)} className="mb-5 pb-3 border-b border-border" />

      <div role="tabpanel" aria-label={TABS.find(t => t.id === tab).label} className="min-w-0">{body}</div>
      {dialogs}
    </div>
  );
}
