import React, { useCallback, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useDebounce, useLocalStorage } from '../../lib/hooks';
import { PRIORITIES, PRIORITY_LABEL, TASK_TYPES, TYPE_META, statusLabel, todayISO } from '../../lib/format';
import { Btn, Icon, SearchInput } from '../ui';
import { Popover, PopoverItem } from './Popover';
import { DUE_OPTIONS, matchesDue, matchesSearch } from './taskUtils';

const EMPTY = { priority: [], tags: [], assignee: [], due: [], status: [], type: [], project: [] };
const FILTER_KEYS = Object.keys(EMPTY);

export function useTaskFilters(tasks, { storageKey } = {}) {
  const [stored, setStored] = useLocalStorage(`taskly.filters.${storageKey || 'default'}`, EMPTY);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);

  const filters = useMemo(() => {
    const safe = stored && typeof stored === 'object' ? stored : {};
    return Object.fromEntries(FILTER_KEYS.map(k => [k, Array.isArray(safe[k]) ? safe[k] : []]));
  }, [stored]);

  const setFilter = useCallback((key, values) => setStored(prev => ({ ...EMPTY, ...prev, [key]: values })), [setStored]);
  const clearAll = useCallback(() => { setStored(EMPTY); setSearch(''); }, [setStored]);
  const activeCount = FILTER_KEYS.reduce((n, k) => n + filters[k].length, 0);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const today = todayISO();
    const f = filters;
    return tasks.filter(t =>
      (!f.priority.length || f.priority.includes(t.priority))
      && (!f.type.length || f.type.includes(t.type))
      && (!f.status.length || f.status.includes(t.status))
      && (!f.project.length || f.project.includes(t.projectId))
      && (!f.assignee.length || f.assignee.includes(t.assigneeId || 'unassigned'))
      && (!f.tags.length || f.tags.some(tag => (t.tags || []).includes(tag)))
      && (!f.due.length || f.due.some(d => matchesDue(t, d, today)))
      && matchesSearch(t, q));
  }, [tasks, filters, debounced]);

  return { filters, setFilter, clearAll, activeCount, search, setSearch, filtered, searching: search !== debounced };
}

function FilterDropdown({ label, icon, options, values, onChange, searchable }) {
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter(o => o.label.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const toggle = value => onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value]);

  return (
    <Popover
      label={`Filtrar por ${label.toLowerCase()}`}
      width={searchable ? 260 : 220}
      trigger={({ toggle: open, ...aria }) => (
        <button
          type="button"
          onClick={open}
          {...aria}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[12px] font-medium whitespace-nowrap transition-colors ${values.length ? 'border-blue-500/40 bg-blue-500/10 text-text-primary' : 'border-border bg-surface-card text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          <Icon name={icon} size={15} />
          {label}
          {values.length > 0 && <span className="min-w-[16px] h-4 px-1 rounded bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center">{values.length}</span>}
          <Icon name="expand_more" size={15} className="text-text-muted" />
        </button>
      )}
    >
      {searchable && (
        <div className="p-1 pb-1.5">
          <SearchInput value={q} onChange={setQ} placeholder={`Buscar ${label.toLowerCase()}…`} data-autofocus />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto">
        {visible.length === 0 && <p className="px-2.5 py-3 text-[12px] text-text-muted text-center">Nenhuma opção</p>}
        {visible.map(o => (
          <PopoverItem key={o.value} label={o.label} checked={values.includes(o.value)} onClick={() => toggle(o.value)}>
            {o.dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: o.dot }} aria-hidden="true" />}
          </PopoverItem>
        ))}
      </div>
      {values.length > 0 && (
        <div className="border-t border-border mt-1 pt-1">
          <PopoverItem icon="filter_alt_off" label="Limpar este filtro" onClick={() => onChange([])} />
        </div>
      )}
    </Popover>
  );
}

export function TaskFilterBar({ state, availableTags, showProject = false, showStatus = true, columns }) {
  const { members, projects, tasks, columnsByProject } = useApp();
  const { filters, setFilter, clearAll, activeCount, search, setSearch, searching } = state;

  const tagOptions = useMemo(() => {
    const list = availableTags || [...new Set(tasks.flatMap(t => t.tags || []))];
    return [...list].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(t => ({ value: t, label: t }));
  }, [availableTags, tasks]);

  const statusOptions = useMemo(() => {
    const source = columns || Object.values(columnsByProject).flat();
    const seen = new Map();
    source.forEach(c => { if (!seen.has(c.statusKey)) seen.set(c.statusKey, { value: c.statusKey, label: c.name, dot: c.color }); });
    return [...seen.values()];
  }, [columns, columnsByProject]);

  const groups = useMemo(() => [
    { key: 'priority', label: 'Prioridade', icon: 'flag', options: PRIORITIES.map(p => ({ value: p, label: PRIORITY_LABEL[p] })) },
    showStatus && { key: 'status', label: 'Status', icon: 'view_column', options: statusOptions },
    { key: 'assignee', label: 'Responsável', icon: 'person', searchable: members.length > 6, options: [{ value: 'unassigned', label: 'Sem responsável' }, ...members.map(m => ({ value: m.id, label: m.name }))] },
    { key: 'due', label: 'Prazo', icon: 'event', options: DUE_OPTIONS },
    { key: 'tags', label: 'Tags', icon: 'sell', searchable: tagOptions.length > 6, options: tagOptions },
    { key: 'type', label: 'Tipo', icon: 'category', options: TASK_TYPES.map(t => ({ value: t, label: TYPE_META[t].label })) },
    showProject && { key: 'project', label: 'Projeto', icon: 'folder', searchable: projects.length > 6, options: projects.map(p => ({ value: p.id, label: p.name, dot: p.color })) }
  ].filter(Boolean), [showStatus, showProject, statusOptions, members, tagOptions, projects]);

  const chips = useMemo(() => groups.flatMap(g => filters[g.key].map(value => ({
    key: g.key,
    value,
    text: `${g.label}: ${g.options.find(o => o.value === value)?.label || (g.key === 'status' ? statusLabel(value) : value)}`
  }))), [groups, filters]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por título, ID, tag ou descrição…" />
          {searching && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />}
        </div>
        {groups.map(g => (
          <FilterDropdown key={g.key} label={g.label} icon={g.icon} options={g.options} searchable={g.searchable} values={filters[g.key]} onChange={v => setFilter(g.key, v)} />
        ))}
        {(activeCount > 0 || search) && <Btn variant="ghost" size="sm" icon="filter_alt_off" onClick={clearAll}>Limpar filtros</Btn>}
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Filtros ativos">
          {chips.map(c => (
            <li key={`${c.key}:${c.value}`} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md border border-border bg-surface-elevated text-[11px] text-text-secondary max-w-full">
              <span className="truncate">{c.text}</span>
              <button type="button" aria-label={`Remover filtro ${c.text}`} onClick={() => setFilter(c.key, filters[c.key].filter(v => v !== c.value))} className="w-4 h-4 rounded flex items-center justify-center hover:text-text-primary hover:bg-surface-hover">
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
