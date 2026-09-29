// Labels and formatting helpers shared by every view (pt-BR).

export const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
export const PRIORITY_LABEL = { Urgent: 'Urgente', High: 'Alta', Normal: 'Normal', Low: 'Baixa' };
export const PRIORITY_COLOR = { Urgent: '#EF4444', High: '#F59E0B', Normal: '#3B82F6', Low: '#8A8A8A' };

export const TASK_TYPES = ['Task', 'Bug', 'Feature', 'Improvement', 'Research', 'Meeting'];
export const TYPE_META = {
  Task: { label: 'Tarefa', icon: 'check_box' },
  Bug: { label: 'Bug', icon: 'pest_control' },
  Feature: { label: 'Feature', icon: 'auto_awesome' },
  Improvement: { label: 'Melhoria', icon: 'trending_up' },
  Research: { label: 'Pesquisa', icon: 'science' },
  Meeting: { label: 'Reunião', icon: 'groups' }
};

export const STATUS_LABEL = { Backlog: 'Backlog', 'To Do': 'A Fazer', 'In Progress': 'Em Andamento', Review: 'Em Revisão', Testing: 'Testes', Done: 'Concluído' };
export const statusLabel = (status, columns = []) => columns.find(c => c.statusKey === status)?.name || STATUS_LABEL[status] || status;

export const ROLE_LABEL = { Owner: 'Proprietário', Manager: 'Gestor', Member: 'Membro', Viewer: 'Leitor' };
export const HEALTH_META = {
  Healthy: { label: 'Saudável', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25', dot: 'bg-emerald-400' },
  'At Risk': { label: 'Em risco', className: 'text-amber-400 bg-amber-500/10 border-amber-500/25', dot: 'bg-amber-400' },
  Critical: { label: 'Crítico', className: 'text-red-400 bg-red-500/10 border-red-500/25', dot: 'bg-red-400' }
};
export const PROJECT_STATUS_LABEL = { PLANNING: 'Planejamento', ACTIVE: 'Ativo', ON_HOLD: 'Pausado', COMPLETED: 'Concluído' };

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const toISODate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseISODate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDaysISO = (iso, n) => { const d = parseISODate(iso); d.setDate(d.getDate() + n); return toISODate(d); };

export function formatDate(iso, opts = { day: '2-digit', month: 'short' }) {
  if (!iso) return '—';
  const d = iso.length === 10 ? parseISODate(iso) : new Date(iso);
  return d.toLocaleDateString('pt-BR', opts).replace('.', '');
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'agora mesmo';
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.round(diff / 86400)} d`;
  return formatDate(iso, { day: '2-digit', month: 'short', year: 'numeric' });
}

// Describes a due date relative to today: overdue / today / soon.
export function dueInfo(dueDate, status) {
  if (!dueDate) return null;
  const today = todayISO();
  const days = Math.round((parseISODate(dueDate) - parseISODate(today)) / 86400000);
  if (status === 'Done') return { label: formatDate(dueDate), tone: 'muted', days };
  if (days < 0) return { label: `${Math.abs(days)}d atrasada`, tone: 'danger', days };
  if (days === 0) return { label: 'Hoje', tone: 'warning', days };
  if (days === 1) return { label: 'Amanhã', tone: 'warning', days };
  return { label: formatDate(dueDate), tone: days <= 3 ? 'warning' : 'muted', days };
}

export const initials = name => (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export const pluralize = (n, one, many) => `${n} ${n === 1 ? one : many}`;
