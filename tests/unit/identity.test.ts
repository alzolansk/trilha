import { describe, expect, it } from 'vitest';
import { contrast, fgOn, isDark } from '@/lib/identity/contrast';
import { DICTIONARY, matchDictionary } from '@/lib/identity/dictionary';
import { ACCENT_CHOICES, DEFAULT_ACCENT, DICTIONARY_ACCENT, safeAccent, tripAccent } from '@/lib/identity/accent';

describe('dicionário bate com o SPEC §4.3', () => {
  const expected = {
    andes: { bg: '#F3E6D3', ink: '#2A1712', acc: '#C8452C', acc2: '#E8A33D', acc3: '#B5246B', deep: '#17403C', routeLine: '#E8A33D', font: 'Bricolage Grotesque', w: 800, slit: 'diamond', split: 'v' },
    japao: { bg: '#F5F0E6', ink: '#161616', acc: '#D7262E', acc2: '#F2B8C6', acc3: '#1E3A5F', deep: '#1E3A5F', routeLine: '#F2B8C6', font: 'Shippori Mincho B1', w: 800, slit: 'lens', split: 'v' },
    marrocos: { bg: '#F6E9DA', ink: '#2B1B17', acc: '#2A4BD7', acc2: '#E9A23B', acc3: '#B4532A', deep: '#2A4BD7', routeLine: '#E9A23B', font: 'Gloock', w: 400, slit: 'arch', split: 'v' },
    islandia: { bg: '#0D1B21', ink: '#E8F1EE', acc: '#53F0A6', acc2: '#7FC8F8', acc3: '#9B7BFF', deep: '#132A31', routeLine: '#53F0A6', font: 'Big Shoulders Display', w: 800, slit: 'band', split: 'h' },
  } as const;
  for (const [k, e] of Object.entries(expected)) {
    it(k, () => {
      const id = DICTIONARY[k];
      expect(id.palette).toMatchObject({ bg: e.bg, ink: e.ink, acc: e.acc, acc2: e.acc2, acc3: e.acc3, deep: e.deep, routeLine: e.routeLine });
      expect(id.display).toMatchObject({ family: e.font, weight: e.w });
      expect(id.slit).toBe(e.slit);
      expect(id.split).toBe(e.split);
    });
  }
  it('contrastes medidos da tabela (±0.1)', () => {
    expect(contrast(DICTIONARY.andes.palette.ink, DICTIONARY.andes.palette.bg)).toBeCloseTo(13.9, 0);
    expect(contrast(DICTIONARY.marrocos.palette.routeLine, DICTIONARY.marrocos.palette.deep)).toBeGreaterThanOrEqual(3);
    expect(contrast(fgOn(DICTIONARY.islandia.palette.acc), DICTIONARY.islandia.palette.acc)).toBeCloseTo(12.6, 0);
  });
  it('Islândia é tema escuro e usa motif sólido hexagonal', () => {
    expect(isDark(DICTIONARY.islandia.palette.bg)).toBe(true);
    expect(DICTIONARY.islandia.motifSolid).toContain('93.3% 25%');
  });
  it('reconhece destinos', () => {
    expect(matchDictionary('Machu Picchu')).toBe('andes');
    expect(matchDictionary('Quioto e Osaka')).toBe('japao');
    expect(matchDictionary('Marrakech')).toBe('marrocos');
    expect(matchDictionary('Reykjavík')).toBe('islandia');
    expect(matchDictionary('Lisboa')).toBeNull();
  });
});


describe('accent (Trilha 2.0)', () => {
  it('as 8 cores aprovadas passam 4.5:1 com texto branco', () => {
    expect(ACCENT_CHOICES).toHaveLength(8);
    for (const c of ACCENT_CHOICES) expect(contrast(c.hex, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
  it('cores do dicionário passam 3:1 com branco (placeholder e pino)', () => {
    for (const hex of Object.values(DICTIONARY_ACCENT)) expect(contrast(hex, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });
  it('tripAccent: coluna accent > identidade antiga > dicionário pelo destino > padrão', () => {
    expect(tripAccent({ accent: '#6A3FD1', identity: DICTIONARY.andes })).toBe('#6A3FD1');
    expect(tripAccent({ identity: DICTIONARY.andes })).toBe(DICTIONARY_ACCENT.andes);
    expect(tripAccent({ destinations: ['Kyoto'] })).toBe(DICTIONARY_ACCENT.japao);
    expect(tripAccent({ destinations: ['Paraty'] })).toBe(DEFAULT_ACCENT);
    expect(tripAccent(null)).toBe(DEFAULT_ACCENT);
  });
  it('safeAccent escurece cor clara demais e recusa hex inválido', () => {
    const fixed = safeAccent('#FFE066');
    expect(contrast(fixed, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(safeAccent('vermelho')).toBe(DEFAULT_ACCENT);
  });
});
