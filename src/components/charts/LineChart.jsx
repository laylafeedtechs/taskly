import React, { useMemo, useState } from 'react';
import { formatDate } from '../../lib/format';
import { VIZ, formatNumber, niceTicks } from './theme';
import { DataTable, Legend, Tooltip, TooltipRow, useWidth } from './parts';

const M = { top: 10, right: 14, bottom: 24, left: 34 };

// Time-series line chart (one shared y-axis) with crosshair tooltip,
// keyboard navigation and a hidden data table.
export function LineChart({ data, series, step = 'day', height = 220, title, emptyLabel = 'Sem dados no período' }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const n = data.length;
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;

  const { ticks, top } = useMemo(() => {
    const max = Math.max(0, ...data.flatMap(d => series.map(s => d[s.key] || 0)));
    const t = niceTicks(max);
    return { ticks: t, top: t[t.length - 1] };
  }, [data, series]);

  const x = i => M.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = v => M.top + innerH - (v / top) * innerH;
  const dateLabel = d => (step === 'week' ? `Semana de ${formatDate(d)}` : formatDate(d, { day: '2-digit', month: 'short', weekday: 'short' }));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));
  const total = key => data.reduce((a, d) => a + (d[key] || 0), 0);
  const summary = `${title}: ${series.map(s => `${s.label} ${total(s.key)}`).join(', ')} no período de ${formatDate(data[0]?.date)} a ${formatDate(data[n - 1]?.date)}.`;

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - M.left;
    setActive(Math.min(n - 1, Math.max(0, Math.round(n <= 1 ? 0 : (px / innerW) * (n - 1)))));
  };
  const onKey = e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive(a => Math.min(n - 1, (a ?? -1) + 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive(a => Math.max(0, (a ?? n) - 1)); }
    else if (e.key === 'Escape') setActive(null);
  };

  if (!n || series.every(s => total(s.key) === 0)) {
    return <div ref={ref} className="flex items-center justify-center text-[12px] text-text-muted" style={{ height }}>{emptyLabel}</div>;
  }

  return (
    <div ref={ref} className="flex flex-col gap-2">
      {series.length > 1 && <Legend items={series.map(s => ({ label: s.label, color: s.color }))} />}
      <div className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width} height={height} role="img" aria-label={summary} tabIndex={0}
            className="block focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 rounded-md"
            onPointerMove={onMove} onPointerLeave={() => setActive(null)} onKeyDown={onKey} onBlur={() => setActive(null)}
          >
            {ticks.map(t => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? VIZ.axis : VIZ.grid }} strokeWidth={1} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} style={{ fill: VIZ.muted, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(t)}</text>
              </g>
            ))}
            {data.map((d, i) => (i % labelEvery === 0 || i === n - 1) && (
              <text key={d.date} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={10} style={{ fill: VIZ.muted }}>{formatDate(d.date)}</text>
            ))}
            {series.map(s => {
              const pts = data.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`);
              return (
                <g key={s.key}>
                  {s.area && <path d={`M${x(0)},${y(0)} L${pts.join(' L')} L${x(n - 1)},${y(0)} Z`} style={{ fill: s.color, opacity: 0.1 }} />}
                  <polyline points={pts.join(' ')} fill="none" style={{ stroke: s.color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx={x(n - 1)} cy={y(data[n - 1][s.key] || 0)} r={4} style={{ fill: s.color, stroke: VIZ.surface }} strokeWidth={2} />
                </g>
              );
            })}
            {active !== null && (
              <g aria-hidden="true">
                <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + innerH} style={{ stroke: VIZ.muted }} strokeWidth={1} />
                {series.map(s => <circle key={s.key} cx={x(active)} cy={y(data[active][s.key] || 0)} r={4} style={{ fill: s.color, stroke: VIZ.surface }} strokeWidth={2} />)}
              </g>
            )}
          </svg>
        )}
        {active !== null && (
          <Tooltip x={x(active)} y={M.top} width={width}>
            <div className="text-text-muted mb-1">{dateLabel(data[active].date)}</div>
            {series.map(s => <TooltipRow key={s.key} color={s.color} label={s.label} value={formatNumber(data[active][s.key] || 0)} />)}
          </Tooltip>
        )}
      </div>
      <DataTable caption={title} columns={[step === 'week' ? 'Semana' : 'Data', ...series.map(s => s.label)]} rows={data.map(d => [formatDate(d.date), ...series.map(s => d[s.key] || 0)])} />
    </div>
  );
}

// Minimal trend line (no axes) for summary widgets.
export function Sparkline({ data, series, height = 48, label }) {
  const [ref, width] = useWidth();
  const n = data.length;
  const max = Math.max(1, ...data.flatMap(d => series.map(s => d[s.key] || 0)));
  const x = i => 4 + (n <= 1 ? 0 : (i * (width - 8)) / (n - 1));
  const y = v => 4 + (height - 8) - (v / max) * (height - 8);
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block">
          {series.map(s => (
            <g key={s.key}>
              <polyline points={data.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`).join(' ')} fill="none" style={{ stroke: s.color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(n - 1)} cy={y(data[n - 1][s.key] || 0)} r={3} style={{ fill: s.color }} />
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
