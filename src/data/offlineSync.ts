'use client';
// Mantém no aparelho as cópias dos documentos marcados como "manter offline".
// Separação explícita: preferência (banco, por pessoa) ≠ estado real (IndexedDB deste aparelho).
import { useSyncExternalStore } from 'react';
import { deleteFile, listFiles, QuotaError, requestPersistence, saveFile } from './offline';
import type { TripSource } from './source';
import type { DocumentRow, TripBundle } from './types';

export type LocalState = 'saved' | 'downloading' | 'failed' | 'none' | 'outdated';
interface Entry {
  state: LocalState;
  error?: string;
}

let map: Record<string, Entry> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(id: string, e: Entry) {
  map = { ...map, [id]: e };
  emit();
}

export function useLocalDocs() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => map,
    () => map,
  );
}

/** Passagens e identidade: offline por padrão (SPEC); o resto só se a pessoa pedir. */
export function wantsOffline(b: TripBundle, d: DocumentRow): boolean {
  const pref = b.offlinePrefs.find((p) => p.document_id === d.id);
  if (pref) return pref.keep_offline;
  return d.category === 'passagem' || d.category === 'identidade';
}

let running: Promise<void> | null = null;

export async function refreshLocalState(source: TripSource, b: TripBundle) {
  if (source.kind !== 'supabase') return;
  const local = await listFiles(source.userId, b.trip.id);
  const next: Record<string, Entry> = { ...map };
  for (const d of b.documents) {
    const f = local.find((x) => x.docId === d.id);
    if (next[d.id]?.state === 'downloading') continue;
    next[d.id] = f ? { state: f.docUpdatedAt === d.storage_path ? 'saved' : 'outdated' } : next[d.id]?.state === 'failed' ? next[d.id] : { state: 'none' };
  }
  map = next;
  emit();
}

export async function downloadOne(source: TripSource, d: DocumentRow) {
  set(d.id, { state: 'downloading' });
  try {
    const blob = await source.download('documents', d.storage_path);
    await saveFile(source.userId, { docId: d.id, tripId: d.trip_id, blob, mime: d.mime, name: d.original_name, size: blob.size, savedAt: new Date().toISOString(), docUpdatedAt: d.storage_path });
    if (d.preview_path) {
      try {
        const pv = await source.download('documents', d.preview_path);
        await saveFile(source.userId, { docId: `${d.id}:preview`, tripId: d.trip_id, blob: pv, mime: 'image/jpeg', name: 'preview.jpg', size: pv.size, savedAt: new Date().toISOString(), docUpdatedAt: d.preview_path });
      } catch {
        /* prévia é opcional */
      }
    }
    set(d.id, { state: 'saved' });
  } catch (e) {
    set(d.id, { state: 'failed', error: e instanceof QuotaError ? e.message : 'Falha ao baixar. Tenta de novo com internet.' });
  }
}

export async function removeLocal(source: TripSource, docId: string) {
  await deleteFile(source.userId, docId);
  await deleteFile(source.userId, `${docId}:preview`).catch(() => undefined);
  set(docId, { state: 'none' });
}

/** Baixa o que falta e remove cópias de documentos que sumiram ou perderam acesso. */
export function syncOffline(source: TripSource, b: TripBundle) {
  if (source.kind !== 'supabase' || typeof navigator === 'undefined') return;
  if (running) return;
  running = (async () => {
    try {
      const local = await listFiles(source.userId, b.trip.id);
      const ids = new Set(b.documents.map((d) => d.id));
      for (const f of local) {
        const base = f.docId.replace(/:preview$/, '');
        if (!ids.has(base) && !f.docId.startsWith('cover-')) await deleteFile(source.userId, f.docId); // acesso revogado ou excluído
      }
      await refreshLocalState(source, b);
      if (!navigator.onLine) return;
      const todo = b.documents.filter((d) => d.status === 'ready' && wantsOffline(b, d) && map[d.id]?.state !== 'saved' && map[d.id]?.state !== 'failed');
      if (todo.length) await requestPersistence();
      for (const d of todo) await downloadOne(source, d);
    } finally {
      running = null;
    }
  })();
}

export function resetLocalState() {
  map = {};
  emit();
}
