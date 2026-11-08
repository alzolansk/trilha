'use client';
// Foto de um lugar: a gravada; senão busca na Wikimedia (/api/photos) e, quando achar, avisa para gravar.
// Só quem pode editar, em conta real e online, resolve: assim cada foto é buscada uma vez e fica salva
// para a turma toda (e para o offline). Sem foto, o <Photo> mostra o placeholder na cor da trilha.
import { useEffect, useState } from 'react';
import type { PhotoRef } from './types';
import { fetchPhoto } from '../lib/photos';
import { useAuth } from './AuthContext';

export function useResolvedPhoto(stored: PhotoRef | null | undefined, query: string | null | undefined, canResolve: boolean, onFound?: (p: PhotoRef) => void): PhotoRef | null {
  const { online } = useAuth();
  const [found, setFound] = useState<PhotoRef | null>(null);
  const has = !!stored?.url;
  useEffect(() => {
    setFound(null);
    if (has || !query || !canResolve || !online) return;
    let alive = true;
    void fetchPhoto(query).then((p) => {
      if (!alive || !p?.url) return;
      setFound(p);
      onFound?.(p);
    });
    return () => {
      alive = false;
    };
  }, [has, query, canResolve, online]); // eslint-disable-line react-hooks/exhaustive-deps
  return has ? stored! : found;
}
