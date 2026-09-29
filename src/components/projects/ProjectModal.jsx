import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { addDaysISO, todayISO, PROJECT_STATUS_LABEL } from '../../lib/format';
import { Modal, Btn, Field, Input, Textarea, Select, Alert, Icon } from '../ui';
import { PROJECT_COLORS, PROJECT_ICONS, ProjectIcon } from './ProjectBits';
import { ColorPicker, IconPicker, MemberPicker } from './ProjectPickers';
import { TemplatePicker } from './TemplatePicker';
import { TemplateEditorModal } from './TemplateEditorModal';

function initialForm(project) {
  if (project) {
    return {
      name: project.name || '', description: project.description || '', startDate: project.startDate || '', dueDate: project.dueDate || '',
      color: project.color || PROJECT_COLORS[0], icon: project.icon || 'folder', status: project.status || 'ACTIVE', members: project.members || []
    };
  }
  const start = todayISO();
  return { name: '', description: '', startDate: start, dueDate: addDaysISO(start, 30), color: PROJECT_COLORS[0], icon: 'folder', status: 'ACTIVE', members: [] };
}

export function ProjectModal() {
  const { projectModal, setProjectModal } = useApp();
  if (!projectModal) return null;
  // Remount per opening so the form always starts from the right state.
  return <ProjectModalContent key={projectModal.project?.id || projectModal.templateId || 'new'} config={projectModal} onClose={() => setProjectModal(null)} />;
}

function ProjectModalContent({ config, onClose }) {
  const { currentWorkspaceId, members, can, confirm, toast, showError, upsertProject, reloadTasks, navigate } = useApp();
  const editing = Boolean(config.project);
  const [step, setStep] = useState(editing || config.templateId ? 'details' : 'template');
  const [templateId, setTemplateId] = useState(config.templateId || null);
  const [form, setForm] = useState(() => initialForm(config.project));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const set = patch => setForm(f => ({ ...f, ...patch }));

  const templatesState = useAsync(
    () => (editing ? Promise.resolve({ templates: [] }) : api.projects.templates(currentWorkspaceId)),
    [editing, currentWorkspaceId]
  );
  const templates = templatesState.data?.templates;
  const template = useMemo(() => templates?.find(t => t.id === templateId) || null, [templates, templateId]);

  // A template chosen before the details step also provides the default icon.
  useEffect(() => { if (!editing) setForm(f => ({ ...f, icon: template?.icon || 'folder' })); }, [template, editing]);

  const errors = {
    name: form.name.trim().length < 2 ? 'Informe um nome com pelo menos 2 caracteres' : null,
    dueDate: form.startDate && form.dueDate && form.dueDate < form.startDate ? 'O prazo deve ser igual ou posterior ao início' : null
  };
  const valid = !errors.name && !errors.dueDate;

  const deleteTemplate = async tpl => {
    const ok = await confirm({ title: `Excluir template "${tpl.name}"?`, message: 'Projetos já criados com ele não serão afetados.', confirmLabel: 'Excluir template', danger: true });
    if (!ok) return;
    try {
      await api.projects.deleteTemplate(tpl.id);
      templatesState.setData(d => ({ templates: d.templates.filter(t => t.id !== tpl.id) }));
      if (templateId === tpl.id) setTemplateId(null);
      toast('Template excluído', 'success');
    } catch (err) { showError(err); }
  };

  const submit = async e => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    setError(null);
    const base = { name: form.name.trim(), description: form.description.trim(), startDate: form.startDate || undefined, dueDate: form.dueDate || undefined, color: form.color, icon: form.icon };
    try {
      if (editing) {
        const res = await api.projects.update(config.project.id, { ...base, status: form.status, members: form.members });
        if (!res.project.archivedAt && res.project.workspaceId === currentWorkspaceId) upsertProject(res.project);
        config.onSaved?.(res.project);
        toast('Projeto atualizado', 'success');
        onClose();
      } else {
        const res = await api.projects.create(currentWorkspaceId, { ...base, templateId: templateId || undefined });
        upsertProject(res.project);
        if (template?.tasks?.length) reloadTasks();
        toast(`Projeto "${res.project.name}" criado`, 'success');
        onClose();
        navigate(`/projects/${res.project.id}/board`);
      }
    } catch (err) {
      if (err.status === 403) { showError(err); onClose(); } else setError(err);
    } finally {
      setSaving(false);
    }
  };

  const title = editing ? 'Configurações do projeto' : step === 'template' ? 'Novo projeto' : 'Detalhes do projeto';
  const description = editing ? config.project.name : step === 'template' ? 'Passo 1 de 2 · Escolha um template ou comece em branco' : 'Passo 2 de 2 · Defina nome, datas e identidade visual';

  const footer = step === 'template' ? (
    <>
      <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
      <Btn variant="primary" iconRight="arrow_forward" onClick={() => setStep('details')} disabled={templatesState.loading}>Continuar</Btn>
    </>
  ) : (
    <>
      {!editing && <Btn variant="ghost" icon="arrow_back" onClick={() => setStep('template')} className="mr-auto">Voltar</Btn>}
      <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
      <Btn variant="primary" type="submit" form="project-form" loading={saving} disabled={touched && !valid}>{editing ? 'Salvar alterações' : 'Criar projeto'}</Btn>
    </>
  );

  return (
    <>
      <Modal open={!editorOpen} onClose={onClose} size={step === 'template' ? 'xl' : 'lg'} title={title} description={description} footer={footer}>
        {step === 'template' ? (
          <TemplatePicker
            templates={templates}
            loading={templatesState.loading}
            error={templatesState.error}
            onRetry={templatesState.reload}
            selectedId={templateId}
            onSelect={setTemplateId}
            onDelete={deleteTemplate}
            onCreate={() => setEditorOpen(true)}
            canCreate={can('project.create')}
            canDelete={can('project.delete')}
          />
        ) : (
          <form id="project-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {error && <Alert tone="danger">{error.message}</Alert>}
            {!editing && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background-secondary border border-border text-[12px]">
                <Icon name={template?.icon || 'note_add'} size={16} className="text-text-muted" />
                <span className="text-text-secondary">Template:</span>
                <span className="text-text-primary font-medium truncate flex-1 min-w-0">{template?.name || (templateId && templatesState.loading ? 'Carregando…' : 'Projeto em branco')}</span>
                <button type="button" onClick={() => setStep('template')} className="text-blue-400 hover:underline flex-shrink-0">Trocar</button>
              </div>
            )}
            <div className="flex items-start gap-3">
              <ProjectIcon project={form} size={40} />
              <Field label="Nome" required error={touched ? errors.name : null} className="flex-1 min-w-0">
                <Input data-autofocus value={form.name} maxLength={100} onChange={e => set({ name: e.target.value })} placeholder="Ex.: Lançamento do app mobile" />
              </Field>
            </div>
            <Field label="Descrição">
              <Textarea value={form.description} maxLength={2000} onChange={e => set({ description: e.target.value })} placeholder="Objetivo, escopo e contexto do projeto" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Início"><Input type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} /></Field>
              <Field label="Prazo" error={errors.dueDate}><Input type="date" value={form.dueDate} min={form.startDate || undefined} onChange={e => set({ dueDate: e.target.value })} /></Field>
            </div>
            {editing && (
              <Field label="Status">
                <Select value={form.status} onChange={e => set({ status: e.target.value })}>
                  {Object.entries(PROJECT_STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Cor"><ColorPicker value={form.color} onChange={color => set({ color })} /></Field>
            <Field label="Ícone"><IconPicker icons={PROJECT_ICONS} value={form.icon} onChange={icon => set({ icon })} /></Field>
            {editing && (
              <Field label="Membros do projeto" hint="Apenas membros do workspace podem ser adicionados.">
                <MemberPicker members={members} value={form.members} onChange={ids => set({ members: ids })} />
              </Field>
            )}
          </form>
        )}
      </Modal>
      <TemplateEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onCreated={tpl => { templatesState.setData(d => ({ templates: [...(d?.templates || []), tpl] })); setTemplateId(tpl.id); }}
      />
    </>
  );
}
