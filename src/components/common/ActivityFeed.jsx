import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatDate, timeAgo, toISODate } from '../../lib/format';
import { Avatar, Btn, EmptyState, ErrorState, Icon, Skeleton } from '../ui';

const TYPE_ICON = {
  task: { icon: 'check_box', className: 'text-blue-400 bg-blue-500/10 border-blue-500/25' },
  comment: { icon: 'chat_bubble', className: 'text-text-secondary bg-surface-elevated border-border' },
  file: { icon: 'attach_file', className: 'text-text-secondary bg-surface-elevated border-border' },
  project: { icon: 'folder', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  milestone: { icon: 'flag', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  member: { icon: 'group', className: 'text-text-secondary bg-surface-elevated border-border' },
  automation: { icon: 'bolt', className: 'text-amber-400 bg-amber-500/10 border-amber-500/25' },
  column: { icon: 'view_column', className: 'text-text-secondary bg-surface-elevated border-border' }
};
const iconFor = type => (type === 'task.commented' ? TYPE_ICON.comment : TYPE_ICON[type?.split('.')[0]] || { icon: 'history', className: 'text-text-secondary bg-surface-elevated border-border' });

function dayLabel(iso) {
  const day = toISODate(new Date(iso));
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day === toISODate(today)) return 'Hoje';
  if (day === toISODate(yesterday)) return 'Ontem';
  return formatDate(day, { weekday: 'long', day: '2-digit', month: 'long', ...(day.slice(0, 4) !== String(today.getFullYear()) && { year: 'numeric' }) });
}

function groupByDay(items) {
  const groups = [];
  items.forEach(item => {
    const label = dayLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item); else groups.push({ label, items: [item] });
  });
  return groups;
}

function FeedItem({ item, compact, showProject, member, onOpenTask }) {
  const meta = iconFor(item.type);
  return (
    <li className={`relative flex gap-3 ${compact ? 'py-2' : 'py-2.5'}`}>
      <div className="relative flex-shrink-0">
        {item.actorId && member ? <Avatar user={member} size={compact ? 26 : 30} /> : (
          <span className={`flex items-center justify-center rounded-full border ${meta.className}`} style={{ width: compact ? 26 : 30, height: compact ? 26 : 30 }}>
            <Icon name={meta.icon} size={compact ? 14 : 16} />
          </span>
        )}
        {item.actorId && member && (
          <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border flex items-center justify-center ${meta.className}`} aria-hidden="true"><Icon name={meta.icon} size={10} /></span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-text-secondary leading-relaxed break-words">
          <span className="font-semibold text-text-primary">{item.actor}</span> {item.message}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] text-text-muted">
          <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString('pt-BR')}>{timeAgo(item.createdAt)}</time>
          {item.taskId && (
            <button type="button" onClick={() => onOpenTask(item.taskId)} className="inline-flex items-center gap-1 max-w-full min-w-0 text-text-secondary hover:text-text-primary hover:underline">
              <span className="font-mono">{item.taskId}</span>
              {item.taskTitle && <span className="truncate max-w-[240px]">{item.taskTitle}</span>}
            </button>
          )}
          {showProject && item.projectName && <span className="inline-flex items-center gap-1 min-w-0"><Icon name="folder" size={12} /><span className="truncate max-w-[180px]">{item.projectName}</span></span>}
        </div>
      </div>
    </li>
  );
}

// Reusable activity feed. Extra filters (userId, type, from, to) are optional.
export function ActivityFeed({ workspaceId, projectId, userId, type, from, to, compact = false, limit }) {
  const { members, openTask } = useApp();
  const pageSize = limit || (compact ? 8 : 30);
  const [state, setState] = useState({ items: [], page: 0, totalPages: 1, loading: true, loadingMore: false, error: null });
  const requestId = useRef(0);

  const load = useCallback(async page => {
    const id = ++requestId.current;
    setState(s => ({ ...s, error: null, ...(page === 1 ? { loading: true } : { loadingMore: true }) }));
    try {
      const res = await api.search.activity({ workspaceId, projectId, userId, type, from, to, page, limit: pageSize });
      if (id !== requestId.current) return;
      setState(s => ({ items: page === 1 ? res.activity : [...s.items, ...res.activity], page: res.page, totalPages: res.totalPages, loading: false, loadingMore: false, error: null }));
    } catch (error) {
      if (id === requestId.current) setState(s => ({ ...s, loading: false, loadingMore: false, error }));
    }
  }, [workspaceId, projectId, userId, type, from, to, pageSize]);

  useEffect(() => { load(1); }, [load]);

  const memberById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members]);
  const groups = useMemo(() => groupByDay(state.items), [state.items]);

  if (state.loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando atividade">
        {Array.from({ length: compact ? 4 : 6 }).map((_, i) => (
          <div key={i} className="flex gap-3"><Skeleton className="w-7 h-7 rounded-full flex-shrink-0" /><div className="flex-1 flex flex-col gap-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-2.5 w-1/3" /></div></div>
        ))}
      </div>
    );
  }
  if (state.error && !state.items.length) return <ErrorState compact error={state.error} onRetry={() => load(1)} />;
  if (!state.items.length) return <EmptyState compact icon="history" title="Nenhuma atividade" description="As ações da equipe aparecerão aqui." />;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(g => (
        <section key={g.label} aria-label={g.label}>
          {!compact && <h3 className="sticky top-14 z-[1] py-1.5 bg-background/90 backdrop-blur text-[11px] font-mono uppercase tracking-wider text-text-muted">{g.label}</h3>}
          {compact && <p className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">{g.label}</p>}
          <ul className="divide-y divide-border-subtle">
            {g.items.map(item => (
              <FeedItem key={item.id} item={item} compact={compact} showProject={!projectId} member={memberById[item.actorId]} onOpenTask={openTask} />
            ))}
          </ul>
        </section>
      ))}
      {state.error && <ErrorState compact error={state.error} onRetry={() => load(state.page + 1)} />}
      {!compact && !state.error && state.page < state.totalPages && (
        <Btn className="self-center" icon="expand_more" loading={state.loadingMore} onClick={() => load(state.page + 1)}>Carregar mais</Btn>
      )}
    </div>
  );
}
