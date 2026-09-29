import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Modal, Btn, Field, Input, Toggle, Alert } from '../ui';

export function SaveTemplateModal({ project, onClose }) {
  const { toast, showError, setProjectModal } = useApp();
  const [name, setName] = useState(() => `${project.name} (template)`.slice(0, 80));
  const [includeTasks, setIncludeTasks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const valid = name.trim().length >= 2;

  const submit = async e => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.projects.saveAsTemplate(project.id, { name: name.trim(), includeTasks });
      toast(`Template "${res.template.name}" salvo`, 'success', { label: 'Usar agora', onClick: () => setProjectModal({ templateId: res.template.id }) });
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
      title="Salvar como template"
      description="Colunas, tags e marcos do projeto viram um template reutilizável neste workspace."
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="primary" type="submit" form="save-template" icon="bookmark_add" loading={saving} disabled={!valid}>Salvar template</Btn>
      </>}
    >
      <form id="save-template" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Field label="Nome do template" required error={valid ? null : 'Use pelo menos 2 caracteres'}>
          <Input data-autofocus value={name} maxLength={80} onChange={e => setName(e.target.value)} />
        </Field>
        <Toggle label="Incluir tarefas" description="Salva até 50 tarefas atuais (título, tipo e prioridade) como tarefas padrão." checked={includeTasks} onChange={setIncludeTasks} />
      </form>
    </Modal>
  );
}
