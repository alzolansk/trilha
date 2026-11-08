// Planejamento assistido: orçamento por pessoa, faixas "cabe / passa do teto" e links de busca.
// Funções puras, usadas no navegador e nos testes. Valores de IA são sempre estimativas.
import type { BudgetCategory, Stop, TripBundle } from '../data/types';
import { toCents } from './money';
import { daysBetween } from './time';

/** Divisão sugerida do orçamento por pessoa (proporções; a soma fecha no total). */
export const BUDGET_SPLIT: { name: string; share: number }[] = [
  { name: 'Transporte', share: 0.22 },
  { name: 'Hospedagem', share: 0.4 },
  { name: 'Comida', share: 0.25 },
  { name: 'Passeios', share: 0.13 },
];

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Pessoas que dividem a viagem (no mínimo 1). */
export function headcount(b: Pick<TripBundle, 'members'>): number {
  return Math.max(1, b.members.length);
}

/** Orçamento total em centavos (o total da trilha, ou a soma do previsto por categoria). */
export function budgetTotalCents(b: Pick<TripBundle, 'trip' | 'budgetCategories'>): number {
  if (b.trip.budget_total != null) {
    const t = toCents(String(b.trip.budget_total));
    if (t > 0) return t;
  }
  return b.budgetCategories.reduce((a, c) => a + Math.max(0, toCents(String(c.planned))), 0);
}

export function perPersonCents(b: Pick<TripBundle, 'trip' | 'budgetCategories' | 'members'>): number {
  return Math.round(budgetTotalCents(b) / headcount(b));
}

/**
 * Previsto de cada categoria para um total. Casa pelo nome (sem acento); categorias
 * que não estão na divisão sugerida ficam como estão. O arredondamento sobra na Hospedagem.
 */
export function splitBudget(totalCents: number, cats: Pick<BudgetCategory, 'id' | 'name'>[]): Map<string, number> {
  const out = new Map<string, number>();
  const matched = BUDGET_SPLIT.map((s) => ({ ...s, cat: cats.find((c) => norm(c.name) === norm(s.name)) })).filter((s) => s.cat);
  const sum = matched.reduce((a, s) => a + s.share, 0);
  if (!sum) return out;
  let used = 0;
  for (const s of matched) {
    const v = Math.floor((totalCents * s.share) / sum);
    out.set(s.cat!.id, v);
    used += v;
  }
  const hosp = matched.find((s) => s.name === 'Hospedagem') ?? matched[0];
  out.set(hosp.cat!.id, (out.get(hosp.cat!.id) ?? 0) + (totalCents - used));
  return out;
}

/** Previsto de uma categoria por pessoa (0 quando não há). */
export function categoryPerPerson(b: Pick<TripBundle, 'budgetCategories' | 'members'>, name: string): number {
  const c = b.budgetCategories.find((x) => norm(x.name) === norm(name));
  return c ? Math.round(Math.max(0, toCents(String(c.planned))) / headcount(b)) : 0;
}

/** Noites da viagem toda (mínimo 1). */
export function tripNights(b: Pick<TripBundle, 'trip'>): number {
  return Math.max(1, daysBetween(b.trip.start_date, b.trip.end_date));
}

export function stopNights(s: Pick<Stop, 'arrival_date' | 'departure_date'>): number {
  return Math.max(0, daysBetween(s.arrival_date, s.departure_date));
}

/** Teto de passeios por pessoa nesta parada: o previsto de Passeios proporcional aos dias dela. */
export function activityCapForStop(b: TripBundle, s: Stop): number {
  const per = categoryPerPerson(b, 'Passeios');
  if (!per) return 0;
  const days = stopNights(s) + 1;
  const total = daysBetween(b.trip.start_date, b.trip.end_date) + 1;
  return Math.round((per * Math.min(days, total)) / Math.max(1, total));
}

/** Teto da diária para o grupo todo: Hospedagem prevista ÷ noites da viagem. */
export function nightlyCap(b: TripBundle): number {
  const c = b.budgetCategories.find((x) => norm(x.name) === 'hospedagem');
  const total = c ? Math.max(0, toCents(String(c.planned))) : 0;
  return total ? Math.round(total / tripNights(b)) : 0;
}

export type Fit = 'free' | 'fits' | 'over' | 'unknown';

/** Cabe no teto? Usa o topo da faixa estimada (pra não prometer o que pode não caber). */
export function fitOf(lowCents: number, highCents: number, capCents: number): Fit {
  if (highCents <= 0 && lowCents <= 0) return 'free';
  if (!capCents) return 'unknown';
  return highCents <= capCents ? 'fits' : 'over';
}

/** "~R$ 80–120" a partir de uma faixa estimada em centavos. */
export function rangeLabel(lowCents: number, highCents: number, currency: string): string {
  const fmt = (c: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(c / 100));
  const sym = currency === 'BRL' ? 'R$' : currency;
  if (highCents <= 0) return 'grátis';
  if (lowCents === highCents || lowCents <= 0) return `~${sym} ${fmt(highCents)}`;
  return `~${sym} ${fmt(lowCents)}–${fmt(highCents)}`;
}

/** "~4h30" de viagem estimada. */
export function hoursLabel(h: number): string {
  if (!h || h <= 0) return '';
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60 / 10) * 10;
  if (!whole) return `~${min} min`;
  return min ? `~${whole}h${String(min === 60 ? 0 : min).padStart(2, '0')}` : `~${whole}h`;
}

export interface SearchLink { label: string; url: string }

/** Buscas de hospedagem já com cidade, datas e pessoas (o Trilha não reserva nada). */
export function staySearchLinks(
  place: string, checkin: string, checkout: string, adults: number,
  opts: { area?: string | null; maxNightCents?: number | null; currency?: string } = {},
): SearchLink[] {
  // Bairro escolhido entra na busca ("San Blas, Cusco, Peru"); sem ele, só a cidade.
  const where = opts.area && !place.toLowerCase().includes(opts.area.toLowerCase()) ? `${opts.area}, ${place}` : place;
  const q = encodeURIComponent(where);
  const n = Math.max(1, Math.min(16, adults));
  // Teto por noite (quarto/casa inteiro) em reais inteiros, só onde o site aceita filtro de preço na URL.
  const max = opts.maxNightCents && opts.maxNightCents > 0 ? Math.round(opts.maxNightCents / 100) : null;
  const cur = opts.currency ?? 'BRL';
  const booking = new URLSearchParams({ ss: where, checkin, checkout, group_adults: String(n), no_rooms: '1', group_children: '0' });
  if (max) {
    booking.set('selected_currency', cur);
    booking.set('nflt', `price=${cur}-0-${max}-1`);
  }
  const airbnb = new URLSearchParams({ checkin, checkout, adults: String(n) });
  if (max) airbnb.set('price_max', String(max));
  return [
    { label: 'Booking', url: `https://www.booking.com/searchresults.pt-br.html?${booking}` },
    { label: 'Airbnb', url: `https://www.airbnb.com.br/s/${q}/homes?${airbnb}` },
    { label: 'Hostelworld', url: `https://www.hostelworld.com/find-and-book/search?search_keywords=${q}&from=${checkin}&to=${checkout}&guests=${n}` },
  ];
}

/** Enquete livre aberta enquanto a trilha não tem destino: é a disputa pelo destino. */
export function destinationPollId(b: TripBundle): string | null {
  if (b.trip.destinations.some((d) => d.trim())) return null;
  return (b.polls ?? []).find((p) => p.target === 'free' && p.status === 'open')?.id ?? null;
}
