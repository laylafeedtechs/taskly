// Admin Center — privacy governance: controller data, retention, data-subject
// requests, security incidents and backups.
import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDate, formatDateTime, timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Btn, Checkbox, Drawer, EmptyState, Field, Input, Modal, Pagination, Pill, Segmented, Select, Textarea } from '../ui';
import { Section, TableWrap, Td, Th, errorText } from '../settings/common';

const RETENTION_LABEL = {
  notificationsDays: 'Notificações', trashDays: 'Itens na lixeira', invitationsDays: 'Convites encerrados',
  systemEventsDays: 'Eventos de sistema', webhookDeliveriesDays: 'Entregas de webhook', automationLogsDays: 'Logs de automação',
  auditLogsDays: 'Registros de auditoria', auditIpDays: 'IP/navegador na auditoria (depois truncados)',
  closedIncidentsDays: 'Incidentes encerrados', privacyRequestsDays: 'Solicitações concluídas', backupsKeep: 'Backups mantidos (quantidade)'
};
const CONTROLLER_FIELDS = [
  ['controllerName', 'Controlador (razão social ou nome)'], ['controllerDocument', 'CNPJ/CPF'], ['controllerAddress', 'Endereço'],
  ['contactEmail', 'E-mail de contato para privacidade'], ['dpoName', 'Encarregado (DPO)'], ['dpoEmail', 'E-mail do encarregado'], ['policyVersion', 'Versão da política']
];

// ---------------------------------------------------------------- privacy

export function AdminPrivacy() {
  const { toast, confirm } = useApp();
  const policy = useAsync(() => api.privacy.policy(), []);
  const retention = useAsync(() => api.admin.retention(), []);
  const [controller, setController] = useState(null);
  const [ret, setRet] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!policy.data) return;
    const p = policy.data;
    setController({ controllerName: p.controller.name || '', controllerDocument: p.controller.document || '', controllerAddress: p.controller.address || '', contactEmail: p.controller.contactEmail || '', dpoName: p.dpo.name || '', dpoEmail: p.dpo.email || '', policyVersion: p.version || '', reviewedByLegal: p.reviewedByLegal });
  }, [policy.data]);
  useEffect(() => { if (retention.data) setRet(retention.data.retention); }, [retention.data]);

  const saveController = async e => {
    e.preventDefault();
    setBusy('controller'); setMsg(null);
    try { await api.admin.updatePrivacy(controller); toast('Dados do controlador salvos', 'success'); policy.reload(); } catch (err) { setMsg(errorText(err)); } finally { setBusy(null); }
  };
  const saveRetention = async e => {
    e.preventDefault();
    setBusy('retention'); setMsg(null);
    try { await api.admin.updateRetention(Object.fromEntries(Object.entries(ret).map(([k, v]) => [k, Number(v)]))); toast('Política de retenção salva', 'success'); } catch (err) { setMsg(errorText(err)); } finally { setBusy(null); }
  };
  const runNow = async () => {
    if (!(await confirm({ title: 'Executar a retenção agora?', message: 'Registros além dos prazos configurados serão removidos ou anonimizados. Itens vencidos na lixeira serão excluídos definitivamente.', confirmLabel: 'Executar', danger: true }))) return;
    setBusy('run');
    try {
      const { counts } = await api.admin.runRetention();
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      toast(total ? `Retenção aplicada: ${total} registro(s)` : 'Nada a remover', 'success');
    } catch (err) { setMsg(errorText(err)); } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col gap-5">
      {msg && <Alert tone="danger">{msg}</Alert>}
      <Section title="Controlador e encarregado" description="Estes dados aparecem na Política de Privacidade pública (/privacy)."
        actions={<a href="/privacy" target="_blank" rel="noopener" className="text-[12px] text-text-secondary hover:text-text-primary underline">Ver política</a>}>
        <AsyncBoundary loading={policy.loading} error={policy.error} onRetry={policy.reload} rows={3}>
          {controller && (
            <form onSubmit={saveController} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {CONTROLLER_FIELDS.map(([k, label]) => (
                <Field key={k} label={label}><Input value={controller[k]} onChange={e => setController(c => ({ ...c, [k]: e.target.value }))} maxLength={200} /></Field>
              ))}
              <label className="sm:col-span-2 flex items-start gap-2.5 text-[12px] text-text-secondary cursor-pointer">
                <Checkbox checked={controller.reviewedByLegal} onChange={v => setController(c => ({ ...c, reviewedByLegal: v }))} label="Revisado juridicamente" className="mt-0.5" />
                <span>O conteúdo da política foi revisado pela assessoria jurídica. Enquanto desmarcado, a página pública exibe o aviso de rascunho técnico.</span>
              </label>
              <div className="sm:col-span-2 flex justify-end"><Btn type="submit" variant="primary" loading={busy === 'controller'}>Salvar</Btn></div>
            </form>
          )}
        </AsyncBoundary>
      </Section>

      <Section title="Política de retenção" description="Prazos em dias (0 = manter indefinidamente). Os padrões são sugestões técnicas — valide com o jurídico."
        actions={<Btn icon="auto_delete" loading={busy === 'run'} onClick={runNow}>Executar retenção agora</Btn>}>
        <AsyncBoundary loading={retention.loading} error={retention.error} onRetry={retention.reload} rows={3}>
          {ret && (
            <form onSubmit={saveRetention} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.keys(RETENTION_LABEL).map(k => (
                  <Field key={k} label={RETENTION_LABEL[k]} hint={`Padrão: ${retention.data.defaults[k]}`}>
                    <Input type="number" min={k === 'backupsKeep' ? 1 : 0} max={3650} value={ret[k]} onChange={e => setRet(r => ({ ...r, [k]: e.target.value }))} />
                  </Field>
                ))}
              </div>
              <div className="flex justify-end"><Btn type="submit" variant="primary" loading={busy === 'retention'}>Salvar prazos</Btn></div>
            </form>
          )}
        </AsyncBoundary>
      </Section>

      {policy.data && (
        <Section title="Operadores e cookies" description="Levantamento técnico exibido na política pública.">
          <div className="flex flex-col gap-4">
            <TableWrap minWidth={640}>
              <thead><tr><Th>Serviço</Th><Th>Dados</Th><Th>Localização</Th><Th>Situação</Th></tr></thead>
              <tbody>{policy.data.processors.map(p => <tr key={p.name}><Td className="text-text-primary">{p.name}</Td><Td>{p.data}</Td><Td>{p.location}</Td><Td>{p.active ? <Pill className="text-blue-400 bg-blue-500/10 border-blue-500/25">Em uso</Pill> : <Pill>Inativo</Pill>}</Td></tr>)}</tbody>
            </TableWrap>
            <TableWrap minWidth={560}>
              <thead><tr><Th>Cookie</Th><Th>Categoria</Th><Th>Finalidade</Th><Th>Duração</Th></tr></thead>
              <tbody>{policy.data.cookies.map(c => <tr key={c.name}><Td className="font-mono text-text-primary">{c.name}</Td><Td>{c.category}</Td><Td>{c.purpose}</Td><Td>{c.duration}</Td></tr>)}</tbody>
            </TableWrap>
          </div>
        </Section>
      )}
    </div>
  );
}

// ------------------------------------------------------- data-subject requests

const REQ_STATUS = {
  received: { label: 'Recebida', cls: undefined },
  in_progress: { label: 'Em andamento', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/25' },
  completed: { label: 'Concluída', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  rejected: { label: 'Recusada', cls: 'text-red-400 bg-red-500/10 border-red-500/25' }
};

export function AdminPrivacyRequests() {
  const { toast } = useApp();
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const list = useAsync(() => api.admin.privacyRequests({ status, page }), [status, page]);
  const types = list.data?.types || {};

  const save = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.admin.updatePrivacyRequest(editing.id, { status: editing.status, response: editing.response || '' });
      toast('Solicitação atualizada', 'success');
      setEditing(null);
      list.reload();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <Segmented label="Status" value={status} onChange={s => { setStatus(s); setPage(1); }}
        options={[{ value: 'ALL', label: 'Todas' }, ...Object.entries(REQ_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
      <AsyncBoundary loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!list.data?.requests.length}
        emptyState={<EmptyState icon="inbox" title="Nenhuma solicitação" description="Solicitações de titulares feitas pela Central de Privacidade aparecem aqui." />}>
        <TableWrap minWidth={820}>
          <thead><tr><Th>Tipo</Th><Th>Titular</Th><Th>Aberta</Th><Th>Prazo de referência</Th><Th>Status</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
          <tbody>
            {list.data?.requests.map(r => {
              const overdue = !['completed', 'rejected'].includes(r.status) && r.dueAt < new Date().toISOString();
              return (
                <tr key={r.id}>
                  <Td className="text-text-primary">{types[r.type] || r.type}</Td>
                  <Td><div className="text-text-primary">{r.userName}</div><div className="text-[11px] text-text-muted">{r.userEmail || '—'}</div></Td>
                  <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                  <Td className={`whitespace-nowrap ${overdue ? 'text-red-400 font-medium' : ''}`}>{formatDate(r.dueAt, { day: '2-digit', month: 'short', year: 'numeric' })}{overdue && ' · vencido'}</Td>
                  <Td><Pill className={REQ_STATUS[r.status]?.cls}>{REQ_STATUS[r.status]?.label}</Pill></Td>
                  <Td className="text-right"><Btn size="xs" onClick={() => setEditing({ ...r })}>Tratar</Btn></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <Pagination page={list.data?.page || 1} totalPages={list.data?.totalPages} onChange={setPage} />
      </AsyncBoundary>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? types[editing.type] : ''} description={editing ? `${editing.userName} · ${editing.userEmail || ''}` : ''}
        footer={<><Btn onClick={() => setEditing(null)}>Cancelar</Btn><Btn variant="primary" type="submit" form="privreq-form" loading={busy}>Salvar</Btn></>}>
        {editing && (
          <form id="privreq-form" onSubmit={save} className="flex flex-col gap-4">
            {editing.details && <div className="text-[13px] text-text-secondary bg-background-secondary border border-border rounded-lg p-3">{editing.details}</div>}
            <Alert tone="info">Prazo de referência: {formatDate(editing.dueAt, { day: '2-digit', month: 'long', year: 'numeric' })} (15 dias, LGPD art. 19, II — confirme com o encarregado). Para acesso e portabilidade, o titular também pode usar "Exportar meus dados".</Alert>
            <Field label="Status"><Select value={editing.status} onChange={e => setEditing(x => ({ ...x, status: e.target.value }))}>{Object.entries(REQ_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
            <Field label="Resposta ao titular" hint="Enviada por notificação quando a solicitação é concluída ou recusada."><Textarea value={editing.response || ''} onChange={e => setEditing(x => ({ ...x, response: e.target.value }))} maxLength={4000} rows={5} /></Field>
            {error && <Alert tone="danger">{error}</Alert>}
          </form>
        )}
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------- incidents

const SEVERITY = { high: { label: 'Alta', cls: 'text-red-400 bg-red-500/10 border-red-500/25' }, medium: { label: 'Média', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/25' }, low: { label: 'Baixa', cls: undefined } };
const INC_STATUS = { open: 'Aberto', investigating: 'Em investigação', closed: 'Encerrado' };
const TRI = [{ value: 'null', label: 'Não avaliado' }, { value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }];
const QUESTIONS = [['involvesPersonalData', 'Envolve dados pessoais?'], ['relevantRisk', 'Pode causar risco ou dano relevante aos titulares?'], ['communicationRequired', 'A comunicação à ANPD e aos titulares é necessária?']];

function IncidentDrawer({ id, onClose, onChanged }) {
  const { toast } = useApp();
  const detail = useAsync(() => api.admin.incident(id), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inc = detail.data?.incident;

  const update = async patch => {
    setBusy(true); setError(null);
    try {
      const res = await api.admin.updateIncident(id, patch);
      detail.setData(d => ({ ...d, incident: res.incident }));
      onChanged();
      toast('Incidente atualizado', 'success');
      return true;
    } catch (err) { setError(errorText(err)); return false; } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} width={560} title={inc?.title || 'Incidente'}>
      <div className="p-5">
        <AsyncBoundary loading={detail.loading} error={detail.error} onRetry={detail.reload} rows={4}>
          {inc && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className={SEVERITY[inc.severity]?.cls}>Severidade {SEVERITY[inc.severity]?.label}</Pill>
                <span className="text-[12px] text-text-muted">Detectado {formatDateTime(inc.detectedAt)}</span>
              </div>
              <p className="text-[13px] text-text-secondary">{inc.summary}</p>
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Status">
                <Select value={inc.status} disabled={busy} onChange={e => update({ status: e.target.value })}>{Object.entries(INC_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              </Field>

              <section className="flex flex-col gap-3">
                <h3 className="text-[13px] font-semibold text-text-primary">Avaliação</h3>
                <p className="text-[12px] text-text-muted">A detecção automática só indica uma suspeita. A decisão de comunicar a ANPD e os titulares é uma avaliação humana do controlador, com o encarregado.</p>
                {QUESTIONS.map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Select value={String(inc.assessment[k])} disabled={busy} onChange={e => update({ [k]: e.target.value === 'null' ? null : e.target.value === 'true' })}>
                      {TRI.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </Field>
                ))}
                {inc.assessment.communicationDeadline && (
                  <Alert tone="danger">
                    <strong>Prazo de referência para comunicação: {formatDateTime(inc.assessment.communicationDeadline)}</strong> (3 dias úteis a partir da confirmação em {formatDateTime(inc.assessment.confirmedAt)}). Feriados não considerados — confirme com o encarregado e o texto vigente da Resolução CD/ANPD nº 15/2024.
                  </Alert>
                )}
                <Field label="Data da comunicação (se feita)">
                  <Input type="date" value={inc.assessment.communicatedAt || ''} disabled={busy} onChange={e => update({ communicatedAt: e.target.value || null })} />
                </Field>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">Notas e medidas tomadas</h3>
                {inc.notes.length ? (
                  <ul className="flex flex-col gap-2">{inc.notes.map((n, i) => <li key={i} className="text-[12px] bg-background-secondary border border-border rounded-lg p-2.5"><div className="text-text-muted text-[11px] mb-1">{n.by} · {formatDateTime(n.at)}</div><div className="text-text-primary whitespace-pre-line">{n.text}</div></li>)}</ul>
                ) : <p className="text-[12px] text-text-muted">Nenhuma nota ainda.</p>}
                <Textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Descreva a análise, a contenção e as medidas tomadas" aria-label="Nova nota" />
                <Btn className="self-end" disabled={!note.trim()} loading={busy} onClick={async () => { if (await update({ note: note.trim() })) setNote(''); }}>Adicionar nota</Btn>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">Evidências ({detail.data.evidence.length})</h3>
                <TableWrap minWidth={480}>
                  <thead><tr><Th>Data</Th><Th>Ação</Th><Th>Ator</Th><Th>IP</Th></tr></thead>
                  <tbody>{detail.data.evidence.map(e => <tr key={e.id}><Td className="whitespace-nowrap">{formatDateTime(e.timestamp)}</Td><Td className="font-mono text-[11px]">{e.action}</Td><Td>{e.actor}</Td><Td className="font-mono text-[11px]">{e.ip || '—'}</Td></tr>)}</tbody>
                </TableWrap>
              </section>
            </div>
          )}
        </AsyncBoundary>
      </div>
    </Drawer>
  );
}

export function AdminIncidents() {
  const [status, setStatus] = useState('ALL');
  const [openId, setOpenId] = useState(null);
  const list = useAsync(() => api.admin.incidents({ status }), [status]);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">Incidentes são abertos automaticamente a partir da trilha de auditoria (força bruta, acessos negados repetidos, exportações e exclusões em massa, falhas de MFA, acessos de suporte). Uma tentativa bloqueada não é, por si só, um incidente com dados pessoais.</Alert>
      <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'ALL', label: 'Todos' }, ...Object.entries(INC_STATUS).map(([value, label]) => ({ value, label }))]} />
      <AsyncBoundary loading={list.loading && !list.data} error={list.error} onRetry={list.reload} empty={!list.data?.incidents.length}
        emptyState={<EmptyState icon="verified_user" title="Nenhum incidente" description="Nada suspeito foi detectado com os filtros atuais." />}>
        <TableWrap minWidth={720}>
          <thead><tr><Th>Severidade</Th><Th>Incidente</Th><Th>Detectado</Th><Th>Status</Th><Th>Prazo</Th></tr></thead>
          <tbody>
            {list.data?.incidents.map(i => (
              <tr key={i.id} className="hover:bg-surface-hover/50 cursor-pointer" onClick={() => setOpenId(i.id)}>
                <Td><Pill className={SEVERITY[i.severity]?.cls}>{SEVERITY[i.severity]?.label}</Pill></Td>
                <Td><button type="button" className="text-left text-text-primary hover:underline" onClick={e => { e.stopPropagation(); setOpenId(i.id); }}>{i.title}</button><div className="text-[11px] text-text-muted">{i.summary}</div></Td>
                <Td className="whitespace-nowrap" title={formatDateTime(i.detectedAt)}>{timeAgo(i.detectedAt)}</Td>
                <Td>{INC_STATUS[i.status]}</Td>
                <Td className="whitespace-nowrap">{i.assessment.communicationDeadline ? <span className="text-red-400">{formatDateTime(i.assessment.communicationDeadline)}</span> : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </AsyncBoundary>
      {openId && <IncidentDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- backups

export function AdminBackups() {
  const { toast, showError } = useApp();
  const data = useAsync(() => api.admin.backups(), []);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await api.admin.runBackup();
      toast(res.status.verified ? 'Backup gerado e verificado' : 'Backup gerado, mas a verificação falhou', res.status.verified ? 'success' : 'error');
      data.reload();
    } catch (err) { showError(err); } finally { setBusy(false); }
  };
  const status = data.data?.status;
  return (
    <div className="flex flex-col gap-5">
      <Section title="Backups" description="Cópias do banco cifradas com AES-256-GCM, guardadas fora do diretório de dados. A chave fica separada dos backups."
        actions={<Btn variant="primary" icon="backup" loading={busy} onClick={run}>Gerar backup agora</Btn>}>
        <AsyncBoundary loading={data.loading && !data.data} error={data.error} onRetry={data.reload} rows={3}>
          <div className="flex flex-col gap-4">
            {status ? (
              <Alert tone={status.ok && status.verified ? 'success' : 'danger'}>
                Último backup: {formatDateTime(status.at)} ({status.reason === 'manual' ? 'manual' : 'automático'}) — {status.ok ? `${status.file}, ${status.verified ? 'restauração de teste OK' : 'restauração de teste FALHOU'}` : `falhou: ${status.error}`}
              </Alert>
            ) : <Alert tone="warning">Nenhum backup registrado ainda.</Alert>}
            {data.data?.backups.length ? (
              <TableWrap minWidth={480}>
                <thead><tr><Th>Arquivo</Th><Th>Tamanho</Th><Th>Data</Th></tr></thead>
                <tbody>{data.data.backups.map(b => <tr key={b.name}><Td className="font-mono text-[11px] text-text-primary">{b.name}</Td><Td>{(b.size / 1024).toFixed(0)} KB</Td><Td>{formatDateTime(b.createdAt)}</Td></tr>)}</tbody>
              </TableWrap>
            ) : null}
            <div className="text-[12px] text-text-secondary space-y-1">
              <p>Restaurar é possível apenas no console do servidor, com o servidor parado: <span className="font-mono text-text-primary">npm run backup:restore -- &lt;arquivo&gt;</span>.</p>
              <p>Guarde uma cópia da chave de criptografia (<span className="font-mono">TASKLY_ENCRYPTION_KEY</span> ou o arquivo em <span className="font-mono">~/.taskly</span>) em local seguro e separado: sem ela os backups não podem ser restaurados.</p>
            </div>
          </div>
        </AsyncBoundary>
      </Section>
    </div>
  );
}
