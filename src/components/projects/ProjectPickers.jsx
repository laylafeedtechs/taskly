import React, { useMemo, useState } from 'react';
import { Avatar, Checkbox, Icon, SearchInput } from '../ui';
import { ROLE_LABEL } from '../../lib/format';
import { PROJECT_COLORS } from './ProjectBits';

export function ColorPicker({ value, onChange }) {
  const custom = !PROJECT_COLORS.includes(value?.toUpperCase());
  return (
    <div role="radiogroup" aria-label="Cor do projeto" className="flex flex-wrap items-center gap-2">
      {PROJECT_COLORS.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value?.toUpperCase() === c}
          aria-label={`Cor ${c}`}
          onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${value?.toUpperCase() === c ? 'border-text-primary' : 'border-transparent'}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label className={`relative w-7 h-7 rounded-full border-2 overflow-hidden cursor-pointer flex items-center justify-center bg-surface-elevated ${custom ? 'border-text-primary' : 'border-border'}`} title="Cor personalizada">
        <span className="sr-only">Cor personalizada</span>
        {custom ? <span className="absolute inset-0" style={{ backgroundColor: value }} /> : <Icon name="palette" size={14} className="text-text-secondary" />}
        <input type="color" value={value || PROJECT_COLORS[0]} onChange={e => onChange(e.target.value.toUpperCase())} className="absolute inset-0 opacity-0 cursor-pointer" />
      </label>
    </div>
  );
}

export function IconPicker({ icons, value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Ícone" className="flex flex-wrap gap-1.5">
      {icons.map(name => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={`Ícone ${name}`}
          onClick={() => onChange(name)}
          className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${value === name ? 'border-blue-500/60 bg-blue-500/10 text-blue-400' : 'border-border bg-background-secondary text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          <Icon name={name} size={17} />
        </button>
      ))}
    </div>
  );
}

export function MemberPicker({ members, value, onChange }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? members.filter(m => m.name.toLowerCase().includes(term) || m.email?.toLowerCase().includes(term)) : members;
  }, [members, q]);
  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);

  return (
    <div className="rounded-lg border border-border bg-background-secondary">
      <div className="p-2 border-b border-border"><SearchInput value={q} onChange={setQ} placeholder="Buscar membros…" /></div>
      <ul className="max-h-48 overflow-y-auto p-1" aria-label="Membros do projeto">
        {filtered.length === 0 && <li className="px-2 py-3 text-[12px] text-text-muted text-center">Nenhum membro encontrado</li>}
        {filtered.map(m => (
          <li key={m.id}>
            <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-surface-hover cursor-pointer">
              <Checkbox checked={value.includes(m.id)} onChange={() => toggle(m.id)} label={m.name} />
              <Avatar user={m} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-text-primary truncate">{m.name}</span>
                <span className="block text-[11px] text-text-muted truncate">{m.email}</span>
              </span>
              <span className="text-[10px] text-text-muted flex-shrink-0">{ROLE_LABEL[m.workspaceRole] || m.workspaceRole}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="px-3 py-1.5 border-t border-border text-[11px] text-text-muted">{value.length} selecionado(s)</p>
    </div>
  );
}
