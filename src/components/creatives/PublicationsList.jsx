// Publications in grid or list ("modo Conteúdo"), with filters, search, sort,
// multi-select and bulk actions. Presets turn it into Rascunhos, Publicados
// and the approval queues.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useDebounce, useLocalStorage } from '../../lib/hooks';
import { Btn, Icon, Select, SearchInput, Segmented, Checkbox, Pagination, EmptyState, ErrorState, Skeleton, Modal, Field, Textarea, Avatar } from '../ui';
import { useCreatives, StatusBadge, TypeIcon, PublicationThumb, STATUS_META, TYPE_META, formatWhen, effectiveDate } from './shared';

const SORTS = [
  { value: 'updated', label: 'Última edição' }, { value: 'date', label: 'Data (mais próxima)' }, { value: '-date', label: 'Data (mais recente)' },
  { value: 'title', label: 'Título' }, { value: 'status', label: 'Status' }
];

function BulkBar({ selected, onDone, onClear }) {
  const { currentWorkspaceId, confirm, toast, showError, members } = useApp();
  const { perms, campaigns } = useCreatives();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState({ campaign: '', responsible: '' });
  const ids = [...selected];

  const run = async (action, extra = {}, { ask } = {}) => {
    if (ask && !(await confirm(ask))) return;
    try {
      const res = await api.publications.bulk(currentWorkspaceId, { action, ids, confirm: true, ...extra });
      const failed = res.results.filter(r => !r.ok);
      toast(`${res.count} publicação(ões) atualizada(s)${failed.length ? ` · ${failed.length} ignorada(s): ${failed[0].error}` : ''}`, failed.length ? 'warning' : 'success');
      onDone();
    } catch (err) { showError(err); }
  };

  return (
    <div className="sticky bottom-4 z-20 mx-auto w-fit max-w-full flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border shadow-modal animate-slideUp">
      <span className="text-[12px] text-text-secondary px-1">{ids.length} selecionada(s)</span>
      {perms.approve && <Btn size="xs" variant="accent" icon="check" onClick={() => run('APPROVE', {}, { ask: { title: `Aprovar ${ids.length} publicação(ões)?`, message: 'Só as que estão aguardando aprovação serão aprovadas. A ação fica registrada na auditoria.', confirmLabel: 'Aprovar' } })}>Aprovar</Btn>}
      {perms.approve && <Btn size="xs" variant="danger" onClick={() => { setReason(''); setRejecting(true); }}>Rejeitar</Btn>}
      {perms.edit && (
        <Select aria-label="Mover para campanha" className="!h-7 !w-auto text-[12px]" value={target.campaign} onChange={e => { const value = e.target.value; setTarget(t => ({ ...t, campaign: '' })); if (value) run('MOVE_CAMPAIGN', { value: value === 'none' ? null : value }); }}>
          <option value="">Mover para campanha…</option><option value="none">Sem campanha</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      {perms.edit && (
        <Select aria-label="Alterar responsável" className="!h-7 !w-auto text-[12px]" value={target.responsible} onChange={e => { const value = e.target.value; setTarget(t => ({ ...t, responsible: '' })); if (value) run('SET_RESPONSIBLE', { value: value === 'none' ? null : value }); }}>
          <option value="">Alterar responsável…</option><option value="none">Sem responsável</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      )}
      {perms.remove && <Btn size="xs" variant="danger" icon="delete" onClick={() => run('DELETE', {}, { ask: { title: `Excluir ${ids.length} publicação(ões)?`, message: 'Publicações agendadas precisam ser canceladas antes e serão ignoradas. Posts já no Instagram continuam lá.', confirmLabel: 'Excluir', danger: true } })}>Excluir</Btn>}
      <Btn size="xs" variant="ghost" onClick={onClear}>Limpar</Btn>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title={`Rejeitar ${ids.length} publicação(ões)`}
        footer={<><Btn onClick={() => setRejecting(false)}>Cancelar</Btn><Btn variant="danger" disabled={reason.trim().length < 3} onClick={async () => { setRejecting(false); await run('REJECT', { reason: reason.trim() }, { ask: { title: 'Confirmar rejeição em lote?', message: `Motivo: "${reason.trim()}"`, confirmLabel: 'Rejeitar', danger: true } }); }}>Rejeitar</Btn></>}>
        <Field label="Motivo (enviado a quem criou)" required><Textarea data-autofocus value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></Field>
      </Modal>
    </div>
  );
}

function Card({ pub, selected, onToggle, onOpen, campaign, selectable, showExternal }) {
  return (
    <div className={`group relative rounded-xl overflow-hidden border bg-surface-card transition-colors ${selected ? 'border-blue-400 ring-1 ring-blue-400/40' : 'border-border hover:border-border-focus'}`}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <PublicationThumb publication={pub} className="aspect-[4/5]" />
        <div className="p-2.5 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={pub.status} compact />
            <span className="text-[10px] font-mono text-text-muted">{formatWhen(effectiveDate(pub))}</span>
          </div>
          <div className="text-[12px] font-medium text-text-primary truncate">{pub.title}</div>
          {campaign && <div className="flex items-center gap-1 text-[10px] text-text-muted truncate"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: campaign.color }} />{campaign.name}</div>}
          {pub.status === 'FAILED' && <div className="text-[10px] text-red-300 line-clamp-2">{pub.error?.message}</div>}
          {pub.status === 'PENDING_APPROVAL' && <div className="text-[10px] text-amber-300">Aguardando quem aprova</div>}
          {showExternal && pub.permalink && <span className="text-[10px] text-sky-300 truncate">{pub.externalId}</span>}
        </div>
      </button>
      {selectable && <span className="absolute top-2 left-2"><Checkbox checked={selected} onChange={onToggle} label={`Selecionar ${pub.title}`} /></span>}
    </div>
  );
}

export function PublicationsList({ account, preset = {}, showExternal = false, emptyTitle, emptyDescription, allowedViews = ['grid', 'list'] }) {
  const { currentWorkspaceId, members, projects } = useApp();
  const { dataVersion, bump, openPublication, newPublication, campaigns, perms, accounts } = useCreatives();
  const [view, setView] = useLocalStorage('taskly.creatives.listView', 'grid');
  const [filters, setFilters] = useState({ q: '', status: '', type: '', campaignId: '', responsibleId: '', projectId: '', sort: preset.sort || 'updated', page: 1 });
  const q = useDebounce(filters.q, 250);
  const [selected, setSelected] = useState(new Set());
  const query = {
    accountId: account?.id, q, type: filters.type || undefined, campaignId: preset.campaignId || filters.campaignId || undefined, responsibleId: filters.responsibleId || undefined,
    projectId: filters.projectId || undefined, sort: filters.sort, page: filters.page, limit: 48,
    status: preset.status || filters.status || 'DRAFT,PENDING_APPROVAL,APPROVED,SCHEDULED,PUBLISHING,PUBLISHED,FAILED', approval: preset.approval
  };
  const { data, loading, error, reload } = useAsync(() => api.publications.list(currentWorkspaceId, query), [currentWorkspaceId, JSON.stringify(query), dataVersion]);
  useEffect(() => setSelected(new Set()), [JSON.stringify(query)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pubs = data?.publications || [];
  const campaignById = useMemo(() => Object.fromEntries(campaigns.map(c => [c.id, c])), [campaigns]);
  const accountById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);
  const memberById = useMemo(() => Object.fromEntries(members.map(m => [m.id, m])), [members]);
  const selectable = perms.edit || perms.approve || perms.remove;
  const toggle = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const activeView = allowedViews.includes(view) ? view : allowedViews[0];
  const filtered = filters.q || filters.status || filters.type || filters.campaignId || filters.responsibleId || filters.projectId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={filters.q} onChange={qq => setFilters(f => ({ ...f, q: qq, page: 1 }))} placeholder="Buscar título, legenda ou hashtag…" className="w-full sm:w-72" />
        {!preset.status && <Select aria-label="Status" className="!w-auto" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}><option value="">Todos os status</option>{Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Select>}
        <Select aria-label="Tipo" className="!w-auto" value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value, page: 1 }))}><option value="">Todos os tipos</option>{Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Select>
        <Select aria-label="Campanha" className="!w-auto" value={filters.campaignId} onChange={e => setFilters(f => ({ ...f, campaignId: e.target.value, page: 1 }))}><option value="">Todas as campanhas</option><option value="none">Sem campanha</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select aria-label="Responsável" className="!w-auto" value={filters.responsibleId} onChange={e => setFilters(f => ({ ...f, responsibleId: e.target.value, page: 1 }))}><option value="">Qualquer responsável</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        <Select aria-label="Projeto" className="!w-auto" value={filters.projectId} onChange={e => setFilters(f => ({ ...f, projectId: e.target.value, page: 1 }))}><option value="">Todos os projetos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select aria-label="Ordenar" className="!w-auto" value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))}>{SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        <span className="ml-auto flex items-center gap-2">
          {allowedViews.length > 1 && <Segmented label="Visualização" value={activeView} onChange={setView} options={[{ value: 'grid', label: 'Grade', icon: 'grid_view', showLabel: false }, { value: 'list', label: 'Lista', icon: 'view_list', showLabel: false }]} />}
          {perms.create && account && <Btn size="sm" icon="add" onClick={() => newPublication({ socialAccountId: account.id })}>Nova publicação</Btn>}
        </span>
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-[4/6] rounded-xl" />)}</div>
      ) : !pubs.length ? (
        <EmptyState icon="photo_library" title={filtered ? 'Nenhuma publicação com esses filtros' : emptyTitle || 'Nenhuma publicação ainda'}
          description={filtered ? 'Ajuste ou limpe os filtros.' : emptyDescription || 'Comece planejando a primeira publicação.'}
          action={!filtered && perms.create && account ? <Btn variant="primary" icon="add" onClick={() => newPublication({ socialAccountId: account.id })}>Nova publicação</Btn> : null} />
      ) : activeView === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {pubs.map(p => <Card key={p.id} pub={p} selectable={selectable} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} onOpen={() => openPublication(p.id)} campaign={campaignById[p.campaignId]} showExternal={showExternal} />)}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-[12px] min-w-[760px]">
            <thead className="bg-background-secondary text-text-muted text-left">
              <tr>
                {selectable && <th className="w-8 px-3 py-2"><Checkbox checked={pubs.every(p => selected.has(p.id))} onChange={v => setSelected(v ? new Set(pubs.map(p => p.id)) : new Set())} label="Selecionar todas" /></th>}
                <th className="px-2 py-2 font-medium">Publicação</th>
                {!account && <th className="px-2 py-2 font-medium">Conta</th>}
                <th className="px-2 py-2 font-medium">Data</th>
                <th className="px-2 py-2 font-medium">Campanha</th>
                <th className="px-2 py-2 font-medium">Responsável</th>
                <th className="px-2 py-2 font-medium">Status</th>
                {showExternal && <th className="px-2 py-2 font-medium">Instagram</th>}
              </tr>
            </thead>
            <tbody>
              {pubs.map(p => (
                <tr key={p.id} className={`border-t border-border hover:bg-surface-hover/50 ${selected.has(p.id) ? 'bg-blue-500/5' : ''}`}>
                  {selectable && <td className="px-3 py-2"><Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} label={`Selecionar ${p.title}`} /></td>}
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => openPublication(p.id)} className="flex items-center gap-2.5 text-left min-w-0">
                      <PublicationThumb publication={p} className="w-9 h-11 rounded-md flex-shrink-0" />
                      <span className="min-w-0"><span className="block text-text-primary font-medium truncate max-w-[260px]">{p.title}</span><span className="flex items-center gap-1 text-text-muted"><TypeIcon type={p.type} size={12} />{TYPE_META[p.type]?.label}</span></span>
                    </button>
                  </td>
                  {!account && <td className="px-2 py-2 text-text-secondary">@{accountById[p.socialAccountId]?.username || '—'}</td>}
                  <td className="px-2 py-2 text-text-secondary whitespace-nowrap">{formatWhen(effectiveDate(p))}</td>
                  <td className="px-2 py-2 text-text-secondary">{campaignById[p.campaignId]?.name || '—'}</td>
                  <td className="px-2 py-2">{memberById[p.responsibleId] ? <span className="flex items-center gap-1.5 text-text-secondary"><Avatar user={memberById[p.responsibleId]} size={18} />{memberById[p.responsibleId].name.split(' ')[0]}</span> : <span className="text-text-muted">—</span>}</td>
                  <td className="px-2 py-2"><StatusBadge status={p.status} /></td>
                  {showExternal && <td className="px-2 py-2">{p.permalink ? <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline inline-flex items-center gap-1">Abrir <Icon name="open_in_new" size={12} /></a> : <span className="text-text-muted" title="A API confirmou a publicação, mas não informou o link">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={page => setFilters(f => ({ ...f, page }))} />
      {selected.size > 0 && <BulkBar selected={selected} onClear={() => setSelected(new Set())} onDone={() => { setSelected(new Set()); bump(); reload(); }} />}
    </div>
  );
}
