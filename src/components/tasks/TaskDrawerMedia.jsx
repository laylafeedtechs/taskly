import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, fileToBase64 } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { formatDateTime, timeAgo } from '../../lib/format';
import { Alert, Avatar, Btn, EmptyState, ErrorState, Icon, IconBtn, Kbd, Skeleton, Spinner, Textarea } from '../ui';
import { Section } from './TaskDrawerSections';
import { MAX_UPLOAD_BYTES, useLookups } from './taskUtils';

// ---------------------------------------------------------- attachments

function fileIcon(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.includes('pdf')) return 'picture_as_pdf';
  if (mime.includes('zip')) return 'folder_zip';
  if (mime.includes('spreadsheet') || mime.includes('csv')) return 'table_chart';
  if (mime.includes('presentation')) return 'slideshow';
  return 'description';
}

export function AttachmentsSection({ task, files, setFiles, loading, error, onRetry }) {
  const { can, user, confirm, showError, toast } = useApp();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const canUpload = can('files.upload');

  const upload = async fileList => {
    const list = [...fileList];
    inputRef.current.value = '';
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) { toast(`"${file.name}" excede o limite de 25 MB`, 'error'); continue; }
      setUploading(u => [...u, file.name]);
      try {
        const data = await fileToBase64(file);
        const res = await api.files.upload(task.projectId, { name: file.name, data, taskId: task.id });
        setFiles(f => [res.file, ...f]);
        toast(`${res.file.name} anexado`, 'success');
      } catch (err) {
        showError(err);
      } finally {
        setUploading(u => u.filter(n => n !== file.name));
      }
    }
  };

  const download = async f => {
    setBusyId(f.id);
    try { await api.files.download(f.id); } catch (err) { showError(err); }
    setBusyId(null);
  };

  const remove = async f => {
    const ok = await confirm({ title: `Excluir "${f.name}"?`, message: 'O arquivo irá para a lixeira do workspace.', confirmLabel: 'Excluir arquivo', danger: true });
    if (!ok) return;
    setBusyId(f.id);
    try {
      await api.files.remove(f.id);
      setFiles(list => list.filter(x => x.id !== f.id));
      toast('Arquivo movido para a lixeira', 'success');
    } catch (err) { showError(err); }
    setBusyId(null);
  };

  return (
    <Section
      title="Anexos"
      icon="attach_file"
      count={files.length || undefined}
      action={canUpload && (
        <>
          <input ref={inputRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={e => upload(e.target.files)}
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.zip,.docx,.xlsx,.pptx,.txt,.md,.csv,.json" />
          <Btn size="xs" variant="ghost" icon="upload" onClick={() => inputRef.current?.click()}>Anexar arquivo</Btn>
        </>
      )}
    >
      {error && <div className="mb-2"><Alert tone="danger">Não foi possível carregar os anexos. <button type="button" className="underline font-medium" onClick={onRetry}>Tentar novamente</button></Alert></div>}
      {loading && !files.length && <Skeleton className="h-12 w-full" />}
      <ul className="flex flex-col gap-1.5">
        {uploading.map(name => (
          <li key={`up-${name}`} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-dashed border-border text-[12px] text-text-secondary">
            <Spinner size={14} /><span className="truncate">Enviando {name}…</span>
          </li>
        ))}
        {files.map(f => {
          const canRemove = canUpload && (f.uploadedById === user?.id || can('files.delete'));
          return (
            <li key={f.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border bg-background-secondary">
              <span className="w-8 h-8 rounded-lg bg-surface-elevated flex items-center justify-center flex-shrink-0"><Icon name={fileIcon(f.mimeType)} size={17} className="text-text-secondary" /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-text-primary truncate" title={f.name}>{f.name}</p>
                <p className="text-[11px] text-text-muted truncate">{f.formattedSize} · {f.uploadedBy} · {timeAgo(f.createdAt)}</p>
              </div>
              {busyId === f.id ? <Spinner size={14} /> : (
                <div className="flex items-center">
                  {f.previewable && f.available !== false && (
                    <a href={api.files.previewUrl(f.id)} target="_blank" rel="noopener noreferrer" aria-label={`Visualizar ${f.name}`} title="Visualizar"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-hover">
                      <Icon name="visibility" size={15} />
                    </a>
                  )}
                  <IconBtn icon="download" size="xs" label={`Baixar ${f.name}`} onClick={() => download(f)} />
                  {canRemove && <IconBtn icon="delete" size="xs" label={`Excluir ${f.name}`} onClick={() => remove(f)} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!loading && !error && !files.length && !uploading.length && (
        <p className="text-[12px] text-text-muted">Nenhum anexo.{canUpload && ' Formatos aceitos: imagens, PDF, documentos Office, ZIP, TXT, MD, CSV e JSON (até 25 MB).'}</p>
      )}
    </Section>
  );
}

// ------------------------------------------------------------- comments

export function CommentsSection({ task, onFresh }) {
  const { user, can, members, confirm, showError } = useApp();
  const { memberById } = useLookups();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const inputRef = useRef(null);
  const comments = task.comments || [];
  const canComment = can('task.comment');

  const mention = /(?:^|\s)@([\p{L}\w.]*)$/u.exec(text);
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention[1].toLowerCase();
    return members.filter(m => m.name.toLowerCase().includes(q) || m.email?.toLowerCase().startsWith(q)).slice(0, 5);
  }, [mention?.[1], members]); // eslint-disable-line react-hooks/exhaustive-deps

  const insertMention = m => {
    setText(t => `${t.slice(0, t.length - mention[1].length)}${m.name} `);
    inputRef.current?.focus();
  };

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      const res = await api.tasks.addComment(task.id, value);
      onFresh(res.task);
      setText('');
    } catch (err) { showError(err); }
    setSending(false);
  };

  const remove = async c => {
    const ok = await confirm({ title: 'Excluir comentário?', message: 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    setDeletingId(c.id);
    try { onFresh((await api.tasks.deleteComment(task.id, c.id)).task); } catch (err) { showError(err); }
    setDeletingId(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 && <EmptyState compact icon="forum" title="Nenhum comentário" description={canComment ? 'Comece a conversa sobre esta tarefa.' : undefined} />}
      <ul className="flex flex-col gap-4">
        {comments.map(c => {
          const author = memberById.get(c.userId) || { name: c.userName, avatar: c.userAvatar };
          const canDelete = c.userId === user?.id || can('members.manage');
          return (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar user={author} size={28} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-text-primary truncate">{author.name}</span>
                  <time dateTime={c.createdAt} title={formatDateTime(c.createdAt)} className="text-[11px] text-text-muted flex-shrink-0">{timeAgo(c.createdAt)}</time>
                  <div className="flex-1" />
                  {canDelete && (deletingId === c.id ? <Spinner size={12} /> : (
                    <IconBtn icon="delete" size="xs" label="Excluir comentário" onClick={() => remove(c)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100" />
                  ))}
                </div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">{c.text}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {canComment ? (
        <div className="relative">
          <Textarea
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
            maxLength={5000}
            placeholder="Escreva um comentário… use @ para mencionar alguém"
            aria-label="Novo comentário"
            className="min-h-[72px]"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-2 bottom-full mb-1 z-10 w-60 max-w-[calc(100%-1rem)] p-1 rounded-xl bg-surface border border-border shadow-modal" aria-label="Sugestões de menção">
              {suggestions.map(m => (
                <li key={m.id}>
                  <button type="button" onClick={() => insertMention(m)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary">
                    <Avatar user={m} size={20} /><span className="truncate">{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-[11px] text-text-muted flex items-center gap-1"><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> para enviar · @nome notifica</span>
            <Btn variant="primary" size="sm" icon="send" loading={sending} disabled={!text.trim()} onClick={send}>Comentar</Btn>
          </div>
        </div>
      ) : <p className="text-[12px] text-text-muted">Seu papel não permite comentar.</p>}
    </div>
  );
}

// ------------------------------------------------------------- activity

const ACTIVITY_ICON = { comment: 'chat_bubble', file: 'attach_file', task: 'edit', automation: 'bolt' };

export function ActivitySection({ taskId, refreshKey }) {
  const { data, loading, error, reload } = useAsync(() => api.tasks.activity(taskId), [taskId, refreshKey]);
  const list = data?.activity || [];
  if (loading && !data) return <div className="flex flex-col gap-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (error && !data) return <ErrorState compact error={error} onRetry={reload} />;
  if (!list.length) return <EmptyState compact icon="history" title="Sem atividade registrada" />;
  const ordered = [...list].reverse();
  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:left-[13px] before:top-2 before:bottom-2 before:w-px before:bg-border">
      {ordered.map(a => (
        <li key={a.id} className="relative flex gap-3">
          <span className="relative z-[1] w-7 h-7 rounded-full bg-surface-elevated border border-border flex items-center justify-center flex-shrink-0">
            <Icon name={ACTIVITY_ICON[a.type.split('.')[0]] || 'history'} size={14} className="text-text-muted" />
          </span>
          <div className="min-w-0 pt-1">
            <p className="text-[12px] text-text-secondary leading-relaxed break-words"><span className="font-semibold text-text-primary">{a.actor}</span> {a.message}</p>
            <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)} className="text-[11px] text-text-muted">{timeAgo(a.createdAt)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
