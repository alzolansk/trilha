// Dinheiro em centavos inteiros (bigint-safe até ~90 trilhões) para evitar erros de ponto flutuante.

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
  shares: { user_id: string; share_cents: number }[];
}
export interface SettlementLike {
  from_user: string;
  to_user: string;
  amount_cents: number;
}

/** Saldo de cada pessoa: positivo = tem a receber; negativo = deve. */
export function balances(expenses: ExpenseLike[], settlements: SettlementLike[], people: string[]): Map<string, number> {
  const net = new Map<string, number>(people.map((p) => [p, 0]));
  const add = (u: string, v: number) => net.set(u, (net.get(u) ?? 0) + v);
  for (const e of expenses) {
    add(e.payer_id, toCents(String(e.base_amount)));
    for (const s of e.shares) add(s.user_id, -s.share_cents);
  }
  for (const s of settlements) {
    add(s.from_user, s.amount_cents);
    add(s.to_user, -s.amount_cents);
  }
  return net;
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
