import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, TASK_TYPES, TYPE_META } from '../../lib/format';
import { Alert, Btn, Field, Icon, IconBtn, Input, Modal, Select, Textarea, Toggle } from '../ui';
import { errorText } from '../settings/common';

export const FIELD_LABEL = { priority: 'Prioridade', type: 'Tipo', status: 'Status', tag: 'Tag', assigneeId: 'Responsável', projectId: 'Projeto' };
export const OP_LABEL = { eq: 'é igual a', neq: 'é diferente de', contains: 'contém' };
const FIELD_KIND = { priority: 'priority', type: 'type', status: 'status', tag: 'text', assigneeId: 'member', projectId: 'project' };
const TRIGGER_KIND = { 'task.status_changed': 'status', 'task.priority_changed': 'priority', 'task.assigned': 'member' };
const ACTION_KIND = { set_priority: 'priority', set_status: 'status', add_tag: 'text', assign: 'member', notify: 'target' };

const EMPTY = { title: '', description: '', projectId: '', enabled: true, trigger: { type: 'task.created', value: '' }, conditions: [], actions: [{ type: 'notify', target: 'assignee' }] };

function fromAutomation(a) {
  if (!a) return EMPTY;
  const def = a.definition;
  return {
    title: a.title, description: a.description || '', projectId: a.projectId || '', enabled: a.enabled,
    trigger: { type: def.trigger.type, value: def.trigger.value || '' },
    conditions: def.conditions.map(c => ({ ...c })),
    actions: def.actions.map(x => ({ ...x }))
  };
}

// Context-appropriate value picker for triggers, conditions and actions.
function ValueInput({ kind, value, onChange, label, statusOptions, optional = false }) {
  const { members, projects } = useApp();
  if (kind === 'text') return <Input value={value} onChange={e => onChange(e.target.value)} placeholder="ex.: cliente" aria-label={label} maxLength={60} />;
  const options = {
    priority: PRIORITIES.map(p => [p, PRIORITY_LABEL[p]]),
    type: TASK_TYPES.map(t => [t, TYPE_META[t].label]),
    status: statusOptions,
    member: members.map(m => [m.id, m.name]),
    project: projects.map(p => [p.id, p.name]),
    target: [['assignee', 'Responsável pela tarefa'], ['project_managers', 'Gestores do workspace'], ...members.map(m => [m.id, m.name])]
  }[kind] || [];
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      {(optional || !value) && <option value="">{optional ? 'Qualquer valor' : 'Selecione…'}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}

function Block({ step, title, subtitle, tone, children }) {
  return (
    <div className="relative rounded-xl border border-border bg-background-secondary/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center justify-center h-5 px-1.5 rounded-md text-[10px] font-mono font-semibold tracking-wider border ${tone}`}>{step}</span>
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        <span className="text-[11px] text-text-muted">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

const Connector = () => <div className="flex justify-center py-1" aria-hidden="true"><Icon name="arrow_downward" size={16} className="text-text-muted" /></div>;

export function AutomationBuilder({ open, automation, meta, onClose, onSaved }) {
  const { currentWorkspaceId, columnsByProject, projects } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setForm(fromAutomation(automation)); setError(null); } }, [open, automation]);

  const statusOptions = useMemo(() => {
    const cols = form.projectId ? columnsByProject[form.projectId] : null;
    return cols?.length ? cols.map(c => [c.statusKey, c.name]) : Object.entries(STATUS_LABEL);
  }, [form.projectId, columnsByProject]);

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const setList = (key, idx, patch) => setForm(f => ({ ...f, [key]: f[key].map((x, i) => (i === idx ? { ...x, ...patch } : x)) }));
  const removeFrom = (key, idx) => setForm(f => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));

  const save = async e => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      enabled: form.enabled,
      definition: {
        trigger: { type: form.trigger.type, value: form.trigger.value || null },
        conditions: form.conditions,
        actions: form.actions.map(a => (a.type === 'notify' ? { type: 'notify', target: a.target } : { type: a.type, value: a.value }))
      }
    };
    try {
      const res = automation
        ? await api.automations.update(automation.id, { ...body, projectId: form.projectId || null })
        : await api.automations.create(currentWorkspaceId, { ...body, projectId: form.projectId || null });
      onSaved(res.automation, !automation);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const triggerKind = TRIGGER_KIND[form.trigger.type];

  return (
    <Modal open={open} onClose={onClose} size="lg" title={automation ? 'Editar automação' : 'Nova automação'} description="Quando algo acontecer (WHEN), se as condições forem atendidas (IF), execute as ações (THEN)."
      footer={<>
        <Btn onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" type="submit" form="automation-form" loading={saving}>{automation ? 'Salvar alterações' : 'Criar automação'}</Btn>
      </>}>
      <form id="automation-form" onSubmit={save} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Título" required className="sm:col-span-2">
            <Input value={form.title} onChange={e => set({ title: e.target.value })} minLength={3} maxLength={120} required data-autofocus placeholder="ex.: Avisar gestores sobre bugs urgentes" />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Textarea value={form.description} onChange={e => set({ description: e.target.value })} maxLength={500} className="min-h-[56px]" />
          </Field>
          <Field label="Escopo" hint="Deixe em branco para valer em todos os projetos.">
            <Select value={form.projectId} onChange={e => set({ projectId: e.target.value })}>
              <option value="">Todos os projetos</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <div className="flex items-end pb-1.5">
            <Toggle checked={form.enabled} onChange={enabled => set({ enabled })} label="Ativa" description="Automações inativas não são executadas." />
          </div>
        </div>

        <div>
          <Block step="WHEN" title="Quando" subtitle="o gatilho" tone="text-blue-400 bg-blue-500/10 border-blue-500/25">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Select value={form.trigger.type} onChange={e => set({ trigger: { type: e.target.value, value: '' } })} aria-label="Gatilho">
                {Object.entries(meta.triggers).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              {triggerKind && <ValueInput kind={triggerKind} optional value={form.trigger.value} onChange={value => set({ trigger: { ...form.trigger, value } })} label="Valor do gatilho" statusOptions={statusOptions} />}
            </div>
          </Block>
          <Connector />
          <Block step="IF" title="Se" subtitle="todas as condições forem verdadeiras" tone="text-amber-400 bg-amber-500/10 border-amber-500/25">
            <div className="flex flex-col gap-2">
              {form.conditions.length === 0 && <p className="text-[12px] text-text-muted">Sem condições — a ação sempre será executada quando o gatilho ocorrer.</p>}
              {form.conditions.map((c, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.3fr_auto] gap-2 items-center pb-2 sm:pb-0 border-b border-border-subtle sm:border-0">
                  <Select value={c.field} onChange={e => setList('conditions', i, { field: e.target.value, value: '' })} aria-label={`Campo da condição ${i + 1}`}>
                    {meta.fields.map(f => <option key={f} value={f}>{FIELD_LABEL[f] || f}</option>)}
                  </Select>
                  <Select value={c.op} onChange={e => setList('conditions', i, { op: e.target.value })} aria-label={`Operador da condição ${i + 1}`}>
                    {meta.ops.map(o => <option key={o} value={o}>{OP_LABEL[o] || o}</option>)}
                  </Select>
                  <ValueInput kind={FIELD_KIND[c.field]} value={c.value} onChange={value => setList('conditions', i, { value })} label={`Valor da condição ${i + 1}`} statusOptions={statusOptions} />
                  <IconBtn icon="delete" label={`Remover condição ${i + 1}`} onClick={() => removeFrom('conditions', i)} />
                </div>
              ))}
              {form.conditions.length < 10 && (
                <div><Btn size="xs" variant="ghost" icon="add" onClick={() => set({ conditions: [...form.conditions, { field: 'priority', op: 'eq', value: '' }] })}>Adicionar condição</Btn></div>
              )}
            </div>
          </Block>
          <Connector />
          <Block step="THEN" title="Então" subtitle="execute as ações em ordem" tone="text-emerald-400 bg-emerald-500/10 border-emerald-500/25">
            <div className="flex flex-col gap-2">
              {form.actions.map((a, i) => {
                const kind = ACTION_KIND[a.type];
                return (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-center pb-2 sm:pb-0 border-b border-border-subtle sm:border-0">
                    <Select value={a.type} onChange={e => setList('actions', i, e.target.value === 'notify' ? { type: 'notify', target: 'assignee', value: undefined } : { type: e.target.value, value: '', target: undefined })} aria-label={`Ação ${i + 1}`}>
                      {Object.entries(meta.actions).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                    <ValueInput
                      kind={kind}
                      value={(kind === 'target' ? a.target : a.value) || ''}
                      onChange={v => setList('actions', i, kind === 'target' ? { target: v } : { value: v })}
                      label={`Valor da ação ${i + 1}`}
                      statusOptions={statusOptions}
                    />
                    <IconBtn icon="delete" label={`Remover ação ${i + 1}`} onClick={() => removeFrom('actions', i)} disabled={form.actions.length === 1} className="disabled:opacity-40" />
                  </div>
                );
              })}
              {form.actions.length < 10 && (
                <div><Btn size="xs" variant="ghost" icon="add" onClick={() => set({ actions: [...form.actions, { type: 'add_tag', value: '' }] })}>Adicionar ação</Btn></div>
              )}
            </div>
          </Block>
        </div>
      </form>
    </Modal>
  );
}
