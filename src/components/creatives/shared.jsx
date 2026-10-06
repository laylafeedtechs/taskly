// Criativos — shared state and small building blocks used by every screen.
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { Icon } from '../ui';

// ----------------------------------------------------------------- status

export const STATUS_META = {
  DRAFT: { label: 'Rascunho', symbol: '○', icon: 'radio_button_unchecked', className: 'text-text-secondary bg-surface-elevated border-border' },
  PENDING_APPROVAL: { label: 'Em aprovação', symbol: '◐', icon: 'hourglass_top', className: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  APPROVED: { label: 'Aprovado', symbol: '◉', icon: 'verified', className: 'text-sky-300 bg-sky-500/10 border-sky-500/30' },
  SCHEDULED: { label: 'Agendado', symbol: '◷', icon: 'schedule', className: 'text-blue-300 bg-blue-500/10 border-blue-500/30' },
  PUBLISHING: { label: 'Publicando', symbol: '↻', icon: 'sync', className: 'text-violet-300 bg-violet-500/10 border-violet-500/30' },
  PUBLISHED: { label: 'Publicado', symbol: '✓', icon: 'check_circle', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  FAILED: { label: 'Erro', symbol: '×', icon: 'error', className: 'text-red-300 bg-red-500/10 border-red-500/30' },
  CANCELLED: { label: 'Cancelado', symbol: '–', icon: 'block', className: 'text-text-muted bg-surface-elevated border-border' }
};

export const TYPE_META = {
  POST: { label: 'Post', icon: 'image' },
  CAROUSEL: { label: 'Carrossel', icon: 'view_carousel' },
  REEL: { label: 'Reel', icon: 'movie' },
  STORY: { label: 'Story', icon: 'web_stories' }
};

export const ACCOUNT_STATUS = {
  CONNECTED: { label: 'Conectado', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  REAUTH_REQUIRED: { label: 'Reconexão necessária', dot: 'bg-amber-400', text: 'text-amber-300' },
  EXPIRED: { label: 'Autorização expirada', dot: 'bg-amber-400', text: 'text-amber-300' },
  ERROR: { label: 'Com erro', dot: 'bg-red-400', text: 'text-red-300' },
  DISCONNECTED: { label: 'Desconectado', dot: 'bg-text-muted', text: 'text-text-muted' }
};

export const CAMPAIGN_STATUS = { PLANNING: 'Planejamento', ACTIVE: 'Em andamento', FINISHED: 'Finalizada' };

export function StatusBadge({ status, compact = false, className = '' }) {
  const meta = STATUS_META[status] || STATUS_META.DRAFT;
  return (
    <span title={meta.label} className={`inline-flex items-center gap-1 rounded-md border font-medium whitespace-nowrap ${compact ? 'h-5 px-1.5 text-[10px]' : 'h-6 px-2 text-[11px]'} ${meta.className} ${className}`}>
      <span aria-hidden="true" className={status === 'PUBLISHING' ? 'inline-block animate-spin' : ''}>{meta.symbol}</span>
      {!compact && meta.label}
      {compact && <span className="sr-only">{meta.label}</span>}
    </span>
  );
}

export function TypeIcon({ type, size = 14, className = '' }) {
  const meta = TYPE_META[type] || TYPE_META.POST;
  return <Icon name={meta.icon} size={size} className={className} label={meta.label} />;
}

// ------------------------------------------------------------- formatting

export const effectiveDate = p => p?.publishedAt || p?.scheduledAt || null;

export function formatWhen(iso, { withWeekday = false } = {}) {
  if (!iso) return 'Sem data';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { ...(withWeekday ? { weekday: 'short' } : {}), day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
}

export const formatTime = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

// <input type="datetime-local"> works in local time; the API stores UTC ISO.
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = value => (value ? new Date(value).toISOString() : null);

export const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const monthLabel = (d, opts = { month: 'long', year: 'numeric' }) => {
  const s = d.toLocaleDateString('pt-BR', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const formatDuration = ms => {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ media

export function AccountAvatar({ account, size = 36, ring = false, className = '' }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  const inner = account?.hasAvatar && !broken
    ? <img src={`${api.social.avatarUrl(account.id)}?v=${encodeURIComponent(account.lastSyncAt || '')}`} alt="" loading="lazy" onError={() => setBroken(true)} className="w-full h-full rounded-full object-cover" />
    : <span className="w-full h-full rounded-full bg-surface-elevated flex items-center justify-center font-semibold text-text-secondary" style={{ fontSize: Math.max(10, size * 0.38) }}>{(account?.username || '?').slice(0, 1).toUpperCase()}</span>;
  if (!ring) return <span className={`inline-flex flex-shrink-0 ${className}`} style={style}>{inner}</span>;
  // Instagram-like story ring, kept subtle so it reads as identity, not decoration.
  return (
    <span className={`inline-flex flex-shrink-0 rounded-full p-[2px] bg-[conic-gradient(from_200deg,#F58529,#DD2A7B,#8134AF,#515BD4,#F58529)] ${className}`} style={{ width: size + 4, height: size + 4 }}>
      <span className="w-full h-full rounded-full p-[2px] bg-background">{inner}</span>
    </span>
  );
}

// Thumbnail of a creative (lazy loaded, never the full video).
export function CreativeThumb({ creative, className = '', fit = 'cover', alt = '' }) {
  const [broken, setBroken] = useState(false);
  if (!creative || !creative.available || broken || (creative.kind === 'video' && !creative.hasThumb)) {
    return (
      <div className={`flex items-center justify-center bg-surface-elevated text-text-muted ${className}`}>
        <Icon name={creative?.kind === 'video' ? 'movie' : creative && !creative.available ? 'hide_image' : 'image'} size={22} />
      </div>
    );
  }
  return <img src={api.creatives.thumbUrl(creative.id)} alt={alt || creative.name} loading="lazy" decoding="async" onError={() => setBroken(true)} className={`${fit === 'cover' ? 'object-cover' : 'object-contain'} ${className}`} />;
}

export function PublicationThumb({ publication, className = '' }) {
  const first = publication?.media?.[0]?.creative;
  const cover = publication?.type === 'REEL' && publication.cover ? publication.cover : first;
  return (
    <div className={`relative overflow-hidden bg-surface-elevated ${className}`}>
      <CreativeThumb creative={cover} className="absolute inset-0 w-full h-full" />
      {publication?.type && publication.type !== 'POST' && (
        <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/55 text-white flex items-center justify-center backdrop-blur-[2px]">
          <TypeIcon type={publication.type} size={14} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- context

const CreativesContext = createContext(null);

export function CreativesProvider({ children }) {
  const { currentWorkspaceId, setQuery, can } = useApp();
  const accountsState = useAsync(() => api.social.accounts(currentWorkspaceId), [currentWorkspaceId]);
  const metaState = useAsync(() => api.creatives.meta(), []);
  const settingsState = useAsync(() => api.creatives.settings(currentWorkspaceId), [currentWorkspaceId]);
  const campaignsState = useAsync(() => api.campaigns.list(currentWorkspaceId), [currentWorkspaceId]);
  const [dataVersion, setDataVersion] = useState(0);
  const [editorDefaults, setEditorDefaults] = useState({});

  // Any mutation bumps the version so open lists refresh themselves.
  const bump = useCallback(() => setDataVersion(v => v + 1), []);
  const openPublication = useCallback(id => setQuery({ pub: id }), [setQuery]);
  const newPublication = useCallback((defaults = {}) => { setEditorDefaults(defaults); setQuery({ pub: 'new' }); }, [setQuery]);
  const closeEditor = useCallback(() => setQuery({ pub: null }), [setQuery]);

  const value = useMemo(() => ({
    accounts: accountsState.data?.accounts || [],
    accountsState,
    reloadAccounts: accountsState.reload,
    integrations: accountsState.data?.integrations || [],
    storageAvailable: accountsState.data?.storageAvailable !== false,
    meta: metaState.data,
    settings: settingsState.data?.settings || { requireApproval: true },
    reloadSettings: settingsState.reload,
    campaigns: campaignsState.data?.campaigns || [],
    reloadCampaigns: campaignsState.reload,
    dataVersion, bump, openPublication, newPublication, closeEditor, editorDefaults,
    perms: {
      view: can('creatives.view'), create: can('creatives.create'), edit: can('creatives.edit'), remove: can('creatives.delete'),
      approve: can('creatives.approve'), publish: can('creatives.publish'), accounts: can('creatives.manage_accounts'),
      campaigns: can('creatives.manage_campaigns'), integrations: can('creatives.manage_integrations')
    }
  }), [accountsState, metaState.data, settingsState, campaignsState, dataVersion, bump, openPublication, newPublication, closeEditor, editorDefaults, can]);

  return <CreativesContext.Provider value={value}>{children}</CreativesContext.Provider>;
}

export function useCreatives() {
  const ctx = useContext(CreativesContext);
  if (!ctx) throw new Error('useCreatives must be used within CreativesProvider');
  return ctx;
}

// Section heading used across the module (quiet, typographic).
export function SectionTitle({ children, action, count }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-[11px] font-mono uppercase tracking-wider text-text-muted flex items-center gap-2">
        {children}
        {count !== undefined && <span className="text-text-secondary">{count}</span>}
      </h2>
      {action}
    </div>
  );
}
