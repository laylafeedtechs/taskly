// Media inspection for the creatives library. The file type, dimensions and
// duration are read from the bytes themselves (magic numbers and container
// headers); the extension or the browser-reported MIME type are never trusted.

const ascii = (b, start, end) => b.subarray(start, end).toString('latin1');

export const MEDIA_TYPES = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'gif' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' }
};

// --------------------------------------------------------------- images

function jpegSize(b) {
  if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(b) {
  if (!b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || ascii(b, 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b) {
  if (!['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6))) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpSize(b) {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 12) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

// --------------------------------------------------------------- MP4 / MOV

// Walks ISO-BMFF boxes. Returns duration (ms), the first video track size and
// whether the `moov` box comes before `mdat` (Meta requires "moov at front").
function isoInfo(b) {
  if (b.length < 12 || ascii(b, 4, 8) !== 'ftyp') return null;
  const brand = ascii(b, 8, 12);
  const out = { brand, durationMs: null, width: null, height: null, moovFirst: null };
  let sawMdat = false;

  const walk = (start, end, depth) => {
    let i = start;
    while (i + 8 <= end) {
      let size = b.readUInt32BE(i);
      const type = ascii(b, i + 4, i + 8);
      let header = 8;
      if (size === 1) {
        if (i + 16 > end) return;
        size = Number(b.readBigUInt64BE(i + 8));
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header || i + size > end) return;
      if (depth === 0) {
        if (type === 'mdat') sawMdat = true;
        if (type === 'moov' && out.moovFirst === null) out.moovFirst = !sawMdat;
      }
      if (type === 'moov' || type === 'trak') walk(i + header, i + size, depth + 1);
      else if (type === 'mvhd') {
        const v = b[i + header];
        const timescale = v === 1 ? b.readUInt32BE(i + header + 20) : b.readUInt32BE(i + header + 12);
        const duration = v === 1 ? Number(b.readBigUInt64BE(i + header + 24)) : b.readUInt32BE(i + header + 16);
        if (timescale) out.durationMs = Math.round((duration / timescale) * 1000);
      } else if (type === 'tkhd' && !out.width) {
        const v = b[i + header];
        const base = i + header + (v === 1 ? 88 : 76);
        if (base + 8 <= i + size) {
          const w = b.readUInt32BE(base) / 65536;
          const h = b.readUInt32BE(base + 4) / 65536;
          if (w > 0 && h > 0) { out.width = Math.round(w); out.height = Math.round(h); }
        }
      }
      i += size;
    }
  };
  walk(0, b.length, 0);
  return out;
}

/**
 * Validates the bytes against the declared extension and returns metadata.
 * Throws an Error with a user-facing message when the content does not match.
 */
export function inspectMedia(buffer, ext) {
  const type = MEDIA_TYPES[ext];
  if (!type) throw new Error(`Formato .${ext || '?'} não suportado na biblioteca de criativos`);
  const warnings = [];
  let size = null;
  if (type.mime === 'image/jpeg') size = jpegSize(buffer);
  else if (type.mime === 'image/png') size = pngSize(buffer);
  else if (type.mime === 'image/gif') size = gifSize(buffer);
  else if (type.mime === 'image/webp') size = webpSize(buffer);
  if (type.kind !== 'video') {
    if (!size || !size.width || !size.height) throw new Error('O conteúdo do arquivo não corresponde a uma imagem válida desse formato');
    return { ...type, width: size.width, height: size.height, durationMs: null, warnings };
  }
  const info = isoInfo(buffer);
  if (!info) throw new Error('O conteúdo do arquivo não corresponde a um vídeo MP4/MOV válido');
  if (!info.durationMs) throw new Error('Não foi possível ler a duração do vídeo');
  if (info.moovFirst === false) warnings.push('MOOV_AT_END');
  // QuickTime files use the "qt  " brand; label them correctly whatever the extension.
  const mime = info.brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  return { kind: 'video', mime, width: info.width, height: info.height, durationMs: info.durationMs, warnings };
}

// Thumbnails generated by the browser are always small JPEGs.
export function inspectThumbnail(buffer) {
  const size = jpegSize(buffer);
  if (!size) throw new Error('A miniatura precisa ser uma imagem JPEG');
  if (size.width > 1080 || size.height > 1920) throw new Error('Miniatura grande demais');
  return size;
}
