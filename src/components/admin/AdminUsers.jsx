import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useDebounce } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { Alert, AsyncBoundary, Avatar, Btn, Checkbox, EmptyState, Field, Input, Modal, Pagination, Pill, SearchInput, Segmented } from '../ui';
import { CopyField, RowMenu, TableWrap, Td, Th, errorText } from '../settings/common';

const STATUS_OPTIONS = [{ value: 'ALL', label: 'Todos' }, { value: 'ACTIVE', label: 'Ativos' }, { value: 'BLOCKED', label: 'Bloqueados' }];

function UserModal({ open, target, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', isSuperAdmin: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({ name: target?.name || '', email: target?.email || '', password: '', isSuperAdmin: Boolean(target?.isSuperAdmin) });
    setError(null);
  }, [open, target]);

  const set = patch => setForm(f => ({ ...f, ...patch }));
  const submit = async e => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = { name: form.name.trim(), email: form.email.trim(), isSuperAdmin: form.isSuperAdmin };
      const res = target
        ? await api.admin.updateUser(target.id, body)
        : await api.admin.createUser({ ...body, password: form.password || undefined });
      onSaved(res, !target, Boolean(form.password));
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={target ? 'Editar usuário' : 'Novo usuário'}
      description={target ? undefined : 'Um workspace pessoal é criado automaticamente para o novo usuário.'}
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" type="submit" form="admin-user-form" loading={saving}>{target ? 'Salvar' : 'Criar usuário'}</Btn></>}>
      <form id="admin-user-form" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Nome" required><Input value={form.name} onChange={e => set({ name: e.target.value })} minLength={2} maxLength={80} required data-autofocus /></Field>
        <Field label="E-mail" required><Input type="email" value={form.email} onChange={e => set({ email: e.target.value })} required autoComplete="off" /></Field>
        {!target && (
          <Field label="Senha inicial" hint="Opcional (mín. 8 caracteres). Sem senha, o usuário recebe um link para defini-la.">
            <Input type="password" value={form.password} onChange={e => set({ password: e.target.value })} minLength={8} autoComplete="new-password" />
          </Field>
        )}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox checked={form.isSuperAdmin} onChange={v => set({ isSuperAdmin: v })} className="mt-0.5" />
          <span>
            <span className="block text-[13px] text-text-primary">Super Admin</span>
            <span className="block text-[11px] text-text-muted">Acesso total ao Admin Center e a todos os workspaces. Alterar este acesso encerra as sessões do usuário.</span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

export function AdminUsers() {
  const { user: me, confirm, toast, showError } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // null | { target? }
  const [setupLink, setSetupLink] = useState(null);
  const query = useDebounce(q.trim(), 300);
  const { data, loading, error, reload, setData } = useAsync(() => api.admin.users({ q: query, status, page, limit: 25 }), [query, status, page]);
  const users = data?.users || [];

  const patch = u => setData(d => ({ ...d, users: d.users.map(x => (x.id === u.id ? { ...x, ...u } : x)) }));

  const onSaved = (res, created, hadPassword) => {
    setModal(null);
    if (created) {
      reload();
      if (res.setupLink) setSetupLink({ link: res.setupLink, email: res.user.email });
      else toast(hadPassword ? 'Usuário criado' : `Usuário criado. Um link para definir a senha foi enviado para ${res.user.email}.`, 'success');
    } else {
      patch(res.user);
      toast('Usuário atualizado', 'success');
    }
  };

  const toggleStatus = async u => {
    const block = u.status === 'ACTIVE';
    if (block) {
      const ok = await confirm({ title: `Bloquear ${u.name}?`, message: 'Todas as sessões serão encerradas e o usuário não conseguirá entrar até ser desbloqueado.', confirmLabel: 'Bloquear', danger: true });
      if (!ok) return;
    }
    try {
      const res = await api.admin.setStatus(u.id, block ? 'BLOCKED' : 'ACTIVE');
      patch(res.user);
      toast(block ? `${u.name} bloqueado(a)` : `${u.name} desbloqueado(a)`, 'success');
    } catch (err) { showError(err); }
  };

  const remove = async u => {
    const ok = await confirm({
      title: `Remover ${u.name}?`,
      message: 'A conta, as sessões e as notificações serão apagadas e as tarefas ficarão sem responsável. Workspaces próprios sem outros membros serão arquivados. Esta ação não pode ser desfeita.',
      confirmLabel: 'Remover usuário',
      danger: true,
      requireText: u.email
    });
    if (!ok) return;
    try {
      await api.admin.deleteUser(u.id);
      toast(`${u.email} removido`, 'success');
      reload();
    } catch (err) { showError(err); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchInput value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Buscar por nome ou e-mail…" className="sm:w-80" />
        <Segmented label="Status" options={STATUS_OPTIONS} value={status} onChange={s => { setStatus(s); setPage(1); }} />
        <Btn variant="primary" icon="person_add" className="sm:ml-auto" onClick={() => setModal({})}>Novo usuário</Btn>
      </div>

      <AsyncBoundary loading={loading && !data} error={error} onRetry={reload} empty={!users.length}
        emptyState={<EmptyState icon="person_search" title="Nenhum usuário encontrado" description={q || status !== 'ALL' ? 'Ajuste a busca ou o filtro.' : undefined} />}>
        <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
          <TableWrap minWidth={940}>
            <thead><tr><Th>Usuário</Th><Th>E-mail</Th><Th>Status</Th><Th>Workspaces</Th><Th>Projetos</Th><Th>Último acesso</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
            <tbody>
              {users.map(u => {
                const self = u.id === me.id;
                return (
                  <tr key={u.id} className="hover:bg-surface-hover/50">
                    <Td>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar user={u} size={28} />
                        <span className="text-text-primary font-medium truncate">{u.name}{self && <span className="text-text-muted font-normal"> (você)</span>}</span>
                        {u.isSuperAdmin && <Pill className="text-amber-400 bg-amber-500/10 border-amber-500/25">Super Admin</Pill>}
                      </div>
                    </Td>
                    <Td className="max-w-[220px]"><span className="block truncate">{u.email}</span></Td>
                    <Td>{u.status === 'BLOCKED' ? <Pill className="text-red-400 bg-red-500/10 border-red-500/25">Bloqueado</Pill> : <Pill className="text-emerald-400 bg-emerald-500/10 border-emerald-500/25">Ativo</Pill>}</Td>
                    <Td><span title={u.workspaces.map(w => `${w.name} (${w.role || '—'})`).join('\n') || undefined}>{u.workspaces.length}</span></Td>
                    <Td>{u.projectCount}</Td>
                    <Td className="whitespace-nowrap" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt) : undefined}>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Nunca'}</Td>
                    <Td className="text-right w-12">
                      <RowMenu label={`Ações de ${u.name}`} items={[
                        { label: 'Editar', icon: 'edit', onClick: () => setModal({ target: u }) },
                        !self && { label: u.status === 'ACTIVE' ? 'Bloquear' : 'Desbloquear', icon: u.status === 'ACTIVE' ? 'block' : 'lock_open', onClick: () => toggleStatus(u) },
                        !self && '-',
                        !self && { label: 'Remover', icon: 'person_remove', danger: true, onClick: () => remove(u) }
                      ]} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <p className="text-[11px] text-text-muted mt-2">{data?.total ?? 0} usuário(s)</p>
          <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={setPage} />
        </div>
      </AsyncBoundary>

      <UserModal open={Boolean(modal)} target={modal?.target} onClose={() => setModal(null)} onSaved={onSaved} />
      <Modal open={Boolean(setupLink)} onClose={() => setSetupLink(null)} title="Usuário criado" description={setupLink?.email} footer={<Btn variant="primary" onClick={() => setSetupLink(null)}>Concluir</Btn>}>
        <div className="flex flex-col gap-3">
          <Alert tone="warning">O envio de e-mails (SMTP) não está configurado. Envie este link ao usuário para que ele defina a senha. O link é válido por 72 horas e não será exibido novamente.</Alert>
          {setupLink && <CopyField value={setupLink.link} label="Link para definir a senha" />}
        </div>
      </Modal>
    </div>
  );
}
