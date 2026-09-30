import React, { Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ToastContainer, ConfirmDialog } from './components/common/ToastContainer';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { LoginView } from './components/views/LoginView';
import { PrivacyPolicyView } from './components/views/PrivacyPolicyView';
import { EmailVerificationBanner } from './components/common/EmailVerificationBanner';
import { SearchPalette } from './components/common/SearchPalette';
import { QuickCreateModal } from './components/common/QuickCreateModal';
import { HelpCenterModal, ShortcutsModal } from './components/common/HelpCenterModal';
import { WorkspaceModal, InviteAcceptModal, OnboardingModal } from './components/common/WorkspaceModals';
import { LoadingState, EmptyState, Btn } from './components/ui';

const lazyNamed = (loader, name) => lazy(() => loader().then(m => ({ default: m[name] })));

const DashboardView = lazyNamed(() => import('./components/views/DashboardView'), 'DashboardView');
const MyTasksView = lazyNamed(() => import('./components/views/MyTasksView'), 'MyTasksView');
const ProjectsView = lazyNamed(() => import('./components/views/ProjectsView'), 'ProjectsView');
const ProjectDetailView = lazyNamed(() => import('./components/views/ProjectDetailView'), 'ProjectDetailView');
const KanbanView = lazyNamed(() => import('./components/views/KanbanView'), 'KanbanView');
const CalendarView = lazyNamed(() => import('./components/views/CalendarView'), 'CalendarView');
const TimelineView = lazyNamed(() => import('./components/views/TimelineView'), 'TimelineView');
const ReportsView = lazyNamed(() => import('./components/views/ReportsView'), 'ReportsView');
const AutomationsView = lazyNamed(() => import('./components/views/AutomationsView'), 'AutomationsView');
const NotificationsView = lazyNamed(() => import('./components/views/NotificationsView'), 'NotificationsView');
const ActivityView = lazyNamed(() => import('./components/views/ActivityView'), 'ActivityView');
const TeamView = lazyNamed(() => import('./components/views/TeamView'), 'TeamView');
const SettingsView = lazyNamed(() => import('./components/views/SettingsView'), 'SettingsView');
const TrashView = lazyNamed(() => import('./components/views/TrashView'), 'TrashView');
const AdminCenterView = lazyNamed(() => import('./components/views/AdminCenterView'), 'AdminCenterView');
const TaskDetailDrawer = lazyNamed(() => import('./components/tasks/TaskDetailDrawer'), 'TaskDetailDrawer');
const ProjectModal = lazyNamed(() => import('./components/projects/ProjectModal'), 'ProjectModal');

const ROUTES = {
  dashboard: DashboardView,
  'my-tasks': MyTasksView,
  projects: ProjectsView,
  kanban: KanbanView,
  calendar: CalendarView,
  timeline: TimelineView,
  reports: ReportsView,
  automations: AutomationsView,
  notifications: NotificationsView,
  activity: ActivityView,
  team: TeamView,
  settings: SettingsView,
  trash: TrashView,
  admin: AdminCenterView
};

function Splash() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center" aria-busy="true">
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.svg" alt="" className="w-10 h-10" />
        <div className="text-[13px] text-text-muted font-medium">Carregando Taskly…</div>
      </div>
    </div>
  );
}

function CurrentView() {
  const { route, params, user, currentWorkspace, workspacesLoaded, setWorkspaceModal, navigate } = useApp();
  if (route === 'admin' && !user?.isSuperAdmin) {
    return <EmptyState icon="lock" title="Acesso restrito" description="O Admin Center é exclusivo para Super Admins." action={<Btn onClick={() => navigate('/dashboard')}>Voltar ao dashboard</Btn>} />;
  }
  const needsWorkspace = !['settings', 'admin', 'notifications'].includes(route);
  if (needsWorkspace && workspacesLoaded && !currentWorkspace) {
    return <EmptyState icon="business" title="Nenhum workspace ativo" description="Crie um workspace para começar a organizar projetos e tarefas." action={<Btn variant="primary" icon="add" onClick={() => setWorkspaceModal({})}>Criar workspace</Btn>} />;
  }
  if (needsWorkspace && !currentWorkspace) return <LoadingState rows={4} />;
  const View = route === 'projects' && params.id ? ProjectDetailView : ROUTES[route];
  if (!View) {
    return <EmptyState icon="explore_off" title="Página não encontrada" action={<Btn onClick={() => navigate('/dashboard')}>Ir para o dashboard</Btn>} />;
  }
  return <View key={route === 'projects' ? params.id || 'list' : `${route}:${currentWorkspace?.id}`} />;
}

function Shell() {
  const { auth, route, query, toasts, removeToast, maintenanceBanner } = useApp();

  if (auth.status === 'loading') return <Splash />;
  // The privacy notice is public and standalone.
  if (route === 'privacy') return <PrivacyPolicyView />;
  // Password reset links work whether or not someone is signed in.
  if (auth.status !== 'authed' || query.reset) {
    return (
      <>
        <LoginView />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <ConfirmDialog />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[300] focus:bg-surface focus:px-3 focus:py-2 focus:rounded-lg">Pular para o conteúdo</a>
      <Sidebar />
      <div className="lg:pl-64 flex flex-col min-w-0 min-h-screen">
        <Header />
        <EmailVerificationBanner />
        {maintenanceBanner && <div role="status" className="bg-amber-500/10 border-b border-amber-500/25 text-amber-300 text-[12px] px-6 py-2">{maintenanceBanner}</div>}
        <main id="main" className="flex-1 min-w-0 w-full">
          <ErrorBoundary>
            <Suspense fallback={<div className="p-6"><LoadingState rows={4} /></div>}>
              <CurrentView />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <Suspense fallback={null}>
        <TaskDetailDrawer />
        <ProjectModal />
      </Suspense>
      <SearchPalette />
      <QuickCreateModal />
      <HelpCenterModal />
      <ShortcutsModal />
      <WorkspaceModal />
      <InviteAcceptModal />
      <OnboardingModal />
      <ConfirmDialog />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary fullPage>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ErrorBoundary>
  );
}
