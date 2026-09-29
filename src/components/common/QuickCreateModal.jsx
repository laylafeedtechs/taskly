import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Btn, Field, Input, Textarea, Select, Alert, Kbd } from '../ui';
import { PRIORITIES, PRIORITY_LABEL, TASK_TYPES, TYPE_META } from '../../lib/format';

const empty = { title: '', description: '', projectId: '', status: '', priority: 'Normal', type: '', assigneeId: '', dueDate: '', tags: '' };

export function QuickCreateModal() {
  const { quickCreate, closeQuickCreate, projects, members, user, columnsByProject, loadColumns, createTask, showError, currentWorkspace, can, openTask } = useApp();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const activeProjects = useMemo(() => projects.filter(p => !p.archivedAt), [projects]);

  useEffect(() => {
    if (!quickCreate.open) return;
    const projectId = quickCreate.defaults.projectId || activeProjects.find(p => p.isFavorite)?.id || activeProjects[0]?.id || '';
    setForm({ ...empty, type: currentWorkspace?.settings?.defaultTaskType || 'Task', assigneeId: user?.id || '', ...quickCreate.defaults, projectId });
  }, [quickCreate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (form.projectId) loadColumns(form.projectId).catch(() => {}); }, [form.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = columnsByProject[form.projectId] || [];
  useEffect(() => {
    if (columns.length && !columns.some(c => c.statusKey === form.status)) {
      setForm(f => ({ ...f, status: (columns.find(c => c.statusKey === 'To Do') || columns[0]).statusKey }));
    }
  }, [columns, form.status]);

  if (!quickCreate.open) return null;
  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async (e, openAfter = false) => {
    e?.preventDefault();
    if (!form.title.trim() || !form.projectId) return;
    setSaving(true);
    try {
      const task = await createTask({
        title: form.title.trim(),
        description: form.description,
        projectId: form.projectId,
        status: form.status || undefined,
        priority: form.priority,
        type: form.type,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        ...(form.subtaskOf ? { subtaskOf: form.subtaskOf } : {})
      });
      closeQuickCreate();
      if (openAfter) openTask(task.id);
    } catch (err) { showError(err); } finally { setSaving(false); }
  };

  if (!can('task.create')) {
    return (
      <Modal open onClose={closeQuickCreate} title="Nova tarefa" size="sm" footer={<Btn onClick={closeQuickCreate}>Fechar</Btn>}>
        <Alert tone="warning">Seu papel neste workspace ({currentWorkspace?.myRole}) não permite criar tarefas.</Alert>
      </Modal>
    );
  }

  return (
    <Modal open onClose={closeQuickCreate} title="Nova tarefa" size="lg"
      footer={<>
        <span className="mr-auto hidden sm:flex items-center gap-1 text-[11px] text-text-muted"><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> para criar</span>
        <Btn onClick={closeQuickCreate}>Cancelar</Btn>
        <Btn onClick={e => submit(e, true)} disabled={!form.title.trim() || !form.projectId || saving}>Criar e abrir</Btn>
        <Btn variant="primary" loading={saving} onClick={submit} disabled={!form.title.trim() || !form.projectId}>Criar tarefa</Btn>
      </>}>
      {activeProjects.length === 0 ? (
        <Alert tone="info">Crie um projeto antes de adicionar tarefas.</Alert>
      ) : (
        <form onSubmit={submit} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Título" required className="sm:col-span-2">
            <Input value={form.title} onChange={set('title')} data-autofocus maxLength={200} placeholder="O que precisa ser feito?" />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Textarea value={form.description} onChange={set('description')} rows={3} placeholder="Contexto, critérios de aceite…" />
          </Field>
          <Field label="Projeto" required>
            <Select value={form.projectId} onChange={set('projectId')}>{activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set('status')} disabled={!columns.length}>{columns.map(c => <option key={c.id} value={c.statusKey}>{c.name}</option>)}</Select>
          </Field>
          <Field label="Prioridade">
            <Select value={form.priority} onChange={set('priority')}>{PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select>
          </Field>
          <Field label="Tipo">
            <Select value={form.type} onChange={set('type')}>{TASK_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}</Select>
          </Field>
          <Field label="Responsável">
            <Select value={form.assigneeId} onChange={set('assigneeId')}>
              <option value="">Sem responsável</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === user.id ? ' (você)' : ''}</option>)}
            </Select>
          </Field>
          <Field label="Prazo">
            <Input type="date" value={form.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field label="Tags" hint="Separe por vírgulas" className="sm:col-span-2">
            <Input value={form.tags} onChange={set('tags')} placeholder="frontend, urgente" />
          </Field>
        </form>
      )}
    </Modal>
  );
}
