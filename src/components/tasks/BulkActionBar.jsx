import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { PRIORITIES, PRIORITY_LABEL, pluralize } from '../../lib/format';
import { Btn, Field, IconBtn, Input, Modal } from '../ui';
import { Popover, PopoverItem } from './Popover';
import { useLookups } from './taskUtils';

function BarButton({ icon, label, onClick, danger, disabled, title, ...aria }) {
  return (
    <Btn size="sm" variant={danger ? 'danger' : 'ghost'} icon={icon} onClick={onClick} disabled={disabled} title={title || label} aria-label={label} {...aria}>
      <span className="hidden md:inline">{label}</span>
    </Btn>
  );
}

function ActionMenu({ icon, label, disabled, title, children, width = 220 }) {
  return (
    <Popover
      placement="top"
      width={width}
      label={label}
      trigger={({ toggle, ...aria }) => <BarButton icon={icon} label={label} onClick={toggle} disabled={disabled} title={title} {...aria} />}
    >
      {close => <div className="max-h-72 overflow-y-auto">{children(close)}</div>}
    </Popover>
  );
}

// Contextual toolbar for bulk edits. `columns` restricts "Mover" to the given
// project columns; otherwise only statuses shared by every selected project are offered.
export function BulkActionBar({ selectedIds, onClear, columns }) {
  const { bulkAction, can, members, columnsByProject, tasks } = useApp();
  const { taskById } = useLookups();
  const [busy, setBusy] = useState(false);
  const [tagModal, setTagModal] = useState(false);
  const [dueModal, setDueModal] = useState(false);

  const selectedTasks = useMemo(() => selectedIds.map(id => taskById.get(id)).filter(Boolean), [selectedIds, taskById]);

  const statusOptions = useMemo(() => {
    if (columns) return columns;
    const projectIds = [...new Set(selectedTasks.map(t => t.projectId))];
    const lists = projectIds.map(id => columnsByProject[id] || []);
    if (!lists.length) return [];
    return lists[0].filter(c => lists.every(l => l.some(x => x.statusKey === c.statusKey)));
  }, [columns, selectedTasks, columnsByProject]);

  const selectedTags = useMemo(() => [...new Set(selectedTasks.flatMap(t => t.tags || []))].sort(), [selectedTasks]);
  const allTags = useMemo(() => [...new Set(tasks.flatMap(t => t.tags || []))].sort(), [tasks]);

  if (!selectedIds.length) return null;
  const canEdit = can('task.edit');

  const run = async (action, value) => {
    setBusy(true);
    const ok = await bulkAction(selectedIds, action, value);
    setBusy(false);
    if (ok && (action === 'DELETE' || action === 'ARCHIVE')) onClear();
    return ok;
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Ações em massa"
        className="fixed z-[85] bottom-3 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 lg:left-[calc(50%+8rem)] sm:max-w-[calc(100vw-2rem)] lg:max-w-[calc(100vw-18rem)]"
      >
        <div className="flex flex-wrap items-center justify-center gap-1 p-1.5 rounded-2xl bg-surface-elevated border border-border shadow-modal animate-slideUp">
          <div className="flex items-center gap-2 px-2.5 h-8 text-[12px] font-semibold text-text-primary whitespace-nowrap" aria-live="polite">
            {busy && <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin opacity-70" aria-hidden="true" />}
            {pluralize(selectedIds.length, 'selecionada', 'selecionadas')}
          </div>
          <span className="hidden sm:block w-px h-5 bg-border mx-0.5" aria-hidden="true" />

          {canEdit && (
            <>
              <ActionMenu icon="view_column" label="Mover" disabled={busy || !statusOptions.length} title={statusOptions.length ? 'Mover para coluna' : 'As tarefas selecionadas são de projetos sem colunas em comum'}>
                {close => statusOptions.map(c => (
                  <PopoverItem key={c.statusKey} label={c.name} onClick={() => { close(); run('STATUS', c.statusKey); }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0 -order-1" style={{ backgroundColor: c.color }} aria-hidden="true" />
                  </PopoverItem>
                ))}
              </ActionMenu>
              <ActionMenu icon="flag" label="Prioridade" disabled={busy}>
                {close => PRIORITIES.map(p => <PopoverItem key={p} label={PRIORITY_LABEL[p]} onClick={() => { close(); run('PRIORITY', p); }} />)}
              </ActionMenu>
              <ActionMenu icon="person" label="Responsável" disabled={busy} width={240}>
                {close => [
                  <PopoverItem key="none" icon="person_off" label="Sem responsável" onClick={() => { close(); run('ASSIGNEE', null); }} />,
                  ...members.map(m => <PopoverItem key={m.id} label={m.name} onClick={() => { close(); run('ASSIGNEE', m.id); }} />)
                ]}
              </ActionMenu>
              <BarButton icon="new_label" label="Adicionar tag" disabled={busy} onClick={() => setTagModal(true)} />
              <ActionMenu icon="label_off" label="Remover tag" disabled={busy || !selectedTags.length} title={selectedTags.length ? 'Remover tag' : 'Nenhuma tag nas tarefas selecionadas'}>
                {close => selectedTags.map(t => <PopoverItem key={t} label={t} onClick={() => { close(); run('REMOVE_TAG', t); }} />)}
              </ActionMenu>
              <BarButton icon="event" label="Definir prazo" disabled={busy} onClick={() => setDueModal(true)} />
              <BarButton icon="archive" label="Arquivar" disabled={busy} onClick={() => run('ARCHIVE')} />
            </>
          )}
          {can('task.delete') && <BarButton icon="delete" label="Excluir" danger disabled={busy} onClick={() => run('DELETE')} />}
          <span className="hidden sm:block w-px h-5 bg-border mx-0.5" aria-hidden="true" />
          <IconBtn icon="close" label="Limpar seleção" onClick={onClear} />
        </div>
      </div>

      <TagModal open={tagModal} onClose={() => setTagModal(false)} suggestions={allTags} onSubmit={tag => run('ADD_TAG', tag)} count={selectedIds.length} />
      <DueModal open={dueModal} onClose={() => setDueModal(false)} onSubmit={date => run('DUE_DATE', date)} count={selectedIds.length} />
    </>
  );
}

function TagModal({ open, onClose, onSubmit, suggestions, count }) {
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);
  const value = tag.trim();
  const submit = async e => {
    e.preventDefault();
    if (!value) return;
    setSaving(true);
    const ok = await onSubmit(value);
    setSaving(false);
    if (ok) { setTag(''); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Adicionar tag" description={`A tag será adicionada a ${pluralize(count, 'tarefa', 'tarefas')}.`}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn variant="primary" type="submit" form="bulk-tag-form" loading={saving} disabled={!value}>Adicionar</Btn></>}>
      <form id="bulk-tag-form" onSubmit={submit}>
        <Field label="Tag" hint="Até 30 caracteres">
          <Input value={tag} onChange={e => setTag(e.target.value)} maxLength={30} list="bulk-tag-suggestions" placeholder="ex.: frontend" data-autofocus />
        </Field>
        <datalist id="bulk-tag-suggestions">{suggestions.map(t => <option key={t} value={t} />)}</datalist>
      </form>
    </Modal>
  );
}

function DueModal({ open, onClose, onSubmit, count }) {
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const apply = async value => {
    setSaving(true);
    const ok = await onSubmit(value);
    setSaving(false);
    if (ok) { setDate(''); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Definir prazo" description={`O novo prazo vale para ${pluralize(count, 'tarefa', 'tarefas')}.`}
      footer={<><Btn variant="ghost" onClick={() => apply(null)} disabled={saving}>Remover prazo</Btn><Btn variant="primary" onClick={() => apply(date)} loading={saving} disabled={!date}>Aplicar</Btn></>}>
      <Field label="Prazo">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} data-autofocus />
      </Field>
    </Modal>
  );
}
