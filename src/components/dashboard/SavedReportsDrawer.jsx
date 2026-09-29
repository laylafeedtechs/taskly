import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { formatDate, pluralize } from '../../lib/format';
import { Btn, Drawer, EmptyState, ErrorState, Input, LoadingState, Menu, IconBtn } from '../ui';

function filterSummary(f) {
  const parts = [`${formatDate(f.from)} – ${formatDate(f.to, { day: '2-digit', month: 'short', year: 'numeric' })}`];
  if (f.projectIds?.length) parts.push(pluralize(f.projectIds.length, 'projeto', 'projetos'));
  if (f.assigneeIds?.length) parts.push(pluralize(f.assigneeIds.length, 'membro', 'membros'));
  const extra = (f.priorities?.length || 0) + (f.types?.length || 0) + (f.tags?.length || 0);
  if (extra) parts.push(pluralize(extra, 'filtro extra', 'filtros extras'));
  return parts.join(' · ');
}

// Lists saved reports with apply / rename / duplicate / delete.
// `saved` is the useAsync state owned by the parent so saves elsewhere update it.
export function SavedReportsDrawer({ open, onClose, saved, onApply }) {
  const { toast, showError, confirm } = useApp();
  const [editing, setEditing] = useState(null); // { id, name }
  const [busy, setBusy] = useState(false);
  const list = saved.data?.savedReports || [];
  const setList = fn => saved.setData(d => ({ ...d, savedReports: fn(d?.savedReports || []) }));

  const rename = async e => {
    e.preventDefault();
    const name = editing.name.trim();
    if (name.length < 2) return;
    setBusy(true);
    try {
      const res = await api.reports.updateSaved(editing.id, { name });
      setList(l => l.map(r => (r.id === res.savedReport.id ? res.savedReport : r)));
      setEditing(null);
      toast('Relatório renomeado', 'success');
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  const duplicate = async r => {
    try {
      const res = await api.reports.duplicateSaved(r.id);
      setList(l => [...l, res.savedReport]);
      toast(`"${res.savedReport.name}" criado`, 'success');
    } catch (err) { showError(err); }
  };

  const remove = async r => {
    const ok = await confirm({ title: `Excluir "${r.name}"?`, message: 'O relatório salvo será removido para todos do workspace. Os dados das tarefas não são afetados.', confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await api.reports.deleteSaved(r.id);
      setList(l => l.filter(x => x.id !== r.id));
      toast('Relatório excluído', 'success');
    } catch (err) { showError(err); }
  };

  let body;
  if (!saved.data && !saved.error) body = <div className="p-4"><LoadingState rows={3} /></div>;
  else if (saved.error) body = <ErrorState error={saved.error} onRetry={saved.reload} />;
  else if (!list.length) body = <EmptyState icon="bookmark" title="Nenhum relatório salvo" description="Ajuste os filtros e use “Salvar relatório” para reutilizá-los depois." />;
  else body = (
    <ul className="flex flex-col gap-2 p-4">
      {list.map(r => (
        <li key={r.id} className="p-3 rounded-lg border border-border bg-surface-card">
          {editing?.id === r.id ? (
            <form onSubmit={rename} className="flex flex-col gap-2">
              <Input aria-label="Nome do relatório" value={editing.name} autoFocus maxLength={100}
                onChange={e => setEditing({ ...editing, name: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Btn size="xs" onClick={() => setEditing(null)}>Cancelar</Btn>
                <Btn size="xs" variant="primary" type="submit" loading={busy} disabled={editing.name.trim().length < 2}>Salvar</Btn>
              </div>
            </form>
          ) : (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text-primary truncate">{r.name}</p>
                <p className="text-[11px] text-text-muted mt-0.5">{filterSummary(r.filters)}</p>
              </div>
              <Btn size="xs" onClick={() => onApply(r)}>Aplicar</Btn>
              <Menu
                trigger={props => <IconBtn icon="more_horiz" size="xs" label={`Ações de ${r.name}`} onClick={props.toggle} aria-expanded={props['aria-expanded']} aria-haspopup="menu" />}
                items={[
                  { label: 'Renomear', icon: 'edit', onClick: () => setEditing({ id: r.id, name: r.name }) },
                  { label: 'Duplicar', icon: 'content_copy', onClick: () => duplicate(r) },
                  '-',
                  { label: 'Excluir', icon: 'delete', danger: true, onClick: () => remove(r) }
                ]}
                width={180}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return <Drawer open={open} onClose={onClose} title="Relatórios salvos" width={420}>{body}</Drawer>;
}
