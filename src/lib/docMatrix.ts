import type { DocCategory, TripBundle } from '../data/types';

/** Documentos esperados por viagem (planning §5.7). Vacina só entraria com regra de fonte oficial (SPEC §9.1): fica de fora. */
export const DOC_COLUMNS: { cat: DocCategory; label: string }[] = [
  { cat: 'identidade', label: 'Passaporte / RG' },
  { cat: 'passagem', label: 'Passagens' },
  { cat: 'seguro', label: 'Seguro' },
];

/**
 * Quem tem cada documento. Os documentos que a RLS mostra contam direto; os privados de outras pessoas
 * vêm de `documentPresence` (só dono e categoria, sem revelar o documento). Sem a migration 00013,
 * o privado alheio continua contando como "—".
 */
export function docMatrix(b: Pick<TripBundle, 'documents' | 'members' | 'documentPresence'>): { cat: DocCategory; label: string; has: Map<string, boolean>; missing: number }[] {
  return DOC_COLUMNS.map((c) => {
    const has = new Map<string, boolean>();
    for (const m of b.members) {
      const seen = b.documents.some((d) => d.owner_id === m.user_id && d.category === c.cat && d.status === 'ready');
      has.set(m.user_id, seen || !!b.documentPresence?.some((p) => p.owner_id === m.user_id && p.category === c.cat));
    }
    return { ...c, has, missing: b.members.filter((m) => !has.get(m.user_id)).length };
  });
}
