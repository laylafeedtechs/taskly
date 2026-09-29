import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, Btn, Input, Field, Icon } from '../ui';

const TONE = {
  success: { icon: 'check_circle', cls: 'text-emerald-400' },
  error: { icon: 'error', cls: 'text-red-400' },
  warning: { icon: 'warning', cls: 'text-amber-400' },
  info: { icon: 'info', cls: 'text-blue-400' }
};

export function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[200] flex flex-col gap-2 sm:w-[380px] pointer-events-none" aria-live="polite" aria-atomic="false">
      {toasts.map(t => {
        const tone = TONE[t.type] || TONE.info;
        return (
          <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'} className="pointer-events-auto p-3 rounded-xl border border-border bg-surface shadow-modal flex items-start gap-2.5 animate-slideUp">
            <Icon name={tone.icon} size={18} className={`${tone.cls} mt-px flex-shrink-0`} />
            <span className="text-[12px] text-text-primary font-medium flex-1 min-w-0 whitespace-pre-line">{t.message}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action.onClick(); onRemove(t.id); }} className="px-2 h-6 rounded-md bg-surface-hover hover:bg-surface-elevated text-text-primary text-[11px] font-semibold flex-shrink-0">
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Fechar aviso" onClick={() => onRemove(t.id)} className="text-text-muted hover:text-text-primary flex-shrink-0"><Icon name="close" size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}

// Global confirmation dialog driven by `confirm()` from the app context.
// `requireText` forces the user to type a word for irreversible actions.
export function ConfirmDialog() {
  const { confirmState, closeConfirm } = useApp();
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [confirmState]);
  if (!confirmState) return null;
  const { title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger, requireText } = confirmState;
  const blocked = requireText && typed.trim() !== requireText;
  return (
    <Modal open onClose={() => closeConfirm(false)} title={title} size="sm"
      footer={<>
        <Btn onClick={() => closeConfirm(false)}>{cancelLabel}</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => closeConfirm(true)} data-autofocus={!requireText || undefined}>{confirmLabel}</Btn>
      </>}>
      {message && <p className="text-[13px] text-text-secondary whitespace-pre-line leading-relaxed">{message}</p>}
      {requireText && (
        <Field label={<>Digite <span className="font-mono text-text-primary">{requireText}</span> para confirmar</>} className="mt-4">
          <Input value={typed} onChange={e => setTyped(e.target.value)} data-autofocus autoComplete="off" />
        </Field>
      )}
    </Modal>
  );
}
