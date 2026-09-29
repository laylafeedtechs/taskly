import React, { useLayoutEffect, useState } from 'react';

// Measures an element's width so SVG charts can draw at real pixel size.
// Returns a callback ref, so it follows whichever element is mounted.
export function useWidth() {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return undefined;
    setWidth(node.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, width];
}

export function Legend({ items }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
      {items.map(i => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={i.shape === 'rect' ? 'w-2.5 h-2.5 rounded-sm' : 'w-3 h-0.5 rounded-full'} style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// Visually hidden data table: the text alternative for every chart.
export function DataTable({ caption, columns, rows }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr>{columns.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}</tr>)}</tbody>
    </table>
  );
}

// Floating readout positioned inside a relatively positioned chart wrapper.
export function Tooltip({ x, y, width, children }) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(0, width - 170));
  return (
    <div role="presentation" className="pointer-events-none absolute z-10 min-w-[140px] max-w-[200px] px-2.5 py-2 rounded-lg bg-surface-elevated border border-border shadow-elevated text-[11px]" style={{ left, top: Math.max(0, y) }}>
      {children}
    </div>
  );
}

export function TooltipRow({ color, label, value }) {
  return (
    <div className="flex items-center gap-2 mt-0.5">
      <span aria-hidden="true" className="w-2.5 h-0.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="font-semibold text-text-primary tabular-nums">{value}</span>
      <span className="text-text-secondary truncate">{label}</span>
    </div>
  );
}
