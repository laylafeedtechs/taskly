import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDate, formatDateTime } from '../../lib/format';
import { Alert, AsyncBoundary, Btn, EmptyState, Field, Icon, Input, Modal, Pill, Select, Textarea } from '../ui';
import { Section, errorText } from './common';

const COUNT_LABEL = {
  memberships: 'Workspaces', sessions: 'Sessões ativas', tasksAssigned: 'Tarefas atribuídas a você', tasksCreated: 'Tarefas criadas',
  comments: 'Comentários', files: 'Arquivos enviados', activity: 'Registros de atividade', notifications: 'Notificações', securityLog: 'Registros de segurança'
};
const STATUS = {
  received: { label: 'Recebida', cls: undefined },
  in_progress: { label: 'Em andamento', cls: 'text-blue-400 bg-blue-500/10 border-blue-500/25' },
  completed: { label: 'Concluída', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  rejected: { label: 'Recusada', cls: 'text-red-400 bg-red-500/10 border-red-500/25' }
};

function MyData() {
  const { data, loading, error, reload } = useAsync(() => api.privacy.summary(), []);
  return (
    <Section title="Meus dados" description="O que o Taskly guarda sobre você e para quê.">
      <AsyncBoundary loading={loading} error={error} onRetry={reload} rows={3}>
        {data && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(data.counts).map(([k, n]) => (
                <div key={k} className="rounded-lg border border-border bg-background-secondary px-3 py-2">
                  <dt className="text-[11px] text-text-muted">{COUNT_LABEL[k] || k}</dt>
                  <dd className="text-[16px] font-semibold text-text-primary font-tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <ul className="flex flex-col divide-y divide-border border border-border rounded-lg">
              {data.categories.map(c => (
                <li key={c.key} className="px-3 py-2.5">
                  <div className="text-[13px] text-text-primary font-medium">{c.label}</div>
                  <div className="text-[12px] text-text-secondary mt-0.5">{c.fields}</div>
                  <div className="text-[11px] text-text-muted mt-1">Finalidade: {c.purpose} · Retenção: {c.retention}</div>
                </li>
              ))}
            </ul>
            <a href="/privacy" className="text-[12px] text-text-secondary hover:text-text-primary underline underline-offset-2 self-start">Ler a Política de Privacidade completa</a>
          </div>
        )}
      </AsyncBoundary>
    </Section>
  );
}

function ExportData() {
  const { toast, showError } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await api.privacy.exportData(); toast('Arquivo gerado', 'success'); } catch (err) { showError(err); } finally { setBusy(false); }
  };
  return (
    <Section title="Exportar meus dados" description="Baixe uma cópia dos seus dados pessoais em JSON, um formato estruturado que pode ser lido por outros sistemas (portabilidade)."
      actions={<Btn icon="download" loading={busy} onClick={run}>Baixar meus dados</Btn>}>
      <p className="text-[12px] text-text-muted">Inclui conta, participações, sessões, tarefas, comentários, arquivos, atividade, notificações e seus registros de segurança. Dados de outras pessoas não são incluídos. A exportação fica registrada na auditoria.</p>
    </Section>
  );
}

function Requests() {
  const { toast } = useApp();
  const { data, loading, error, reload, setData } = useAsync(() => api.privacy.requests(), []);
  const [form, setForm] = useState({ type: 'access', details: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setFormError('');
    try {
      const res = await api.privacy.createRequest(form.type, form.details.trim());
      setData(d => ({ ...d, requests: [res.request, ...(d?.requests || [])] }));
      setForm({ type: form.type, details: '' });
      toast('Solicitação registrada', 'success');
    } catch (err) { setFormError(errorText(err)); } finally { setBusy(false); }
  };
  const types = data?.types || {};
  return (
    <Section title="Solicitações sobre seus dados (LGPD)" description="Peça acesso, correção, eliminação, informações sobre compartilhamento e outros direitos previstos na LGPD.">
      <AsyncBoundary loading={loading} error={error} onRetry={reload} rows={2}>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-3 mb-5">
          <Field label="Tipo de solicitação">
            <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {Object.entries(types).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Detalhes (opcional)">
            <Textarea value={form.details} onChange={e => setForm(f => ({ ...f, details: e.target.value }))} maxLength={2000} className="min-h-[40px]" placeholder="Descreva o que você precisa" />
          </Field>
          {formError && <div className="sm:col-span-2"><Alert tone="danger">{formError}</Alert></div>}
          <div className="sm:col-span-2 flex justify-end"><Btn type="submit" variant="primary" loading={busy}>Enviar solicitação</Btn></div>
        </form>
        {data?.requests?.length ? (
          <ul className="flex flex-col divide-y divide-border border border-border rounded-lg">
            {data.requests.map(r => (
              <li key={r.id} className="px-3 py-3 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text-primary font-medium">{types[r.type] || r.type}</span>
                  <Pill className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label || r.status}</Pill>
                </div>
                <div className="text-[11px] text-text-muted">Aberta em {formatDateTime(r.createdAt)} · prazo de referência {formatDate(r.dueAt, { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                {r.details && <p className="text-[12px] text-text-secondary">{r.details}</p>}
                {r.response && <div className="mt-1 text-[12px] text-text-primary bg-background-secondary border border-border rounded-lg p-2"><strong>Resposta:</strong> {r.response}</div>}
              </li>
            ))}
          </ul>
        ) : <EmptyState compact icon="inbox" title="Nenhuma solicitação" description="Suas solicitações e respostas aparecem aqui." />}
      </AsyncBoundary>
    </Section>
  );
}

function DeleteAccount() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ confirmEmail: '', password: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.privacy.deleteAccount(form);
      window.location.href = '/';
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  const ready = form.confirmEmail.toLowerCase() === user.email.toLowerCase() && (!user.hasPassword || form.password) && (!user.mfaEnabled || form.code.length === 6);
  return (
    <Section title="Excluir minha conta" className="border-red-500/30"
      actions={<Btn variant="danger" icon="delete_forever" onClick={() => setOpen(true)}>Excluir conta</Btn>}>
      <ul className="text-[12px] text-text-secondary list-disc pl-5 space-y-1">
        <li>Sua conta, sessões, notificações e foto são apagadas. Workspaces em que você é a única pessoa são excluídos com todo o conteúdo.</li>
        <li>Se você for proprietário de um workspace com outros membros, transfira a propriedade antes.</li>
        <li>Comentários, arquivos e histórico que você deixou em workspaces compartilhados continuam para os outros membros, identificados como "Usuário removido".</li>
        <li>Registros de segurança e auditoria são mantidos pelo prazo de retenção, por segurança e prestação de contas. Backups são renovados automaticamente.</li>
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Excluir sua conta definitivamente" size="sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Alert tone="danger">Esta ação não pode ser desfeita.</Alert>
          <Field label={<>Digite <span className="font-mono text-text-primary">{user.email}</span> para confirmar</>} required>
            <Input value={form.confirmEmail} onChange={e => setForm(f => ({ ...f, confirmEmail: e.target.value }))} autoComplete="off" data-autofocus />
          </Field>
          {user.hasPassword && <Field label="Senha" required><Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="current-password" /></Field>}
          {user.mfaEnabled && <Field label="Código do aplicativo autenticador" required><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" maxLength={6} className="font-mono tracking-widest text-center" /></Field>}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Btn onClick={() => setOpen(false)}>Cancelar</Btn><Btn type="submit" variant="danger" loading={busy} disabled={!ready}>Excluir definitivamente</Btn></div>
        </form>
      </Modal>
    </Section>
  );
}

export function PrivacyCenterSection() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2 text-[12px] text-text-secondary"><Icon name="info" size={16} className="mt-px" />Aqui você controla seus dados pessoais: veja o que guardamos, baixe uma cópia, faça solicitações ou exclua sua conta.</div>
      <MyData />
      <ExportData />
      <Requests />
      <DeleteAccount />
    </div>
  );
}
