import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { pluralize } from '../../lib/format';
import { StatusBadge } from '../common/Badge';
import { Avatar, Btn, Checkbox, Icon, IconBtn, Input, ProgressBar, SearchInput } from '../ui';
import { useLookups } from './taskUtils';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';

export function Section({ title, icon, count, action, children }) {
  return (
    <section className="px-5 py-4 border-b border-border">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          {icon && <Icon name={icon} size={15} className="text-text-muted" />}
          {title}
          {count !== undefined && <span className="font-mono font-normal text-text-muted normal-case">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------ checklist

const clean = items => items.map(({ id, text, completed }) => (id ? { id, text, completed } : { text, completed }));

export function ChecklistSection({ task, canEdit, save }) {
  const items = task.checklist || [];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null); // { index, text }
  const done = items.filter(i => i.completed).length;

  const commit = next => save({ checklist: clean(next) });
  const add = e => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    commit([...items, { text, completed: false }]);
    setDraft('');
  };
  const rename = () => {
    const text = editing.text.trim();
    if (text && text !== items[editing.index].text) commit(items.map((it, i) => (i === editing.index ? { ...it, text } : it)));
    setEditing(null);
  };

  return (
    <Section title="Checklist" icon="checklist" count={items.length ? `${done}/${items.length}` : undefined}>
      {items.length > 0 && (
        <div className="mb-3">
          <ProgressBar value={(done / items.length) * 100} />
          <p className="mt-1.5 text-[11px] text-text-muted">{done} / {items.length} concluídos</p>
        </div>
      )}
      {items.length === 0 && !canEdit && <p className="text-[12px] text-text-muted">Nenhum item no checklist.</p>}
      <ul className="flex flex-col gap-0.5">
        {items.map((item, i) => (
          <li key={item.id || `new-${i}`} className="group flex items-center gap-2.5 min-h-9 px-1.5 rounded-lg hover:bg-surface-hover">
            <Checkbox checked={item.completed} disabled={!canEdit} onChange={v => commit(items.map((it, j) => (j === i ? { ...it, completed: v } : it)))} label={`Concluir: ${item.text}`} />
            {editing?.index === i ? (
              <Input
                autoFocus
                value={editing.text}
                maxLength={300}
                onChange={e => setEditing({ index: i, text: e.target.value })}
                onBlur={rename}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } }}
                className="h-8"
                aria-label="Editar item"
              />
            ) : (
              <button type="button" disabled={!canEdit} onClick={() => setEditing({ index: i, text: item.text })}
                className={`flex-1 min-w-0 text-left text-[13px] break-words py-1 disabled:cursor-default ${item.completed ? 'line-through text-text-muted' : 'text-text-primary'}`}
                title={canEdit ? 'Clique para editar' : undefined}>
                {item.text}
              </button>
            )}
            {canEdit && editing?.index !== i && (
              <IconBtn icon="close" size="xs" label={`Remover item ${item.text}`} onClick={() => commit(items.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100" />
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="flex gap-2 mt-2">
          <Input value={draft} onChange={e => setDraft(e.target.value)} maxLength={300} placeholder="Adicionar item…" aria-label="Novo item do checklist" />
          <Btn type="submit" icon="add" disabled={!draft.trim()} size="md">Adicionar</Btn>
        </form>
      )}
    </Section>
  );
}

// ------------------------------------------------------------- subtasks

export function SubtasksSection({ task, subtasks }) {
  const { createTask, openTask, can, showError, columnsByProject } = useApp();
  const { memberById } = useLookups();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const progress = task.subtaskProgress || { done: subtasks.filter(s => s.status === 'Done').length, total: subtasks.length };

  const add = async e => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    setSaving(true);
    try {
      await createTask({ title: value, projectId: task.projectId, subtaskOf: task.id });
      setTitle('');
    } catch (err) { showError(err); }
    setSaving(false);
  };

  return (
    <Section title="Subtarefas" icon="account_tree" count={progress.total ? `${progress.done}/${progress.total}` : undefined}>
      {progress.total > 0 && <ProgressBar value={(progress.done / progress.total) * 100} className="mb-3" />}
      {subtasks.length === 0 && <p className="text-[12px] text-text-muted mb-2">Nenhuma subtarefa.</p>}
      <ul className="flex flex-col gap-1">
        {subtasks.map(s => (
          <li key={s.id}>
            <button type="button" onClick={() => openTask(s.id)} className="w-full flex items-center gap-2 min-h-9 px-2 rounded-lg text-left hover:bg-surface-hover">
              <Icon name={s.status === 'Done' ? 'check_circle' : 'radio_button_unchecked'} size={16} className={s.status === 'Done' ? 'text-emerald-400' : 'text-text-muted'} />
              <span className="text-[11px] font-mono text-text-muted flex-shrink-0">{s.id}</span>
              <span className={`flex-1 min-w-0 truncate text-[13px] ${s.status === 'Done' ? 'line-through text-text-muted' : 'text-text-primary'}`}>{s.title}</span>
              <StatusBadge status={s.status} columns={columnsByProject[s.projectId]} />
              {memberById.get(s.assigneeId) && <Avatar user={memberById.get(s.assigneeId)} size={20} />}
            </button>
          </li>
        ))}
      </ul>
      {can('task.create') && (
        <form onSubmit={add} className="flex gap-2 mt-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Adicionar subtarefa…" aria-label="Título da subtarefa" />
          <Btn type="submit" icon="add" size="md" loading={saving} disabled={!title.trim()}>Adicionar</Btn>
        </form>
      )}
    </Section>
  );
}

// --------------------------------------------------------- dependencies

function DependencyRow({ dep, onRemove, removeLabel }) {
  const { openTask, columnsByProject } = useApp();
  return (
    <li className="group flex items-center gap-2 min-h-9 px-2 rounded-lg hover:bg-surface-hover">
      <button type="button" onClick={() => openTask(dep.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
        <span className="text-[11px] font-mono text-text-muted flex-shrink-0">{dep.id}</span>
        <span className={`min-w-0 truncate text-[13px] ${dep.status === 'Done' ? 'line-through text-text-muted' : 'text-text-primary'}`}>{dep.title || 'Tarefa indisponível'}</span>
      </button>
      {dep.status && <StatusBadge status={dep.status} columns={columnsByProject[dep.projectId]} />}
      {onRemove && <IconBtn icon="link_off" size="xs" label={removeLabel} onClick={onRemove} className="opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100" />}
    </li>
  );
}

export function DependenciesSection({ task, fallback, canEdit, save }) {
  const { tasks } = useApp();
  const { taskById } = useLookups();
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');

  const resolve = (id, list) => taskById.get(id) || list?.find(d => d.id === id) || { id };
  const blockedBy = (task.blockedBy || []).map(id => resolve(id, fallback?.blockedBy));
  const blockIds = task.blocks || fallback?.blocks?.map(b => b.id) || [];
  const blocks = blockIds.map(id => resolve(id, fallback?.blocks));

  const candidates = useMemo(() => {
    if (!picking) return [];
    const exclude = new Set([task.id, ...(task.blockedBy || []), ...blockIds]);
    const s = q.trim().toLowerCase();
    return tasks
      .filter(t => !exclude.has(t.id) && (!s || t.title.toLowerCase().includes(s) || t.id.toLowerCase().includes(s)))
      .slice(0, 8);
  }, [picking, tasks, task.id, task.blockedBy, blockIds, q]);

  const add = async id => {
    const ok = await save({ blockedBy: [...(task.blockedBy || []), id] });
    if (ok) { setPicking(false); setQ(''); }
  };
  const remove = id => save({ blockedBy: (task.blockedBy || []).filter(x => x !== id) });

  return (
    <Section
      title="Dependências"
      icon="link"
      action={canEdit && !picking && <Btn size="xs" variant="ghost" icon="add" onClick={() => setPicking(true)}>Adicionar bloqueio</Btn>}
    >
      {picking && (
        <div className="mb-3 p-2 rounded-lg border border-border bg-background-secondary">
          <div className="flex gap-2">
            <SearchInput
              className="flex-1"
              value={q}
              onChange={setQ}
              placeholder="Buscar tarefa por título ou ID…"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && candidates[0]) { e.preventDefault(); add(candidates[0].id); } }}
            />
            <Btn variant="ghost" size="md" onClick={() => { setPicking(false); setQ(''); }}>Cancelar</Btn>
          </div>
          <ul className="mt-1.5 max-h-60 overflow-y-auto">
            {candidates.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-text-muted">Nenhuma tarefa encontrada</li>}
            {candidates.map(c => (
              <li key={c.id}>
                <button type="button" onClick={() => add(c.id)} className="w-full flex items-center gap-2 min-h-9 px-2 rounded-lg text-left hover:bg-surface-hover">
                  <span className="text-[11px] font-mono text-text-muted flex-shrink-0">{c.id}</span>
                  <span className="flex-1 min-w-0 truncate text-[13px] text-text-primary">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4 className="text-[11px] font-medium text-text-muted mb-1">Bloqueada por</h4>
      {blockedBy.length ? (
        <ul className="flex flex-col gap-0.5 mb-3">
          {blockedBy.map(d => <DependencyRow key={d.id} dep={d} onRemove={canEdit ? () => remove(d.id) : null} removeLabel={`Remover dependência ${d.id}`} />)}
        </ul>
      ) : <p className="text-[12px] text-text-muted mb-3">Nenhuma tarefa bloqueia esta.</p>}

      <h4 className="text-[11px] font-medium text-text-muted mb-1">Bloqueia</h4>
      {blocks.length ? (
        <ul className="flex flex-col gap-0.5">
          {blocks.map(d => <DependencyRow key={d.id} dep={d} />)}
        </ul>
      ) : <p className="text-[12px] text-text-muted">Esta tarefa não bloqueia outras.</p>}
      {blocks.length > 0 && <p className="mt-2 text-[11px] text-text-muted">{pluralize(blocks.length, 'tarefa depende', 'tarefas dependem')} da conclusão desta.</p>}
    </Section>
  );
}

// ------------------------------------------------- linked publications

const PUB_STATUS = { DRAFT: 'Rascunho', PENDING_APPROVAL: 'Em aprovação', APPROVED: 'Aprovado', SCHEDULED: 'Agendado', PUBLISHING: 'Publicando', PUBLISHED: 'Publicado', FAILED: 'Erro', CANCELLED: 'Cancelado' };

// Criativos ↔ Tarefas: publications linked to this task (Task → Creative → Publication).
export function PublicationsSection({ task }) {
  const { can, navigate } = useApp();
  const allowed = can('creatives.view');
  const { data } = useAsync(() => (allowed ? api.publications.byTask(task.id) : Promise.resolve({ publications: [] })), [task.id, allowed, task.updatedAt]);
  const pubs = data?.publications || [];
  if (!allowed || !pubs.length) return null;
  return (
    <Section title="Publicações" icon="photo_library" count={pubs.length}>
      <ul className="flex flex-col gap-1.5">
        {pubs.map(p => (
          <li key={p.id}>
            <button type="button" onClick={() => navigate(`/creatives/${p.socialAccountId}/publications?pub=${encodeURIComponent(p.id)}`)} className="w-full flex items-center gap-2.5 p-2 rounded-lg border border-border hover:bg-surface-hover text-left">
              <span className="w-8 h-10 rounded overflow-hidden bg-surface-elevated flex-shrink-0">
                {p.media?.[0]?.creative?.available ? <img src={api.creatives.thumbUrl(p.media[0].creative.id)} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Icon name="image" size={16} className="m-auto mt-3 text-text-muted" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-text-primary truncate">{p.title}</span>
                <span className="block text-[11px] text-text-muted">{PUB_STATUS[p.status] || p.status}{p.scheduledAt ? ` · ${new Date(p.publishedAt || p.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
              </span>
              <Icon name="chevron_right" size={16} className="text-text-muted" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
