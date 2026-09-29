import React, { useCallback, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Btn, Card, EmptyState, Icon, PageHeader, Pill, Tabs, Toggle } from '../ui';
import { RowMenu } from '../settings/common';
import { AutomationBuilder, FIELD_LABEL } from '../automations/AutomationBuilder';
import { AutomationLogs } from '../automations/AutomationLogs';

const TARGET_LABEL = { assignee: 'responsável', project_managers: 'gestores' };

function SummaryLine({ step, tone, children }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className={`flex-shrink-0 w-12 text-[10px] font-mono font-semibold tracking-wider pt-px ${tone}`}>{step}</span>
      <span className="text-[12px] text-text-secondary min-w-0 break-words">{children}</span>
    </div>
  );
}

export function AutomationsView() {
  const { currentWorkspaceId, params, navigate, can, toast, confirm, showError, members, projects } = useApp();
  const tab = params.id === 'logs' ? 'logs' : 'rules';
  const canManage = can('automations.manage');
  const [builder, setBuilder] = useState(null); // null | { automation? }
  const [busyId, setBusyId] = useState(null);

  const { data, loading, error, reload, setData } = useAsync(async () => {
    const [list, meta] = await Promise.all([api.automations.list(currentWorkspaceId), api.automations.meta()]);
    return { automations: list.automations, meta };
  }, [currentWorkspaceId]);
  const automations = data?.automations || [];

  // API summaries reference raw ids; swap them for names the user recognizes.
  const humanize = useCallback(text => {
    if (!text) return text;
    let out = text;
    members.forEach(m => { out = out.split(m.id).join(m.name); });
    projects.forEach(p => { out = out.split(p.id).join(p.name); });
    Object.entries(TARGET_LABEL).forEach(([k, l]) => { out = out.replace(new RegExp(`\\b${k}\\b`, 'g'), l); });
    Object.entries(FIELD_LABEL).forEach(([k, l]) => { out = out.replace(new RegExp(`(^|E )${k} `, 'g'), `$1${l} `); });
    return out;
  }, [members, projects]);

  const replace = automation => setData(d => ({ ...d, automations: d.automations.map(a => (a.id === automation.id ? automation : a)) }));

  const toggle = async a => {
    setBusyId(a.id);
    replace({ ...a, enabled: !a.enabled });
    try {
      const res = await api.automations.update(a.id, { enabled: !a.enabled });
      replace(res.automation);
      toast(res.automation.enabled ? 'Automação ativada' : 'Automação desativada', 'success');
    } catch (err) { replace(a); showError(err); } finally { setBusyId(null); }
  };

  const duplicate = async a => {
    try {
      const res = await api.automations.duplicate(a.id);
      setData(d => ({ ...d, automations: [...d.automations, res.automation] }));
      toast('Automação duplicada (inativa até você ativá-la)', 'success');
    } catch (err) { showError(err); }
  };

  const remove = async a => {
    const ok = await confirm({ title: `Excluir "${a.title}"?`, message: 'A regra deixará de ser executada. O histórico de execuções é mantido.', confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await api.automations.remove(a.id);
      setData(d => ({ ...d, automations: d.automations.filter(x => x.id !== a.id) }));
      toast('Automação excluída', 'success');
    } catch (err) { showError(err); }
  };

  const onSaved = (automation, created) => {
    setData(d => ({ ...d, automations: created ? [...d.automations, automation] : d.automations.map(a => (a.id === automation.id ? automation : a)) }));
    setBuilder(null);
    toast(created ? 'Automação criada' : 'Automação atualizada', 'success');
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        icon="bolt"
        title="Central de automações"
        description="Regras WHEN → IF → THEN que executam ações automaticamente nas tarefas."
        actions={canManage && tab === 'rules' && <Btn variant="primary" icon="add" onClick={() => setBuilder({})} disabled={!data}>Nova automação</Btn>}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={id => navigate(id === 'logs' ? '/automations/logs' : '/automations')}
        tabs={[{ id: 'rules', label: 'Regras', icon: 'rule', count: data ? automations.length : undefined }, { id: 'logs', label: 'Logs de execução', icon: 'history' }]}
      />

      {!canManage && tab === 'rules' && <div className="mb-4"><Alert>Você pode visualizar as automações, mas apenas gestores e proprietários podem criá-las ou editá-las.</Alert></div>}

      {tab === 'logs' ? (
        <AutomationLogs automations={automations} humanize={humanize} />
      ) : (
        <AsyncBoundary loading={loading} error={error} onRetry={reload} empty={!automations.length} rows={4}
          emptyState={<EmptyState icon="bolt" title="Nenhuma automação ainda" description="Automatize tarefas repetitivas: notificar gestores, mudar prioridades, atribuir responsáveis e mais."
            action={canManage && <Btn variant="primary" icon="add" onClick={() => setBuilder({})}>Criar primeira automação</Btn>} />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {automations.map(a => {
              const scope = a.projectId ? projects.find(p => p.id === a.projectId)?.name || 'Projeto removido' : 'Todos os projetos';
              return (
                <Card key={a.id} className={`flex flex-col gap-4 transition-colors hover:border-border-focus ${a.enabled ? '' : 'opacity-75'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-text-primary break-words">{a.title}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <Pill><Icon name="folder" size={12} />{scope}</Pill>
                        {!canManage && <Pill className={a.enabled ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' : undefined}>{a.enabled ? 'Ativa' : 'Inativa'}</Pill>}
                      </div>
                      {a.description && <p className="text-[12px] text-text-muted mt-2 line-clamp-2">{a.description}</p>}
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Toggle checked={a.enabled} disabled={busyId === a.id} onChange={() => toggle(a)} label={<span className="text-[12px] text-text-secondary">{a.enabled ? 'Ativa' : 'Inativa'}</span>} />
                        <RowMenu
                          label={`Ações de ${a.title}`}
                          items={[
                            { label: 'Editar', icon: 'edit', onClick: () => setBuilder({ automation: a }) },
                            { label: 'Duplicar', icon: 'content_copy', onClick: () => duplicate(a) },
                            '-',
                            { label: 'Excluir', icon: 'delete', danger: true, onClick: () => remove(a) }
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-lg bg-background-secondary/60 border border-border-subtle p-3">
                    <SummaryLine step="WHEN" tone="text-blue-400">{a.summary.trigger}</SummaryLine>
                    <SummaryLine step="IF" tone="text-amber-400">{humanize(a.summary.condition)}</SummaryLine>
                    <SummaryLine step="THEN" tone="text-emerald-400">{humanize(a.summary.action)}</SummaryLine>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted mt-auto">
                    <span className="inline-flex items-center gap-1"><Icon name="play_circle" size={14} />{a.executionsCount || 0} execuç{a.executionsCount === 1 ? 'ão' : 'ões'}</span>
                    <span className="inline-flex items-center gap-1"><Icon name="schedule" size={14} />{a.lastTriggeredAt ? `Última: ${timeAgo(a.lastTriggeredAt)}` : 'Nunca executada'}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        </AsyncBoundary>
      )}

      {data && (
        <AutomationBuilder open={Boolean(builder)} automation={builder?.automation} meta={data.meta} onClose={() => setBuilder(null)} onSaved={onSaved} />
      )}
    </div>
  );
}
