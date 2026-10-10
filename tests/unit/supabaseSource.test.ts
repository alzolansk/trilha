import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseSource, isMissingTable } from '@/data/supabaseSource';

// Cliente falso: cada tabela responde com linhas ou com o erro configurado.
function fakeClient(errors: Record<string, { code: string; message: string }>) {
  const result = (table: string) => (errors[table] ? { data: null, error: errors[table] } : { data: table === 'trips' ? { id: 't1' } : [], error: null });
  const query = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'in']) q[m] = () => q;
    q.maybeSingle = async () => result(table);
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result(table)).then(ok, bad);
    return q;
  };
  return { from: query } as unknown as SupabaseClient;
}
const missing = (t: string) => ({ code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` });

describe('carga com migration pendente', () => {
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
