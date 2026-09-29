import React from 'react';
import { Avatar, Icon } from '../ui';

export const PROJECT_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#EF4444', '#F59E0B', '#10B981', '#14B8A6', '#64748B'];
export const PROJECT_ICONS = ['folder', 'rocket_launch', 'code', 'campaign', 'school', 'language', 'work', 'design_services', 'science', 'storefront', 'event', 'star'];
export const MILESTONE_STATUS = {
  PLANNED: { label: 'Planejado', className: 'text-text-secondary bg-surface-elevated border-border' },
  IN_PROGRESS: { label: 'Em andamento', className: 'text-blue-400 bg-blue-500/10 border-blue-500/25' },
  COMPLETED: { label: 'Concluído', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  MISSED: { label: 'Não atingido', className: 'text-red-400 bg-red-500/10 border-red-500/25' }
};
export const PROJECT_STATUS_STYLE = {
  PLANNING: 'text-text-secondary bg-surface-elevated border-border',
  ACTIVE: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
  ON_HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  COMPLETED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
};

// Project color comes from user data, so it is applied through `style`.
export function ProjectIcon({ project, size = 36 }) {
  const color = project?.color || PROJECT_COLORS[0];
  return (
    <span
      className="inline-flex items-center justify-center rounded-lg flex-shrink-0 border"
      style={{ width: size, height: size, backgroundColor: `${color}22`, borderColor: `${color}55`, color }}
      aria-hidden="true"
    >
      <Icon name={project?.icon || 'folder'} size={Math.round(size * 0.5)} />
    </span>
  );
}

export function MemberStack({ ids = [], members, max = 4, size = 22 }) {
  const people = ids.map(id => members.find(m => m.id === id)).filter(Boolean);
  if (!people.length) return <span className="text-[11px] text-text-muted">Sem membros</span>;
  const extra = people.length - max;
  return (
    <div className="flex items-center -space-x-1.5" aria-label={`${people.length} membro(s): ${people.map(p => p.name).join(', ')}`}>
      {people.slice(0, max).map(p => <Avatar key={p.id} user={p} size={size} className="ring-2 ring-surface-card" />)}
      {extra > 0 && (
        <span className="rounded-full bg-surface-elevated border border-border ring-2 ring-surface-card flex items-center justify-center text-[10px] font-semibold text-text-secondary" style={{ width: size, height: size }}>+{extra}</span>
      )}
    </div>
  );
}

export function daysLeftLabel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return null;
  if (daysLeft < 0) return { label: `${Math.abs(daysLeft)}d atrasado`, className: 'text-red-400' };
  if (daysLeft === 0) return { label: 'Vence hoje', className: 'text-amber-400' };
  return { label: `${daysLeft}d restantes`, className: daysLeft <= 7 ? 'text-amber-400' : 'text-text-muted' };
}

export function FavoriteButton({ project, onToggle }) {
  if (project.archivedAt) return null;
  const on = project.isFavorite;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remover ${project.name} dos favoritos` : `Favoritar ${project.name}`}
      title={on ? 'Remover dos favoritos' : 'Favoritar'}
      onClick={() => onToggle(project)}
      className={`w-7 h-7 inline-flex items-center justify-center rounded-lg transition-colors hover:bg-surface-hover ${on ? 'text-amber-400' : 'text-text-muted hover:text-text-primary'}`}
    >
      <Icon name="star" size={16} filled={on} />
    </button>
  );
}

