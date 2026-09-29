// Taskly design-system primitives. Views should compose these instead of
// re-styling raw elements, and must only use theme tokens (no hex colors).
import React, { useEffect, useId, useRef, useState } from 'react';
import { initials } from '../../lib/format';

export const Icon = ({ name, className = '', size = 16, filled = false, label }) => (
  <span
    className={`material-symbols-outlined leading-none ${className}`}
    style={{ fontSize: size, fontVariationSettings: filled ? "'FILL' 1" : undefined }}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
  >{name}</span>
);

// ------------------------------------------------------------------ Button

const BTN_VARIANTS = {
  primary: 'bg-inverse text-inverse-text hover:opacity-90 font-semibold',
  secondary: 'bg-surface-card text-text-primary border border-border hover:bg-surface-hover hover:border-border-focus',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
  danger: 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25',
  accent: 'bg-blue-600 text-white hover:bg-blue-500'
};
const BTN_SIZES = { xs: 'h-7 px-2 text-[11px] gap-1', sm: 'h-8 px-2.5 text-[12px] gap-1.5', md: 'h-9 px-3.5 text-[13px] gap-2', lg: 'h-10 px-4 text-[14px] gap-2' };

export function Btn({ variant = 'secondary', size = 'sm', icon, iconRight, loading = false, className = '', children, disabled, type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <Spinner size={14} /> : icon && <Icon name={icon} size={size === 'xs' ? 14 : 16} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={16} />}
    </button>
  );
}

export function IconBtn({ icon, label, onClick, className = '', size = 'sm', active = false, ...props }) {
  const dim = size === 'xs' ? 'w-7 h-7' : size === 'md' ? 'w-9 h-9' : 'w-8 h-8';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-lg transition-colors ${active ? 'bg-surface-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'} ${dim} ${className}`}
      {...props}
    >
      <Icon name={icon} size={size === 'xs' ? 15 : 18} />
    </button>
  );
}

export const Kbd = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-border bg-surface-elevated text-text-muted font-mono text-[10px]">{children}</kbd>
);

// ----------------------------------------------------------- feedback states

export const Spinner = ({ size = 16, className = '' }) => (
  <span role="status" aria-label="Carregando" className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin opacity-70 ${className}`} style={{ width: size, height: size }} />
);

export const Skeleton = ({ className = '' }) => <div className={`skeleton ${className}`} aria-hidden="true" />;

export function LoadingState({ rows = 3, label = 'Carregando…' }) {
  return (
    <div className="flex flex-col gap-2.5 p-1" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, description, action, compact = false }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-16'} px-6`}>
      <div className="w-11 h-11 rounded-xl bg-surface-card border border-border flex items-center justify-center mb-3">
        <Icon name={icon} size={22} className="text-text-muted" />
      </div>
      <p className="text-[14px] font-semibold text-text-primary">{title}</p>
      {description && <p className="text-[12px] text-text-secondary mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact = false }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-14'} px-6`}>
      <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-center mb-3">
        <Icon name="error" size={22} className="text-red-400" />
      </div>
      <p className="text-[14px] font-semibold text-text-primary">Não foi possível carregar</p>
      <p className="text-[12px] text-text-secondary mt-1 max-w-sm">{error?.message || 'Erro inesperado.'}</p>
      {onRetry && <Btn className="mt-4" icon="refresh" onClick={() => onRetry()}>Tentar novamente</Btn>}
    </div>
  );
}

// Renders loading / error / empty / content consistently.
export function AsyncBoundary({ loading, error, onRetry, empty, emptyState, children, rows }) {
  if (loading) return <LoadingState rows={rows} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (empty) return emptyState || <EmptyState title="Nada por aqui ainda" />;
  return children;
}

export function Alert({ tone = 'info', children, icon }) {
  const tones = {
    info: 'bg-blue-500/10 border-blue-500/25 text-blue-300',
    warning: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
    danger: 'bg-red-500/10 border-red-500/25 text-red-300',
    success: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
  };
  const icons = { info: 'info', warning: 'warning', danger: 'error', success: 'check_circle' };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2 p-3 rounded-lg border text-[12px] leading-relaxed ${tones[tone]}`}>
      <Icon name={icon || icons[tone]} size={16} className="mt-px flex-shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- overlays

function useFocusTrap(open, ref, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = ref.current;
    const focusables = () => node?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [];
    const first = focusables()[0];
    (node?.querySelector('[data-autofocus]') || first)?.focus();
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
      if (e.key !== 'Tab') return;
      const list = [...focusables()];
      if (!list.length) return;
      const idx = list.indexOf(document.activeElement);
      if (e.shiftKey && idx <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && idx === list.length - 1) { e.preventDefault(); list[0].focus(); }
    };
    node?.addEventListener('keydown', onKey);
    return () => { node?.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [open, ref, onClose]);
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissable = true }) {
  const ref = useRef(null);
  const titleId = useId();
  useFocusTrap(open, ref, dismissable ? onClose : undefined);
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-[120] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" onClick={dismissable ? onClose : undefined} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`relative w-full ${widths[size]} bg-surface border border-border rounded-2xl shadow-modal animate-scaleIn my-auto`}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-text-primary">{title}</h2>
            {description && <p className="text-[12px] text-text-secondary mt-1">{description}</p>}
          </div>
          {dismissable && <IconBtn icon="close" label="Fechar" onClick={onClose} size="xs" />}
        </div>
        <div className="px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-background-secondary/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 460, headerActions }) {
  const ref = useRef(null);
  useFocusTrap(open, ref, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Detalhes'} className="absolute right-0 top-0 h-full w-full bg-surface border-l border-border shadow-modal flex flex-col animate-slideInRight" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-border flex-shrink-0">
          <div className="min-w-0 flex-1 text-[13px] font-semibold text-text-primary truncate">{title}</div>
          <div className="flex items-center gap-1">{headerActions}<IconBtn icon="close" label="Fechar" onClick={onClose} size="xs" /></div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}

// Anchored dropdown menu.
export function Menu({ trigger, items, align = 'right', width = 220 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="relative inline-flex" ref={ref}>
      {trigger({ open, toggle: () => setOpen(o => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div role="menu" className={`absolute top-full mt-1 z-[90] p-1 rounded-xl bg-surface border border-border shadow-modal animate-scaleIn ${align === 'right' ? 'right-0' : 'left-0'}`} style={{ width }}>
          {items.filter(Boolean).map((item, i) => item === '-' ? <div key={i} className="my-1 border-t border-border" /> : item.header ? (
            <div key={i} className="px-2.5 pt-1.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">{item.header}</div>
          ) : (
            <button
              key={i}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick?.(); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left transition-colors disabled:opacity-40 ${item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
            >
              {item.icon && <Icon name={item.icon} size={15} />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-[10px] font-mono text-text-muted">{item.hint}</span>}
              {item.checked && <Icon name="check" size={14} className="text-blue-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- forms

const fieldBase = 'w-full bg-background-secondary border border-border rounded-lg text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-blue-500/40 transition-colors disabled:opacity-60';

export function Field({ label, hint, error, children, required, className = '' }) {
  const id = useId();
  const child = React.isValidElement(children) ? React.cloneElement(children, { id: children.props.id || id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? `${id}-desc` : undefined }) : children;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <label htmlFor={children?.props?.id || id} className="text-[12px] font-medium text-text-secondary">{label}{required && <span className="text-red-400"> *</span>}</label>}
      {child}
      {(error || hint) && <p id={`${id}-desc`} className={`text-[11px] ${error ? 'text-red-400' : 'text-text-muted'}`}>{error || hint}</p>}
    </div>
  );
}

export const Input = React.forwardRef(({ className = '', ...props }, ref) => <input ref={ref} className={`${fieldBase} h-9 px-3 ${className}`} {...props} />);
export const Textarea = React.forwardRef(({ className = '', ...props }, ref) => <textarea ref={ref} className={`${fieldBase} px-3 py-2 min-h-[80px] resize-y ${className}`} {...props} />);
export const Select = React.forwardRef(({ className = '', children, ...props }, ref) => <select ref={ref} className={`${fieldBase} h-9 px-2.5 ${className}`} {...props}>{children}</select>);

export function SearchInput({ value, onChange, placeholder = 'Buscar…', className = '', inputRef, ...props }) {
  return (
    <div className={`relative ${className}`}>
      <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input ref={inputRef} type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${fieldBase} h-9 pl-8 pr-3`} {...props} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          {label && <div className="text-[13px] text-text-primary font-medium">{label}</div>}
          {description && <div className="text-[11px] text-text-muted mt-0.5">{description}</div>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${checked ? 'bg-blue-600' : 'bg-surface-hover border border-border'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, className = '', ...props }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      aria-label={label}
      className={`w-4 h-4 rounded border-border bg-background-secondary accent-blue-600 cursor-pointer flex-shrink-0 ${className}`}
      {...props}
    />
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div role="tablist" className={`flex items-center gap-1 overflow-x-auto ${className}`}>
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${value === t.id ? 'bg-surface-elevated text-text-primary border border-border' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-transparent'}`}
        >
          {t.icon && <Icon name={t.icon} size={15} />}
          {t.label}
          {t.count !== undefined && <span className="text-[10px] font-mono text-text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex p-0.5 rounded-lg bg-background-secondary border border-border">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.label} onClick={() => onChange(o.value)}
          className={`flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ${value === o.value ? 'bg-surface-elevated text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.showLabel !== false && o.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-2 pt-3">
      <span className="text-[11px] text-text-muted font-mono">Página {page} de {totalPages}</span>
      <div className="flex gap-1">
        <Btn size="xs" icon="chevron_left" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Btn>
        <Btn size="xs" iconRight="chevron_right" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Próxima</Btn>
      </div>
    </nav>
  );
}

// ----------------------------------------------------------------- display

export function Avatar({ user, size = 24, className = '' }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.4) };
  if (user?.avatar && !broken) {
    return <img src={user.avatar} alt={user.name || ''} title={user.name} onError={() => setBroken(true)} className={`rounded-full object-cover border border-border flex-shrink-0 ${className}`} style={style} />;
  }
  return (
    <span title={user?.name} aria-label={user?.name || 'Sem responsável'} className={`rounded-full bg-surface-elevated border border-border flex items-center justify-center font-semibold text-text-secondary flex-shrink-0 ${className}`} style={style}>
      {user ? initials(user.name) : <Icon name="person" size={size * 0.6} />}
    </span>
  );
}

export function Card({ children, className = '', padded = true, ...props }) {
  return <div className={`bg-surface-card border border-border rounded-xl ${padded ? 'p-4' : ''} ${className}`} {...props}>{children}</div>;
}

export function PageHeader({ title, description, actions, icon }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-title-lg text-text-primary flex items-center gap-2">{icon && <Icon name={icon} size={24} className="text-text-muted" />}{title}</h1>
        {description && <p className="text-[13px] text-text-secondary mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ProgressBar({ value, className = '', tone }) {
  const color = tone || (value >= 100 ? 'bg-emerald-400' : 'bg-blue-500');
  return (
    <div className={`h-1.5 rounded-full bg-surface-hover overflow-hidden ${className}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(0, value || 0))}%` }} />
    </div>
  );
}

export const Pill = ({ children, className = '', title }) => (
  <span title={title} className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[11px] font-medium whitespace-nowrap ${className || 'border-border bg-surface-elevated text-text-secondary'}`}>{children}</span>
);
