import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useLocalStorage } from '../../lib/hooks';
import { PRIORITIES, PRIORITY_COLOR, PRIORITY_LABEL, TASK_TYPES, TYPE_META, todayISO, addDaysISO, formatDate, dueInfo, pluralize } from '../../lib/format';
import { Avatar, Btn, Card, EmptyState, ErrorState, Field, Icon, Input, Modal, PageHeader, ProgressBar, Select, Skeleton } from '../ui';
import { HealthBadge } from '../common/Badge';
import { LineChart } from '../charts/LineChart';
import { BarChart } from '../charts/BarChart';
import { VIZ, formatNumber } from '../charts/theme';
import { StatCard, TONE_TEXT } from '../dashboard/parts';
import { MultiSelect } from '../dashboard/MultiSelect';
import { SavedReportsDrawer } from '../dashboard/SavedReportsDrawer';

const PRESETS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' }
];
const EMPTY_FILTERS = { preset: '30', from: '', to: '', projectIds: [], assigneeIds: [], priorities: [], types: [], tags: [] };
const LIST_KEYS = ['projectIds', 'assigneeIds', 'priorities', 'types', 'tags'];
const EXPORTS = [{ format: 'pdf', label: 'PDF' }, { format: 'csv', label: 'CSV' }, { format: 'xlsx', label: 'Excel' }];

function resolvePeriod(f, today) {
  if (f.preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (f.preset === 'custom') return { from: f.from, to: f.to };
  return { from: addDaysISO(today, -(Number(f.preset) - 1)), to: today };
}

// Maps saved (absolute) dates back to a preset when they match one relative to today.
function presetFor({ from, to }, today) {
  if (to === today) {
    const hit = ['7', '30', '90'].find(n => from === addDaysISO(today, -(Number(n) - 1)));
    if (hit) return hit;
    if (from === `${today.slice(0, 7)}-01`) return 'month';
  }
  return 'custom';
}

function ChartCard({ title, subtitle, children, className = '' }) {
  return (
    <Card className={`min-w-0 ${className}`}>
      <h2 className="text-[13px] font-semibold text-text-primary">{title}</h2>
      {subtitle && <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function TaskListCard({ title, icon, items, empty, renderMeta, onOpen }) {
  return (
    <Card padded={false} className="min-w-0">
      <h2 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-[13px] font-semibold text-text-primary">
        <Icon name={icon} size={17} className="text-text-muted" />{title}<span className="text-[11px] font-mono text-text-muted">{items.length}</span>
      </h2>
      {items.length ? (
        <ul className="px-2 pb-2 max-h-[360px] overflow-y-auto">
          {items.map(t => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t.id)} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-text-primary truncate">{t.title}</span>
                  <span className="block text-[11px] text-text-muted truncate">{renderMeta(t)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <EmptyState compact icon="task_alt" title={empty} />}
    </Card>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando relatório" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}</div>
      <div className="grid lg:grid-cols-2 gap-4"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      <div className="grid lg:grid-cols-3 gap-4"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
    </div>
  );
}

export function ReportsView({ projectId }) {
  const { currentWorkspaceId, can, projects, members, tasks, openTask, toast, showError } = useApp();
  const embedded = Boolean(projectId);
  const today = todayISO();
  const [filters, setFilters] = useLocalStorage(`taskly.reports.${currentWorkspaceId}${embedded ? `.${projectId}` : ''}`, EMPTY_FILTERS);
  const f = { ...EMPTY_FILTERS, ...filters };
  const patch = p => setFilters(prev => ({ ...EMPTY_FILTERS, ...prev, ...p }));

  const period = resolvePeriod(f, today);
  const periodError = f.preset === 'custom' && (!period.from || !period.to ? 'Informe as duas datas' : period.from > period.to ? 'A data inicial deve ser anterior à final' : null);

  // Last valid filter set actually sent to the API.
  const lastValid = useRef(null);
  const apiFilters = useMemo(() => {
    if (periodError) return lastValid.current || { ...resolvePeriod(EMPTY_FILTERS, today), projectIds: embedded ? [projectId] : [] };
    const next = { ...period, projectIds: embedded ? [projectId] : f.projectIds, assigneeIds: f.assigneeIds, priorities: f.priorities, types: f.types, tags: f.tags };
    lastValid.current = next;
    return next;
  }, [JSON.stringify(f), periodError, today, embedded, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(apiFilters);

  const allowed = can('reports.view');
  const report = useAsync(() => (allowed ? api.reports.get(currentWorkspaceId, apiFilters) : Promise.resolve(null)), [currentWorkspaceId, key, allowed]);
  const saved = useAsync(() => api.reports.saved(currentWorkspaceId), [currentWorkspaceId], { immediate: false });
  const [savedOpen, setSavedOpen] = useState(false);
  const [saveModal, setSaveModal] = useState(null); // { name, saving }
  const [exporting, setExporting] = useState(null);
  const closeSaved = useCallback(() => setSavedOpen(false), []);
  const closeSaveModal = useCallback(() => setSaveModal(null), []);

  const projectsById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);
  const membersById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members]);
  const tagOptions = useMemo(() => {
    const set = new Set();
    tasks.forEach(t => { if (!embedded || t.projectId === projectId) (t.tags || []).forEach(tag => set.add(tag)); });
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(t => ({ value: t, label: t }));
  }, [tasks, embedded, projectId]);

  const activeFilterCount = LIST_KEYS.filter(k => k !== 'projectIds' || !embedded).reduce((a, k) => a + f[k].length, 0);

  const openSaved = () => { setSavedOpen(true); if (!saved.data) saved.reload(); };
  const applySaved = r => {
    const sf = r.filters;
    patch({ preset: sf.preset && sf.preset !== 'custom' ? sf.preset : presetFor(sf, today), from: sf.from, to: sf.to, projectIds: embedded ? [] : sf.projectIds || [], assigneeIds: sf.assigneeIds || [], priorities: sf.priorities || [], types: sf.types || [], tags: sf.tags || [] });
    setSavedOpen(false);
    toast(`Relatório "${r.name}" aplicado`, 'success');
  };

  const saveReport = async e => {
    e.preventDefault();
    const name = saveModal.name.trim();
    if (name.length < 2) return;
    setSaveModal(s => ({ ...s, saving: true }));
    try {
      const res = await api.reports.save(currentWorkspaceId, { name, filters: { ...apiFilters, preset: filters.preset } });
      if (saved.data) saved.setData(d => ({ ...d, savedReports: [...d.savedReports, res.savedReport] }));
      setSaveModal(null);
      toast('Relatório salvo', 'success');
    } catch (err) {
      showError(err);
      setSaveModal(s => ({ ...s, saving: false }));
    }
  };

  const exportAs = async format => {
    setExporting(format);
    try {
      await api.reports.export(currentWorkspaceId, format, apiFilters);
      toast('Exportação concluída', 'success');
    } catch (err) { showError(err, 'Não foi possível exportar o relatório'); } finally { setExporting(null); }
  };

  const actions = allowed && (
    <>
      <Btn icon="bookmark" onClick={openSaved}>Relatórios salvos</Btn>
      <Btn icon="bookmark_add" onClick={() => setSaveModal({ name: '', saving: false })} disabled={Boolean(periodError)}>Salvar relatório</Btn>
      {can('reports.export') && (
        <div className="inline-flex items-center gap-1" role="group" aria-label="Exportar relatório">
          {EXPORTS.map(x => (
            <Btn key={x.format} icon="download" loading={exporting === x.format} disabled={Boolean(exporting) || Boolean(periodError)} onClick={() => exportAs(x.format)} aria-label={`Exportar em ${x.label}`}>{x.label}</Btn>
          ))}
        </div>
      )}
    </>
  );

  const filterBar = (
    <div className="flex flex-wrap items-start gap-2 mb-4">
      <Select aria-label="Período" value={f.preset} onChange={e => patch({ preset: e.target.value, ...(e.target.value === 'custom' && !f.from ? { from: period.from, to: period.to } : {}) })} className="w-auto h-8">
        {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </Select>
      {f.preset === 'custom' && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="Data inicial" value={f.from} max={f.to || undefined} onChange={e => patch({ from: e.target.value })} className="h-8 w-[150px]" aria-invalid={Boolean(periodError)} />
            <span className="text-text-muted text-[12px]">até</span>
            <Input type="date" aria-label="Data final" value={f.to} min={f.from || undefined} onChange={e => patch({ to: e.target.value })} className="h-8 w-[150px]" aria-invalid={Boolean(periodError)} />
          </div>
          {periodError && <p role="alert" className="text-[11px] text-red-400">{periodError}</p>}
        </div>
      )}
      {!embedded && <MultiSelect label="Projetos" value={f.projectIds} onChange={v => patch({ projectIds: v })} options={projects.map(p => ({ value: p.id, label: p.name, swatch: p.color }))} />}
      <MultiSelect label="Membros" value={f.assigneeIds} onChange={v => patch({ assigneeIds: v })} options={members.map(m => ({ value: m.id, label: m.name }))} />
      <MultiSelect label="Prioridade" allLabel="Todas" value={f.priorities} onChange={v => patch({ priorities: v })} options={PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABEL[p], swatch: PRIORITY_COLOR[p] }))} />
      <MultiSelect label="Tipo" value={f.types} onChange={v => patch({ types: v })} options={TASK_TYPES.map(t => ({ value: t, label: TYPE_META[t].label }))} />
      {tagOptions.length > 0 && <MultiSelect label="Tags" allLabel="Todas" value={f.tags} onChange={v => patch({ tags: v })} options={tagOptions} />}
      {(activeFilterCount > 0 || f.preset !== EMPTY_FILTERS.preset) && (
        <Btn variant="ghost" icon="filter_alt_off" onClick={() => setFilters(EMPTY_FILTERS)}>Limpar filtros</Btn>
      )}
    </div>
  );

  let body;
  const data = report.data;
  if (!allowed) body = <Card><EmptyState icon="lock" title="Sem acesso a relatórios" description="Seu papel neste workspace não permite ver relatórios. Fale com um gestor." /></Card>;
  else if (report.loading && !data) body = <ReportSkeleton />;
  else if (report.error && !data) body = <Card><ErrorState error={report.error} onRetry={report.reload} /></Card>;
  else {
    const m = data.metrics;
    const hasTasks = data.statusDistribution.length > 0 || m.tasksCreated > 0 || m.tasksCompleted > 0;
    const stepLabel = data.seriesStep === 'week' ? 'Série semanal' : 'Série diária';
    const periodLabel = `${formatDate(data.filters.from)} – ${formatDate(data.filters.to, { day: '2-digit', month: 'short', year: 'numeric' })}`;
    const workload = [...data.workload].sort((a, b) => (a.userId === null) - (b.userId === null) || a.userName.localeCompare(b.userName, 'pt-BR'));
    const maxOpen = Math.max(1, ...workload.map(w => w.open));
    body = (
      <div className={`flex flex-col gap-4 transition-opacity ${report.loading ? 'opacity-60' : ''}`} aria-busy={report.loading}>
        {report.error && <p role="alert" className="text-[12px] text-red-400">Não foi possível atualizar: {report.error.message} <button type="button" className="underline" onClick={() => report.reload()}>Tentar novamente</button></p>}
        <p className="text-[12px] text-text-muted -mt-1">{periodLabel} · {stepLabel}</p>
        <section aria-label="Indicadores" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-3">
          <StatCard label="Tarefas criadas" value={formatNumber(m.tasksCreated)} icon="add_task" hint="No período" />
          <StatCard label="Concluídas" value={formatNumber(m.tasksCompleted)} icon="check_circle" hint="No período" />
          <StatCard label="Atrasadas" value={formatNumber(m.overdueTasks)} icon="schedule" tone={m.overdueTasks ? 'danger' : undefined} hint="Em aberto hoje" />
          <StatCard label="Taxa de conclusão" value={m.completionRate === null ? '—' : `${m.completionRate}%`} icon="percent" hint="Das criadas no período" />
          <StatCard label="Tempo médio de conclusão" value={m.avgCompletionDays === null ? '—' : formatNumber(m.avgCompletionDays)} icon="timer" hint="Dias, da criação à conclusão" />
          <StatCard label="Projetos ativos" value={formatNumber(m.activeProjects)} icon="folder_open" />
          <StatCard label="Bloqueadas" value={formatNumber(m.blockedTasks)} icon="lock" tone={m.blockedTasks ? 'warning' : undefined} hint="Por dependências abertas" />
        </section>

        {!hasTasks ? (
          <Card><EmptyState icon="query_stats" title="Nenhuma tarefa encontrada com estes filtros" description="Amplie o período ou remova alguns filtros para ver os gráficos."
            action={<Btn icon="filter_alt_off" onClick={() => setFilters(EMPTY_FILTERS)}>Limpar filtros</Btn>} /></Card>
        ) : (
          <>
            <div className="grid lg:grid-cols-2 gap-4">
              <ChartCard title="Tarefas concluídas ao longo do tempo" subtitle={stepLabel}>
                <LineChart title="Tarefas concluídas ao longo do tempo" data={data.series} step={data.seriesStep} series={[{ key: 'completed', label: 'Concluídas', color: VIZ.series3, area: true }]} emptyLabel="Nenhuma tarefa concluída no período" />
              </ChartCard>
              <ChartCard title="Criadas vs. concluídas" subtitle={stepLabel}>
                <LineChart title="Tarefas criadas vs. concluídas" data={data.series} step={data.seriesStep}
                  series={[{ key: 'created', label: 'Criadas', color: VIZ.series1 }, { key: 'completed', label: 'Concluídas', color: VIZ.series3 }]} />
              </ChartCard>
            </div>

            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              <ChartCard title="Tarefas por status" subtitle="Todas as tarefas do escopo">
                <BarChart title="Tarefas por status" items={data.statusDistribution.map(s => ({ key: s.status, label: s.label, value: s.count }))} />
              </ChartCard>
              <ChartCard title="Tarefas por prioridade" subtitle="Somente tarefas em aberto">
                <BarChart title="Tarefas em aberto por prioridade" emptyLabel="Nenhuma tarefa em aberto"
                  items={data.priorityDistribution.map(p => ({ key: p.priority, label: PRIORITY_LABEL[p.priority], value: p.count, color: PRIORITY_COLOR[p.priority] }))} />
              </ChartCard>
              <ChartCard title="Tarefas por tipo" subtitle="Todas as tarefas do escopo" className="md:col-span-2 xl:col-span-1">
                <BarChart title="Tarefas por tipo" items={data.typeDistribution.map(t => ({ key: t.type, label: TYPE_META[t.type]?.label || t.type, value: t.count }))} />
              </ChartCard>
            </div>
          </>
        )}

        <div className="grid xl:grid-cols-2 gap-4">
          {!embedded && (
            <ChartCard title="Progresso dos projetos" subtitle="Saúde calculada por prazos, atrasos e bloqueios">
              {data.projectProgress.length ? (
                <ul className="flex flex-col gap-3">
                  {data.projectProgress.map(p => (
                    <li key={p.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span aria-hidden="true" className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: p.color }} />
                        <span className="truncate text-[12px] font-medium text-text-primary flex-1">{p.name}</span>
                        <HealthBadge health={p.health} reasons={p.healthReasons} />
                      </div>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={p.progress} className="flex-1" />
                        <span className="text-[11px] font-mono text-text-secondary w-9 text-right">{p.progress}%</span>
                      </div>
                      <p className="text-[11px] text-text-muted">
                        {p.completedTasks}/{p.totalTasks} concluídas · {pluralize(p.overdueTasks, 'atrasada', 'atrasadas')} · {pluralize(p.blockedTasks, 'bloqueada', 'bloqueadas')}
                        {p.healthReasons?.length > 0 && <span className="text-text-secondary"> — {p.healthReasons.join('; ')}</span>}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact icon="folder_open" title="Nenhum projeto no escopo" />}
            </ChartCard>
          )}

          <ChartCard title="Distribuição de carga" subtitle="Números objetivos por pessoa no período — não é uma avaliação de desempenho" className={embedded ? 'xl:col-span-2' : ''}>
            {workload.length ? (
              <div className="relative overflow-x-auto -mx-1">
                <table className="w-full text-[12px] min-w-[460px]">
                  <thead>
                    <tr className="text-left text-[11px] text-text-muted">
                      <th scope="col" className="font-medium px-1 pb-2">Pessoa</th>
                      <th scope="col" className="font-medium px-1 pb-2">Em aberto</th>
                      <th scope="col" className="font-medium px-1 pb-2 text-right">Concluídas</th>
                      <th scope="col" className="font-medium px-1 pb-2 text-right">Atrasadas</th>
                      <th scope="col" className="font-medium px-1 pb-2 text-right">Média (dias)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workload.map(w => (
                      <tr key={w.userId || 'none'} className="border-t border-border-subtle">
                        <th scope="row" className="px-1 py-2 font-normal text-left">
                          <span className="flex items-center gap-2 min-w-0">
                            <Avatar user={w.userId ? { name: w.userName, avatar: w.userAvatar } : null} size={22} />
                            <span className="truncate text-text-primary">{w.userName}</span>
                          </span>
                        </th>
                        <td className="px-1 py-2">
                          <span className="flex items-center gap-2">
                            <span className="w-8 text-right tabular-nums text-text-primary">{w.open}</span>
                            <svg width="80" height="8" aria-hidden="true" className="flex-shrink-0">
                              <rect x="0" y="0" width="80" height="8" rx="4" style={{ fill: 'rgb(var(--surface-hover))' }} />
                              {w.open > 0 && <rect x="0" y="0" width={Math.max(8, (w.open / maxOpen) * 80)} height="8" rx="4" style={{ fill: VIZ.series1 }} />}
                            </svg>
                          </span>
                        </td>
                        <td className="px-1 py-2 text-right tabular-nums text-text-secondary">{w.completed}</td>
                        <td className={`px-1 py-2 text-right tabular-nums ${w.overdue ? 'text-red-400' : 'text-text-secondary'}`}>{w.overdue}</td>
                        <td className="px-1 py-2 text-right tabular-nums text-text-secondary">{w.avgCompletionDays === null ? '—' : formatNumber(w.avgCompletionDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState compact icon="group" title="Sem tarefas atribuídas no escopo" />}
          </ChartCard>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <TaskListCard title="Atrasadas" icon="schedule" items={data.overdueList} empty="Nenhuma tarefa atrasada" onOpen={openTask}
            renderMeta={t => {
              const due = dueInfo(t.dueDate, 'open');
              return <>{t.id} · {projectsById[t.projectId]?.name || 'Projeto'} · <span className={TONE_TEXT[due.tone]}>{due.label}</span>{t.assigneeId && membersById[t.assigneeId] ? ` · ${membersById[t.assigneeId].name}` : ''}</>;
            }} />
          <TaskListCard title="Bloqueadas" icon="lock" items={data.blockedList} empty="Nenhuma tarefa bloqueada" onOpen={openTask}
            renderMeta={t => `${t.id} · ${projectsById[t.projectId]?.name || 'Projeto'} · Bloqueada por ${(t.blockedBy || []).join(', ')}`} />
        </div>
      </div>
    );
  }

  const content = (
    <>
      {allowed && filterBar}
      {body}
      <SavedReportsDrawer open={savedOpen} onClose={closeSaved} saved={saved} onApply={applySaved} />
      <Modal open={Boolean(saveModal)} onClose={closeSaveModal} title="Salvar relatório" description="Os filtros atuais (período, projetos, membros, prioridade, tipo e tags) ficarão disponíveis para todo o workspace." size="sm"
        footer={<><Btn onClick={() => setSaveModal(null)}>Cancelar</Btn><Btn variant="primary" type="submit" form="save-report-form" loading={saveModal?.saving} disabled={(saveModal?.name.trim().length || 0) < 2}>Salvar</Btn></>}>
        {saveModal && (
          <form id="save-report-form" onSubmit={saveReport}>
            <Field label="Nome" required hint="Mínimo de 2 caracteres">
              <Input data-autofocus value={saveModal.name} maxLength={100} onChange={e => setSaveModal(s => ({ ...s, name: e.target.value }))} placeholder="Ex.: Sprint atual — equipe de produto" />
            </Field>
          </form>
        )}
      </Modal>
    </>
  );

  if (embedded) {
    return (
      <div>
        {actions && <div className="flex flex-wrap items-center justify-end gap-2 mb-3">{actions}</div>}
        {content}
      </div>
    );
  }
  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader title="Relatórios" description="Acompanhe entregas, prazos e carga de trabalho com dados objetivos." actions={actions} />
      {content}
    </div>
  );
}
