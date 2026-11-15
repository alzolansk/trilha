import { describe, expect, it, vi } from 'vitest';
import { buildDemoBundle } from '@/lib/demo/build';
import { buildTripExport, prepareTripExport, tripExportFilename } from '@/lib/tripExport';
import { readAllPages } from '@/data/supabaseSource';
import { createDemoSource } from '@/data/demoSource';

describe('contexto completo da viagem', () => {
  it('preserva todas as seções e o planejamento sem exportar chaves do cofre', () => {
    const b = structuredClone(buildDemoBundle('andes'));
    b.trip.onboarding = { status: 'em_andamento', step: 3, wishes: ['Ver a neve'], prefs: { vibes: ['natureza'], pace: 'leve', stay: 'economico', story: 'Queremos viajar sem pressa.' } };
    b.documentKeys = [{ document_id: 'd1', user_id: 'u1', wrapped_key: 'SEGREDO' }];
    b.publicKeys = [{ user_id: 'u1', public_key: { kty: 'RSA' } }];
    const before = structuredClone(b);
    const context = buildTripExport(b, 'supabase', '2026-11-15T12:00:00.000Z');
    const parsed = JSON.parse(JSON.stringify(context));
    for (const [key, value] of Object.entries(b)) {
      if (key !== 'documentKeys' && key !== 'publicKeys') expect(parsed.data[key]).toEqual(value);
    }
    expect(parsed.data.trip.onboarding.prefs.story).toBe('Queremos viajar sem pressa.');
    expect(parsed.data).not.toHaveProperty('documentKeys');
    expect(parsed.data).not.toHaveProperty('publicKeys');
    expect(JSON.stringify(context)).not.toContain('SEGREDO');
    expect(b).toEqual(before);
  });

  it('busca a versão atual completa antes de gerar um JSON válido', async () => {
    const source = createDemoSource('andes');
    const load = vi.spyOn(source, 'load');
    const file = await prepareTripExport(source);
    expect(load).toHaveBeenCalledWith({ allRows: true });
    const parsed = JSON.parse(file.content);
    expect(parsed.source).toBe('demo');
    expect(parsed.data.trip.id).toBe(source.tripId);
    expect(file.filename).toMatch(/^trilha-.+\.json$/);
  });

  it('falha sem gerar arquivo quando a consulta falha, sem recorrer a dados antigos', async () => {
    const source = createDemoSource('andes');
    vi.spyOn(source, 'load').mockRejectedValue(new Error('Sem acesso'));
    await expect(prepareTripExport(source)).rejects.toThrow('Sem acesso');
  });

  it('gera nomes portáveis mesmo com acentos, barras e títulos vazios', () => {
    expect(tripExportFilename('Férias / Japão: 2027', '2026-11-15T12:30:00.000Z'))
      .toBe('trilha-ferias-japao-2027-2026-11-15T12-30-00-000Z.json');
    expect(tripExportFilename('🌍', '2026-11-15')).toBe('trilha-viagem-2026-11-15.json');
  });
});

describe('paginação da exportação', () => {
  it('exporta mais de mil registros mesmo se o servidor limitar cada página abaixo do solicitado', async () => {
    const original = Array.from({ length: 1207 }, (_, id) => ({ id }));
    const query = vi.fn(async (from: number, to: number) => ({ data: original.slice(from, Math.min(to + 1, from + 100)), error: null }));
    const result = await readAllPages(query);
    expect(result.data).toEqual(original);
    expect(query).toHaveBeenLastCalledWith(1207, 1706);
  });

  it('não retorna uma exportação parcial se uma página falhar', async () => {
    const error = { code: '42501', message: 'permission denied' };
    const result = await readAllPages(async (from) => from === 0 ? { data: [{ id: 1 }], error: null } : { data: null, error });
    expect(result).toEqual({ data: null, error });
  });
});
