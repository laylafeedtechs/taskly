import React, { useState } from 'react';
import { api } from '../../services/api';
import { useAsync, useDebounce } from '../../lib/hooks';
import { formatDateTime } from '../../lib/format';
import { AsyncBoundary, EmptyState, Field, Input, Pagination, Pill, SearchInput, Select } from '../ui';
import { TableWrap, Td, Th } from '../settings/common';

const SEVERITY = {
  info: { label: 'Info', className: 'text-blue-400 bg-blue-500/10 border-blue-500/25' },
  warn: { label: 'Alerta', className: 'text-amber-400 bg-amber-500/10 border-amber-500/25' },
  error: { label: 'Erro', className: 'text-red-400 bg-red-500/10 border-red-500/25' }
};

export function SeverityBadge({ severity }) {
  const meta = SEVERITY[severity] || SEVERITY.info;
  return <Pill className={meta.className}>{meta.label}</Pill>;
}

const RESULT = {
  SUCCESS: { label: 'Sucesso', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  FAILED: { label: 'Falha', className: 'text-red-400 bg-red-500/10 border-red-500/25' },
  BLOCKED: { label: 'Bloqueado', className: 'text-amber-400 bg-amber-500/10 border-amber-500/25' }
};
const resultMeta = r => RESULT[Object.keys(RESULT).find(k => String(r).startsWith(k))] || { label: r };

const CATEGORIES = {
  auth: 'Autenticação', security: 'Segurança', permissions: 'Permissões', admin: 'Administração', users: 'Usuários',
  workspace: 'Workspace', projects: 'Projetos', tasks: 'Tarefas', files: 'Arquivos', automations: 'Automações',
  api: 'API', webhooks: 'Webhooks', reports: 'Relatórios', general: 'Geral'
};

function usePagedFilters(initial) {
  const [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1);
  const update = patch => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  return { filters, update, page, setPage };
}

function Results({ state, onPage, items, emptyTitle, minWidth, head, children }) {
  const { data, loading, error, reload } = state;
  return (
    <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!items.length}
      emptyState={<EmptyState icon="manage_search" title={emptyTitle} description="Ajuste os filtros para ver outros registros." />}>
      <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
        <TableWrap minWidth={minWidth}>
          <thead><tr>{head.map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>{children}</tbody>
        </TableWrap>
        <p className="text-[11px] text-text-muted mt-2">{data?.total ?? 0} registro(s)</p>
        <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={onPage} />
      </div>
    </AsyncBoundary>
  );
}

export function SystemEvents() {
  const { filters, update, page, setPage } = usePagedFilters({ severity: 'ALL', type: '' });
  const type = useDebounce(filters.type.trim(), 300);
  const state = useAsync(() => api.admin.systemEvents({ severity: filters.severity, type, page, limit: 50 }), [filters.severity, type, page]);
  const events = state.data?.events || [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3 max-w-2xl">
        <Field label="Severidade">
          <Select value={filters.severity} onChange={e => update({ severity: e.target.value })}>
            <option value="ALL">Todas</option>
            {Object.entries(SEVERITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Tipo (prefixo)">
          <Input value={filters.type} onChange={e => update({ type: e.target.value })} placeholder="ex.: auth, webhook, automation" />
        </Field>
      </div>
      <Results state={state} onPage={setPage} items={events} emptyTitle="Nenhum evento encontrado" minWidth={820} head={['Data', 'Severidade', 'Tipo', 'Mensagem', 'Contexto']}>
        {events.map(e => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap font-mono text-[11px]">{formatDateTime(e.createdAt)}</Td>
            <Td><SeverityBadge severity={e.severity} /></Td>
            <Td><code className="font-mono text-[11px]">{e.type}</code></Td>
            <Td className="text-text-primary">{e.message}</Td>
            <Td className="max-w-[280px]">
              {e.context && Object.keys(e.context).length
                ? <code className="block font-mono text-[10px] text-text-muted truncate" title={JSON.stringify(e.context, null, 2)}>{JSON.stringify(e.context)}</code>
                : <span className="text-text-muted">—</span>}
            </Td>
          </tr>
        ))}
      </Results>
    </div>
  );
}

export function AuditLogs() {
  const { filters, update, page, setPage } = usePagedFilters({ q: '', category: 'ALL', result: 'ALL', from: '', to: '' });
  const q = useDebounce(filters.q, 300);
  const state = useAsync(
    () => api.admin.auditLogs({ q, category: filters.category, result: filters.result, from: filters.from, to: filters.to, page, limit: 50 }),
    [q, filters.category, filters.result, filters.from, filters.to, page]
  );
  const logs = state.data?.auditLogs || [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr] gap-3 items-end">
        <Field label="Buscar"><SearchInput value={filters.q} onChange={v => update({ q: v })} placeholder="Ator, ação, entidade ou IP…" /></Field>
        <Field label="Categoria">
          <Select value={filters.category} onChange={e => update({ category: e.target.value })}>
            <option value="ALL">Todas</option>
            {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Resultado">
          <Select value={filters.result} onChange={e => update({ result: e.target.value })}>
            <option value="ALL">Todos</option>
            {Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="De"><Input type="date" value={filters.from} max={filters.to || undefined} onChange={e => update({ from: e.target.value })} /></Field>
        <Field label="Até"><Input type="date" value={filters.to} min={filters.from || undefined} onChange={e => update({ to: e.target.value })} /></Field>
      </div>
      <Results state={state} onPage={setPage} items={logs} emptyTitle="Nenhum registro de auditoria" minWidth={1100} head={['Ator', 'Ação', 'Entidade', 'Resultado', 'IP', 'Dispositivo', 'Data']}>
        {logs.map(l => {
          const r = resultMeta(l.result);
          return (
            <tr key={l.id}>
              <Td className="text-text-primary max-w-[220px]"><span className="block truncate" title={l.actor}>{l.actor}</span></Td>
              <Td>
                <code className="font-mono text-[11px] text-text-primary">{l.action}</code>
                {l.category && <div className="text-[10px] text-text-muted">{CATEGORIES[l.category] || l.category}</div>}
              </Td>
              <Td className="max-w-[260px]"><span className="block truncate" title={l.entity}>{l.entity}</span></Td>
              <Td><Pill className={r.className}>{r.label}</Pill></Td>
              <Td className="font-mono text-[11px] whitespace-nowrap">{l.ip || '—'}</Td>
              <Td className="max-w-[200px]"><span className="block truncate text-[11px]" title={l.device}>{l.device || '—'}</span></Td>
              <Td className="whitespace-nowrap font-mono text-[11px]">{formatDateTime(l.timestamp)}</Td>
            </tr>
          );
        })}
      </Results>
    </div>
  );
}
