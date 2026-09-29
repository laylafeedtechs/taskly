import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../ui';

// Anchored panel that stays open while interacting with its content (multi-select
// filters, bulk actions). Opens upwards when `placement="top"` and is nudged
// horizontally so it never leaves the viewport.
export function Popover({ trigger, children, placement = 'bottom', width = 240, label }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      wrapRef.current?.querySelector('button')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    wrapRef.current?.addEventListener('keydown', onKey);
    const node = wrapRef.current;
    return () => { document.removeEventListener('mousedown', onDown); node?.removeEventListener('keydown', onKey); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) { setShift(0); return; }
    panelRef.current.querySelector('[data-autofocus], button, input')?.focus({ preventScroll: true });
    const rect = panelRef.current.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) setShift(window.innerWidth - margin - rect.right);
    else if (rect.left < margin) setShift(margin - rect.left);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="relative inline-flex" ref={wrapRef}>
      {trigger({ open, toggle: () => setOpen(o => !o), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          className={`absolute left-0 z-[95] p-1.5 rounded-xl bg-surface border border-border shadow-modal animate-scaleIn max-w-[calc(100vw-1rem)] ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-1'}`}
          style={{ width, transform: shift ? `translateX(${shift}px)` : undefined }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function PopoverItem({ icon, label, onClick, checked, danger, disabled, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      role={checked === undefined ? undefined : 'menuitemcheckbox'}
      aria-checked={checked}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left transition-colors disabled:opacity-40 ${danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
    >
      {checked !== undefined && (
        <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-blue-600 border-blue-600 text-white' : 'border-border-focus'}`} aria-hidden="true">
          {checked && <Icon name="check" size={13} />}
        </span>
      )}
      {icon && <Icon name={icon} size={15} />}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {children}
    </button>
  );
}
