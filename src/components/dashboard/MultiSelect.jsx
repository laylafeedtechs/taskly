import React, { useCallback, useId, useRef, useState } from 'react';
import { useOnClickOutside } from '../../lib/hooks';
import { Checkbox, Icon, SearchInput } from '../ui';

// Filter dropdown with checkboxes. An empty selection means "all".
export function MultiSelect({ label, options, value, onChange, allLabel = 'Todos' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const listId = useId();
  const close = useCallback(() => { setOpen(false); setSearch(''); }, []);
  useOnClickOutside(ref, close, open);

  const selected = options.filter(o => value.includes(o.value));
  const summary = !selected.length ? allLabel : selected.length === 1 ? selected[0].label : `${selected.length} selecionados`;
  const visible = search ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) : options;
  const toggle = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);

  return (
    <div className="relative" ref={ref} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(); buttonRef.current?.focus(); } }}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? close() : setOpen(true))}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] transition-colors max-w-[220px] ${selected.length ? 'border-border-focus bg-surface-elevated text-text-primary' : 'border-border bg-surface-card text-text-secondary hover:bg-surface-hover'}`}
      >
        <span className="text-text-muted">{label}:</span>
        <span className="truncate font-medium">{summary}</span>
        <Icon name="expand_more" size={16} className="text-text-muted flex-shrink-0" />
      </button>
      {open && (
        <div id={listId} role="group" aria-label={label} className="absolute left-0 top-full mt-1 z-[90] w-[260px] max-w-[calc(100vw-32px)] p-1.5 rounded-xl bg-surface border border-border shadow-modal animate-scaleIn">
          {options.length > 8 && <SearchInput value={search} onChange={setSearch} placeholder={`Buscar ${label.toLowerCase()}…`} className="mb-1.5" autoFocus />}
          <ul className="max-h-64 overflow-y-auto">
            {visible.map(o => (
              <li key={o.value}>
                <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer">
                  <Checkbox checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                  {o.swatch && <span aria-hidden="true" className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: o.swatch }} />}
                  <span className="truncate">{o.label}</span>
                </label>
              </li>
            ))}
            {!visible.length && <li className="px-2 py-3 text-[12px] text-text-muted text-center">Nenhuma opção</li>}
          </ul>
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="w-full mt-1 pt-1.5 border-t border-border text-[12px] text-text-secondary hover:text-text-primary py-1">Limpar seleção</button>
          )}
        </div>
      )}
    </div>
  );
}
