// Publication editor: editor on the left, live Instagram preview on the right
// (tabs on mobile). Every action maps to a backend transition; the browser
// never decides that something was published.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useMediaQuery } from '../../lib/hooks';
import { Btn, IconBtn, Icon, Field, Input, Textarea, Select, Alert, Modal, Tabs, Segmented, Spinner, Avatar, EmptyState } from '../ui';
import { InstagramPreviewRenderer, PREVIEW_DISCLAIMER } from './InstagramPreviewRenderer';
import { CreativePickerModal } from './LibraryView';
import { useCreatives, StatusBadge, TYPE_META, CreativeThumb, toLocalInput, fromLocalInput, formatWhen, formatDuration, ACCOUNT_STATUS } from './shared';

const CAPABILITY = { POST: 'canPublishPost', CAROUSEL: 'canPublishCarousel', REEL: 'canPublishReel', STORY: 'canPublishStory' };
const CONTENT_LOCKED = ['PUBLISHING', 'PUBLISHED', 'CANCELLED'];
const HASHTAG_RE = /^[\p{L}\p{N}_]{1,100}$/u;

function formFrom(pub, defaults = {}) {
  return {
    socialAccountId: pub?.socialAccountId || defaults.socialAccountId || '',
    type: pub?.type || defaults.type || 'POST',
    title: pub?.title || '',
    media: pub ? pub.media.map(m => m.creative).filter(Boolean) : defaults.media || [],
    cover: pub?.cover || null,
    caption: pub?.caption || '',
    hashtags: pub?.hashtags || [],
    location: { name: pub?.location?.name || '', id: pub?.location?.id || '' },
    shareToFeed: pub ? pub.shareToFeed !== false : true,
    campaignId: pub?.campaignId || defaults.campaignId || '',
    projectId: pub?.projectId || defaults.projectId || '',
    taskId: pub?.taskId || defaults.taskId || '',
    responsibleId: pub?.responsibleId || '',
    tags: pub?.tags || [],
    scheduledAt: toLocalInput(pub?.scheduledAt || defaults.scheduledAt)
  };
}

function payloadFrom(form) {
  return {
    socialAccountId: form.socialAccountId, type: form.type, title: form.title,
    media: form.media.map(c => c.id), coverCreativeId: form.type === 'REEL' ? form.cover?.id || null : null,
    caption: form.caption, hashtags: form.hashtags, location: form.location.name || form.location.id ? form.location : null,
    shareToFeed: form.shareToFeed, campaignId: form.campaignId || null, projectId: form.projectId || null, taskId: form.taskId || null,
    responsibleId: form.responsibleId || null, tags: form.tags, scheduledAt: fromLocalInput(form.scheduledAt)
  };
}

// --------------------------------------------------------------- pieces

function MediaManager({ form, setForm, locked, rules }) {
  const [picker, setPicker] = useState(null); // { mode: 'add' | 'replace' | 'cover', index }
  const [dragIndex, setDragIndex] = useState(null);
  const max = rules?.mediaMax || 1;
  const kinds = rules?.kinds || ['image'];
  const move = (from, to) => setForm(f => { const list = [...f.media]; const [item] = list.splice(from, 1); list.splice(to, 0, item); return { ...f, media: list }; });
  const onPick = picked => setForm(f => {
    if (picker.mode === 'cover') return { ...f, cover: picked[0] };
    if (picker.mode === 'replace') { const list = [...f.media]; list[picker.index] = picked[0]; return { ...f, media: list }; }
    const ids = new Set(f.media.map(m => m.id));
    return { ...f, media: [...f.media, ...picked.filter(p => !ids.has(p.id))].slice(0, max) };
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="list" aria-label="Mídias da publicação">
        {form.media.map((c, i) => (
          <div key={c.id} role="listitem" draggable={!locked && form.media.length > 1}
            onDragStart={e => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={e => { if (dragIndex !== null) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) move(dragIndex, i); setDragIndex(null); }}
            onDragEnd={() => setDragIndex(null)}
            className={`group relative w-[88px] h-[110px] rounded-lg overflow-hidden border ${dragIndex === i ? 'opacity-40 border-blue-400' : 'border-border'} ${!locked && form.media.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}>
            <CreativeThumb creative={c} className="absolute inset-0 w-full h-full" />
            {form.media.length > 1 && <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/65 text-white text-[10px] font-semibold flex items-center justify-center">{i + 1}</span>}
            {c.kind === 'video' && <span className="absolute bottom-1 left-1 text-[10px] font-mono px-1 rounded bg-black/65 text-white">{formatDuration(c.durationMs)}</span>}
            {!locked && (
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-0.5 p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity bg-gradient-to-t from-black/70 to-transparent">
                {form.media.length > 1 && i > 0 && <button type="button" aria-label="Mover para a esquerda" onClick={() => move(i, i - 1)} className="w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center"><Icon name="chevron_left" size={14} /></button>}
                <button type="button" aria-label="Substituir" onClick={() => setPicker({ mode: 'replace', index: i })} className="w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center"><Icon name="swap_horiz" size={14} /></button>
                <button type="button" aria-label="Remover" onClick={() => setForm(f => ({ ...f, media: f.media.filter(m => m.id !== c.id) }))} className="w-6 h-6 rounded bg-black/60 text-white flex items-center justify-center"><Icon name="close" size={14} /></button>
              </div>
            )}
          </div>
        ))}
        {!locked && form.media.length < max && (
          <button type="button" onClick={() => setPicker({ mode: 'add' })}
            className="w-[88px] h-[110px] rounded-lg border border-dashed border-border hover:border-border-focus text-text-muted hover:text-text-primary flex flex-col items-center justify-center gap-1 text-[11px] transition-colors">
            <Icon name="add_photo_alternate" size={22} />{form.media.length ? 'Adicionar' : 'Escolher'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-muted">
        {form.type === 'CAROUSEL' ? `2 a ${max} itens · arraste para reordenar.` : form.type === 'REEL' ? 'Um vídeo MP4/MOV de 3 s a 15 min (9:16 recomendado).' : form.type === 'STORY' ? 'Uma imagem JPEG ou um vídeo de até 60 s (9:16).' : 'Uma imagem JPEG, proporção entre 4:5 e 1,91:1.'}
      </p>
      {form.type === 'REEL' && (
        <div className="flex items-center gap-3 mt-1">
          <div className="w-12 h-16 rounded-md overflow-hidden border border-border relative bg-surface-elevated">{form.cover ? <CreativeThumb creative={form.cover} className="absolute inset-0 w-full h-full" /> : <Icon name="image" size={18} className="absolute inset-0 m-auto text-text-muted" />}</div>
          <div className="flex flex-col gap-1">
            <span className="text-[12px] text-text-secondary">Capa do reel (opcional, JPEG)</span>
            {!locked && <div className="flex gap-1.5"><Btn size="xs" onClick={() => setPicker({ mode: 'cover' })}>{form.cover ? 'Trocar capa' : 'Definir capa'}</Btn>{form.cover && <Btn size="xs" variant="ghost" onClick={() => setForm(f => ({ ...f, cover: null }))}>Remover</Btn>}</div>}
          </div>
        </div>
      )}
      <CreativePickerModal open={Boolean(picker)} onClose={() => setPicker(null)} onPick={onPick}
        max={picker?.mode === 'add' ? Math.max(1, max - form.media.length) : 1}
        kinds={picker?.mode === 'cover' ? ['image'] : kinds}
        title={picker?.mode === 'cover' ? 'Escolher capa do reel' : picker?.mode === 'replace' ? 'Substituir criativo' : 'Escolher criativos'} />
    </div>
  );
}

function HashtagInput({ value, onChange, disabled }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const add = raw => {
    const tags = raw.split(/[\s,]+/).map(t => t.replace(/^#+/, '').trim()).filter(Boolean);
    const bad = tags.find(t => !HASHTAG_RE.test(t));
    if (bad) { setError(`#${bad} tem caracteres inválidos`); return; }
    setError('');
    onChange([...new Set([...value, ...tags])].slice(0, 30));
    setText('');
  };
  return (
    <div>
      <div className={`flex flex-wrap items-center gap-1.5 min-h-9 px-2 py-1.5 rounded-lg border bg-background-secondary ${error ? 'border-red-500/60' : 'border-border focus-within:border-border-focus'}`}>
        {value.map(t => (
          <span key={t} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-surface-elevated text-[12px] text-sky-300">#{t}
            {!disabled && <button type="button" aria-label={`Remover #${t}`} onClick={() => onChange(value.filter(x => x !== t))} className="text-text-muted hover:text-text-primary"><Icon name="close" size={13} /></button>}
          </span>
        ))}
        {!disabled && value.length < 30 && (
          <input value={text} onChange={e => setText(e.target.value)} placeholder={value.length ? '' : '#hashtag'} aria-label="Adicionar hashtag"
            onKeyDown={e => { if (['Enter', ',', ' '].includes(e.key) && text.trim()) { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
            onBlur={() => text.trim() && add(text)} className="flex-1 min-w-[90px] bg-transparent text-[13px] text-text-primary focus:outline-none placeholder:text-text-muted" />
        )}
      </div>
      <p className={`text-[11px] mt-1 ${error ? 'text-red-400' : 'text-text-muted'}`}>{error || `${value.length}/30 hashtags`}</p>
    </div>
  );
}

function RejectModal({ open, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Rejeitar publicação" description="O motivo fica registrado e é enviado a quem criou a publicação, que poderá ajustá-la."
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="danger" disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>Rejeitar</Btn></>}>
      <Field label="Motivo" required><Textarea data-autofocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex.: Alterar o CTA da legenda." maxLength={1000} /></Field>
    </Modal>
  );
}

function DuplicateModal({ open, onClose, pub, onDone }) {
  const { campaigns, accounts } = useCreatives();
  const { members, showError, toast } = useApp();
  const [form, setForm] = useState({});
  useEffect(() => { if (open) setForm({ scheduledAt: '', campaignId: pub?.campaignId || '', responsibleId: pub?.responsibleId || '', socialAccountId: pub?.socialAccountId || '' }); }, [open, pub]);
  const submit = async () => {
    try {
      const res = await api.publications.duplicate(pub.id, { scheduledAt: fromLocalInput(form.scheduledAt), campaignId: form.campaignId || null, responsibleId: form.responsibleId || null, socialAccountId: form.socialAccountId });
      toast('Publicação duplicada como rascunho', 'success');
      onDone(res.publication);
    } catch (err) { showError(err); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Duplicar publicação" description="Cria uma nova publicação em rascunho com o mesmo conteúdo."
      footer={<><Btn onClick={onClose}>Cancelar</Btn><Btn variant="primary" onClick={submit}>Duplicar</Btn></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Conta"><Select value={form.socialAccountId || ''} onChange={e => setForm(f => ({ ...f, socialAccountId: e.target.value }))}>{accounts.map(a => <option key={a.id} value={a.id}>@{a.username}</option>)}</Select></Field>
        <Field label="Nova data e horário"><Input type="datetime-local" value={form.scheduledAt || ''} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} /></Field>
        <Field label="Campanha"><Select value={form.campaignId || ''} onChange={e => setForm(f => ({ ...f, campaignId: e.target.value }))}><option value="">Sem campanha</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Responsável"><Select value={form.responsibleId || ''} onChange={e => setForm(f => ({ ...f, responsibleId: e.target.value }))}><option value="">Sem responsável</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

const ACTION_LABEL = {
  PUBLICATION_CREATED: 'criou a publicação', PUBLICATION_EDITED: 'editou', PUBLICATION_SUBMITTED: 'enviou para aprovação', PUBLICATION_APPROVED: 'aprovou',
  PUBLICATION_REJECTED: 'rejeitou', PUBLICATION_SCHEDULED: 'agendou', PUBLICATION_RESCHEDULED: 'reagendou', PUBLICATION_UNSCHEDULED: 'desfez o agendamento',
  PUBLICATION_PUBLISHING: 'iniciou o envio ao Instagram', PUBLICATION_PUBLISHED: 'publicação confirmada pelo Instagram', PUBLICATION_FAILED: 'falha ao publicar',
  PUBLICATION_CANCELLED: 'cancelou', PUBLICATION_REOPENED: 'reabriu', PUBLICATION_RETRY: 'solicitou nova tentativa', PUBLICATION_DELETED: 'excluiu'
};

function HistoryPanel({ pub }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { let alive = true; api.publications.history(pub.id).then(d => alive && setData(d)).catch(e => alive && setError(e)); return () => { alive = false; }; }, [pub.id, pub.updatedAt, pub.status]);
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  if (!data) return <div className="py-8 flex justify-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-text-muted">Criada</dt><dd className="text-text-secondary">{new Date(pub.createdAt).toLocaleString('pt-BR')}</dd>
        {pub.approval?.decidedAt && <><dt className="text-text-muted">{pub.approval.state === 'APPROVED' ? 'Aprovada' : 'Decisão'}</dt><dd className="text-text-secondary">{pub.approval.decidedByName || '—'} · {new Date(pub.approval.decidedAt).toLocaleString('pt-BR')}</dd></>}
        {pub.scheduledAt && <><dt className="text-text-muted">Agendada para</dt><dd className="text-text-secondary">{formatWhen(pub.scheduledAt, { withWeekday: true })}</dd></>}
        {pub.publishedAt && <><dt className="text-text-muted">Publicada</dt><dd className="text-text-secondary">{new Date(pub.publishedAt).toLocaleString('pt-BR')}</dd></>}
        {pub.externalId && <><dt className="text-text-muted">ID externo</dt><dd className="text-text-secondary font-mono break-all">{pub.externalId}</dd></>}
        <dt className="text-text-muted">Tentativas</dt><dd className="text-text-secondary">{pub.publishing?.attempts || 0}</dd>
      </dl>
      {data.attempts.length > 0 && (
        <section>
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-2">Tentativas de publicação</h3>
          <ol className="flex flex-col gap-2">
            {data.attempts.map(a => (
              <li key={a.id} className="rounded-lg border border-border p-2.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text-primary">Tentativa {a.attempt}</span>
                  <span className={a.outcome === 'SUCCESS' ? 'text-emerald-300' : a.outcome === 'FAILED' ? 'text-red-300' : 'text-text-muted'}>{{ SUCCESS: 'Sucesso', FAILED: 'Falhou', IN_PROGRESS: 'Em andamento' }[a.outcome] || a.outcome}</span>
                </div>
                <div className="text-text-muted mt-0.5">{new Date(a.startedAt).toLocaleString('pt-BR')}{a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} s` : ''}</div>
                {a.error && <div className="text-red-300 mt-1">{a.error.message}</div>}
                <div className="text-[10px] font-mono text-text-muted mt-1">chave: {a.idempotencyKey}</div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section>
        <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-2">Linha do tempo</h3>
        {!data.events.length ? <p className="text-[12px] text-text-muted">Sem eventos ainda.</p> : (
          <ol className="relative border-l border-border ml-1.5 flex flex-col gap-3">
            {data.events.map(e => (
              <li key={e.id} className="pl-4 relative">
                <span className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${e.result === 'FAILURE' ? 'bg-red-400' : e.action === 'PUBLICATION_PUBLISHED' ? 'bg-emerald-400' : 'bg-text-muted'}`} />
                <p className="text-[12px] text-text-primary"><span className="font-medium">{e.actor}</span> {ACTION_LABEL[e.action] || e.action}</p>
                {e.details?.reason && <p className="text-[12px] text-text-secondary mt-0.5">“{e.details.reason}”</p>}
                <p className="text-[11px] text-text-muted">{new Date(e.timestamp).toLocaleString('pt-BR')}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function FailurePanel({ pub, onRetry, onReconnect, canPublish }) {
  if (pub.status !== 'FAILED' && !pub.error?.retrying) return null;
  const e = pub.error || {};
  return (
    <div role="alert" className={`rounded-xl border p-3.5 ${pub.status === 'FAILED' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <div className="flex items-start gap-2.5">
        <Icon name={pub.status === 'FAILED' ? 'error' : 'schedule'} size={18} className={pub.status === 'FAILED' ? 'text-red-400 mt-0.5' : 'text-amber-400 mt-0.5'} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-text-primary">{pub.status === 'FAILED' ? 'Falha ao publicar' : 'Nova tentativa agendada'}</p>
          <p className="text-[12px] text-text-secondary mt-0.5">{e.message || 'Erro desconhecido'}</p>
          <p className="text-[11px] text-text-muted mt-1">
            {e.at && new Date(e.at).toLocaleString('pt-BR')}{e.attempt ? ` · tentativa ${e.attempt}` : ''}{e.code ? ` · código ${e.code}` : ''}
            {pub.publishing?.nextAttemptAt && pub.status !== 'FAILED' ? ` · próxima em ${formatWhen(pub.publishing.nextAttemptAt)}` : ''}
          </p>
          {pub.status === 'FAILED' && canPublish && (
            <div className="flex flex-wrap gap-2 mt-2.5">
              {e.action?.code === 'RECONNECT' ? <Btn size="xs" variant="primary" icon="link" onClick={onReconnect}>{e.action.label}</Btn> : null}
              {['RETRY', 'WAIT', 'RECONNECT'].includes(e.action?.code) && <Btn size="xs" icon="refresh" onClick={onRetry}>Tentar novamente</Btn>}
              {e.action?.code === 'EDIT' && <span className="text-[11px] text-text-secondary self-center">Ajuste a publicação abaixo e tente novamente.</span>}
              {e.action?.code === 'EDIT' && <Btn size="xs" icon="refresh" onClick={onRetry}>Tentar novamente</Btn>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor

export function PublicationEditor({ id }) {
  const { currentWorkspaceId, projects, tasks, members, toast, showError, confirm, setQuery, user } = useApp();
  const { accounts, meta, campaigns, settings, perms, bump, closeEditor, editorDefaults } = useCreatives();
  const isNew = id === 'new';
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [pub, setPub] = useState(null);
  const [form, setForm] = useState(() => formFrom(null, editorDefaults));
  const [initial, setInitial] = useState(() => JSON.stringify(formFrom(null, editorDefaults)));
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('edit');
  const [sideTab, setSideTab] = useState('preview');
  const [previewTheme, setPreviewTheme] = useState('dark');
  const [rejecting, setRejecting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (isNew) {
      const start = formFrom(null, { socialAccountId: accounts[0]?.id, ...editorDefaults });
      setForm(start); setInitial(JSON.stringify(start)); setPub(null); setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    api.publications.get(id).then(res => {
      if (!alive) return;
      setPub(res.publication);
      const f = formFrom(res.publication);
      setForm(f); setInitial(JSON.stringify(f)); setLoading(false);
    }).catch(err => { if (alive) { setLoadError(err); setLoading(false); } });
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the worker is publishing, follow the status from the server.
  useEffect(() => {
    if (!pub || !['PUBLISHING', 'SCHEDULED'].includes(pub.status)) return undefined;
    if (pub.status === 'SCHEDULED' && Date.parse(pub.scheduledAt) > Date.now() + 120000) return undefined;
    const t = setInterval(() => api.publications.get(pub.id).then(res => { if (res.publication.status !== pub.status || res.publication.updatedAt !== pub.updatedAt) { setPub(res.publication); bump(); } }).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [pub, bump]);

  const dirty = JSON.stringify(form) !== initial;
  const account = accounts.find(a => a.id === form.socialAccountId) || null;
  const rules = meta?.types?.[form.type];
  const status = pub?.status || 'DRAFT';
  const locked = CONTENT_LOCKED.includes(status) || !(perms.edit || perms.create);
  const scheduleLocked = status === 'SCHEDULED' && !perms.publish;
  const set = patch => setForm(f => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }));
  const canDelete = pub && (perms.remove || (pub.status === 'DRAFT' && pub.createdBy === user?.id)) && !['SCHEDULED', 'PUBLISHING'].includes(pub.status);
  const accountReady = account?.status === 'CONNECTED' && account.capabilities?.[CAPABILITY[form.type]];
  const problems = pub && !dirty ? pub.problems : [];
  const captionLength = [form.caption, form.hashtags.map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n').length;
  const projectTasks = useMemo(() => tasks.filter(t => !form.projectId || t.projectId === form.projectId).slice(0, 300), [tasks, form.projectId]);

  const close = useCallback(async () => {
    if (dirty && !(await confirm({ title: 'Descartar alterações?', message: 'As alterações não salvas serão perdidas.', confirmLabel: 'Descartar', danger: true }))) return;
    closeEditor();
  }, [dirty, confirm, closeEditor]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !document.querySelectorAll('[aria-modal="true"]')[1]) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const applyResult = (next, message) => {
    setPub(next);
    const f = formFrom(next);
    setForm(f); setInitial(JSON.stringify(f));
    bump();
    if (message) toast(message, 'success');
  };

  // Saves the form; asks before removing an approval or moving a scheduled post.
  const save = async ({ quiet = false } = {}) => {
    if (!form.socialAccountId) { showError(new Error('Escolha a conta do Instagram')); return null; }
    setBusy(true);
    try {
      if (isNew && !pub) {
        const res = await api.publications.create(currentWorkspaceId, payloadFrom(form));
        applyResult(res.publication, quiet ? null : 'Rascunho salvo');
        setQuery({ pub: res.publication.id });
        return res.publication;
      }
      let body = payloadFrom(form);
      for (;;) {
        try {
          const res = await api.publications.update(pub.id, body);
          applyResult(res.publication, quiet ? null : 'Alterações salvas');
          return res.publication;
        } catch (err) {
          if (err.code !== 'REQUIRES_CONFIRMATION') throw err;
          const ok = await confirm({ title: 'Confirmar alteração', message: err.message, confirmLabel: 'Confirmar' });
          if (!ok) return null;
          body = { ...body, confirmReset: true, confirmReschedule: true };
        }
      }
    } catch (err) {
      showError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const act = async (name, body, message) => {
    let target = pub;
    if (dirty || !target) target = await save({ quiet: true });
    if (!target) return;
    setBusy(true);
    try {
      const res = await api.publications.action(target.id, name, body);
      applyResult(res.publication, message);
    } catch (err) { showError(err); } finally { setBusy(false); }
  };

  const schedule = async () => {
    if (!form.scheduledAt) { showError(new Error('Defina a data e o horário')); return; }
    await act('schedule', { scheduledAt: fromLocalInput(form.scheduledAt) }, 'Publicação agendada. O Taskly publica no horário, mesmo com o navegador fechado.');
  };
  const publishNow = async () => {
    if (!(await confirm({ title: 'Publicar agora?', message: `A publicação será enviada para @${account?.username} pelo agendador do Taskly. O status só muda para “Publicado” quando o Instagram confirmar.`, confirmLabel: 'Publicar agora' }))) return;
    await act('publish', {}, 'Enviando ao Instagram…');
  };
  const reconnect = async () => {
    try { window.location.href = (await api.social.connect(currentWorkspaceId)).authorizationUrl; } catch (err) { showError(err); }
  };
  const remove = async () => {
    const published = pub.status === 'PUBLISHED';
    if (!(await confirm({ title: 'Excluir publicação?', message: published ? 'Ela sai do Taskly, mas o post continua no Instagram.' : 'Esta ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.publications.remove(pub.id); bump(); toast('Publicação excluída', 'success'); closeEditor(); } catch (err) { showError(err); }
  };

  // --------------------------------------------------------- footer actions
  const actions = [];
  if (status === 'PUBLISHED') {
    if (pub.permalink) actions.push(<a key="open" href={pub.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium border border-border bg-surface-card hover:bg-surface-hover text-text-primary"><Icon name="open_in_new" size={16} />Ver no Instagram</a>);
  } else if (status !== 'PUBLISHING') {
    if (!locked && (perms.edit || perms.create) && !scheduleLocked) actions.push(<Btn key="save" disabled={busy || (!dirty && !isNew)} onClick={() => save()}>{isNew && !pub ? 'Salvar rascunho' : 'Salvar'}</Btn>);
    if (status === 'DRAFT' && perms.edit) actions.push(<Btn key="submit" icon="send" disabled={busy} onClick={() => act('submit', {}, 'Enviada para aprovação')}>Enviar para aprovação</Btn>);
    if (status === 'PENDING_APPROVAL' && perms.edit) actions.push(<Btn key="withdraw" variant="ghost" disabled={busy} onClick={() => act('withdraw', {}, 'Envio para aprovação retirado')}>Retirar</Btn>);
    if (status === 'PENDING_APPROVAL' && perms.approve) {
      actions.push(<Btn key="reject" variant="danger" disabled={busy} onClick={() => setRejecting(true)}>Rejeitar</Btn>);
      actions.push(<Btn key="approve" variant="accent" icon="check" disabled={busy} onClick={() => act('approve', {}, 'Publicação aprovada')}>Aprovar</Btn>);
    }
    const canSchedule = perms.publish && (status === 'APPROVED' || (status === 'DRAFT' && !settings.requireApproval));
    if (canSchedule) actions.push(<Btn key="schedule" variant="primary" icon="event" disabled={busy || !accountReady} title={!accountReady ? 'A conta precisa estar conectada e permitir este formato' : undefined} onClick={schedule}>Agendar</Btn>);
    if (status === 'SCHEDULED' && perms.publish) actions.push(<Btn key="unschedule" variant="ghost" disabled={busy} onClick={() => act('unschedule', {}, 'Agendamento desfeito')}>Desfazer agendamento</Btn>);
    // "Publicar agora" only when everything needed is in place.
    const publishable = perms.publish && accountReady && !problems.length && !dirty && (['APPROVED', 'SCHEDULED'].includes(status) || (status === 'DRAFT' && !settings.requireApproval)) && pub;
    if (publishable) actions.push(<Btn key="now" variant="accent" icon="rocket_launch" disabled={busy} onClick={publishNow}>Publicar agora</Btn>);
    if (status === 'FAILED' && perms.publish) actions.push(<Btn key="retry" variant="primary" icon="refresh" disabled={busy} onClick={() => act('retry', {}, 'Nova tentativa enviada ao agendador')}>Tentar novamente</Btn>);
    if (status === 'CANCELLED' && perms.edit) actions.push(<Btn key="reopen" icon="undo" disabled={busy} onClick={() => act('reopen', {}, 'Publicação reaberta como rascunho')}>Reabrir</Btn>);
  }
  const menuItems = pub ? [
    perms.create && { label: 'Duplicar', icon: 'content_copy', onClick: () => setDuplicating(true) },
    ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(status) && perms.edit && { label: 'Cancelar publicação', icon: 'block', onClick: async () => { if (await confirm({ title: 'Cancelar publicação?', message: 'Ela fica registrada como cancelada e pode ser reaberta depois.', confirmLabel: 'Cancelar publicação', danger: true })) act('cancel', {}, 'Publicação cancelada'); } },
    status === 'SCHEDULED' && perms.publish && { label: 'Cancelar agendamento e publicação', icon: 'block', onClick: async () => { if (await confirm({ title: 'Cancelar publicação agendada?', message: 'Ela não será publicada. Você pode reabri-la depois.', confirmLabel: 'Cancelar publicação', danger: true })) act('cancel', {}, 'Publicação cancelada'); } },
    canDelete && '-', canDelete && { label: 'Excluir', icon: 'delete', danger: true, onClick: remove }
  ].filter(Boolean) : [];

  // --------------------------------------------------------------- layout
  const editorPane = (
    <div className="flex flex-col gap-4">
      {pub && <FailurePanel pub={pub} canPublish={perms.publish} onReconnect={reconnect} onRetry={() => act('retry', {}, 'Nova tentativa enviada ao agendador')} />}
      {pub?.approval?.state === 'REJECTED' && status === 'DRAFT' && (
        <Alert tone="warning"><strong>Rejeitada por {pub.approval.decidedByName || 'um aprovador'}:</strong> {pub.approval.reason}</Alert>
      )}
      {pub?.approval?.state === 'RESET' && status === 'DRAFT' && <Alert tone="info">O conteúdo mudou depois da aprovação. Envie novamente para aprovação.</Alert>}
      {status === 'PUBLISHING' && <Alert tone="info">Enviando ao Instagram pelo agendador do Taskly. Esta tela atualiza sozinha.</Alert>}
      {status === 'PUBLISHED' && <Alert tone="success">Publicação confirmada pelo Instagram{pub.publishedAt ? ` em ${new Date(pub.publishedAt).toLocaleString('pt-BR')}` : ''}. O conteúdo não pode mais ser alterado.</Alert>}

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Conta do Instagram" required>
          <Select value={form.socialAccountId} disabled={locked || scheduleLocked} onChange={e => set({ socialAccountId: e.target.value })}>
            {!form.socialAccountId && <option value="">Selecione…</option>}
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.username}{a.status !== 'CONNECTED' ? ` — ${ACCOUNT_STATUS[a.status]?.label}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Título interno" hint="Só aparece no Taskly">
          <Input value={form.title} maxLength={120} disabled={status === 'PUBLISHING'} onChange={e => set({ title: e.target.value })} placeholder="Ex.: Black Friday — Post 04" />
        </Field>
      </div>

      <Field label="Formato">
        <Segmented label="Formato" value={form.type} onChange={type => !locked && !scheduleLocked && set(f => ({ type, media: f.media.slice(0, meta?.types?.[type]?.mediaMax || 1) }))}
          options={Object.entries(TYPE_META).map(([value, m]) => ({ value, label: m.label, icon: m.icon, disabled: account && account.status === 'CONNECTED' && !account.capabilities?.[CAPABILITY[value]] }))} />
      </Field>
      {account && account.status === 'CONNECTED' && !account.capabilities?.[CAPABILITY[form.type]] && <Alert tone="warning">A autorização atual desta conta não permite publicar este formato pela API.</Alert>}

      <Field label="Criativos">
        <MediaManager form={form} setForm={setForm} locked={locked || scheduleLocked} rules={rules} />
      </Field>

      {form.type !== 'STORY' ? (
        <Field label="Legenda" hint={`${captionLength}/2200 caracteres (legenda + hashtags)`} error={captionLength > 2200 ? 'Legenda acima do limite do Instagram' : undefined}>
          <Textarea value={form.caption} disabled={locked || scheduleLocked} onChange={e => set({ caption: e.target.value })} rows={6} className="min-h-[140px]" placeholder="Escreva a legenda…" />
        </Field>
      ) : <Alert tone="info">Stories publicados pela API não exibem legenda.</Alert>}
      {form.type !== 'STORY' && <Field label="Hashtags"><HashtagInput value={form.hashtags} disabled={locked || scheduleLocked} onChange={hashtags => set({ hashtags })} /></Field>}

      {form.type === 'REEL' && (
        <label className="flex items-center gap-2 text-[12px] text-text-secondary">
          <input type="checkbox" className="accent-blue-600" checked={form.shareToFeed} disabled={locked || scheduleLocked} onChange={e => set({ shareToFeed: e.target.checked })} />
          Mostrar o reel também no feed do perfil
        </label>
      )}

      {form.type !== 'STORY' && (
        <div className="grid sm:grid-cols-[1fr_180px] gap-3">
          <Field label="Localização" hint="Nome exibido na prévia">
            <Input value={form.location.name} disabled={locked || scheduleLocked} maxLength={100} onChange={e => set(f => ({ location: { ...f.location, name: e.target.value } }))} placeholder="Ex.: São Paulo, SP" />
          </Field>
          <Field label="ID do local (opcional)" hint="ID numérico de página do Facebook">
            <Input value={form.location.id} disabled={locked || scheduleLocked} inputMode="numeric" onChange={e => set(f => ({ location: { ...f.location, id: e.target.value.replace(/\D/g, '') } }))} />
          </Field>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Data e horário" hint={status === 'SCHEDULED' ? 'Alterar pede confirmação' : 'Horário local'}>
          <Input type="datetime-local" value={form.scheduledAt} disabled={['PUBLISHING', 'PUBLISHED', 'CANCELLED'].includes(status) || scheduleLocked} onChange={e => set({ scheduledAt: e.target.value })} />
        </Field>
        <Field label="Responsável">
          <Select value={form.responsibleId} disabled={status === 'PUBLISHING'} onChange={e => set({ responsibleId: e.target.value })}>
            <option value="">Sem responsável</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Campanha">
          <Select value={form.campaignId} disabled={status === 'PUBLISHING'} onChange={e => set({ campaignId: e.target.value })}>
            <option value="">Sem campanha</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Projeto">
          <Select value={form.projectId} disabled={status === 'PUBLISHING'} onChange={e => set({ projectId: e.target.value, taskId: '' })}>
            <option value="">Sem projeto</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Tarefa" className="sm:col-span-2">
          <Select value={form.taskId} disabled={status === 'PUBLISHING'} onChange={e => set({ taskId: e.target.value })}>
            <option value="">Sem tarefa vinculada</option>
            {projectTasks.map(t => <option key={t.id} value={t.id}>{t.id} — {t.title}</option>)}
          </Select>
        </Field>
      </div>

      {problems.length > 0 && (
        <Alert tone="warning">
          <p className="font-semibold mb-1">Antes de agendar, corrija:</p>
          <ul className="list-disc pl-4 space-y-0.5">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
        </Alert>
      )}
      {pub?.warnings?.length > 0 && <Alert tone="info"><ul className="list-disc pl-4 space-y-0.5">{pub.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Alert>}
      {dirty && pub && <p className="text-[11px] text-text-muted">Há alterações não salvas.</p>}
    </div>
  );

  const previewPane = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-muted">Prévia · {TYPE_META[form.type]?.label}</span>
        <Segmented label="Tema da prévia" value={previewTheme} onChange={setPreviewTheme} options={[{ value: 'dark', label: 'Escuro', icon: 'dark_mode', showLabel: false }, { value: 'light', label: 'Claro', icon: 'light_mode', showLabel: false }]} />
      </div>
      <InstagramPreviewRenderer account={account} theme={previewTheme} cover={form.type === 'REEL' ? form.cover : null}
        publication={{ type: form.type, caption: form.caption, hashtags: form.hashtags, location: form.location, scheduledAt: fromLocalInput(form.scheduledAt), publishedAt: pub?.publishedAt, shareToFeed: form.shareToFeed }}
        media={form.media} />
      <p className="text-[11px] text-text-muted text-center">{PREVIEW_DISCLAIMER}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[115] flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={close} aria-hidden="true" />
      <section ref={panelRef} role="dialog" aria-modal="true" aria-label={isNew ? 'Nova publicação' : 'Editar publicação'}
        className="relative ml-auto w-full max-w-[1180px] h-full bg-surface border-l border-border shadow-modal flex flex-col animate-slideInRight">
        <header className="flex items-center gap-3 px-4 sm:px-5 h-14 border-b border-border flex-shrink-0">
          <IconBtn icon="close" label="Fechar" onClick={close} size="xs" />
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-text-primary truncate">{isNew && !pub ? 'Nova publicação' : form.title || 'Publicação'}</h2>
            {pub && <StatusBadge status={pub.status} />}
          </div>
          {account && <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-text-secondary">@{account.username}</span>}
        </header>

        {loading ? <div className="flex-1 flex items-center justify-center"><Spinner size={22} /></div>
          : loadError ? <div className="flex-1"><EmptyState icon="error" title="Não foi possível abrir a publicação" description={loadError.message} action={<Btn onClick={closeEditor}>Fechar</Btn>} /></div>
            : !accounts.length && isNew ? <div className="flex-1"><EmptyState icon="link_off" title="Nenhuma conta do Instagram conectada" description="Conecte uma conta para planejar publicações." action={<Btn onClick={closeEditor}>Voltar</Btn>} /></div>
              : (
                <>
                  {!isDesktop && <Tabs className="px-4 pt-3" value={tab} onChange={setTab} tabs={[{ id: 'edit', label: 'Editar', icon: 'edit' }, { id: 'preview', label: 'Prévia', icon: 'visibility' }, ...(pub ? [{ id: 'history', label: 'Histórico', icon: 'history' }] : [])]} />}
                  <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_420px]">
                    <div className={`p-4 sm:p-5 lg:overflow-y-auto ${!isDesktop && tab !== 'edit' ? 'hidden' : ''}`}>{editorPane}</div>
                    <aside className={`p-4 sm:p-5 lg:border-l border-border lg:overflow-y-auto bg-background-secondary/40 ${!isDesktop && tab === 'edit' ? 'hidden' : ''}`}>
                      {isDesktop && pub && <Tabs className="mb-4" value={sideTab} onChange={setSideTab} tabs={[{ id: 'preview', label: 'Prévia', icon: 'visibility' }, { id: 'history', label: 'Histórico', icon: 'history' }]} />}
                      {(isDesktop ? sideTab === 'history' && pub : tab === 'history') ? <HistoryPanel pub={pub} /> : previewPane}
                    </aside>
                  </div>
                  <footer className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-border bg-background-secondary/60 flex-shrink-0">
                    {menuItems.length > 0 && (
                      <div className="mr-auto">
                        <MenuButton items={menuItems} />
                      </div>
                    )}
                    {actions}
                  </footer>
                </>
              )}
      </section>
      <RejectModal open={rejecting} onClose={() => setRejecting(false)} onConfirm={reason => { setRejecting(false); act('reject', { reason }, 'Publicação rejeitada'); }} />
      <DuplicateModal open={duplicating} onClose={() => setDuplicating(false)} pub={pub} onDone={copy => { setDuplicating(false); bump(); setQuery({ pub: copy.id }); }} />
    </div>
  );
}

function MenuButton({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Btn variant="ghost" icon="more_horiz" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>Mais</Btn>
      {open && (
        <div role="menu" className="absolute bottom-full mb-1 left-0 z-[130] w-60 p-1 rounded-xl bg-surface border border-border shadow-modal animate-scaleIn">
          {items.map((item, i) => item === '-' ? <div key={i} className="my-1 border-t border-border" /> : (
            <button key={i} role="menuitem" type="button" onClick={() => { setOpen(false); item.onClick(); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left ${item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}>
              <Icon name={item.icon} size={15} />{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
