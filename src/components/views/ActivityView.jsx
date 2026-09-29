import React from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { PageHeader, Btn, Field, Input, Select, Card, Alert } from '../ui';
import { ActivityFeed } from '../common/ActivityFeed';

const EVENT_TYPES = [
  { value: 'task.', label: 'Tarefas' },
  { value: 'comment.', label: 'Comentários' },
  { value: 'file.', label: 'Arquivos' },
  { value: 'project.', label: 'Projetos' },
  { value: 'member.', label: 'Membros' },
  { value: 'automation.', label: 'Automações' }
];
const FILTER_KEYS = ['ws', 'project', 'user', 'type', 'from', 'to'];

// Filters live in the URL so a filtered feed can be shared or refreshed.
export function ActivityView() {
  const { query, setQuery, workspaces, currentWorkspaceId, projects, members } = useApp();
  const ws = query.ws === 'ALL' ? '' : query.ws || currentWorkspaceId;
  const isCurrent = ws === currentWorkspaceId;

  // Other workspaces need their own project/member lists for the filters.
  const scope = useAsync(async () => {
    if (!ws || isCurrent) return null;
    const [p, m] = await Promise.all([api.projects.list(ws), api.team.members(ws)]);
    return { projects: p.projects, members: m.members };
  }, [ws, isCurrent]);
  const scopeProjects = isCurrent ? projects : scope.data?.projects || [];
  const scopeMembers = isCurrent ? members : scope.data?.members || [];

  const { project = '', user = '', type = '', from = '', to = '' } = query;
  const rangeInvalid = from && to && from > to;
  const hasFilters = FILTER_KEYS.some(k => k !== 'ws' && query[k]);

  const update = patch => setQuery(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v || null])));
  const changeWorkspace = value => update({ ws: value === currentWorkspaceId ? null : value || 'ALL', project: null, user: null });

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto animate-fadeIn">
      <PageHeader title="Atividade" description="Tudo o que aconteceu nos seus workspaces, em ordem cronológica." />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">
        <Card className="lg:sticky lg:top-20 flex flex-col gap-3">
          <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Filtros</p>
          <Field label="Workspace">
            <Select value={ws || ''} onChange={e => changeWorkspace(e.target.value)}>
              <option value="">Todos os workspaces</option>
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Projeto" hint={!ws ? 'Selecione um workspace para filtrar por projeto' : scope.error ? 'Não foi possível carregar os projetos' : null}>
            <Select value={project} disabled={!ws || scope.loading} onChange={e => update({ project: e.target.value })}>
              <option value="">Todos os projetos</option>
              {scopeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Pessoa" hint={!ws ? 'Selecione um workspace para filtrar por pessoa' : null}>
            <Select value={user} disabled={!ws || scope.loading} onChange={e => update({ user: e.target.value })}>
              <option value="">Todas as pessoas</option>
              {scopeMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Tipo de evento">
            <Select value={type} onChange={e => update({ type: e.target.value })}>
              <option value="">Todos os eventos</option>
              {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
            <Field label="De"><Input type="date" value={from} max={to || undefined} onChange={e => update({ from: e.target.value })} /></Field>
            <Field label="Até"><Input type="date" value={to} min={from || undefined} onChange={e => update({ to: e.target.value })} /></Field>
          </div>
          {rangeInvalid && <Alert tone="warning">A data inicial deve ser anterior à final.</Alert>}
          {hasFilters && <Btn variant="ghost" icon="filter_alt_off" onClick={() => update({ project: null, user: null, type: null, from: null, to: null })}>Limpar filtros</Btn>}
        </Card>
        <div className="min-w-0">
          {rangeInvalid ? null : (
            <ActivityFeed
              workspaceId={ws || undefined}
              projectId={project || undefined}
              userId={user || undefined}
              type={type || undefined}
              from={from || undefined}
              to={to || undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
