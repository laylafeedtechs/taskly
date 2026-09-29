import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Btn, Checkbox, Drawer, EmptyState, Field, Input, Modal, Pagination, Pill, Segmented, Toggle } from '../ui';
import { ResultBadge, RowMenu, SecretModal, Section, TableWrap, Td, Th, errorText } from './common';

const EVENT_LABEL = {
  'task.created': 'Tarefa criada',
  'task.updated': 'Tarefa atualizada',
  'task.completed': 'Tarefa concluída',
  'task.deleted': 'Tarefa excluída',
  'project.created': 'Projeto criado',
  'project.updated': 'Projeto atualizado',
  'member.added': 'Membro adicionado',
  'member.removed': 'Membro removido',
  'comment.created': 'Comentário criado'
};

const EMPTY = { name: '', url: '', events: ['task.created'], maxAttempts: 3, backoffSeconds: 5 };

function WebhookModal({ open, webhook, events, onClose, onSaved }) {
  const { currentWorkspaceId } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(webhook
      ? { name: webhook.name, url: webhook.url, events: webhook.events, maxAttempts: webhook.retryPolicy?.maxAttempts ?? 3, backoffSeconds: webhook.retryPolicy?.backoffSeconds ?? 5 }
      : EMPTY);
    setError(null);
  }, [open, webhook]);

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const toggleEvent = (ev, on) => set({ events: on ? [...form.events, ev] : form.events.filter(e => e !== ev) });

  const submit = async e => {
    e.preventDefault();
    if (!form.events.length) { setError('Selecione ao menos um evento.'); return; }
    setSaving(true); setError(null);
    const body = { name: form.name.trim(), url: form.url.trim(), events: form.events, retryPolicy: { maxAttempts: Number(form.maxAttempts), backoffSeconds: Number(form.backoffSeconds) } };
    try {
      const res = webhook ? await api.webhooks.update(webhook.id, body) : await api.webhooks.create(currentWorkspaceId, body);
      onSaved(res, !webhook);
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={webhook ? 'Editar webhook' : 'Novo webhook'} description="O Taskly enviará um POST assinado para a URL sempre que um evento selecionado ocorrer."
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" type="submit" form="webhook-form" loading={saving}>{webhook ? 'Salvar' : 'Criar webhook'}</Btn></>}>
      <form id="webhook-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome" required>
            <Input value={form.name} onChange={e => set({ name: e.target.value })} minLength={2} maxLength={80} required data-autofocus />
          </Field>
          <Field label="URL de destino" required hint="Endpoint público http(s). Endereços internos são bloqueados.">
            <Input type="url" value={form.url} onChange={e => set({ url: e.target.value })} placeholder="https://exemplo.com/webhooks/taskly" required maxLength={500} />
          </Field>
        </div>
        <fieldset>
          <legend className="text-[12px] font-medium text-text-secondary mb-2">Eventos</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {events.map(ev => (
              <label key={ev} className="flex items-center gap-2.5 text-[13px] text-text-primary cursor-pointer">
                <Checkbox checked={form.events.includes(ev)} onChange={on => toggleEvent(ev, on)} />
                <span className="min-w-0">{EVENT_LABEL[ev] || ev} <code className="text-[11px] font-mono text-text-muted">{ev}</code></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <Field label="Máx. de tentativas" hint="1 a 10">
            <Input type="number" min={1} max={10} value={form.maxAttempts} onChange={e => set({ maxAttempts: e.target.value })} required />
          </Field>
          <Field label="Intervalo inicial (s)" hint="Dobra a cada nova tentativa">
            <Input type="number" min={1} max={3600} value={form.backoffSeconds} onChange={e => set({ backoffSeconds: e.target.value })} required />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function DeliveriesDrawer({ webhook, onClose }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(
    () => (webhook ? api.webhooks.deliveries(webhook.id, { page, limit: 20, status: filter === 'failed' ? 'failed' : undefined }) : Promise.resolve(null)),
    [webhook?.id, page, filter]
  );
  useEffect(() => { setPage(1); setFilter('all'); }, [webhook?.id]);

  return (
    <Drawer open={Boolean(webhook)} onClose={onClose} width={620} title={webhook ? `Entregas — ${webhook.name}` : ''}>
      <div className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Segmented label="Filtrar entregas" value={filter} onChange={f => { setFilter(f); setPage(1); }} options={[{ value: 'all', label: 'Todas' }, { value: 'failed', label: 'Com falha' }]} />
          <Btn size="xs" icon="refresh" onClick={() => reload()} disabled={loading}>Atualizar</Btn>
        </div>
        <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!data?.deliveries?.length}
          emptyState={<EmptyState compact icon="outbox" title="Nenhuma entrega" description={filter === 'failed' ? 'Nenhuma falha registrada.' : 'As entregas aparecerão aqui quando eventos ocorrerem.'} />}>
          <TableWrap minWidth={540}>
            <thead><tr><Th>Data</Th><Th>Evento</Th><Th>Tentativa</Th><Th>Status</Th><Th>Resultado</Th><Th>Duração</Th></tr></thead>
            <tbody>
              {data?.deliveries.map(d => (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap font-mono text-[11px]">{formatDateTime(d.createdAt)}</Td>
                  <Td><code className="font-mono text-[11px]">{d.event}</code></Td>
                  <Td className="text-center">{d.attempt}</Td>
                  <Td className="font-mono">{d.statusCode ?? '—'}</Td>
                  <Td>
                    <ResultBadge success={d.success} />
                    {d.error && <div className="text-[11px] text-red-400 mt-1 max-w-[200px] break-words">{d.error}</div>}
                  </Td>
                  <Td className="whitespace-nowrap font-mono">{d.durationMs} ms</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={setPage} />
        </AsyncBoundary>
      </div>
    </Drawer>
  );
}

export function WebhooksSection() {
  const { can, currentWorkspaceId, confirm, toast, showError } = useApp();
  const allowed = can('webhooks.manage');
  const { data, loading, error, reload, setData } = useAsync(async () => {
    if (!allowed) return null;
    const [list, events] = await Promise.all([api.webhooks.list(currentWorkspaceId), api.webhooks.events()]);
    return { hooks: list.webhooks, events: events.events };
  }, [currentWorkspaceId, allowed]);
  const [modal, setModal] = useState(null);
  const [secret, setSecret] = useState(null);
  const [deliveriesFor, setDeliveriesFor] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const hooks = data?.hooks || [];
  const upsert = h => setData(d => ({ ...d, hooks: d.hooks.some(x => x.id === h.id) ? d.hooks.map(x => (x.id === h.id ? h : x)) : [...d.hooks, h] }));

  const onSaved = (res, created) => {
    upsert(res.webhook);
    setModal(null);
    if (created) setSecret({ value: res.secret, name: res.webhook.name });
    else toast('Webhook atualizado', 'success');
  };

  const toggleActive = async h => {
    upsert({ ...h, active: !h.active });
    try {
      const res = await api.webhooks.update(h.id, { active: !h.active });
      upsert(res.webhook);
      toast(res.webhook.active ? 'Webhook ativado' : 'Webhook pausado', 'success');
    } catch (err) { upsert(h); showError(err); }
  };

  const test = async h => {
    setTesting(h.id);
    try {
      const res = await api.webhooks.test(h.id);
      setTestResult({ hook: h, delivery: res.delivery });
      upsert({ ...h, lastDeliveryAt: res.delivery.createdAt, lastStatus: res.delivery.success ? 'SUCCESS' : 'FAILURE' });
    } catch (err) { showError(err); } finally { setTesting(null); }
  };

  const rotate = async h => {
    const ok = await confirm({ title: `Rotacionar o segredo de "${h.name}"?`, message: 'As próximas entregas serão assinadas com o novo segredo. Atualize a verificação no seu servidor.', confirmLabel: 'Rotacionar segredo', danger: true });
    if (!ok) return;
    try {
      const res = await api.webhooks.rotateSecret(h.id);
      upsert(res.webhook);
      setSecret({ value: res.secret, name: res.webhook.name });
    } catch (err) { showError(err); }
  };

  const remove = async h => {
    const ok = await confirm({ title: `Excluir "${h.name}"?`, message: 'As entregas para esta URL serão interrompidas.', confirmLabel: 'Excluir webhook', danger: true });
    if (!ok) return;
    try {
      await api.webhooks.remove(h.id);
      setData(d => ({ ...d, hooks: d.hooks.filter(x => x.id !== h.id) }));
      toast('Webhook excluído', 'success');
    } catch (err) { showError(err); }
  };

  if (!allowed) return <Section title="Webhooks"><Alert>Você não tem permissão para gerenciar webhooks neste workspace. Peça a um gestor ou ao proprietário.</Alert></Section>;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Webhooks" description="Receba eventos do Taskly em tempo real no seu servidor."
        actions={<Btn variant="primary" icon="add" disabled={!data} onClick={() => setModal({})}>Novo webhook</Btn>}>
        <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!hooks.length}
          emptyState={<EmptyState compact icon="webhook" title="Nenhum webhook" description="Crie um webhook para enviar eventos de tarefas e projetos a outros sistemas." />}>
          <TableWrap minWidth={900}>
            <thead><tr><Th>Nome</Th><Th>URL</Th><Th>Eventos</Th><Th>Ativo</Th><Th>Última entrega</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
            <tbody>
              {hooks.map(h => (
                <tr key={h.id}>
                  <Td>
                    <div className="text-text-primary font-medium">{h.name}</div>
                    <div className="text-[11px] text-text-muted font-mono">{h.secretHint}</div>
                  </Td>
                  <Td className="max-w-[260px]"><span className="block truncate font-mono text-[11px]" title={h.url}>{h.url}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1 max-w-[260px]">
                      {h.events.slice(0, 3).map(ev => <Pill key={ev}><span className="font-mono">{ev}</span></Pill>)}
                      {h.events.length > 3 && <Pill title={h.events.slice(3).join(', ')}>+{h.events.length - 3}</Pill>}
                    </div>
                  </Td>
                  <Td><Toggle checked={h.active} onChange={() => toggleActive(h)} label={<span className="sr-only">{`Webhook ${h.name} ativo`}</span>} /></Td>
                  <Td className="whitespace-nowrap">
                    {h.lastStatus
                      ? <div className="flex items-center gap-2"><ResultBadge success={h.lastStatus === 'SUCCESS'} /><span className="text-[11px] text-text-muted">{timeAgo(h.lastDeliveryAt)}</span></div>
                      : <span className="text-text-muted">Nenhuma</span>}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <Btn size="xs" icon="send" loading={testing === h.id} onClick={() => test(h)}>Testar</Btn>
                      <RowMenu label={`Ações do webhook ${h.name}`} items={[
                        { label: 'Ver entregas', icon: 'list_alt', onClick: () => setDeliveriesFor(h) },
                        { label: 'Editar', icon: 'edit', onClick: () => setModal({ webhook: h }) },
                        { label: 'Rotacionar segredo', icon: 'autorenew', onClick: () => rotate(h) },
                        '-',
                        { label: 'Excluir', icon: 'delete', danger: true, onClick: () => remove(h) }
                      ]} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </AsyncBoundary>
      </Section>

      <Section title="Verificando a assinatura">
        <div className="flex flex-col gap-2 text-[12px] text-text-secondary">
          <p>Cada entrega inclui os cabeçalhos <code className="font-mono text-text-primary">X-Taskly-Timestamp</code> e <code className="font-mono text-text-primary">X-Taskly-Signature</code>. Calcule o HMAC-SHA256 do timestamp, um ponto e o corpo bruto da requisição com o segredo do webhook e compare:</p>
          <pre className="text-[12px] font-mono bg-background-secondary border border-border rounded-lg p-3 overflow-x-auto text-text-primary">{`X-Taskly-Signature: sha256=HMAC(secret, timestamp + '.' + body)`}</pre>
          <p className="text-[11px] text-text-muted">Rejeite requisições com timestamp muito antigo para evitar replay. Falhas são repetidas conforme a política de tentativas, com intervalo dobrando a cada tentativa.</p>
        </div>
      </Section>

      {data && <WebhookModal open={Boolean(modal)} webhook={modal?.webhook} events={data.events} onClose={() => setModal(null)} onSaved={onSaved} />}
      <SecretModal secret={secret?.value} title="Segredo de assinatura" description={secret?.name} onClose={() => setSecret(null)} />
      <DeliveriesDrawer webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      <Modal open={Boolean(testResult)} onClose={() => setTestResult(null)} size="sm" title="Resultado do teste" description={testResult?.hook.name} footer={<Btn variant="primary" onClick={() => setTestResult(null)}>Fechar</Btn>}>
        {testResult && (
          <dl className="grid grid-cols-2 gap-3 text-[12px]">
            <dt className="text-text-muted">Resultado</dt><dd><ResultBadge success={testResult.delivery.success} /></dd>
            <dt className="text-text-muted">Código HTTP</dt><dd className="font-mono text-text-primary">{testResult.delivery.statusCode ?? '—'}</dd>
            <dt className="text-text-muted">Duração</dt><dd className="font-mono text-text-primary">{testResult.delivery.durationMs} ms</dd>
            {testResult.delivery.error && <><dt className="text-text-muted">Erro</dt><dd className="text-red-400 break-words">{testResult.delivery.error}</dd></>}
          </dl>
        )}
      </Modal>
    </div>
  );
}
