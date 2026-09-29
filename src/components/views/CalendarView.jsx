import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useLocalStorage, useMediaQuery } from '../../lib/hooks';
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, todayISO, parseISODate, toISODate, addDaysISO, formatDate, pluralize } from '../../lib/format';
import { Btn, Checkbox, EmptyState, ErrorState, Field, Icon, IconBtn, Input, LoadingState, PageHeader, Segmented, Select } from '../ui';
import { StatusBadge } from '../common/Badge';

const VIEWS = ['month', 'week', 'day'];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MAX_IN_CELL = 3;
const OCCURRENCES = 3;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const mondayOf = iso => addDaysISO(iso, -((parseISODate(iso).getDay() + 6) % 7));
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

// Mirrors the server's recurrence rule (server/routes/tasks.js nextOccurrence).
function nextOccurrence(iso, rec) {
  const d = parseISODate(iso);
  const every = rec.every || 1;
  if (rec.interval === 'daily') d.setDate(d.getDate() + every);
  else if (rec.interval === 'monthly') d.setMonth(d.getMonth() + every);
  else if (rec.weekdays?.length) {
    do d.setDate(d.getDate() + 1); while (!rec.weekdays.includes(d.getDay()));
    if (every > 1) d.setDate(d.getDate() + 7 * (every - 1));
  } else d.setDate(d.getDate() + (rec.interval === 'weekly' ? 7 : 1) * every);
  return toISODate(d);
}

function visibleRange(view, date) {
  if (view === 'day') return { start: date, days: [date] };
  if (view === 'week') {
    const start = mondayOf(date);
    return { start, days: Array.from({ length: 7 }, (_, i) => addDaysISO(start, i)) };
  }
  const first = `${date.slice(0, 7)}-01`;
  const start = mondayOf(first);
  return { start, days: Array.from({ length: 42 }, (_, i) => addDaysISO(start, i)) };
}

function periodTitle(view, date, days) {
  if (view === 'day') return capitalize(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (view === 'month') return capitalize(formatDate(date, { month: 'long', year: 'numeric' }));
  const a = days[0];
  const b = days[6];
  return `${formatDate(a, { day: 'numeric', month: 'short' })} – ${formatDate(b, { day: 'numeric', month: 'short' })} de ${b.slice(0, 4)}`;
}

function shift(view, date, dir) {
  if (view === 'day') return addDaysISO(date, dir);
  if (view === 'week') return addDaysISO(date, 7 * dir);
  const d = parseISODate(`${date.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + dir);
  return toISODate(d);
}

const RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));
const ORDER = { milestone: 0, task: 1, occurrence: 2 };
const sortItems = (a, b) => ORDER[a.kind] - ORDER[b.kind]
  || (a.kind === 'task' ? (a.task.status === 'Done') - (b.task.status === 'Done') || RANK[a.task.priority] - RANK[b.task.priority] : 0);

function dependencyText(task, tasksById) {
  const names = (task.blockedBy || []).map(id => (tasksById[id] ? `${id} ${tasksById[id].title}` : id)).join(', ');
  return task.isBlocked ? `Bloqueada por ${names}` : `Dependências concluídas: ${names}`;
}

function TaskFlags({ task, tasksById }) {
  return (
    <>
      {task.recurrence && <Icon name="repeat" size={12} className="text-text-muted flex-shrink-0" label="Recorrente" />}
      {task.blockedBy?.length > 0 && (
        <span title={dependencyText(task, tasksById)} className="flex-shrink-0 inline-flex">
          <Icon name={task.isBlocked ? 'lock' : 'link'} size={12} className={task.isBlocked ? 'text-amber-400' : 'text-text-muted'} label={dependencyText(task, tasksById)} />
        </span>
      )}
    </>
  );
}

// Compact calendar chip for a task, a predicted recurrence or a milestone.
function Chip({ item, tasksById, onOpen, canDrag, onDragStart, onDragEnd }) {
  if (item.kind === 'milestone') {
    return (
      <div className="flex items-center gap-1.5 h-6 px-1.5 rounded-md bg-surface-elevated text-[11px] text-text-primary min-w-0" title={`Marco: ${item.milestone.name} · ${item.project.name}`}>
        <span aria-hidden="true" className="w-2 h-2 rotate-45 rounded-[1px] flex-shrink-0" style={{ background: item.project.color }} />
        <span className="truncate"><span className="sr-only">Marco: </span>{item.milestone.name}</span>
      </div>
    );
  }
  const { task } = item;
  if (item.kind === 'occurrence') {
    return (
      <button type="button" onClick={() => onOpen(task.id)} title={`Ocorrência prevista de ${task.id} · ${task.title}`}
        aria-label={`Ocorrência prevista de ${task.title} em ${formatDate(item.date)}. Abrir tarefa original`}
        className="w-full flex items-center gap-1 h-6 px-1.5 rounded-md border border-dashed border-border-focus opacity-60 hover:opacity-100 text-[11px] text-text-secondary text-left min-w-0 transition-opacity">
        <Icon name="repeat" size={12} className="flex-shrink-0" />
        <span className="truncate">{task.title}</span>
      </button>
    );
  }
  const done = task.status === 'Done';
  return (
    <button
      type="button"
      draggable={canDrag}
      onDragStart={canDrag ? e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); onDragStart(task.id); } : undefined}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task.id)}
      title={`${task.id} · ${task.title} · Prioridade ${PRIORITY_LABEL[task.priority]}`}
      className={`w-full flex items-center gap-1 h-6 pl-1.5 pr-1 rounded-md border-l-[3px] bg-surface-elevated hover:bg-surface-hover text-[11px] text-left min-w-0 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 ${done ? 'opacity-50' : ''} ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ borderLeftColor: PRIORITY_COLOR[task.priority] }}
    >
      <span className={`truncate flex-1 ${done ? 'line-through text-text-muted' : 'text-text-primary'}`}>{task.title}{done && <span className="sr-only"> (concluída)</span>}</span>
      <TaskFlags task={task} tasksById={tasksById} />
    </button>
  );
}

// Drop target shared by month cells and week columns.
function dropHandlers(date, dnd) {
  if (!dnd.draggingId) return {};
  return {
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dnd.overDate !== date) dnd.setOverDate(date); },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) dnd.setOverDate(null); },
    onDrop: e => { e.preventDefault(); dnd.drop(e.dataTransfer.getData('text/plain') || dnd.draggingId, date); }
  };
}

function DayCell({ date, items, inMonth, isToday, compact, onOpenDay, onCreate, chipProps, dnd }) {
  const drop = dropHandlers(date, dnd);
  const hidden = items.length - MAX_IN_CELL;
  const dayLabel = formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
  const over = dnd.overDate === date;
  const base = `relative flex flex-col gap-1 p-1 sm:p-1.5 border-b border-r border-border-subtle min-w-0 transition-colors ${inMonth ? '' : 'bg-background-secondary/60'} ${over ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/40' : ''}`;

  if (compact) {
    return (
      <button type="button" onClick={() => onOpenDay(date)} aria-label={`${dayLabel}: ${pluralize(items.length, 'item', 'itens')}`} className={`${base} min-h-[64px] items-center text-left hover:bg-surface-hover`}>
        <span className={`text-[12px] w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-inverse text-inverse-text font-semibold' : inMonth ? 'text-text-primary' : 'text-text-muted'}`}>{parseISODate(date).getDate()}</span>
        <span className="flex flex-wrap justify-center gap-0.5" aria-hidden="true">
          {items.slice(0, MAX_IN_CELL).map((it, i) => (
            <span key={i} className={`w-1.5 h-1.5 ${it.kind === 'milestone' ? 'rotate-45 rounded-[1px]' : 'rounded-full'} ${it.kind === 'occurrence' ? 'opacity-50' : ''}`}
              style={{ background: it.kind === 'milestone' ? it.project.color : PRIORITY_COLOR[it.task.priority] }} />
          ))}
        </span>
        {hidden > 0 && <span className="text-[9px] text-text-muted" aria-hidden="true">+{hidden}</span>}
      </button>
    );
  }

  return (
    <div className={`${base} min-h-[118px] group`} data-empty="true" onClick={e => { if (e.target.dataset.empty && onCreate) onCreate(date); }} {...drop}>
      <div className="flex items-center justify-between gap-1" data-empty="true">
        <button type="button" onClick={() => onOpenDay(date)} aria-label={`Ver ${dayLabel}: ${pluralize(items.length, 'item', 'itens')}`}
          className={`text-[12px] w-6 h-6 flex items-center justify-center rounded-full hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 ${isToday ? 'bg-inverse text-inverse-text font-semibold hover:bg-inverse' : inMonth ? 'text-text-primary' : 'text-text-muted'}`}>
          {parseISODate(date).getDate()}
        </button>
        {onCreate && <IconBtn icon="add" size="xs" label={`Nova tarefa em ${dayLabel}`} onClick={() => onCreate(date)} className="opacity-0 group-hover:opacity-100 focus:opacity-100" />}
      </div>
      {items.slice(0, MAX_IN_CELL).map(it => <Chip key={it.key} item={it} {...chipProps} />)}
      {hidden > 0 && (
        <button type="button" onClick={() => onOpenDay(date)} className="text-left px-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary">+{hidden} mais</button>
      )}
      <div className="flex-1 min-h-[8px]" data-empty="true" />
    </div>
  );
}

function WeekColumn({ date, items, isToday, onOpenDay, onCreate, chipProps, dnd }) {
  const drop = dropHandlers(date, dnd);
  const over = dnd.overDate === date;
  return (
    <section aria-label={formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })} className={`flex flex-col min-w-0 border-b md:border-b-0 md:border-r border-border-subtle transition-colors ${over ? 'bg-blue-500/10' : ''}`} {...drop}>
      <div className="flex items-center justify-between gap-1 px-2 py-2 border-b border-border-subtle">
        <button type="button" onClick={() => onOpenDay(date)} className="flex items-baseline gap-1.5 rounded-md hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
          <span className="text-[11px] uppercase text-text-muted">{formatDate(date, { weekday: 'short' }).slice(0, 3)}</span>
          <span className={`text-[14px] font-semibold ${isToday ? 'text-text-primary underline decoration-2 underline-offset-4 decoration-blue-500' : 'text-text-secondary'}`}>{parseISODate(date).getDate()}</span>
        </button>
        {onCreate && <IconBtn icon="add" size="xs" label={`Nova tarefa em ${formatDate(date, { day: 'numeric', month: 'long' })}`} onClick={() => onCreate(date)} />}
      </div>
      <div className="flex flex-col gap-1 p-1.5 md:min-h-[360px]">
        {items.length ? items.map(it => <Chip key={it.key} item={it} {...chipProps} />) : <span className="hidden md:block text-[11px] text-text-muted px-1 py-2">—</span>}
      </div>
    </section>
  );
}

function DayList({ date, items, tasksById, projectsById, onOpen, onCreate, onMove, canEdit }) {
  if (!items.length) {
    return <EmptyState icon="event_available" title="Nada para este dia" description="Nenhuma tarefa, recorrência ou marco com esta data."
      action={onCreate && <Btn icon="add" onClick={() => onCreate(date)}>Nova tarefa neste dia</Btn>} />;
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      <ul className="flex flex-col gap-2">
        {items.map(it => {
          if (it.kind === 'milestone') {
            return (
              <li key={it.key} className="flex items-center gap-3 p-3 rounded-lg bg-background-secondary border border-border-subtle">
                <span aria-hidden="true" className="w-3 h-3 rotate-45 rounded-sm flex-shrink-0" style={{ background: it.project.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text-primary truncate">Marco: {it.milestone.name}</span>
                  <span className="block text-[11px] text-text-muted truncate">{it.project.name}</span>
                </span>
              </li>
            );
          }
          const { task } = it;
          const project = projectsById[task.projectId];
          if (it.kind === 'occurrence') {
            return (
              <li key={it.key} className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-border-focus opacity-70">
                <Icon name="repeat" size={18} className="text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-text-secondary truncate">{task.title}</span>
                  <span className="block text-[11px] text-text-muted">Ocorrência prevista · será criada quando {task.id} for concluída</span>
                </span>
                <Btn size="xs" variant="ghost" onClick={() => onOpen(task.id)}>Abrir original</Btn>
              </li>
            );
          }
          return (
            <li key={it.key} className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-background-secondary border border-border-subtle border-l-[3px] ${task.status === 'Done' ? 'opacity-60' : ''}`} style={{ borderLeftColor: PRIORITY_COLOR[task.priority] }}>
              <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 text-left rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                  <span className={`truncate ${task.status === 'Done' ? 'line-through' : ''}`}>{task.title}</span>
                  <TaskFlags task={task} tasksById={tasksById} />
                </span>
                <span className="block text-[11px] text-text-muted truncate">{task.id}{project ? ` · ${project.name}` : ''} · Prioridade {PRIORITY_LABEL[task.priority]}</span>
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusBadge status={task.status} />
                {canEdit && (
                  <Field label="Prazo" className="w-[150px]">
                    <Input type="date" value={task.dueDate || ''} onChange={e => e.target.value && onMove(task.id, e.target.value)} className="h-8" />
                  </Field>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {onCreate && <div><Btn variant="ghost" icon="add" onClick={() => onCreate(date)}>Nova tarefa neste dia</Btn></div>}
    </div>
  );
}

export function CalendarView({ projectId }) {
  const { tasks, tasksState, reloadTasks, projects, user, query, setQuery, updateTask, openTask, openQuickCreate, can, toast } = useApp();
  const embedded = Boolean(projectId);
  const wide = useMediaQuery('(min-width: 768px)');
  const [nav, setNav] = useState(() => ({
    view: !embedded && VIEWS.includes(query.view) ? query.view : 'month',
    date: !embedded && ISO_RE.test(query.date || '') ? query.date : todayISO()
  }));
  const [projectFilter, setProjectFilter] = useLocalStorage('taskly.calendar.project', 'ALL');
  const [onlyMine, setOnlyMine] = useLocalStorage('taskly.calendar.mine', false);
  const [draggingId, setDraggingId] = useState(null);
  const [overDate, setOverDate] = useState(null);

  const go = patch => {
    const next = { ...nav, ...patch };
    setNav(next);
    if (!embedded) setQuery({ view: next.view, date: next.date });
  };

  const today = todayISO();
  const { days } = useMemo(() => visibleRange(nav.view, nav.date), [nav.view, nav.date]);
  const scopeProject = embedded ? projectId : projectFilter !== 'ALL' && projects.some(p => p.id === projectFilter) ? projectFilter : null;
  const tasksById = useMemo(() => Object.fromEntries(tasks.map(t => [t.id, t])), [tasks]);
  const projectsById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  const itemsByDate = useMemo(() => {
    const first = days[0];
    const last = days[days.length - 1];
    const inRange = d => d && d >= first && d <= last;
    const map = {};
    const add = (date, item) => { (map[date] ||= []).push(item); };
    const scoped = tasks.filter(t => (!scopeProject || t.projectId === scopeProject) && (!onlyMine || t.assigneeId === user?.id));
    const existing = new Set(scoped.map(t => `${t.recurrenceOf || t.id}@${t.dueDate}`));
    scoped.forEach(t => {
      if (!t.dueDate) return;
      if (inRange(t.dueDate)) add(t.dueDate, { kind: 'task', key: t.id, task: t });
      if (!t.recurrence || t.status === 'Done') return;
      let d = t.dueDate;
      for (let i = 0; i < OCCURRENCES && d <= last; i++) {
        d = nextOccurrence(d, t.recurrence);
        if (inRange(d) && !existing.has(`${t.recurrenceOf || t.id}@${d}`)) add(d, { kind: 'occurrence', key: `${t.id}~${d}`, task: t, date: d });
      }
    });
    projects.filter(p => !scopeProject || p.id === scopeProject).forEach(p => (p.milestones || []).forEach(m => {
      if (inRange(m.dueDate)) add(m.dueDate, { kind: 'milestone', key: m.id, milestone: m, project: p });
    }));
    Object.values(map).forEach(list => list.sort(sortItems));
    return map;
  }, [days, tasks, projects, scopeProject, onlyMine, user?.id]);

  const canEdit = can('task.edit');
  const onCreate = can('task.create') ? date => openQuickCreate({ dueDate: date, ...(scopeProject ? { projectId: scopeProject } : {}) }) : null;

  const moveTask = async (id, date) => {
    const task = tasksById[id];
    if (!task || task.dueDate === date) return;
    const previous = task.dueDate;
    const updated = await updateTask(id, { dueDate: date }, { silent: true });
    if (updated) toast('Prazo alterado', 'success', { label: 'Desfazer', onClick: () => updateTask(id, { dueDate: previous }, { silent: true }) });
  };

  const dnd = {
    draggingId, overDate, setOverDate,
    drop: (id, date) => { setDraggingId(null); setOverDate(null); moveTask(id, date); }
  };
  const chipProps = {
    tasksById, onOpen: openTask, canDrag: canEdit && wide,
    onDragStart: setDraggingId, onDragEnd: () => { setDraggingId(null); setOverDate(null); }
  };
  const openDay = date => go({ view: 'day', date });
  const itemCount = days.reduce((a, d) => a + (itemsByDate[d]?.length || 0), 0);
  const title = periodTitle(nav.view, nav.date, days);

  const toolbar = (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1">
          <IconBtn icon="chevron_left" label="Período anterior" onClick={() => go({ date: shift(nav.view, nav.date, -1) })} />
          <IconBtn icon="chevron_right" label="Próximo período" onClick={() => go({ date: shift(nav.view, nav.date, 1) })} />
        </div>
        <Btn onClick={() => go({ date: today })} disabled={nav.date === today}>Hoje</Btn>
        <h2 className="text-[15px] font-semibold text-text-primary truncate" aria-live="polite">{title}</h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Visualização" value={nav.view} onChange={view => go({ view })}
          options={[{ value: 'month', label: 'Mês', icon: 'calendar_view_month' }, { value: 'week', label: 'Semana', icon: 'calendar_view_week' }, { value: 'day', label: 'Dia', icon: 'calendar_view_day' }]} />
        {!embedded && (
          <Select aria-label="Filtrar por projeto" value={scopeProject || 'ALL'} onChange={e => setProjectFilter(e.target.value)} className="w-auto max-w-[200px] h-8">
            <option value="ALL">Todos os projetos</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <label className="inline-flex items-center gap-2 h-8 px-2.5 rounded-lg border border-border bg-surface-card text-[12px] text-text-secondary cursor-pointer select-none">
          <Checkbox checked={onlyMine} onChange={setOnlyMine} />
          Somente minhas
        </label>
      </div>
    </div>
  );

  let body;
  if (tasksState.loading && !tasks.length) body = <LoadingState rows={5} label="Carregando calendário…" />;
  else if (tasksState.error) body = <ErrorState error={tasksState.error} onRetry={reloadTasks} />;
  else if (nav.view === 'day') {
    body = <DayList date={nav.date} items={itemsByDate[nav.date] || []} tasksById={tasksById} projectsById={projectsById} onOpen={openTask} onCreate={onCreate} onMove={moveTask} canEdit={canEdit} />;
  } else if (nav.view === 'week') {
    body = (
      <div className="grid grid-cols-1 md:grid-cols-7">
        {days.map(d => <WeekColumn key={d} date={d} items={itemsByDate[d] || []} isToday={d === today} onOpenDay={openDay} onCreate={onCreate} chipProps={chipProps} dnd={dnd} />)}
      </div>
    );
  } else {
    const month = nav.date.slice(0, 7);
    body = (
      <div>
        <div className="grid grid-cols-7 border-b border-border-subtle" aria-hidden="true">
          {WEEKDAYS.map(w => <div key={w} className="px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-text-muted text-center sm:text-left">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map(d => (
            <DayCell key={d} date={d} items={itemsByDate[d] || []} inMonth={d.slice(0, 7) === month} isToday={d === today} compact={!wide}
              onOpenDay={openDay} onCreate={onCreate} chipProps={chipProps} dnd={dnd} />
          ))}
        </div>
      </div>
    );
  }

  const ready = !(tasksState.loading && !tasks.length) && !tasksState.error;
  const content = (
    <>
      {toolbar}
      {ready && itemCount === 0 && nav.view !== 'day' && (
        <p className="mb-2 text-[12px] text-text-muted" role="status">
          Nenhuma tarefa com prazo neste período{onCreate ? ' — clique em um dia para criar uma.' : '.'}
        </p>
      )}
      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">{body}</div>
      {ready && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-text-muted" aria-label="Legenda">
          {PRIORITIES.map(p => <li key={p} className="flex items-center gap-1.5"><span aria-hidden="true" className="w-1 h-3 rounded-sm" style={{ background: PRIORITY_COLOR[p] }} />{PRIORITY_LABEL[p]}</li>)}
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="w-2 h-2 rotate-45 bg-text-muted rounded-[1px]" />Marco</li>
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="w-4 h-3 rounded-sm border border-dashed border-border-focus" />Recorrência prevista</li>
          <li className="flex items-center gap-1.5"><Icon name="lock" size={12} />Bloqueada</li>
          {canEdit && wide && <li className="flex items-center gap-1.5"><Icon name="drag_pan" size={12} />Arraste para alterar o prazo</li>}
        </ul>
      )}
    </>
  );

  if (embedded) return <div>{content}</div>;
  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader title="Calendário" description="Prazos, marcos e recorrências do workspace."
        actions={onCreate && <Btn variant="primary" icon="add" onClick={() => onCreate(nav.view === 'day' ? nav.date : today)}>Nova tarefa</Btn>} />
      {content}
    </div>
  );
}
