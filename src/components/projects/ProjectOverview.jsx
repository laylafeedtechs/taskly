import React, { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { dueInfo, HEALTH_META } from '../../lib/format';
import { Card, Icon, Btn, EmptyState, ProgressBar, Avatar } from '../ui';
import { HealthBadge, PriorityBadge } from '../common/Badge';
import { ActivityFeed } from '../common/ActivityFeed';
import { MilestonesPanel } from './MilestonesPanel';

const TONE = { danger: 'text-red-400', warning: 'text-amber-400', muted: 'text-text-muted' };

function Stat({ icon, label, value, hint, tone }) {
  return (
    <Card className="flex flex-col gap-1 min-w-0">
      <span className="flex items-center gap-1.5 text-[11px] text-text-muted"><Icon name={icon} size={15} />{label}</span>
      <span className={`text-[22px] font-semibold font-tabular leading-tight ${tone || 'text-text-primary'}`}>{value}</span>
      {hint && <span className="text-[11px] text-text-muted truncate">{hint}</span>}
    </Card>
  );
}

function daysLeftStat(project) {
  if (project.daysLeft === null || project.daysLeft === undefined) return { value: '—', hint: 'Sem prazo definido' };
  if (project.status === 'COMPLETED') return { value: '—', hint: 'Projeto concluído' };
  if (project.daysLeft < 0) return { value: Math.abs(project.daysLeft), hint: 'dias de atraso', tone: 'text-red-400' };
  return { value: project.daysLeft, hint: project.daysLeft === 1 ? 'dia restante' : 'dias restantes', tone: project.daysLeft <= 7 ? 'text-amber-400' : undefined };
}

function UpcomingDeadlines({ tasks, members, onOpen }) {
  const upcoming = useMemo(() => tasks
    .filter(t => t.status !== 'Done' && t.dueDate && !t.archivedAt)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8), [tasks]);
  if (!upcoming.length) return <EmptyState compact icon="event_available" title="Sem prazos pendentes" description="Tarefas abertas com prazo aparecerão aqui." />;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {upcoming.map(t => {
        const due = dueInfo(t.dueDate, t.status);
        const assignee = members.find(m => m.id === t.assigneeId);
        return (
          <li key={t.id}>
            <button type="button" onClick={() => onOpen(t.id)} className="w-full flex items-center gap-2.5 py-2 text-left rounded-md hover:bg-surface-hover/60 px-1.5 -mx-1.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-text-primary truncate">{t.title}</span>
                <span className="block text-[10px] font-mono text-text-muted">{t.id}</span>
              </span>
              <span className="hidden sm:inline-flex"><PriorityBadge priority={t.priority} /></span>
              <Avatar user={assignee} size={20} />
              <span className={`text-[11px] whitespace-nowrap w-[72px] text-right ${TONE[due.tone]}`}>{due.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectOverview({ project, tasks, canEdit, onMilestonesChange, onViewActivity }) {
  const { members, openTask } = useApp();
  const days = daysLeftStat(project);
  const health = HEALTH_META[project.health] || HEALTH_META.Healthy;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat icon="radio_button_unchecked" label="Abertas" value={project.openTasks} hint={`de ${project.totalTasks} tarefas`} />
        <Stat icon="schedule" label="Atrasadas" value={project.overdueTasks} tone={project.overdueTasks ? 'text-red-400' : undefined} hint={project.overdueTasks ? 'precisam de atenção' : 'nenhuma atrasada'} />
        <Stat icon="block" label="Bloqueadas" value={project.blockedTasks} tone={project.blockedTasks ? 'text-amber-400' : undefined} hint="por dependências" />
        <Card className="flex flex-col gap-1 min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted"><Icon name="donut_large" size={15} />Progresso</span>
          <span className="text-[22px] font-semibold font-tabular leading-tight text-text-primary">{project.progress}%</span>
          <ProgressBar value={project.progress} className="mt-1.5" />
        </Card>
        <Stat icon="event" label="Prazo" value={days.value} hint={days.hint} tone={days.tone} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h2 className="text-title-sm text-text-primary flex items-center gap-2"><Icon name="monitor_heart" size={18} className="text-text-muted" />Saúde do projeto</h2>
              <HealthBadge health={project.health} reasons={project.healthReasons} />
            </div>
            {project.healthReasons?.length ? (
              <ul className="flex flex-col gap-1.5 mt-3">
                {project.healthReasons.map(r => (
                  <li key={r} className="flex items-center gap-2 text-[12px] text-text-secondary">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${health.dot}`} />{r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-text-secondary">Nenhum risco identificado: sem tarefas atrasadas ou bloqueadas e prazo sob controle.</p>
            )}
          </Card>
          <Card><MilestonesPanel projectId={project.id} milestones={project.milestones || []} canEdit={canEdit} onChange={onMilestonesChange} /></Card>
        </div>
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <h2 className="text-title-sm text-text-primary flex items-center gap-2 mb-2"><Icon name="event_upcoming" size={18} className="text-text-muted" />Próximos prazos</h2>
            <UpcomingDeadlines tasks={tasks} members={members} onOpen={openTask} />
          </Card>
          <Card>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-title-sm text-text-primary flex items-center gap-2"><Icon name="history" size={18} className="text-text-muted" />Atividade recente</h2>
              <Btn size="xs" variant="ghost" iconRight="arrow_forward" onClick={onViewActivity}>Ver tudo</Btn>
            </div>
            <ActivityFeed workspaceId={project.workspaceId} projectId={project.id} compact limit={8} />
          </Card>
        </div>
      </div>
    </div>
  );
}
