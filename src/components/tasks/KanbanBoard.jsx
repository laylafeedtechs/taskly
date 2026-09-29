import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { pluralize } from '../../lib/format';
import { Alert, Btn, EmptyState, ErrorState, Field, Icon, Input, Modal, Select, Skeleton } from '../ui';
import { TaskCard } from './TaskCard';
import { TaskFilterBar, useTaskFilters } from './TaskFilters';
import { BulkActionBar } from './BulkActionBar';
import { FloatingMenu } from './FloatingMenu';
import { useSelection } from './useSelection';
import { byPriorityThenDue, useLookups } from './taskUtils';

const PAGE = 50;
const COLUMN_COLORS = ['#A0A0A0', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#10B981', '#EF4444', '#14B8A6'];
const DRAG_TYPE = 'application/x-taskly-task';

export function KanbanBoard({ projectId }) {
  const {
    tasks, tasksState, reloadTasks, columnsByProject, loadColumns, setProjectColumns,
    moveTask, bulkAction, archiveTask, deleteTask, openTask, openQuickCreate, can, showError, toast, confirm
  } = useApp();
  const { memberById, taskById } = useLookups();
  const columns = columnsByProject[projectId];
  const [colError, setColError] = useState(null);
  const [limits, setLimits] = useState({});
  const [dragOver, setDragOver] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [columnForm, setColumnForm] = useState(null); // { column? }
  const [deleting, setDeleting] = useState(null); // { column, count }

  const canEdit = can('task.edit');
  const canDelete = can('task.delete');
  const canManage = can('project.edit');
  const selectable = canEdit || canDelete;

  const fetchColumns = useCallback(() => {
    setColError(null);
    loadColumns(projectId, true).catch(setColError);
  }, [loadColumns, projectId]);

  useEffect(() => {
    if (!columnsByProject[projectId]) fetchColumns();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const projectTasks = useMemo(() => tasks.filter(t => t.projectId === projectId), [tasks, projectId]);
  const filterState = useTaskFilters(projectTasks, { storageKey: `kanban.${projectId}` });
  const { filtered, activeCount, search, clearAll } = filterState;
  const availableTags = useMemo(() => [...new Set(projectTasks.flatMap(t => t.tags || []))], [projectTasks]);

  const { grouped, totals } = useMemo(() => {
    const cols = columns || [];
    const keys = new Set(cols.map(c => c.statusKey));
    const bucket = status => (keys.has(status) ? status : cols[0]?.statusKey);
    const g = Object.fromEntries(cols.map(c => [c.statusKey, []]));
    const tot = Object.fromEntries(cols.map(c => [c.statusKey, 0]));
    filtered.forEach(t => g[bucket(t.status)]?.push(t));
    projectTasks.forEach(t => { const k = bucket(t.status); if (k in tot) tot[k] += 1; });
    Object.values(g).forEach(list => list.sort(byPriorityThenDue));
    return { grouped: g, totals: tot };
  }, [columns, filtered, projectTasks]);

  const orderedIds = useMemo(() => (columns || []).flatMap(c => grouped[c.statusKey].map(t => t.id)), [columns, grouped]);
  const selection = useSelection(orderedIds);

  const onDragStart = useCallback((e, id) => {
    e.dataTransfer.setData(DRAG_TYPE, id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
  }, []);
  const onDragEnd = useCallback(() => { setDraggingId(null); setDragOver(null); }, []);

  const dropOn = (e, statusKey) => {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    const id = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData('text/plain');
    if (!id || !taskById.has(id)) return;
    if (selection.isSelected(id) && selection.count > 1) {
      const ids = selection.ids.filter(x => taskById.get(x)?.status !== statusKey);
      if (ids.length) bulkAction(ids, 'STATUS', statusKey);
    } else moveTask(id, statusKey);
  };

  const onArchive = useCallback(id => archiveTask(id), [archiveTask]);
  const onDelete = useCallback(id => deleteTask(id), [deleteTask]);
  const onToggleSelect = selection.toggle;

  const reorder = async (column, dir) => {
    const prev = columns;
    const idx = prev.findIndex(c => c.id === column.id);
    const target = idx + dir;
    if (target < 0 || target >= prev.length) return;
    const next = [...prev];
    [next[idx], next[target]] = [next[target], next[idx]];
    setProjectColumns(projectId, next);
    try {
      const res = await api.columns.reorder(projectId, next.map(c => c.id));
      setProjectColumns(projectId, res.columns);
    } catch (err) {
      setProjectColumns(projectId, prev);
      showError(err);
    }
  };

  const removeColumn = async column => {
    const count = totals[column.statusKey] || 0;
    if (columns.length <= 1) { toast('O projeto precisa de pelo menos uma coluna', 'error'); return; }
    if (count > 0) { setDeleting({ column, count }); return; }
    const ok = await confirm({ title: `Excluir a coluna "${column.name}"?`, message: 'A coluna está vazia e será removida do quadro.', confirmLabel: 'Excluir coluna', danger: true });
    if (!ok) return;
    try {
      await api.columns.remove(column.id);
      setProjectColumns(projectId, cols => cols.filter(c => c.id !== column.id));
      toast(`Coluna "${column.name}" excluída`, 'success');
    } catch (err) {
      if (err.status === 409) setDeleting({ column, count: err.details?.taskCount || 0 });
      else showError(err);
    }
  };

  if (colError && !columns) return <ErrorState error={colError} onRetry={fetchColumns} />;
  if (tasksState.error && !tasks.length) return <ErrorState error={tasksState.error} onRetry={reloadTasks} />;
  const loading = !columns || (tasksState.loading && !tasks.length);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <TaskFilterBar state={filterState} availableTags={availableTags} showStatus={false} columns={columns} />

      {!loading && (activeCount > 0 || search) && filtered.length === 0 && projectTasks.length > 0 && (
        <Alert tone="info">
          Nenhuma tarefa corresponde à busca e aos filtros atuais.{' '}
          <button type="button" onClick={clearAll} className="underline underline-offset-2 font-medium">Limpar filtros</button>
        </Alert>
      )}

      {loading ? (
        <div className="kanban-scroll flex gap-4 pb-3" aria-busy="true" aria-label="Carregando quadro">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="kanban-column flex flex-col gap-3 rounded-2xl border border-border bg-background-secondary p-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : columns.length === 0 ? (
        <EmptyState
          icon="view_column"
          title="Este projeto ainda não tem colunas"
          description="Crie a primeira coluna para começar a organizar as tarefas no quadro."
          action={canManage && <Btn variant="primary" icon="add" onClick={() => setColumnForm({})}>Criar coluna</Btn>}
        />
      ) : (
        <div className="kanban-scroll flex items-stretch gap-4 pb-3 min-h-[460px]" style={{ height: 'calc(100dvh - 16rem)' }}>
          {columns.map((col, i) => {
            const list = grouped[col.statusKey] || [];
            const total = totals[col.statusKey] || 0;
            const limit = limits[col.id] || PAGE;
            const overWip = col.wipLimit && total > col.wipLimit;
            const isOver = dragOver === col.statusKey;
            return (
              <section
                key={col.id}
                aria-label={`Coluna ${col.name}`}
                onDragOver={canEdit ? e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== col.statusKey) setDragOver(col.statusKey); } : undefined}
                onDragLeave={canEdit ? e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(null); } : undefined}
                onDrop={canEdit ? e => dropOn(e, col.statusKey) : undefined}
                className={`kanban-column flex flex-col rounded-2xl border transition-colors ${isOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-border-subtle bg-background-secondary'}`}
              >
                <header className="flex items-center gap-2 px-3.5 pt-3 pb-2.5">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.color || undefined }} aria-hidden="true" />
                  <h2 className="text-[13px] font-semibold text-text-primary truncate" title={col.name}>{col.name}</h2>
                  <span className="text-[11px] font-mono text-text-muted" title={activeCount || search ? `${list.length} visíveis de ${total}` : undefined}>
                    {activeCount || search ? `${list.length}/${total}` : total}
                  </span>
                  {col.wipLimit && (
                    <span
                      className={`inline-flex items-center gap-0.5 h-5 px-1.5 rounded-md border text-[10px] font-mono ${overWip ? 'text-amber-400 bg-amber-500/10 border-amber-500/25' : 'text-text-muted border-border'}`}
                      title={overWip ? `Limite WIP excedido (${total} de ${col.wipLimit})` : `Limite WIP: ${col.wipLimit}`}
                    >
                      {overWip && <Icon name="warning" size={12} />}WIP {col.wipLimit}
                    </span>
                  )}
                  <div className="flex-1" />
                  {can('task.create') && (
                    <button type="button" onClick={() => openQuickCreate({ projectId, status: col.statusKey })} aria-label={`Adicionar tarefa em ${col.name}`} title="Adicionar tarefa"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover">
                      <Icon name="add" size={18} />
                    </button>
                  )}
                  {canManage && (
                    <FloatingMenu
                      items={[
                        { icon: 'edit', label: 'Editar coluna', onClick: () => setColumnForm({ column: col }) },
                        { icon: 'arrow_back', label: 'Mover para a esquerda', disabled: i === 0, onClick: () => reorder(col, -1) },
                        { icon: 'arrow_forward', label: 'Mover para a direita', disabled: i === columns.length - 1, onClick: () => reorder(col, 1) },
                        '-',
                        { icon: 'delete', label: 'Excluir coluna', danger: true, disabled: columns.length <= 1, onClick: () => removeColumn(col) }
                      ]}
                      trigger={({ toggle, ...aria }) => (
                        <button type="button" onClick={toggle} {...aria} aria-label={`Opções da coluna ${col.name}`} title="Opções da coluna"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover">
                          <Icon name="more_horiz" size={18} />
                        </button>
                      )}
                    />
                  )}
                </header>

                <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 flex flex-col gap-2.5">
                  {list.length === 0 && (
                    <div className={`flex-shrink-0 rounded-xl border border-dashed py-8 px-3 text-center text-[12px] ${isOver ? 'border-blue-500/50 text-text-secondary' : 'border-border text-text-muted'}`}>
                      {draggingId ? 'Solte a tarefa aqui' : total ? 'Nenhuma tarefa visível com os filtros' : 'Nenhuma tarefa nesta coluna'}
                    </div>
                  )}
                  {list.slice(0, limit).map(task => (
                    <div key={task.id} className={`flex-shrink-0 ${draggingId === task.id ? 'opacity-40' : ''}`}>
                      <TaskCard
                        task={task}
                        assignee={memberById.get(task.assigneeId)}
                        columns={columns}
                        taskById={taskById}
                        selectable={selectable}
                        selected={selection.selected.has(task.id)}
                        selectionMode={selection.count > 0}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        onOpen={openTask}
                        onToggleSelect={onToggleSelect}
                        onMove={moveTask}
                        onArchive={onArchive}
                        onDelete={onDelete}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                      />
                    </div>
                  ))}
                  {list.length > limit && (
                    <Btn variant="ghost" size="sm" className="flex-shrink-0" icon="expand_more" onClick={() => setLimits(l => ({ ...l, [col.id]: limit + PAGE }))}>
                      Mostrar mais ({list.length - limit} restantes)
                    </Btn>
                  )}
                </div>

                {can('task.create') && (
                  <div className="px-2.5 pb-2.5">
                    <button type="button" onClick={() => openQuickCreate({ projectId, status: col.statusKey })}
                      className="w-full flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors">
                      <Icon name="add" size={16} />Adicionar tarefa
                    </button>
                  </div>
                )}
              </section>
            );
          })}

          {canManage && (
            <button type="button" onClick={() => setColumnForm({})}
              className="kanban-column self-start flex items-center justify-center gap-2 h-12 rounded-2xl border border-dashed border-border text-[12px] font-medium text-text-muted hover:text-text-primary hover:border-border-focus hover:bg-surface-hover transition-colors">
              <Icon name="add" size={16} />Nova coluna
            </button>
          )}
        </div>
      )}

      {selectable && <BulkActionBar selectedIds={selection.ids} onClear={selection.clear} columns={columns} />}

      <ColumnFormModal
        key={columnForm ? columnForm.column?.id || 'new' : 'closed'}
        state={columnForm}
        projectId={projectId}
        onClose={() => setColumnForm(null)}
      />
      <DeleteColumnModal
        state={deleting}
        columns={columns || []}
        onClose={() => setDeleting(null)}
        onDeleted={column => {
          setProjectColumns(projectId, cols => cols.filter(c => c.id !== column.id));
          reloadTasks();
        }}
      />
    </div>
  );
}

function ColumnFormModal({ state, projectId, onClose }) {
  const { setProjectColumns, showError, toast } = useApp();
  const column = state?.column;
  const [name, setName] = useState(column?.name || '');
  const [color, setColor] = useState(column?.color || COLUMN_COLORS[1]);
  const [wip, setWip] = useState(column?.wipLimit ? String(column.wipLimit) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const trimmed = name.trim();
  const wipNumber = wip === '' ? null : Number(wip);
  const wipInvalid = wip !== '' && (!Number.isInteger(wipNumber) || wipNumber < 1 || wipNumber > 999);

  const submit = async e => {
    e.preventDefault();
    if (!trimmed || wipInvalid) return;
    setSaving(true);
    setError(null);
    try {
      if (column) {
        const res = await api.columns.update(column.id, { name: trimmed, color, wipLimit: wipNumber });
        setProjectColumns(projectId, cols => cols.map(c => (c.id === column.id ? res.column : c)));
        toast('Coluna atualizada', 'success');
      } else {
        const res = await api.columns.create(projectId, { name: trimmed, color, wipLimit: wipNumber ?? undefined });
        setProjectColumns(projectId, cols => [...cols, res.column]);
        toast(`Coluna "${res.column.name}" criada`, 'success');
      }
      onClose();
    } catch (err) {
      if (err.status === 400) setError(err.message);
      else showError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(state)}
      onClose={onClose}
      size="sm"
      title={column ? 'Editar coluna' : 'Nova coluna'}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn variant="primary" type="submit" form="column-form" loading={saving} disabled={!trimmed || wipInvalid}>{column ? 'Salvar' : 'Criar coluna'}</Btn></>}
    >
      <form id="column-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nome" required>
          <Input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="ex.: Em validação" data-autofocus />
        </Field>
        <fieldset>
          <legend className="text-[12px] font-medium text-text-secondary mb-1.5">Cor</legend>
          <div className="flex flex-wrap items-center gap-2">
            {COLUMN_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Cor ${c}`} aria-pressed={color.toLowerCase() === c.toLowerCase()}
                className={`w-7 h-7 rounded-full border-2 transition-transform ${color.toLowerCase() === c.toLowerCase() ? 'border-text-primary scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
            ))}
            <label className="relative w-7 h-7 rounded-full border border-border overflow-hidden cursor-pointer" title="Cor personalizada">
              <span className="sr-only">Cor personalizada</span>
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              <Icon name="palette" size={16} className="absolute inset-0 m-auto w-4 h-4 text-text-muted pointer-events-none" />
            </label>
          </div>
        </fieldset>
        <Field label="Limite WIP" hint="Opcional. Um aviso aparece quando a coluna passa desse número de tarefas." error={wipInvalid ? 'Use um número inteiro entre 1 e 999' : undefined}>
          <Input type="number" min={1} max={999} inputMode="numeric" value={wip} onChange={e => setWip(e.target.value)} placeholder="Sem limite" />
        </Field>
      </form>
    </Modal>
  );
}

function DeleteColumnModal({ state, columns, onClose, onDeleted }) {
  const { showError, toast } = useApp();
  const options = columns.filter(c => c.id !== state?.column.id);
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const moveTo = target || options[0]?.statusKey || '';

  const submit = async () => {
    setSaving(true);
    try {
      const res = await api.columns.remove(state.column.id, moveTo);
      onDeleted(state.column);
      toast(`Coluna "${state.column.name}" excluída${res.movedTasks ? ` — ${pluralize(res.movedTasks, 'tarefa movida', 'tarefas movidas')}` : ''}`, 'success');
      setTarget('');
      onClose();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(state)}
      onClose={onClose}
      size="sm"
      title={state ? `Excluir a coluna "${state.column.name}"?` : ''}
      description={state ? `A coluna possui ${pluralize(state.count, 'tarefa', 'tarefas')}. Escolha para onde ${state.count === 1 ? 'ela será movida' : 'elas serão movidas'}.` : ''}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn variant="danger" loading={saving} disabled={!moveTo} onClick={submit}>Mover e excluir</Btn></>}
    >
      <Field label="Mover tarefas para">
        <Select value={moveTo} onChange={e => setTarget(e.target.value)}>
          {options.map(c => <option key={c.id} value={c.statusKey}>{c.name}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}
