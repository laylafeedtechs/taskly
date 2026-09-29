import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { PriorityBadge, StatusBadge } from '../common/Badge';
import { Alert, AsyncBoundary, Btn, EmptyState, Icon, PageHeader, SearchInput, Tabs } from '../ui';
import { TableWrap, Td, Th } from '../settings/common';

const TABS = [
  { id: 'tasks', type: 'task', label: 'Tarefas', singular: 'Tarefa', icon: 'check_box', empty: 'Nenhuma tarefa na lixeira.' },
  { id: 'projects', type: 'project', label: 'Projetos', singular: 'Projeto', icon: 'folder', empty: 'Nenhum projeto na lixeira.' },
  { id: 'files', type: 'file', label: 'Arquivos', singular: 'Arquivo', icon: 'description', empty: 'Nenhum arquivo na lixeira.' }
];

const itemName = item => item.title || item.name;

export function TrashView() {
  const { currentWorkspaceId, projects, can, confirm, toast, showError, reloadTasks, reloadProjects, reloadFavorites } = useApp();
  const [tab, setTab] = useState('tasks');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(null);
  const { data, loading, error, reload, setData } = useAsync(() => api.trash.list(currentWorkspaceId), [currentWorkspaceId]);
  const canPurge = can('trash.purge');
  const current = TABS.find(t => t.id === tab);

  // Deleted projects are excluded from the context list, so resolve names from the trash too.
  const projectName = useMemo(() => {
    const map = Object.fromEntries([...(data?.projects || []), ...projects].map(p => [p.id, p.name]));
    return id => map[id] || '—';
  }, [data, projects]);

  const items = useMemo(() => {
    const list = data?.[tab] || [];
    const q = search.trim().toLowerCase();
    const filtered = q ? list.filter(i => `${itemName(i)} ${i.id} ${i.deletedBy || ''}`.toLowerCase().includes(q)) : list;
    return [...filtered].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  }, [data, tab, search]);

  const drop = (key, id) => setData(d => ({ ...d, [key]: d[key].filter(i => i.id !== id) }));

  const restore = async item => {
    setBusy(item.id);
    try {
      await api.trash.restore(current.type, item.id);
      drop(tab, item.id);
      if (current.type === 'task') reload(); // subtasks deleted with the task come back too
      if (current.type === 'project') { reloadProjects(); reloadFavorites(); }
      if (current.type !== 'file') reloadTasks();
      toast(`"${itemName(item)}" restaurado`, 'success');
    } catch (err) { showError(err); } finally { setBusy(null); }
  };

  const purge = async item => {
    const ok = await confirm({
      title: `Excluir "${itemName(item)}" permanentemente?`,
      message: current.type === 'project'
        ? 'O projeto, suas tarefas, colunas, marcos, arquivos e automações serão apagados para sempre. Esta ação não pode ser desfeita.'
        : 'Este item será apagado para sempre. Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir permanentemente',
      danger: true,
      requireText: 'EXCLUIR'
    });
    if (!ok) return;
    setBusy(item.id);
    try {
      await api.trash.purge(current.type, item.id);
      drop(tab, item.id);
      if (current.type !== 'file') reload(); // subtasks and project tasks go with it
      toast(`"${itemName(item)}" excluído permanentemente`, 'success');
    } catch (err) { showError(err); } finally { setBusy(null); }
  };

  const tabs = TABS.map(t => ({ ...t, count: data ? data[t.id].length : undefined }));

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader icon="delete" title="Lixeira" description="Itens excluídos podem ser restaurados. A exclusão permanente não pode ser desfeita." />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar na lixeira…" className="sm:w-72" />
      </div>
      {!canPurge && <div className="mb-4"><Alert>Você pode restaurar itens, mas apenas gestores e proprietários podem excluí-los permanentemente.</Alert></div>}

      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!items.length}
        emptyState={<EmptyState icon={search ? 'search_off' : 'delete'} title={search ? 'Nada encontrado' : 'Lixeira vazia'} description={search ? 'Nenhum item corresponde à busca.' : current.empty} />}>
        <TableWrap minWidth={760}>
          <thead>
            <tr>
              <Th>{current.singular}</Th>
              {tab === 'tasks' && <><Th>Projeto</Th><Th>Status</Th><Th>Prioridade</Th></>}
              {tab === 'projects' && <Th>Tarefas</Th>}
              {tab === 'files' && <><Th>Projeto</Th><Th>Tamanho</Th></>}
              <Th>Excluído</Th><Th>Excluído por</Th><Th className="text-right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} className="hover:bg-surface-hover/50">
                <Td>
                  <div className="flex items-center gap-2 min-w-0">
                    {tab === 'projects'
                      ? <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} aria-hidden="true" />
                      : <Icon name={current.icon} size={15} className="text-text-muted flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-text-primary font-medium truncate">{itemName(item)}</div>
                      {tab === 'tasks' && <div className="font-mono text-[10px] text-text-muted">{item.id}</div>}
                    </div>
                  </div>
                </Td>
                {tab === 'tasks' && <><Td>{projectName(item.projectId)}</Td><Td><StatusBadge status={item.status} /></Td><Td><PriorityBadge priority={item.priority} /></Td></>}
                {tab === 'projects' && <Td>{item.taskCount}</Td>}
                {tab === 'files' && <><Td>{projectName(item.projectId)}</Td><Td className="font-mono">{item.formattedSize}</Td></>}
                <Td className="whitespace-nowrap" title={formatDateTime(item.deletedAt)}>{timeAgo(item.deletedAt)}</Td>
                <Td>{item.deletedBy || '—'}</Td>
                <Td className="text-right whitespace-nowrap">
                  <div className="inline-flex gap-1.5">
                    <Btn size="xs" icon="restore_from_trash" loading={busy === item.id} disabled={Boolean(busy)} onClick={() => restore(item)}>Restaurar</Btn>
                    {canPurge && <Btn size="xs" variant="danger" icon="delete_forever" disabled={Boolean(busy)} onClick={() => purge(item)}>Excluir</Btn>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </AsyncBoundary>
    </div>
  );
}
