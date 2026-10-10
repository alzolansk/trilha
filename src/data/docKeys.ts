'use client';
// Libera a chave de cada documento cifrado para quem tem direito de lê-lo e ainda não recebeu.
// Roda no aparelho de quem já tem a chave (o servidor nunca a vê): quem entra na turma, cria o
// cofre depois ou passa a ter o documento compartilhado recebe na próxima vez que alguém com
// acesso abrir a viagem com o cofre desbloqueado.
import { wrapDocumentKey } from '../lib/crypto/e2e';
import type { TripSource } from './source';
import type { DocumentRow, TripBundle } from './types';

/** Quem deve conseguir abrir o documento (espelha document_visible_to no banco). */
export function documentReaders(b: TripBundle, d: Pick<DocumentRow, 'id' | 'owner_id' | 'visibility'>): Set<string> {
  const members = new Set(b.members.map((m) => m.user_id));
  const out = new Set([d.owner_id]);
  if (d.visibility === 'trip') members.forEach((u) => out.add(u));
  if (d.visibility === 'shared') for (const s of b.documentShares) if (s.document_id === d.id && members.has(s.user_id)) out.add(s.user_id);
  return out;
}

/** Embrulha a chave para cada pessoa da lista que já tem cofre. */
export async function grantKey(source: TripSource, b: TripBundle, docId: string, key: CryptoKey, userIds: Iterable<string>) {
  let n = 0;
  for (const uid of userIds) {
    const pub = (b.publicKeys ?? []).find((p) => p.user_id === uid);
    if (!pub) continue;
    await source.insert('document_keys', { document_id: docId, user_id: uid, wrapped_key: await wrapDocumentKey(key, pub.public_key, docId, uid) }, { returning: false });
    n++;
  }
  return n;
}

let running = false;

/** Retorna quantas chaves foram liberadas (para recarregar se > 0). */
export async function grantMissingKeys(source: TripSource, b: TripBundle, me: string, docKey: (b: TripBundle, d: DocumentRow) => Promise<CryptoKey>): Promise<number> {
  if (source.kind !== 'supabase' || running || (typeof navigator !== 'undefined' && !navigator.onLine)) return 0;
  running = true;
  let n = 0;
  try {
    const has = new Set((b.documentKeys ?? []).map((k) => `${k.document_id}:${k.user_id}`));
    const withKey = new Set((b.publicKeys ?? []).map((p) => p.user_id));
    for (const d of b.documents) {
      if (!d.encrypted || !has.has(`${d.id}:${me}`) || (d.status !== 'ready' && d.owner_id !== me)) continue;
      const missing = [...documentReaders(b, d)].filter((u) => withKey.has(u) && !has.has(`${d.id}:${u}`));
      if (!missing.length) continue;
      let key: CryptoKey;
      try {
        key = await docKey(b, d);
      } catch {
        continue;
      }
      for (const u of missing) {
        try {
          n += await grantKey(source, b, d.id, key, [u]);
        } catch {
          /* outra pessoa liberou antes, ou o acesso mudou: tenta de novo na próxima carga */
        }
      }
    }
  } finally {
    running = false;
  }
  return n;
}
