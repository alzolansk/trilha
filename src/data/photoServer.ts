'use client';
// Ponte do navegador com as rotas de foto do servidor (ajuste de 14/11/2026).
import type { PhotoRef } from './types';
import type { ServerPhotoFn } from '../lib/photos';

/** null = ainda não sabemos; false = o servidor não tem chave do Unsplash (não pergunta mais nesta sessão). */
let configured: boolean | null = null;

export const serverPhoto: ServerPhotoFn = async (ask) => {
  if (configured === false) return undefined;
  const r = await fetch('/api/photos/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ask) });
  if (!r.ok) return undefined;
  const j = (await r.json()) as { configured?: boolean; unavailable?: boolean; photo?: PhotoRef | null };
  if (j.configured === false) {
    configured = false;
    return undefined;
  }
  configured = true;
  if (j.unavailable || j.photo === undefined) return undefined;
  return j.photo?.url ? j.photo : null;
};

const tracked = new Set<string>();
/** Avisa o Unsplash que a foto foi escolhida para uso (diretriz da API). Uma vez por foto por sessão; falha não importa. */
export function trackPhotoUse(p: PhotoRef | null | undefined) {
  const id = p?.provider === 'unsplash' ? p.provider_id : null;
  if (!id || tracked.has(id)) return;
  tracked.add(id);
  void fetch('/api/photos/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => undefined);
}

/** Opções para "Trocar foto". `configured: false` = sem Unsplash no servidor (a tela oferece a Wikipedia). */
export async function photoOptions(name: string, context?: string | null): Promise<{ configured: boolean; photos: PhotoRef[]; error?: string }> {
  try {
    const r = await fetch(`/api/photos/options?${new URLSearchParams({ name, ...(context ? { context } : {}) })}`);
    const j = (await r.json()) as { configured?: boolean; photos?: PhotoRef[]; error?: string };
    return { configured: j.configured !== false, photos: j.photos ?? [], error: r.ok ? undefined : j.error ?? 'Fotos indisponíveis agora.' };
  } catch {
    return { configured: true, photos: [], error: 'Sem conexão para buscar fotos.' };
  }
}
