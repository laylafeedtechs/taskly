import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Modal, Btn, Field, Input, Toggle, Alert } from '../ui';

const OPTIONS = [
  { key: 'copyTasks', label: 'Tarefas', description: 'Tarefas ativas com dependências, subtarefas e checklists' },
  { key: 'copyColumns', label: 'Colunas', description: 'Estrutura do quadro e limites WIP' },
  { key: 'copyTags', label: 'Tags', description: 'Tags do projeto e das tarefas' },
  { key: 'copyAutomations', label: 'Automações', description: 'Regras de automação vinculadas ao projeto' },
  { key: 'copyMilestones', label: 'Marcos', description: 'Marcos com as mesmas datas, reiniciados como planejados' },
  { key: 'copyMembers', label: 'Membros', description: 'Membros do projeto e responsáveis das tarefas' }
];
const DEFAULTS = { copyTasks: true, copyColumns: true, copyTags: true, copyAutomations: true, copyMilestones: true, copyMembers: false };

// Opened with a project; closes itself by calling onClose.
export function DuplicateProjectModal({ project, onClose }) {
  const { upsertProject, reloadTasks, toast, navigate, showError } = useApp();
  const [name, setName] = useState(() => `${project.name} (cópia)`);
  const [options, setOptions] = useState(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const valid = name.trim().length >= 2;

  const submit = async e => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.projects.duplicate(project.id, { name: name.trim(), ...options });
      upsertProject(res.project);
      if (options.copyTasks) reloadTasks();
      toast(`Projeto "${res.project.name}" criado`, 'success', { label: 'Abrir', onClick: () => navigate(`/projects/${res.project.id}/overview`) });
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
      title="Duplicar projeto"
      description={`Crie uma cópia de "${project.name}" escolhendo o que levar.`}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" type="submit" form="duplicate-project" icon="content_copy" loading={saving} disabled={!valid}>Duplicar</Btn>
      </>}
    >
      <form id="duplicate-project" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Field label="Nome da cópia" required error={valid ? null : 'Use pelo menos 2 caracteres'}>
          <Input data-autofocus value={name} maxLength={100} onChange={e => setName(e.target.value)} />
        </Field>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-background-secondary p-3">
          <legend className="px-1 text-[12px] font-medium text-text-secondary">Copiar</legend>
          {OPTIONS.map(o => (
            <Toggle key={o.key} label={o.label} description={o.description} checked={options[o.key]} onChange={v => setOptions(s => ({ ...s, [o.key]: v }))} />
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}
