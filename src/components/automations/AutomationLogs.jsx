import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useDebounce } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import { AsyncBoundary, EmptyState, Field, Input, Pagination, SearchInput, Segmented, Select } from '../ui';
import { ResultBadge, TableWrap, Td, Th } from '../settings/common';

const STATUS_OPTIONS = [{ value: 'ALL', label: 'Todos' }, { value: 'SUCCESS', label: 'Sucesso' }, { value: 'FAILURE', label: 'Falha' }];

export function AutomationLogs({ automations, humanize }) {
  const { currentWorkspaceId, openTask } = useApp();
  const [filters, setFilters] = useState({ status: 'ALL', automationId: 'ALL', from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const q = useDebounce(filters.q, 300);
  const { data, loading, error, reload } = useAsync(
    () => api.automations.logs(currentWorkspaceId, { page, limit: 20, status: filters.status, automationId: filters.automationId, from: filters.from, to: filters.to, q }),
    [currentWorkspaceId, page, filters.status, filters.automationId, filters.from, filters.to, q]
  );
  const update = patch => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const filtered = filters.status !== 'ALL' || filters.automationId !== 'ALL' || filters.from || filters.to || filters.q;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[auto_1fr_1fr_1fr_1.5fr] gap-3 items-end">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-text-secondary">Resultado</span>
          <Segmented label="Resultado" options={STATUS_OPTIONS} value={filters.status} onChange={status => update({ status })} />
        </div>
        <Field label="Automação">
          <Select value={filters.automationId} onChange={e => update({ automationId: e.target.value })}>
            <option value="ALL">Todas</option>
            {automations.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </Select>
        </Field>
        <Field label="De"><Input type="date" value={filters.from} max={filters.to || undefined} onChange={e => update({ from: e.target.value })} /></Field>
        <Field label="Até"><Input type="date" value={filters.to} min={filters.from || undefined} onChange={e => update({ to: e.target.value })} /></Field>
        <Field label="Buscar"><SearchInput value={filters.q} onChange={v => update({ q: v })} placeholder="Tarefa, automação, erro…" /></Field>
      </div>

      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!data?.logs?.length}
        emptyState={<EmptyState icon="history" title={filtered ? 'Nenhum log encontrado' : 'Nenhuma execução ainda'} description={filtered ? 'Ajuste os filtros para ver outras execuções.' : 'As execuções das automações aparecerão aqui.'} />}>
        <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
          <TableWrap minWidth={1000}>
            <thead>
              <tr><Th>Data</Th><Th>Automação</Th><Th>Gatilho</Th><Th>Condições</Th><Th>Ação</Th><Th>Resultado</Th><Th>Erro</Th><Th>Tarefa</Th></tr>
            </thead>
            <tbody>
              {data?.logs.map(log => (
                <tr key={log.id} className="hover:bg-surface-hover/50">
                  <Td className="whitespace-nowrap font-mono text-[11px]">{formatDateTime(log.timestamp)}</Td>
                  <Td className="text-text-primary font-medium">{log.automationTitle}</Td>
                  <Td>{log.trigger}</Td>
                  <Td>{humanize(log.condition)}</Td>
                  <Td>
                    <div>{humanize(log.action)}</div>
                    {log.result && <div className="text-[11px] text-text-muted mt-0.5">{log.result}</div>}
                  </Td>
                  <Td><ResultBadge success={log.status === 'SUCCESS'} /></Td>
                  <Td className="text-red-400 max-w-[220px]">{log.error || <span className="text-text-muted">—</span>}</Td>
                  <Td>
                    {log.taskId
                      ? <button type="button" onClick={() => openTask(log.taskId)} className="font-mono text-[11px] text-blue-400 hover:underline">{log.taskId}</button>
                      : <span className="text-text-muted">—</span>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={setPage} />
        </div>
      </AsyncBoundary>
    </div>
  );
}
