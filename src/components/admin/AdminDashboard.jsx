import React from 'react';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { AsyncBoundary, Btn, Card, EmptyState, Icon, ProgressBar } from '../ui';
import { Section } from '../settings/common';
import { SeverityBadge } from './AdminLogs';

export function useAdminDashboard() {
  return useAsync(() => api.admin.dashboard(), []);
}

function Stat({ label, value, icon, tone = 'text-text-secondary', hint }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">{label}</span>
        <Icon name={icon} size={16} className={tone} />
      </div>
      <div className="text-[24px] leading-none font-semibold text-text-primary tabular-nums">{value.toLocaleString('pt-BR')}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </Card>
  );
}

const formatUptime = s => {
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}min`].filter(Boolean).join(' ');
};

function DashboardBody({ data, loading, onRefresh }) {
  const m = data.metrics;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end"><Btn size="xs" icon="refresh" loading={loading} onClick={() => onRefresh()}>Atualizar</Btn></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Usuários" value={m.totalUsers} icon="group" hint={`${m.activeUsers} ativos · ${m.blockedUsers} bloqueados`} />
        <Stat label="Ativos 24h" value={m.activeLast24h} icon="bolt" tone="text-emerald-400" />
        <Stat label="Workspaces" value={m.totalWorkspaces} icon="business" />
        <Stat label="Projetos" value={m.totalProjects} icon="folder" />
        <Stat label="Tarefas" value={m.totalTasks} icon="check_box" hint={`${m.completedTasks} concluídas`} />
        <Stat label="Sessões" value={m.activeSessions} icon="devices" />
        <Stat label="Erros 24h" value={m.errorsLast24h} icon="error" tone={m.errorsLast24h ? 'text-red-400' : 'text-text-secondary'} />
        <Stat label="Logins falhos 24h" value={m.failedLoginsLast24h} icon="lock" tone={m.failedLoginsLast24h ? 'text-amber-400' : 'text-text-secondary'} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.6fr] gap-5">
        <Section title="Saúde do servidor">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[12px]">
            <dt className="text-text-muted">Tempo ativo</dt><dd className="text-text-primary font-mono">{formatUptime(data.health.uptimeSeconds)}</dd>
            <dt className="text-text-muted">Memória</dt><dd className="text-text-primary font-mono">{data.health.memoryMb} MB</dd>
            <dt className="text-text-muted">Node.js</dt><dd className="text-text-primary font-mono">{data.health.node}</dd>
            <dt className="text-text-muted">E-mail</dt><dd className="text-text-primary">{data.health.email}</dd>
            <dt className="text-text-muted">Google OAuth</dt><dd className="text-text-primary">{data.health.googleOAuth}</dd>
          </dl>
        </Section>
        <Section title="Eventos recentes">
          {data.recentEvents.length ? (
            <ul className="divide-y divide-border-subtle">
              {data.recentEvents.map(e => (
                <li key={e.id} className="flex items-start gap-3 py-2.5 first:pt-0">
                  <SeverityBadge severity={e.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-text-primary break-words">{e.message}</div>
                    <div className="text-[11px] text-text-muted font-mono">{e.type}</div>
                  </div>
                  <time className="text-[11px] text-text-muted whitespace-nowrap" title={formatDateTime(e.createdAt)}>{timeAgo(e.createdAt)}</time>
                </li>
              ))}
            </ul>
          ) : <EmptyState compact icon="monitor_heart" title="Nenhum evento registrado" />}
        </Section>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { data, loading, error, reload } = useAdminDashboard();
  return (
    <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} rows={4}>
      {data && <DashboardBody data={data} loading={loading} onRefresh={reload} />}
    </AsyncBoundary>
  );
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function Ratio({ label, value, detail, tone }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-text-secondary">{label}</span>
        <span className="text-[15px] font-semibold text-text-primary tabular-nums">{value}%</span>
      </div>
      <ProgressBar value={value} tone={tone} />
      <span className="text-[11px] text-text-muted">{detail}</span>
    </div>
  );
}

const avg = (a, b) => (b ? (a / b).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0');

function ReportsBody({ m }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Section title="Adoção" description="Uso da plataforma pelos usuários cadastrados.">
        <div className="flex flex-col gap-5">
          <Ratio label="Usuários ativos nas últimas 24h" value={pct(m.activeLast24h, m.totalUsers)} detail={`${m.activeLast24h} de ${m.totalUsers} usuários`} />
          <Ratio label="Contas ativas" value={pct(m.activeUsers, m.totalUsers)} detail={`${m.blockedUsers} conta(s) bloqueada(s)`} tone="bg-emerald-400" />
        </div>
      </Section>
      <Section title="Produtividade" description="Volume de trabalho em todos os workspaces.">
        <div className="flex flex-col gap-5">
          <Ratio label="Taxa de conclusão de tarefas" value={pct(m.completedTasks, m.totalTasks)} detail={`${m.completedTasks} de ${m.totalTasks} tarefas concluídas`} tone="bg-emerald-400" />
          <dl className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-lg border border-border p-3"><dt className="text-text-muted">Projetos por workspace</dt><dd className="text-[18px] font-semibold text-text-primary mt-1">{avg(m.totalProjects, m.totalWorkspaces)}</dd></div>
            <div className="rounded-lg border border-border p-3"><dt className="text-text-muted">Tarefas por projeto</dt><dd className="text-[18px] font-semibold text-text-primary mt-1">{avg(m.totalTasks, m.totalProjects)}</dd></div>
          </dl>
        </div>
      </Section>
      <Section title="Segurança e estabilidade" description="Últimas 24 horas." className="lg:col-span-2">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
          <div className="rounded-lg border border-border p-3"><dt className="text-text-muted">Erros do servidor</dt><dd className={`text-[18px] font-semibold mt-1 ${m.errorsLast24h ? 'text-red-400' : 'text-text-primary'}`}>{m.errorsLast24h}</dd></div>
          <div className="rounded-lg border border-border p-3"><dt className="text-text-muted">Tentativas de login com falha</dt><dd className={`text-[18px] font-semibold mt-1 ${m.failedLoginsLast24h ? 'text-amber-400' : 'text-text-primary'}`}>{m.failedLoginsLast24h}</dd></div>
          <div className="rounded-lg border border-border p-3"><dt className="text-text-muted">Sessões abertas</dt><dd className="text-[18px] font-semibold text-text-primary mt-1">{m.activeSessions}</dd></div>
        </dl>
      </Section>
    </div>
  );
}

export function AdminReports() {
  const { data, loading, error, reload } = useAdminDashboard();
  return (
    <AsyncBoundary loading={loading && !data} error={error} onRetry={reload}>
      {data && <ReportsBody m={data.metrics} />}
    </AsyncBoundary>
  );
}
