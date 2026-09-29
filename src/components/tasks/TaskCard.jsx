import React, { memo } from 'react';
import { dueInfo } from '../../lib/format';
import { PriorityBadge, TypeBadge, TagPill } from '../common/Badge';
import { Avatar, Checkbox, Icon } from '../ui';
import { FloatingMenu } from './FloatingMenu';
import { DUE_TONE } from './taskUtils';

function Meta({ icon, children, title, className = 'text-text-muted' }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-tabular ${className}`} title={title}>
      <Icon name={icon} size={13} />{children}
    </span>
  );
}

export const TaskCard = memo(function TaskCard({
  task, assignee, columns, taskById, selected, selectionMode, selectable, canEdit, canDelete,
  onOpen, onToggleSelect, onMove, onArchive, onDelete, onDragStart, onDragEnd
}) {
  const due = dueInfo(task.dueDate, task.status);
  const tags = task.tags || [];
  const checklist = task.checklistProgress || { done: 0, total: 0 };
  const subtasks = task.subtaskProgress || { done: 0, total: 0 };
  const blockedTitle = task.isBlocked ? `Bloqueada por: ${(task.blockedBy || []).map(id => (taskById?.get(id) ? `${id} — ${taskById.get(id).title}` : id)).join(', ')}` : undefined;

  const menuItems = [
    { icon: 'open_in_new', label: 'Abrir detalhes', onClick: () => onOpen(task.id) },
    canEdit && columns.length > 1 && '-',
    canEdit && columns.length > 1 && { header: 'Mover para…' },
    ...(canEdit ? columns.filter(c => c.statusKey !== task.status).map(c => ({ icon: 'arrow_forward', label: c.name, onClick: () => onMove(task.id, c.statusKey) })) : []),
    (canEdit || canDelete) && '-',
    canEdit && { icon: 'archive', label: 'Arquivar', onClick: () => onArchive(task.id) },
    canDelete && { icon: 'delete', label: 'Excluir', danger: true, onClick: () => onDelete(task.id) }
  ];

  return (
    <article
      draggable={canEdit}
      onDragStart={e => onDragStart?.(e, task.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task.id)}
      aria-label={`${task.id}: ${task.title}`}
      className={`group relative rounded-xl border bg-surface-card p-3.5 cursor-pointer card-hover ${selected ? 'border-blue-500/60 ring-1 ring-blue-500/40' : 'border-border'} ${canEdit ? 'active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-start gap-2">
        {selectable && (
          <span onClick={e => e.stopPropagation()} className={`pt-0.5 transition-opacity ${selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
            <Checkbox checked={selected} onChange={() => onToggleSelect(task.id)} label={`Selecionar ${task.id}`} />
          </span>
        )}
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-mono text-text-muted">{task.id}</span>
          <PriorityBadge priority={task.priority} />
          {task.isRecurring && <Icon name="repeat" size={14} className="text-text-muted" label="Tarefa recorrente" />}
          {task.subtaskOf && <Meta icon="subdirectory_arrow_right" title={`Subtarefa de ${task.subtaskOf}`}>{task.subtaskOf}</Meta>}
        </div>
        <div onClick={e => e.stopPropagation()} className="-mr-1.5 -mt-1">
          <FloatingMenu
            width={220}
            items={menuItems}
            trigger={({ toggle, ...aria }) => (
              <button type="button" onClick={toggle} {...aria} aria-label={`Ações de ${task.id}`} title="Ações"
                className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover opacity-0 group-hover:opacity-100 focus:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100">
                <Icon name="more_horiz" size={18} />
              </button>
            )}
          />
        </div>
      </div>

      <h3 className="mt-2 text-[13px] font-semibold leading-snug text-text-primary break-words">
        <button type="button" onClick={e => { e.stopPropagation(); onOpen(task.id); }} className="text-left hover:underline decoration-border-focus underline-offset-2">
          {task.title}
        </button>
      </h3>
      {task.description && <p className="mt-1 text-[12px] leading-relaxed text-text-secondary line-clamp-2 break-words">{task.description}</p>}

      {task.isBlocked && (
        <div className="mt-2.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-red-500/25 bg-red-500/10 text-red-400 text-[11px] font-medium" title={blockedTitle}>
          <Icon name="lock" size={12} />Bloqueada
          <span className="sr-only">{blockedTitle}</span>
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {tags.slice(0, 3).map(t => <TagPill key={t} tag={t} />)}
          {tags.length > 3 && <span className="inline-flex items-center h-5 px-1.5 text-[11px] text-text-muted" title={tags.slice(3).join(', ')}>+{tags.length - 3}</span>}
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-border-subtle flex items-center gap-3">
        <TypeBadge type={task.type} showLabel={false} />
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {due && <Meta icon="event" className={DUE_TONE[due.tone]} title={`Prazo: ${task.dueDate}`}>{due.label}</Meta>}
          {checklist.total > 0 && <Meta icon="checklist" className={checklist.done === checklist.total ? 'text-emerald-400' : 'text-text-muted'} title="Checklist">{checklist.done}/{checklist.total}</Meta>}
          {subtasks.total > 0 && <Meta icon="account_tree" title="Subtarefas concluídas">{subtasks.done}/{subtasks.total}</Meta>}
          {task.commentCount > 0 && <Meta icon="chat_bubble" title="Comentários">{task.commentCount}</Meta>}
          {task.attachmentCount > 0 && <Meta icon="attach_file" title="Anexos">{task.attachmentCount}</Meta>}
        </div>
        <Avatar user={assignee} size={22} />
      </div>
    </article>
  );
});
