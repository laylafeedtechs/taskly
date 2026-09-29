// Chart palette as CSS variables (RGB channels) so marks follow the app theme.
// Validated with the dataviz checker against the app's card surfaces
// (dark #161616 / light #FFFFFF): blue → orange → aqua, fixed order.
const STYLE_ID = 'taskly-viz-palette';
const CSS = `
:root { --viz-1: 57 135 229; --viz-2: 217 89 38; --viz-3: 25 158 112; }
:root[data-theme="light"] { --viz-1: 42 120 214; --viz-2: 235 104 52; --viz-3: 27 175 122; }
`;

if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export const VIZ = {
  series1: 'rgb(var(--viz-1))',
  series2: 'rgb(var(--viz-2))',
  series3: 'rgb(var(--viz-3))',
  grid: 'rgb(var(--border-subtle))',
  axis: 'rgb(var(--border))',
  muted: 'rgb(var(--text-muted))',
  secondary: 'rgb(var(--text-secondary))',
  surface: 'rgb(var(--surface-card))'
};

export const formatNumber = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR'));

// Rounds the max of an axis up to a clean value and returns evenly spaced ticks.
export function niceTicks(max, count = 4) {
  if (!max || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}
