import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDate, formatDateTime, timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Btn, Checkbox, EmptyState, Field, Input, Modal, Pill } from '../ui';
import { RowMenu, SecretModal, Section, TableWrap, Td, Th, errorText } from './common';

const SCOPE_LABEL = {
  'tasks:read': 'Ler tarefas',
  'tasks:write': 'Criar e editar tarefas',
  'projects:read': 'Ler projetos',
  'projects:write': 'Criar e editar projetos',
  'reports:read': 'Ler relatórios'
};

const keyStatus = k => (k.revokedAt ? 'revoked' : k.expiresAt && Date.parse(k.expiresAt) < Date.now() ? 'expired' : 'active');
const STATUS_PILL = {
  active: <Pill className="text-emerald-400 bg-emerald-500/10 border-emerald-500/25">Ativa</Pill>,
  expired: <Pill className="text-amber-400 bg-amber-500/10 border-amber-500/25">Expirada</Pill>,
  revoked: <Pill className="text-red-400 bg-red-500/10 border-red-500/25">Revogada</Pill>
};

function KeyModal({ open, apiKey, scopes, onClose, onSaved }) {
  const { currentWorkspaceId } = useApp();
  const [form, setForm] = useState({ name: '', scopes: ['tasks:read'], expiresInDays: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(apiKey ? { name: apiKey.name, scopes: apiKey.scopes, expiresInDays: '' } : { name: '', scopes: ['tasks:read'], expiresInDays: '' });
    setError(null);
  }, [open, apiKey]);

  const toggleScope = (scope, on) => setForm(f => ({ ...f, scopes: on ? [...f.scopes, scope] : f.scopes.filter(s => s !== scope) }));

  const submit = async e => {
    e.preventDefault();
    if (!form.scopes.length) { setError('Selecione ao menos um escopo.'); return; }
    setSaving(true); setError(null);
    try {
      const body = { name: form.name.trim(), scopes: form.scopes };
      const res = apiKey
        ? await api.apiKeys.update(apiKey.id, body)
        : await api.apiKeys.create(currentWorkspaceId, { ...body, expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : undefined });
      onSaved(res, !apiKey);
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={apiKey ? 'Editar chave de API' : 'Nova chave de API'} description="Chaves dão acesso somente a este workspace, limitado aos escopos escolhidos."
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" type="submit" form="apikey-form" loading={saving}>{apiKey ? 'Salvar' : 'Gerar chave'}</Btn></>}>
      <form id="apikey-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nome" required hint="Identifique onde a chave será usada, ex.: “Integração CRM”.">
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} minLength={2} maxLength={80} required data-autofocus />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-medium text-text-secondary mb-1.5">Escopos</legend>
          {scopes.map(scope => (
            <label key={scope} className="flex items-center gap-2.5 text-[13px] text-text-primary cursor-pointer">
              <Checkbox checked={form.scopes.includes(scope)} onChange={on => toggleScope(scope, on)} />
              <span>{SCOPE_LABEL[scope] || scope}</span>
              <code className="text-[11px] font-mono text-text-muted">{scope}</code>
            </label>
          ))}
          <p className="text-[11px] text-text-muted">Escopos de escrita incluem a leitura correspondente.</p>
        </fieldset>
        {!apiKey && (
          <Field label="Validade (dias)" hint="Opcional, de 1 a 730. Deixe vazio para não expirar.">
            <Input type="number" min={1} max={730} value={form.expiresInDays} onChange={e => setForm(f => ({ ...f, expiresInDays: e.target.value }))} className="max-w-[160px]" />
          </Field>
        )}
      </form>
    </Modal>
  );
}

export function ApiKeysSection() {
  const { can, currentWorkspaceId, confirm, toast, showError } = useApp();
  const allowed = can('apikeys.manage');
  const { data, loading, error, reload, setData } = useAsync(async () => {
    if (!allowed) return null;
    const [list, scopes] = await Promise.all([api.apiKeys.list(currentWorkspaceId), api.apiKeys.scopes()]);
    return { keys: list.apiKeys, scopes: scopes.scopes };
  }, [currentWorkspaceId, allowed]);
  const [modal, setModal] = useState(null); // null | { apiKey? }
  const [secret, setSecret] = useState(null);

  const keys = [...(data?.keys || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const upsert = k => setData(d => ({ ...d, keys: d.keys.some(x => x.id === k.id) ? d.keys.map(x => (x.id === k.id ? k : x)) : [k, ...d.keys] }));

  const onSaved = (res, created) => {
    upsert(res.apiKey);
    setModal(null);
    if (created) setSecret({ value: res.secret, name: res.apiKey.name });
    else toast('Chave atualizada', 'success');
  };

  const rotate = async k => {
    const ok = await confirm({ title: `Rotacionar "${k.name}"?`, message: 'Uma nova chave será gerada e a atual deixará de funcionar imediatamente. Atualize suas integrações em seguida.', confirmLabel: 'Rotacionar', danger: true });
    if (!ok) return;
    try {
      const res = await api.apiKeys.rotate(k.id);
      upsert(res.apiKey);
      setSecret({ value: res.secret, name: res.apiKey.name });
    } catch (err) { showError(err); }
  };

  const revoke = async k => {
    const ok = await confirm({ title: `Revogar "${k.name}"?`, message: 'Integrações que usam esta chave pararão de funcionar. Esta ação não pode ser desfeita.', confirmLabel: 'Revogar chave', danger: true });
    if (!ok) return;
    try {
      const res = await api.apiKeys.revoke(k.id);
      upsert(res.apiKey);
      toast('Chave revogada', 'success');
    } catch (err) { showError(err); }
  };

  if (!allowed) return <Section title="Chaves de API"><Alert>Você não tem permissão para gerenciar chaves de API neste workspace. Peça a um gestor ou ao proprietário.</Alert></Section>;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Chaves de API" description="Acesse a API REST do Taskly a partir de outros sistemas."
        actions={<Btn variant="primary" icon="add" disabled={!data} onClick={() => setModal({})}>Nova chave</Btn>}>
        <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!keys.length}
          emptyState={<EmptyState compact icon="key" title="Nenhuma chave criada" description="Crie uma chave para integrar o Taskly com outras ferramentas." />}>
          <TableWrap minWidth={980}>
            <thead><tr><Th>Nome</Th><Th>Chave</Th><Th>Escopos</Th><Th>Criada por</Th><Th>Criada</Th><Th>Último uso</Th><Th>Expira</Th><Th>Status</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
            <tbody>
              {keys.map(k => {
                const status = keyStatus(k);
                return (
                  <tr key={k.id} className={status === 'revoked' ? 'opacity-60' : ''}>
                    <Td className="text-text-primary font-medium">{k.name}</Td>
                    <Td><code className="font-mono text-[11px]">{k.keyPrefix}</code></Td>
                    <Td><div className="flex flex-wrap gap-1">{k.scopes.map(s => <Pill key={s}><span className="font-mono">{s}</span></Pill>)}</div></Td>
                    <Td>{k.createdByName || '—'}</Td>
                    <Td className="whitespace-nowrap">{formatDate(k.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                    <Td className="whitespace-nowrap" title={k.lastUsedAt ? formatDateTime(k.lastUsedAt) : undefined}>{k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Nunca'}</Td>
                    <Td className="whitespace-nowrap">{k.expiresAt ? formatDate(k.expiresAt, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Não expira'}</Td>
                    <Td>{STATUS_PILL[status]}</Td>
                    <Td className="text-right w-12">
                      {status !== 'revoked' && (
                        <RowMenu label={`Ações da chave ${k.name}`} items={[
                          { label: 'Editar', icon: 'edit', onClick: () => setModal({ apiKey: k }) },
                          { label: 'Rotacionar', icon: 'autorenew', onClick: () => rotate(k) },
                          '-',
                          { label: 'Revogar', icon: 'block', danger: true, onClick: () => revoke(k) }
                        ]} />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </AsyncBoundary>
      </Section>

      <Section title="Como usar">
        <p className="text-[12px] text-text-secondary mb-2">Envie a chave no cabeçalho <code className="font-mono text-text-primary">Authorization</code> de cada requisição:</p>
        <pre className="text-[12px] font-mono bg-background-secondary border border-border rounded-lg p-3 overflow-x-auto text-text-primary">{`curl -H "Authorization: Bearer <chave>" \\\n  ${window.location.origin}/api/tasks/workspace/${currentWorkspaceId}`}</pre>
        <p className="text-[11px] text-text-muted mt-2">Guarde as chaves em um cofre de segredos e nunca as exponha no navegador. Chaves não acessam o Admin Center nem ações de conta.</p>
      </Section>

      {data && <KeyModal open={Boolean(modal)} apiKey={modal?.apiKey} scopes={data.scopes} onClose={() => setModal(null)} onSaved={onSaved} />}
      <SecretModal secret={secret?.value} title="Sua nova chave de API" description={secret?.name} onClose={() => setSecret(null)} />
    </div>
  );
}
