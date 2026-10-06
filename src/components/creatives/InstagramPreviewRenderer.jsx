// InstagramPreviewRenderer — renders a publication the way Instagram lays it
// out (structure, hierarchy, proportions and behaviour of each format), from
// the publication's real data. It is an approximation, not a pixel-perfect
// copy: Instagram changes its interface, so everything network-specific lives
// in this file (FORMAT rules, palette, icons) and can be updated in one place.
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { formatDuration } from './shared';

// Visual tokens of the network UI (not Taskly's theme; the preview mirrors Instagram).
const PALETTE = {
  dark: { bg: '#000000', text: '#F5F5F5', muted: '#A8A8A8', link: '#E0F1FF', border: '#262626', chip: '#262626' },
  light: { bg: '#FFFFFF', text: '#0C1014', muted: '#737373', link: '#00376B', border: '#DBDBDB', chip: '#EFEFEF' }
};

// Feed media keeps its own ratio, clamped to what Instagram displays (4:5 to 1.91:1).
function feedRatio(first) {
  if (!first?.width || !first?.height) return 4 / 5;
  return Math.min(1.91, Math.max(0.8, first.width / first.height));
}

const Svg = ({ children, size = 24, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const Heart = p => <Svg {...p}><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" /></Svg>;
const Comment = p => <Svg {...p}><path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.6-4.3A8.5 8.5 0 1 1 20.5 11.5z" /></Svg>;
const Send = p => <Svg {...p}><path d="M21.5 3.5 10 13.2M21.5 3.5l-7 17-3.6-7.3-7.4-3.4 18-6.3z" /></Svg>;
const Save = p => <Svg {...p}><path d="M18.5 20.5 12 15.7l-6.5 4.8V4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v16z" /></Svg>;
const More = ({ color }) => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill={color} /><circle cx="12" cy="12" r="1.6" fill={color} /><circle cx="19" cy="12" r="1.6" fill={color} /></svg>;

function Avatar({ account, size = 32, c }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="inline-flex rounded-full p-[1.5px] flex-shrink-0" style={{ width: size, height: size, background: 'conic-gradient(from 200deg,#F58529,#DD2A7B,#8134AF,#515BD4,#F58529)' }}>
      <span className="w-full h-full rounded-full p-[1.5px]" style={{ background: c.bg }}>
        {account?.hasAvatar && !broken
          ? <img src={api.social.avatarUrl(account.id)} alt="" onError={() => setBroken(true)} className="w-full h-full rounded-full object-cover" />
          : <span className="w-full h-full rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: c.chip, color: c.text }}>{(account?.username || '?')[0].toUpperCase()}</span>}
      </span>
    </span>
  );
}

// Caption with tappable-looking hashtags/mentions and the "mais" truncation.
function Caption({ username, text, c }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 125 || text.split('\n').length > 2;
  const shown = open || !long ? text : `${text.slice(0, 120).trimEnd()}…`;
  const parts = shown.split(/(\s+)/).map((w, i) => (/^[#@][\p{L}\p{N}_.]+/u.test(w) ? <span key={i} style={{ color: c.link }}>{w}</span> : w));
  return (
    <p className="text-[13px] leading-[18px] whitespace-pre-wrap break-words" style={{ color: c.text }}>
      <span className="font-semibold mr-1">{username}</span>{parts}
      {long && !open && <button type="button" onClick={() => setOpen(true)} className="ml-1" style={{ color: c.muted }}>mais</button>}
    </p>
  );
}

function MediaView({ item, ratio, active = true, fill = false }) {
  if (!item) return <div className="w-full h-full flex items-center justify-center text-[12px] text-neutral-500 bg-neutral-900">Sem mídia</div>;
  if (!item.available) return <div className="w-full h-full flex items-center justify-center text-[12px] text-neutral-400 bg-neutral-900">Criativo indisponível</div>;
  const style = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : { width: '100%', aspectRatio: ratio };
  if (item.kind === 'video') {
    return (
      <video key={item.id} src={api.creatives.fileUrl(item.id)} poster={item.hasThumb ? api.creatives.thumbUrl(item.id) : undefined}
        style={{ ...style, objectFit: 'cover', background: '#000' }} muted loop playsInline controls={active} preload="metadata" />
    );
  }
  return <img src={api.creatives.fileUrl(item.id)} alt="" loading="lazy" style={{ ...style, objectFit: 'cover', background: '#000' }} />;
}

function relativeLabel(iso) {
  if (!iso) return 'AGORA';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' }).toUpperCase();
}

// ------------------------------------------------------------------ formats

function FeedPost({ account, publication, media, c }) {
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [media.length]);
  const isCarousel = publication.type === 'CAROUSEL' && media.length > 1;
  const ratio = feedRatio(media[0]);
  const caption = [publication.caption, (publication.hashtags || []).map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n');
  return (
    <article style={{ background: c.bg, color: c.text }}>
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar account={account} size={32} c={c} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-semibold truncate">{account?.username || 'sua_conta'}</div>
          {publication.location?.name && <div className="text-[11px] truncate" style={{ color: c.text }}>{publication.location.name}</div>}
        </div>
        <More color={c.text} />
      </header>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: ratio }}>
        {isCarousel ? (
          <div className="absolute inset-0 flex transition-transform duration-300 ease-out" style={{ transform: `translateX(-${index * 100}%)` }}>
            {media.map((m, i) => <div key={m?.id || i} className="relative w-full h-full flex-shrink-0"><MediaView item={m} fill active={i === index} /></div>)}
          </div>
        ) : <MediaView item={media[0]} fill />}
        {isCarousel && (
          <>
            <span className="absolute top-3 right-3 text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/60 text-white">{index + 1}/{media.length}</span>
            {index > 0 && <button type="button" aria-label="Anterior" onClick={() => setIndex(i => i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 text-black text-[15px] leading-none">‹</button>}
            {index < media.length - 1 && <button type="button" aria-label="Próximo" onClick={() => setIndex(i => i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 text-black text-[15px] leading-none">›</button>}
          </>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="relative flex items-center gap-3.5">
          <Heart color={c.text} /><Comment color={c.text} /><Send color={c.text} />
          {isCarousel && (
            <div className="absolute left-1/2 -translate-x-1/2 flex gap-1">
              {media.map((_, i) => <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === index ? '#0095F6' : c.muted, opacity: i === index ? 1 : 0.5 }} />)}
            </div>
          )}
          <span className="ml-auto"><Save color={c.text} /></span>
        </div>
        <div className="mt-2 flex flex-col gap-1">
          <Caption username={account?.username || 'sua_conta'} text={caption} c={c} />
          <span className="text-[10px] tracking-wide" style={{ color: c.muted }}>{relativeLabel(publication.publishedAt || publication.scheduledAt)}</span>
        </div>
      </div>
    </article>
  );
}

function Reel({ account, publication, media, cover, c }) {
  const caption = [publication.caption, (publication.hashtags || []).map(t => `#${t}`).join(' ')].filter(Boolean).join(' ');
  const video = media[0];
  return (
    <article className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: 9 / 16 }}>
      <MediaView item={video} fill />
      {cover && <span className="absolute top-3 left-3 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">Capa definida: {cover.name}</span>}
      <div className="absolute inset-x-0 bottom-0 p-3 pt-16 bg-gradient-to-t from-black/75 via-black/30 to-transparent text-white pointer-events-none">
        <div className="flex items-center gap-2 mb-2"><Avatar account={account} size={28} c={PALETTE.dark} /><span className="text-[13px] font-semibold">{account?.username || 'sua_conta'}</span><span className="text-[11px] border border-white/60 rounded-md px-2 py-0.5">Seguir</span></div>
        {caption && <p className="text-[12px] leading-[16px] line-clamp-2">{caption}</p>}
        {publication.location?.name && <p className="text-[11px] mt-1 opacity-80">📍 {publication.location.name}</p>}
      </div>
      <div className="absolute right-2.5 bottom-20 flex flex-col items-center gap-4 text-white pointer-events-none">
        <Heart color="#fff" size={26} /><Comment color="#fff" size={26} /><Send color="#fff" size={26} /><More color="#fff" />
      </div>
      {video?.durationMs && <span className="absolute top-3 right-3 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">{formatDuration(video.durationMs)}</span>}
      {publication.shareToFeed === false && <span className="absolute top-9 right-3 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">Só na aba Reels</span>}
    </article>
  );
}

function Story({ account, publication, media }) {
  return (
    <article className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: 9 / 16 }}>
      <MediaView item={media[0]} fill />
      <div className="absolute inset-x-0 top-0 p-2.5 bg-gradient-to-b from-black/60 to-transparent text-white">
        <div className="h-0.5 rounded-full bg-white/40 overflow-hidden"><div className="h-full w-1/3 bg-white" /></div>
        <div className="flex items-center gap-2 mt-2.5">
          <Avatar account={account} size={28} c={PALETTE.dark} />
          <span className="text-[13px] font-semibold">{account?.username || 'sua_conta'}</span>
          <span className="text-[12px] opacity-70">{publication.publishedAt || publication.scheduledAt ? new Date(publication.publishedAt || publication.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora'}</span>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-center gap-3 text-white">
        <span className="flex-1 h-10 rounded-full border border-white/60 px-4 flex items-center text-[13px] opacity-80">Enviar mensagem</span>
        <Heart color="#fff" /><Send color="#fff" />
      </div>
    </article>
  );
}

/**
 * @param {object} props
 * @param {object} props.account   connected account (username, avatar)
 * @param {object} props.publication  { type, caption, hashtags, location, scheduledAt, publishedAt, shareToFeed }
 * @param {object[]} props.media   creatives in order ({ id, kind, width, height, available, hasThumb, durationMs })
 * @param {object} [props.cover]   reel cover creative
 * @param {'dark'|'light'} [props.theme]
 */
export function InstagramPreviewRenderer({ account, publication, media = [], cover = null, theme = 'dark' }) {
  const c = PALETTE[theme] || PALETTE.dark;
  const items = useMemo(() => media.filter(Boolean), [media]);
  const Format = { REEL: Reel, STORY: Story }[publication?.type] || FeedPost;
  return (
    <div className="w-full max-w-[360px] mx-auto rounded-[22px] overflow-hidden border shadow-elevated" style={{ borderColor: c.border, background: c.bg }}>
      <Format account={account} publication={publication || {}} media={items} cover={cover} c={c} />
    </div>
  );
}

export const PREVIEW_DISCLAIMER = 'Pré-visualização aproximada, montada com os dados reais da publicação. A interface do Instagram pode variar.';
