import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Alert, Btn, Checkbox, Field, Icon, Input, Modal, Pill } from '../ui';
import { Section, errorText } from './common';

const codeInput = { inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6, placeholder: '000000', className: 'font-mono tracking-widest text-center' };

function downloadCodes(codes, email) {
  const text = `Taskly — códigos de recuperação (${email})\nCada código pode ser usado uma única vez.\nGerados em ${new Date().toLocaleString('pt-BR')}\n\n${codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: 'taskly-codigos-de-recuperacao.txt' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Shown once: the user must confirm they stored the codes before closing.
function RecoveryCodes({ codes, email, onDone }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">Guarde estes códigos em um local seguro. Cada um funciona <strong>uma única vez</strong> se você perder o celular, e eles <strong>não serão exibidos novamente</strong>.</Alert>
      <ul className="grid grid-cols-2 gap-2 font-mono text-[13px] text-text-primary bg-background-secondary border border-border rounded-lg p-3" aria-label="Códigos de recuperação">
        {codes.map(c => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Btn icon="content_copy" onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copiar</Btn>
        <Btn icon="download" onClick={() => downloadCodes(codes, email)}>Baixar .txt</Btn>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
        <Checkbox checked={saved} onChange={setSaved} label="Guardei meus códigos" />Guardei meus códigos em um local seguro
      </label>
      <div className="flex justify-end"><Btn variant="primary" disabled={!saved} onClick={onDone}>Concluir</Btn></div>
    </div>
  );
}

function EnableWizard({ onClose }) {
  const { user, setUser, loadSession, toast } = useApp();
  const [step, setStep] = useState(user.hasPassword ? 'password' : 'start');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true); setError('');
    try { setSetup(await api.mfa.setup(password)); setStep('scan'); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const confirmCode = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.mfa.enable(code);
      setUser(res.user);
      setCodes(res.recoveryCodes);
      setStep('codes');
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  const finish = async () => { await loadSession(); toast('Verificação em duas etapas ativada', 'success'); onClose(); };

  return (
    <Modal open onClose={step === 'codes' ? () => {} : onClose} dismissable={step !== 'codes'} title="Ativar verificação em duas etapas" size="md">
      {(step === 'password' || step === 'start') && (
        <form onSubmit={e => { e.preventDefault(); start(); }} className="flex flex-col gap-4">
          <p className="text-[13px] text-text-secondary">Você vai precisar de um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</p>
          {step === 'password' && <Field label="Confirme sua senha atual" required><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" data-autofocus /></Field>}
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancelar</Btn><Btn type="submit" variant="primary" loading={busy} disabled={step === 'password' && !password}>Continuar</Btn></div>
        </form>
      )}
      {step === 'scan' && setup && (
        <form onSubmit={e => { e.preventDefault(); confirmCode(); }} className="flex flex-col gap-4">
          <p className="text-[13px] text-text-secondary">1. Escaneie o QR code com o aplicativo autenticador.</p>
          <img src={setup.qrCode} alt="QR code para configurar o aplicativo autenticador" className="w-44 h-44 rounded-lg bg-white p-2 self-center" />
          <details className="text-[12px] text-text-secondary">
            <summary className="cursor-pointer">Não consegue escanear? Digite a chave manualmente</summary>
            <p className="mt-2 font-mono text-text-primary break-all select-all bg-background-secondary border border-border rounded-lg p-2">{setup.secret}</p>
          </details>
          <Field label="2. Digite o código de 6 dígitos exibido no aplicativo" required>
            <Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} {...codeInput} data-autofocus />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancelar</Btn><Btn type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>Ativar</Btn></div>
        </form>
      )}
      {step === 'codes' && codes && <RecoveryCodes codes={codes} email={user.email} onDone={finish} />}
    </Modal>
  );
}

function DisableModal({ onClose }) {
  const { user, setUser, toast } = useApp();
  const [form, setForm] = useState({ password: '', code: '', recovery: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await api.mfa.disable({ password: form.password, ...(form.recovery ? { recoveryCode: form.code } : { code: form.code }) });
      setUser(res.user);
      toast('Verificação em duas etapas desativada', 'warning');
      onClose();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Desativar verificação em duas etapas" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Alert tone="warning">Sua conta ficará protegida apenas pela senha.{user.isSuperAdmin ? ' Você perderá o acesso ao Admin Center.' : ''}</Alert>
        {user.hasPassword && <Field label="Senha atual" required><Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="current-password" data-autofocus /></Field>}
        <Field label={form.recovery ? 'Código de recuperação' : 'Código do aplicativo'} required>
          <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} {...(form.recovery ? { className: 'font-mono' } : codeInput)} />
        </Field>
        <button type="button" onClick={() => setForm(f => ({ ...f, recovery: !f.recovery, code: '' }))} className="self-start text-[12px] text-text-secondary hover:text-text-primary">{form.recovery ? 'Usar código do aplicativo' : 'Usar código de recuperação'}</button>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancelar</Btn><Btn type="submit" variant="danger" loading={busy} disabled={!form.code || (user.hasPassword && !form.password)}>Desativar</Btn></div>
      </form>
    </Modal>
  );
}

function RegenerateModal({ onClose }) {
  const { user } = useApp();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try { setCodes((await api.mfa.regenerateCodes(code)).recoveryCodes); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={codes ? () => {} : onClose} dismissable={!codes} title="Gerar novos códigos de recuperação" size="sm">
      {codes ? <RecoveryCodes codes={codes} email={user.email} onDone={onClose} /> : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-[13px] text-text-secondary">Os códigos antigos deixam de funcionar imediatamente.</p>
          <Field label="Código do aplicativo" required><Input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} {...codeInput} data-autofocus /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancelar</Btn><Btn type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>Gerar códigos</Btn></div>
        </form>
      )}
    </Modal>
  );
}

export function MfaSection() {
  const { user, auth } = useApp();
  const [modal, setModal] = useState(null);
  const enabled = user.mfaEnabled;
  return (
    <Section title="Verificação em duas etapas (MFA)" description="Além da senha, pede um código do aplicativo autenticador a cada login."
      actions={enabled ? <>
        <Btn icon="key" onClick={() => setModal('codes')}>Novos códigos de recuperação</Btn>
        <Btn variant="danger" onClick={() => setModal('disable')}>Desativar</Btn>
      </> : <Btn variant="primary" icon="verified_user" onClick={() => setModal('enable')}>Ativar</Btn>}>
      <div className="flex items-center gap-3">
        <span className={`w-9 h-9 rounded-lg border flex items-center justify-center ${enabled ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-surface-elevated border-border text-text-muted'}`}><Icon name={enabled ? 'verified_user' : 'gpp_maybe'} size={18} /></span>
        <div className="flex-1 min-w-0 text-[13px] text-text-primary">{enabled ? 'Ativada' : 'Desativada'}</div>
        <Pill className={enabled ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : undefined}>{enabled ? 'Protegida' : 'Recomendado'}</Pill>
      </div>
      {user.isSuperAdmin && auth.requireMfaForAdmins && !enabled && <div className="mt-4"><Alert tone="warning">Como Super Admin, você precisa ativar o MFA para acessar o Admin Center.</Alert></div>}
      {user.isSuperAdmin && enabled && !auth.sessionMfa && !auth.impersonatedBy && <div className="mt-4"><Alert tone="info">Esta sessão foi aberta sem MFA. Saia e entre novamente para acessar o Admin Center.</Alert></div>}
      {modal === 'enable' && <EnableWizard onClose={() => setModal(null)} />}
      {modal === 'disable' && <DisableModal onClose={() => setModal(null)} />}
      {modal === 'codes' && <RegenerateModal onClose={() => setModal(null)} />}
    </Section>
  );
}

export function EmailStatusSection() {
  const { user, toast, showError } = useApp();
  const [busy, setBusy] = useState(false);
  const verified = user.emailVerified !== false;
  const resend = async () => {
    setBusy(true);
    try { await api.auth.resendVerification(); toast('Enviamos um novo link de confirmação', 'success'); } catch (err) { showError(err); } finally { setBusy(false); }
  };
  return (
    <Section title="E-mail da conta" actions={!verified && <Btn icon="send" loading={busy} onClick={resend}>Reenviar confirmação</Btn>}>
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg bg-surface-elevated border border-border flex items-center justify-center"><Icon name={verified ? 'mark_email_read' : 'mark_email_unread'} size={18} className={verified ? 'text-emerald-400' : 'text-amber-400'} /></span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] text-text-primary truncate">{user.email}</div>
          <div className="text-[11px] text-text-muted">{verified ? 'Confirmado' : 'Aguardando confirmação — verifique sua caixa de entrada.'}</div>
        </div>
      </div>
    </Section>
  );
}
