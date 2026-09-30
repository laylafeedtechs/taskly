import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, fileToBase64 } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Avatar, Btn, Field, Icon, Input, Modal, Pill } from '../ui';
import { Section, errorText } from './common';
import { MfaSection, EmailStatusSection } from './MfaSection';

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_MAX = 2 * 1024 * 1024;

function AvatarEditor() {
  const { user, setUser, toast, showError } = useApp();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const upload = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) { setError('Formato não suportado. Use PNG, JPG, WEBP ou GIF.'); return; }
    if (file.size > AVATAR_MAX) { setError('A imagem deve ter no máximo 2 MB.'); return; }
    setError(null); setBusy(true);
    try {
      const res = await api.auth.uploadAvatar(file.name, await fileToBase64(file));
      setUser(res.user);
      toast('Foto atualizada', 'success');
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await api.auth.removeAvatar();
      setUser(res.user);
      toast('Foto removida', 'success');
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <Avatar user={user} size={72} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Btn icon="upload" loading={busy} onClick={() => inputRef.current?.click()}>Enviar foto</Btn>
          {user.avatar && <Btn variant="ghost" icon="delete" disabled={busy} onClick={remove}>Remover</Btn>}
        </div>
        <p className="text-[11px] text-text-muted">PNG, JPG, WEBP ou GIF, até 2 MB.</p>
        <input ref={inputRef} type="file" accept={AVATAR_TYPES.join(',')} className="sr-only" onChange={upload} aria-label="Selecionar foto de perfil" tabIndex={-1} />
      </div>
      {error && <div className="sm:ml-auto"><Alert tone="danger">{error}</Alert></div>}
    </div>
  );
}

export function ProfileSection() {
  const { user, setUser, toast } = useApp();
  const [form, setForm] = useState({ name: user.name, email: user.email, currentPassword: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const emailChanged = form.email.trim().toLowerCase() !== user.email.toLowerCase();
  const dirty = form.name.trim() !== user.name || emailChanged;

  const save = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = { name: form.name.trim() };
      if (emailChanged) Object.assign(body, { email: form.email.trim(), currentPassword: form.currentPassword });
      const res = await api.auth.updateProfile(body);
      setUser(res.user);
      setForm({ name: res.user.name, email: res.user.email, currentPassword: '' });
      toast('Perfil atualizado', 'success');
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section title="Foto de perfil" description="Exibida para os membros dos seus workspaces."><AvatarEditor /></Section>
      <Section title="Informações pessoais">
        <form onSubmit={save} className="flex flex-col gap-4 max-w-xl">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Nome completo" required>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} minLength={2} maxLength={80} required autoComplete="name" />
          </Field>
          <Field label="E-mail" hint={user.hasPassword ? 'Alterar o e-mail exige a confirmação da sua senha atual.' : 'Esta conta entra pelo Google (sem senha), por isso o e-mail não pode ser alterado aqui. Defina uma senha em Segurança para liberar a alteração.'}>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} disabled={!user.hasPassword} required autoComplete="email" />
          </Field>
          {emailChanged && user.hasPassword && (
            <Field label="Senha atual" required>
              <Input type="password" value={form.currentPassword} onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))} required autoComplete="current-password" />
            </Field>
          )}
          <div><Btn type="submit" variant="primary" loading={saving} disabled={!dirty}>Salvar alterações</Btn></div>
        </form>
      </Section>
    </div>
  );
}

function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  const mobile = /Mobile|Android|iPhone/.test(ua);
  return { label: [browser, os].filter(Boolean).join(' · ') || 'Dispositivo desconhecido', icon: mobile ? 'smartphone' : 'computer' };
}

function PasswordForm({ onChanged }) {
  const { user, setUser, toast } = useApp();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const mismatch = form.confirm && form.next !== form.confirm;
  const tooShort = form.next && form.next.length < 8;

  const submit = async e => {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setSaving(true); setError(null);
    try {
      await api.auth.changePassword(user.hasPassword ? form.current : undefined, form.next);
      setForm({ current: '', next: '', confirm: '' });
      if (!user.hasPassword) setUser({ ...user, hasPassword: true });
      toast(user.hasPassword ? 'Senha alterada. As outras sessões foram encerradas.' : 'Senha definida com sucesso', 'success');
      onChanged();
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 max-w-xl">
      {error && <Alert tone="danger">{error}</Alert>}
      {!user.hasPassword && <Alert>Sua conta ainda não tem senha (acesso pelo Google ou por link de convite). Defina uma para também entrar com e-mail e senha.</Alert>}
      {user.hasPassword && (
        <Field label="Senha atual" required>
          <Input type="password" value={form.current} onChange={set('current')} required autoComplete="current-password" />
        </Field>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nova senha" required error={tooShort ? 'Mínimo de 8 caracteres' : undefined} hint="Mínimo de 8 caracteres">
          <Input type="password" value={form.next} onChange={set('next')} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Confirmar nova senha" required error={mismatch ? 'As senhas não conferem' : undefined}>
          <Input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
        </Field>
      </div>
      <div><Btn type="submit" variant="primary" loading={saving} disabled={!form.next || mismatch || tooShort}>{user.hasPassword ? 'Alterar senha' : 'Definir senha'}</Btn></div>
    </form>
  );
}

const GOOGLE_ERRORS = {
  google_not_configured: 'O login com Google ainda não foi configurado neste servidor.',
  google_in_use: 'Essa conta Google já está vinculada a outro usuário do Taskly.',
  oauth_cancelled: 'O vínculo com o Google foi cancelado.',
  oauth_state: 'A solicitação expirou. Tente vincular novamente.',
  oauth_unverified: 'O e-mail dessa conta Google não está verificado.',
  session_required: 'Sua sessão mudou durante o vínculo. Tente novamente.',
  link_forbidden: 'Não é possível vincular o Google durante um acesso de suporte.',
  oauth_failed: 'Não foi possível concluir o vínculo com o Google.'
};

// Link / unlink a Google account for signing in. The outcome of the Google
// redirect arrives as ?google=linked or ?auth_error=<code>.
function GoogleSection() {
  const { user, setUser, query, setQuery, toast, loadSession, auth } = useApp();
  const [available, setAvailable] = useState(null);
  const [unlinking, setUnlinking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.auth.providers().then(p => setAvailable(p.google)).catch(() => setAvailable(false)); }, []);
  useEffect(() => {
    if (query.google === 'linked') { toast('Conta Google vinculada', 'success'); loadSession(); setQuery({ google: null }); }
    else if (query.auth_error) { toast(GOOGLE_ERRORS[query.auth_error] || GOOGLE_ERRORS.oauth_failed, 'error'); setQuery({ auth_error: null }); }
  }, [query.google, query.auth_error]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlink = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await api.auth.unlinkGoogle(password);
      setUser(res.user);
      setUnlinking(false); setPassword('');
      toast('Conta Google desvinculada', 'success');
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const linked = user.googleLinked;
  const action = linked
    ? <Btn variant="danger" onClick={() => setUnlinking(true)}>Desvincular</Btn>
    : <a href={available && !auth.impersonatedBy ? api.auth.googleLinkUrl() : undefined} aria-disabled={!available}
        onClick={e => { if (!available) { e.preventDefault(); toast(GOOGLE_ERRORS.google_not_configured, 'warning'); } }}
        className={`inline-flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-surface-card text-[12px] font-medium text-text-primary ${available ? 'hover:bg-surface-hover' : 'opacity-60 cursor-not-allowed'}`}>
        <Icon name="link" size={16} />Vincular conta Google
      </a>;

  return (
    <Section title="Conta Google" description="Entre no Taskly com um clique usando sua conta Google." actions={action}>
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-surface-elevated border border-border flex items-center justify-center"><Icon name="account_circle" size={18} className="text-text-secondary" /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-text-primary">{linked ? 'Vinculada' : 'Não vinculada'}</div>
          <div className="text-[11px] text-text-muted">
            {linked ? 'Você pode entrar com a conta Google vinculada ou com sua senha.' : available === false ? 'O administrador do servidor ainda não configurou o login com Google.' : 'Você será levado ao Google para escolher a conta. Usamos apenas o identificador, o nome e o e-mail verificado.'}
          </div>
        </div>
        <Pill className={linked ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : undefined}>{linked ? 'Ativa' : 'Inativa'}</Pill>
      </div>
      {linked && !user.hasPassword && <div className="mt-4"><Alert tone="info">Para desvincular o Google, defina antes uma senha na seção abaixo — assim você não perde o acesso à conta.</Alert></div>}
      <Modal open={unlinking} onClose={() => setUnlinking(false)} title="Desvincular conta Google" size="sm">
        <form onSubmit={unlink} className="flex flex-col gap-4">
          <p className="text-[13px] text-text-secondary">Depois disso, você entrará apenas com e-mail e senha.</p>
          <Field label="Confirme sua senha" required><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" data-autofocus /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Btn onClick={() => setUnlinking(false)}>Cancelar</Btn><Btn type="submit" variant="danger" loading={busy} disabled={!password || !user.hasPassword}>Desvincular</Btn></div>
        </form>
      </Modal>
    </Section>
  );
}

export function SecuritySection() {
  const { user, confirm, toast, showError } = useApp();
  const { data, loading, error, reload, setData } = useAsync(() => api.auth.sessions(), []);
  const [revoking, setRevoking] = useState(null);
  const sessions = [...(data?.sessions || [])].sort((a, b) => (b.current - a.current) || (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
  const others = sessions.filter(s => !s.current);

  const revoke = async ids => {
    setRevoking(ids.length === 1 ? ids[0] : 'all');
    const results = await Promise.allSettled(ids.map(id => api.auth.revokeSession(id)));
    const failed = results.find(r => r.status === 'rejected');
    const revoked = new Set(ids.filter((_, i) => results[i].status === 'fulfilled'));
    setData(d => ({ ...d, sessions: d.sessions.filter(s => !revoked.has(s.id)) }));
    setRevoking(null);
    if (failed) showError(failed.reason); else toast(ids.length === 1 ? 'Sessão encerrada' : 'Outras sessões encerradas', 'success');
  };

  const revokeOthers = async () => {
    const ok = await confirm({ title: 'Sair de todos os outros dispositivos?', message: `${others.length} sessão(ões) serão desconectadas. Esta sessão continua ativa.`, confirmLabel: 'Encerrar sessões', danger: true });
    if (!ok) return;
    setRevoking('all');
    try {
      await api.auth.revokeOtherSessions();
      setData(d => ({ ...d, sessions: d.sessions.filter(x => x.current) }));
      toast('Outras sessões encerradas', 'success');
    } catch (err) { showError(err); } finally { setRevoking(null); }
  };

  return (
    <div className="flex flex-col gap-5">
      <MfaSection />
      <EmailStatusSection />
      <Section title={user.hasPassword ? 'Alterar senha' : 'Definir senha'} description="Ao alterar a senha, as demais sessões são encerradas automaticamente.">
        <PasswordForm onChanged={reload} />
      </Section>

      <Section title="Sessões ativas" description="Dispositivos conectados à sua conta."
        actions={others.length > 0 && <Btn variant="danger" icon="logout" loading={revoking === 'all'} onClick={revokeOthers}>Sair de todos os outros dispositivos</Btn>}>
        <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!sessions.length} rows={2}>
          <ul className="divide-y divide-border-subtle border border-border rounded-lg">
            {sessions.map(s => {
              const device = describeDevice(s.device);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <span className="w-9 h-9 rounded-lg bg-surface-elevated border border-border flex items-center justify-center flex-shrink-0"><Icon name={device.icon} size={18} className="text-text-secondary" /></span>
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2 text-[13px] text-text-primary">
                      {device.label}
                      {s.current && <Pill className="text-emerald-400 bg-emerald-500/10 border-emerald-500/25">Esta sessão</Pill>}
                      {s.mfa && <Pill title="Autenticada com verificação em duas etapas">MFA</Pill>}
                      {s.support && <Pill className="text-amber-400 bg-amber-500/10 border-amber-500/25" title="Sessão aberta por um administrador para suporte">Acesso de suporte</Pill>}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {s.ip || 'IP desconhecido'} · ativa {timeAgo(s.lastSeenAt)} · iniciada em {formatDateTime(s.createdAt)}
                    </div>
                  </div>
                  {!s.current && <Btn size="xs" variant="ghost" icon="close" loading={revoking === s.id} disabled={Boolean(revoking)} onClick={() => revoke([s.id])}>Encerrar</Btn>}
                </li>
              );
            })}
          </ul>
        </AsyncBoundary>
      </Section>

      <GoogleSection />
    </div>
  );
}
