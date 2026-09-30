import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Btn, EmptyState, Field, Input, Modal, Textarea, Toggle } from '../ui';
import { RowMenu, Section, errorText } from '../settings/common';

function FlagModal({ open, flag, onClose, onSaved }) {
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({ key: flag?.key || '', name: flag?.name || '', description: flag?.description || '' });
    setError(null);
  }, [open, flag]);

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const submit = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = { name: form.name.trim(), description: form.description.trim() };
      const res = flag ? await api.admin.updateFlag(flag.id, body) : await api.admin.createFlag({ ...body, key: form.key.trim() });
      onSaved(res.featureFlag, !flag);
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={flag ? 'Editar feature flag' : 'Nova feature flag'}
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" type="submit" form="flag-form" loading={saving}>{flag ? 'Salvar' : 'Criar flag'}</Btn></>}>
      <form id="flag-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Chave" required hint={flag ? 'A chave não pode ser alterada.' : 'Letras minúsculas, números e hífens. Ex.: nova-timeline'}>
          <Input value={form.key} onChange={e => set({ key: e.target.value.toLowerCase() })} disabled={Boolean(flag)} pattern="[a-z0-9-]+" minLength={2} maxLength={60} required className="font-mono" data-autofocus={!flag || undefined} />
        </Field>
        <Field label="Nome" required><Input value={form.name} onChange={e => set({ name: e.target.value })} minLength={2} maxLength={80} required data-autofocus={flag ? true : undefined} /></Field>
        <Field label="Descrição"><Textarea value={form.description} onChange={e => set({ description: e.target.value })} maxLength={300} /></Field>
      </form>
    </Modal>
  );
}

export function AdminFlags() {
  const { confirm, toast, showError } = useApp();
  const { data, loading, error, reload, setData } = useAsync(() => api.admin.flags(), []);
  const [modal, setModal] = useState(null);
  const flags = data?.featureFlags || [];
  const upsert = f => setData(d => ({ ...d, featureFlags: d.featureFlags.some(x => x.id === f.id) ? d.featureFlags.map(x => (x.id === f.id ? f : x)) : [...d.featureFlags, f] }));

  const toggle = async f => {
    upsert({ ...f, enabled: !f.enabled });
    try {
      const res = await api.admin.updateFlag(f.id, { enabled: !f.enabled });
      upsert(res.featureFlag);
      toast(`${f.name} ${res.featureFlag.enabled ? 'ativada' : 'desativada'}`, 'success');
    } catch (err) { upsert(f); showError(err); }
  };

  const remove = async f => {
    const ok = await confirm({ title: `Excluir a flag "${f.key}"?`, message: 'Recursos que dependem desta flag passarão a considerá-la desativada.', confirmLabel: 'Excluir flag', danger: true });
    if (!ok) return;
    try {
      await api.admin.deleteFlag(f.id);
      setData(d => ({ ...d, featureFlags: d.featureFlags.filter(x => x.id !== f.id) }));
      toast('Flag excluída', 'success');
    } catch (err) { showError(err); }
  };

  const onSaved = (flag, created) => { upsert(flag); setModal(null); toast(created ? 'Flag criada' : 'Flag atualizada', 'success'); };

  return (
    <Section title="Feature flags" description="Ative ou desative recursos para toda a plataforma. As mudanças valem no próximo carregamento do app."
      actions={<Btn variant="primary" icon="add" onClick={() => setModal({})}>Nova flag</Btn>}>
      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!flags.length}
        emptyState={<EmptyState compact icon="flag" title="Nenhuma feature flag" />}>
        <ul className="divide-y divide-border-subtle border border-border rounded-lg">
          {flags.map(f => (
            <li key={f.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-text-primary font-medium">{f.name}</span>
                  <code className="text-[11px] font-mono text-text-muted">{f.key}</code>
                </div>
                {f.description && <p className="text-[12px] text-text-secondary mt-0.5">{f.description}</p>}
                {f.updatedAt && <p className="text-[11px] text-text-muted mt-0.5">Atualizada {timeAgo(f.updatedAt)}</p>}
              </div>
              <Toggle checked={f.enabled} onChange={() => toggle(f)} label={<span className="sr-only">{`Ativar ${f.name}`}</span>} />
              <RowMenu label={`Ações da flag ${f.key}`} items={[
                { label: 'Editar', icon: 'edit', onClick: () => setModal({ flag: f }) },
                '-',
                { label: 'Excluir', icon: 'delete', danger: true, onClick: () => remove(f) }
              ]} />
            </li>
          ))}
        </ul>
      </AsyncBoundary>
      <FlagModal open={Boolean(modal)} flag={modal?.flag} onClose={() => setModal(null)} onSaved={onSaved} />
    </Section>
  );
}

function SettingsForm({ settings, onSaved }) {
  const { toast, confirm } = useApp();
  const initial = { allowSignup: settings.allowSignup !== false, maintenanceBanner: settings.maintenanceBanner || '', sessionDays: settings.sessionDays || 7, requireMfaForAdmins: settings.requireMfaForAdmins !== false };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const daysInvalid = !(Number(form.sessionDays) >= 1 && Number(form.sessionDays) <= 30);

  const submit = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      if (initial.requireMfaForAdmins && !form.requireMfaForAdmins) {
        const ok = await confirm({ title: 'Deixar de exigir MFA dos Super Admins?', message: 'Contas com acesso total à plataforma ficarão protegidas apenas por senha. Não é recomendado.', confirmLabel: 'Desativar exigência', danger: true, requireText: 'DESATIVAR' });
        if (!ok) { setSaving(false); return; }
      }
      const res = await api.admin.updateSettings({ allowSignup: form.allowSignup, maintenanceBanner: form.maintenanceBanner.trim(), sessionDays: Number(form.sessionDays), requireMfaForAdmins: form.requireMfaForAdmins });
      onSaved(res.settings);
      toast('Configurações do sistema salvas', 'success');
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 max-w-2xl">
      {error && <Alert tone="danger">{error}</Alert>}
      <Toggle checked={form.allowSignup} onChange={allowSignup => setForm(f => ({ ...f, allowSignup }))} label="Permitir cadastro público" description="Quando desativado, novas contas só podem ser criadas por administradores ou por convite." />
      <Toggle checked={form.requireMfaForAdmins} onChange={requireMfaForAdmins => setForm(f => ({ ...f, requireMfaForAdmins }))} label="Exigir MFA para Super Admins" description="O Admin Center e o acesso de suporte só funcionam em sessões verificadas com o segundo fator. Recomendado." />
      <Field label="Aviso de manutenção" hint="Exibido no topo do app para todos os usuários. Deixe vazio para ocultar (máx. 300 caracteres).">
        <Textarea value={form.maintenanceBanner} onChange={e => setForm(f => ({ ...f, maintenanceBanner: e.target.value }))} maxLength={300} className="min-h-[64px]" />
      </Field>
      <Field label="Duração da sessão (dias)" hint="Entre 1 e 30. Aplica-se a novos logins." error={daysInvalid ? 'Informe um valor entre 1 e 30' : undefined}>
        <Input type="number" min={1} max={30} value={form.sessionDays} onChange={e => setForm(f => ({ ...f, sessionDays: e.target.value }))} required className="max-w-[140px]" />
      </Field>
      <div><Btn type="submit" variant="primary" loading={saving} disabled={!dirty || daysInvalid}>Salvar configurações</Btn></div>
    </form>
  );
}

export function AdminSystemSettings() {
  const { data, loading, error, reload, setData } = useAsync(() => api.admin.settings(), []);
  return (
    <Section title="Configurações do sistema" description="Valem para toda a instalação do Taskly.">
      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload}>
        {data && <SettingsForm key={JSON.stringify(data.settings)} settings={data.settings} onSaved={settings => setData({ settings })} />}
      </AsyncBoundary>
    </Section>
  );
}
