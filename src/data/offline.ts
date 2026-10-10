'use client';
// Armazenamento local por usuário (IndexedDB): snapshot das viagens e cópias dos documentos.
// Cada conta tem seu próprio banco "trilha-u-<id>", apagado inteiro ao sair.
import { openDB, type IDBPDatabase } from 'idb';
import type { TripBundle, TripSummary } from './types';

export interface OfflineFile {
  docId: string;
  tripId: string;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  savedAt: string;
  /** updated_at do documento quando a cópia foi feita (detecta cópia desatualizada) */
  docUpdatedAt: string;
}

const PREFIX = 'trilha-u-';
const dbs = new Map<string, Promise<IDBPDatabase>>();

function open(userId: string) {
  let p = dbs.get(userId);
  if (!p) {
    p = openDB(PREFIX + userId, 1, {
      upgrade(db) {
        db.createObjectStore('bundles');
        const files = db.createObjectStore('files', { keyPath: 'docId' });
        files.createIndex('trip', 'tripId');
        db.createObjectStore('kv');
      },
    });
    dbs.set(userId, p);
  }
  return p;
}

export const offlineSupported = () => typeof indexedDB !== 'undefined';

export async function saveBundle(userId: string, bundle: TripBundle) {
  if (!offlineSupported()) return;
  try {
    await (await open(userId)).put('bundles', bundle, bundle.trip.id);
  } catch {
    /* sem espaço: o app continua online */
  }
}
export async function getBundle(userId: string, tripId: string): Promise<TripBundle | null> {
  if (!offlineSupported()) return null;
  try {
    const b = (await (await open(userId)).get('bundles', tripId)) as TripBundle | undefined;
    return b ? upgradeBundle(b) : null;
  } catch {
    return null;
  }
}

/** Cópias salvas antes de uma tabela nova existir não têm a lista: trata como vazia. */
function upgradeBundle(b: TripBundle): TripBundle {
  b.inspirationVotes ??= [];
  b.polls ??= [];
  b.pollOptions ??= [];
  b.pollVotes ??= [];
  return b;
}
export async function deleteBundle(userId: string, tripId: string) {
  if (!offlineSupported()) return;
  const db = await open(userId);
  await db.delete('bundles', tripId);
  const tx = db.transaction('files', 'readwrite');
  for (const key of await tx.store.index('trip').getAllKeys(tripId)) await tx.store.delete(key);
  await tx.done;
}

export async function saveTripList(userId: string, list: TripSummary[]) {
  if (!offlineSupported()) return;
  try {
    await (await open(userId)).put('kv', list, 'trips');
  } catch {
    /* ignora */
  }
}
export async function getTripList(userId: string): Promise<TripSummary[] | null> {
  if (!offlineSupported()) return null;
  try {
    return ((await (await open(userId)).get('kv', 'trips')) as TripSummary[] | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Chave privada desbloqueada neste aparelho (CryptoKey não exportável) e o cofre cifrado, para abrir offline. */
export interface DeviceVault {
  privateKey: CryptoKey | null;
  record: import('../lib/crypto/e2e').VaultRecord;
}
export async function saveDeviceVault(userId: string, v: DeviceVault) {
  if (!offlineSupported()) return;
  try {
    await (await open(userId)).put('kv', v, 'vault');
  } catch {
    /* sem IndexedDB: desbloqueio vale só nesta aba */
  }
}
export async function getDeviceVault(userId: string): Promise<DeviceVault | null> {
  if (!offlineSupported()) return null;
  try {
    return ((await (await open(userId)).get('kv', 'vault')) as DeviceVault | undefined) ?? null;
  } catch {
    return null;
  }
}
export async function deleteDeviceVault(userId: string) {
  if (!offlineSupported()) return;
  await (await open(userId)).delete('kv', 'vault').catch(() => undefined);
}

export class QuotaError extends Error {
  constructor() {
    super('Sem espaço no aparelho para guardar este arquivo offline. Libere espaço ou remova outras cópias.');
    this.name = 'QuotaError';
  }
}

export async function saveFile(userId: string, f: OfflineFile) {
  const est = await storageEstimate();
  if (est && est.quota - est.usage < f.size * 1.2) throw new QuotaError();
  try {
    await (await open(userId)).put('files', f);
  } catch (e) {
    if ((e as DOMException)?.name === 'QuotaExceededError') throw new QuotaError();
    throw e;
  }
}
export async function getFile(userId: string, docId: string): Promise<OfflineFile | null> {
  if (!offlineSupported()) return null;
  try {
    return ((await (await open(userId)).get('files', docId)) as OfflineFile | undefined) ?? null;
  } catch {
    return null;
  }
}
export async function deleteFile(userId: string, docId: string) {
  if (!offlineSupported()) return;
  await (await open(userId)).delete('files', docId);
}
/** Metadados das cópias locais de uma viagem (sem carregar os blobs na memória da UI). */
export async function listFiles(userId: string, tripId: string): Promise<Omit<OfflineFile, 'blob'>[]> {
  if (!offlineSupported()) return [];
  try {
    const all = (await (await open(userId)).getAllFromIndex('files', 'trip', tripId)) as OfflineFile[];
    return all.map(({ blob: _b, ...rest }) => rest);
  } catch {
    return [];
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}

/** Pede ao navegador para não apagar os dados sob pressão de espaço (pode ser negado). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Apaga todos os dados locais de todas as contas deste navegador (logout). */
export async function wipeAllLocalData() {
  for (const p of dbs.values()) {
    try {
      (await p).close();
    } catch {
      /* ignora */
    }
  }
  dbs.clear();
  if (typeof indexedDB === 'undefined') return;
  const list = (await indexedDB.databases?.()) ?? [];
  await Promise.all(
    list
      .filter((d) => d.name?.startsWith(PREFIX))
      .map(
        (d) =>
          new Promise<void>((res) => {
            const r = indexedDB.deleteDatabase(d.name!);
            r.onsuccess = r.onerror = r.onblocked = () => res();
          }),
      ),
  );
  try {
    localStorage.removeItem('trilha.last');
    Object.keys(localStorage)
      .filter((k) => k.startsWith('trilha.draft.'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignora */
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.controller?.postMessage({ type: 'logout' });
}
