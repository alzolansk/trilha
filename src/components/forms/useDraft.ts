'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Estado de formulário com rascunho local (sobrevive a recarregar/ficar offline).
 * Removido ao salvar com `clear()` e apagado no logout (prefixo trilha.draft.).
 */
export function useDraft<T extends object>(key: string | null, initial: T) {
  const storageKey = key ? `trilha.draft.${key}` : null;
  const [value, setValue] = useState<T>(() => {
    if (!storageKey || typeof window === 'undefined') return initial;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...initial, ...(JSON.parse(raw) as T) } : initial;
    } catch {
      return initial;
    }
  });
  const [restored] = useState(() => {
    if (!storageKey || typeof window === 'undefined') return false;
    try {
      return !!localStorage.getItem(storageKey);
    } catch {
      return false;
    }
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* sem espaço: segue só em memória */
    }
  }, [value, storageKey]);
  const set = <K extends keyof T>(k: K, v: T[K]) => setValue((p) => ({ ...p, [k]: v }));
  const clear = () => {
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignora */
      }
    }
  };
  return { value, set, setValue, clear, restored };
}
