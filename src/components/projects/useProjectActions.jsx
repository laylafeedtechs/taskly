import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { DuplicateProjectModal } from './DuplicateProjectModal';
import { SaveTemplateModal } from './SaveTemplateModal';

// Shared project actions (card menus and the project header). `onChange`
// receives the updated project after archive/unarchive/edit so callers
// holding their own copy (archived lists, detail view) stay in sync.
export function useProjectActions({ onChange, onDeleted } = {}) {
  const { can, navigate, toast, showError, setProjects, upsertProject, reloadFavorites, toggleFavorite, deleteProject, setProjectModal } = useApp();
  const [dialog, setDialog] = useState(null);

  const archive = async (project, archived) => {
    try {
      const res = await api.projects.archive(project.id, archived);
      if (archived) setProjects(prev => prev.filter(p => p.id !== project.id));
      else upsertProject(res.project);
      reloadFavorites();
      onChange?.(res.project);
      toast(archived ? `"${project.name}" arquivado` : `"${project.name}" desarquivado`, archived ? 'info' : 'success',
        archived ? { label: 'Desfazer', onClick: () => archive(res.project, false) } : null);
    } catch (err) { showError(err); }
  };

  const remove = async project => {
    if (await deleteProject(project)) onDeleted?.(project);
  };

  const menuItems = (project, { includeOpen = true } = {}) => {
    const archived = Boolean(project.archivedAt);
    return [
      includeOpen && { label: 'Abrir', icon: 'open_in_new', onClick: () => navigate(`/projects/${project.id}/overview`) },
      can('project.edit') && { label: 'Editar', icon: 'edit', onClick: () => setProjectModal({ project, onSaved: onChange }) },
      !archived && { label: project.isFavorite ? 'Remover dos favoritos' : 'Favoritar', icon: 'star', onClick: () => toggleFavorite(project) },
      can('project.create') && '-',
      can('project.create') && { label: 'Duplicar', icon: 'content_copy', onClick: () => setDialog({ kind: 'duplicate', project }) },
      can('project.create') && { label: 'Salvar como template', icon: 'bookmark_add', onClick: () => setDialog({ kind: 'template', project }) },
      can('project.delete') && '-',
      can('project.delete') && { label: archived ? 'Desarquivar' : 'Arquivar', icon: archived ? 'unarchive' : 'archive', onClick: () => archive(project, !archived) },
      can('project.delete') && { label: 'Excluir', icon: 'delete', danger: true, onClick: () => remove(project) }
    ];
  };

  const close = () => setDialog(null);
  const dialogs = dialog && (dialog.kind === 'duplicate'
    ? <DuplicateProjectModal project={dialog.project} onClose={close} />
    : <SaveTemplateModal project={dialog.project} onClose={close} />);

  return { menuItems, archive, dialogs };
}
