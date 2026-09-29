import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../ui';

// Same item API as ui/Menu, but rendered in a fixed-position portal so it is
// never clipped by scroll containers (Kanban columns, the board).
export function FloatingMenu({ trigger, items, width = 220 }) {
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const open = Boolean(pos);

  const close = useCallback((restoreFocus = true) => {
    setPos(null);
    if (restoreFocus) triggerRef.current?.querySelector('button')?.focus();
  }, []);

  const toggle = () => {
    if (open) return close();
    const r = triggerRef.current.getBoundingClientRect();
    return setPos({ top: r.bottom + 4, bottom: r.top - 4, right: r.right, left: r.left });
  };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const h = panel.offsetHeight;
    const margin = 8;
    const fitsBelow = pos.top + h <= window.innerHeight - margin;
    const top = fitsBelow ? pos.top : Math.max(margin, pos.bottom - h);
    const left = Math.min(Math.max(margin, pos.right - width), window.innerWidth - width - margin);
    Object.assign(panel.style, { top: `${top}px`, left: `${Math.max(margin, left)}px`, visibility: 'visible' });
    panel.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  }, [open, pos, width]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!panelRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) close(false); };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const list = [...panelRef.current.querySelectorAll('button:not([disabled])')];
      const idx = list.indexOf(document.activeElement);
      list[(idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    };
    const onScroll = e => { if (!panelRef.current?.contains(e.target)) close(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    const onResize = () => close(false);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  return (
    <span ref={triggerRef} className="inline-flex">
      {trigger({ open, toggle, 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && createPortal(
        <div ref={panelRef} role="menu" onClick={e => e.stopPropagation()} className="fixed z-[130] p-1 rounded-xl bg-surface border border-border shadow-modal max-h-[70vh] overflow-y-auto" style={{ width, visibility: 'hidden', top: 0, left: 0 }}>
          {items.filter(Boolean).map((item, i) => (item === '-' ? <div key={i} className="my-1 border-t border-border" /> : item.header ? (
            <div key={i} className="px-2.5 pt-1.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-text-muted">{item.header}</div>
          ) : (
            <button
              key={i}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => { close(); item.onClick?.(); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left transition-colors disabled:opacity-40 ${item.danger ? 'text-red-400 hover:bg-red-500/10 focus:bg-red-500/10' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover focus:bg-surface-hover'}`}
            >
              {item.icon && <Icon name={item.icon} size={15} />}
              {item.dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.dot }} aria-hidden="true" />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.checked && <Icon name="check" size={14} className="text-blue-400" />}
            </button>
          )))}
        </div>,
        document.body
      )}
    </span>
  );
}
