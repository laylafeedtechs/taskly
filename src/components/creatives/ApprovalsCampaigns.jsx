// Criativos → Aprovações and Campanhas.
import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { Btn, Icon, Tabs, Alert, Modal, Field, Input, Textarea, Select, EmptyState, ErrorState, Skeleton, Avatar, Menu, IconBtn } from '../ui';
import { useCreatives, CAMPAIGN_STATUS, TYPE_META, formatWhen } from './shared';
import { PublicationsList } from './PublicationsList';

// ---------------------------------------------------------------- approvals

export function ApprovalsView({ account }) {
  const { currentWorkspaceId, members } = useApp();
  const { perms, dataVersion } = useCreatives();
  const [tab, setTab] = useState('pending');
  const counts = useAsync(async () => {
    const [p, a, r] = await Promise.all([
      api.publications.list(currentWorkspaceId, { accountId: account?.id, status: 'PENDING_APPROVAL', limit: 1 }),
      api.publications.list(currentWorkspaceId, { accountId: account?.id, approval: 'APPROVED', limit: 1 }),
      api.publications.list(currentWorkspaceId, { accountId: account?.id, approval: 'REJECTED', status: 'DRAFT', limit: 1 })
    ]);
    return { pending: p.total, approved: a.total, rejected: r.total };
  }, [currentWorkspaceId, account?.id, dataVersion]);
  const approvers = members.filter(m => ['Owner', 'Manager'].includes(m.role));
  const pending = counts.data?.pending || 0;

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'pending', label: 'Pendentes', icon: 'hourglass_top', count: counts.data?.pending },
        { id: 'approved', label: 'Aprovadas', icon: 'verified', count: counts.data?.approved },
        { id: 'rejected', label: 'Rejeitadas', icon: 'undo', count: counts.data?.rejected }
      ]} />
      {tab === 'pending' && pending > 0 && (perms.approve
        ? <Alert tone="warning"><strong>Você precisa agir:</strong> {pending} publicação(ões) aguardando sua revisão. Abra cada uma para ver a prévia e aprovar ou rejeitar (com motivo), ou selecione várias para decidir em lote.</Alert>
        : <Alert tone="info"><strong>Aguardando aprovação de:</strong> {approvers.length ? approvers.map(m => m.name).join(', ') : 'proprietários e gestores do workspace'}.</Alert>)}
      {tab === 'rejected' && <Alert tone="info">Publicações rejeitadas voltam para rascunho com o motivo. Ajuste e envie novamente.</Alert>}
      {tab === 'pending' && <PublicationsList account={account} preset={{ status: 'PENDING_APPROVAL', sort: 'date' }} emptyTitle="Nada aguardando aprovação" emptyDescription="Quando alguém enviar uma publicação para aprovação, ela aparece aqui." />}
      {tab === 'approved' && <PublicationsList account={account} preset={{ approval: 'APPROVED', status: 'APPROVED,SCHEDULED,PUBLISHING,PUBLISHED,FAILED', sort: '-date' }} emptyTitle="Nenhuma publicação aprovada ainda" />}
      {tab === 'rejected' && <PublicationsList account={account} preset={{ approval: 'REJECTED', status: 'DRAFT', sort: 'updated' }} emptyTitle="Nenhuma publicação rejeitada" emptyDescription="Ótimo sinal." />}
    </div>
  );
}

// ---------------------------------------------------------------- campaigns

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#A0A0A0'];

function CampaignModal({ campaign, defaults, onClose, onSaved }) {
  const { currentWorkspaceId, projects, members, showError, toast } = useApp();
  const { accounts } = useCreatives();
  const [form, setForm] = useState(() => ({
    name: campaign?.name || '', description: campaign?.description || '', client: campaign?.client || '', status: campaign?.status || 'PLANNING',
    startDate: campaign?.startDate || '', endDate: campaign?.endDate || '', projectId: campaign?.projectId || '', responsibleId: campaign?.responsibleId || '',
    socialAccountId: campaign?.socialAccountId ?? defaults?.socialAccountId ?? '', color: campaign?.color || COLORS[0], budget: campaign?.budget?.amount ?? ''
  }));
  const [busy, setBusy] = useState(false);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const submit = async e => {
    e?.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, startDate: form.startDate || null, endDate: form.endDate || null, projectId: form.projectId || null, responsibleId: form.responsibleId || null, socialAccountId: form.socialAccountId || null, budget: form.budget === '' ? null : { amount: Number(form.budget), currency: 'BRL' } };
      const res = campaign ? await api.campaigns.update(campaign.id, body) : await api.campaigns.create(currentWorkspaceId, body);
      toast(campaign ? 'Campanha atualizada' : 'Campanha criada', 'success');
      onSaved(res.campaign);
    } catch (err) { showError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={campaign ? 'Editar campanha' : 'Nova campanha'} size="lg"
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" loading={busy} onClick={submit}>{campaign ? 'Salvar' : 'Criar campanha'}</Btn></>}>
      <form onSubmit={submit} className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome" required className="sm:col-span-2"><Input data-autofocus value={form.name} maxLength={120} onChange={e => set({ name: e.target.value })} placeholder="Ex.: Black Friday 2026" /></Field>
        <Field label="Cliente"><Input value={form.client} maxLength={120} onChange={e => set({ client: e.target.value })} /></Field>
        <Field label="Conta do Instagram"><Select value={form.socialAccountId} onChange={e => set({ socialAccountId: e.target.value })}><option value="">Todas as contas</option>{accounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}</Select></Field>
        <Field label="Início"><Input type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} /></Field>
        <Field label="Fim"><Input type="date" value={form.endDate} onChange={e => set({ endDate: e.target.value })} /></Field>
        <Field label="Status"><Select value={form.status} onChange={e => set({ status: e.target.value })}>{Object.entries(CAMPAIGN_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Responsável"><Select value={form.responsibleId} onChange={e => set({ responsibleId: e.target.value })}><option value="">Sem responsável</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        <Field label="Projeto"><Select value={form.projectId} onChange={e => set({ projectId: e.target.value })}><option value="">Sem projeto</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Orçamento (opcional, R$)"><Input type="number" min="0" step="0.01" value={form.budget} onChange={e => set({ budget: e.target.value })} /></Field>
        <Field label="Descrição" className="sm:col-span-2"><Textarea value={form.description} maxLength={2000} onChange={e => set({ description: e.target.value })} /></Field>
        <Field label="Cor" className="sm:col-span-2">
          <div className="flex gap-2">{COLORS.map(c => <button key={c} type="button" aria-label={`Cor ${c}`} aria-pressed={form.color === c} onClick={() => set({ color: c })} className={`w-6 h-6 rounded-full border-2 ${form.color === c ? 'border-text-primary' : 'border-transparent'}`} style={{ backgroundColor: c }} />)}</div>
        </Field>
      </form>
    </Modal>
  );
}

export function CampaignsView({ account, onOpenCampaign }) {
  const { currentWorkspaceId, members, confirm, toast, showError } = useApp();
  const { perms, bump, reloadCampaigns, dataVersion } = useCreatives();
  const [status, setStatus] = useState('ALL');
  const [editing, setEditing] = useState(null); // campaign | 'new'
  const { data, loading, error, reload } = useAsync(() => api.campaigns.list(currentWorkspaceId, { status, socialAccountId: account?.id }), [currentWorkspaceId, status, account?.id, dataVersion]);
  const campaigns = data?.campaigns || [];
  const memberById = Object.fromEntries(members.map(m => [m.id, m]));
  const refresh = () => { reload(); reloadCampaigns(); bump(); };
  const fmtDate = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={status} onChange={setStatus} tabs={[{ id: 'ALL', label: 'Todas' }, ...Object.entries(CAMPAIGN_STATUS).map(([id, label]) => ({ id, label }))]} />
        {perms.campaigns && <Btn className="ml-auto" size="sm" variant="primary" icon="add" onClick={() => setEditing('new')}>Nova campanha</Btn>}
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : !campaigns.length ? (
        <EmptyState icon="campaign" title="Nenhuma campanha" description="Campanhas agrupam publicações e criativos (ex.: Black Friday 2026) e podem ser ligadas a um projeto do Taskly."
          action={perms.campaigns && <Btn variant="primary" icon="add" onClick={() => setEditing('new')}>Criar campanha</Btn>} />
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {campaigns.map(c => (
            <article key={c.id} className="rounded-xl border border-border bg-surface-card p-4 flex flex-col gap-3">
              <header className="flex items-start gap-3">
                <span className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: c.color }} />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpenCampaign?.(c)} className="text-[14px] font-semibold text-text-primary hover:underline text-left truncate block max-w-full">{c.name}</button>
                  <p className="text-[11px] text-text-muted truncate">{[c.client, `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}`].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md border ${c.status === 'ACTIVE' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : c.status === 'FINISHED' ? 'text-text-muted border-border' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`}>{CAMPAIGN_STATUS[c.status]}</span>
                {perms.campaigns && (
                  <Menu trigger={p => <IconBtn icon="more_horiz" label="Ações da campanha" size="xs" onClick={p.toggle} aria-expanded={p['aria-expanded']} />} items={[
                    { label: 'Editar', icon: 'edit', onClick: () => setEditing(c) },
                    { label: 'Duplicar', icon: 'content_copy', onClick: async () => { try { await api.campaigns.duplicate(c.id, {}); toast('Campanha duplicada', 'success'); refresh(); } catch (err) { showError(err); } } },
                    '-',
                    { label: 'Excluir', icon: 'delete', danger: true, onClick: async () => { if (await confirm({ title: `Excluir "${c.name}"?`, message: 'As publicações e criativos continuam existindo, só deixam de estar ligados à campanha.', confirmLabel: 'Excluir', danger: true })) { try { await api.campaigns.remove(c.id); toast('Campanha excluída', 'success'); refresh(); } catch (err) { showError(err); } } } }
                  ]} />
                )}
              </header>
              <div className="flex items-baseline gap-2">
                <span className="text-title-md text-text-primary">{c.stats.publications}</span>
                <span className="text-[12px] text-text-secondary">publicações</span>
                <span className="ml-auto text-[11px] text-text-muted">{c.stats.creatives} criativos</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(c.stats.byType).filter(([, n]) => n).map(([t, n]) => <span key={t} className="inline-flex items-center gap-1 text-[11px] text-text-secondary px-1.5 h-5 rounded-md bg-surface-elevated"><Icon name={TYPE_META[t].icon} size={12} />{n} {TYPE_META[t].label}</span>)}
              </div>
              <footer className="flex items-center justify-between text-[11px] text-text-muted border-t border-border pt-2.5">
                <span>{c.stats.nextScheduledAt ? `Próxima: ${formatWhen(c.stats.nextScheduledAt)}` : 'Nada agendado'}</span>
                {memberById[c.responsibleId] && <span className="flex items-center gap-1"><Avatar user={memberById[c.responsibleId]} size={16} />{memberById[c.responsibleId].name.split(' ')[0]}</span>}
              </footer>
            </article>
          ))}
        </div>
      )}
      {editing && <CampaignModal campaign={editing === 'new' ? null : editing} defaults={{ socialAccountId: account?.id }} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}
