// Feed Planner: "how does this Instagram look — now and after the next posts?"
// Planned items (drafts, approvals, scheduled) sit above what is already
// published, newest first, like the profile grid. Dragging changes only the
// planned order; dates change only through an explicit, confirmed action.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useLocalStorage } from '../../lib/hooks';
import { Btn, Icon, Alert, Segmented, Skeleton, ErrorState, EmptyState, Toggle } from '../ui';
import { useCreatives, StatusBadge, TypeIcon, CreativeThumb, formatWhen, AccountAvatar, STATUS_META } from './shared';

const FUTURE = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'FAILED'];

function Tile({ item, ratio, draggable, onDragStart, onDragOver, onDrop, onDragEnd, dragging, onOpen }) {
  const future = item.kind === 'planned';
  const pub = item.publication;
  const label = future ? (pub.scheduledAt ? formatWhen(pub.scheduledAt) : 'Sem data') : new Date(item.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const cover = pub ? (pub.type === 'REEL' && pub.cover ? pub.cover : pub.media?.[0]?.creative) : null;
  return (
    <div draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
      className={`group relative overflow-hidden bg-surface-elevated ${dragging ? 'opacity-30' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`} style={{ aspectRatio: ratio }}>
      <button type="button" onClick={onOpen} className="absolute inset-0 w-full h-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:-outline-offset-2"
        aria-label={`${pub?.title || 'Post publicado'} — ${future ? STATUS_META[pub.status]?.label : 'Publicado'} — ${label}`}>
        {item.kind === 'external'
          ? (item.media.hasPreview ? <img src={api.social.previewUrl(item.media.id)} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-text-muted"><Icon name="image" size={22} /></span>)
          : <CreativeThumb creative={cover} className="absolute inset-0 w-full h-full" />}
        {/* Future content is visually distinct from what is already live. */}
        {future && <span className="absolute inset-0 ring-1 ring-inset ring-white/25 bg-gradient-to-b from-black/45 via-transparent to-black/55" />}
        {future && <span className="absolute inset-1 border border-dashed border-white/40 rounded-[2px] pointer-events-none" />}
        <span className="absolute top-1.5 left-1.5 flex items-center gap-1">
          {future ? <StatusBadge status={pub.status} compact className="!bg-black/60 !border-white/20 !text-white" /> : <span className="h-5 px-1.5 rounded-md bg-black/50 text-white text-[10px] flex items-center" title="Publicado">✓</span>}
        </span>
        {(pub?.type && pub.type !== 'POST') || (item.kind === 'external' && item.media.mediaType !== 'POST') ? (
          <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded bg-black/55 text-white flex items-center justify-center"><TypeIcon type={pub?.type || (item.media.mediaType === 'VIDEO' ? 'REEL' : item.media.mediaType)} size={13} /></span>
        ) : null}
        <span className={`absolute bottom-0 inset-x-0 px-1.5 py-1 text-[10px] font-medium text-white ${future ? 'bg-black/0' : 'bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity'}`}>
          {label}{pub?.campaignName ? ` · ${pub.campaignName}` : ''}
        </span>
      </button>
    </div>
  );
}

export function FeedPlanner({ account }) {
  const { currentWorkspaceId, toast, showError, confirm } = useApp();
  const { dataVersion, bump, openPublication, newPublication, perms, campaigns } = useCreatives();
  const { data, loading, error, reload } = useAsync(() => api.publications.feed(currentWorkspaceId, account.id), [currentWorkspaceId, account.id, dataVersion]);
  const [ratioMode, setRatioMode] = useLocalStorage('taskly.creatives.gridRatio', '3:4');
  const [includeDrafts, setIncludeDrafts] = useLocalStorage('taskly.creatives.feedDrafts', true);
  const [order, setOrder] = useState(null); // planned ids in visual order
  const [dragId, setDragId] = useState(null);
  const [saving, setSaving] = useState(false);
  const ratio = ratioMode === '1:1' ? 1 : 3 / 4;
  const campaignName = useMemo(() => Object.fromEntries(campaigns.map(c => [c.id, c.name])), [campaigns]);

  useEffect(() => { if (data) setOrder(data.planned.map(p => p.id)); }, [data]);

  const plannedById = useMemo(() => Object.fromEntries((data?.planned || []).map(p => [p.id, { ...p, campaignName: campaignName[p.campaignId] }])), [data, campaignName]);
  const planned = (order || []).map(id => plannedById[id]).filter(Boolean).filter(p => includeDrafts || !['DRAFT', 'PENDING_APPROVAL'].includes(p.status));
  const live = useMemo(() => [
    ...(data?.published || []).map(p => ({ kind: 'published', key: p.id, publication: { ...p, campaignName: campaignName[p.campaignId] }, timestamp: p.publishedAt })),
    ...(data?.external || []).map(m => ({ kind: 'external', key: m.id, media: m, timestamp: m.timestamp }))
  ].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))), [data, campaignName]);

  const counts = useMemo(() => FUTURE.reduce((acc, s) => ({ ...acc, [s]: planned.filter(p => p.status === s).length }), {}), [planned]);
  const orderChanged = data && order && JSON.stringify(order) !== JSON.stringify(data.planned.map(p => p.id));

  const move = (from, to) => setOrder(o => { const list = [...o]; const i = list.indexOf(from); const j = list.indexOf(to); if (i < 0 || j < 0) return o; list.splice(i, 1); list.splice(j, 0, from); return list; });

  const saveOrder = async () => {
    setSaving(true);
    try { await api.publications.saveFeedOrder(currentWorkspaceId, account.id, order); toast('Ordem planejada salva (as datas não mudaram)', 'success'); bump(); } catch (err) { showError(err); } finally { setSaving(false); }
  };

  const applyDates = async () => {
    try {
      if (orderChanged) await api.publications.saveFeedOrder(currentWorkspaceId, account.id, order);
      await api.publications.applyFeedDates(currentWorkspaceId, account.id, order);
      toast('Nenhuma data precisava mudar', 'info');
    } catch (err) {
      if (err.code !== 'REQUIRES_CONFIRMATION') { showError(err); return; }
      const list = (err.details?.changes || []).map(c => `• ${c.title || 'Publicação'}: ${formatWhen(c.from)} → ${formatWhen(c.to)}${c.status === 'SCHEDULED' ? ' (agendada)' : ''}`).join('\n');
      const ok = await confirm({ title: 'Aplicar a ordem do feed às datas?', message: `${err.message}\n\n${list}\n\nAs mesmas datas são redistribuídas para seguir a ordem planejada.`, confirmLabel: 'Aplicar datas' });
      if (!ok) return;
      try { const res = await api.publications.applyFeedDates(currentWorkspaceId, account.id, order, true); toast(`${res.changed} data(s) atualizada(s)`, 'success'); bump(); } catch (e2) { showError(e2); }
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="grid xl:grid-cols-[minmax(0,640px)_1fr] gap-8 items-start">
      <div className="min-w-0">
        {/* Profile header: only numbers returned by the API. */}
        <div className="flex items-center gap-4 mb-5">
          <AccountAvatar account={account} size={64} ring />
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-text-primary truncate">{account.username}</div>
            <div className="text-[12px] text-text-secondary truncate">{account.name}</div>
            <div className="flex gap-4 mt-1.5 text-[12px] text-text-secondary">
              {account.metadata?.mediaCount !== null && account.metadata?.mediaCount !== undefined && <span><strong className="text-text-primary">{account.metadata.mediaCount}</strong> posts</span>}
              {account.metadata?.followersCount !== null && account.metadata?.followersCount !== undefined && <span><strong className="text-text-primary">{account.metadata.followersCount.toLocaleString('pt-BR')}</strong> seguidores</span>}
              <span><strong className="text-text-primary">{planned.length}</strong> planejados</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Segmented label="Proporção da grade" value={ratioMode} onChange={setRatioMode} options={[{ value: '3:4', label: '3:4' }, { value: '1:1', label: '1:1' }]} />
          <Toggle checked={includeDrafts} onChange={setIncludeDrafts} label="Rascunhos" />
          <span className="ml-auto flex gap-2">
            {orderChanged && perms.edit && <Btn size="sm" variant="primary" loading={saving} onClick={saveOrder}>Salvar ordem planejada</Btn>}
            {perms.create && <Btn size="sm" icon="add" onClick={() => newPublication({ socialAccountId: account.id })}>Nova publicação</Btn>}
          </span>
        </div>

        {data && (!data.orderMatchesSchedule || orderChanged) && planned.some(p => p.scheduledAt) && (
          <div className="mb-3"><Alert tone="info">
            A ordem planejada é só visual e difere do cronograma. {perms.edit ? <button type="button" className="underline font-medium" onClick={applyDates}>Aplicar esta ordem às datas</button> : 'Peça a quem gerencia a agenda para aplicá-la às datas.'}
          </Alert></div>
        )}

        {loading && !data ? (
          <div className="grid grid-cols-3 gap-0.5">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className={`rounded-none ${ratio === 1 ? 'aspect-square' : 'aspect-[3/4]'}`} />)}</div>
        ) : !planned.length && !live.length ? (
          <EmptyState icon="grid_on" title="O feed ainda está vazio" description="Comece planejando a primeira publicação para este Instagram." action={perms.create && <Btn variant="primary" icon="add" onClick={() => newPublication({ socialAccountId: account.id })}>Nova publicação</Btn>} />
        ) : (
          <div className="grid grid-cols-3 gap-0.5 rounded-md overflow-hidden">
            {planned.map(p => (
              <Tile key={p.id} ratio={ratio} item={{ kind: 'planned', publication: p }} dragging={dragId === p.id}
                draggable={perms.edit && p.status !== 'PUBLISHING'}
                onDragStart={e => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); }}
                onDragOver={e => { if (dragId && dragId !== p.id) { e.preventDefault(); } }}
                onDrop={e => { e.preventDefault(); if (dragId) move(dragId, p.id); setDragId(null); }}
                onDragEnd={() => setDragId(null)}
                onOpen={() => openPublication(p.id)} />
            ))}
            {live.map(item => (
              <Tile key={item.key} ratio={ratio} item={item}
                onOpen={() => (item.kind === 'published' ? openPublication(item.publication.id) : item.media.permalink && window.open(item.media.permalink, '_blank', 'noopener'))} />
            ))}
          </div>
        )}
        {!loading && live.length === 0 && planned.length > 0 && <p className="text-[11px] text-text-muted mt-3">Os posts já publicados aparecem aqui depois da sincronização com o Instagram.</p>}
      </div>

      <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-3">Legenda da grade</h3>
          <ul className="flex flex-col gap-2 text-[12px]">
            <li className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-surface-elevated flex items-center justify-center text-[10px]">✓</span><span className="text-text-secondary">Publicado (ao vivo)</span></li>
            {['SCHEDULED', 'APPROVED', 'PENDING_APPROVAL', 'DRAFT', 'FAILED'].map(s => (
              <li key={s} className="flex items-center justify-between gap-2"><StatusBadge status={s} /><span className="font-mono text-text-muted">{counts[s] || 0}</span></li>
            ))}
          </ul>
          <p className="text-[11px] text-text-muted mt-3 leading-relaxed">Conteúdo futuro aparece com borda tracejada e não se confunde com o que já está no ar. Arraste para planejar a ordem; as datas só mudam quando você aplicar a ordem.</p>
        </div>
      </aside>
    </div>
  );
}
