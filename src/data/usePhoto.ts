'use client';
// Foto de um lugar: a gravada; senão busca na Wikipedia direto do navegador e, quando achar, avisa para gravar.
// `query` pode ser uma lista: tenta cada busca na ordem (ex.: nome do lugar, depois o termo da IA).
// Só quem pode editar, em conta real e online, resolve: assim cada foto é buscada uma vez e fica salva
// para a turma toda (e para o offline). Sem foto, o <Photo> mostra o placeholder na cor da trilha.
// Uma foto já mostrada para um lugar não aparece em outro (claimPhoto): nada de vários destinos com a mesma foto.
import { useEffect, useState } from 'react';
import type { PhotoRef } from './types';
import { claimPhoto, fetchPhoto, fetchPlacePhoto, type PlacePhotoQuery } from '../lib/photos';
import { useAuth } from './AuthContext';

export function useResolvedPhoto(stored: PhotoRef | null | undefined, query: string | string[] | null | undefined, canResolve: boolean, onFound?: (p: PhotoRef) => void): PhotoRef | null {
  const { online } = useAuth();
  // Chave estável: uma lista nova a cada render não pode disparar outra busca.
  const key = Array.isArray(query) ? query.filter(Boolean).join('|') : query ?? '';
  const [found, setFound] = useState<PhotoRef | null>(null);
  const has = !!stored?.url;
  useEffect(() => {
    setFound(null);
    if (has || !key || !canResolve || !online) return;
    let alive = true;
    void fetchPhoto(key.split('|')).then((p) => {
      if (!alive || !p?.url) return;
      if (!claimPhoto(p.url, key.split('|')[0].toLowerCase())) return;
      setFound(p);
      onFound?.(p);
    });
    return () => {
      alive = false;
    };
  }, [has, key, canResolve, online]); // eslint-disable-line react-hooks/exhaustive-deps
  return has ? stored! : found;
}

/**
 * Foto conferida de um lugar (nome exato + perto das coordenadas). `loading` permite reservar o espaço só
 * enquanto busca: sem foto, quem usa decide encolher (janela do lugar) ou mostrar o número (destaques).
 */
export function usePlacePhoto(q: PlacePhotoQuery | null, enabled = true): { photo: PhotoRef | null; loading: boolean } {
  const { online } = useAuth();
  const key = q ? JSON.stringify([q.name, q.context ?? '', q.lat ?? null, q.lng ?? null, q.radiusKm ?? null]) : '';
  const [state, setState] = useState<{ key: string; photo: PhotoRef | null; done: boolean }>({ key: '', photo: null, done: false });
  useEffect(() => {
    if (!key || !enabled || !online) return;
    let alive = true;
    const ask = JSON.parse(key) as [string, string, number | null, number | null, number | null];
    const query: PlacePhotoQuery = { name: ask[0], context: ask[1] || null, lat: ask[2], lng: ask[3], radiusKm: ask[4] ?? undefined };
    void fetchPlacePhoto(query).then((p) => {
      if (!alive) return;
      const owner = `${ask[0]}|${ask[1]}`.toLowerCase();
      setState({ key, photo: p?.url && claimPhoto(p.url, owner) ? p : null, done: true });
    });
    return () => {
      alive = false;
    };
  }, [key, enabled, online]);
  const mine = state.key === key;
  return { photo: mine ? state.photo : null, loading: !!key && enabled && online && !(mine && state.done) };
}

/** Raio da conferência por tipo de lugar (km). */
export const PHOTO_RADIUS: Record<string, number> = { cidade: 40, regiao: 120, bairro: 6, atracao: 3, experiencia: 60 };
