import { useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { PRIORITIES, todayISO, addDaysISO } from '../../lib/format';

export const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));

export const DUE_OPTIONS = [
  { value: 'overdue', label: 'Atrasadas' },
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Esta semana' },
  { value: 'none', label: 'Sem prazo' }
];

export function matchesDue(task, due, today = todayISO()) {
  const d = task.dueDate;
  if (due === 'overdue') return Boolean(d && d < today && task.status !== 'Done');
  if (due === 'today') return d === today;
  if (due === 'week') return Boolean(d && d >= today && d <= addDaysISO(today, 7));
  if (due === 'none') return !d;
  return true;
}

export function matchesSearch(task, q) {
  if (!q) return true;
  return task.title.toLowerCase().includes(q)
    || task.id.toLowerCase().includes(q)
    || (task.description || '').toLowerCase().includes(q)
    || (task.tags || []).some(t => t.toLowerCase().includes(q));
}

export const byPriorityThenDue = (a, b) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
  || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
  || a.id.localeCompare(b.id, undefined, { numeric: true });

export function useLookups() {
  const { members, projects, tasks } = useApp();
  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  return { memberById, projectById, taskById };
}

// The column that means "finished" for a project: the canonical Done key or the last column.
export function doneStatusOf(columns = []) {
  return columns.find(c => c.statusKey === 'Done')?.statusKey || columns[columns.length - 1]?.statusKey || 'Done';
}

export function reopenStatusOf(columns = []) {
  const done = doneStatusOf(columns);
  return columns.find(c => c.statusKey === 'To Do')?.statusKey || columns.find(c => c.statusKey !== done)?.statusKey || 'To Do';
}

export const isDone = (task, columns) => task.status === 'Done' || task.status === doneStatusOf(columns);

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const joinPt = list => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`);

export function recurrenceSummary(rec) {
  if (!rec) return 'Não se repete';
  const every = rec.every || 1;
  const days = [...(rec.weekdays || [])].sort((a, b) => a - b);
  let text;
  if (rec.interval === 'daily' || (rec.interval === 'custom' && !days.length)) text = every === 1 ? 'Todo dia' : `A cada ${every} dias`;
  else if (rec.interval === 'monthly') text = every === 1 ? 'Todo mês' : `A cada ${every} meses`;
  else if (days.length === 1 && every === 1) text = `${days[0] === 0 || days[0] === 6 ? 'Todo' : 'Toda'} ${WEEKDAYS[days[0]]}`;
  else if (days.length) text = `${every === 1 ? 'Toda semana' : `A cada ${every} semanas`}: ${joinPt(days.map(d => WEEKDAY_SHORT[d].toLowerCase()))}`;
  else text = every === 1 ? 'Toda semana' : `A cada ${every} semanas`;
  return rec.time ? `${text} às ${rec.time}` : text;
}

export const DUE_TONE = { danger: 'text-red-400', warning: 'text-amber-400', muted: 'text-text-muted' };

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
