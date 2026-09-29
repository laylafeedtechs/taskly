import React, { useState } from 'react';
import { Btn, Field, Icon, Input, Select } from '../ui';
import { WEEKDAY_SHORT, recurrenceSummary } from './taskUtils';

const MODES = [
  { value: 'none', label: 'Não se repete' },
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'custom', label: 'Personalizada (dias da semana)' }
];
const UNIT = { daily: 'dia(s)', weekly: 'semana(s)', monthly: 'mês(es)', custom: 'semana(s)' };

const toDraft = rec => ({
  interval: rec?.interval || 'none',
  every: String(rec?.every || 1),
  weekdays: rec?.weekdays || [],
  time: rec?.time || ''
});

export function RecurrenceEditor({ value, onSave, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(value));
  const [saving, setSaving] = useState(false);
  const set = patch => setDraft(d => ({ ...d, ...patch }));

  const every = Number(draft.every);
  const everyInvalid = draft.interval !== 'none' && (!Number.isInteger(every) || every < 1 || every > 365);
  const needsDays = draft.interval === 'custom' && !draft.weekdays.length;
  const showDays = draft.interval === 'weekly' || draft.interval === 'custom';

  const start = () => { setDraft(toDraft(value)); setEditing(true); };
  const toggleDay = d => set({ weekdays: draft.weekdays.includes(d) ? draft.weekdays.filter(x => x !== d) : [...draft.weekdays, d].sort() });

  const save = async () => {
    setSaving(true);
    const rec = draft.interval === 'none' ? null : { interval: draft.interval, every, time: draft.time || null, weekdays: showDays ? draft.weekdays : [] };
    const ok = await onSave(rec);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 min-h-9 px-3 rounded-lg border border-border bg-background-secondary">
        <span className={`flex items-center gap-1.5 text-[13px] min-w-0 ${value ? 'text-text-primary' : 'text-text-muted'}`}>
          <Icon name="repeat" size={15} className="text-text-muted flex-shrink-0" />
          <span className="truncate">{recurrenceSummary(value)}</span>
        </span>
        {!readOnly && <Btn variant="ghost" size="xs" onClick={start}>Editar</Btn>}
      </div>
    );
  }

  const preview = draft.interval === 'none' ? null : { interval: draft.interval, every: every || 1, time: draft.time, weekdays: showDays ? draft.weekdays : [] };

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-background-secondary">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Repetição" className="col-span-2">
          <Select value={draft.interval} onChange={e => set({ interval: e.target.value })}>
            {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        {draft.interval !== 'none' && (
          <>
            <Field label={`A cada (${UNIT[draft.interval]})`} error={everyInvalid ? 'Entre 1 e 365' : undefined}>
              <Input type="number" min={1} max={365} inputMode="numeric" value={draft.every} onChange={e => set({ every: e.target.value })} />
            </Field>
            <Field label="Horário (opcional)">
              <Input type="time" value={draft.time} onChange={e => set({ time: e.target.value })} />
            </Field>
          </>
        )}
      </div>
      {showDays && (
        <fieldset>
          <legend className="text-[12px] font-medium text-text-secondary mb-1.5">Dias da semana{draft.interval === 'custom' && <span className="text-red-400"> *</span>}</legend>
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_SHORT.map((label, d) => (
              <button key={label} type="button" aria-pressed={draft.weekdays.includes(d)} onClick={() => toggleDay(d)}
                className={`h-8 min-w-[40px] px-2 rounded-lg border text-[12px] font-medium transition-colors ${draft.weekdays.includes(d) ? 'bg-blue-600 border-blue-600 text-white' : 'border-border text-text-secondary hover:bg-surface-hover hover:text-text-primary'}`}>
                {label}
              </button>
            ))}
          </div>
          {needsDays && <p className="text-[11px] text-red-400 mt-1">Escolha pelo menos um dia.</p>}
        </fieldset>
      )}
      <p className="text-[12px] text-text-secondary"><span className="text-text-muted">Resumo:</span> {recurrenceSummary(preview)}</p>
      <div className="flex justify-end gap-2">
        <Btn variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Btn>
        <Btn variant="primary" size="sm" loading={saving} disabled={everyInvalid || needsDays} onClick={save}>Salvar recorrência</Btn>
      </div>
    </div>
  );
}
