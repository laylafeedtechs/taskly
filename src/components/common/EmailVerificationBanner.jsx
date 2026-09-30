import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Icon } from '../ui';

export function EmailVerificationBanner() {
  const { user, toast, showError } = useApp();
  const [hidden, setHidden] = useState(() => sessionStorage.getItem('taskly.verifyBanner') === 'hidden');
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerified !== false || hidden) return null;

  const resend = async () => {
    setSending(true);
    try {
      const res = await api.auth.resendVerification();
      toast(res.delivered === false ? 'E-mail gerado. Neste servidor os e-mails ficam na caixa de saída local.' : 'Enviamos um novo link de confirmação.', 'success');
    } catch (err) { showError(err); } finally { setSending(false); }
  };
  const dismiss = () => { sessionStorage.setItem('taskly.verifyBanner', 'hidden'); setHidden(true); };

  return (
    <div role="status" className="bg-blue-500/10 border-b border-blue-500/25 text-blue-300 text-[12px] px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <Icon name="mark_email_unread" size={16} />
      <span className="flex-1 min-w-0">Confirme seu e-mail <strong className="text-blue-200">{user.email}</strong> pelo link que enviamos.</span>
      <button type="button" onClick={resend} disabled={sending} className="font-semibold hover:text-blue-200 disabled:opacity-60">{sending ? 'Enviando…' : 'Reenviar e-mail'}</button>
      <button type="button" onClick={dismiss} aria-label="Ocultar aviso" className="hover:text-blue-200"><Icon name="close" size={16} /></button>
    </div>
  );
}
