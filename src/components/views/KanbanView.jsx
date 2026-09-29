import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useLocalStorage } from '../../lib/hooks';
import { Btn, EmptyState, ErrorState, LoadingState, PageHeader, Select } from '../ui';
import { KanbanBoard } from '../tasks/KanbanBoard';

export function KanbanView() {
  const { projects, projectsState, reloadProjects, favorites, currentWorkspaceId, navigate, can, openQuickCreate, setProjectModal } = useApp();
  const [stored, setStored] = useLocalStorage(`taskly.kanban.project.${currentWorkspaceId}`, null);

  const projectId = useMemo(() => {
    if (projects.some(p => p.id === stored)) return stored;
    const fav = favorites.find(f => projects.some(p => p.id === f.id)) || projects.find(p => p.isFavorite);
    return fav?.id || projects[0]?.id || null;
  }, [projects, favorites, stored]);

  const project = projects.find(p => p.id === projectId);
  const sorted = useMemo(() => [...projects].sort((a, b) => Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)) || a.name.localeCompare(b.name, 'pt-BR')), [projects]);

  let content;
  if (projectsState.error && !projects.length) content = <ErrorState error={projectsState.error} onRetry={reloadProjects} />;
  else if (projectsState.loading && !projects.length) content = <LoadingState rows={4} label="Carregando projetos" />;
  else if (!projects.length) {
    content = (
      <EmptyState
        icon="view_kanban"
        title="Nenhum projeto ainda"
        description="Crie um projeto para organizar suas tarefas em um quadro Kanban."
        action={can('project.create') && <Btn variant="primary" icon="add" onClick={() => setProjectModal({})}>Criar projeto</Btn>}
      />
    );
  } else content = <KanbanBoard key={projectId} projectId={projectId} />;

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto pb-24">
      <PageHeader
        title="Kanban"
        icon="view_kanban"
        description={project ? `Quadro do projeto ${project.name}` : 'Acompanhe o fluxo das tarefas por coluna'}
        actions={projects.length > 0 && (
          <>
            <label className="sr-only" htmlFor="kanban-project">Projeto</label>
            <Select id="kanban-project" value={projectId || ''} onChange={e => setStored(e.target.value)} className="w-full sm:w-60">
              {sorted.map(p => <option key={p.id} value={p.id}>{p.isFavorite ? '★ ' : ''}{p.name}</option>)}
            </Select>
            {project && <Btn icon="open_in_new" onClick={() => navigate(`/projects/${project.id}`)}>Abrir projeto</Btn>}
            {can('task.create') && project && <Btn variant="primary" icon="add" onClick={() => openQuickCreate({ projectId: project.id })}>Nova tarefa</Btn>}
          </>
        )}
      />
      {content}
    </div>
  );
}
