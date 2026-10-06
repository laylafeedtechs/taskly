// Criativos → Biblioteca: the workspace's images and videos, with upload,
// metadata, filters and the picker used by the publication editor.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync, useDebounce } from '../../lib/hooks';
import { Btn, IconBtn, Icon, Modal, Field, Input, Select, SearchInput, EmptyState, ErrorState, Skeleton, Pagination, Checkbox, Menu, Alert, Pill } from '../ui';
import { useCreatives, CreativeThumb, SectionTitle, formatDuration } from './shared';
import { UploadDropzone, UploadQueue, useCreativeUploader } from './Uploader';

const KINDS = [{ value: 'ALL', label: 'Todos' }, { value: 'image', label: 'Imagens' }, { value: 'video', label: 'Vídeos' }, { value: 'gif', label: 'GIFs' }];

function useLibrary({ q, kind, campaignId, projectId, tag, createdBy, archived, page, limit = 40 }) {
  const { currentWorkspaceId } = useApp();
  const { dataVersion } = useCreatives();
  return useAsync(() => api.creatives.list(currentWorkspaceId, { q, kind, campaignId, projectId, tag, createdBy, archived, page, limit }), [currentWorkspaceId, q, kind, campaignId, projectId, tag, createdBy, archived, page, limit, dataVersion]);
}

function CreativeCard({ creative, selected, onSelect, onOpen, selectable }) {
  return (
    <div className={`group relative rounded-xl overflow-hidden border transition-colors ${selected ? 'border-blue-400 ring-1 ring-blue-400/50' : 'border-border hover:border-border-focus'} bg-surface-card`}>
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Abrir ${creative.name}`}>
        <div className="relative aspect-square bg-surface-elevated">
          <CreativeThumb creative={creative} className="absolute inset-0 w-full h-full" />
          {creative.kind === 'video' && <span className="absolute bottom-1.5 right-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/60 text-white">{formatDuration(creative.durationMs)}</span>}
          {creative.archivedAt && <span className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">Arquivado</span>}
          {creative.usage?.published > 0 && <span className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/80 text-white">Publicado</span>}
        </div>
        <div className="px-2.5 py-2">
          <div className="text-[12px] text-text-primary truncate" title={creative.name}>{creative.name}</div>
          <div className="text-[10px] text-text-muted font-mono mt-0.5">{creative.width && creative.height ? `${creative.width}×${creative.height} · ` : ''}{creative.formattedSize}</div>
        </div>
      </button>
      {selectable && (
        <span className="absolute top-2 left-2"><Checkbox checked={selected} onChange={onSelect} label={`Selecionar ${creative.name}`} /></span>
      )}
    </div>
  );
}

function CreativeDetail({ creative, onClose, onChanged }) {
  const { campaigns, perms } = useCreatives();
  const { projects, user, toast, showError, confirm } = useApp();
  const [form, setForm] = useState(() => ({ name: creative.name, tags: (creative.tags || []).join(', '), campaignId: creative.campaignId || '', projectId: creative.projectId || '' }));
  const [busy, setBusy] = useState(false);
  const mine = creative.createdBy === user?.id;
  const canEdit = perms.edit || (mine && perms.create);
  const canDelete = perms.remove || (mine && perms.edit);

  const save = async () => {
    setBusy(true);
    try {
      await api.creatives.update(creative.id, { name: form.name, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean), campaignId: form.campaignId || null, projectId: form.projectId || null });
      toast('Criativo atualizado', 'success');
      onChanged();
      onClose();
    } catch (err) { showError(err); } finally { setBusy(false); }
  };
  const run = async (fn, message) => { setBusy(true); try { await fn(); toast(message, 'success'); onChanged(); onClose(); } catch (err) { showError(err); } finally { setBusy(false); } };

  return (
    <Modal open onClose={onClose} title={creative.name} size="xl"
      footer={<>
        {canDelete && <Btn variant="danger" icon="delete" disabled={busy} onClick={async () => { if (await confirm({ title: 'Excluir criativo?', message: 'O arquivo será removido. Publicações já publicadas no Instagram não são afetadas.', confirmLabel: 'Excluir', danger: true })) run(() => api.creatives.remove(creative.id), 'Criativo excluído'); }}>Excluir</Btn>}
        {canEdit && <Btn icon={creative.archivedAt ? 'unarchive' : 'archive'} disabled={busy} onClick={() => run(() => api.creatives.update(creative.id, { archived: !creative.archivedAt }), creative.archivedAt ? 'Criativo restaurado' : 'Criativo arquivado')}>{creative.archivedAt ? 'Desarquivar' : 'Arquivar'}</Btn>}
        {perms.create && <Btn icon="content_copy" disabled={busy} onClick={() => run(() => api.creatives.duplicate(creative.id), 'Criativo duplicado')}>Duplicar</Btn>}
        <a href={api.creatives.downloadUrl(creative.id)} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium border border-border bg-surface-card hover:bg-surface-hover text-text-primary"><Icon name="download" size={16} />Baixar</a>
        {canEdit && <Btn variant="primary" loading={busy} onClick={save}>Salvar</Btn>}
      </>}>
      <div className="grid md:grid-cols-[1.4fr_1fr] gap-5">
        <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center min-h-[240px]">
          {creative.kind === 'video'
            ? <video src={api.creatives.fileUrl(creative.id)} poster={creative.hasThumb ? api.creatives.thumbUrl(creative.id) : undefined} controls className="max-h-[60vh] w-full" preload="metadata" />
            : <img src={api.creatives.fileUrl(creative.id)} alt={creative.name} className="max-h-[60vh] w-full object-contain" />}
        </div>
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            <dt className="text-text-muted">Tipo</dt><dd className="text-text-secondary">{creative.mimeType}</dd>
            <dt className="text-text-muted">Dimensões</dt><dd className="text-text-secondary font-mono">{creative.width ? `${creative.width} × ${creative.height}` : '—'}</dd>
            {creative.kind === 'video' && <><dt className="text-text-muted">Duração</dt><dd className="text-text-secondary font-mono">{formatDuration(creative.durationMs)}</dd></>}
            <dt className="text-text-muted">Tamanho</dt><dd className="text-text-secondary font-mono">{creative.formattedSize}</dd>
            <dt className="text-text-muted">Enviado por</dt><dd className="text-text-secondary truncate">{creative.createdByName || '—'}</dd>
            <dt className="text-text-muted">Em</dt><dd className="text-text-secondary">{new Date(creative.createdAt).toLocaleString('pt-BR')}</dd>
            <dt className="text-text-muted">Uso</dt><dd className="text-text-secondary">{creative.usage.total} publicação(ões)</dd>
          </dl>
          {creative.mimeType !== 'image/jpeg' && creative.kind !== 'video' && <Alert tone="warning">A API do Instagram publica somente JPEG. Converta este arquivo antes de usá-lo em uma publicação.</Alert>}
          {creative.warnings?.includes('MOOV_AT_END') && <Alert tone="warning">Vídeo não otimizado para streaming (moov no fim do arquivo). A Meta pode recusá-lo; exporte com “fast start”.</Alert>}
          <Field label="Nome"><Input value={form.name} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Tags" hint="Separe por vírgulas"><Input value={form.tags} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} /></Field>
          <Field label="Campanha">
            <Select value={form.campaignId} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, campaignId: e.target.value }))}>
              <option value="">Sem campanha</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Projeto">
            <Select value={form.projectId} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
              <option value="">Sem projeto</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function LibraryFilters({ filters, setFilters, tags }) {
  const { campaigns } = useCreatives();
  const { projects, members } = useApp();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={filters.q} onChange={q => setFilters(f => ({ ...f, q, page: 1 }))} placeholder="Buscar por nome ou tag…" className="w-full sm:w-64" />
      <Select aria-label="Tipo" value={filters.kind} onChange={e => setFilters(f => ({ ...f, kind: e.target.value, page: 1 }))} className="!w-auto">{KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
      <Select aria-label="Campanha" value={filters.campaignId} onChange={e => setFilters(f => ({ ...f, campaignId: e.target.value, page: 1 }))} className="!w-auto">
        <option value="">Todas as campanhas</option><option value="none">Sem campanha</option>
        {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select aria-label="Projeto" value={filters.projectId} onChange={e => setFilters(f => ({ ...f, projectId: e.target.value, page: 1 }))} className="!w-auto">
        <option value="">Todos os projetos</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      {tags.length > 0 && (
        <Select aria-label="Tag" value={filters.tag} onChange={e => setFilters(f => ({ ...f, tag: e.target.value, page: 1 }))} className="!w-auto">
          <option value="">Todas as tags</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
      )}
      <Select aria-label="Enviado por" value={filters.createdBy} onChange={e => setFilters(f => ({ ...f, createdBy: e.target.value, page: 1 }))} className="!w-auto">
        <option value="">Qualquer pessoa</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </Select>
      <Select aria-label="Arquivados" value={filters.archived} onChange={e => setFilters(f => ({ ...f, archived: e.target.value, page: 1 }))} className="!w-auto">
        <option value="false">Ativos</option><option value="true">Arquivados</option><option value="all">Todos</option>
      </Select>
    </div>
  );
}

const EMPTY_FILTERS = { q: '', kind: 'ALL', campaignId: '', projectId: '', tag: '', createdBy: '', archived: 'false', page: 1 };

export function LibraryView() {
  const { perms, bump, storageAvailable } = useCreatives();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = useDebounce(filters.q, 250);
  const { data, loading, error, reload } = useLibrary({ ...filters, q });
  const [open, setOpen] = useState(null);
  const [convert, setConvert] = useState(true);
  const { upload, queue, clearDone, busy } = useCreativeUploader();

  const onFiles = async files => { const created = await upload(files, { convert }); if (created.length) bump(); };
  const creatives = data?.creatives || [];
  const filtered = Object.entries(filters).some(([k, v]) => k !== 'page' && v !== EMPTY_FILTERS[k]);

  return (
    <div className="flex flex-col gap-5">
      {!storageAvailable && <Alert tone="warning">O armazenamento de arquivos (R2) ainda não foi ativado neste ambiente. Uploads ficam indisponíveis até a configuração.</Alert>}
      {perms.create && storageAvailable && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
          <UploadDropzone onFiles={onFiles} disabled={busy} convert={convert} onConvertChange={setConvert} />
          <UploadQueue queue={queue} onClear={clearDone} />
        </div>
      )}
      <LibraryFilters filters={filters} setFilters={setFilters} tags={data?.tags || []} />
      <SectionTitle count={data?.total}>Criativos</SectionTitle>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-xl" />)}</div>
      ) : !creatives.length ? (
        <EmptyState icon="photo_library" title={filtered ? 'Nenhum criativo com esses filtros' : 'Sua biblioteca está vazia'}
          description={filtered ? 'Ajuste ou limpe os filtros.' : 'Envie imagens e vídeos para usar nas publicações. Eles ficam disponíveis para toda a equipe do workspace.'}
          action={filtered ? <Btn onClick={() => setFilters(EMPTY_FILTERS)}>Limpar filtros</Btn> : null} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {creatives.map(c => <CreativeCard key={c.id} creative={c} onOpen={() => setOpen(c)} />)}
        </div>
      )}
      <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={page => setFilters(f => ({ ...f, page }))} />
      {open && <CreativeDetail creative={open} onClose={() => setOpen(null)} onChanged={() => { bump(); reload(); }} />}
    </div>
  );
}

// Picker for the publication editor: choose existing creatives or upload new ones.
export function CreativePickerModal({ open, onClose, onPick, max = 10, kinds, title = 'Escolher criativos' }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, kind: kinds?.length === 1 ? kinds[0] : 'ALL' });
  const q = useDebounce(filters.q, 250);
  const { data, loading, error, reload } = useLibrary({ ...filters, q, limit: 30 });
  const [selected, setSelected] = useState([]);
  const { upload, queue, busy } = useCreativeUploader();
  const { perms, storageAvailable } = useCreatives();
  useEffect(() => { if (open) setSelected([]); }, [open]);
  const toggle = c => setSelected(s => (s.some(x => x.id === c.id) ? s.filter(x => x.id !== c.id) : s.length >= max ? (max === 1 ? [c] : s) : [...s, c]));
  const creatives = (data?.creatives || []).filter(c => !kinds || kinds.includes(c.kind));
  const onFiles = async files => {
    const created = await upload(files, { convert: true });
    if (created.length) { reload(); setSelected(s => [...s, ...created.filter(c => !kinds || kinds.includes(c.kind))].slice(0, max)); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size="xl" description={max > 1 ? `Selecione até ${max} itens, na ordem em que devem aparecer.` : undefined}
      footer={<><span className="mr-auto text-[12px] text-text-muted">{selected.length} selecionado(s)</span><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" disabled={!selected.length} onClick={() => { onPick(selected); onClose(); }}>Adicionar</Btn></>}>
      <div className="flex flex-col gap-3">
        {perms.create && storageAvailable && <UploadDropzone compact onFiles={onFiles} disabled={busy} hint="Novos arquivos entram na biblioteca do workspace" />}
        <UploadQueue queue={queue} />
        <div className="flex flex-wrap gap-2">
          <SearchInput value={filters.q} onChange={qq => setFilters(f => ({ ...f, q: qq, page: 1 }))} className="flex-1 min-w-[180px]" />
          {!kinds || kinds.length > 1 ? <Select aria-label="Tipo" value={filters.kind} onChange={e => setFilters(f => ({ ...f, kind: e.target.value, page: 1 }))} className="!w-auto">{KINDS.filter(k => k.value === 'ALL' || !kinds || kinds.includes(k.value)).map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</Select> : null}
        </div>
        {error ? <ErrorState compact error={error} onRetry={reload} /> : loading && !data ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}</div>
        ) : !creatives.length ? <EmptyState compact icon="photo_library" title="Nenhum criativo compatível" description="Envie um arquivo acima." /> : (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[46vh] overflow-y-auto pr-1">
            {creatives.map(c => {
              const index = selected.findIndex(x => x.id === c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggle(c)} aria-pressed={index >= 0}
                  className={`relative aspect-square rounded-lg overflow-hidden border ${index >= 0 ? 'border-blue-400 ring-2 ring-blue-400/50' : 'border-border hover:border-border-focus'}`}>
                  <CreativeThumb creative={c} className="absolute inset-0 w-full h-full" />
                  {index >= 0 && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-500 text-white text-[11px] font-semibold flex items-center justify-center">{index + 1}</span>}
                  {c.kind === 'video' && <span className="absolute bottom-1 left-1"><Pill className="bg-black/60 border-transparent text-white">{formatDuration(c.durationMs)}</Pill></span>}
                </button>
              );
            })}
          </div>
        )}
        <Pagination page={data?.page || 1} totalPages={data?.totalPages} onChange={page => setFilters(f => ({ ...f, page }))} />
      </div>
    </Modal>
  );
}
