// Browser-side media helpers for the creatives library. The server validates
// every file again; these only make uploads lighter and the library faster.

const THUMB_MAX = 480;

function canvasToJpeg(canvas, quality = 0.82) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem'))), 'image/jpeg', quality));
}

function drawScaled(source, width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ img, url }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem ilegível')); };
    img.src = url;
  });
}

// A frame ~1 s into the video (or the middle of short clips).
function videoFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('Vídeo ilegível no navegador')); };
    video.onerror = fail;
    video.onloadedmetadata = () => { video.currentTime = Math.min(1, (video.duration || 2) / 2); };
    video.onseeked = () => {
      try {
        const canvas = drawScaled(video, video.videoWidth, video.videoHeight, THUMB_MAX);
        URL.revokeObjectURL(url);
        resolve(canvas);
      } catch { fail(); }
    };
    video.src = url;
  });
}

export async function makeThumbnail(file) {
  if (file.type.startsWith('video/') || /\.(mp4|mov)$/i.test(file.name)) return canvasToJpeg(await videoFrame(file));
  const { img, url } = await loadImage(file);
  try {
    return await canvasToJpeg(drawScaled(img, img.naturalWidth, img.naturalHeight, THUMB_MAX));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// PNG/WebP → JPEG at full size (the Instagram API only accepts JPEG images).
export async function convertToJpeg(file) {
  const { img, url } = await loadImage(file);
  try {
    const canvas = drawScaled(img, img.naturalWidth, img.naturalHeight, Math.max(img.naturalWidth, img.naturalHeight));
    const blob = await canvasToJpeg(canvas, 0.92);
    return new File([blob], file.name.replace(/\.(png|webp)$/i, '.jpg'), { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const isConvertible = file => /\.(png|webp)$/i.test(file.name) || ['image/png', 'image/webp'].includes(file.type);
export const ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime';

export function formatBytes(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
