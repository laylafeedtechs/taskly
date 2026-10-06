// Upload pipeline for the creatives library: optional PNG/WebP → JPEG
// conversion (the Instagram API only accepts JPEG images), binary upload with
// progress, then a light thumbnail generated in the browser.
import React, { useCallback, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { Icon, Btn, Toggle, ProgressBar } from '../ui';
import { makeThumbnail, convertToJpeg, isConvertible, ACCEPT, formatBytes } from './media';

export function useCreativeUploader() {
  const { currentWorkspaceId, showError } = useApp();
  const [queue, setQueue] = useState([]); // { key, name, size, progress, status, error }

  const update = (key, patch) => setQueue(q => q.map(item => (item.key === key ? { ...item, ...patch } : item)));

  const upload = useCallback(async (files, { convert = true, query = {} } = {}) => {
    const list = [...files];
    const entries = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, progress: 0, status: 'pending', error: null }));
    setQueue(q => [...entries, ...q].slice(0, 30));
    const created = [];
    for (let i = 0; i < list.length; i++) {
      const entry = entries[i];
      let file = list[i];
      try {
        update(entry.key, { status: 'uploading' });
        if (convert && isConvertible(file)) file = await convertToJpeg(file);
        const res = await api.creatives.upload(currentWorkspaceId, file, { query, onProgress: p => update(entry.key, { progress: p }) });
        let creative = res.creative;
        try {
          const thumb = await makeThumbnail(file);
          creative = (await api.creatives.thumbnail(creative.id, thumb)).creative;
        } catch { /* the original is used as a fallback for images */ }
        update(entry.key, { status: 'done', progress: 1 });
        created.push(creative);
      } catch (err) {
        update(entry.key, { status: 'error', error: err.message });
        if (list.length === 1) showError(err);
      }
    }
    return created;
  }, [currentWorkspaceId, showError]);

  const clearDone = useCallback(() => setQueue(q => q.filter(i => i.status !== 'done')), []);
  return { upload, queue, clearDone, busy: queue.some(i => i.status === 'uploading' || i.status === 'pending') };
}

export function UploadDropzone({ onFiles, disabled, compact = false, convert, onConvertChange, hint }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = files => { if (files?.length && !disabled) onFiles(files); };
  return (
    <div className="flex flex-col gap-2">
      <div
        role="button" tabIndex={0} aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
        className={`flex ${compact ? 'flex-row gap-3 py-3 px-4' : 'flex-col gap-2 py-8 px-6'} items-center justify-center text-center rounded-xl border border-dashed transition-colors cursor-pointer ${over ? 'border-blue-400 bg-blue-500/5' : 'border-border hover:border-border-focus bg-background-secondary/40'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Icon name="cloud_upload" size={compact ? 20 : 26} className="text-text-muted" />
        <div className={compact ? 'text-left' : ''}>
          <p className="text-[13px] font-medium text-text-primary">Arraste arquivos ou clique para enviar</p>
          <p className="text-[11px] text-text-muted mt-0.5">{hint || 'JPG, PNG, WebP, GIF (até 20 MB) · MP4, MOV (até 50 MB)'}</p>
        </div>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => { pick(e.target.files); e.target.value = ''; }} />
      </div>
      {onConvertChange && (
        <Toggle checked={convert} onChange={onConvertChange} label="Converter PNG/WebP para JPEG" description="A API do Instagram publica somente imagens JPEG." />
      )}
    </div>
  );
}

export function UploadQueue({ queue, onClear }) {
  if (!queue.length) return null;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      {queue.slice(0, 8).map(item => (
        <div key={item.key} className="flex items-center gap-3 text-[12px]">
          <Icon name={item.status === 'done' ? 'check_circle' : item.status === 'error' ? 'error' : 'upload'} size={16} className={item.status === 'done' ? 'text-emerald-400' : item.status === 'error' ? 'text-red-400' : 'text-text-muted'} />
          <span className="truncate flex-1 text-text-secondary" title={item.name}>{item.name} <span className="text-text-muted">· {formatBytes(item.size)}</span></span>
          {item.status === 'error' ? <span className="text-red-300 truncate max-w-[50%]" title={item.error}>{item.error}</span> : <ProgressBar value={Math.round(item.progress * 100)} className="w-24" />}
        </div>
      ))}
      {queue.some(i => i.status === 'done') && <Btn size="xs" variant="ghost" className="self-start" onClick={onClear}>Limpar concluídos</Btn>}
    </div>
  );
}
