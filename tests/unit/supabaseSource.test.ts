import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseSource, isMissingTable } from '@/data/supabaseSource';

// Cliente falso: cada tabela responde com linhas ou com o erro configurado.
function fakeClient(errors: Record<string, { code: string; message: string }>, records: Record<string, Record<string, unknown>[]> = {}) {
  const result = (table: string, from = 0, to = 999) => (errors[table] ? { data: null, error: errors[table] } : { data: table === 'trips' ? { id: 't1' } : (records[table] ?? []).slice(from, to + 1), error: null });
  const query = (table: string) => {
    let from = 0, to = 999;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'in']) q[m] = () => q;
    q.range = (start: number, end: number) => { from = start; to = end; return q; };
    q.maybeSingle = async () => result(table);
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result(table, from, to)).then(ok, bad);
    return q;
  };
  return { from: query } as unknown as SupabaseClient;
}
const missing = (t: string) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` });

describe('carga com migration pendente', () => {
  it('carga para exportação pagina tabelas da viagem e relações dos documentos', async () => {
    const records = {
      tasks: Array.from({ length: 1207 }, (_, i) => ({ id: `task-${i}` })),
      documents: [{ id: 'doc-1' }],
      document_shares: Array.from({ length: 1050 }, (_, i) => ({ document_id: 'doc-1', user_id: `u${i}` })),
    };
    const source = createSupabaseSource(fakeClient({}, records), 't1', 'u1');
    expect((await source.load()).tasks).toHaveLength(1000);
    const exported = await source.load({ allRows: true });
    expect(exported.tasks).toEqual(records.tasks);
    expect(exported.documentShares).toEqual(records.document_shares);
  });

  it('tabelas da votação ausentes viram lista vazia e a viagem carrega', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sb = fakeClient({ inspiration_votes: missing('inspiration_votes'), polls: missing('polls'), poll_options: missing('poll_options'), poll_votes: missing('poll_votes') });
    const b = await createSupabaseSource(sb, 't1', 'u1').load();
    expect(b.trip.id).toBe('t1');
    expect([b.inspirationVotes, b.polls, b.pollOptions, b.pollVotes]).toEqual([[], [], [], []]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('tabela essencial ausente ou outro erro continua falhando (vai para a cópia offline)', async () => {
    await expect(createSupabaseSource(fakeClient({ stops: missing('stops') }), 't1', 'u1').load()).rejects.toMatchObject({ code: 'PGRST205' });
    await expect(createSupabaseSource(fakeClient({ polls: { code: '42501', message: 'permission denied' } }), 't1', 'u1').load()).rejects.toMatchObject({ code: '42501' });
  });

  it('isMissingTable reconhece só tabela inexistente', () => {
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTable({ code: '42P01' })).toBe(true);
    expect(isMissingTable({ code: '42501' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});
