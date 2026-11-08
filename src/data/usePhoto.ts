'use client';
// Foto de um lugar: a gravada; senão busca na Wikipedia direto do navegador e, quando achar, avisa para gravar.
// `query` pode ser uma lista: tenta cada busca na ordem (ex.: nome do lugar, depois o termo da IA).
// Só quem pode editar, em conta real e online, resolve: assim cada foto é buscada uma vez e fica salva
// para a turma toda (e para o offline). Sem foto, o <Photo> mostra o placeholder na cor da trilha.
import { useEffect, useState } from 'react';
import type { PhotoRef } from './types';
import { fetchPhoto } from '../lib/photos';
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
      setFound(p);
      onFound?.(p);
    });
    return () => {
      alive = false;
    };
  }, [has, key, canResolve, online]); // eslint-disable-line react-hooks/exhaustive-deps
  return has ? stored! : found;
}
