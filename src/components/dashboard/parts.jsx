import React from 'react';
import { Icon, Btn } from '../ui';
import { PriorityBadge } from '../common/Badge';
import { dueInfo } from '../../lib/format';

export const TONE_TEXT = { danger: 'text-red-400', warning: 'text-amber-400', muted: 'text-text-muted' };

export function WidgetCard({ title, icon, action, children, className = '', bodyClassName = '' }) {
  return (
    <section className={`bg-surface-card border border-border rounded-xl flex flex-col min-w-0 ${className}`} aria-label={title}>
      <header className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text-primary min-w-0">
          {icon && <Icon name={icon} size={17} className="text-text-muted" />}
          <span className="truncate">{title}</span>
        </h2>
        {action}
      </header>
      <div className={`flex-1 min-h-0 px-2 pb-2 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export const WidgetLink = ({ onClick, children = 'Ver tudo' }) => (
  <Btn variant="ghost" size="xs" iconRight="chevron_right" onClick={onClick}>{children}</Btn>
);

// Objective stat tile: label, value, optional hint. Clickable when onClick is given.
export function StatCard({ label, value, icon, hint, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  const toneCls = { danger: 'text-red-400', warning: 'text-amber-400', success: 'text-emerald-400' }[tone] || 'text-text-muted';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left bg-surface-card border border-border rounded-xl p-4 flex flex-col gap-2 min-w-0 transition-colors ${onClick ? 'hover:border-border-focus hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50' : ''}`}
    >
      <span className="flex items-center justify-between gap-2 text-[12px] text-text-secondary">
        <span className="truncate">{label}</span>
        {icon && <Icon name={icon} size={17} className={toneCls} />}
      </span>
      <span className="text-[26px] leading-none font-semibold text-text-primary">{value ?? '—'}</span>
      {hint && <span className="text-[11px] text-text-muted truncate">{hint}</span>}
    </Tag>
  );
}

// One clickable task line used by every dashboard list.
export function TaskRow({ task, project, onOpen }) {
  const due = dueInfo(task.dueDate, task.status);
  return (
    <li>
      <button type="button" onClick={() => onOpen(task.id)} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 transition-colors">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: project?.color || 'rgb(var(--text-muted))' }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] text-text-primary">
            <span className="truncate">{task.title}</span>
            {task.isBlocked && <Icon name="lock" size={13} className="text-amber-400 flex-shrink-0" label="Bloqueada" />}
          </span>
          <span className="block text-[11px] text-text-muted truncate">{task.id}{project ? ` · ${project.name}` : ''}</span>
        </span>
        {due && <span className={`text-[11px] font-medium whitespace-nowrap ${TONE_TEXT[due.tone]}`}>{due.label}</span>}
        <span className="hidden sm:inline-flex"><PriorityBadge priority={task.priority} /></span>
      </button>
    </li>
  );
}

export function TaskRowList({ tasks, projectsById, onOpen, limit = 6 }) {
  return (
    <ul className="flex flex-col">
      {tasks.slice(0, limit).map(t => <TaskRow key={t.id} task={t} project={projectsById[t.projectId]} onOpen={onOpen} />)}
    </ul>
  );
}
