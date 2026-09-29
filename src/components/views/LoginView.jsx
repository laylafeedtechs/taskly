import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Btn, Field, Input, Alert, Icon } from '../ui';
import { ROLE_LABEL } from '../../lib/format';
import { InstallAppButton } from '../common/InstallAppButton';

const AUTH_ERRORS = {
  google_not_configured: 'O login com Google não está configurado neste servidor (defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).',
  oauth_cancelled: 'O login com Google foi cancelado.',
  oauth_state: 'A sessão de login expirou ou é inválida. Tente novamente.',
  oauth_failed: 'Não foi possível concluir o login com Google. Tente novamente.',
  oauth_unverified: 'Seu e-mail do Google não está verificado.',
  account_blocked: 'Esta conta foi suspensa. Contate o administrador.',
  signup_disabled: 'Novos cadastros estão desativados neste servidor.'
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

export function LoginView() {
  const { query, setQuery, loadSession, auth, navigate } = useApp();
  const resetToken = query.reset;
  const [mode, setMode] = useState(resetToken ? 'reset' : 'login');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(query.auth_error ? AUTH_ERRORS[query.auth_error] || 'Falha na autenticação.' : '');
  const [notice, setNotice] = useState(auth.expired ? 'Sua sessão expirou. Entre novamente.' : '');
  const [providers, setProviders] = useState({ google: false, allowSignup: true });
  const [invite, setInvite] = useState(null);
  const inviteToken = query.invite || sessionStorage.getItem('taskly.invite');

  useEffect(() => {
    api.auth.providers().then(setProviders).catch(() => {});
    if (query.auth_error) setQuery({ auth_error: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!inviteToken) return;
    sessionStorage.setItem('taskly.invite', inviteToken);
    api.workspaces.previewInvite(inviteToken).then(p => {
      setInvite(p);
      setForm(f => ({ ...f, email: p.email }));
      if (!p.accountExists) setMode(m => (m === 'login' ? 'signup' : m));
    }).catch(err => { setInvite({ invalid: err.message }); sessionStorage.removeItem('taskly.invite'); });
  }, [inviteToken]);

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const switchMode = m => { setMode(m); setError(''); setNotice(''); };

  const submit = async e => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await api.auth.login(form.email, form.password);
        await loadSession();
      } else if (mode === 'signup') {
        await api.auth.signup(form.name, form.email, form.password);
        await loadSession();
      } else if (mode === 'forgot') {
        const res = await api.auth.forgotPassword(form.email);
        setNotice(res.message);
      } else if (mode === 'reset') {
        if (form.password !== form.confirm) throw new Error('As senhas não coincidem');
        await api.auth.resetPassword(resetToken, form.password);
        setQuery({ reset: null });
        setMode('login');
        setForm(f => ({ ...f, password: '', confirm: '' }));
        setNotice('Senha redefinida. Entre com a nova senha.');
        if (auth.status === 'authed') navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Falha na autenticação. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const titles = {
    login: ['Entrar no Taskly', 'Bem-vindo de volta'],
    signup: ['Criar sua conta', 'Comece a organizar o trabalho da sua equipe'],
    forgot: ['Recuperar senha', 'Enviaremos um link de redefinição para o seu e-mail'],
    reset: ['Definir nova senha', 'Escolha uma senha com pelo menos 8 caracteres']
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] animate-fadeIn">
        <div className="flex flex-col items-center gap-3 mb-7">
          <img src="/logo.svg" alt="" className="w-11 h-11" />
          <div className="text-center">
            <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">{titles[mode][0]}</h1>
            <p className="text-[13px] text-text-secondary mt-1">{titles[mode][1]}</p>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 sm:p-7 shadow-modal">
          {invite && !invite.invalid && (
            <div className="mb-5"><Alert tone="info" icon="mail">
              <strong className="text-text-primary">{invite.invitedBy || 'Alguém'}</strong> convidou você para <strong className="text-text-primary">{invite.workspaceName}</strong> como {ROLE_LABEL[invite.role]}. {invite.accountExists ? 'Entre com' : 'Crie uma conta com'} <span className="font-mono">{invite.email}</span> para aceitar.
            </Alert></div>
          )}
          {invite?.invalid && <div className="mb-5"><Alert tone="warning">{invite.invalid}</Alert></div>}

          {(mode === 'login' || mode === 'signup') && (
            <div role="tablist" className="flex gap-1 p-1 bg-background-secondary border border-border rounded-xl mb-5">
              {[['login', 'Entrar'], ['signup', 'Criar conta']].filter(([m]) => m === 'login' || providers.allowSignup || invite).map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
                  className={`flex-1 h-8 text-[13px] font-medium rounded-lg transition-colors ${mode === m ? 'bg-surface-elevated text-text-primary border border-border' : 'text-text-muted hover:text-text-secondary'}`}>{label}</button>
              ))}
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {mode === 'signup' && (
              <Field label="Nome completo" required>
                <Input value={form.name} onChange={set('name')} autoComplete="name" required minLength={2} placeholder="Seu nome" />
              </Field>
            )}
            {mode !== 'reset' && (
              <Field label="E-mail" required>
                <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" required placeholder="voce@empresa.com" />
              </Field>
            )}
            {mode !== 'forgot' && (
              <Field label={mode === 'reset' ? 'Nova senha' : 'Senha'} required hint={mode !== 'login' ? 'Mínimo de 8 caracteres' : undefined}>
                <div className="relative">
                  <Input type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} required minLength={mode === 'login' ? 1 : 8}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="pr-10" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                    <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>
              </Field>
            )}
            {mode === 'reset' && (
              <Field label="Confirmar nova senha" required>
                <Input type={showPassword ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" />
              </Field>
            )}
            {mode === 'login' && (
              <button type="button" onClick={() => switchMode('forgot')} className="self-end -mt-2 text-[12px] text-text-secondary hover:text-text-primary">Esqueceu a senha?</button>
            )}

            {error && <Alert tone="danger">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}

            <Btn type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              {{ login: 'Entrar', signup: 'Criar minha conta', forgot: 'Enviar link', reset: 'Salvar nova senha' }[mode]}
            </Btn>
          </form>

          {(mode === 'login' || mode === 'signup') && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-border" /><span className="text-[11px] text-text-muted font-medium">OU</span><div className="flex-1 h-px bg-border" />
              </div>
              <a href={providers.google ? api.auth.googleStartUrl(inviteToken) : undefined} aria-disabled={!providers.google}
                onClick={e => { if (!providers.google) { e.preventDefault(); setError(AUTH_ERRORS.google_not_configured); } }}
                className={`w-full h-10 rounded-lg border border-border bg-surface-card text-[13px] font-medium text-text-primary flex items-center justify-center gap-2 transition-colors ${providers.google ? 'hover:bg-surface-hover' : 'opacity-60 cursor-not-allowed'}`}>
                <GoogleIcon />Continuar com Google
              </a>
            </>
          )}

          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" onClick={() => { setQuery({ reset: null }); switchMode('login'); }} className="w-full mt-4 text-[12px] text-text-secondary hover:text-text-primary flex items-center justify-center gap-1">
              <Icon name="arrow_back" size={14} />Voltar para o login
            </button>
          )}

          {mode === 'login' && <div className="mt-5"><InstallAppButton variant="button" /></div>}

          {import.meta.env.DEV && mode === 'login' && (
            <p className="mt-5 text-[11px] text-text-muted text-center">Ambiente de desenvolvimento — conta de demonstração: <span className="font-mono text-text-secondary">lucas@taskly.io</span> / <span className="font-mono text-text-secondary">taskly123</span></p>
          )}
        </div>
      </div>
    </div>
  );
}
