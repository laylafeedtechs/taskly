import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useDebounce, useLocalStorage } from '../../lib/hooks';
import { formatDate, PROJECT_STATUS_LABEL, pluralize } from '../../lib/format';
import { PageHeader, Btn, IconBtn, Icon, Menu, SearchInput, Select, Segmented, Card, ProgressBar, Pill, Skeleton, EmptyState, ErrorState, Spinner } from '../ui';
import { HealthBadge } from '../common/Badge';
import { ProjectIcon, MemberStack, FavoriteButton, PROJECT_STATUS_STYLE, daysLeftLabel } from '../projects/ProjectBits';
import { useProjectActions } from '../projects/useProjectActions';

const HEALTH_ORDER = { Critical: 0, 'At Risk': 1, Healthy: 2 };
const SORTS = {
  name: { label: 'Nome', fn: (a, b) => a.name.localeCompare(b.name, 'pt-BR') },
  due: { label: 'Prazo', fn: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') },
  progress: { label: 'Progresso', fn: (a, b) => b.progress - a.progress },
  health: { label: 'Saúde', fn: (a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] }
};

function projectHref(p) { return `/projects/${p.id}/overview`; }

function ProjectLink({ project, navigate, className = '' }) {
  return (
    <a href={projectHref(project)} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(projectHref(project)); }} className={`block font-semibold text-text-primary hover:underline focus:outline-none focus-visible:underline truncate ${className}`}>
      {project.name}
    </a>
  );
}

function ProjectMenu({ project, items }) {
  return (
    <Menu
      items={items}
      trigger={({ toggle, ...aria }) => <IconBtn icon="more_horiz" size="xs" label={`Ações de ${project.name}`} onClick={toggle} {...aria} />}
    />
  );
}

function StatusPill({ status }) {
  return <Pill className={PROJECT_STATUS_STYLE[status]}>{PROJECT_STATUS_LABEL[status] || status}</Pill>;
}

function Deadline({ project }) {
  const left = project.status === 'COMPLETED' ? null : daysLeftLabel(project.daysLeft);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary whitespace-nowrap">
      <Icon name="event" size={14} className="text-text-muted" />
      {formatDate(project.dueDate, { day: '2-digit', month: 'short', year: 'numeric' })}
      {left && <span className={left.className}>· {left.label}</span>}
    </span>
  );
}

function ProjectCard({ project, members, navigate, onToggleFavorite, menuItems }) {
  return (
    <Card padded={false} className={`relative flex flex-col p-4 gap-3 card-hover hover:border-border-focus hover:bg-surface-hover/40 ${project.archivedAt ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <ProjectIcon project={project} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <ProjectLink project={project} navigate={navigate} className="text-[14px] after:absolute after:inset-0 after:rounded-xl" />
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <StatusPill status={project.status} />
            {project.archivedAt && <Pill><Icon name="archive" size={12} />Arquivado</Pill>}
          </div>
        </div>
        <div className="relative flex items-center -mr-1.5 -mt-1">
          <FavoriteButton project={project} onToggle={onToggleFavorite} />
          <ProjectMenu project={project} items={menuItems(project)} />
        </div>
      </div>
      <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-2 min-h-[36px]">{project.description || <span className="text-text-muted">Sem descrição</span>}</p>
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="text-text-secondary"><span className="font-tabular">{project.completedTasks}/{project.totalTasks}</span> tarefas</span>
          <span className="font-mono text-text-primary">{project.progress}%</span>
        </div>
        <ProgressBar value={project.progress} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border-subtle">
        <MemberStack ids={project.members} members={members} />
        <div className="relative"><HealthBadge health={project.health} reasons={project.healthReasons} /></div>
      </div>
      <Deadline project={project} />
    </Card>
  );
}

function ProjectTable({ projects, members, navigate, onToggleFavorite, menuItems }) {
  return (
    <Card padded={false}>
      <div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] font-mono uppercase tracking-wider text-text-muted border-b border-border">
              <th scope="col" className="px-4 py-2.5 font-medium">Projeto</th>
              <th scope="col" className="px-3 py-2.5 font-medium hidden md:table-cell">Status</th>
              <th scope="col" className="px-3 py-2.5 font-medium hidden sm:table-cell w-[180px]">Progresso</th>
              <th scope="col" className="px-3 py-2.5 font-medium hidden xl:table-cell">Membros</th>
              <th scope="col" className="px-3 py-2.5 font-medium hidden xl:table-cell">Prazo</th>
              <th scope="col" className="px-3 py-2.5 font-medium hidden md:table-cell">Saúde</th>
              <th scope="col" className="px-3 py-2.5 w-[76px]"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className={`border-b border-border-subtle last:border-0 hover:bg-surface-hover/50 ${p.archivedAt ? 'opacity-70' : ''}`}>
                <td className="px-4 py-3 max-w-0 w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ProjectIcon project={p} size={30} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ProjectLink project={p} navigate={navigate} className="text-[13px]" />
                        {p.archivedAt && <Pill>Arquivado</Pill>}
                      </div>
                      <p className="text-[11px] text-text-muted truncate">{p.description || 'Sem descrição'}</p>
                      <p className="sm:hidden text-[11px] text-text-secondary mt-0.5">{p.progress}% · {p.completedTasks}/{p.totalTasks} tarefas</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 hidden md:table-cell"><StatusPill status={p.status} /></td>
                <td className="px-3 py-3 hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <ProgressBar value={p.progress} className="flex-1" />
                    <span className="font-mono text-[11px] text-text-primary w-9 text-right">{p.progress}%</span>
                  </div>
                  <p className="text-[10px] text-text-muted mt-1 font-tabular">{p.completedTasks}/{p.totalTasks} tarefas</p>
                </td>
                <td className="px-3 py-3 hidden xl:table-cell"><MemberStack ids={p.members} members={members} max={3} size={20} /></td>
                <td className="px-3 py-3 hidden xl:table-cell"><Deadline project={p} /></td>
                <td className="px-3 py-3 hidden md:table-cell"><HealthBadge health={p.health} reasons={p.healthReasons} /></td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-end">
                    <FavoriteButton project={p} onToggle={onToggleFavorite} />
                    <ProjectMenu project={p} items={menuItems(p)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4" aria-busy="true" aria-label="Carregando projetos">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[228px] rounded-xl" />)}
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-text-muted">{title}<span className="text-text-muted/70">{count}</span></h2>
      {children}
    </section>
  );
}

export function ProjectsView() {
  const { projects, projectsState, reloadProjects, members, currentWorkspaceId, can, navigate, setProjectModal, toggleFavorite } = useApp();
  const [view, setView] = useLocalStorage('taskly.projects.view', 'grid');
  const [sort, setSort] = useLocalStorage('taskly.projects.sort', 'name');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [showArchived, setShowArchived] = useState(false);
  const q = useDebounce(search.trim().toLowerCase(), 150);

  const archivedState = useAsync(
    () => (showArchived ? api.projects.list(currentWorkspaceId, true).then(r => r.projects.filter(p => p.archivedAt)) : Promise.resolve([])),
    [showArchived, currentWorkspaceId]
  );
  const archived = archivedState.data || [];
  const setArchived = archivedState.setData;
  const archivedLoading = showArchived && archivedState.loading;

  // Keep the local archived list in sync with archive/unarchive/edit actions.
  const { menuItems, dialogs } = useProjectActions({
    onChange: p => setArchived(list => {
      const rest = (list || []).filter(x => x.id !== p.id);
      return p.archivedAt && showArchived ? [...rest, p] : rest;
    }),
    onDeleted: p => setArchived(list => (list || []).filter(x => x.id !== p.id))
  });

  const all = useMemo(() => (showArchived ? [...projects, ...archived.filter(a => !projects.some(p => p.id === a.id))] : projects), [projects, archived, showArchived]);
  const filtered = useMemo(() => all
    .filter(p => status === 'ALL' || p.status === status)
    .filter(p => !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
    .sort(SORTS[sort]?.fn || SORTS.name.fn), [all, status, q, sort]);
  const favorites = filtered.filter(p => p.isFavorite && !p.archivedAt);
  const others = favorites.length ? filtered.filter(p => !favorites.includes(p)) : filtered;
  const filtering = Boolean(q) || status !== 'ALL';

  const listProps = { members, navigate, onToggleFavorite: toggleFavorite, menuItems };
  const renderList = list => (view === 'list'
    ? <ProjectTable projects={list} {...listProps} />
    : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {list.map(p => <ProjectCard key={p.id} project={p} {...listProps} />)}
      </div>
    ));

  let content;
  if (projectsState.loading && !projects.length) content = <GridSkeleton />;
  else if (projectsState.error && !projects.length) content = <ErrorState error={projectsState.error} onRetry={reloadProjects} />;
  else if (!all.length && !archivedLoading) {
    content = (
      <EmptyState
        icon="folder_open"
        title={showArchived ? 'Nenhum projeto neste workspace' : 'Nenhum projeto ainda'}
        description="Projetos organizam tarefas, quadros, prazos e arquivos da equipe."
        action={can('project.create') && <Btn variant="primary" icon="add" onClick={() => setProjectModal({})}>Criar primeiro projeto</Btn>}
      />
    );
  } else if (!filtered.length && !archivedLoading) {
    content = (
      <EmptyState
        icon="search_off"
        title="Nenhum projeto encontrado"
        description="Ajuste a busca ou os filtros para ver outros projetos."
        action={<Btn icon="filter_alt_off" onClick={() => { setSearch(''); setStatus('ALL'); }}>Limpar filtros</Btn>}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-7">
        {favorites.length > 0 && <Section title="Favoritos" count={favorites.length}>{renderList(favorites)}</Section>}
        {others.length > 0 && (favorites.length ? <Section title="Todos os projetos" count={others.length}>{renderList(others)}</Section> : renderList(others))}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto animate-fadeIn">
      <PageHeader
        title="Projetos"
        description={projects.length ? `${pluralize(projects.length, 'projeto ativo', 'projetos ativos')} neste workspace` : 'Organize o trabalho da equipe em projetos'}
        actions={can('project.create') && <Btn variant="primary" icon="add" onClick={() => setProjectModal({})}>Novo projeto</Btn>}
      />

      <div className="flex flex-col lg:flex-row lg:items-center gap-2 mb-5">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar projetos…" className="w-full lg:max-w-xs" />
        <div className="flex flex-wrap items-center gap-2 lg:flex-1">
          <Select aria-label="Filtrar por status" value={status} onChange={e => setStatus(e.target.value)} className="w-auto min-w-[150px]">
            <option value="ALL">Todos os status</option>
            {Object.entries(PROJECT_STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
          <Select aria-label="Ordenar por" value={sort} onChange={e => setSort(e.target.value)} className="w-auto min-w-[140px]">
            {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Ordenar: {s.label}</option>)}
          </Select>
          <Btn
            icon="archive"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(v => !v)}
            className={`h-9 ${showArchived ? 'border-blue-500/50 text-blue-400 bg-blue-500/10' : ''}`}
          >
            Arquivados
            {showArchived && (archivedLoading ? <Spinner size={12} /> : <span className="font-mono text-[10px]">{archived.length}</span>)}
          </Btn>
          {filtering && <span className="text-[12px] text-text-muted">{pluralize(filtered.length, 'resultado', 'resultados')}</span>}
          <div className="ml-auto">
            <Segmented
              label="Modo de visualização"
              value={view}
              onChange={setView}
              options={[{ value: 'grid', label: 'Grade', icon: 'grid_view' }, { value: 'list', label: 'Lista', icon: 'view_list' }]}
            />
          </div>
        </div>
      </div>

      {showArchived && archivedState.error && (
        <div className="mb-4"><ErrorState compact error={archivedState.error} onRetry={archivedState.reload} /></div>
      )}
      {content}
      {dialogs}
    </div>
  );
}
