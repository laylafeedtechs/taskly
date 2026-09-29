import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useLocalStorage, useMediaQuery } from '../../lib/hooks';
import { todayISO, parseISODate, addDaysISO, formatDate, pluralize, PRIORITY_LABEL } from '../../lib/format';
import { Btn, Card, Checkbox, EmptyState, ErrorState, Icon, LoadingState, PageHeader, Segmented, Select } from '../ui';

const ZOOM = { day: 40, week: 16, month: 5 };
const ROW = 36;
const HEADER = 48;
const DAY_MS = 86400000;
const CONFLICT = '#EF4444';

const diffDays = (a, b) => Math.round((parseISODate(b) - parseISODate(a)) / DAY_MS);
const mondayOf = iso => addDaysISO(iso, -((parseISODate(iso).getDay() + 6) % 7));

function taskSpan(t) {
  const end = t.dueDate;
  let start = t.startDate || t.createdAt?.slice(0, 10) || end;
  if (start > end) start = end;
  return { start, end };
}

// Header segments (months on top; days or weeks below depending on zoom).
function buildScale(rangeStart, totalDays, zoom) {
  const months = [];
  const minor = [];
  for (let i = 0; i < totalDays; i++) {
    const iso = addDaysISO(rangeStart, i);
    const d = parseISODate(iso);
    if (i === 0 || d.getDate() === 1) months.push({ i, iso });
    if (zoom === 'day') minor.push({ i, iso, label: String(d.getDate()), weekend: d.getDay() === 0 || d.getDay() === 6 });
    else if (zoom === 'week' && d.getDay() === 1) minor.push({ i, iso, label: formatDate(iso) });
  }
  return { months: months.map((m, k) => ({ ...m, span: (months[k + 1]?.i ?? totalDays) - m.i })), minor };
}

function arrowPath(x1, y1, x2, y2) {
  const gap = 8;
  if (x2 - x1 >= gap * 2) return `M${x1},${y1} H${x1 + gap} V${y2} H${x2}`;
  const ym = y2 > y1 ? y2 - ROW / 2 : y2 + ROW / 2;
  return `M${x1},${y1} H${x1 + gap} V${ym} H${x2 - gap} V${y2} H${x2}`;
}

export function TimelineView({ projectId }) {
  const { tasks, tasksState, reloadTasks, projects, user, can, updateTask, openTask, openQuickCreate, navigate, toast } = useApp();
  const embedded = Boolean(projectId);
  const wide = useMediaQuery('(min-width: 768px)');
  const LEFT = wide ? 260 : 140;
  const [zoom, setZoom] = useLocalStorage('taskly.timeline.zoom', 'week');
  const [projectFilter, setProjectFilter] = useLocalStorage('taskly.timeline.project', 'ALL');
  const [onlyMine, setOnlyMine] = useLocalStorage('taskly.timeline.mine', false);
  const ppd = ZOOM[zoom] || ZOOM.week;
  const canEdit = can('task.edit');
  const today = todayISO();

  const scopeProject = embedded ? projectId : projectFilter !== 'ALL' && projects.some(p => p.id === projectFilter) ? projectFilter : null;

  const model = useMemo(() => {
    const scoped = tasks.filter(t => (!scopeProject || t.projectId === scopeProject) && (!onlyMine || t.assigneeId === user?.id));
    const rows = [];
    const dates = [today];
    projects.filter(p => !scopeProject || p.id === scopeProject).forEach(p => {
      const own = scoped.filter(t => t.projectId === p.id && t.dueDate).map(t => ({ task: t, ...taskSpan(t) }))
        .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
      const milestones = (p.milestones || []).filter(m => m.dueDate);
      if (!own.length && !milestones.length) return;
      rows.push({ type: 'project', key: `p-${p.id}`, project: p, count: own.length });
      if (milestones.length) rows.push({ type: 'milestones', key: `m-${p.id}`, project: p, milestones });
      own.forEach(r => rows.push({ type: 'task', key: r.task.id, project: p, ...r }));
      own.forEach(r => dates.push(r.start, r.end));
      milestones.forEach(m => dates.push(m.dueDate));
    });
    dates.sort();
    const rangeStart = mondayOf(addDaysISO(dates[0], -7));
    const totalDays = diffDays(rangeStart, addDaysISO(dates[dates.length - 1], 21)) + 1;
    const rowIndex = Object.fromEntries(rows.map((r, i) => [r.key, i]));
    return { rows, rowIndex, rangeStart, totalDays, undated: scoped.filter(t => !t.dueDate), scopedCount: scoped.length };
  }, [tasks, projects, scopeProject, onlyMine, user?.id, today]);

  const { rows, rowIndex, rangeStart, totalDays, undated } = model;
  const width = totalDays * ppd;
  const scale = useMemo(() => buildScale(rangeStart, totalDays, zoom), [rangeStart, totalDays, zoom]);
  const x = iso => diffDays(rangeStart, iso) * ppd;
  const todayX = x(today) + ppd / 2;

  // --- scrolling
  const scrollRef = useRef(null);
  const scrollToToday = (behavior = 'auto') => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: Math.max(0, todayX - (el.clientWidth - LEFT) / 3), behavior });
  };
  const ready = !(tasksState.loading && !tasks.length) && !tasksState.error;
  useLayoutEffect(() => { if (ready) scrollToToday(); }, [ready, ppd]); // eslint-disable-line react-hooks/exhaustive-deps
  // When an edit widens the range to the left, keep the visible dates in place.
  const prevStart = useRef(rangeStart);
  useLayoutEffect(() => {
    if (scrollRef.current && prevStart.current !== rangeStart) scrollRef.current.scrollLeft += diffDays(rangeStart, prevStart.current) * ppd;
    prevStart.current = rangeStart;
  }, [rangeStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- drag to shift dates (mouse/pen only so touch keeps native scrolling)
  const [drag, setDrag] = useState(null); // { id, x0, delta, moved }
  const suppressClick = useRef(false);

  const commitShift = async (row, delta) => {
    if (!delta) return;
    const patch = { startDate: addDaysISO(row.start, delta), dueDate: addDaysISO(row.end, delta) };
    const before = { startDate: row.task.startDate || null, dueDate: row.task.dueDate };
    const updated = await updateTask(row.task.id, patch, { silent: true });
    if (updated) toast(`Datas de ${row.task.id} alteradas`, 'success', { label: 'Desfazer', onClick: () => updateTask(row.task.id, before, { silent: true }) });
  };

  const barHandlers = row => canEdit ? {
    onPointerDown: e => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id: row.task.id, x0: e.clientX, delta: 0, moved: false });
    },
    onPointerMove: e => {
      if (drag?.id !== row.task.id) return;
      const moved = drag.moved || Math.abs(e.clientX - drag.x0) > 4;
      const delta = moved ? Math.round((e.clientX - drag.x0) / ppd) : 0;
      if (moved !== drag.moved || delta !== drag.delta) setDrag({ ...drag, moved, delta });
    },
    onPointerUp: () => {
      if (drag?.id !== row.task.id) return;
      if (drag.moved) { suppressClick.current = true; commitShift(row, drag.delta); }
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: e => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      commitShift(row, e.key === 'ArrowRight' ? 1 : -1);
    }
  } : {};

  const barGeom = row => {
    const delta = drag?.id === row.task.id ? drag.delta : 0;
    const left = x(row.start) + delta * ppd;
    return { left, width: (diffDays(row.start, row.end) + 1) * ppd };
  };

  const arrows = useMemo(() => {
    const list = [];
    rows.forEach((r, i) => {
      if (r.type !== 'task') return;
      (r.task.blockedBy || []).forEach(bid => {
        const j = rowIndex[bid];
        if (j === undefined) return;
        const blocker = rows[j];
        const conflict = blocker.task.status !== 'Done' && r.start < blocker.end;
        list.push({ key: `${bid}>${r.task.id}`, from: blocker, to: r, i, j, conflict });
      });
    });
    return list;
  }, [rows, rowIndex]);

  const onCreate = can('task.create') ? () => openQuickCreate(scopeProject ? { projectId: scopeProject } : {}) : null;

  const toolbar = (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Zoom" value={zoom} onChange={setZoom}
          options={[{ value: 'day', label: 'Dia' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }]} />
        <Btn icon="today" onClick={() => scrollToToday('smooth')}>Hoje</Btn>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
  if (tasksState.loading && !tasks.length) body = <Card><LoadingState rows={6} label="Carregando linha do tempo…" /></Card>;
  else if (tasksState.error) body = <Card><ErrorState error={tasksState.error} onRetry={reloadTasks} /></Card>;
  else if (!rows.length && !undated.length) {
    body = (
      <Card><EmptyState icon="view_timeline" title="Nada para mostrar na linha do tempo"
        description={onlyMine ? 'Nenhuma tarefa atribuída a você neste escopo.' : 'Crie tarefas com início e prazo para visualizar o cronograma.'}
        action={onCreate && <Btn icon="add" onClick={onCreate}>Nova tarefa</Btn>} /></Card>
    );
  } else {
    body = (
      <>
        {rows.length > 0 ? (
          <div ref={scrollRef} role="region" aria-label="Linha do tempo" tabIndex={0}
            className="relative overflow-auto max-h-[72vh] bg-surface-card border border-border rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
            <div className="relative" style={{ width: LEFT + width }}>
              {/* header */}
              <div className="sticky top-0 z-30 flex bg-surface-card border-b border-border" style={{ height: HEADER }}>
                <div className="sticky left-0 z-40 flex items-end px-3 pb-1.5 bg-surface-card border-r border-border text-[11px] font-medium text-text-muted" style={{ width: LEFT, minWidth: LEFT }}>Tarefa</div>
                <div className="relative" style={{ width }} aria-hidden="true">
                  {scale.months.map(m => (
                    <div key={m.iso} className="absolute top-0 h-6 flex items-center px-2 text-[11px] font-medium text-text-secondary border-l border-border-subtle truncate" style={{ left: m.i * ppd, width: m.span * ppd }}>
                      {m.span * ppd > 60 ? formatDate(m.iso, { month: 'short', year: 'numeric' }) : formatDate(m.iso, { month: 'short' })}
                    </div>
                  ))}
                  {scale.minor.map(d => (
                    <div key={d.iso} className={`absolute top-6 h-6 flex items-center text-[10px] ${d.weekend ? 'text-text-muted' : 'text-text-secondary'} ${zoom === 'day' ? 'justify-center' : 'pl-1.5 border-l border-border-subtle'}`}
                      style={{ left: d.i * ppd, width: zoom === 'day' ? ppd : 7 * ppd }}>{d.label}</div>
                  ))}
                  <div className="absolute bottom-0 -translate-x-1/2 px-1.5 rounded-t-md bg-blue-500 text-white text-[10px] font-semibold leading-4" style={{ left: todayX }}>Hoje</div>
                </div>
              </div>

              {/* body */}
              <div className="relative">
                <svg className="absolute top-0 pointer-events-none" style={{ left: LEFT }} width={width} height={rows.length * ROW} aria-hidden="true">
                  {zoom === 'day' && scale.minor.filter(d => d.weekend).map(d => <rect key={d.iso} x={d.i * ppd} y={0} width={ppd} height={rows.length * ROW} style={{ fill: 'rgb(var(--text-muted))', opacity: 0.05 }} />)}
                  {(zoom === 'month' ? scale.months : scale.minor.filter(d => zoom === 'week' || parseISODate(d.iso).getDay() === 1)).map(d => (
                    <line key={d.iso} x1={d.i * ppd + 0.5} x2={d.i * ppd + 0.5} y1={0} y2={rows.length * ROW} style={{ stroke: 'rgb(var(--border-subtle))' }} />
                  ))}
                </svg>

                {rows.map(r => {
                  if (r.type === 'project') {
                    return (
                      <div key={r.key} className="flex border-b border-border-subtle bg-background-secondary/40" style={{ height: ROW }}>
                        <div className="sticky left-0 z-20 flex items-center gap-2 px-3 bg-surface-elevated border-r border-border min-w-0" style={{ width: LEFT, minWidth: LEFT }}>
                          <span aria-hidden="true" className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: r.project.color }} />
                          {embedded ? <span className="truncate text-[12px] font-semibold text-text-primary">{r.project.name}</span> : (
                            <button type="button" onClick={() => navigate(`/projects/${r.project.id}`)} className="truncate text-[12px] font-semibold text-text-primary hover:underline text-left">{r.project.name}</button>
                          )}
                          <span className="ml-auto text-[10px] font-mono text-text-muted">{r.count}</span>
                        </div>
                        <div style={{ width }} />
                      </div>
                    );
                  }
                  if (r.type === 'milestones') {
                    return (
                      <div key={r.key} className="flex border-b border-border-subtle" style={{ height: ROW }}>
                        <div className="sticky left-0 z-20 flex items-center gap-2 px-3 bg-surface-card border-r border-border text-[12px] text-text-secondary" style={{ width: LEFT, minWidth: LEFT }}>
                          <Icon name="flag" size={14} className="text-text-muted" />Marcos
                        </div>
                        <div className="relative" style={{ width }}>
                          {r.milestones.map(m => (
                            <div key={m.id} className="absolute top-1/2 -translate-y-1/2 flex items-center gap-1.5" style={{ left: x(m.dueDate) + ppd / 2 - 6 }}
                              role="img" aria-label={`Marco ${m.name} em ${formatDate(m.dueDate)}`} title={`${m.name} · ${formatDate(m.dueDate)}`}>
                              <span className="w-3 h-3 rotate-45 rounded-[2px] border-2 border-surface-card" style={{ background: r.project.color }} />
                              {ppd >= 16 && <span className="text-[11px] text-text-secondary whitespace-nowrap">{m.name}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  const { task } = r;
                  const g = barGeom(r);
                  const done = task.status === 'Done';
                  const inside = g.width >= 90;
                  const label = `${task.id} ${task.title}: ${formatDate(r.start)} a ${formatDate(r.end)}${task.isBlocked ? ', bloqueada' : ''}${canEdit ? '. Alt + setas para mover um dia' : ''}`;
                  return (
                    <div key={r.key} className="flex border-b border-border-subtle" style={{ height: ROW }}>
                      <div className="sticky left-0 z-20 flex items-center bg-surface-card border-r border-border min-w-0" style={{ width: LEFT, minWidth: LEFT }}>
                        <button type="button" onClick={() => openTask(task.id)} className="w-full h-full flex items-center gap-2 px-3 text-left hover:bg-surface-hover min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500/50">
                          <span className="font-mono text-[10px] text-text-muted flex-shrink-0 hidden sm:inline">{task.id}</span>
                          <span className={`truncate text-[12px] ${done ? 'text-text-muted line-through' : 'text-text-primary'}`}>{task.title}</span>
                        </button>
                      </div>
                      <div className="relative" style={{ width }}>
                        <button
                          type="button"
                          aria-label={label}
                          title={`${task.title} · ${formatDate(r.start)} → ${formatDate(r.end)} · ${PRIORITY_LABEL[task.priority]}`}
                          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } openTask(task.id); }}
                          {...barHandlers(r)}
                          className={`absolute top-1.5 bottom-1.5 z-10 flex items-center gap-1 px-2 rounded-md border-l-[3px] text-[11px] text-text-primary text-left select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${done ? 'opacity-50' : ''} ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${drag?.id === task.id && drag.moved ? 'ring-1 ring-blue-500/60 shadow-elevated' : ''}`}
                          style={{ left: g.left, width: g.width, background: `color-mix(in srgb, ${r.project.color} 28%, transparent)`, borderLeftColor: r.project.color }}
                        >
                          {task.isBlocked && <Icon name="lock" size={12} className="text-amber-400 flex-shrink-0" />}
                          {inside && <span className="truncate">{task.title}</span>}
                        </button>
                        {!inside && (
                          <span aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 text-[11px] text-text-secondary whitespace-nowrap pointer-events-none" style={{ left: g.left + g.width + 6 }}>{task.title}</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {arrows.length > 0 && (
                  <svg className="absolute top-0 z-[15] pointer-events-none overflow-visible" style={{ left: LEFT }} width={width} height={rows.length * ROW} aria-hidden="true">
                    <defs>
                      <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" style={{ fill: 'rgb(var(--text-muted))' }} /></marker>
                      <marker id="tl-arrow-conflict" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 Z" style={{ fill: CONFLICT }} /></marker>
                    </defs>
                    {arrows.map(a => {
                      const from = barGeom(a.from);
                      const to = barGeom(a.to);
                      return (
                        <path key={a.key} d={arrowPath(from.left + from.width, a.j * ROW + ROW / 2, to.left, a.i * ROW + ROW / 2)}
                          fill="none" strokeWidth={1.5} markerEnd={`url(#${a.conflict ? 'tl-arrow-conflict' : 'tl-arrow'})`}
                          style={{ stroke: a.conflict ? CONFLICT : 'rgb(var(--text-muted))' }} />
                      );
                    })}
                  </svg>
                )}

                <div className="absolute top-0 bottom-0 w-px bg-blue-500 z-[16] pointer-events-none" style={{ left: LEFT + todayX }} aria-hidden="true" />
              </div>
            </div>
          </div>
        ) : (
          <Card><EmptyState compact icon="view_timeline" title="Nenhuma tarefa com prazo" description="Defina prazos para ver as tarefas na linha do tempo." /></Card>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-text-muted" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-blue-500" />Hoje</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rotate-45 bg-text-muted rounded-[1px]" />Marco</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-px bg-text-muted" />Dependência</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-px bg-red-500" />Conflito: começa antes do bloqueador terminar</span>
          {canEdit && wide && <span>Arraste as barras para mover as datas</span>}
        </div>

        {undated.length > 0 && (
          <Card className="mt-4" padded={false}>
            <h2 className="px-4 pt-3.5 pb-2 text-[13px] font-semibold text-text-primary flex items-center gap-2">
              <Icon name="event_busy" size={17} className="text-text-muted" />Sem prazo <span className="text-[11px] font-mono text-text-muted">{undated.length}</span>
            </h2>
            <p className="px-4 -mt-1 pb-2 text-[11px] text-text-muted">Defina um prazo para posicionar estas tarefas no cronograma.</p>
            <ul className="px-2 pb-2 grid sm:grid-cols-2 xl:grid-cols-3">
              {undated.map(t => (
                <li key={t.id}>
                  <button type="button" onClick={() => openTask(t.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
                    <span className="font-mono text-[10px] text-text-muted">{t.id}</span>
                    <span className={`truncate text-[12px] ${t.status === 'Done' ? 'text-text-muted line-through' : 'text-text-primary'}`}>{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </>
    );
  }

  const content = <>{toolbar}{body}</>;
  if (embedded) return <div>{content}</div>;
  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader title="Linha do tempo" description={ready ? `${pluralize(model.scopedCount, 'tarefa', 'tarefas')} em ${pluralize(rows.filter(r => r.type === 'project').length, 'projeto', 'projetos')}` : 'Cronograma das tarefas e marcos'}
        actions={onCreate && <Btn variant="primary" icon="add" onClick={onCreate}>Nova tarefa</Btn>} />
      {content}
    </div>
  );
}
