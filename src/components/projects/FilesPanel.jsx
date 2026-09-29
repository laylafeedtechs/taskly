import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, fileToBase64 } from '../../services/api';
import { useAsync, useDebounce } from '../../lib/hooks';
import { formatDateTime, pluralize } from '../../lib/format';
import { Btn, IconBtn, Icon, Menu, Modal, Field, Input, Alert, SearchInput, Select, Card, LoadingState, ErrorState, EmptyState, Spinner } from '../ui';

const ALLOWED = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'zip', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json'];
const MAX_BYTES = 25 * 1024 * 1024;
const TYPE_FILTERS = [
  { value: '', label: 'Todos os tipos' },
  { value: 'image', label: 'Imagens' },
  { value: 'pdf', label: 'PDF' },
  { value: 'document', label: 'Documentos' },
  { value: 'spreadsheet', label: 'Planilhas' },
  { value: 'archive', label: 'Compactados' }
];

const extOf = name => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const isImage = f => f.mimeType?.startsWith('image/');

function typeIcon(file) {
  const m = file.mimeType || '';
  if (m.startsWith('image/')) return { icon: 'image', className: 'text-blue-400' };
  if (m === 'application/pdf') return { icon: 'picture_as_pdf', className: 'text-red-400' };
  if (m.includes('spreadsheetml') || m.startsWith('text/csv')) return { icon: 'table_chart', className: 'text-emerald-400' };
  if (m.includes('presentationml')) return { icon: 'slideshow', className: 'text-amber-400' };
  if (m.includes('zip')) return { icon: 'folder_zip', className: 'text-text-secondary' };
  if (m.includes('json')) return { icon: 'data_object', className: 'text-text-secondary' };
  return { icon: 'description', className: 'text-text-secondary' };
}

function FileThumb({ file }) {
  const [broken, setBroken] = useState(false);
  if (isImage(file) && file.available && !broken) {
    return <img src={api.files.previewUrl(file.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="w-10 h-10 rounded-lg object-cover border border-border bg-background-secondary flex-shrink-0" />;
  }
  const meta = typeIcon(file);
  return (
    <span className="w-10 h-10 rounded-lg border border-border bg-background-secondary flex items-center justify-center flex-shrink-0">
      <Icon name={meta.icon} size={20} className={meta.className} />
    </span>
  );
}

function RenameModal({ file, onClose, onRenamed }) {
  const ext = extOf(file.name);
  const [base, setBase] = useState(() => (ext ? file.name.slice(0, -(ext.length + 1)) : file.name));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const valid = base.trim().length > 0;

  const submit = async e => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.files.rename(file.id, ext ? `${base.trim()}.${ext}` : base.trim());
      onRenamed(res.file);
      onClose();
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Renomear arquivo" size="sm" footer={<>
      <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
      <Btn variant="primary" type="submit" form="rename-file" loading={saving} disabled={!valid}>Renomear</Btn>
    </>}>
      <form id="rename-file" onSubmit={submit} className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Field label="Nome" hint="A extensão do arquivo não pode ser alterada.">
          <div className="flex items-center">
            <Input data-autofocus value={base} maxLength={170} onChange={e => setBase(e.target.value)} className={ext ? 'rounded-r-none' : ''} aria-label="Nome do arquivo" />
            {ext && <span className="h-9 px-2.5 flex items-center rounded-r-lg border border-l-0 border-border bg-surface-elevated text-[12px] font-mono text-text-muted">.{ext}</span>}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

function FileRow({ file, task, canManage, onPreview, onDownload, onRename, onDelete, onOpenTask }) {
  const disabled = !file.available;
  const canPreview = file.available && file.previewable;
  return (
    <li className={`flex items-center gap-3 px-3 sm:px-4 py-3 ${disabled ? 'opacity-60' : 'hover:bg-surface-hover/40'}`}>
      <FileThumb file={file} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {canPreview ? (
            <button type="button" onClick={() => onPreview(file)} className="text-[13px] font-medium text-text-primary truncate hover:underline text-left">{file.name}</button>
          ) : <span className="text-[13px] font-medium text-text-primary truncate">{file.name}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted mt-0.5">
          <span className="font-mono">{file.formattedSize}</span>
          <span aria-hidden="true">·</span>
          <span>{file.uploadedBy}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDateTime(file.createdAt)}</span>
          {file.taskId && (
            <button type="button" onClick={() => onOpenTask(file.taskId)} className="inline-flex items-center gap-1 min-w-0 text-text-secondary hover:text-text-primary hover:underline">
              <Icon name="link" size={12} /><span className="font-mono">{file.taskId}</span>
              {task && <span className="truncate max-w-[180px]">{task.title}</span>}
            </button>
          )}
        </div>
        {disabled && <p className="text-[11px] text-amber-400 mt-0.5">Registro de demonstração: o conteúdo não está disponível.</p>}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {canPreview && <IconBtn icon="visibility" size="xs" label={`Visualizar ${file.name}`} onClick={() => onPreview(file)} className="hidden sm:inline-flex" />}
        <IconBtn icon="download" size="xs" label={`Baixar ${file.name}`} onClick={() => onDownload(file)} disabled={disabled} className="disabled:opacity-40 disabled:pointer-events-none" />
        {canManage(file) && (
          <Menu
            width={180}
            items={[
              canPreview && { label: 'Visualizar', icon: 'visibility', onClick: () => onPreview(file) },
              { label: 'Renomear', icon: 'edit', onClick: () => onRename(file) },
              { label: 'Mover para a lixeira', icon: 'delete', danger: true, onClick: () => onDelete(file) }
            ]}
            trigger={({ toggle, ...aria }) => <IconBtn icon="more_horiz" size="xs" label={`Ações de ${file.name}`} onClick={toggle} {...aria} />}
          />
        )}
      </div>
    </li>
  );
}

export function FilesPanel({ projectId }) {
  const { can, user, tasks, openTask, confirm, toast, showError } = useApp();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const q = useDebounce(search.trim(), 300);
  const { data, loading, error, reload, setData } = useAsync(() => api.files.list(projectId, { q, type }), [projectId, q, type]);
  const files = data?.files || [];
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const inputRef = useRef(null);
  const canUpload = can('files.upload');
  const taskById = useMemo(() => Object.fromEntries(tasks.filter(t => t.projectId === projectId).map(t => [t.id, t])), [tasks, projectId]);
  const canManage = f => canUpload && (f.uploadedById === user?.id || can('files.delete'));
  const busy = uploads.some(u => u.status === 'uploading');

  const setUpload = (key, patch) => setUploads(list => list.map(u => (u.key === key ? { ...u, ...patch } : u)));

  const uploadFiles = async fileList => {
    const picked = [...fileList].map((file, i) => {
      const ext = extOf(file.name);
      const problem = !ALLOWED.includes(ext) ? `Tipo .${ext || '?'} não permitido` : file.size > MAX_BYTES ? 'Maior que 25 MB' : file.size === 0 ? 'Arquivo vazio' : null;
      return { key: `${Date.now()}-${i}-${file.name}`, file, name: file.name, status: problem ? 'error' : 'uploading', error: problem };
    });
    if (!picked.length) return;
    setUploads(list => [...list.filter(u => u.status === 'uploading'), ...picked]);
    let uploaded = 0;
    for (const item of picked.filter(p => p.status === 'uploading')) {
      try {
        const base64 = await fileToBase64(item.file);
        await api.files.upload(projectId, { name: item.name, data: base64 });
        uploaded += 1;
        setUploads(list => list.filter(u => u.key !== item.key));
      } catch (err) {
        setUpload(item.key, { status: 'error', error: err.message });
      }
    }
    if (uploaded) {
      toast(`${pluralize(uploaded, 'arquivo enviado', 'arquivos enviados')}`, 'success');
      reload();
    }
  };

  const onDrop = e => {
    e.preventDefault();
    setDragging(false);
    if (canUpload && e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  const download = async file => {
    try { await api.files.download(file.id); } catch (err) { showError(err); }
  };

  const preview = file => {
    if (isImage(file)) setPreviewing(file);
    else window.open(api.files.previewUrl(file.id), '_blank', 'noopener');
  };

  const remove = async file => {
    const ok = await confirm({ title: `Mover "${file.name}" para a lixeira?`, message: 'Você poderá restaurá-lo pela lixeira do workspace.', confirmLabel: 'Mover para a lixeira', danger: true });
    if (!ok) return;
    try {
      await api.files.remove(file.id);
      setData(d => ({ files: d.files.filter(f => f.id !== file.id) }));
      toast(`"${file.name}" movido para a lixeira`, 'warning', {
        label: 'Desfazer',
        onClick: async () => { try { await api.trash.restore('file', file.id); reload(); toast('Arquivo restaurado', 'success'); } catch (err) { showError(err); } }
      });
    } catch (err) { showError(err); }
  };

  const filtering = Boolean(q || type);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar arquivos…" className="w-full sm:max-w-xs" />
        <Select aria-label="Filtrar por tipo" value={type} onChange={e => setType(e.target.value)} className="sm:w-[170px]">
          {TYPE_FILTERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        {canUpload && <Btn variant="primary" icon="upload" className="sm:ml-auto h-9" loading={busy} onClick={() => inputRef.current?.click()}>Enviar arquivos</Btn>}
        <input ref={inputRef} type="file" multiple hidden accept={ALLOWED.map(e => `.${e}`).join(',')} onChange={e => { uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {canUpload && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragging ? 'border-blue-500/60 bg-blue-500/10' : 'border-border bg-background-secondary/50'}`}
        >
          <Icon name="cloud_upload" size={24} className={dragging ? 'text-blue-400' : 'text-text-muted'} />
          <p className="text-[12px] text-text-secondary mt-1">
            Arraste arquivos para cá ou{' '}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-blue-400 hover:underline font-medium">selecione no computador</button>
          </p>
          <p className="text-[11px] text-text-muted mt-0.5">Até 25 MB · {ALLOWED.join(', ')}</p>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-live="polite">
          {uploads.map(u => (
            <li key={u.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] ${u.status === 'error' ? 'border-red-500/25 bg-red-500/10' : 'border-border bg-surface-card'}`}>
              {u.status === 'uploading' ? <Spinner size={14} /> : <Icon name="error" size={16} className="text-red-400" />}
              <span className="truncate text-text-primary min-w-0 flex-1">{u.name}</span>
              {u.status === 'error' ? <span className="text-red-400 truncate max-w-[50%]">{u.error}</span> : <span className="text-text-muted">Enviando…</span>}
              {u.status === 'error' && <IconBtn icon="close" size="xs" label={`Dispensar erro de ${u.name}`} onClick={() => setUploads(list => list.filter(x => x.key !== u.key))} />}
            </li>
          ))}
        </ul>
      )}

      <Card padded={false}>
        {loading && !data ? <div className="p-3"><LoadingState rows={4} label="Carregando arquivos" /></div>
          : error ? <ErrorState compact error={error} onRetry={reload} />
          : !files.length ? (
            filtering
              ? <EmptyState compact icon="search_off" title="Nenhum arquivo encontrado" description="Tente outro termo ou tipo." action={<Btn icon="filter_alt_off" onClick={() => { setSearch(''); setType(''); }}>Limpar filtros</Btn>} />
              : <EmptyState compact icon="folder_open" title="Nenhum arquivo ainda" description={canUpload ? 'Envie documentos, imagens e planilhas do projeto.' : 'Os arquivos do projeto aparecerão aqui.'} />
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border text-[11px] text-text-muted">
                <span>{pluralize(files.length, 'arquivo', 'arquivos')}</span>
                {loading && <Spinner size={12} />}
              </div>
              <ul className="divide-y divide-border-subtle">
                {files.map(f => (
                  <FileRow key={f.id} file={f} task={taskById[f.taskId]} canManage={canManage} onPreview={preview} onDownload={download} onRename={setRenaming} onDelete={remove} onOpenTask={openTask} />
                ))}
              </ul>
            </>
          )}
      </Card>

      {renaming && (
        <RenameModal file={renaming} onClose={() => setRenaming(null)} onRenamed={f => { setData(d => ({ files: d.files.map(x => (x.id === f.id ? f : x)) })); toast('Arquivo renomeado', 'success'); }} />
      )}
      {previewing && (
        <Modal open size="xl" onClose={() => setPreviewing(null)} title={previewing.name} description={`${previewing.formattedSize} · ${previewing.uploadedBy}`}
          footer={<Btn icon="download" onClick={() => download(previewing)}>Baixar</Btn>}>
          <div className="flex items-center justify-center rounded-lg bg-background-secondary border border-border p-2">
            <img src={api.files.previewUrl(previewing.id)} alt={previewing.name} className="max-w-full max-h-[70vh] object-contain rounded" />
          </div>
        </Modal>
      )}
    </div>
  );
}
