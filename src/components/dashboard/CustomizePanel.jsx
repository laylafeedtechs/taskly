import React, { useState } from 'react';
import { Btn, Icon, IconBtn, Toggle } from '../ui';
import { WIDGET_BY_ID, WidgetIcon } from './widgets';

// Draft editor for the dashboard layout: [{ id, visible }] in display order.
export function CustomizePanel({ draft, onChange, onSave, onCancel, onReset, saving }) {
  const [dragIndex, setDragIndex] = useState(null);

  const move = (from, to) => {
    if (to < 0 || to >= draft.length || from === to) return;
    const next = [...draft];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const toggle = id => onChange(draft.map(w => (w.id === id ? { ...w, visible: !w.visible } : w)));
  const visibleCount = draft.filter(w => w.visible).length;

  return (
    <section aria-label="Personalizar dashboard" className="bg-surface-card border border-border-focus rounded-xl p-4 mb-5 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[14px] font-semibold text-text-primary">Personalizar dashboard</h2>
          <p className="text-[12px] text-text-secondary mt-0.5">Mostre, oculte e reordene os widgets. Arraste pela alça ou use as setas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" icon="restart_alt" onClick={onReset} disabled={saving}>Restaurar padrão</Btn>
          <Btn onClick={onCancel} disabled={saving}>Cancelar</Btn>
          <Btn variant="primary" icon="check" onClick={onSave} loading={saving} disabled={!visibleCount}>Salvar</Btn>
        </div>
      </div>
      {!visibleCount && <p role="alert" className="text-[12px] text-amber-400 mb-2">Mantenha pelo menos um widget visível.</p>}
      <ol className="grid gap-1.5 md:grid-cols-2">
        {draft.map((w, i) => {
          const meta = WIDGET_BY_ID[w.id];
          return (
            <li
              key={w.id}
              draggable
              onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w.id); }}
              onDragOver={e => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) { move(dragIndex, i); setDragIndex(i); } }}
              onDragEnd={() => setDragIndex(null)}
              onDrop={e => e.preventDefault()}
              className={`flex items-center gap-2 p-2 rounded-lg border bg-background-secondary transition-colors ${dragIndex === i ? 'border-border-focus opacity-60' : 'border-border-subtle'} ${w.visible ? '' : 'opacity-70'}`}
            >
              <span className="cursor-grab text-text-muted" title="Arrastar para reordenar"><Icon name="drag_indicator" size={18} /></span>
              <WidgetIcon id={w.id} />
              <div className="min-w-0 flex-1">
                <Toggle checked={w.visible} onChange={() => toggle(w.id)} label={meta.label} description={meta.description} />
              </div>
              <IconBtn icon="arrow_upward" size="xs" label={`Mover ${meta.label} para cima`} onClick={() => move(i, i - 1)} disabled={i === 0} className="disabled:opacity-30" />
              <IconBtn icon="arrow_downward" size="xs" label={`Mover ${meta.label} para baixo`} onClick={() => move(i, i + 1)} disabled={i === draft.length - 1} className="disabled:opacity-30" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
