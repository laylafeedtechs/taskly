import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { AsyncBoundary, Avatar, Btn, Checkbox, EmptyState, Icon, PageHeader, Pagination, Segmented, Tabs } from '../ui';
import { RowMenu } from '../settings/common';

const CATEGORIES = [
  { id: 'All', label: 'Todas', icon: 'inbox' },
  { id: 'Mentions', label: 'Menções', icon: 'alternate_email' },
  { id: 'Assignments', label: 'Atribuições', icon: 'assignment_ind' },
  { id: 'Comments', label: 'Comentários', icon: 'chat_bubble' },
  { id: 'Deadlines', label: 'Prazos', icon: 'schedule' },
  { id: 'System', label: 'Sistema', icon: 'settings' }
];
const STATUSES = [{ value: 'active', label: 'Ativas' }, { value: 'unread', label: 'Não lidas' }, { value: 'archived', label: 'Arquivadas' }];
const EVENT_ICON = { automation: 'bolt', security: 'shield', invitation: 'mail' };
const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map(c => [c.id, c.icon]));
const PAGE_SIZE = 20;

export function NotificationsView() {
  const { openTask, navigate, confirm, toast, showError, setUnreadCount } = useApp();
  const [category, setCategory] = useState('All');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(() => api.notifications.list({ category, status, page, limit: PAGE_SIZE }), [category, status, page]);
  const list = data?.notifications || [];

  // The list response already carries the unread total, so the badge stays in sync without an extra call.
  useEffect(() => { if (data) setUnreadCount(data.unreadCount); }, [data, setUnreadCount]);
  useEffect(() => setSelected(new Set()), [category, status, page]);

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      if (message) toast(message, 'success');
      setSelected(new Set());
      const res = await reload();
      if (res && !res.notifications.length && page > 1) setPage(p => p - 1);
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  const ids = [...selected];
  const allSelected = list.length > 0 && list.every(n => selected.has(n.id));
  const toggleOne = (id, on) => setSelected(prev => { const next = new Set(prev); on ? next.add(id) : next.delete(id); return next; });
  const toggleAll = on => setSelected(on ? new Set(list.map(n => n.id)) : new Set());

  const openNotification = n => {
    if (n.unread) run(() => api.notifications.markRead(n.id));
    if (n.taskId) openTask(n.taskId);
  };

  const removeSelected = async targetIds => {
    const ok = await confirm({ title: `Excluir ${targetIds.length} notificação(ões)?`, message: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true });
    if (ok) run(() => api.notifications.bulkDelete(targetIds), 'Notificações excluídas');
  };

  const archived = status === 'archived';
  const emptyCopy = archived ? 'Nenhuma notificação arquivada.' : status === 'unread' ? 'Você está em dia! Nenhuma notificação não lida.' : 'Quando algo acontecer nas suas tarefas, você verá aqui.';

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        icon="notifications"
        title="Notificações"
        description={data ? `${data.unreadCount} não lida(s)` : 'Atualizações sobre suas tarefas e seu workspace.'}
        actions={<>
          <Btn icon="tune" variant="ghost" onClick={() => navigate('/settings/notifications')}>Preferências</Btn>
          <Btn icon="done_all" disabled={busy || !data?.unreadCount} onClick={() => run(() => api.notifications.bulkRead(), 'Todas marcadas como lidas')}>Marcar todas como lidas</Btn>
        </>}
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
        <Tabs tabs={CATEGORIES} value={category} onChange={c => { setCategory(c); setPage(1); }} />
        <Segmented label="Status" options={STATUSES} value={status} onChange={s => { setStatus(s); setPage(1); }} />
      </div>

      <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 min-h-[48px] py-2 border-b border-border bg-background-secondary/60">
          <Checkbox checked={allSelected} onChange={toggleAll} disabled={!list.length} label="Selecionar todas desta página" />
          {selected.size ? (
            <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Ações em lote">
              <span className="text-[12px] text-text-primary font-medium mr-1">{selected.size} selecionada(s)</span>
              {!archived && <Btn size="xs" icon="drafts" disabled={busy} onClick={() => run(() => api.notifications.bulkRead(ids), 'Marcadas como lidas')}>Marcar como lidas</Btn>}
              <Btn size="xs" icon={archived ? 'unarchive' : 'archive'} disabled={busy} onClick={() => run(() => api.notifications.bulkArchive(ids, !archived), archived ? 'Notificações restauradas' : 'Notificações arquivadas')}>{archived ? 'Desarquivar' : 'Arquivar'}</Btn>
              <Btn size="xs" variant="danger" icon="delete" disabled={busy} onClick={() => removeSelected(ids)}>Excluir</Btn>
            </div>
          ) : <span className="text-[12px] text-text-muted" aria-hidden="true">Selecionar todas desta página</span>}
        </div>

        <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!list.length}
          emptyState={<EmptyState icon="notifications_off" title="Nada por aqui" description={emptyCopy} />}>
          <ul className={`divide-y divide-border-subtle ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {list.map(n => (
              <li key={n.id} className={`group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover/50 ${n.unread ? 'bg-blue-500/[0.04]' : ''}`}>
                <Checkbox checked={selected.has(n.id)} onChange={on => toggleOne(n.id, on)} label={`Selecionar: ${n.title}`} className="mt-2.5" />
                <div className="relative flex-shrink-0 mt-0.5">
                  {n.actorName
                    ? <Avatar user={{ name: n.actorName, avatar: n.avatar }} size={32} />
                    : <span className="w-8 h-8 rounded-full bg-surface-elevated border border-border flex items-center justify-center"><Icon name={EVENT_ICON[n.event] || CATEGORY_ICON[n.category] || 'notifications'} size={16} className="text-text-secondary" /></span>}
                  {n.actorName && (
                    <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-surface border border-border flex items-center justify-center">
                      <Icon name={EVENT_ICON[n.event] || CATEGORY_ICON[n.category] || 'notifications'} size={10} className="text-text-secondary" />
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => openNotification(n)} className="flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50">
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] truncate ${n.unread ? 'text-text-primary font-semibold' : 'text-text-secondary font-medium'}`}>{n.title}</span>
                    {n.unread && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"><span className="sr-only">Não lida</span></span>}
                  </div>
                  {n.description && <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">{n.description}</p>}
                  <p className="text-[11px] text-text-muted mt-1">
                    {n.actorName && <span>{n.actorName} · </span>}
                    <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>{timeAgo(n.createdAt)}</time>
                    {n.taskId && <span className="font-mono"> · {n.taskId}</span>}
                  </p>
                </button>
                <RowMenu
                  label={`Ações da notificação ${n.title}`}
                  items={[
                    !archived && { label: n.unread ? 'Marcar como lida' : 'Marcar como não lida', icon: n.unread ? 'drafts' : 'mark_email_unread', onClick: () => run(() => api.notifications.markRead(n.id, !n.unread)) },
                    { label: archived ? 'Desarquivar' : 'Arquivar', icon: archived ? 'unarchive' : 'archive', onClick: () => run(() => api.notifications.bulkArchive([n.id], !archived), archived ? 'Notificação restaurada' : 'Notificação arquivada') },
                    '-',
                    { label: 'Excluir', icon: 'delete', danger: true, onClick: () => removeSelected([n.id]) }
                  ]}
                />
              </li>
            ))}
          </ul>
        </AsyncBoundary>
      </div>
      <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={setPage} />
    </div>
  );
}
