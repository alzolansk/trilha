'use client';
// Extração de texto no navegador (o arquivo não sai do aparelho para isso):
// PDF → pdf.js (texto embutido; se vazio, OCR da 1ª página). Imagens → OCR (tesseract.js).
// HEIC é convertido para JPEG só para OCR/prévia; o original é guardado sem alteração.
import { heicToJpeg, isHeic } from './image';

export const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'];
export const MAX_BYTES = 25 * 1024 * 1024;

export function normalizedMime(f: File): string | null {
  if (ACCEPTED.includes(f.type)) return f.type;
  const ext = f.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return null;
}

export function validateFile(f: File): string | null {
  const mime = normalizedMime(f);
  if (!mime) return `${f.name}: formato não aceito. Use PDF, JPG, PNG ou HEIC.`;
  if (f.size > MAX_BYTES) return `${f.name}: passa de 25 MB.`;
  if (f.size === 0) return `${f.name}: arquivo vazio.`;
  return null;
}

async function ocr(image: Blob | HTMLCanvasElement, onProgress?: (p: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['por', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image as never);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

async function pdfText(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = '';
  const pages = Math.min(doc.numPages, 3);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  if (text.replace(/\s/g, '').length > 30) return text;
  // PDF escaneado: renderiza a 1ª página e faz OCR
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp } as never).promise;
  return ocr(canvas, onProgress);
}

export interface Extracted {
  text: string;
  /** JPEG gerado a partir de HEIC para prévia (o original fica intacto) */
  preview: Blob | null;
  error: string | null;
}

export async function extract(file: File, onProgress?: (p: number) => void): Promise<Extracted> {
  const mime = normalizedMime(file);
  try {
    if (mime === 'application/pdf') return { text: await pdfText(file, onProgress), preview: null, error: null };
    if (isHeic({ type: mime ?? '', name: file.name })) {
      let preview: Blob | null = null;
      try {
        preview = await heicToJpeg(file);
      } catch {
        return { text: '', preview: null, error: 'Não deu pra converter o HEIC neste navegador. O original será guardado; a prévia fica indisponível.' };
      }
      return { text: await ocr(preview, onProgress), preview, error: null };
    }
    return { text: await ocr(file, onProgress), preview: null, error: null };
  } catch {
    return { text: '', preview: null, error: 'Não deu pra ler o texto do arquivo. Preencha os dados à mão.' };
  }
}
