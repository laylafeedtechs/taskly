import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { greeting } from '../../lib/format';
import { Btn, Card, ErrorState, PageHeader, Skeleton } from '../ui';
import { CustomizePanel } from '../dashboard/CustomizePanel';
import { DEFAULT_LAYOUT, WIDGETS, WIDGET_BY_ID, WIDGET_COMPONENTS } from '../dashboard/widgets';

// Widgets that fetch their own data instead of the dashboard payload.
const SELF_LOADING = new Set(['calendar', 'reports', 'notifications']);

const toDraft = layout => [
  ...layout.map(id => ({ id, visible: true })),
  ...WIDGETS.filter(w => !layout.includes(w.id)).map(w => ({ id: w.id, visible: false }))
];

function WidgetSkeleton({ full }) {
  return (
    <Card className={full ? 'lg:col-span-2' : ''} aria-hidden="true">
      <Skeleton className="h-4 w-32 mb-4" />
      <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
    </Card>
  );
}

export function DashboardView() {
  const { user, setUser, currentWorkspaceId, tasks, tasksState, can, openQuickCreate, toast, showError } = useApp();
  const { data, error, loading, reload } = useAsync(() => api.search.dashboard(currentWorkspaceId), [currentWorkspaceId]);

  // Keep server-computed lists fresh after task edits made elsewhere (drawer, quick create).
  const tasksLoadedOnce = useRef(false);
  useEffect(() => {
    if (tasksState.loading) return undefined;
    if (!tasksLoadedOnce.current) { tasksLoadedOnce.current = true; return undefined; }
    const t = setTimeout(reload, 700);
    return () => clearTimeout(t);
  }, [tasks, tasksState.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = useMemo(() => {
    const saved = (user?.dashboardLayout || []).filter(id => WIDGET_BY_ID[id]);
    return saved.length ? saved : DEFAULT_LAYOUT;
  }, [user?.dashboardLayout]);

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const visible = editing ? draft.filter(w => w.visible).map(w => w.id) : layout;

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.auth.updateProfile({ dashboardLayout: draft.filter(w => w.visible).map(w => w.id) });
      setUser(res.user);
      setDraft(null);
      toast('Dashboard personalizado', 'success');
    } catch (err) { showError(err); } finally { setSaving(false); }
  };

  const firstName = (user?.name || '').split(' ')[0];

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description="Veja o que está acontecendo com o seu trabalho."
        actions={!editing && (
          <>
            <Btn icon="tune" onClick={() => setDraft(toDraft(layout))}>Personalizar</Btn>
            {can('task.create') && <Btn variant="primary" icon="add" onClick={() => openQuickCreate()}>Nova tarefa</Btn>}
          </>
        )}
      />

      {editing && (
        <CustomizePanel draft={draft} onChange={setDraft} saving={saving} onSave={save}
          onCancel={() => setDraft(null)} onReset={() => setDraft(toDraft(DEFAULT_LAYOUT))} />
      )}

      {error && !data && <Card className="mb-4"><ErrorState error={error} onRetry={reload} /></Card>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {visible.map(id => {
          const meta = WIDGET_BY_ID[id];
          const needsData = !SELF_LOADING.has(id);
          if (needsData && !data) return error ? null : <WidgetSkeleton key={id} full={meta.full} />;
          const Widget = WIDGET_COMPONENTS[id];
          return <div key={id} className={`min-w-0 ${meta.full ? 'lg:col-span-2' : ''}`}><Widget data={data} /></div>;
        })}
      </div>
      {loading && data && <span className="sr-only" role="status">Atualizando dashboard…</span>}
    </div>
  );
}
