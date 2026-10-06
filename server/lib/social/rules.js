// Publication formats and the media rules each one must satisfy before it can
// be scheduled. Values follow the official Instagram Platform documentation
// (content publishing / IG User Media reference, API v25.0). The same rules are
// sent to the browser (GET /api/creatives/meta) so the editor can explain them,
// but they are always enforced again here on the server.

export const PUBLICATION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED'];

export const PUBLICATION_TYPES = {
  POST: { label: 'Post', mediaMin: 1, mediaMax: 1, kinds: ['image'], inFeed: true, caption: true },
  CAROUSEL: { label: 'Carrossel', mediaMin: 2, mediaMax: 10, kinds: ['image', 'video'], inFeed: true, caption: true },
  REEL: { label: 'Reel', mediaMin: 1, mediaMax: 1, kinds: ['video'], inFeed: true, caption: true },
  STORY: { label: 'Story', mediaMin: 1, mediaMax: 1, kinds: ['image', 'video'], inFeed: false, caption: false }
};

export const LIMITS = {
  captionChars: 2200,
  hashtags: 30,
  mentions: 20,
  imageMaxBytes: 8 * 1024 * 1024,
  imageMinWidth: 320,
  feedAspectMin: 4 / 5, // 4:5
  feedAspectMax: 1.91, // 1.91:1
  videoMinMs: 3000,
  reelMaxMs: 15 * 60 * 1000,
  reelMaxBytes: 300 * 1024 * 1024,
  storyVideoMaxMs: 60 * 1000,
  storyVideoMaxBytes: 100 * 1024 * 1024,
  publishesPer24h: 100
};

const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(^|\s)@[\w.]+/g;

// Final text sent to the network: caption followed by the hashtag block.
export function composeCaption(publication) {
  const tags = (publication.hashtags || []).map(t => `#${t}`).join(' ');
  return [publication.caption || '', tags].filter(Boolean).join('\n\n').trim();
}

/**
 * Returns blocking problems for publishing `publication` with the resolved
 * `media` (creative records in order). An empty list means it can be scheduled.
 */
export function validatePublication(publication, media, { cover = null } = {}) {
  const problems = [];
  const type = PUBLICATION_TYPES[publication.type];
  if (!type) return [{ field: 'type', message: 'Tipo de publicação inválido' }];

  if (media.length < type.mediaMin) problems.push({ field: 'media', message: type.mediaMin === 1 ? 'Adicione o criativo da publicação' : `Um carrossel precisa de pelo menos ${type.mediaMin} itens` });
  if (media.length > type.mediaMax) problems.push({ field: 'media', message: `${type.label} aceita no máximo ${type.mediaMax} ${type.mediaMax === 1 ? 'item' : 'itens'}` });

  media.forEach((c, i) => {
    const where = media.length > 1 ? `Item ${i + 1}: ` : '';
    if (!c || c.deletedAt) { problems.push({ field: 'media', message: `${where}criativo indisponível` }); return; }
    if (!type.kinds.includes(c.kind)) {
      problems.push({ field: 'media', message: `${where}${c.kind === 'gif' ? 'GIFs não são publicáveis pela API oficial' : c.kind === 'video' ? `${type.label} não aceita vídeo` : `${type.label} precisa de um vídeo`}` });
      return;
    }
    if (c.kind === 'image') {
      if (c.mimeType !== 'image/jpeg') problems.push({ field: 'media', message: `${where}a API do Instagram aceita somente imagens JPEG` });
      if (c.size > LIMITS.imageMaxBytes) problems.push({ field: 'media', message: `${where}imagem acima de 8 MB` });
      if (type.inFeed && c.width && c.height) {
        const ratio = c.width / c.height;
        if (ratio < LIMITS.feedAspectMin - 0.005 || ratio > LIMITS.feedAspectMax + 0.005) problems.push({ field: 'media', message: `${where}proporção ${c.width}×${c.height} fora do intervalo aceito no feed (4:5 a 1,91:1)` });
      }
    }
    if (c.kind === 'video') {
      if (c.durationMs && c.durationMs < LIMITS.videoMinMs) problems.push({ field: 'media', message: `${where}vídeo com menos de 3 segundos` });
      if (publication.type === 'STORY') {
        if (c.durationMs > LIMITS.storyVideoMaxMs) problems.push({ field: 'media', message: `${where}vídeo de story com mais de 60 segundos` });
        if (c.size > LIMITS.storyVideoMaxBytes) problems.push({ field: 'media', message: `${where}vídeo de story acima de 100 MB` });
      } else {
        if (c.durationMs > LIMITS.reelMaxMs) problems.push({ field: 'media', message: `${where}vídeo com mais de 15 minutos` });
        if (c.size > LIMITS.reelMaxBytes) problems.push({ field: 'media', message: `${where}vídeo acima de 300 MB` });
      }
    }
  });

  if (cover) {
    if (publication.type !== 'REEL') problems.push({ field: 'cover', message: 'Capa personalizada só é aceita em reels' });
    else if (cover.kind !== 'image' || cover.mimeType !== 'image/jpeg') problems.push({ field: 'cover', message: 'A capa do reel precisa ser uma imagem JPEG' });
    else if (cover.size > LIMITS.imageMaxBytes) problems.push({ field: 'cover', message: 'Capa acima de 8 MB' });
  }

  if (type.caption) {
    const text = composeCaption(publication);
    if (text.length > LIMITS.captionChars) problems.push({ field: 'caption', message: `Legenda + hashtags com ${text.length} caracteres (máximo ${LIMITS.captionChars})` });
    const tags = text.match(HASHTAG_RE) || [];
    if (tags.length > LIMITS.hashtags) problems.push({ field: 'hashtags', message: `${tags.length} hashtags (máximo ${LIMITS.hashtags})` });
    const mentions = text.match(MENTION_RE) || [];
    if (mentions.length > LIMITS.mentions) problems.push({ field: 'caption', message: `${mentions.length} menções (máximo ${LIMITS.mentions})` });
  }
  if (publication.location?.id && !/^\d{1,30}$/.test(publication.location.id)) problems.push({ field: 'location', message: 'O ID de localização precisa ser o ID numérico de uma página do Facebook' });
  return problems;
}

// Non-blocking notes shown in the editor.
export function publicationWarnings(publication, media) {
  const warnings = [];
  if (publication.type === 'STORY' && (publication.caption || publication.hashtags?.length)) warnings.push('Stories publicados pela API não exibem legenda.');
  media.forEach((c, i) => {
    if (c?.warnings?.includes('MOOV_AT_END')) warnings.push(`Item ${i + 1}: o vídeo não está otimizado para streaming (moov no fim do arquivo) e pode ser recusado pela Meta.`);
    if (c?.kind === 'image' && c.width && c.width < LIMITS.imageMinWidth) warnings.push(`Item ${i + 1}: largura abaixo de 320 px; o Instagram vai ampliar a imagem.`);
  });
  return warnings;
}
