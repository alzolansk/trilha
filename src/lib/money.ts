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

// ───────────────────────── Fase 6: telas de Dinheiro (planning §5.6 e §6) ─────────────────────────

export type MovementKind = 'expense' | 'deposit' | 'refund' | 'settlement';
export interface Movement {
  kind: MovementKind;
  id: string;
  /** data do movimento (yyyy-mm-dd) */
  date: string;
  /** desempate na ordem (mais recente primeiro) */
  at: string;
  title: string;
  /** quem pagou / aportou / recebeu; POOL quando saiu do caixa */
  who: string;
  /** destino de um pagamento entre pessoas */
  to?: string;
  /** valor na base (positivo = entra no caixa ou pagamento; gastos também positivos) */
  cents: number;
  /** valor original quando a moeda é outra */
  original?: { cents: number; currency: string } | null;
  categoryId?: string | null;
  stopId?: string | null;
  item?: { type: ItemType; id: string } | null;
  /** gasto: quem dividiu */
  people?: string[];
}

/** Extrato: gastos, aportes, devoluções e pagamentos, do mais recente ao mais antigo. */
export function ledger(b: Pick<TripBundle, 'expenses' | 'expenseShares' | 'poolContributions' | 'settlements' | 'trip'>): Movement[] {
  const base = b.trip.base_currency;
  const out: Movement[] = [];
  for (const e of b.expenses) {
    out.push({
      kind: 'expense', id: e.id, date: e.spent_on, at: e.created_at ?? e.spent_on, title: e.description,
      who: e.paid_from_pool ? POOL : e.payer_id, cents: toCents(String(e.base_amount)),
      original: e.currency !== base ? { cents: toCents(String(e.amount)), currency: e.currency } : null,
      categoryId: e.category_id, stopId: e.stop_id,
      item: e.activity_id ? { type: 'activity', id: e.activity_id } : e.stay_id ? { type: 'stay', id: e.stay_id } : e.transport_id ? { type: 'transport', id: e.transport_id } : null,
      people: b.expenseShares.filter((s) => s.expense_id === e.id).map((s) => s.user_id),
    });
  }
  for (const c of b.poolContributions ?? []) {
    out.push({ kind: c.kind, id: c.id, date: c.contributed_on, at: c.created_at, title: c.kind === 'deposit' ? 'Aporte no caixa' : 'Devolução do caixa', who: c.user_id, cents: c.amount_cents });
  }
  for (const s of b.settlements) {
    out.push({ kind: 'settlement', id: s.id, date: s.paid_on, at: s.created_at, title: 'Pagamento entre a turma', who: s.from_user, to: s.to_user, cents: s.amount_cents });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date) || y.at.localeCompare(x.at));
}

export interface MovementFilter {
  type?: 'all' | 'expenses' | 'pool';
  categoryId?: string | null;
  stopId?: string | null;
  person?: string | null;
  q?: string;
}

/** Filtros do Extrato (planning §6.3). Pessoa casa com quem pagou, quem dividiu, quem aportou e os dois lados de um pagamento. */
export function filterMovements(list: Movement[], f: MovementFilter): Movement[] {
  const q = f.q ? fold(f.q.trim()) : '';
  return list.filter((m) => {
    if (f.type === 'expenses' && m.kind !== 'expense') return false;
    if (f.type === 'pool' && m.kind !== 'deposit' && m.kind !== 'refund') return false;
    if (f.categoryId && m.categoryId !== f.categoryId) return false;
    if (f.stopId && m.stopId !== f.stopId) return false;
    if (f.person && m.who !== f.person && m.to !== f.person && !m.people?.includes(f.person)) return false;
    if (q && !fold(m.title).includes(q)) return false;
    return true;
  });
}

/** CSV do extrato (separador ";" e vírgula decimal, como o Excel em pt-BR abre). */
export function movementsCsv(list: Movement[], opts: { base: string; nameOf: (uid: string) => string; categoryOf: (id: string | null | undefined) => string; stopOf: (id: string | null | undefined) => string }): string {
  const dec = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  // Texto da turma pode começar com fórmula; exportar como texto no Excel.
  const esc = (raw: string) => {
    const v = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const KIND: Record<MovementKind, string> = { expense: 'Gasto', deposit: 'Aporte', refund: 'Devolução', settlement: 'Pagamento' };
  const rows = [['Data', 'Tipo', 'Descrição', 'Quem', 'Para', 'Categoria', 'Parada', 'Valor original', 'Moeda original', `Valor (${opts.base})`]];
  for (const m of list) {
    rows.push([
      m.date, KIND[m.kind], m.title, m.who === POOL ? 'Caixa da turma' : opts.nameOf(m.who), m.to ? opts.nameOf(m.to) : '',
      m.kind === 'expense' ? opts.categoryOf(m.categoryId) : '', m.kind === 'expense' ? opts.stopOf(m.stopId) : '',
      m.original ? dec(m.original.cents) : dec(m.cents), m.original?.currency ?? opts.base, dec(m.cents),
    ]);
  }
  return rows.map((r) => r.map((v) => esc(String(v))).join(';')).join('\r\n');
}

/** Itens do roteiro ainda sem gasto ligado, para sugerir no Sheet de gasto ("Ingresso Machu Picchu"). */
export function unpaidItems(b: TripBundle, rates: Rates = {}): (CategoryItem & { categoryId: string | null })[] {
  const out: (CategoryItem & { categoryId: string | null })[] = [];
  const cats = categoryStatus(b, rates);
  const kinds = new Set(cats.map((c) => c.kind));
  for (const c of cats) for (const i of c.items) if (!i.paid) out.push({ ...i, categoryId: c.id });
  // trilha sem categoria de passeios: as atividades ainda aparecem, sem categoria
  if (!kinds.has('passeios')) {
    for (const a of b.activities) if (!b.expenses.some((e) => e.activity_id === a.id)) out.push({ type: 'activity', id: a.id, title: a.title, stopId: a.stop_id, costCents: itemCost(b, 'activity', a.id, rates), isEstimate: a.cost_is_estimate ?? true, paidCents: 0, paid: false, categoryId: null });
  }
  return out;
}

/** Preenchimento do Sheet de gasto a partir de um item ("Marcar como pago"). */
export function paymentPreset(b: TripBundle, type: ItemType, id: string, rates: Rates = {}): { description: string; categoryId: string | null; stopId: string | null; cents: number | null } {
  const cat = categoryStatus(b, rates).find((c) => c.items.some((i) => i.type === type && i.id === id));
  const kind: BudgetKind = type === 'activity' ? 'passeios' : type === 'stay' ? 'hospedagem' : 'transporte';
  const categoryId = cat?.id ?? b.budgetCategories.find((c) => categoryKind(c) === kind)?.id ?? null;
  if (type === 'activity') {
    const a = b.activities.find((x) => x.id === id);
    return { description: a?.title ?? 'Passeio', categoryId, stopId: a?.stop_id ?? null, cents: itemCost(b, type, id, rates) };
  }
  if (type === 'stay') {
    const s = b.stays.find((x) => x.id === id);
    return { description: s?.name ?? 'Hospedagem', categoryId, stopId: s?.stop_id ?? null, cents: itemCost(b, type, id, rates) };
  }
  const t = b.transports.find((x) => x.id === id);
  const title = t ? [t.origin_code ?? t.origin_name, t.dest_code ?? t.dest_name].filter(Boolean).join(' → ') : '';
  return { description: title ? `Passagem ${title}` : 'Passagem', categoryId, stopId: t?.stop_id ?? null, cents: itemCost(b, type, id, rates) };
}

/** Título curto de um item do roteiro (cadeia "Caixa → Passeios → Dia 7 ✓ pago"). */
export function itemLabel(b: TripBundle, type: ItemType, id: string): string | null {
  if (type === 'activity') {
    const a = b.activities.find((x) => x.id === id);
    return a ? `Dia ${Math.max(1, Math.round((Date.parse(a.day) - Date.parse(b.trip.start_date)) / 86_400_000) + 1)}` : null;
  }
  if (type === 'stay') return b.stays.find((x) => x.id === id)?.name ?? null;
  const t = b.transports.find((x) => x.id === id);
  return t ? [t.origin_code ?? t.origin_name, t.dest_code ?? t.dest_name].filter(Boolean).join(' → ') || 'Trecho' : null;
}

/** Linha de contexto do cartão da categoria: "Voos pagos · falta o trem e os ônibus". */
export function categoryContext(b: TripBundle, c: CategoryStatus): string {
  const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' e ') : `${xs.slice(0, 2).join(', ')} e mais ${xs.length - 2}`);
  if (c.kind === 'comida') {
    const d = b.trip.budget_plan?.daily_food_cents;
    return d ? `Reserva para a viagem, ${formatMoney(d, b.trip.base_currency, { compact: true })} por pessoa/dia` : 'Reserva para comida e compras durante a viagem';
  }
  if (c.kind === 'hospedagem') {
    const voting = (b.polls ?? []).filter((p) => p.status === 'open' && p.target === 'stay' && p.stop_id).map((p) => b.stops.find((s) => s.id === p.stop_id)?.name).filter(Boolean) as string[];
    if (voting.length && !c.items.some((i) => i.paid)) return `${list(voting)} em votação`;
  }
  if (!c.items.length) return c.spentCents ? 'Gastos lançados à mão' : 'Nada lançado ainda';
  const paid = c.items.filter((i) => i.paid).map((i) => i.title);
  const open = c.items.filter((i) => !i.paid).map((i) => i.title);
  if (!open.length) return `Tudo pago: ${list(paid)}`;
  if (!paid.length) return `Falta pagar ${list(open)}`;
  return `${list(paid)} ${paid.length > 1 ? 'pagos' : 'pago'} · falta ${list(open)}`;
}

/** Gasto lançado nas últimas 24 h (o cartão da categoria ganha destaque "Acabou de baixar"). */
export function recentHit(b: Pick<TripBundle, 'expenses'>, now = Date.now()): { categoryId: string; description: string } | null {
  const fresh = b.expenses
    .filter((e) => e.category_id && e.created_at && now - Date.parse(e.created_at) < 86_400_000 && now - Date.parse(e.created_at) >= -60_000)
    .sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
  return fresh ? { categoryId: fresh.category_id!, description: fresh.description } : null;
}

/** Valores rápidos do Sheet de aporte: o que falta para a meta e metade disso. */
export function poolQuickAmounts(m: Pick<MemberPool, 'depositedCents' | 'targetCents'> | null | undefined): { missing: number; half: number } | null {
  if (!m || m.targetCents <= 0) return null;
  const missing = Math.max(0, m.targetCents - m.depositedCents);
  return missing > 0 ? { missing, half: Math.round(missing / 2) } : null;
}

/** Divisão "valores diferentes": confere se soma o total. */
export function customSplit(total: number, values: Record<string, number | null>): { shares: { user_id: string; share_cents: number }[]; diff: number } {
  const shares = Object.entries(values).filter(([, v]) => v != null && v > 0).map(([user_id, v]) => ({ user_id, share_cents: v! }));
  return { shares, diff: total - shares.reduce((a, s) => a + s.share_cents, 0) };
}
