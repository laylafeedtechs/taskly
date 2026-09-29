// Small building blocks shared by the settings, admin, team and automation screens.
import React, { useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { Alert, Btn, Card, IconBtn, Input, Menu, Modal, Pill } from '../ui';

export function CopyField({ value, label = 'Valor' }) {
  const { toast } = useApp();
  const ref = useRef(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast('Copiado para a área de transferência', 'success');
    } catch {
      ref.current?.select();
      toast('Não foi possível copiar automaticamente. Use Ctrl+C.', 'warning');
    }
  };
  return (
    <div className="flex gap-2 min-w-0">
      <Input ref={ref} readOnly value={value} aria-label={label} onFocus={e => e.target.select()} className="font-mono text-[12px] min-w-0" />
      <Btn icon="content_copy" onClick={copy} className="flex-shrink-0">Copiar</Btn>
    </div>
  );
}

// Shows a secret exactly once, right after it was generated.
export function SecretModal({ secret, title, description, onClose, children }) {
  return (
    <Modal open={Boolean(secret)} onClose={onClose} title={title} description={description} footer={<Btn variant="primary" onClick={onClose}>Já copiei</Btn>}>
      <div className="flex flex-col gap-3">
        <Alert tone="warning">Copie e guarde agora. Por segurança, este segredo <strong>não será exibido novamente</strong>.</Alert>
        {secret && <CopyField value={secret} label="Segredo" />}
        {children}
      </div>
    </Modal>
  );
}

export function Section({ title, description, actions, children, className = '' }) {
  return (
    <Card className={`p-5 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            {title && <h2 className="text-title-sm text-text-primary">{title}</h2>}
            {description && <p className="text-[12px] text-text-secondary mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function TableWrap({ children, minWidth = 640 }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px] text-text-secondary" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export const Th = ({ children, className = '' }) => (
  <th scope="col" className={`text-left font-medium text-[10px] font-mono uppercase tracking-wider text-text-muted px-3 py-2.5 border-b border-border bg-background-secondary/60 whitespace-nowrap ${className}`}>{children}</th>
);

export const Td = ({ children, className = '', ...props }) => (
  <td className={`px-3 py-2.5 border-b border-border-subtle align-middle ${className}`} {...props}>{children}</td>
);

export function ResultBadge({ success, successLabel = 'Sucesso', failureLabel = 'Falha' }) {
  return success
    ? <Pill className="text-emerald-400 bg-emerald-500/10 border-emerald-500/25">{successLabel}</Pill>
    : <Pill className="text-red-400 bg-red-500/10 border-red-500/25">{failureLabel}</Pill>;
}

// Reads the backend error message for inline display inside forms.
export const errorText = err => err?.message || 'Algo deu errado. Tente novamente.';

export function RowMenu({ label, items, width }) {
  return <Menu width={width} trigger={({ toggle, ...aria }) => <IconBtn icon="more_horiz" label={label} onClick={toggle} {...aria} />} items={items} />;
}
