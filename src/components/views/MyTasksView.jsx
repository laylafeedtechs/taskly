import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useLocalStorage } from '../../lib/hooks';
import { addDaysISO, pluralize, todayISO } from '../../lib/format';
import { Btn, EmptyState, ErrorState, LoadingState, PageHeader, Toggle } from '../ui';
import { TaskFilterBar, useTaskFilters } from '../tasks/TaskFilters';
import { TaskListTable } from '../tasks/TaskList';
import { byPriorityThenDue, isDone } from '../tasks/taskUtils';

const GROUPS = [
  { id: 'overdue', label: 'Atrasadas', icon: 'warning', tone: 'text-red-400' },
  { id: 'today', label: 'Hoje', icon: 'today', tone: 'text-amber-400' },
  { id: 'week', label: 'Próximos 7 dias', icon: 'date_range' },
  { id: 'later', label: 'Mais tarde', icon: 'event_upcoming' },
  { id: 'none', label: 'Sem prazo', icon: 'event_busy' },
  { id: 'done', label: 'Concluídas', icon: 'task_alt', tone: 'text-emerald-400' }
];

export function MyTasksView() {
  const { user, tasks, tasksState, reloadTasks, columnsByProject, can, openQuickCreate } = useApp();
  const [showDone, setShowDone] = useLocalStorage('taskly.myTasks.showDone', false);

  const mine = useMemo(() => tasks.filter(t => t.assigneeId === user?.id), [tasks, user?.id]);
  const scoped = useMemo(
    () => (showDone ? mine : mine.filter(t => !isDone(t, columnsByProject[t.projectId]))),
    [mine, showDone, columnsByProject]
  );
  const filterState = useTaskFilters(scoped, { storageKey: 'my-tasks' });
  const { filtered, activeCount, search, clearAll } = filterState;

  const { groups, overdueCount, openCount } = useMemo(() => {
    const today = todayISO();
    const weekEnd = addDaysISO(today, 7);
    const buckets = Object.fromEntries(GROUPS.map(g => [g.id, []]));
    filtered.forEach(t => {
      const d = t.dueDate;
      if (isDone(t, columnsByProject[t.projectId])) buckets.done.push(t);
      else if (!d) buckets.none.push(t);
      else if (d < today) buckets.overdue.push(t);
      else if (d === today) buckets.today.push(t);
      else if (d <= weekEnd) buckets.week.push(t);
      else buckets.later.push(t);
    });
    Object.values(buckets).forEach(list => list.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || byPriorityThenDue(a, b)));
    return {
      groups: GROUPS.filter(g => buckets[g.id].length).map(g => ({ ...g, tasks: buckets[g.id] })),
      overdueCount: buckets.overdue.length,
      openCount: filtered.length - buckets.done.length
    };
  }, [filtered, columnsByProject]);

  const loading = tasksState.loading && !tasks.length;
  const description = loading ? 'Carregando suas tarefas…' : `${pluralize(openCount, 'tarefa aberta', 'tarefas abertas')}${overdueCount ? ` · ${overdueCount} atrasada${overdueCount > 1 ? 's' : ''}` : ''}`;

  let content;
  if (tasksState.error && !tasks.length) content = <ErrorState error={tasksState.error} onRetry={reloadTasks} />;
  else if (loading) content = <LoadingState rows={6} label="Carregando suas tarefas" />;
  else if (!mine.length) {
    content = (
      <EmptyState
        icon="task_alt"
        title="Nenhuma tarefa atribuída a você"
        description="Quando alguém atribuir uma tarefa a você, ela aparecerá aqui organizada por prazo."
        action={can('task.create') && <Btn variant="primary" icon="add" onClick={() => openQuickCreate({ assigneeId: user.id })}>Criar tarefa</Btn>}
      />
    );
  } else {
    content = (
      <TaskListTable
        groups={groups}
        showDoneToggle
        showProject
        emptyState={
          activeCount || search
            ? <EmptyState icon="filter_alt_off" title="Nenhuma tarefa corresponde aos filtros" action={<Btn onClick={clearAll}>Limpar filtros</Btn>} />
            : <EmptyState icon="celebration" title="Tudo em dia!" description="Você não tem tarefas abertas." action={!showDone && <Btn onClick={() => setShowDone(true)}>Mostrar concluídas</Btn>} />
        }
      />
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto pb-24">
      <PageHeader
        title="Minhas tarefas"
        icon="task_alt"
        description={description}
        actions={can('task.create') && <Btn variant="primary" icon="add" onClick={() => openQuickCreate({ assigneeId: user?.id })}>Nova tarefa</Btn>}
      />
      {mine.length > 0 && (
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 mb-4">
          <div className="min-w-0 flex-1"><TaskFilterBar state={filterState} showProject showStatus /></div>
          <div className="flex-shrink-0 lg:pt-1.5"><Toggle checked={showDone} onChange={setShowDone} label="Mostrar concluídas" /></div>
        </div>
      )}
      {content}
    </div>
  );
}
