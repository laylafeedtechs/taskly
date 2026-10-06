// Editorial calendar (month / week / day). Dragging a publication to another
// day or hour saves the new date on the server; scheduled posts ask first.
import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useLocalStorage } from '../../lib/hooks';
import { Btn, IconBtn, Icon, Segmented, Select, ErrorState, Skeleton } from '../ui';
import { useCreatives, StatusBadge, TypeIcon, CreativeThumb, STATUS_META, TYPE_META, monthLabel, formatTime, effectiveDate } from './shared';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06h–23h
const LOCKED = ['PUBLISHED', 'PUBLISHING', 'CANCELLED'];

const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function rangeFor(view, cursor) {
  if (view === 'month') {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = mondayOf(first);
    const end = addDays(start, 42);
    return { start, end, days: Array.from({ length: 42 }, (_, i) => addDays(start, i)) };
  }
  if (view === 'week') { const start = mondayOf(cursor); return { start, end: addDays(start, 7), days: Array.from({ length: 7 }, (_, i) => addDays(start, i)) }; }
  const start = startOfDay(cursor);
  return { start, end: addDays(start, 1), days: [start] };
}

function Chip({ pub, campaign, onOpen, onDragStart, draggable, dense }) {
  return (
    <button type="button" draggable={draggable} onDragStart={onDragStart} onClick={onOpen}
      title={`${pub.title} — ${STATUS_META[pub.status]?.label}`}
      className={`w-full flex items-center gap-1.5 rounded-md border border-border bg-surface-card hover:bg-surface-hover text-left transition-colors ${dense ? 'p-1' : 'p-1.5'} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}>
      <span className={`relative flex-shrink-0 rounded overflow-hidden bg-surface-elevated ${dense ? 'w-6 h-7' : 'w-8 h-10'}`}>
        <CreativeThumb creative={pub.type === 'REEL' && pub.cover ? pub.cover : pub.media?.[0]?.creative} className="absolute inset-0 w-full h-full" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[10px] text-text-muted font-mono">
          {formatTime(effectiveDate(pub))}<TypeIcon type={pub.type} size={11} />
          <span aria-hidden="true" className={STATUS_META[pub.status]?.className.split(' ')[0]}>{STATUS_META[pub.status]?.symbol}</span>
        </span>
        <span className="block text-[11px] text-text-primary truncate">{pub.title}</span>
        {!dense && campaign && <span className="flex items-center gap-1 text-[10px] text-text-muted truncate"><span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: campaign.color }} />{campaign.name}</span>}
      </span>
    </button>
  );
}

export function EditorialCalendar({ account }) {
  const { currentWorkspaceId, members, projects, confirm, toast, showError } = useApp();
  const { dataVersion, bump, openPublication, newPublication, campaigns, perms } = useCreatives();
  const [view, setView] = useLocalStorage('taskly.creatives.calendarView', 'month');
  const [cursor, setCursor] = useState(() => new Date());
  const [filters, setFilters] = useState({ campaignId: '', status: '', type: '', responsibleId: '', projectId: '', tag: '' });
  const [dragId, setDragId] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const range = useMemo(() => rangeFor(view, cursor), [view, cursor]);
  const { data, loading, error, reload } = useAsync(() => api.publications.list(currentWorkspaceId, {
    accountId: account.id, from: range.start.toISOString(), to: range.end.toISOString(), limit: 200, sort: 'date',
    campaignId: filters.campaignId || undefined, status: filters.status || 'DRAFT,PENDING_APPROVAL,APPROVED,SCHEDULED,PUBLISHING,PUBLISHED,FAILED',
    type: filters.type || undefined, responsibleId: filters.responsibleId || undefined, projectId: filters.projectId || undefined, tag: filters.tag || undefined
  }), [currentWorkspaceId, account.id, range.start.getTime(), range.end.getTime(), JSON.stringify(filters), dataVersion]);
  const overview = useAsync(() => api.publications.overview(currentWorkspaceId, { accountId: account.id }), [currentWorkspaceId, account.id, dataVersion]);
  const campaignById = useMemo(() => Object.fromEntries(campaigns.map(c => [c.id, c])), [campaigns]);
  const pubs = data?.publications || [];
  const byDay = useMemo(() => {
    const map = {};
    pubs.forEach(p => { const d = new Date(effectiveDate(p)); (map[dayKey(d)] = map[dayKey(d)] || []).push(p); });
    return map;
  }, [pubs]);
  const step = dir => setCursor(c => (view === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (view === 'week' ? 7 : 1))));
  const monthCount = key => overview.data?.months?.find(m => m.month === key)?.count;
  const mk = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  // Persist a new date; scheduled publications need confirmation and permission.
  const moveTo = async (pubId, day, hour = null) => {
    const pub = pubs.find(p => p.id === pubId);
    if (!pub || LOCKED.includes(pub.status)) return;
    const from = new Date(effectiveDate(pub) || Date.now());
    const target = new Date(day);
    target.setHours(hour ?? from.getHours(), hour === null ? from.getMinutes() : 0, 0, 0);
    if (target.getTime() === from.getTime()) return;
    const body = { scheduledAt: target.toISOString() };
    if (pub.status === 'SCHEDULED') {
      if (!perms.publish) { showError(new Error('Somente quem pode agendar move publicações já agendadas.')); return; }
      if (target.getTime() < Date.now() + 60000) { showError(new Error('Escolha um horário futuro.')); return; }
      const ok = await confirm({ title: 'Reagendar publicação?', message: `"${pub.title}" está agendada. Novo horário: ${target.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}.`, confirmLabel: 'Reagendar' });
      if (!ok) return;
      body.confirmReschedule = true;
    }
    try { await api.publications.update(pub.id, body); toast('Data atualizada', 'success'); bump(); } catch (err) { showError(err); reload(); }
  };

  const dropProps = (key, day, hour = null) => ({
    onDragOver: e => { if (dragId) { e.preventDefault(); if (overKey !== key) setOverKey(key); } },
    onDragLeave: () => setOverKey(k => (k === key ? null : k)),
    onDrop: e => { e.preventDefault(); setOverKey(null); const id = dragId; setDragId(null); if (id) moveTo(id, day, hour); }
  });
  const chipProps = p => ({ pub: p, campaign: campaignById[p.campaignId], onOpen: () => openPublication(p.id), draggable: perms.edit && !LOCKED.includes(p.status) && !(p.status === 'SCHEDULED' && !perms.publish), onDragStart: e => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); } });
  const today = new Date();
  const title = view === 'month' ? monthLabel(cursor) : view === 'week' ? `${range.days[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${range.days[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}` : cursor.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  const prevMonth = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const tags = [...new Set(pubs.flatMap(p => p.tags || []))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <IconBtn icon="chevron_left" label="Anterior" onClick={() => step(-1)} />
          {view === 'month' && <button type="button" onClick={() => step(-1)} className="hidden md:block text-[12px] text-text-muted hover:text-text-primary px-1">{monthLabel(prevMonth, { month: 'long' })}{monthCount(mk(prevMonth)) !== undefined ? ` · ${monthCount(mk(prevMonth))}` : ''}</button>}
          <h2 className="text-title-sm text-text-primary px-2 min-w-[150px] text-center">{title}{view === 'month' && monthCount(mk(cursor)) !== undefined && <span className="block text-[11px] font-normal text-text-muted">{monthCount(mk(cursor))} publicações</span>}</h2>
          {view === 'month' && <button type="button" onClick={() => step(1)} className="hidden md:block text-[12px] text-text-muted hover:text-text-primary px-1">{monthLabel(nextMonth, { month: 'long' })}{monthCount(mk(nextMonth)) !== undefined ? ` · ${monthCount(mk(nextMonth))}` : ''}</button>}
          <IconBtn icon="chevron_right" label="Próximo" onClick={() => step(1)} />
          <Btn size="xs" variant="ghost" onClick={() => setCursor(new Date())}>Hoje</Btn>
        </div>
        <Segmented label="Visualização" value={view} onChange={setView} options={[{ value: 'month', label: 'Mês' }, { value: 'week', label: 'Semana' }, { value: 'day', label: 'Dia' }]} />
        {perms.create && <Btn className="ml-auto" size="sm" icon="add" onClick={() => newPublication({ socialAccountId: account.id })}>Nova publicação</Btn>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select aria-label="Campanha" className="!w-auto" value={filters.campaignId} onChange={e => setFilters(f => ({ ...f, campaignId: e.target.value }))}><option value="">Todas as campanhas</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select aria-label="Status" className="!w-auto" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}><option value="">Todos os status</option>{Object.entries(STATUS_META).filter(([k]) => k !== 'CANCELLED').map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Select>
        <Select aria-label="Tipo" className="!w-auto" value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}><option value="">Todos os tipos</option>{Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Select>
        <Select aria-label="Responsável" className="!w-auto" value={filters.responsibleId} onChange={e => setFilters(f => ({ ...f, responsibleId: e.target.value }))}><option value="">Qualquer responsável</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
        <Select aria-label="Projeto" className="!w-auto" value={filters.projectId} onChange={e => setFilters(f => ({ ...f, projectId: e.target.value }))}><option value="">Todos os projetos</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        {tags.length > 0 && <Select aria-label="Tag" className="!w-auto" value={filters.tag} onChange={e => setFilters(f => ({ ...f, tag: e.target.value }))}><option value="">Todas as tags</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</Select>}
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <Skeleton className="h-[520px] rounded-xl" /> : view === 'month' ? (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-7 bg-background-secondary border-b border-border">{WEEKDAYS.map(d => <div key={d} className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {range.days.map(day => {
              const key = dayKey(day);
              const items = byDay[key] || [];
              const outside = day.getMonth() !== cursor.getMonth();
              return (
                <div key={key} {...dropProps(key, day)} className={`min-h-[118px] border-b border-r border-border p-1.5 flex flex-col gap-1 transition-colors ${outside ? 'bg-background-secondary/40' : ''} ${overKey === key ? 'bg-blue-500/10' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-mono w-6 h-6 flex items-center justify-center rounded-full ${sameDay(day, today) ? 'bg-inverse text-inverse-text font-semibold' : outside ? 'text-text-muted' : 'text-text-secondary'}`}>{day.getDate()}</span>
                    {perms.create && !outside && <button type="button" aria-label={`Nova publicação em ${day.toLocaleDateString('pt-BR')}`} onClick={() => { const at = new Date(day); at.setHours(18, 0, 0, 0); newPublication({ socialAccountId: account.id, scheduledAt: at.toISOString() }); }} className="w-5 h-5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover opacity-0 hover:opacity-100 focus:opacity-100 flex items-center justify-center"><Icon name="add" size={14} /></button>}
                  </div>
                  {items.slice(0, 3).map(p => <Chip key={p.id} dense {...chipProps(p)} />)}
                  {items.length > 3 && <button type="button" onClick={() => { setCursor(day); setView('day'); }} className="text-[10px] text-text-muted hover:text-text-primary text-left px-1">+{items.length - 3} mais</button>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid border-b border-border bg-background-secondary" style={{ gridTemplateColumns: `56px repeat(${range.days.length}, minmax(0,1fr))` }}>
              <div />
              {range.days.map(d => <div key={dayKey(d)} className={`px-2 py-1.5 text-[11px] ${sameDay(d, today) ? 'text-text-primary font-semibold' : 'text-text-muted'}`}>{d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' })}</div>)}
            </div>
            {HOURS.map(h => (
              <div key={h} className="grid border-b border-border" style={{ gridTemplateColumns: `56px repeat(${range.days.length}, minmax(0,1fr))` }}>
                <div className="px-2 py-1 text-[10px] font-mono text-text-muted">{String(h).padStart(2, '0')}:00</div>
                {range.days.map(d => {
                  const key = `${dayKey(d)}-${h}`;
                  const items = (byDay[dayKey(d)] || []).filter(p => new Date(effectiveDate(p)).getHours() === h || (h === 6 && new Date(effectiveDate(p)).getHours() < 6));
                  return (
                    <div key={key} {...dropProps(key, d, h)} className={`min-h-[44px] border-l border-border p-1 flex flex-col gap-1 ${overKey === key ? 'bg-blue-500/10' : ''}`}>
                      {items.map(p => <Chip key={p.id} dense={view === 'week'} {...chipProps(p)} />)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && data && !pubs.length && (
        <div className="text-center py-6">
          <p className="text-[14px] font-semibold text-text-primary">Seu calendário está vazio neste período</p>
          <p className="text-[12px] text-text-secondary mt-1">Comece planejando a próxima publicação para @{account.username}.</p>
          {perms.create && <Btn className="mt-3" variant="primary" icon="add" onClick={() => newPublication({ socialAccountId: account.id })}>Nova publicação</Btn>}
        </div>
      )}
    </div>
  );
}
