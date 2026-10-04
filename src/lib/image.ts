'use client';
// Compressão de imagens no navegador para capa e diário. Documentos NUNCA passam por aqui:
// o arquivo original é guardado como enviado.

export interface Compressed {
  blob: Blob;
  width: number;
  height: number;
  type: string;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* cai para <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function heicToJpeg(file: Blob): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.86 });
  return Array.isArray(out) ? out[0] : out;
}

export const isHeic = (f: { type: string; name?: string }) => /image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name ?? '');

/** Reduz para no máximo `maxSide` px no lado maior; WebP quando suportado, senão JPEG. */
export async function compressImage(file: Blob & { name?: string }, maxSide = 2400, quality = 0.82): Promise<Compressed> {
  const src = isHeic({ type: file.type, name: file.name }) ? await heicToJpeg(file) : file;
  const img = await decode(src);
  const w0 = 'naturalWidth' in img ? img.naturalWidth : img.width;
  const h0 = 'naturalHeight' in img ? img.naturalHeight : img.height;
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem neste navegador.');
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  let blob = await toBlob('image/webp');
  let type = 'image/webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob('image/jpeg');
    type = 'image/jpeg';
  }
  if (!blob) throw new Error('Falha ao comprimir a imagem.');
  return { blob, width: w, height: h, type };
}
