// Dinheiro em centavos inteiros (bigint-safe até ~90 trilhões) para evitar erros de ponto flutuante.
import type { BudgetCategory, BudgetKind, Member, TripBundle } from '../data/types';

export function toCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100);
  const clean = value.trim().replace(/\s/g, '');
  // aceita "1.234,56", "1234,56", "1234.56"
  let normalized = clean;
  if (clean.includes(',')) normalized = clean.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const SYMBOL_OVERRIDES: Record<string, string> = { PEN: 'S/', BOB: 'Bs' };

export function formatMoney(cents: number, currency = 'BRL', opts: { compact?: boolean } = {}): string {
  const value = cents / 100;
  const digits = opts.compact && Number.isInteger(value) ? 0 : 2;
  const decimals = opts.compact ? (Math.abs(cents) % 100 === 0 ? 0 : 2) : digits;
  try {
    const s = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
    const o = SYMBOL_OVERRIDES[currency];
    return o ? s.replace(currency, o) : s.replace(/ /g, ' ');
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Converte valor original para a moeda base usando a taxa gravada na despesa. */
export function convertCents(amountCents: number, rateToBase: number): number {
  return Math.round(amountCents * rateToBase);
}

/**
 * Divide igualmente em centavos. Os centavos que sobram vão, um a um, para os
 * primeiros da lista (ordem estável), e a soma sempre fecha com o total.
 */
export function splitEqual(totalCents: number, people: string[]): { user_id: string; share_cents: number }[] {
  if (people.length === 0) return [];
  const unique = Array.from(new Set(people));
  const base = Math.floor(totalCents / unique.length);
  let rest = totalCents - base * unique.length;
  return unique.map((user_id) => {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    return { user_id, share_cents: base + extra };
  });
}

export interface ExpenseLike {
  payer_id: string;
  base_amount: number | string;
  /** pago com dinheiro do caixa da turma (não do bolso de payer_id) */
  paid_from_pool?: boolean;
  shares: { user_id: string; share_cents: number }[];
}
/** Aporte no caixa (deposit) ou devolução do caixa para a pessoa (refund), em centavos da moeda base. */
export interface PoolEntryLike {
  user_id: string;
  kind: 'deposit' | 'refund';
  amount_cents: number;
}

/** Id do caixa da turma quando ele entra no acerto como participante. */
export const POOL = 'caixa';
export interface SettlementLike {
  from_user: string;
  to_user: string;
  amount_cents: number;
}

/**
 * Saldo de cada pessoa: positivo = tem a receber; negativo = deve.
 * Havendo caixa, ele aparece como POOL: negativo = sobra a devolver; positivo = faltou dinheiro.
 * A soma de todos os saldos é sempre zero.
 */
export function balances(expenses: ExpenseLike[], settlements: SettlementLike[], people: string[], pool: PoolEntryLike[] = []): Map<string, number> {
  const net = new Map<string, number>(people.map((p) => [p, 0]));
  const add = (u: string, v: number) => net.set(u, (net.get(u) ?? 0) + v);
  for (const e of expenses) {
    add(e.paid_from_pool ? POOL : e.payer_id, toCents(String(e.base_amount)));
    for (const s of e.shares) add(s.user_id, -s.share_cents);
  }
  for (const s of settlements) {
    add(s.from_user, s.amount_cents);
    add(s.to_user, -s.amount_cents);
  }
  for (const c of pool) {
    const v = c.kind === 'deposit' ? c.amount_cents : -c.amount_cents;
    add(c.user_id, v);
    add(POOL, -v);
  }
  return net;
}

/** Dinheiro que deveria estar no caixa agora: aportes − devoluções − gastos pagos pelo caixa. */
export function poolSummary(expenses: Pick<ExpenseLike, 'base_amount' | 'paid_from_pool'>[], pool: PoolEntryLike[]) {
  const deposited = pool.filter((c) => c.kind === 'deposit').reduce((a, c) => a + c.amount_cents, 0);
  const refunded = pool.filter((c) => c.kind === 'refund').reduce((a, c) => a + c.amount_cents, 0);
  const spent = expenses.filter((e) => e.paid_from_pool).reduce((a, e) => a + toCents(String(e.base_amount)), 0);
  const byPerson = new Map<string, number>();
  for (const c of pool) byPerson.set(c.user_id, (byPerson.get(c.user_id) ?? 0) + (c.kind === 'deposit' ? c.amount_cents : -c.amount_cents));
  return { deposited, refunded, spent, balance: deposited - refunded - spent, byPerson };
}

export interface Transfer {
  from: string;
  to: string;
  cents: number;
}

/** Sugere poucas transferências para zerar os saldos (maior devedor → maior credor). */
export function suggestTransfers(net: Map<string, number>): Transfer[] {
  const debtors = [...net].filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v }));
  const creditors = [...net].filter(([, v]) => v > 0).map(([u, v]) => ({ u, v }));
  const out: Transfer[] = [];
  const byAmount = (a: { u: string; v: number }, b: { u: string; v: number }) => b.v - a.v || a.u.localeCompare(b.u);
  debtors.sort(byAmount);
  creditors.sort(byAmount);
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) out.push({ from: debtors[i].u, to: creditors[j].u, cents: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}

export interface CategoryBudget {
  id: string | null;
  name: string;
  color: string;
  plannedCents: number;
  spentCents: number;
  /** % acima do previsto (ex.: 12 = 12% acima), null se não há previsto */
  overPct: number | null;
  usedPct: number | null;
}

export function budgetByCategory(
  categories: { id: string; name: string; color: string; planned: number | string }[],
  expenses: { category_id: string | null; base_amount: number | string }[],
): CategoryBudget[] {
  const spent = new Map<string | null, number>();
  for (const e of expenses) {
    const k = categories.some((c) => c.id === e.category_id) ? e.category_id : null;
    spent.set(k, (spent.get(k) ?? 0) + toCents(String(e.base_amount)));
  }
  const rows: CategoryBudget[] = categories.map((c) => {
    const plannedCents = toCents(String(c.planned));
    const spentCents = spent.get(c.id) ?? 0;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      plannedCents,
      spentCents,
      usedPct: plannedCents > 0 ? Math.round((spentCents / plannedCents) * 100) : null,
      overPct: plannedCents > 0 && spentCents > plannedCents ? Math.round(((spentCents - plannedCents) / plannedCents) * 100) : null,
    };
  });
  const un = spent.get(null);
  if (un) rows.push({ id: null, name: 'Sem categoria', color: '#E3D9C6', plannedCents: 0, spentCents: un, usedPct: null, overPct: null });
  return rows;
}

// ───────────────────────── Trilha 2.0: Dinheiro ligado ao roteiro (planning §7) ─────────────────────────
// Funções puras sobre o TripBundle. Valores sempre em centavos da moeda base da trilha.

/** Taxas para a moeda base (ex.: { PEN: 1.45 } = 1 PEN vale 1,45 na base). */
export type Rates = Record<string, number>;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Tipo da categoria: a coluna `kind` quando existe e não é 'outro'; senão, pelo nome (cópias antigas e demo). */
export function categoryKind(c: Pick<BudgetCategory, 'name'> & { kind?: BudgetKind }): BudgetKind {
  if (c.kind && c.kind !== 'outro') return c.kind;
  const n = fold(c.name);
  if (/transp|passage/.test(n)) return 'transporte';
  if (/hosped|estadia/.test(n)) return 'hospedagem';
  if (/passeio|atividade|ingresso/.test(n)) return 'passeios';
  if (/comida|aliment|refei/.test(n)) return 'comida';
  return 'outro';
}

/** Converte centavos de `currency` para a base. null quando falta a taxa. */
export function toBaseCents(cents: number | null | undefined, currency: string | null | undefined, base: string, rates: Rates = {}): number | null {
  if (cents == null) return null;
  if (!currency || currency === base) return cents;
  const r = rates[currency];
  return r && r > 0 ? Math.round(cents * r) : null;
}

const people = (b: Pick<TripBundle, 'members'>) => Math.max(1, b.members.length);
const plannedOf = (b: Pick<TripBundle, 'trip' | 'budgetCategories'>) => {
  const cats = b.budgetCategories.reduce((a, c) => a + Math.max(0, toCents(String(c.planned))), 0);
  if (cats > 0) return cats;
  return b.trip.budget_total != null ? Math.max(0, toCents(String(b.trip.budget_total))) : 0;
};

export interface BudgetOverview {
  /** planejado da turma toda (soma das categorias; senão, o total da trilha) */
  plannedCents: number;
  /** aportes − devoluções no caixa */
  pooledCents: number;
  /** todos os gastos lançados */
  spentCents: number;
  /** dinheiro que deveria estar no caixa agora */
  poolBalanceCents: number;
  /** planejado − gasto */
  remainingCents: number;
  /** % juntado do planejado (0–100+, null sem planejado) */
  pooledPct: number | null;
  perPersonCents: number;
}

export function budgetOverview(b: Pick<TripBundle, 'trip' | 'budgetCategories' | 'expenses' | 'poolContributions' | 'members'>): BudgetOverview {
  const plannedCents = plannedOf(b);
  const pool = poolSummary(b.expenses, b.poolContributions ?? []);
  const spentCents = b.expenses.reduce((a, e) => a + toCents(String(e.base_amount)), 0);
  const pooledCents = pool.deposited - pool.refunded;
  return {
    plannedCents,
    pooledCents,
    spentCents,
    poolBalanceCents: pool.balance,
    remainingCents: plannedCents - spentCents,
    pooledPct: plannedCents > 0 ? Math.round((pooledCents / plannedCents) * 100) : null,
    perPersonCents: Math.round(plannedCents / people(b)),
  };
}

export type ItemType = 'activity' | 'stay' | 'transport';
export interface CategoryItem {
  type: ItemType;
  id: string;
  title: string;
  stopId: string;
  /** custo estimado/confirmado para a turma toda, na base (null = sem preço ou sem taxa) */
  costCents: number | null;
  isEstimate: boolean;
  /** soma dos gastos ligados a este item */
  paidCents: number;
  paid: boolean;
}
export interface CategoryStatus {
  id: string;
  name: string;
  kind: BudgetKind;
  color: string;
  plannedCents: number;
  spentCents: number;
  items: CategoryItem[];
  /** custo previsto dos itens ainda não pagos */
  unpaidCents: number;
  /** itens sem preço (o Orçamento pergunta por eles) */
  missing: number;
}

/** Custo do item para a turma toda, na base. Atividade e transporte são por pessoa; hospedagem é por noite. */
export function itemCost(b: TripBundle, type: ItemType, id: string, rates: Rates = {}): number | null {
  const base = b.trip.base_currency;
  if (type === 'activity') {
    const a = b.activities.find((x) => x.id === id);
    const v = toBaseCents(a?.cost_cents, a?.cost_currency, base, rates);
    return v == null ? null : v * people(b);
  }
  if (type === 'transport') {
    const t = b.transports.find((x) => x.id === id);
    const v = toBaseCents(t?.price_cents, t?.price_currency, base, rates);
    return v == null ? null : v * people(b);
  }
  const s = b.stays.find((x) => x.id === id);
  const v = toBaseCents(s?.price_cents, s?.price_currency, base, rates);
  if (v == null || !s) return null;
  const stop = b.stops.find((x) => x.id === s.stop_id);
  const from = s.checkin_date ?? stop?.arrival_date;
  const to = s.checkout_date ?? stop?.departure_date;
  const nights = from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)) : 1;
  return v * nights;
}

/** Por categoria: previsto, gasto e os itens do roteiro (pagos e não pagos, pelos vínculos dos gastos). */
export function categoryStatus(b: TripBundle, rates: Rates = {}): CategoryStatus[] {
  const paidBy = new Map<string, number>();
  for (const e of b.expenses) {
    const k = e.activity_id ? `activity:${e.activity_id}` : e.stay_id ? `stay:${e.stay_id}` : e.transport_id ? `transport:${e.transport_id}` : null;
    if (k) paidBy.set(k, (paidBy.get(k) ?? 0) + toCents(String(e.base_amount)));
  }
  const item = (type: ItemType, id: string, title: string, stopId: string, isEstimate: boolean | undefined): CategoryItem => {
    const paidCents = paidBy.get(`${type}:${id}`) ?? 0;
    return { type, id, title, stopId, costCents: itemCost(b, type, id, rates), isEstimate: isEstimate ?? true, paidCents, paid: paidCents > 0 };
  };
  const byKind: Record<BudgetKind, CategoryItem[]> = {
    transporte: b.transports.map((t) => item('transport', t.id, [t.origin_code ?? t.origin_name, t.dest_code ?? t.dest_name].filter(Boolean).join(' → ') || 'Trecho', t.stop_id, t.price_is_estimate)),
    hospedagem: b.stays.map((s) => item('stay', s.id, s.name, s.stop_id, s.price_is_estimate)),
    passeios: b.activities.filter((a) => a.cost_cents != null || paidBy.has(`activity:${a.id}`)).map((a) => item('activity', a.id, a.title, a.stop_id, a.cost_is_estimate)),
    comida: [],
    outro: [],
  };
  const spent = budgetByCategory(b.budgetCategories, b.expenses);
  const seen = new Set<BudgetKind>();
  return [...b.budgetCategories].sort((x, y) => x.position - y.position).map((c) => {
    const kind = categoryKind(c);
    // se houver duas categorias do mesmo tipo, os itens ficam só na primeira
    const items = seen.has(kind) ? [] : byKind[kind];
    seen.add(kind);
    const row = spent.find((r) => r.id === c.id);
    return {
      id: c.id,
      name: c.name,
      kind,
      color: c.color,
      plannedCents: row?.plannedCents ?? 0,
      spentCents: row?.spentCents ?? 0,
      items,
      unpaidCents: items.filter((i) => !i.paid).reduce((a, i) => a + (i.costCents ?? 0), 0),
      missing: items.filter((i) => i.costCents == null).length,
    };
  });
}

export type PoolStatus = 'completo' | 'em_dia' | 'atrasado' | 'sem_meta';
export interface MemberPool {
  userId: string;
  depositedCents: number;
  targetCents: number;
  /** quanto já deveria ter entrado até agora (meta proporcional ao tempo até a viagem) */
  expectedCents: number;
  pct: number | null;
  status: PoolStatus;
}

/**
 * Juntado, meta e status de cada pessoa no caixa. Meta = cota individual (pool_target_cents)
 * ou planejado ÷ pessoas. "Em dia" compara com uma meta linear entre a criação da trilha e o embarque.
 */
export function memberPoolStatus(b: Pick<TripBundle, 'trip' | 'budgetCategories' | 'expenses' | 'poolContributions' | 'members'>, now = Date.now()): MemberPool[] {
  const share = Math.round(plannedOf(b) / people(b));
  const { byPerson } = poolSummary(b.expenses, b.poolContributions ?? []);
  const start = Date.parse(`${b.trip.start_date}T00:00:00`);
  const created = Date.parse(b.trip.created_at);
  const span = start - created;
  const elapsed = span > 0 ? Math.min(1, Math.max(0, (now - created) / span)) : 1;
  return b.members.map((m: Member) => {
    const targetCents = m.pool_target_cents ?? share;
    const depositedCents = Math.max(0, byPerson.get(m.user_id) ?? 0);
    const expectedCents = Math.round(targetCents * elapsed);
    const status: PoolStatus = targetCents <= 0 ? 'sem_meta' : depositedCents >= targetCents ? 'completo' : depositedCents >= expectedCents ? 'em_dia' : 'atrasado';
    return { userId: m.user_id, depositedCents, targetCents, expectedCents, pct: targetCents > 0 ? Math.round((depositedCents / targetCents) * 100) : null, status };
  });
}

export interface ExpenseDraft {
  /** valor na moeda base, em centavos */
  baseCents: number;
  category_id: string | null;
  paid_from_pool: boolean;
  activity_id?: string | null;
  stay_id?: string | null;
  transport_id?: string | null;
  /** id do gasto em edição (o valor antigo sai da conta) */
  id?: string | null;
}
export interface ExpenseImpact {
  category: { id: string; name: string; beforeCents: number; afterCents: number; plannedCents: number; over: boolean } | null;
  pool: { beforeCents: number; afterCents: number; negative: boolean } | null;
  item: { type: ItemType; id: string; title: string } | null;
}

/** Prévia do Sheet de gasto (planning §6.1): o que muda na categoria, no caixa e no item ligado. */
export function expenseImpact(d: ExpenseDraft, b: TripBundle): ExpenseImpact {
  const old = d.id ? b.expenses.find((e) => e.id === d.id) : null;
  const oldCents = old ? toCents(String(old.base_amount)) : 0;
  const cats = budgetByCategory(b.budgetCategories, b.expenses);
  const cat = d.category_id ? cats.find((c) => c.id === d.category_id) : null;
  const before = cat?.spentCents ?? 0;
  const after = before - (old && old.category_id === d.category_id ? oldCents : 0) + d.baseCents;
  const pool = poolSummary(b.expenses, b.poolContributions ?? []);
  const poolBefore = pool.balance;
  const poolAfter = poolBefore + (old?.paid_from_pool ? oldCents : 0) - (d.paid_from_pool ? d.baseCents : 0);
  const type: ItemType | null = d.activity_id ? 'activity' : d.stay_id ? 'stay' : d.transport_id ? 'transport' : null;
  const itemId = d.activity_id ?? d.stay_id ?? d.transport_id ?? null;
  const title = type === 'activity' ? b.activities.find((a) => a.id === itemId)?.title
    : type === 'stay' ? b.stays.find((s) => s.id === itemId)?.name
    : type === 'transport' ? (() => { const t = b.transports.find((x) => x.id === itemId); return t ? [t.origin_code, t.dest_code ?? t.dest_name].filter(Boolean).join(' → ') || 'Trecho' : undefined; })()
    : undefined;
  return {
    category: cat && cat.id ? { id: cat.id, name: cat.name, beforeCents: before, afterCents: after, plannedCents: cat.plannedCents, over: cat.plannedCents > 0 && after > cat.plannedCents } : null,
    pool: d.paid_from_pool || old?.paid_from_pool ? { beforeCents: poolBefore, afterCents: poolAfter, negative: poolAfter < 0 } : null,
    item: type && itemId && title ? { type, id: itemId, title } : null,
  };
}
