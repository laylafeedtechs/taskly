import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { dueInfo, statusLabel } from '../../lib/format';
import { PriorityBadge, StatusBadge } from '../common/Badge';
import { Avatar, Btn, Checkbox, EmptyState, Icon } from '../ui';
import { BulkActionBar } from './BulkActionBar';
import { useSelection } from './useSelection';
import { DUE_TONE, PRIORITY_RANK, doneStatusOf, isDone, reopenStatusOf, useLookups } from './taskUtils';

const PAGE = 100;
const noop = () => {};

const SORTERS = {
  id: (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }),
  title: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
  status: (a, b, ctx) => statusLabel(a.status, ctx.cols(a)).localeCompare(statusLabel(b.status, ctx.cols(b)), 'pt-BR'),
  priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9),
  assignee: (a, b, ctx) => (ctx.member(a)?.name || '~').localeCompare(ctx.member(b)?.name || '~', 'pt-BR'),
  due: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'),
  project: (a, b, ctx) => (ctx.project(a)?.name || '').localeCompare(ctx.project(b)?.name || '', 'pt-BR')
};

function SortHeader({ id, label, sort, onSort, className = '' }) {
  const active = sort.key === id;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2 py-2 text-left font-medium ${className}`}>
      <button type="button" onClick={() => onSort(id)} className={`inline-flex items-center gap-0.5 rounded hover:text-text-primary ${active ? 'text-text-primary' : ''}`}>
        {label}
        <Icon name={active ? (sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'} size={13} className={active ? '' : 'opacity-40'} />
      </button>
    </th>
  );
}

// Dense sortable task table. Pass `groups` ([{ id, label, icon, tone, tasks }]) to
// render collapsible sections that share one selection and one bulk bar.
export function TaskListTable({ tasks = [], selectable = true, showProject = true, emptyState, groups, showDoneToggle = false }) {
  const { can, openTask, columnsByProject, moveTask } = useApp();
  const { memberById, projectById } = useLookups();
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [limits, setLimits] = useState({});
  const [collapsed, setCollapsed] = useState(() => new Set());

  const canBulk = selectable && (can('task.edit') || can('task.delete'));
  const canEdit = can('task.edit');

  const sections = useMemo(() => {
    const base = groups || [{ id: 'all', tasks }];
    if (!sort.key) return base;
    const ctx = { cols: t => columnsByProject[t.projectId], member: t => memberById.get(t.assigneeId), project: t => projectById.get(t.projectId) };
    const cmp = SORTERS[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return base.map(g => ({ ...g, tasks: [...g.tasks].sort((a, b) => dir * cmp(a, b, ctx) || SORTERS.id(a, b)) }));
  }, [groups, tasks, sort, columnsByProject, memberById, projectById]);

  const visible = useMemo(() => sections.map(g => ({
    ...g,
    rows: collapsed.has(g.id) ? [] : g.tasks.slice(0, limits[g.id] || PAGE)
  })), [sections, collapsed, limits]);

  const orderedIds = useMemo(() => visible.flatMap(g => g.rows.map(t => t.id)), [visible]);
  const selection = useSelection(orderedIds);
  const total = sections.reduce((n, g) => n + g.tasks.length, 0);

  const onSort = key => setSort(s => (s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' }));
  const toggleGroup = id => setCollapsed(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  if (!total) return emptyState || <EmptyState icon="task_alt" title="Nenhuma tarefa encontrada" compact />;

  const allSelected = orderedIds.length > 0 && orderedIds.every(id => selection.selected.has(id));
  const colCount = 4 + (canBulk ? 1 : 0) + (showDoneToggle ? 1 : 0) + (showProject ? 1 : 0) + 1;

  const toggleDone = task => {
    const cols = columnsByProject[task.projectId];
    moveTask(task.id, isDone(task, cols) ? reopenStatusOf(cols) : doneStatusOf(cols));
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card overflow-hidden">
      <table className="w-full table-fixed text-[13px]">
        <thead className="bg-background-secondary text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
          <tr>
            {canBulk && (
              <th scope="col" className="w-10 pl-3 py-2">
                <Checkbox checked={allSelected} onChange={v => selection.setMany(orderedIds, v)} label="Selecionar todas as tarefas visíveis" />
              </th>
            )}
            {showDoneToggle && <th scope="col" className="w-9"><span className="sr-only">Concluir</span></th>}
            <SortHeader id="title" label="Tarefa" sort={sort} onSort={onSort} className={canBulk || showDoneToggle ? '' : 'pl-4'} />
            <SortHeader id="status" label="Status" sort={sort} onSort={onSort} className="w-[140px] hidden md:table-cell" />
            <SortHeader id="priority" label="Prioridade" sort={sort} onSort={onSort} className="w-[108px] hidden sm:table-cell" />
            <SortHeader id="assignee" label="Responsável" sort={sort} onSort={onSort} className="w-[170px] hidden lg:table-cell" />
            <SortHeader id="due" label="Prazo" sort={sort} onSort={onSort} className="w-[96px] sm:w-[112px]" />
            {showProject && <SortHeader id="project" label="Projeto" sort={sort} onSort={onSort} className="w-[170px] hidden xl:table-cell" />}
          </tr>
        </thead>
        {visible.map(g => (
          <tbody key={g.id} className="divide-y divide-border-subtle">
            {groups && (
              <tr className="bg-background-secondary/60">
                <th scope="rowgroup" colSpan={colCount} className="text-left px-3 py-0 border-t border-border">
                  <button type="button" onClick={() => toggleGroup(g.id)} aria-expanded={!collapsed.has(g.id)} className="w-full flex items-center gap-2 h-9 text-[12px] font-semibold text-text-primary">
                    <Icon name={collapsed.has(g.id) ? 'chevron_right' : 'expand_more'} size={16} className="text-text-muted" />
                    {g.icon && <Icon name={g.icon} size={15} className={g.tone || 'text-text-muted'} />}
                    <span className={g.tone}>{g.label}</span>
                    <span className="text-[11px] font-mono font-normal text-text-muted">{g.tasks.length}</span>
                  </button>
                </th>
              </tr>
            )}
            {g.rows.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                columns={columnsByProject[task.projectId]}
                assignee={memberById.get(task.assigneeId)}
                showProject={showProject}
                project={projectById.get(task.projectId)}
                selectable={canBulk}
                selected={selection.selected.has(task.id)}
                selectionMode={selection.count > 0}
                onSelect={range => selection.toggle(task.id, { range })}
                showDoneToggle={showDoneToggle}
                canEdit={canEdit}
                onToggleDone={toggleDone}
                onOpen={openTask}
              />
            ))}
            {!collapsed.has(g.id) && g.tasks.length > g.rows.length && (
              <tr>
                <td colSpan={colCount} className="px-3 py-2 text-center">
                  <Btn variant="ghost" size="sm" icon="expand_more" onClick={() => setLimits(l => ({ ...l, [g.id]: (l[g.id] || PAGE) + PAGE }))}>
                    Mostrar mais ({g.tasks.length - g.rows.length} restantes)
                  </Btn>
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      {canBulk && <BulkActionBar selectedIds={selection.ids} onClear={selection.clear} />}
    </div>
  );
}

function TaskRow({ task, columns, assignee, project, showProject, selectable, selected, selectionMode, onSelect, showDoneToggle, canEdit, onToggleDone, onOpen }) {
  const due = dueInfo(task.dueDate, task.status);
  const done = isDone(task, columns);
  return (
    <tr onClick={() => onOpen(task.id)} className={`group cursor-pointer transition-colors ${selected ? 'bg-blue-500/5' : 'hover:bg-surface-hover'}`}>
      {selectable && (
        <td className="w-10 pl-3 py-2.5 align-middle" onClick={e => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            onChange={noop}
            onClick={e => onSelect(e.shiftKey)}
            label={`Selecionar ${task.id}`}
            className={selectionMode || selected ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100'}
          />
        </td>
      )}
      {showDoneToggle && (
        <td className="w-9 py-2.5 align-middle" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => onToggleDone(task)}
            aria-label={done ? `Reabrir ${task.id}` : `Concluir ${task.id}`}
            title={done ? 'Reabrir' : 'Marcar como concluída'}
            className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors disabled:opacity-40 ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-border-focus text-transparent hover:border-emerald-400 hover:text-emerald-400'}`}
          >
            <Icon name="check" size={13} />
          </button>
        </td>
      )}
      <td className={`py-2.5 px-2 align-middle min-w-0 ${selectable || showDoneToggle ? '' : 'pl-4'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-mono text-text-muted flex-shrink-0 hidden sm:inline">{task.id}</span>
          <button type="button" onClick={e => { e.stopPropagation(); onOpen(task.id); }} className={`min-w-0 truncate text-left font-medium hover:underline underline-offset-2 decoration-border-focus ${done ? 'text-text-muted line-through' : 'text-text-primary'}`} title={task.title}>
            {task.title}
          </button>
          {task.isBlocked && <Icon name="lock" size={14} className="text-red-400 flex-shrink-0" label="Bloqueada" />}
          {task.isRecurring && <Icon name="repeat" size={14} className="text-text-muted flex-shrink-0" label="Recorrente" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1 md:hidden">
          <span className="text-[11px] font-mono text-text-muted sm:hidden">{task.id}</span>
          <span className="sm:hidden"><PriorityBadge priority={task.priority} /></span>
          <StatusBadge status={task.status} columns={columns} />
        </div>
      </td>
      <td className="px-2 py-2.5 align-middle hidden md:table-cell"><StatusBadge status={task.status} columns={columns} /></td>
      <td className="px-2 py-2.5 align-middle hidden sm:table-cell"><PriorityBadge priority={task.priority} /></td>
      <td className="px-2 py-2.5 align-middle hidden lg:table-cell">
        <span className="flex items-center gap-2 min-w-0">
          <Avatar user={assignee} size={22} />
          <span className={`truncate text-[12px] ${assignee ? 'text-text-secondary' : 'text-text-muted'}`}>{assignee?.name || 'Sem responsável'}</span>
        </span>
      </td>
      <td className={`px-2 py-2.5 align-middle text-[12px] font-tabular whitespace-nowrap ${due ? DUE_TONE[due.tone] : 'text-text-muted'}`}>{due ? due.label : '—'}</td>
      {showProject && (
        <td className="px-2 py-2.5 align-middle hidden xl:table-cell">
          <span className="flex items-center gap-2 min-w-0 text-[12px] text-text-secondary">
            <span className="w-2 h-2 rounded-full flex-shrink-0 bg-text-muted" style={project?.color ? { backgroundColor: project.color } : undefined} aria-hidden="true" />
            <span className="truncate">{project?.name || '—'}</span>
          </span>
        </td>
      )}
    </tr>
  );
}
