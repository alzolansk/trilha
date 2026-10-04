import { describe, expect, it } from 'vitest';
import { contrast, fgOn, isDark } from '@/lib/identity/contrast';
import { DICTIONARY, matchDictionary } from '@/lib/identity/dictionary';
import { generateRulesIdentity } from '@/lib/identity/generate';
import { patternDefs, landscapeInner } from '@/lib/identity/render';
import { clipFor, motifArea, pathFractions, routePoints, smoothPath } from '@/lib/identity/shapes';
import { themeVars } from '@/lib/identity/theme';
import { checkContrasts, validateIdentity } from '@/lib/identity/validate';

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
      expect(checkContrasts(id.palette)).toEqual([]);
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
    expect(motifArea(DICTIONARY.islandia.motif)!).toBeLessThan(0.55);
    expect(themeVars(DICTIONARY.islandia)['--card']).toBe('#152A31');
  });
  it('reconhece destinos', () => {
    expect(matchDictionary('Machu Picchu')).toBe('andes');
    expect(matchDictionary('Quioto e Osaka')).toBe('japao');
    expect(matchDictionary('Marrakech')).toBe('marrocos');
    expect(matchDictionary('Reykjavík')).toBe('islandia');
    expect(matchDictionary('Lisboa')).toBeNull();
  });
});

describe('fendas (SPEC §6.3)', () => {
  it('diamond fechado e aberto', () => {
    expect(clipFor('diamond', 0, 1000)).toBe('polygon(50% 26%, 51.4% 50%, 50% 74%, 48.6% 50%)');
    expect(clipFor('diamond', 1, 1000)).toBe('polygon(50% -56%, 155.4% 50%, 50% 156%, -55.4% 50%)');
  });
  it('lens, arch, band', () => {
    expect(clipFor('lens', 0, 1000)).toBe('ellipse(0.7% 24% at 50% 50%)');
    expect(clipFor('arch', 1, 1000)).toBe('inset(0% 0% 0% 0% round 0px 0px 0 0)');
    expect(clipFor('arch', 0, 1000)).toBe('inset(14% 48.6% 14% 48.6% round 14px 14px 0 0)');
    expect(clipFor('band', 0, 1000)).toBe('inset(49.4% 6% 49.4% 6%)');
  });
});

describe('rota', () => {
  it('frações do protótipo Andes são reproduzidas pelo comprimento do caminho', () => {
    const pts: [number, number][] = [[70, 420], [210, 250], [340, 380], [480, 170], [620, 300], [740, 90]];
    const fr = pathFractions(pts);
    expect(fr[0]).toBe(0);
    expect(fr[fr.length - 1]).toBe(1);
    // crescentes e não uniformes (não é divisão por índice)
    for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThan(fr[i - 1]);
    expect(Math.abs(fr[1] - 0.2)).toBeLessThan(0.06);
    expect(smoothPath(pts).startsWith('M70 420 C')).toBe(true);
  });
  it('usa coordenadas reais quando todas as paradas têm', () => {
    const r = routePoints([{ lat: -12.05, lng: -77.04 }, { lat: -13.53, lng: -71.97 }, { lat: -16.5, lng: -68.15 }]);
    expect(r.geographic).toBe(true);
    expect(r.pts[0][0]).toBeLessThan(r.pts[2][0]); // oeste → leste
    expect(routePoints([{ lat: null, lng: null }, { lat: 1, lng: 1 }]).geographic).toBe(false);
  });
});

describe('validação e gerador local', () => {
  it('gera identidade válida e estável fora do dicionário', () => {
    const a = generateRulesIdentity({ destination: 'Lisboa, Portugal', departDate: '2027-05-10', style: 'Cultural' });
    const b = generateRulesIdentity({ destination: 'Lisboa, Portugal', departDate: '2027-05-10', style: 'Cultural' });
    expect(a).toEqual(b);
    expect(a.generatedBy).toBe('rules');
    expect(checkContrasts(a.palette)).toEqual([]);
    const c = generateRulesIdentity({ destination: 'Lisboa, Portugal', departDate: '2027-05-10', style: 'Cultural', version: 2 });
    expect(c.palette.acc).not.toBe(a.palette.acc);
    expect(c.version).toBe(2);
    expect(patternDefs(a, 'x')).toContain('id="pat-x"');
    expect(landscapeInner(a, 'x')).toContain('data-par="1"');
  });
  it('destino polar vira tema escuro com contraste válido', () => {
    const t = generateRulesIdentity({ destination: 'Tromsø, Noruega', style: 'Aventura' });
    expect(isDark(t.palette.bg)).toBe(true);
    expect(checkContrasts(t.palette)).toEqual([]);
  });
  const base = {
    idName: 'Teste & Cor',
    palette: { bg: '#F5F0E6', ink: '#777777', mute: '#999999', acc: '#FFD84D', acc2: '#7FC8F8', acc3: '#9B7BFF', deep: '#1E3A5F', onDeep: '#F5F0E6', routeLine: '#F2B8C6' },
    display: { family: 'Syne', weight: 700 },
    motif: 'polygon(50% 0%, 58% 36.1%, 93.3% 25%, 66% 50%, 93.3% 75%, 58% 63.9%, 50% 100%, 42% 63.9%, 6.7% 75%, 34% 50%, 6.7% 25%, 42% 36.1%)',
    pattern: { w: 40, h: 40, shapes: [{ t: 'circle', cx: 20, cy: 20, r: 6, fill: 'acc' }] },
    slit: 'band',
    landscape: { sky: ['#FFFFFF', '#F5F0E6'], sun: null, layers: [{ style: 'hills', color: 'acc3', base: 600, amp: 100, seed: 3 }] },
    sources: ['a b', 'c d', 'e f', 'g h'],
  };
  it('corrige contraste, troca fonte proibida e gera motif sólido', () => {
    const r = validateIdentity(base, { key: 'gen_x', generatedBy: 'ai', version: 1 });
    expect(r.ok).toBe(true);
    const id = r.identity!;
    expect(checkContrasts(id.palette)).toEqual([]);
    expect(id.display.family).not.toBe('Syne');
    expect(id.motifSolid).not.toBe(id.motif);
    expect(id.split).toBe('h');
  });
  it('rejeita formas e motifs fora da regra', () => {
    expect(validateIdentity({ ...base, slit: 'star' }, { key: 'k', generatedBy: 'ai', version: 1 }).ok).toBe(false);
    expect(validateIdentity({ ...base, motif: 'url(evil)' }, { key: 'k', generatedBy: 'ai', version: 1 }).ok).toBe(false);
    const many = `polygon(${Array.from({ length: 25 }, (_, i) => `${i}% ${i}%`).join(', ')})`;
    expect(validateIdentity({ ...base, motif: many }, { key: 'k', generatedBy: 'ai', version: 1 }).ok).toBe(false);
    expect(validateIdentity({ ...base, pattern: { w: 40, h: 40, shapes: [{ t: 'script', src: 'x' }] } }, { key: 'k', generatedBy: 'ai', version: 1 }).ok).toBe(false);
  });
});
