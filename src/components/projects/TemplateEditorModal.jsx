import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Modal, Btn, IconBtn, Field, Input, Textarea, Select, Alert } from '../ui';
import { TagPill } from '../common/Badge';
import { PRIORITIES, PRIORITY_LABEL, TASK_TYPES, TYPE_META } from '../../lib/format';
import { PROJECT_ICONS } from './ProjectBits';
import { IconPicker } from './ProjectPickers';

const EMPTY = () => ({ name: '', description: '', icon: 'dashboard_customize', columns: ['A Fazer', 'Em Andamento', 'Concluído'], defaultTags: [], milestones: [], tasks: [] });

function ListEditor({ label, items, onChange, render, blank, addLabel, min = 0, max }) {
  const update = (i, value) => onChange(items.map((it, idx) => (idx === i ? value : it)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[12px] font-medium text-text-secondary mb-1.5">{label}</legend>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1 min-w-0 flex flex-wrap sm:flex-nowrap gap-2">{render(item, v => update(i, v), i)}</div>
          <IconBtn icon="remove_circle_outline" size="xs" label={`Remover item ${i + 1}`} disabled={items.length <= min} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="disabled:opacity-30" />
        </div>
      ))}
      {(!max || items.length < max) && <Btn size="xs" variant="ghost" icon="add" className="self-start" onClick={() => onChange([...items, blank()])}>{addLabel}</Btn>}
    </fieldset>
  );
}

export function TemplateEditorModal({ open, onClose, onCreated }) {
  const { currentWorkspaceId, toast } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  const close = () => { setForm(EMPTY()); setTagDraft(''); setError(null); onClose(); };

  const addTag = () => {
    const tag = tagDraft.trim();
    if (tag && !form.defaultTags.includes(tag) && form.defaultTags.length < 20) set({ defaultTags: [...form.defaultTags, tag] });
    setTagDraft('');
  };

  const columns = form.columns.map(c => c.trim()).filter(Boolean);
  const nameError = form.name.trim().length > 0 && form.name.trim().length < 2 ? 'Use pelo menos 2 caracteres' : null;
  const valid = form.name.trim().length >= 2 && columns.length >= 2;

  const submit = async e => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.projects.createTemplate(currentWorkspaceId, {
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon,
        columns,
        defaultTags: form.defaultTags,
        milestones: form.milestones.filter(m => m.name.trim()).map(m => ({ name: m.name.trim(), offsetDays: Math.max(0, Number(m.offsetDays) || 0) })),
        tasks: form.tasks.filter(t => t.title.trim()).map(t => ({ ...t, title: t.title.trim() }))
      });
      toast(`Template "${res.template.name}" criado`, 'success');
      onCreated(res.template);
      close();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Criar template personalizado"
      description="Defina a estrutura reutilizável: colunas, tags, marcos e tarefas padrão."
      footer={<>
        <Btn variant="ghost" onClick={close}>Cancelar</Btn>
        <Btn variant="primary" type="submit" form="template-editor" loading={saving} disabled={!valid}>Salvar template</Btn>
      </>}
    >
      <form id="template-editor" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nome" required error={nameError}><Input data-autofocus value={form.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder="Ex.: Onboarding de clientes" /></Field>
          <Field label="Ícone"><IconPicker icons={PROJECT_ICONS.concat('dashboard_customize')} value={form.icon} onChange={icon => set({ icon })} /></Field>
        </div>
        <Field label="Descrição"><Textarea value={form.description} maxLength={300} onChange={e => set({ description: e.target.value })} className="min-h-[60px]" /></Field>

        <ListEditor
          label="Colunas (mínimo 2, a última é tratada como concluída)"
          items={form.columns}
          min={2}
          max={12}
          blank={() => ''}
          addLabel="Adicionar coluna"
          onChange={cols => set({ columns: cols })}
          render={(value, onChange, i) => <Input aria-label={`Coluna ${i + 1}`} value={value} maxLength={40} onChange={e => onChange(e.target.value)} />}
        />

        <Field label="Tags padrão" hint="Pressione Enter para adicionar">
          <Input value={tagDraft} maxLength={30} onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="Ex.: Design" />
        </Field>
        {form.defaultTags.length > 0 && (
          <div className="flex flex-wrap gap-1 -mt-2">{form.defaultTags.map(t => <TagPill key={t} tag={t} onRemove={() => set({ defaultTags: form.defaultTags.filter(x => x !== t) })} />)}</div>
        )}

        <ListEditor
          label="Marcos (dias após o início)"
          items={form.milestones}
          max={20}
          blank={() => ({ name: '', offsetDays: 14 })}
          addLabel="Adicionar marco"
          onChange={milestones => set({ milestones })}
          render={(m, onChange, i) => <>
            <Input aria-label={`Nome do marco ${i + 1}`} value={m.name} maxLength={80} placeholder="Nome do marco" onChange={e => onChange({ ...m, name: e.target.value })} className="flex-1 min-w-[140px]" />
            <Input aria-label={`Dias do marco ${i + 1}`} type="number" min={0} max={730} value={m.offsetDays} onChange={e => onChange({ ...m, offsetDays: e.target.value })} className="w-24" />
          </>}
        />

        <ListEditor
          label="Tarefas padrão"
          items={form.tasks}
          max={50}
          blank={() => ({ title: '', type: 'Task', priority: 'Normal' })}
          addLabel="Adicionar tarefa"
          onChange={tasks => set({ tasks })}
          render={(t, onChange, i) => <>
            <Input aria-label={`Título da tarefa ${i + 1}`} value={t.title} maxLength={200} placeholder="Título da tarefa" onChange={e => onChange({ ...t, title: e.target.value })} className="flex-1 min-w-[160px]" />
            <Select aria-label={`Tipo da tarefa ${i + 1}`} value={t.type} onChange={e => onChange({ ...t, type: e.target.value })} className="w-[120px]">
              {TASK_TYPES.map(type => <option key={type} value={type}>{TYPE_META[type].label}</option>)}
            </Select>
            <Select aria-label={`Prioridade da tarefa ${i + 1}`} value={t.priority} onChange={e => onChange({ ...t, priority: e.target.value })} className="w-[110px]">
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </>}
        />
      </form>
    </Modal>
  );
}
