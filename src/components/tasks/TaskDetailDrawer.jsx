import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { PRIORITIES, PRIORITY_LABEL, TASK_TYPES, TYPE_META, formatDate, formatDateTime, statusLabel, timeAgo } from '../../lib/format';
import { TagPill } from '../common/Badge';
import { Alert, Btn, Drawer, EmptyState, ErrorState, Field, IconBtn, Input, LoadingState, Menu, Select, Tabs, Textarea } from '../ui';
import { RecurrenceEditor } from './RecurrenceEditor';
import { ChecklistSection, DependenciesSection, Section, SubtasksSection } from './TaskDrawerSections';
import { ActivitySection, AttachmentsSection, CommentsSection } from './TaskDrawerMedia';
import { useLookups } from './taskUtils';

export function TaskDetailDrawer() {
  const { drawerTaskId, closeTask } = useApp();
  if (!drawerTaskId) return null;
  return <TaskDrawerContent key={drawerTaskId} id={drawerTaskId} onClose={closeTask} />;
}

function TaskDrawerContent({ id, onClose }) {
  const { tasks, upsertTask, updateTask, archiveTask, deleteTask, createTask, openTask, can, toast, showError, columnsByProject, loadColumns, projects } = useApp();
  const detail = useAsync(() => api.tasks.get(id), [id]);
  const ctxTask = useMemo(() => tasks.find(t => t.id === id), [tasks, id]);
  const task = ctxTask || detail.data?.task;
  const [files, setFiles] = useState([]);
  const [tab, setTab] = useState('comments');
  const canEdit = can('task.edit');

  useEffect(() => { if (detail.data) setFiles(detail.data.attachments || []); }, [detail.data]);

  const projectId = task?.projectId;
  useEffect(() => { if (projectId && !columnsByProject[projectId]) loadColumns(projectId).catch(() => {}); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the context list (cards, lists) and the local snapshot in sync.
  const onFresh = useCallback(fresh => {
    if (tasks.some(t => t.id === fresh.id)) upsertTask(fresh);
    detail.setData(d => (d ? { ...d, task: fresh } : d));
  }, [tasks, upsertTask, detail.setData]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async patch => {
    const fresh = await updateTask(id, patch);
    if (fresh) detail.setData(d => (d ? { ...d, task: fresh } : d));
    return fresh;
  }, [id, updateTask, detail.setData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attachment count shown on cards follows uploads/deletions made here.
  useEffect(() => {
    if (ctxTask && detail.data && ctxTask.attachmentCount !== files.length) upsertTask({ ...ctxTask, attachmentCount: files.length });
  }, [files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtasks = useMemo(() => {
    const live = tasks.filter(t => t.subtaskOf === id);
    return live.length ? live : detail.data?.subtasks || [];
  }, [tasks, id, detail.data]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?task=${encodeURIComponent(id)}`);
      toast('Link da tarefa copiado', 'success');
    } catch { toast('Não foi possível copiar o link', 'error'); }
  };

  const duplicate = async () => {
    try {
      const copy = await createTask({
        title: `${task.title} (cópia)`.slice(0, 200), projectId: task.projectId, status: task.status, description: task.description,
        priority: task.priority, type: task.type, tags: task.tags, assigneeId: task.assigneeId, startDate: task.startDate, dueDate: task.dueDate,
        milestoneId: task.milestoneId, checklist: (task.checklist || []).map(c => ({ text: c.text, completed: false }))
      });
      openTask(copy.id);
    } catch (err) { showError(err); }
  };

  const notFound = detail.error && [403, 404].includes(detail.error.status);

  const menu = task && !notFound && (
    <Menu
      width={200}
      items={[
        { icon: 'link', label: 'Copiar link', onClick: copyLink },
        can('task.create') && { icon: 'content_copy', label: 'Duplicar', onClick: duplicate },
        canEdit && { icon: task.archivedAt ? 'unarchive' : 'archive', label: task.archivedAt ? 'Desarquivar' : 'Arquivar', onClick: async () => { await archiveTask(id, !task.archivedAt); if (!task.archivedAt) onClose(); } },
        can('task.delete') && '-',
        can('task.delete') && { icon: 'delete', label: 'Excluir', danger: true, onClick: () => deleteTask(id) }
      ]}
      trigger={({ toggle, ...aria }) => <IconBtn icon="more_horiz" size="xs" label="Mais ações" onClick={toggle} {...aria} />}
    />
  );

  const title = (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-text-secondary">{id}</span>
      {task && !notFound && <IconBtn icon="link" size="xs" label="Copiar link da tarefa" onClick={copyLink} />}
    </span>
  );

  let body;
  if (notFound) {
    body = <EmptyState icon="search_off" title="Tarefa não encontrada" description="Ela pode ter sido excluída ou você não tem acesso a este projeto." action={<Btn onClick={onClose}>Fechar</Btn>} />;
  } else if (!task && detail.error) {
    body = <ErrorState error={detail.error} onRetry={detail.reload} />;
  } else if (!task) {
    body = <div className="p-5"><LoadingState rows={5} label="Carregando tarefa" /></div>;
  } else {
    const project = projects.find(p => p.id === task.projectId);
    const columns = columnsByProject[task.projectId] || [];
    body = (
      <>
        {task.archivedAt && (
          <div className="px-5 pt-4">
            <Alert tone="warning">
              Tarefa arquivada {timeAgo(task.archivedAt)}.{' '}
              {canEdit && <button type="button" className="underline font-medium" onClick={() => archiveTask(id, false)}>Desarquivar</button>}
            </Alert>
          </div>
        )}
        {task.isBlocked && (
          <div className="px-5 pt-4">
            <Alert tone="danger" icon="lock">Bloqueada por {(task.blockedBy || []).join(', ')} — conclua as dependências antes de avançar.</Alert>
          </div>
        )}
        <DetailsSection task={task} project={project} columns={columns} canEdit={canEdit} save={save} />
        <DescriptionSection task={task} canEdit={canEdit} save={save} />
        <ChecklistSection task={task} canEdit={canEdit} save={save} />
        <SubtasksSection task={task} subtasks={subtasks} />
        <DependenciesSection task={task} fallback={detail.data?.dependencies} canEdit={canEdit} save={save} />
        <AttachmentsSection task={task} files={files} setFiles={setFiles} loading={detail.loading} error={detail.error} onRetry={detail.reload} />
        <section className="px-5 py-4">
          <Tabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[{ id: 'comments', label: 'Comentários', icon: 'forum', count: (task.comments || []).length }, { id: 'activity', label: 'Atividade', icon: 'history' }]}
          />
          {tab === 'comments'
            ? <CommentsSection task={task} onFresh={onFresh} />
            : <ActivitySection taskId={id} refreshKey={`${task.updatedAt}|${task.commentCount}|${files.length}|${task.archivedAt}`} />}
        </section>
        <p className="px-5 pb-6 text-[11px] text-text-muted">
          Criada em {formatDateTime(task.createdAt)}{task.updatedAt && ` · atualizada ${timeAgo(task.updatedAt)}`}{task.completedAt && ` · concluída em ${formatDate(task.completedAt)}`}
        </p>
      </>
    );
  }

  return (
    <Drawer open onClose={onClose} width={460} title={title} headerActions={menu}>
      {body}
    </Drawer>
  );
}

// ---------------------------------------------------------------- details

function ReadOnly({ children }) {
  return <div className="min-h-9 flex items-center px-3 rounded-lg border border-border-subtle bg-background-secondary text-[13px] text-text-primary truncate">{children}</div>;
}

function TitleEditor({ task, canEdit, save }) {
  const [value, setValue] = useState(task.title);
  useEffect(() => setValue(task.title), [task.title]);
  if (!canEdit) return <h2 className="text-[17px] font-semibold leading-snug text-text-primary break-words">{task.title}</h2>;
  const commit = () => {
    const v = value.trim();
    if (!v) { setValue(task.title); return; }
    if (v !== task.title) save({ title: v });
  };
  return (
    <textarea
      value={value}
      onChange={e => setValue(e.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      maxLength={200}
      rows={Math.min(4, Math.max(1, Math.ceil(value.length / 38)))}
      aria-label="Título da tarefa"
      className="w-full resize-none bg-transparent border border-transparent hover:border-border focus:border-border-focus focus:bg-background-secondary rounded-lg -mx-2 px-2 py-1 text-[17px] font-semibold leading-snug text-text-primary focus:outline-none transition-colors"
    />
  );
}

function DateField({ label, value, canEdit, onCommit }) {
  const [local, setLocal] = useState(value || '');
  useEffect(() => setLocal(value || ''), [value]);
  if (!canEdit) return <Field label={label}><ReadOnly>{value ? formatDate(value, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</ReadOnly></Field>;
  const commit = async () => {
    if ((local || null) === (value || null)) return;
    const ok = await onCommit(local || null);
    if (!ok) setLocal(value || '');
  };
  return (
    <Field label={label}>
      <Input type="date" value={local} onChange={e => setLocal(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
    </Field>
  );
}

function TagsEditor({ tags, canEdit, onChange }) {
  const { tasks } = useApp();
  const [draft, setDraft] = useState('');
  const suggestions = useMemo(() => [...new Set(tasks.flatMap(t => t.tags || []))].filter(t => !tags.includes(t)).sort(), [tasks, tags]);
  const add = () => {
    const t = draft.trim().replace(/,$/, '').slice(0, 30);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-h-9 p-1.5 rounded-lg border border-border bg-background-secondary">
      {tags.map(t => <TagPill key={t} tag={t} onRemove={canEdit ? () => onChange(tags.filter(x => x !== t)) : undefined} />)}
      {!tags.length && !canEdit && <span className="px-1.5 text-[13px] text-text-muted">Sem tags</span>}
      {canEdit && tags.length < 20 && (
        <>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
              if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
            }}
            onBlur={() => draft.trim() && add()}
            list="drawer-tag-suggestions"
            maxLength={30}
            placeholder={tags.length ? 'Adicionar…' : 'Adicionar tag…'}
            aria-label="Adicionar tag"
            className="flex-1 min-w-[90px] h-6 px-1.5 bg-transparent text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <datalist id="drawer-tag-suggestions">{suggestions.map(t => <option key={t} value={t} />)}</datalist>
        </>
      )}
    </div>
  );
}

function DetailsSection({ task, project, columns, canEdit, save }) {
  const { members } = useApp();
  const { memberById } = useLookups();
  const milestones = project?.milestones || [];
  const assignee = memberById.get(task.assigneeId);

  const select = (label, value, onChange, options, display) => (
    <Field label={label}>
      {canEdit
        ? <Select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        : <ReadOnly>{display}</ReadOnly>}
    </Field>
  );

  return (
    <Section title="Detalhes" icon="tune">
      <div className="mb-4">
        <TitleEditor task={task} canEdit={canEdit} save={save} />
        {project && (
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-text-muted">
            <span className="w-2 h-2 rounded-full bg-text-muted" style={project.color ? { backgroundColor: project.color } : undefined} aria-hidden="true" />
            {project.name}
            {task.subtaskOf && <> · subtarefa de <span className="font-mono">{task.subtaskOf}</span></>}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {select('Status', task.status, v => save({ status: v }),
          (columns.some(c => c.statusKey === task.status) ? columns : [{ statusKey: task.status, name: statusLabel(task.status) }, ...columns]).map(c => ({ value: c.statusKey, label: c.name })),
          statusLabel(task.status, columns))}
        {select('Prioridade', task.priority, v => save({ priority: v }), PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABEL[p] })), PRIORITY_LABEL[task.priority])}
        {select('Tipo', task.type, v => save({ type: v }), TASK_TYPES.map(t => ({ value: t, label: TYPE_META[t].label })), TYPE_META[task.type]?.label || task.type)}
        {select('Responsável', task.assigneeId || '', v => save({ assigneeId: v || null }),
          [{ value: '', label: 'Sem responsável' }, ...members.map(m => ({ value: m.id, label: m.name }))], assignee?.name || 'Sem responsável')}
        <DateField label="Início" value={task.startDate} canEdit={canEdit} onCommit={v => save({ startDate: v })} />
        <DateField label="Prazo" value={task.dueDate} canEdit={canEdit} onCommit={v => save({ dueDate: v })} />
        <div className="col-span-2">
          {select('Marco', task.milestoneId || '', v => save({ milestoneId: v || null }),
            [{ value: '', label: milestones.length ? 'Nenhum marco' : 'O projeto não tem marcos' }, ...milestones.map(m => ({ value: m.id, label: `${m.name}${m.dueDate ? ` · ${formatDate(m.dueDate)}` : ''}` }))],
            milestones.find(m => m.id === task.milestoneId)?.name || 'Nenhum marco')}
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">Tags</span>
          <TagsEditor tags={task.tags || []} canEdit={canEdit} onChange={tags => save({ tags })} />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">Recorrência</span>
          <RecurrenceEditor value={task.recurrence} readOnly={!canEdit} onSave={recurrence => save({ recurrence })} />
        </div>
      </div>
    </Section>
  );
}

function DescriptionSection({ task, canEdit, save }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const start = () => { setDraft(task.description || ''); setEditing(true); };
  const submit = async () => {
    setSaving(true);
    const ok = await save({ description: draft });
    setSaving(false);
    if (ok) setEditing(false);
  };
  return (
    <Section title="Descrição" icon="notes" action={canEdit && !editing && <Btn size="xs" variant="ghost" icon="edit" onClick={start}>Editar</Btn>}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={20000} className="min-h-[140px]" aria-label="Descrição da tarefa" placeholder="Descreva o contexto, critérios de aceite, links…" />
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancelar</Btn>
            <Btn variant="primary" size="sm" onClick={submit} loading={saving} disabled={draft === (task.description || '')}>Salvar</Btn>
          </div>
        </div>
      ) : task.description ? (
        <p className="text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">{task.description}</p>
      ) : (
        <p className="text-[12px] text-text-muted">{canEdit ? <button type="button" onClick={start} className="hover:text-text-primary">Adicionar uma descrição…</button> : 'Sem descrição.'}</p>
      )}
    </Section>
  );
}
