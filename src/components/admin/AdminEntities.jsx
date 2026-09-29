import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { PROJECT_STATUS_LABEL, formatDate } from '../../lib/format';
import { HealthBadge } from '../common/Badge';
import { AsyncBoundary, Btn, EmptyState, Pill, ProgressBar, SearchInput, Segmented } from '../ui';
import { TableWrap, Td, Th } from '../settings/common';

const WS_FIELDS = ['name', 'owner'];
const PROJECT_FIELDS = ['name', 'workspaceName'];

const useSearch = (list, fields) => {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? list.filter(item => fields.some(f => String(item[f] || '').toLowerCase().includes(s))) : list;
  }, [list, q, fields]);
  return [q, setQ, filtered];
};

export function AdminWorkspaces() {
  const { confirm, toast, showError, reloadWorkspaces } = useApp();
  const { data, loading, error, reload, setData } = useAsync(() => api.admin.workspaces(), []);
  const [show, setShow] = useState('active');
  const [busy, setBusy] = useState(null);
  const all = data?.workspaces || [];
  const scoped = useMemo(() => all.filter(w => (show === 'archived' ? w.archivedAt : show === 'active' ? !w.archivedAt : true)), [all, show]);
  const [q, setQ, list] = useSearch(scoped, WS_FIELDS);

  const toggle = async w => {
    const archive = !w.archivedAt;
    const ok = await confirm({
      title: archive ? `Arquivar "${w.name}"?` : `Desarquivar "${w.name}"?`,
      message: archive ? `Os ${w.memberCount} membro(s) perderão o acesso até o workspace ser desarquivado.` : 'Os membros voltarão a ter acesso ao workspace.',
      confirmLabel: archive ? 'Arquivar' : 'Desarquivar',
      danger: archive
    });
    if (!ok) return;
    setBusy(w.id);
    try {
      await api.admin.archiveWorkspace(w.id, archive);
      setData(d => ({ ...d, workspaces: d.workspaces.map(x => (x.id === w.id ? { ...x, archivedAt: archive ? new Date().toISOString() : null } : x)) }));
      toast(archive ? 'Workspace arquivado' : 'Workspace desarquivado', 'success');
      reloadWorkspaces().catch(() => {});
    } catch (err) { showError(err); } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nome ou proprietário…" className="sm:w-80" />
        <Segmented label="Situação" value={show} onChange={setShow} options={[{ value: 'active', label: 'Ativos' }, { value: 'archived', label: 'Arquivados' }, { value: 'all', label: 'Todos' }]} />
      </div>
      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!list.length}
        emptyState={<EmptyState icon="business" title="Nenhum workspace encontrado" />}>
        <TableWrap minWidth={820}>
          <thead><tr><Th>Workspace</Th><Th>Proprietário</Th><Th>Membros</Th><Th>Projetos</Th><Th>Tarefas</Th><Th>Criado</Th><Th>Situação</Th><Th className="text-right">Ações</Th></tr></thead>
          <tbody>
            {list.map(w => (
              <tr key={w.id} className="hover:bg-surface-hover/50">
                <Td>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: w.color }} aria-hidden="true" />
                    <span className="text-text-primary font-medium truncate">{w.name}</span>
                  </div>
                </Td>
                <Td>{w.owner}</Td>
                <Td>{w.memberCount}</Td>
                <Td>{w.projectCount}</Td>
                <Td>{w.taskCount}</Td>
                <Td className="whitespace-nowrap">{formatDate(w.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                <Td>{w.archivedAt ? <Pill className="text-amber-400 bg-amber-500/10 border-amber-500/25">Arquivado</Pill> : <Pill className="text-emerald-400 bg-emerald-500/10 border-emerald-500/25">Ativo</Pill>}</Td>
                <Td className="text-right">
                  <Btn size="xs" variant={w.archivedAt ? 'secondary' : 'ghost'} icon={w.archivedAt ? 'unarchive' : 'archive'} loading={busy === w.id} onClick={() => toggle(w)}>
                    {w.archivedAt ? 'Desarquivar' : 'Arquivar'}
                  </Btn>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </AsyncBoundary>
    </div>
  );
}

const HEALTH_FILTERS = [{ value: 'ALL', label: 'Todos' }, { value: 'Healthy', label: 'Saudáveis' }, { value: 'At Risk', label: 'Em risco' }, { value: 'Critical', label: 'Críticos' }];

export function AdminProjects() {
  const { data, loading, error, reload } = useAsync(() => api.admin.projects(), []);
  const [health, setHealth] = useState('ALL');
  const all = data?.projects || [];
  const scoped = useMemo(() => (health === 'ALL' ? all : all.filter(p => p.health === health)), [all, health]);
  const [q, setQ, list] = useSearch(scoped, PROJECT_FIELDS);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por projeto ou workspace…" className="sm:w-80" />
        <Segmented label="Saúde" value={health} onChange={setHealth} options={HEALTH_FILTERS} />
      </div>
      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!list.length}
        emptyState={<EmptyState icon="folder" title="Nenhum projeto encontrado" />}>
        <TableWrap minWidth={900}>
          <thead><tr><Th>Projeto</Th><Th>Workspace</Th><Th>Status</Th><Th>Saúde</Th><Th>Progresso</Th><Th>Tarefas</Th><Th>Atrasadas</Th><Th>Prazo</Th></tr></thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id} className="hover:bg-surface-hover/50">
                <Td className="text-text-primary font-medium">{p.name}{p.archivedAt && <span className="ml-2"><Pill>Arquivado</Pill></span>}</Td>
                <Td>{p.workspaceName || '—'}</Td>
                <Td>{PROJECT_STATUS_LABEL[p.status] || p.status || '—'}</Td>
                <Td><HealthBadge health={p.health} reasons={p.healthReasons} /></Td>
                <Td className="w-40">
                  <div className="flex items-center gap-2"><ProgressBar value={p.progress} className="flex-1" /><span className="font-mono text-[11px] w-9 text-right">{p.progress}%</span></div>
                </Td>
                <Td>{p.completedTasks}/{p.totalTasks}</Td>
                <Td className={p.overdueTasks ? 'text-red-400 font-medium' : ''}>{p.overdueTasks}</Td>
                <Td className="whitespace-nowrap">{p.dueDate ? formatDate(p.dueDate, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </AsyncBoundary>
    </div>
  );
}
