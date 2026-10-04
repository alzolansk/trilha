'use client';
import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* sem SW: o app funciona, só sem o shell offline */
    });
  }, []);
  return null;
}

/** Pede ao SW para guardar as telas de uma trilha (abrem sem internet depois). */
export function warmTripPages(base: string) {
  if (!('serviceWorker' in navigator)) return;
  const urls = ['', '/roteiro', '/documentos', '/mala', '/diario', '/turma'].map((p) => base + p);
  navigator.serviceWorker.ready.then((r) => r.active?.postMessage({ type: 'warm', urls })).catch(() => undefined);
}
