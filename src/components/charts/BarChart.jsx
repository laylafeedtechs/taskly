import React, { useState } from 'react';
import { VIZ, formatNumber } from './theme';
import { DataTable, Tooltip, TooltipRow, useWidth } from './parts';

const ROW = 30;
const BAR = 16;
const VALUE_SPACE = 40;

// Bar with a 4px rounded data-end and a square baseline.
const barPath = (w, y) => {
  const r = Math.min(4, w / 2);
  return `M0,${y} H${w - r} Q${w},${y} ${w},${y + r} V${y + BAR - r} Q${w},${y + BAR} ${w - r},${y + BAR} H0 Z`;
};

// Horizontal bar chart for categorical counts. Values sit at the bar tips;
// the tooltip adds the share of the total.
export function BarChart({ items, title, color = VIZ.series1, emptyLabel = 'Sem dados' }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const total = items.reduce((a, i) => a + i.value, 0);
  const max = Math.max(1, ...items.map(i => i.value));
  const scale = v => (v / max) * Math.max(0, width - VALUE_SPACE);

  if (!total) return <div className="py-8 text-center text-[12px] text-text-muted">{emptyLabel}</div>;

  return (
    <div className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] gap-x-3">
      <ul aria-hidden="true">
        {items.map(i => (
          <li key={i.key} className="flex items-center text-[12px] text-text-secondary truncate" style={{ height: ROW }} title={i.label}>
            <span className="truncate">{i.label}</span>
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative min-w-0">
        {width > 0 && (
          <svg width={width} height={items.length * ROW} role="img" aria-label={`${title}: ${items.map(i => `${i.label} ${i.value}`).join(', ')}`} className="block overflow-visible">
            <line x1={0.5} x2={0.5} y1={0} y2={items.length * ROW} style={{ stroke: VIZ.axis }} />
            {items.map((i, idx) => {
              const y = idx * ROW + (ROW - BAR) / 2;
              const w = scale(i.value);
              return (
                <g key={i.key} onPointerEnter={() => setActive(idx)} onPointerLeave={() => setActive(null)}>
                  <rect x={0} y={idx * ROW} width={width} height={ROW} fill="transparent" />
                  {w > 0 && <path d={barPath(w, y)} style={{ fill: i.color || color, opacity: active === null || active === idx ? 1 : 0.55 }} />}
                  <text x={w + 6} y={y + BAR / 2} dy="0.32em" fontSize={11} style={{ fill: VIZ.secondary, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(i.value)}</text>
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && (
          <Tooltip x={Math.min(scale(items[active].value), width - 60)} y={active * ROW + ROW} width={width}>
            <div className="text-text-muted mb-1">{items[active].label}</div>
            <TooltipRow color={items[active].color || color} label={`${Math.round((items[active].value / total) * 100)}% do total`} value={formatNumber(items[active].value)} />
          </Tooltip>
        )}
      </div>
      <DataTable caption={title} columns={['Categoria', 'Quantidade']} rows={items.map(i => [i.label, i.value])} />
    </div>
  );
}
