'use client';
import { useEffect, useState } from 'react';
import { getFile, saveFile } from './offline';
import { useBundle } from './TripContext';

/** Capa enviada pela turma (bucket covers): cópia local (offline) ou download; null = sem capa. */
export function useCover(): string | null {
  const { bundle, source } = useBundle();
  const [url, setUrl] = useState<string | null>(null);
  const path = bundle.trip.cover_path;
  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    (async () => {
      if (!path) return setUrl(null);
      const key = `cover-${bundle.trip.id}`;
      const local = source.kind === 'supabase' ? await getFile(source.userId, key) : null;
      if (local && local.docUpdatedAt === path) {
        obj = URL.createObjectURL(local.blob);
        if (alive) setUrl(obj);
        return;
      }
      try {
        const blob = await source.download('covers', path);
        if (source.kind === 'supabase') {
          await saveFile(source.userId, { docId: key, tripId: bundle.trip.id, blob, mime: blob.type, name: 'capa', size: blob.size, savedAt: new Date().toISOString(), docUpdatedAt: path }).catch(() => undefined);
        }
        obj = URL.createObjectURL(blob);
        if (alive) setUrl(obj);
      } catch {
        if (alive) setUrl(null);
      }
    })();
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [path, bundle.trip.id, source]);
  return url;
}
