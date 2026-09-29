import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { ROLE_LABEL, formatDate, formatDateTime, timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Avatar, Btn, EmptyState, Field, Input, Modal, PageHeader, Pill, Select } from '../ui';
import { CopyField, RowMenu, Section, TableWrap, Td, Th, errorText } from '../settings/common';
import { PermissionMatrixTable } from '../settings/PermissionMatrix';

const ROLE_TONE = {
  Owner: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  Manager: 'text-blue-400 bg-blue-500/10 border-blue-500/25'
};
const RoleBadge = ({ role }) => <Pill className={ROLE_TONE[role]}>{ROLE_LABEL[role] || role}</Pill>;

function InviteForm({ roles, onInvited }) {
  const { currentWorkspaceId, toast } = useApp();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roles.includes('Member') ? 'Member' : roles[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState(null);

  const submit = async e => {
    e.preventDefault();
    setSaving(true); setError(null); setLink(null);
    try {
      const res = await api.workspaces.invite(currentWorkspaceId, email.trim(), role);
      if (res.inviteLink) setLink(res.inviteLink);
      toast(res.emailDelivered ? `Convite enviado para ${res.invitation.email}` : 'Convite criado — compartilhe o link manualmente', 'success');
      setEmail('');
      onInvited(res.invitation);
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
        <Field label="E-mail">
          <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@empresa.com" autoComplete="off" />
        </Field>
        <Field label="Papel">
          <Select value={role} onChange={e => setRole(e.target.value)}>
            {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
        <Btn type="submit" variant="primary" size="md" icon="send" loading={saving}>Convidar</Btn>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {link && (
        <div className="flex flex-col gap-2">
          <Alert tone="warning">O envio de e-mails (SMTP) não está configurado nesta instalação. Copie o link abaixo e envie ao convidado. Ele expira em 7 dias e só funciona para o e-mail convidado.</Alert>
          <CopyField value={link} label="Link do convite" />
        </div>
      )}
    </form>
  );
}

function TransferModal({ open, onClose, candidates, onDone }) {
  const { currentWorkspace, confirm, toast } = useApp();
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const member = candidates.find(m => m.id === target);

  const submit = async e => {
    e.preventDefault();
    if (!member) return;
    const ok = await confirm({
      title: 'Transferir propriedade?',
      message: `${member.name} se tornará proprietário(a) de "${currentWorkspace.name}". Você passará a ser Gestor e perderá o controle total do workspace.`,
      confirmLabel: 'Transferir propriedade',
      danger: true,
      requireText: currentWorkspace.name
    });
    if (!ok) return;
    setSaving(true); setError(null);
    try {
      await api.team.transferOwnership(currentWorkspace.id, member.id);
      toast(`Propriedade transferida para ${member.name}`, 'success');
      onDone();
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Transferir propriedade" description="Escolha o membro que será o novo proprietário do workspace."
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="danger" type="submit" form="transfer-form" disabled={!member} loading={saving}>Continuar</Btn></>}>
      <form id="transfer-form" onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Novo proprietário">
          <Select value={target} onChange={e => setTarget(e.target.value)} required data-autofocus>
            <option value="">Selecione um membro…</option>
            {candidates.map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

export function TeamView() {
  const { user, currentWorkspace, currentWorkspaceId, can, confirm, toast, showError, reloadMembers, reloadWorkspaces, navigate } = useApp();
  const canManage = can('members.manage');
  const isOwner = currentWorkspace?.ownerId === user.id;
  const [transferOpen, setTransferOpen] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const membersState = useAsync(() => api.team.members(currentWorkspaceId), [currentWorkspaceId]);
  const matrixState = useAsync(() => api.team.permissionsMatrix(currentWorkspaceId), [currentWorkspaceId]);
  const invitesState = useAsync(() => (canManage ? api.workspaces.invitations(currentWorkspaceId) : Promise.resolve({ invitations: [] })), [currentWorkspaceId, canManage]);

  const members = membersState.data?.members || [];
  const assignable = (matrixState.data?.assignableRoles || []).filter(r => r !== 'Owner');
  const invitations = invitesState.data?.invitations || [];

  const patchMember = (id, patch) => membersState.setData(d => ({ ...d, members: d.members.map(m => (m.id === id ? { ...m, ...patch } : m)) }));

  const changeRole = async (member, role) => {
    setSavingId(member.id);
    const previous = member.workspaceRole;
    patchMember(member.id, { workspaceRole: role });
    try {
      await api.team.updateRole(currentWorkspaceId, member.id, role);
      toast(`${member.name} agora é ${ROLE_LABEL[role]}`, 'success');
      reloadMembers();
    } catch (err) { patchMember(member.id, { workspaceRole: previous }); showError(err); } finally { setSavingId(null); }
  };

  const removeMember = async member => {
    const ok = await confirm({ title: `Remover ${member.name}?`, message: `${member.name} perderá o acesso a "${currentWorkspace.name}". As tarefas abertas atribuídas a essa pessoa ficarão sem responsável.`, confirmLabel: 'Remover membro', danger: true });
    if (!ok) return;
    try {
      await api.team.remove(currentWorkspaceId, member.id);
      membersState.setData(d => ({ ...d, members: d.members.filter(m => m.id !== member.id) }));
      reloadMembers();
      toast(`${member.name} foi removido(a) do workspace`, 'success');
    } catch (err) { showError(err); }
  };

  const revokeInvite = async inv => {
    const ok = await confirm({ title: `Revogar convite para ${inv.email}?`, message: 'O link enviado deixará de funcionar.', confirmLabel: 'Revogar', danger: true });
    if (!ok) return;
    try {
      await api.workspaces.revokeInvite(currentWorkspaceId, inv.id);
      invitesState.setData(d => ({ ...d, invitations: d.invitations.filter(i => i.id !== inv.id) }));
      toast('Convite revogado', 'success');
    } catch (err) { showError(err); }
  };

  const leave = async () => {
    const ok = await confirm({ title: `Sair de "${currentWorkspace.name}"?`, message: 'Você perderá o acesso a projetos e tarefas deste workspace até ser convidado novamente.', confirmLabel: 'Sair do workspace', danger: true });
    if (!ok) return;
    try {
      await api.workspaces.leave(currentWorkspaceId);
      toast(`Você saiu de "${currentWorkspace.name}"`, 'success');
      await reloadWorkspaces();
      navigate('/dashboard');
    } catch (err) { showError(err); }
  };

  const onTransferred = async () => {
    setTransferOpen(false);
    try { await reloadWorkspaces(); } catch (err) { showError(err); }
    membersState.reload();
    matrixState.reload();
    reloadMembers();
  };

  const canEdit = m => canManage && m.id !== user.id && m.workspaceRole !== 'Owner' && assignable.includes(m.workspaceRole);

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader
        icon="group"
        title="Equipe"
        description={`Membros, convites e permissões de ${currentWorkspace?.name || 'seu workspace'}.`}
        actions={<>
          {isOwner && <Btn icon="swap_horiz" onClick={() => setTransferOpen(true)} disabled={members.length < 2}>Transferir propriedade</Btn>}
          {!isOwner && members.some(m => m.id === user.id) && <Btn variant="danger" icon="logout" onClick={leave}>Sair do workspace</Btn>}
        </>}
      />

      <div className="flex flex-col gap-5">
        <Section title="Membros" description={membersState.data ? `${members.length} pessoa(s) com acesso` : undefined}>
          <AsyncBoundary loading={membersState.loading && !membersState.data} error={membersState.error} onRetry={membersState.reload} empty={!members.length}
            emptyState={<EmptyState icon="group" title="Nenhum membro" compact />}>
            <TableWrap minWidth={760}>
              <thead><tr><Th>Membro</Th><Th>Papel</Th><Th>Entrou em</Th><Th>Último acesso</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} className="hover:bg-surface-hover/50">
                    <Td>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar user={m} size={30} />
                        <div className="min-w-0">
                          <div className="text-[13px] text-text-primary font-medium truncate">
                            {m.name}{m.id === user.id && <span className="text-text-muted font-normal"> (você)</span>}
                            {m.status === 'BLOCKED' && <Pill className="ml-2 text-red-400 bg-red-500/10 border-red-500/25">Bloqueado</Pill>}
                          </div>
                          <div className="text-[11px] text-text-muted truncate">{m.email}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {canEdit(m) ? (
                        <Select value={m.workspaceRole} disabled={savingId === m.id} onChange={e => changeRole(m, e.target.value)} aria-label={`Papel de ${m.name}`} className="h-8 w-36">
                          {assignable.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </Select>
                      ) : <RoleBadge role={m.workspaceRole} />}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(m.joinedAt, { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                    <Td className="whitespace-nowrap" title={m.lastLoginAt ? formatDateTime(m.lastLoginAt) : undefined}>{m.lastLoginAt ? timeAgo(m.lastLoginAt) : 'Nunca'}</Td>
                    <Td className="text-right w-12">
                      {canEdit(m) && <RowMenu label={`Ações de ${m.name}`} items={[{ label: 'Remover do workspace', icon: 'person_remove', danger: true, onClick: () => removeMember(m) }]} />}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {canManage && <p className="text-[11px] text-text-muted mt-3">A propriedade só pode ser transferida pelo proprietário. Você não pode alterar o seu próprio papel.</p>}
          </AsyncBoundary>
        </Section>

        {canManage && (
          <Section title="Convidar pessoas" description="Convites expiram em 7 dias.">
            {matrixState.loading ? null : assignable.length
              ? <InviteForm roles={assignable} onInvited={inv => invitesState.setData(d => ({ ...d, invitations: [inv, ...(d?.invitations || []).filter(i => i.email !== inv.email)] }))} />
              : <Alert>Seu papel não permite convidar novos membros.</Alert>}

            <h3 className="text-[12px] font-semibold text-text-secondary mt-6 mb-2">Convites pendentes</h3>
            <AsyncBoundary loading={invitesState.loading && !invitesState.data} error={invitesState.error} onRetry={invitesState.reload} empty={!invitations.length}
              emptyState={<p className="text-[12px] text-text-muted py-2">Nenhum convite pendente.</p>}>
              <ul className="divide-y divide-border-subtle border border-border rounded-lg">
                {invitations.map(inv => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-[180px]">
                      <div className="text-[13px] text-text-primary truncate">{inv.email}</div>
                      <div className="text-[11px] text-text-muted">{inv.invitedBy ? `Convidado por ${inv.invitedBy} · ` : ''}expira em {formatDate(inv.expiresAt, { day: '2-digit', month: 'short' })}</div>
                    </div>
                    <RoleBadge role={inv.role} />
                    <Btn size="xs" variant="ghost" icon="block" onClick={() => revokeInvite(inv)}>Revogar</Btn>
                  </li>
                ))}
              </ul>
            </AsyncBoundary>
          </Section>
        )}

        <Section title="Matriz de permissões" description="O que cada papel pode fazer. A coluna do seu papel está destacada.">
          <AsyncBoundary loading={matrixState.loading} error={matrixState.error} onRetry={matrixState.reload} empty={!matrixState.data?.permissionsMatrix?.length}>
            {matrixState.data && <PermissionMatrixTable matrix={matrixState.data.permissionsMatrix} myRole={matrixState.data.myRole} />}
          </AsyncBoundary>
        </Section>
      </div>

      {isOwner && <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} candidates={members.filter(m => m.id !== user.id)} onDone={onTransferred} />}
    </div>
  );
}
