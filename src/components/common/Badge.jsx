import React from 'react';
import { PRIORITY_LABEL, TYPE_META, HEALTH_META, statusLabel } from '../../lib/format';
import { Icon, Pill } from '../ui';

const PRIORITY_STYLE = {
  Urgent: { cls: 'text-red-400 bg-red-500/10 border-red-500/25', dot: 'bg-red-500' },
  High: { cls: 'text-amber-400 bg-amber-500/10 border-amber-500/25', dot: 'bg-amber-500' },
  Normal: { cls: 'text-blue-400 bg-blue-500/10 border-blue-500/25', dot: 'bg-blue-500' },
  Low: { cls: 'text-text-secondary bg-surface-elevated border-border', dot: 'bg-text-muted' }
};

export function PriorityBadge({ priority }) {
  const s = PRIORITY_STYLE[priority] || PRIORITY_STYLE.Normal;
  return <Pill className={s.cls} title={`Prioridade ${PRIORITY_LABEL[priority]}`}><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{PRIORITY_LABEL[priority] || priority}</Pill>;
}

const STATUS_STYLE = {
  Done: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  'In Progress': 'text-blue-400 bg-blue-500/10 border-blue-500/25',
  Review: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  Testing: 'text-pink-400 bg-pink-500/10 border-pink-500/25'
};

export function StatusBadge({ status, columns }) {
  return <Pill className={STATUS_STYLE[status]}>{statusLabel(status, columns)}</Pill>;
}

export function TypeBadge({ type, showLabel = true }) {
  const meta = TYPE_META[type] || { icon: 'label', label: type };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title={`Tipo: ${meta.label}`}>
      <Icon name={meta.icon} size={13} />{showLabel && meta.label}
    </span>
  );
}

export function HealthBadge({ health, reasons }) {
  const meta = HEALTH_META[health] || HEALTH_META.Healthy;
  return <Pill className={meta.className} title={reasons?.length ? reasons.join(' · ') : 'Sem riscos identificados'}><span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}</Pill>;
}

export function TagPill({ tag, onRemove }) {
  return (
    <Pill>
      <span className="truncate max-w-[120px]">{tag}</span>
      {onRemove && <button type="button" aria-label={`Remover tag ${tag}`} onClick={onRemove} className="hover:text-text-primary"><Icon name="close" size={12} /></button>}
    </Pill>
  );
}
