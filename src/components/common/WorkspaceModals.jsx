import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Modal, Btn, Field, Input, Select, Alert, Icon } from '../ui';
import { ROLE_LABEL } from '../../lib/format';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#A0A0A0'];
const ICONS = ['business', 'rocket_launch', 'code', 'campaign', 'school', 'palette', 'handshake', 'language'];

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor">
      {COLORS.map(c => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`Cor ${c}`} onClick={() => onChange(c)}
          className={`w-7 h-7 rounded-lg border-2 transition-transform ${value === c ? 'border-text-primary scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

export function WorkspaceModal() {
  const { workspaceModal, setWorkspaceModal, createWorkspace, showError } = useApp();
  const [form, setForm] = useState({ name: '', color: COLORS[0], icon: ICONS[0] });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (workspaceModal) setForm({ name: '', color: COLORS[0], icon: ICONS[0] }); }, [workspaceModal]);
  if (!workspaceModal) return null;

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    try { await createWorkspace(form); setWorkspaceModal(null); } catch (err) { showError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={() => setWorkspaceModal(null)} title="Novo workspace" description="Workspaces isolam projetos, tarefas, membros e permissões.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome" required><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required minLength={2} maxLength={60} data-autofocus placeholder="Ex.: Agência, Produto, Estudos" /></Field>
        <Field label="Cor"><ColorPicker value={form.color} onChange={color => setForm(f => ({ ...f, color }))} /></Field>
        <Field label="Ícone">
          <div className="flex flex-wrap gap-2">
            {ICONS.map(i => (
              <button key={i} type="button" aria-label={i} aria-pressed={form.icon === i} onClick={() => setForm(f => ({ ...f, icon: i }))}
                className={`w-9 h-9 rounded-lg border flex items-center justify-center ${form.icon === i ? 'border-border-focus bg-surface-elevated text-text-primary' : 'border-border text-text-muted hover:text-text-primary'}`}><Icon name={i} size={18} /></button>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Btn onClick={() => setWorkspaceModal(null)}>Cancelar</Btn>
          <Btn type="submit" variant="primary" loading={saving} disabled={form.name.trim().length < 2}>Criar workspace</Btn>
        </div>
      </form>
    </Modal>
  );
}

// Accepts a pending invitation (from ?invite= or one remembered before login).
export function InviteAcceptModal() {
  const { query, setQuery, user, reloadWorkspaces, switchWorkspace, toast } = useApp();
  const [token, setToken] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = query.invite || sessionStorage.getItem('taskly.invite');
    if (!t) return;
    setToken(t);
    api.workspaces.previewInvite(t).then(setPreview).catch(err => setError(err.message));
  }, [query.invite]);

  const close = () => {
    sessionStorage.removeItem('taskly.invite');
    if (query.invite) setQuery({ invite: null });
    setToken(null); setPreview(null); setError('');
  };
  if (!token) return null;

  const accept = async () => {
    setBusy(true);
    try {
      const res = await api.workspaces.acceptInvite(token);
      await reloadWorkspaces();
      switchWorkspace(res.workspace.id);
      toast(`Você entrou em ${res.workspace.name}`, 'success');
      close();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const mismatch = preview && preview.email !== user.email.toLowerCase();
  return (
    <Modal open onClose={close} title="Convite para workspace" size="sm"
      footer={<><Btn onClick={close}>{error ? 'Fechar' : 'Agora não'}</Btn>{!error && preview && !mismatch && <Btn variant="primary" loading={busy} onClick={accept}>Aceitar convite</Btn>}</>}>
      {!preview && !error && <p className="text-[13px] text-text-secondary">Verificando convite…</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {preview && !error && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-secondary"><strong className="text-text-primary">{preview.invitedBy || 'Um membro'}</strong> convidou você para <strong className="text-text-primary">{preview.workspaceName}</strong> com o papel de <strong className="text-text-primary">{ROLE_LABEL[preview.role]}</strong>.</p>
          {mismatch && <Alert tone="warning">Este convite foi enviado para <span className="font-mono">{preview.email}</span>, mas você está conectado como <span className="font-mono">{user.email}</span>. Entre com a conta convidada para aceitar.</Alert>}
        </div>
      )}
    </Modal>
  );
}

const STEPS = ['Seu nome', 'Workspace', 'Convidar equipe', 'Primeiro projeto', 'Primeira tarefa'];

export function OnboardingModal() {
  const { onboardingOpen, setOnboardingOpen, user, setUser, currentWorkspace, setWorkspaces, reloadProjects, createTask, showError, navigate, toast } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [wsName, setWsName] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'Member', sent: [] });
  const [projectName, setProjectName] = useState('');
  const [project, setProject] = useState(null);
  const [taskTitle, setTaskTitle] = useState('');

  useEffect(() => {
    if (onboardingOpen) { setName(user?.name || ''); setWsName(currentWorkspace?.name || ''); }
  }, [onboardingOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!onboardingOpen || !user) return null;

  const finish = async () => {
    try { const res = await api.auth.updateProfile({ onboardingCompleted: true }); setUser(res.user); } catch (err) { showError(err); }
    setOnboardingOpen(false);
    if (project) navigate(`/projects/${project.id}/board`);
  };
  const later = () => { sessionStorage.setItem('taskly.onboarding.later', '1'); setOnboardingOpen(false); };
  const run = async fn => { setBusy(true); try { await fn(); setStep(s => s + 1); } catch (err) { showError(err); } finally { setBusy(false); } };

  const canManage = currentWorkspace?.permissions?.includes('members.manage');
  const actions = [
    () => run(async () => { if (name.trim() && name.trim() !== user.name) setUser((await api.auth.updateProfile({ name: name.trim() })).user); }),
    () => run(async () => {
      if (currentWorkspace && wsName.trim() && wsName.trim() !== currentWorkspace.name && currentWorkspace.permissions.includes('workspace.manage')) {
        const res = await api.workspaces.update(currentWorkspace.id, { name: wsName.trim() });
        setWorkspaces(list => list.map(w => (w.id === res.workspace.id ? res.workspace : w)));
      }
    }),
    () => setStep(3),
    () => run(async () => {
      if (project || !projectName.trim()) return;
      const res = await api.projects.create(currentWorkspace.id, { name: projectName.trim(), templateId: 'tpl-blank' });
      setProject(res.project);
      await reloadProjects();
    }),
    async () => {
      if (taskTitle.trim() && project) {
        setBusy(true);
        try { await createTask({ title: taskTitle.trim(), projectId: project.id }); } catch (err) { showError(err); setBusy(false); return; }
        setBusy(false);
      }
      finish();
    }
  ];

  const sendInvite = async () => {
    setBusy(true);
    try {
      const res = await api.workspaces.invite(currentWorkspace.id, invite.email, invite.role);
      setInvite(i => ({ email: '', role: i.role, sent: [...i.sent, { email: res.invitation.email, link: res.inviteLink }] }));
      toast('Convite criado', 'success');
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={later} title="Vamos configurar o Taskly" description={`Etapa ${step + 1} de ${STEPS.length} — ${STEPS[step]}`} size="md"
      footer={<>
        <Btn variant="ghost" onClick={later} className="mr-auto">Continuar depois</Btn>
        {step < 4 && <Btn onClick={() => setStep(s => s + 1)}>Pular</Btn>}
        {step === 4 && <Btn onClick={finish}>Concluir sem tarefa</Btn>}
        <Btn variant="primary" loading={busy} onClick={actions[step]} disabled={(step === 3 && !projectName.trim() && !project) || (step === 4 && (!taskTitle.trim() || !project))}>{step === 4 ? 'Criar e concluir' : 'Continuar'}</Btn>
      </>}>
      <ol className="flex gap-1.5 mb-5" aria-label="Progresso">
        {STEPS.map((s, i) => <li key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-blue-500' : 'bg-surface-hover'}`} aria-current={i === step ? 'step' : undefined}><span className="sr-only">{s}</span></li>)}
      </ol>
      {step === 0 && <Field label="Como devemos chamar você?"><Input value={name} onChange={e => setName(e.target.value)} data-autofocus maxLength={80} /></Field>}
      {step === 1 && (
        <Field label="Nome do seu workspace" hint="Você pode criar outros workspaces depois.">
          <Input value={wsName} onChange={e => setWsName(e.target.value)} data-autofocus maxLength={60} disabled={!currentWorkspace?.permissions?.includes('workspace.manage')} />
        </Field>
      )}
      {step === 2 && (canManage ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input type="email" placeholder="colega@empresa.com" value={invite.email} onChange={e => setInvite(i => ({ ...i, email: e.target.value }))} aria-label="E-mail do convidado" />
            <Select value={invite.role} onChange={e => setInvite(i => ({ ...i, role: e.target.value }))} aria-label="Papel" className="sm:w-36">
              {['Manager', 'Member', 'Viewer'].map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
            <Btn onClick={sendInvite} loading={busy} disabled={!invite.email.includes('@')}>Convidar</Btn>
          </div>
          {invite.sent.map(s => (
            <div key={s.email} className="text-[12px] text-text-secondary">
              <Icon name="check" size={14} className="text-emerald-400 mr-1 align-middle" />{s.email}
              {s.link && <div className="mt-1 font-mono text-[11px] break-all text-text-muted">E-mail não configurado — compartilhe o link: {s.link}</div>}
            </div>
          ))}
        </div>
      ) : <Alert>Somente proprietários e gestores podem convidar pessoas para este workspace.</Alert>)}
      {step === 3 && (project
        ? <Alert tone="success">Projeto <strong>{project.name}</strong> criado.</Alert>
        : <Field label="Nome do primeiro projeto"><Input value={projectName} onChange={e => setProjectName(e.target.value)} data-autofocus placeholder="Ex.: Lançamento do site" maxLength={100} /></Field>)}
      {step === 4 && (project
        ? <Field label={`Primeira tarefa em ${project.name}`}><Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} data-autofocus placeholder="Ex.: Definir escopo" maxLength={200} /></Field>
        : <Alert>Crie um projeto na etapa anterior para adicionar a primeira tarefa, ou conclua agora.</Alert>)}
    </Modal>
  );
}
