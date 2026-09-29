import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatDate, todayISO } from '../../lib/format';
import { Modal, Btn, Field, Input, Textarea, Select, Alert, Menu, IconBtn, ProgressBar, Pill, EmptyState, Icon } from '../ui';
import { MILESTONE_STATUS } from './ProjectBits';

function MilestoneModal({ projectId, milestone, onClose, onSaved }) {
  const { showError } = useApp();
  const [form, setForm] = useState(() => ({
    name: milestone?.name || '', description: milestone?.description || '', dueDate: milestone?.dueDate || todayISO(), status: milestone?.status || 'PLANNED'
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const valid = form.name.trim().length >= 2 && Boolean(form.dueDate);

  const submit = async e => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    const data = { ...form, name: form.name.trim(), description: form.description.trim() };
    try {
      const res = milestone ? await api.projects.updateMilestone(milestone.id, data) : await api.projects.createMilestone(projectId, data);
      onSaved(res.milestone);
      onClose();
    } catch (err) {
      if (err.status === 403) { showError(err); onClose(); } else setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={milestone ? 'Editar marco' : 'Novo marco'}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" type="submit" form="milestone-form" loading={saving} disabled={!valid}>{milestone ? 'Salvar' : 'Criar marco'}</Btn>
      </>}
    >
      <form id="milestone-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Field label="Nome" required error={form.name && form.name.trim().length < 2 ? 'Use pelo menos 2 caracteres' : null}>
          <Input data-autofocus value={form.name} maxLength={120} onChange={e => set({ name: e.target.value })} placeholder="Ex.: MVP entregue" />
        </Field>
        <Field label="Descrição"><Textarea value={form.description} maxLength={1000} onChange={e => set({ description: e.target.value })} className="min-h-[64px]" /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Data" required><Input type="date" value={form.dueDate} onChange={e => set({ dueDate: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={e => set({ status: e.target.value })}>
              {Object.entries(MILESTONE_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

export function MilestonesPanel({ projectId, milestones, canEdit, onChange }) {
  const { confirm, toast, showError } = useApp();
  const [editing, setEditing] = useState(null); // null | {} (new) | milestone
  const sorted = useMemo(() => [...milestones].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')), [milestones]);
  const today = todayISO();

  const save = ms => {
    const exists = milestones.some(m => m.id === ms.id);
    onChange(exists ? milestones.map(m => (m.id === ms.id ? ms : m)) : [...milestones, ms]);
    toast(exists ? 'Marco atualizado' : 'Marco criado', 'success');
  };

  const remove = async ms => {
    const ok = await confirm({ title: `Excluir o marco "${ms.name}"?`, message: 'As tarefas vinculadas continuam no projeto, apenas sem marco.', confirmLabel: 'Excluir marco', danger: true });
    if (!ok) return;
    try {
      await api.projects.deleteMilestone(ms.id);
      onChange(milestones.filter(m => m.id !== ms.id));
      toast('Marco excluído', 'success');
    } catch (err) { showError(err); }
  };

  return (
    <section aria-labelledby="milestones-title">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 id="milestones-title" className="text-title-sm text-text-primary flex items-center gap-2"><Icon name="flag" size={18} className="text-text-muted" />Marcos</h2>
        {canEdit && <Btn size="xs" icon="add" onClick={() => setEditing({})}>Novo marco</Btn>}
      </div>
      {sorted.length === 0 ? (
        <EmptyState compact icon="flag" title="Nenhum marco" description="Marcos destacam entregas importantes no cronograma do projeto." action={canEdit && <Btn size="xs" icon="add" onClick={() => setEditing({})}>Criar marco</Btn>} />
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map(m => {
            const meta = MILESTONE_STATUS[m.status] || MILESTONE_STATUS.PLANNED;
            const late = m.status !== 'COMPLETED' && m.dueDate && m.dueDate < today;
            return (
              <li key={m.id} className="rounded-lg border border-border bg-background-secondary p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium text-text-primary break-words">{m.name}</span>
                      <Pill className={meta.className}>{meta.label}</Pill>
                    </div>
                    {m.description && <p className="text-[12px] text-text-secondary mt-1 line-clamp-2">{m.description}</p>}
                  </div>
                  <span className={`text-[11px] whitespace-nowrap flex items-center gap-1 ${late ? 'text-red-400' : 'text-text-muted'}`}>
                    <Icon name="event" size={13} />{formatDate(m.dueDate)}
                  </span>
                  {canEdit && (
                    <Menu
                      width={170}
                      items={[{ label: 'Editar', icon: 'edit', onClick: () => setEditing(m) }, { label: 'Excluir', icon: 'delete', danger: true, onClick: () => remove(m) }]}
                      trigger={({ toggle, ...aria }) => <IconBtn icon="more_horiz" size="xs" label={`Ações do marco ${m.name}`} onClick={toggle} {...aria} className="-mt-1 -mr-1" />}
                    />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  <ProgressBar value={m.progress} className="flex-1" />
                  <span className="text-[11px] font-mono text-text-secondary w-9 text-right">{m.progress || 0}%</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <MilestoneModal projectId={projectId} milestone={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={save} />}
    </section>
  );
}
