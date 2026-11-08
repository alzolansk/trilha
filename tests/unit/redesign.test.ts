// Trilha 2.0 · Fase 3: Dinheiro ligado ao roteiro, Orçamento, sugestões e fotos.
import { describe, expect, it } from 'vitest';
import { buildDemoBundle, DEMO_USER } from '@/lib/demo/build';
import { budgetOverview, categoryKind, categoryStatus, expenseImpact, memberPoolStatus, toBaseCents } from '@/lib/money';
import { budgetFromPlan, diffSince, plannedUpdates, snapshotOf } from '@/lib/budgetPlan';
import { bestDayFor, fitsSlot, rankForHome, slotsForDay, stopsNeedingSuggestions, suggestionsForDay } from '@/lib/suggestions';
import { isUnfitImage, parseImageInfo, photoCredit, pickPageImage, stripHtml, thumbAt, titleMatches } from '@/lib/photos';
import type { TripBundle } from '@/data/types';

const NOW = Date.parse('2026-11-08T12:00:00-03:00');
const andes = () => structuredClone(buildDemoBundle('andes')) as TripBundle;

describe('money · visão geral e caixa', () => {
  it('demo Andes bate com o canvas: R$ 19.410 planejados (R$ 6.470/pessoa) e R$ 9.360 juntados', () => {
    const o = budgetOverview(andes());
    expect(o.plannedCents).toBe(1_941_000);
    expect(o.perPersonCents).toBe(647_000);
    expect(o.pooledCents).toBe(936_000);
    expect(o.pooledPct).toBe(48);
    // dois gastos saíram do caixa (voo e hostel)
    expect(o.poolBalanceCents).toBe(936_000 - 435_000 - 116_000);
  });

  it('status de cada pessoa no caixa: meta = planejado ÷ pessoas, ou a cota individual', () => {
    const b = andes();
    const st = memberPoolStatus(b, NOW);
    expect(st.map((m) => m.depositedCents)).toEqual([390_000, 324_000, 222_000]);
    expect(st.every((m) => m.targetCents === 647_000)).toBe(true);
    // 1º set → 15 jan: em 8 nov já passou ~51% do tempo; Léo (222k < ~331k) está atrasado
    expect(st[0].status).toBe('em_dia');
    expect(st[2].status).toBe('atrasado');
    b.members[2].pool_target_cents = 200_000;
    expect(memberPoolStatus(b, NOW)[2].status).toBe('completo');
  });

  it('categoryKind usa a coluna; sem ela (ou "outro"), cai no nome', () => {
    expect(categoryKind({ name: 'Qualquer', kind: 'comida' })).toBe('comida');
    expect(categoryKind({ name: 'Passeios e ingressos', kind: 'outro' })).toBe('passeios');
    expect(categoryKind({ name: 'Alimentação' })).toBe('comida');
    expect(categoryKind({ name: 'Lembrancinhas' })).toBe('outro');
  });

  it('toBaseCents converte com a taxa e devolve null sem ela', () => {
    expect(toBaseCents(1000, 'BRL', 'BRL')).toBe(1000);
    expect(toBaseCents(1000, 'PEN', 'BRL', { PEN: 1.45 })).toBe(1450);
    expect(toBaseCents(1000, 'PEN', 'BRL')).toBeNull();
  });
});

describe('money · categorias e itens', () => {
  it('itens do roteiro entram na categoria do tipo, com pago/não pago pelos vínculos', () => {
    const cats = categoryStatus(andes());
    const tr = cats.find((c) => c.kind === 'transporte')!;
    expect(tr.items).toHaveLength(6);
    const voo = tr.items[0];
    expect(voo.paid).toBe(true);
    expect(voo.costCents).toBe(145_000 * 3);
    const hosp = cats.find((c) => c.kind === 'hospedagem')!;
    expect(hosp.items.filter((i) => i.paid).map((i) => i.title)).toEqual(['Hostel no bairro de San Blas']);
    // Cusco: 4 noites × R$ 290
    expect(hosp.items[1].costCents).toBe(4 * 29_000);
    const ps = cats.find((c) => c.kind === 'passeios')!;
    expect(ps.items.find((i) => /Machu Picchu/.test(i.title))?.paid).toBe(true);
    expect(ps.unpaidCents).toBeGreaterThan(0);
  });

  it('expenseImpact: prévia na categoria, no caixa e no item', () => {
    const b = andes();
    const cat = b.budgetCategories.find((c) => c.kind === 'passeios')!;
    const vale = b.activities.find((a) => /Vale Sagrado/.test(a.title))!;
    const imp = expenseImpact({ baseCents: 54_000, category_id: cat.id, paid_from_pool: true, activity_id: vale.id }, b);
    expect(imp.category).toMatchObject({ beforeCents: 96_000, afterCents: 150_000, plannedCents: 372_000, over: false });
    expect(imp.pool).toEqual({ beforeCents: 385_000, afterCents: 331_000, negative: false });
    expect(imp.item).toEqual({ type: 'activity', id: vale.id, title: vale.title });
    // gasto pelo bolso não mexe no caixa
    expect(expenseImpact({ baseCents: 100, category_id: cat.id, paid_from_pool: false }, b).pool).toBeNull();
  });

  it('expenseImpact na edição tira o valor antigo da conta', () => {
    const b = andes();
    const e = b.expenses.find((x) => x.description === 'Voo GRU → LIM')!;
    const imp = expenseImpact({ id: e.id, baseCents: 400_000, category_id: e.category_id, paid_from_pool: true, transport_id: e.transport_id }, b);
    expect(imp.category!.afterCents).toBe(imp.category!.beforeCents - 435_000 + 400_000);
    expect(imp.pool!.afterCents).toBe(imp.pool!.beforeCents + 35_000);
  });
});

describe('budgetPlan', () => {
  it('estilo e ritmo mudam o total; itens com preço entram como estão', () => {
    const b = andes();
    const eq = budgetFromPlan(b, { style: 'equilibrado', pace: 'moderado', daily_food_cents: null });
    const eco = budgetFromPlan(b, { style: 'economico', pace: 'leve', daily_food_cents: null });
    const conf = budgetFromPlan(b, { style: 'conforto', pace: 'intenso', daily_food_cents: null });
    expect(eco.perPersonCents).toBeLessThan(eq.perPersonCents);
    expect(conf.perPersonCents).toBeGreaterThan(eq.perPersonCents);
    const tr = eq.lines.find((l) => l.kind === 'transporte')!;
    expect(tr.perPersonCents).toBe(145_000 + 145_000 + 42_000 + 11_000 * 3);
    expect(tr.missing).toBe(0);
    expect(eq.totalCents).toBe(eq.perPersonCents * 3);
  });

  it('diária de comida confirmada não leva multiplicador de estilo', () => {
    const b = andes();
    const days = 17;
    const r = budgetFromPlan(b, { style: 'conforto', pace: 'moderado', daily_food_cents: 9000 });
    expect(r.lines.find((l) => l.kind === 'comida')!.perPersonCents).toBe(9000 * days);
  });

  it('plannedUpdates casa pelo tipo da categoria', () => {
    const b = andes();
    const r = budgetFromPlan(b, { style: 'equilibrado', pace: 'moderado', daily_food_cents: 9000 });
    const up = plannedUpdates(b, r);
    expect(up).toHaveLength(4);
    const comida = b.budgetCategories.find((c) => c.kind === 'comida')!;
    expect(up.find((u) => u.id === comida.id)!.planned).toBe(((9000 * 17 * 3) / 100).toFixed(2));
  });

  it('diffSince aponta parada nova, noites trocadas e gente nova', () => {
    const b = andes();
    const snap = snapshotOf(b, '2026-11-01T00:00:00Z');
    expect(diffSince(snap, b)).toEqual([]);
    b.stops[0].departure_date = '2027-01-18';
    b.stops.push({ ...b.stops[5], id: 'nova', name: 'Sucre', position: 9 });
    b.members.push({ ...b.members[1], user_id: 'u4' });
    const d = diffSince(snap, b);
    expect(d).toContainEqual({ kind: 'nights', stopId: b.stops[0].id, name: 'Lima', from: 2, to: 3 });
    expect(d).toContainEqual({ kind: 'stop_added', stopId: 'nova', name: 'Sucre' });
    expect(d).toContainEqual({ kind: 'people', from: 3, to: 4 });
  });
});

describe('suggestions', () => {
  it('estado dos dias: aclimatar na chegada em altitude, vazio, folga e cheio', () => {
    const b = andes();
    const cusco = b.stops[1];
    expect(slotsForDay(b, cusco, '2027-01-17').state).not.toBe('aclimatar'); // dia já tem atividade planejada
    b.activities = b.activities.filter((a) => a.day !== '2027-01-17');
    expect(slotsForDay(b, cusco, '2027-01-17').state).toBe('aclimatar');
    expect(slotsForDay(b, cusco, '2027-01-20')).toMatchObject({ state: 'vazio', dayNumber: 6 });
    expect(fitsSlot('dia_todo', { date: '', dayNumber: 1, count: 1, state: 'folga' })).toBe(false);
    expect(fitsSlot('noite', { date: '', dayNumber: 1, count: 1, state: 'folga' })).toBe(true);
  });

  it('bestDayFor: Montanha Colorida (dia todo) cai no dia vazio de Cusco', () => {
    const b = andes();
    const s = b.suggestions.find((x) => /Montanha/.test(x.payload.title))!;
    expect(bestDayFor(b, s)).toMatchObject({ date: '2027-01-20', dayNumber: 6 });
    // passeio à noite cabe num dia com folga em Lima
    const agua = b.suggestions.find((x) => /Circuito/.test(x.payload.title))!;
    expect(bestDayFor(b, agua)?.state).toBe('folga');
  });

  it('suggestionsForDay respeita o teto de passeios', () => {
    const b = andes();
    const cusco = b.stops[1];
    expect(suggestionsForDay(b, cusco, '2027-01-20').map((s) => s.payload.title)).toEqual(['Montanha Colorida, saindo de Cusco', 'Laguna Humantay', 'Aula de cozinha peruana']);
    expect(suggestionsForDay(b, cusco, '2027-01-20', 5_000)).toEqual([]);
  });

  it('rankForHome: voto pendente → reserva → passeio → aporte; sem IA só regras', () => {
    const b = andes();
    const cards = rankForHome(b, DEMO_USER, NOW);
    const types = cards.map((c) => c.type);
    expect(types[0]).toBe('vote');
    expect(cards[0].detail).toMatch(/Bia: Hostel Pirwa/);
    expect(types.indexOf('reserve')).toBeLessThan(types.indexOf('activity'));
    expect(cards.find((c) => c.type === 'activity')?.eyebrow).toBe('Passeio · cabe no dia 6');
    const noAi = rankForHome({ ...b, suggestions: [] }, DEMO_USER, NOW);
    expect(noAi.some((c) => c.type === 'activity' || c.type === 'area')).toBe(false);
    expect(noAi.length).toBeGreaterThan(0);
  });

  it('rankForHome mostra o aporte atrasado de quem está atrasado', () => {
    const b = andes();
    const leo = b.members[2].user_id;
    expect(rankForHome(b, leo, NOW).some((c) => c.type === 'pool')).toBe(true);
    expect(rankForHome(b, DEMO_USER, NOW).some((c) => c.type === 'pool')).toBe(false);
  });

  it('sugestão dispensada/aceita some; paradas sem sugestão pedem IA', () => {
    const b = andes();
    b.suggestions = b.suggestions.map((s) => ({ ...s, status: 'dismissed' }));
    expect(rankForHome(b, DEMO_USER, NOW).some((c) => c.suggestion)).toBe(false);
    // sugestões da demo são de 1º out: até 14 dias depois só faltam Puno e Uyuni; depois, todas vencem
    expect(stopsNeedingSuggestions(andes(), Date.parse('2026-10-05')).map((s) => s.name)).toEqual(['Puno', 'Uyuni']);
    expect(stopsNeedingSuggestions(andes(), NOW)).toHaveLength(6);
  });
});

describe('photos', () => {
  it('descarta brasões, bandeiras, mapas e SVG', () => {
    expect(isUnfitImage('Cusco_Emblem.svg')).toBe(true);
    expect(isUnfitImage('Flag_of_Peru.png')).toBe(true);
    expect(isUnfitImage('Peru_location_map.jpg')).toBe(true);
    expect(isUnfitImage('Cusco_Plaza_de_Armas.jpg')).toBe(false);
  });

  it('só aceita página do lugar pedido (nunca foto de outro lugar)', () => {
    expect(titleMatches('Cusco', 'Cusco')).toBe(true);
    expect(titleMatches('Barranco, Lima', 'Barranco (Lima)')).toBe(true);
    expect(titleMatches('Vinicunca', 'Montanha Arco-Íris')).toBe(false);
    const json = {
      query: {
        pages: [
          { title: 'Peru', index: 2, pageimage: 'Peru_landscape.jpg' },
          { title: 'Cusco', index: 1, pageimage: 'Cusco_Emblem.svg' },
          { title: 'Cusco (província)', index: 3, pageimage: 'Cusco_vista.jpg' },
        ],
      },
    };
    expect(pickPageImage(json, 'Cusco')).toEqual({ title: 'Cusco (província)', file: 'Cusco_vista.jpg' });
    expect(pickPageImage({ query: { pages: [{ title: 'Lima', pageimage: 'Lima.jpg' }] } }, 'San Blas, Cusco')).toBeNull();
  });

  it('parse do extmetadata: autor sem HTML, licença obrigatória, só upload.wikimedia.org', () => {
    const json = {
      query: {
        pages: [{
          imageinfo: [{
            url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cusco.jpg',
            thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cusco.jpg/1200px-Cusco.jpg',
            thumbwidth: 1200, thumbheight: 800, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cusco.jpg',
            extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Fulano">Fulano &amp; Cia</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
          }],
        }],
      },
    };
    const p = parseImageInfo(json)!;
    expect(p).toEqual({
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cusco.jpg/1200px-Cusco.jpg', width: 1200, height: 800,
      author: 'Fulano & Cia', license: 'CC BY-SA 4.0', source_url: 'https://commons.wikimedia.org/wiki/File:Cusco.jpg',
    });
    expect(photoCredit(p)).toBe('Foto: Fulano & Cia · CC BY-SA 4.0 · Wikimedia Commons');
    expect(thumbAt(p.url!, 400)).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cusco.jpg/400px-Cusco.jpg');
    const noLicense = structuredClone(json);
    noLicense.query.pages[0].imageinfo[0].extmetadata.LicenseShortName.value = '';
    expect(parseImageInfo(noLicense)).toBeNull();
    const other = structuredClone(json);
    other.query.pages[0].imageinfo[0].thumburl = 'https://exemplo.com/x.jpg';
    expect(parseImageInfo(other)).toBeNull();
    expect(stripHtml('<span>Ana</span>&nbsp;<b>Silva</b>')).toBe('Ana Silva');
  });
});
