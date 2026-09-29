import React from 'react';
import { Btn, Icon, IconBtn, LoadingState, ErrorState, Pill } from '../ui';
import { pluralize } from '../../lib/format';

const BLANK = { id: null, name: 'Projeto em branco', description: 'Comece do zero com as colunas padrão: Backlog, A Fazer, Em Andamento, Em Revisão e Concluído.', icon: 'note_add', columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'], defaultTags: [], milestones: [], tasks: [] };

function TemplatePreview({ template }) {
  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div>
        <p className="text-[14px] font-semibold text-text-primary">{template.name}</p>
        {template.description && <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">{template.description}</p>}
      </div>
      <PreviewSection title="Colunas" icon="view_column">
        <div className="flex flex-wrap gap-1">{template.columns.map((c, i) => <Pill key={`${c}-${i}`}>{c}</Pill>)}</div>
      </PreviewSection>
      <PreviewSection title="Tags padrão" icon="sell" empty={!template.defaultTags?.length}>
        <div className="flex flex-wrap gap-1">{template.defaultTags?.map(t => <Pill key={t}>{t}</Pill>)}</div>
      </PreviewSection>
      <PreviewSection title="Marcos" icon="flag" empty={!template.milestones?.length}>
        <ul className="flex flex-col gap-1">
          {template.milestones?.map((m, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="text-text-primary truncate">{m.name}</span>
              <span className="text-text-muted font-mono text-[11px] flex-shrink-0">+{m.offsetDays}d</span>
            </li>
          ))}
        </ul>
      </PreviewSection>
      <PreviewSection title={`Tarefas iniciais${template.tasks?.length ? ` (${template.tasks.length})` : ''}`} icon="checklist" empty={!template.tasks?.length}>
        <ul className="flex flex-col gap-1">
          {template.tasks?.slice(0, 6).map((t, i) => (
            <li key={i} className="flex items-center gap-1.5 text-[12px] text-text-secondary min-w-0">
              <Icon name="check_box_outline_blank" size={14} className="text-text-muted flex-shrink-0" />
              <span className="truncate">{t.title}</span>
            </li>
          ))}
          {template.tasks?.length > 6 && <li className="text-[11px] text-text-muted">+ {template.tasks.length - 6} tarefa(s)</li>}
        </ul>
      </PreviewSection>
    </div>
  );
}

function PreviewSection({ title, icon, empty, children }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1.5"><Icon name={icon} size={13} />{title}</p>
      {empty ? <p className="text-[12px] text-text-muted">Nenhum</p> : children}
    </div>
  );
}

export function TemplatePicker({ templates, loading, error, onRetry, selectedId, onSelect, onDelete, onCreate, canCreate, canDelete }) {
  const all = [BLANK, ...(templates || [])];
  const selected = all.find(t => t.id === selectedId) || BLANK;

  if (loading) return <LoadingState rows={4} label="Carregando templates" />;
  if (error) return <ErrorState error={error} onRetry={onRetry} compact />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] gap-4">
      <div className="flex flex-col gap-2 min-w-0">
        <div role="radiogroup" aria-label="Template do projeto" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {all.map(t => {
            const active = t.id === selected.id;
            return (
              <div key={t.id || 'blank'} className={`relative rounded-xl border transition-colors ${active ? 'border-blue-500/60 bg-blue-500/10' : 'border-border bg-surface-card hover:bg-surface-hover hover:border-border-focus'}`}>
                <button type="button" role="radio" aria-checked={active} onClick={() => onSelect(t.id)} className="w-full text-left p-3 pr-9 flex items-start gap-2.5 rounded-xl">
                  <span className="w-8 h-8 rounded-lg bg-surface-elevated border border-border flex items-center justify-center flex-shrink-0">
                    <Icon name={t.icon || 'dashboard_customize'} size={17} className={active ? 'text-blue-400' : 'text-text-secondary'} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-text-primary truncate">{t.name}</span>
                    <span className="block text-[11px] text-text-muted mt-0.5">
                      {t.id === null ? 'Estrutura padrão' : `${pluralize(t.columns.length, 'coluna', 'colunas')} · ${pluralize(t.tasks?.length || 0, 'tarefa', 'tarefas')}`}
                      {t.workspaceId && ' · Personalizado'}
                    </span>
                  </span>
                </button>
                {t.workspaceId && canDelete && (
                  <IconBtn icon="delete" size="xs" label={`Excluir template ${t.name}`} onClick={() => onDelete(t)} className="absolute top-2 right-2 hover:text-red-400" />
                )}
              </div>
            );
          })}
        </div>
        {canCreate && (
          <Btn variant="ghost" icon="add" className="self-start" onClick={onCreate}>Criar template personalizado</Btn>
        )}
      </div>
      <aside className="rounded-xl border border-border bg-background-secondary p-4 min-w-0" aria-label="Pré-visualização do template">
        <TemplatePreview template={selected} />
      </aside>
    </div>
  );
}
