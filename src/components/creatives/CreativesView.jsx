// Criativos — Social Media Hub. Routes:
//   /creatives                         hub: dashboard, connected accounts, upcoming
//   /creatives/library | /campaigns    workspace-wide library and campaigns
//   /creatives/<accountId>/<section>   one account: feed, calendar, publications…
// ?pub=<id|new> opens the publication editor on top of any of them.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { Btn, IconBtn, Icon, Alert, Modal, Toggle, Tabs, EmptyState, ErrorState, Skeleton, Menu, Spinner } from '../ui';
import { CreativesProvider, useCreatives, AccountAvatar, ACCOUNT_STATUS, StatusBadge, PublicationThumb, TypeIcon, formatWhen, effectiveDate, SectionTitle } from './shared';
import { FeedPlanner } from './FeedPlanner';
import { EditorialCalendar } from './EditorialCalendar';
import { PublicationsList } from './PublicationsList';
import { ApprovalsView, CampaignsView } from './ApprovalsCampaigns';
import { LibraryView } from './LibraryView';
import { PublicationEditor } from './PublicationEditor';

const SECTIONS = [
  { id: 'feed', label: 'Feed Planner', icon: 'grid_on' },
  { id: 'calendar', label: 'Calendário', icon: 'calendar_month' },
  { id: 'publications', label: 'Publicações', icon: 'view_list' },
  { id: 'approvals', label: 'Aprovações', icon: 'fact_check' },
  { id: 'drafts', label: 'Rascunhos', icon: 'edit_note' },
  { id: 'published', label: 'Publicados', icon: 'task_alt' },
  { id: 'campaigns', label: 'Campanhas', icon: 'campaign' },
  { id: 'library', label: 'Biblioteca', icon: 'photo_library' }
];

const OAUTH_ERRORS = {
  oauth_cancelled: 'A conexão foi cancelada na tela da Meta.',
  oauth_state: 'A solicitação de conexão expirou ou não pôde ser validada. Tente novamente.',
  oauth_permission: 'A Meta não concedeu as permissões necessárias para publicar.',
  session_required: 'Conclua a conexão com a mesma sessão que a iniciou.',
  forbidden: 'Seu papel neste workspace não permite conectar contas.',
  oauth_failed: 'Não foi possível concluir a conexão com o Instagram.'
};

const accountKey = ws => `taskly.creatives.account.${ws}`;
const remember = (ws, id) => { try { localStorage.setItem(accountKey(ws), id); } catch { /* ignore */ } };
const recall = ws => { try { return localStorage.getItem(accountKey(ws)); } catch { return null; } };

function useConnect() {
  const { currentWorkspaceId, showError } = useApp();
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const res = await api.social.connect(currentWorkspaceId, 'instagram');
      window.location.href = res.authorizationUrl; // official Meta authorization screen
    } catch (err) { showError(err); setBusy(false); }
  };
  return { connect, busy };
}

// ------------------------------------------------------------- settings

function SettingsModal({ onClose }) {
  const { currentWorkspaceId, toast, showError } = useApp();
  const { settings, reloadSettings, integrations, perms, storageAvailable } = useCreatives();
  const ig = integrations.find(i => i.provider === 'instagram');
  const save = async requireApproval => {
    try { await api.creatives.updateSettings(currentWorkspaceId, { requireApproval }); reloadSettings(); toast('Regra atualizada', 'success'); } catch (err) { showError(err); }
  };
  return (
    <Modal open onClose={onClose} title="Integrações e regras" size="lg" footer={<Btn onClick={onClose}>Fechar</Btn>}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Fluxo de aprovação</h3>
          <Toggle checked={settings.requireApproval} disabled={!perms.integrations} onChange={save} label="Exigir aprovação antes de agendar"
            description="Com a regra ativa, só publicações aprovadas por proprietários ou gestores podem ser agendadas ou publicadas." />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Instagram (API oficial da Meta)</h3>
          {ig?.configured ? <Alert tone="success">Integração configurada neste ambiente. Contas são conectadas pelo login oficial da Meta; o Taskly nunca recebe a senha do Instagram.</Alert> : (
            <Alert tone="warning">
              <p className="font-semibold">Integração ainda não configurada neste ambiente.</p>
              <p className="mt-1">Crie um app do tipo Business no Meta for Developers com o produto <em>Instagram API with Instagram Login</em> e defina no servidor: {ig?.requiredConfig?.map(n => <code key={n} className="mx-0.5 px-1 rounded bg-black/30">{n}</code>)}.</p>
            </Alert>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <dt className="text-text-muted">URI de redirecionamento</dt><dd className="font-mono text-text-secondary break-all">{ig?.redirectUri}</dd>
            <dt className="text-text-muted">Permissões</dt><dd className="font-mono text-text-secondary">instagram_business_basic, instagram_business_content_publish</dd>
            <dt className="text-text-muted">Contas aceitas</dt><dd className="text-text-secondary">Profissionais (Empresa ou Criador de conteúdo)</dd>
            <dt className="text-text-muted">Limite da Meta</dt><dd className="text-text-secondary">100 publicações pela API a cada 24 horas por conta</dd>
            <dt className="text-text-muted">Armazenamento</dt><dd className="text-text-secondary">{storageAvailable ? 'Disponível' : 'R2 não configurado — uploads indisponíveis'}</dd>
          </dl>
          <p className="text-[11px] text-text-muted">Para uso por contas fora da equipe do app, a Meta exige App Review com Advanced Access para as permissões acima.</p>
        </section>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- hub

function Metric({ label, value, tone }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border-r border-border last:border-r-0">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
      <span className={`text-title-lg ${tone || 'text-text-primary'}`}>{value ?? '—'}</span>
    </div>
  );
}

function AccountCard({ account, onOpen }) {
  const st = ACCOUNT_STATUS[account.status] || ACCOUNT_STATUS.ERROR;
  return (
    <button type="button" onClick={onOpen} className="group flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-card hover:border-border-focus hover:bg-surface-hover text-left transition-colors">
      <AccountAvatar account={account} size={44} ring />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-text-primary truncate">@{account.username}</div>
        <div className="text-[12px] text-text-secondary truncate">{account.name}</div>
        <div className={`flex items-center gap-1.5 text-[11px] mt-0.5 ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}</div>
      </div>
      <Icon name="chevron_right" size={18} className="text-text-muted group-hover:text-text-primary" />
    </button>
  );
}

function UpcomingRow({ pub, account, onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="w-full flex items-center gap-3 py-2 text-left hover:bg-surface-hover/50 rounded-lg px-2 -mx-2">
      <PublicationThumb publication={pub} className="w-10 h-12 rounded-md flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-text-primary truncate">{pub.title}</div>
        <div className="text-[11px] text-text-muted flex items-center gap-1.5">{account && <span>@{account.username}</span>}<TypeIcon type={pub.type} size={12} />{formatWhen(effectiveDate(pub), { withWeekday: true })}</div>
      </div>
      <StatusBadge status={pub.status} compact />
    </button>
  );
}

function Hub() {
  const { currentWorkspaceId, navigate, query, setQuery, toast } = useApp();
  const { accounts, accountsState, integrations, perms, openPublication, newPublication, dataVersion } = useCreatives();
  const { connect, busy } = useConnect();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const overview = useAsync(() => api.publications.overview(currentWorkspaceId), [currentWorkspaceId, dataVersion]);
  const ig = integrations.find(i => i.provider === 'instagram');
  const accountById = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a])), [accounts]);
  const last = recall(currentWorkspaceId);
  const lastAccount = accounts.find(a => a.id === last);
  const m = overview.data?.metrics;
  const h = overview.data?.health;

  useEffect(() => {
    if (query.social_error) { toast(OAUTH_ERRORS[query.social_error] || OAUTH_ERRORS.oauth_failed, 'error'); setQuery({ social_error: null }); }
  }, [query.social_error]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-title-lg text-text-primary">Criativos</h1>
          <p className="text-[13px] text-text-secondary mt-1">Planeje, aprove, agende e publique o Instagram de cada cliente — integrado aos projetos e tarefas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn icon="photo_library" onClick={() => navigate('/creatives/library')}>Biblioteca</Btn>
          <Btn icon="campaign" onClick={() => navigate('/creatives/campaigns')}>Campanhas</Btn>
          {(perms.integrations || perms.accounts) && <IconBtn icon="tune" label="Integrações e regras" onClick={() => setSettingsOpen(true)} />}
          {perms.create && accounts.length > 0 && <Btn variant="primary" icon="add" onClick={() => newPublication({ socialAccountId: lastAccount?.id || accounts[0].id })}>Nova publicação</Btn>}
        </div>
      </header>

      {overview.error ? <ErrorState compact error={overview.error} onRetry={overview.reload} /> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 rounded-xl border border-border bg-surface-card overflow-hidden [&>*]:border-b lg:[&>*]:border-b-0 [&>*]:border-border">
          <Metric label="Este mês" value={m?.thisMonth} />
          <Metric label="Agendadas" value={m?.scheduled} />
          <Metric label="Aguardando aprovação" value={m?.pendingApproval} tone={m?.pendingApproval ? 'text-amber-300' : undefined} />
          <Metric label="Publicadas" value={m?.published} />
          <Metric label="Com erro" value={m?.failed} tone={m?.failed ? 'text-red-300' : undefined} />
          <Metric label="Campanhas ativas" value={m?.activeCampaigns} />
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-7 items-start">
        <section>
          <SectionTitle count={accounts.length} action={lastAccount && <Btn size="xs" variant="ghost" iconRight="arrow_forward" onClick={() => navigate(`/creatives/${lastAccount.id}/feed`)}>Continuar em @{lastAccount.username}</Btn>}>Contas de Instagram</SectionTitle>
          {accountsState.error ? <ErrorState compact error={accountsState.error} onRetry={accountsState.reload} /> : accountsState.loading && !accountsState.data ? (
            <div className="grid sm:grid-cols-2 gap-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {accounts.map(a => <AccountCard key={a.id} account={a} onOpen={() => navigate(`/creatives/${a.id}/feed`)} />)}
              {perms.accounts && (
                <button type="button" onClick={connect} disabled={busy || !ig?.configured}
                  title={!ig?.configured ? 'A integração com a Meta ainda não foi configurada neste ambiente' : undefined}
                  className="flex items-center justify-center gap-2 p-3 min-h-[76px] rounded-xl border border-dashed border-border hover:border-border-focus text-[13px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {busy ? <Spinner size={16} /> : <Icon name="add_link" size={18} />}Conectar conta Instagram
                </button>
              )}
            </div>
          )}
          {!accounts.length && !accountsState.loading && (
            <div className="mt-4">
              {ig?.configured
                ? <EmptyState compact icon="link_off" title="Nenhuma conta Instagram conectada" description={perms.accounts ? 'Conecte uma conta profissional pelo login oficial da Meta. O Taskly nunca pede a senha do Instagram.' : 'Peça a um proprietário ou gestor do workspace para conectar a conta.'} action={perms.accounts && <Btn variant="primary" icon="add_link" loading={busy} onClick={connect}>Conectar Instagram</Btn>} />
                : <Alert tone="warning"><strong>Instagram não conectado.</strong> A integração com a API oficial da Meta ainda não foi configurada neste ambiente{perms.integrations || perms.accounts ? <> — veja os requisitos em <button type="button" className="underline" onClick={() => setSettingsOpen(true)}>Integrações e regras</button></> : ''}. Biblioteca e campanhas já podem ser usadas.</Alert>}
            </div>
          )}

          {overview.data?.attention?.length > 0 && (
            <div className="mt-7">
              <SectionTitle count={overview.data.attention.length}>Precisa de atenção</SectionTitle>
              <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-1">
                {overview.data.attention.map(p => <UpcomingRow key={p.id} pub={p} account={accountById[p.socialAccountId]} onOpen={() => openPublication(p.id)} />)}
              </div>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-7">
          <section>
            <SectionTitle>Próximas publicações</SectionTitle>
            {overview.loading && !overview.data ? <Skeleton className="h-40 rounded-xl" /> : !overview.data?.upcoming?.length ? (
              <p className="text-[12px] text-text-muted">Nada agendado ou aprovado para os próximos dias.</p>
            ) : (
              <div className="flex flex-col">{overview.data.upcoming.map(p => <UpcomingRow key={p.id} pub={p} account={accountById[p.socialAccountId]} onOpen={() => openPublication(p.id)} />)}</div>
            )}
          </section>
          {h && (
            <section>
              <SectionTitle>Saúde do agendador</SectionTitle>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                <dt className="text-text-muted">Taxa de sucesso (30 dias)</dt><dd className="text-text-primary text-right">{h.successRate === null ? '—' : `${h.successRate}%`}</dd>
                <dt className="text-text-muted">Tempo médio de publicação</dt><dd className="text-text-primary text-right">{h.avgPublishMs === null ? '—' : `${(h.avgPublishMs / 1000).toFixed(1)} s`}</dd>
                <dt className="text-text-muted">Atrasadas</dt><dd className={`text-right ${h.delayed ? 'text-amber-300' : 'text-text-primary'}`}>{h.delayed}</dd>
                <dt className="text-text-muted">Em nova tentativa</dt><dd className="text-text-primary text-right">{h.retrying}</dd>
                <dt className="text-text-muted">Contas pedindo ação</dt><dd className={`text-right ${h.accountsNeedingAction ? 'text-amber-300' : 'text-text-primary'}`}>{h.accountsNeedingAction}</dd>
              </dl>
            </section>
          )}
        </aside>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------ account area

function AccountSwitcher({ account, section }) {
  const { navigate } = useApp();
  const { accounts } = useCreatives();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (accounts.length < 2) return null;
  return (
    <div className="relative" ref={ref}>
      <Btn size="sm" iconRight="unfold_more" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>Trocar conta</Btn>
      {open && (
        <div role="listbox" aria-label="Contas" className="absolute right-0 top-full mt-1 z-50 w-64 p-1.5 rounded-xl bg-surface border border-border shadow-modal animate-scaleIn">
          {accounts.map(a => (
            <button key={a.id} role="option" aria-selected={a.id === account.id} type="button" onClick={() => { setOpen(false); navigate(`/creatives/${a.id}/${section}`); }}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left ${a.id === account.id ? 'bg-surface-elevated' : 'hover:bg-surface-hover'}`}>
              <AccountAvatar account={a} size={26} />
              <span className="min-w-0 flex-1"><span className="block text-[12px] text-text-primary truncate">@{a.username}</span><span className="block text-[10px] text-text-muted truncate">{a.name}</span></span>
              <span className={`w-1.5 h-1.5 rounded-full ${ACCOUNT_STATUS[a.status]?.dot}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountArea({ accountId, section }) {
  const { currentWorkspaceId, navigate, query, setQuery, toast, showError, confirm } = useApp();
  const { accounts, accountsState, reloadAccounts, perms, dataVersion, bump } = useCreatives();
  const { connect, busy } = useConnect();
  const account = accounts.find(a => a.id === accountId);
  const stats = useAsync(() => (account ? api.publications.overview(currentWorkspaceId, { accountId }) : Promise.resolve(null)), [currentWorkspaceId, accountId, Boolean(account), dataVersion]);
  const [campaignFilter, setCampaignFilter] = useState(null);

  useEffect(() => { if (account) remember(currentWorkspaceId, account.id); }, [account, currentWorkspaceId]);
  useEffect(() => {
    if (query.social === 'connected') { toast('Conta do Instagram conectada', 'success'); setQuery({ social: null }); reloadAccounts(); const t = setTimeout(reloadAccounts, 4000); return () => clearTimeout(t); }
    return undefined;
  }, [query.social]); // eslint-disable-line react-hooks/exhaustive-deps

  if (accountsState.loading && !accountsState.data) return <Skeleton className="h-40 rounded-xl" />;
  if (!account) return <EmptyState icon="person_off" title="Conta não encontrada" description="Ela pode ter sido desconectada ou pertencer a outro workspace." action={<Btn onClick={() => navigate('/creatives')}>Voltar para Criativos</Btn>} />;

  const st = ACCOUNT_STATUS[account.status] || ACCOUNT_STATUS.ERROR;
  const m = stats.data?.metrics;
  const sync = async () => { try { await api.social.sync(account.id); toast('Sincronizando com o Instagram…', 'info'); setTimeout(() => { reloadAccounts(); bump(); }, 3500); } catch (err) { showError(err); } };
  const disconnect = async () => {
    if (!(await confirm({ title: `Desconectar @${account.username}?`, message: 'O token de acesso é apagado imediatamente e publicações agendadas desta conta não serão publicadas até ela ser reconectada. O histórico continua no Taskly.', confirmLabel: 'Desconectar', danger: true }))) return;
    try {
      const res = await api.social.disconnect(account.id);
      toast(res.scheduledAffected ? `Conta desconectada · ${res.scheduledAffected} publicação(ões) agendada(s) ficarão pendentes` : 'Conta desconectada', 'warning');
      await reloadAccounts();
      navigate('/creatives');
    } catch (err) { showError(err); }
  };
  const current = SECTIONS.find(s => s.id === section) ? section : 'feed';

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={() => navigate('/creatives')} className="self-start flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary"><Icon name="arrow_back" size={15} />Criativos</button>
      <header className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <AccountAvatar account={account} size={56} ring />
          <div className="min-w-0">
            <h1 className="text-title-md text-text-primary truncate">@{account.username}</h1>
            <p className="text-[12px] text-text-secondary truncate">{account.name}</p>
            <p className={`flex items-center gap-1.5 text-[11px] mt-0.5 ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}{account.lastSyncAt ? <span className="text-text-muted"> · sincronizado {new Date(account.lastSyncAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> : null}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountSwitcher account={account} section={current} />
          {perms.accounts && (
            <Menu trigger={p => <Btn size="sm" icon="more_horiz" onClick={p.toggle} aria-expanded={p['aria-expanded']} aria-haspopup="menu">Conta</Btn>} items={[
              account.status === 'CONNECTED' && { label: 'Sincronizar agora', icon: 'sync', onClick: sync },
              { label: 'Reconectar', icon: 'link', onClick: connect },
              '-',
              { label: 'Desconectar', icon: 'link_off', danger: true, onClick: disconnect }
            ]} />
          )}
        </div>
      </header>

      {account.status !== 'CONNECTED' && (
        <Alert tone="warning">
          <strong>{st.label}.</strong> {account.statusReason || 'Reconecte a conta para continuar agendando e publicando.'}{' '}
          {perms.accounts ? <button type="button" disabled={busy} className="underline font-medium" onClick={connect}>Reconectar Instagram</button> : 'Peça a um gestor para reconectar.'}
        </Alert>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          ['Publicações este mês', m?.thisMonth], ['Próximas', m?.scheduled], ['Aguardando aprovação', m?.pendingApproval, m?.pendingApproval ? 'text-amber-300' : ''],
          ['Com erro', m?.failed, m?.failed ? 'text-red-300' : ''], ['Campanhas ativas', m?.activeCampaigns]
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted truncate">{label}</div>
            <div className={`text-title-sm ${tone || 'text-text-primary'}`}>{value ?? '—'}</div>
          </div>
        ))}
      </div>

      <Tabs className="border-b border-border pb-2 -mx-1 px-1" value={current} onChange={id => { setCampaignFilter(null); navigate(`/creatives/${account.id}/${id}`); }}
        tabs={SECTIONS.map(s => ({ ...s, count: s.id === 'approvals' && m?.pendingApproval ? m.pendingApproval : undefined }))} />

      {current === 'feed' && <FeedPlanner account={account} />}
      {current === 'calendar' && <EditorialCalendar account={account} />}
      {current === 'publications' && (campaignFilter
        ? <><Alert tone="info">Campanha: <strong>{campaignFilter.name}</strong> <button type="button" className="underline ml-1" onClick={() => setCampaignFilter(null)}>limpar</button></Alert><PublicationsList key={campaignFilter.id} account={account} preset={{ campaignId: campaignFilter.id }} /></>
        : <PublicationsList account={account} />)}
      {current === 'approvals' && <ApprovalsView account={account} />}
      {current === 'drafts' && <PublicationsList account={account} preset={{ status: 'DRAFT', sort: 'updated' }} emptyTitle="Nenhum rascunho" emptyDescription="Rascunhos ficam aqui até serem enviados para aprovação." />}
      {current === 'published' && <PublicationsList account={account} preset={{ status: 'PUBLISHED', sort: '-date' }} showExternal allowedViews={['list', 'grid']} emptyTitle="Nada publicado pelo Taskly ainda" emptyDescription="Publicações confirmadas pela API do Instagram aparecem aqui, com o ID externo e o link." />}
      {current === 'campaigns' && <CampaignsView account={account} onOpenCampaign={c => { setCampaignFilter(c); navigate(`/creatives/${account.id}/publications`); }} />}
      {current === 'library' && <LibraryView />}
    </div>
  );
}

// ------------------------------------------------------------------ root

function CreativesRoot() {
  const { location, query, navigate } = useApp();
  const { perms } = useCreatives();
  const [, first, second] = location.segs;
  if (!perms.view) return <EmptyState icon="lock" title="Sem acesso a Criativos" description="Seu papel neste workspace não inclui o módulo Criativos." />;
  const back = <button type="button" onClick={() => navigate('/creatives')} className="self-start flex items-center gap-1 text-[12px] text-text-muted hover:text-text-primary mb-4"><Icon name="arrow_back" size={15} />Criativos</button>;
  let content;
  if (!first) content = <Hub />;
  else if (first === 'library') content = <div className="flex flex-col">{back}<h1 className="text-title-lg text-text-primary mb-5">Biblioteca de criativos</h1><LibraryView /></div>;
  else if (first === 'campaigns') content = <div className="flex flex-col">{back}<h1 className="text-title-lg text-text-primary mb-5">Campanhas</h1><CampaignsView /></div>;
  else content = <AccountArea accountId={first} section={second || 'feed'} />;
  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
      {content}
      {query.pub && <PublicationEditor key={query.pub} id={query.pub} />}
    </div>
  );
}

export function CreativesView() {
  return (
    <CreativesProvider>
      <CreativesRoot />
    </CreativesProvider>
  );
}
