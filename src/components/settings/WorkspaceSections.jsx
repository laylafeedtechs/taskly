import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { ROLE_LABEL, TASK_TYPES, TYPE_META } from '../../lib/format';
import { Alert, Btn, Field, Icon, Input, Select } from '../ui';
import { Section, errorText } from './common';

const ICONS = ['business', 'rocket_launch', 'work', 'apartment', 'code', 'palette', 'science', 'school', 'storefront', 'campaign', 'hub', 'favorite'];
const WEEK_DAYS = [[0, 'Domingo'], [1, 'Segunda-feira'], [6, 'Sábado']];

function WorkspaceForm({ workspace, editable }) {
  const { setWorkspaces, toast } = useApp();
  const initial = {
    name: workspace.name,
    color: workspace.color || '#3B82F6',
    icon: workspace.icon || 'business',
    defaultTaskType: workspace.settings?.defaultTaskType || 'Task',
    weekStartsOn: workspace.settings?.weekStartsOn ?? 1
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await api.workspaces.update(workspace.id, {
        name: form.name.trim(), color: form.color, icon: form.icon,
        settings: { defaultTaskType: form.defaultTaskType, weekStartsOn: Number(form.weekStartsOn) }
      });
      setWorkspaces(prev => prev.map(w => (w.id === res.workspace.id ? res.workspace : w)));
      toast('Workspace atualizado', 'success');
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4 max-w-2xl">
      {error && <Alert tone="danger">{error}</Alert>}
      {!editable && <Alert>Apenas o proprietário pode alterar os dados do workspace.</Alert>}
      <div className="flex items-center gap-3">
        <span className="w-12 h-12 rounded-xl flex items-center justify-center text-white flex-shrink-0" style={{ backgroundColor: form.color }} aria-hidden="true">
          <Icon name={form.icon} size={24} />
        </span>
        <Field label="Nome do workspace" required className="flex-1">
          <Input value={form.name} onChange={e => set({ name: e.target.value })} minLength={2} maxLength={60} required disabled={!editable} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ws-color" className="text-[12px] font-medium text-text-secondary">Cor</label>
          <div className="flex items-center gap-2">
            <input id="ws-color" type="color" value={form.color} onChange={e => set({ color: e.target.value.toUpperCase() })} disabled={!editable} className="h-9 w-12 rounded-lg border border-border bg-background-secondary cursor-pointer disabled:opacity-60" />
            <span className="font-mono text-[12px] text-text-secondary">{form.color}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary" id="ws-icon-label">Ícone</span>
          <div role="radiogroup" aria-labelledby="ws-icon-label" className="flex flex-wrap gap-1">
            {ICONS.map(icon => (
              <button key={icon} type="button" role="radio" aria-checked={form.icon === icon} aria-label={icon} disabled={!editable} onClick={() => set({ icon })}
                className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors disabled:opacity-60 ${form.icon === icon ? 'border-blue-500/60 bg-blue-500/10 text-text-primary' : 'border-border text-text-secondary hover:bg-surface-hover'}`}>
                <Icon name={icon} size={16} />
              </button>
            ))}
          </div>
        </div>
        <Field label="Tipo padrão de tarefa">
          <Select value={form.defaultTaskType} onChange={e => set({ defaultTaskType: e.target.value })} disabled={!editable}>
            {TASK_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </Select>
        </Field>
        <Field label="Início da semana">
          <Select value={form.weekStartsOn} onChange={e => set({ weekStartsOn: Number(e.target.value) })} disabled={!editable}>
            {WEEK_DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      </div>
      {editable && <div><Btn type="submit" variant="primary" loading={saving} disabled={!dirty}>Salvar alterações</Btn></div>}
    </form>
  );
}

export function WorkspaceSection() {
  const { user, currentWorkspace, can, confirm, toast, showError, reloadWorkspaces, navigate } = useApp();
  const [archiving, setArchiving] = useState(false);
  if (!currentWorkspace) return null;
  const isOwner = currentWorkspace.ownerId === user.id;

  const archive = async () => {
    const ok = await confirm({
      title: `Arquivar "${currentWorkspace.name}"?`,
      message: 'O workspace ficará inacessível para todos os membros até ser desarquivado. Os dados são mantidos.',
      confirmLabel: 'Arquivar workspace',
      danger: true,
      requireText: currentWorkspace.name
    });
    if (!ok) return;
    setArchiving(true);
    try {
      await api.workspaces.archive(currentWorkspace.id, true);
      toast(`Workspace "${currentWorkspace.name}" arquivado`, 'success');
      await reloadWorkspaces();
      navigate('/dashboard');
    } catch (err) { showError(err); } finally { setArchiving(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="Detalhes do workspace" description={`Seu papel: ${ROLE_LABEL[currentWorkspace.myRole] || currentWorkspace.myRole}`}>
        <WorkspaceForm key={currentWorkspace.id} workspace={currentWorkspace} editable={can('workspace.manage')} />
      </Section>
      {isOwner && (
        <Section title="Zona de perigo" className="border-red-500/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-[13px] text-text-primary font-medium">Arquivar workspace</div>
              <p className="text-[12px] text-text-secondary mt-0.5">Remove o acesso de todos os membros. Os dados são mantidos.</p>
            </div>
            <Btn variant="danger" icon="archive" loading={archiving} onClick={archive}>Arquivar workspace</Btn>
          </div>
        </Section>
      )}
    </div>
  );
}

export function MembersLinkSection() {
  const { navigate, currentWorkspace, can } = useApp();
  return (
    <Section title="Membros" description="Convites, papéis e remoção de membros ficam na página Equipe.">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center"><Icon name="group" size={20} className="text-text-secondary" /></span>
          <div>
            <div className="text-[13px] text-text-primary font-medium">{currentWorkspace?.memberCount ?? 0} membro(s)</div>
            <div className="text-[11px] text-text-muted">{can('members.manage') ? 'Você pode convidar e gerenciar membros.' : 'Você pode ver os membros do workspace.'}</div>
          </div>
        </div>
        <Btn variant="primary" iconRight="arrow_forward" onClick={() => navigate('/team')}>Abrir Equipe</Btn>
      </div>
    </Section>
  );
}
