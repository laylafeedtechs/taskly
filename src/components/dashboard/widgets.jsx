import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { todayISO, addDaysISO, parseISODate, formatDate, timeAgo, pluralize } from '../../lib/format';
import { Avatar, Btn, EmptyState, ErrorState, Icon, ProgressBar, Skeleton, Tabs } from '../ui';
import { HealthBadge } from '../common/Badge';
import { Sparkline } from '../charts/LineChart';
import { Legend } from '../charts/parts';
import { VIZ } from '../charts/theme';
import { StatCard, TaskRowList, WidgetCard, WidgetLink } from './parts';

export const WIDGETS = [
  { id: 'metrics', label: 'Indicadores', description: 'Tarefas abertas, prazos de hoje, atrasadas e concluídas na semana', icon: 'monitoring', full: true },
  { id: 'my-tasks', label: 'Minhas tarefas', description: 'O que vence hoje e suas tarefas abertas', icon: 'task_alt' },
  { id: 'upcoming', label: 'Próximos prazos', description: 'Tarefas que vencem nos próximos 7 dias', icon: 'event_upcoming' },
  { id: 'overdue', label: 'Atrasadas', description: 'Suas tarefas com prazo vencido', icon: 'schedule' },
  { id: 'activity', label: 'Atividade recente', description: 'Últimas mudanças no workspace', icon: 'history' },
  { id: 'projects', label: 'Visão dos projetos', description: 'Progresso e saúde de cada projeto', icon: 'folder_open', full: true },
  { id: 'calendar', label: 'Mini calendário', description: 'Sua semana com a quantidade de tarefas por dia', icon: 'calendar_month' },
  { id: 'reports', label: 'Resumo de relatórios', description: 'Criadas vs. concluídas nos últimos 14 dias', icon: 'insights' },
  { id: 'notifications', label: 'Notificações', description: 'Suas 5 notificações mais recentes', icon: 'notifications' }
];
export const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map(w => [w.id, w]));
export const DEFAULT_LAYOUT = ['metrics', 'my-tasks', 'upcoming', 'activity', 'projects'];

function useProjectsById() {
  const { projects } = useApp();
  return useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);
}

function MetricsWidget({ data }) {
  const { navigate } = useApp();
  const m = data.metrics;
  const go = () => navigate('/my-tasks');
  return (
    <section aria-label="Indicadores" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label="Tarefas abertas" value={m.openTasks} icon="radio_button_unchecked" hint="Atribuídas a você" onClick={go} />
      <StatCard label="Vencem hoje" value={m.dueToday} icon="today" tone={m.dueToday ? 'warning' : undefined} hint={m.dueToday ? 'Priorize estas primeiro' : 'Nada vence hoje'} onClick={go} />
      <StatCard label="Atrasadas" value={m.overdue} icon="schedule" tone={m.overdue ? 'danger' : undefined} hint={m.overdue ? 'Prazo já passou' : 'Tudo em dia'} onClick={go} />
      <StatCard label="Concluídas na semana" value={m.completedThisWeek} icon="check_circle" tone={m.completedThisWeek ? 'success' : undefined} hint="Desde segunda-feira" onClick={go} />
    </section>
  );
}

function MyTasksWidget({ data }) {
  const { openTask, openQuickCreate, navigate, can } = useApp();
  const projectsById = useProjectsById();
  const [tab, setTab] = useState('today');
  const list = tab === 'today' ? data.today : data.myTasks;
  return (
    <WidgetCard title="Minhas tarefas" icon="task_alt" action={<WidgetLink onClick={() => navigate('/my-tasks')} />}>
      <Tabs className="px-2 pb-2" value={tab} onChange={setTab} tabs={[{ id: 'today', label: 'Hoje', count: data.today.length }, { id: 'open', label: 'Abertas', count: data.metrics.openTasks }]} />
      {list.length ? <TaskRowList tasks={list} projectsById={projectsById} onOpen={openTask} /> : (
        <EmptyState compact icon={tab === 'today' ? 'wb_sunny' : 'task_alt'}
          title={tab === 'today' ? 'Nenhuma tarefa para hoje' : 'Nenhuma tarefa aberta'}
          description={tab === 'today' ? 'Aproveite para adiantar os próximos prazos ou planejar a semana.' : 'Tarefas atribuídas a você aparecem aqui.'}
          action={can('task.create') && <Btn icon="add" onClick={() => openQuickCreate({ dueDate: todayISO() })}>Criar tarefa</Btn>} />
      )}
    </WidgetCard>
  );
}

function UpcomingWidget({ data }) {
  const { openTask, navigate } = useApp();
  const projectsById = useProjectsById();
  return (
    <WidgetCard title="Próximos prazos" icon="event_upcoming" action={<WidgetLink onClick={() => navigate('/calendar')}>Calendário</WidgetLink>}>
      {data.upcoming.length ? <TaskRowList tasks={data.upcoming} projectsById={projectsById} onOpen={openTask} limit={8} /> : (
        <EmptyState compact icon="event_available" title="Nenhum prazo nos próximos 7 dias" description="Defina prazos nas suas tarefas para planejar a semana." action={<Btn icon="calendar_month" onClick={() => navigate('/calendar')}>Abrir calendário</Btn>} />
      )}
    </WidgetCard>
  );
}

function OverdueWidget({ data }) {
  const { openTask, navigate } = useApp();
  const projectsById = useProjectsById();
  const today = todayISO();
  const overdue = data.today.filter(t => t.dueDate < today);
  return (
    <WidgetCard title="Atrasadas" icon="schedule" action={overdue.length > 0 && <WidgetLink onClick={() => navigate('/my-tasks')} />}>
      {overdue.length ? <TaskRowList tasks={overdue} projectsById={projectsById} onOpen={openTask} limit={8} /> : (
        <EmptyState compact icon="verified" title="Nenhuma tarefa atrasada" description="Todas as suas tarefas estão dentro do prazo." />
      )}
    </WidgetCard>
  );
}

function ProjectsWidget({ data }) {
  const { navigate, can, setProjectModal } = useApp();
  return (
    <WidgetCard title="Visão dos projetos" icon="folder_open" action={<WidgetLink onClick={() => navigate('/projects')} />}>
      {data.projects.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 px-2 pb-2">
          {data.projects.map(p => (
            <li key={p.id}>
              <button type="button" onClick={() => navigate(`/projects/${p.id}`)} className="w-full h-full text-left p-3 rounded-lg border border-border-subtle bg-background-secondary/50 hover:border-border-focus hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 transition-colors flex flex-col gap-2.5">
                <span className="flex items-center gap-2 min-w-0">
                  <span aria-hidden="true" className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: p.color }} />
                  <span className="flex-1 truncate text-[13px] font-medium text-text-primary">{p.name}</span>
                  <HealthBadge health={p.health} reasons={p.healthReasons} />
                </span>
                <span className="flex items-center gap-2">
                  <ProgressBar value={p.progress} className="flex-1" />
                  <span className="text-[11px] font-mono text-text-secondary w-9 text-right">{p.progress}%</span>
                </span>
                <span className="text-[11px] text-text-muted">
                  {p.completedTasks} de {pluralize(p.totalTasks, 'tarefa concluída', 'tarefas concluídas')}
                  {p.dueDate && ` · Prazo ${formatDate(p.dueDate)}`}
                </span>
                {p.healthReasons?.length > 0 && <span className="text-[11px] text-text-secondary">{p.healthReasons.join(' · ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon="folder_open" title="Nenhum projeto ativo" description="Crie um projeto para acompanhar progresso e prazos."
          action={can('project.create') && <Btn icon="add" onClick={() => setProjectModal({})}>Criar projeto</Btn>} />
      )}
    </WidgetCard>
  );
}

function ActivityWidget({ data }) {
  const { openTask, navigate } = useApp();
  return (
    <WidgetCard title="Atividade recente" icon="history" action={<WidgetLink onClick={() => navigate('/activity')} />}>
      {data.recentActivity.length ? (
        <ul className="flex flex-col">
          {data.recentActivity.slice(0, 8).map(a => {
            const body = (
              <>
                <Avatar user={{ name: a.actor }} size={24} />
                <span className="min-w-0 flex-1 text-[12px] text-text-secondary">
                  <span className="font-medium text-text-primary">{a.actor}</span> {a.message}
                  {a.taskId && <span className="font-mono text-text-muted"> · {a.taskId}</span>}
                </span>
                <time dateTime={a.createdAt} className="text-[11px] text-text-muted whitespace-nowrap">{timeAgo(a.createdAt)}</time>
              </>
            );
            return (
              <li key={a.id}>
                {a.taskId ? (
                  <button type="button" onClick={() => openTask(a.taskId)} className="w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">{body}</button>
                ) : <div className="flex items-start gap-2.5 px-2 py-2">{body}</div>}
              </li>
            );
          })}
        </ul>
      ) : <EmptyState compact icon="history" title="Nenhuma atividade ainda" description="Criar, mover e comentar tarefas gera o histórico do workspace." />}
    </WidgetCard>
  );
}

function MiniCalendarWidget() {
  const { tasks, user, navigate } = useApp();
  const today = todayISO();
  const monday = addDaysISO(today, -((parseISODate(today).getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i));
  const counts = useMemo(() => {
    const c = {};
    tasks.forEach(t => { if (t.assigneeId === user?.id && t.status !== 'Done' && t.dueDate) c[t.dueDate] = (c[t.dueDate] || 0) + 1; });
    return c;
  }, [tasks, user?.id]);
  return (
    <WidgetCard title="Mini calendário" icon="calendar_month" action={<WidgetLink onClick={() => navigate('/calendar?view=week')}>Semana</WidgetLink>}>
      <ol className="grid grid-cols-7 gap-1 px-2 pb-2">
        {days.map(d => {
          const n = counts[d] || 0;
          const isToday = d === today;
          const weekday = formatDate(d, { weekday: 'short' });
          return (
            <li key={d}>
              <button type="button" onClick={() => navigate(`/calendar?view=day&date=${d}`)}
                aria-label={`${formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${pluralize(n, 'tarefa', 'tarefas')}`}
                className={`w-full flex flex-col items-center gap-1 py-2 rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 ${isToday ? 'border-border-focus bg-surface-elevated' : 'border-transparent hover:bg-surface-hover'}`}>
                <span className="text-[10px] uppercase tracking-wide text-text-muted">{weekday.slice(0, 3)}</span>
                <span className={`text-[15px] font-semibold ${isToday ? 'text-text-primary' : 'text-text-secondary'}`}>{parseISODate(d).getDate()}</span>
                <span className={`min-w-[20px] h-5 px-1 rounded-md text-[11px] font-mono flex items-center justify-center ${n ? (d < today ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-400') : 'text-text-muted'}`}>{n || '·'}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="px-3 pb-2 text-[11px] text-text-muted">Tarefas abertas atribuídas a você, por dia de prazo.</p>
    </WidgetCard>
  );
}

function ReportsSummaryWidget() {
  const { currentWorkspaceId, can, navigate } = useApp();
  const allowed = can('reports.view');
  const today = todayISO();
  const { data, error, loading, reload } = useAsync(
    () => (allowed ? api.reports.get(currentWorkspaceId, { from: addDaysISO(today, -13), to: today }) : Promise.resolve(null)),
    [currentWorkspaceId, allowed, today]
  );
  const series = [{ key: 'created', label: 'Criadas', color: VIZ.series1 }, { key: 'completed', label: 'Concluídas', color: VIZ.series3 }];
  let body;
  if (!allowed) body = <EmptyState compact icon="lock" title="Sem acesso a relatórios" description="Peça a um gestor do workspace para liberar a visualização de relatórios." />;
  else if (loading && !data) body = <div className="px-2 flex flex-col gap-2"><Skeleton className="h-10 w-24" /><Skeleton className="h-12 w-full" /></div>;
  else if (error) body = <ErrorState compact error={error} onRetry={reload} />;
  else {
    const m = data.metrics;
    body = (
      <div className="px-2 pb-2 flex flex-col gap-3">
        <div className="flex items-end gap-6 flex-wrap">
          <div>
            <div className="text-[26px] leading-none font-semibold text-text-primary">{m.completionRate === null ? '—' : `${m.completionRate}%`}</div>
            <div className="text-[11px] text-text-muted mt-1">Taxa de conclusão</div>
          </div>
          <dl className="flex gap-5 text-[12px]">
            <div><dt className="text-text-muted text-[11px]">Criadas</dt><dd className="font-semibold text-text-primary">{m.tasksCreated}</dd></div>
            <div><dt className="text-text-muted text-[11px]">Concluídas</dt><dd className="font-semibold text-text-primary">{m.tasksCompleted}</dd></div>
          </dl>
        </div>
        <Sparkline data={data.series} series={series} height={56} label={`Últimos 14 dias: ${m.tasksCreated} tarefas criadas e ${m.tasksCompleted} concluídas.`} />
        <Legend items={series} />
      </div>
    );
  }
  return (
    <WidgetCard title="Resumo de relatórios" icon="insights" action={allowed && <WidgetLink onClick={() => navigate('/reports')}>Relatórios</WidgetLink>}>
      <p className="px-2 -mt-1 mb-2 text-[11px] text-text-muted">Últimos 14 dias · workspace inteiro</p>
      {body}
    </WidgetCard>
  );
}

function NotificationsWidget() {
  const { navigate, openTask, unreadCount, refreshUnread, showError } = useApp();
  const { data, error, loading, reload, setData } = useAsync(() => api.notifications.list({ limit: 5 }), [unreadCount]);
  const open = async n => {
    if (n.unread) {
      setData(d => ({ ...d, notifications: d.notifications.map(x => (x.id === n.id ? { ...x, unread: false } : x)) }));
      api.notifications.markRead(n.id).then(refreshUnread).catch(showError);
    }
    if (n.taskId) openTask(n.taskId);
    else navigate('/notifications');
  };
  let body;
  if (loading && !data) body = <div className="px-2 flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  else if (error) body = <ErrorState compact error={error} onRetry={reload} />;
  else if (!data.notifications.length) body = <EmptyState compact icon="notifications_off" title="Nenhuma notificação" description="Você será avisado sobre menções, atribuições e prazos." />;
  else body = (
    <ul className="flex flex-col">
      {data.notifications.map(n => (
        <li key={n.id}>
          <button type="button" onClick={() => open(n)} className="w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
            <span aria-hidden="true" className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${n.unread ? 'bg-blue-400' : 'bg-transparent'}`} />
            <span className="min-w-0 flex-1">
              <span className={`block text-[12px] truncate ${n.unread ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>{n.title}{n.unread && <span className="sr-only"> (não lida)</span>}</span>
              {n.description && <span className="block text-[11px] text-text-muted truncate">{n.description}</span>}
            </span>
            <time dateTime={n.createdAt} className="text-[11px] text-text-muted whitespace-nowrap">{timeAgo(n.createdAt)}</time>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <WidgetCard title="Notificações" icon="notifications" action={<WidgetLink onClick={() => navigate('/notifications')}>Ver todas</WidgetLink>}>
      {body}
    </WidgetCard>
  );
}

export const WIDGET_COMPONENTS = {
  metrics: MetricsWidget,
  'my-tasks': MyTasksWidget,
  upcoming: UpcomingWidget,
  overdue: OverdueWidget,
  projects: ProjectsWidget,
  activity: ActivityWidget,
  calendar: MiniCalendarWidget,
  reports: ReportsSummaryWidget,
  notifications: NotificationsWidget
};

export function WidgetIcon({ id }) {
  return <Icon name={WIDGET_BY_ID[id]?.icon || 'widgets'} size={17} className="text-text-muted" />;
}
